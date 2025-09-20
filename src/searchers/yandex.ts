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
    let tempFileCreated = false;

    try {
      const url = `https://${this.config.domain}/images/`
      if (this.debugConfig.enabled) logger.info(`[yandex] [Stealth] 导航到: ${url}`);
      // --- THIS IS THE FIX ---: Use a faster navigation strategy.
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      
      const cookiePopupSelector = '.gdpr-popup-v3-main';
      const allowAllButtonSelector = '#gdpr-popup-v3-button-all';
      try {
        if (this.debugConfig.enabled) logger.info(`[yandex] [Stealth] 检查 Cookie 弹窗...`);
        await page.waitForSelector(cookiePopupSelector, { visible: true, timeout: 5000 });
        if (this.debugConfig.enabled) logger.info(`[yandex] [Stealth] 检测到 Cookie 弹窗，点击 "Allow all"...`);
        await page.click(allowAllButtonSelector);
        await page.waitForSelector(cookiePopupSelector, { hidden: true, timeout: 3000 });
        if (this.debugConfig.enabled) logger.info(`[yandex] [Stealth] Cookie 弹窗已处理。`);
      } catch (e) {
        if (this.debugConfig.enabled) logger.info(`[yandex] [Stealth] 未检测到 Cookie 弹窗，或弹窗处理超时，继续执行。`);
      }

      const cameraButtonSelector = '.HeaderDesktopActions-CbirButton';
      const uploadPanelSelector = '.CbirPanel-Popup';
      const selectFileButtonSelector = '.CbirPanel-FileControlsButton';
      
      let uploadPanelVisible = false;
      const maxRetries = 3;
      for (let i = 0; i < maxRetries; i++) {
          try {
              if (this.debugConfig.enabled) logger.info(`[yandex] [Stealth] 等待相机图标可见 (尝试 ${i + 1}/${maxRetries})...`);
              const cameraButton = await page.waitForSelector(cameraButtonSelector, { visible: true, timeout: 10000 });
              
              if (this.debugConfig.enabled) logger.info(`[yandex] [Stealth] 点击相机图标...`);
              await cameraButton.click();

              if (this.debugConfig.enabled) logger.info(`[yandex] [Stealth] 等待上传面板出现...`);
              await page.waitForSelector(uploadPanelSelector, { visible: true, timeout: 5000 });

              uploadPanelVisible = true;
              break;
          } catch (e) {
              if (this.debugConfig.enabled) logger.warn(`[yandex] [Stealth] 第 ${i + 1} 次点击未能打开上传面板: ${e.message}`);
              if (i < maxRetries - 1) {
                  // Reload using a more lenient condition as well
                  await page.reload({ waitUntil: 'domcontentloaded' });
              }
          }
      }

      if (!uploadPanelVisible) {
          throw new Error(`点击相机图标 ${maxRetries} 次后，仍未能打开上传面板。`);
      }

      await fs.mkdir(path.dirname(tempFilePath), { recursive: true });
      await fs.writeFile(tempFilePath, options.imageBuffer);
      tempFileCreated = true;
      if (this.debugConfig.enabled) logger.info(`[yandex] [Stealth] 临时文件已创建: ${tempFilePath}`);
      
      const fileChooserPromise = page.waitForFileChooser();

      if (this.debugConfig.enabled) logger.info(`[yandex] [Stealth] 等待“选择文件”按钮...`);
      const selectFileButton = await page.waitForSelector(selectFileButtonSelector);
      
      if (this.debugConfig.enabled) logger.info(`[yandex] [Stealth] 点击“选择文件”按钮...`);
      await selectFileButton.click();
      
      const fileChooser = await fileChooserPromise;
      await fileChooser.accept([tempFilePath]);
      if (this.debugConfig.enabled) logger.info(`[yandex] [Stealth] 文件已通过选择器提交。`);

      if (this.debugConfig.enabled) logger.info(`[yandex] [Stealth] 等待第一个结果元素出现...`);
      const firstResultSelector = '.CbirSites-Item';
      await page.waitForSelector(firstResultSelector, { timeout: this.ctx.root.config.requestTimeout * 1000 });

      if (this.debugConfig.enabled) logger.info(`[yandex] [Stealth] 结果已加载，正在浏览器端解析...`);
      
      if (this.debugConfig.logApiResponses.includes(this.name)) {
        const html = await page.content();
        logger.info({ '[yandex] Raw HTML Response': html });
      }

      const results = await page.$$eval(
        '.CbirSites-Item',
        (items, maxResults) => {
          const parsedResults = [];
          for (const item of items.slice(0, maxResults)) {
            const thumbElement = item.querySelector('.CbirSites-ItemThumb img') as HTMLImageElement;
            const titleElement = item.querySelector('.CbirSites-ItemTitle a') as HTMLAnchorElement;
            const domainElement = item.querySelector('.CbirSites-ItemDomain') as HTMLAnchorElement;
            const sizeElement = item.querySelector('.Thumb-Mark');

            if (!thumbElement || !titleElement) continue;
            
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
              similarity: 0,
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
        options.maxResults
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
        if (tempFileCreated) {
            try {
                await fs.unlink(tempFilePath);
            } catch {}
        }
    }
  }
}
// --- END OF FILE src/searchers/yandex.ts ---