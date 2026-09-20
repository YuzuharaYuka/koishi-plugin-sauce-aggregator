import { Context, Logger, h } from 'koishi'
import { Config, Danbooru as DanbooruConfig, Enhancer, EnhancedResult, Searcher } from '../config'
import { getImageTypeFromUrl, buildDanbooruUserAgent } from '../utils'
import type { GotScraping } from 'got-scraping'

const logger = new Logger('sauce-aggregator')

// 使用动态导入以避免 get-stream 版本兼容性问题
// 延迟加载 got-scraping，确保在任何模块系统下都能正常工作
let gotScrapingModule: { gotScraping: GotScraping } | null = null;
let gotScraping: GotScraping | null = null;

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
    };
  }

  /** 取用户 ID：优先后台填写的 `userAgentId`，留空则回退到凭据中的用户名 */
  private resolveUserId(): string {
    const configured = this.subConfig.userAgentId?.trim();
    if (configured) return configured.replace(/^#/, '');
    return this.subConfig.keyPairs?.[0]?.username?.trim() || '';
  }

  private async _getGotInstance(isCdn: boolean = false): Promise<GotScraping> {
    // 确保只导入一次，并处理可能的模块系统兼容性问题
    // 使用动态导入延迟加载，避免在模块加载时就触发 get-stream 的导入
    // 这样可以避免 get-stream 版本升级导致的模块系统兼容性问题
    if (!gotScraping) {
      try {
        // 使用动态导入（支持 ESM 和 CommonJS）
        gotScrapingModule = await import('got-scraping');
        gotScraping = gotScrapingModule.gotScraping;

        if (!gotScraping) {
          throw new Error('got-scraping 导入失败：未找到 gotScraping 导出');
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`[danbooru] 导入 got-scraping 失败: ${errorMessage}`);
        throw new Error(`无法导入 got-scraping，请检查依赖是否正确安装: ${errorMessage}`);
      }
    }

    // 留空表示直连：不能把空串交给 got-scraping，否则会抛出难以理解的内部错误
    const proxyUrl = this.mainConfig.proxy?.trim() || undefined;
    const headers = this.buildHeaders();

    if (!proxyUrl && this.mainConfig.debug.enabled) {
        logger.info('[danbooru] 未配置独立代理，将直连访问。');
    }

    // For CDN requests, we don't need the prefixUrl
    if (isCdn) {
        return gotScraping!.extend({
            timeout: { request: this.mainConfig.requestTimeout * 1000 },
            retry: { limit: this.mainConfig.enhancerRetryCount },
            ...(proxyUrl ? { proxyUrl } : {}),
            headers,
        });
    }

    if (this._gotInstance) return this._gotInstance;

    // 未声明用户 ID 时 Danbooru 会拦截请求，提前给出可操作的告警
    if (!this.resolveUserId()) {
        logger.warn(
            '[danbooru] 未配置用户 ID，User-Agent 缺少 `user #<ID>` 声明，请求很可能被 Cloudflare 拦截 (403)。' +
            '请在「Danbooru 图源设置」中填写用户 ID，或配置凭据中的用户名。'
        );
    }

    if (this.mainConfig.debug.enabled) {
        if (proxyUrl) logger.info(`[danbooru] got-scraping 将使用独立代理: ${proxyUrl}`);
        logger.info(`[danbooru] User-Agent: ${headers['user-agent']}`);
    }

    return this._gotInstance = gotScraping!.extend({
        prefixUrl: 'https://danbooru.donmai.us',
        timeout: { request: this.mainConfig.requestTimeout * 1000 },
        retry: { limit: this.mainConfig.enhancerRetryCount },
        ...(proxyUrl ? { proxyUrl } : {}),
        headers,
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
      // makeApiRequest 已给出可操作的错误描述，这里只做记录与包装
      const errorMessage = error.name === 'TimeoutError'
          ? `请求超时 (${this.mainConfig.requestTimeout}秒)`
          : (error.message || '未知错误');

      logger.error(`[danbooru] 处理过程中发生错误 (ID: ${postId}):`, errorMessage);

      if (
        this.mainConfig.debug.enabled &&
        error.response &&
        !/Just a moment|challenge-platform|_cf_chl_opt/i.test(String(error.response.body || ''))
      ) {
          logger.info(`[danbooru] 详细错误响应:
  - Status: ${error.response.statusCode}
  - Body: ${String(error.response.body).slice(0, 1000)}`);
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

    let post: DanbooruPost;
    try {
        post = await got.get(url, requestOptions).json<DanbooruPost>();
    } catch (error) {
        throw new Error(this.describeRequestError(error));
    }

    if (this.mainConfig.debug.logApiResponses.includes(this.name)) {
        logger.info(`[danbooru] API 响应: ${JSON.stringify(post, null, 2)}`);
    }

    if (post.success === false) throw new Error(`API 返回错误: ${post.message || '未知错误'}`);
    return post;
  }

  /**
   * 把 got 的错误翻译成可操作的提示。
   * 最常见的是 Cloudflare 挑战页（403 + HTML），根因是 User-Agent 不符合 Danbooru 的 API 要求。
   */
  private describeRequestError(error: any): string {
    const status = error?.response?.statusCode;
    const body = typeof error?.response?.body === 'string' ? error.response.body : '';

    // got 在响应不是 JSON 时会直接抛解析错误，结合响应体判断是否为 Cloudflare 挑战
    const isCloudflareChallenge = /Just a moment|challenge-platform|cf-mitigated|_cf_chl_opt|Enable JavaScript and cookies/i.test(body)
        || /<!DOCTYPE html>/i.test(body)
        || /is not valid JSON/i.test(error?.message || '');

    if (status === 403 && isCloudflareChallenge) {
        const hint = this.resolveUserId()
            ? '当前用户 ID 仍被拒绝，请确认 ID 有效，或更换代理出口 IP。'
            : '请在「Danbooru 图源设置」中填写用户 ID，或配置凭据中的用户名。';
        logger.warn(`[danbooru] 被 Cloudflare 拦截 (403 挑战页)。${hint}`);
        return '被 Cloudflare 拦截 (403)，需按 Danbooru 要求配置带 `user #<用户ID>` 的 User-Agent。';
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
    if (error?.name === 'TimeoutError' || /timeout/i.test(error?.message || '')) {
        return `请求超时 (${this.mainConfig.requestTimeout}秒)。`;
    }
    return error?.message || `网络请求失败 (${error?.name || '未知错误'})。`;
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

