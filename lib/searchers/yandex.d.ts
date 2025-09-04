import { Context } from 'koishi';
import { Searcher, SearchOptions, Yandex as YandexConfig, DebugConfig, SearchEngineName } from '../config';
import type { PuppeteerManager } from '../puppeteer';
export declare class Yandex implements Searcher<YandexConfig.Config> {
    ctx: Context;
    config: YandexConfig.Config;
    debugConfig: DebugConfig;
    readonly name: SearchEngineName;
    private puppeteer;
    constructor(ctx: Context, config: YandexConfig.Config, debugConfig: DebugConfig, puppeteerManager: PuppeteerManager);
    search(options: SearchOptions): Promise<Searcher.Result[]>;
}
