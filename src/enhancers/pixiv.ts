// --- START OF FILE src/enhancers/pixiv.ts ---
import { Context, Logger, h } from 'koishi'
import { Pixiv as PixivConfig, Enhancer, EnhancedResult, Searcher, DebugConfig } from '../config'
import { getImageTypeFromUrl } from '../utils'

const logger = new Logger('sauce-aggregator')

interface PixivIllust {
  id: number;
  title: string;
  user: {
    id: number;
    name: string;
    account: string;
  };
  tags: { name: string; translated_name?: string }[];
  create_date: string;
  width: number;
  height: number;
  x_restrict: number; // 0 for all ages, 1 for R-18, 2 for R-18G
  meta_single_page: {
    original_image_url?: string;
  };
  meta_pages: {
    image_urls: {
      original: string;
      large: string;
      medium: string;
    };
  }[];
}

class PixivApiService {
  private accessToken: string | null = null;
  private readonly headers: Record<string, string>;
  
  constructor(private ctx: Context, private config: PixivConfig.Config, private debugConfig: DebugConfig, private requestTimeout: number) {
    this.headers = {
      'app-os': 'ios',
      'app-os-version': '14.6',
      'user-agent': 'PixivIOSApp/7.13.3 (iOS 14.6; iPhone13,2)',
      'Referer': 'https://www.pixiv.net/',
    };
  }

  private async _refreshAccessToken(): Promise<boolean> {
    const data = new URLSearchParams({
      'grant_type': 'refresh_token',
      'client_id': this.config.clientId,
      'client_secret': this.config.clientSecret,
      'refresh_token': this.config.refreshToken,
      'get_secure_url': 'true',
    }).toString();
    try {
      const response = await this.ctx.http.post('https://oauth.secure.pixiv.net/auth/token', data, {
        headers: { ...this.headers, 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: this.requestTimeout,
      });
      if (response.access_token) {
        this.accessToken = response.access_token;
        if (this.debugConfig.enabled) logger.info('[pixiv] AccessToken 刷新成功。');
        return true;
      }
      return false;
    } catch (error) {
      this.accessToken = null;
      logger.error('[pixiv] 刷新 AccessToken 失败:', error.response?.data || error.message);
      return false;
    }
  }

  private async _request(url: string, params: Record<string, any>) {
    if (!this.accessToken) {
      if (!await this._refreshAccessToken()) {
        throw new Error('无法获取或刷新 Pixiv Access Token。');
      }
    }
    const makeRequest = () => this.ctx.http.get(url, {
      params,
      headers: { ...this.headers, 'Authorization': `Bearer ${this.accessToken}` },
      timeout: this.requestTimeout,
    });
    try {
      return await makeRequest();
    } catch (error) {
      const errorMsg = error.response?.data?.error?.message || '';
      if (error.response?.status === 400 && /invalid_grant|invalid_token/i.test(errorMsg)) {
        if (this.debugConfig.enabled) logger.info('[pixiv] AccessToken 已失效，尝试强制刷新...');
        if (await this._refreshAccessToken()) {
          return await makeRequest();
        }
      }
      throw error;
    }
  }
  
  public async getArtworkDetail(pid: string): Promise<PixivIllust | null> {
    try {
      const response = await this._request(`https://app-api.pixiv.net/v1/illust/detail`, { illust_id: pid, filter: 'for_ios' });
      return response.illust;
    } catch (error) {
      if (this.debugConfig.enabled) logger.warn(`[pixiv] 获取插画详情失败 (PID: ${pid}):`, error.response?.data || error.message);
      return null;
    }
  }

  public async downloadImage(url: string): Promise<Buffer | null> {
    try {
      const arrayBuffer = await this.ctx.http.get(url, {
        headers: { 'Referer': 'https://www.pixiv.net/' },
        responseType: 'arraybuffer',
        timeout: this.requestTimeout,
      });
      return Buffer.from(arrayBuffer);
    } catch (error) {
      logger.warn(`[pixiv] 图片下载失败 (URL: ${url}):`, error.message);
      return null;
    }
  }
}

export class PixivEnhancer implements Enhancer<PixivConfig.Config> {
  public readonly name: 'pixiv' = 'pixiv';
  private api: PixivApiService;
  
  constructor(public ctx: Context, public config: PixivConfig.Config, public debugConfig: DebugConfig, requestTimeout: number) {
      this.api = new PixivApiService(ctx, config, debugConfig, requestTimeout * 1000);
  }

  public async enhance(result: Searcher.Result): Promise<EnhancedResult | null> {
    const pixivUrl = this.findPixivUrl(result);
    if (!pixivUrl) return null;

    const postId = this.parsePostId(pixivUrl);
    if (!postId) return null;

    if (this.debugConfig.enabled) logger.info(`[pixiv] 检测到 Pixiv 链接 (来自 ${pixivUrl})，帖子 ID: ${postId}，开始获取图源信息...`);
    
    try {
      const illust = await this.api.getArtworkDetail(postId);
      if (!illust) {
        if (this.debugConfig.enabled) logger.warn(`[pixiv] API 未能找到 ID 为 ${postId} 的帖子。`);
        return null;
      }

      if (this.debugConfig.logApiResponses.includes(this.name)) {
        logger.info(`[pixiv] API 响应: ${JSON.stringify(illust, null, 2)}`);
      }

      const isR18 = illust.x_restrict > 0;
      if (isR18 && !this.config.allowR18) {
        if (this.debugConfig.enabled) logger.info(`[pixiv] 帖子 ${postId} 是 R-18 内容，但配置不允许发送，已跳过。`);
        return { details: [h.text(`[!] Pixiv 图源的评级为 R-18，根据设置已隐藏详情。`)] };
      }
      
      const details = this.buildDetailNodes(illust);
      
      let downloadUrl: string;
      // *** THIS IS THE FIX ***
      // Handle multi-page and single-page illusts separately to ensure type safety.
      if (illust.meta_pages && illust.meta_pages.length > 0) {
        const image_urls = illust.meta_pages[0].image_urls;
        switch(this.config.postQuality) {
            case 'original': downloadUrl = image_urls.original; break;
            case 'large': downloadUrl = image_urls.large; break;
            case 'medium': downloadUrl = image_urls.medium; break;
            default: downloadUrl = image_urls.large; break; // Default to large for multi-page
        }
      } else {
        // For single page, all qualities point to the same original URL.
        downloadUrl = illust.meta_single_page.original_image_url;
      }
      
      if (!downloadUrl) {
        if (this.debugConfig.enabled) logger.warn(`[pixiv] 帖子 ${postId} 缺少任何可用的图片 URL。`);
        return { details };
      }

      if (this.debugConfig.enabled) logger.info(`[pixiv] 正在下载图源图片 (${this.config.postQuality} 质量)... URL: ${downloadUrl}`);
      const imageBuffer = await this.api.downloadImage(downloadUrl);
      const imageType = getImageTypeFromUrl(downloadUrl);

      return { details, imageBuffer, imageType };
    } catch (error) {
      logger.error(`[pixiv] 获取图源信息 (ID: ${postId}) 时发生错误:`, error);
      return null;
    }
  }

  private findPixivUrl(result: Searcher.Result): string | null {
    const urlRegex = /(https?:\/\/(?:(?:www\.)?pixiv\.net\/(?:en\/)?artworks\/\d+|i\.pximg\.net\/[^\s"]+))/;
    
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
    let match = url.match(/artworks\/(\d+)/);
    if (match) return match[1];

    match = url.match(/\/(\d+)(?:_p\d+)?(?:\.\w+)?$/);
    if (match) return match[1];

    return null;
  }

  private buildDetailNodes(illust: PixivIllust): h[] {
    const info: string[] = [];
    info.push(`Pixiv (ID: ${illust.id})`);
    info.push(`标题: ${illust.title}`);
    info.push(`作者: ${illust.user.name} (@${illust.user.account})`);
    info.push(`尺寸: ${illust.width}x${illust.height}`);
    
    const postDate = new Date(illust.create_date).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    info.push(`发布于: ${postDate}`);

    if (illust.x_restrict > 0) {
      info.push(`等级: R-18${illust.x_restrict === 2 ? 'G' : ''}`);
    }
    
    const tags = illust.tags.map(t => t.translated_name || t.name).filter(Boolean);
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
// --- END OF FILE src/enhancers/pixiv.ts ---