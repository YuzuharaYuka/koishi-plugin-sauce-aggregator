import { Context, Logger, h } from 'koishi'
import { Config, Danbooru as DanbooruConfig, Enhancer, EnhancedResult, Searcher } from '../config'
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

// [FEAT] 封装浏览器环境内的 fetch 逻辑，增加健壮性
async function fetchInBrowser(page, url: string, type: 'json' | 'image', retries: number): Promise<any> {
    return page.evaluate(async (url, type, retries) => {
        const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        let lastError: Error | null = null;

        for (let i = 0; i <= retries; i++) {
            try {
                const res = await fetch(url, { mode: 'cors' });

                if (!res.ok) {
                    throw new Error(`请求失败，状态码: ${res.status}`);
                }

                // 统一的 Cloudflare 检测
                const contentType = res.headers.get('Content-Type') || '';
                if (contentType.includes('text/html')) {
                    const text = await res.text();
                    if (/Verifying you are human|cdn-cgi\/challenge-platform/i.test(text)) {
                        return { isCloudflare: true };
                    }
                    // 如果期望的是图片或JSON，但收到了HTML，则认为是错误
                    if (type === 'image' || type === 'json') {
                         throw new Error(`预期得到 ${type}，但收到了 HTML 页面。`);
                    }
                }
                
                if (type === 'json') {
                    return res.json();
                }

                if (type === 'image') {
                    if(!contentType.startsWith('image/')) {
                        throw new Error(`预期得到图片，但收到了 ${contentType} 类型。`);
                    }
                    const buffer = await res.arrayBuffer();
                    let binary = '';
                    const bytes = new Uint8Array(buffer);
                    for (let j = 0; j < bytes.byteLength; j++) {
                        binary += String.fromCharCode(bytes[j]);
                    }
                    return { base64: btoa(binary) };
                }

            } catch (error) {
                lastError = error;
                if (i < retries) {
                    // 在浏览器控制台打印日志，便于调试
                    console.log(`[sauce-aggregator/danbooru] 尝试 ${i + 1} 失败 (URL: ${url}): ${error.message}，2秒后重试...`);
                    await sleep(2000);
                }
            }
        }
        return { isError: true, message: `经过 ${retries + 1} 次尝试后失败。最后错误: ${lastError?.message}` };
    }, url, type, retries);
}


export class DanbooruEnhancer extends Enhancer<DanbooruConfig.Config> {
  public readonly name: 'danbooru' = 'danbooru';
  public readonly needsPuppeteer: boolean = true;
  private puppeteer: PuppeteerManager;
  
  constructor(ctx: Context, mainConfig: Config, subConfig: DanbooruConfig.Config, puppeteerManager: PuppeteerManager) {
    super(ctx, mainConfig, subConfig);
    this.puppeteer = puppeteerManager;
  }

  public async enhance(result: Searcher.Result): Promise<EnhancedResult | null> {
    const danbooruUrl = this.findDanbooruUrl(result);
    if (!danbooruUrl) return null;

    const postId = this.parsePostId(danbooruUrl);
    if (!postId) {
      if (this.mainConfig.debug.enabled) logger.info(`[danbooru] 在链接 ${danbooruUrl} 中未找到有效的帖子 ID。`);
      return null;
    }
    
    const page = await this.puppeteer.getPage();
    
    try {
      let post: DanbooruPost;
      let imageBuffer: Buffer;
      
      const keyPair = this.subConfig.keyPairs[Math.floor(Math.random() * this.subConfig.keyPairs.length)];
      const apiBaseUrl = `https://danbooru.donmai.us/posts/${postId}.json`;
      const apiUrl = (keyPair?.username && keyPair?.apiKey)
        ? `${apiBaseUrl}?login=${keyPair.username}&api_key=${keyPair.apiKey}` 
        : apiBaseUrl;

      if (this.mainConfig.debug.enabled) logger.info(`[danbooru] 正在通过页面内 fetch 获取 API: ${apiBaseUrl}`);
      
      await page.goto('https://danbooru.donmai.us', { waitUntil: 'domcontentloaded' });
      
      const apiPromise = fetchInBrowser(page, apiUrl, 'json', 0); // API 通常不应重试，以快速失败
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`页面内 API 请求超时 (${this.mainConfig.requestTimeout}秒)。`)), this.mainConfig.requestTimeout * 1000)
      );
      
      const responseData = await Promise.race([apiPromise, timeoutPromise]);

      if (responseData.isCloudflare) {
          throw new Error('检测到 Cloudflare 人机验证页面。这通常由您的网络环境或代理 IP 引起。请尝试更换网络环境或暂时禁用此图源。');
      }
      if (responseData.isError) {
        throw new Error(`页面内 Fetch 失败: ${responseData.message}`);
      }
      
      post = responseData as DanbooruPost;

      if (this.mainConfig.debug.logApiResponses.includes(this.name)) {
        logger.info(`[danbooru] API 响应: ${JSON.stringify(post, null, 2)}`);
      }
      
      if (post.success === false) throw new Error(`API 返回错误: ${post.message || '凭据验证失败'}`);
      if (!post.id) throw new Error(`API 未返回有效的帖子对象。`);

      let downloadUrl: string;
      switch(this.subConfig.postQuality) {
        case 'original': downloadUrl = post.file_url; break;
        case 'sample': downloadUrl = post.large_file_url; break;
        case 'preview': downloadUrl = post.preview_file_url; break;
        default: downloadUrl = post.large_file_url; break;
      }

      if (downloadUrl) {
        if (this.mainConfig.debug.enabled) logger.info(`[danbooru] 正在通过页面内 fetch 下载图源图片: ${downloadUrl}`);
        
        const imageResponse = await fetchInBrowser(page, downloadUrl, 'image', this.mainConfig.enhancerRetryCount);

        if (imageResponse.isCloudflare) {
            throw new Error('下载图片时检测到 Cloudflare 人机验证页面。');
        }
        if (imageResponse.isError) {
          throw new Error(`在浏览器上下文中下载图片失败: ${imageResponse.message}`);
        }
        
        imageBuffer = Buffer.from(imageResponse.base64, 'base64');
        if (this.mainConfig.debug.enabled) logger.info(`[danbooru] 图片下载并转换成功，大小: ${imageBuffer.length} 字节。`);
      }
      
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
      const imageType = getImageTypeFromUrl(post.file_url);

      return { details, imageBuffer, imageType };
      
    } catch (error) {
      logger.error(`[danbooru] 处理过程中发生错误 (ID: ${postId}):`, error.message);
      // 只有在非 Cloudflare 错误时才保存快照，避免无效截图
      if (this.mainConfig.debug.enabled && !error.message.includes('Cloudflare')) {
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