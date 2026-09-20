// 通用 HTTP 请求助手
// 说明：部分图站（如 soutubot）需要通过插件的「独立代理」而非全局 ctx.http 访问，
// 因此这里基于 Node 原生 fetch 实现，并可按需挂载 undici 的 ProxyAgent。

import { Readable } from 'stream'

/** 仅取 fetch 的 dispatcher 字段，避免在类型层面硬依赖 undici */
type FetchDispatcher = NonNullable<RequestInit extends { dispatcher?: infer D } ? D : never>
export type FetchInit = Omit<RequestInit, 'dispatcher'> & { dispatcher?: FetchDispatcher }

/** 代理 dispatcher 缓存，key 为代理地址（含空字符串表示直连） */
const agentCache = new Map<string, FetchDispatcher>()

type ProxyAgentCtor = new (uri: string) => FetchDispatcher
let proxyAgentCtor: ProxyAgentCtor | null | undefined

/**
 * 动态解析 undici 的 ProxyAgent。
 * 优先使用插件自身的 undici 依赖，找不到时回退到 Node 内置的 undici。
 */
async function loadProxyAgentCtor(): Promise<ProxyAgentCtor | null> {
    if (proxyAgentCtor !== undefined) return proxyAgentCtor

    const candidates = ['undici', 'node:undici', 'internal/deps/undici/undici']
    for (const specifier of candidates) {
        try {
            const mod: any = await import(/* @vite-ignore */ specifier)
            const candidate = mod?.ProxyAgent ?? mod?.default?.ProxyAgent
            if (typeof candidate === 'function') {
                proxyAgentCtor = candidate as ProxyAgentCtor
                return proxyAgentCtor
            }
        } catch {
            // 继续尝试下一个候选模块
        }
    }

    proxyAgentCtor = null
    return proxyAgentCtor
}

/** 取得（并缓存）指定代理地址对应的 dispatcher，失败时返回 null 表示直连 */
export async function resolveProxyDispatcher(proxyUrl?: string): Promise<FetchDispatcher | null> {
    const key = (proxyUrl || '').trim()
    if (!key) return null

    if (agentCache.has(key)) return agentCache.get(key) ?? null

    const ctor = await loadProxyAgentCtor()
    if (!ctor) return null

    try {
        const agent = new ctor(key)
        agentCache.set(key, agent)
        return agent
    } catch {
        return null
    }
}

/** 释放全部缓存的代理 dispatcher */
export async function disposeProxyDispatchers(): Promise<void> {
    const agents = [...agentCache.values()]
    agentCache.clear()
    await Promise.all(agents.map(async (agent: any) => {
        try {
            await agent?.close?.()
        } catch {
            // 关闭失败不影响插件卸载
        }
    }))
}

/** 带状态码与响应体的 HTTP 错误 */
export class HttpError extends Error {
    constructor(message: string, public readonly status: number, public readonly body: string) {
        super(message)
        this.name = 'HttpError'
    }
}

/** 下载过程中的超时（非请求超时） */
export class HttpTimeoutError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'Timeout'
    }
}

/** 网络层错误，去重时只保留一份提示 */
function unwrapError(error: unknown): Error {
    if (error instanceof Error) {
        const cause = (error as { cause?: unknown }).cause
        if (cause instanceof Error && !error.message.includes(cause.message)) {
            return new Error(`${error.message} (${cause.message})`)
        }
        return error
    }
    return new Error(String(error))
}

export function describeHttpError(error: unknown): string {
    if (error instanceof HttpError) {
        return `状态码 ${error.status}${error.body ? `: ${error.body.slice(0, 200)}` : ''}`
    }
    return unwrapError(error).message
}

/** 从响应中提取可读的错误正文 */
async function extractErrorBody(response: Response): Promise<string> {
    try {
        const text = await readBodyText(response)
        const trimmed = text.trim()
        if (!trimmed) return ''

        try {
            const payload = JSON.parse(trimmed)
            const message = payload?.error?.message || payload?.error || payload?.message || payload?.detail
            if (typeof message === 'string' && message.trim()) return message.trim()
        } catch {
            // 非 JSON 响应，直接使用截断后的文本
        }

        return trimmed.replace(/\s+/g, ' ').slice(0, 300)
    } catch {
        return ''
    }
}

/**
 * 流式读取响应正文（带空闲超时保护）。
 * 相比 response.text()，可以在服务端只挂起连接、迟迟不返回响应体时及时失败。
 */
export async function readResponseBody(response: Response, idleTimeoutMs: number): Promise<Buffer> {
    const body = response.body as ReadableStream<Uint8Array> | null
    if (!body) return Buffer.from(await response.arrayBuffer())

    const stream = Readable.fromWeb(body as any)
    const chunks: Buffer[] = []

    await new Promise<void>((resolve, reject) => {
        let timer: NodeJS.Timeout

        const cleanup = () => clearTimeout(timer)
        const arm = () => {
            cleanup()
            timer = setTimeout(() => {
                stream.destroy()
                reject(new HttpTimeoutError(`响应体读取超时（${Math.round(idleTimeoutMs / 1000)} 秒内无数据）`))
            }, idleTimeoutMs)
        }

        arm()
        stream.on('data', (chunk: Buffer) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
            arm()
        })
        stream.on('end', () => {
            cleanup()
            resolve()
        })
        stream.on('error', (error) => {
            cleanup()
            reject(error)
        })
    })

    return Buffer.concat(chunks)
}

/** 读取响应正文为 UTF-8 文本 */
export async function readBodyText(response: Response, idleTimeoutMs = 30000): Promise<string> {
    const buffer = await readResponseBody(response, idleTimeoutMs)
    return buffer.toString('utf8').replace(/^\uFEFF/, '')
}

export interface FetchWithProxyOptions extends FetchInit {
    /** 独立代理地址，留空表示直连 */
    proxyUrl?: string
    /** 请求超时（毫秒），覆盖响应头与响应体的等待时间 */
    timeout?: number
    /** 失败重试次数（不含首次请求） */
    retries?: number
    /** 重试基础间隔（毫秒），按次数指数退避 */
    retryDelay?: number
    /** 是否把 429 / 5xx 视为可重试 */
    retryOnStatus?: boolean
    debug?: (message: string) => void
}

/**
 * 发起带代理与重试的 HTTP 请求。
 * 仅重试网络错误、超时以及（可选的）429 / 5xx，业务性 4xx 直接抛出。
 */
export async function fetchWithProxy(url: string, options: FetchWithProxyOptions = {}): Promise<Response> {
    const {
        proxyUrl,
        timeout = 30000,
        retries = 1,
        retryDelay = 1000,
        retryOnStatus = true,
        debug,
        ...init
    } = options

    const dispatcher = await resolveProxyDispatcher(proxyUrl)
    if (dispatcher) debug?.(`使用代理: ${proxyUrl}`)

    let lastError: Error = new Error('请求失败')

    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeout)

        try {
            // 注意：dispatcher 为 null/undefined 时必须完全省略该字段，
            // 否则 Node 内置 undici 会因 dispatcher 非法而抛出断言错误。
            const requestInit: Record<string, unknown> = { ...(init as Record<string, unknown>) }
            requestInit.signal = controller.signal
            if (dispatcher) requestInit.dispatcher = dispatcher

            const response = await fetch(url, requestInit as RequestInit)

            if (response.ok) return response

            const status = response.status
            const body = await extractErrorBody(response)
            const retryable = retryOnStatus && (status === 429 || status >= 500)
            lastError = new HttpError(body || response.statusText || `HTTP ${status}`, status, body)

            if (!retryable || attempt === retries) throw lastError
        } catch (error) {
            if (error instanceof HttpError) {
                // 业务错误，直接抛出
                if (!(retryOnStatus && (error.status === 429 || error.status >= 500))) throw error
                lastError = error
                if (attempt === retries) throw lastError
            } else {
                lastError = controller.signal.aborted
                    ? new HttpTimeoutError(`请求超时（${Math.round(timeout / 1000)} 秒）`)
                    : unwrapError(error)
                if (attempt === retries) throw lastError
            }
        } finally {
            clearTimeout(timer)
        }

        const wait = retryDelay * Math.pow(2, attempt)
        debug?.(`请求失败（${describeHttpError(lastError)}），${wait}ms 后重试 (${attempt + 1}/${retries})`)
        await new Promise((resolve) => setTimeout(resolve, wait))
    }

    throw lastError
}

/** 读取完整响应正文并返回文本，失败时抛错 */
export async function fetchTextWithProxy(url: string, options: FetchWithProxyOptions = {}): Promise<string> {
    const response = await fetchWithProxy(url, options)
    return readBodyText(response, options.timeout ?? 30000)
}

/** 读取完整响应正文并解析为 JSON */
export async function fetchJsonWithProxy<T = any>(url: string, options: FetchWithProxyOptions = {}): Promise<T> {
    const text = await fetchTextWithProxy(url, options)
    try {
        return JSON.parse(text) as T
    } catch {
        throw new Error(`响应不是有效的 JSON: ${text.slice(0, 200)}`)
    }
}
