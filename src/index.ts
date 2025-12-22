
// sauce-aggregator 插件入口，负责指令注册与调度

import { Context, Logger } from 'koishi'
import { Config, SearchEngineName } from './config'
import { SEARCH_MESSAGES, COMMAND_ERRORS } from './constants'
import { SearchHandler } from './core/search'
import { CommandHandler } from './core/command'
import { LinkParser } from './core/parser'
import { DebugLogger } from './core/logger'
import { initializePuppeteerManager, initializeSearchers, initializeEnhancers } from './bootstrap'
import { registerLifecycleHooks } from './lifecycle'
import { selectSearchStrategy } from './strategy'

export const name = 'sauce-aggregator'
export const inject = {
  required: ['http'],
  optional: ['puppeteer'],
}

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
*	**[soutubot](https://soutubot.moe/) (b)** : 搜图bot酱，使用完整或局部图识别nh或eh本子，下载nh本子可使用[nhentai-downloader](/market?keyword=nhentai-downloader)插件。
*	**[ascii2d](https://ascii2d.net/) (a)** : 二次元画像詳細検索，作为补充结果。
*	**[yandex](https://ya.ru/) (y)** : 识别网络媒体或网站中存在的特征相似图片并返回来源，主要作为补充结果。

#### 可用图源
*	**[yandere](https://yande.re/post)** : 动漫和游戏插画图站，高清壁纸和原画。
*	**[konachan](https://konachan.com/post)** : 动漫壁纸站，专注于高质量壁纸。
*	**[gelbooru](https://gelbooru.com/index.php?page=post&s=list&tags=all)** : 综合性动漫图站，插画、漫画和同人作品。
*	**[danbooru](https://danbooru.donmai.us/)** : 动漫艺术网站，标签详尽元数据丰富。
*	**[pixiv](https://www.pixiv.net/)** : 艺术家原创插画、漫画分享社区。
---

###	注意：
*	部分引擎可能需要配置代理才可用, **http** 相关报错请先检查代理网络设置。
*	返回的搜索结果可能存在 **R18/NSFW** 内容，请设置分级筛选或在合理范围内使用。
*	\`saucenao\` 引擎, \`gelbooru\` , \`danbooru\` , \`pixiv\` 图源需要配置 API Key 或 Token 才可用。
*	\`yandex\` , \`ascii2d\` ,  \`soutubot\` 引擎需要启动浏览器实例才可用，如果服务器性能不足可以考虑关闭或者设置自动关闭延迟。
`

export function apply(ctx: Context, config: Config) {
  // 初始化日志器
  const debugLogger = new DebugLogger('main', config)

  // 初始化核心组件
  const puppeteerManager = initializePuppeteerManager(ctx, config, debugLogger)
  const allSearchers = initializeSearchers(ctx, config, puppeteerManager)
  const allEnhancers = initializeEnhancers(ctx, config, puppeteerManager)

  // 获取已启用的引擎和增强器
  const allEnabledSearchers = config.order
    .filter(item => item.enabled && allSearchers[item.engine])
    .map(item => allSearchers[item.engine])

  const sortedEnhancers = config.enhancerOrder
    .filter(item => item.enabled && allEnhancers[item.engine])
    .map(item => allEnhancers[item.engine])

  // 输出已启用的引擎和增强器顺序
  if (allEnabledSearchers.length > 0) {
    debugLogger.always(`已启用的搜图引擎顺序: ${allEnabledSearchers.map(s => s.name).join(', ')}`)
  }
  if (sortedEnhancers.length > 0) {
    debugLogger.always(`已启用的图源顺序: ${sortedEnhancers.map(e => e.name).join(', ')}`)
  }

  // 创建处理器
  const searchHandler = new SearchHandler(ctx, config, allSearchers, allEnabledSearchers, puppeteerManager)
  const commandHandler = new CommandHandler(ctx, config, allSearchers, allEnabledSearchers)

  // 注册主搜图指令
  ctx.command('sauce [...text:string]', '聚合搜图')
    .alias('soutu', '搜图')
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
      // 解析指令参数
      const { searchersToUse, imageInputText, isSingleEngineSpecified } = commandHandler.parseCommandInput(text)

      if (isSingleEngineSpecified && searchersToUse.length === 0) {
        return COMMAND_ERRORS.INVALID_ENGINE
      }
      if (!isSingleEngineSpecified && allEnabledSearchers.length === 0) {
        return COMMAND_ERRORS.NO_ENABLED_ENGINES
      }

      const imgData = await commandHandler.resolveImageInput(session, imageInputText)
      if (!imgData) return

      try {
        await session.send(SEARCH_MESSAGES.SEARCHING)
        const searchOptions = await commandHandler.buildSearchOptions(imgData)
        if (!searchOptions) {
          logger.warn('图片处理失败：无法构建搜索选项')
          return SEARCH_MESSAGES.IMAGE_PROCESS_FAILED
        }
        const botUser = await session.bot.getSelf()
        return await selectSearchStrategy({
          isSingleEngineSpecified,
          searchOptions,
          searchHandler,
          commandHandler,
          allEnabledSearchers,
          searchersToUse,
          options,
          config,
          botUser,
          session,
          sortedEnhancers
        })
      } catch (error) {
        logger.error('搜索过程中出现异常:', error)
        return SEARCH_MESSAGES.IMAGE_PROCESS_FAILED
      }
    })

  // 注册链接解析中间件
  const linkParsingHandler = new LinkParser(ctx, config, searchHandler, allEnhancers)
  ctx.middleware(
    (session, next) => linkParsingHandler.handleMiddleware(session, next),
    config.prependLinkParsingMiddleware
  )

  // 注册生命周期钩子
  registerLifecycleHooks(ctx, config, puppeteerManager, debugLogger)
}
