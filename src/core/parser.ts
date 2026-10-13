import { Context, Logger, Session, h } from 'koishi'
import { Config, Enhancer, Searcher } from '../config'
import { extractPlainText } from '../utils'
import { SearchHandler } from './search'
import { DebugLogger } from './logger'

const logger = new Logger('sauce-aggregator:parser')

/**
 * 链接解析服务配置
 */
export interface LinkParsingService {
  name: string
  regex: RegExp
  enhancer: Enhancer | undefined
  config: { enableLinkParsing: boolean }
}

/**
 * 链接解析处理器
 */
export class LinkParser {
  private debugLogger: DebugLogger
  private registry: LinkParsingService[]

  constructor(
    private ctx: Context,
    private config: Config,
    private searchHandler: SearchHandler,
    allEnhancers: Record<string, Enhancer>
  ) {
    this.debugLogger = new DebugLogger('parser', config)

    // 初始化链接解析注册表
    this.registry = [
      {
        name: 'pixiv',
        regex: /(www\.pixiv\.net\/(en\/)?artworks\/\d+|i\.pximg\.net|www\.pixiv\.net\/member_illust\.php\?.*illust_id=\d+)/,
        enhancer: allEnhancers.pixiv,
        config: config.pixiv,
      },
      {
        name: 'danbooru',
        regex: /danbooru\.donmai\.us\/(posts|post\/show)\/\d+/,
        enhancer: allEnhancers.danbooru,
        config: config.danbooru,
      },
      {
        name: 'gelbooru',
        regex: /gelbooru\.com\/index\.php\?.*id=\d+/,
        enhancer: allEnhancers.gelbooru,
        config: config.gelbooru,
      },
      {
        name: 'yandere',
        regex: /yande\.re\/post\/show\/\d+/,
        enhancer: allEnhancers.yandere,
        config: config.yandere,
      },
      {
        name: 'konachan',
        regex: /(konachan\.(?:com|net)\/post\/show\/\d+|konachan\.(?:com|net)\/(?:image|data\/sample|jpeg)\/[a-f0-9]+\/Konachan\.(?:com|net)[^\/]*?[-_\s]\d+[^\/]*?\.\w+)/i,
        enhancer: allEnhancers.konachan,
        config: config.konachan,
      },
    ]
  }

  /**
   * 中间件处理函数
   */
  public async handleMiddleware(session: Session, next: () => Promise<any>): Promise<any> {
    const plainText = extractPlainText(session.elements)

    // 如果是搜图指令，跳过链接解析
    if (plainText.toLowerCase().startsWith('sauce') || plainText.toLowerCase().startsWith('搜图')) {
      return next()
    }

    // 提取 URL
    const urls = plainText.match(/https?:\/\/[^\s]+/g)
    if (!urls) {
      return next()
    }

    // 逐个检查 URL 是否匹配任何已注册的图源
    for (const url of urls) {
      for (const service of this.registry) {
        if (
          service.enhancer &&
          service.config.enableLinkParsing &&
          service.regex.test(url)
        ) {
          // 找到匹配的图源，进行解析
          if (await this.parseLink(session, service, url)) {
            return // 成功解析后直接返回
          }
          break // 只尝试匹配第一个服务
        }
      }
    }

    return next()
  }

  /**
   * 解析单个链接
   */
  private async parseLink(
    session: Session,
    service: LinkParsingService,
    url: string
  ): Promise<boolean> {
    try {
      this.debugLogger.info(`[${service.name}] 检测到链接，开始自动解析: ${url}`)
      await session.send('检测到图源链接，正在解析……')

      // 创建虚拟结果对象用于增强
      const dummyResult: any = {
        url,
        similarity: 100,
        thumbnail: '',
        source: '链接解析',
      }

      const processedIds = new Set<string>()
      const { enhancedResult } = await this.searchHandler.enhanceResult(
        dummyResult,
        [service.enhancer!],
        processedIds
      )

      if (!enhancedResult) {
        await session.send('未解析出有效信息，请确认链接是否有效。')
        return false
      }

      // 构建消息
      const botUser = await session.bot.getSelf()
      const figureMessage = h('figure')

      if (enhancedResult.imageBuffer) {
        figureMessage.children.push(
          h(
            'message',
            { nickname: '图源图片', avatar: botUser?.avatar },
            h.image(enhancedResult.imageBuffer, enhancedResult.imageType || 'image/jpeg')
          )
        )
      }

      figureMessage.children.push(
        h(
          'message',
          { nickname: '图源信息', avatar: botUser?.avatar },
          enhancedResult.details
        )
      )

      const additionalImages = enhancedResult.additionalImages
      if (additionalImages?.length) {
        figureMessage.children.push(...additionalImages)
      }

      await session.send(figureMessage)
      return true
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.warn(`[${service.name}] 链接解析失败 (URL: ${url}):`, errorMessage)

      // 使用消息元素避免消息注入
      await session.send([
        '[',
        h.text(service.name),
        '] 链接解析失败: ',
        h.text(errorMessage),
      ])
      return false
    }
  }
}
