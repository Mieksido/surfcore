/**
 * 每日 token 额度：SurfCore 的统一账本口径（2026-10-23 用户定）。
 *
 * 为什么单独一个模块、而不是散在桥接和插件里：
 *   · QQ 桥接要按额度决定「还要不要唤醒」，B站 调度器要决定「还要不要叫醒」，
 *     设置页要展示同一份用量 —— 三处必须用**同一套单位/比例/拦截语义**，
 *     否则会出现「页面显示没到、桥接却说超了」这种互相打脸的现场。
 *   · 额度既可以用人民币填，也可以用 token 数填；两种单位可以同时设。
 *     各自独立比较，谁先到 80% 谁触发提醒，谁先到 100% 谁拦截。
 *   · 提醒「每天只有第一次」必须落盘，不能只存在内存：DSH 重启 / 插件热重载
 *     之后同一天不能再弹第二次。
 *
 * 文件都放在 <DSH_HOME>/surfcore/：
 *   token-budget.json        额度（用户可改；设置页写）
 *   token-alert.json         当天已经提醒过的记录（只写一次/天）
 *   token-usage-daily.json   插件侧实时用量快照（QQ 桥接读它做闸门）
 *   token-usage-state.json   插件侧采集状态（逐会话 seen/当日累计；崩溃恢复用）
 *
 * 这个模块只做纯逻辑 + JSON 文件读写，不碰 DSH、不碰网络、不发 QQ。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withConfiguredTimeZone } from './timezone.js';

export const BUDGET_VERSION = 1;
/** 80% 触发提醒；100% 才拦截。 */
export const ALERT_RATIO = 0.8;
export const SCOPES = Object.freeze(['qq', 'bili', 'other', 'total']);
export const CATEGORY_SCOPES = Object.freeze(['qq', 'bili', 'other']);
export const UNIT_KEYS = Object.freeze(['cny', 'tokens']);
export const SCOPE_LABELS = Object.freeze({ qq: 'QQ', bili: 'B站', other: '其他', total: '总额' });
export const UNIT_LABELS = Object.freeze({ cny: '元', tokens: 'token' });
export const BUDGET_FILES = Object.freeze({
  budget: 'token-budget.json',
  alert: 'token-alert.json',
  daily: 'token-usage-daily.json',
  state: 'token-usage-state.json'
});

/**
 * 默认额度：QQ 沿用 2026-10-23 已上线的 ¥8（近 24h 花费闸迁移为自然日）；
 * B站 / 其他 / 总额默认不限，等用户在设置页自己开。
 */
export const DEFAULT_LIMITS = Object.freeze({
  qq: Object.freeze({ cny: 8, tokens: null }),
  bili: Object.freeze({ cny: null, tokens: null }),
  other: Object.freeze({ cny: null, tokens: null }),
  total: Object.freeze({ cny: null, tokens: null })
});

const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/** 把金额收敛到 4 位小数；0 / 负数 / 非数字 = 不限（null）。 */
function normalizeCny(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 10000) / 10000;
}

/** token 数必须是正整数；0 / 负数 / 非数字 = 不限（null）。 */
function normalizeTokenCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

/**
 * 解析人民币输入：`¥8` / `￥8.5` / `8元` / `8 CNY` 都行。
 * 空串 = 不限（null）；无法解析返回 undefined，调用方据此报错。
 */
export function parseCnyText(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const cleaned = raw
    .replace(/[¥￥]/g, '')
    .replace(/(?:人民币|元|块|CNY|cny)/gi, '')
    .replace(/[,\s，]/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return undefined;
  const n = Number(cleaned);
  return normalizeCny(n);
}

/**
 * 解析 token 输入：`8000000` / `8M` / `8m` / `8,000,000` / `2万` / `1.5亿` 都行。
 * 空串 = 不限（null）；无法解析返回 undefined。
 */
export function parseTokenText(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const cleaned = raw
    .replace(/(?:tokens?|个)/gi, '')
    .replace(/[,\s，]/g, '')
    .toLowerCase();
  const match = cleaned.match(/^(\d+(?:\.\d+)?)(k|m|b|万|亿)?$/);
  if (!match) return undefined;
  const base = Number(match[1]);
  const unit = match[2] ?? '';
  const multiplier = unit === 'k' ? 1e3
    : unit === 'm' ? 1e6
      : unit === 'b' ? 1e9
        : unit === '万' ? 1e4
          : unit === '亿' ? 1e8
            : 1;
  const n = base * multiplier;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** 把一个额度项归一化成 `{cny, tokens}`；接受数字、字符串、`{value,unit}`。 */
export function normalizeLimitPair(input) {
  if (input == null) return { cny: null, tokens: null };
  if (typeof input === 'number' || typeof input === 'string') {
    // 裸数字/裸字符串默认按人民币解释（历史配置 maxDailyCostCNY 的语义）。
    return { cny: parseCnyValue(input), tokens: null };
  }
  if (!isPlainObject(input)) return { cny: null, tokens: null };
  // `{value:'8', unit:'cny'}` 这种单值形态。
  if (Object.hasOwn(input, 'value') && typeof input.unit === 'string') {
    const unit = input.unit === 'token' || input.unit === 'tokens' ? 'tokens' : 'cny';
    return unit === 'cny'
      ? { cny: parseCnyValue(input.value), tokens: null }
      : { cny: null, tokens: parseTokenValue(input.value) };
  }
  return {
    cny: parseCnyValue(input.cny ?? input.yuan ?? input.CNY),
    tokens: parseTokenValue(input.tokens ?? input.token ?? input.Tokens)
  };
}

/** 字符串必须能解析，否则抛错；坏额度绝不能静默变成「不限」。 */
function parseCnyValue(value) {
  if (typeof value === 'string') {
    const parsed = parseCnyText(value);
    if (parsed === undefined) throw new Error(`无法识别人民币额度：${value}`);
    return parsed;
  }
  return normalizeCny(value);
}

function parseTokenValue(value) {
  if (typeof value === 'string') {
    const parsed = parseTokenText(value);
    if (parsed === undefined) throw new Error(`无法识别 token 额度：${value}`);
    return parsed;
  }
  return normalizeTokenCount(value);
}

/** 归一化整份额度；缺的 scope 用 fallback 补，避免旧文件把 B站 误变成 0=不限。 */
export function normalizeLimits(input, fallback = DEFAULT_LIMITS) {
  const source = isPlainObject(input) ? (isPlainObject(input.limits) ? input.limits : input) : {};
  const base = isPlainObject(fallback) ? fallback : DEFAULT_LIMITS;
  const out = {};
  for (const scope of SCOPES) {
    out[scope] = normalizeLimitPair(source[scope] ?? base[scope] ?? null);
  }
  return out;
}

/** 空用量（四类都带 cost/tokens），避免调用方各自拼 0。 */
export function zeroUsage() {
  return normalizeUsage(null);
}

/** 归一化一个 `{cost, tokens}` 用量项；兼容 `{cost, totalTokens}`。 */
export function normalizeUsagePair(input) {
  const cost = Number(input?.cost ?? input?.cny);
  const tokens = Number(input?.tokens ?? input?.totalTokens);
  return {
    cost: Number.isFinite(cost) && cost > 0 ? cost : 0,
    tokens: Number.isFinite(tokens) && tokens > 0 ? Math.round(tokens) : 0
  };
}

/** 三类之和 = 总额。 */
export function totalsOf(usage) {
  const qq = normalizeUsagePair(usage?.qq);
  const bili = normalizeUsagePair(usage?.bili);
  const other = normalizeUsagePair(usage?.other);
  return {
    cost: qq.cost + bili.cost + other.cost,
    tokens: qq.tokens + bili.tokens + other.tokens
  };
}

/** 统一成 `{qq,bili,other,total}`（每个都带 cost/tokens）。 */
export function normalizeUsage(input) {
  const out = {};
  for (const scope of CATEGORY_SCOPES) out[scope] = normalizeUsagePair(input?.[scope]);
  out.total = totalsOf(out);
  return out;
}

export function localDayStart(now = Date.now()) {
  return withConfiguredTimeZone(() => {
    const d = new Date(Number(now));
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  });
}

/** 本地日历日 key（YYYY-MM-DD）。额度按用户所在时区的自然日重置。 */
export function localDayKey(now = Date.now()) {
  return withConfiguredTimeZone(() => {
    const d = new Date(Number(now));
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${month}-${day}`;
  });
}

/** SurfCore 共享状态目录（默认 ~/.dsh/surfcore，可用 DSH_HOME 覆盖）。 */
export function surfcoreDir(env = process.env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  const dshHome = env.DSH_HOME || path.join(home, '.dsh');
  return path.join(dshHome, 'surfcore');
}

function readJsonFile(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(16).slice(2, 10)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function budgetFileOf(dir) { return path.join(dir, BUDGET_FILES.budget); }
export function alertFileOf(dir) { return path.join(dir, BUDGET_FILES.alert); }
export function dailyFileOf(dir) { return path.join(dir, BUDGET_FILES.daily); }
export function stateFileOf(dir) { return path.join(dir, BUDGET_FILES.state); }

/**
 * 读额度。文件不存在时返回默认值（QQ ¥8），这样升级上来行为不变；
 * 文件存在但坏掉时也回默认值，不让一个坏 JSON 把闸门变成「不限」。
 */
export function readBudget(dir, fallback = DEFAULT_LIMITS) {
  const file = budgetFileOf(dir);
  const parsed = readJsonFile(file, null);
  if (!isPlainObject(parsed)) return normalizeLimits(fallback, DEFAULT_LIMITS);
  try {
    return normalizeLimits(parsed, fallback);
  } catch {
    // 文件里写了无法解析的额度（手工编辑/旧版本）：回落默认 QQ ¥8，
    // 不能把这条坏数据当成「不限」——否则额度闸会静默消失。
    return normalizeLimits(fallback, DEFAULT_LIMITS);
  }
}

/** 写额度（保留版本与更新时间；调用方负责写前备份）。 */
export function writeBudget(dir, limits, now = Date.now()) {
  const normalized = normalizeLimits(limits, DEFAULT_LIMITS);
  writeJsonAtomic(budgetFileOf(dir), {
    version: BUDGET_VERSION,
    updatedAt: Number(now),
    limits: normalized
  });
  return normalized;
}

/** 读当天用量快照；不是今天的就返回 0（旧文件不能被当成今天继续算）。 */
export function readDailyUsage(dir, day = localDayKey()) {
  const parsed = readJsonFile(dailyFileOf(dir), null);
  if (!isPlainObject(parsed)) {
    return { day, at: 0, ...normalizeUsage(null), source: null, stale: true };
  }
  const sameDay = parsed.day === day;
  const usage = sameDay ? normalizeUsage(parsed) : normalizeUsage(null);
  return {
    ...usage,
    day,
    fileDay: parsed.day ?? null,
    at: Number(parsed.at) || 0,
    source: parsed.source ?? null,
    stale: !sameDay,
    sessions: isPlainObject(parsed.sessions) ? parsed.sessions : {}
  };
}

/** 写当天用量快照；total 永远由三类相加得出，避免调用方漏算。 */
export function writeDailyUsage(dir, usage, { day = localDayKey(), at = Date.now(), source = 'surfcore-plugin', sessions } = {}) {
  const normalized = normalizeUsage(usage);
  const record = {
    day,
    at: Number(at),
    source,
    qq: normalized.qq,
    bili: normalized.bili,
    other: normalized.other,
    total: normalized.total,
    sessions: isPlainObject(sessions) ? sessions : {}
  };
  writeJsonAtomic(dailyFileOf(dir), record);
  return record;
}

/** 单价比例；limit 为空/0 返回 null（不限）。 */
export function ratioOf(used, limit) {
  const l = Number(limit);
  if (!Number.isFinite(l) || l <= 0) return null;
  const u = Number(used);
  return (Number.isFinite(u) && u > 0 ? u : 0) / l;
}

export function limitRatios(used, limit) {
  return {
    cny: ratioOf(used?.cost, limit?.cny),
    tokens: ratioOf(used?.tokens, limit?.tokens)
  };
}

export function allRatios(usage, limits) {
  const normalized = normalizeUsage(usage);
  const out = {};
  for (const scope of SCOPES) {
    out[scope] = limitRatios(normalized[scope], limits?.[scope]);
  }
  return out;
}

function groupThousands(value) {
  const n = Math.max(0, Math.round(Number(value) || 0));
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatCny(value) {
  return formatMoney(value);
}

/** 更稳的金额格式（两位小数，千分位）。 */
export function formatMoney(value) {
  const n = Math.max(0, Number(value) || 0);
  const fixed = n.toFixed(2);
  const [int, dec] = fixed.split('.');
  return `¥${groupThousands(Number(int))}.${dec}`;
}

export function formatTokens(value) {
  return groupThousands(value);
}

export function formatLimit(limit, unit) {
  if (!Number.isFinite(Number(limit)) || Number(limit) <= 0) return '不限';
  return unit === 'cny' ? formatMoney(limit) : `${formatTokens(limit)} token`;
}

export function formatUsed(used, unit) {
  return unit === 'cny' ? formatMoney(used) : `${formatTokens(used)} token`;
}

/**
 * 收集达到阈值的额度项。
 * @param {object} usage   normalizeUsage 的结果
 * @param {object} limits  normalizeLimits 的结果
 * @param {{threshold?:number, scopes?:string[]}} [opts]
 * @returns {Array<{scope,scopeLabel,unit,unitLabel,used,limit,ratio,kind}>}
 */
export function collectHits(usage, limits, { threshold = 1, scopes = SCOPES } = {}) {
  const normalized = normalizeUsage(usage);
  const out = [];
  for (const scope of SCOPES) {
    if (!scopes.includes(scope)) continue;
    const usedPair = normalized[scope];
    const limitPair = normalizeLimitPair(limits?.[scope]);
    for (const unit of UNIT_KEYS) {
      const limit = limitPair[unit];
      if (!Number.isFinite(limit) || limit <= 0) continue;
      const used = unit === 'cny' ? usedPair.cost : usedPair.tokens;
      const ratio = ratioOf(used, limit);
      if (ratio != null && ratio >= threshold) {
        out.push({
          scope,
          scopeLabel: SCOPE_LABELS[scope] ?? scope,
          unit,
          unitLabel: UNIT_LABELS[unit] ?? unit,
          used,
          limit,
          ratio,
          threshold
        });
      }
    }
  }
  out.sort((a, b) => b.ratio - a.ratio || SCOPES.indexOf(a.scope) - SCOPES.indexOf(b.scope) || UNIT_KEYS.indexOf(a.unit) - UNIT_KEYS.indexOf(b.unit));
  return out;
}

/**
 * 闸门判定：达到 100% 即拦截。
 * @returns {{blocked:boolean, hits:Array, scopes:Record<string,boolean>}}
 */
export function evaluateBudget(usage, limits, { scopes = SCOPES } = {}) {
  const hits = collectHits(usage, limits, { threshold: 1, scopes });
  const scopesOut = {};
  for (const scope of scopes) scopesOut[scope] = hits.some((hit) => hit.scope === scope);
  return { blocked: hits.length > 0, hits, scopes: scopesOut };
}

/** 80% 提醒项（不写盘；写盘由 takeAlert 负责）。 */
export function collectAlerts(usage, limits) {
  return collectHits(usage, limits, { threshold: ALERT_RATIO, scopes: SCOPES });
}

export function describeHit(hit) {
  const scope = hit.scopeLabel ?? SCOPE_LABELS[hit.scope] ?? hit.scope;
  const used = formatUsed(hit.used, hit.unit);
  const limit = formatLimit(hit.limit, hit.unit);
  const percent = (Number(hit.ratio) * 100).toFixed(1);
  return `${scope}：${used} / ${limit}（${percent}%）`;
}

export function describeHits(hits, separator = '；') {
  return (Array.isArray(hits) ? hits : []).map(describeHit).join(separator);
}

export function readAlert(dir) {
  const parsed = readJsonFile(alertFileOf(dir), null);
  if (!isPlainObject(parsed) || typeof parsed.day !== 'string') return null;
  return {
    day: parsed.day,
    at: Number(parsed.at) || 0,
    items: Array.isArray(parsed.items) ? parsed.items : [],
    limits: isPlainObject(parsed.limits) ? parsed.limits : null
  };
}

export function writeAlert(dir, record) {
  writeJsonAtomic(alertFileOf(dir), {
    day: String(record?.day ?? localDayKey()),
    at: Number(record?.at) || Date.now(),
    items: Array.isArray(record?.items) ? record.items : [],
    limits: isPlainObject(record?.limits) ? record.limits : null
  });
}

/**
 * 取当天的「第一次 80% 提醒」。同一天第二次开始永远返回 null。
 * 这里在**返回时**就落盘，而不是等用户点「知道了」：用户关掉页面/DSH 重启
 * 也不能让同一个提醒弹第二遍。
 *
 * @returns {{alert:object|null, existing:object|null}}
 */
export function takeAlert(dir, usage, limits, now = Date.now()) {
  const existing = readAlert(dir);
  const day = localDayKey(now);
  if (existing?.day === day) return { alert: null, existing };
  const items = collectAlerts(usage, limits);
  if (!items.length) return { alert: null, existing };
  const record = { day, at: Number(now), items, limits: normalizeLimits(limits, DEFAULT_LIMITS) };
  writeAlert(dir, record);
  return { alert: record, existing: null };
}

/**
 * 拦截说明（给桥接/调度器/设置页共用）。
 * 例如：`Token 额度：QQ：¥8.00 / ¥8.00（100.0%）；总额：...`
 */
export function blockMessage(hits, prefix = 'Token 额度') {
  const text = describeHits(hits);
  return text ? `${prefix}：${text}` : prefix;
}
