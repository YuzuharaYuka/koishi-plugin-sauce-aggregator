import { Context } from 'koishi';
import { Config } from './config';
import type { Page } from 'puppeteer-core';
export declare class PuppeteerManager {
    private _browserPromise;
    private ctx;
    private config;
    constructor(ctx: Context, config: Config);
    private getBrowserPath;
    private launchBrowser;
    private getBrowser;
    getPage(): Promise<Page>;
    dispose(): Promise<void>;
}
