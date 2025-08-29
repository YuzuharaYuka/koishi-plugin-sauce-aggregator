import { Context } from 'koishi';
import { Searcher, SearchOptions, SauceNAO as SauceNAOConfig } from '../config';
export declare class SauceNAO implements Searcher<SauceNAOConfig.Config> {
    ctx: Context;
    config: SauceNAOConfig.Config;
    debug: boolean;
    name: string;
    private keyIndex;
    constructor(ctx: Context, config: SauceNAOConfig.Config, debug: boolean);
    search(options: SearchOptions): Promise<Searcher.Result[]>;
}
