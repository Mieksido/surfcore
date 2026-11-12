/**
 * 记忆衰减：清晰度每天最多降一档，被提到升一档
 * ============================================================================
 * 行为来源（旧的 memory-card.js，见 docs/persona-core/MEMORY-KERNEL-SHAPE.md §9）：
 *   ① 五档清晰度，每天**最多降一档**（渐渐模糊，不是一次消失）
 *   ② 被重新提到会**升一档**（复习效应）
 *   ③ 「最初」独立于「重要」：标记为最初的记忆不会被彻底遗忘
 *   ④ 主人重要记忆保底，永不遗忘
 *   ⑤ 最近 N 天保底"清楚"
 *   ⑥ 补跑：关机一周最多补 30 天
 *
 * 铁律：本文件不认识任何渠道（架构法则 11）。
 */

/** 清晰度阶梯：只允许按这个顺序一格一格地变 */
export const CLARITY_ORDER = Object.freeze(['vivid', 'clear', 'fuzzy', 'trace', 'forgotten']);

const DAY = 86400000;

export const DEFAULT_DECAY = Object.freeze({
  recentDays: 7,          // 最近 7 天保底"清楚"
  fuzzyAfterDays: 7,      // 超过 7 天开始变模糊
  forgetAfterDays: 60,    // 超过 60 天且不重要 → 可彻底遗忘
  dailyHour: 4,           // 每天 4 点之后才做日衰减（不是过零点就做）
  minOwnerImportance: 65, // 主人相关且重要度 ≥ 65 → 永不遗忘
});

const dayKey = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** 这条记忆"按人类规律"现在该有多清楚 */
export function targetClarity(record, cfg = DEFAULT_DECAY, now = Date.now()) {
  if (!record) return 'forgotten';
  if (record.pinned) return 'vivid';
  const ageDays = Math.max(0, (now - (record.from?.at ?? now)) / DAY);
  const seenDays = Math.max(0, (now - (record.lastSeenAt ?? record.from?.at ?? now)) / DAY);

  // ③「最初」独立于「重要」
  const protectedInitial = record.initial === true;
  // ④ 主人重要记忆永不遗忘
  const ownerVital = record.to?.owner === true && Number(record.importance) >= cfg.minOwnerImportance;

  if (!protectedInitial && !ownerVital
      && ageDays > cfg.forgetAfterDays && Number(record.importance) < 50) {
    return 'forgotten';
  }

  let retention = Number(record.importance) || 0;
  retention += Math.min(12, (Number(record.recallCount) || 0) * 2);      // 被提到过 = 复习
  if (ageDays <= cfg.recentDays) retention += 18;
  if (seenDays <= 2) retention += 8;
  const penalty = (ownerVital || protectedInitial) ? 0.12 : 0.35;
  retention -= Math.min(80, Math.max(0, ageDays - cfg.fuzzyAfterDays) * penalty);
  if (ownerVital || protectedInitial) retention = Math.max(retention, 55);
  if (ageDays <= cfg.recentDays) retention = Math.max(retention, 50);

  if (retention >= 68) return 'vivid';
  if (retention >= 46) return 'clear';
  if (retention >= 24) return 'fuzzy';
  if (retention >= 12) return 'trace';
  return 'forgotten';
}

/**
 * 每日衰减：每条最多移动一格。返回被遗忘的记录（调用方负责归档）。
 * @param {object} card { records, lastDecayDay, stats }
 */
export function applyDailyDecay(card, cfg = DEFAULT_DECAY, now = Date.now()) {
  const today = dayKey(now);
  if (card.lastDecayDay === today) return { changed: false, forgotten: [] };
  const forgotten = [];
  let changed = false;

  const keep = [];
  for (const record of card.records) {
    const cur = CLARITY_ORDER.includes(record.clarity) ? record.clarity : 'clear';
    const curIdx = CLARITY_ORDER.indexOf(cur);
    const tgtIdx = CLARITY_ORDER.indexOf(targetClarity(record, cfg, now));

    if (tgtIdx > curIdx) {
      const next = CLARITY_ORDER[curIdx + 1];
      if (next === 'forgotten') { forgotten.push(record); changed = true; continue; }
      record.clarity = next;
      record.decaySteps = (Number(record.decaySteps) || 0) + 1;
      changed = true;
    } else if (tgtIdx < curIdx) {
      record.clarity = CLARITY_ORDER[curIdx - 1];   // 复习：一天恢复一档
      changed = true;
    }
    keep.push(record);
  }
  card.records = keep;
  card.lastDecayDay = today;
  if (changed) card.stats.decayed = (Number(card.stats.decayed) || 0) + 1;
  return { changed, forgotten };
}

/** 两次维护之间隔了几天（关机一周要补跑，最多补 30 天） */
export function decayDaysBetween(lastDay, now = Date.now()) {
  if (!lastDay) return 1;
  const from = Date.parse(`${lastDay}T00:00:00`);
  if (!Number.isFinite(from)) return 1;
  return Math.max(1, Math.min(30, Math.floor((now - from) / DAY)));
}

/** 今天该不该做日衰减（到 dailyHour 之后才做） */
export function needsDailyDecay(card, cfg = DEFAULT_DECAY, now = Date.now()) {
  if (card.lastDecayDay === dayKey(now)) return false;
  return new Date(now).getHours() >= cfg.dailyHour;
}

/** 被提到 = 复习 */
export function touch(record, now = Date.now()) {
  if (!record) return record;
  record.lastSeenAt = now;
  record.recallCount = (Number(record.recallCount) || 0) + 1;
  return record;
}

/**
 * 衰减记忆卡（叙事记忆里的两张卡之一，和全量记忆卡同级）。
 * 只负责"会忘的那一份"：入卡、变模糊、被提到时升一档。
 * 全量卡不归它管——它忘了的事，全量卡里还在。
 */
export function createDecayCard({ now = () => Date.now(), initial = [] } = {}) {
  const card = { records: [...initial], lastDecayDay: null, stats: {} };

  return {
    records() { return card.records; },
    add(record) { card.records.push(record); return record; },
    /** 容量淘汰：把这些记录从卡里拿走（全量卡里仍在） */
    removeAll(list = []) {
      const drop = new Set(Array.isArray(list) ? list : []);
      const before = card.records.length;
      card.records = card.records.filter((r) => !drop.has(r));
      return before - card.records.length;
    },
    /** 做一次日衰减：返回 { changed, forgotten }（forgotten 只是"从这张卡里出去"） */
    decay(cfg) { return applyDailyDecay(card, cfg ?? DEFAULT_DECAY, now()); },
    needsDecay(cfg) { return needsDailyDecay(card, cfg ?? DEFAULT_DECAY, now()); },
    touch(record) { return touch(record, now()); },
    restore(list = []) { card.records = Array.isArray(list) ? [...list] : []; card.lastDecayDay = null; },
    snapshot() { return card.records.slice(); },
    get lastDecayDay() { return card.lastDecayDay; },
  };
}
