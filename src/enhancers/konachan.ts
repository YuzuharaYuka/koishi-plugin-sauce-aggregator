import { Context, Logger, h } from 'koishi'
import { Config, Konachan as KonachanConfig, Enhancer, EnhancedResult, Searcher } from '../config'
import { getImageTypeFromUrl } from '../utils'

const logger = new Logger('sauce-aggregator')
// 匹配两种 URL 格式：
// 1. 帖子页面: https://konachan.com/post/show/123456
// 2. 直接图片: https://konachan.com/image/{md5}/Konachan.com%20-%20{id}%20{tags}.{ext}
const KONACHAN_POST_URL_REGEX = /(https?:\/\/konachan\.(?:com|net)\/post\/show\/\d+)/;
const KONACHAN_IMAGE_URL_REGEX = /(https?:\/\/konachan\.(?:com|net)\/(?:image|data\/sample|jpeg)\/[a-f0-9]+\/Konachan\.(?:com|net)[^\/]*?[-_\s](\d+)[^\/]*?\.\w+)/i;

interface KonachanPost {
  id: number
  tags: string
  created_at: number
  updated_at: number
  creator_id: number
  author: string
  source: string
  score: number
  rating: 's' | 'q' | 'e'
  width: number
  height: number
  md5: string
  file_size: number
  file_url: string
  preview_url: string
  sample_url: string
  sample_width: number
  sample_height: number
  sample_file_size: number
  jpeg_url: string
  jpeg_width: number
  jpeg_height: number
  jpeg_file_size: number
  [key: string]: any
}

export class KonachanEnhancer extends Enhancer<KonachanConfig.Config> {
  public readonly name: 'konachan' = 'konachan';
  public readonly needsPuppeteer: boolean = false;

  constructor(ctx: Context, mainConfig: Config, subConfig: KonachanConfig.Config) {
    super(ctx, mainConfig, subConfig);
  }

  public async enhance(result: Searcher.Result): Promise<EnhancedResult | null> {
    // 检查是否启用链接解析
    if (!this.subConfig.enableLinkParsing) return null;

    const konachanUrl = this.findKonachanUrl(result);
    if (!konachanUrl) return null;

    const postId = this.parsePostId(konachanUrl)
    if (!postId) return null

    if (this.mainConfig.debug.enabled) logger.info(`[konachan] 检测到 Konachan 链接,帖子 ID: ${postId},开始获取图源信息...`)

    try {
      // 构建API URL - 使用 konachan.net (更稳定,SFW，支持匿名访问)
      const apiUrl = `https://konachan.net/post.json?tags=id:${postId}`

      // 使用 Koishi 内置的 ctx.http,避免触发人机验证
      const response = await this.ctx.http.get(apiUrl, {
        timeout: this.mainConfig.requestTimeout * 1000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Referer': `https://konachan.net/post/show/${postId}`,
        }
      }) as KonachanPost[];

      if (this.mainConfig.debug.logApiResponses.includes(this.name)) {
        logger.info(`[konachan] API 响应: ${JSON.stringify(response, null, 2)}`)
      }

      if (!response || response.length === 0) {
        if (this.mainConfig.debug.enabled) logger.warn(`[konachan] API 未能找到 ID 为 ${postId} 的帖子。`)
        return null
      }

      const post = response[0]

      const ratingHierarchy = { s: 1, q: 2, e: 3 };
      const postRatingLevel = ratingHierarchy[post.rating];
      const maxAllowedLevel = ratingHierarchy[this.subConfig.maxRating];

      if (postRatingLevel > maxAllowedLevel) {
        if (this.mainConfig.debug.enabled) logger.info(`[konachan] 帖子 ${postId} 的评级为 '${post.rating.toUpperCase()}'，超出配置允许的最高等级 '${this.subConfig.maxRating.toUpperCase()}'，已跳过。`);
        return { details: [h.text(`[!] Konachan 图源的评级 (${post.rating.toUpperCase()}) 超出设置，已隐藏详情。`)] };
      }

      const details: h[] = this.buildDetailNodes(post)

      // 根据配置选择图片质量
      // file_url: 原始文件 (可能是 PNG)
      // jpeg_url: JPEG 格式的全尺寸图 (与原图尺寸相同)
      // sample_url: 缩小的预览图 (通常宽度 1500px)
      let downloadUrl: string;
      switch (this.subConfig.postQuality) {
        case 'original':
          downloadUrl = post.file_url;
          break;
        case 'jpeg':
          // jpeg_url 是全尺寸的 JPEG 版本
          downloadUrl = post.jpeg_url || post.file_url;
          break;
        case 'sample':
        default:
          // sample_url 是缩小的预览版本
          downloadUrl = post.sample_url || post.jpeg_url || post.file_url;
          break;
      }

      if (!downloadUrl) {
        if (this.mainConfig.debug.enabled) logger.warn(`[konachan] 帖子 ${postId} 缺少任何可用的图片 URL。`);
        return { details };
      }

      if (this.mainConfig.debug.enabled) logger.info(`[konachan] 正在下载图源图片 (${this.subConfig.postQuality} 质量)... URL: ${downloadUrl}`)

      // 使用 ctx.http 下载图片,添加 Referer 防盗链
      const imageBuffer = await this.ctx.http.get(downloadUrl, {
        responseType: 'arraybuffer',
        timeout: this.mainConfig.requestTimeout * 1000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': `https://konachan.net/post/show/${postId}`,
        }
      }) as ArrayBuffer

      const imageType = getImageTypeFromUrl(downloadUrl)

      return { details, imageBuffer: Buffer.from(imageBuffer), imageType }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[konachan] 获取图源信息 (ID: ${postId}) 时发生错误: ${errorMessage}`)
      if (this.mainConfig.debug.enabled) {
         if (error.response) {
            logger.error(`[konachan] 错误响应: Status=${error.response.status}, Body=${JSON.stringify(error.response.data).slice(0, 200)}`)
         }
         if (error.code) {
            logger.error(`[konachan] 错误代码: ${error.code}`)
         }
      }
      return null
    }
  }

  private findKonachanUrl(result: Searcher.Result): string | null {
    // 优先检查帖子 URL
    if (result.url && KONACHAN_POST_URL_REGEX.test(result.url)) {
        return result.url;
    }
    // 检查直接图片 URL
    if (result.url && KONACHAN_IMAGE_URL_REGEX.test(result.url)) {
        return result.url;
    }
    // 在详情中查找
    if (result.details) {
        for (const detail of result.details) {
            const detailStr = String(detail);
            // 优先匹配帖子 URL
            let match = detailStr.match(KONACHAN_POST_URL_REGEX);
            if (match) return match[0];
            // 再匹配图片 URL
            match = detailStr.match(KONACHAN_IMAGE_URL_REGEX);
            if (match) return match[0];
        }
    }
    return null;
  }

  private parsePostId(url: string): string | null {
    // 尝试从帖子 URL 中提取 ID
    let match = url.match(/konachan\.(?:com|net)\/post\/show\/(\d+)/);
    if (match) return match[1];

    // 尝试从图片 URL 中提取 ID
    // 格式: Konachan.com - 396990 ... 或 Konachan.com_396990_...
    match = url.match(/Konachan\.(?:com|net)[^\/]*?[-_\s](\d+)/i);
    if (match) return match[1];

    return null;
  }

  private buildDetailNodes(post: KonachanPost): h[] {
    const info: string[] = [];
    info.push(`Konachan (ID: ${post.id})`);
    info.push(`尺寸: ${post.width}x${post.height}`);

    // 添加文件大小信息
    if (post.file_size) {
      const sizeMB = (post.file_size / (1024 * 1024)).toFixed(2);
      info.push(`文件大小: ${sizeMB} MB`);
    }

    info.push(`评分: ${post.score}`);
    info.push(`等级: ${post.rating.toUpperCase()}`);
    info.push(`上传者: ${post.author}`);

    const postDate = new Date(post.updated_at * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    info.push(`更新于: ${postDate}`);

    if (post.source && post.source.startsWith('http')) {
        info.push(`原始来源: ${post.source}`);
    }

    const tags = post.tags.split(' ').map(tag => tag.replace(/_/g, ' ')).filter(Boolean);
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
