import { Context } from 'koishi';
import { Searcher, SearchOptions, TraceMoe as TraceMoeConfig } from '../config';
export declare class TraceMoe implements Searcher<TraceMoeConfig.Config> {
    ctx: Context;
    config: TraceMoeConfig.Config;
    debug: boolean;
    name: string;
    constructor(ctx: Context, config: TraceMoeConfig.Config, debug: boolean);
    search(options: SearchOptions): Promise<Searcher.Result[]>;
}
