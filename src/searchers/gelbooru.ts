// --- START OF FILE searchers/gelbooru.ts ---

import { Context, Logger, h } from 'koishi'
import { Gelbooru as GelbooruConfig, Enhancer, EnhancedResult, Searcher } from '../config'

const logger = new Logger('sauce-aggregator')

// ... (接口定义不变)
interface GelbooruPost {
  id: number
  owner: string
  created_at: string
  source: string
  rating: 'general' | 'sensitive' | 'questionable' | 'explicit'
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


export class GelbooruEnhancer implements Enhancer<GelbooruConfig.Config> {
  // **MODIFICATION START**: 显式声明 name 的字面量类型
  public readonly name: 'gelbooru' = 'gelbooru';
  // **MODIFICATION END**
  
  constructor(public ctx: Context, public config: GelbooruConfig.Config, public debug: boolean) {}

  public async enhance(result: Searcher.Result): Promise<EnhancedResult | null> {
    const gelbooruUrl = this.findGelbooruUrl(result);
    if (!gelbooruUrl) return null;

    const postId = this.parseParam(gelbooruUrl, 'id');
    const postMd5 = this.parseParam(gelbooruUrl, 'md5');

    if (!postId && !postMd5) {
      if (this.debug) logger.info(`[gelbooru] 在链接 ${gelbooruUrl} 中未找到有效的 id 或 md5 参数。`);
      return null;
    }
    
    const logIdentifier = postId ? `ID: ${postId}` : `MD5: ${postMd5}`;
    if (this.debug) logger.info(`[gelbooru] 检测到 Gelbooru 链接，${logIdentifier}，开始获取图源信息...`);

    try {
      const keyPair = this.config.keyPairs[Math.floor(Math.random() * this.config.keyPairs.length)];
      const apiUrl = 'https://gelbooru.com/index.php';
      
      const apiParams: Record<string, any> = {
            page: 'dapi', s: 'post', q: 'index', json: '1',
            api_key: keyPair.apiKey, user_id: keyPair.userId
      };

      if (postId) {
        apiParams.id = postId;
      } else {
        apiParams.tags = `md5:${postMd5}`;
      }
      
      const response = await this.ctx.http.get<GelbooruResponse>(apiUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
        },
        params: apiParams,
      });
      
      if (this.debug) {
        logger.info(`[gelbooru] API 响应: ${JSON.stringify(response, null, 2)}`);
      }
      
      const post = response?.post?.[0];

      if (!post || !post.id) {
        if (this.debug) logger.warn(`[gelbooru] API 未能找到帖子 (${logIdentifier})。`);
        return null;
      }
      
      const ratingHierarchy = { general: 1, sensitive: 2, questionable: 3, explicit: 4 };
      const postRatingLevel = ratingHierarchy[post.rating];
      const maxAllowedLevel = ratingHierarchy[this.config.maxRating];

      if (postRatingLevel > maxAllowedLevel) {
        if (this.debug) logger.info(`[gelbooru] 帖子 ${post.id} 的评级 '${post.rating}' 超出设置 '${this.config.maxRating}'，已跳过。`);
        return { details: [h.text(`[!] Gelbooru 图源的评级 (${post.rating}) 超出设置，已隐藏详情。`)] };
      }

      const details = this.buildDetailNodes(post);

      let downloadUrl: string;
      switch(this.config.postQuality) {
        case 'original': downloadUrl = post.file_url; break;
        case 'sample': downloadUrl = post.sample_url; break;
        case 'preview': downloadUrl = post.preview_url; break;
        default: downloadUrl = post.sample_url; break;
      }
      
      if (!downloadUrl) {
         if (this.debug) logger.warn(`[gelbooru] 帖子 ${post.id} 缺少 ${this.config.postQuality} 质量的图片URL，将尝试使用 sample_url。`);
         downloadUrl = post.sample_url;
      }
       if (!downloadUrl) {
         if (this.debug) logger.warn(`[gelbooru] 帖子 ${post.id} 缺少任何可用的图片URL。`);
        return { details };
      }

      if (this.debug) logger.info(`[gelbooru] 正在下载图源图片 (${this.config.postQuality} 质量)... URL: ${downloadUrl}`);

      const imageBuffer = Buffer.from(await this.ctx.http.get(downloadUrl, { responseType: 'arraybuffer' }));
      const imageType = this.getImageType(downloadUrl);

      return { details, imageBuffer, imageType };
    } catch (error) {
      logger.error(`[gelbooru] 获取图源信息 (${logIdentifier}) 时发生错误:`, error);
      return null;
    }
  }

  private findGelbooruUrl(result: Searcher.Result): string | null {
    const urlRegex = /(https?:\/\/gelbooru\.com\/index\.php\?[^"\s]*(id=\d+|md5=[a-f0-f0-9]{32}))/;
    if (result.url && urlRegex.test(result.url)) return result.url;
    if (result.details) {
      for (const detail of result.details) {
        const match = detail.match(urlRegex);
        if (match) return match[0];
      }
    }
    return null;
  }

  private parseParam(url: string, param: string): string | null {
    const match = url.match(new RegExp(`[?&]${param}=([^&]*)`));
    return match ? match[1] : null;
  }

  private getImageType(url: string): string {
    const ext = url.split('.').pop()?.toLowerCase();
    if (ext === 'png') return 'image/png';
    if (ext === 'gif') return 'image/gif';
    return 'image/jpeg';
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
    
    const tags = post.tags.split(' ').filter(Boolean);
    const displayedTags = tags.slice(0, 15).join(', ');
    const remainingCount = tags.length - 15;
    
    let tagsText = `标签: ${displayedTags}`;
    if (remainingCount > 0) {
      tagsText += `... (及其他 ${remainingCount} 个)`;
    }
    info.push(tagsText);

    return [h.text(info.join('\n'))];
  }
}