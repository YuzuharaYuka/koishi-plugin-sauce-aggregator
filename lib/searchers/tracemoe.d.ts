import { Context } from 'koishi';
import { Searcher, SearchOptions, TraceMoe as TraceMoeConfig, DebugConfig, SearchEngineName } from '../config';
export declare class TraceMoe implements Searcher<TraceMoeConfig.Config> {
    ctx: Context;
    config: TraceMoeConfig.Config;
    debugConfig: DebugConfig;
    readonly name: SearchEngineName;
    private timeout;
    constructor(ctx: Context, config: TraceMoeConfig.Config, debugConfig: DebugConfig, requestTimeout: number);
    search(options: SearchOptions): Promise<Searcher.Result[]>;
}
