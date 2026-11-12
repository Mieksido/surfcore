/**
 * B站 渠道的内部业务逻辑（纯逻辑，不联网、不需要真机）
 * ============================================================================
 * 移植自旧的 scheduler.js / bili-* / tools（34 个命令背后的规则）：
 *   · 四本额度账（分享/评论/私信/弹幕）
 *   · 生物钟：只在作息窗口里醒，且**随机跳过**（免得像定时机器人）
 *   · 选片：去重、偏好加权、先看没看过的
 *
 * 为什么放在平台包里：这些全是"B站 这个世界的规矩"，内核不该知道。
 */
import { biliInWindow, biliDayKey } from './time.js';

/** 四本账 */
export const QUOTA_KINDS = Object.freeze(['share', 'comment', 'dm', 'danmaku']);

export function createQuota({ limits = {}, now = () => Date.now() } = {}) {
  const day = { value: null };
  const used = new Map();

  function rollover() {
    const key = biliDayKey(now());
    if (day.value !== key) { day.value = key; used.clear(); }
  }

  return {
    canDo(kind = 'share', n = 1) {
      rollover();
      const k = QUOTA_KINDS.includes(kind) ? kind : 'share';
      const lim = Number(limits[k]);
      const cur = used.get(k) ?? 0;
      if (!Number.isFinite(lim) || lim <= 0) return { ok: false, reason: 'no-quota', hint: `「${k}」额度没配或为 0：到 B站 页调高` };
      if (cur + n > lim) return { ok: false, reason: 'exceeded', used: cur, limit: lim, hint: `今天的「${k}」用完了（${cur}/${lim}）：明天再来` };
      return { ok: true, used: cur, limit: lim };
    },
    commit(kind = 'share', n = 1) {
      rollover();
      const k = QUOTA_KINDS.includes(kind) ? kind : 'share';
      used.set(k, (used.get(k) ?? 0) + n);
      return { kind: k, used: used.get(k) };
    },
    snapshot() { rollover(); return Object.fromEntries(used); },
  };
}

/**
 * 生物钟：现在该不该醒。
 * @param {object} input { windows:[{start,end,videosPerWake}], maxPerDay, countToday, skipProbability, rng, now }
 */
export function planNight({
  windows = [],
  maxPerDay = 3,
  countToday = 0,
  skipProbability = 0.2,
  rng = Math.random,
  now = () => Date.now(),
} = {}) {
  if (countToday >= maxPerDay) return { wake: false, reason: 'daily-cap', hint: `今天已经醒过 ${countToday} 次（上限 ${maxPerDay}）` };
  const d = new Date(now());
  const win = windows.find((w) => biliInWindow(d, w?.start, w?.end));
  if (!win) return { wake: false, reason: 'not-in-window', hint: '不在作息窗口里' };
  if (rng() < Number(skipProbability)) return { wake: false, reason: 'skip-random', hint: '这次随机跳过（免得看起来像定时机器人）' };
  return { wake: true, reason: 'in-window', window: win, videosPerWake: Math.max(1, Number(win.videosPerWake) || 1) };
}

/**
 * 选片：去重优先，其次偏好标签，最后按热度。
 * @param {object} input { candidates:[{id,title,tags,heat}], seenIds, prefs, limit }
 */
export function pickVideos({ candidates = [], seenIds = [], prefs = [], limit = 1 } = {}) {
  const seen = new Set((seenIds ?? []).map(String));
  const prefSet = new Set((prefs ?? []).map(String));

  const scored = candidates
    .filter((c) => c && c.id)
    .map((c) => {
      const isSeen = seen.has(String(c.id));
      const tagHit = Array.isArray(c.tags) ? c.tags.filter((t) => prefSet.has(String(t))).length : 0;
      const score = (isSeen ? -100 : 0) + tagHit * 3 + (Number(c.heat) || 0) / 100;
      return { ...c, _score: score, _seen: isSeen };
    })
    .sort((a, b) => b._score - a._score);

  const n = Number.isFinite(Number(limit)) ? Math.max(0, Math.floor(Number(limit))) : 1;
  return scored.slice(0, n);
}
