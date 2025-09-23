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
  tag_string_meta?: string; // Add optional meta tag string
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
  private retries: number;
  
  constructor(public ctx: Context, public config: DanbooruConfig.Config, public debugConfig: DebugConfig, puppeteerManager: PuppeteerManager, enhancerRetryCount: number) {
    this.puppeteer = puppeteerManager;
    this.retries = enhancerRetryCount;
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
      const apiUrl = (keyPair && keyPair.username && keyPair.apiKey)
        ? `${apiBaseUrl}?login=${keyPair.username}&api_key=${keyPair.apiKey}` 
        : apiBaseUrl;

      if (this.debugConfig.enabled) logger.info(`[danbooru] [Stealth] 正在通过页面内 fetch 获取 API: ${apiBaseUrl}`);
      
      // Go to a neutral page first to establish context
      await page.goto('https://danbooru.donmai.us', { waitUntil: 'domcontentloaded' });
      
      const jsonContent = await page.evaluate(async (url) => {
        try {
            const res = await fetch(url);
            if (!res.ok) {
              if (res.headers.get('Content-Type')?.includes('text/html')) {
                  const text = await res.text();
                  if (/Verifying you are human|cdn-cgi\/challenge-platform/i.test(text)) {
                      return JSON.stringify({ isCloudflare: true });
                  }
              }
              throw new Error(`API Request failed with status ${res.status}`);
            }
            return await res.text();
        } catch (e) {
            throw new Error(`Fetch failed: ${e.message}`);
        }
      }, apiUrl);

      const responseData = JSON.parse(jsonContent);

      if (responseData.isCloudflare) {
          throw new Error('检测到 Cloudflare 人机验证页面。这通常由您的网络环境或代理 IP 引起。请尝试更换网络环境或暂时禁用此图源。');
      }
      
      post = responseData as DanbooruPost;

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
        
        const imageBase64 = await page.evaluate(async (url, retries) => {
            const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
            let lastError: Error = null;

            for (let i = 0; i <= retries; i++) {
                try {
                    const response = await fetch(url, { mode: 'cors' });
                    if (!response.ok) {
                        throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
                    }
                    const buffer = await response.arrayBuffer();
                    let binary = '';
                    const bytes = new Uint8Array(buffer);
                    const len = bytes.byteLength;
                    for (let j = 0; j < len; j++) {
                        binary += String.fromCharCode(bytes[j]);
                    }
                    return btoa(binary);
                } catch (error) {
                    lastError = error;
                    if (i < retries) {
                        console.log(`[Danbooru Downloader] Attempt ${i + 1} failed. Retrying in 2s...`);
                        await sleep(2000);
                    }
                }
            }
            throw new Error(`Failed to download after ${retries + 1} attempts. Last error: ${lastError.message}`);
        }, downloadUrl, this.retries);

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
      if (error.message.includes('Cloudflare')) {
        throw error;
      }
      logger.error(`[danbooru] [Stealth] 处理过程中发生错误 (ID: ${postId}):`, error);
      if (this.debugConfig.enabled && !(error.message.includes('Fetch failed'))) {
          await this.puppeteer.saveErrorSnapshot(page, this.name);
      }
      throw new Error(`[danbooru] 处理失败: ${error.message}`);
    } finally {
      if (page && !page.isClosed()) await page.close();
    }
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
    const match = url.match(/(\d+)/g);
    return match ? match[match.length - 1] : null;
  }
  
  private buildDetailNodes(post: DanbooruPost): h[] {
    const info: string[] = [];
    const formatTags = (tagString: string) => (tagString || '').split(' ').map(tag => tag.replace(/_/g, ' ')).filter(Boolean).join(', ');

    info.push(`Danbooru (ID: ${post.id})`);

    // Categorized tags
    const artists = formatTags(post.tag_string_artist);
    if (artists) info.push(`作者: ${artists}`);

    const copyrights = formatTags(post.tag_string_copyright);
    if (copyrights) info.push(`作品: ${copyrights}`);

    const characters = formatTags(post.tag_string_character);
    if (characters) info.push(`角色: ${characters}`);

    // Post metadata
    info.push(`评分: ${post.score} (收藏: ${post.fav_count})`);
    info.push(`等级: ${post.rating.toUpperCase()}`);
    
    if (post.created_at) {
        const postDate = new Date(post.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
        info.push(`发布于: ${postDate}`);
    }

    // File info
    if (post.file_size > 0) {
        const fileSizeMB = (post.file_size / 1024 / 1024).toFixed(2);
        info.push(`文件信息: ${post.image_width}x${post.image_height} (${fileSizeMB} MB, ${post.file_ext})`);
    } else {
        info.push(`文件信息: ${post.image_width}x${post.image_height} (${post.file_ext})`);
    }
    
    if (post.source && post.source.startsWith('http')) {
      info.push(`原始来源: ${post.source}`);
    }

    // --- NEW: Display Meta Tags ---
    const metaTags = formatTags(post.tag_string_meta);
    if (metaTags) info.push(`元标签: ${metaTags}`);
    
    // General tags
    const allTags = (post.tag_string_general || '').split(' ').map(tag => tag.replace(/_/g, ' ')).filter(Boolean);
    const MAX_GENERAL_TAGS = 35; // Increased limit
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