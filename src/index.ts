import { Context, Logger, h } from 'koishi'
import { Config, Searcher, SearchOptions, Enhancer, SearchEngineName } from './config'
import { SauceNAO } from './searchers/saucenao'
import { TraceMoe } from './searchers/tracemoe'
import { IQDB } from './searchers/iqdb'
import { Yandex } from './searchers/yandex'
import { Ascii2D } from './searchers/ascii2d'
import sharp from 'sharp'
import { Buffer } from 'buffer'
import { YandeReEnhancer } from './enhancers/yande'
import { GelbooruEnhancer } from './enhancers/gelbooru'
import { DanbooruEnhancer } from './enhancers/danbooru'
import { PuppeteerManager } from './puppeteer'

export const name = 'sauce-aggregator'
export const using = ['http']
export const inject = ['http']
const logger = new Logger(name)
export { Config }

export const usage = `
指令: sauce [引擎名] [图片]
别名: 搜图, soutu
选项: --all / -a (返回全部引擎搜索结果)

- **默认搜索**: \`sauce [图片]\` - 按配置顺序搜索，找到高匹配度结果后停止。
- **全量搜索**: \`sauce --all [图片]\` - 搜索所有启用的引擎并报告全部结果。
- **指定引擎搜索**: \`sauce <引擎名> [图片]\` - 只使用指定引擎搜索。

**可用引擎名 (及其别名)**:
- \`saucenao\` (s) : 识别动漫、插画和本子图片等。
- \`iqdb\` (i) : 从多个图源网站识别动漫、漫画、游戏图片和壁纸。
- \`ascii2d\` (a) : 二次元画像詳細検索，作为补充结果。
- \`tracemoe\` (t) : 识别番剧，提供标题、集数、时间轴与视频预览。
- \`yandex\` (y) : 识别网络媒体和网站中存在的相似图片并返回来源，主要作为其他引擎未找到高匹配度结果时的补充。

###	注意：
####	部分引擎需要配置代理才可用, http相关报错请先检查代理设置。
####	为绕过机器人脚本防护，yandex, ascii2d, danbooru部分使用浏览器实例实现，响应速度相对较慢。
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
  const puppeteerManager = new PuppeteerManager(ctx, config);
  ctx.on('dispose', () => puppeteerManager.dispose());
  
  const allSearchers: Record<string, Searcher> = {};
  
  if (config.saucenao.apiKeys && config.saucenao.apiKeys.length > 0) {
    allSearchers.saucenao = new SauceNAO(ctx, config.saucenao, config.debug, config);
  } else {
    logger.info('[saucenao] 未提供任何 API Key，引擎已禁用。');
  }

  allSearchers.tracemoe = new TraceMoe(ctx, config.tracemoe, config.debug, config);
  allSearchers.iqdb = new IQDB(ctx, config.iqdb, config.debug, config);
  allSearchers.yandex = new Yandex(ctx, config.yandex, config.debug, puppeteerManager);
  allSearchers.ascii2d = new Ascii2D(ctx, config.ascii2d, config.debug, puppeteerManager);

  const availableEngines = Object.keys(allSearchers) as SearchEngineName[];

  const engineAliases: Record<string, SearchEngineName> = {
      's': 'saucenao', 'i': 'iqdb', 't': 'tracemoe', 'y': 'yandex', 'a': 'ascii2d',
  };

  const allEnabledSearchers = config.order
    .filter(item => item.enabled && allSearchers[item.engine])
    .map(item => allSearchers[item.engine]);

  const sequentialSearchers = allEnabledSearchers
    .filter(searcher => searcher.name !== 'yandex' && searcher.name !== 'ascii2d');
  
  const allEnhancers: Record<string, Enhancer> = {};

  const enhancerRegistry = {
    yandere: { constructor: YandeReEnhancer, needsKeys: false, keys: null, keyName: '', messageName: '图源' },
    gelbooru: { constructor: GelbooruEnhancer, needsKeys: true, keys: config.gelbooru.keyPairs, keyName: 'API Key', messageName: '图源' },
    danbooru: { constructor: DanbooruEnhancer, needsKeys: true, keys: config.danbooru.keyPairs, keyName: '用户凭据', messageName: '图源', requiresPuppeteer: true }
  };
  
  for (const name in enhancerRegistry) {
      const entry = enhancerRegistry[name];
      const generalConfig = config[name];
  
      if (generalConfig.enabled) {
          if (!entry.needsKeys || (Array.isArray(entry.keys) && entry.keys.length > 0)) {
              const constructorArgs: any[] = [ctx, generalConfig, config.debug];
              if (name === 'yandere' || name === 'gelbooru') constructorArgs.push(config);
              if (entry.requiresPuppeteer) constructorArgs.push(puppeteerManager);
              
              allEnhancers[name] = new entry.constructor(...constructorArgs);
          } else {
              logger.info(`[${name}] ${entry.messageName}已启用但未配置任何${entry.keyName}，已禁用。`);
          }
      }
  }
  
  const sortedEnhancers = config.enhancerOrder
    .filter(item => item.enabled && allEnhancers[item.engine])
    .map(item => allEnhancers[item.engine]);
      
  if (allEnabledSearchers.length > 0) {
      logger.info(`已启用的搜图引擎顺序: ${allEnabledSearchers.map(s => s.name).join(', ')}`);
  }
  if (sortedEnhancers.length > 0) {
      logger.info(`已启用的图源顺序: ${sortedEnhancers.map(e => e.name).join(', ')}`);
  }

  ctx.command('sauce [...text:string]', '聚合搜图')
    .alias('soutu','搜图')
    .option('all', '-a, --all 返回所有启用的引擎搜索结果')
    .action(async ({ session, options }, text) => {
        const { searchersToUse, imageInput, isSingleEngineSpecified } = parseInput(text, options);
        return searchLogic(searchersToUse, imageInput, isSingleEngineSpecified, { session, options });
    });

  function parseInput(inputText: string, options: any) {
      const text = inputText || '';
      const words = text.split(/\s+/).filter(Boolean);

      let searchersToUse: Searcher[] = sequentialSearchers;
      let imageInput: string = text;
      let isSingleEngineSpecified = false;

      const firstWord = words[0]?.toLowerCase();
      let targetEngineName: SearchEngineName | null = null;
      
      if (availableEngines.includes(firstWord as SearchEngineName)) {
          targetEngineName = firstWord as SearchEngineName;
      } else if (engineAliases[firstWord]) {
          targetEngineName = engineAliases[firstWord];
      }

      if (targetEngineName) {
          const targetSearcher = allSearchers[targetEngineName];
          if (targetSearcher) {
              searchersToUse = [targetSearcher];
              imageInput = words.slice(1).join(' ');
              isSingleEngineSpecified = true;
          }
      } else if (options.all) {
          searchersToUse = allEnabledSearchers;
      }
      return { searchersToUse, imageInput, isSingleEngineSpecified };
  }

  async function searchLogic(searchers: Searcher[], image: string, isSingleEngineSpecified: boolean, { session, options }) {
      if (searchers.length === 0 && !config.yandex.alwaysAttach && !config.ascii2d.alwaysAttach) {
          return '没有启用或指定任何有效的搜图引擎。';
      }

      let imgData = getImageUrlAndName(session, image);
      
      if (!imgData.url) {
        await session.send(`请发送图片... (超时: ${config.promptTimeout}秒)`);
        try {
          const nextMessageContent = await session.prompt(config.promptTimeout * 1000);
          if (!nextMessageContent) return '已取消。';
          imgData = getImageUrlAndName({ content: nextMessageContent, quote: session.quote, elements: h.parse(nextMessageContent) }, nextMessageContent);
          if (!imgData.url) return '未找到图片，已取消。';
        } catch (e) {
          return '等待超时，已取消。';
        }
      }
      
      try {
        await session.send("正在搜索...");
        const rawImageArrayBuffer = await ctx.http.get(imgData.url, { responseType: 'arraybuffer' });
        const processedImageBuffer = await preprocessImage(Buffer.from(rawImageArrayBuffer));
        
        const searchOptions: SearchOptions = { 
          imageUrl: imgData.url, 
          imageBuffer: processedImageBuffer,
          fileName: imgData.name,
          maxResults: config.maxResults,
        };
        
        const botUser = await session.bot.getSelf();

        if (isSingleEngineSpecified || options.all) {
            return await handleDirectSearch(searchers, searchOptions, botUser, session);
        } else {
            return await handleSequentialSearch(searchers, searchOptions, botUser, session);
        }

      } catch (error) {
        logger.error('图片处理失败:', error);
        return '图片处理失败，请检查链接或网络。';
      }
  }

  async function performSearch(searcher: Searcher, options: SearchOptions, session) {
      try {
        const results = await searcher.search(options);
        return { engine: searcher.name, results, error: null };
      } catch (error) {
        const errorMessage = `[${searcher.name}] 引擎搜索失败: ${error.message}`;
        logger.warn(errorMessage, config.debug.enabled ? error : '');
        await session.send(errorMessage);
        return { engine: searcher.name, results: [], error: errorMessage };
      }
  }

  async function sendFigureMessage(session, figureMessage: h, errorMessage: string) {
      if (figureMessage.children.length > 0) {
          try {
              await session.send(figureMessage);
          } catch (e) {
              logger.warn(`${errorMessage}:`, e.message);
              await session.send('结果发送失败，请检查适配器兼容性。');
          }
      }
  }

  async function handleDirectSearch(searchers: Searcher[], options: SearchOptions, botUser, session) {
      const searcherOutputs = await Promise.all(searchers.map(s => performSearch(s, options, session)));
      const successfulOutputs = searcherOutputs.filter(o => o.results.length > 0);
      
      if (successfulOutputs.length === 0) return '未找到任何相关结果。';

      await session.send('搜索完成，结果如下:');
      const figureMessage = h('figure');
      const nodePromises = successfulOutputs.flatMap(output => {
          const headerNode = Promise.resolve(h('message', { nickname: `--- ${output.engine} ---`, avatar: botUser.avatar }));
          const resultNodesPromises = output.results.slice(0, config.maxResults).map(result => 
              buildLowConfidenceNode(result, output.engine, botUser)
          );
          return [headerNode, ...resultNodesPromises];
      });

      figureMessage.children.push(...await Promise.all(nodePromises));
      await sendFigureMessage(session, figureMessage, '合并转发结果失败');
  }

  async function handleSequentialSearch(searchers: Searcher[], options: SearchOptions, botUser, session) {
      const executedOutputs = [];
      let highConfidenceResult: Searcher.Result = null;
      let highConfidenceSearcherName = '';

      for (const searcher of searchers) {
          const output = await performSearch(searcher, options, session);
          if (output.results.length > 0) executedOutputs.push(output);

          highConfidenceResult = output.results.find(r => r.similarity >= config.confidenceThreshold);
          if (highConfidenceResult) {
              highConfidenceSearcherName = searcher.name;
              break;
          }
      }

      if (highConfidenceResult) {
          await session.send(`[${highConfidenceSearcherName}] 找到高匹配度结果:`);
          const figureMessage = h('figure');
          await buildHighConfidenceMessage(figureMessage, highConfidenceResult, highConfidenceSearcherName, botUser);
          await attachAdditionalResults(executedOutputs, options, botUser, figureMessage, session);
          await sendFigureMessage(session, figureMessage, '发送高匹配度结果失败');
          return;
      }
      
      let finalOutputs = executedOutputs;
      const searchersToRunForLowConfidence = allEnabledSearchers
          .filter(s => {
              if (s.name === 'yandex') return !config.yandex.alwaysAttach;
              if (s.name === 'ascii2d') return !config.ascii2d.alwaysAttach;
              return true;
          })
          .filter(s => !executedOutputs.some(o => o.engine === s.name));

      if (searchersToRunForLowConfidence.length > 0) {
          const unexecutedOutputs = await Promise.all(searchersToRunForLowConfidence.map(s => performSearch(s, options, session)));
          finalOutputs.push(...unexecutedOutputs.filter(o => o.results.length > 0));
      }
      
      await attachAdditionalResults(finalOutputs, options, botUser, null, session);
      
      if (finalOutputs.length === 0) return '未找到任何相关结果。';

      await session.send('未找到高匹配度结果，显示如下:');
      const figureMessage = h('figure');
      const nodePromises = finalOutputs.flatMap(output => {
          const headerNode = Promise.resolve(h('message', { nickname: `--- ${output.engine} ---`, avatar: botUser.avatar }));
          const resultNodesPromises = output.results.slice(0, config.maxResults).map(result => 
              buildLowConfidenceNode(result, output.engine, botUser)
          );
          return [headerNode, ...resultNodesPromises];
      });
      figureMessage.children.push(...await Promise.all(nodePromises));
      await sendFigureMessage(session, figureMessage, '合并转发低匹配度结果失败');
  }
  
  async function attachAdditionalResults(executedOutputs, options, botUser, figureMessage, session) {
      const attachEngines = [
          { name: 'yandex', config: config.yandex, searcher: allSearchers.yandex },
          { name: 'ascii2d', config: config.ascii2d, searcher: allSearchers.ascii2d }
      ];
      
      for (const eng of attachEngines) {
          if (eng.config.alwaysAttach) {
              let output = executedOutputs.find(o => o.engine === eng.name);
              if (!output) output = await performSearch(eng.searcher, options, session);
              if (output?.results?.[0]) {
                  if (figureMessage) { // Attach to high-confidence message
                      const result = output.results[0];
                      const headerNode = h('message', { nickname: `--- ${eng.name} (附加结果) ---`, avatar: botUser.avatar });
                      const resultNode = await buildLowConfidenceNode(result, eng.name, botUser);
                      figureMessage.children.push(headerNode, resultNode);
                  } else { // Or add to final output list for low-confidence display
                      if (!executedOutputs.some(o => o.engine === eng.name)) {
                          executedOutputs.push(output);
                      }
                  }
              }
          }
      }
  }

  async function buildHighConfidenceMessage(figureMessage: h, result: Searcher.Result, engineName: string, botUser) {
    if (result.coverImage) {
      figureMessage.children.push(h('message', { nickname: '番剧封面', avatar: botUser.avatar }, h.image(result.coverImage)));
    }
    
    const formattedContent = await createResultContent(result);
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

  async function createResultContent(result: Searcher.Result): Promise<h[]> {
      const textFields = [
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

  async function buildLowConfidenceNode(result: Searcher.Result, engineName: string, botUser) {
    const content = await createResultContent(result);
    return h('message', { 
        nickname: (result.source || engineName).substring(0, 10),
        avatar: botUser.avatar
    }, content);
  }
  
  function getImageUrlAndName(session: any, text: string): { url: string; name: string } {
      let elements = session.elements;
      if (session.quote) elements = session.quote.elements;
      
      const imgElement = elements?.find(e => e.type === 'img');
      let url: string;

      if (imgElement?.attrs.src) url = imgElement.attrs.src;
      
      if (!url && text) {
          try {
              const potentialUrl = text.trim();
              new URL(potentialUrl);
              if (potentialUrl.startsWith('http')) url = potentialUrl;
          } catch (_) {}
      }
      
      if (!url) return { url: null, name: null };
      
      const rawName = (imgElement?.attrs.file || url.split('/').pop().split('?')[0]) || 'image.jpg';
      const name = rawName.replace(/[\r\n"']+/g, '');
  
      if (config.debug.enabled && url) {
          logger.info(`[Debug] Parsed image URL from elements: ${url}`);
      }
      return { url, name };
  }
}