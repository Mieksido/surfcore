// brain-decay.js · 「这条记忆接下来一年会怎么淡」的只读投影（星图的时间推演用）
//
// 为什么单独一个文件：星图要画 R 曲线，而 R/S/D 这套算在 src/memory-strength.js 里
// （移植计划第 3 件：FSRS 形状的强度分）。这个文件负责把强度分接到「记忆卡记录」上，
// 并提供星图认识的那几个名词：清晰度档、保真度、冻结线、ltm: 编号。
//
// 只读：不改卡、不写盘、不联网。调用方给记录，这里只算数——所以它可以在测试里直接跑。
import { CLARITY_LABEL, CLARITY_ORDER } from './memory-card.js';
import { CLARITY_RETRIEVABILITY, protectedRecord, retrievabilityInDays, strengthOf } from './memory-strength.js';

/** 清晰度档 → 保真度。数值只用于画曲线和比较，不代表真实概率；在强度模型里它是「卡面承认的上界」。 */
export const R_OF_CLARITY = CLARITY_RETRIEVABILITY;

/** 冻结线：R 跌破它就算「想不起来了」（fuzzy 之下）。 */
export const FREEZE_BELOW = 0.5;

/** 星图里的记忆节点编号前缀。全量档的 id 直接跟在后面（ltm:mem_xxx）。 */
export const UNIT_PREFIX = 'ltm:';

const DAY_CAP = 365;

export { protectedRecord };

export function clarityOf(record) {
  const c = record?.clarity;
  return CLARITY_ORDER.includes(c) ? c : 'clear';
}

export function fidelityOf(clarity) {
  const r = R_OF_CLARITY[clarity];
  return typeof r === 'number' ? r : R_OF_CLARITY.clear;
}

export function clarityLabelOf(clarity) {
  return CLARITY_LABEL[clarity] ?? String(clarity ?? '');
}

export function memoryUnitId(id) {
  const s = String(id ?? '');
  return s ? `${UNIT_PREFIX}${s}` : '';
}

/** ltm:mem_xxx → mem_xxx；不是记忆单元就返回 null。 */
export function recordIdOfUnit(unit) {
  const s = String(unit ?? '');
  if (!s.startsWith(UNIT_PREFIX)) return null;
  const id = s.slice(UNIT_PREFIX.length);
  return /^[A-Za-z0-9:_.\-]{1,80}$/.test(id) ? id : null;
}

/** 卡面档位对应的保真度（不算时间；要「现在有多牢」请用 strengthOf 的 R）。 */
export function recordFidelity(record) {
  return fidelityOf(clarityOf(record));
}

/**
 * 往后推 days 天：这条记忆的 R 会怎么走。
 *
 * 返回 `{ R0, S, D, clarity, clarityLabel, freezeBelow, exempt, frozenAtDay, dueInDays, daysToFreeze, points }`：
 *   · `R0` 现在的可提取性（= `points[0].R`）；
 *   · `S` 稳固度（天，FSRS 的 S；越大越经放）；`D` 难度（1~10，FSRS 的 D）；
 *   · `frozenAtDay` 第几天跌破冻结线（**0 = 现在就在线下**，null = 这一年里不会掉）；
 *   · `exempt` 受保护（钉住 / 最初 / 主人重要）——它们的曲线不掉到线下，`frozenAtDay` 恒为 null；
 *   · `dueInDays` 按预测曲线算的「该再看一眼」，和 `frozenAtDay` 的口径不同（后者看卡面承认到哪一步）。
 */
export function decayCurveFor(record, { now = Date.now(), config = {}, days = DAY_CAP, freezeBelow = FREEZE_BELOW, targetRetention } = {}) {
  const raw = Number(days);
  const total = Number.isFinite(raw) ? Math.max(0, Math.min(DAY_CAP, Math.round(raw))) : DAY_CAP;
  const strength = strengthOf(record, { now, config, freezeBelow, targetRetention });
  const exempt = strength.protected === true;
  const startClarity = clarityOf(record);
  const points = [];
  let frozenAtDay = null;
  for (let d = 0; d <= total; d += 1) {
    const R = Math.round(retrievabilityInDays(strength, d) * 10000) / 10000;
    points.push({ day: d, R });
    if (frozenAtDay === null && !exempt && R < freezeBelow) frozenAtDay = d;
  }
  return {
    ok: true,
    shape: 'fsrs-strength',
    R0: points[0]?.R ?? strength.R,
    S: strength.S,
    D: strength.D,
    label: strength.label,
    observedR: strength.observedR,
    clarity: startClarity,
    clarityLabel: clarityLabelOf(startClarity),
    freezeBelow,
    exempt,
    frozenAtDay,
    dueInDays: strength.dueInDays,
    daysToFreeze: strength.daysToFreeze,
    elapsedDays: strength.elapsedDays,
    reviews: strength.reviews,
    lapses: strength.lapses,
    assumedSpread: strength.assumedSpread,
    points
  };
}
