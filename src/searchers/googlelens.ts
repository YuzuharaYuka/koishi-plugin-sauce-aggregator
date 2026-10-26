import { Context, Logger } from 'koishi'
import { Config, Searcher, SearchOptions, GoogleLens as GoogleLensConfig, SearchEngineName } from '../config'
import { fetchJsonWithProxy, describeHttpError, HttpError } from '../core/http'

// Google Lens 搜索器（通过 SerpApi）
//
// SerpApi 的 google_lens 引擎只接受公网图片 URL：
//   GET https://serpapi.com/search?engine=google_lens&url=<公网图片URL>&hl=zh-cn&api_key=<key>
// 返回 JSON 中的 visual_matches[] 即「视觉匹配」结果（title / link / source / thumbnail）。
//
// 与 yandex、ascii2d 一样属于附加（补充）引擎：
// 本引擎不返回相似度，因此不参与「找到高匹配度即停止」的判定。

const logger = new Logger('sauce-aggregator')

const ENDPOINT = 'https://serpapi.com/search'
const DEFAULT_HL = 'zh-cn'
/** 额度耗尽的 Key 在此时间内不再尝试（毫秒） */
const EXHAUSTED_COOLDOWN = 10 * 60 * 1000
/** 单次请求的超时下限，SerpApi 偶尔较慢 */
const MIN_TIMEOUT = 20000

interface VisualMatch {
    position?: number
    title?: string
    link?: string
    source?: string
    source_icon?: string
    thumbnail?: string
    thumbnail_width?: number
    thumbnail_height?: number
    image?: string
    image_width?: number
    image_height?: number
}

interface SerpApiResponse {
    error?: string
    visual_matches?: VisualMatch[]
    search_metadata?: { status?: string }
}

export class GoogleLens extends Searcher<GoogleLensConfig.Config> {
    public readonly name: SearchEngineName = 'googlelens'

    /** 下一个使用的 Key 下标，实现多 Key 轮询 */
    private keyIndex = 0
    /** 已判定额度耗尽的 Key -> 判定时间 */
    private readonly exhaustedKeys = new Map<string, number>()

    constructor(ctx: Context, mainConfig: Config, subConfig: GoogleLensConfig.Config) {
        super(ctx, mainConfig, subConfig)
    }

    async search(options: SearchOptions): Promise<Searcher.Result[]> {
        const apiKeys = (this.subConfig.apiKeys || []).filter(Boolean)
        if (apiKeys.length === 0) {
            logger.warn('[googlelens] 未配置 SerpApi API Key，已跳过')
            return []
        }

        // SerpApi 不支持本地文件，必须有公网可访问的图片链接
        if (!options.imageUrl || !/^https?:\/\//i.test(options.imageUrl)) {
            logger.warn('[googlelens] 需要公网 HTTP/HTTPS 图片链接，已跳过')
            return []
        }

        const startTime = Date.now()
        const debugEnabled = this.mainConfig.debug.enabled
        const timeout = Math.max(this.mainConfig.requestTimeout * 1000, MIN_TIMEOUT)

        let lastError: Error | null = null

        for (let i = 0; i < apiKeys.length; i++) {
            const currentIndex = (this.keyIndex + i) % apiKeys.length
            const apiKey = apiKeys[currentIndex]

            if (this.isExhausted(apiKey)) {
                if (debugEnabled) logger.info(`[googlelens] 第 ${currentIndex + 1} 个 Key 额度已耗尽，跳过`)
                continue
            }

            try {
                const payload = await this.request(apiKey, options.imageUrl, timeout, debugEnabled)

                // 成功即把轮询指针移到下一个 Key，实现分散调用
                this.keyIndex = (currentIndex + 1) % apiKeys.length

                if (this.mainConfig.debug.logApiResponses.includes(this.name)) {
                    logger.info(`[googlelens] Parsed JSON Response: ${JSON.stringify(payload, null, 2)}`)
                }

                const results = this.formatResults(payload)

                if (debugEnabled) {
                    const total = payload?.visual_matches?.length ?? 0
                    logger.info(`[googlelens] 搜索完成 (${Date.now() - startTime}ms)，匹配 ${total} 条，去重后返回 ${results.length} 条`)
                }

                return results
            } catch (error) {
                if (error instanceof QuotaExhaustedError) {
                    // 额度耗尽：标记并换下一个 Key 重试
                    this.markExhausted(apiKey)
                    logger.warn(`[googlelens] 第 ${currentIndex + 1} 个 Key 额度已耗尽，尝试下一个`)
                    lastError = error
                    continue
                }

                lastError = error as Error
                logger.warn(`[googlelens] 第 ${currentIndex + 1} 个 Key 请求失败: ${describeHttpError(error)}`)
                continue
            }
        }

        // 所有 Key 均失败
        this.keyIndex = (this.keyIndex + 1) % apiKeys.length
        const detail = lastError ? describeHttpError(lastError) : '所有 Key 额度均已耗尽'
        throw new Error(`Google Lens 搜索失败。${this.formatRequestError(detail)}`)
    }

    /** 发起一次 SerpApi 请求 */
    private async request(apiKey: string, imageUrl: string, timeout: number, debugEnabled: boolean): Promise<SerpApiResponse> {
        const hl = this.subConfig.hl || DEFAULT_HL
        const url = `${ENDPOINT}?engine=google_lens&hl=${encodeURIComponent(hl)}`
            + `&url=${encodeURIComponent(imageUrl)}&api_key=${encodeURIComponent(apiKey)}`

        if (debugEnabled) logger.info(`[googlelens] 发送请求到 ${ENDPOINT}（engine=google_lens, hl=${hl}）`)

        try {
            const payload = await fetchJsonWithProxy<SerpApiResponse>(url, {
                proxyUrl: this.mainConfig.proxy,
                timeout,
                retries: 1,
                retryDelay: 1200,
                headers: { accept: 'application/json' },
            })

            // SerpApi 在额度耗尽时也可能以 200 + error 返回
            if (payload?.error) {
                if (this.isQuotaMessage(payload.error)) throw new QuotaExhaustedError(payload.error)
                throw new Error(payload.error)
            }

            return payload
        } catch (error) {
            // 401/403/429 在 SerpApi 语义下基本等同于 Key 不可用或额度耗尽
            if (error instanceof HttpError && [401, 403, 429].includes(error.status)) {
                throw new QuotaExhaustedError(error.body || `HTTP ${error.status}`)
            }
            throw error
        }
    }

    /** 判断错误信息是否表示额度/Key 问题 */
    private isQuotaMessage(message: string): boolean {
        return /api key|exceeded|quota|run out|plan|subscription/i.test(message)
    }

    private isExhausted(apiKey: string): boolean {
        const at = this.exhaustedKeys.get(apiKey)
        if (!at) return false
        if (Date.now() - at > EXHAUSTED_COOLDOWN) {
            this.exhaustedKeys.delete(apiKey)
            return false
        }
        return true
    }

    private markExhausted(apiKey: string): void {
        this.exhaustedKeys.set(apiKey, Date.now())
    }

    /** 把 SerpApi 的错误转成用户可读的提示 */
    private formatRequestError(message: string): string {
        if (/api key/i.test(message)) {
            return 'SerpApi API Key 无效，请在「Google Lens 设置」中检查。'
        }
        if (/exceeded|quota|run out|plan|subscription/i.test(message)) {
            return 'SerpApi 额度已用尽，请更换 Key 或升级套餐。'
        }
        if (/状态码 429/.test(message)) {
            return '请求过于频繁，站点已触发限流，请稍后再试。'
        }
        if (/超时|timeout/i.test(message)) {
            return '请求超时，请检查网络或代理设置。'
        }
        return `接口错误: ${message}`
    }

    /**
     * 解析 visual_matches。
     * Google Lens 会返回同一站点的大量相似图，这里按域名去重，每个站点只保留最靠前的一条。
     */
    private formatResults(payload: SerpApiResponse): Searcher.Result[] {
        const matches = payload?.visual_matches || []
        if (!Array.isArray(matches) || matches.length === 0) return []

        const limit = Math.max(1, this.subConfig.maxResults || 5)
        const seenHosts = new Set<string>()
        const results: Searcher.Result[] = []

        for (const match of matches) {
            if (results.length >= limit) break

            const title = match?.title?.trim()
            const link = match?.link?.trim()
            if (!title || !link) continue

            const host = this.hostnameOf(link)
            // 同一站点只保留第一条（visual_matches 已按相关性排序）
            if (host) {
                if (seenHosts.has(host)) continue
                seenHosts.add(host)
            }

            const source = match?.source?.trim()
            const details: string[] = []
            if (source) details.push(`站点: ${source}`)
            if (match?.image_width && match?.image_height) {
                details.push(`图片尺寸: ${match.image_width}x${match.image_height}`)
            }

            results.push({
                thumbnail: match?.thumbnail || match?.image || '',
                // 附加引擎不参与高匹配度判定，相似度固定为 0
                similarity: 0,
                url: link,
                source: source ? `[Google Lens · ${source}] ${title}` : `[Google Lens] ${title}`,
                details,
            })
        }

        return results
    }

    /** 取链接的域名（忽略 www. 与端口），解析失败时返回空串 */
    private hostnameOf(url: string): string {
        try {
            return new URL(url).hostname.replace(/^www\./i, '').toLowerCase()
        } catch {
            return ''
        }
    }
}

/** 内部信号：当前 Key 额度耗尽或不可用，应切换下一个 Key */
class QuotaExhaustedError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'QuotaExhaustedError'
    }
}
