import { Context } from 'koishi';
import { Config } from './config';
import type { Page } from 'puppeteer-core';
export declare class PuppeteerManager {
    private _browserPromise;
    private ctx;
    private config;
    private _isInitialized;
    private _closeTimer;
    constructor(ctx: Context, config: Config);
    initialize(): Promise<void>;
    private getBrowserPath;
    private launchBrowser;
    private getBrowser;
    private scheduleClose;
    getPage(): Promise<Page>;
    saveErrorSnapshot(page: Page, contextName: string): Promise<void>;
    dispose(): Promise<void>;
}
