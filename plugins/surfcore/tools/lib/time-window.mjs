/**
 * 作息时间窗的共享解析。
 *
 * 之前 scheduler.js 的 inWindow 和 night-schedule.js 各写一套：
 *   - 一个不支持跨午夜；
 *   - 一个遇到非法/全角冒号会静默变 0；
 *   - 两套结果会漂移。
 * 这里把「HH:MM 文本 → 分钟 → 是否命中」收敛成纯函数。
 */

const FULLWIDTH_DIGITS = '０１２３４５６７８９';
const FULLWIDTH_COLONS = /[：]/g;

/** 只做文本归一化，不改变 6:00 / 06:00 的写法。 */
export function normalizeClockText(value) {
  return String(value ?? '')
    .trim()
    .replace(FULLWIDTH_COLONS, ':')
    .replace(/[０-９]/g, (ch) => String(FULLWIDTH_DIGITS.indexOf(ch)));
}

/**
 * 解析 HH:MM。
 * allow24=true 时允许 24:00（只应给结束时间用）。
 * 非法返回 null，不再像旧代码那样 Math.max(...,0) 静默变 0 点。
 */
export function parseClock(value, { allow24 = false } = {}) {
  const text = normalizeClockText(value);
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(text);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || m < 0 || m > 59) return null;
  if (h === 24 && m === 0 && allow24) return 1440;
  if (h < 0 || h > 23) return null;
  return h * 60 + m;
}

/** 分钟 → HH:MM（24:00 保留为 24:00，便于显示结束边界）。 */
export function formatClock(minutes) {
  const total = Math.round(Number(minutes) || 0);
  if (total === 1440) return '24:00';
  const n = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

/**
 * 归一化一个窗口。
 * end <= start 视为跨午夜；start === end 视为非法（避免“22:00–22:00”到底是空还是全天）。
 */
export function normalizeWindow(window) {
  const start = parseClock(window?.start);
  const end = parseClock(window?.end, { allow24: true });
  if (start == null) return { ok: false, code: 'WINDOW_START_INVALID', error: `开始时间不合法：${window?.start ?? ''}` };
  if (end == null) return { ok: false, code: 'WINDOW_END_INVALID', error: `结束时间不合法：${window?.end ?? ''}` };
  if (end === start) return { ok: false, code: 'WINDOW_EMPTY', error: '开始时间和结束时间不能相同' };
  const normalizedEnd = end < start ? end + 1440 : end;
  const rawWakes = Number(window?.wakes ?? 1);
  const wakes = Number.isFinite(rawWakes) ? Math.max(0, Math.min(12, Math.floor(rawWakes))) : 1;
  return {
    ok: true,
    start,
    end: normalizedEnd,
    wrap: normalizedEnd > 1440,
    label: `${formatClock(start)}–${formatClock(normalizedEnd)}`,
    wakes,
  };
}

/** 归一化整组窗口；非法项丢弃并返回 warnings，不把旧窗口静默算到 0 点。 */
export function normalizeWindows(windows = [], { fallback = null } = {}) {
  const out = [];
  const warnings = [];
  for (const raw of Array.isArray(windows) ? windows : []) {
    const normalized = normalizeWindow(raw);
    if (!normalized.ok) {
      warnings.push(`${normalized.code}：${normalized.error}`);
      continue;
    }
    out.push(normalized);
  }
  if (!out.length && fallback) {
    for (const raw of fallback) {
      const normalized = normalizeWindow(raw);
      if (normalized.ok) out.push(normalized);
    }
  }
  return { windows: out, warnings };
}

/** 某个本地分钟是否落在窗口内；支持跨午夜。 */
export function windowContains(window, minutes) {
  if (!window) return false;
  const m = Number(minutes);
  if (!Number.isFinite(m)) return false;
  if (window.wrap) return m >= window.start || m < window.end - 1440;
  return m >= window.start && m < window.end;
}
