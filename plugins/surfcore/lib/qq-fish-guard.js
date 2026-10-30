/**
 * QQ 鱼群保护触发记录的纯整理层（给设置页用）。
 *
 * 桥接把每次新触发写进 `state/social-v2.json` 的 `fishGuardLog`（每群最多 30 条），
 * 这里只负责把多个群的状态摊平成一张按时间倒序的表；不读不写文件，方便单测。
 */
import { withConfiguredTimeZone } from '../../../src/timezone.js'


const localDate = (value) => {
  const t = new Date(value);
  return Number.isFinite(t.getTime()) ? withConfiguredTimeZone(() => t.toLocaleDateString('sv-SE')) : '';
};

function normalizeItem(key, entry, { active = false, ended = false } = {}) {
  if (!entry || typeof entry !== 'object') return null;
  const at = Number(entry.at) || 0;
  const groupId = String(key).startsWith('group:') ? String(key).slice(6) : '';
  return {
    key,
    groupId,
    groupName: String(entry.groupName ?? ''),
    at: at ? new Date(at).toISOString() : '',
    reason: String(entry.reason ?? ''),
    fishCount: Number(entry.fishCount) || 0,
    fishMessages: Number(entry.fishMessages) || 0,
    totalMessages: Number(entry.totalMessages) || 0,
    fishRatio: Number(entry.fishRatio) || 0,
    consecutiveFish: Number(entry.consecutiveFish) || 0,
    until: Number(entry.until) ? new Date(Number(entry.until)).toISOString() : '',
    active,
    ended,
  };
}

/**
 * @param {{conversations?:Object<string,object>}} data - social-v2.json 的内容
 * @param {{now?:number}} opts
 * @returns {{items:Array, active:number, today:number}}
 */
export function summarizeQqFishGuard(data, { now = Date.now() } = {}) {
  const conversations = data?.conversations && typeof data.conversations === 'object' ? data.conversations : {};
  const groupEntries = Object.entries(conversations).filter(([key, st]) => String(key).startsWith('group:') && st && typeof st === 'object');
  // 当前冷却/lastFishGuard 本身不带群名；从同一群的触发日志里补，避免设置页只显示群号。
  const nameByKey = new Map();
  for (const [key, st] of groupEntries) {
    for (const entry of Array.isArray(st.fishGuardLog) ? st.fishGuardLog : []) {
      if (entry?.groupName) nameByKey.set(key, String(entry.groupName));
    }
  }
  const items = [];
  for (const [key, st] of groupEntries) {
    for (const entry of Array.isArray(st.fishGuardLog) ? st.fishGuardLog : []) {
      const item = normalizeItem(key, entry);
      if (item) items.push(item);
    }
    if (st.fishGuard) {
      const item = normalizeItem(key, st.fishGuard, { active: Number(st.fishGuard.until) > now });
      if (item) {
        if (!item.groupName) item.groupName = nameByKey.get(key) ?? '';
        items.push(item);
      }
    } else if (st.lastFishGuard) {
      const item = normalizeItem(key, st.lastFishGuard, { ended: true });
      if (item) {
        if (!item.groupName) item.groupName = nameByKey.get(key) ?? '';
        items.push(item);
      }
    }
  }
  // 日志与当前冷却可能指向同一次触发：按 key+时间+原因去重，active 优先。
  const merged = new Map();
  for (const item of items) {
    const k = `${item.key}|${item.at}|${item.reason}`;
    const prev = merged.get(k);
    if (!prev || (!prev.active && item.active)) merged.set(k, item);
  }
  const list = [...merged.values()]
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 30);
  const today = localDate(now);
  return {
    items: list,
    active: list.filter((x) => x.active).length,
    today: list.filter((x) => x.at && localDate(x.at) === today).length,
  };
}
