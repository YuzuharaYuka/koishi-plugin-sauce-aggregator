import { Context } from 'koishi';
import { Searcher, SearchOptions, IQDB as IQDBConfig, DebugConfig, SearchEngineName, Config } from '../config';
export declare class IQDB implements Searcher<IQDBConfig.Config> {
    ctx: Context;
    config: IQDBConfig.Config;
    debugConfig: DebugConfig;
    readonly name: SearchEngineName;
    private timeout;
    constructor(ctx: Context, config: IQDBConfig.Config, debugConfig: DebugConfig, pluginConfig: Config);
    search(options: SearchOptions): Promise<Searcher.Result[]>;
}
