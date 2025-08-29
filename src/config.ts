// --- START OF FILE config.ts ---

import { Schema, Context, h } from 'koishi'
import { Buffer } from 'buffer'

export interface SearchOptions {
  imageUrl: string;
  imageBuffer: Buffer;
  fileName: string;
  maxResults: number;
}

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

export interface EnhancedResult {
  details: h[]
  imageBuffer?: Buffer
  imageType?: string
}

// 内部类名保持不变，因为它描述的是代码行为（增强结果）
export abstract class Enhancer<T = any> {
  abstract name: 'yandere' | 'gelbooru'
  constructor(public ctx: Context, public config: T, public debug: boolean) {}
  abstract enhance(result: Searcher.Result): Promise<EnhancedResult | null>;
}


export abstract class Searcher<T = any> {
  abstract name: string
  constructor(public ctx: Context, public config: T, public debug: boolean) {}
  abstract search(options: SearchOptions): Promise<Searcher.Result[]>
}

export interface Config {
  debug: boolean
  order: { engine: 'saucenao' | 'iqdb' | 'tracemoe'; enabled: boolean }[]
  enhancerOrder: { engine: 'yandere' | 'gelbooru'; enabled: boolean }[]
  confidenceThreshold: number
  maxResults: number
  promptTimeout: number
  saucenao: SauceNAO.Config
  tracemoe: TraceMoe.Config
  iqdb: IQDB.Config
  yandere: YandeRe.Config
  gelbooru: Gelbooru.Config
}

export namespace SauceNAO { export interface Config { apiKeys: string[]; } }
export namespace TraceMoe { export interface Config { sendVideoPreview: boolean; } }
export namespace IQDB { export interface Config { } }

export namespace YandeRe {
  export interface Config {
    enabled: boolean
    postQuality: 'jpeg' | 'sample' | 'original'
    maxRating: 's' | 'q' | 'e'
  }
}

export namespace Gelbooru {
    export interface Config {
        enabled: boolean
        keyPairs: { userId: string; apiKey: string }[]
        postQuality: 'original' | 'sample' | 'preview'
        maxRating: 'general' | 'sensitive' | 'questionable' | 'explicit'
    }
}


export const Config: Schema<Config> = Schema.object({

  order: Schema.array(Schema.object({
    engine: Schema.union(['saucenao', 'iqdb', 'tracemoe']).description('搜图引擎'),
    enabled: Schema.boolean().default(true).description('是否启用'),
  }))
    .role('table')
    .default([
      { engine: 'saucenao', enabled: true },
      { engine: 'iqdb', enabled: true },
      { engine: 'tracemoe', enabled: true },
    ])
    .description('搜图引擎调用顺序与开关 (可拖拽排序)。'),

  // **MODIFICATION START**: 统一术语为 "图源"
  enhancerOrder: Schema.array(Schema.object({
    engine: Schema.union(['gelbooru', 'yandere']).description('图源'),
    enabled: Schema.boolean().default(true).description('是否启用'),
  }))
    .role('table')
    .default([
      { engine: 'yandere', enabled: true },
      { engine: 'gelbooru', enabled: true },
    ])
    .description('图源调用顺序 (找到高置信度结果后按序调用)。'),

  confidenceThreshold: Schema.number().default(85).min(0).max(100).description('高置信度结果的相似度阈值 (%)。'),
  maxResults: Schema.number().default(3).description('无高置信度结果时，各引擎最大显示数量。'),
  promptTimeout: Schema.number().default(60).description('等待用户发送图片的超时时间 (秒)。'),
  debug: Schema.boolean().default(false).description('启用Debug模式，输出详细日志。'),

  saucenao: Schema.object({
    apiKeys: Schema.array(Schema.string().role('secret')).description('SauceNAO 的 API Key 列表。\n\n注册登录 saucenao.com，在底部选项 \`Account\` -> \`api\` -> \`api key\`中生成。\n\n将api key: 后字符串完整复制并填入。'),
  }).description('SauceNAO 设置'),
  
  tracemoe: Schema.object({
    sendVideoPreview: Schema.boolean().default(true).description('高置信度结果发送预览视频。'),
  }).description('Trace.moe 设置'),

  iqdb: Schema.object({
  }).description('IQDB 设置'),

  yandere: Schema.object({
    enabled: Schema.boolean().default(true).description('启用 Yande.re 图源。'),
    postQuality: Schema.union([
      Schema.const('original').description('原图 (最大)'),
      Schema.const('jpeg').description('中等图 (中等)'),
      Schema.const('sample').description('预览图 (最小)'),
    ]).default('jpeg').description('发送的图片尺寸。'),
    maxRating: Schema.union([
        Schema.const('s').description('Safe (安全)'),
        Schema.const('q').description('Questionable (可疑)'),
        Schema.const('e').description('Explicit (露骨)'),
    ]).default('s').description('允许的最高内容评级。'),
  }).description('Yande.re 图源设置'),
  
  gelbooru: Schema.object({
    enabled: Schema.boolean().default(true).description('启用 Gelbooru 图源。'),
    keyPairs: Schema.array(Schema.object({
        userId: Schema.string().description('Gelbooru User ID').required(),
        apiKey: Schema.string().role('secret').description('Gelbooru API Key').required(),
    })).description('Gelbooru API Key 。\n\n注册登录 gelbooru.com，在 \`My Account\` -> \`Options\` 底部选项卡\``API Access Credentials\``中生成。\n\n形如\`&api_key={ API Key }&user_id={ User ID }\` { }中的才是需要填入的。'),
    postQuality: Schema.union([
        Schema.const('original').description('原图 (最大)'),
        Schema.const('sample').description('预览图 (较大)'),
        Schema.const('preview').description('缩略图 (最小)'),
    ]).default('sample').description('发送的图片尺寸。'),
    maxRating: Schema.union([
        Schema.const('general').description('General'),
        Schema.const('sensitive').description('Sensitive'),
        Schema.const('questionable').description('Questionable'),
        Schema.const('explicit').description('Explicit'),
    ]).default('general').description('允许的最高内容评级。'),
    }).description('Gelbooru 图源设置'),
  // **MODIFICATION END**
})