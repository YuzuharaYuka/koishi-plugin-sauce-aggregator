import { Context, Logger, h } from 'koishi'
import { Config, Danbooru as DanbooruConfig, Enhancer, EnhancedResult, Searcher } from '../config'
import { getImageTypeFromUrl, buildDanbooruUserAgent } from '../utils'
import { fetchJsonWithProxy, fetchWithProxy, readResponseBody, HttpError, HttpTimeoutError } from '../core/http'

const logger = new Logger('sauce-aggregator')

// Danbooru 的 Cloudflare 校验只看 User-Agent 中是否声明了用户 ID（`user #<ID>`），
// 不需要模拟 TLS 指纹；因此这里直接用 undici fetch + 独立代理即可。
// 已实测：带声明 UA 的普通请求返回 200，浏览器 UA / 无 UA 均返回 403 挑战页。

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

  constructor(ctx: Context, mainConfig: Config, subConfig: DanbooruConfig.Config) {
    super(ctx, mainConfig, subConfig);
  }

  /** 独立代理：留空表示直连 */
  private get proxyUrl(): string | undefined {
    const proxy = this.mainConfig.proxy?.trim();
    return proxy || undefined;
  }

  /**
   * 构造请求头。
   *
   * Danbooru 要求 API 客户端的 User-Agent 中声明用户 ID（`user #<ID>`），
   * 否则会被 Cloudflare 判定为爬虫并返回 403 挑战页（`Just a moment...`）。
   * 用户只需填写 ID，其余部分由插件拼接，版本号取自 package.json。
   */
  private buildHeaders(): Record<string, string> {
    return {
      'user-agent': buildDanbooruUserAgent(this.resolveUserId()),
      accept: 'application/json',
    };
  }

  /** 取用户 ID：优先后台填写的 `userAgentId`，留空则回退到凭据中的用户名 */
  private resolveUserId(): string {
    const configured = this.subConfig.userAgentId?.trim();
    if (configured) return configured.replace(/^#/, '');
    return this.subConfig.keyPairs?.[0]?.username?.trim() || '';
  }

  /** 组装查询参数，有凭据时附带认证信息 */
  private buildSearchParams(extra: Record<string, string> = {}): URLSearchParams {
    const params = new URLSearchParams(extra);
    const keyPair = this.subConfig.keyPairs?.[0];
    if (keyPair?.username && keyPair.apiKey) {
      params.set('login', keyPair.username);
      params.set('api_key', keyPair.apiKey);
    }
    return params;
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

            // 部分受限帖子的文件直链需要携带凭据，这里与 API 请求保持一致
            const params = this.buildSearchParams();
            const query = params.toString();
            const signedUrl = query ? `${downloadUrl}${downloadUrl.includes('?') ? '&' : '?'}${query}` : downloadUrl;

            try {
                const response = await fetchWithProxy(signedUrl, {
                    proxyUrl: this.proxyUrl,
                    headers: {
                        'user-agent': buildDanbooruUserAgent(this.resolveUserId()),
                        accept: 'image/*,*/*;q=0.8',
                    },
                    timeout: this.mainConfig.requestTimeout * 1000,
                    retries: this.mainConfig.enhancerRetryCount,
                });
                imageBuffer = await readResponseBody(response, 30_000);
            } catch (error) {
                // 图片下载失败不影响详情展示
                logger.warn(`[danbooru] 图源图片下载失败: ${this.describeRequestError(error)}`);
            }
        }

        const imageType = getImageTypeFromUrl(post.file_url);
        return { details, imageBuffer, imageType };

    } catch (error: any) {
      // makeApiRequest 已给出可操作的错误描述，这里只做记录与包装
      const errorMessage = error?.message || '未知错误';

      logger.error(`[danbooru] 处理过程中发生错误 (ID: ${postId}):`, errorMessage);

      if (this.mainConfig.debug.enabled && error instanceof HttpError) {
          logger.info(`[danbooru] 详细错误响应:
  - Status: ${error.status}
  - Body: ${error.body.slice(0, 1000)}`);
      }
      throw new Error(`[danbooru] 处理失败: ${errorMessage}`);
    }
  }

  private async makeApiRequest(postId: string): Promise<DanbooruPost> {
    const onlyFields = [
        'id', 'created_at', 'score', 'source', 'rating', 'image_width',
        'image_height', 'tag_string', 'tag_string_general', 'tag_string_artist',
        'tag_string_character', 'tag_string_copyright', 'tag_string_meta',
        'file_ext', 'file_size', 'fav_count', 'file_url', 'large_file_url',
        'preview_file_url',
    ].join(',');

    const params = this.buildSearchParams({ only: onlyFields });
    const hasAuth = params.has('login');
    const url = `https://danbooru.donmai.us/posts/${postId}.json?${params.toString()}`;

    if (this.mainConfig.debug.enabled) {
        const safeUrl = url.replace(/api_key=[^&]+/, 'api_key=***');
        logger.info(`[danbooru] 发起 API 请求:
  - Method: GET
  - URL: ${safeUrl}
  - Auth: ${hasAuth ? 'URL Params (API Key)' : 'None'}`);
    }

    let post: DanbooruPost;
    try {
        post = await fetchJsonWithProxy<DanbooruPost>(url, {
            proxyUrl: this.proxyUrl,
            headers: this.buildHeaders(),
            timeout: this.mainConfig.requestTimeout * 1000,
            retries: this.mainConfig.enhancerRetryCount,
            debug: this.mainConfig.debug.enabled
                ? (message) => logger.info(`[danbooru] ${message}`)
                : undefined,
        });
    } catch (error: any) {
        throw new Error(this.describeRequestError(error));
    }

    if (this.mainConfig.debug.logApiResponses.includes(this.name)) {
        logger.info(`[danbooru] API 响应: ${JSON.stringify(post, null, 2)}`);
    }

    if (post.success === false) throw new Error(`API 返回错误: ${post.message || '未知错误'}`);
    return post;
  }

  /**
   * 把请求错误翻译成可操作的提示。
   * 最常见的是 Cloudflare 挑战页（403 + HTML），根因是 User-Agent 不符合 Danbooru 的 API 要求。
   */
  private describeRequestError(error: any): string {
    const status = error instanceof HttpError ? error.status : undefined;
    const body = error instanceof HttpError ? error.body : '';
    const message = error?.message || '';

    const isCloudflareChallenge = /Just a moment|challenge-platform|cf-mitigated|_cf_chl_opt|Enable JavaScript and cookies|<!DOCTYPE html>/i.test(body)
        || /is not valid JSON/i.test(message);

    if (status === 403 && isCloudflareChallenge) {
        const hint = this.resolveUserId()
            ? '当前用户 ID 仍被拒绝，请确认 ID 有效，或更换代理出口 IP。'
            : '请在「Danbooru 图源设置」中填写用户 ID，或配置凭据中的用户名。';
        logger.warn(`[danbooru] 被 Cloudflare 拦截 (403 挑战页)。${hint}`);
        return '被 Cloudflare 拦截 (403)，需按 Danbooru 要求配置带 `user #<用户 ID>` 的 User-Agent。';
    }

    if (status === 401 || status === 403) {
        return `认证失败 (${status})，请检查 API Key / 用户名是否正确。`;
    }
    if (status === 404) {
        return '帖子不存在或已被删除 (404)。';
    }
    if (status === 429) {
        return '请求过于频繁 (429)，请稍后再试。';
    }
    if (error instanceof HttpTimeoutError || error?.name === 'TimeoutError' || /timeout/i.test(message)) {
        return `请求超时 (${this.mainConfig.requestTimeout} 秒)。`;
    }
    return message || `网络请求失败 (${error?.name || '未知错误'})。`;
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

    const metaTags = formatTags(post.tag_string_meta || '');
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

