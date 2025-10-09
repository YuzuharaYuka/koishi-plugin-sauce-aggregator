// --- START OF FILE src/searchers/tracemoe.ts ---

import { Context, Logger } from 'koishi'
import { Config, Searcher, SearchOptions, TraceMoe as TraceMoeConfig, SearchEngineName } from '../config'
const logger = new Logger('sauce-aggregator')

export class TraceMoe extends Searcher<TraceMoeConfig.Config> {
  public readonly name: SearchEngineName = 'tracemoe';
  
  // [FIX] 遵循正确的构造函数模式
  constructor(ctx: Context, mainConfig: Config, subConfig: TraceMoeConfig.Config) {
    super(ctx, mainConfig, subConfig);
  }

  async search(options: SearchOptions): Promise<Searcher.Result[]> {
    const form = new FormData()
    const safeBuffer = Buffer.from(options.imageBuffer);
    form.append('image', new Blob([safeBuffer]), options.fileName)
    
    const url = 'https://api.trace.moe/search?cutBorders&anilistInfo'
    if (this.mainConfig.debug.enabled) logger.info(`[tracemoe] 发送请求到 ${url}，图片大小: ${options.imageBuffer.length} 字节`)
    
    try {
      const data = await this.ctx.http.post(url, form, { timeout: this.mainConfig.requestTimeout * 1000 })
      
      if (this.mainConfig.debug.logApiResponses.includes(this.name)) {
        logger.info(`[tracemoe] 收到响应: ${JSON.stringify(data, null, 2)}`)
      }

      if (data.error) throw new Error(`API 返回错误: ${data.error}`)
      if (!data.result || data.result.length === 0) return []

      const uniqueResults = [];
      const seen = new Set<string>();
      for (const res of data.result) {
        if (!res.anilist) continue;
        const uniqueKey = `${res.anilist.id}-${res.episode}`;
        if (!seen.has(uniqueKey)) {
          seen.add(uniqueKey);
          uniqueResults.push(res);
        }
      }

      return this._parseResults(uniqueResults.slice(0, options.maxResults));

    } catch (error) {
      logger.warn(`[tracemoe] 请求出错: ${error.message}`)
      if (this.mainConfig.debug.enabled && error.response) {
        logger.debug(`[tracemoe] 响应状态: ${error.response.status}`, `响应数据: ${JSON.stringify(error.response.data)}`);
      }
      throw error
    }
  }
  
  private _parseResults(results: any[]): Searcher.Result[] {
    return results.map(res => this._formatSingleResult(res));
  }

  private _formatSingleResult(res: any): Searcher.Result {
    const { anilist, episode, from, similarity, image, video } = res;
    const { title, status, isAdult, synonyms, startDate, season, format, episodes, genres, studios, externalLinks, idMal, siteUrl, coverImage } = anilist;

    const details: string[] = [];
    if (episode) details.push(`集数: ${episode}`);
    if (title.chinese && title.romaji && title.chinese !== title.romaji) details.push(`罗马音: ${title.romaji}`);
    if (title.english) details.push(`英文: ${title.english}`);
    if (isAdult) details.push(`分级: R18+`);
    if (synonyms?.length > 0) details.push(`别名: ${synonyms.join(', ')}`);

    const year = startDate?.year;
    const seasonText = season ? season.charAt(0) + season.slice(1).toLowerCase() : null;
    const formatText = format?.replace('_', ' ');
    const statusText = status ? status.charAt(0) + status.slice(1).toLowerCase() : null;
    const animeInfo = [year, seasonText, formatText, episodes ? `${episodes} 集` : null, statusText].filter(Boolean).join(' · ');
    if (animeInfo) details.push(`信息: ${animeInfo}`);
    if (genres?.length > 0) details.push(`类型: ${genres.join(', ')}`);
    
    const mainStudio = studios?.edges?.find(e => e.isMain)?.node.name;
    const officialSite = externalLinks?.find(l => l.site === 'Official Site')?.url;
    if (officialSite) details.push(`官网: ${officialSite}`);
    if (idMal) details.push(`MyAnimeList: https://myanimelist.net/anime/${idMal}`);
    if (siteUrl) details.push(`Anilist: ${siteUrl}`);

    return {
      thumbnail: image,
      similarity: similarity * 100,
      url: video,
      source: title.chinese || title.romaji || title.english || '未知动漫',
      author: mainStudio || '未知工作室',
      time: this._formatTime(from),
      details,
      coverImage: coverImage?.large || coverImage?.medium,
    };
  }

  private _formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  }
}