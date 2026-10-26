// --- 搜索处理模块 ---

import { Context, h, Logger, Session, Universal } from 'koishi'
import { Config, Searcher, SearchEngineName, SearchOptions, Searcher as SearcherResult, Enhancer, EnhancedResult } from '../config'
import { SEARCH_ENGINES, ENHANCER_PATTERNS, ENHANCEMENT_ID_EXTRACTORS, SPECIAL_ENGINES, SEARCH_FILTERS, SEARCH_MESSAGES, MESSAGE_TITLES, isAlwaysAttach, isAttachEngine } from '../constants'
import * as MessageBuilder from './builder'
import { Semaphore } from './semaphore'
import { PuppeteerManager } from '../puppeteer'
import { formatNetworkError } from '../utils'
import { DebugLogger } from './logger'
import { EngineBusyError } from './errors'

const logger = new Logger('sauce-aggregator:handler')

interface SearchOutput {
  engine: SearchEngineName
  results: SearcherResult.Result[]
  error: string | null
  /** 引擎主动跳过（如站点排队）时的安静提示，不进入错误汇总 */
  notice?: string
}

export class SearchHandler {
  private puppeteerSemaphore: Semaphore
  private enhancerUrlPatterns: Record<string, RegExp>
  private debugLogger: DebugLogger

  constructor(
    private ctx: Context,
    private config: Config,
    private allSearchers: Record<string, Searcher>,
    private allEnabledSearchers: Searcher[],
    private puppeteerManager: PuppeteerManager,
  ) {
    this.puppeteerSemaphore = new Semaphore(config.puppeteer.concurrency)
    this.enhancerUrlPatterns = ENHANCER_PATTERNS
    this.debugLogger = new DebugLogger('search-handler', config)
  }

  /** 各引擎独立的高匹配度阈值；未配置的引擎按 0 处理 */
  private getConfidenceThreshold(engine: SearchEngineName): number {
    const engineConfig = this.config[engine] as { confidenceThreshold?: number }
    return Math.max(0, Math.min(100, engineConfig?.confidenceThreshold ?? 0))
  }

  /** 各引擎独立的低匹配度展示条数；0 表示不展示 */
  private getLowConfidenceLimit(engine: SearchEngineName): number {
    const engineConfig = this.config[engine] as { maxLowConfidenceResults?: number }
    return Math.max(0, Math.min(10, engineConfig?.maxLowConfidenceResults ?? 0))
  }

  private getEnhancementId(enhancerName: string, textToSearch: string): string | null {
    const regex = ENHANCEMENT_ID_EXTRACTORS[enhancerName as keyof typeof ENHANCEMENT_ID_EXTRACTORS]
    if (!regex) return null

    const match = textToSearch.match(regex)
    if (!match) return null

    const id = match.slice(1).find((g) => g !== undefined)
    return id ? `${enhancerName}:${id}` : null
  }

  public async enhanceResult(
    result: SearcherResult.Result,
    sortedEnhancers: Enhancer[],
    processedIds?: Set<string>,
    successfulEnhancers?: Set<string>
  ): Promise<{ enhancedResult: EnhancedResult | null; enhancementId: string | null }> {
    const textToSearch = [result.url, ...(result.details || [])].join(' ')

    for (const enhancer of sortedEnhancers) {
      if (successfulEnhancers?.has(enhancer.name)) continue

      const urlPattern = this.enhancerUrlPatterns[enhancer.name]
      if (!urlPattern || !urlPattern.test(textToSearch)) {
        continue
      }

      const enhancementId = this.getEnhancementId(enhancer.name, textToSearch)
      if (enhancementId && processedIds?.has(enhancementId)) {
        this.debugLogger.info(`[增强器] 跳过重复的图源处理: ${enhancementId}`)
        continue
      }

      try {
        this.debugLogger.info(`[${enhancer.name}] 检测到匹配链接，开始增强...`)
        let enhancedData: EnhancedResult | null
        const enhanceTask = () => enhancer.enhance(result)

        if (enhancer.needsPuppeteer) {
          this.debugLogger.info(`[${enhancer.name}] 增强任务已加入 Puppeteer 队列。`)
          enhancedData = await this.puppeteerSemaphore.run(enhanceTask)
        } else {
          enhancedData = await enhanceTask()
        }

        if (enhancedData) {
          this.debugLogger.info(`[${enhancer.name}] 已成功获取图源信息。`)
          successfulEnhancers?.add(enhancer.name)
          return { enhancedResult: enhancedData, enhancementId }
        }
      } catch (e) {
        logger.warn(`[${enhancer.name}] 图源处理时发生错误:`, formatNetworkError(e))
      }
      break
    }
    return { enhancedResult: null, enhancementId: null }
  }

  private async performSearch(searcher: Searcher, options: SearchOptions): Promise<SearchOutput> {
    try {
      const results = await searcher.search(options)
      return { engine: searcher.name, results, error: null }
    } catch (error) {
      // 站点繁忙/排队属于「主动跳过」，不按搜索失败处理
      if (error instanceof EngineBusyError) {
        this.debugLogger.info(`[${searcher.name}] ${error.message}`)
        return { engine: searcher.name, results: [], error: null, notice: `${searcher.name} ${error.message}` }
      }
      const errorMessage = `[${searcher.name}] 引擎搜索失败: ${formatNetworkError(error)}`
      logger.warn(errorMessage)
      return { engine: searcher.name, results: [], error: errorMessage }
    }
  }

  /** 收集引擎主动跳过的提示（去重后保持顺序） */
  private collectNotices(outputs: SearchOutput[]): string[] {
    const notices = outputs.map((o) => o.notice).filter((n): n is string => !!n)
    return [...new Set(notices)]
  }

  private async handleAttachEngines(attachOutputs: SearchOutput[], botUser: Universal.User, session: Session): Promise<void> {
    const displayableOutputs = attachOutputs
      .map((output) => ({
        engine: output.engine,
        results: output.results.slice(0, this.getLowConfidenceLimit(output.engine)),
      }))
      .filter((output) => output.results.length > 0)
    if (displayableOutputs.length === 0) return

    const figureMessage = h('figure')
    const nodePromises = displayableOutputs.flatMap((output) =>
      output.results.map((result) =>
        MessageBuilder.buildLowConfidenceNode(this.ctx, result, output.engine, botUser)
      )
    )
    figureMessage.children.push(...(await Promise.all(nodePromises)))

    if (figureMessage.children.length > 0) {
      await session.send(SEARCH_MESSAGES.ATTACH_RESULTS)
      await MessageBuilder.sendFigureMessage(session, figureMessage, SEARCH_MESSAGES.FORWARD_ATTACH_FAILED)
    }
  }

  private async executeSearch(searchers: Searcher[], options: SearchOptions): Promise<SearchOutput[]> {
    const puppeteerSearchers = searchers.filter((s) => SEARCH_ENGINES.PUPPETEER.includes(s.name as any))
    const apiSearchers = searchers.filter((s) => !SEARCH_ENGINES.PUPPETEER.includes(s.name as any))

    let tempFile: { filePath: string; cleanup: () => Promise<void> } | null = null
    let puppeteerPromises: Promise<SearchOutput>[] = []

    try {
      if (puppeteerSearchers.length > 0) {
        tempFile = await this.puppeteerManager.createTempFile(options.imageBuffer, options.fileName)
        const newOptions = { ...options, tempFilePath: tempFile.filePath }

        puppeteerPromises = puppeteerSearchers.map((searcher) => {
          const task = () => this.performSearch(searcher, newOptions)
          this.debugLogger.info(`Puppeteer 任务 [${searcher.name}] 已加入队列。`)
          return this.puppeteerSemaphore.run(task)
        })
      }

      const apiPromises = apiSearchers.map((searcher) => this.performSearch(searcher, options))

      return await Promise.all([...apiPromises, ...puppeteerPromises])
    } finally {
      if (tempFile) {
        await tempFile.cleanup()
      }
    }
  }

  public async handleDirectSearch(
    mainSearchers: Searcher[],
    attachSearchers: Searcher[],
    isSingleEngineSearch: boolean,
    isAllSearch: boolean,
    options: SearchOptions,
    botUser: Universal.User,
    session: Session,
    collectedErrors: string[],
    sortedEnhancers: Enhancer[]
  ): Promise<void> {
    const allSearchers = [...mainSearchers, ...attachSearchers]
    const allOutputs = await this.executeSearch(allSearchers, options)
    const notices = this.collectNotices(allOutputs)
    allOutputs.forEach((o) => {
      if (o.error) collectedErrors.push(o.error)
    })

    const highConfidenceGroups: { engine: SearchEngineName; results: SearcherResult.Result[] }[] = []
    const lowConfidenceGroups: { engine: SearchEngineName; results: SearcherResult.Result[] }[] = []
    const finalAttachOutputs: SearchOutput[] = []

    for (const output of allOutputs) {
      if (attachSearchers.some((s) => s.name === output.engine)) {
        finalAttachOutputs.push(output)
        continue
      }

      if (output.results.length === 0) continue

      // 附加引擎的 similarity 固定为 0，不参与高匹配度判定，只按展示条数取低匹配度结果
      if (isAttachEngine(output.engine)) {
        const lowResults = output.results.slice(0, this.getLowConfidenceLimit(output.engine))
        if (lowResults.length > 0) {
          lowConfidenceGroups.push({ engine: output.engine, results: lowResults })
        }
        continue
      }

      const threshold = this.getConfidenceThreshold(output.engine)
      const high: SearcherResult.Result[] = []
      const low: SearcherResult.Result[] = []
      output.results.forEach((result) => {
        if (result.similarity >= threshold) high.push(result)
        else low.push(result)
      })

      if (high.length > 0) {
        highConfidenceGroups.push({ engine: output.engine, results: high })
      } else if (low.length > 0) {
        const lowResults = low.slice(0, this.getLowConfidenceLimit(output.engine))
        if (lowResults.length > 0) {
          lowConfidenceGroups.push({ engine: output.engine, results: lowResults })
        }
      }
    }

    const figureMessage = h('figure')
    const processedEnhancements = new Set<string>()
    const successfulEnhancers = new Set<string>()
    let mainResultsFound = false

    if (highConfidenceGroups.length > 0) {
      mainResultsFound = true
      await session.send(SEARCH_MESSAGES.SEARCH_COMPLETE)
      for (const group of highConfidenceGroups) {
        const engineSpecificConfig = this.config[group.engine] as { maxHighConfidenceResults?: number }
        const maxHighResults = engineSpecificConfig?.maxHighConfidenceResults ?? 1

        let resultsToShow: SearcherResult.Result[]

        if (isSingleEngineSearch || this.config.search.parallelHighConfidenceStrategy === 'all' || isAllSearch) {
          resultsToShow = group.results
        } else {
          resultsToShow = group.results.slice(0, maxHighResults)
        }

        for (const result of resultsToShow) {
          const { enhancedResult, enhancementId } = await this.enhanceResult(
            result,
            sortedEnhancers,
            processedEnhancements,
            successfulEnhancers
          )
          if (enhancementId) processedEnhancements.add(enhancementId)
          await MessageBuilder.buildHighConfidenceMessage(
            figureMessage,
            this.ctx,
            this.config,
            result,
            group.engine,
            botUser,
            enhancedResult
          )
        }
      }
    }

    if (notices.length > 0) {
      await session.send(notices.join('\n'))
      notices.length = 0
    }

    if (lowConfidenceGroups.length > 0 && (!mainResultsFound || isSingleEngineSearch || isAllSearch)) {
      if (!mainResultsFound) {
        await session.send(SEARCH_MESSAGES.NO_HIGH_CONFIDENCE)
      } else if (isAllSearch) {
        await session.send(SEARCH_MESSAGES.LOW_CONFIDENCE_RESULTS)
      }
      mainResultsFound = true
      const lowConfidencePromises = lowConfidenceGroups.flatMap((group) =>
        group.results.map((result) => MessageBuilder.buildLowConfidenceNode(this.ctx, result, group.engine, botUser))
      )
      figureMessage.children.push(...(await Promise.all(lowConfidencePromises)))
    }

    if (figureMessage.children.length > 0) {
      await MessageBuilder.sendFigureMessage(session, figureMessage, SEARCH_MESSAGES.FORWARD_FAILED)
    }

    await this.handleAttachEngines(finalAttachOutputs, botUser, session)

    const hasDisplayableAttach = finalAttachOutputs.some(
      (output) => output.results.length > 0 && this.getLowConfidenceLimit(output.engine) > 0
    )
    if (!mainResultsFound && lowConfidenceGroups.length === 0 && !hasDisplayableAttach) {
      let finalMessage: string
      if (isSingleEngineSearch) {
        const engineName = mainSearchers[0].name
        finalMessage = `[${engineName}] ${SEARCH_MESSAGES.NO_RESULTS}`
      } else {
        finalMessage = SEARCH_MESSAGES.NO_RESULTS
      }

      if (collectedErrors.length > 0) {
        finalMessage += '\n\n' + SEARCH_MESSAGES.PROBLEMS_ENCOUNTERED + '\n' + collectedErrors.join('\n')
      }
      if (notices.length > 0) {
        finalMessage += '\n\n' + notices.join('\n')
      }
      await session.send(finalMessage)
      return
    }

    if (collectedErrors.length > 0) {
      await session.send(SEARCH_MESSAGES.PARTIAL_FAILURE + '\n' + collectedErrors.join('\n'))
    }
  }

  public async handleSequentialSearch(
    searchers: Searcher[],
    options: SearchOptions,
    botUser: any,
    session: Session,
    collectedErrors: string[],
    sortedEnhancers: Enhancer[]
  ): Promise<void> {
    const executedOutputs: SearchOutput[] = []
    const notices: string[] = []
    let highConfidenceResults: SearcherResult.Result[] = []
    let highConfidenceSearcherName: SearchEngineName | null = null
    const executedEngineNames = new Set<SearchEngineName>()

    for (const searcher of searchers) {
      executedEngineNames.add(searcher.name)
      const output = await this.executeSearch([searcher], options)
      notices.push(...this.collectNotices(output))
      if (output[0].error) collectedErrors.push(output[0].error)
      if (output[0].results.length > 0) executedOutputs.push(output[0])

      const threshold = this.getConfidenceThreshold(searcher.name)
      const foundResults = output[0].results.filter((r) => r.similarity >= threshold)
      if (foundResults.length > 0) {
        highConfidenceResults = foundResults
        highConfidenceSearcherName = searcher.name
        break
      }
    }

    if (highConfidenceResults.length > 0) {
      let resultsToShow = highConfidenceResults
      if (highConfidenceSearcherName === SPECIAL_ENGINES.SOUTUBOT) {
        resultsToShow = highConfidenceResults.slice(0, this.config.soutubot.maxHighConfidenceResults)
        await session.send(`[${highConfidenceSearcherName}] ${SEARCH_MESSAGES.SEARCH_COMPLETE}`)
      } else {
        resultsToShow = [highConfidenceResults[0]]
        await session.send(`[${highConfidenceSearcherName}] ${SEARCH_MESSAGES.SEARCH_COMPLETE}`)
      }

      const figureMessage = h('figure')
      const processedEnhancements = new Set<string>()
      const successfulEnhancers = new Set<string>()
      for (const result of resultsToShow) {
        const { enhancedResult, enhancementId } = await this.enhanceResult(
          result,
          sortedEnhancers,
          processedEnhancements,
          successfulEnhancers
        )
        if (enhancementId) processedEnhancements.add(enhancementId)
        await MessageBuilder.buildHighConfidenceMessage(
          figureMessage,
          this.ctx,
          this.config,
          result,
          highConfidenceSearcherName!,
          botUser,
          enhancedResult
        )
      }
      await MessageBuilder.sendFigureMessage(session, figureMessage, '发送高匹配度结果失败')

      const attachEngines = this.allEnabledSearchers.filter(
        (s) => isAlwaysAttach(this.config, s.name) && !executedEngineNames.has(s.name)
      )
      const attachOutputs = await this.executeSearch(attachEngines, options)
      notices.push(...this.collectNotices(attachOutputs))
      attachOutputs.forEach((o) => {
        if (o.error) collectedErrors.push(o.error)
      })
      await this.handleAttachEngines(attachOutputs, botUser, session)
      if (collectedErrors.length > 0) await session.send(SEARCH_MESSAGES.PARTIAL_FAILURE + '\n' + collectedErrors.join('\n'))
      return
    }

    const remainingSearchers = this.allEnabledSearchers.filter((s) => !executedEngineNames.has(s.name))
    if (remainingSearchers.length > 0) {
      const unexecutedOutputs = await this.executeSearch(remainingSearchers, options)
      notices.push(...this.collectNotices(unexecutedOutputs))
      unexecutedOutputs.forEach((output) => {
        if (output.error) collectedErrors.push(output.error)
        if (output.results.length > 0) executedOutputs.push(output)
      })
    }

    const displayableLow = executedOutputs
      .map((output) => ({
        engine: output.engine,
        results: output.results.slice(0, this.getLowConfidenceLimit(output.engine)),
      }))
      .filter((output) => output.results.length > 0)

    if (displayableLow.length === 0) {
      let finalMessage = SEARCH_MESSAGES.NO_RESULTS
      if (collectedErrors.length > 0) finalMessage += '\n\n' + SEARCH_MESSAGES.PROBLEMS_ENCOUNTERED + '\n' + collectedErrors.join('\n')
      if (notices.length > 0) finalMessage += '\n\n' + notices.join('\n')
      await session.send(finalMessage)
      return
    }

    await session.send(SEARCH_MESSAGES.NO_HIGH_CONFIDENCE)
    const figureMessage = h('figure')
    const nodePromises = displayableLow.flatMap((output) =>
      output.results.map((result) =>
        MessageBuilder.buildLowConfidenceNode(this.ctx, result, output.engine, botUser)
      )
    )
    figureMessage.children.push(...(await Promise.all(nodePromises)))
    await MessageBuilder.sendFigureMessage(session, figureMessage, SEARCH_MESSAGES.FORWARD_LOW_CONFIDENCE_FAILED)

    if (collectedErrors.length > 0) {
      await session.send(SEARCH_MESSAGES.PARTIAL_FAILURE + '\n' + collectedErrors.join('\n'))
    }
  }

  public async handleParallelSearch(
    searchers: Searcher[],
    options: SearchOptions,
    botUser: any,
    session: Session,
    collectedErrors: string[],
    sortedEnhancers: Enhancer[]
  ): Promise<void> {
    const abortController = new AbortController()
    const { signal } = abortController

    // 任一附加引擎开启了「总是附加」时，不能提前中止搜索
    const hasAlwaysAttachEngine = SEARCH_ENGINES.ATTACH.some((name) => isAlwaysAttach(this.config, name))

    const isFastFirstMode =
      this.config.search.parallelHighConfidenceStrategy === 'first' &&
      !hasAlwaysAttachEngine

    let highConfidenceSent = false
    const lowConfidenceOutputs: SearchOutput[] = []
    const notices: string[] = []
    const processedEnhancements = new Set<string>()
    const successfulEnhancers = new Set<string>()
    const completedMainEngines = new Set<SearchEngineName>()

    let tempFile: { filePath: string; cleanup: () => Promise<void> } | null = null
    let optionsWithTempFile = options
    const needsPuppeteer = searchers.some((s) => SEARCH_ENGINES.PUPPETEER.includes(s.name as any))

    if (needsPuppeteer) {
      tempFile = await this.puppeteerManager.createTempFile(options.imageBuffer, options.fileName)
      optionsWithTempFile = { ...options, tempFilePath: tempFile.filePath }
    }

    const searchPromises = searchers.map(async (searcher) => {
      if (signal.aborted) return

      const performTask = () => {
        const searchOptions = SEARCH_ENGINES.PUPPETEER.includes(searcher.name as any) ? optionsWithTempFile : options
        return this.performSearch(searcher, searchOptions)
      }

      let output: SearchOutput
      if (SEARCH_ENGINES.PUPPETEER.includes(searcher.name as any)) {
        if (this.config.debug.enabled) logger.info(`Puppeteer 任务 [${searcher.name}] 已加入队列。`)
        output = await this.puppeteerSemaphore.run(performTask, signal)
      } else {
        output = await performTask()
      }

      if (signal.aborted) return
      if (output.error) {
        collectedErrors.push(output.error)
        return
      }

      // 引擎主动跳过（如 IQDB 排队）：只记录安静提示
      if (output.notice) {
        notices.push(output.notice)
        if (SEARCH_ENGINES.MAIN.includes(searcher.name as any)) {
          completedMainEngines.add(searcher.name)
        }
        return
      }

      if (SEARCH_ENGINES.MAIN.includes(searcher.name as any)) {
        completedMainEngines.add(searcher.name)
      }

      const isMainEngine = SEARCH_ENGINES.MAIN.includes(searcher.name as any)
      const highConfidenceResults = isMainEngine
        ? output.results.filter((r) => r.similarity >= this.getConfidenceThreshold(searcher.name))
        : []

      if (highConfidenceResults.length > 0) {
        if (isFastFirstMode) {
          if (highConfidenceSent) return
          highConfidenceSent = true
          abortController.abort()
          await session.send(`[${output.engine}] ${SEARCH_MESSAGES.SEARCH_COMPLETE}`)
          const { enhancedResult, enhancementId } = await this.enhanceResult(
            highConfidenceResults[0],
            sortedEnhancers,
            processedEnhancements,
            successfulEnhancers
          )
          if (enhancementId) processedEnhancements.add(enhancementId)
          const figureMessage = h('figure')
          await MessageBuilder.buildHighConfidenceMessage(
            figureMessage,
            this.ctx,
            this.config,
            highConfidenceResults[0],
            output.engine,
            botUser,
            enhancedResult
          )
          await MessageBuilder.sendFigureMessage(session, figureMessage, SEARCH_MESSAGES.FORWARD_FAILED)
        } else {
          if (this.config.search.parallelHighConfidenceStrategy === 'first' && highConfidenceSent) return

          highConfidenceSent = true
          await session.send(`[${output.engine}] ${SEARCH_MESSAGES.SEARCH_COMPLETE}`)
          const figureMessage = h('figure')
          let resultsToShow = highConfidenceResults
          if (output.engine === SPECIAL_ENGINES.SOUTUBOT) {
            resultsToShow = resultsToShow.slice(0, this.config.soutubot.maxHighConfidenceResults)
          } else if (this.config.search.parallelHighConfidenceStrategy === 'first') {
            resultsToShow = [resultsToShow.reduce((prev, curr) => (prev.similarity > curr.similarity ? prev : curr))]
          }

          for (const result of resultsToShow) {
            const { enhancedResult, enhancementId } = await this.enhanceResult(
              result,
              sortedEnhancers,
              processedEnhancements,
              successfulEnhancers
            )
            if (enhancementId) processedEnhancements.add(enhancementId)
            await MessageBuilder.buildHighConfidenceMessage(
              figureMessage,
              this.ctx,
              this.config,
              result,
              output.engine,
              botUser,
              enhancedResult
            )
          }
          await MessageBuilder.sendFigureMessage(session, figureMessage, SEARCH_MESSAGES.FORWARD_FAILED)
        }
      } else if (output.results.length > 0) {
        lowConfidenceOutputs.push(output)
      }
    })

    const results = await Promise.allSettled(searchPromises)
    results.forEach((result) => {
      if (result.status === 'rejected' && result.reason?.name !== 'AbortError') {
        logger.warn('并行搜索中发生未捕获的错误:', result.reason)
      }
    })

    const enabledMainEngines = searchers.filter((s) => SEARCH_ENGINES.MAIN.includes(s.name as any))
    if (
      !isFastFirstMode &&
      !hasAlwaysAttachEngine &&
      enabledMainEngines.every((s) => completedMainEngines.has(s.name))
    ) {
      if (!signal.aborted) abortController.abort()
    }

    if (tempFile) await tempFile.cleanup()
    if (signal.aborted && isFastFirstMode) return

    if (!highConfidenceSent) {
      const finalLowConfidence = lowConfidenceOutputs.filter((o) => {
        const wasAborted = results.find((r) => r.status === 'rejected' && r.reason?.name === 'AbortError')
        // 因提前中止而未跑完的附加引擎结果不展示
        return !(wasAborted && SEARCH_ENGINES.ATTACH.includes(o.engine as any))
      })
      const displayableLow = finalLowConfidence
        .map((output) => ({
          engine: output.engine,
          results: output.results.slice(0, this.getLowConfidenceLimit(output.engine)),
        }))
        .filter((output) => output.results.length > 0)

      if (displayableLow.length === 0) {
        let finalMessage = SEARCH_MESSAGES.NO_RESULTS
        if (collectedErrors.length > 0) finalMessage += '\n\n' + SEARCH_MESSAGES.PROBLEMS_ENCOUNTERED + '\n' + collectedErrors.join('\n')
        const uniqueNotices = [...new Set(notices)]
        if (uniqueNotices.length > 0) finalMessage += '\n\n' + uniqueNotices.join('\n')
        await session.send(finalMessage)
        return
      }

      await session.send(SEARCH_MESSAGES.NO_HIGH_CONFIDENCE)
      const uniqueNotices = [...new Set(notices)]
      if (uniqueNotices.length > 0) await session.send(uniqueNotices.join('\n'))
      const figureMessage = h('figure')
      const nodePromises = displayableLow.flatMap((output) =>
        output.results.map((result) =>
          MessageBuilder.buildLowConfidenceNode(this.ctx, result, output.engine, botUser)
        )
      )
      figureMessage.children.push(...(await Promise.all(nodePromises)))
      await MessageBuilder.sendFigureMessage(session, figureMessage, SEARCH_MESSAGES.FORWARD_LOW_CONFIDENCE_FAILED)
    }

    if (collectedErrors.length > 0) {
      await session.send(SEARCH_MESSAGES.PARTIAL_FAILURE + '\n' + collectedErrors.join('\n'))
    }
  }
}

