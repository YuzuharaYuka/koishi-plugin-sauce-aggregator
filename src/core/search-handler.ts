// --- START OF FILE src/core/search-handler.ts ---

import { Context, h, Logger } from 'koishi';
import { Config, Searcher, SearchEngineName, SearchOptions, Searcher as SearcherResult, Enhancer, EnhancedResult } from '../config';
import * as MessageBuilder from './message-builder';
import { Semaphore } from './semaphore';
import { PuppeteerManager } from '../puppeteer';

const logger = new Logger('sauce-aggregator:handler');

type SearchOutput = { engine: SearchEngineName; results: SearcherResult.Result[]; error: string | null };

const PUPPETEER_ENGINES: SearchEngineName[] = ['yandex', 'soutubot', 'ascii2d'];

// 根据图源名称和结果内容生成一个唯一的ID，用于防止重复增强
function getEnhancementId(enhancerName: string, result: SearcherResult.Result): string | null {
    const patterns = {
        pixiv: /illust_id=(\d+)|artworks\/(\d+)/,
        danbooru: /posts\/(\d+)/,
        gelbooru: /id=(\d+)|md5=([a-f0-9]{32})/,
        yandere: /post\/show\/(\d+)/,
    };
    const regex = patterns[enhancerName];
    if (!regex) return null;

    const match = result.url.match(regex) || result.details?.join(' ').match(regex);
    return match ? `${enhancerName}:${match[1] || match[2]}` : null;
}

// 负责调度和执行所有搜图策略的核心处理器
export class SearchHandler {
    private puppeteerSemaphore: Semaphore;

    constructor(
        private ctx: Context,
        private config: Config,
        private allSearchers: Record<string, Searcher>,
        private allEnabledSearchers: Searcher[],
        private puppeteerManager: PuppeteerManager, // [FEAT] 注入 PuppeteerManager 以便使用其方法
    ) {
        this.puppeteerSemaphore = new Semaphore(config.puppeteer.concurrency);
    }

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

    // [FEAT] 新增：统一处理图源增强逻辑，并应用并发保护
    public async enhanceResult(
      result: SearcherResult.Result,
      sortedEnhancers: Enhancer[],
      processedIds?: Set<string>
    ): Promise<{ enhancedResult: EnhancedResult | null; enhancementId: string | null }> {
      for (const enhancer of sortedEnhancers) {
        const enhancementId = getEnhancementId(enhancer.name, result);
        if (enhancementId && processedIds?.has(enhancementId)) {
          if (this.config.debug.enabled) logger.info(`[增强器] 跳过重复的图源处理: ${enhancementId}`);
          continue;
        }
    
        try {
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
            return { enhancedResult: enhancedData, enhancementId };
          }
        } catch (e) {
          logger.warn(`[${enhancer.name}] 图源处理时发生错误:`, e);
        }
      }
      return { enhancedResult: null, enhancementId: null };
    }

    private async handleAttachEngines(attachEngines: Searcher[], options: SearchOptions, botUser: any, session: any, collectedErrors: string[]) {
        if (attachEngines.length === 0) return;

        const attachPromises = attachEngines.map(s => {
            if (PUPPETEER_ENGINES.includes(s.name)) {
                if (this.config.debug.enabled) logger.info(`附加任务 [${s.name}] 已加入 Puppeteer 队列。`);
                return this.puppeteerSemaphore.run(() => this.performSearch(s, options));
            }
            return this.performSearch(s, options);
        });

        const attachOutputs = await Promise.all(attachPromises);
        const successfulAttachOutputs = attachOutputs.filter(o => o.results.length > 0);
        
        attachOutputs.forEach(o => { if (o.error) collectedErrors.push(o.error); });
        
        if (successfulAttachOutputs.length === 0) {
            return;
        }

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
        const apiTasks: Promise<SearchOutput>[] = [];
        const puppeteerTasks: Promise<SearchOutput>[] = [];

        for (const searcher of searchers) {
            const task = () => this.performSearch(searcher, options);
            
            if (PUPPETEER_ENGINES.includes(searcher.name)) {
                if (this.config.debug.enabled) logger.info(`Puppeteer 任务 [${searcher.name}] 已加入队列。`);
                puppeteerTasks.push(this.puppeteerSemaphore.run(task));
            } else {
                apiTasks.push(task());
            }
        }

        const allPromises = [...apiTasks, ...puppeteerTasks];
        return Promise.all(allPromises);
    }

    // 处理指定引擎搜索或 --all 全量搜索
    public async handleDirectSearch(
      mainSearchers: Searcher[],
      attachSearchers: Searcher[],
      isSingleEngineSearch: boolean,
      options: SearchOptions,
      botUser: any,
      session: any,
      collectedErrors: string[],
      sortedEnhancers: Enhancer[]
    ) {
        const mainOutputs = await this.executeSearch(mainSearchers, options);
        mainOutputs.forEach(o => { if (o.error) collectedErrors.push(o.error); });

        const highConfidenceGroups: { engine: SearchEngineName; results: SearcherResult.Result[] }[] = [];
        const lowConfidenceGroups: { engine: SearchEngineName; results: SearcherResult.Result[] }[] = [];

        for (const output of mainOutputs) {
            if (output.results.length === 0) continue;

            const engineConfig = this.config[output.engine] as { confidenceThreshold?: number };
            const specificThreshold = engineConfig?.confidenceThreshold;
            const thresholdToUse = (specificThreshold && specificThreshold > 0) ? specificThreshold : this.config.confidenceThreshold;
            
            const high: SearcherResult.Result[] = [];
            const low: SearcherResult.Result[] = [];

            output.results.forEach(result => {
                if (result.similarity >= thresholdToUse) {
                    high.push(result);
                } else {
                    low.push(result);
                }
            });

            if (high.length > 0) highConfidenceGroups.push({ engine: output.engine, results: high });
            if (low.length > 0) lowConfidenceGroups.push({ engine: output.engine, results: low.slice(0, this.config.maxResults) });
        }
        
        const figureMessage = h('figure');
        const processedEnhancements = new Set<string>();

        if (highConfidenceGroups.length > 0) {
            await session.send('搜索完成，找到高匹配度结果:');
            for (const group of highConfidenceGroups) {
                let resultsToShow = group.results;
                if (group.engine === 'soutubot') {
                    resultsToShow = group.results.slice(0, this.config.soutubot.maxHighConfidenceResults);
                } else if (!isSingleEngineSearch) {
                    resultsToShow = [group.results[0]];
                }
                for (const result of resultsToShow) {
                    const { enhancedResult, enhancementId } = await this.enhanceResult(result, sortedEnhancers, processedEnhancements);
                    if (enhancementId) processedEnhancements.add(enhancementId);
                    await MessageBuilder.buildHighConfidenceMessage(figureMessage, this.ctx, this.config, result, group.engine, botUser, enhancedResult);
                }
            }
        } else if (lowConfidenceGroups.length > 0) {
            await session.send('未找到高匹配度结果，显示如下:');
        }
        
        if (!isSingleEngineSearch || (isSingleEngineSearch && highConfidenceGroups.length === 0)) {
            const lowConfidencePromises = lowConfidenceGroups.flatMap(group =>
                group.results.map(result => MessageBuilder.buildLowConfidenceNode(this.ctx, result, group.engine, botUser))
            );
            figureMessage.children.push(...await Promise.all(lowConfidencePromises));
        }
        
        if (figureMessage.children.length > 0) {
             await MessageBuilder.sendFigureMessage(session, figureMessage, '合并转发结果失败');
        } else if (attachSearchers.length === 0) {
            let finalMessage = '未找到任何相关结果。';
            if (collectedErrors.length > 0) {
                finalMessage += '\n\n遇到的问题:\n' + collectedErrors.join('\n');
            }
            return session.send(finalMessage);
        }

        await this.handleAttachEngines(attachSearchers, options, botUser, session, collectedErrors);

        if (collectedErrors.length > 0) {
            await session.send('部分引擎搜索失败:\n' + collectedErrors.join('\n'));
        }
    }

    // 处理串行搜索策略
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
            const processedEnhancements = new Set<string>();
            for (const result of resultsToShow) {
                const { enhancedResult, enhancementId } = await this.enhanceResult(result, sortedEnhancers, processedEnhancements);
                if (enhancementId) processedEnhancements.add(enhancementId);
                await MessageBuilder.buildHighConfidenceMessage(figureMessage, this.ctx, this.config, result, highConfidenceSearcherName, botUser, enhancedResult);
            }
            await MessageBuilder.sendFigureMessage(session, figureMessage, '发送高匹配度结果失败');
            
            const attachEngines = this.allEnabledSearchers.filter(s => 
                (s.name === 'yandex' && this.config.yandex.alwaysAttach) || 
                (s.name === 'ascii2d' && this.config.ascii2d.alwaysAttach));
            await this.handleAttachEngines(attachEngines, options, botUser, session, collectedErrors);
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
    
    // 处理并行搜索策略
    public async handleParallelSearch(
      searchers: Searcher[],
      options: SearchOptions,
      botUser: any,
      session: any,
      collectedErrors: string[],
      sortedEnhancers: Enhancer[]
    ) {
        let highConfidenceSent = false;
        const processedEnhancements = new Set<string>();
        const lowConfidenceOutputs: SearchOutput[] = [];
    
        const attachEngines: Searcher[] = [];
        const mainSearchers: Searcher[] = [];
    
        searchers.forEach(s => {
            if ((s.name === 'yandex' && this.config.yandex.alwaysAttach) || (s.name === 'ascii2d' && this.config.ascii2d.alwaysAttach)) {
                attachEngines.push(s);
            } else {
                mainSearchers.push(s);
            }
        });
    
        const attachPromise = this.handleAttachEngines(attachEngines, options, botUser, session, collectedErrors);
    
        const processSearchResult = async (output: SearchOutput) => {
            if (output.error) {
                collectedErrors.push(output.error);
                return;
            }
            if (output.results.length === 0) {
                return;
            }
    
            const engineConfig = this.config[output.engine] as { confidenceThreshold?: number };
            const specificThreshold = engineConfig?.confidenceThreshold;
            const thresholdToUse = (specificThreshold && specificThreshold > 0) ? specificThreshold : this.config.confidenceThreshold;
            const highConfidenceResults = output.results.filter(r => r.similarity >= thresholdToUse);
    
            if (highConfidenceResults.length > 0) {
                if (this.config.search.parallelHighConfidenceStrategy === 'first' && highConfidenceSent) {
                    return;
                }
    
                if (!highConfidenceSent || this.config.search.parallelHighConfidenceStrategy === 'all') {
                    highConfidenceSent = true;
    
                    let resultsToShow = [highConfidenceResults[0]];
                    if (output.engine === 'soutubot') {
                        resultsToShow = highConfidenceResults.slice(0, this.config.soutubot.maxHighConfidenceResults);
                    }
                    
                    await session.send(`[${output.engine}] 找到高匹配度结果:`);
                    const figureMessage = h('figure');
                    for (const result of resultsToShow) {
                        const { enhancedResult, enhancementId } = await this.enhanceResult(result, sortedEnhancers, processedEnhancements);
                        if (enhancementId) processedEnhancements.add(enhancementId);
                        await MessageBuilder.buildHighConfidenceMessage(figureMessage, this.ctx, this.config, result, output.engine, botUser, enhancedResult);
                    }
                    await MessageBuilder.sendFigureMessage(session, figureMessage, `[${output.engine}] 发送高匹配度结果失败`);
                }
            } else {
                lowConfidenceOutputs.push(output);
            }
        };

        const apiProcessingPromises: Promise<void>[] = [];
        const puppeteerProcessingPromises: Promise<void>[] = [];
        
        mainSearchers.forEach(searcher => {
            const task = async () => {
                const output = await this.performSearch(searcher, options);
                await processSearchResult(output);
            };

            if (PUPPETEER_ENGINES.includes(searcher.name)) {
                if (this.config.debug.enabled) logger.info(`Puppeteer 任务 [${searcher.name}] 已加入队列。`);
                puppeteerProcessingPromises.push(this.puppeteerSemaphore.run(task));
            } else {
                apiProcessingPromises.push(task());
            }
        });

        await Promise.all([...apiProcessingPromises, ...puppeteerProcessingPromises]);
    
        await attachPromise;
    
        if (!highConfidenceSent) {
            const successfulOutputs = lowConfidenceOutputs.filter(o => o.results.length > 0);
    
            if (successfulOutputs.length === 0) {
                let finalMessage = '未找到任何相关结果。';
                if (collectedErrors.length > 0) {
                    finalMessage += '\n\n遇到的问题:\n' + collectedErrors.join('\n');
                }
                await session.send(finalMessage);
                return;
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
}