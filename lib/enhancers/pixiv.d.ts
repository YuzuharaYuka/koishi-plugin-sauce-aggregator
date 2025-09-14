import { Context } from 'koishi';
import { Pixiv as PixivConfig, Enhancer, EnhancedResult, Searcher, DebugConfig } from '../config';
export declare class PixivEnhancer implements Enhancer<PixivConfig.Config> {
    ctx: Context;
    config: PixivConfig.Config;
    debugConfig: DebugConfig;
    readonly name: 'pixiv';
    private api;
    constructor(ctx: Context, config: PixivConfig.Config, debugConfig: DebugConfig, requestTimeout: number);
    enhance(result: Searcher.Result): Promise<EnhancedResult | null>;
    private findPixivUrl;
    private parsePostId;
    private buildDetailNodes;
}
