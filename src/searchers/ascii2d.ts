// --- START OF FILE src/searchers/ascii2d.ts ---

import { Context, Logger } from 'koishi'
import { Searcher, SearchOptions, Ascii2D as Ascii2DConfig, DebugConfig, SearchEngineName } from '../config'
import type { PuppeteerManager } from '../puppeteer'
import type { Page } from 'puppeteer-core';

const logger = new Logger('sauce-aggregator')

export class Ascii2D implements Searcher<Ascii2DConfig.Config> {
  public readonly name: SearchEngineName = 'ascii2d';
  private puppeteer: PuppeteerManager;
  
  constructor(public ctx: Context, public config: Ascii2DConfig.Config, public debugConfig: DebugConfig, puppeteerManager: PuppeteerManager) {
    this.puppeteer = puppeteerManager;
  }

  async search(options: SearchOptions): Promise<Searcher.Result[]> {
    if (!options.imageUrl) {
        logger.warn('[ascii2d] 此引擎需要图片 URL 才能进行搜索。');
        return [];
    }

    const page = await this.puppeteer.getPage();

    try {
      if (this.debugConfig.enabled) logger.info(`[ascii2d] [Stealth] 导航到 ascii2d.net`);
      await page.goto('https://ascii2d.net/');

      const urlFormSelector = 'form[action="/search/uri"]';
      await page.waitForSelector(urlFormSelector);
      
      const inputSelector = `${urlFormSelector} input[name="uri"]`;
      if (this.debugConfig.enabled) logger.info(`[ascii2d] [Stealth] 正在快速输入 URL...`);
      await page.evaluate((selector, value) => {
        const input = document.querySelector(selector) as HTMLInputElement;
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, inputSelector, options.imageUrl);
      
      const searchButtonSelector = `${urlFormSelector} button[type="submit"]`;
      await page.waitForSelector(searchButtonSelector);
      
      if (this.debugConfig.enabled) logger.info(`[ascii2d] [Stealth] 点击 URL 搜索按钮...`);
      
      await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}),
          page.click(searchButtonSelector),
      ]);
      await page.waitForSelector('div.item-box');
      if (this.debugConfig.enabled) logger.info(`[ascii2d] [Stealth] 已加载颜色搜索 (color) 结果页: ${page.url()}`);
      
      if (this.debugConfig.enabled) logger.info(`[ascii2d] [Stealth] 正在解析结果页面...`);
      
      const results = await this.parseResults(page);
      return results.slice(0, options.maxResults);

    } catch(error) {
        logger.error('[ascii2d] [Stealth] 搜索过程中发生错误:', error);
        if (this.debugConfig.enabled) {
            await this.puppeteer.saveErrorSnapshot(page, this.name);
        }
        throw error;
    } finally {
        if (page && !page.isClosed()) await page.close();
    }
  }

  private async parseResults(page: Page): Promise<Searcher.Result[]> {
    const rawResults = await page.$$eval('div.item-box', (boxes: HTMLDivElement[]) => {
        return boxes.slice(1).map(box => {
            if (box.querySelector('h5')?.textContent === '広告') return null;

            const thumbnailElement = box.querySelector('img');
            const detailBox = box.querySelector('.detail-box');
            if (!thumbnailElement || !detailBox) return null;

            const links = Array.from(detailBox.querySelectorAll('h6 a')) as HTMLAnchorElement[];
            if (links.length === 0) return null;

            const sourceInfoElement = detailBox.querySelector('h6 small.text-muted');
            const sourceInfo = sourceInfoElement ? sourceInfoElement.textContent : '未知来源';
            
            const authorLink = links.find(a => a.href.includes('/users/') || a.href.includes('/i/user/'));
            const mainLink = links.find(a => !a.href.includes('/users/') && !a.href.includes('/i/user/'));

            const searchType = '色合検索';
            
            return {
                thumbnail: new URL(thumbnailElement.src, location.origin).href,
                url: mainLink?.href || null,
                source: `[${sourceInfo}] ${mainLink?.textContent || ''}`.trim(),
                author: authorLink?.textContent || null,
                searchType: searchType.trim(),
            };
        }).filter(Boolean);
    });

    return rawResults.map(res => ({
        thumbnail: res.thumbnail,
        similarity: 0,
        url: res.url,
        source: res.source,
        author: res.author,
        details: [`搜索类型: ${res.searchType}`],
    }));
  }
}
// --- END OF FILE src/searchers/ascii2d.ts ---