// --- 消息构建模块 ---

import { Context, h, Logger } from 'koishi'
import { Config, EnhancedResult, SearchEngineName, Searcher as SearcherResult } from '../config'
import { ENHANCER_LABELS, MESSAGE_TITLES, SPECIAL_ENGINES } from '../constants'
import { getImageTypeFromUrl } from '../utils'

const logger = new Logger('sauce-aggregator:message-builder')

// 高阶函数：非空过滤和映射 (遵循准则6 - 简化消息构建)
function filterMap<T, R>(array: (T | null | undefined)[], fn: (val: T) => R): R[] {
  return array.filter((x): x is T => x != null).map(fn)
}

// 创建包含缩略图和文本描述的基础消息内容
export async function createResultContent(
  ctx: Context,
  result: SearcherResult.Result,
  engineName?: SearchEngineName
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

  try {
    const imageBuffer = Buffer.from(await ctx.http.get(result.thumbnail, { responseType: 'arraybuffer' }))
    const imageType = getImageTypeFromUrl(result.thumbnail)
    return [h.image(imageBuffer, imageType), textNode]
  } catch (e) {
    logger.warn(`缩略图下载失败 ${result.thumbnail}:`, (e as any).message)
    return [h('p', '[!] 缩略图加载失败'), textNode]
  }
}

// 构建用于合并转发的低相似度结果消息节点
export async function buildLowConfidenceNode(
  ctx: Context,
  result: SearcherResult.Result,
  engineName: SearchEngineName,
  botUser: any
) {
  const content = await createResultContent(ctx, result, engineName)
  return h(
    'message',
    {
      nickname: (result.source || engineName).substring(0, 10),
      avatar: botUser.avatar,
    },
    content
  )
}

// 构建包含图源增强信息的高相似度结果消息节点
export async function buildHighConfidenceMessage(
  figureMessage: h,
  ctx: Context,
  config: Config,
  result: SearcherResult.Result,
  engineName: SearchEngineName,
  botUser: any,
  enhancedData?: EnhancedResult
) {
  if (result.coverImage) {
    figureMessage.children.push(
      h('message', { nickname: MESSAGE_TITLES.ANIME_COVER, avatar: botUser.avatar }, h.image(result.coverImage))
    )
  }

  const formattedContent = await createResultContent(ctx, result, engineName)
  const detailsNode = h('message', { nickname: MESSAGE_TITLES.DETAILS, avatar: botUser.avatar }, formattedContent)
  figureMessage.children.push(detailsNode)

  if (engineName === SPECIAL_ENGINES.TRACEMOE && config.tracemoe.sendVideoPreview && result.url) {
    try {
      if (config.debug.enabled) logger.info(`[${SPECIAL_ENGINES.TRACEMOE}] 正在为高置信度结果下载视频预览...`)
      const videoPreview = await ctx.http.get(result.url, { responseType: 'arraybuffer' })
      figureMessage.children.push(
        h('message', { nickname: MESSAGE_TITLES.VIDEO_PREVIEW, avatar: botUser.avatar }, h.video(videoPreview, 'video/mp4'))
      )
    } catch (e) {
      logger.warn(`[${SPECIAL_ENGINES.TRACEMOE}] 高置信度视频预览下载失败: ${(e as any).message}`)
    }
  }

  if (enhancedData) {
    if (enhancedData.imageBuffer) {
      figureMessage.children.push(
        h('message', { nickname: MESSAGE_TITLES.IMAGE, avatar: botUser.avatar }, h.image(enhancedData.imageBuffer, enhancedData.imageType))
      )
    }
    const enhancedDetailsNode = h('message', { nickname: MESSAGE_TITLES.INFO, avatar: botUser.avatar }, enhancedData.details)
    figureMessage.children.push(enhancedDetailsNode)

    if (enhancedData.additionalImages?.length > 0) {
      figureMessage.children.push(...enhancedData.additionalImages)
    }
  }
}

// 安全地发送 figure 消息，并在失败时提供回退
export async function sendFigureMessage(session: any, figureMessage: h, errorMessage: string) {
  if (figureMessage.children.length > 0) {
    try {
      await session.send(figureMessage)
    } catch (e) {
      logger.warn(`${errorMessage}:`, (e as any).message)
      await session.send('结果发送失败，请检查适配器兼容性。')
    }
  }
}
