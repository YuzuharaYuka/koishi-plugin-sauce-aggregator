
// 插件配置与类型定义

import { Schema, Context, h } from 'koishi'
import { Buffer } from 'buffer'


// 支持的搜图引擎标识
export type SearchEngineName = 'saucenao' | 'iqdb' | 'tracemoe' | 'yandex' | 'ascii2d' | 'googlelens' | 'soutubot'
// 支持的图源增强器标识
export type EnhancerName = 'yandere' | 'gelbooru' | 'danbooru' | 'pixiv' | 'konachan'

// soutubot 搜索模式与站点 factor 参数的对应关系
// 站点上是「常规 / 严格」开关，因子越大匹配越严格、越容易没有结果
export const SOUTUBOT_SEARCH_MODE_FACTOR: Record<'normal' | 'strict', number> = {
  normal: 1.2,
  strict: 1.4,
}


// 搜图函数输入选项
export interface SearchOptions {
  imageUrl: string
  imageBuffer: Buffer
  fileName: string
  /** 单个引擎的候选结果上限（内部值，不对外暴露） */
  resultLimit: number
  tempFilePath?: string
}


// 图片输入信息
export interface ImageInput {
  url: string
  name: string
}


// 指令参数解析结果
export interface CommandParseResult {
  searchersToUse: Searcher[]
  imageInputText: string
  isSingleEngineSpecified: boolean
}


// 搜图引擎返回结果格式
export namespace Searcher {
  export interface Result {
    thumbnail: string
    similarity: number
    url: string
    source?: string
    author?: string
    time?: string
    details?: string[]
    coverImage?: string
    videoPreview?: ArrayBuffer
  }
}


// 图源增强器返回结果格式
export interface EnhancedResult {
  details: h[]
  imageBuffer?: Buffer
  imageType?: string
  additionalImages?: h[]
}


// 调试配置
export interface DebugConfig {
  enabled: boolean
  logApiResponses: (SearchEngineName | EnhancerName)[]
}


// Puppeteer 浏览器配置
export interface PuppeteerConfig {
  provider: 'internal' | 'global'; // 浏览器服务方式
  persistentBrowser: boolean
  browserCloseTimeout: number
  browserLaunchTimeout: number
  restartInterval: number;
  chromeExecutablePath: string
  concurrency: number;
  tempPath: string;
}


// 搜索设置配置
export interface SearchConfig {
  mode: 'sequential' | 'parallel';
  parallelHighConfidenceStrategy: 'first' | 'all';
}


// 图片预处理配置
export interface ImageConfig {
  /** 上传前的最长边上限（像素），0 表示不缩放 */
  maxEdge: number
  /** 上传前的体积上限（MB），0 表示不压缩 */
  maxSizeMB: number
  /** 重新编码为 JPEG 时的质量 */
  quality: number
}


// 图源增强器抽象类
export abstract class Enhancer<T = any> {
  abstract name: EnhancerName
  public needsPuppeteer: boolean = false;
  constructor(public ctx: Context, public mainConfig: Config, public subConfig: T) {}
  abstract enhance(result: Searcher.Result): Promise<EnhancedResult | null>;
}


// 搜图引擎抽象类
export abstract class Searcher<T = any> {
  abstract name: SearchEngineName
  constructor(public ctx: Context, public mainConfig: Config, public subConfig: T) {}
  abstract search(options: SearchOptions): Promise<Searcher.Result[]>
}


// 插件完整配置接口
export interface Config {
  proxy: string;
  order: { engine: SearchEngineName; enabled: boolean }[]
  enhancerOrder: { engine: EnhancerName; enabled: boolean }[]
  promptTimeout: number
  requestTimeout: number
  prependLinkParsingMiddleware: boolean;
  enhancerRetryCount: number;
  search: SearchConfig
  image: ImageConfig
  puppeteer: PuppeteerConfig
  debug: DebugConfig
  saucenao: SauceNAO.Config
  tracemoe: TraceMoe.Config
  iqdb: IQDB.Config
  yandex: Yandex.Config
  yandere: YandeRe.Config
  konachan: Konachan.Config
  gelbooru: Gelbooru.Config
  danbooru: Danbooru.Config
  ascii2d: Ascii2D.Config
  googlelens: GoogleLens.Config
  soutubot: SoutuBot.Config
  pixiv: Pixiv.Config
}

export namespace SauceNAO { export interface Config { apiKeys: string[]; confidenceThreshold?: number; maxLowConfidenceResults?: number; } }
export namespace TraceMoe { export interface Config { sendVideoPreview: boolean; confidenceThreshold?: number; maxLowConfidenceResults?: number; } }
export namespace IQDB {
  export interface Config {
    confidenceThreshold?: number
    maxLowConfidenceResults?: number
    /** 排队繁忙/超时后的冷却分钟数，0 表示不冷却 */
    cooldownMinutes?: number
    /** 单次搜索的等待上限（秒） */
    timeoutSeconds?: number
  }
}
export namespace Yandex {
  export interface Config {
    alwaysAttach: boolean
    domain: 'ya.ru' | 'yandex.com'
    maxLowConfidenceResults?: number
    /** 搜索失败（多为页面未加载完或站点抖动）时的自动重试次数 */
    retries: number
  }
}
export namespace YandeRe { export interface Config { postQuality: 'jpeg' | 'sample' | 'original'; maxRating: 's' | 'q' | 'e'; enableLinkParsing: boolean; } }
export namespace Konachan { export interface Config { postQuality: 'jpeg' | 'sample' | 'original'; maxRating: 's' | 'q' | 'e'; enableLinkParsing: boolean; } }
export namespace Gelbooru { export interface Config { keyPairs: { userId: string; apiKey: string }[]; postQuality: 'original' | 'sample' | 'preview'; maxRating: 'general' | 'sensitive' | 'questionable' | 'explicit'; enableLinkParsing: boolean; } }
export namespace Danbooru { export interface Config { keyPairs: { username: string; apiKey: string }[]; postQuality: 'original' | 'sample' | 'preview'; maxRating: 'general' | 'sensitive' | 'questionable' | 'explicit'; enableLinkParsing: boolean; userAgentId?: string; } }
export namespace Ascii2D {
  export interface Config {
    alwaysAttach: boolean
    maxLowConfidenceResults?: number
    /** 搜索失败（多为 Cloudflare 挑战或站点抖动）时的自动重试次数 */
    retries: number
    /** 提交后等待结果出现的额外秒数，用于容忍 Cloudflare 挑战 */
    resolveTimeout: number
  }
}

export namespace GoogleLens {
  export interface Config {
    /** SerpApi 的 API Key 列表，支持多 Key 轮询 */
    apiKeys: string[]
    /** 总是附加结果：开启后即使已找到高匹配度结果也一并展示 */
    alwaysAttach: boolean
    /** 结果语言，影响标题语言与来源站点覆盖 */
    hl: 'zh-cn' | 'zh-tw' | 'en' | 'ja'
    /** 向 SerpApi 请求的最大结果数 */
    maxResults: number
    maxLowConfidenceResults?: number
  }
}
export namespace SoutuBot {
  export interface Config {
    confidenceThreshold?: number
    maxHighConfidenceResults?: number
    maxLowConfidenceResults?: number
    searchMode?: 'normal' | 'strict'
    topK?: number
    useProxy?: boolean
    apiEndpoint?: string
  }
}
export namespace Pixiv { export interface Config { refreshToken: string; clientId: string; clientSecret: string; postQuality: 'original' | 'large' | 'medium'; allowR18: boolean; enableLinkParsing: boolean; maxImagesInPost: number; } }

const puppeteerConfig = Schema.object({
    provider: Schema.union([
      Schema.const('internal').description('插件内置'),
      Schema.const('global').description('全局服务'),
    ]).default('internal').description(
      '**浏览器服务**<br>' +
      '插件内置：使用自带浏览器，可通过简单人机验证<br>' +
      '全局服务：使用 `koishi-plugin-puppeteer` 等插件提供的浏览器'
    ),
    persistentBrowser: Schema.boolean().default(false).description('浏览器常驻后台，响应更快，但会持续占用内存'),
    concurrency: Schema.number().min(1).max(3).default(1).description('同时执行的浏览器任务数；越高越占资源，建议 `1`'),
    browserCloseTimeout: Schema.number().default(30).min(0).description('非常驻模式下，任务结束后等待多久关闭浏览器（秒）'),
    browserLaunchTimeout: Schema.number().default(90).min(10).description('浏览器启动超时（秒）'),
    restartInterval: Schema.number().min(0).default(6).description('常驻模式下每隔几小时空闲重启，`0` 不重启'),
    chromeExecutablePath: Schema.string().description('浏览器可执行文件路径，留空自动检测'),
    tempPath: Schema.string().description(
      '临时目录，留空使用 `./data/temp/sauce-aggregator`；Docker 下需指向共享卷'
    ),
})

export const Config: Schema<Config> = Schema.intersect([
  // ==================== 引擎与图源 ====================
  Schema.object({
    order: Schema.array(Schema.object({
      engine: Schema.union(['saucenao', 'iqdb', 'tracemoe', 'soutubot', 'yandex', 'ascii2d', 'googlelens']).description('搜图引擎'),
      enabled: Schema.boolean().default(true).description('是否启用'),
    }))
      .role('table')
      .default([
        { engine: 'saucenao', enabled: true }, { engine: 'iqdb', enabled: true }, { engine: 'tracemoe', enabled: true },
        { engine: 'soutubot', enabled: true }, { engine: 'ascii2d', enabled: true }, { engine: 'yandex', enabled: true },
        { engine: 'googlelens', enabled: true },
      ])
      .description('**搜图引擎**<br>' +
        '拖动排序，关闭开关即停用<br>' +
        '找到高匹配度结果后停止（`--all` 或并行模式除外）<br>' +
        '`Yandex`、`Ascii2D`、`Google Lens` 只作补充结果'),
    enhancerOrder: Schema.array(Schema.object({
      engine: Schema.union(['gelbooru', 'yandere', 'danbooru', 'pixiv', 'konachan']).description('图源'),
      enabled: Schema.boolean().default(true).description('是否启用'),
    }))
      .role('table')
      .default([
        { engine: 'yandere', enabled: true }, { engine: 'konachan', enabled: true }, { engine: 'gelbooru', enabled: true },
        { engine: 'danbooru', enabled: true }, { engine: 'pixiv', enabled: true },
      ])
      .description('**结果图源**<br>' +
        '高匹配度结果按此顺序尝试获取详情与原图'),
  }).description('引擎与图源'),

  // ==================== 搜索设置 ====================
  Schema.object({
    search: Schema.object({
      mode: Schema.union([
          Schema.const('sequential').description('串行模式'),
          Schema.const('parallel').description('并行模式'),
      ]).default('sequential').description(
          '**搜索模式**<br>' +
          '串行：逐个搜索，找到高匹配度结果后停止<br>' +
          '并行：同时搜索，找到后立即返回'
      ),
      parallelHighConfidenceStrategy: Schema.union([
          Schema.const('first').description('返回最先找到的结果'),
          Schema.const('all').description('返回所有高匹配度结果'),
      ]).default('first').description(
          '并行模式下，命中多个高匹配度结果时的取法'
      )
    }),
    promptTimeout: Schema.number().default(60).min(10).description('等待用户发图的时长（秒）'),
  }).description('搜索设置'),

  // ==================== 网络设置 ====================
  Schema.object({
    proxy: Schema.string().default('http://127.0.0.1:7890').description(
      '**独立代理**<br>' +
      '仅用于 Danbooru 图源与搜图bot酱、Yandex、Ascii2D 引擎<br>' +
      '留空则这些请求直连，其余跟随全局代理'
    ),
    requestTimeout: Schema.number().default(30).min(5).description('网络请求超时（秒）'),
    enhancerRetryCount: Schema.number().min(0).max(5).default(1).description('图源图片下载失败后的重试次数'),
  }).description('网络设置'),

  // ==================== 链接解析 ====================
  Schema.object({
    prependLinkParsingMiddleware: Schema.boolean().default(false).description('**优先解析图源链接**<br>' +
      '先于其他插件处理消息中的图源链接<br>' +
      '可能使同类链接解析插件失效'),
  }).description('链接解析'),

  // ==================== 图片处理 ====================
  Schema.object({
    image: Schema.object({
      maxEdge: Schema.number().min(0).max(8000).default(2000).description('**最长边（像素）**<br>' +
        '上传前超过该值则等比缩小，`0` 不缩放'),
      maxSizeMB: Schema.number().min(0).max(20).default(2).description('**体积上限（MB）**<br>' +
        '上传前超过该值则压缩，`0` 不压缩'),
      quality: Schema.number().min(50).max(100).default(90).description('重新编码为 JPEG 时的质量'),
    }),
  }).description('图片处理'),

  // ==================== 浏览器 ====================
  Schema.object({
    puppeteer: puppeteerConfig,
  }).description('浏览器'),

  // ==================== 引擎配置 ====================
  Schema.object({
    saucenao: Schema.object({
      apiKeys: Schema.array(Schema.string().role('secret')).description('**SauceNAO API Key**<br>' +
        '登录后，在 [API 设置](https://saucenao.com/user.php?page=search-api) 获取<br>' +
        '可填多个，按顺序轮询'),
      confidenceThreshold: Schema.number().min(0).max(100).default(85).description('高匹配度阈值（%），`0` 不筛选'),
      maxLowConfidenceResults: Schema.number().min(0).max(10).default(2).description('低匹配度结果展示上限（条），`0` 不展示'),
    }).description('SauceNAO 设置'),
    tracemoe: Schema.object({
      confidenceThreshold: Schema.number().min(0).max(100).default(90).description('高匹配度阈值（%），`0` 不筛选'),
      maxLowConfidenceResults: Schema.number().min(0).max(10).default(0).description('低匹配度结果展示上限（条），`0` 不展示'),
      sendVideoPreview: Schema.boolean().default(true).description('高匹配度结果附带视频预览'),
    }).description('Trace.moe 设置'),
    iqdb: Schema.object({
      confidenceThreshold: Schema.number().min(0).max(100).default(85).description('高匹配度阈值（%），`0` 不筛选'),
      maxLowConfidenceResults: Schema.number().min(0).max(10).default(2).description('低匹配度结果展示上限（条），`0` 不展示'),
      timeoutSeconds: Schema.number().min(5).max(120).default(20).description('**等待上限（秒）**<br>' +
        'IQDB 繁忙时会排队，超时则跳过 IQDB'),
      cooldownMinutes: Schema.number().min(0).max(120).default(10).description('**繁忙冷却（分钟）**<br>' +
        '排队超时后暂停使用 IQDB，`0` 不冷却'),
    }).description('IQDB 设置'),
    soutubot: Schema.object({
      searchMode: Schema.union([
        Schema.const('normal').description('常规'),
        Schema.const('strict').description('严格'),
      ]).default('normal').description('常规 / 严格模式；严格更精确，但更容易没有结果'),
      topK: Schema.number().min(1).max(50).default(25).description('每个图库索引请求的候选数'),
      confidenceThreshold: Schema.number().min(0).max(100).default(60).description('高匹配度阈值（%），`0` 不筛选'),
      maxHighConfidenceResults: Schema.number().min(1).max(10).default(3).description('高匹配度结果展示上限（条）'),
      maxLowConfidenceResults: Schema.number().min(0).max(10).default(2).description('低匹配度结果展示上限（条），`0` 不展示'),
      apiEndpoint: Schema.string().default('https://soutubot.moe/api/search').description('接口地址，站点换域名时可覆盖'),
      useProxy: Schema.boolean().default(true).description('使用「网络设置」中的独立代理访问'),
    }).description('搜图bot酱设置'),
    yandex: Schema.object({
      domain: Schema.union([
        Schema.const('ya.ru').description('ya.ru（推荐）'),
        Schema.const('yandex.com').description('yandex.com（可能锁区）'),
      ]).default('ya.ru').description('搜索域名，`ya.ru` 更稳定'),
      retries: Schema.number().min(0).max(3).default(1).description('搜索失败后的重试次数'),
      maxLowConfidenceResults: Schema.number().min(0).max(10).default(2).description('低匹配度结果展示上限（条），`0` 不展示'),
      alwaysAttach: Schema.boolean().default(false).description('即使找到高匹配度结果，也展示 `Yandex` 结果'),
    }).description('Yandex 设置'),
    ascii2d: Schema.object({
        retries: Schema.number().min(0).max(3).default(1).description('搜索失败后的重试次数'),
        resolveTimeout: Schema.number().min(10).max(180).default(60).description('提交后等待结果的时间（秒），与网络请求超时取较大值'),
        maxLowConfidenceResults: Schema.number().min(0).max(10).default(2).description('低匹配度结果展示上限（条），`0` 不展示'),
        alwaysAttach: Schema.boolean().default(false).description('即使找到高匹配度结果，也展示 `Ascii2D` 结果'),
    }).description('Ascii2D 设置'),
    googlelens: Schema.object({
      apiKeys: Schema.array(Schema.string().role('secret')).default([]).description(
        '**SerpApi API Key**<br>' +
        'Google Lens 通过 [SerpApi](https://serpapi.com/) 调用，在 [控制台](https://serpapi.com/manage-api-key) 获取<br>' +
        '免费额度 250 次/月；可填多个，按顺序轮询；额度用尽的 Key 自动跳过'),
      hl: Schema.union([
        Schema.const('zh-cn').description('简体中文'),
        Schema.const('zh-tw').description('繁体中文'),
        Schema.const('ja').description('日文'),
        Schema.const('en').description('英文'),
      ]).default('zh-cn').description('结果语言，影响标题与来源站点'),
      maxResults: Schema.number().min(1).max(20).default(5).description(
        '请求的结果数；同一站点只保留最靠前一条'),
      maxLowConfidenceResults: Schema.number().min(0).max(10).default(2).description('低匹配度结果展示上限（条），`0` 不展示'),
      alwaysAttach: Schema.boolean().default(false).description(
        '即使找到高匹配度结果，也展示 `Google Lens` 结果'),
    }).description('Google Lens 设置'),
  }).description('引擎配置'),

  // ==================== 图源配置 ====================
  Schema.object({
    yandere: Schema.object({
      postQuality: Schema.union([
        Schema.const('original').description('原图'),
        Schema.const('jpeg').description('原尺寸 JPG'),
        Schema.const('sample').description('样本图'),
      ]).default('jpeg').description('取图质量'),
      maxRating: Schema.union([
          Schema.const('s').description('安全'),
          Schema.const('q').description('可疑'),
          Schema.const('e').description('露骨'),
      ]).default('s').description('允许展示的最高内容评级'),
      enableLinkParsing: Schema.boolean().default(false).description('自动解析本站帖子与图片链接'),
    }).description('Yande.re 图源设置'),
    konachan: Schema.object({
      postQuality: Schema.union([
        Schema.const('original').description('原图'),
        Schema.const('jpeg').description('原尺寸 JPG'),
        Schema.const('sample').description('样本图'),
      ]).default('jpeg').description('取图质量'),
      maxRating: Schema.union([
          Schema.const('s').description('安全'),
          Schema.const('q').description('可疑'),
          Schema.const('e').description('露骨'),
      ]).default('s').description('允许展示的最高内容评级'),
      enableLinkParsing: Schema.boolean().default(false).description('自动解析本站帖子与图片链接'),
    }).description('Konachan 图源设置'),
    gelbooru: Schema.object({
      keyPairs: Schema.array(Schema.object({
          userId: Schema.string().description('User ID').required(),
          apiKey: Schema.string().role('secret').description('API Key').required(),
      })).description('**Gelbooru API 凭据**<br>' +
        '登录后，在 [账号设置](https://gelbooru.com/index.php?page=account&s=options) 页面底部的 `API Access Credentials` 中获取<br>' +
        '填写 User ID 与 API Key'),
      postQuality: Schema.union([
          Schema.const('original').description('原图'),
          Schema.const('sample').description('样本图'),
          Schema.const('preview').description('缩略图'),
      ]).default('sample').description('取图质量'),
      maxRating: Schema.union([
          Schema.const('general').description('通用'),
          Schema.const('sensitive').description('敏感'),
          Schema.const('questionable').description('可疑'),
          Schema.const('explicit').description('露骨'),
      ]).default('general').description('允许展示的最高内容评级'),
      enableLinkParsing: Schema.boolean().default(false).description('自动解析本站帖子与图片链接'),
    }).description('Gelbooru 图源设置'),
    danbooru: Schema.object({
        keyPairs: Schema.array(Schema.object({
            username: Schema.string().description('用户名（Login Name）').required(),
            apiKey: Schema.string().role('secret').description('API Key').required(),
        })).description('**Danbooru 用户凭据**<br>' +
          '登录后，在 [个人资料](https://danbooru.donmai.us/profile) 页面底部的 `API Key` 处点击 `view` 查看<br>' +
          '填写用户名与 API Key'),
        userAgentId: Schema.string().default('').description(
          '**数字 User ID**<br>' +
          'Danbooru 要求 User-Agent 声明用户 ID，否则会被 Cloudflare 拦截<br>' +
          '只填数字；留空则使用凭据中的用户名'),
        postQuality: Schema.union([
            Schema.const('original').description('原图'),
            Schema.const('sample').description('样本图'),
            Schema.const('preview').description('缩略图'),
        ]).default('sample').description('取图质量'),
        maxRating: Schema.union([
            Schema.const('general').description('通用'),
            Schema.const('sensitive').description('敏感'),
            Schema.const('questionable').description('可疑'),
            Schema.const('explicit').description('露骨'),
        ]).default('general').description('允许展示的最高内容评级'),
        enableLinkParsing: Schema.boolean().default(false).description('自动解析本站帖子与图片链接'),
    }).description('Danbooru 图源设置'),
    pixiv: Schema.object({
        refreshToken: Schema.string().role('secret').description('**Refresh Token**<br>Pixiv API 必填凭据，获取方法见 [获取教程](https://www.nanoka.top/posts/e78ef86/)'),
        postQuality: Schema.union([
            Schema.const('original').description('原图'),
            Schema.const('large').description('样本图'),
            Schema.const('medium').description('缩略图'),
        ]).default('large').description('取图质量'),
        allowR18: Schema.boolean().default(false).description('允许发送 R-18 / R-18G 内容'),
        clientId: Schema.string().role('secret').description('Pixiv API 的 Client ID，一般无需修改').default('MOBrBDS8blbauoSck0ZfDbtuzpyT'),
        clientSecret: Schema.string().role('secret').description('Pixiv API 的 Client Secret，一般无需修改').default('lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj'),
        enableLinkParsing: Schema.boolean().default(false).description('自动解析本站帖子与图片链接'),
        maxImagesInPost: Schema.number().min(0).max(50).default(3).description('多图作品最多发送几张，`0` 不限制'),
    }).description('Pixiv 图源设置'),
  }).description('图源配置'),

  // ==================== 调试设置 ====================
  Schema.object({
    debug: Schema.object({
      enabled: Schema.boolean().default(false).description('在控制台输出各引擎与图源的详细日志'),
      logApiResponses: Schema.array(Schema.union(['saucenao', 'iqdb', 'tracemoe', 'yandex', 'ascii2d', 'googlelens', 'soutubot', 'gelbooru', 'yandere', 'danbooru', 'pixiv', 'konachan']))
        .role('checkbox')
        .default([])
        .description('输出所选引擎或图源返回的原始 JSON / HTML'),
    }),
  }).description('调试设置'),
])
