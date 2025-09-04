import { Context } from 'koishi';
import { Gelbooru as GelbooruConfig, Enhancer, EnhancedResult, Searcher, DebugConfig, Config } from '../config';
export declare class GelbooruEnhancer implements Enhancer<GelbooruConfig.Config> {
    ctx: Context;
    config: GelbooruConfig.Config;
    debugConfig: DebugConfig;
    readonly name: 'gelbooru';
    private timeout;
    constructor(ctx: Context, config: GelbooruConfig.Config, debugConfig: DebugConfig, pluginConfig: Config);
    enhance(result: Searcher.Result): Promise<EnhancedResult | null>;
    private findGelbooruUrl;
    private parseParam;
    private getImageType;
    private buildDetailNodes;
}
