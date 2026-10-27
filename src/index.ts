
// sauce-aggregator 插件入口，负责指令注册与调度

import { Context, Logger } from 'koishi'
import path from 'path'
import type {} from '@koishijs/plugin-console'
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
  optional: ['puppeteer', 'console'],
}

const logger = new Logger(name)
export { Config }

export const usage = `
###	指令用法
#### sauce [引擎名] [图片]
*	别名: \`搜图\`, \`soutu\`
*	选项: \`--all\` / \`-a\` 搜索全部已启用引擎
*	给图方式: 指令后跟图片或图片链接、回复带图的消息、先发指令再发图
	*	**默认搜索**: \`sauce [图片]\` 按配置的串行 / 并行模式搜索
	*	**全量搜索**: \`sauce -a [图片]\` 搜索全部已启用引擎并返回全部结果
	*	**指定引擎**: \`sauce <引擎名> [图片]\` 只用一个引擎

---

#### 搜图引擎 (及别名)
*	**[saucenao](https://saucenao.com/) (s)** : 同人图与插画检索，需 API Key
*	**[iqdb](https://www.iqdb.org/) (i)** : Booru 类图站，检索壁纸与高清图
*	**[tracemoe](https://trace.moe/) (t)** : 识别番剧截图，给出番剧、集数与时间轴
*	**[soutubot](https://soutubot.moe/) (b)** : 搜图bot酱，索引 E-Hentai、ExHentai、nHentai 等站点
*	**[ascii2d](https://ascii2d.net/) (a)** : 识别推特同人图，作为补充结果
*	**[yandex](https://ya.ru/) (y)** : 特征相似图与来源，作为补充结果
*	**[googlelens](https://lens.google.com/) (g)** : 谷歌以图搜图，作为补充结果，需 SerpApi Key

\`ascii2d\`、\`yandex\`、\`googlelens\` 不参与「找到高匹配度结果即停止」的判定，默认只在未找到高匹配度结果时补位，
开启各自的「总是附加」后则每次展示；\`sauce -a\` 会执行全部已启用引擎，不受该开关影响

#### 图源 (命中后获取作品详情与原图)
*	**[yandere](https://yande.re/post)** : 动漫游戏插画图站，高清壁纸与原画
*	**[konachan](https://konachan.com/post)** : 动漫壁纸站
*	**[gelbooru](https://gelbooru.com/index.php?page=post&s=list&tags=all)** : 综合图站，插画、漫画与同人作品
*	**[danbooru](https://danbooru.donmai.us/)** : 动漫艺术图站，标签与元数据详尽
*	**[pixiv](https://www.pixiv.net/)** : 画师原创插画与漫画社区

---

###	注意
*	部分引擎需要代理才可用，报 **http** 相关错误时请检查网络与代理设置
*	搜索结果可能包含 **R18/NSFW** 内容，建议收紧各图源的评级上限
*	\`saucenao\`、\`googlelens\` 与 \`gelbooru\`、\`danbooru\`、\`pixiv\` 需要配置 API Key 或 Token
*	\`yandex\`、\`ascii2d\` 需要浏览器环境，服务器性能有限时可以关闭
*	需要 nh、eh 漫画下载能力时可搭配 [nhentai-downloader](/market?keyword=nhentai-downloader)、[ehentai-downloader](/market?keyword=ehentai-downloader)
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
    .option('all', '-a  搜索全部已启用的引擎')
    .usage([
      '支持三种给图方式：',
      '– 指令后直接跟图片或图片链接',
      '– 回复一条包含图片的消息',
      '– 单独发送指令，然后在规定时间内发送图片',
      '',
      '可通过指定引擎名或别名来使用特定引擎进行搜索。',
      '可用引擎 (及其别名):',
      'saucenao(s), iqdb(i), tracemoe(t), soutubot(b), ascii2d(a), yandex(y), googlelens(g)',
    ].join('\n'))
    .example('sauce [图片]  (默认模式搜索)')
    .example('sauce -a [图片]  (搜索全部已启用引擎)')
    .example('sauce saucenao [图片]  (使用 SauceNAO 搜索)')
    .example('sauce a [图片]  (使用 ascii2d 搜索)')
    .action(async ({ session, options }, text) => {
      // session 由框架保证存在，这里仅为满足 strict 类型收窄
      if (!session) return

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
          options: options ?? {},
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

  // 注册控制台客户端入口：配置页右侧的悬浮导航
  ctx.inject(['console'], (ctx) => {
    ctx.console.addEntry({
      dev: path.resolve(__dirname, '../client/index.ts'),
      prod: path.resolve(__dirname, '../dist'),
    })
  })
}
