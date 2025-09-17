// --- START OF FILE src/core/message-builder.ts ---

import { Context, h, Logger } from 'koishi';
import { Config, Enhancer, SearchEngineName, Searcher as SearcherResult } from '../config';

const logger = new Logger('sauce-aggregator:message-builder');

// This function now has an optional engineName parameter
export async function createResultContent(ctx: Context, result: SearcherResult.Result, engineName?: SearchEngineName): Promise<h[]> {
    const textFields = [
      // *** THIS IS THE FIX ***
      // Add engine name to the message body if provided.
      engineName ? `引擎: ${engineName}` : null,
      result.similarity ? `相似度: ${result.similarity.toFixed(2)}%` : null,
      result.source ? `来源: ${result.source}` : null,
      result.author ? `作者: ${result.author}` : null,
      result.time ? `时间: ${result.time}` : null,
      ...(result.details || []),
      result.url ? `链接: ${result.url}`: null,
    ].filter(Boolean);
  
    const textNode = h.text('\n' + textFields.join('\n'));

    try {
      const imageBuffer = Buffer.from(await ctx.http.get(result.thumbnail, { responseType: 'arraybuffer' }));
      const imageBase64 = imageBuffer.toString('base64');
      const dataUri = `data:image/jpeg;base64,${imageBase64}`;
      return [h.image(dataUri), textNode];
    } catch (e) {
      logger.warn(`缩略图下载失败 ${result.thumbnail}:`, e.message);
      return [h('p', '[!] 缩略图加载失败'), textNode];
    }
}

export async function buildLowConfidenceNode(ctx: Context, result: SearcherResult.Result, engineName: SearchEngineName, botUser) {
  // Pass the engineName to createResultContent
  const content = await createResultContent(ctx, result, engineName);
  return h('message', { 
      nickname: (result.source || engineName).substring(0, 10),
      avatar: botUser.avatar
  }, content);
}

export async function buildHighConfidenceMessage(
    figureMessage: h,
    ctx: Context,
    config: Config,
    sortedEnhancers: Enhancer[],
    result: SearcherResult.Result,
    engineName: SearchEngineName,
    botUser,
) {
  if (result.coverImage) {
    figureMessage.children.push(h('message', { nickname: '番剧封面', avatar: botUser.avatar }, h.image(result.coverImage)));
  }
  
  // Do NOT pass engineName here to keep the high-confidence message clean
  const formattedContent = await createResultContent(ctx, result);
  const detailsNode = h('message', { nickname: '详细信息', avatar: botUser.avatar }, formattedContent);
  figureMessage.children.push(detailsNode);

  if (engineName === 'tracemoe' && config.tracemoe.sendVideoPreview && result.url) {
    try {
      if (config.debug.enabled) logger.info(`[tracemoe] 正在为高置信度结果下载视频预览...`);
      const videoPreview = await ctx.http.get(result.url, { responseType: 'arraybuffer' });
      figureMessage.children.push(h('message', { nickname: '视频预览', avatar: botUser.avatar }, h.video(videoPreview, 'video/mp4')));
    } catch (e) {
      logger.warn(`[tracemoe] 高置信度视频预览下载失败: ${e.message}`);
    }
  }
  
  for (const enhancer of sortedEnhancers) {
    try {
      const enhancedData = await enhancer.enhance(result);
      if (enhancedData) {
        if (config.debug.enabled) logger.info(`[${enhancer.name}] 已成功获取图源信息。`);
        if (enhancedData.imageBuffer) {
            figureMessage.children.push(h('message', { nickname: '图源图片', avatar: botUser.avatar }, h.image(enhancedData.imageBuffer, enhancedData.imageType)))
        }
        const enhancedDetailsNode = h('message', { nickname: '图源信息', avatar: botUser.avatar }, enhancedData.details);
        figureMessage.children.push(enhancedDetailsNode);
        break;
      }
    } catch (e) {
        logger.warn(`[${enhancer.name}] 图源处理时发生错误:`, e);
    }
  }
}

export async function sendFigureMessage(session, figureMessage: h, errorMessage: string) {
    if (figureMessage.children.length > 0) {
        try {
            await session.send(figureMessage);
        } catch (e) {
            logger.warn(`${errorMessage}:`, e.message);
            await session.send('结果发送失败，请检查适配器兼容性。');
        }
    }
}
// --- END OF FILE src/core/message-builder.ts ---