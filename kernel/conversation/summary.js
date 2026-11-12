/**
 * 对话摘要：把"窗口挤出去的旧轮次"压成一段事实摘要
 * ============================================================================
 * 位置：内核·对话。它隐藏的秘密是**怎么把多轮对话压成不编造的一段话**；
 * 何时触发、模型从哪来、失败怎么办，由 conversation / kernel 决定。
 *
 * 三条规矩：
 *   · 只做压缩，不编事实；模型输出空/沉默/坏形状 → null（调用方保留原文）
 *   · 摘要长度有上限（默认 600 字），不把"长期记忆"变成另一份超长正文
 *   · 不碰渠道、不碰事件；输入是纯轮次，输出是纯文本
 */

export const DEFAULT_SUMMARY = Object.freeze({
  enabled: true,
  minTurns: 4,        // 至少攒够几轮才值得调一次模型
  minChars: 400,      // 或者攒够多少字
  maxChars: 600,      // 摘要本身的长度上限
  maxPending: 80,     // 等摘要的旧轮次上限（防无限涨）
});

/**
 * 现在值不值得摘要。
 * @param {object} input { pendingTurns, pendingChars, minTurns, minChars }
 */
export function shouldSummarize({
  pendingTurns = 0,
  pendingChars = 0,
  minTurns = DEFAULT_SUMMARY.minTurns,
  minChars = DEFAULT_SUMMARY.minChars,
} = {}) {
  const n = Math.max(0, Number(pendingTurns) || 0);
  const c = Math.max(0, Number(pendingChars) || 0);
  return n >= Math.max(1, Number(minTurns) || DEFAULT_SUMMARY.minTurns)
    || c >= Math.max(1, Number(minChars) || DEFAULT_SUMMARY.minChars);
}

const who = (turn) => (turn?.role === 'her' ? '她' : (turn?.actor ? String(turn.actor) : '对方'));

/**
 * 组装摘要提示词。previous 是已有摘要（第一次为空）。
 * @returns {{system:string, user:string, turns:number}}
 */
export function buildSummaryPrompt({ previous = '', turns = [], maxChars = DEFAULT_SUMMARY.maxChars } = {}) {
  const list = (Array.isArray(turns) ? turns : []).filter((t) => String(t?.text ?? '').trim());
  const lines = list.map((t) => `- ${who(t)}：${String(t.text).trim().slice(0, 300)}`);
  const cap = Math.max(80, Number(maxChars) || DEFAULT_SUMMARY.maxChars);
  const user = [
    previous ? `已有摘要（请合并，不要丢掉旧事实）：\n${String(previous).slice(0, cap)}\n` : '',
    '请把下面这段对话压缩成一段事实摘要，供以后继续聊天时参考。',
    '要求：只写确实发生的事（谁说了什么、约定了什么、情绪/偏好）；不要编造；不要写分析；不要用 Markdown；不超过 ' + cap + ' 字。',
    '',
    ...lines,
  ].filter(Boolean).join('\n');

  return {
    system: '你是对话摘要器。只输出摘要正文，不要解释，不要加引号，不要输出“摘要：”。',
    user,
    turns: list.length,
  };
}

/**
 * 清理模型输出：去代码围栏/引号/前缀；空、沉默、坏形状 → null。
 */
export function normalizeSummary(text, { maxChars = DEFAULT_SUMMARY.maxChars } = {}) {
  let s = String(text ?? '').trim();
  if (!s) return null;
  if (/^\[(SILENT|沉默)\]$/i.test(s)) return null;
  s = s.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '').trim();
  s = s.replace(/^(摘要|总结)[：:]\s*/i, '').trim();
  s = s.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  if (!s) return null;
  const cap = Math.max(80, Number(maxChars) || DEFAULT_SUMMARY.maxChars);
  return s.slice(0, cap);
}

/** 合并旧摘要与新摘要（模型没合并时兜底；保留旧事实在前的顺序） */
export function mergeSummary(previous = '', addition = '', { maxChars = DEFAULT_SUMMARY.maxChars } = {}) {
  const old = String(previous ?? '').trim();
  const add = String(addition ?? '').trim();
  if (!old) return add.slice(0, Math.max(80, Number(maxChars) || DEFAULT_SUMMARY.maxChars));
  if (!add) return old.slice(0, Math.max(80, Number(maxChars) || DEFAULT_SUMMARY.maxChars));
  if (old.includes(add)) return old.slice(0, Math.max(80, Number(maxChars) || DEFAULT_SUMMARY.maxChars));
  const cap = Math.max(80, Number(maxChars) || DEFAULT_SUMMARY.maxChars);
  return `${old}\n${add}`.slice(0, cap);
}

/** 给提示词用的摘要块（没摘要就空串） */
export function renderSummaryBlock(summary = '') {
  const s = String(summary ?? '').trim();
  return s ? `【更早的对话摘要】\n${s}` : '';
}
