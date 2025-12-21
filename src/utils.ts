import { Buffer } from 'buffer';
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
    check: (e) => e.response?.status && e.response.status >= 500,
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
export async function downloadWithRetry(
  ctx: Context,
  url: string,
  options: { retries: number; timeout: number; headers?: Record<string, string> }
): Promise<Buffer> {
  if (!url || typeof url !== 'string') {
    throw new Error('下载 URL 无效')
  }

  let lastError: Error
  for (let i = 0; i <= options.retries; i++) {
    try {
      const headers = { 'User-Agent': USER_AGENT, ...options.headers }
      const buffer = await ctx.http.get(url, {
        responseType: 'arraybuffer',
        timeout: options.timeout,
        headers,
      })
      return Buffer.from(buffer)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (i < options.retries) {
        logger.warn(
          `[utils] [下载器] 下载失败 ${url} (尝试 ${i + 1}/${options.retries + 1}): ${lastError.message}，2秒后重试...`
        )
        await ctx.sleep(2000)
      }
    }
  }
  logger.warn(`[utils] [下载器] 下载 ${url} 失败 (${options.retries + 1}次尝试)。`)
  throw lastError
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
