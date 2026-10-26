import { Context, Logger } from 'koishi'
import { Config, Searcher, SearchOptions, TraceMoe as TraceMoeConfig, SearchEngineName } from '../config'
import { errorMessage } from '../utils'

// TraceMoe 搜索器：调用 API 并格式化返回结果
const logger = new Logger('sauce-aggregator')

export class TraceMoe extends Searcher<TraceMoeConfig.Config> {
  public readonly name: SearchEngineName = 'tracemoe'

  constructor(ctx: Context, mainConfig: Config, subConfig: TraceMoeConfig.Config) {
    super(ctx, mainConfig, subConfig)
  }

  // 主搜索方法：构建 multipart 请求并调用 TraceMoe API
  async search(options: SearchOptions): Promise<Searcher.Result[]> {
    // 构建 multipart/form-data 请求体
    const form = new FormData()
    const safeBuffer = Buffer.from(options.imageBuffer)
    form.append('image', new Blob([safeBuffer]), options.fileName)

    const url = 'https://api.trace.moe/search?cutBorders&anilistInfo'
    if (this.mainConfig.debug.enabled) logger.info(`[tracemoe] 发送请求到 ${url}，图片大小: ${options.imageBuffer.length} 字节`)

    try {
      const startTime = Date.now()
      const data = await this.ctx.http.post(url, form, { timeout: this.mainConfig.requestTimeout * 1000 })

      // 请求成功后记录基础调试信息
      if (this.mainConfig.debug.enabled) {
        const duration = Date.now() - startTime
        logger.info(`[tracemoe] 收到响应 (${duration}ms)，解析到 ${data.result?.length ?? 0} 个结果。`)
      }

      if (this.mainConfig.debug.logApiResponses.includes(this.name)) {
        logger.info(`[tracemoe] 收到响应: ${JSON.stringify(data, null, 2)}`)
      }

      if (data.error) throw new Error(`API 返回错误: ${data.error}`)
      if (!data.result || data.result.length === 0) return []

      // 去重：以 anilist id + episode 作为唯一键
      const uniqueResults: any[] = []
      const seen = new Set<string>()
      for (const res of data.result) {
        if (!res.anilist) continue
        const uniqueKey = `${res.anilist.id}-${res.episode}`
        if (!seen.has(uniqueKey)) {
          seen.add(uniqueKey)
          uniqueResults.push(res)
        }
      }

      return this._parseResults(uniqueResults.slice(0, options.resultLimit))

    } catch (error) {
      // 捕获并记录错误，尽量提供调试信息
      logger.warn(`[tracemoe] 请求出错: ${errorMessage(error)}`)
      if (this.mainConfig.debug.enabled && (error as any).response) {
        logger.debug(`[tracemoe] 响应状态: ${(error as any).response.status}`, `响应数据: ${JSON.stringify((error as any).response.data)}`)
      }
      throw error
    }
  }

  // 将原始 API 结果转换为 Searcher.Result 列表
  private _parseResults(results: any[]): Searcher.Result[] {
    return results.map((res) => this._formatSingleResult(res))
  }

  // 格式化单条结果为 Searcher.Result
  private _formatSingleResult(res: any): Searcher.Result {
    const { anilist, episode, from, similarity, image, video } = res
    const { title, status, isAdult, synonyms, startDate, season, format, episodes, genres, studios, externalLinks, idMal, siteUrl, coverImage } = anilist

    const details: string[] = []
    if (episode) details.push(`集数: ${episode}`)
    if (title.chinese && title.romaji && title.chinese !== title.romaji) details.push(`罗马音: ${title.romaji}`)
    if (title.english) details.push(`英文: ${title.english}`)
    if (isAdult) details.push(`分级: R18+`)
    if (synonyms?.length > 0) details.push(`别名: ${synonyms.join(', ')}`)

    const year = startDate?.year
    const seasonText = season ? season.charAt(0) + season.slice(1).toLowerCase() : null
    const formatText = format?.replace('_', ' ')
    const statusText = status ? status.charAt(0) + status.slice(1).toLowerCase() : null
    const animeInfo = [year, seasonText, formatText, episodes ? `${episodes} 集` : null, statusText].filter(Boolean).join(' · ')
    if (animeInfo) details.push(`信息: ${animeInfo}`)
    if (genres?.length > 0) details.push(`类型: ${genres.join(', ')}`)

    const mainStudio = studios?.edges?.find((e: any) => e.isMain)?.node.name
    const officialSite = externalLinks?.find((l: any) => l.site === 'Official Site')?.url
    if (officialSite) details.push(`官网: ${officialSite}`)
    if (idMal) details.push(`MyAnimeList: https://myanimelist.net/anime/${idMal}`)
    if (siteUrl) details.push(`Anilist: ${siteUrl}`)

    return {
      thumbnail: image,
      similarity: similarity * 100,
      url: video,
      source: title.chinese || title.romaji || title.english || '未知动漫',
      author: mainStudio || '未知工作室',
      time: this._formatTime(from),
      details,
      coverImage: coverImage?.large || coverImage?.medium,
    }
  }

  // 将秒数格式化为 HH:MM:SS
  private _formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0')
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0')
    const s = Math.floor(seconds % 60).toString().padStart(2, '0')
    return `${h}:${m}:${s}`
  }
}
