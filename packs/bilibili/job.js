/**
 * B站 分享任务：到点 → 选一张卡 → 组装提示词 → 调模型 → 交给发送方
 * ============================================================================
 * 位置：B站 模块。**"到点做什么、拿哪条内容、提示词长什么样"是 B站 自己的规矩**；
 * 真正的"谁发、发到哪、几点触发"由调用方（工具/计划任务）注入。
 *
 * 不碰 fs、不碰 timer、不联网：state / model / send 全部由参数给。
 * 这样这段逻辑可以在几毫秒内用假世界验证（法则 15）。
 */
import { planShareSchedule } from './slots.js';
import { buildSharePrompt, pickShareCard, renderShare, SHARE_COOLDOWN_MS } from './share.js';

/** 分享历史保留 30 天（旧调度器同口径） */
export const SHARE_HISTORY_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 算"这一轮要不要分享、分享什么"。
 * @param {object} input
 *   { now, times, state, records, shareMode, cooldownMs }
 * @returns {object} { due, reason, slot?, next, card?, prompt?, cardText?, cardMode? }
 */
export function planShareJob({
  now = Date.now(),
  times,
  state = {},
  records = [],
  shareMode = { cardMode: 'text' },
  cooldownMs = SHARE_COOLDOWN_MS,
} = {}) {
  const schedule = planShareSchedule({ now, times, state });
  const next = { label: schedule.next.label, at: schedule.next.at };
  if (!schedule.due) {
    return { due: false, reason: schedule.reason, slot: schedule.slot ?? null, next };
  }

  const slot = schedule.slot;
  const timeList = Array.isArray(times) ? times : [];
  const slotIndex = Math.max(0, timeList.findIndex((t) => t === slot.label));
  const history = state?.shareHistory && typeof state.shareHistory === 'object' ? state.shareHistory : {};
  const card = pickShareCard(records, { slotIndex, history, now, cooldownMs });
  if (!card) {
    return {
      due: true,
      reason: 'no-fresh-material',
      slot,
      next,
      hint: '没有新鲜素材（能分享的都在冷却期）：这一场跳过，不发旧的',
    };
  }

  const rendered = renderShare(card, { share: shareMode });
  const cardSent = rendered.send === true;
  const prompt = buildSharePrompt(card, slot.label, { cardSent });
  return {
    due: true,
    reason: 'ready',
    slot,
    next,
    card,
    cardMode: rendered.mode,
    cardText: cardSent ? rendered.text : '',
    prompt,
  };
}

/**
 * 投递成功后推进状态：这个槽位算跑过、这张卡进 30 天历史。
 * 纯函数：返回新 state，不改入参。
 */
export function applyShareResult(state = {}, { slot, card, now = Date.now(), keepMs = SHARE_HISTORY_KEEP_MS } = {}) {
  if (!slot?.key || !card?.id) return state;
  const at = new Date(Number(now) || Date.now()).toISOString();
  const lastSlots = { ...(state.lastSlots && typeof state.lastSlots === 'object' ? state.lastSlots : {}) };
  lastSlots[slot.key] = at;
  const shareHistory = { ...(state.shareHistory && typeof state.shareHistory === 'object' ? state.shareHistory : {}) };
  shareHistory[String(card.id)] = at;

  const cutoff = Number(now) - Math.max(0, Number(keepMs) || 0);
  for (const [key, iso] of Object.entries(shareHistory)) {
    const t = Date.parse(String(iso));
    if (!Number.isFinite(t) || t < cutoff) delete shareHistory[key];
  }
  return { ...state, lastSlot: slot.key, lastRunAt: at, lastSlots, shareHistory };
}

/** 模型输出清理：去引号/空白；沉默或空 → null */
export function cleanShareReply(text) {
  const s = String(text ?? '').trim();
  if (!s || /^\[(SILENT|沉默)\]$/i.test(s)) return null;
  return s.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim().slice(0, 500) || null;
}

/**
 * 执行一轮分享：对每个群先发卡（如果模式是 text），再发模型短评。
 * @param {object} input
 *   { plan, groups, model, system, send, now, onLog }
 * @returns {Promise<object>} { sentGroups, failures, text, card }
 */
export async function runShareJob({
  plan,
  groups = [],
  model,
  system = '',
  send,
  now = Date.now(),
  onLog = () => {},
} = {}) {
  if (!plan?.due) return { skipped: true, reason: plan?.reason ?? 'not-due', sentGroups: 0, failures: [] };
  if (plan.reason !== 'ready' || !plan.card) {
    return { skipped: true, reason: plan.reason, sentGroups: 0, failures: [] };
  }
  if (!Array.isArray(groups) || !groups.length) {
    return { skipped: false, sentGroups: 0, failures: [{ group: '', error: '没有白名单群' }], reason: 'no-groups' };
  }
  if (!model || typeof model.complete !== 'function') {
    return { skipped: false, sentGroups: 0, failures: [{ group: '', error: '没有可用模型' }], reason: 'no-model' };
  }
  if (typeof send !== 'function') {
    return { skipped: false, sentGroups: 0, failures: [{ group: '', error: '没有发送函数' }], reason: 'no-send' };
  }

  const out = await model.complete({
    messages: [
      { role: 'system', content: String(system || '你是群里的一个角色，说话自然、短。') },
      { role: 'user', content: plan.prompt },
    ],
  });
  if (out?.error) {
    return { skipped: false, sentGroups: 0, failures: [{ group: '', error: out.error.message ?? out.error.code ?? '模型失败' }], reason: 'model-failed' };
  }
  const text = cleanShareReply(out?.text);
  if (!text) {
    return { skipped: false, sentGroups: 0, failures: [{ group: '', error: '模型没有产出可发的内容' }], reason: 'empty-reply' };
  }

  const failures = [];
  const delivered = new Set();
  for (const gid of groups) {
    const channel = `group:${String(gid).replace(/^group:/, '')}`;
    try {
      if (plan.cardText) {
        const cardAck = await send(channel, { kind: 'say', text: plan.cardText });
        if (!cardAck || cardAck.status !== 'delivered') throw new Error(cardAck?.error?.message ?? '卡片发送失败');
        delivered.add(channel);
      }
      const ack = await send(channel, { kind: 'say', text, aiGenerated: true, label: 'AI 生成' });
      if (!ack || ack.status !== 'delivered') throw new Error(ack?.error?.message ?? '短评发送失败');
      delivered.add(channel);
      onLog('info', `[B站分享] ${plan.slot.label} 已发 ${channel}`);
    } catch (error) {
      failures.push({ group: channel, error: String(error?.message ?? error) });
      onLog('error', `[B站分享] ${plan.slot.label} 发送失败 ${channel}：${error?.message ?? error}`);
    }
  }
  // 只要这个群收到了卡或短评中的任意一条，就算"这一场发过了"（旧调度器口径），
  // 避免下一轮把同一张卡再发一遍。失败仍逐条返回，不静默。
  return { skipped: false, sentGroups: delivered.size, failures, text, card: plan.card, at: now };
}
