// --- START OF FILE src/enhancers/danbooru.ts ---
import { Context, Logger, h } from 'koishi'
import { Danbooru as DanbooruConfig, Enhancer, EnhancedResult, Searcher, DebugConfig } from '../config'
import type { PuppeteerManager } from '../puppeteer'
import { getImageTypeFromUrl } from '../utils'

const logger = new Logger('sauce-aggregator')

interface DanbooruPost {
  id: number;
  created_at: string;
  uploader_id: number;
  score: number;
  source: string;
  md5: string;
  rating: 'g' | 's' | 'q' | 'e';
  image_width: number;
  image_height: number;
  tag_string: string;
  tag_string_general: string;
  tag_string_artist: string;
  tag_string_character: string;
  tag_string_copyright: string;
  file_ext: string;
  file_size: number;
  fav_count: number;
  file_url: string;
  large_file_url: string;
  preview_file_url: string;
  success?: false;
  message?: string;
}

export class DanbooruEnhancer implements Enhancer<DanbooruConfig.Config> {
  public readonly name: 'danbooru' = 'danbooru';
  private puppeteer: PuppeteerManager;
  
  constructor(public ctx: Context, public config: DanbooruConfig.Config, public debugConfig: DebugConfig, puppeteerManager: PuppeteerManager) {
    this.puppeteer = puppeteerManager;
  }

  public async enhance(result: Searcher.Result): Promise<EnhancedResult | null> {
    const danbooruUrl = this.findDanbooruUrl(result);
    if (!danbooruUrl) return null;

    const postId = this.parsePostId(danbooruUrl);
    if (!postId) {
      if (this.debugConfig.enabled) logger.info(`[danbooru] 在链接 ${danbooruUrl} 中未找到有效的帖子 ID。`);
      return null;
    }
    
    const page = await this.puppeteer.getPage();
    
    try {
      let post: DanbooruPost;
      let imageBuffer: Buffer;
      
      const keyPair = this.config.keyPairs[Math.floor(Math.random() * this.config.keyPairs.length)];
      const apiBaseUrl = `https://danbooru.donmai.us/posts/${postId}.json`;
      const apiUrl = `${apiBaseUrl}?login=${keyPair.username}&api_key=${keyPair.apiKey}`;

      if (this.debugConfig.enabled) logger.info(`[danbooru] [Stealth] 正在通过页面内 fetch 获取 API: ${apiBaseUrl}`);
      
      await page.goto('https://danbooru.donmai.us/posts', { waitUntil: 'domcontentloaded' });
      
      const jsonContent = await page.evaluate(url => 
        fetch(url).then(res => {
          if (!res.ok) throw new Error(`API Request failed with status ${res.status}`);
          return res.text();
        }), 
      apiUrl);

      post = JSON.parse(jsonContent) as DanbooruPost;

      if (this.debugConfig.logApiResponses.includes(this.name)) {
        logger.info(`[danbooru] API 响应: ${JSON.stringify(post, null, 2)}`);
      }
      
      if (post.success === false) throw new Error(`API returned an error: ${post.message || 'Authentication failed'}`);
      if (!post.id) throw new Error(`API did not return a valid post object.`);

      let downloadUrl: string;
      switch(this.config.postQuality) {
        case 'original': downloadUrl = post.file_url; break;
        case 'sample': downloadUrl = post.large_file_url; break;
        case 'preview': downloadUrl = post.preview_file_url; break;
        default: downloadUrl = post.large_file_url; break;
      }

      if (downloadUrl) {
        if (this.debugConfig.enabled) logger.info(`[danbooru] [Stealth] 正在通过页面内 fetch 下载图源图片: ${downloadUrl}`);
        
        // --- THIS IS THE FIX ---
        // Use page.evaluate to fetch the image and return it as a Base64 string.
        // This avoids Puppeteer's internal buffer limitations for large files.
        const imageBase64 = await page.evaluate(async (url) => {
          const response = await fetch(url, { mode: 'cors' }); // Add mode: 'cors' for safety
          if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
          }
          const buffer = await response.arrayBuffer();
          // A robust way to convert ArrayBuffer to Base64
          let binary = '';
          const bytes = new Uint8Array(buffer);
          const len = bytes.byteLength;
          for (let i = 0; i < len; i++) {
              binary += String.fromCharCode(bytes[i]);
          }
          return btoa(binary);
        }, downloadUrl);

        if (!imageBase64) {
          throw new Error('Failed to download image or convert to Base64 in browser context.');
        }
        
        imageBuffer = Buffer.from(imageBase64, 'base64');
        if (this.debugConfig.enabled) logger.info(`[danbooru] [Stealth] 图片下载并转换成功，大小: ${imageBuffer.length} 字节。`);
      }
      
      const ratingMap = { g: 'general', s: 'sensitive', q: 'questionable', e: 'explicit' };
      const ratingHierarchy = { general: 1, sensitive: 2, questionable: 3, explicit: 4 };
      const postRating = ratingMap[post.rating] as keyof typeof ratingHierarchy;
      const postRatingLevel = ratingHierarchy[postRating];
      const maxAllowedLevel = ratingHierarchy[this.config.maxRating];

      if (postRatingLevel > maxAllowedLevel) {
        if (this.debugConfig.enabled) logger.info(`[danbooru] 帖子 ${post.id} 的评级 '${postRating}' 超出设置 '${this.config.maxRating}'，已跳过。`);
        return { details: [h.text(`[!] Danbooru 图源的评级 (${postRating}) 超出设置，已隐藏详情。`)] };
      }

      const details = this.buildDetailNodes(post);
      const imageType = getImageTypeFromUrl(post.file_url);

      return { details, imageBuffer, imageType };
      
    } catch (error) {
      logger.error(`[danbooru] [Stealth] 处理过程中发生错误 (ID: ${postId}):`, error);
      if (this.debugConfig.enabled) {
          await this.puppeteer.saveErrorSnapshot(page, this.name);
      }
      throw error;
    } finally {
      if (page && !page.isClosed()) await page.close();
    }
  }
  
  private findDanbooruUrl(result: Searcher.Result): string | null {
    const urlRegex = /(https?:\/\/danbooru\.donmai\.us\/(posts|post\/show)\/\d+)/;
    if (result.url && urlRegex.test(result.url)) return result.url;
    if (result.details) {
      for (const detail of result.details) {
        const match = detail.match(urlRegex);
        if (match) return match[0];
      }
    }
    return null;
  }

  private parsePostId(url: string): string | null {
    const match = url.match(/(\d+)/g);
    return match ? match[match.length - 1] : null;
  }
  
  private buildDetailNodes(post: DanbooruPost): h[] {
    const info: string[] = [];
    const formatTags = (tagString: string) => tagString.split(' ').map(tag => tag.replace(/_/g, ' ')).filter(Boolean).join(', ');

    info.push(`Danbooru (ID: ${post.id})`);

    const artists = formatTags(post.tag_string_artist);
    if (artists) info.push(`作者: ${artists}`);

    const copyrights = formatTags(post.tag_string_copyright);
    if (copyrights) info.push(`作品: ${copyrights}`);

    const characters = formatTags(post.tag_string_character);
    if (characters) info.push(`角色: ${characters}`);

    info.push(`评分: ${post.score} (收藏: ${post.fav_count})`);
    info.push(`等级: ${post.rating.toUpperCase()}`);
    
    const postDate = new Date(post.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    info.push(`发布于: ${postDate}`);

    const fileSizeMB = (post.file_size / 1024 / 1024).toFixed(2);
    info.push(`文件信息: ${post.image_width}x${post.image_height} (${fileSizeMB} MB, ${post.file_ext})`);
    
    if (post.source && post.source.startsWith('http')) {
      info.push(`原始来源: ${post.source}`);
    }
    
    const allTags = post.tag_string_general.split(' ').map(tag => tag.replace(/_/g, ' ')).filter(Boolean);
    const displayedTags = allTags.slice(0, 25).join(', ');
    const remainingCount = allTags.length - 25;
    
    let tagsText = `标签: ${displayedTags}`;
    if (remainingCount > 0) {
      tagsText += `... (及其他 ${remainingCount} 个)`;
    }
    info.push(tagsText);

    return [h.text(info.join('\n'))];
  }
}
// --- END OF FILE src/enhancers/danbooru.ts ---