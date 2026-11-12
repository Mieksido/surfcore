/**
 * 时间工具（内核内部）
 * ============================================================================
 * 为什么在内核：**只有内核自己用**（目的机制的"当天"、语音的静默时段）。
 * 平台包需要时间就自己算——包不许 import 内核，这是边界。
 *
 * 依赖方向：无（只用 node 内置）。谁也不 import 它，除了内核自己。
 */

const pad = (n) => String(n).padStart(2, '0');

/** 本地日界：YYYY-MM-DD */
export function localDayKey(ms = Date.now()) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "23:30" → 1410（一天中的第几分钟）；非法值回退 fallback */
export function minutesOfDay(text, fallback = 0) {
  const m = /^(\d{1,2})\s*[:：]\s*(\d{1,2})$/.exec(String(text ?? '').trim());
  if (!m) return fallback;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return fallback;
  return h * 60 + min;
}

/** 现在是否在安静时段（起止相同 = 不启用） */
export function inQuietHours(date, quietStart, quietEnd) {
  const s = minutesOfDay(quietStart, -1);
  const e = minutesOfDay(quietEnd, -1);
  if (s < 0 || e < 0 || s === e) return false;
  const cur = date.getHours() * 60 + date.getMinutes();
  return s < e ? (cur >= s && cur < e) : (cur >= s || cur < e);
}

/** 下一个"安静结束"时刻（严格晚于 date） */
export function quietEndAfter(date, quietStart, quietEnd) {
  const e = minutesOfDay(quietEnd, -1);
  const d = new Date(date.getTime());
  if (e < 0) return d;
  d.setHours(Math.floor(e / 60), e % 60, 0, 0);
  if (d.getTime() <= date.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

/** 现在是否在某个时间窗内：'23:00'~'07:00'，支持跨午夜 */
export function inWindow(date, start, end) {
  return inQuietHours(date, start, end);
}
