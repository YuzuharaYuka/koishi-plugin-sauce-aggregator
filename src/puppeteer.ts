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
    private _isInitialized = false;
    private _closeTimer: NodeJS.Timeout | null = null; // --- THIS IS THE FIX ---: Timer for auto-closing

    constructor(ctx: Context, config: Config) {
        this.ctx = ctx;
        this.config = config;
    }

    public async initialize(): Promise<void> {
        // --- THIS IS THE FIX ---: Only initialize in persistent mode
        if (this._isInitialized || !this.config.puppeteer.persistentBrowser) return;

        logger.info('[Stealth] 正在预初始化常驻浏览器实例...');
        try {
            await this.getBrowser();
            this._isInitialized = true;
            logger.info('[Stealth] 常驻浏览器实例已成功预初始化。');
        } catch (error) {
            logger.error('[Stealth] 预初始化常驻浏览器实例失败:', error);
        }
    }

    private async getBrowserPath(): Promise<string | null> {
        const customPath = this.config.puppeteer.chromeExecutablePath;
        if (customPath) {
            if (this.config.debug.enabled) logger.info(`[Stealth] 使用用户配置的浏览器路径: ${customPath}`);
            return customPath;
        }
        
        try {
            if (this.config.debug.enabled) logger.info('[Stealth] 正在使用 puppeteer-finder 自动检测浏览器...');
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
            throw new Error('未能找到任何兼容的浏览器。请在插件的浏览器设置中手动指定路径。');
        }
        
        const launchTimeout = this.config.puppeteer.browserLaunchTimeout * 1000;
        const browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                `--user-agent=${USER_AGENT}`
            ],
            executablePath: executablePath,
            protocolTimeout: launchTimeout,
            timeout: this.config.requestTimeout * 1000,
        });

        browser.on('disconnected', () => {
            logger.warn('[Stealth] 共享浏览器实例已断开连接。');
            this._browserPromise = null;
        });
        return browser;
    }

    private getBrowser(): Promise<Browser> {
        // --- THIS IS THE FIX ---: Cancel any pending auto-close timer on access
        if (this._closeTimer) {
            clearTimeout(this._closeTimer);
            this._closeTimer = null;
            if (this.config.debug.enabled) logger.info('[Stealth] [按需模式] 浏览器被再次使用，已取消自动关闭。');
        }

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
    
    // --- THIS IS THE FIX ---: New method to schedule browser closing
    private async scheduleClose() {
        if (this.config.puppeteer.persistentBrowser || this._closeTimer) return;

        const browser = await this.getBrowser();
        // The first page is always about:blank, so we check if there are more than 1 pages.
        if ((await browser.pages()).length > 1) {
            if (this.config.debug.enabled) logger.info(`[Stealth] [按需模式] 仍有 ${(await browser.pages()).length - 1} 个活动页面，暂不关闭。`);
            return;
        }

        const timeout = this.config.puppeteer.browserCloseTimeout * 1000;
        if (timeout <= 0) {
             if (this.config.debug.enabled) logger.info('[Stealth] [按需模式] 关闭延迟为0，立即关闭浏览器。');
             this.dispose();
             return;
        }

        if (this.config.debug.enabled) logger.info(`[Stealth] [按需模式] 所有页面已关闭，将在 ${timeout / 1000} 秒后自动关闭浏览器。`);
        this._closeTimer = setTimeout(() => {
            if (this.config.debug.enabled) logger.info('[Stealth] [按需模式] 空闲超时，正在关闭浏览器实例...');
            this.dispose();
            this._closeTimer = null;
        }, timeout);
    }

    public async getPage(): Promise<Page> {
        const browser = await this.getBrowser();
        const page = await browser.newPage();
        page.setDefaultTimeout(this.config.requestTimeout * 1000);
        await page.setBypassCSP(true);
        
        // --- THIS IS THE FIX ---: Attach a listener to schedule closing when a page closes
        if (!this.config.puppeteer.persistentBrowser) {
            page.on('close', () => this.scheduleClose());
        }

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
        // --- THIS IS THE FIX ---: Ensure timer is cleared on manual dispose
        if (this._closeTimer) {
            clearTimeout(this._closeTimer);
            this._closeTimer = null;
        }

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