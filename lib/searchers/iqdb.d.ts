import { Context } from 'koishi';
import { Searcher, SearchOptions, IQDB as IQDBConfig, DebugConfig, SearchEngineName } from '../config';
export declare class IQDB implements Searcher<IQDBConfig.Config> {
    ctx: Context;
    config: IQDBConfig.Config;
    debugConfig: DebugConfig;
    readonly name: SearchEngineName;
    private timeout;
    constructor(ctx: Context, config: IQDBConfig.Config, debugConfig: DebugConfig, requestTimeout: number);
    search(options: SearchOptions): Promise<Searcher.Result[]>;
}
