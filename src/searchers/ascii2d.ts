// --- START OF FILE src/searchers/ascii2d.ts ---

import { Context, Logger } from 'koishi'
import { Config, Searcher, SearchOptions, Ascii2D as Ascii2DConfig, SearchEngineName } from '../config'
import type { PuppeteerManager } from '../puppeteer'
import type { Page } from 'puppeteer-core';

const logger = new Logger('sauce-aggregator')

// Ascii2D 搜图引擎实现
export class Ascii2D implements Searcher<Ascii2DConfig.Config> {
  public readonly name: SearchEngineName = 'ascii2d';
  private puppeteer: PuppeteerManager;
  
  constructor(public ctx: Context, public mainConfig: Config, public subConfig: Ascii2DConfig.Config, puppeteerManager: PuppeteerManager) {
    this.puppeteer = puppeteerManager;
  }

  // 执行搜索
  async search(options: SearchOptions): Promise<Searcher.Result[]> {
    if (!options.imageUrl) {
        logger.warn('[ascii2d] 此引擎需要图片 URL 才能进行搜索。');
        return [];
    }

    const page = await this.puppeteer.getPage();

    try {
      // 导航与图片提交
      if (this.mainConfig.debug.enabled) logger.info(`[ascii2d] 导航到 ascii2d.net`);
      await page.goto('https://ascii2d.net/');

      const urlFormSelector = 'form[action="/search/uri"]';
      await page.waitForSelector(urlFormSelector);
      
      const inputSelector = `${urlFormSelector} input[name="uri"]`;
      if (this.mainConfig.debug.enabled) logger.info(`[ascii2d] 正在输入 URL...`);
      await page.type(inputSelector, options.imageUrl);
      
      const searchButtonSelector = `${urlFormSelector} button[type="submit"]`;
      if (this.mainConfig.debug.enabled) logger.info(`[ascii2d] 点击 URL 搜索按钮...`);
      await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}),
          page.click(searchButtonSelector),
      ]);
      
      // 等待并解析结果
      await page.waitForSelector('div.item-box');
      if (this.mainConfig.debug.enabled) logger.info(`[ascii2d] 已加载颜色搜索结果页: ${page.url()}`);
      
      const results = await this.parseResults(page);
      return results.slice(0, options.maxResults);

    } catch(error) {
        logger.error('[ascii2d] 搜索过程中发生错误:', error);
        if (this.mainConfig.debug.enabled) {
            await this.puppeteer.saveErrorSnapshot(page, this.name);
        }
        throw error;
    } finally {
        if (page && !page.isClosed()) await page.close();
    }
  }

  // 解析结果页面
  private async parseResults(page: Page): Promise<Searcher.Result[]> {
    const rawResults = await page.$$eval('div.item-box', (boxes: HTMLDivElement[]) => {
        // 从第二个 item-box 开始，第一个是原图
        return boxes.slice(1).map(box => {
            if (box.querySelector('h5')?.textContent === '広告') return null;

            const thumbnailEl = box.querySelector('img');
            const detailBox = box.querySelector('.detail-box');
            if (!thumbnailEl || !detailBox) return null;

            const links = Array.from(detailBox.querySelectorAll('h6 a')) as HTMLAnchorElement[];
            if (links.length === 0) return null;

            const sourceInfoEl = detailBox.querySelector('h6 small.text-muted');
            const sourceInfo = sourceInfoEl?.textContent || '未知来源';
            
            const authorLink = links.find(a => a.href.includes('/users/') || a.href.includes('/i/user/'));
            const mainLink = links.find(a => !a.href.includes('/users/') && !a.href.includes('/i/user/'));
            
            return {
                thumbnail: new URL(thumbnailEl.src, location.origin).href,
                url: mainLink?.href || null,
                source: `[${sourceInfo}] ${mainLink?.textContent || ''}`.trim(),
                author: authorLink?.textContent || null,
                searchType: '色合検索',
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