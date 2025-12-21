import { Context, Logger, Session, h } from 'koishi'
import { Config, Searcher, SearchEngineName, SearchOptions, CommandParseResult, ImageInput } from '../config'
import { getImageUrlAndName, preprocessImage, detectImageType } from '../utils'
import { ENGINE_ALIASES, PROMPT_MESSAGES } from '../constants'
import { DebugLogger } from './logger'
import { Buffer } from 'buffer'

const logger = new Logger('sauce-aggregator')

/**
 * 指令处理服务 - 处理 sauce 指令的所有逻辑
 */
export class CommandHandler {
  private debugLogger: DebugLogger

  constructor(
    private ctx: Context,
    private config: Config,
    private allSearchers: Record<string, Searcher>,
    private allEnabledSearchers: Searcher[]
  ) {
    this.debugLogger = new DebugLogger('command', config)
  }

  /**
   * 解析指令参数，识别指定的引擎和图片输入
   */
  public parseCommandInput(text: string): CommandParseResult {
    const words = (text || '').split(/\s+/).filter(Boolean)
    let searchersToUse = this.allEnabledSearchers
    let imageInputText = text || ''
    let isSingleEngineSpecified = false

    const availableEngines = Object.keys(this.allSearchers) as SearchEngineName[]
    const firstWord = words[0]?.toLowerCase()

    // 检查第一个单词是否是有效的引擎名或别名
    const targetEngine = firstWord
      ? ENGINE_ALIASES[firstWord as keyof typeof ENGINE_ALIASES] ?? (availableEngines.includes(firstWord as any) ? (firstWord as SearchEngineName) : null)
      : null

    // [FIX] 增强判断逻辑：排除图片(XML元素)、URL等非引擎名格式
    const isNonEngineFormat = firstWord && (
      firstWord.startsWith('<') ||
      firstWord.match(/^https?:\/\//) ||
      firstWord.startsWith('file://')
    )

    if (!isNonEngineFormat && targetEngine && this.allSearchers[targetEngine]) {
      // 有效的引擎指定
      searchersToUse = [this.allSearchers[targetEngine]]
      imageInputText = words.slice(1).join(' ')
      isSingleEngineSpecified = true
    }

    return { searchersToUse, imageInputText, isSingleEngineSpecified }
  }

  /**
   * 解析图片输入，支持直接输入、回复、等待等多种方式
   */
  public async resolveImageInput(session: Session, text: string): Promise<ImageInput | null> {
    let imgData = getImageUrlAndName(session, text)
    if (imgData.url) {
      return { url: imgData.url, name: imgData.name || 'image.jpg' }
    }

    await session.send(PROMPT_MESSAGES.WAITING_IMAGE(this.config.promptTimeout))
    try {
      const nextMessageContent = await session.prompt(this.config.promptTimeout * 1000)
      if (!nextMessageContent) {
        await session.send(PROMPT_MESSAGES.CANCELLED)
        return null
      }

      const messageSession = { elements: h.parse(h.unescape(nextMessageContent)) }
      imgData = getImageUrlAndName(messageSession, '')

      if (!imgData.url) {
        await session.send(PROMPT_MESSAGES.NO_IMAGE_FOUND)
        return null
      }

      return { url: imgData.url, name: imgData.name || 'image.jpg' }
    } catch (error) {
      this.debugLogger.info('[command] 等待用户图片时出错:', error)
      await session.send(PROMPT_MESSAGES.TIMEOUT)
      return null
    }
  }

  /**
   * 构建搜索选项，处理图片预处理和验证
   */
  public async buildSearchOptions(imgData: ImageInput): Promise<SearchOptions | null> {
    try {
      const rawImageArrayBuffer = await this.ctx.http.get(imgData.url, {
        responseType: 'arraybuffer',
      })

      // 补全文件扩展名
      let fileName = imgData.name
      if (!/\.(jpe?g|png|gif|webp)$/i.test(fileName)) {
        const imageType = detectImageType(Buffer.from(rawImageArrayBuffer))
        if (imageType) {
          fileName = `${fileName}.${imageType}`
        }
      }

      // 预处理图片
      const processedImageBuffer = await preprocessImage(Buffer.from(rawImageArrayBuffer))

      return {
        imageUrl: imgData.url,
        imageBuffer: processedImageBuffer,
        fileName,
        maxResults: this.config.maxResults === 0 ? 3 : this.config.maxResults,
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      this.debugLogger.info(`构建搜索选项失败 (URL: ${imgData.url}):`, errorMsg)
      logger.error('[command] 构建搜索选项失败:', error)
      return null
    }
  }

  /**
   * 计算附加搜索器（Yandex 和 Ascii2D 的补充搜索）
   */
  public getAttachSearchers(mainSearchers: Searcher[]): Searcher[] {
    return this.allEnabledSearchers.filter((s) => {
      const isAttachEngine =
        (this.config.yandex.alwaysAttach && s.name === 'yandex') ||
        (this.config.ascii2d.alwaysAttach && s.name === 'ascii2d')

      return isAttachEngine && !mainSearchers.some(m => m.name === s.name)
    })
  }
}
