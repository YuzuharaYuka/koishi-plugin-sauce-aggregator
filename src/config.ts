
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
  maxResults: number
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


// 搜索策略配置
export interface SearchConfig {
  mode: 'sequential' | 'parallel';
  parallelHighConfidenceStrategy: 'first' | 'all';
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
  confidenceThreshold: number
  maxResults: number
  promptTimeout: number
  requestTimeout: number
  prependLinkParsingMiddleware: boolean;
  enhancerRetryCount: number;
  search: SearchConfig
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

export namespace SauceNAO { export interface Config { apiKeys: string[]; confidenceThreshold?: number; } }
export namespace TraceMoe { export interface Config { sendVideoPreview: boolean; confidenceThreshold?: number; } }
export namespace IQDB { export interface Config { confidenceThreshold?: number; } }
export namespace Yandex { export interface Config { alwaysAttach: boolean; domain: 'ya.ru' | 'yandex.com'; } }
export namespace YandeRe { export interface Config { postQuality: 'jpeg' | 'sample' | 'original'; maxRating: 's' | 'q' | 'e'; enableLinkParsing: boolean; } }
export namespace Konachan { export interface Config { postQuality: 'jpeg' | 'sample' | 'original'; maxRating: 's' | 'q' | 'e'; enableLinkParsing: boolean; } }
export namespace Gelbooru { export interface Config { keyPairs: { userId: string; apiKey: string }[]; postQuality: 'original' | 'sample' | 'preview'; maxRating: 'general' | 'sensitive' | 'questionable' | 'explicit'; enableLinkParsing: boolean; } }
export namespace Danbooru { export interface Config { keyPairs: { username: string; apiKey: string }[]; postQuality: 'original' | 'sample' | 'preview'; maxRating: 'general' | 'sensitive' | 'questionable' | 'explicit'; enableLinkParsing: boolean; userAgentId?: string; } }
export namespace Ascii2D {
  export interface Config {
    alwaysAttach: boolean
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
    /** 返回的最大结果数 */
    maxResults: number
  }
}
export namespace SoutuBot {
  export interface Config {
    confidenceThreshold?: number
    maxHighConfidenceResults?: number
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
      '**浏览器服务提供**<br>' +
      '插件内置: 使用插件自带的 puppeteer 服务，可通过简单人机验证。<br>' +
      '全局服务: 使用由 `koishi-plugin-puppeteer` 或其他插件提供的 puppeteer 服务。'
    ),
    persistentBrowser: Schema.boolean().default(false).description('**常驻浏览器**<br>' +
      '开启后，浏览器将在插件启动时预加载并常驻，加快后续搜索响应速度，但会占用后台资源'),
    concurrency: Schema.number().min(1).max(3).default(1).description('**浏览器并发任务数**<br>' +
      '同时执行浏览器任务的最大数量。提高此值会增加浏览器资源占用，可能导致任务超时失败，建议设为 1'),
    browserCloseTimeout: Schema.number().default(30).min(0).description('**自动关闭延迟 (秒)**<br>' +
      '仅在关闭 `常驻浏览器` 时生效。设置搜索任务结束后，等待多少秒关闭浏览器'),
    browserLaunchTimeout: Schema.number().default(90).min(10).description('**浏览器启动超时 (秒)**<br>' +
      '等待浏览器进程启动并准备就绪的最长时间'),
    restartInterval: Schema.number().min(0).default(6).description('**定时重启浏览器 (小时)**<br>' +
      '仅在开启 `常驻浏览器` 时生效。设置指定时间后，于空闲时自动重启浏览器，以防止因长时间运行出现问题。设置为 0 则禁用。'),
    chromeExecutablePath: Schema.string().description(
      '本地浏览器可执行文件路径 (可选)<br>' +
      '插件会优先使用此路径。如果留空，将尝试自动检测。'
    ),
    tempPath: Schema.string().description(
      '临时文件存储路径 (可选)<br>' +
      '留空则使用默认路径 `./data/temp/sauce-aggregator`<br>' +
      '对于 Docker: 此路径应指向 Koishi 和 Puppeteer 容器共享的卷。'
    ),
})

export const Config: Schema<Config> = Schema.intersect([
  // ==================== 基础设置 ====================
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
      .description('搜图引擎。将按顺序调用，找到高匹配度结果后即停止（除非使用 --all或并行搜索）。<br>' +
        '\`Yandex\`、\`Ascii2D\` 和 \`Google Lens\` 仅作为附加结果使用'),
    enhancerOrder: Schema.array(Schema.object({
      engine: Schema.union(['gelbooru', 'yandere', 'danbooru', 'pixiv', 'konachan']).description('图源'),
      enabled: Schema.boolean().default(true).description('是否启用'),
    }))
      .role('table')
      .default([
        { engine: 'yandere', enabled: true }, { engine: 'konachan', enabled: true }, { engine: 'gelbooru', enabled: true },
        { engine: 'danbooru', enabled: true }, { engine: 'pixiv', enabled: true },
      ])
      .description('结果增强图源。在此处启用并排序，找到高匹配度结果后，将按顺序尝试获取更详细信息'),
  }).description('基础设置'),

  // ==================== 搜索设置 ====================
  Schema.object({
    search: Schema.object({
      mode: Schema.union([
          Schema.const('sequential').description('串行模式'),
          Schema.const('parallel').description('并行模式'),
      ]).default('sequential').description(
          '**默认搜索模式**<br>' +
          '**串行模式**: 逐个调用引擎，找到高匹配度结果后停止<br>' +
          '**并行模式**: 同时调用所有启用引擎，找到高匹配度结果直接返回'
      ),
      parallelHighConfidenceStrategy: Schema.union([
          Schema.const('first').description('返回最先找到的结果'),
          Schema.const('all').description('返回所有高匹配度结果'),
      ]).default('first').description(
          '并行模式下的高匹配度结果策略'
      )
    }),
    confidenceThreshold: Schema.number().default(85).min(0).max(100).description('全局高匹配度阈值 (%)'),
    maxResults: Schema.number().default(2).min(0).max(10).description('低匹配度结果的最大显示数量 (0 表示不显示)'),
    promptTimeout: Schema.number().default(60).min(10).description('发送图片超时 (秒)'),
    requestTimeout: Schema.number().default(30).min(5).description('全局网络请求超时 (秒)'),
    enhancerRetryCount: Schema.number().min(0).max(5).default(1).description('图源下载重试次数'),
    prependLinkParsingMiddleware: Schema.boolean().default(false).description('**启用前置中间件模式**<br>' +
    '开启后，本插件将优先处理消息中的图源链接<br>' +
    '**注意**：这可能会阻止其他相同链接解析插件生效，请按需开启'),
  }).description('搜索设置'),

  // ==================== 网络与浏览器 ====================
  Schema.object({
    proxy: Schema.string().default('http://127.0.0.1:7890').description(
      '**独立代理配置**：如`http://127.0.0.1:7890`，**留空则直连**。<br>' +
      '仅影响 `danbooru` 图源与 `soutubot`、`yandex`、`ascii2d` 引擎<br>' +
      '其余 `ctx.http` 请求仍使用 `proxy-agent` 的全局代理配置<br>'
    ),
    puppeteer: puppeteerConfig,
  }).description('网络与浏览器'),

  // ==================== 引擎配置 ====================
  Schema.object({
    saucenao: Schema.object({
      apiKeys: Schema.array(Schema.string().role('secret')).description('SauceNAO 的 API Key 列表。<br>' +
        '注册登录 **[SauceNAO](https://saucenao.com/user.php)**，'+
        '在底部选项 [Account](https://saucenao.com/user.php?page=account-overview) -> '+
        '[api](https://saucenao.com/user.php?page=search-api) -> \`api key\`处生成'),
      confidenceThreshold: Schema.number().min(0).max(100).default(85).description('独立高匹配度阈值 (%)'),
    }).description('SauceNAO 设置'),
    tracemoe: Schema.object({
      sendVideoPreview: Schema.boolean().default(true).description('发送视频预览'),
      confidenceThreshold: Schema.number().min(0).max(100).default(90).description('独立高匹配度阈值 (%)'),
    }).description('Trace.moe 设置'),
    iqdb: Schema.object({
      confidenceThreshold: Schema.number().min(0).max(100).default(85).description('独立高匹配度阈值 (%)'),
    }).description('IQDB 设置'),
    soutubot: Schema.object({
      confidenceThreshold: Schema.number().min(0).max(100).default(60).description('独立高匹配度阈值 (%)'),
      maxHighConfidenceResults: Schema.number().min(1).max(10).default(3).description('高匹配度结果的最大显示数量'),
      searchMode: Schema.union([
        Schema.const('normal').description('常规'),
        Schema.const('strict').description('严格'),
      ]).default('normal').description('**搜索模式**<br>' +
        '对应站点上的「常规 / 严格」开关<br>' +
        '常规: 匹配更宽松，结果更多<br>' +
        '严格: 匹配更精确，但更容易没有结果'),
      topK: Schema.number().min(1).max(50).default(25).description('**候选结果数量**<br>' +
        '向站点的每个索引请求的候选数量'),
      useProxy: Schema.boolean().default(true).description('**使用独立代理**<br>' +
        '开启后使用上方「网络与浏览器」中的独立代理访问搜图bot酱'),
      apiEndpoint: Schema.string().default('https://soutubot.moe/api/search').description('**接口地址**<br>' +
        '留空使用默认值'),
    }).description('搜图bot酱 设置'),
    yandex: Schema.object({
      alwaysAttach: Schema.boolean().default(false).description('总是附加\`Yandex\`结果'),
      domain: Schema.union([
        Schema.const('ya.ru').description('ya.ru (推荐)'),
        Schema.const('yandex.com').description('yandex.com (锁区)'),
      ]).default('ya.ru').description('选择用于搜索的\`Yandex\`域名'),
    }).description('Yandex 设置'),
    ascii2d: Schema.object({
        alwaysAttach: Schema.boolean().default(false).description('总是附加\`Ascii2D\` 结果'),
        retries: Schema.number().min(0).max(3).default(2).description('**失败重试次数**<br>' +
          'Ascii2D 偶发 Cloudflare 挑战或响应缓慢，失败时自动重新导航并重试'),
        resolveTimeout: Schema.number().min(10).max(180).default(60).description('**结果等待时间 (秒)**<br>' +
          '提交图片后等待结果出现的额外时间，用于容忍 Cloudflare 挑战；' +
          '与「全局网络请求超时」取较大值生效'),
    }).description('Ascii2D 设置'),
    googlelens: Schema.object({
      apiKeys: Schema.array(Schema.string().role('secret')).default([]).description(
        '**SerpApi API Key 列表**<br>' +
        'Google Lens 需通过 **[SerpApi](https://serpapi.com/)** 调用，' +
        '注册后在 [Dashboard](https://serpapi.com/manage-api-key) 获取 Key<br>' +
        '免费额度250 次/月，可填入多个 Key 轮询使用，额度耗尽的 Key 会自动跳过'),
      alwaysAttach: Schema.boolean().default(false).description(
        '总是附加\`Google Lens\` 结果'),
      hl: Schema.union([
        Schema.const('zh-cn').description('简体中文'),
        Schema.const('zh-tw').description('繁体中文'),
        Schema.const('ja').description('日文'),
        Schema.const('en').description('英文'),
      ]).default('zh-cn').description('**结果语言**<br>' +
        '影响结果标题的语言与来源站点的覆盖范围'),
      maxResults: Schema.number().min(1).max(20).default(5).description(
        '**最大结果数**<br>' +
        '同一站点的结果会自动去重，每个站点只保留最靠前的一条'),
    }).description('Google Lens 设置'),
  }).description('引擎配置'),

  // ==================== 图源配置 ====================
  Schema.object({
    yandere: Schema.object({
      postQuality: Schema.union([
        Schema.const('original').description('原图'),
        Schema.const('jpeg').description('中等图'),
        Schema.const('sample').description('预览图'),
      ]).default('jpeg').description('图片质量'),
      maxRating: Schema.union([
          Schema.const('s').description('安全'),
          Schema.const('q').description('可疑'),
          Schema.const('e').description('露骨'),
      ]).default('s').description('允许的最高内容评级'),
      enableLinkParsing: Schema.boolean().default(false).description('启用链接解析'),
    }).description('Yande.re 图源设置'),
    konachan: Schema.object({
      postQuality: Schema.union([
        Schema.const('original').description('原图'),
        Schema.const('jpeg').description('JPEG'),
        Schema.const('sample').description('预览图'),
      ]).default('jpeg').description('图片质量'),
      maxRating: Schema.union([
          Schema.const('s').description('安全'),
          Schema.const('q').description('可疑'),
          Schema.const('e').description('露骨'),
      ]).default('s').description('允许的最高内容评级'),
      enableLinkParsing: Schema.boolean().default(false).description('启用链接解析'),
    }).description('Konachan 图源设置'),
    gelbooru: Schema.object({
      keyPairs: Schema.array(Schema.object({
          userId: Schema.string().description('User ID').required(),
          apiKey: Schema.string().role('secret').description('API Key').required(),
      })).description('Gelbooru API Key 对 (User ID 与 Key)<br>' +
        '注册登录 **[Gelbooru](https://gelbooru.com/index.php?page=account&s=login&code=00)** ，' +
        '在 [My Account](https://gelbooru.com/index.php?page=account&s=home) -> ' +
        '[Options](https://gelbooru.com/index.php?page=account&s=options) 底部选项卡 \`API Access Credentials\` 中生成<br>' +
        '形如\`&api_key={ API Key }&user_id={ User ID }\` **{ }中的才是需要填入的**'),
      postQuality: Schema.union([
          Schema.const('original').description('原图'),
          Schema.const('sample').description('样本图'),
          Schema.const('preview').description('缩略图'),
      ]).default('sample').description('图片质量'),
      maxRating: Schema.union([
          Schema.const('general').description('通用'),
          Schema.const('sensitive').description('敏感'),
          Schema.const('questionable').description('可疑'),
          Schema.const('explicit').description('露骨'),
      ]).default('general').description('允许的最高内容评级'),
      enableLinkParsing: Schema.boolean().default(false).description('启用链接解析'),
    }).description('Gelbooru 图源设置'),
    danbooru: Schema.object({
        keyPairs: Schema.array(Schema.object({
            username: Schema.string().description('用户名 (Login Name)').required(),
            apiKey: Schema.string().role('secret').description('API Key').required(),
        })).description('Danbooru API 用户凭据 (用户名与 API Key)<br>' +
          '注册登录 **[Danbooru](https://danbooru.donmai.us/login?url=%2F)**，' +
          '在 [My Account](https://danbooru.donmai.us/profile) -> 档案底部 \`API Key\` 栏点击 \`view\` 查看'),
        userAgentId: Schema.string().default('').description(
          '**User ID**<br>' +
          'Danbooru 要求 API 客户端的 User-Agent 中声明用户 ID<br>' +
          '可在 **[My Account](https://danbooru.donmai.us/profile)** 查看'),
        postQuality: Schema.union([
            Schema.const('original').description('原图'),
            Schema.const('sample').description('样本图'),
            Schema.const('preview').description('缩略图'),
        ]).default('sample').description('图片质量'),
        maxRating: Schema.union([
            Schema.const('general').description('通用'),
            Schema.const('sensitive').description('敏感'),
            Schema.const('questionable').description('可疑'),
            Schema.const('explicit').description('露骨'),
        ]).default('general').description('允许的最高内容评级'),
        enableLinkParsing: Schema.boolean().default(false).description('启用链接解析'),
    }).description('Danbooru 图源设置'),
    pixiv: Schema.object({
        refreshToken: Schema.string().role('secret').description('Pixiv API Refresh Token. <br>' +
          '用于 API 请求认证，是正常使用此图源的必需项 **[获取教程](https://www.nanoka.top/posts/e78ef86/)**'),
        postQuality: Schema.union([
            Schema.const('original').description('原图'),
            Schema.const('large').description('大图'),
            Schema.const('medium').description('中等图'),
        ]).default('large').description('图片质量'),
        allowR18: Schema.boolean().default(false).description('是否允许发送 R-18/R-18G 内容'),
        clientId: Schema.string().role('secret').description('Pixiv API Client ID').default('MOBrBDS8blbauoSck0ZfDbtuzpyT'),
        clientSecret: Schema.string().role('secret').description('Pixiv API Client Secret').default('lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj'),
        enableLinkParsing: Schema.boolean().default(false).description('启用链接解析'),
        maxImagesInPost: Schema.number().min(0).max(50).default(3).description('多图作品最大发送数量'),
    }).description('Pixiv 图源设置'),
  }).description('图源配置'),

  // ==================== 调试设置 ====================
  Schema.object({
    debug: Schema.object({
      enabled: Schema.boolean().default(false).description('启用调试模式<br>' +
        '在控制台输出各引擎与图源的详细过程日志'),
      logApiResponses: Schema.array(Schema.union(['saucenao', 'iqdb', 'tracemoe', 'yandex', 'ascii2d', 'googlelens', 'soutubot', 'gelbooru', 'yandere', 'danbooru', 'pixiv', 'konachan']))
        .role('checkbox')
        .default([])
        .description('记录原始响应<br>' +
          '输出所选引擎或图源收到的原始 JSON / HTML'),
    }),
  }).description('调试设置'),
])
