/**
 * 价目表：把 token 用量折成钱（数据 + 纯函数，不含任何网络/凭据）
 * ============================================================================
 * 位置：内核·表达层里的**数据件**。为什么不是内核支撑层：
 * 支撑层（账本）是稳定的抽象——它只说"按这个价格算"；价目表是**易变的数据**，
 * 官方一改价就得动它。稳定的不该依赖易变的（法则 7），所以账本只收一个 `price()`，
 * 这张表由组装层递给它。
 *
 * 口径与旧 model-prices.js 一致：
 *   扣费 = Σ(桶 token × 单价)，单位是"元 / 百万 token"；
 *   高峰 = 北京时间周一至周五 9:00-12:00、14:00-18:00，且不含法定节假日；
 *   空闲 = 其余时段；高峰单价 = 空闲 × peakMultiplier。
 */
import { emptyBuckets, normalizeUsage, totalTokensOf } from '../support/ledger.js';

export const PRICE_TABLE_VERSION = '2026-11-10';

/** 2026 年法定节假日（含调休连休段；周末本身已被"周一至周五"排除） */
export const CN_HOLIDAYS_2026 = Object.freeze([
  '2026-01-01', '2026-01-02', '2026-01-03',
  '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
  '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
  '2026-04-04', '2026-04-05', '2026-04-06',
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
  '2026-06-19', '2026-06-20', '2026-06-21',
  '2026-09-25', '2026-09-26', '2026-09-27',
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
  '2026-10-05', '2026-10-06', '2026-10-07',
]);

/** 2027 年法定节假日（官方公布后按实际日期替换） */
export const CN_HOLIDAYS_2027 = Object.freeze([
  '2027-01-01', '2027-01-02', '2027-01-03',
  '2027-02-05', '2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09',
  '2027-02-10', '2027-02-11', '2027-02-12', '2027-02-13',
  '2027-04-04', '2027-04-05', '2027-04-06',
  '2027-05-01', '2027-05-02', '2027-05-03', '2027-05-04', '2027-05-05',
  '2027-06-09', '2027-06-10', '2027-06-11',
  '2027-09-15', '2027-09-16', '2027-09-17',
  '2027-10-01', '2027-10-02', '2027-10-03', '2027-10-04',
  '2027-10-05', '2027-10-06', '2027-10-07',
]);

export const CN_HOLIDAYS = Object.freeze([...CN_HOLIDAYS_2026, ...CN_HOLIDAYS_2027]);

const BEIJING_OFFSET_MINUTES = 8 * 60;

/** 默认价目表（元 / 百万 token；`off` 是空闲价，高峰 = off × peakMultiplier） */
export const DEFAULT_PRICE_TABLE = Object.freeze({
  version: PRICE_TABLE_VERSION,
  currency: 'CNY',
  symbol: '¥',
  unit: 1e6,
  peakMultiplier: 2,
  peakWindows: Object.freeze([[9, 12], [14, 18]]),
  peakWeekdays: Object.freeze([1, 2, 3, 4, 5]),
  holidays: CN_HOLIDAYS,
  models: Object.freeze({
    'deepseek-flash': Object.freeze({ label: 'DeepSeek-V4.1-Flash', off: Object.freeze({ cacheHit: 0.02, cacheMiss: 1, cacheWrite: 1, output: 4 }) }),
    'deepseek-v4-flash': Object.freeze({ label: 'DeepSeek-V4.1-Flash（旧名）', off: Object.freeze({ cacheHit: 0.02, cacheMiss: 1, cacheWrite: 1, output: 4 }) }),
    'deepseek-v4-pro': Object.freeze({ label: 'DeepSeek-V4-Pro-0813', off: Object.freeze({ cacheHit: 0.15, cacheMiss: 4.5, cacheWrite: 4.5, output: 13.5 }) }),
    'deepseek-pro': Object.freeze({ label: 'DeepSeek-V4-Pro-0813（旧名）', off: Object.freeze({ cacheHit: 0.15, cacheMiss: 4.5, cacheWrite: 4.5, output: 13.5 }) }),
  }),
  fallbackModel: 'deepseek-flash',
});

/** 合并用户覆盖项（设置页/配置文件里的 pricing）；坏值回落到默认 */
export function resolvePriceTable(override) {
  const base = DEFAULT_PRICE_TABLE;
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    return { ...base, models: { ...base.models } };
  }
  const merged = {
    ...base,
    ...override,
    models: { ...base.models },
    peakWindows: Array.isArray(override.peakWindows) ? override.peakWindows.map((w) => [...w]) : base.peakWindows.map((w) => [...w]),
    peakWeekdays: Array.isArray(override.peakWeekdays) ? [...override.peakWeekdays] : [...base.peakWeekdays],
    holidays: Array.isArray(override.holidays) ? [...override.holidays] : [...base.holidays],
  };
  if (override.models && typeof override.models === 'object' && !Array.isArray(override.models)) {
    for (const [name, entry] of Object.entries(override.models)) {
      if (!entry || typeof entry !== 'object') continue;
      const inherited = base.models[name];
      const given = entry.off ?? {};
      const fallbackOff = base.models[base.fallbackModel].off;
      const off = { ...(inherited?.off ?? fallbackOff), ...given };
      // 只有条目自己没写 cacheWrite 时才跟随 cacheMiss，避免继承到不相干的价
      if (!Number.isFinite(Number(given.cacheWrite))) off.cacheWrite = off.cacheMiss;
      merged.models[name] = { label: entry.label ?? inherited?.label ?? name, off };
    }
  }
  if (typeof merged.fallbackModel !== 'string' || !merged.models[merged.fallbackModel]) merged.fallbackModel = base.fallbackModel;
  if (!Number.isFinite(merged.peakMultiplier) || merged.peakMultiplier <= 0) merged.peakMultiplier = base.peakMultiplier;
  if (!Number.isFinite(merged.unit) || merged.unit <= 0) merged.unit = base.unit;
  if (typeof merged.version !== 'string' || !merged.version) merged.version = PRICE_TABLE_VERSION;
  if (typeof merged.currency !== 'string' || !merged.currency) merged.currency = base.currency;
  return merged;
}

/** 北京时间日历分量（不依赖运行机器的本地时区） */
export function beijingParts(atMs) {
  const d = new Date(Number(atMs) + BEIJING_OFFSET_MINUTES * 60000);
  const weekday = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return {
    weekday,
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    date: `${d.getUTCFullYear()}-${month}-${day}`,
    clock: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`,
  };
}

/** 这一时刻是不是高峰 */
export function isPeakAt(atMs, table = DEFAULT_PRICE_TABLE) {
  const ms = Number(atMs);
  if (!Number.isFinite(ms)) return false;
  const { weekday, hour, date } = beijingParts(ms);
  if (!table.peakWeekdays.includes(weekday)) return false;
  const holidays = table.holidays instanceof Set ? table.holidays : new Set(table.holidays ?? []);
  if (holidays.has(date)) return false;
  return (table.peakWindows ?? []).some(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && hour >= start && hour < end);
}

/** 某模型某一时刻生效的单价（含峰谷倍数） */
export function ratesAt(model, atMs, table = DEFAULT_PRICE_TABLE) {
  const key = String(model ?? '').trim();
  const entry = table.models[key];
  const chosen = entry ?? table.models[table.fallbackModel];
  const off = chosen.off;
  const peak = isPeakAt(atMs, table);
  const factor = peak ? table.peakMultiplier : 1;
  return {
    model: key || table.fallbackModel,
    label: chosen.label,
    tier: peak ? 'peak' : 'off',
    tierLabel: peak ? '高峰时段' : '空闲时段',
    currency: table.currency,
    symbol: table.symbol,
    unit: table.unit,
    estimated: !entry,
    cacheHit: off.cacheHit * factor,
    cacheMiss: off.cacheMiss * factor,
    cacheWrite: (Number.isFinite(off.cacheWrite) ? off.cacheWrite : off.cacheMiss) * factor,
    output: off.output * factor,
  };
}

/** 按单价把四个桶折成金额 */
export function costOfBuckets(buckets, rates) {
  const b = buckets ?? emptyBuckets();
  const cacheHit = ((b.cacheHit ?? 0) / rates.unit) * rates.cacheHit;
  const cacheMiss = ((b.cacheMiss ?? 0) / rates.unit) * rates.cacheMiss;
  const cacheWrite = ((b.cacheWrite ?? 0) / rates.unit) * rates.cacheWrite;
  const output = ((b.output ?? 0) / rates.unit) * rates.output;
  return { cacheHit, cacheMiss, cacheWrite, output, total: cacheHit + cacheMiss + cacheWrite + output };
}

/** 一步到位：桶 + 时间 + 模型 → 钱 */
export function priceUsage(buckets, { model, at, table = DEFAULT_PRICE_TABLE } = {}) {
  const rates = ratesAt(model, at, table);
  return { rates, cost: costOfBuckets(buckets, rates) };
}

/** 给账本用的适配器：只返回它需要的几个字段 */
export function ledgerPrice(table = DEFAULT_PRICE_TABLE) {
  return (buckets, { model, at } = {}) => {
    const p = priceUsage(buckets, { model, at, table });
    return { total: p.cost.total, currency: p.rates.currency, tier: p.rates.tier, estimated: p.rates.estimated };
  };
}

/** 只做展示的汇总（控制台/状态命令用） */
export function describePriceTable(table = DEFAULT_PRICE_TABLE) {
  return {
    version: table.version,
    currency: table.currency,
    peakMultiplier: table.peakMultiplier,
    models: Object.keys(table.models),
    fallbackModel: table.fallbackModel,
    unit: table.unit,
  };
}

/** 给"这次用了多少"补上计费总量（转发到支撑层的纯函数，避免两套口径） */
export function billableTokens(usage) {
  return totalTokensOf(normalizeUsage(usage));
}
