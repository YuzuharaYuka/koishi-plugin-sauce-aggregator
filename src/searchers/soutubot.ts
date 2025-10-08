// --- START OF FILE src/searchers/soutubot.ts ---
import { Context, Logger } from 'koishi'
import { Config, Searcher, SearchOptions, SoutuBot as SoutuBotConfig, SearchEngineName } from '../config'
import type { PuppeteerManager } from '../puppeteer'
import type { Page } from 'puppeteer-core';

const logger = new Logger('sauce-aggregator')

// [FIX] 修正：使用 'extends' 继承抽象基类，而不是 'implements'
export class SoutuBot extends Searcher<SoutuBotConfig.Config> {
  public readonly name: SearchEngineName = 'soutubot';
  private puppeteer: PuppeteerManager;
  
  constructor(public ctx: Context, public mainConfig: Config, public subConfig: SoutuBotConfig.Config, puppeteerManager: PuppeteerManager) {
    super(ctx, mainConfig, subConfig);
    this.puppeteer = puppeteerManager;
  }

  // 执行搜索
  async search(options: SearchOptions): Promise<Searcher.Result[]> {
    return this.puppeteer.withTempFile(options.imageBuffer, options.fileName, async (tempFilePath) => {
        const page = await this.puppeteer.getPage();
        try {
            const url = `https://soutubot.moe/`
            if (this.mainConfig.debug.enabled) logger.info(`[soutubot] 导航到: ${url}`);
            await page.goto(url, { waitUntil: 'networkidle0' });

            if (await this.puppeteer.checkForCloudflare(page)) {
                if (this.mainConfig.debug.enabled && this.mainConfig.debug.logApiResponses.includes(this.name)) {
                    logger.info(`[soutubot] 检测到 Cloudflare，正在保存页面快照...`);
                    await this.puppeteer.saveErrorSnapshot(page, `${this.name}-cloudflare`);
                }
                throw new Error('检测到 Cloudflare 人机验证页面。这通常由您的网络环境或代理 IP 引起。请尝试更换网络环境或暂时禁用此引擎。');
            }
            
            const inputSelector = 'input[type="file"]';
            await page.waitForSelector(inputSelector);
            const inputUploadHandle = await page.$(inputSelector);

            await inputUploadHandle.uploadFile(tempFilePath);
            
            const firstResultSelector = '.card-2';
            const noResultSelector = 'div.text-center > h3';
            
            if (this.mainConfig.debug.enabled) logger.info(`[soutubot] 等待搜索结果加载...`);
            await page.waitForSelector(`${firstResultSelector}, ${noResultSelector}`);
            if (this.mainConfig.debug.enabled) logger.info(`[soutubot] 结果已加载，正在解析...`);

            if (this.mainConfig.debug.logApiResponses.includes(this.name)) {
                const html = await page.content();
                logger.info({ '[soutubot] Raw HTML Response': html });
            }
            
            const maxNeeded = Math.max(options.maxResults, this.subConfig.maxHighConfidenceResults || 1);
            return await this.parseResults(page, maxNeeded);

        } catch (error) {
            if (error.message.includes('Cloudflare')) throw error;
            
            logger.error(`[soutubot] 搜索过程中发生错误:`, error);
            if (this.mainConfig.debug.enabled) {
                await this.puppeteer.saveErrorSnapshot(page, this.name);
            }
            if (error.name === 'TimeoutError') {
                throw new Error(`等待搜索结果超时，网站可能没有响应或没有找到结果。`);
            }
            throw error;
        } finally {
            if (page && !page.isClosed()) await page.close();
        }
    });
  }

  // 解析结果页面
  private async parseResults(page: Page, maxNeeded: number): Promise<Searcher.Result[]> {
    const rawResults = await page.$$eval('.card-2', (cards: HTMLDivElement[], maxNeeded) => {
        const langMap = { cn: '中文', jp: '日文', gb: '英文', kr: '韩文' };
        
        return cards.slice(0, maxNeeded).map(card => {
            const similarityLabel = Array.from(card.querySelectorAll('span')).find(el => el.textContent?.trim() === '匹配度:');
            const similarityText = similarityLabel?.nextElementSibling?.textContent?.trim().replace('%', '') || '0';

            const title = (card.querySelector('.font-semibold span') as HTMLElement)?.innerText;
            const thumbnail = (card.querySelector('a[target="_blank"] img') as HTMLImageElement)?.src;

            const sourceImg = (card.querySelector('img[src*="/images/icons/"]') as HTMLImageElement);
            const sourceName = sourceImg ? sourceImg.src.split('/').pop()?.replace('.png', '') : '未知';
            
            const langFlag = card.querySelector('span.fi[class*="fi-"]');
            const langCode = langFlag ? Array.from(langFlag.classList).find(c => c.startsWith('fi-'))?.replace('fi-', '') : null;
            const language = langCode ? (langMap[langCode] || langCode) : null;

            const detailPageLink = Array.from(card.querySelectorAll('a.el-button')).find(a => a.textContent?.includes('详情页')) as HTMLAnchorElement;
            const imagePageLink = Array.from(card.querySelectorAll('a.el-button')).find(a => a.textContent?.includes('图片页')) as HTMLAnchorElement;

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
    }, maxNeeded);

    return rawResults.map(res => {
        const details: string[] = [];
        if (res.language) details.push(`语言: ${res.language}`);
        
        const pageMatch = res.imagePageText?.match(/\(P(\d+)\)/);
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