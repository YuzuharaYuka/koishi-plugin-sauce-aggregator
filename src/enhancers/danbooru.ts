import { Context, Logger, h } from 'koishi'
import { Config, Danbooru as DanbooruConfig, Enhancer, EnhancedResult, Searcher } from '../config'
import { getImageTypeFromUrl, USER_AGENT } from '../utils'
import type { GotScraping } from 'got-scraping'

const logger = new Logger('sauce-aggregator')

let gotScraping: GotScraping;

interface DanbooruPost {
  id: number;
  created_at: string;
  score: number;
  source: string;
  rating: 'g' | 's' | 'q' | 'e';
  image_width: number;
  image_height: number;
  tag_string: string;
  tag_string_general: string;
  tag_string_artist: string;
  tag_string_character: string;
  tag_string_copyright: string;
  tag_string_meta?: string;
  file_ext: string;
  file_size: number;
  fav_count: number;
  file_url: string;
  large_file_url: string;
  preview_file_url: string;
  success?: false;
  message?: string;
}

export class DanbooruEnhancer extends Enhancer<DanbooruConfig.Config> {
  public readonly name: 'danbooru' = 'danbooru';
  public readonly needsPuppeteer: boolean = false;
  
  private _gotInstance: GotScraping | null = null;

  constructor(ctx: Context, mainConfig: Config, subConfig: DanbooruConfig.Config) {
    super(ctx, mainConfig, subConfig);
  }

  private async _getGotInstance(isCdn: boolean = false): Promise<GotScraping> {
    // For CDN requests, we don't need the prefixUrl
    if (isCdn) {
        gotScraping ??= (await import('got-scraping')).gotScraping;
        const proxyUrl = this.mainConfig.proxy;
        return gotScraping.extend({
            timeout: { request: this.mainConfig.requestTimeout * 1000 },
            retry: { limit: this.mainConfig.enhancerRetryCount },
            proxyUrl: proxyUrl,
            headerGeneratorOptions: {
                browsers: [{ name: 'chrome', minVersion: 100 }],
                devices: ['desktop'],
                operatingSystems: ['windows'],
            },
        });
    }

    if (this._gotInstance) return this._gotInstance;
    
    gotScraping ??= (await import('got-scraping')).gotScraping;
    
    const proxyUrl = this.mainConfig.proxy;
    if (this.mainConfig.debug.enabled && proxyUrl) {
        logger.info(`[danbooru] got-scraping 将使用独立代理: ${proxyUrl}`);
    }

    return this._gotInstance = gotScraping.extend({
        prefixUrl: 'https://danbooru.donmai.us',
        timeout: { request: this.mainConfig.requestTimeout * 1000 },
        retry: { limit: this.mainConfig.enhancerRetryCount },
        proxyUrl: proxyUrl,
        headerGeneratorOptions: {
            browsers: [{ name: 'chrome', minVersion: 100 }],
            devices: ['desktop'],
            operatingSystems: ['windows'],
        },
    });
  }

  public async enhance(result: Searcher.Result): Promise<EnhancedResult | null> {
    const danbooruUrl = this.findDanbooruUrl(result);
    if (!danbooruUrl) return null;

    const postId = this.parsePostId(danbooruUrl);
    if (!postId) {
      if (this.mainConfig.debug.enabled) logger.info(`[danbooru] 在链接 ${danbooruUrl} 中未找到有效的帖子 ID。`);
      return null;
    }
    
    try {
        const post = await this.makeApiRequest(postId);

        const ratingMap = { g: 'general', s: 'sensitive', q: 'questionable', e: 'explicit' };
        const ratingHierarchy = { general: 1, sensitive: 2, questionable: 3, explicit: 4 };
        const postRating = ratingMap[post.rating] as keyof typeof ratingHierarchy;
        const postRatingLevel = ratingHierarchy[postRating];
        const maxAllowedLevel = ratingHierarchy[this.subConfig.maxRating];

        if (postRatingLevel > maxAllowedLevel) {
            if (this.mainConfig.debug.enabled) logger.info(`[danbooru] 帖子 ${post.id} 的评级 '${postRating}' 超出设置 '${this.subConfig.maxRating}'，已跳过。`);
            return { details: [h.text(`[!] Danbooru 图源的评级 (${postRating}) 超出设置，已隐藏详情。`)] };
        }

        const details = this.buildDetailNodes(post);

        let downloadUrl: string;
        switch(this.subConfig.postQuality) {
            case 'original': downloadUrl = post.file_url; break;
            case 'sample': downloadUrl = post.large_file_url; break;
            case 'preview': downloadUrl = post.preview_file_url; break;
            default: downloadUrl = post.large_file_url; break;
        }

        let imageBuffer: Buffer | undefined;
        if (downloadUrl) {
            if (this.mainConfig.debug.enabled) logger.info(`[danbooru] 正在下载图源图片: ${downloadUrl}`);
            
            const got = await this._getGotInstance(true);
            const keyPair = this.subConfig.keyPairs?.[0];
            const searchParams = (keyPair?.username && keyPair.apiKey) ? {
                login: keyPair.username,
                api_key: keyPair.apiKey,
            } : undefined;

            imageBuffer = await got(downloadUrl, { searchParams }).buffer();
        }
      
        const imageType = getImageTypeFromUrl(post.file_url);
        return { details, imageBuffer, imageType };
      
    } catch (error) {
      // [FIX] 精简错误日志，只保留核心信息
      const errorMessage = error.name === 'TimeoutError' 
          ? `请求超时 (${this.mainConfig.requestTimeout}秒)`
          : (error.message || '未知错误');

      logger.error(`[danbooru] 处理过程中发生错误 (ID: ${postId}):`, errorMessage);
      
      if (this.mainConfig.debug.enabled && error.response) {
          logger.info(`[danbooru] 详细错误响应:
  - Status: ${error.response.statusCode}
  - Body: ${error.response.body}`);
      }
      throw new Error(`[danbooru] 处理失败: ${errorMessage}`);
    }
  }
  
  private async makeApiRequest(postId: string): Promise<DanbooruPost> {
    const got = await this._getGotInstance();
    const keyPair = this.subConfig.keyPairs?.[0];
    const hasAuth = keyPair?.username && keyPair.apiKey;
    
    const onlyFields = [
        'id', 'created_at', 'score', 'source', 'rating', 'image_width',
        'image_height', 'tag_string', 'tag_string_general', 'tag_string_artist',
        'tag_string_character', 'tag_string_copyright', 'tag_string_meta',
        'file_ext', 'file_size', 'fav_count', 'file_url', 'large_file_url',
        'preview_file_url',
    ].join(',');

    const searchParams = { only: onlyFields } as Record<string, string>;
    let authMethod = 'None';

    if (hasAuth) {
        searchParams.login = keyPair.username;
        searchParams.api_key = keyPair.apiKey;
        authMethod = 'URL Params (API Key)';
    }

    const url = `posts/${postId}.json`;
    const requestOptions = { searchParams };

    if (this.mainConfig.debug.enabled) {
        const fullUrl = `${got.defaults.options.prefixUrl}/${url}?${new URLSearchParams(searchParams).toString()}`;
        logger.info(`[danbooru] 发起 API 请求:
  - Method: GET
  - URL: ${fullUrl}
  - Auth: ${authMethod}`);
    }

    const post = await got.get(url, requestOptions).json<DanbooruPost>();

    if (this.mainConfig.debug.logApiResponses.includes(this.name)) {
        logger.info(`[danbooru] API 响应: ${JSON.stringify(post, null, 2)}`);
    }

    if (post.success === false) throw new Error(`API 返回错误: ${post.message || '未知错误'}`);
    return post;
  }

  private findDanbooruUrl(result: Searcher.Result): string | null {
    const urlRegex = /(https?:\/\/danbooru\.donmai\.us\/(posts|post\/show)\/\d+)/;
    if (result.url && urlRegex.test(result.url)) return result.url;
    if (result.details) {
      for (const detail of result.details) {
        const match = String(detail).match(urlRegex);
        if (match) return match[0];
      }
    }
    return null;
  }

  private parsePostId(url: string): string | null {
    const match = url.match(/\/(\d+)(?:[?#]|$)/);
    return match ? match[1] : null;
  }
  
  private buildDetailNodes(post: DanbooruPost): h[] {
    const info: string[] = [];
    const formatTags = (tagString: string) => (tagString || '').split(' ').map(tag => tag.replace(/_/g, ' ')).filter(Boolean).join(', ');

    info.push(`Danbooru (ID: ${post.id})`);

    const artists = formatTags(post.tag_string_artist);
    if (artists) info.push(`作者: ${artists}`);

    const copyrights = formatTags(post.tag_string_copyright);
    if (copyrights) info.push(`作品: ${copyrights}`);

    const characters = formatTags(post.tag_string_character);
    if (characters) info.push(`角色: ${characters}`);

    info.push(`评分: ${post.score} (收藏: ${post.fav_count})`);
    info.push(`等级: ${post.rating.toUpperCase()}`);
    
    if (post.created_at) {
        const postDate = new Date(post.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
        info.push(`发布于: ${postDate}`);
    }

    if (post.file_size > 0) {
        const fileSizeMB = (post.file_size / 1024 / 1024).toFixed(2);
        info.push(`文件信息: ${post.image_width}x${post.image_height} (${fileSizeMB} MB, ${post.file_ext})`);
    } else {
        info.push(`文件信息: ${post.image_width}x${post.image_height} (${post.file_ext})`);
    }
    
    if (post.source && post.source.startsWith('http')) {
      info.push(`原始来源: ${post.source}`);
    }

    const metaTags = formatTags(post.tag_string_meta);
    if (metaTags) info.push(`元标签: ${metaTags}`);
    
    const allTags = (post.tag_string_general || '').split(' ').map(tag => tag.replace(/_/g, ' ')).filter(Boolean);
    const MAX_GENERAL_TAGS = 35;
    const displayedTags = allTags.slice(0, MAX_GENERAL_TAGS).join(', ');
    const remainingCount = allTags.length - MAX_GENERAL_TAGS;
    
    let tagsText = `标签: ${displayedTags}`;
    if (remainingCount > 0) {
      tagsText += `... (及其他 ${remainingCount} 个)`;
    }
    info.push(tagsText);

    return [h.text(info.join('\n'))];
  }
}