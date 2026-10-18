// --- START OF FILE src/searchers/iqdb.ts ---

import { Context, Logger } from 'koishi'
import { Config, Searcher, SearchOptions, IQDB as IQDBConfig, SearchEngineName } from '../config'
import * as cheerio from 'cheerio'
import { USER_AGENT } from '../utils'
import { EngineBusyError } from '../core/errors'

// IQDB 搜索器：提交图片并解析 HTML 结果（使用 cheerio）
const logger = new Logger('sauce-aggregator')

// 修正链接为完整地址（属性可能缺失，容许 undefined）
function fixedHref(href?: string): string {
  if (!href) return ''
  if (href.startsWith('//')) return 'https:' + href
  if (href.startsWith('/')) return 'https://iqdb.org' + href
  return href
}

// 从 img 的 alt 属性中解析可能包含的属性（例如 score、tags）
function parseImageProperties(alt: string) {
  if (!alt) return { score: undefined, tags: undefined }

  const scoreMatch = alt.match(/Score:\s*(\d+)/i)
  const score = scoreMatch ? parseInt(scoreMatch[1]) : undefined

  const tagsMatch = alt.match(/Tags:\s*(.+)$/i)
  let tags: string[] | undefined

  if (tagsMatch) {
    const rawTags = tagsMatch[1].trim()
    // 尝试逗号分隔，如果没有逗号则尝试空格分隔
    if (rawTags.includes(',')) {
      tags = rawTags.split(',').map((t) => t.trim()).filter(Boolean)
    } else {
      tags = rawTags.split(' ').map((t) => t.trim()).filter(Boolean)
    }
  }

  return { score, tags }
}

export class IQDB extends Searcher<IQDBConfig.Config> {
  public readonly name: SearchEngineName = 'iqdb'
  /** 排队繁忙后的恢复时间戳（毫秒）；冷却期内直接跳过，避免每次搜索都白等超时 */
  private busyUntil = 0

  constructor(ctx: Context, mainConfig: Config, subConfig: IQDBConfig.Config) {
    super(ctx, mainConfig, subConfig)
  }

  private get timeoutMs(): number {
    return Math.max(5, this.subConfig.timeoutSeconds ?? 20) * 1000
  }

  private get cooldownMs(): number {
    return Math.max(0, this.subConfig.cooldownMinutes ?? 10) * 60_000
  }

  /** 标记站点繁忙并进入冷却，返回可直接抛出的 EngineBusyError */
  private markBusy(reason: string): EngineBusyError {
    if (this.cooldownMs > 0) this.busyUntil = Date.now() + this.cooldownMs
    const minutes = Math.ceil(this.cooldownMs / 60_000)
    const suffix = this.cooldownMs > 0 ? `，${minutes} 分钟内跳过` : ''
    logger.info(`[iqdb] ${reason}${suffix}`)
    return new EngineBusyError(`${reason}${suffix}`, this.busyUntil)
  }

  // 主搜索方法：提交图片并返回解析结果
  async search(options: SearchOptions): Promise<Searcher.Result[]> {
    const remaining = this.busyUntil - Date.now()
    if (remaining > 0) {
      const minutes = Math.ceil(remaining / 60_000)
      throw new EngineBusyError(`排队繁忙，${minutes} 分钟内跳过`, this.busyUntil)
    }

    const form = new FormData()
    // 优化：直接使用 options.imageBuffer，避免额外的 Buffer.from 拷贝
    form.append('file', new Blob([options.imageBuffer as any]), options.fileName)

    const url = 'https://iqdb.org/'
    if (this.mainConfig.debug.enabled) logger.info(`[iqdb] 发送请求到 ${url}，图片大小: ${options.imageBuffer.length} 字节`)

    try {
      const startTime = Date.now()
      const html = await this.ctx.http.post(url, form, {
        headers: {
          'User-Agent': USER_AGENT,
          Referer: 'https://iqdb.org/',
        },
        timeout: this.timeoutMs,
      })

      // 排队 / 限流页面不会给出结果，提前识别并进入冷却
      if (/You are searching too much/i.test(html)) {
        throw this.markBusy('触发了站点的频率限制')
      }
      if (/heavy load|currently under load|placed in a? queue|too many requests|try again in a few/i.test(html)) {
        throw this.markBusy('站点正在排队')
      }

      // 解析 HTML 并提取结果
      const results = this._parseResults(html)

      // 请求成功的调试日志
      if (this.mainConfig.debug.enabled) {
        const duration = Date.now() - startTime
        logger.info(`[iqdb] 收到响应并解析完成 (${duration}ms)，解析到 ${results.length} 个结果`)
      }

      if (this.mainConfig.debug.logApiResponses.includes(this.name)) {
        logger.info(`[iqdb] Parsed JSON Response: ${JSON.stringify(results, null, 2)}`)
        logger.info({ '[iqdb] Raw HTML Response': html })
      }

      // 常见错误提示判断
      if (html.includes('File is too large')) throw new Error('图片体积过大 (超过 8MB 限制)。')
      if (html.includes("Can't read query result")) throw new Error('服务器未能读取查询结果，可能是临时性问题，请稍后重试。')

      return results

    } catch (error) {
      // 已经在上面标记过繁忙
      if (error instanceof EngineBusyError) throw error

      // 超时：IQDB 繁忙时会长时间排队，视为繁忙而不是失败
      const name = (error as Error)?.name || ''
      const message = (error as Error)?.message || ''
      if ((error as any)?.code === 'ETIMEDOUT' || /timeout|aborted/i.test(message) || name === 'TimeoutError') {
        throw this.markBusy(`等待结果超时（${Math.round(this.timeoutMs / 1000)} 秒）`)
      }

      logger.warn(`[iqdb] 请求出错: ${message}`)
      if (this.mainConfig.debug.enabled && (error as any).response) {
        logger.debug(`[iqdb] 响应状态: ${(error as any).response.status}`)
        logger.debug(`[iqdb] 响应数据: ${JSON.stringify((error as any).response.data)}`)
      }
      throw error
    }
  }

  // 使用 cheerio 从 HTML 中提取结果项
  private _parseResults(html: string): Searcher.Result[] {
    const $ = cheerio.load(html)
    const resultElements = $('.pages > div')

    if (resultElements.length === 0) {
      if (html.includes('No relevant results found')) return []
      if (this.mainConfig.debug.enabled) logger.warn('[iqdb] 页面结构可能已更改，未找到结果容器')
      return []
    }

    const results: Searcher.Result[] = []
    resultElements.each((_, element) => {
      try {
        const $div = $(element)
        if ($div.find('th').length === 0) return

        const similarityMatch = $div.find('tr:last-child td').text().match(/(\d+\.?\d*)% similarity/)
        const mainUrl = $div.find('td.image a').attr('href')
        if (!similarityMatch || !mainUrl) return

        const details: string[] = []
        const $rows = $div.find('table tr')

        const matchType = $rows.first().find('th').text()
        if (matchType) details.push(`匹配类型: ${matchType}`)

        let sizeAndRatingText = ''
        let $sourceCell: any = null

        $rows.each((_, row) => {
          const $row = $(row)
          const text = $row.text()

          if (/\d+[x×]\d+/.test(text)) {
            sizeAndRatingText = text
          }

          const hasImg = $row.find('img').length > 0
          const isResRow = /\d+[x×]\d+/.test(text)
          const hasLink = $row.find('a').length > 0
          const isSimilarity = /similarity/.test(text)

          if (!hasImg && !isResRow && hasLink && !isSimilarity) {
            $sourceCell = $row.find('td')
          }
        })

        if (sizeAndRatingText) {
          const dimensionMatch = /(\d+[x×]\d+)/.exec(sizeAndRatingText)
          if (dimensionMatch) details.push(`尺寸: ${dimensionMatch[1]}`)
          const typeMatch = /\[(Safe|Ero|Explicit|Questionable)\]/i.exec(sizeAndRatingText)
          if (typeMatch) details.push(`分级: ${typeMatch[1]}`)
        }

        const altText = $div.find('.image img').attr('alt') || ''
        const props = parseImageProperties(altText)
        if (props.score) details.push(`评分: ${props.score}`)
        if (props.tags && props.tags.length > 0) details.push(`标签: ${props.tags.join(' ')}`)

        let primarySource = '未知来源'
        if ($sourceCell) {
          const text = $sourceCell.clone().children().remove().end().text().trim()
          if (text) primarySource = text

          $sourceCell.find('a').each((_: number, el: any) => {
            const $a = $(el)
            const href = $a.attr('href')
            if (href) {
              details.push(`${$a.text()} 来源: ${fixedHref(href)}`)
            }
          })
        }

        results.push({
          thumbnail: fixedHref($div.find('.image img').attr('src')),
          similarity: parseFloat(similarityMatch[1]),
          url: fixedHref(mainUrl),
          source: primarySource,
          details,
        })
      } catch (parseError) {
        if (this.mainConfig.debug.enabled) logger.error('[iqdb] 解析单个结果时出错:', parseError)
      }
    })

    return results.filter((r) => r.thumbnail && r.url)
  }
}
