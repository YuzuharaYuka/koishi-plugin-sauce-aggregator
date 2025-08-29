import { Context } from 'koishi';
import { YandeRe as YandeReConfig, Enhancer, EnhancedResult, Searcher } from '../config';
export declare class YandeReEnhancer implements Enhancer<YandeReConfig.Config> {
    ctx: Context;
    config: YandeReConfig.Config;
    debug: boolean;
    readonly name: 'yandere';
    constructor(ctx: Context, config: YandeReConfig.Config, debug: boolean);
    enhance(result: Searcher.Result): Promise<EnhancedResult | null>;
    private findYandeReUrl;
    private parsePostId;
    private getImageType;
    private buildDetailNodes;
}
