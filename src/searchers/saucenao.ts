// --- START OF FILE src/searchers/saucenao.ts ---

import { Context, Logger } from 'koishi'
import { Config, Searcher, SearchOptions, SauceNAO as SauceNAOConfig, SearchEngineName } from '../config'
const logger = new Logger('sauce-aggregator')

const saucenaoIndexMap: Record<number, string> = {
  0: 'H-Mags', 2: 'H-Game CG', 4: 'HCG', 5: 'Pixiv', 6: 'Pixiv Historical', 8: 'Nico Nico Seiga', 9: 'Danbooru', 10: 'Drawr', 11: 'Nijie', 12: 'Yande.re', 16: 'FAKKU', 18: 'H-Misc (nhentai)', 19: '2D-Market', 20: 'MediBang', 21: 'Anime', 22: 'H-Anime', 23: 'Movies', 24: 'Shows', 25: 'Gelbooru', 26: 'Konachan', 27: 'Sankaku Channel', 28: 'Anime-Pictures', 29: 'e621', 30: 'Idol Complex', 31: 'BCY Illust', 32: 'BCY Cosplay', 33: 'PortalGraphics', 34: 'deviantArt', 35: 'Pawoo', 36: 'Madokami', 37: 'MangaDex', 38: 'H-Misc (e-hentai)', 39: 'ArtStation', 40: 'FurAffinity', 41: 'Twitter', 42: 'Furry Network', 43: 'Kemono', 44: 'Skeb',
}

// [FIX] 修正：使用 'extends' 继承抽象基类，而不是 'implements'
export class SauceNAO extends Searcher<SauceNAOConfig.Config> {
  public readonly name: SearchEngineName = 'saucenao';
  private keyIndex = 0
  
  constructor(public ctx: Context, public mainConfig: Config, public subConfig: SauceNAOConfig.Config) {
    super(ctx, mainConfig, subConfig);
  }

  // 执行搜索，并处理 API Key 的轮换逻辑
  async search(options: SearchOptions): Promise<Searcher.Result[]> {
    const apiKeys = this.subConfig.apiKeys;
    if (!apiKeys || apiKeys.length === 0) {
      logger.warn('[saucenao] 未配置任何 API Key。');
      return [];
    }
    
    const keyQueue = [...apiKeys.slice(this.keyIndex), ...apiKeys.slice(0, this.keyIndex)];
    let keysTried = 0;
    
    for (const apiKey of keyQueue) {
        const currentKeyIndex = (this.keyIndex + keysTried) % apiKeys.length;
        keysTried++;
        
        try {
            if (this.mainConfig.debug.enabled) {
                logger.info(`[saucenao] 正在尝试使用第 ${currentKeyIndex + 1} 个 Key。`);
            }
            
            const form = new FormData()
            form.append('output_type', '2')
            form.append('api_key', apiKey)
            const safeBuffer = Buffer.from(options.imageBuffer);
            form.append('file', new Blob([safeBuffer]), options.fileName)

            const url = 'https://saucenao.com/search.php'
            if (this.mainConfig.debug.enabled) logger.info(`[saucenao] 发送请求到 ${url}，图片大小: ${options.imageBuffer.length} 字节`)

            const data = await this.ctx.http.post(url, form, { timeout: this.mainConfig.requestTimeout * 1000 });

            this.keyIndex = (this.keyIndex + keysTried) % apiKeys.length;
            
            if (this.mainConfig.debug.logApiResponses.includes(this.name)) {
                logger.info(`[saucenao] 收到响应: ${JSON.stringify(data, null, 2)}`);
            }
        
            if (!data?.header) throw new Error('响应格式不正确，缺少 header');
            if (data.header.status > 0) throw new Error(`API 返回错误: ${data.header.message || '未知服务器端错误'}`);

            if (data.header.status < 0) {
                const message = data.header.message || '';
                const retryableErrors = ['Search Rate Too High', 'Daily Search Limit Exceeded', 'Invalid API key', 'does not permit API usage'];
                if (retryableErrors.some(e => message.includes(e))) {
                    logger.warn(`[saucenao] 第 ${currentKeyIndex + 1} 个 Key 失败: ${message}。正在尝试下一个...`);
                    continue;
                }
                throw new Error(`API 返回错误: ${message || '未知客户端错误'}`);
            }
            
            if (!data.results) return [];
            return this._parseResults(data.results);

        } catch (error) {
            const responseMessage = error.response?.data?.header?.message || '';
            const retryableHttpErrors = ['does not permit API usage', 'Invalid API key', 'Daily Search Limit Exceeded'];
            
            if (retryableHttpErrors.some(e => responseMessage.includes(e))) {
                logger.warn(`[saucenao] 第 ${currentKeyIndex + 1} 个 Key 失败 (HTTP ${error.response?.status}): ${responseMessage}。正在尝试下一个...`);
                continue;
            }

            logger.warn(`[saucenao] 请求出错，将中止此引擎的搜索: ${error.message}`);
            if (this.mainConfig.debug.enabled && error.response) {
                logger.debug(`[saucenao] 响应状态: ${error.response.status}`, `响应数据: ${JSON.stringify(error.response.data)}`);
            }
            this.keyIndex = (this.keyIndex + keysTried) % apiKeys.length;
            throw error;
        }
    }
    
    this.keyIndex = (this.keyIndex + keysTried) % apiKeys.length;
    throw new Error('所有 SauceNAO API Key 均尝试失败。');
  }

  // 解析 SauceNAO API 的返回结果
  private _parseResults(apiResults: any[]): Searcher.Result[] {
    return apiResults
      .filter(res => res?.header?.similarity && res?.data?.ext_urls?.length > 0)
      .map(res => this._formatSingleResult(res));
  }

  // 格式化单个结果对象
  private _formatSingleResult(res: any): Searcher.Result {
    const { header, data } = res;
    const details: string[] = [];

    const sourceEngine = saucenaoIndexMap[header.index_id] || header.index_name.split(' - ')[0];

    if (data.material) details.push(`作品: ${data.material}`);
    if (data.characters) details.push(`角色: ${data.characters}`);
    if (data.company) details.push(`公司: ${data.company}`);
    if (data.part) details.push(`集数: ${data.part}`);
    if (data.year) details.push(`年份: ${data.year}`);
    if (data.est_time) details.push(`时间: ${data.est_time}`);
    
    details.push(...this._formatExtraUrls(data.ext_urls, data.source));
    
    return {
        thumbnail: header.thumbnail,
        similarity: parseFloat(header.similarity),
        url: data.ext_urls[0],
        source: `[${sourceEngine}] ${data.title || data.material || '未知作品'}`,
        author: data.member_name || (Array.isArray(data.creator) ? data.creator.join(', ') : data.creator) || '未知作者',
        details,
    };
  }
  
  // 格式化附加的来源链接
  private _formatExtraUrls(ext_urls: string[], sourceUrl: string): string[] {
    const siteNameMap = {
      'pixiv.net': 'Pixiv', 'twitter.com': 'Twitter', 'danbooru.donmai.us': 'Danbooru',
      'gelbooru.com': 'Gelbooru', 'yande.re': 'Yande.re', 'konachan.com': 'Konachan',
      'mangadex.org': 'MangaDex', 'anidb.net': 'AniDB', 'myanimelist.net': 'MyAnimeList',
      'anilist.co': 'Anilist', 'e-hentai.org': 'E-Hentai', 'nhentai.net': 'nhentai',
      'artstation.com': 'ArtStation', 'deviantart.com': 'DeviantArt', 'furaffinity.net': 'FurAffinity',
    };
    
    return [...new Set([sourceUrl, ...ext_urls].filter(Boolean))]
      .filter(url => url !== ext_urls[0])
      .map(url => {
        const domain = Object.keys(siteNameMap).find(d => url.includes(d));
        const siteName = domain ? siteNameMap[domain] : '其他来源';
        return `${siteName}: ${url}`;
      });
  }
}