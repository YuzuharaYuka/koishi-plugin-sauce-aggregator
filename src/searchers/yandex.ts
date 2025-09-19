// --- START OF FILE src/searchers/yandex.ts ---
import { Context, Logger } from 'koishi'
import { Searcher, SearchOptions, Yandex as YandexConfig, DebugConfig, SearchEngineName } from '../config'
import type { PuppeteerManager } from '../puppeteer'
import { promises as fs } from 'fs';
import path from 'path';

const logger = new Logger('sauce-aggregator')

export class Yandex implements Searcher<YandexConfig.Config> {
  public readonly name: SearchEngineName = 'yandex';
  private puppeteer: PuppeteerManager;
  
  constructor(public ctx: Context, public config: YandexConfig.Config, public debugConfig: DebugConfig, puppeteerManager: PuppeteerManager) {
    this.puppeteer = puppeteerManager;
  }

  async search(options: SearchOptions): Promise<Searcher.Result[]> {
    const page = await this.puppeteer.getPage();
    const tempFilePath = path.resolve(this.ctx.baseDir, 'temp', `sauce-aggregator-yandex-${Date.now()}-${options.fileName}`);

    try {
      const url = `https://${this.config.domain}/images/`
      if (this.debugConfig.enabled) logger.info(`[yandex] [Stealth] 导航到: ${url}`);
      await page.goto(url);
      
      const inputSelector = 'input[type="file"]';
      await page.waitForSelector(inputSelector);
      const inputUploadHandle = await page.$(inputSelector);

      await fs.mkdir(path.dirname(tempFilePath), { recursive: true });
      await fs.writeFile(tempFilePath, options.imageBuffer);
      
      if (this.debugConfig.enabled) logger.info(`[yandex] [Stealth] 正在上传临时文件: ${tempFilePath}`);
      await inputUploadHandle.uploadFile(tempFilePath);
      
      if (this.debugConfig.enabled) logger.info(`[yandex] [Stealth] 等待第一个结果元素出现...`);
      // --- THIS IS THE OPTIMIZATION ---: Wait for the key element instead of full navigation.
      const firstResultSelector = '.CbirSites-Item';
      await page.waitForSelector(firstResultSelector, { timeout: this.ctx.root.config.requestTimeout * 1000 });

      if (this.debugConfig.enabled) logger.info(`[yandex] [Stealth] 结果已加载，正在浏览器端解析...`);
      
      if (this.debugConfig.logApiResponses.includes(this.name)) {
        // Still log the HTML for debugging purposes if enabled
        const html = await page.content();
        logger.info({ '[yandex] Raw HTML Response': html });
      }

      // --- THIS IS THE OPTIMIZATION ---: Parse data within the browser context.
      const results = await page.$$eval(
        '.CbirSites-Item',
        (items, maxResults) => {
          // This function runs in the browser context
          const parsedResults = [];
          // Slice to process only the required number of items, improving performance
          for (const item of items.slice(0, maxResults)) {
            const thumbElement = item.querySelector('.CbirSites-ItemThumb img') as HTMLImageElement;
            const titleElement = item.querySelector('.CbirSites-ItemTitle a') as HTMLAnchorElement;
            const domainElement = item.querySelector('.CbirSites-ItemDomain') as HTMLAnchorElement;
            const sizeElement = item.querySelector('.Thumb-Mark');

            if (!thumbElement || !titleElement) continue;
            
            // Fix thumbnail URL which might be relative or protocol-less
            let thumbnailUrl = thumbElement.src;
            if (thumbnailUrl.startsWith('//')) {
                thumbnailUrl = 'https:' + thumbnailUrl;
            }

            const details = [];
            if (sizeElement) {
                details.push(`尺寸: ${sizeElement.textContent.trim()}`);
            }

            parsedResults.push({
              thumbnail: thumbnailUrl,
              similarity: 0, // Yandex doesn't provide similarity
              url: titleElement.href,
              source: domainElement?.textContent.trim() || '未知来源',
              details: [
                  `标题: ${titleElement.textContent.trim()}`,
                  ...details
              ],
            });
          }
          return parsedResults;
        },
        options.maxResults // Pass maxResults to the browser-side function
      );

      if (this.debugConfig.enabled) logger.info(`[yandex] 成功解析到 ${results.length} 个结果。`);
      return results;

    } catch (error) {
      logger.warn(`[yandex] 请求或解析出错: ${error.message}`);
      if (this.debugConfig.enabled) {
          await this.puppeteer.saveErrorSnapshot(page, this.name);
      }
      if (this.debugConfig.enabled) logger.debug(`[yandex] 错误详情:`, error);
      throw new Error(`请求 Yandex 失败: ${error.message}`);
    } finally {
        if (page && !page.isClosed()) await page.close();
        try {
            await fs.unlink(tempFilePath);
        } catch {}
    }
  }
}
// --- END OF FILE src/searchers/yandex.ts ---