import { Logger as KoishiLogger } from 'koishi'
import { Config } from '../config'

/**
 * 系统化的调试日志工具类
 * 作用：统一管理调试日志，避免重复的 if (config.debug.enabled) 检查
 */
export class DebugLogger {
  private enabled: boolean
  private logger: KoishiLogger
  private logApiResponses: Set<string>

  constructor(moduleName: string, config: Config) {
    this.logger = new KoishiLogger(`sauce-aggregator:${moduleName}`)
    this.enabled = config.debug.enabled
    this.logApiResponses = new Set(config.debug.logApiResponses)
  }

  info(message: string, ...args: unknown[]): void {
    if (this.enabled) {
      this.logger.info(message, ...args)
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.enabled) {
      this.logger.warn(message, ...args)
    }
  }

  apiResponse(moduleName: string, response: unknown): void {
    if (this.logApiResponses.has(moduleName)) {
      this.logger.info(`[${moduleName}] API 响应: ${JSON.stringify(response, null, 2)}`)
    }
  }

  always(message: string, ...args: unknown[]): void {
    this.logger.info(message, ...args)
  }
}

