import { Context, Logger } from 'koishi'
import { Config } from './config'
import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import find from 'puppeteer-finder';
import type { Browser, Page, ScreenshotOptions } from 'puppeteer-core';
import { promises as fs } from 'fs';
import path from 'path';
import { formatNetworkError } from './utils'

const logger = new Logger('sauce-aggregator:puppeteer')

puppeteer.use(StealthPlugin())

// 负责管理 Puppeteer 浏览器实例的生命周期、并发和页面创建
export class PuppeteerManager {
    private _browser: Browser | null = null;
    private _browserPromise: Promise<Browser> | null = null;
    private _wsEndpoint: string | null = null;
    private ctx: Context;
    private config: Config;
    private _isInitialized = false;
    private _closeTimer: NodeJS.Timeout | null = null;
    private _restartTimer: NodeJS.Timeout | null = null;
    private _browserPath: string | null = null; // [FEAT] 新增浏览器路径缓存

    constructor(ctx: Context, config: Config) {
        this.ctx = ctx;
        this.config = config;
    }

    public async initialize(): Promise<void> {
        if (this._isInitialized || !this.config.puppeteer.persistentBrowser) return;

        logger.info('正在预初始化常驻浏览器实例...');
        try {
            await this.ensureBrowserIsReady();
            this._isInitialized = true;
            this._scheduleRestart();
            logger.info('常驻浏览器实例已成功预初始化。');
        } catch (error) {
            logger.error('预初始化常驻浏览器实例失败:', error);
        }
    }

    // [FEAT] 优化 getBrowserPath 方法以使用缓存
    private async getBrowserPath(): Promise<string | null> {
        const customPath = this.config.puppeteer.chromeExecutablePath;
        if (customPath) {
            if (this.config.debug.enabled) logger.info(`使用用户配置的浏览器路径: ${customPath}`);
            return customPath;
        }

        if (this._browserPath) {
            if (this.config.debug.enabled) logger.info(`使用缓存的浏览器路径: ${this._browserPath}`);
            return this._browserPath;
        }
        
        try {
            if (this.config.debug.enabled) logger.info('正在自动检测浏览器...');
            const browserPath = await find();
            logger.info(`自动检测到浏览器路径: ${browserPath}`);
            this._browserPath = browserPath; // 缓存路径
            return browserPath;
        } catch (error) {
            logger.warn('puppeteer-finder 未能找到任何浏览器:', error);
            return null;
        }
    }
    
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
            protocolTimeout: launchTimeout,
            timeout: launchTimeout,
        });
    }

    private launchBrowser(): Promise<Browser> {
        const launchTimeout = this.config.puppeteer.browserLaunchTimeout * 1000;
        
        const timeoutPromise = new Promise<Browser>((_, reject) => 
            setTimeout(() => reject(new Error(`浏览器启动在 ${this.config.puppeteer.browserLaunchTimeout} 秒内未能完成，操作已超时。`)), launchTimeout)
        );

        return Promise.race([this._launchBrowserInternal(), timeoutPromise]);
    }
    
    private ensureBrowserIsReady(): Promise<Browser> {
        if (this._closeTimer) {
            clearTimeout(this._closeTimer);
            this._closeTimer = null;
        }

        if (this._browser && this._browser.connected) {
            return Promise.resolve(this._browser);
        }

        if (this._browserPromise) {
            return this._browserPromise;
        }

        logger.info('浏览器实例不存在或已断开，正在启动或重建...');
        
        this._browserPromise = (async () => {
            if (this._browser) {
                await this.dispose().catch(err => logger.warn('在重建浏览器前，清理旧实例时出错:', err.message));
            }
            
            try {
                const browser = await this.launchBrowser();
                logger.info('新的浏览器实例已成功启动。');
                this._browser = browser;
                this._wsEndpoint = browser.wsEndpoint();

                browser.on('disconnected', () => {
                    logger.warn('浏览器实例连接已断开。');
                    if (this._browser === browser) {
                        this._browser = null;
                        this._browserPromise = null;
                        this._wsEndpoint = null;
                    }
                });
                this._browserPromise = null;
                return browser;
            } catch (error) {
                logger.error('启动浏览器实例时发生严重错误:', error.message);
                this._browser = null;
                this._browserPromise = null; 
                this._wsEndpoint = null;
                throw error;
            }
        })();
        
        return this._browserPromise;
    }
    
    private async scheduleClose() {
        if (this.config.puppeteer.persistentBrowser || this._closeTimer) return;
        if (!this._browser) return;

        try {
            const pages = await this._browser.pages();
            if (pages.length > 1) {
                if (this.config.debug.enabled) logger.info(`仍有 ${pages.length - 1} 个活动页面，暂不调度关闭。`);
                return;
            }
        } catch(e) {
             logger.warn('调度关闭浏览器时检查页面失败 (可能是浏览器已关闭):', e.message);
             return;
        }

        const timeout = this.config.puppeteer.browserCloseTimeout * 1000;
        if (timeout <= 0) {
            if (this.config.debug.enabled) logger.info('关闭延迟为0，立即关闭浏览器。');
            await this.dispose();
            return;
        }

        if (this.config.debug.enabled) logger.info(`所有页面已关闭，将在 ${timeout / 1000} 秒后检查并关闭浏览器。`);
        
        this._closeTimer = setTimeout(async () => {
            this._closeTimer = null; 
            if (!this._browser || !this._browser.connected) return;

            try {
                const currentPages = await this._browser.pages();
                if (currentPages.length > 1) { 
                    if (this.config.debug.enabled) logger.info('空闲超时检查：检测到新的活动页面，取消本次关闭。');
                    return;
                }

                if (this.config.debug.enabled) logger.info('空闲超时，正在关闭浏览器实例...');
                await this.dispose();

            } catch (error) {
                logger.warn('执行延迟关闭浏览器时检查页面失败:', error.message);
                await this.dispose();
            }
        }, timeout);
    }

    private _scheduleRestart(): void {
        if (!this.config.puppeteer.persistentBrowser || this.config.puppeteer.restartInterval <= 0) {
            return;
        }
        if (this._restartTimer) clearTimeout(this._restartTimer);

        const intervalMs = this.config.puppeteer.restartInterval * 60 * 60 * 1000;
        logger.info(`浏览器实例将在 ${this.config.puppeteer.restartInterval} 小时后进行下一次计划重启。`);

        this._restartTimer = setTimeout(() => this._performRestart(), intervalMs);
    }

    private async _performRestart(): Promise<void> {
        logger.info('开始执行计划中的浏览器重启...');
        
        if (!this._browser || !this._browser.connected) {
            logger.warn('计划重启时浏览器已关闭或未连接，将直接尝试重新初始化。');
        } else {
            try {
                const pages = await this._browser.pages();
                if (pages.length > 1) {
                    logger.info('检测到浏览器正在使用中，重启将推迟 1 分钟。');
                    this._restartTimer = setTimeout(() => this._performRestart(), 60 * 1000);
                    return;
                }
            } catch (error) {
                logger.warn('检查浏览器页面时出错，将继续强制重启:', error.message);
            }
        }

        try {
            await this.dispose();
            await this.ensureBrowserIsReady();
            logger.info('浏览器计划性重启成功。');
        } catch (error) {
            logger.error('浏览器计划性重启失败:', error.message);
        } finally {
            this._scheduleRestart();
        }
    }

    public async getPage(): Promise<Page> {
        if (this._closeTimer) {
            clearTimeout(this._closeTimer);
            this._closeTimer = null;
            if (this.config.debug.enabled) logger.info('检测到新的页面请求，已取消待处理的浏览器关闭计划。');
        }

        try {
            const browser = await this.ensureBrowserIsReady();
            const page = await browser.newPage();
            page.setDefaultTimeout(this.config.requestTimeout * 1000);
            await page.setBypassCSP(true);
            
            // [FEAT] 集中化请求拦截策略
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                const resourceType = req.resourceType();
                // 拦截图片、样式表、字体和媒体文件以提升加载速度
                if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                    req.abort();
                } else {
                    req.continue();
                }
            });

            page.on('close', () => {
                if (!this.config.puppeteer.persistentBrowser) {
                    this.scheduleClose();
                }
            });

            return page;
        } catch (error) {
            logger.error('获取新页面时发生严重错误:', formatNetworkError(error));
            throw error;
        }
    }

    public async createTempFile(buffer: Buffer, fileName: string): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
        const customPath = this.config.puppeteer.tempPath;
        const baseDir = customPath 
            ? path.resolve(customPath)
            : path.resolve(this.ctx.baseDir, 'data', 'temp', 'sauce-aggregator');

        const tempFilePath = path.join(baseDir, `sauce-aggregator-${Date.now()}-${fileName}`);
        
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
        if (this._closeTimer) clearTimeout(this._closeTimer);
        if (this._restartTimer) clearTimeout(this._restartTimer);

        const browserToClose = this._browser;
        this._browser = null;
        this._browserPromise = null;
        this._wsEndpoint = null;
        this._closeTimer = null;
        this._restartTimer = null;

        if (browserToClose) {
            if (this.config.debug.enabled) logger.info('正在关闭浏览器实例...');
            try {
                if (browserToClose.connected) {
                    await browserToClose.close();
                    if (this.config.debug.enabled) logger.info('浏览器实例已成功关闭。');
                }
            } catch (error) {
                logger.warn('关闭浏览器实例时发生错误:', error.message);
            }
        }
    }
}