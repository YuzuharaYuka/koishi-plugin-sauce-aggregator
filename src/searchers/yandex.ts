// --- START OF FILE src/searchers/yandex.ts ---
import { Context, Logger } from 'koishi'
import { Config, Searcher, SearchOptions, Yandex as YandexConfig, SearchEngineName } from '../config'
import type { PuppeteerManager } from '../puppeteer'
import type { Page } from 'puppeteer-core';

const logger = new Logger('sauce-aggregator')

// [FIX] 修正：使用 'extends' 继承抽象基类，而不是 'implements'
export class Yandex extends Searcher<YandexConfig.Config> {
  public readonly name: SearchEngineName = 'yandex';
  private puppeteer: PuppeteerManager;
  
  constructor(public ctx: Context, public mainConfig: Config, public subConfig: YandexConfig.Config, puppeteerManager: PuppeteerManager) {
    super(ctx, mainConfig, subConfig);
    this.puppeteer = puppeteerManager;
  }

  // 执行搜索
  async search(options: SearchOptions): Promise<Searcher.Result[]> {
    return this.puppeteer.withTempFile(options.imageBuffer, options.fileName, async (tempFilePath) => {
        const page = await this.puppeteer.getPage();
        try {
            const url = `https://${this.subConfig.domain}/images/`
            if (this.mainConfig.debug.enabled) logger.info(`[yandex] 导航到: ${url}`);
            await page.goto(url, { waitUntil: 'domcontentloaded' });
            
            try {
                if (this.mainConfig.debug.enabled) logger.info(`[yandex] 检查 Cookie 弹窗...`);
                const cookiePopupSelector = '.gdpr-popup-v3-main';
                await page.waitForSelector(cookiePopupSelector, { visible: true, timeout: 5000 });
                if (this.mainConfig.debug.enabled) logger.info(`[yandex] 检测到 Cookie 弹窗，点击接受...`);
                await page.click('#gdpr-popup-v3-button-all');
                await page.waitForSelector(cookiePopupSelector, { hidden: true, timeout: 3000 });
            } catch (e) {
                if (this.mainConfig.debug.enabled) logger.info(`[yandex] 未检测到 Cookie 弹窗，继续执行。`);
            }

            const cameraButtonSelector = '.HeaderDesktopActions-CbirButton';
            const uploadPanelSelector = '.CbirPanel-Popup';
            let uploadPanelVisible = false;
            for (let i = 0; i < 3; i++) {
                try {
                    if (this.mainConfig.debug.enabled) logger.info(`[yandex] 等待并点击相机图标 (尝试 ${i + 1}/3)...`);
                    await page.waitForSelector(cameraButtonSelector, { visible: true, timeout: 10000 });
                    await page.click(cameraButtonSelector);
                    await page.waitForSelector(uploadPanelSelector, { visible: true, timeout: 5000 });
                    uploadPanelVisible = true;
                    break;
                } catch (e) {
                    if (this.mainConfig.debug.enabled) logger.warn(`[yandex] 第 ${i + 1} 次点击未能打开上传面板: ${e.message}`);
                    if (i < 2) await page.reload({ waitUntil: 'domcontentloaded' });
                }
            }
            if (!uploadPanelVisible) throw new Error(`点击相机图标 3 次后，仍未能打开上传面板。`);
            
            const fileChooserPromise = page.waitForFileChooser();
            const selectFileButtonSelector = '.CbirPanel-FileControlsButton';
            await page.waitForSelector(selectFileButtonSelector);
            await page.click(selectFileButtonSelector);
            
            const fileChooser = await fileChooserPromise;
            await fileChooser.accept([tempFilePath]);
            if (this.mainConfig.debug.enabled) logger.info(`[yandex] 文件已提交。`);

            if (this.mainConfig.debug.enabled) logger.info(`[yandex] 等待结果元素出现...`);
            await page.waitForSelector('.CbirSites-Item', { timeout: this.mainConfig.requestTimeout * 1000 });
            if (this.mainConfig.debug.enabled) logger.info(`[yandex] 结果已加载，正在解析...`);

            if (this.mainConfig.debug.logApiResponses.includes(this.name)) {
                const html = await page.content();
                logger.info({ '[yandex] Raw HTML Response': html });
            }
            
            const results = await this._parseResults(page, options.maxResults);
            if (this.mainConfig.debug.enabled) logger.info(`[yandex] 成功解析到 ${results.length} 个结果。`);
            return results;

        } catch (error) {
            logger.warn(`[yandex] 请求或解析出错: ${error.message}`);
            if (this.mainConfig.debug.enabled) {
                await this.puppeteer.saveErrorSnapshot(page, this.name);
            }
            throw new Error(`请求 Yandex 失败: ${error.message}`);
        } finally {
            if (page && !page.isClosed()) await page.close();
        }
    });
  }

  // 解析结果页面
  private async _parseResults(page: Page, maxResults: number): Promise<Searcher.Result[]> {
    return page.$$eval(
      '.CbirSites-Item',
      (items, max) => {
        const parsedResults = [];
        for (const item of items.slice(0, max)) {
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
            source: domainElement?.textContent?.trim() || '未知来源',
            details: [
                `标题: ${titleElement.textContent.trim()}`,
                ...details
            ],
          });
        }
        return parsedResults;
      },
      maxResults
    );
  }
}