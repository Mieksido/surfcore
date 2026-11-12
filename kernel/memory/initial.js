/**
 * 「最初」：哪件事算"我们最初的那件事"
 * ============================================================================
 * 位置：内存模块内部策略（纯函数 + 时间窗）。不改接口。
 *
 * 两条规则（旧代码的行为）：
 *   · 只有**30 天内**的记录才可能是「最初」
 *   · 越靠近"第一次交谈"的记录概率越高（四档：0.9 / 0.55 / 0.3 / 0.03）
 *   · **按记录内容稳定散列**，不是每次随机 —— 否则每次刷新结论都变
 *
 * 改法：窗口与概率在本文件 `DEFAULT_INITIAL`；判定逻辑在 `shouldMarkInitial`。
 */

export const DEFAULT_INITIAL = Object.freeze({
  windowDays: 30,
  bands: [
    { withinDays: 1, p: 0.9 },
    { withinDays: 7, p: 0.55 },
    { withinDays: 14, p: 0.3 },
    { withinDays: 30, p: 0.03 },
  ],
});

/** 稳定散列 → [0,1)：同样的输入永远同样的结果（不随刷新变化） */
export function stableUnit(input) {
  let h = 2166136261;
  for (const ch of String(input ?? '')) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** 按"距第一次多久"取概率 */
export function initialProbability(daysSinceFirst, cfg = DEFAULT_INITIAL) {
  const d = Math.max(0, Number(daysSinceFirst) || 0);
  for (const band of cfg.bands) if (d <= band.withinDays) return band.p;
  return 0;
}

/**
 * 这条记录该不该被标成「最初」。
 * @param {object} record
 * @param {object} ctx { now, firstOwnerAt（她与主人第一次的时间）, cfg }
 */
export function shouldMarkInitial(record = {}, { now = Date.now(), firstOwnerAt = null, cfg = {} } = {}) {
  const conf = { ...DEFAULT_INITIAL, ...cfg };          // 允许只覆盖 windowDays（bands 用默认）
  if (record.initial === true) return false;            // 已经标过
  if (record.to?.owner !== true) return false;          // 只有跟主人有关的才可能
  const at = Number(record.from?.at) || now;
  const firstAt = Number(firstOwnerAt) || at;
  const days = (at - firstAt) / 86400000;
  if (days > conf.windowDays) return false;             // 窗口外：不可能
  const p = initialProbability(days, conf);
  if (p <= 0) return false;
  // 稳定散列：同一条记录每次判定结果一致
  const key = `${record.from?.channel ?? ''}|${record.from?.actor ?? ''}|${at}|${String(record.text ?? '').slice(0, 40)}`;
  return stableUnit(key) < p;
}

/**
 * 自动初次相遇：把"最早一条主人记录"标成初遇（重要度 100、置顶、最初）。
 * 幂等：已经有 firstMeet 的就不动。
 * @returns {object|null} 被标记的记录
 */
export function markFirstMeet(records = []) {
  const list = Array.isArray(records) ? records : [];
  if (list.some((r) => r.firstMeet === true)) return null;
  const owners = list
    .filter((r) => r?.to?.owner === true)
    .sort((a, b) => (Number(a.from?.at) || 0) - (Number(b.from?.at) || 0));
  const first = owners[0];
  if (!first) return null;
  first.firstMeet = true;
  first.initial = true;
  first.pinned = true;
  first.importance = 100;
  return first;
}
