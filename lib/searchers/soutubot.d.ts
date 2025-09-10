import { Context } from 'koishi';
import { Searcher, SearchOptions, DebugConfig, SearchEngineName } from '../config';
import type { PuppeteerManager } from '../puppeteer';
export declare namespace SoutuBot {
    interface Config {
        confidenceThreshold?: number;
        maxHighConfidenceResults?: number;
    }
}
export declare class SoutuBot implements Searcher<SoutuBot.Config> {
    ctx: Context;
    config: SoutuBot.Config;
    debugConfig: DebugConfig;
    readonly name: SearchEngineName;
    private puppeteer;
    constructor(ctx: Context, config: SoutuBot.Config, debugConfig: DebugConfig, puppeteerManager: PuppeteerManager);
    search(options: SearchOptions): Promise<Searcher.Result[]>;
    private parseResults;
}
