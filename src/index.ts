// --- START OF FILE src/index.ts ---
import { Context, Logger, h, Session } from 'koishi'
import { Config, Searcher, SearchOptions, Enhancer, SearchEngineName, Searcher as SearcherResult } from './config'
import { SauceNAO } from './searchers/saucenao'
import { TraceMoe } from './searchers/tracemoe'
import { IQDB } from './searchers/iqdb'
import { Yandex } from './searchers/yandex'
import { Ascii2D } from './searchers/ascii2d'
import { SoutuBot } from './searchers/soutubot'
import { YandeReEnhancer } from './enhancers/yande'
import { GelbooruEnhancer } from './enhancers/gelbooru'
import { DanbooruEnhancer } from './enhancers/danbooru'
import { PixivEnhancer } from './enhancers/pixiv'
import { PuppeteerManager } from './puppeteer'
import { SearchHandler } from './core/search-handler'
import { getImageUrlAndName, preprocessImage, detectImageType, extractPlainText } from './utils'

export const name = 'sauce-aggregator'
export const using = ['http']
export const inject = ['http']
const logger = new Logger(name)
export { Config }

export const usage = `
###	指令用法
#### sauce [引擎名] [图片]
*	别名: \`搜图\`, \`soutu\`
*	选项: \`--all\` / \`-a\` (返回全部引擎搜索结果)
*	支持指令后跟图片/URL、回复图片、或发送指令后等待图片。
	*	**默认搜索**: \`sauce [图片]\` 按配置的 **搜索模式(串行/并行)** 进行搜索。
	*	**全量搜索**: \`sauce -a [图片]\` 强制搜索所有启用的引擎并返回全部结果。
	*	**指定引擎搜索**: \`sauce <引擎名> [图片]\` 只使用指定引擎搜索。

---

#### 可用引擎 (及其别名):
*	**[saucenao](https://saucenao.com/) (s)** : 识别动漫、插画和漫画图片等。
*	**[iqdb](https://www.iqdb.org/) (i)** : 从多个图源网站识别动漫、漫画、游戏图片和壁纸。
*	**[tracemoe](https://trace.moe/) (t)** : 识别番剧截图，提供番剧信息、集数、时间轴与视频预览。
*	**[soutubot](https://soutubot.moe/) (b)** : 搜图bot酱，使用完整或局部图识别nh或eh本子，下载可使用[nhentai-downloader](/market?keyword=nhentai-downloader)插件。
*	**[ascii2d](https://ascii2d.net/) (a)** : 二次元画像詳細検索，作为补充结果。
*	**[yandex](https://ya.ru/) (y)** : 识别网络媒体或网站中存在的特征相似图片并返回来源，主要作为补充结果。

#### 可用图源
*	**[yandere](https://yande.re/post)** : 动漫和游戏插画图站，高清壁纸和原画。
*	**[gelbooru](https://gelbooru.com/index.php?page=post&s=list&tags=all)** : 综合性动漫图站，插画、漫画和同人作品。
*	**[danbooru](https://danbooru.donmai.us/)** : 动漫艺术网站，标签详尽元数据丰富。
*	**[pixiv](https://www.pixiv.net/)** : 艺术家原创插画、漫画分享社区。
---

###	注意：
*	部分引擎可能需要配置代理才可用, **http** 相关报错请先检查代理网络设置。
*	返回的搜索结果可能存在 **R18/NSFW** 内容，请设置分级筛选或在合理范围内使用。
*	\`saucenao\` 引擎, \`gelbooru\` , \`danbooru\` , \`pixiv\` 图源需要配置 API Key 或 Token 才可用。 
*	\`yandex\` , \`ascii2d\` ,  \`soutubot\` 引擎, \`danbooru\` 图源需要启动浏览器实例才可用，如果服务器性能不足可以考虑关闭或者设置自动关闭延迟。
`

export function apply(ctx: Context, config: Config) {
  const puppeteerManager = new PuppeteerManager(ctx, config);

  // 初始化所有 searchers 和 enhancers
  const allSearchers: Record<string, Searcher> = {};
  if (config.saucenao.apiKeys && config.saucenao.apiKeys.length > 0) {
    allSearchers.saucenao = new SauceNAO(ctx, config, config.saucenao);
  } else {
    logger.info('[saucenao] 未提供任何 API Key，引擎已禁用。');
  }
  allSearchers.tracemoe = new TraceMoe(ctx, config, config.tracemoe);
  allSearchers.iqdb = new IQDB(ctx, config, config.iqdb);
  allSearchers.yandex = new Yandex(ctx, config, config.yandex, puppeteerManager);
  allSearchers.ascii2d = new Ascii2D(ctx, config, config.ascii2d, puppeteerManager);
  allSearchers.soutubot = new SoutuBot(ctx, config, config.soutubot, puppeteerManager);

  const allEnhancers: Record<string, Enhancer> = {};
  const enhancerRegistry = {
    yandere: { constructor: YandeReEnhancer, needsKeys: false, keys: null, keyName: '', messageName: '图源' },
    gelbooru: { constructor: GelbooruEnhancer, needsKeys: true, keys: config.gelbooru.keyPairs, keyName: 'API Key', messageName: '图源' },
    danbooru: { constructor: DanbooruEnhancer, needsKeys: true, keys: config.danbooru.keyPairs, keyName: '用户凭据', messageName: '图源' },
    pixiv: { constructor: PixivEnhancer, needsKeys: true, keys: [config.pixiv.refreshToken], keyName: 'Refresh Token', messageName: '图源' },
  };

  for (const name in enhancerRegistry) {
      const entry = enhancerRegistry[name];
      const areKeysProvided = !entry.needsKeys || (Array.isArray(entry.keys) ? entry.keys.filter(Boolean).length > 0 : !!entry.keys);

      if (areKeysProvided) {
          const constructorArgs: any[] = [ctx, config, config[name]];
          if (name === 'danbooru') constructorArgs.push(puppeteerManager);
          allEnhancers[name] = new entry.constructor(...constructorArgs);
      } else {
          logger.info(`[${name}] ${entry.messageName}未配置任何${entry.keyName}，将无法启用。`);
      }
  }

  const allEnabledSearchers = config.order
    .filter(item => item.enabled && allSearchers[item.engine])
    .map(item => allSearchers[item.engine]);
  
  const sortedEnhancers = config.enhancerOrder
    .filter(item => item.enabled && allEnhancers[item.engine])
    .map(item => allEnhancers[item.engine]);

  if (allEnabledSearchers.length > 0) logger.info(`已启用的搜图引擎顺序: ${allEnabledSearchers.map(s => s.name).join(', ')}`);
  if (sortedEnhancers.length > 0) logger.info(`已启用的图源顺序: ${sortedEnhancers.map(e => e.name).join(', ')}`);

  const searchHandler = new SearchHandler(ctx, config, allSearchers, allEnabledSearchers);

  // 注册 `sauce` 指令
  ctx.command('sauce [...text:string]', '聚合搜图')
    .alias('soutu','搜图')
    .option('all', '-a  强制搜索所有已启用的引擎')
    .usage([
      '支持多种灵活的搜图方式：',
      '– 指令后直接跟图片或图片URL',
      '– 回复一条包含图片的消息',
      '– 单独发送指令，然后在规定时间内发送图片',
      '',
      '可通过指定引擎名或别名来使用特定引擎进行搜索。',
      '可用引擎 (及其别名):',
      'saucenao(s), iqdb(i), tracemoe(t), soutubot(b), ascii2d(a), yandex(y)',
    ].join('\n'))
    .example('sauce [图片]  (默认模式搜索)')
    .example('sauce -a [图片]  (搜索所有可用引擎)')
    .example('sauce saucenao [图片]  (使用 SauceNAO 搜索)')
    .example('sauce a [图片]  (使用 ascii2d 搜索)')
    .action(async ({ session, options }, text) => {
        function parseInput(inputText: string) {
            const words = (inputText || '').split(/\s+/).filter(Boolean);
            let searchersToUse: Searcher[] = allEnabledSearchers;
            let imageInputText: string = inputText || '';
            let isSingleEngineSpecified = false;
            
            const availableEngines = Object.keys(allSearchers) as SearchEngineName[];
            const engineAliases: Record<string, SearchEngineName> = {
                's': 'saucenao', 'i': 'iqdb', 't': 'tracemoe', 'y': 'yandex', 'a': 'ascii2d', 'b': 'soutubot',
            };
            const firstWord = words[0]?.toLowerCase();
            const targetEngineName = engineAliases[firstWord] || (availableEngines.includes(firstWord as any) ? firstWord : null) as SearchEngineName;
            
            if (targetEngineName) {
                const targetSearcher = allSearchers[targetEngineName];
                if (targetSearcher) {
                    searchersToUse = [targetSearcher];
                    imageInputText = words.slice(1).join(' ');
                    isSingleEngineSpecified = true;
                }
            }
            return { searchersToUse, imageInputText, isSingleEngineSpecified };
        }

        async function resolveImageInput(session: Session, text: string) {
          let imgData = getImageUrlAndName(session, text);
          if (imgData.url) return imgData;
        
          await session.send(`请发送图片... (超时: ${config.promptTimeout}秒)`);
          try {
            const nextMessageContent = await session.prompt(config.promptTimeout * 1000);
            if (!nextMessageContent) {
              await session.send('已取消。');
              return null;
            }
            const messageSession = { elements: h.parse(h.unescape(nextMessageContent)) };
            imgData = getImageUrlAndName(messageSession, '');
            
            if (!imgData.url) {
              await session.send('未找到图片，已取消。');
              return null;
            }
            return imgData;
          } catch (e) {
            if (config.debug.enabled) logger.warn('等待用户图片时出错:', e);
            await session.send('等待超时，已取消。');
            return null;
          }
        }

        const { searchersToUse, imageInputText, isSingleEngineSpecified } = parseInput(text);

        if (isSingleEngineSpecified && searchersToUse.length === 0) return '指定的搜图引擎无效或未正确配置。';
        if (!isSingleEngineSpecified && allEnabledSearchers.length === 0) return '沒有启用或指定任何有效的搜图引擎。';

        const imgData = await resolveImageInput(session, imageInputText);
        if (!imgData) return;
        
        try {
          await session.send("正在搜索...");
          const rawImageArrayBuffer = await ctx.http.get(imgData.url, { responseType: 'arraybuffer' });
          
          if (!/\.(jpe?g|png|gif|webp)$/i.test(imgData.name)) {
            const imageType = detectImageType(Buffer.from(rawImageArrayBuffer));
            if (imageType) imgData.name = `${imgData.name}.${imageType}`;
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
              const mainSearchers = options.all ? allEnabledSearchers : searchersToUse;
              const attachSearchers = options.all ? [] : allEnabledSearchers.filter(s =>
                  ((config.yandex.alwaysAttach && s.name === 'yandex') || (config.ascii2d.alwaysAttach && s.name === 'ascii2d'))
                  && mainSearchers[0]?.name !== s.name
              );
              return searchHandler.handleDirectSearch(mainSearchers, attachSearchers, isSingleEngineSpecified, searchOptions, botUser, session, collectedErrors, sortedEnhancers);
          } else if (config.search.mode === 'parallel') {
              return searchHandler.handleParallelSearch(allEnabledSearchers, searchOptions, botUser, session, collectedErrors, sortedEnhancers);
          } else {
              const sequentialSearchers = allEnabledSearchers.filter(s => s.name !== 'yandex' && s.name !== 'ascii2d');
              return searchHandler.handleSequentialSearch(sequentialSearchers, searchOptions, botUser, session, collectedErrors, sortedEnhancers);
          }
        } catch (error) {
          logger.error('图片处理失败:', error);
          return '图片处理失败，请检查链接或网络。';
        }
    });

  // 注册中间件以自动解析图源链接
  const linkParsingRegistry = [
    { name: 'pixiv', regex: /(www\.pixiv\.net\/(en\/)?artworks\/\d+|i\.pximg\.net|www\.pixiv\.net\/member_illust\.php\?.*illust_id=\d+)/, enhancer: allEnhancers.pixiv, config: config.pixiv },
    { name: 'danbooru', regex: /danbooru\.donmai\.us\/(posts|post\/show)\/\d+/, enhancer: allEnhancers.danbooru, config: config.danbooru },
    { name: 'gelbooru', regex: /gelbooru\.com\/index\.php\?.*id=\d+/, enhancer: allEnhancers.gelbooru, config: config.gelbooru },
    { name: 'yandere', regex: /yande\.re\/post\/show\/\d+/, enhancer: allEnhancers.yandere, config: config.yandere },
  ];

  ctx.middleware(async (session, next) => {
    const plainText = extractPlainText(session.elements);
    if (plainText.toLowerCase().startsWith('sauce') || plainText.toLowerCase().startsWith('搜图')) {
        return next();
    }

    const urls = plainText.match(/https?:\/\/[^\s]+/g);
    if (!urls) return next();

    for (const url of urls) {
      for (const service of linkParsingRegistry) {
        if (service.enhancer && service.config.enableLinkParsing && service.regex.test(url)) {
          if (config.debug.enabled) logger.info(`[${service.name}] 检测到链接，开始自动解析: ${url}`);
          try {
            const dummyResult: SearcherResult.Result = { url, similarity: 100, thumbnail: '', source: '链接解析' };
            const enhancedData = await service.enhancer.enhance(dummyResult);
            if (enhancedData) {
              const botUser = await session.bot.getSelf();
              const figureMessage = h('figure');
              if (enhancedData.imageBuffer) {
                figureMessage.children.push(h('message', { nickname: '图源图片', avatar: botUser.avatar }, h.image(enhancedData.imageBuffer, enhancedData.imageType)))
              }
              figureMessage.children.push(h('message', { nickname: '图源信息', avatar: botUser.avatar }, enhancedData.details));
              if (enhancedData.additionalImages?.length > 0) {
                figureMessage.children.push(...enhancedData.additionalImages);
              }
              await session.send(figureMessage);
              return; 
            }
          } catch (e) {
            logger.warn(`[${service.name}] 链接解析失败 (URL: ${url}):`, e.message);
          }
          break;
        }
      }
    }
    return next();
  }, config.prependLinkParsingMiddleware);

  // 注册生命周期钩子
  ctx.on('ready', async () => {
    if (config.puppeteer.persistentBrowser) {
        const puppeteerSearchers: SearchEngineName[] = ['yandex', 'ascii2d', 'soutubot'];
        const needsPuppeteerForSearch = config.order.some(e => e.enabled && puppeteerSearchers.includes(e.engine));
        const needsPuppeteerForEnhance = sortedEnhancers.some(e => e.name === 'danbooru');
        if (needsPuppeteerForSearch || needsPuppeteerForEnhance) {
            await puppeteerManager.initialize();
        }
    }
  });

  ctx.on('dispose', () => puppeteerManager.dispose());
}
// --- END OF FILE src/index.ts ---