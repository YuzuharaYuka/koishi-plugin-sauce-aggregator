// 引擎状态与错误
//
// 站点忙碌（如 IQDB 排队）不属于「搜索失败」，不应出现在面向用户的错误汇总里。
// 普通异常则按原因归类为 blocked / timeout / auth / config / error，
// 让调用方能够区分「确实没有结果」和「引擎没有完成搜索」。

export type EngineStatus =
  | 'ok'
  | 'no_results'
  | 'busy'
  | 'blocked'
  | 'timeout'
  | 'auth'
  | 'config'
  | 'error'

export type EngineErrorKind = Exclude<EngineStatus, 'ok' | 'no_results' | 'busy'>

export const ENGINE_STATUS_LABELS: Record<EngineStatus, string> = {
  ok: '完成',
  no_results: '无结果',
  busy: '繁忙，已跳过',
  blocked: '访问被拦截',
  timeout: '请求超时',
  auth: 'API Key 无效或额度不足',
  config: '配置不完整',
  error: '搜索失败',
}

/** 带分类的引擎错误；searcher 可在明确知道原因时直接抛出 */
export class EngineError extends Error {
  constructor(message: string, public readonly kind: EngineErrorKind = 'error') {
    super(message)
    this.name = 'EngineError'
  }
}

/** 引擎主动跳过：站点繁忙/冷却中，不算搜索失败 */
export class EngineBusyError extends Error {
  constructor(
    message: string,
    /** 恢复时间（毫秒时间戳），用于展示冷却剩余时间 */
    public readonly retryAt: number = 0,
  ) {
    super(message)
    this.name = 'EngineBusyError'
  }
}

const AUTH_PATTERN = /401|unauthorized|invalid\s*(?:api\s*)?key|api\s*key.*(?:invalid|exhausted|missing|失败)|所有.*api\s*key|额度|quota|exhausted|token.*(?:无效|过期|失效)/i
const BLOCKED_PATTERN = /cloudflare|人机验证|captcha|访问受限|风控|拦截|blocked|429|too many requests|rate limit|频率限制|搜索受限|页面没有跳转|challenge/i
const TIMEOUT_PATTERN = /超时|timeout|timed out|ETIMEDOUT|TimeoutError|aborted/i
const CONFIG_PATTERN = /未配置|未填写|缺少.*(?:api|key|token|配置)|not configured|missing.*(?:api\s*)?key|no.*api\s*key/i

/**
 * 把 searcher 抛出的异常归入统一状态。
 *
 * 先看显式的 EngineError / EngineBusyError，再按错误文本匹配。
 * 文本匹配只是兜底：HTTP 状态码、Cloudflare 提示和 Key 报错在现有
 * searcher 中大多以中文/英文文本抛出，因此能覆盖常见情况。
 */
export function classifyEngineError(error: unknown): EngineStatus {
  if (error instanceof EngineBusyError) return 'busy'
  if (error instanceof EngineError) return error.kind

  const message = error instanceof Error ? error.message : String(error ?? '')

  if (CONFIG_PATTERN.test(message)) return 'config'
  if (AUTH_PATTERN.test(message)) return 'auth'
  if (BLOCKED_PATTERN.test(message)) return 'blocked'
  if (TIMEOUT_PATTERN.test(message)) return 'timeout'
  return 'error'
}
