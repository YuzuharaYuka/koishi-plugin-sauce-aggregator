// --- START OF FILE src/enhancers/gelbooru.ts ---
import { Context, Logger, h } from 'koishi'
import { Config, Gelbooru as GelbooruConfig, Enhancer, EnhancedResult, Searcher } from '../config'
import { USER_AGENT, getImageTypeFromUrl, downloadWithRetry } from '../utils'

const logger = new Logger('sauce-aggregator')
const GELBOORU_URL_REGEX = /https?:\/\/gelbooru\.com\/index\.php\?[^"\s]*/;

const RATING_MAP: Record<string, number> = {
  'g': 1, 'general': 1,
  's': 2, 'sensitive': 2,
  'q': 3, 'questionable': 3,
  'e': 4, 'explicit': 4,
}

interface GelbooruPost {
  id: number
  owner: string
  created_at: string
  source: string
  rating: 'general' | 'sensitive' | 'questionable' | 'explicit' | 'g' | 's' | 'q' | 'e'
  width: number
  height: number
  tags: string
  score: number
  file_url: string
  sample_url: string
  preview_url: string
}

interface GelbooruResponse {
    post?: GelbooruPost[]
    "@attributes"?: {
        limit: number;
        offset: number;
        count: number;
    }
}

export class GelbooruEnhancer extends Enhancer<GelbooruConfig.Config> {
  public readonly name: 'gelbooru' = 'gelbooru';

  constructor(ctx: Context, mainConfig: Config, subConfig: GelbooruConfig.Config) {
    super(ctx, mainConfig, subConfig);
  }

  public async enhance(result: Searcher.Result): Promise<EnhancedResult | null> {
    const gelbooruUrl = this.findGelbooruUrl(result);
    if (!gelbooruUrl) return null;

    let postId: string | null = null;
    let postMd5: string | null = null;

    try {
      const urlObj = new URL(gelbooruUrl);
      postId = urlObj.searchParams.get('id');
      postMd5 = urlObj.searchParams.get('md5');
    } catch (e) {
      if (this.mainConfig.debug.enabled) logger.warn(`[gelbooru] URL 解析失败: ${gelbooruUrl}`);
      return null;
    }

    if (!postId && !postMd5) {
      if (this.mainConfig.debug.enabled) logger.info(`[gelbooru] 在链接 ${gelbooruUrl} 中未找到有效的 id 或 md5 参数。`);
      return null;
    }

    const logIdentifier = postId ? `ID: ${postId}` : `MD5: ${postMd5}`;
    if (this.mainConfig.debug.enabled) logger.info(`[gelbooru] 检测到 Gelbooru 链接 (${logIdentifier})，开始获取图源信息...`);

    try {
      const keyPairs = this.subConfig.keyPairs || [];
      const keyPair = keyPairs.length > 0 ? keyPairs[Math.floor(Math.random() * keyPairs.length)] : null;

      const apiParams: Record<string, any> = {
            page: 'dapi', s: 'post', q: 'index', json: '1',
            id: postId,
            tags: postId ? undefined : `md5:${postMd5}`,
      };
      if (keyPair?.apiKey && keyPair?.userId) {
          apiParams.api_key = keyPair.apiKey;
          apiParams.user_id = keyPair.userId;
      }

      const response = await this.ctx.http.get<GelbooruResponse>('https://gelbooru.com/index.php', {
        headers: { 'User-Agent': USER_AGENT },
        params: apiParams,
        timeout: this.mainConfig.requestTimeout * 1000,
      });

      if (this.mainConfig.debug.logApiResponses.includes(this.name)) {
        logger.info(`[gelbooru] API 响应: ${JSON.stringify(response, null, 2)}`);
      }

      const post = response?.post?.[0];

      if (!post || !post.id) {
        if (this.mainConfig.debug.enabled) logger.warn(`[gelbooru] API 未能找到帖子 (${logIdentifier})。`);
        return null;
      }

      const postRatingLevel = RATING_MAP[post.rating] || 3; // Default to questionable if unknown
      const maxAllowedLevel = RATING_MAP[this.subConfig.maxRating] || 2;

      if (postRatingLevel > maxAllowedLevel) {
        if (this.mainConfig.debug.enabled) logger.info(`[gelbooru] 帖子 ${post.id} 的评级 '${post.rating}' 超出设置 '${this.subConfig.maxRating}'，已跳过。`);
        return { details: [h.text(`[!] Gelbooru 图源的评级 (${post.rating}) 超出设置，已隐藏详情。`)] };
      }

      const details = this.buildDetailNodes(post);

      let downloadUrl: string;
      switch(this.subConfig.postQuality) {
        case 'original': downloadUrl = post.file_url; break;
        case 'sample': downloadUrl = post.sample_url; break;
        case 'preview': downloadUrl = post.preview_url; break;
        default: downloadUrl = post.sample_url; break;
      }

      if (!downloadUrl) {
         if (this.mainConfig.debug.enabled) logger.warn(`[gelbooru] 帖子 ${post.id} 缺少 ${this.subConfig.postQuality} 质量的图片URL，将尝试使用 sample_url。`);
         downloadUrl = post.sample_url;
      }
       if (!downloadUrl) {
         if (this.mainConfig.debug.enabled) logger.warn(`[gelbooru] 帖子 ${post.id} 缺少任何可用的图片URL。`);
        return { details };
      }

      if (this.mainConfig.debug.enabled) logger.info(`[gelbooru] 正在下载图源图片 (${this.subConfig.postQuality} 质量)... URL: ${downloadUrl}`);

      const imageBuffer = await downloadWithRetry(this.ctx, downloadUrl, {
          retries: this.mainConfig.enhancerRetryCount,
          timeout: this.mainConfig.requestTimeout * 1000,
      });
      const imageType = getImageTypeFromUrl(downloadUrl);

      return { details, imageBuffer, imageType };
    } catch (error) {
      logger.error(`[gelbooru] 获取图源信息 (${logIdentifier}) 时发生错误:`, error.message);
      return null;
    }
  }

  private findGelbooruUrl(result: Searcher.Result): string | null {
    if (result.url && GELBOORU_URL_REGEX.test(result.url)) return result.url;
    if (result.details) {
      for (const detail of result.details) {
        const match = String(detail).match(GELBOORU_URL_REGEX);
        if (match) return match[0];
      }
    }
    return null;
  }

  private buildDetailNodes(post: GelbooruPost): h[] {
    const info: string[] = [];
    info.push(`Gelbooru (ID: ${post.id})`);
    info.push(`尺寸: ${post.width}x${post.height}`);
    info.push(`评分: ${post.score}`);
    info.push(`等级: ${post.rating}`);
    info.push(`上传者: ${post.owner.replace(/_/g, ' ')}`);

    const postDate = new Date(post.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    info.push(`发布于: ${postDate}`);

    if (post.source && post.source.startsWith('http')) {
      info.push(`原始来源: ${post.source}`);
    }

    const tags = post.tags.split(' ').map(tag => tag.replace(/_/g, ' ')).filter(Boolean);
    const ignoredTags = ['highres', 'absurdres', 'translated', 'commentary_request', 'check_my_note'];
    const filteredTags = tags.filter(t => !ignoredTags.includes(t));

    const displayedTags = filteredTags.slice(0, 15).join(', ');
    const remainingCount = filteredTags.length - 15;

    let tagsText = `标签: ${displayedTags}`;
    if (remainingCount > 0) {
      tagsText += `... (及其他 ${remainingCount} 个)`;
    }
    info.push(tagsText);

    return [h.text(info.join('\n'))];
  }
}
