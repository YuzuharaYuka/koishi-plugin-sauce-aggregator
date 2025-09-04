import { Context } from 'koishi';
import { Searcher, SearchOptions, SauceNAO as SauceNAOConfig, DebugConfig, SearchEngineName, Config } from '../config';
export declare class SauceNAO implements Searcher<SauceNAOConfig.Config> {
    ctx: Context;
    config: SauceNAOConfig.Config;
    debugConfig: DebugConfig;
    readonly name: SearchEngineName;
    private keyIndex;
    private timeout;
    constructor(ctx: Context, config: SauceNAOConfig.Config, debugConfig: DebugConfig, pluginConfig: Config);
    search(options: SearchOptions): Promise<Searcher.Result[]>;
}
