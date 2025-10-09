import { Context, Logger } from 'koishi'
import { Config, Searcher, SearchOptions, SoutuBot as SoutuBotConfig, SearchEngineName } from '../config'
import type { PuppeteerManager } from '../puppeteer'
import type { Page } from 'puppeteer-core';

const logger = new Logger('sauce-aggregator')

export class SoutuBot extends Searcher<SoutuBotConfig.Config> {
  public readonly name: SearchEngineName = 'soutubot';
  private puppeteer: PuppeteerManager;
  
  constructor(ctx: Context, mainConfig: Config, subConfig: SoutuBotConfig.Config, puppeteerManager: PuppeteerManager) {
    super(ctx, mainConfig, subConfig);
    this.puppeteer = puppeteerManager;
  }

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

            const maxNeeded = Math.max(options.maxResults, this.subConfig.maxHighConfidenceResults || 1);
            const parsedResults = await this.parseResults(page, maxNeeded);

            // [FIX] 将日志记录从原始 HTML 改为解析后的 JSON 数据，使其更易读，便于排查问题。
            if (this.mainConfig.debug.logApiResponses.includes(this.name)) {
                logger.info(`[soutubot] Parsed JSON Response: ${JSON.stringify(parsedResults, null, 2)}`);
            }
            
            return this.formatResults(parsedResults);

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

  // 将页面解析逻辑独立出来，返回原始数据结构
  private async parseResults(page: Page, maxNeeded: number) {
    return page.$$eval('.card-2', (cards: HTMLDivElement[], maxNeeded) => {
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
  }

  // 将解析出的原始数据格式化为统一的 Searcher.Result[] 格式
  private formatResults(rawResults: Awaited<ReturnType<typeof this.parseResults>>): Searcher.Result[] {
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