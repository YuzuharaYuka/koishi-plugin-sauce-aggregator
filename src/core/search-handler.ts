import { Context, h, Logger } from 'koishi';
import { Config, Searcher, SearchEngineName, SearchOptions, Searcher as SearcherResult, Enhancer, EnhancedResult } from '../config';
import * as MessageBuilder from './message-builder';
import { Semaphore } from './semaphore';
import { PuppeteerManager } from '../puppeteer';

const logger = new Logger('sauce-aggregator:handler');

type SearchOutput = { engine: SearchEngineName; results: SearcherResult.Result[]; error: string | null };

const PUPPETEER_ENGINES: SearchEngineName[] = ['yandex', 'soutubot', 'ascii2d'];

// [FIX] 彻底重构增强器调度逻辑，根除“幽灵触发”问题。
// 不再盲目遍历所有增强器，而是根据结果中的链接特征，精确、智能地选择并调用唯一匹配的增强器。
// 这是解决所有跨引擎误触发问题的最终方案。
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
            pixiv: /pixiv\.net\/(?:artworks\/|member_illust\.php\?.*illust_id=)/,
            danbooru: /danbooru\.donmai\.us\/(?:posts|post\/show)\//,
            gelbooru: /gelbooru\.com\/index\.php\?.*(id=|md5=)/,
            yandere: /yande\.re\/post\/show\//,
        };
    }

    private getEnhancementId(enhancerName: string, textToSearch: string): string | null {
        const patterns: Record<string, RegExp> = {
            pixiv: /pixiv\.net\/(?:artworks\/|member_illust\.php\?.*illust_id=)(\d+)/,
            danbooru: /danbooru\.donmai\.us\/(?:posts|post\/show)\/(\d+)/,
            gelbooru: /gelbooru\.com\/index\.php\?.*(?:id=(\d+)|md5=([a-f0-9]{32}))/,
            yandere: /yande\.re\/post\/show\/(\d+)/,
        };
        const regex = patterns[enhancerName];
        if (!regex) return null;
    
        const match = textToSearch.match(regex);
        if (!match) return null;
        
        const id = match.slice(1).find(g => g !== undefined);
        return id ? `${enhancerName}:${id}` : null;
    }

    public async enhanceResult(
        result: SearcherResult.Result,
        sortedEnhancers: Enhancer[],
        processedIds?: Set<string>
    ): Promise<{ enhancedResult: EnhancedResult | null; enhancementId: string | null }> {
        const textToSearch = [result.url, ...(result.details || [])].join(' ');

        for (const enhancer of sortedEnhancers) {
            const urlPattern = this.enhancerUrlPatterns[enhancer.name];
            if (!urlPattern || !urlPattern.test(textToSearch)) {
                continue;
            }

            const enhancementId = this.getEnhancementId(enhancer.name, textToSearch);
            if (enhancementId && processedIds?.has(enhancementId)) {
              if (this.config.debug.enabled) logger.info(`[增强器] 跳过重复的图源处理: ${enhancementId}`);
              continue;
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
                return { enhancedResult: enhancedData, enhancementId };
              }
            } catch (e) {
              logger.warn(`[${enhancer.name}] 图源处理时发生错误:`, e);
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
          const errorMessage = `[${searcher.name}] 引擎搜索失败: ${error.message}`;
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
    
    // [FEAT] 优化 executeSearch 逻辑，集中处理临时文件
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

            if (high.length > 0) highConfidenceGroups.push({ engine: output.engine, results: high });
            if (low.length > 0) lowConfidenceGroups.push({ engine: output.engine, results: low.slice(0, this.config.maxResults) });
        }
        
        const figureMessage = h('figure');
        const processedEnhancements = new Set<string>();
        let mainResultsFound = false;

        if (highConfidenceGroups.length > 0) {
            mainResultsFound = true;
            await session.send('搜索完成，找到高匹配度结果:');
            for (const group of highConfidenceGroups) {
                let resultsToShow = (isSingleEngineSearch || this.config.search.parallelHighConfidenceStrategy === 'all') ? group.results : [group.results[0]];
                if (group.engine === 'soutubot') {
                    resultsToShow = resultsToShow.slice(0, this.config.soutubot.maxHighConfidenceResults);
                }

                for (const result of resultsToShow) {
                    const { enhancedResult, enhancementId } = await this.enhanceResult(result, sortedEnhancers, processedEnhancements);
                    if (enhancementId) processedEnhancements.add(enhancementId);
                    await MessageBuilder.buildHighConfidenceMessage(figureMessage, this.ctx, this.config, result, group.engine, botUser, enhancedResult);
                }
            }
        }
        
        if (lowConfidenceGroups.length > 0 && (!mainResultsFound || isSingleEngineSearch)) {
             if (!mainResultsFound) {
                await session.send('未找到高匹配度结果，显示如下:');
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
            let finalMessage = '未找到任何相关结果。';
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
            for (const result of resultsToShow) {
                const { enhancedResult, enhancementId } = await this.enhanceResult(result, sortedEnhancers, processedEnhancements);
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
        const allOutputs = await this.executeSearch(searchers, options);
        allOutputs.forEach(o => { if (o.error) collectedErrors.push(o.error); });

        const mainOutputs: SearchOutput[] = [];
        const attachOutputs: SearchOutput[] = [];

        for (const output of allOutputs) {
            const isAttach = (output.engine === 'yandex' && this.config.yandex.alwaysAttach) || 
                             (output.engine === 'ascii2d' && this.config.ascii2d.alwaysAttach);
            if (isAttach) attachOutputs.push(output);
            else mainOutputs.push(output);
        }
        
        const highConfidenceResults: { engine: SearchEngineName; result: SearcherResult.Result }[] = [];
        const lowConfidenceResults: { engine: SearchEngineName; result: SearcherResult.Result }[] = [];

        for (const output of mainOutputs) {
            const engineConfig = this.config[output.engine] as { confidenceThreshold?: number };
            const threshold = (engineConfig?.confidenceThreshold > 0) ? engineConfig.confidenceThreshold : this.config.confidenceThreshold;
            for (const result of output.results) {
                if (result.similarity >= threshold) highConfidenceResults.push({ engine: output.engine, result });
                else lowConfidenceResults.push({ engine: output.engine, result });
            }
        }
        
        let mainResultsFound = false;
        if (highConfidenceResults.length > 0) {
            mainResultsFound = true;
            await session.send(`搜索完成，找到 ${highConfidenceResults.length} 个高匹配度结果:`);
            
            let resultsToShow = highConfidenceResults;
            // [FIX] 增加对 soutubot 的特判，确保其多个高相似度结果都能展示
            const soutubotResults = highConfidenceResults.filter(r => r.engine === 'soutubot');
            if (soutubotResults.length > 0) {
                const otherResults = highConfidenceResults.filter(r => r.engine !== 'soutubot');
                const limitedSoutubot = soutubotResults.slice(0, this.config.soutubot.maxHighConfidenceResults);
                if (this.config.search.parallelHighConfidenceStrategy === 'all') {
                    resultsToShow = [...otherResults, ...limitedSoutubot];
                } else { // 'first' 策略
                    const bestOther = otherResults.reduce((prev, curr) => (prev?.result.similarity > curr?.result.similarity ? prev : curr), null);
                    const bestSoutubot = limitedSoutubot.reduce((prev, curr) => (prev?.result.similarity > curr?.result.similarity ? prev : curr), null);
                    if(bestOther && (!bestSoutubot || bestOther.result.similarity >= bestSoutubot.result.similarity)) {
                        resultsToShow = [bestOther];
                    } else {
                        resultsToShow = limitedSoutubot;
                    }
                }
            } else if (highConfidenceResults.length > 1 && this.config.search.parallelHighConfidenceStrategy === 'first') {
                resultsToShow = [highConfidenceResults.reduce((prev, curr) => prev.result.similarity > curr.result.similarity ? prev : curr)];
            }


            const figureMessage = h('figure');
            const processedEnhancements = new Set<string>();
            for (const { engine, result } of resultsToShow) {
                const { enhancedResult, enhancementId } = await this.enhanceResult(result, sortedEnhancers, processedEnhancements);
                if (enhancementId) processedEnhancements.add(enhancementId);
                await MessageBuilder.buildHighConfidenceMessage(figureMessage, this.ctx, this.config, result, engine, botUser, enhancedResult);
            }
            await MessageBuilder.sendFigureMessage(session, figureMessage, '发送高匹配度结果失败');
        
        } else if (lowConfidenceResults.length > 0) {
            mainResultsFound = true;
            await session.send('未找到高匹配度结果，显示如下:');
            const figureMessage = h('figure');
            
            const lowConfidenceByEngine = new Map<SearchEngineName, SearcherResult.Result[]>();
            for(const {engine, result} of lowConfidenceResults) {
                if(!lowConfidenceByEngine.has(engine)) lowConfidenceByEngine.set(engine, []);
                lowConfidenceByEngine.get(engine).push(result);
            }
            
            const nodePromises = [];
            for(const [engine, results] of lowConfidenceByEngine.entries()){
                results.slice(0, this.config.maxResults).forEach(result => {
                    nodePromises.push(MessageBuilder.buildLowConfidenceNode(this.ctx, result, engine, botUser));
                });
            }
            figureMessage.children.push(...await Promise.all(nodePromises));
            await MessageBuilder.sendFigureMessage(session, figureMessage, '合并转发低匹配度结果失败');
        }

        await this.handleAttachEngines(attachOutputs, botUser, session);

        if (!mainResultsFound && attachOutputs.every(o => o.results.length === 0)) {
            let finalMessage = '未找到任何相关结果。';
            if (collectedErrors.length > 0) finalMessage += '\n\n遇到的问题:\n' + collectedErrors.join('\n');
            await session.send(finalMessage);
        } else if (collectedErrors.length > 0) {
            await session.send('部分引擎搜索失败:\n' + collectedErrors.join('\n'));
        }
    }
}