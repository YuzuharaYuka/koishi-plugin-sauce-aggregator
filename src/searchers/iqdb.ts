// --- START OF FILE src/searchers/iqdb.ts ---

import { Context, Logger } from 'koishi'
import { Config, Searcher, SearchOptions, IQDB as IQDBConfig, SearchEngineName } from '../config'
import * as cheerio from 'cheerio'
import { USER_AGENT } from '../utils'

const logger = new Logger('sauce-aggregator')

function fixedHref(href: string): string {
  if (!href) return ''
  if (href.startsWith('//')) return 'https:' + href
  if (href.startsWith('/')) return 'https://iqdb.org' + href
  return href
}

function parseImageProperties(alt: string) {
    if (!alt) return { score: undefined, tags: undefined }
    const properties: Record<string, string> = {};
    alt.split(' ').forEach((part, i, arr) => {
        if (part.endsWith(':')) {
            properties[part.slice(0, -1).toLowerCase()] = arr[i + 1];
        }
    });

    const tags = properties.tags?.split(',').map(t => t.trim()).filter(Boolean);
    const score = properties.score ? parseInt(properties.score) : undefined;
    return { score, tags };
}

export class IQDB extends Searcher<IQDBConfig.Config> {
  public readonly name: SearchEngineName = 'iqdb';
  
  constructor(ctx: Context, mainConfig: Config, subConfig: IQDBConfig.Config) {
    super(ctx, mainConfig, subConfig);
  }

  async search(options: SearchOptions): Promise<Searcher.Result[]> {
    const form = new FormData()
    const safeBuffer = Buffer.from(options.imageBuffer);
    form.append('file', new Blob([safeBuffer]), options.fileName)
    
    const url = 'https://iqdb.org/'
    if (this.mainConfig.debug.enabled) logger.info(`[iqdb] 发送请求到 ${url}，图片大小: ${options.imageBuffer.length} 字节`)

    try {
      const startTime = Date.now();
      const html = await this.ctx.http.post(url, form, {
        headers: { 
            'User-Agent': USER_AGENT,
            'Referer': 'https://iqdb.org/',
        },
        timeout: this.mainConfig.requestTimeout * 1000,
      })

      const results = this._parseResults(html);

      // [FIX] 新增请求成功日志
      if (this.mainConfig.debug.enabled) {
          const duration = Date.now() - startTime;
          logger.info(`[iqdb] 收到响应并解析完成 (${duration}ms)，解析到 ${results.length} 个结果。`);
      }
      
      if (this.mainConfig.debug.logApiResponses.includes(this.name)) {
        logger.info({ '[iqdb] Raw HTML Response': html });
      }
      
      if (html.includes('File is too large')) throw new Error('图片体积过大 (超过 8MB 限制)。');
      if (html.includes('You are searching too much.')) throw new Error('搜索过于频繁，请稍后再试。');
      if (html.includes("Can't read query result")) throw new Error('服务器未能读取查询结果，可能是临时性问题，请稍后重试。');

      return results;

    } catch (error) {
      if (error.code === 'ETIMEDOUT' || /timeout/i.test(error.message)) {
          throw new Error('请求超时。IQDB 服务器可能正处于高负载状态，请稍后重试。');
      }
      logger.warn(`[iqdb] 请求出错: ${error.message}`)
      if (this.mainConfig.debug.enabled && error.response) {
        logger.debug(`[iqdb] 响应状态: ${error.response.status}`)
        logger.debug(`[iqdb] 响应数据: ${JSON.stringify(error.response.data)}`)
      }
      throw error
    }
  }

  private _parseResults(html: string): Searcher.Result[] {
    const $ = cheerio.load(html);
    const resultElements = $('.pages > div');

    if (resultElements.length === 0) {
      if (html.includes('No relevant results found')) return [];
      if (this.mainConfig.debug.enabled) logger.warn('[iqdb] 页面结构可能已更改，未找到结果容器。');
      return [];
    }

    const results: Searcher.Result[] = [];
    resultElements.each((_, element) => {
      try {
        const $div = $(element);
        if ($div.find('th').length === 0) return;

        const similarityMatch = $div.find('tr:last-child td').text().match(/(\d+\.?\d*)% similarity/);
        const mainUrl = $div.find('td.image a').attr('href');
        if (!similarityMatch || !mainUrl) return;

        const details: string[] = [];
        const $rows = $div.find('table tr');
        
        const matchType = $rows.eq(0).find('th').text();
        if (matchType) details.push(`匹配类型: ${matchType}`);

        const sizeAndRatingText = $rows.eq(3).find('td').text();
        const dimensionMatch = /(\d+[x×]\d+)/.exec(sizeAndRatingText);
        if (dimensionMatch) details.push(`尺寸: ${dimensionMatch[1]}`);
        const typeMatch = /\[(Safe|Ero|Explicit|Questionable)\]/i.exec(sizeAndRatingText);
        if (typeMatch) details.push(`分级: ${typeMatch[1]}`);

        const altText = $div.find('.image img').attr('alt') || '';
        const props = parseImageProperties(altText);
        if (props.score) details.push(`评分: ${props.score}`);
        if (props.tags?.length > 0) details.push(`标签: ${props.tags.join(' ')}`);

        const $sourceCell = $rows.eq(2).find('td');
        const primarySource = $sourceCell.clone().children().remove().end().text().trim();
        $sourceCell.find('a').each((_, el) => {
          const $a = $(el);
          details.push(`${$a.text()} 来源: ${fixedHref($a.attr('href'))}`);
        });

        results.push({
            thumbnail: fixedHref($div.find('.image img').attr('src')),
            similarity: parseFloat(similarityMatch[1]),
            url: fixedHref(mainUrl),
            source: primarySource || '未知来源',
            details,
        });
      } catch (parseError) {
        if (this.mainConfig.debug.enabled) logger.error('[iqdb] 解析单个结果时出错:', parseError);
      }
    });
    
    return results.filter(r => r.thumbnail && r.url);
  }
}
// --- END OF FILE src/searchers/iqdb.ts ---