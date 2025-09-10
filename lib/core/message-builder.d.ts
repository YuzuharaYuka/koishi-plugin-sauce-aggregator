import { Context, h } from 'koishi';
import { Config, Enhancer, SearchEngineName, Searcher as SearcherResult } from '../config';
export declare function createResultContent(ctx: Context, result: SearcherResult.Result, engineName?: SearchEngineName): Promise<h[]>;
export declare function buildLowConfidenceNode(ctx: Context, result: SearcherResult.Result, engineName: SearchEngineName, botUser: any): Promise<h>;
export declare function buildHighConfidenceMessage(figureMessage: h, ctx: Context, config: Config, sortedEnhancers: Enhancer[], result: SearcherResult.Result, engineName: SearchEngineName, botUser: any): Promise<void>;
export declare function sendFigureMessage(session: any, figureMessage: h, errorMessage: string): Promise<void>;
