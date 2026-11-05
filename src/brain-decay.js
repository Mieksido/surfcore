// brain-decay.js · 「这条记忆接下来一年会怎么淡」的只读投影（星图的时间推演用）
//
// 为什么单独一个文件：星图要画 R 曲线，但 SurfCore 里没有 FSRS 那套
// （可提取性 R / 稳固度 S / 难度 D）——那是移植计划的第 3 件。这里先用现成的
// 清晰度阶梯反推一条等价曲线：把 vivid/clear/fuzzy/trace/forgotten 映射成保真度
// 1 / 0.75 / 0.5 / 0.25 / 0.05，再按 applyDailyDecay 的真实规则往后推 365 天
// （每天最多朝 targetClarity 移一档，掉了就回不来）。
//
// 只读：不改卡、不写盘、不联网。调用方给记录，这里只算数——所以它可以在测试里直接跑。
import {
  CLARITY_LABEL, CLARITY_ORDER, DAY_MS, normalizeMemoryCardConfig, targetClarity
} from './memory-card.js';

/** 清晰度档 → 保真度。数值只用于画曲线和比较，不代表真实概率。 */
export const R_OF_CLARITY = Object.freeze({ vivid: 1, clear: 0.75, fuzzy: 0.5, trace: 0.25, forgotten: 0.05 });

/** 冻结线：保真度跌破它就算「想不起来了」（fuzzy 之下）。 */
export const FREEZE_BELOW = 0.5;

/** 星图里的记忆节点编号前缀。全量档的 id 直接跟在后面（ltm:mem_xxx）。 */
export const UNIT_PREFIX = 'ltm:';

const DAY_CAP = 365;

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

/**
 * 这条记忆是不是「保底」的：钉住 / 标记为最初 / 主人重要。
 * 与 memory-card.js 的 targetClarity 判据保持一致，否则曲线会和实际降档对不上。
 */
export function protectedRecord(record, config = {}) {
  if (!record) return false;
  if (record.pinned || record.isInitial) return true;
  const cfg = normalizeMemoryCardConfig(config);
  const tags = Array.isArray(record.tags) ? record.tags : [];
  return tags.includes('owner') && (Number(record.importance) || 0) >= cfg.minOwnerImportance;
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

/** 现在的保真度（按记录当前的清晰度档，不看未来）。 */
export function recordFidelity(record) {
  return fidelityOf(clarityOf(record));
}

/**
 * 往后推 days 天，按 applyDailyDecay 的规则模拟清晰度档的移动。
 * 返回 { R0, S, D, clarity, clarityLabel, freezeBelow, exempt, frozenAtDay, points }。
 * S = 保真度跌破冻结线还需要的天数（null = 一年内不会掉）；D 恒为 null（没有 FSRS 的难度维度）。
 */
export function decayCurveFor(record, { now = Date.now(), config = {}, days = DAY_CAP, freezeBelow = FREEZE_BELOW } = {}) {
  const raw = Number(days);
  const total = Number.isFinite(raw) ? Math.max(0, Math.min(DAY_CAP, Math.round(raw))) : DAY_CAP;
  const startClarity = clarityOf(record);
  const exempt = protectedRecord(record, config);
  const cfg = normalizeMemoryCardConfig(config);
  let index = Math.max(0, CLARITY_ORDER.indexOf(startClarity));
  const points = [];
  let frozenAtDay = null;
  for (let d = 0; d <= total; d += 1) {
    const clarity = CLARITY_ORDER[index] ?? 'forgotten';
    const R = fidelityOf(clarity);
    points.push({ day: d, R: Math.round(R * 10000) / 10000 });
    if (frozenAtDay === null && !exempt && R < freezeBelow) frozenAtDay = d;
    // 明天怎么走：目标档由 targetClarity 在「未来那一刻」算出来，我们只朝它挪一档。
    let target;
    try {
      target = targetClarity(record, cfg, now + d * DAY_MS);
    } catch {
      target = clarity;
    }
    const tIndex = CLARITY_ORDER.indexOf(target);
    if (tIndex > index) index += 1;
    else if (tIndex >= 0 && tIndex < index) index -= 1;
  }
  return {
    ok: true,
    R0: fidelityOf(startClarity),
    S: frozenAtDay,
    D: null,
    clarity: startClarity,
    clarityLabel: clarityLabelOf(startClarity),
    freezeBelow,
    exempt,
    frozenAtDay,
    points
  };
}
