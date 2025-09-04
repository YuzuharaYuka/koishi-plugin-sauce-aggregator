import { Context } from 'koishi';
import { Searcher, SearchOptions, Ascii2D as Ascii2DConfig, DebugConfig, SearchEngineName } from '../config';
import type { PuppeteerManager } from '../puppeteer';
export declare class Ascii2D implements Searcher<Ascii2DConfig.Config> {
    ctx: Context;
    config: Ascii2DConfig.Config;
    debugConfig: DebugConfig;
    readonly name: SearchEngineName;
    private puppeteer;
    constructor(ctx: Context, config: Ascii2DConfig.Config, debugConfig: DebugConfig, puppeteerManager: PuppeteerManager);
    search(options: SearchOptions): Promise<Searcher.Result[]>;
    private parseResults;
}
