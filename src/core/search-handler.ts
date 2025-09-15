// --- START OF FILE src/core/search-handler.ts ---

import { Context, h, Logger, Session } from 'koishi';
import { Config, Searcher, SearchEngineName, SearchOptions, Searcher as SearcherResult } from '../config';
import * as MessageBuilder from './message-builder';

const logger = new Logger('sauce-aggregator:handler');

export class SearchHandler {
    constructor(
        private ctx: Context,
        private config: Config,
        private allSearchers: Record<string, Searcher>,
        private allEnabledSearchers: Searcher[],
    ) {}

    private async performSearch(searcher: Searcher, options: SearchOptions) {
        try {
          const results = await searcher.search(options);
          return { engine: searcher.name, results, error: null };
        } catch (error) {
          const errorMessage = `[${searcher.name}] 引擎搜索失败: ${error.message}`;
          logger.warn(errorMessage, this.config.debug.enabled ? error : '');
          return { engine: searcher.name, results: [], error: errorMessage };
        }
    }

    public async handleDirectSearch(searchers: Searcher[], options: SearchOptions, botUser, session, collectedErrors: string[]) {
        const searcherOutputs = await Promise.all(searchers.map(async s => {
          const output = await this.performSearch(s, options);
          if (output.error) collectedErrors.push(output.error);
          return output;
        }));
        const successfulOutputs = searcherOutputs.filter(o => o.results.length > 0);
        
        if (successfulOutputs.length === 0) {
          let finalMessage = '未找到任何相关结果。';
          if (collectedErrors.length > 0) {
            finalMessage += '\n\n遇到的问题:\n' + collectedErrors.join('\n');
          }
          return finalMessage;
        }
  
        await session.send('搜索完成，结果如下:');
        const figureMessage = h('figure');
        const nodePromises = successfulOutputs.flatMap(output => {
            const resultNodesPromises = output.results.slice(0, this.config.maxResults).map(result => 
                MessageBuilder.buildLowConfidenceNode(this.ctx, result, output.engine, botUser)
            );
            return resultNodesPromises;
        });
  
        figureMessage.children.push(...await Promise.all(nodePromises));
        await MessageBuilder.sendFigureMessage(session, figureMessage, '合并转发结果失败');
  
        if (collectedErrors.length > 0) {
          await session.send('部分引擎搜索失败:\n' + collectedErrors.join('\n'));
        }
    }

    public async handleSequentialSearch(searchers: Searcher[], options: SearchOptions, botUser, session, collectedErrors: string[], sortedEnhancers) {
        const executedOutputs = [];
        let highConfidenceResults: SearcherResult.Result[] = [];
        let highConfidenceSearcherName: SearchEngineName = null;
        const executedEngineNames = new Set<SearchEngineName>(); 
  
        for (const searcher of searchers) {
            executedEngineNames.add(searcher.name); 
            const output = await this.performSearch(searcher, options);
            if (output.error) collectedErrors.push(output.error);
            if (output.results.length > 0) executedOutputs.push(output);
  
            const engineConfig = this.config[searcher.name] as { confidenceThreshold?: number };
            const specificThreshold = engineConfig?.confidenceThreshold;
            const thresholdToUse = (specificThreshold && specificThreshold > 0) ? specificThreshold : this.config.confidenceThreshold;
            
            const foundResults = output.results.filter(r => r.similarity >= thresholdToUse);
            if (foundResults.length > 0) {
              highConfidenceResults = foundResults;
              highConfidenceSearcherName = searcher.name;
              break;
            }
        }
  
        if (highConfidenceResults.length > 0) {
            let resultsToShow = highConfidenceResults;
            if (highConfidenceSearcherName === 'soutubot') {
                const maxCount = this.config.soutubot.maxHighConfidenceResults || 3;
                resultsToShow = highConfidenceResults.slice(0, maxCount);
                await session.send(`[${highConfidenceSearcherName}] 找到 ${resultsToShow.length} 个高匹配度结果:`);
            } else {
                resultsToShow = [highConfidenceResults[0]];
                await session.send(`[${highConfidenceSearcherName}] 找到高匹配度结果:`);
            }
  
            const figureMessage = h('figure');
            for (const result of resultsToShow) {
                await MessageBuilder.buildHighConfidenceMessage(figureMessage, this.ctx, this.config, sortedEnhancers, result, highConfidenceSearcherName, botUser);
            }
            await this.attachAdditionalResults(executedOutputs, options, botUser, figureMessage, session, collectedErrors);
            await MessageBuilder.sendFigureMessage(session, figureMessage, '发送高匹配度结果失败');
            return;
        }
        
        let finalOutputs = executedOutputs;
        const searchersToRunForLowConfidence = this.allEnabledSearchers
            .filter(s => {
                if (s.name === 'yandex') return !this.config.yandex.alwaysAttach;
                if (s.name === 'ascii2d') return !this.config.ascii2d.alwaysAttach;
                return true;
            })
            .filter(s => !executedEngineNames.has(s.name)); 
  
        if (searchersToRunForLowConfidence.length > 0) {
            const unexecutedOutputs = await Promise.all(searchersToRunForLowConfidence.map(async (s) => {
                const output = await this.performSearch(s, options);
                if (output.error) collectedErrors.push(output.error);
                return output;
            }));
            finalOutputs.push(...unexecutedOutputs.filter(o => o.results.length > 0));
        }
        
        await this.attachAdditionalResults(finalOutputs, options, botUser, null, session, collectedErrors);
        
        if (finalOutputs.length === 0) {
          let finalMessage = '未找到任何相关结果。';
          if (collectedErrors.length > 0) {
            finalMessage += '\n\n遇到的问题:\n' + collectedErrors.join('\n');
          }
          return finalMessage;
        }
  
        await session.send('未找到高匹配度结果，显示如下:');
        const figureMessage = h('figure');
        const nodePromises = finalOutputs.flatMap(output => {
            const resultNodesPromises = output.results.slice(0, this.config.maxResults).map(result => 
                MessageBuilder.buildLowConfidenceNode(this.ctx, result, output.engine, botUser)
            );
            return resultNodesPromises;
        });
        figureMessage.children.push(...await Promise.all(nodePromises));
        await MessageBuilder.sendFigureMessage(session, figureMessage, '合并转发低匹配度结果失败');
  
        if (collectedErrors.length > 0) {
            await session.send('部分引擎搜索失败:\n' + collectedErrors.join('\n'));
        }
    }
    
    private async attachAdditionalResults(executedOutputs, options, botUser, figureMessage, session, collectedErrors: string[]) {
        // --- THIS IS THE FIX ---
        // Explicitly type the array to help TypeScript understand the shape of `eng`.
        const attachEngines: { name: SearchEngineName; config: any; searcher: Searcher }[] = [
            { name: 'yandex', config: this.config.yandex, searcher: this.allSearchers.yandex },
            { name: 'ascii2d', config: this.config.ascii2d, searcher: this.allSearchers.ascii2d }
        ];
        
        for (const eng of attachEngines) {
            if (eng.config.alwaysAttach && eng.searcher) {
                let output = executedOutputs.find(o => o.engine === eng.name);
                if (!output) {
                    output = await this.performSearch(eng.searcher, options);
                    if(output.error) collectedErrors.push(output.error);
                }
                if (output?.results?.[0]) {
                    if (figureMessage) {
                        const result = output.results[0];
                        const headerNode = h('message', { nickname: `--- ${eng.name} (附加结果) ---`, avatar: botUser.avatar });
                        const resultNode = await MessageBuilder.buildLowConfidenceNode(this.ctx, result, eng.name, botUser);
                        figureMessage.children.push(headerNode, resultNode);
                    } else {
                        if (!executedOutputs.some(o => o.engine === eng.name)) {
                            executedOutputs.push(output);
                        }
                    }
                }
            }
        }
    }
}
// --- END OF FILE src/core/search-handler.ts ---