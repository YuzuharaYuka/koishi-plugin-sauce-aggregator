// 搜索策略模块
// 负责选择并执行合适的搜索模式（直接 / 并行 / 顺序）

import { Session } from 'koishi'
import { Config, Searcher, SearchOptions, Enhancer } from './config'
import { SEARCH_FILTERS } from './constants'
import { SearchHandler } from './core/search'
import { CommandHandler } from './core/command'

// 选择并执行搜索策略：根据参数和配置决定搜索模式
export async function selectSearchStrategy(
  isSingleEngineSpecified: boolean,
  searchOptions: SearchOptions,
  searchHandler: SearchHandler,
  commandHandler: CommandHandler,
  allEnabledSearchers: Searcher[],
  searchersToUse: Searcher[],
  options: Record<string, any>,
  config: Config,
  botUser: any,
  session: Session,
  sortedEnhancers: Enhancer[]
): Promise<string | void> {
  const collectedErrors: string[] = []
  const isDirect = isSingleEngineSpecified || options.all

  if (isDirect) {
    // 直接搜索：指定单个引擎或强制搜索所有引擎
    const mainSearchers = options.all ? allEnabledSearchers : searchersToUse
    const attachSearchers = options.all ? [] : commandHandler.getAttachSearchers(mainSearchers)
    return await searchHandler.handleDirectSearch(
      mainSearchers,
      attachSearchers,
      isSingleEngineSpecified,
      !!options.all,
      searchOptions,
      botUser,
      session,
      collectedErrors,
      sortedEnhancers
    )
  } else if (config.search.mode === 'parallel') {
    // 并行搜索：同时执行所有启用的引擎
    return await searchHandler.handleParallelSearch(
      allEnabledSearchers,
      searchOptions,
      botUser,
      session,
      collectedErrors,
      sortedEnhancers
    )
  } else {
    // 顺序搜索：依次执行启用的引擎，排除某些特定引擎
    const sequentialSearchers = allEnabledSearchers.filter(
      (s) => !SEARCH_FILTERS.SEQUENTIAL_EXCLUDE.includes(s.name as any)
    )
    return await searchHandler.handleSequentialSearch(
      sequentialSearchers,
      searchOptions,
      botUser,
      session,
      collectedErrors,
      sortedEnhancers
    )
  }
}
