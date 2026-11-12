/**
 * 容量：记不下了就淘汰，但要保护重要的
 * ============================================================================
 * 位置：内存模块内部策略（纯函数）。不改接口。
 *
 * 三条规矩（旧代码的教训）：
 *   · 先丢**最不重要**的，同分再丢最老的
 *   · **保护**：置顶、最初、主人且重要度 ≥65
 *   · 淘汰是"从衰减卡里出去"，全量卡里仍在（不丢原文）
 *
 * 改法：上限进设置（`memory.maxRecords`），淘汰顺序在本文件 `planEviction`。
 */

export const DEFAULT_CAPACITY = Object.freeze({
  maxRecords: 600,
  protectOwnerImportance: 65,
});

/** 这条记录受保护吗 */
export function isProtected(record = {}, cfg = DEFAULT_CAPACITY) {
  if (record.pinned === true) return true;
  if (record.initial === true) return true;
  if (record.to?.owner === true && (Number(record.importance) || 0) >= cfg.protectOwnerImportance) return true;
  return false;
}

/**
 * 算该淘汰谁。
 * @param {Array} records
 * @param {object} opts { maxRecords, cfg }
 * @returns {{keep:Array, evict:Array}}
 */
export function planEviction(records = [], { maxRecords, cfg = DEFAULT_CAPACITY } = {}) {
  const max = Number(maxRecords) > 0 ? Number(maxRecords) : cfg.maxRecords;
  const all = Array.isArray(records) ? records : [];
  if (all.length <= max) return { keep: all.slice(), evict: [] };

  const over = all.length - max;
  // 候选：不保护的；排序 = 重要度低的先，重要度相同则老的先
  const candidates = all
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !isProtected(r, cfg))
    .sort((a, b) => {
      const di = (Number(a.r.importance) || 0) - (Number(b.r.importance) || 0);
      if (di !== 0) return di;
      return (Number(a.r.from?.at) || 0) - (Number(b.r.from?.at) || 0);
    });

  const evictSet = new Set(candidates.slice(0, over).map((x) => x.i));
  const keep = [];
  const evict = [];
  all.forEach((r, i) => (evictSet.has(i) ? evict : keep).push(r));
  return { keep, evict };
}

/**
 * 容量档位（给告警用）：ok / warn80 / warn90 / full。
 * @param {number} count
 * @param {number} maxRecords
 */
export function capacityLevel(count, maxRecords = DEFAULT_CAPACITY.maxRecords) {
  const max = Number(maxRecords) > 0 ? Number(maxRecords) : DEFAULT_CAPACITY.maxRecords;
  const pct = (Number(count) || 0) / max * 100;
  if (pct >= 100) return 'full';
  if (pct >= 90) return 'warn90';
  if (pct >= 80) return 'warn80';
  return 'ok';
}
