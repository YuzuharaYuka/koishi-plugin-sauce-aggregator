// --- START OF FILE src/core/search-handler.ts ---

import { Context, h, Logger } from 'koishi';
import { Config, Searcher, SearchEngineName, SearchOptions, Searcher as SearcherResult, Enhancer, EnhancedResult } from '../config';
import * as MessageBuilder from './message-builder';
import { Semaphore } from './semaphore';
import { PuppeteerManager } from '../puppeteer';
import { formatNetworkError } from '../utils';

const logger = new Logger('sauce-aggregator:handler');

type SearchOutput = { engine: SearchEngineName; results: SearcherResult.Result[]; error: string | null };

const PUPPETEER_ENGINES: SearchEngineName[] = ['yandex', 'soutubot', 'ascii2d'];
const MAIN_ENGINES: SearchEngineName[] = ['saucenao', 'iqdb', 'tracemoe', 'soutubot'];

export class SearchHandler {
    private puppeteerSemaphore: Semaphore;
    private enhancerUrlPatterns: Record<string, RegExp>;

    constructor(
        private ctx: Context,
        private config: Config,
        private allSearchers: Record<string, Searcher>,
        private allEnabledSearchers: Searcher[],
        private puppeteerManager: PuppeteerManager,
    ) {
        this.puppeteerSemaphore = new Semaphore(config.puppeteer.concurrency);
        this.enhancerUrlPatterns = {
            pixiv: /pixiv\.net\/(?:artworks\/|member_illust\.php\?.*illust_id=)|i\.pximg\.net/,
            danbooru: /danbooru\.donmai\.us\/(?:posts|post\/show)\//,
            gelbooru: /gelbooru\.com\/index\.php\?.*(id=|md5=)/,
            yandere: /yande\.re\/post\/show\//,
        };
    }

    // [FIX] 增加 getEnhancementId 辅助方法，用于生成唯一的图源任务ID
    private getEnhancementId(enhancerName: string, textToSearch: string): string | null {
        // danbooru/yandere: post id
        // gelbooru: post id or md5
        // pixiv: illust id
        const patterns: Record<string, RegExp> = {
            pixiv: /(?:artworks\/|illust_id=)(\d+)/,
            danbooru: /(?:posts|post\/show)\/(\d+)/,
            gelbooru: /(?:id=(\d+)|md5=([a-f0-9]{32}))/,
            yandere: /post\/show\/(\d+)/,
        };
        const regex = patterns[enhancerName];
        if (!regex) return null;
    
        const match = textToSearch.match(regex);
        if (!match) return null;
        
        // match[1] 是 id, match[2] 可能是 gelbooru 的 md5
        const id = match[1] || match[2];
        return id ? `${enhancerName}:${id}` : null;
    }

    public async enhanceResult(
        result: SearcherResult.Result,
        sortedEnhancers: Enhancer[],
        processedIds: Set<string>, // [FIX] 修改参数名，更清晰
        successfulEnhancers?: Set<string>
    ): Promise<{ enhancedResult: EnhancedResult | null; enhancementId: string | null }> {
        const textToSearch = [result.url, ...(result.details || [])].join(' ');

        for (const enhancer of sortedEnhancers) {
            if (successfulEnhancers?.has(enhancer.name)) continue;

            const urlPattern = this.enhancerUrlPatterns[enhancer.name];
            if (!urlPattern || !urlPattern.test(textToSearch)) {
                continue;
            }

            const enhancementId = this.getEnhancementId(enhancer.name, textToSearch);
            // [FIX] 核心逻辑：如果 ID 已被处理，则跳过
            if (enhancementId && processedIds.has(enhancementId)) {
              if (this.config.debug.enabled) logger.info(`[增强器] 跳过重复的图源处理: ${enhancementId}`);
              continue; // 返回 null，表示没有新的增强结果
            }
        
            try {
              if (this.config.debug.enabled) logger.info(`[${enhancer.name}] 检测到匹配链接，开始增强...`);
              let enhancedData: EnhancedResult | null;
              const enhanceTask = () => enhancer.enhance(result);
        
              if (enhancer.needsPuppeteer) {
                if (this.config.debug.enabled) logger.info(`[${enhancer.name}] 增强任务已加入 Puppeteer 队列。`);
                enhancedData = await this.puppeteerSemaphore.run(enhanceTask);
              } else {
                enhancedData = await enhanceTask();
              }
        
              if (enhancedData) {
                if (this.config.debug.enabled) logger.info(`[${enhancer.name}] 已成功获取图源信息。`);
                successfulEnhancers?.add(enhancer.name);
                return { enhancedResult: enhancedData, enhancementId };
              }
            } catch (e) {
              logger.warn(`[${enhancer.name}] 图源处理时发生错误:`, formatNetworkError(e));
            }
            break; 
        }
        return { enhancedResult: null, enhancementId: null };
    }

    private async performSearch(searcher: Searcher, options: SearchOptions): Promise<SearchOutput> {
        try {
          const results = await searcher.search(options);
          return { engine: searcher.name, results, error: null };
        } catch (error) {
          const errorMessage = `[${searcher.name}] 引擎搜索失败: ${formatNetworkError(error)}`;
          logger.warn(errorMessage, this.config.debug.enabled ? error : '');
          return { engine: searcher.name, results: [], error: errorMessage };
        }
    }

    private async handleAttachEngines(attachOutputs: SearchOutput[], botUser: any, session: any) {
        const successfulAttachOutputs = attachOutputs.filter(o => o.results.length > 0);
        if (successfulAttachOutputs.length === 0) return;

        const figureMessage = h('figure');
        const nodePromises = successfulAttachOutputs.flatMap(output => 
            output.results.slice(0, this.config.maxResults).map(result => 
                MessageBuilder.buildLowConfidenceNode(this.ctx, result, output.engine, botUser)
            )
        );
        figureMessage.children.push(...await Promise.all(nodePromises));

        if (figureMessage.children.length > 0) {
            await session.send('来自附加引擎的结果:');
            await MessageBuilder.sendFigureMessage(session, figureMessage, '发送附加结果失败');
        }
    }
    
    private async executeSearch(searchers: Searcher[], options: SearchOptions): Promise<SearchOutput[]> {
        const puppeteerSearchers = searchers.filter(s => PUPPETEER_ENGINES.includes(s.name));
        const apiSearchers = searchers.filter(s => !PUPPETEER_ENGINES.includes(s.name));
    
        let tempFile: { filePath: string; cleanup: () => Promise<void> } | null = null;
        let puppeteerPromises: Promise<SearchOutput>[] = [];
    
        try {
            if (puppeteerSearchers.length > 0) {
                tempFile = await this.puppeteerManager.createTempFile(options.imageBuffer, options.fileName);
                const newOptions = { ...options, tempFilePath: tempFile.filePath };
                
                puppeteerPromises = puppeteerSearchers.map(searcher => {
                    const task = () => this.performSearch(searcher, newOptions);
                    if (this.config.debug.enabled) logger.info(`Puppeteer 任务 [${searcher.name}] 已加入队列。`);
                    return this.puppeteerSemaphore.run(task);
                });
            }
    
            const apiPromises = apiSearchers.map(searcher => this.performSearch(searcher, options));
    
            return await Promise.all([...apiPromises, ...puppeteerPromises]);
        } finally {
            if (tempFile) {
                await tempFile.cleanup();
            }
        }
    }

    public async handleDirectSearch(
      mainSearchers: Searcher[],
      attachSearchers: Searcher[],
      isSingleEngineSearch: boolean,
      isAllSearch: boolean,
      options: SearchOptions,
      botUser: any,
      session: any,
      collectedErrors: string[],
      sortedEnhancers: Enhancer[]
    ) {
        const allSearchers = [...mainSearchers, ...attachSearchers];
        const allOutputs = await this.executeSearch(allSearchers, options);
        allOutputs.forEach(o => { if (o.error) collectedErrors.push(o.error); });

        const highConfidenceGroups: { engine: SearchEngineName; results: SearcherResult.Result[] }[] = [];
        const lowConfidenceGroups: { engine: SearchEngineName; results: SearcherResult.Result[] }[] = [];
        const finalAttachOutputs: SearchOutput[] = [];

        for (const output of allOutputs) {
            if(attachSearchers.some(s => s.name === output.engine)) {
                finalAttachOutputs.push(output);
                continue;
            }

            if (output.results.length === 0) continue;
            const engineConfig = this.config[output.engine] as { confidenceThreshold?: number };
            const threshold = (engineConfig?.confidenceThreshold > 0) ? engineConfig.confidenceThreshold : this.config.confidenceThreshold;
            
            const high: SearcherResult.Result[] = [];
            const low: SearcherResult.Result[] = [];
            output.results.forEach(result => {
                if (result.similarity >= threshold) high.push(result);
                else low.push(result);
            });

            if (high.length > 0) {
                highConfidenceGroups.push({ engine: output.engine, results: high });
            } else if (low.length > 0) {
                lowConfidenceGroups.push({ engine: output.engine, results: low.slice(0, this.config.maxResults) });
            }
        }
        
        const figureMessage = h('figure');
        const processedEnhancements = new Set<string>();
        const successfulEnhancers = new Set<string>();
        let mainResultsFound = false;

        if (highConfidenceGroups.length > 0) {
            mainResultsFound = true;
            await session.send('搜索完成，找到高匹配度结果:');
            for (const group of highConfidenceGroups) {
                let resultsToShow = (isSingleEngineSearch || this.config.search.parallelHighConfidenceStrategy === 'all' || isAllSearch) ? group.results : [group.results[0]];
                if (group.engine === 'soutubot') {
                    resultsToShow = resultsToShow.slice(0, this.config.soutubot.maxHighConfidenceResults);
                }

                for (const result of resultsToShow) {
                    const { enhancedResult, enhancementId } = await this.enhanceResult(result, sortedEnhancers, processedEnhancements, successfulEnhancers);
                    if (enhancementId) processedEnhancements.add(enhancementId);
                    await MessageBuilder.buildHighConfidenceMessage(figureMessage, this.ctx, this.config, result, group.engine, botUser, enhancedResult);
                }
            }
        }
        
        if (lowConfidenceGroups.length > 0 && (!mainResultsFound || isSingleEngineSearch || isAllSearch)) {
             if (!mainResultsFound) {
                await session.send('未找到高匹配度结果，显示如下:');
             } else if (isAllSearch) {
                await session.send('低匹配度结果如下:');
             }
             mainResultsFound = true;
             const lowConfidencePromises = lowConfidenceGroups.flatMap(group =>
                 group.results.map(result => MessageBuilder.buildLowConfidenceNode(this.ctx, result, group.engine, botUser))
             );
             figureMessage.children.push(...await Promise.all(lowConfidencePromises));
        }
        
        if (figureMessage.children.length > 0) {
             await MessageBuilder.sendFigureMessage(session, figureMessage, '合并转发结果失败');
        } 
        
        await this.handleAttachEngines(finalAttachOutputs, botUser, session);

        if (!mainResultsFound && finalAttachOutputs.every(o => o.results.length === 0)) {
            let finalMessage: string;
            if (isSingleEngineSearch) {
                const engineName = mainSearchers[0].name;
                finalMessage = `[${engineName}] 未找到任何相关结果。`;
            } else {
                finalMessage = '未找到任何相关结果。';
            }

            if (collectedErrors.length > 0) {
                finalMessage += '\n\n遇到的问题:\n' + collectedErrors.join('\n');
            }
            return session.send(finalMessage);
        }

        if (collectedErrors.length > 0) {
            await session.send('部分引擎搜索失败:\n' + collectedErrors.join('\n'));
        }
    }

    public async handleSequentialSearch(
      searchers: Searcher[],
      options: SearchOptions,
      botUser: any,
      session: any,
      collectedErrors: string[],
      sortedEnhancers: Enhancer[]
    ) {
        const executedOutputs: SearchOutput[] = [];
        let highConfidenceResults: SearcherResult.Result[] = [];
        let highConfidenceSearcherName: SearchEngineName = null;
        const executedEngineNames = new Set<SearchEngineName>(); 
  
        for (const searcher of searchers) {
            executedEngineNames.add(searcher.name); 
            const output = await this.executeSearch([searcher], options);
            if (output[0].error) collectedErrors.push(output[0].error);
            if (output[0].results.length > 0) executedOutputs.push(output[0]);
  
            const engineConfig = this.config[searcher.name] as { confidenceThreshold?: number };
            const threshold = (engineConfig?.confidenceThreshold > 0) ? engineConfig.confidenceThreshold : this.config.confidenceThreshold;
            
            const foundResults = output[0].results.filter(r => r.similarity >= threshold);
            if (foundResults.length > 0) {
              highConfidenceResults = foundResults;
              highConfidenceSearcherName = searcher.name;
              break;
            }
        }
  
        if (highConfidenceResults.length > 0) {
            let resultsToShow = highConfidenceResults;
            if (highConfidenceSearcherName === 'soutubot') {
                resultsToShow = highConfidenceResults.slice(0, this.config.soutubot.maxHighConfidenceResults);
                await session.send(`[${highConfidenceSearcherName}] 找到 ${resultsToShow.length} 个高匹配度结果:`);
            } else {
                resultsToShow = [highConfidenceResults[0]];
                await session.send(`[${highConfidenceSearcherName}] 找到高匹配度结果:`);
            }
  
            const figureMessage = h('figure');
            const processedEnhancements = new Set<string>();
            const successfulEnhancers = new Set<string>();
            for (const result of resultsToShow) {
                const { enhancedResult, enhancementId } = await this.enhanceResult(result, sortedEnhancers, processedEnhancements, successfulEnhancers);
                if (enhancementId) processedEnhancements.add(enhancementId);
                await MessageBuilder.buildHighConfidenceMessage(figureMessage, this.ctx, this.config, result, highConfidenceSearcherName, botUser, enhancedResult);
            }
            await MessageBuilder.sendFigureMessage(session, figureMessage, '发送高匹配度结果失败');
            
            const attachEngines = this.allEnabledSearchers.filter(s => 
                ((s.name === 'yandex' && this.config.yandex.alwaysAttach) || (s.name === 'ascii2d' && this.config.ascii2d.alwaysAttach))
                && !executedEngineNames.has(s.name)
            );
            const attachOutputs = await this.executeSearch(attachEngines, options);
            attachOutputs.forEach(o => { if(o.error) collectedErrors.push(o.error) });
            await this.handleAttachEngines(attachOutputs, botUser, session);
            if(collectedErrors.length > 0) await session.send('部分引擎搜索失败:\n' + collectedErrors.join('\n'));
            return;
        }
        
        const remainingSearchers = this.allEnabledSearchers.filter(s => !executedEngineNames.has(s.name));
        if (remainingSearchers.length > 0) {
            const unexecutedOutputs = await this.executeSearch(remainingSearchers, options);
            unexecutedOutputs.forEach(output => {
                if (output.error) collectedErrors.push(output.error);
                if (output.results.length > 0) executedOutputs.push(output);
            });
        }
        
        if (executedOutputs.every(o => o.results.length === 0)) {
          let finalMessage = '未找到任何相关结果。';
          if (collectedErrors.length > 0) finalMessage += '\n\n遇到的问题:\n' + collectedErrors.join('\n');
          return finalMessage;
        }
  
        await session.send('未找到高匹配度结果，显示如下:');
        const figureMessage = h('figure');
        const nodePromises = executedOutputs.flatMap(output => 
            output.results.slice(0, this.config.maxResults).map(result => 
                MessageBuilder.buildLowConfidenceNode(this.ctx, result, output.engine, botUser)
            )
        );
        figureMessage.children.push(...await Promise.all(nodePromises));
        await MessageBuilder.sendFigureMessage(session, figureMessage, '合并转发低匹配度结果失败');
  
        if (collectedErrors.length > 0) {
            await session.send('部分引擎搜索失败:\n' + collectedErrors.join('\n'));
        }
    }
    
    public async handleParallelSearch(
        searchers: Searcher[],
        options: SearchOptions,
        botUser: any,
        session: any,
        collectedErrors: string[],
        sortedEnhancers: Enhancer[]
    ) {
        const abortController = new AbortController();
        const { signal } = abortController;

        const isFastFirstMode = this.config.search.parallelHighConfidenceStrategy === 'first' &&
                                !this.config.yandex.alwaysAttach &&
                                !this.config.ascii2d.alwaysAttach;

        let highConfidenceSent = false;
        const lowConfidenceOutputs: SearchOutput[] = [];
        const processedEnhancements = new Set<string>(); // [FIX] 在 handleParallelSearch 中初始化
        const successfulEnhancers = new Set<string>();
        const completedMainEngines = new Set<SearchEngineName>();
        
        let tempFile: { filePath: string; cleanup: () => Promise<void> } | null = null;
        let optionsWithTempFile = options;
        const needsPuppeteer = searchers.some(s => PUPPETEER_ENGINES.includes(s.name));

        if (needsPuppeteer) {
            tempFile = await this.puppeteerManager.createTempFile(options.imageBuffer, options.fileName);
            optionsWithTempFile = { ...options, tempFilePath: tempFile.filePath };
        }

        const searchPromises = searchers.map(async (searcher) => {
            if (signal.aborted) return;
            
            const performTask = () => {
                const searchOptions = PUPPETEER_ENGINES.includes(searcher.name) ? optionsWithTempFile : options;
                return this.performSearch(searcher, searchOptions);
            };

            let output: SearchOutput;
            if (PUPPETEER_ENGINES.includes(searcher.name)) {
                if (this.config.debug.enabled) logger.info(`Puppeteer 任务 [${searcher.name}] 已加入队列。`);
                output = await this.puppeteerSemaphore.run(performTask, signal);
            } else {
                output = await performTask();
            }

            if (signal.aborted) return;
            if (output.error) {
                collectedErrors.push(output.error);
                return;
            }

            if (MAIN_ENGINES.includes(searcher.name)) {
                completedMainEngines.add(searcher.name);
            }

            const engineConfig = this.config[searcher.name] as { confidenceThreshold?: number };
            const threshold = (engineConfig?.confidenceThreshold > 0) ? engineConfig.confidenceThreshold : this.config.confidenceThreshold;
            const highConfidenceResults = output.results.filter(r => r.similarity >= threshold);

            if (highConfidenceResults.length > 0) {
                if (isFastFirstMode) {
                    if (highConfidenceSent) return;
                    highConfidenceSent = true;
                    abortController.abort();
                    await session.send(`[${output.engine}] 找到高匹配度结果:`);
                    const { enhancedResult, enhancementId } = await this.enhanceResult(highConfidenceResults[0], sortedEnhancers, processedEnhancements, successfulEnhancers);
                    if (enhancementId) processedEnhancements.add(enhancementId);
                    const figureMessage = h('figure');
                    await MessageBuilder.buildHighConfidenceMessage(figureMessage, this.ctx, this.config, highConfidenceResults[0], output.engine, botUser, enhancedResult);
                    await MessageBuilder.sendFigureMessage(session, figureMessage, '发送高匹配度结果失败');
                } else {
                    highConfidenceSent = true;
                    await session.send(`[${output.engine}] 找到高匹配度结果:`);
                    const figureMessage = h('figure');
                    let resultsToShow = highConfidenceResults;
                    if(output.engine === 'soutubot') {
                        resultsToShow = resultsToShow.slice(0, this.config.soutubot.maxHighConfidenceResults);
                    } else if (this.config.search.parallelHighConfidenceStrategy === 'first') {
                        resultsToShow = [resultsToShow.reduce((prev, curr) => prev.similarity > curr.similarity ? prev : curr)];
                    }

                    for (const result of resultsToShow) {
                        const { enhancedResult, enhancementId } = await this.enhanceResult(result, sortedEnhancers, processedEnhancements, successfulEnhancers);
                        if (enhancementId) processedEnhancements.add(enhancementId);
                        await MessageBuilder.buildHighConfidenceMessage(figureMessage, this.ctx, this.config, result, output.engine, botUser, enhancedResult);
                    }
                    await MessageBuilder.sendFigureMessage(session, figureMessage, `[${output.engine}] 发送高匹配度结果失败`);
                }
            } else if (output.results.length > 0) {
                lowConfidenceOutputs.push(output);
            }
        });
        
        const results = await Promise.allSettled(searchPromises);
        results.forEach(result => {
            if (result.status === 'rejected' && result.reason?.name !== 'AbortError') {
                logger.warn('并行搜索中发生未捕获的错误:', result.reason);
            }
        });
        
        const enabledMainEngines = searchers.filter(s => MAIN_ENGINES.includes(s.name));
        if (!isFastFirstMode && !this.config.yandex.alwaysAttach && !this.config.ascii2d.alwaysAttach && enabledMainEngines.every(s => completedMainEngines.has(s.name))) {
            if(!signal.aborted) abortController.abort();
        }

        if(tempFile) await tempFile.cleanup();
        if (signal.aborted && isFastFirstMode) return;

        if (!highConfidenceSent && lowConfidenceOutputs.length > 0) {
            const finalLowConfidence = lowConfidenceOutputs.filter(o => {
                const wasAborted = results.find(r => (r.status === 'rejected' && r.reason?.name === 'AbortError'));
                return !(wasAborted && (o.engine === 'yandex' || o.engine === 'ascii2d'));
            });

            if (finalLowConfidence.length > 0) {
                await session.send('未找到高匹配度结果，显示如下:');
                const figureMessage = h('figure');
                const nodePromises = finalLowConfidence.flatMap(output => 
                    output.results.slice(0, this.config.maxResults).map(result => 
                        MessageBuilder.buildLowConfidenceNode(this.ctx, result, output.engine, botUser)
                    )
                );
                figureMessage.children.push(...await Promise.all(nodePromises));
                await MessageBuilder.sendFigureMessage(session, figureMessage, '合并转发低匹配度结果失败');
            }
        }

        if (!highConfidenceSent && lowConfidenceOutputs.length === 0) {
            let finalMessage = '未找到任何相关结果。';
            if (collectedErrors.length > 0) finalMessage += '\n\n遇到的问题:\n' + collectedErrors.join('\n');
            await session.send(finalMessage);
        } else if (collectedErrors.length > 0) {
            await session.send('部分引擎搜索失败:\n' + collectedErrors.join('\n'));
        }
    }
}