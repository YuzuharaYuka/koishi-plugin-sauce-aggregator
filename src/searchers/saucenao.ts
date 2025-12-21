import { Context, Logger } from 'koishi'
import { Config, Searcher, SearchOptions, SauceNAO as SauceNAOConfig, SearchEngineName } from '../config'

// SauceNAO 索引映射表：将 index id 映射为可读来源名
const logger = new Logger('sauce-aggregator')

const saucenaoIndexMap: Record<number, string> = {
  0: 'H-Mags',
  2: 'H-Game CG',
  4: 'HCG',
  5: 'Pixiv',
  6: 'Pixiv Historical',
  8: 'Nico Nico Seiga',
  9: 'Danbooru',
 10: 'Drawr',
 11: 'Nijie',
 12: 'Yande.re',
 16: 'FAKKU',
 18: 'H-Misc (nhentai)',
 19: '2D-Market',
 20: 'MediBang',
 21: 'Anime',
 22: 'H-Anime',
 23: 'Movies',
 24: 'Shows',
 25: 'Gelbooru',
 26: 'Konachan',
 27: 'Sankaku Channel',
 28: 'Anime-Pictures',
 29: 'e621',
 30: 'Idol Complex',
 31: 'BCY Illust',
 32: 'BCY Cosplay',
 33: 'PortalGraphics',
 34: 'deviantArt',
 35: 'Pawoo',
 36: 'Madokami',
 37: 'MangaDex',
 38: 'H-Misc (e-hentai)',
 39: 'ArtStation',
 40: 'FurAffinity',
 41: 'Twitter',
 42: 'Furry Network',
 43: 'Kemono',
 44: 'Skeb',
}

const siteNameMap: Record<string, string> = {
  'pixiv.net': 'Pixiv',
  'twitter.com': 'Twitter',
  'danbooru.donmai.us': 'Danbooru',
  'gelbooru.com': 'Gelbooru',
  'yande.re': 'Yande.re',
  'konachan.com': 'Konachan',
  'mangadex.org': 'MangaDex',
  'anidb.net': 'AniDB',
  'myanimelist.net': 'MyAnimeList',
  'anilist.co': 'Anilist',
  'e-hentai.org': 'E-Hentai',
  'nhentai.net': 'nhentai',
  'artstation.com': 'ArtStation',
  'deviantart.com': 'DeviantArt',
  'furaffinity.net': 'FurAffinity',
}

export class SauceNAO extends Searcher<SauceNAOConfig.Config> {
  public readonly name: SearchEngineName = 'saucenao'
  private keyIndex = 0

  constructor(ctx: Context, mainConfig: Config, subConfig: SauceNAOConfig.Config) {
    super(ctx, mainConfig, subConfig)
  }

  // 主搜索方法：轮换 API Key，调用 SauceNAO 并返回解析结果
  async search(options: SearchOptions): Promise<Searcher.Result[]> {
    const apiKeys = this.subConfig.apiKeys
    if (!apiKeys || apiKeys.length === 0) {
      logger.warn('[saucenao] 未配置任何 API Key')
      return []
    }

    let lastError: Error | null = null

    for (let i = 0; i < apiKeys.length; i++) {
      const currentKeyIndex = (this.keyIndex + i) % apiKeys.length
      const apiKey = apiKeys[currentKeyIndex]

      try {
        const startTime = Date.now()
        if (this.mainConfig.debug.enabled) {
          logger.info(`[saucenao] 尝试使用第 ${currentKeyIndex + 1} 个 Key`)
        }

        // 构建 multipart/form-data 请求
        const form = new FormData()
        form.append('output_type', '2')
        form.append('api_key', apiKey)
        const safeBuffer = Buffer.from(options.imageBuffer)
        form.append('file', new Blob([safeBuffer]), options.fileName)

        const url = 'https://saucenao.com/search.php'
        if (this.mainConfig.debug.enabled) logger.info(`[saucenao] 发送请求到 ${url}，图片大小: ${options.imageBuffer.length} 字节`)

        const data = await this.ctx.http.post(url, form, { timeout: this.mainConfig.requestTimeout * 1000 })

        // 请求成功时记录调试信息
        if (this.mainConfig.debug.enabled) {
          const duration = Date.now() - startTime
          logger.info(`[saucenao] 收到响应 (${duration}ms)，解析到 ${data.results?.length ?? 0} 个结果`)
        }

        if (this.mainConfig.debug.logApiResponses.includes(this.name)) {
          logger.info(`[saucenao] 收到响应: ${JSON.stringify(data, null, 2)}`)
        }

        if (!data?.header) throw new Error('响应格式不正确，缺少 header')
        if (data.header.status > 0) throw new Error(`API 返回错误: ${data.header.message || '未知服务器端错误'}`)

        // 处理可重试的服务端错误
        if (data.header.status < 0) {
          const message = data.header.message || ''
          const retryableErrors = ['Search Rate Too High', 'Daily Search Limit Exceeded', 'Invalid API key', 'does not permit API usage']
          if (retryableErrors.some((e) => message.includes(e))) {
            logger.warn(`[saucenao] 第 ${currentKeyIndex + 1} 个 Key 失败: ${message}，尝试下一个`)
            lastError = new Error(message)
            continue
          }
          throw new Error(`API 返回错误: ${message || '未知客户端错误'}`)
        }

        // 成功后更新 keyIndex 为下一个
        this.keyIndex = (currentKeyIndex + 1) % apiKeys.length

        if (!data.results) return []
        return this._parseResults(data.results)

      } catch (error) {
        lastError = error as Error
        // HTTP / 网络层的可重试错误判断
        const response = (error as any)?.response
        const responseMessage = response?.data?.header?.message || ''
        const retryableHttpErrors = ['does not permit API usage', 'Invalid API key', 'Daily Search Limit Exceeded']

        if (retryableHttpErrors.some((e) => responseMessage.includes(e))) {
          logger.warn(`[saucenao] 第 ${currentKeyIndex + 1} 个 Key 失败 (HTTP ${response?.status}): ${responseMessage}，尝试下一个`)
          continue
        }

        logger.warn(`[saucenao] 请求出错，将中止此引擎的搜索: ${(error as Error).message}`)
        if (this.mainConfig.debug.enabled && response) {
          logger.debug(`[saucenao] 响应状态: ${response.status}`, `响应数据: ${JSON.stringify(response.data)}`)
        }

        // 发生不可重试错误时，也要轮换 Key，避免下次卡在坏 Key 上
        this.keyIndex = (currentKeyIndex + 1) % apiKeys.length
        throw error
      }
    }

    // 循环结束，说明所有 Key 都试过了
    // 轮换到下一个，虽然都失败了
    this.keyIndex = (this.keyIndex + 1) % apiKeys.length
    throw new Error(`所有 SauceNAO API Key 均尝试失败。最后错误: ${lastError?.message || '未知错误'}`)
  }

  // 解析 SauceNAO 返回的原始结果为 Searcher.Result 列表
  private _parseResults(apiResults: any[]): Searcher.Result[] {
    return apiResults
      .filter((res) => res?.header?.similarity && res?.data?.ext_urls?.length > 0)
      .map((res) => this._formatSingleResult(res))
  }

  // 格式化单条 SauceNAO 结果
  private _formatSingleResult(res: any): Searcher.Result {
    const { header, data } = res
    const details: string[] = []

    const sourceEngine = saucenaoIndexMap[header.index_id] || header.index_name.split(' - ')[0]

    if (data.material) details.push(`作品: ${data.material}`)
    if (data.characters) details.push(`角色: ${data.characters}`)
    if (data.company) details.push(`公司: ${data.company}`)
    if (data.part) details.push(`集数: ${data.part}`)
    if (data.year) details.push(`年份: ${data.year}`)
    if (data.est_time) details.push(`时间: ${data.est_time}`)

    details.push(...this._formatExtraUrls(data.ext_urls, data.source))

    return {
      thumbnail: header.thumbnail,
      similarity: parseFloat(header.similarity),
      url: data.ext_urls[0],
      source: `[${sourceEngine}] ${data.title || data.material || '未知作品'}`,
      author: data.member_name || (Array.isArray(data.creator) ? data.creator.join(', ') : data.creator) || '未知作者',
      details,
    }
  }

  // 格式化额外链接为可读字符串列表
  private _formatExtraUrls(ext_urls: string[], sourceUrl: string): string[] {
    return [...new Set([sourceUrl, ...ext_urls].filter(Boolean))]
      .filter((url) => url !== ext_urls[0])
      .map((url) => {
        const domain = Object.keys(siteNameMap).find((d) => url.includes(d))
        const siteName = domain ? siteNameMap[domain] : '其他来源'
        return `${siteName}: ${url}`
      })
  }
}
// --- END OF FILE src/searchers/saucenao.ts ---
