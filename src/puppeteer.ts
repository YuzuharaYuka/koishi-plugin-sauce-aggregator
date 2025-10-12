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
    private _browser: Browser | null = null;
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
    
    // [FIX] 将原始启动逻辑封装，以便添加超时
    private async _launchBrowserInternal(): Promise<Browser> {
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

        const proxyUrl = this.config.proxy;
        if (proxyUrl) {
            if (this.config.debug.enabled) logger.info(`[puppeteer] 将使用独立代理: ${proxyUrl}`);
            args.push(`--proxy-server=${proxyUrl}`);
        }

        return puppeteer.launch({
            headless: true,
            args: args,
            executablePath: executablePath,
            protocolTimeout: launchTimeout, // puppeteer 内部的协议超时
            timeout: launchTimeout, // puppeteer 内部的启动超时
        });
    }

    // [FIX] 使用 Promise.race 为浏览器启动添加一个硬性超时
    private launchBrowser(): Promise<Browser> {
        const launchTimeout = this.config.puppeteer.browserLaunchTimeout * 1000;
        
        return Promise.race([
            this._launchBrowserInternal(),
            new Promise<Browser>((_, reject) => 
                setTimeout(() => reject(new Error(`浏览器启动在 ${this.config.puppeteer.browserLaunchTimeout} 秒内未能完成，操作已超时。`)), launchTimeout)
            )
        ]);
    }

    private getBrowser(): Promise<Browser> {
        if (this._closeTimer) {
            clearTimeout(this._closeTimer);
            this._closeTimer = null;
            if (this.config.debug.enabled) logger.info('浏览器被再次使用，已取消自动关闭。');
        }

        if (this._browser && this._browser.isConnected()) {
            return Promise.resolve(this._browser);
        }

        if (this._browserPromise) {
            return this._browserPromise;
        }

        if (this.config.debug.enabled) logger.info('共享浏览器实例不存在或已断开，正在启动...');
        
        this._browserPromise = (async () => {
            try {
                // [FIX] 现在 launchBrowser() 拥有了可靠的超时机制
                const browser = await this.launchBrowser();
                this._browser = browser; // 存储已成功启动的实例
                browser.on('disconnected', () => {
                    logger.warn('共享浏览器实例已断开连接。');
                    if (this._browser === browser) {
                        this._browser = null;
                        this._browserPromise = null;
                    }
                });
                return browser;
            } catch (error) {
                // [FIX] 无论启动失败还是超时，都会进入这里，保证状态被重置
                logger.error('启动浏览器实例时发生严重错误:', error.message);
                this._browser = null;
                this._browserPromise = null; 
                throw error; // 将错误向上抛出，让调用方知道失败了
            }
        })();
        
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
             await this.dispose();
             return;
        }

        if (this.config.debug.enabled) logger.info(`所有页面已关闭，将在 ${timeout / 1000} 秒后自动关闭浏览器。`);
        this._closeTimer = setTimeout(async () => {
            if (this.config.debug.enabled) logger.info('空闲超时，正在关闭浏览器实例...');
            await this.dispose();
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

        const browserPromise = this._browserPromise;
        // 立即重置状态，防止新的请求进入
        this._browser = null;
        this._browserPromise = null;

        if (browserPromise) {
            if (this.config.debug.enabled) logger.info('正在等待浏览器任务完成并关闭...');
            try {
                const browser = await browserPromise;
                if (browser?.isConnected()) {
                    await browser.close();
                    if (this.config.debug.enabled) logger.info('浏览器实例已成功关闭。');
                }
            } catch (error) {
                logger.warn('关闭浏览器实例时发生错误 (可能是在启动过程中):', error.message);
            }
        }
    }
}