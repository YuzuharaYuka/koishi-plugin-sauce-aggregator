import { Context, Logger } from 'koishi'
import { Config } from './config'
import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import find from 'puppeteer-finder';
import type { Browser, Page, ScreenshotOptions } from 'puppeteer-core';
import { promises as fs } from 'fs';
import path from 'path';

const logger = new Logger('sauce-aggregator:puppeteer')

puppeteer.use(StealthPlugin())

// 负责管理 Puppeteer 浏览器实例的生命周期、并发和页面创建
export class PuppeteerManager {
    private _browserPromise: Promise<Browser> | null = null;
    private ctx: Context;
    private config: Config;
    private _isInitialized = false;
    private _closeTimer: NodeJS.Timeout | null = null;

    constructor(ctx: Context, config: Config) {
        this.ctx = ctx;
        this.config = config;
    }

    public async initialize(): Promise<void> {
        if (this._isInitialized || !this.config.puppeteer.persistentBrowser) return;

        logger.info('正在预初始化常驻浏览器实例...');
        try {
            await this.getBrowser();
            this._isInitialized = true;
            logger.info('常驻浏览器实例已成功预初始化。');
        } catch (error) {
            logger.error('预初始化常驻浏览器实例失败:', error);
        }
    }

    private async getBrowserPath(): Promise<string | null> {
        const customPath = this.config.puppeteer.chromeExecutablePath;
        if (customPath) {
            if (this.config.debug.enabled) logger.info(`使用用户配置的浏览器路径: ${customPath}`);
            return customPath;
        }
        
        try {
            if (this.config.debug.enabled) logger.info('正在自动检测浏览器...');
            const browserPath = await find();
            logger.info(`自动检测到浏览器路径: ${browserPath}`);
            return browserPath;
        } catch (error) {
            logger.warn('puppeteer-finder 未能找到任何浏览器:', error);
            return null;
        }
    }

    private async launchBrowser(): Promise<Browser> {
        const executablePath = await this.getBrowserPath();
        if (!executablePath) {
            throw new Error('未能找到任何兼容的浏览器。请在插件的浏览器设置中手动指定路径。');
        }
        
        const launchTimeout = this.config.puppeteer.browserLaunchTimeout * 1000;
        
        const args = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-infobars',
            '--window-size=1920,1080',
            '--lang=en-US,en',
        ];

        // [FIX] 彻底移除对 ctx.http.config 的所有错误访问，只依赖插件自身的代理配置
        const proxyUrl = this.config.proxy;
        if (proxyUrl) {
            if (this.config.debug.enabled) logger.info(`[puppeteer] 将使用独立代理: ${proxyUrl}`);
            args.push(`--proxy-server=${proxyUrl}`);
        }

        const browser = await puppeteer.launch({
            headless: true,
            args: args,
            executablePath: executablePath,
            protocolTimeout: launchTimeout,
            timeout: launchTimeout,
        });

        browser.on('disconnected', () => {
            logger.warn('共享浏览器实例已断开连接。');
            this._browserPromise = null;
        });
        return browser;
    }

    private getBrowser(): Promise<Browser> {
        if (this._closeTimer) {
            clearTimeout(this._closeTimer);
            this._closeTimer = null;
            if (this.config.debug.enabled) logger.info('浏览器被再次使用，已取消自动关闭。');
        }

        if (this._browserPromise) {
            return this._browserPromise.then(browser => {
                if (browser.isConnected()) {
                    return browser;
                }
                if (this.config.debug.enabled) logger.info('共享浏览器实例已断开，正在启动新的实例...');
                this._browserPromise = this.launchBrowser().catch(err => {
                    this._browserPromise = null; 
                    throw err;
                });
                return this._browserPromise;
            });
        }
        if (this.config.debug.enabled) logger.info('共享浏览器实例不存在，正在启动...');
        this._browserPromise = this.launchBrowser().catch(err => {
            this._browserPromise = null; 
            throw err;
        });
        return this._browserPromise;
    }
    
    private async scheduleClose() {
        if (this.config.puppeteer.persistentBrowser || this._closeTimer) return;

        const browser = await this.getBrowser();
        if ((await browser.pages()).length > 1) {
            if (this.config.debug.enabled) logger.info(`仍有 ${(await browser.pages()).length - 1} 个活动页面，暂不关闭。`);
            return;
        }

        const timeout = this.config.puppeteer.browserCloseTimeout * 1000;
        if (timeout <= 0) {
             if (this.config.debug.enabled) logger.info('关闭延迟为0，立即关闭浏览器。');
             this.dispose();
             return;
        }

        if (this.config.debug.enabled) logger.info(`所有页面已关闭，将在 ${timeout / 1000} 秒后自动关闭浏览器。`);
        this._closeTimer = setTimeout(() => {
            if (this.config.debug.enabled) logger.info('空闲超时，正在关闭浏览器实例...');
            this.dispose();
            this._closeTimer = null;
        }, timeout);
    }

    public async getPage(): Promise<Page> {
        const browser = await this.getBrowser();
        const page = await browser.newPage();
        page.setDefaultTimeout(this.config.requestTimeout * 1000);
        await page.setBypassCSP(true);
        
        if (!this.config.puppeteer.persistentBrowser) {
            page.on('close', () => this.scheduleClose());
        }

        return page;
    }

    public async createTempFile(buffer: Buffer, fileName: string): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
        const tempFilePath = path.resolve(this.ctx.baseDir, 'data', 'temp', 'sauce-aggregator', `sauce-aggregator-${Date.now()}-${fileName}`);
        await fs.mkdir(path.dirname(tempFilePath), { recursive: true });
        await fs.writeFile(tempFilePath, buffer);
        if (this.config.debug.enabled) logger.info(`已创建临时文件: ${tempFilePath}`);
    
        const cleanup = async () => {
            try {
                await fs.unlink(tempFilePath);
                if (this.config.debug.enabled) logger.info(`已清理临时文件: ${tempFilePath}`);
            } catch (unlinkError) {
                logger.warn(`清理临时文件失败 ${tempFilePath}:`, unlinkError);
            }
        };
    
        return { filePath: tempFilePath, cleanup };
    }
    
    public async checkForCloudflare(page: Page): Promise<boolean> {
        try {
            const title = await page.title();
            if (/Just a moment|Checking your browser/i.test(title)) {
                if (this.config.debug.enabled) logger.info('检测到 Cloudflare 页面 (基于标题)。');
                return true;
            }

            const verificationTextSelector = '::-p-text("Verifying you are human")';
            const securityReviewTextSelector = '::-p-text("needs to review the security of your connection")';
            
            const challengeElement = await Promise.race([
                page.waitForSelector(verificationTextSelector, { timeout: 1000 }).catch(() => null),
                page.waitForSelector(securityReviewTextSelector, { timeout: 1000 }).catch(() => null),
            ]);

            if (challengeElement) {
                if (this.config.debug.enabled) logger.info('检测到 Cloudflare 页面 (基于可见文本内容)。');
                return true;
            }
        } catch (error) {
            if (this.config.debug.enabled) logger.warn('Cloudflare 检测时发生错误:', error.message);
        }
        return false;
    }

    public async saveErrorSnapshot(page: Page, contextName: string): Promise<void> {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const logDir = path.resolve(this.ctx.baseDir, 'data', 'sauce-aggregator', 'logs');
            await fs.mkdir(logDir, { recursive: true });

            const screenshotPath = path.resolve(logDir, `${contextName}-error-${timestamp}.png`);
            const htmlPath = path.resolve(logDir, `${contextName}-error-${timestamp}.html`);
            
            await page.screenshot({ path: screenshotPath, fullPage: true } as ScreenshotOptions);
            const htmlContent = await page.content();
            await fs.writeFile(htmlPath, htmlContent);

            logger.info(`[${contextName}] 已保存错误快照: ${screenshotPath}`);
            logger.info(`[${contextName}] 已保存错误页面HTML: ${htmlPath}`);
        } catch (snapshotError) {
            logger.error(`[${contextName}] 保存错误快照失败:`, snapshotError);
        }
    }

    public async dispose() {
        if (this._closeTimer) {
            clearTimeout(this._closeTimer);
            this._closeTimer = null;
        }

        if (this._browserPromise) {
            try {
                const browser = await this._browserPromise;
                if (browser?.isConnected()) {
                    if (this.config.debug.enabled) logger.info('正在关闭共享浏览器实例...');
                    await browser.close();
                }
            } catch (error) {
                logger.warn('关闭浏览器实例时发生错误:', error);
            }
            this._browserPromise = null;
        }
    }
}