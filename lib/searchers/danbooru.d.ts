import { Context } from 'koishi';
import { Danbooru as DanbooruConfig, Enhancer, EnhancedResult, Searcher } from '../config';
export declare class DanbooruEnhancer implements Enhancer<DanbooruConfig.Config> {
    ctx: Context;
    config: DanbooruConfig.Config;
    debug: boolean;
    name: string;
    constructor(ctx: Context, config: DanbooruConfig.Config, debug: boolean);
    enhance(result: Searcher.Result): Promise<EnhancedResult | null>;
    private findDanbooruUrl;
    private parsePostId;
    private getImageType;
    private buildDetailNodes;
}
