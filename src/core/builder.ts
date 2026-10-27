// --- 消息构建模块 ---

import { Context, h, Logger, Universal } from 'koishi'
import { Config, EnhancedResult, SearchEngineName, Searcher as SearcherResult } from '../config'
import { ENHANCER_LABELS, MESSAGE_TITLES, SPECIAL_ENGINES } from '../constants'
import { getImageTypeFromUrl, downloadWithRetry } from '../utils'

const logger = new Logger('sauce-aggregator')

// 高阶函数：非空过滤和映射 (遵循准则6 - 简化消息构建)
function filterMap<T, R>(array: (T | null | undefined)[], fn: (val: T) => R): R[] {
  return array.filter((x): x is T => x != null).map(fn)
}

// 创建包含缩略图和文本描述的基础消息内容；includeImages 仅控制引擎缩略图
export async function createResultContent(
  ctx: Context,
  result: SearcherResult.Result,
  engineName?: SearchEngineName,
  includeImages = true
): Promise<h[]> {
  const authorLabel = engineName === 'tracemoe' ? ENHANCER_LABELS.tracemoe : ENHANCER_LABELS.default

  const textFields = filterMap(
    [
      engineName ? `引擎: ${engineName}` : null,
      result.similarity ? `相似度: ${result.similarity.toFixed(2)}%` : null,
      result.source ? `来源: ${result.source}` : null,
      result.author ? `${authorLabel}: ${result.author}` : null,
      result.time ? `时间: ${result.time}` : null,
      ...(result.details || []),
      result.url ? `链接: ${result.url}` : null,
    ],
    x => x
  )

  const textNode = h.text('\n' + textFields.join('\n'))
  if (!includeImages) return [textNode]

  try {
    const imageBuffer = await downloadWithRetry(ctx, result.thumbnail, {
      retries: 1,
      timeout: 10000,
    })
    const imageType = getImageTypeFromUrl(result.thumbnail)
    return [h.image(imageBuffer, imageType), textNode]
  } catch (e) {
    logger.warn(`[builder] 缩略图下载失败 ${result.thumbnail}:`, (e as any).message)
    return [h('p', '[!] 缩略图加载失败'), textNode]
  }
}

// 构建用于合并转发的低相似度结果消息节点
export async function buildLowConfidenceNode(
  ctx: Context,
  result: SearcherResult.Result,
  engineName: SearchEngineName,
  botUser: Universal.User,
  includeImages = true
) {
  const content = await createResultContent(ctx, result, engineName, includeImages)
  return h(
    'message',
    {
      nickname: (result.source || engineName).substring(0, 10),
      avatar: botUser.avatar,
    },
    content
  )
}

// 构建包含图源增强信息的高相似度结果消息节点；includeImages 仅控制引擎封面与视频预览，图源图片始终保留
export async function buildHighConfidenceMessage(
  figureMessage: h,
  ctx: Context,
  config: Config,
  result: SearcherResult.Result,
  engineName: SearchEngineName,
  botUser: Universal.User,
  enhancedData?: EnhancedResult | null,
  includeImages = true
) {
  if (includeImages && result.coverImage) {
    figureMessage.children.push(
      h('message', { nickname: MESSAGE_TITLES.ANIME_COVER, avatar: botUser.avatar }, h.image(result.coverImage))
    )
  }

  const formattedContent = await createResultContent(ctx, result, engineName, includeImages)
  const detailsNode = h('message', { nickname: MESSAGE_TITLES.DETAILS, avatar: botUser.avatar }, formattedContent)
  figureMessage.children.push(detailsNode)

  if (includeImages && engineName === SPECIAL_ENGINES.TRACEMOE && config.tracemoe.sendVideoPreview && result.url) {
    try {
      if (config.debug.enabled) logger.info(`[builder] [${SPECIAL_ENGINES.TRACEMOE}] 正在为高置信度结果下载视频预览...`)
      const videoPreview = await ctx.http.get(result.url, { responseType: 'arraybuffer' })
      figureMessage.children.push(
        h('message', { nickname: MESSAGE_TITLES.VIDEO_PREVIEW, avatar: botUser.avatar }, h.video(videoPreview, 'video/mp4'))
      )
    } catch (e) {
      logger.warn(`[builder] [${SPECIAL_ENGINES.TRACEMOE}] 高置信度视频预览下载失败: ${(e as any).message}`)
    }
  }

  if (enhancedData) {
    if (enhancedData.imageBuffer) {
      figureMessage.children.push(
        h('message', { nickname: MESSAGE_TITLES.IMAGE, avatar: botUser.avatar }, h.image(enhancedData.imageBuffer, enhancedData.imageType || 'image/jpeg'))
      )
    }
    const enhancedDetailsNode = h('message', { nickname: MESSAGE_TITLES.INFO, avatar: botUser.avatar }, enhancedData.details)
    figureMessage.children.push(enhancedDetailsNode)

    const additionalImages = enhancedData.additionalImages
    if (additionalImages?.length) {
      figureMessage.children.push(...additionalImages)
    }
  }
}

// 合并转发失败时的文字回退：去掉媒体，只保留文字与链接
const IMAGE_RISK_LABEL = '!触发图片风控，回退为纯文本'

const MEDIA_LABELS: Record<string, string> = {
  img: IMAGE_RISK_LABEL,
  image: IMAGE_RISK_LABEL,
  video: '视频',
  audio: '音频',
  file: '文件',
  record: '语音',
}

function isElement(value: any): value is h {
  return !!value && typeof value === 'object' && typeof value.type === 'string'
}

function stripMedia(value: any): any {
  if (!isElement(value)) return value
  const label = MEDIA_LABELS[value.type]
  if (label) return h.text(`[${label}]`)
  const children = (value.children || []).map((child: any) => stripMedia(child))
  return h(value.type, value.attrs, ...children)
}

function collectText(value: any): string {
  if (typeof value === 'string') return value
  if (!isElement(value)) return ''
  if (value.type === 'text') return value.attrs?.content ?? ''
  const label = MEDIA_LABELS[value.type]
  if (label) return `[${label}]`
  return (value.children || []).map((child: any) => collectText(child)).join('')
}

function truncateText(text: string, limit = 1800): string {
  return text.length > limit ? `${text.slice(0, limit)}\n…（内容过长，已截断）` : text
}

export function buildTextOnlyFigure(figureMessage: h): h {
  return h('figure', figureMessage.attrs, ...figureMessage.children.map((child) => stripMedia(child)))
}

export function extractFigureText(figureMessage: h): string {
  return truncateText(collectText(figureMessage).trim())
}

// Session.send 会吞掉发送错误；部分适配器成功发送合并转发时也可能返回空数组，
// 因此不能把返回值当作失败依据。直接调用 bot.createMessage，只把抛出的异常视为失败。
async function trySend(session: any, content: any): Promise<boolean> {
  try {
    await session.bot.createMessage(
      session.channelId,
      content,
      session.event?.referrer,
      { session },
    )
    return true
  } catch (e) {
    logger.warn('消息发送失败:', (e as any).message)
    return false
  }
}

// 安全地发送 figure 消息；失败时先降级为纯文字转发，再降级为普通文字消息
export async function sendFigureMessage(session: any, figureMessage: h, errorMessage: string) {
  if (figureMessage.children.length === 0) return

  if (await trySend(session, figureMessage)) return

  logger.warn(errorMessage)
  if (await trySend(session, buildTextOnlyFigure(figureMessage))) {
    logger.info('合并转发失败，已降级为纯文字转发。')
    return
  }

  const text = extractFigureText(figureMessage)
  if (text && await trySend(session, text)) {
    logger.info('合并转发失败，已降级为普通文字消息。')
    return
  }

  await trySend(session, '结果发送失败，可能是图片或链接被平台拦截。')
}
