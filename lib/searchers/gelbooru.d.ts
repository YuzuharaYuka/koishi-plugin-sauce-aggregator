import { Context } from 'koishi';
import { Gelbooru as GelbooruConfig, Enhancer, EnhancedResult, Searcher } from '../config';
export declare class GelbooruEnhancer implements Enhancer<GelbooruConfig.Config> {
    ctx: Context;
    config: GelbooruConfig.Config;
    debug: boolean;
    readonly name: 'gelbooru';
    constructor(ctx: Context, config: GelbooruConfig.Config, debug: boolean);
    enhance(result: Searcher.Result): Promise<EnhancedResult | null>;
    private findGelbooruUrl;
    private parseParam;
    private getImageType;
    private buildDetailNodes;
}
