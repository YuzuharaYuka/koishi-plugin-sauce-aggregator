import { Context } from 'koishi';
import { Config, Searcher, SearchOptions } from '../config';
export declare class SearchHandler {
    private ctx;
    private config;
    private allSearchers;
    private allEnabledSearchers;
    constructor(ctx: Context, config: Config, allSearchers: Record<string, Searcher>, allEnabledSearchers: Searcher[]);
    private performSearch;
    handleDirectSearch(searchers: Searcher[], options: SearchOptions, botUser: any, session: any, collectedErrors: string[]): Promise<string>;
    handleSequentialSearch(searchers: Searcher[], options: SearchOptions, botUser: any, session: any, collectedErrors: string[], sortedEnhancers: any): Promise<string>;
    private attachAdditionalResults;
}
