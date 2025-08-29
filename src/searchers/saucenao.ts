// --- START OF FILE searchers/saucenao.ts ---

import { Context, Logger } from 'koishi'
import { Searcher, SearchOptions, SauceNAO as SauceNAOConfig } from '../config'
import FormData from 'form-data'
const logger = new Logger('sauce-aggregator')

// Based on the official Index Details file provided by the user.
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


export class SauceNAO implements Searcher<SauceNAOConfig.Config> {
  name = 'saucenao'
  private keyIndex = 0
  
  constructor(public ctx: Context, public config: SauceNAOConfig.Config, public debug: boolean) {}

  async search(options: SearchOptions): Promise<Searcher.Result[]> {
    const apiKeys = this.config.apiKeys;
    if (!apiKeys || apiKeys.length === 0) {
      logger.warn('[saucenao] 未配置任何 API Key。');
      return [];
    }
    
    const currentApiKey = apiKeys[this.keyIndex];
    if (this.debug) {
      logger.info(`[saucenao] 使用 API Key 列表中的第 ${this.keyIndex + 1} 个 Key。`);
    }
    this.keyIndex = (this.keyIndex + 1) % apiKeys.length;

    const form = new FormData()
    form.append('output_type', 2)
    form.append('api_key', currentApiKey)
    form.append('file', options.imageBuffer, options.fileName)

    const url = 'https://saucenao.com/search.php'
    if (this.debug) logger.info(`[saucenao] 发送请求到 ${url}，图片大小: ${options.imageBuffer.length} 字节`)

    try {
      // **FIXED**: 回退到使用 getBuffer() 和 getHeaders() 的工作方式
      const data = await this.ctx.http.post(url, form.getBuffer(), { headers: form.getHeaders() })
      
      if (this.debug) logger.info(`[saucenao] 收到响应: ${JSON.stringify(data, null, 2)}`)
      
      if (!data?.header) {
          logger.warn('[saucenao] 响应格式不正确，缺少 header。')
          return []
      }
      if (data.header.status !== 0) {
          logger.warn(`[saucenao] API 返回错误状态: ${data.header.status}。消息: ${data.header.message || '未知错误'}`)
          return []
      }
      
      if (!data.results) return []
      return data.results
        .filter(res => res?.header?.similarity && res?.data?.ext_urls?.length > 0)
        .map(res => {
          const { header, data } = res;
          const ext_urls = data.ext_urls;
          const details: string[] = [];

          // Use the new map to get a clean engine name
          const sourceEngine = saucenaoIndexMap[header.index_id] || header.index_name.split(' - ')[0];

          // Add metadata from the 'data' object
          if (data.material) details.push(`作品: ${data.material}`);
          if (data.characters) details.push(`角色: ${data.characters}`);
          if (data.company) details.push(`公司: ${data.company}`);
          if (data.part) details.push(`集数: ${data.part}`);
          if (data.year) details.push(`年份: ${data.year}`);
          if (data.est_time) details.push(`时间: ${data.est_time}`);
        
          // Create a unique list of all URLs from both data.source and data.ext_urls
          const allUrls = [...new Set([data.source, ...ext_urls].filter(Boolean))];
          
          allUrls.forEach(url => {
            // The main URL is already returned in the 'url' field, so we just add the others as details.
            if (url === ext_urls[0]) return;
            
            let siteName = '其他来源';
            if (url.includes('pixiv.net')) siteName = 'Pixiv';
            else if (url.includes('twitter.com')) siteName = 'Twitter';
            else if (url.includes('danbooru.donmai.us')) siteName = 'Danbooru';
            else if (url.includes('gelbooru.com')) siteName = 'Gelbooru';
            else if (url.includes('yande.re')) siteName = 'Yande.re';
            else if (url.includes('konachan.com')) siteName = 'Konachan';
            else if (url.includes('mangadex.org')) siteName = 'MangaDex';
            else if (url.includes('anidb.net')) siteName = 'AniDB';
            else if (url.includes('myanimelist.net')) siteName = 'MyAnimeList';
            else if (url.includes('anilist.co')) siteName = 'Anilist';
            else if (url.includes('e-hentai.org')) siteName = 'E-Hentai';
            else if (url.includes('nhentai.net')) siteName = 'nhentai';
            else if (url.includes('artstation.com')) siteName = 'ArtStation';
            else if (url.includes('deviantart.com')) siteName = 'DeviantArt';
            else if (url.includes('furaffinity.net')) siteName = 'FurAffinity';

            details.push(`${siteName}: ${url}`);
          });

          return {
            thumbnail: header.thumbnail,
            similarity: parseFloat(header.similarity),
            url: ext_urls[0],
            source: `[${sourceEngine}] ${data.title || data.material || '未知作品'}`,
            author: data.member_name || (Array.isArray(data.creator) ? data.creator.join(', ') : data.creator) || '未知作者',
            details,
          }
        })
    } catch (error) {
        logger.warn(`[saucenao] 请求出错: ${error.message}`)
        if (this.debug && error.response) {
            logger.debug(`[saucenao] 响应状态: ${error.response.status}`)
            logger.debug(`[saucenao] 响应数据: ${JSON.stringify(error.response.data)}`)
        }
        throw error
    }
  }
}