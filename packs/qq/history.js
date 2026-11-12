/**
 * QQ 历史补读：断线/重连后补上断线期间的消息
 * ============================================================================
 * 位置：QQ 平台包。**补历史是渠道能力**，不是内核能力；内核只收到普通事件，
 * 只是 source='history'（内容字段，不是新消息种类），并且不因历史消息醒来。
 *
 * 只补群历史：OneBot v11 的 get_group_msg_history 最稳定；私聊历史网关支持不一，
 * 没有就跳过，不猜。
 */
import { normalizeEvent } from './onebot.js';

export const DEFAULT_HISTORY = Object.freeze({ maxAgeMs: 2 * 60 * 60 * 1000, limit: 30, knownMax: 200, toleranceMs: 5000 });

const num = (v) => Number(v) || 0;

/** 已见过的最新时间/编号（用于水位，不依赖平台时间精确到毫秒） */
export function rememberEvent(state = {}, event = {}) {
  const channel = String(event?.from?.channel ?? '');
  if (!channel) return state;
  const at = num(event?.from?.at);
  const id = String(event?.externalId ?? '');
  const next = state[channel] ?? { at: 0, ids: [] };
  if (at > next.at) next.at = at;
  if (id) {
    next.ids.push(id);
    if (next.ids.length > DEFAULT_HISTORY.knownMax) next.ids.splice(0, next.ids.length - DEFAULT_HISTORY.knownMax);
  }
  state[channel] = next;
  return state;
}

/**
 * 从历史消息里挑“水位之后、没见过的”。
 * @param {Array} messages normalizeEvent 后的事件
 * @param {object} opts { afterAt, knownIds, now, maxAgeMs, toleranceMs, limit }
 */
export function selectMissedHistory(messages = [], { afterAt = 0, knownIds = [], now = Date.now(), maxAgeMs = DEFAULT_HISTORY.maxAgeMs, toleranceMs = DEFAULT_HISTORY.toleranceMs, limit = DEFAULT_HISTORY.limit } = {}) {
  const known = new Set((Array.isArray(knownIds) ? knownIds : []).map(String));
  const floor = Math.max(0, now - Math.max(0, Number(maxAgeMs) || 0));
  const watermark = Math.max(0, Number(afterAt) || 0) - Math.max(0, Number(toleranceMs) || 0);
  const out = [];
  for (const event of Array.isArray(messages) ? messages : []) {
    const id = String(event?.externalId ?? '');
    const at = num(event?.from?.at);
    if (!id || !at) continue;          // 没有稳定编号/时间，无法去重
    if (at < floor || at < watermark) continue;
    if (known.has(id)) continue;
    out.push(event);
    if (out.length >= Math.max(1, Number(limit) || DEFAULT_HISTORY.limit)) break;
  }
  return out.sort((a, b) => num(a.from.at) - num(b.from.at));
}

/** 把 OneBot 历史消息转成统一事件；失败返回 null。 */
export function historyMessageToEvent(raw = {}, { ownerId = '' } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const groupId = raw.group_id ?? raw.groupId;
  if (!groupId) return null;
  const sender = raw.sender ?? {};
  const event = normalizeEvent({
    post_type: 'message',
    message_type: 'group',
    group_id: groupId,
    user_id: raw.user_id ?? sender.user_id,
    message_id: raw.message_id ?? raw.messageId,
    time: raw.time,
    message: raw.message ?? raw.raw_message ?? '',
    sender,
    raw_message: raw.raw_message,
  }, { ownerId });
  if (!event) return null;
  // 通用布尔：只入记忆、不唤醒；内核不认识“历史/QQ”这些外部概念。
  return { ...event, silent: true };
}

/**
 * 造一个补历史器；client 只要求有 call()。
 * @param {object} opts { client, ownerId, now, log }
 */
export function createHistoryCatchup({ client, ownerId = '', now = () => Date.now(), log = () => {} } = {}) {
  const state = {};
  return {
    remember(event) { rememberEvent(state, event); },
    channels() { return Object.keys(state); },
    watermark(channel) { return state[String(channel ?? '')] ?? { at: 0, ids: [] }; },
    async catchup(channel, { limit = DEFAULT_HISTORY.limit } = {}) {
      const key = String(channel ?? '');
      const m = /^group:(\d+)$/.exec(key);
      if (!m || !client || typeof client.call !== 'function') return { ok: false, skipped: true, reason: 'not-group-or-client' };
      const groupId = Number(m[1]);
      const snap = state[key] ?? { at: 0, ids: [] };
      let res;
      try { res = await client.call('get_group_msg_history', { group_id: groupId, count: Math.max(1, Math.min(100, Number(limit) || 30)) }); }
      catch (error) { return { ok: false, code: 'qq.history-failed', error: String(error?.message ?? error) }; }
      if (res?.ok === false) return { ok: false, code: res?.error?.code ?? 'qq.history-failed', error: res?.error?.message ?? '补历史失败' };
      const list = Array.isArray(res?.data) ? res.data : (Array.isArray(res?.data?.messages) ? res.data.messages : []);
      const events = list.map((x) => historyMessageToEvent(x, { ownerId })).filter(Boolean);
      const missed = selectMissedHistory(events, { afterAt: snap.at, knownIds: snap.ids, now: now(), limit });
      log('info', `QQ 补历史 ${key}：拉到 ${events.length}，补 ${missed.length}`);
      return { ok: true, channel: key, fetched: events.length, missed };
    },
  };
}
