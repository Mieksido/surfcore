/**
 * 时间工具（这个平台包自己用）
 * ============================================================================
 * 为什么包里有自己的一份：**包不许 import 内核**（边界）。需要的就那两个函数，
 * 各层各留一份，比"为了复用拉一个公共层"更干净。
 */

const pad = (n) => String(n).padStart(2, '0');

/** 本地日界：YYYY-MM-DD */
export function biliDayKey(ms = Date.now()) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function minutesOfDay(text, fallback = 0) {
  const m = /^(\d{1,2})\s*[:：]\s*(\d{1,2})$/.exec(String(text ?? '').trim());
  if (!m) return fallback;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return fallback;
  return h * 60 + min;
}

/** 现在是否在某个时间窗内（起止相同 = 不启用；支持跨午夜） */
export function biliInWindow(date, start, end) {
  const s = minutesOfDay(start, -1);
  const e = minutesOfDay(end, -1);
  if (s < 0 || e < 0 || s === e) return false;
  const cur = date.getHours() * 60 + date.getMinutes();
  return s < e ? (cur >= s && cur < e) : (cur >= s || cur < e);
}
