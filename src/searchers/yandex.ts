import { Context, Logger } from 'koishi'
import { Searcher, SearchOptions, Yandex as YandexConfig, DebugConfig, SearchEngineName } from '../config'
import * as cheerio from 'cheerio'
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
      
      if (this.debugConfig.enabled) logger.info(`[yandex] [Stealth] 等待页面跳转...`);
      await page.waitForNavigation({ waitUntil: 'networkidle0' });

      if (this.debugConfig.enabled) logger.info(`[yandex] [Stealth] 正在解析结果页面: ${page.url()}`);
      
      const html = await page.content();
      if (this.debugConfig.logApiResponses.includes(this.name)) {
        logger.info(`[yandex] Raw HTML length: ${html.length}.`)
      }

      const $ = cheerio.load(html);
      const dataStateAttr = $('div.Root[id^="ImagesApp-"]').attr('data-state');
      
      if (!dataStateAttr) {
        if (this.debugConfig.enabled) logger.warn('[yandex] 页面结构可能已更改，未找到 data-state 属性。');
        return [];
      }

      const dataState = JSON.parse(dataStateAttr);
      const sites = dataState?.initialState?.cbirSites?.sites || [];
      
      const results = sites.map((site) => {
        const thumbUrl = site.thumb.url;
        const fullThumbUrl = thumbUrl.startsWith('//') ? `https:${thumbUrl}` : thumbUrl;
        
        return {
          thumbnail: fullThumbUrl,
          similarity: 0,
          url: site.url,
          source: site.domain,
          details: [
            `标题: ${site.title}`,
            `尺寸: ${site.originalImage.width}x${site.originalImage.height}`,
          ].filter(Boolean),
        }
      });
      
      if (this.debugConfig.enabled) logger.info(`[yandex] 成功解析到 ${results.length} 个结果。`);
      return results;

    } catch (error) {
      logger.warn(`[yandex] 请求或解析出错: ${error.message}`);
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