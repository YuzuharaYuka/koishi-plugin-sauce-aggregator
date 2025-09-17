// --- START OF FILE src/core/search-handler.ts ---

import { Context, h, Logger, Session } from 'koishi';
import { Config, Searcher, SearchEngineName, SearchOptions, Searcher as SearcherResult, Enhancer } from '../config';
import * as MessageBuilder from './message-builder';

const logger = new Logger('sauce-aggregator:handler');

type SearchOutput = { engine: SearchEngineName; results: SearcherResult.Result[]; error: string | null };

export class SearchHandler {
    constructor(
        private ctx: Context,
        private config: Config,
        private allSearchers: Record<string, Searcher>,
        private allEnabledSearchers: Searcher[],
    ) {}

    private async performSearch(searcher: Searcher, options: SearchOptions): Promise<SearchOutput> {
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
        const executedOutputs: SearchOutput[] = [];
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
            // --- THIS IS THE FIX --- Pass executedOutputs to attachAdditionalResults
            await this.attachAdditionalResults(options, botUser, session, collectedErrors, executedOutputs, figureMessage);
            await MessageBuilder.sendFigureMessage(session, figureMessage, '发送高匹配度结果失败');
            return;
        }
        
        // --- THIS IS THE FIX --- Combine all low-confidence searchers, including those previously excluded
        const allLowConfidenceSearchers = this.allEnabledSearchers.filter(s => !executedEngineNames.has(s.name));
        if (allLowConfidenceSearchers.length > 0) {
            const unexecutedOutputs = await Promise.all(allLowConfidenceSearchers.map(s => this.performSearch(s, options)));
            unexecutedOutputs.forEach(output => {
                if (output.error) collectedErrors.push(output.error);
                if (output.results.length > 0) executedOutputs.push(output);
            });
        }
        
        if (executedOutputs.length === 0) {
          let finalMessage = '未找到任何相关结果。';
          if (collectedErrors.length > 0) {
            finalMessage += '\n\n遇到的问题:\n' + collectedErrors.join('\n');
          }
          return finalMessage;
        }
  
        await session.send('未找到高匹配度结果，显示如下:');
        const figureMessage = h('figure');
        const nodePromises = executedOutputs.flatMap(output => {
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
    
    // --- THIS IS THE FIX --- New method for parallel search
    public async handleParallelSearch(searchers: Searcher[], options: SearchOptions, botUser, session, collectedErrors: string[], sortedEnhancers: Enhancer[]) {
        let highConfidenceSent = false;
        const allOutputs: SearchOutput[] = [];
    
        const attachEngines: Searcher[] = [];
        const mainSearchers: Searcher[] = [];
    
        // Separate always-attach engines from main searchers
        searchers.forEach(s => {
            if ((s.name === 'yandex' && this.config.yandex.alwaysAttach) || (s.name === 'ascii2d' && this.config.ascii2d.alwaysAttach)) {
                attachEngines.push(s);
            } else {
                mainSearchers.push(s);
            }
        });
    
        const handleHighConfidence = async (output: SearchOutput) => {
            if (this.config.search.parallelHighConfidenceStrategy === 'first' && highConfidenceSent) {
                return;
            }
    
            const engineConfig = this.config[output.engine] as { confidenceThreshold?: number };
            const specificThreshold = engineConfig?.confidenceThreshold;
            const thresholdToUse = (specificThreshold && specificThreshold > 0) ? specificThreshold : this.config.confidenceThreshold;
            const highConfidenceResults = output.results.filter(r => r.similarity >= thresholdToUse);
    
            if (highConfidenceResults.length > 0) {
                if (this.config.search.parallelHighConfidenceStrategy === 'first' && highConfidenceSent) return;
                
                highConfidenceSent = true;
                let resultsToShow = [highConfidenceResults[0]];
                if (output.engine === 'soutubot') {
                    resultsToShow = highConfidenceResults.slice(0, this.config.soutubot.maxHighConfidenceResults);
                }
                
                await session.send(`[${output.engine}] 找到高匹配度结果:`);
                const figureMessage = h('figure');
                for (const result of resultsToShow) {
                    await MessageBuilder.buildHighConfidenceMessage(figureMessage, this.ctx, this.config, sortedEnhancers, result, output.engine, botUser);
                }
                await MessageBuilder.sendFigureMessage(session, figureMessage, `[${output.engine}] 发送高匹配度结果失败`);
            }
        };
    
        // Fire and forget for attached results, they send their own messages
        attachEngines.forEach(async (searcher) => {
            const output = await this.performSearch(searcher, options);
            if (output.error) {
                collectedErrors.push(output.error); // Collect error but don't block
                session.send(`[${searcher.name}] 附加结果搜索失败: ${output.error}`);
            } else if (output.results.length > 0) {
                const result = output.results[0];
                const figureMessage = h('figure');
                const resultNode = await MessageBuilder.buildLowConfidenceNode(this.ctx, result, searcher.name, botUser);
                figureMessage.children.push(resultNode);
                await session.send(`来自 [${searcher.name}] 的附加结果:`);
                await MessageBuilder.sendFigureMessage(session, figureMessage, `[${searcher.name}] 发送附加结果失败`);
            }
        });
    
        const searchPromises = mainSearchers.map(async (searcher) => {
            const output = await this.performSearch(searcher, options);
            allOutputs.push(output);
            if (output.error) collectedErrors.push(output.error);
            if (output.results.length > 0) {
                await handleHighConfidence(output);
            }
        });
    
        await Promise.all(searchPromises);
    
        if (!highConfidenceSent) {
            const successfulOutputs = allOutputs.filter(o => o.results.length > 0);
            if (successfulOutputs.length === 0) {
                let finalMessage = '未找到任何相关结果。';
                if (collectedErrors.length > 0) {
                    finalMessage += '\n\n遇到的问题:\n' + collectedErrors.join('\n');
                }
                return session.send(finalMessage);
            }
    
            await session.send('未找到高匹配度结果，显示如下:');
            const figureMessage = h('figure');
            const nodePromises = successfulOutputs.flatMap(output =>
                output.results.slice(0, this.config.maxResults).map(result =>
                    MessageBuilder.buildLowConfidenceNode(this.ctx, result, output.engine, botUser)
                )
            );
            figureMessage.children.push(...await Promise.all(nodePromises));
            await MessageBuilder.sendFigureMessage(session, figureMessage, '合并转发低匹配度结果失败');
        }
    
        if (collectedErrors.length > 0 && !highConfidenceSent) {
            await session.send('部分引擎搜索失败:\n' + collectedErrors.join('\n'));
        }
    }

    // --- THIS IS THE FIX --- Refactor attachAdditionalResults to be more generic
    private async attachAdditionalResults(options: SearchOptions, botUser, session, collectedErrors: string[], executedOutputs: SearchOutput[], figureMessage: h | null) {
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
                    } else if (!executedOutputs.some(o => o.engine === eng.name)) {
                        executedOutputs.push(output);
                    }
                }
            }
        }
    }
}
// --- END OF FILE src/core/search-handler.ts ---