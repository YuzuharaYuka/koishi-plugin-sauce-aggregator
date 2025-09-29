// --- START OF FILE src/core/message-builder.ts ---

import { Context, h, Logger } from 'koishi';
import { Config, Enhancer, SearchEngineName, Searcher as SearcherResult } from '../config';

const logger = new Logger('sauce-aggregator:message-builder');

// 根据图源名称和结果内容生成一个唯一的ID，用于防止重复增强
function getEnhancementId(enhancerName: string, result: SearcherResult.Result): string | null {
    const patterns = {
        pixiv: /illust_id=(\d+)|artworks\/(\d+)/,
        danbooru: /posts\/(\d+)/,
        gelbooru: /id=(\d+)|md5=([a-f0-9]{32})/,
        yandere: /post\/show\/(\d+)/,
    };
    const regex = patterns[enhancerName];
    if (!regex) return null;

    const match = result.url.match(regex) || result.details?.join(' ').match(regex);
    return match ? `${enhancerName}:${match[1] || match[2]}` : null;
}

// 创建包含缩略图和文本描述的基础消息内容
export async function createResultContent(ctx: Context, result: SearcherResult.Result, engineName?: SearchEngineName): Promise<h[]> {
    const authorLabel = engineName === 'tracemoe' ? '工作室' : '作者';
    
    const textFields = [
      engineName ? `引擎: ${engineName}` : null,
      result.similarity ? `相似度: ${result.similarity.toFixed(2)}%` : null,
      result.source ? `来源: ${result.source}` : null,
      result.author ? `${authorLabel}: ${result.author}` : null,
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

// 构建用于合并转发的低相似度结果消息节点
export async function buildLowConfidenceNode(ctx: Context, result: SearcherResult.Result, engineName: SearchEngineName, botUser: any) {
  const content = await createResultContent(ctx, result, engineName);
  return h('message', { 
      nickname: (result.source || engineName).substring(0, 10),
      avatar: botUser.avatar
  }, content);
}

// 构建包含图源增强信息的高相似度结果消息节点
export async function buildHighConfidenceMessage(
    figureMessage: h,
    ctx: Context,
    config: Config,
    sortedEnhancers: Enhancer[],
    result: SearcherResult.Result,
    engineName: SearchEngineName,
    botUser: any,
    processedEnhancements: Set<string>,
) {
  if (result.coverImage) {
    figureMessage.children.push(h('message', { nickname: '番剧封面', avatar: botUser.avatar }, h.image(result.coverImage)));
  }
  
  const formattedContent = await createResultContent(ctx, result, engineName);
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
    const enhancementId = getEnhancementId(enhancer.name, result);
    if (enhancementId && processedEnhancements.has(enhancementId)) {
        if (config.debug.enabled) logger.info(`[增强器] 跳过重复的图源处理: ${enhancementId}`);
        continue;
    }

    try {
      const enhancedData = await enhancer.enhance(result);
      if (enhancedData) {
        if (config.debug.enabled) logger.info(`[${enhancer.name}] 已成功获取图源信息。`);
        if (enhancementId) processedEnhancements.add(enhancementId);

        if (enhancedData.imageBuffer) {
            figureMessage.children.push(h('message', { nickname: '图源图片', avatar: botUser.avatar }, h.image(enhancedData.imageBuffer, enhancedData.imageType)))
        }
        const enhancedDetailsNode = h('message', { nickname: '图源信息', avatar: botUser.avatar }, enhancedData.details);
        figureMessage.children.push(enhancedDetailsNode);
        
        if (enhancedData.additionalImages?.length > 0) {
            figureMessage.children.push(...enhancedData.additionalImages);
        }
        
        break;
      }
    } catch (e) {
        logger.warn(`[${enhancer.name}] 图源处理时发生错误:`, e);
    }
  }
}

// 安全地发送 figure 消息，并在失败时提供回退
export async function sendFigureMessage(session: any, figureMessage: h, errorMessage: string) {
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