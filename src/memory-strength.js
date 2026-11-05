// memory-strength.js · 记忆强度分（FSRS 形状的可提取性 R / 稳固度 S / 难度 D）
//
// 这是移植计划的第 3 件。为什么单独一个文件、而且**不改动** memory-card.js 的降档规则：
//
//   · memory-card.js 的 `targetClarity()` 是阶梯模型（重要度 + 年龄 + 复习次数 → 五档清晰度，
//     每天最多降一档）。它是**卡面上写什么**的唯一真相，星图曲线、降档整理都跟着它；
//   · 这里的 S/D/R 是**连续的强度估计**，回答的是另一个问题：「这条记忆现在有多容易被想起来」
//     「它大概还有多少天会跌破冻结线」。同一个「清晰度档」背后的强度可以差很远：
//     一条 vivid 的旧事可能已经在悬崖边，一条 clear 的常用事可能还很稳。
//
// 没有评分序列怎么办（诚实说明）
// ----------------------------
// 真正的 FSRS 需要每次复习的评分（again/hard/good/easy）。SurfCore 的记忆档里没有这个，
// 只有三个**计数与时刻**：`recallCount`（被再次提起 = 复习）、`decaySteps`（降过档 = 遗忘事件）、
// `lastSeenAt`/`createdAt`。所以这里不假装复现 FSRS 的公式，而是：
//
//   1. S / D 的**初值**由字段映射（重要度、kind、tags）得到；
//   2. 用上面的计数按「遗忘事件先把 S 打下来、复习再把 S 打回去」的次序**重放**一遍；
//   3. R 用 FSRS-4.5 的**遗忘曲线形状** `R = (1 + 19/81 · t/S)^(-0.5)`，这条是公开且稳定的；
//   4. 复习/遗忘事件**发生的时刻**我们并不知道，只能假设均匀分布在 createdAt..lastSeenAt 之间。
//      这个假设写进了 `assumedSpread` 字段，别当成事实。
//
// 全程纯函数：不改记录、不写盘、不联网。同一份记录任何时候算出来都一样。
import { DAY_MS, normalizeMemoryCardConfig } from './memory-card.js';

/** FSRS-4.5 的遗忘曲线指数（负值：越大越久 R 越低）。 */
export const FSRS_DECAY = -0.5;
/** FSRS-4.5 的尺度因子 19/81，使 R(t = S) = 0.9。 */
export const FSRS_FACTOR = 19 / 81;
/** 默认目标保留率：到它就「该再看一眼」（FSRS 的默认 desired retention）。 */
export const DEFAULT_TARGET_RETENTION = 0.9;
/** 冻结线：R 跌破它就算「想不起来了」。与星图的 FREEZE_BELOW 同一个数，别各写一套。 */
export const FREEZE_R = 0.5;
/** 稳固度的上下限（天）。3650 天 = 10 年：再牢的事也不必假装比这更牢。 */
export const S_MIN_DAYS = 0.25;
export const S_MAX_DAYS = 3650;
/** 难度区间（FSRS 惯例 1~10，越大越难）。 */
export const D_MIN = 1;
export const D_MAX = 10;
/** 复习一次能把稳固度拉高多少（D=1 时最多 ×1.9，D=10 时 ×1.09）。 */
const REVIEW_GROWTH = 0.9;
/** 遗忘一次的惩罚：稳固度乘这个系数，难度加一档。 */
const LAPSE_SHRINK = 0.45;
const LAPSE_DIFFICULTY_STEP = 0.7;
/** 受保护记忆（钉住 / 最初 / 主人重要）的稳固度加成与下限。 */
const PROTECTED_BOOST = 1.8;

/**
 * 卡面清晰度档 → 可提取性**上界**。
 *
 * 为什么要有这个：曲线只是**预测**，而清晰度是卡面已经承认的事实 ——
 * 一条被降成 forgotten 的记忆，不能因为「它的 lastSeenAt 很近」就报告成 R≈1。
 * 卡面档位低的，取更悲观的那个数（`min`），这条规则也解释了为什么降过档的记忆
 * 会立刻掉到冻结线以下。受保护的记忆不吃这个上界：它们本来就是「不会淡忘」那类。
 *
 * 数值与 `brain-decay.js` 的 `R_OF_CLARITY` 一致（那边是同一个东西的旧名字，保留别名）。
 */
export const CLARITY_RETRIEVABILITY = Object.freeze({ vivid: 1, clear: 0.75, fuzzy: 0.5, trace: 0.25, forgotten: 0.05 });

/** 记录当前卡面档位对应的上界；档位不认识就当没有上界。 */
export function observedRetrievability(record) {
  const r = CLARITY_RETRIEVABILITY[String(record?.clarity ?? '')];
  return typeof r === 'number' ? r : 1;
}


/** kind → 难度修正：越「可复述」的事越容易记牢。 */
const KIND_DIFFICULTY = Object.freeze({
  promise: -0.8,   // 「说好的事」有人反复提，最牢
  fact: -0.5,      // 事实类（名字、偏好）
  place: -0.3,
  emotion: 0.2,    // 情绪类容易变形
  event: 0.3,      // 一次性的经过最难留
});

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

function numberOr(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function timeOr(value, fallback) {
  // 记忆卡里的时刻通常是 ISO 字符串，但别假定：数字毫秒（夹具、老数据、别的写入方）
  // 若走到 Date.parse("1779000000000") 会得到 NaN，于是整条被当成「刚刚提过」，R 直接算成 1。
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : fallback;
  const t = Date.parse(String(value ?? ''));
  return Number.isFinite(t) ? t : fallback;
}

/** 这条记忆是不是受保护的（和 memory-card 的 targetClarity 用同一套判据）。 */
export function protectedRecord(record, config = {}) {
  if (!record) return false;
  if (record.pinned || record.isInitial) return true;
  const cfg = normalizeMemoryCardConfig(config);
  const tags = Array.isArray(record.tags) ? record.tags : [];
  return tags.includes('owner') && numberOr(record.importance) >= cfg.minOwnerImportance;
}

/** FSRS 的可提取性曲线：t 天后还剩多少概率想起。 */
export function retrievability(stabilityDays, elapsedDays) {
  const S = clamp(numberOr(stabilityDays, S_MIN_DAYS), S_MIN_DAYS, S_MAX_DAYS);
  const t = Math.max(0, numberOr(elapsedDays, 0));
  const r = Math.pow(1 + (FSRS_FACTOR * t) / S, FSRS_DECAY);
  return clamp(r, 0, 1);
}

/** 反解曲线：R 掉到 target 需要多少天。target=0.9 时正好等于 S。 */
export function daysUntilRetention(stabilityDays, target = DEFAULT_TARGET_RETENTION) {
  const S = clamp(numberOr(stabilityDays, S_MIN_DAYS), S_MIN_DAYS, S_MAX_DAYS);
  const q = clamp(numberOr(target, DEFAULT_TARGET_RETENTION), 0.01, 0.999);
  const t = (S * (Math.pow(q, 1 / FSRS_DECAY) - 1)) / FSRS_FACTOR;
  return Math.max(0, t);
}

/**
 * 上一条的反解：已经过了 t 天，想要 R 不低于 target，稳固度至少要多少天。
 *
 * 保护类记忆用得上：它们的「掉不下去」应该落在**稳固度**上，而不是事后把算出来的
 * R 抬一手 —— 只抬 R 不同步抬 S，就会出现「R 显示 0.6，但距冻结线 0 天」这种自相矛盾。
 */
export function stabilityForRetention(elapsedDays, target = DEFAULT_TARGET_RETENTION) {
  const t = Math.max(0, numberOr(elapsedDays, 0));
  const q = clamp(numberOr(target, DEFAULT_TARGET_RETENTION), 0.01, 0.999);
  const denom = Math.pow(q, 1 / FSRS_DECAY) - 1;
  if (!(denom > 0)) return S_MAX_DAYS;
  return clamp((t * FSRS_FACTOR) / denom, S_MIN_DAYS, S_MAX_DAYS);
}

/** 初值难度：重要度越低越难记，kind 再修正一点。 */
export function initialDifficulty(record) {
  const importance = clamp(numberOr(record?.importance), 0, 100);
  let d = 5 + (50 - importance) / 10;
  d += KIND_DIFFICULTY[String(record?.kind ?? '')] ?? 0;
  const tags = Array.isArray(record?.tags) ? record.tags : [];
  if (tags.includes('owner')) d -= 1;
  return clamp(d, D_MIN, D_MAX);
}

/** 初值稳固度：重要度线性给 1~14 天，kind 与保护再乘。 */
export function initialStability(record, config = {}) {
  const cfg = normalizeMemoryCardConfig(config);
  const importance = clamp(numberOr(record?.importance), 0, 100);
  let s = 1 + (importance / 100) * 13;
  const kind = String(record?.kind ?? '');
  if (kind === 'promise') s *= 1.5;
  else if (kind === 'fact') s *= 1.2;
  const tags = Array.isArray(record?.tags) ? record.tags : [];
  if (tags.includes('owner') && numberOr(record?.importance) >= cfg.minOwnerImportance) s *= 2;
  if (record?.pinned || record?.isInitial) s *= 2;
  return clamp(s, S_MIN_DAYS, S_MAX_DAYS);
}

/**
 * 重放这条记忆的复习历史，得到现在的 S / D。
 *
 * 次序（重要，别改）：先把 `decaySteps` 次遗忘事件打上去，再按 `recallCount` 次复习长回来。
 * 理由是记录里最后一次「被提起」一定晚于最后一次降档 —— 降档之后被重新提起才会刷新
 * `lastSeenAt`，所以「先遗忘、后复习」是唯一和字段自洽的次序。
 */
export function replayHistory(record, config = {}) {
  const protectedNow = protectedRecord(record, config);
  let S = initialStability(record, config);
  let D = initialDifficulty(record);
  const lapses = clamp(Math.round(numberOr(record?.decaySteps)), 0, 200);
  const reviews = clamp(Math.round(numberOr(record?.recallCount)), 0, 200);
  for (let i = 0; i < lapses; i += 1) {
    S = clamp(S * LAPSE_SHRINK, S_MIN_DAYS, S_MAX_DAYS);
    D = clamp(D + LAPSE_DIFFICULTY_STEP, D_MIN, D_MAX);
  }
  for (let i = 0; i < reviews; i += 1) {
    S = clamp(S * (1 + (REVIEW_GROWTH * (D_MAX + 1 - D)) / D_MAX), S_MIN_DAYS, S_MAX_DAYS);
  }
  if (protectedNow) {
    S = clamp(S * PROTECTED_BOOST, S_MIN_DAYS, S_MAX_DAYS);
    D = clamp(D - 1, D_MIN, D_MAX);
  }
  return { S, D, reviews, lapses, protected: protectedNow };
}

/** R 的显示档（给人看的，不参与任何数学）。 */
export function strengthLabel(R) {
  const r = clamp(numberOr(R), 0, 1);
  if (r >= 0.9) return '牢';
  if (r >= 0.75) return '稳';
  if (r >= 0.6) return '松';
  if (r >= FREEZE_R) return '摇';
  return '将忘';
}

/**
 * 现在的强度分。
 *
 * 返回 `{ R, S, D, label, elapsedDays, reviews, lapses, protected, dueInDays, daysToFreeze, assumedSpread }`：
 *   · `R` 现在的可提取性（0~1）；`S` 稳固度（天，R(t=S)=0.9）；`D` 难度（1~10）；
 *   · `dueInDays` 距离「该再看一眼」（默认 0.9）还有几天；已经过了就报 0（不是负数——
 *     调用方拿它当日程用时，0 和 -12 表达的是同一件事「现在就该看一眼」，多一个负数态只会多一种分支）；
 *   · `daysToFreeze` 距离跌破冻结线还有几天；
 *   · `assumedSpread`：复习/遗忘事件的时刻是**均匀假设**出来的，不是记录里的事实。
 */
export function strengthOf(record, { now = Date.now(), config = {}, targetRetention = DEFAULT_TARGET_RETENTION, freezeBelow = FREEZE_R } = {}) {
  const nowMs = numberOr(now, Date.now());
  const createdAt = timeOr(record?.createdAt, nowMs);
  const lastSeenAt = timeOr(record?.lastSeenAt, createdAt);
  const { S, D, reviews, lapses, protected: isProtected } = replayHistory(record, config);
  const elapsedDays = Math.max(0, (nowMs - Math.max(createdAt, lastSeenAt)) / DAY_MS);
  const observed = observedRetrievability(record);
  const spread = lapses + reviews > 1;
  if (isProtected) {
    // 受保护的记忆（钉住 / 最初 / 主人重要）**不随时间淡忘** —— 这是 memory-card 的规则
    // （targetClarity 给它们留了底），所以这里也不许把它们算成「快忘了」：
    // R 就报卡面档位，不给「该复习了 / 会冻结」的天数。S 仍然算，只用于显示（且有加成）。
    return {
      R: observed,
      S: Math.round(S * 100) / 100,
      D: Math.round(D * 100) / 100,
      label: strengthLabel(observed),
      observedR: observed,
      elapsedDays: Math.round(elapsedDays * 100) / 100,
      reviews,
      lapses,
      protected: true,
      dueInDays: null,
      daysToFreeze: null,
      assumedSpread: spread,
    };
  }
  const R = Math.round(retrievabilityAt(S, elapsedDays, observed) * 10000) / 10000;
  // 「该再看一眼」和「跌破冻结线」是两件事：
  //   · dueInDays 看**预测**曲线（卡面档位是「已经承认的事实」，不是「什么时候该复习」）；
  //   · daysToFreeze 看**取小后**的 R —— 卡面已经认了「想不起来」，那现在就在线下。
  const dueInDays = Math.max(0, daysUntilRetention(S, targetRetention) - elapsedDays);
  const daysToFreeze = observed < numberOr(freezeBelow, FREEZE_R)
    ? 0
    : Math.max(0, daysUntilRetention(S, freezeBelow) - elapsedDays);
  return {
    R,
    S: Math.round(S * 100) / 100,
    D: Math.round(D * 100) / 100,
    label: strengthLabel(R),
    observedR: observed,
    elapsedDays: Math.round(elapsedDays * 100) / 100,
    reviews,
    lapses,
    protected: false,
    dueInDays: Math.round(dueInDays * 10) / 10,
    daysToFreeze: Math.round(daysToFreeze * 10) / 10,
    assumedSpread: spread,
  };
}

/** 单条曲线取值：预测值，再和卡面承认的上界取小。 */
function retrievabilityAt(stability, elapsedDays, observed) {
  const predicted = retrievability(stability, elapsedDays);
  return Math.min(predicted, numberOr(observed, 1));
}

/**
 * 星图的时间推演：再过 days 天，这条记忆的 R 是多少。
 *
 * 规则和 `strengthOf` 完全一致，所以推演曲线的起点一定等于 `strength.R`：
 *   · 非保护类 = 预测曲线与卡面上界取小（上界没被追平的这段是平台，连续不跳）；
 *   · 受保护类 = 平的一条，就是卡面档位（它们不随时间淡忘）。
 */
export function retrievabilityInDays(strength, days) {
  const s = strength && typeof strength === 'object' ? strength : {};
  const offset = Math.max(0, numberOr(days, 0));
  if (s.protected === true) return numberOr(s.observedR, 1);
  const base = numberOr(s.elapsedDays, 0);
  return retrievabilityAt(numberOr(s.S, S_MIN_DAYS), base + offset, numberOr(s.observedR, 1));
}
