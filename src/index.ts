// --- START OF FILE src/index.ts ---
import { Context, Logger, h } from 'koishi'
import { Config, Searcher, SearchOptions, Enhancer, SearchEngineName } from './config'
import { SauceNAO } from './searchers/saucenao'
import { TraceMoe } from './searchers/tracemoe'
import { IQDB } from './searchers/iqdb'
import { Yandex } from './searchers/yandex'
import { Ascii2D } from './searchers/ascii2d'
import { SoutuBot } from './searchers/soutubot'
import { Buffer } from 'buffer'
import { YandeReEnhancer } from './enhancers/yande'
import { GelbooruEnhancer } from './enhancers/gelbooru'
import { DanbooruEnhancer } from './enhancers/danbooru'
import { PuppeteerManager } from './puppeteer'
import { SearchHandler } from './core/search-handler'
import { getImageUrlAndName, preprocessImage, detectImageType } from './utils'

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
- \`tracemoe\` (t) : 识别番剧截图，提供标题、集数、时间轴与视频预览。
- \`soutubot\` (b) : 搜图bot酱，使用完整图或局部图识别nh和eh本子图片。
- \`ascii2d\` (a) : 二次元画像詳細検索，作为补充结果。
- \`yandex\` (y) : 识别网络媒体和网站中存在的相似图片并返回来源，主要作为其他引擎未找到高匹配度结果时的补充。

###	注意：
####	部分引擎需要配置代理才可用, http相关报错请先检查代理设置。
####	为绕过机器人脚本防护，yandex, ascii2d, danbooru, soutubot搜图使用浏览器实例实现，响应速度相对较慢。
`

export function apply(ctx: Context, config: Config) {
  const puppeteerManager = new PuppeteerManager(ctx, config);
  ctx.on('dispose', () => puppeteerManager.dispose());
  
  const allSearchers: Record<string, Searcher> = {};
  
  if (config.saucenao.apiKeys && config.saucenao.apiKeys.length > 0) {
    allSearchers.saucenao = new SauceNAO(ctx, config.saucenao, config.debug, config.requestTimeout);
  } else {
    logger.info('[saucenao] 未提供任何 API Key，引擎已禁用。');
  }

  allSearchers.tracemoe = new TraceMoe(ctx, config.tracemoe, config.debug, config.requestTimeout);
  allSearchers.iqdb = new IQDB(ctx, config.iqdb, config.debug, config.requestTimeout);
  allSearchers.yandex = new Yandex(ctx, config.yandex, config.debug, puppeteerManager);
  allSearchers.ascii2d = new Ascii2D(ctx, config.ascii2d, config.debug, puppeteerManager);
  allSearchers.soutubot = new SoutuBot(ctx, config.soutubot, config.debug, puppeteerManager);

  const availableEngines = Object.keys(allSearchers) as SearchEngineName[];

  const engineAliases: Record<string, SearchEngineName> = {
      's': 'saucenao', 'i': 'iqdb', 't': 'tracemoe', 'y': 'yandex', 'a': 'ascii2d', 'b': 'soutubot',
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
  
      if (!entry.needsKeys || (Array.isArray(entry.keys) && entry.keys.length > 0)) {
          const constructorArgs: any[] = [ctx, generalConfig, config.debug];
          if (name === 'yandere' || name === 'gelbooru') constructorArgs.push(config.requestTimeout);
          if (entry.requiresPuppeteer) constructorArgs.push(puppeteerManager);
          
          allEnhancers[name] = new entry.constructor(...constructorArgs);
      } else {
          logger.info(`[${name}] ${entry.messageName}未配置任何${entry.keyName}，将无法启用。`);
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

  const searchHandler = new SearchHandler(ctx, config, allSearchers, allEnabledSearchers);

  ctx.command('sauce [...text:string]', '聚合搜图')
    .alias('soutu','搜图')
    .option('all', '-a, --all 返回所有启用的引擎搜索结果')
    .action(async ({ session, options }, text) => {

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

        const { searchersToUse, imageInput, isSingleEngineSpecified } = parseInput(text, options);

        if (isSingleEngineSpecified) {
            if (searchersToUse.length === 0) return '指定的搜图引擎无效或未正确配置。';
        } else {
            if (allEnabledSearchers.length === 0) return '沒有啟用或指定任何有效的搜图引擎。';
        }

        let imgData = getImageUrlAndName(session, imageInput);
      
        if (!imgData.url) {
          await session.send(`请发送图片... (超时: ${config.promptTimeout}秒)`);
          try {
            const nextMessageContent = await session.prompt(config.promptTimeout * 1000);
            if (!nextMessageContent) return '已取消。';
            
            const unescapedContent = h.unescape(nextMessageContent);
            imgData = getImageUrlAndName({ content: unescapedContent, quote: session.quote, elements: h.parse(unescapedContent) }, unescapedContent);
            
            if (!imgData.url) return '未找到图片，已取消。';
          } catch (e) {
            return '等待超时，已取消。';
          }
        }
        
        try {
          await session.send("正在搜索...");
          const rawImageArrayBuffer = await ctx.http.get(imgData.url, { responseType: 'arraybuffer' });
          
          if (!/\.(jpe?g|png|gif|webp)$/i.test(imgData.name)) {
            const imageType = detectImageType(Buffer.from(rawImageArrayBuffer));
            if (imageType) {
              const newName = `${imgData.name}.${imageType}`;
              if (config.debug.enabled) logger.info(`[Debug] Original filename "${imgData.name}" lacked extension. Renaming to "${newName}".`);
              imgData.name = newName;
            }
          }
          
          const processedImageBuffer = await preprocessImage(Buffer.from(rawImageArrayBuffer));
          
          const searchOptions: SearchOptions = { 
            imageUrl: imgData.url, 
            imageBuffer: processedImageBuffer,
            fileName: imgData.name,
            maxResults: config.maxResults,
          };
          
          const botUser = await session.bot.getSelf();
          const collectedErrors: string[] = [];
  
          if (isSingleEngineSpecified || options.all) {
              return await searchHandler.handleDirectSearch(searchersToUse, searchOptions, botUser, session, collectedErrors);
          } else {
              return await searchHandler.handleSequentialSearch(searchersToUse, searchOptions, botUser, session, collectedErrors, sortedEnhancers);
          }
  
        } catch (error) {
          logger.error('图片处理失败:', error);
          return '图片处理失败，请检查链接或网络。';
        }
    });
}
// --- END OF FILE src/index.ts ---