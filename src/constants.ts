
// 常量定义：搜图引擎、增强器、消息、错误等

import type { Config } from './config'

// 需要浏览器的引擎、主流引擎与附加（补充）引擎
// 注意: soutubot 已改为直接调用站点搜索接口(/api/search)，不再需要浏览器实例
export const SEARCH_ENGINES = {
  PUPPETEER: ['yandex', 'ascii2d'] as const,
  MAIN: ['saucenao', 'iqdb', 'tracemoe', 'soutubot'] as const,
  // 附加引擎：不参与「找到高匹配度即停止」的判定，是否展示由各自的 alwaysAttach 决定
  ATTACH: ['yandex', 'ascii2d', 'googlelens'] as const,
} as const

// 判断某个引擎是否为附加（补充）引擎
export function isAttachEngine(name: string): boolean {
  return (SEARCH_ENGINES.ATTACH as readonly string[]).includes(name)
}

// 判断某个引擎是否已开启「总是附加结果」
export function isAlwaysAttach(config: Config, name: string): boolean {
  switch (name) {
    case 'yandex': return !!config.yandex?.alwaysAttach
    case 'ascii2d': return !!config.ascii2d?.alwaysAttach
    case 'googlelens': return !!config.googlelens?.alwaysAttach
    default: return false
  }
}

// 增强器标签
export const ENHANCER_LABELS = {
  tracemoe: '工作室',
  default: '作者',
} as const

// 交互提示消息
export const PROMPT_MESSAGES = {
  WAITING_IMAGE: (timeout: number) => `请发送图片……（${timeout} 秒内有效）`,
  CANCELLED: '已取消。',
  NO_IMAGE_FOUND: '未收到图片，已取消。',
  TIMEOUT: '等待超时，已取消。',
} as const

// 引擎别名映射
export const ENGINE_ALIASES = {
  s: 'saucenao',
  i: 'iqdb',
  t: 'tracemoe',
  y: 'yandex',
  a: 'ascii2d',
  g: 'googlelens',
  b: 'soutubot',
} as const

// 图源正则匹配
export const ENHANCER_PATTERNS = {
  pixiv: /pixiv\.net\/(?:artworks\/|member_illust\.php\?.*illust_id=)|i\.pximg\.net/,
  danbooru: /danbooru\.donmai\.us\/(?:posts|post\/show)\//,
  gelbooru: /gelbooru\.com\/index\.php\?.*(id=|md5=)/,
  yandere: /yande\.re\/post\/show\//,
  konachan: /konachan\.com\/post\/show\//,
} as const

// 图源ID提取正则
export const ENHANCEMENT_ID_EXTRACTORS = {
  pixiv: /pixiv\.net\/(?:artworks\/|member_illust\.php\?.*illust_id=)(\d+)|i\.pximg\.net\/img-original\/img\/[^/]+\/[^/]+\/[^/]+\/(?<id>\d+)_p/,
  danbooru: /danbooru\.donmai\.us\/(?:posts|post\/show)\/(\d+)/,
  gelbooru: /gelbooru\.com\/index\.php\?.*(?:id=(\d+)|md5=([a-f0-9]{32}))/,
  yandere: /yande\.re\/post\/show\/(\d+)/,
  konachan: /konachan\.com\/post\/show\/(\d+)/,
} as const

// 搜索结果提示信息
export const SEARCH_MESSAGES = {
  SEARCHING: '正在搜索……',
  SEARCH_COMPLETE: '找到高匹配度结果:',
  NO_HIGH_CONFIDENCE: '未找到高匹配度结果，以下是相似度较低的结果:',
  LOW_CONFIDENCE_RESULTS: '其余低匹配度结果:',
  ATTACH_RESULTS: '来自补充引擎的结果:',
  NO_RESULTS: '未找到相关结果。',
  NO_RESULTS_INCOMPLETE: '未获取到可用结果，部分引擎未完成。',
  IMAGE_PROCESS_FAILED: '图片处理失败，请检查图片链接或网络连接。',
  FORWARD_FAILED: '合并转发结果失败',
  FORWARD_ATTACH_FAILED: '发送补充结果失败',
  FORWARD_LOW_CONFIDENCE_FAILED: '合并转发低匹配度结果失败',
  PARTIAL_FAILURE: '部分引擎未完成:',
  PROBLEMS_ENCOUNTERED: '遇到的问题:',
} as const

// 消息框标题
export const MESSAGE_TITLES = {
  ANIME_COVER: '番剧封面',
  DETAILS: '详细信息',
  VIDEO_PREVIEW: '视频预览',
  IMAGE: '图源图片',
  INFO: '图源信息',
} as const

// 指令错误提示
export const COMMAND_ERRORS = {
  INVALID_ENGINE: '指定的搜图引擎不存在或未启用。',
  NO_ENABLED_ENGINES: '没有启用任何有效的搜图引擎。',
  INVALID_ENGINE_INPUT: '指定的搜图引擎无效或未正确配置。',
  UNKNOWN_ENGINE: '无效的引擎名或别名，请检查拼写。',
} as const

// 特殊引擎名称
export const SPECIAL_ENGINES = {
  SOUTUBOT: 'soutubot',
  TRACEMOE: 'tracemoe',
  YANDEX: 'yandex',
  ASCII2D: 'ascii2d',
  GOOGLELENS: 'googlelens',
} as const

// 搜索过滤器配置
// 顺序模式默认不主动调用附加引擎，由各自 alwaysAttach 或「未找到高匹配度」时补位
export const SEARCH_FILTERS = {
  SEQUENTIAL_EXCLUDE: SEARCH_ENGINES.ATTACH,
} as const
