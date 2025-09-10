// --- START OF FILE yande.ts ---

import { Context, Logger, h } from 'koishi'
import { YandeRe as YandeReConfig, Enhancer, EnhancedResult, Searcher, DebugConfig } from '../config'
import { getImageTypeFromUrl } from '../utils'

const logger = new Logger('sauce-aggregator')

interface YandeRePost {
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
  file_url: string
  jpeg_url: string
  sample_url: string
  [key: string]: any
}


export class YandeReEnhancer implements Enhancer<YandeReConfig.Config> {
  public readonly name: 'yandere' = 'yandere';
  private timeout: number;

  constructor(public ctx: Context, public config: YandeReConfig.Config, public debugConfig: DebugConfig, requestTimeout: number) {
      this.timeout = requestTimeout * 1000;
  }

  public async enhance(result: Searcher.Result): Promise<EnhancedResult | null> {
    const yandeReUrl = this.findYandeReUrl(result);
    if (!yandeReUrl) return null;

    const postId = this.parsePostId(yandeReUrl)
    if (!postId) return null

    if (this.debugConfig.enabled) logger.info(`[yande.re] 检测到 Yande.re 链接，帖子 ID: ${postId}，开始获取图源信息...`)

    try {
      const apiUrl = `https://yande.re/post.json?tags=id:${postId}`
      const response = await this.ctx.http.get<YandeRePost[]>(apiUrl, { timeout: this.timeout })

      if (this.debugConfig.logApiResponses.includes(this.name)) {
        logger.info(`[yande.re] API 响应: ${JSON.stringify(response, null, 2)}`)
      }

      if (!response || response.length === 0) {
        if (this.debugConfig.enabled) logger.warn(`[yande.re] API 未能找到 ID 为 ${postId} 的帖子。`)
        return null
      }

      const post = response[0]

      const ratingHierarchy = { s: 1, q: 2, e: 3 };
      const postRatingLevel = ratingHierarchy[post.rating];
      const maxAllowedLevel = ratingHierarchy[this.config.maxRating];
      
      if (postRatingLevel > maxAllowedLevel) {
        if (this.debugConfig.enabled) logger.info(`[yande.re] 帖子 ${postId} 的评级为 '${post.rating.toUpperCase()}'，超出了配置允许的最高等级 '${this.config.maxRating.toUpperCase()}'，已跳过。`);
        return { details: [h.text(`[!] Yande.re 图源的评级 (${post.rating.toUpperCase()}) 超出设置，已隐藏详情。`)] };
      }

      const details: h[] = this.buildDetailNodes(post)

      let downloadUrl: string;
      switch (this.config.postQuality) {
        case 'original': downloadUrl = post.file_url; break;
        case 'sample': downloadUrl = post.sample_url; break;
        case 'jpeg': default: downloadUrl = post.jpeg_url; break;
      }

      if (this.debugConfig.enabled) logger.info(`[yande.re] 正在下载图源图片 (${this.config.postQuality} 质量)... URL: ${downloadUrl}`)

      const imageBuffer = Buffer.from(await this.ctx.http.get(downloadUrl, { responseType: 'arraybuffer', timeout: this.timeout }))
      const imageType = getImageTypeFromUrl(downloadUrl)

      return { details, imageBuffer, imageType }
    } catch (error) {
      logger.error(`[yande.re] 获取图源信息 (ID: ${postId}) 时发生错误:`, error)
      return null
    }
  }
  
  private findYandeReUrl(result: Searcher.Result): string | null {
    const urlRegex = /(https?:\/\/yande\.re\/post\/show\/\d+)/;
    
    if (result.url && urlRegex.test(result.url)) {
        return result.url;
    }

    if (result.details) {
        for (const detail of result.details) {
            const match = detail.match(urlRegex);
            if (match) return match[0];
        }
    }
    
    return null;
  }

  private parsePostId(url: string): string | null {
    const match = url.match(/yande\.re\/post\/show\/(\d+)/)
    return match ? match[1] : null
  }
  
  private buildDetailNodes(post: YandeRePost): h[] {
    const info: string[] = [];
    info.push(`Yande.re (ID: ${post.id})`);
    info.push(`尺寸: ${post.width}x${post.height}`);
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
// --- END OF FILE yande.ts ---