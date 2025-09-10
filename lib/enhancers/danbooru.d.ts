import { Context } from 'koishi';
import { Danbooru as DanbooruConfig, Enhancer, EnhancedResult, Searcher, DebugConfig } from '../config';
import type { PuppeteerManager } from '../puppeteer';
export declare class DanbooruEnhancer implements Enhancer<DanbooruConfig.Config> {
    ctx: Context;
    config: DanbooruConfig.Config;
    debugConfig: DebugConfig;
    readonly name: 'danbooru';
    private puppeteer;
    constructor(ctx: Context, config: DanbooruConfig.Config, debugConfig: DebugConfig, puppeteerManager: PuppeteerManager);
    enhance(result: Searcher.Result): Promise<EnhancedResult | null>;
    private findDanbooruUrl;
    private parsePostId;
    private buildDetailNodes;
}
