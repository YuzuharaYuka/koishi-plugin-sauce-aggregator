// --- START OF FILE index.ts ---

import { Context, Logger, h } from 'koishi'
import { Config, Searcher, SearchOptions, Enhancer } from './config'
import { SauceNAO } from './searchers/saucenao'
import { TraceMoe } from './searchers/tracemoe'
import { IQDB } from './searchers/iqdb'
import sharp from 'sharp'
import { Buffer } from 'buffer'
import { YandeReEnhancer } from './searchers/yande'
import { GelbooruEnhancer } from './searchers/gelbooru'

export const name = 'sauce-aggregator'
export const using = []
export const inject = ['http']
const logger = new Logger(name)
export { Config }

export const usage = `
指令: sauce [图片]
别名: 搜图, soutu
选项: --all / -a (搜索全部引擎)

支持直接发送图片、回复图片或发送图片链接。
`

async function preprocessImage(buffer: Buffer, maxSizeInMB = 4): Promise<Buffer> {
  const ONE_MB = 1024 * 1024;
  if (buffer.length <= maxSizeInMB * ONE_MB) return buffer;
  logger.info(`图片体积 (${(buffer.length / ONE_MB).toFixed(2)}MB) 超出 ${maxSizeInMB}MB，正在压缩...`);
  try {
    return await sharp(buffer)
      .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch (error) {
    logger.error('图片压缩失败:', error);
    return buffer;
  }
}

export function apply(ctx: Context, config: Config) {
  const allSearchers: Record<string, Searcher> = {};
  
  const allEnhancers: Record<string, Enhancer> = {};
  if (config.yandere.enabled) {
    allEnhancers.yandere = new YandeReEnhancer(ctx, config.yandere, config.debug);
  }
  if (config.gelbooru.enabled && config.gelbooru.keyPairs?.length > 0) {
    allEnhancers.gelbooru = new GelbooruEnhancer(ctx, config.gelbooru, config.debug);
  } else if (config.gelbooru.enabled) {
    logger.info('[gelbooru] 图源已启用但未配置任何 API Key，已禁用。');
  }


  if (config.saucenao.apiKeys && config.saucenao.apiKeys.length > 0) {
    allSearchers.saucenao = new SauceNAO(ctx, config.saucenao, config.debug);
  } else {
    logger.info('[saucenao] 未提供任何 API Key，引擎已禁用。');
  }

  allSearchers.tracemoe = new TraceMoe(ctx, config.tracemoe, config.debug);
  allSearchers.iqdb = new IQDB(ctx, config.iqdb, config.debug);

  const sortedSearchers = config.order
    .filter(item => item.enabled && allSearchers[item.engine])
    .map(item => allSearchers[item.engine]);
  
  const sortedEnhancers = config.enhancerOrder
    .filter(item => item.enabled && allEnhancers[item.engine])
    .map(item => allEnhancers[item.engine]);
  if (sortedEnhancers.length > 0) {
      // **MODIFICATION START**: 统一术语为 "图源"
      logger.info(`已启用的图源顺序: ${sortedEnhancers.map(e => e.name).join(', ')}`);
      // **MODIFICATION END**
  }


  ctx.command('sauce [image:text]', '聚合搜图')
    .alias('soutu','搜图')
    .option('all', '-a, --all 返回所有启用的引擎搜索结果')
    .action(async ({ session, options }, image) => {
      let imgData: { url: string; name: string };
      imgData = await getImageUrlAndName(session, image);
      
      if (!imgData.url) {
        await session.send(`请发送图片... (超时: ${config.promptTimeout}秒)`);
        try {
          const nextMessageContent = await session.prompt(config.promptTimeout * 1000);
          if (!nextMessageContent) return '已取消。';
          imgData = await getImageUrlAndName({ content: nextMessageContent, quote: null }, nextMessageContent);
          if (!imgData.url) return '未找到图片，已取消。';
        } catch (e) {
          return '已超时。';
        }
      }
      
      try {
        const initialMessage = options.all 
          ? '正在进行全量搜索...' 
          : '正在搜索...';
        await session.send(initialMessage);

        const rawImageArrayBuffer = await ctx.http.get(imgData.url, { responseType: 'arraybuffer' });
        const processedImageBuffer = await preprocessImage(Buffer.from(rawImageArrayBuffer));

        const searchOptions: SearchOptions = { 
          imageUrl: imgData.url, 
          imageBuffer: processedImageBuffer,
          fileName: imgData.name,
          maxResults: config.maxResults,
        };

        const performSearch = async (searcher: Searcher) => {
          try {
            const results = await searcher.search(searchOptions);
            return { engine: searcher.name, results };
          } catch (error) {
            logger.warn(`引擎 ${searcher.name} 搜索失败:`, config.debug ? error : error.message);
            return { engine: searcher.name, results: [] };
          }
        };
        
        const searcherOutputs = await Promise.all(sortedSearchers.map(performSearch));

        const hasAnyResult = searcherOutputs.some(o => o.results.length > 0);
        if (!hasAnyResult) return '未找到任何结果。';
        
        const botUser = await session.bot.getSelf();
        
        if (!options.all) {
          for (const searcher of sortedSearchers) {
            const output = searcherOutputs.find(o => o.engine === searcher.name);
            const highConfidenceResult = output?.results.find(r => r.similarity >= config.confidenceThreshold);

            if (highConfidenceResult) {
              try {
                await session.send(`引擎 ${searcher.name} 找到高置信度结果:`);
                const figureMessage = h('figure');

                if (highConfidenceResult.coverImage) {
                  figureMessage.children.push(h('message', { nickname: '番剧封面', avatar: botUser.avatar }, h.image(highConfidenceResult.coverImage)));
                }
                
                const detailsNode = h('message', { nickname: '详细信息', avatar: botUser.avatar }, formatResult(highConfidenceResult));
                figureMessage.children.push(detailsNode);

                if (searcher.name === 'tracemoe' && config.tracemoe.sendVideoPreview && highConfidenceResult.url) {
                  try {
                    logger.info(`[tracemoe] 正在为高置信度结果下载视频预览...`);
                    const videoPreview = await ctx.http.get(highConfidenceResult.url, { responseType: 'arraybuffer' });
                    figureMessage.children.push(h('message', { nickname: '视频预览', avatar: botUser.avatar }, h.video(videoPreview, 'video/mp4')));
                  } catch (e) {
                    logger.warn(`[tracemoe] 高置信度视频预览下载失败: ${e.message}`);
                  }
                }
                
                for (const enhancer of sortedEnhancers) {
                  try {
                    const enhancedData = await enhancer.enhance(highConfidenceResult);
                    if (enhancedData) {
                      logger.info(`[${enhancer.name}] 已成功获取图源信息。`);
                      if (enhancedData.imageBuffer) {
                          figureMessage.children.push(h('message', { nickname: '图源图片', avatar: botUser.avatar }, h.image(enhancedData.imageBuffer, enhancedData.imageType)))
                      }
                      const enhancedDetailsNode = h('message', { nickname: '图源信息', avatar: botUser.avatar }, enhancedData.details);
                      figureMessage.children.push(enhancedDetailsNode);
                      break;
                    }
                  } catch (e) {
                      // **MODIFICATION START**: 统一术语为 "图源"
                      logger.warn(`[${enhancer.name}] 图源处理时发生错误:`, e);
                      // **MODIFICATION END**
                  }
                }

                await session.send(figureMessage);
                return;

              } catch (error) {
                logger.warn(`引擎 ${searcher.name} 的高置信度结果发送失败:`, error.message);
                await session.send(`[!] ${searcher.name} 结果发送失败，尝试下一引擎...`);
              }
            }
          }
        }

        const introMessage = options.all
          ? '全量搜索结果:'
          : '未找到高置信度结果，显示如下:';
        await session.send(introMessage);

        const figureMessage = h('figure');
        const nodePromises = searcherOutputs.flatMap(output => {
            if (output.results.length === 0) return [];
            
            const headerNode = Promise.resolve(h('message', { nickname: `--- ${output.engine} ---`, avatar: botUser.avatar }));
            
            const resultNodesPromises = output.results.slice(0, config.maxResults).map(async (result) => {
              try {
                const imageBuffer = Buffer.from(await ctx.http.get(result.thumbnail, { responseType: 'arraybuffer' }));
                const imageBase64 = imageBuffer.toString('base64');
                const dataUri = `data:image/jpeg;base64,${imageBase64}`;

                const textFields = [
                  `相似度: ${result.similarity.toFixed(2)}%`,
                  result.source ? `来源: ${result.source}` : null,
                  result.author ? `作者: ${result.author}` : null,
                  result.time ? `时间: ${result.time}` : null,
                  ...(result.details || []),
                  result.url ? `预览链接: ${result.url}`: null,
                ].filter(Boolean);
              
                const content: h[] = [
                  h.image(dataUri), 
                  h.text('\n' + textFields.join('\n'))
                ];
  
                return h('message', { 
                    nickname: (result.source || output.engine).substring(0, 10),
                    avatar: botUser.avatar
                }, content);
  
              } catch (e) {
                logger.warn(`Failed to download thumbnail ${result.thumbnail}:`, e.message);
                const errorContent = h.text(`[!] 缩略图加载失败\n相似度: ${result.similarity.toFixed(2)}%\n来源: ${result.source}\n链接: ${result.url || 'N/A'}`);
                return h('message', {
                    nickname: (result.source || output.engine).substring(0, 10),
                    avatar: botUser.avatar
                }, errorContent);
              }
            });
  
            return [headerNode, ...resultNodesPromises];
        });

        const resolvedNodes = await Promise.all(nodePromises);
        figureMessage.children.push(...resolvedNodes);

        if (figureMessage.children.length > 0) {
            try {
                await session.send(figureMessage);
            } catch(e) {
                logger.warn('合并转发低置信度结果失败:', e.message);
                await session.send('结果发送失败，请检查适配器兼容性。');
            }
        }

      } catch (error) {
        logger.error('图片处理失败:', error);
        return '图片处理失败，请检查链接或网络。';
      }
    });
}

async function getImageUrlAndName(session, text: string): Promise<{ url: string; name: string }> {
    const getUrl = (element: h): string => element?.attrs.src;
    let url: string;
    if (session.quote?.content) url = h.select(session.quote.content, 'img').map(getUrl)[0];
    if (!url && session.content) url = h.select(session.content, 'img').map(getUrl)[0];
    if (!url && text && text.startsWith('http')) url = text;
    if (!url) return { url: null, name: null };
    
    const rawName = url.split('/').pop().split('?')[0] || 'image.jpg';
    const name = rawName.replace(/[\r\n"']+/g, '');

    return { url, name };
}

function formatResult(result: Searcher.Result): h[] {
    const textFields = [
      `相似度: ${result.similarity.toFixed(2)}%`,
      result.source ? `来源: ${result.source}` : null,
      result.author ? `作者: ${result.author}` : null,
      result.time ? `时间: ${result.time}` : null,
      ...(result.details || []),
      result.url ? `预览链接: ${result.url}`: null,
    ].filter(Boolean);
  
    const content: h[] = [
      h.image(result.thumbnail),
      h.text('\n' + textFields.join('\n'))
    ];
  
    return content;
}