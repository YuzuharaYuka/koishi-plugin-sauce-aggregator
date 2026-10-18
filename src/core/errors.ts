// 引擎主动跳过
//
// 站点忙碌（如 IQDB 排队）不属于「搜索失败」，不应出现在面向用户的错误汇总里。
// 用这个错误类型与普通异常区分：搜索流程会把它转成一条安静的通知。

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
