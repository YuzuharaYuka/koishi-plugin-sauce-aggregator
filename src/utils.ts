import { Buffer } from 'buffer';
import { createRequire } from 'module';
import { decodeJPEGFromStream, decodePNGFromStream, encodeJPEGToStream, encodePNGToStream, make } from 'pureimage';
import { Readable, PassThrough } from 'stream';
import { Context, Logger, h } from 'koishi';

const logger = new Logger('sauce-aggregator');

// 图片源接口定义
interface ImageSource {
  elements?: h[]
  quote?: { elements?: h[] }
}

export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// 插件版本号缓存，仅读取一次 package.json
let pluginVersion: string | null = null

/**
 * 从 catch 到的未知值中安全取出错误信息。
 * 启用 strict 后 catch 变量类型为 unknown，不能直接访问 .message。
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

/** 从 catch 到的未知值中安全取出错误名（如 TimeoutError / AbortError） */
export function errorName(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error) return String((error as { name?: unknown }).name ?? '')
  return ''
}

/** 判断是否为「响应不是有效 JSON」这类解析错误（腾讯/部分适配器会直接抛字符串） */
export function isJsonParseError(error: unknown): boolean {
  if (typeof error === 'string') return /not valid JSON|Unexpected token/i.test(error)
  return /not valid JSON|Unexpected token/i.test(errorMessage(error))
}

/**
 * 读取插件自身版本号（用于拼接 User-Agent 等）。
 * 直接读取 package.json，因此无需任何构建步骤即可跟随版本变化。
 */
export function getPluginVersion(): string {
  if (pluginVersion !== null) return pluginVersion

  try {
    // 用插件自身的文件位置解析 package.json，兼容 CJS / ESM 产物
    const base = typeof __filename !== 'undefined' ? __filename : `${process.cwd()}/`
    const version = createRequire(base)('../package.json')?.version
    pluginVersion = typeof version === 'string' && version ? version : '0.0.0'
  } catch {
    pluginVersion = '0.0.0'
  }
  return pluginVersion
}

/**
 * 拼装 Danbooru 要求的 User-Agent。
 * 官方要求客户端声明自己的用户 ID（`user #<ID>`），否则会被 Cloudflare 拦截。
 */
export function buildDanbooruUserAgent(userId?: string): string {
  const id = userId?.trim()
  return `Sauce-aggregator/${getPluginVersion()}${id ? ` (user #${id})` : ''}`
}

// 网络错误接口
interface NetworkError extends Error {
  code?: string
  response?: { status: number }
}

type ErrorMessage = string | ((error: NetworkError) => string)

interface ErrorHandler {
  check: (e: NetworkError) => boolean
  message: ErrorMessage
}

// 错误处理器配置
const ERROR_HANDLERS: readonly ErrorHandler[] = [
  {
    check: (e) => e.code === 'ETIMEDOUT' || /timeout/i.test(e.message),
    message: '请求超时，请检查网络或代理设置。',
  },
  {
    check: (e) => e.response?.status === 401 || e.response?.status === 403,
    message: '认证失败 (401/403)，请检查 API Key 或凭据配置。',
  },
  {
    check: (e) => e.response?.status === 429,
    message: '请求过于频繁 (429)，请稍后再试。',
  },
  {
    check: (e) => !!e.response?.status && e.response.status >= 500,
    message: (e) => `服务提供方服务器错误 (${e.response?.status})，请稍后再试。`,
  },
  {
    check: (e) => !!e.response?.status,
    message: (e) => `网络请求失败，状态码: ${e.response?.status}。`,
  },
  {
    check: (e) => e.name === 'TimeoutError',
    message: '页面操作超时，目标网站可能无响应或加载缓慢。',
  },
]

// 格式化网络错误信息
export function formatNetworkError(error: unknown): string {
  if (!(error instanceof Error)) {
    return '发生未知网络错误。'
  }

  for (const handler of ERROR_HANDLERS) {
    if (handler.check(error as NetworkError)) {
      const msg = handler.message
      return typeof msg === 'function' ? msg(error as NetworkError) : msg
    }
  }

  return error.message || '发生未知网络错误。'
}

// 带重试的文件下载
//
// 图片站点（尤其 yande.re / konachan 的原图 PNG）动辄十几 MB，
// 在带宽有限或代理较慢时，固定超时很容易失败。这里做了三点优化：
//   1. 整个请求的超时预算按文件大小放大，而不是死守 requestTimeout；
//   2. 用流式读取搭配「闲置超时」，避免连接卡死时白等；
//   3. 超时后按已接收字节用 Range 续传，不必从 0 重下十几 MB。

/** 低于该体积不做额外探测，直接用基础超时 */
const LARGE_FILE_THRESHOLD = 4 * 1024 * 1024
/** 按体积追加的超时预算：每 MB 给 8 秒（约 0.125 MB/s 的保守带宽） */
const TIMEOUT_PER_MB = 8000
/** 单次请求的总超时上限 */
const MAX_DOWNLOAD_TIMEOUT = 5 * 60 * 1000
/** 响应体闲置多久没有新数据视为卡死 */
const IDLE_TIMEOUT = 15000

/** 单个图片源的连接策略缓存：大小与是否支持 Range */
type SourceProfile = { size?: number; acceptRanges: boolean }
const sourceProfiles = new Map<string, SourceProfile>()

/** 按文件大小计算本次下载允许的超时 */
export function resolveDownloadTimeout(baseTimeout: number, size?: number): number {
  const base = Number.isFinite(baseTimeout) && baseTimeout > 0 ? baseTimeout : 30000
  if (!size || size <= LARGE_FILE_THRESHOLD) return base

  const extra = Math.ceil((size - LARGE_FILE_THRESHOLD) / (1024 * 1024)) * TIMEOUT_PER_MB
  return Math.min(Math.max(base, base + extra), MAX_DOWNLOAD_TIMEOUT)
}

/**
 * 读取响应头字段。
 * ctx.http.head() 返回的是 Headers 对象（有 get()），
 * 但某些适配器会包成 { headers }，这里都兼容。
 */
function readHeader(source: any, name: string): string {
  const target = source?.headers ?? source
  if (!target) return ''
  if (typeof target.get === 'function') return String(target.get(name) ?? '')
  const value = target[name] ?? target[name.toLowerCase()]
  return value == null ? '' : String(value)
}

/** 探测远端大小与 Range 支持；失败不影响正常下载 */
async function probeSource(ctx: Context, url: string, headers: Record<string, string>, timeout: number): Promise<SourceProfile> {
  const cached = sourceProfiles.get(url)
  if (cached) return cached

  const profile: SourceProfile = { acceptRanges: false }

  try {
    const head: any = await ctx.http.head(url, { headers, timeout })
    const length = Number(readHeader(head, 'content-length'))
    if (Number.isFinite(length) && length > 0) profile.size = length
    profile.acceptRanges = readHeader(head, 'accept-ranges').includes('bytes')
  } catch {
    // 部分 CDN 不支持 HEAD，或未返回 accept-ranges，用 1 字节 Range 再确认一次
    try {
      const probe: any = await ctx.http.get(url, {
        headers: { ...headers, range: 'bytes=0-0' },
        responseType: 'arraybuffer',
        timeout,
      })
      const contentRange = readHeader(probe, 'content-range')
      const total = Number(contentRange.split('/')[1])
      if (Number.isFinite(total) && total > 0) profile.size = total
      if (contentRange) profile.acceptRanges = true
    } catch {
      // 探测失败：按未知大小、不支持续传处理
    }
  }

  sourceProfiles.set(url, profile)
  return profile
}

export async function downloadWithRetry(
  ctx: Context,
  url: string,
  options: { retries: number; timeout: number; headers?: Record<string, string> }
): Promise<Buffer> {
  if (!url || typeof url !== 'string') {
    throw new Error('下载 URL 无效')
  }

  const headers = { 'User-Agent': USER_AGENT, ...options.headers }
  const profile = await probeSource(ctx, url, headers, Math.min(options.timeout, 10000))
  const timeout = resolveDownloadTimeout(options.timeout, profile.size)
  const startedAt = Date.now()

  // 已确认可保留的分片（每次按 Range 成功续传后追加），以及当前请求的临时分片。
  // 分开保存是为了在「服务端忽略 Range、返回整个文件」时丢弃残缺前缀，
  // 否则会把半截数据和完整数据拼成损坏的超长文件。
  const committed: Buffer[] = []
  let pending: Buffer[] = []
  let offset = 0

  if (profile.size && profile.size > LARGE_FILE_THRESHOLD) {
    logger.info(
      `[utils] [下载器] 图片体积 ${(profile.size / 1048576).toFixed(2)}MB，超时放宽至 ${Math.round(timeout / 1000)} 秒`
    )
  }

  let lastError: Error = new Error('下载失败')

  for (let attempt = 0; attempt <= options.retries; attempt++) {
    // 仅当服务端支持 Range 且已有数据时才续传
    const resumable = offset > 0 && profile.acceptRanges
    pending = []

    try {
      const requestHeaders = resumable ? { ...headers, range: `bytes=${offset}-` } : { ...headers }
      const read = await streamToBuffer(ctx, url, requestHeaders, timeout, (chunk) => pending.push(chunk))

      const expectedRemainder = profile.size ? profile.size - offset : undefined
      const ignoredRange = resumable && expectedRemainder !== undefined && read !== expectedRemainder

      if (ignoredRange) {
        // 服务端没按 Range 返回，丢弃之前累加的半截数据，直接用这次的完整响应
        logger.info(`[utils] [下载器] 服务端未按 Range 返回，改为整文件下载 (${(read / 1048576).toFixed(2)}MB)`)
        committed.length = 0
        offset = 0
      }

      committed.push(...pending)
      const total = bufferBytes(committed)

      if (profile.size && total < profile.size) {
        throw new Error(`连接提前中断 (${(total / 1048576).toFixed(2)}/${(profile.size / 1048576).toFixed(2)}MB)`)
      }

      if (attempt > 0) {
        logger.info(`[utils] [下载器] 下载完成，${(total / 1048576).toFixed(2)}MB（第 ${attempt + 1} 次尝试）`)
      }
      return Buffer.concat(committed)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (profile.acceptRanges) {
        // 支持 Range：保留已收到的部分，下次从这里续传
        committed.push(...pending)
        offset = bufferBytes(committed)
      } else {
        committed.length = 0
        offset = 0
      }

      if (attempt < options.retries) {
        const progress = offset > 0 ? `，已接收 ${(offset / 1048576).toFixed(2)}MB` : ''
        const mode = offset > 0 ? '续传' : '重试'
        logger.warn(
          `[utils] [下载器] 下载失败 ${url} (尝试 ${attempt + 1}/${options.retries + 1}): ${lastError.message}${progress}，2秒后${mode}...`
        )
        await ctx.sleep(2000)
      }
    }
  }

  const totalMb = profile.size ? `${(profile.size / 1048576).toFixed(2)}MB` : '大小未知'
  const gotMb = `${(bufferBytes(committed) / 1048576).toFixed(2)}MB`
  logger.warn(
    `[utils] [下载器] 下载 ${url} 失败 (${options.retries + 1}次尝试，${totalMb}，已获取 ${gotMb}，用时 ${Math.round((Date.now() - startedAt) / 1000)}秒)。`
  )
  throw lastError
}

/** 统计分片总字节数 */
function bufferBytes(chunks: Buffer[]): number {
  let total = 0
  for (const chunk of chunks) total += chunk.length
  return total
}

/**
 * 流式读取响应，边读边回调，并用闲置超时兜住卡死的连接。
 * ctx.http 的 `stream` 类型是 Web ReadableStream，同时兼容 Node 流。
 */
async function streamToBuffer(
  ctx: Context,
  url: string,
  headers: Record<string, string>,
  timeout: number,
  onChunk: (chunk: Buffer) => void
): Promise<number> {
  const response: any = await ctx.http.get(url, {
    responseType: 'stream',
    timeout,
    headers,
  })

  const stream = response?.data ?? response
  let reads = 0

  // Web ReadableStream（ctx.http 的标准返回）
  if (stream && typeof stream.getReader === 'function') {
    const reader = stream.getReader()
    let stalled = false
    let idleTimer: NodeJS.Timeout | undefined
    const arm = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        stalled = true
        // 取消读取以解除 read() 的挂起，随后由下面的判断抛出错误
        reader.cancel().catch(() => {})
      }, IDLE_TIMEOUT)
    }

    try {
      arm()
      for (;;) {
        const { done, value } = await reader.read()
        if (stalled) throw new Error(`响应体闲置超过 ${Math.round(IDLE_TIMEOUT / 1000)} 秒`)
        if (done) break
        if (value) {
          const buf = Buffer.isBuffer(value) ? value : Buffer.from(value)
          reads += buf.length
          onChunk(buf)
          arm()
        }
      }
      return reads
    } finally {
      clearTimeout(idleTimer)
      reader.releaseLock?.()
    }
  }

  // Node 流
  if (stream && typeof stream.on === 'function') {
    await new Promise<void>((resolve, reject) => {
      let idleTimer: NodeJS.Timeout | undefined
      const arm = () => {
        clearTimeout(idleTimer)
        idleTimer = setTimeout(() => {
          stream.destroy()
          reject(new Error(`响应体闲置超过 ${Math.round(IDLE_TIMEOUT / 1000)} 秒`))
        }, IDLE_TIMEOUT)
      }
      const cleanup = () => clearTimeout(idleTimer)

      arm()
      stream.on('data', (chunk: Buffer) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        reads += buf.length
        onChunk(buf)
        arm()
      })
      stream.on('end', () => {
        cleanup()
        resolve()
      })
      stream.on('error', (error: Error) => {
        cleanup()
        reject(error)
      })
    })
    return reads
  }

  // 适配器不支持流式返回时，退化为整体读取
  const buffer = Buffer.from(stream ?? [])
  if (buffer.length) {
    reads += buffer.length
    onChunk(buffer)
  }
  return reads
}

// 提取消息元素中的纯文本
export function extractPlainText(elements: h[] | undefined): string {
  if (!elements || !Array.isArray(elements)) return ''
  return h
    .select(elements, 'text')
    .map((e) => (e.attrs?.content ? String(e.attrs.content) : ''))
    .join('')
    .trim()
}

// 从 URL 推断图片类型
export function getImageTypeFromUrl(url: string): string {
  if (!url || typeof url !== 'string') return 'image/jpeg'

  const basePath = url.split(/[?#]/)[0]
  const ext = basePath.split('.').pop()?.toLowerCase()

  if (!ext) return 'image/jpeg'

  const mimeMap: Record<string, string> = {
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
  }
  return mimeMap[ext] || 'image/jpeg'
}

// 检测图片类型
export function detectImageType(buffer: Buffer): 'jpeg' | 'png' | null {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff && buffer[3]) return 'jpeg'
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47)
    return 'png'
  return null
}

// 预处理图片压缩
export async function preprocessImage(buffer: Buffer, maxSizeInMB = 4): Promise<Buffer> {
  if (!Buffer.isBuffer(buffer)) {
    logger.error('[utils] 传入的不是有效的 Buffer 对象')
    return buffer
  }

  const ONE_MB = 1024 * 1024
  if (buffer.length <= maxSizeInMB * ONE_MB) return buffer

  logger.info(
    `[utils] 图片体积 (${(buffer.length / ONE_MB).toFixed(2)}MB) 超出 ${maxSizeInMB}MB，正在压缩...`
  )

  try {
    const imageType = detectImageType(buffer)
    if (!imageType) {
      logger.warn('[utils] 不支持的图片格式，无法压缩，将使用原图。')
      return buffer
    }

    const stream = Readable.from(buffer)
    const image =
      imageType === 'jpeg'
        ? await decodeJPEGFromStream(stream)
        : await decodePNGFromStream(stream)

    if (image.width <= 0 || image.height <= 0) {
      logger.warn('图片尺寸无效，无法处理')
      return buffer
    }

    const MAX_DIMENSION = 2000
    const ratio = Math.min(MAX_DIMENSION / image.width, MAX_DIMENSION / image.height, 1)
    const newWidth = Math.round(image.width * ratio)
    const newHeight = Math.round(image.height * ratio)

    const newCanvas = make(newWidth, newHeight)
    const canvasCtx = newCanvas.getContext('2d')
    canvasCtx.drawImage(
      image,
      0,
      0,
      image.width,
      image.height,
      0,
      0,
      newWidth,
      newHeight
    )

    const processPromise = new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []
      const passThrough = new PassThrough()

      passThrough.on('data', (chunk: Buffer) => chunks.push(chunk))
      passThrough.on('finish', () => {
        resolve(Buffer.concat(chunks))
      })
      passThrough.on('error', reject)

      const encodeStream =
        imageType === 'jpeg'
          ? encodeJPEGToStream(newCanvas, passThrough, 90)
          : encodePNGToStream(newCanvas, passThrough)

      Promise.resolve(encodeStream).catch(reject)
    })

    // 添加 15 秒超时保护
    const timeoutPromise = new Promise<Buffer>((_, reject) =>
      setTimeout(() => reject(new Error('图片压缩处理超时')), 15000)
    )

    const finalBuffer = await Promise.race([processPromise, timeoutPromise])

    logger.info(`[utils] 图片压缩完成，新体积: ${(finalBuffer.length / ONE_MB).toFixed(2)}MB`)
    return finalBuffer
  } catch (error) {
    logger.error('[utils] 图片压缩失败:', error)
    return buffer
  }
}

// 查找消息元素中的图片
function findImageInElements(elements: h[] | undefined): { imgElement: h | undefined; textContent: string } {
  if (!Array.isArray(elements)) {
    return { imgElement: undefined, textContent: '' }
  }

  const imgElement = elements.find((e) => e.type === 'img')
  const textContent = imgElement ? '' : extractPlainText(elements)

  return { imgElement, textContent }
}

// 获取图片 URL 和名称
export function getImageUrlAndName(
  session: ImageSource,
  text: string
): { url: string | null; name: string | null } {
  if (!session || typeof session !== 'object') {
    return { url: null, name: null }
  }

  let url: string | undefined
  let imgElement: h | undefined
  let textToParse = typeof text === 'string' ? text : ''

  const { imgElement: element1, textContent: text1 } = findImageInElements(session.elements)
  if (element1?.attrs?.src) {
    url = String(element1.attrs.src)
    imgElement = element1
  } else if (text1) {
    textToParse = text1
  }

  if (!url && session.quote && typeof session.quote === 'object') {
    const { imgElement: element2, textContent: text2 } = findImageInElements(session.quote.elements)
    if (element2?.attrs?.src) {
      url = String(element2.attrs.src)
      imgElement = element2
    } else if (text2 && !textToParse) {
      textToParse = text2
    }
  }

  if (!url && textToParse) {
    try {
      const potentialUrl = textToParse.trim().split(/\s+/)[0]
      new URL(potentialUrl)
      if (potentialUrl.startsWith('http')) {
        url = potentialUrl
      }
    } catch {
    }
  }

  if (!url) {
    return { url: null, name: null }
  }

  let rawName = imgElement?.attrs?.file ? String(imgElement.attrs.file) : ''

  if (!rawName && url) {
    try {
      // 尝试从 URL 路径中提取文件名，忽略查询参数
      const urlObj = new URL(url)
      const segments = urlObj.pathname.split('/').filter(Boolean)
      if (segments.length > 0) {
        rawName = segments[segments.length - 1]
      }
    } catch {
      // URL 解析失败时的回退处理
      rawName = url.split('/').pop()?.split('?')[0] || ''
    }
  }

  const name = (rawName || 'image.jpg').replace(/[\r\n"']+/g, '')

  return { url, name }
}
