import { Context } from 'koishi';
import { Searcher, SearchOptions, TraceMoe as TraceMoeConfig, DebugConfig, SearchEngineName, Config } from '../config';
export declare class TraceMoe implements Searcher<TraceMoeConfig.Config> {
    ctx: Context;
    config: TraceMoeConfig.Config;
    debugConfig: DebugConfig;
    readonly name: SearchEngineName;
    private timeout;
    constructor(ctx: Context, config: TraceMoeConfig.Config, debugConfig: DebugConfig, pluginConfig: Config);
    search(options: SearchOptions): Promise<Searcher.Result[]>;
}
