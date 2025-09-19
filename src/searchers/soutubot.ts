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
      
      const firstResultSelector = 'div.card-2';
      const lowConfidenceButtonSelector = 'button.el-button--warning';
      const resultsInfoSelector = 'div.text-center > h3';
      
      if (this.debugConfig.enabled) logger.info(`[soutubot] [Stealth] 等待搜索结果加载 (等待 '${firstResultSelector}' 或 '${resultsInfoSelector}')...`);

      await Promise.race([
        page.waitForSelector(firstResultSelector),
        page.waitForSelector(resultsInfoSelector),
      ]);

      const hasResultCards = await page.$(firstResultSelector);
      const lowConfidenceButton = await page.$(lowConfidenceButtonSelector);

      if (!hasResultCards && lowConfidenceButton) {
        if (this.debugConfig.enabled) logger.info('[soutubot] 未直接显示结果，正在点击“显示剩余低匹配度结果”按钮...');
        await page.click(lowConfidenceButtonSelector);
        await page.waitForSelector(firstResultSelector);
      } else if (!hasResultCards) {
        if (this.debugConfig.enabled) logger.info('[soutubot] 页面已加载，但未找到任何结果卡片。');
        return [];
      }

      if (this.debugConfig.enabled) logger.info(`[soutubot] [Stealth] 正在解析结果页面: ${page.url()}`);
      
      if (this.debugConfig.logApiResponses.includes(this.name)) {
        const html = await page.content();
        logger.info(`[soutubot] Raw HTML length: ${html.length}.`)
      }
      
      const results = await this.parseResults(page);
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

  private async parseResults(page: Page): Promise<Searcher.Result[]> {
    // 仅选择第一个结果网格（高匹配度结果），该网格没有 .mt-4 类
    const highConfidenceResultsSelector = 'div.grid.grid-cols-1.gap-4:not(.mt-4) div.card-2';

    const rawResults = await page.$$eval(highConfidenceResultsSelector, (cards: HTMLDivElement[]) => {
        const langMap = { cn: '中文', jp: '日文', gb: '英文', kr: '韩文' };
        
        return cards.map(card => {
            const similarityEl = Array.from(card.querySelectorAll('span')).find(el => el.textContent.trim() === '匹配度:');
            const similarityText = similarityEl ? similarityEl.nextElementSibling?.textContent.trim().replace('%', '') : '0';

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
    });

    return rawResults.map(res => {
        const details: string[] = [];
        if (res.language) details.push(`语言: ${res.language}`);
        if (res.imageUrl) details.push(`${res.imagePageText}: ${res.imageUrl}`);
        
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