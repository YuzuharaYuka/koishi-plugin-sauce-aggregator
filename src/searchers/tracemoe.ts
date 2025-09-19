// --- START OF FILE src/searchers/tracemoe.ts ---

import { Context, Logger } from 'koishi'
import { Searcher, SearchOptions, TraceMoe as TraceMoeConfig, DebugConfig, SearchEngineName, Config } from '../config'
const logger = new Logger('sauce-aggregator')

export class TraceMoe implements Searcher<TraceMoeConfig.Config> {
  public readonly name: SearchEngineName = 'tracemoe';
  private timeout: number;
  
  constructor(public ctx: Context, public config: TraceMoeConfig.Config, public debugConfig: DebugConfig, requestTimeout: number) {
      this.timeout = requestTimeout * 1000;
  }

  async search(options: SearchOptions): Promise<Searcher.Result[]> {
    const form = new FormData()
    const safeBuffer = Buffer.from(options.imageBuffer);
    form.append('image', new Blob([safeBuffer]), options.fileName)
    
    const url = 'https://api.trace.moe/search?cutBorders&anilistInfo'
    
    if (this.debugConfig.enabled) logger.info(`[tracemoe] 发送请求到 ${url}，图片大小: ${options.imageBuffer.length} 字节`)
    
    try {
      const data = await this.ctx.http.post(url, form, { timeout: this.timeout })
      
      if (this.debugConfig.logApiResponses.includes(this.name)) {
        logger.info(`[tracemoe] 收到响应: ${JSON.stringify(data, null, 2)}`)
      }

      if (data.error) {
        throw new Error(`API 返回错误: ${data.error}`)
      }

      const { result } = data
      if (!result || result.length === 0) return []

      const uniqueResults = []
      const seen = new Set<string>()

      for (const res of result) {
        const uniqueKey = `${res.anilist?.id}-${res.episode}`
        if (!seen.has(uniqueKey)) {
          seen.add(uniqueKey)
          uniqueResults.push(res)
        }
      }

      return uniqueResults.slice(0, options.maxResults).map((res): Searcher.Result => {
        const { anilist, episode, from, similarity, image, video } = res
        const titles = anilist?.title || {}
        
        const details: string[] = []

        if (titles.chinese && titles.romaji && titles.chinese !== titles.romaji) details.push(`罗马音: ${titles.romaji}`)
        if (titles.english) details.push(`英文: ${titles.english}`)

        const status = anilist.status ? anilist.status.charAt(0) + anilist.status.slice(1).toLowerCase() : null
        if (anilist.isAdult) details.push(`分级: R18+`)
        if (anilist.synonyms?.length > 0) details.push(`别名: ${anilist.synonyms.join(', ')}`)

        const year = anilist.startDate?.year
        const season = anilist.season ? anilist.season.charAt(0) + anilist.season.slice(1).toLowerCase() : null
        const format = anilist.format?.replace('_', ' ')
        const episodes = anilist.episodes
        const animeInfo = [year, season, format, episodes ? `${episodes} 集` : null, status].filter(Boolean).join(' · ')
        if (animeInfo) details.push(`信息: ${animeInfo}`)

        if (anilist.genres?.length > 0) details.push(`类型: ${anilist.genres.join(', ')}`)
        const mainStudio = anilist.studios?.edges?.find(e => e.isMain)?.node.name
        if (mainStudio) details.push(`工作室: ${mainStudio}`)

        const officialSite = anilist.externalLinks?.find(l => l.site === 'Official Site')?.url
        if (officialSite) details.push(`官网: ${officialSite}`)
        if (anilist.idMal) details.push(`MyAnimeList: https://myanimelist.net/anime/${anilist.idMal}`)
        if (anilist.siteUrl) details.push(`Anilist: https://anilist.co/anime/${anilist.siteUrl}`)

        const formatTime = (seconds: number) => {
          const h = Math.floor(seconds / 3600).toString().padStart(2, '0')
          const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0')
          const s = Math.floor(seconds % 60).toString().padStart(2, '0')
          return `${h}:${m}:${s}`
        }

        return {
          thumbnail: image,
          similarity: similarity * 100,
          url: video,
          source: titles.chinese || titles.romaji || '未知动漫',
          author: `第 ${episode || 'N/A'} 集`,
          time: formatTime(from),
          details,
          coverImage: anilist.coverImage?.extraLarge || anilist.coverImage?.large,
        }
      })
    } catch (error) {
      logger.warn(`[tracemoe] 请求出错: ${error.message}`)
      if (this.debugConfig.enabled && error.response) {
        logger.debug(`[tracemoe] 响应状态: ${error.response.status}`)
        logger.debug(`[tracemoe] 响应数据: ${JSON.stringify(error.response.data)}`)
      }
      throw error
    }
  }
}
// --- END OF FILE src/searchers/tracemoe.ts ---