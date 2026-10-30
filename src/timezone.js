// timezone.js — 自定义时区（覆盖系统时区）
//
// 为什么需要：很多云服务器的系统时区是错的，甚至是默认 UTC。SurfCore 的安静时段、
// 每日额度的「几点换天」、B站作息窗口、问候/分享的定点时间……全是按「本地时钟」算的，
// 系统时区不对，这些就全错位了。
//
// 配置：config.json 的 `timezone`（IANA 名，如 "Asia/Shanghai"；也接受 "UTC+8" / "GMT-5"
// 这种整点偏移）。留空 = 用系统时区（旧行为，完全不变）。环境变量 SURFCORE_TIMEZONE 优先于文件。
//
// 怎么生效（两层，别混）：
//   1. 自己拥有的进程（桥接、B站工具、MCP）：启动时 applyProcessTimeZone() 把 process.env.TZ
//      设成配置值。此后这些进程里所有 `new Date().getHours()` 之类的本地时间调用自动按该时区算。
//   2. DSH 宿主进程（插件跑在里面，不是我们的）：**不能**常驻改它的 TZ，会影响宿主和别的插件。
//      所以涉及「本地时钟」的函数用 withConfiguredTimeZone(() => …) 包住：同步地临时切 TZ、
//      算完立刻还原。JS 单线程，同步块里不会被别的代码打断，所以临时切换是安全的。
//      进程层已经是该时区时，它直接执行 fn，没有任何开销。
//
// 注意：fn 必须是同步函数（里面不能 await）；Date 对象只在块内用，别带出去再 getHours()。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let CONFIG_FILE = path.join(ROOT, 'config.json');

/** 测试用：换一个 config 文件路径（不碰用户真实的 config.json）。 */
export function _setConfigFileForTest(file) {
  CONFIG_FILE = file || path.join(ROOT, 'config.json');
  resetTimeZoneCache();
}

/** 进程启动时的系统时区（IANA 名）。还原 TZ 时必须显式设回它：delete process.env.TZ 不会让 V8 重读系统时区。 */
export const SYSTEM_TIME_ZONE = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
})();

/**
 * 校验并规范化一个时区输入。
 * @returns {{ ok: true, zone: string } | { ok: false, error: string, hint: string }}
 *   zone === '' 表示「用系统时区」。
 */
export function normalizeTimeZone(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: true, zone: '' };

  // "UTC+8" / "GMT-5" / "UTC+08:00"（整点）→ Etc/GMT∓N（POSIX 符号与直觉相反，这里统一翻过来）
  const offset = /^(?:UTC|GMT)\s*([+-])\s*(\d{1,2})(?::?00)?$/i.exec(raw);
  if (offset) {
    const hours = Number(offset[2]);
    const sign = offset[1] === '+' ? '-' : '+';
    const name = hours === 0 ? 'UTC' : `Etc/GMT${sign}${hours}`;
    if (hours <= 14 && isKnownZone(name)) return { ok: true, zone: name };
    return { ok: false, error: `时区偏移超出范围：${raw}`, hint: '偏移要在 UTC-12 到 UTC+14 之间；或直接填 IANA 名，例如 Asia/Shanghai。' };
  }

  if (isKnownZone(raw)) {
    // Intl 会把大小写规范成标准写法（asia/shanghai → Asia/Shanghai）
    return { ok: true, zone: new Intl.DateTimeFormat('en-US', { timeZone: raw }).resolvedOptions().timeZone };
  }
  return {
    ok: false,
    error: `不认识的时区：${raw}`,
    hint: '请填 IANA 时区名（例如 Asia/Shanghai、America/New_York、Europe/London、UTC），或 UTC+8 这样的整点偏移。半小时偏移的地区请用 IANA 名（例如 Asia/Kolkata）。',
  };
}

function isKnownZone(name) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: name }); return true; } catch { return false; }
}

let fileCache = { at: 0, mtimeMs: -1, value: '' };

function readConfigFileTimeZone() {
  const now = Date.now();
  if (now - fileCache.at < 1000) return fileCache.value;   // 1 秒内不重复碰磁盘
  fileCache.at = now;
  try {
    const stat = fs.statSync(CONFIG_FILE);
    if (stat.mtimeMs !== fileCache.mtimeMs) {
      let text = fs.readFileSync(CONFIG_FILE, 'utf8');
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      const parsed = JSON.parse(text);
      fileCache.value = typeof parsed?.timezone === 'string' ? parsed.timezone : '';
      fileCache.mtimeMs = stat.mtimeMs;
    }
  } catch {
    fileCache.value = '';
    fileCache.mtimeMs = -1;
  }
  return fileCache.value;
}

/** 测试用：丢掉文件缓存。 */
export function resetTimeZoneCache() {
  fileCache = { at: 0, mtimeMs: -1, value: '' };
}

/**
 * 当前生效的配置时区。
 * @returns {{ zone: string, source: 'env'|'config'|'system', error?: string, raw?: string }}
 *   zone === '' 表示用系统时区；配置值非法时回退系统时区并带 error（不抛，调度器不能因为配置写错就崩）。
 */
export function configuredTimeZone() {
  const fromEnv = String(process.env.SURFCORE_TIMEZONE ?? '').trim();
  const candidates = fromEnv
    ? [['env', fromEnv]]
    : [['config', readConfigFileTimeZone()]];
  for (const [source, raw] of candidates) {
    if (!String(raw).trim()) continue;
    const r = normalizeTimeZone(raw);
    if (r.ok && r.zone) return { zone: r.zone, source };
    if (!r.ok) return { zone: '', source: 'system', error: r.error, raw: String(raw) };
  }
  return { zone: '', source: 'system' };
}

let processZone = '';   // 本进程已常驻应用的时区（'' = 没应用，用系统的）

// 启动时环境里本来有没有 TZ（用户可能自己设了）：清空配置时要还原成「原来的样子」，而不是一律删掉。
const ORIGINAL_TZ_ENV = Object.prototype.hasOwnProperty.call(process.env, 'TZ') ? process.env.TZ : undefined;

function restoreOriginalTzEnv() {
  if (ORIGINAL_TZ_ENV !== undefined) {
    process.env.TZ = ORIGINAL_TZ_ENV;
  } else {
    process.env.TZ = SYSTEM_TIME_ZONE;   // 先显式设回系统时区（这一步才会让 V8 重算），再删变量
    delete process.env.TZ;
  }
}

function setProcessTz(zone) {
  process.env.TZ = zone;
}

/**
 * 同步地在指定时区下执行 fn，结束后还原。可嵌套。fn 里不要 await。
 * zone 为空 = 系统时区（当前进程层的时区）。
 */
export function withTimeZone(zone, fn) {
  const target = zone || SYSTEM_TIME_ZONE;
  const had = Object.prototype.hasOwnProperty.call(process.env, 'TZ');
  const previous = process.env.TZ;
  if (had ? previous === target : target === SYSTEM_TIME_ZONE) return fn();
  setProcessTz(target);
  try {
    return fn();
  } finally {
    if (had) {
      setProcessTz(previous);
    } else {
      // 先显式设回系统时区（这一步才会让 V8 重新计算），再把变量删掉，保持环境和原来一样。
      setProcessTz(SYSTEM_TIME_ZONE);
      delete process.env.TZ;
    }
  }
}

/** 在「配置的时区」下执行 fn；没配置 = 系统时区；进程层已经是目标时区时零开销直接执行。 */
export function withConfiguredTimeZone(fn) {
  const { zone } = configuredTimeZone();
  const target = zone || '';
  if (target === processZone) return fn();
  return withTimeZone(target, fn);
}

/**
 * 给自己拥有的进程用：把配置的时区常驻应用到 process.env.TZ。
 * 配置变化后再调一次即可（比如桥接每分钟调一次，改了设置不用重启）。
 * @returns {{ zone: string, source: string, changed: boolean, error?: string }}
 */
export function applyProcessTimeZone() {
  const cfg = configuredTimeZone();
  const next = cfg.zone;
  const changed = next !== processZone;
  if (changed) {
    if (next) {
      setProcessTz(next);
    } else {
      restoreOriginalTzEnv();   // 清空配置：回到系统时区
    }
    processZone = next;
  }
  return { ...cfg, changed };
}

/** 本进程当前常驻应用的时区（'' = 系统）。 */
export function appliedProcessTimeZone() {
  return processZone;
}

/** 起子进程时合并进 env：让子进程和我们用同一个时区。没配置就什么都不加。 */
export function timeZoneEnv() {
  const { zone } = configuredTimeZone();
  return zone ? { TZ: zone } : {};
}

function pad2(n) { return String(n).padStart(2, '0'); }

/** 某时区在 at 这一刻的墙上时钟，格式 YYYY-MM-DD HH:mm:ss（不依赖进程 TZ）。 */
export function formatInTimeZone(at, zone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone || SYSTEM_TIME_ZONE, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** 某时区在 at 这一刻相对 UTC 的偏移（分钟）。 */
export function offsetMinutes(at, zone) {
  const wall = formatInTimeZone(at, zone);
  const [d, t] = wall.split(' ');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi, s] = t.split(':').map(Number);
  const asUtc = Date.UTC(y, mo - 1, da, h, mi, s);
  return Math.round((asUtc - Math.floor(at / 1000) * 1000) / 60000);
}

export function offsetLabel(minutes) {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `UTC${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/**
 * 给设置页看的说明：系统时区、生效时区、各自此刻的时间，让人一眼看出「服务器时区是不是错的」。
 */
export function describeTimeZone(at = Date.now()) {
  const cfg = configuredTimeZone();
  const effective = cfg.zone || SYSTEM_TIME_ZONE;
  return {
    configured: cfg.zone,
    source: cfg.source,
    error: cfg.error ?? '',
    system: { zone: SYSTEM_TIME_ZONE, offset: offsetLabel(offsetMinutes(at, SYSTEM_TIME_ZONE)), now: formatInTimeZone(at, SYSTEM_TIME_ZONE) },
    effective: { zone: effective, offset: offsetLabel(offsetMinutes(at, effective)), now: formatInTimeZone(at, effective) },
  };
}
