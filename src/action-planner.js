/**
 * Action Planner 的第一版：只做 close 的幂等与状态校验，不自动合并写操作。
 *
 * 为什么不在这里自动 send+close：
 *   · 发送失败不能假装成功后收尾；
 *   · 发送成功后如果又来了新未读，不能无条件结束；
 *   · close 还会改 unread/closure/noAction，必须先让模型明确决定。
 *
 * 后续可扩展 send 失败状态、wait 状态；当前先保证重复 close 不重复写。
 */
export const ACTION_PLANNER_VERSION = 1;

/**
 * @param {object} opts
 * @param {object} opts.st socialV2 state
 * @param {number} [opts.now]
 */
export const CLOSE_SEND_FAILED_STALE_MS = 10 * 60 * 1000;

export function planClose({ st, now = Date.now(), sendFailed = false, sendFailedAgeMs = 0, allowAbandon = false } = {}) {
  if (sendFailed) {
    // 模型明确放弃本轮：允许收尾，但要求把「没发出去」写进 summary，而不是假装说过。
    if (allowAbandon) {
      return {
        blocked: false,
        abandonedSendFailure: true,
        hint: '已按「放弃本轮」收尾：发送失败不再阻止；summary 里要写清没发出去，别当成说过。',
      };
    }
    // 失败记录过期（默认 10 分钟）：通道早恢复了，不要永远挡着收尾。
    if (Number(sendFailedAgeMs) >= CLOSE_SEND_FAILED_STALE_MS) {
      return { blocked: false, staleSendFailure: true };
    }
    return {
      blocked: true,
      code: 'CLOSE_AFTER_SEND_FAILED',
      error: '最近一次 QQ 发送失败，不能假装发送成功后收尾；先重试发送，或明确放弃本轮。',
      hint: '先重试 qq_send_message；发送成功后再 close；确实发不出去（对方离线/通道故障）时用 abandon:true 明确放弃本轮。',
      nextStep: 'send',
    };
  }
  const closure = st?.closure;
  if (!closure || closure.reopenedAt) return { blocked: false };
  const closedAt = Number(closure.at) || 0;
  const lastActionAt = Number(st?.lastActionAt) || 0;
  // 上次 close 之后没有新的动作/发送，重复 close 直接幂等返回。
  if (closedAt && lastActionAt <= closedAt) {
    return {
      blocked: true,
      code: 'ALREADY_CLOSED',
      alreadyClosed: true,
      closedAt,
      cooldownUntil: Number(closure.cooldownUntil) || 0,
      summary: String(closure.summary || ''),
      nextOpening: String(closure.nextOpening || ''),
      hint: '这段已经收尾；有新消息/新话题再继续，不要重复收尾。',
    };
  }
  return { blocked: false };
}
