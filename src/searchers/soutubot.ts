// --- START OF FILE src/searchers/soutubot.ts ---

import { Context, Logger } from 'koishi'
import { Searcher, SearchOptions, DebugConfig, SearchEngineName } from '../config'
import type { PuppeteerManager } from '../puppeteer'
import { promises as fs } from 'fs';
import path from 'path';
import type { Page } from 'puppeteer-core';

const logger = new Logger('sauce-aggregator')

export namespace SoutuBot {
    export interface Config { 
      confidenceThreshold?: number; 
      maxHighConfidenceResults?: number;
    }
}

export class SoutuBot implements Searcher<SoutuBot.Config> {
  public readonly name: SearchEngineName = 'soutubot';
  private puppeteer: PuppeteerManager;
  
  constructor(public ctx: Context, public config: SoutuBot.Config, public debugConfig: DebugConfig, puppeteerManager: PuppeteerManager) {
    this.puppeteer = puppeteerManager;
  }

  async search(options: SearchOptions): Promise<Searcher.Result[]> {
    const page = await this.puppeteer.getPage();
    const tempFilePath = path.resolve(this.ctx.baseDir, 'temp', `sauce-aggregator-soutubot-${Date.now()}-${options.fileName}`);

    try {
      const url = `https://soutubot.moe/`
      if (this.debugConfig.enabled) logger.info(`[soutubot] [Stealth] 导航到: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle0' });
      
      const inputSelector = 'input[type="file"]';
      await page.waitForSelector(inputSelector);
      const inputUploadHandle = await page.$(inputSelector);

      await fs.mkdir(path.dirname(tempFilePath), { recursive: true });
      await fs.writeFile(tempFilePath, options.imageBuffer);
      
      if (this.debugConfig.enabled) logger.info(`[soutubot] [Stealth] 正在上传临时文件: ${tempFilePath}`);
      await inputUploadHandle.uploadFile(tempFilePath);
      
      const firstResultSelector = '.card-2';
      const noResultSelector = 'div.text-center > h3';
      
      if (this.debugConfig.enabled) logger.info(`[soutubot] [Stealth] 等待搜索结果加载 (等待 '${firstResultSelector}' 或 '${noResultSelector}')...`);
      
      await page.waitForSelector(`${firstResultSelector}, ${noResultSelector}`);

      if (this.debugConfig.enabled) logger.info(`[soutubot] [Stealth] 结果已加载，正在浏览器端解析...`);

      if (this.debugConfig.logApiResponses.includes(this.name)) {
        const html = await page.content();
        logger.info({ '[soutubot] Raw HTML Response': html });
      }
      
      // --- THIS IS THE OPTIMIZATION ---: Determine max number of results needed
      const maxNeeded = Math.max(options.maxResults, this.config.maxHighConfidenceResults || 1);

      const results = await this.parseResults(page, maxNeeded);
      return results;

    } catch (error) {
      logger.error(`[soutubot] [Stealth] 搜索过程中发生错误:`, error);
      if (this.debugConfig.enabled) {
          await this.puppeteer.saveErrorSnapshot(page, this.name);
      }
      if (error.name === 'TimeoutError') {
          throw new Error(`等待搜索结果超时，网站可能没有响应或没有找到结果。`);
      }
      throw error;
    } finally {
        if (page && !page.isClosed()) await page.close();
        try {
            await fs.unlink(tempFilePath);
        } catch {}
    }
  }

  private async parseResults(page: Page, maxNeeded: number): Promise<Searcher.Result[]> {
    // --- THIS IS THE OPTIMIZATION ---: Pass maxNeeded and slice in the browser.
    const rawResults = await page.$$eval('.card-2', (cards: HTMLDivElement[], maxNeeded) => {
        const langMap = { cn: '中文', jp: '日文', gb: '英文', kr: '韩文' };
        
        // Process only the top N cards needed, right in the browser.
        return cards.slice(0, maxNeeded).map(card => {
            const similarityLabel = Array.from(card.querySelectorAll('span')).find(el => el.textContent.trim() === '匹配度:');
            const similarityText = similarityLabel ? similarityLabel.nextElementSibling?.textContent.trim().replace('%', '') : '0';

            const title = (card.querySelector('.font-semibold span') as HTMLElement)?.innerText;
            const thumbnail = (card.querySelector('a[target="_blank"] img') as HTMLImageElement)?.src;

            const sourceImg = (card.querySelector('img[src*="/images/icons/"]') as HTMLImageElement);
            const sourceName = sourceImg ? sourceImg.src.split('/').pop().replace('.png', '') : '未知';
            
            const langFlag = card.querySelector('span.fi[class*="fi-"]');
            const langCode = langFlag ? Array.from(langFlag.classList).find(c => c.startsWith('fi-')).replace('fi-', '') : null;
            const language = langMap[langCode] || langCode;

            const detailPageLink = Array.from(card.querySelectorAll('a.el-button')).find(a => a.textContent.includes('详情页')) as HTMLAnchorElement;
            const imagePageLink = Array.from(card.querySelectorAll('a.el-button')).find(a => a.textContent.includes('图片页')) as HTMLAnchorElement;

            return {
                thumbnail,
                similarity: parseFloat(similarityText),
                title,
                sourceName,
                language,
                detailUrl: detailPageLink?.href,
                imageUrl: imagePageLink?.href,
                imagePageText: imagePageLink?.innerText.trim()
            };
        }).filter(Boolean);
    }, maxNeeded); // Pass maxNeeded as an argument into page.$$eval

    return rawResults.map(res => {
        const details: string[] = [];
        if (res.language) details.push(`语言: ${res.language}`);
        const pageMatch = res.imagePageText.match(/\(P(\d+)\)/);
        if (res.imageUrl) {
            let linkText = "图片页";
            if (pageMatch) linkText += ` (P${pageMatch[1]})`;
            details.push(`${linkText}: ${res.imageUrl}`);
        }
        
        return {
            thumbnail: res.thumbnail,
            similarity: res.similarity,
            url: res.detailUrl || res.imageUrl,
            source: `[${res.sourceName}] ${res.title || '未知作品'}`,
            details,
        };
    });
  }
}
// --- END OF FILE src/searchers/soutubot.ts ---