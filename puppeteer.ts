// --- START OF FILE src/puppeteer.ts ---
import { Context, Logger } from 'koishi'
import { Config } from './config'
import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import find from 'puppeteer-finder';
import type { Browser, Page, ScreenshotOptions } from 'puppeteer-core';
import { USER_AGENT } from './utils'
import { promises as fs } from 'fs';
import path from 'path';

const logger = new Logger('sauce-aggregator:puppeteer')
puppeteer.use(StealthPlugin())

export class PuppeteerManager {
    private _browserPromise: Promise<Browser> | null = null;
    private ctx: Context;
    private config: Config;

    constructor(ctx: Context, config: Config) {
        this.ctx = ctx;
        this.config = config;
    }

    private async getBrowserPath(): Promise<string | null> {
        if (this.config.chromeExecutablePath) {
            if(this.config.debug.enabled) logger.info(`[Stealth] 使用用户配置的全局浏览器路径: ${this.config.chromeExecutablePath}`);
            return this.config.chromeExecutablePath;
        }
        
        try {
            if(this.config.debug.enabled) logger.info('[Stealth] 正在使用 puppeteer-finder 自动检测浏览器...');
            const browserPath = await find();
            logger.info(`[Stealth] 自动检测到浏览器路径: ${browserPath}`);
            return browserPath;
        } catch (error) {
            logger.warn('[Stealth] puppeteer-finder 未能找到任何浏览器:', error);
            return null;
        }
    }

    private async launchBrowser(): Promise<Browser> {
        const executablePath = await this.getBrowserPath();
        if (!executablePath) {
            throw new Error('未能找到任何兼容的浏览器。请在插件的基础设置中手动指定路径。');
        }
        
        const timeout = this.config.requestTimeout * 1000;
        const browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                `--user-agent=${USER_AGENT}`
            ],
            executablePath: executablePath,
            protocolTimeout: timeout * 3,
            timeout: timeout,
        });

        browser.on('disconnected', () => {
            logger.warn('[Stealth] 共享浏览器实例已断开连接。');
            this._browserPromise = null;
        });
        return browser;
    }

    private getBrowser(): Promise<Browser> {
        if (this._browserPromise) {
            return this._browserPromise.then(browser => {
                if (browser.isConnected()) {
                    return browser;
                }
                if (this.config.debug.enabled) logger.info('[Stealth] 共享浏览器实例已断开，正在启动新的实例...');
                this._browserPromise = this.launchBrowser().catch(err => {
                    this._browserPromise = null; 
                    throw err;
                });
                return this._browserPromise;
            });
        }
        if (this.config.debug.enabled) logger.info('[Stealth] 共享浏览器实例不存在，正在启动...');
        this._browserPromise = this.launchBrowser().catch(err => {
            this._browserPromise = null; 
            throw err;
        });
        return this._browserPromise;
    }
    
    public async getPage(): Promise<Page> {
        const browser = await this.getBrowser();
        const page = await browser.newPage();
        page.setDefaultTimeout(this.config.requestTimeout * 1000);
        await page.setBypassCSP(true);
        return page;
    }

    public async saveErrorSnapshot(page: Page, contextName: string): Promise<void> {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const logDir = path.resolve(this.ctx.baseDir, 'logs');
            await fs.mkdir(logDir, { recursive: true });

            const screenshotPath = path.resolve(logDir, `${contextName}-error-${timestamp}.png`);
            const htmlPath = path.resolve(logDir, `${contextName}-error-${timestamp}.html`);
            
            await page.screenshot({ path: screenshotPath, fullPage: true } as ScreenshotOptions);
            const htmlContent = await page.content();
            await fs.writeFile(htmlPath, htmlContent);

            logger.info(`[Stealth] [${contextName}] 已保存错误快照: ${screenshotPath}`);
            logger.info(`[Stealth] [${contextName}] 已保存错误页面HTML: ${htmlPath}`);
        } catch (snapshotError) {
            logger.error(`[Stealth] [${contextName}] 保存错误快照失败:`, snapshotError);
        }
    }

    public async dispose() {
        if (this._browserPromise) {
            try {
                const browser = await this._browserPromise;
                if (browser?.isConnected()) {
                    if (this.config.debug.enabled) logger.info('[Stealth] 正在关闭共享浏览器实例...');
                    await browser.close();
                }
            } catch (error) {
                logger.warn('[Stealth] 关闭浏览器实例时发生错误:', error);
            }
            this._browserPromise = null;
        }
    }
}
// --- END OF FILE src/puppeteer.ts ---