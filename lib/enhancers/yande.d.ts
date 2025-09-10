import { Context } from 'koishi';
import { YandeRe as YandeReConfig, Enhancer, EnhancedResult, Searcher, DebugConfig } from '../config';
export declare class YandeReEnhancer implements Enhancer<YandeReConfig.Config> {
    ctx: Context;
    config: YandeReConfig.Config;
    debugConfig: DebugConfig;
    readonly name: 'yandere';
    private timeout;
    constructor(ctx: Context, config: YandeReConfig.Config, debugConfig: DebugConfig, requestTimeout: number);
    enhance(result: Searcher.Result): Promise<EnhancedResult | null>;
    private findYandeReUrl;
    private parsePostId;
    private buildDetailNodes;
}
