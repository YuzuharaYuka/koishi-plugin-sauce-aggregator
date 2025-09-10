import { Context } from 'koishi';
import { Searcher, SearchOptions, SauceNAO as SauceNAOConfig, DebugConfig, SearchEngineName } from '../config';
export declare class SauceNAO implements Searcher<SauceNAOConfig.Config> {
    ctx: Context;
    config: SauceNAOConfig.Config;
    debugConfig: DebugConfig;
    readonly name: SearchEngineName;
    private keyIndex;
    private timeout;
    constructor(ctx: Context, config: SauceNAOConfig.Config, debugConfig: DebugConfig, requestTimeout: number);
    search(options: SearchOptions): Promise<Searcher.Result[]>;
}
