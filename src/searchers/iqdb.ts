// --- START OF FILE searchers/iqdb.ts ---

import { Context, Logger } from 'koishi'
import { Searcher, SearchOptions, IQDB as IQDBConfig } from '../config'
import * as cheerio from 'cheerio'
import FormData from 'form-data'

const logger = new Logger('sauce-aggregator')

// 辅助函数：将 IQDB 的相对链接补全为可访问的 URL
function fixedHref (href: string): string {
  if (!href) return ''
  if (href.startsWith('//')) {
    return 'https:' + href
  } else if (href.startsWith('/')) {
    return 'https://iqdb.org' + href
  }
  return href
}

// 辅助函数：解析 <img> alt 属性中的评分和标签
function parseImageProperties(alt: string) {
    if (!alt) return { score: undefined, tags: undefined }
    const parts = alt.split(' ')
    const properties: Record<string, string | string[]> = {}
    let currentKey = ''
    for (const part of parts) {
        if (part.endsWith(':')) {
            currentKey = part.slice(0, -1).toLowerCase()
            continue
        }
        if (currentKey) {
            const value = properties[currentKey]
            if (value) {
                if (Array.isArray(value)) {
                    value.push(part)
                } else {
                    properties[currentKey] = [value, part]
                }
            } else {
                properties[currentKey] = part
            }
        }
    }

    const tags = properties.tags
    let finalTags: string[] | undefined
    if (tags) {
        finalTags = (Array.isArray(tags) ? tags : [tags]).join(' ').split(',').map(t => t.trim()).filter(Boolean)
    }

    return {
        score: properties.score ? parseInt(properties.score as string) : undefined,
        tags: finalTags
    }
}

export class IQDB implements Searcher<IQDBConfig.Config> {
  name = 'iqdb'
  
  constructor(public ctx: Context, public config: IQDBConfig.Config, public debug: boolean) {}

  async search(options: SearchOptions): Promise<Searcher.Result[]> {
    const form = new FormData()
    form.append('file', options.imageBuffer, options.fileName)
    
    const url = 'https://iqdb.org/'
    if (this.debug) logger.info(`[iqdb] 发送请求到 ${url}，图片大小: ${options.imageBuffer.length} 字节`)

    try {
      // **FIXED**: 回退到使用 getBuffer() 和 getHeaders() 的工作方式
      const html = await this.ctx.http.post(url, form.getBuffer(), {
        headers: { 
            ...form.getHeaders(),
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            'Referer': 'https://iqdb.org/',
        },
      })
      logger.info(`[iqdb] 收到响应页面，长度: ${html.length}`)

      const $ = cheerio.load(html)
      const results: Searcher.Result[] = []
      const resultElements = $('#pages > div, #more1 > .pages > div')

      if (resultElements.length === 0 && !html.includes('No relevant results found')) {
        if (this.debug) logger.warn('[iqdb] 页面结构可能已更改，未找到结果容器。')
        return []
      }

      resultElements.each((_, element) => {
        try {
          const $div = $(element)
          if ($div.find('th').length === 0) return

          const similarityMatch = $div.find('tr:last-child td').text().match(/(\d+\.?\d*)% similarity/)
          if (!similarityMatch) return
          
          const mainUrl = $div.find('td.image a').attr('href')
          if (!mainUrl) return

          const details: string[] = []
          const $rows = $div.find('table tr')
          
          const matchType = $rows.eq(0).find('th').text()
          if (matchType) details.push(`匹配类型: ${matchType}`)

          const sizeAndRatingText = $rows.eq(3).find('td').text()
          const dimensionMatch = /(\d+[x×]\d+)/.exec(sizeAndRatingText)
          if (dimensionMatch) details.push(`尺寸: ${dimensionMatch[1]}`)
          const typeMatch = /\[(Safe|Ero|Explicit|Questionable)\]/i.exec(sizeAndRatingText)
          if (typeMatch) details.push(`分级: ${typeMatch[1]}`)

          const altText = $div.find('.image img').attr('alt') || ''
          const props = parseImageProperties(altText)
          if (props.score) details.push(`评分: ${props.score}`)
          if (props.tags && props.tags.length > 0) {
            details.push(`标签: ${props.tags.join(' ')}`)
          }

          const $sourceCell = $rows.eq(2).find('td')
          const primarySource = $sourceCell.clone().children().remove().end().text().trim()
          
          $sourceCell.find('a').each((_, el) => {
            const $a = $(el)
            details.push(`${$a.text()} 来源: ${fixedHref($a.attr('href'))}`)
          })

          results.push({
              thumbnail: fixedHref($div.find('.image img').attr('src')),
              similarity: parseFloat(similarityMatch[1]),
              url: fixedHref(mainUrl),
              source: primarySource || '未知来源',
              details,
          })
        } catch (parseError) {
          if (this.debug) logger.error('[iqdb] 解析单个结果时出错:', parseError)
        }
      })
      
      return results.filter(r => r.thumbnail && r.url)
    } catch (error) {
      logger.warn(`[iqdb] 请求出错: ${error.message}`)
      if (this.debug && error.response) {
        logger.debug(`[iqdb] 响应状态: ${error.response.status}`)
        logger.debug(`[iqdb] 响应数据: ${JSON.stringify(error.response.data)}`)
      }
      throw error
    }
  }
}