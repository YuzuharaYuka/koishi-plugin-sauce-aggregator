import { Context } from 'koishi';
import { Searcher, SearchOptions, IQDB as IQDBConfig } from '../config';
export declare class IQDB implements Searcher<IQDBConfig.Config> {
    ctx: Context;
    config: IQDBConfig.Config;
    debug: boolean;
    name: string;
    constructor(ctx: Context, config: IQDBConfig.Config, debug: boolean);
    search(options: SearchOptions): Promise<Searcher.Result[]>;
}
