// --- START OF FILE src/config.ts ---
import { Schema, Context, h } from 'koishi'
import { Buffer } from 'buffer'

export type SearchEngineName = 'saucenao' | 'iqdb' | 'tracemoe' | 'yandex' | 'ascii2d' | 'soutubot'
export type EnhancerName = 'yandere' | 'gelbooru' | 'danbooru' | 'pixiv'

// 搜图函数的输入选项
export interface SearchOptions {
  imageUrl: string;
  imageBuffer: Buffer;
  fileName: string;
  maxResults: number;
}

// 搜图引擎返回结果的统一格式
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

// 图源增强器返回结果的统一格式
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

// Puppeteer (浏览器) 配置
export interface PuppeteerConfig {
  persistentBrowser: boolean
  browserCloseTimeout: number
  browserLaunchTimeout: number
  chromeExecutablePath: string
  concurrency: number;
}

// 搜索策略配置
export interface SearchConfig {
    mode: 'sequential' | 'parallel';
    parallelHighConfidenceStrategy: 'first' | 'all';
}

// 图源增强器的抽象基类
export abstract class Enhancer<T = any> {
  abstract name: EnhancerName
  public needsPuppeteer: boolean = false;
  constructor(public ctx: Context, public mainConfig: Config, public subConfig: T) {}
  abstract enhance(result: Searcher.Result): Promise<EnhancedResult | null>;
}

// 搜图引擎的抽象基类
export abstract class Searcher<T = any> {
  abstract name: SearchEngineName
  constructor(public ctx: Context, public mainConfig: Config, public subConfig: T) {}
  abstract search(options: SearchOptions): Promise<Searcher.Result[]>
}

// 插件的完整配置接口
export interface Config {
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
  gelbooru: Gelbooru.Config
  danbooru: Danbooru.Config
  ascii2d: Ascii2D.Config
  soutubot: SoutuBot.Config
  pixiv: Pixiv.Config
}

export namespace SauceNAO { export interface Config { apiKeys: string[]; confidenceThreshold?: number; } }
export namespace TraceMoe { export interface Config { sendVideoPreview: boolean; confidenceThreshold?: number; } }
export namespace IQDB { export interface Config { confidenceThreshold?: number; } }
export namespace Yandex { export interface Config { alwaysAttach: boolean; domain: 'ya.ru' | 'yandex.com'; } }
export namespace YandeRe { export interface Config { postQuality: 'jpeg' | 'sample' | 'original'; maxRating: 's' | 'q' | 'e'; enableLinkParsing: boolean; } }
export namespace Gelbooru { export interface Config { keyPairs: { userId: string; apiKey: string }[]; postQuality: 'original' | 'sample' | 'preview'; maxRating: 'general' | 'sensitive' | 'questionable' | 'explicit'; enableLinkParsing: boolean; } }
export namespace Danbooru { export interface Config { keyPairs: { username: string; apiKey: string }[]; postQuality: 'original' | 'sample' | 'preview'; maxRating: 'general' | 'sensitive' | 'questionable' | 'explicit'; enableLinkParsing: boolean; } }
export namespace Ascii2D { export interface Config { alwaysAttach: boolean; } }
export namespace SoutuBot { export interface Config { confidenceThreshold?: number; maxHighConfidenceResults?: number; } }
export namespace Pixiv { export interface Config { refreshToken: string; clientId: string; clientSecret: string; postQuality: 'original' | 'large' | 'medium'; allowR18: boolean; enableLinkParsing: boolean; maxImagesInPost: number; } }

const puppeteerConfig = Schema.object({
    persistentBrowser: Schema.boolean().default(false).description('**常驻浏览器**<br>' +
      '开启后，浏览器将在插件启动时预加载并常驻，加快后续搜索响应速度，但会占用后台资源。'),
    concurrency: Schema.number().min(1).max(3).default(1).description('**浏览器并发任务数**<br>' +
      '同时执行浏览器任务的最大数量。提高此值会增加浏览器资源占用，可能导致任务超时失败，建议设为 1。'),
    browserCloseTimeout: Schema.number().default(30).min(0).description('**自动关闭延迟 (秒)**<br>' +
      '仅在关闭 `常驻浏览器` 时生效。设置搜索任务结束后，等待多少秒关闭浏览器。'),
    browserLaunchTimeout: Schema.number().default(90).min(10).description('**浏览器启动超时 (秒)**<br>' +
      '等待浏览器进程启动并准备就绪的最长时间。'),
    chromeExecutablePath: Schema.string().description(
      '**本地浏览器可执行文件路径 (可选)**<br>' +
      '插件会优先使用此路径。如果留空，将尝试自动检测。'
    ),
})

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    order: Schema.array(Schema.object({
      engine: Schema.union(['saucenao', 'iqdb', 'tracemoe', 'soutubot', 'yandex', 'ascii2d']).description('搜图引擎'),
      enabled: Schema.boolean().default(true).description('是否启用'),
    }))
      .role('table')
      .default([
        { engine: 'saucenao', enabled: true }, { engine: 'iqdb', enabled: true }, { engine: 'tracemoe', enabled: true },
        { engine: 'soutubot', enabled: true }, { engine: 'ascii2d', enabled: true }, { engine: 'yandex', enabled: true },
      ])
      .description('搜图引擎。将按顺序调用，找到高匹配度结果后即停止（除非使用 --all或并行搜索）。<br>' +
        '\`Yandex\` 和 \`Ascii2D\` 仅作为附加结果使用。'),
    enhancerOrder: Schema.array(Schema.object({
      engine: Schema.union(['gelbooru', 'yandere', 'danbooru', 'pixiv']).description('图源'),
      enabled: Schema.boolean().default(true).description('是否启用'),
    }))
      .role('table')
      .default([
        { engine: 'yandere', enabled: true }, { engine: 'gelbooru', enabled: true },
        { engine: 'danbooru', enabled: true }, { engine: 'pixiv', enabled: true },
      ])
      .description('结果增强图源。在此处启用并排序，找到高匹配度结果后，将按顺序尝试获取更详细信息。'),
  }).description('基础设置'),

  Schema.object({
    search: Schema.object({
      mode: Schema.union([
          Schema.const('sequential').description('串行模式'),
          Schema.const('parallel').description('并行模式'),
      ]).default('sequential').description(
          '**默认搜索模式**<br>' +
          '**串行模式**: 逐个调用引擎，找到高匹配度结果后停止，适合性能有限的环境。<br>' +
          '**并行模式**: 同时调用所有启用引擎，找到高匹配度结果直接返回，响应快，但资源占用更多。'
      ),
      parallelHighConfidenceStrategy: Schema.union([
          Schema.const('first').description('返回最先找到的结果'),
          Schema.const('all').description('返回所有高匹配度结果'),
      ]).default('first').description(
          '并行模式下的高匹配度结果策略' 
      )
    }),
    confidenceThreshold: Schema.number().default(85).min(0).max(100).description('全局高匹配度阈值 (%)。当引擎未设置独立阈值时，将使用此值。'),
    maxResults: Schema.number().default(2).min(1).max(10).description('低匹配度结果的最大显示数量。当没有找到高匹配度结果时，每个引擎最多显示的结果数。'),
    promptTimeout: Schema.number().default(60).min(10).description('发送图片超时 (秒)。使用 `sauce` 指令后等待用户发送图片的超时时间。'),
    requestTimeout: Schema.number().default(30).min(5).description('全局网络请求超时 (秒)。适用于所有搜图引擎和图源。'),
    enhancerRetryCount: Schema.number().min(0).max(5).default(1).description('图源下载重试次数。当从图源网站下载图片失败时，额外尝试的次数。'),
    prependLinkParsingMiddleware: Schema.boolean().default(false).description('**启用前置中间件模式**<br>' +
    '开启后，本插件将优先处理消息中的图源链接。<br>' +
    '**注意**：这可能会阻止其他相同链接解析插件生效，请按需开启。'),
  }).description('搜索设置'),

  Schema.object({
    puppeteer: puppeteerConfig,
  }).description('浏览器设置'),

  Schema.object({
    saucenao: Schema.object({
      apiKeys: Schema.array(Schema.string().role('secret')).description('SauceNAO 的 API Key 列表。<br>' +
        '注册登录 **[SauceNAO](https://saucenao.com/user.php)**，'+
        '在底部选项 [Account](https://saucenao.com/user.php?page=account-overview) -> '+
        '[api](https://saucenao.com/user.php?page=search-api) -> \`api key\`处生成。'),
      confidenceThreshold: Schema.number().min(0).max(100).default(85).description('独立高匹配度阈值 (%)。如果设置为 0，将使用全局阈值。'),
    }).description('SauceNAO 设置'),
    tracemoe: Schema.object({
      sendVideoPreview: Schema.boolean().default(true).description('发送视频预览。当\`Trace.moe\` 找到高匹配度结果时，是否发送预览视频。'),
      confidenceThreshold: Schema.number().min(0).max(100).default(90).description('独立高匹配度阈值 (%)。如果设置为 0，将使用全局阈值。'),
    }).description('Trace.moe 设置'),
    iqdb: Schema.object({
      confidenceThreshold: Schema.number().min(0).max(100).default(85).description('独立高匹配度阈值 (%)。如果设置为 0，将使用全局阈值。'),
    }).description('IQDB 设置'),
    soutubot: Schema.object({
      confidenceThreshold: Schema.number().min(0).max(100).default(65).description('独立高匹配度阈值 (%)。如果设置为 0，将使用全局阈值。'),
      maxHighConfidenceResults: Schema.number().min(1).max(10).default(3).description('高匹配度结果的最大显示数量。用于展示多个不同版本（如语言）的匹配结果。'),
    }).description('搜图bot酱 设置'),
    yandex: Schema.object({
      alwaysAttach: Schema.boolean().default(false).description('总是附加\`Yandex\`结果。开启后，即使其他引擎找到高匹配度结果，也会附带\`Yandex\`结果。<br>' +
        '在并行模式下，此结果将作为独立消息稍后发送。'),
      domain: Schema.union([
        Schema.const('ya.ru').description('ya.ru (推荐)'),
        Schema.const('yandex.com').description('yandex.com (锁区)'),
      ]).default('ya.ru').description('选择用于搜索的\`Yandex\`域名。如果遇到访问问题或搜索无结果，可以尝试切换。'),
    }).description('Yandex 设置'),
    ascii2d: Schema.object({
        alwaysAttach: Schema.boolean().default(false).description('总是附加 Ascii2D 结果。开启后，即使其他引擎找到高匹配度结果，也会附带\`Ascii2D\`结果。<br>' +
          '在并行模式下，此结果将作为独立消息稍后发送。'),
    }).description('Ascii2D 设置'),
  }).description('引擎配置'),

  Schema.object({
    yandere: Schema.object({
      postQuality: Schema.union([
        Schema.const('original').description('原图'),
        Schema.const('jpeg').description('中等图'),
        Schema.const('sample').description('预览图'),
      ]).default('jpeg').description('图片质量。从\`Yande.re\`获取的图片尺寸。'),
      maxRating: Schema.union([
          Schema.const('s').description('安全'),
          Schema.const('q').description('可疑'),
          Schema.const('e').description('露骨'),
      ]).default('s').description('允许的最高内容评级。'),
      enableLinkParsing: Schema.boolean().default(false).description('启用链接解析。当用户发送 \`Yande.re\` 帖子链接时，自动获取并发送图源详情。'),
    }).description('Yande.re 图源设置'),
    gelbooru: Schema.object({
      keyPairs: Schema.array(Schema.object({
          userId: Schema.string().description('User ID').required(),
          apiKey: Schema.string().role('secret').description('API Key').required(),
      })).description('Gelbooru API Key 对 (User ID 与 Key)。<br>' +
        '注册登录 **[Gelbooru](https://gelbooru.com/index.php?page=account&s=login&code=00)** ，' +
        '在 [My Account](https://gelbooru.com/index.php?page=account&s=home) -> ' +
        '[Options](https://gelbooru.com/index.php?page=account&s=options) 底部选项卡 \`API Access Credentials\` 中生成。<br>' +
        '形如\`&api_key={ API Key }&user_id={ User ID }\` **{ }中的才是需要填入的。**'),
      postQuality: Schema.union([
          Schema.const('original').description('原图'),
          Schema.const('sample').description('样本图'),
          Schema.const('preview').description('缩略图'),
      ]).default('sample').description('图片质量。从\`Gelbooru\`获取的图片尺寸。'),
      maxRating: Schema.union([
          Schema.const('general').description('通用'),
          Schema.const('sensitive').description('敏感'),
          Schema.const('questionable').description('可疑'),
          Schema.const('explicit').description('露骨'),
      ]).default('general').description('允许的最高内容评级。'),
      enableLinkParsing: Schema.boolean().default(false).description('启用链接解析。当用户发送 \`Gelbooru\` 帖子链接时，自动获取并发送图源详情。'),
    }).description('Gelbooru 图源设置'),
    danbooru: Schema.object({
        keyPairs: Schema.array(Schema.object({
            username: Schema.string().description('用户名 (Login Name)').required(),
            apiKey: Schema.string().role('secret').description('API Key').required(),
        })).description('Danbooru API 用户凭据 (用户名与 API Key)。<br>' +
          '注册登录 **[Danbooru](https://danbooru.donmai.us/login?url=%2F)**，' +
          '在 [My Account](https://danbooru.donmai.us/profile) -> 档案底部 \`API Key\` 栏点击 \`view\` 查看。'),
        postQuality: Schema.union([
            Schema.const('original').description('原图'),
            Schema.const('sample').description('样本图'),
            Schema.const('preview').description('缩略图'),
        ]).default('sample').description('图片质量。从\`Danbooru\`获取的图片尺寸。'),
        maxRating: Schema.union([
            Schema.const('general').description('通用'),
            Schema.const('sensitive').description('敏感'),
            Schema.const('questionable').description('可疑'),
            Schema.const('explicit').description('露骨'),
        ]).default('general').description('允许的最高内容评级。'),
        enableLinkParsing: Schema.boolean().default(false).description('启用链接解析。当用户发送 \`Danbooru\` 帖子链接时，自动获取并发送图源详情。'),
    }).description('Danbooru 图源设置'),
    pixiv: Schema.object({
        refreshToken: Schema.string().role('secret').description('Pixiv API Refresh Token. <br>' +
          '用于 API 请求认证，是正常使用此图源的必需项。**[获取教程](https://www.nanoka.top/posts/e78ef86/)**'),
        postQuality: Schema.union([
            Schema.const('original').description('原图'),
            Schema.const('large').description('大图'),
            Schema.const('medium').description('中等图'),
        ]).default('large').description('图片质量。从\`Pixiv\`获取的图片尺寸。'),
        allowR18: Schema.boolean().default(false).description('是否允许发送 R-18/R-18G 内容。'),
        clientId: Schema.string().role('secret').description('Pixiv API Client ID.').default('MOBrBDS8blbauoSck0ZfDbtuzpyT'),
        clientSecret: Schema.string().role('secret').description('Pixiv API Client Secret.').default('lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj'),
        enableLinkParsing: Schema.boolean().default(false).description('启用链接解析。当用户发送 \`Pixiv\` 作品链接时，自动获取并发送图源详情。'),
        maxImagesInPost: Schema.number().min(0).max(50).default(3).description('多图作品最大发送数量。解析包含多张图片的作品时，最多发送的图片数量。设置为 0 则无限制。'),
    }).description('Pixiv 图源设置'),
  }).description('图源配置'),

  Schema.object({
    debug: Schema.object({
      enabled: Schema.boolean().default(false).description('启用调试模式。将在控制台输出详细的执行日志。'),
      logApiResponses: Schema.array(Schema.union(['saucenao', 'iqdb', 'tracemoe', 'yandex', 'ascii2d', 'soutubot', 'gelbooru', 'yandere', 'danbooru', 'pixiv']))
        .role('checkbox')
        .default([])
        .description('记录原始响应: 选择要将 API 或页面 HTML 的原始返回信息输出到日志的引擎/图源 (可能产生大量日志，仅用于问题诊断)。'),
    }),
  }).description('调试设置'),
])