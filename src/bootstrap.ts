// 插件初始化与引擎/增强器启动模块
// 负责初始化所有搜图引擎、图源增强器和 Puppeteer 管理器

import { Context } from 'koishi'
import {} from 'koishi-plugin-puppeteer' // 仅为类型声明而导入
import { Config, Searcher, Enhancer } from './config'
import { SauceNAO } from './searchers/saucenao'
import { TraceMoe } from './searchers/tracemoe'
import { IQDB } from './searchers/iqdb'
import { Yandex } from './searchers/yandex'
import { Ascii2D } from './searchers/ascii2d'
import { SoutuBot } from './searchers/soutubot'
import { YandeReEnhancer } from './enhancers/yande'
import { KonachanEnhancer } from './enhancers/konachan'
import { GelbooruEnhancer } from './enhancers/gelbooru'
import { DanbooruEnhancer } from './enhancers/danbooru'
import { PixivEnhancer } from './enhancers/pixiv'
import { PuppeteerManager, GlobalPuppeteer } from './puppeteer'
import { DebugLogger } from './core/logger'
import { Logger } from 'koishi'

const logger = new Logger('sauce-aggregator')

// Enhancer 初始化元数据与验证器
interface EnhancerMetadata {
  constructor: new (ctx: Context, config: Config, subConfig: unknown, puppeteerManager?: PuppeteerManager) => Enhancer
  needsKeys: boolean
  /** 缺少凭据时用于提示的说明文字，需自带反引号 */
  keyLabel: string
  configKey: keyof Config
  validator: (config: Config) => boolean
}

// 创建各图源增强器的元数据和验证器
const ENHANCER_METADATA: Record<string, EnhancerMetadata> = {
  yandere: {
    constructor: YandeReEnhancer,
    needsKeys: false,
    keyLabel: '',
    configKey: 'yandere',
    validator: () => true,
  },
  konachan: {
    constructor: KonachanEnhancer,
    needsKeys: false,
    keyLabel: '',
    configKey: 'konachan',
    validator: () => true,
  },
  gelbooru: {
    constructor: GelbooruEnhancer,
    needsKeys: true,
    keyLabel: '`API Key`',
    configKey: 'gelbooru',
    validator: (c: Config) => c.gelbooru.keyPairs?.some((p) => p.userId && p.apiKey) ?? false,
  },
  danbooru: {
    constructor: DanbooruEnhancer,
    needsKeys: true,
    keyLabel: '`用户名` 与 `API Key`',
    configKey: 'danbooru',
    validator: (c: Config) => c.danbooru.keyPairs?.some((p) => p.username && p.apiKey) ?? false,
  },
  pixiv: {
    constructor: PixivEnhancer,
    needsKeys: true,
    keyLabel: '`Refresh Token`',
    configKey: 'pixiv',
    validator: (c: Config) => !!c.pixiv.refreshToken,
  },
}

// 初始化 Puppeteer 管理器
export function initializePuppeteerManager(ctx: Context, config: Config, debugLogger: DebugLogger): PuppeteerManager {
  if (config.puppeteer.provider === 'global') {
    if (ctx.puppeteer) {
      logger.info('[bootstrap] 正在使用全局 `puppeteer` 服务。')
      return new PuppeteerManager(ctx, config, ctx.puppeteer as unknown as GlobalPuppeteer)
    } else {
      logger.warn('[bootstrap] 已配置使用全局 `puppeteer` 服务，但该服务未启用，将回退到内置 `puppeteer-extra`。')
      return new PuppeteerManager(ctx, config)
    }
  } else {
    logger.info('[bootstrap] 正在使用插件内置的 `puppeteer-extra` 服务。')
    return new PuppeteerManager(ctx, config)
  }
}

// 初始化所有搜图引擎
export function initializeSearchers(
  ctx: Context,
  config: Config,
  puppeteerManager: PuppeteerManager
): Record<string, Searcher> {
  const allSearchers: Record<string, Searcher> = {}

  if (config.saucenao.apiKeys?.filter(Boolean).length > 0) {
    allSearchers.saucenao = new SauceNAO(ctx, config, config.saucenao)
  } else {
    logger.info('[bootstrap] [saucenao] 未配置有效的 `API Key`，引擎已禁用。')
  }

  const basicSearchers = { tracemoe: TraceMoe, iqdb: IQDB }
  // soutubot 直接调用站点搜索接口，不需要浏览器实例
  const puppeteerSearchers = { yandex: Yandex, ascii2d: Ascii2D }

  for (const [name, Ctor] of Object.entries(basicSearchers)) {
    allSearchers[name] = new Ctor(ctx, config, config[name])
  }

  allSearchers.soutubot = new SoutuBot(ctx, config, config.soutubot)

  for (const [name, Ctor] of Object.entries(puppeteerSearchers)) {
    allSearchers[name] = new Ctor(ctx, config, config[name], puppeteerManager)
  }

  return allSearchers
}

// 初始化所有图源增强器
export function initializeEnhancers(
  ctx: Context,
  config: Config,
  puppeteerManager: PuppeteerManager
): Record<string, Enhancer> {
  const allEnhancers: Record<string, Enhancer> = {}

  for (const [name, metadata] of Object.entries(ENHANCER_METADATA)) {
    if (metadata.validator(config)) {
      const subConfig = config[metadata.configKey]
      allEnhancers[name] = new metadata.constructor(ctx, config, subConfig, puppeteerManager)
    } else if (metadata.needsKeys) {
      logger.info(`[bootstrap] [${name}] 图源未配置有效的 ${metadata.keyLabel}，将无法启用。`)
    }
  }

  return allEnhancers
}
