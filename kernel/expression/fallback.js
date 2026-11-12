/**
 * 模型失败时的降级：她这会儿说不出话，该给什么反应
 * ============================================================================
 * 为什么在表达层：它产出的是**要说的话**（措辞），不是运送、也不是渠道。
 *
 * 三条规矩：
 *   · **临时故障**（超时/网络/空回复）→ 可以给一句短话（人话，不解释技术细节）
 *   · **永久故障**（鉴权/额度）→ **不说话**，只留审计（说也没用，还会让人困惑）
 *   · 任何情况都**不假装成功**（返回值里永远带 reason）
 */
export const DEFAULT_FALLBACK = Object.freeze({
  onTransient: 'say',                                   // 'say' | 'silent'
  text: '我这边卡了一下，等我一会儿。',
});

const TRANSIENT = new Set(['model.timeout', 'model.network', 'model.empty']);

/**
 * @param {object} error 模型端口返回的 { code, message, retryable, hint }
 * @param {object} cfg DEFAULT_FALLBACK 的覆盖
 * @returns {{kind:'say'|'stay_silent', text?:string, reason:string}}
 */
export function fallbackFor(error = {}, cfg = {}) {
  const opts = { ...DEFAULT_FALLBACK, ...cfg };
  const code = String(error?.code ?? 'model.unknown');

  if (!TRANSIENT.has(code)) {
    return { kind: 'stay_silent', reason: `永久故障：${code}` };
  }
  if (opts.onTransient === 'silent') {
    return { kind: 'stay_silent', reason: `临时故障（静默）：${code}` };
  }
  return { kind: 'say', text: String(opts.text), reason: `临时故障（降级一句）：${code}` };
}
