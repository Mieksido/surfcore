/**
 * B站 分享槽位：一天里的固定时间点、去重、错过的补跑
 * ============================================================================
 * 位置：B站 模块。**"一天分享几次、哪几个点、错过十分钟内还补不补"是 B站 自己的规矩**，
 * 内核不该认识 07:00/23:00 这种数。
 *
 * 这里只做纯计算：
 *   · 时间点归一（去重、排序、坏值丢掉）
 *   · 下一个点、上一个点
 *   · 这个点跑过没有（同一天同一个点只跑一次）
 *   · 启动补跑窗口（旧代码是 10 分钟）
 *
 * 不碰 fs、不碰 timer、不碰网络；时间由参数给，状态由调用方传进来。
 * 真正的"到点触发"属于运行入口，不属于包。
 */
import { biliDayKey } from './time.js';

/** 旧代码的 8 个点（用户可以在设置里改） */
export const DEFAULT_SHARE_TIMES = Object.freeze([
  '07:00', '11:00', '13:00', '15:00', '17:00', '19:00', '21:00', '23:00',
]);

/** 启动/重连后，点过去多久还允许补跑（旧代码 10 分钟） */
export const SHARE_CATCH_UP_MS = 10 * 60 * 1000;

/** 槽位记录保留 30 天（旧代码同口径） */
export const SHARE_SLOT_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 归一化时间点：接受 "7:00" / "07:00" / " 7：00 "，越界夹到 00:00~23:59，坏的丢掉。
 * @param {string[]} times
 * @returns {string[]} 升序、去重的 "HH:MM"
 */
export function normalizeShareTimes(times = DEFAULT_SHARE_TIMES) {
  const out = [];
  for (const raw of Array.isArray(times) ? times : DEFAULT_SHARE_TIMES) {
    const m = /^(\d{1,2})\s*[:：]\s*(\d{1,2})$/.exec(String(raw ?? '').trim());
    if (!m) continue;
    const hh = Math.min(23, Math.max(0, Number(m[1])));
    const mm = Math.min(59, Math.max(0, Number(m[2])));
    out.push(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
  }
  return [...new Set(out)].sort();
}

/** 槽位键：本地日期 + 时间点（例：2026-11-10 21:00） */
export function shareSlotKey(at, label) {
  return `${biliDayKey(at)} ${label}`;
}

/** 把一个 HH:MM 落到某一天（本地时区） */
function atLabel(dayMs, label) {
  const [hh, mm] = String(label).split(':').map(Number);
  const d = new Date(dayMs);
  d.setHours(hh, mm, 0, 0);
  return d;
}

/**
 * 下一个槽位（严格晚于 now）。
 * @returns {{label:string, at:number, key:string}}
 */
export function nextShareSlot({ now = Date.now(), times = DEFAULT_SHARE_TIMES } = {}) {
  const list = normalizeShareTimes(times);
  const labels = list.length ? list : [...DEFAULT_SHARE_TIMES];
  const t = new Date(now);
  for (const label of labels) {
    const d = atLabel(t.getTime(), label);
    if (d.getTime() > t.getTime() + 1000) {
      return { label, at: d.getTime(), key: shareSlotKey(d.getTime(), label) };
    }
  }
  const tomorrow = new Date(t.getTime());
  tomorrow.setDate(tomorrow.getDate() + 1);
  const d = atLabel(tomorrow.getTime(), labels[0]);
  return { label: labels[0], at: d.getTime(), key: shareSlotKey(d.getTime(), labels[0]) };
}

/**
 * 今天的最后一个"已经到点"的槽位（可能没有）。
 * @returns {{label:string, at:number, key:string}|null}
 */
export function lastShareSlot({ now = Date.now(), times = DEFAULT_SHARE_TIMES } = {}) {
  const list = normalizeShareTimes(times);
  const t = new Date(now);
  let last = null;
  for (const label of list) {
    const d = atLabel(t.getTime(), label);
    if (d.getTime() <= t.getTime()) last = { label, at: d.getTime(), key: shareSlotKey(d.getTime(), label) };
  }
  return last;
}

/**
 * 清掉过期的槽位记录（只保留 keepMs 内的）。
 * @param {{lastSlots?:object}} state
 */
export function pruneShareSlots(state = {}, { now = Date.now(), keepMs = SHARE_SLOT_KEEP_MS } = {}) {
  const src = state?.lastSlots && typeof state.lastSlots === 'object' && !Array.isArray(state.lastSlots)
    ? state.lastSlots
    : {};
  const cutoff = now - Math.max(0, Number(keepMs) || 0);
  const lastSlots = {};
  for (const [key, iso] of Object.entries(src)) {
    const at = Date.parse(String(iso));
    if (Number.isFinite(at) && at >= cutoff) lastSlots[key] = String(iso);
  }
  return { ...state, lastSlots };
}

/**
 * 现在该不该跑这个槽位。
 * @param {object} input { now, times, state, catchUpMs }
 * @returns {{due:boolean, reason:string, slot?:object, next:object}}
 */
export function dueShareSlot({
  now = Date.now(),
  times = DEFAULT_SHARE_TIMES,
  state = {},
  catchUpMs = SHARE_CATCH_UP_MS,
} = {}) {
  const next = nextShareSlot({ now, times });
  const slot = lastShareSlot({ now, times });
  if (!slot) return { due: false, reason: 'before-first-slot', next };
  if (state?.lastSlots?.[slot.key]) return { due: false, reason: 'already-used', slot, next };
  const lag = Math.max(0, Number(now) - slot.at);
  if (lag > Math.max(0, Number(catchUpMs) || 0)) return { due: false, reason: 'missed-window', slot, next };
  return { due: true, reason: 'due', slot, next };
}

/**
 * 一次算出：清过期后的状态 + 该不该跑 + 下一个点。
 * 调用方拿到 due 后自己决定投递；投递成功再写 `lastSlots[key] = new Date().toISOString()`。
 */
export function planShareSchedule({
  now = Date.now(),
  times = DEFAULT_SHARE_TIMES,
  state = {},
  catchUpMs = SHARE_CATCH_UP_MS,
} = {}) {
  const pruned = pruneShareSlots(state, { now });
  return { ...dueShareSlot({ now, times, state: pruned, catchUpMs }), state: pruned };
}
