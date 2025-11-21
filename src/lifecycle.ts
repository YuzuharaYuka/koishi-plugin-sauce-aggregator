// 插件生命周期管理模块
// 负责 Puppeteer 初始化与资源清理

import { Context, Logger } from 'koishi'
import { Config, SearchEngineName } from './config'
import { PuppeteerManager } from './puppeteer'
import { DebugLogger } from './core/logger'

const logger = new Logger('sauce-aggregator:lifecycle')

// Puppeteer 浏览器实例初始化（仅在需要时执行）
export async function initializePuppeteer(
  ctx: Context,
  config: Config,
  puppeteerManager: PuppeteerManager,
  debugLogger: DebugLogger
): Promise<void> {
  if (config.puppeteer.provider === 'internal' && config.puppeteer.persistentBrowser) {
    const puppeteerSearchers: SearchEngineName[] = ['yandex', 'ascii2d', 'soutubot']
    const needsPuppeteerForSearch = config.order.some(
      (e) => e.enabled && puppeteerSearchers.includes(e.engine)
    )
    if (needsPuppeteerForSearch) {
      try {
        await puppeteerManager.initialize()
        debugLogger.always('浏览器实例初始化成功')
      } catch (error) {
      logger.error('初始化浏览器失败，相关引擎将不可用:', error)
        const affectedEngines = config.order
          .filter(e => e.enabled && puppeteerSearchers.includes(e.engine))
          .map(e => e.engine)
          .join(', ')
        if (affectedEngines) logger.warn(`以下引擎将被禁用: ${affectedEngines}`)
      }
    }
  }
}

// 清理 Puppeteer 资源
export function disposePuppeteer(puppeteerManager: PuppeteerManager): void {
  try {
    puppeteerManager.dispose()
  } catch (error) {
    logger.warn('清理 Puppeteer 资源时出错:', error)
  }
}

// 注册生命周期钩子
export function registerLifecycleHooks(
  ctx: Context,
  config: Config,
  puppeteerManager: PuppeteerManager,
  debugLogger: DebugLogger
): void {
  ctx.on('ready', () => initializePuppeteer(ctx, config, puppeteerManager, debugLogger))
  ctx.on('dispose', () => disposePuppeteer(puppeteerManager))
}
