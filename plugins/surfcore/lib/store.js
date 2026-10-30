/**
 * 统一配置存储层。
 *
 * 设计原则（很重要）：
 *   · **不搬家**：QQ 仍然读 <surfcore>/config.json，B站工具链仍然读
 *     ~/.dsh/surfcore/bili.config.json。合体插件只是把它们装进同一个窗口，
 *     不制造第二份真相。
 *   · **跨域设置**单独放 ~/.dsh/surfcore/config.json（记忆同步、身份对齐、
 *     扩展与平台接入）。
 *   · 每次写入前自动备份；写入是原子的（临时文件 + rename）。
 *   · 读给 UI 的配置会脱敏；保存时 `********` 表示“保持原值”。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  BACKUP_DIR, BILI_CONFIG, DSH_HOME, HOME, PLUGIN_ROOT, QQBOT_ROOT, QQ_CONFIG,
  QQ_CONFIG_EXAMPLE, UNIFIED_FILE, ensureDirs,
} from './paths.js';
import { DEFAULT_BILI_FISH_GUARD, normalizeBiliFishGuard } from '../tools/lib/fish-guard.mjs';
import { DEFAULT_LIMITS, normalizeLimits } from '../tools/lib/limits.mjs';
import { dynamicDefaults, normalizeDynamics } from '../tools/lib/kinds.mjs';
import { DEFAULT_QQ_FISH_GUARD, normalizeQqFishGuard } from '../../../src/fish-guard.js';
import { adminFromSources, normalizeAdmin } from '../../../src/admin-identity.js';
import { DEFAULT_MEMORY_CARD_CONFIG, normalizeMemoryCardConfig } from '../../../src/memory-card.js?rev=20261025-pet-memory2';
import { normalizeCardMode } from '../../../src/share-mode.js';
import { normalizeTimeZone } from '../../../src/timezone.js';

export const MASK = '********';

const BIDI_DEFAULTS = {
  owner: { mid: '', name: '' },
  self: { mid: '', name: '' },
  persona: { name: '', ownerTitle: '主人', selfClaim: '我' },
  night: {
    windows: [{ start: '20:00', end: '24:00', wakes: 1 }],
    skipChance: 0.3,
    maxVideos: 5,
    maxWakesPerDay: 1,
    minGapMin: 20,
  },
  preferences: {
    like: ['DSH/AI 工具与插件', '鬼畜与怀旧向剪辑', '猫咪', 'Live2D/模型', 'B站生态八卦'],
    dislike: ['带货', '擦边', '标题党', '纯搬运'],
    keywords: [],
    // 每个偏好关键词的权重（0~5；0 = 停用，1 = 默认）。没有的键按 1 算。
    // 2026-10-23：用户反馈「只会看某一个偏好」——权重决定 feed 每轮给该词分几条。
    weights: {},
  },
  quota: { shareDaily: 3 },
  // 四本账的硬闸门（2026-10-22 可编辑）：默认值与 tools/lib/limits.mjs 同源。
  limits: { ...DEFAULT_LIMITS },
  // 四类动态（2026-10-22 可编辑）：默认值与 tools/lib/kinds.mjs 的 DEFAULT_KINDS 同源。
  dynamics: dynamicDefaults(),
  diary: { push: true, enabled: true },
  notify: { type: 'none', url: '', template: 'text', cmd: '', args: [] },
  listen: {
    comment: true, commentIntervalSec: 300, scope: 'both', oncePerPerson: false,
    allDay: false, dm: false, dmScope: 'owner', live: false, liveRoom: '', liveScope: 'owner',
  },
  share: { enabled: true, via: 'dynamic', minScore: 13, silentAfterDays: 3, decayPerDay: 1 },
  fishGuard: DEFAULT_BILI_FISH_GUARD,
  toolsPath: '',
};

export const DEFAULT_UNIFIED = {
  version: 1,
  qqbotRoot: QQBOT_ROOT,
  bridge: {
    autoStart: false,
    startupNotify: true,
    consoleBase: 'http://127.0.0.1:3100',
    startScript: 'start.bat',
  },
  persona: {
    // 留空 = 自动取 roles/ 下第一张 .md；新用户不需要改代码，也不需要叫某个固定名字。
    file: '',
    injectInBili: true,
    compactChars: 2200,
  },
  // 管理员身份（QQ ⇄ B站 同一个人）：唯一真相在合体层，保存时投影到
  // QQ config.json 的 ownerQQ 与 B站 bili.config.json 的 owner.mid/name。
  // 默认先留空：升级后 readAll() 会用旧字段推导，不需要用户重填。
  admin: {
    qq: '',
    biliMid: '',
    biliName: '',
    displayName: '',
    gentle: true,
  },
  memory: {
    qqToBili: {
      enabled: false,
      lookbackDays: 7,
      maxMessages: 300,
      maxChars: 6000,
      intervalMs: 1800000,
      includeOwner: false,
      includeAgentReplies: false,
      useNicknames: true,
      includeGroups: [],
    },
    biliToQq: {
      // 真正的开关是 qq.biliBridge.memory.enabled（默认 true，保持原行为）。
      previewOnly: false,
    },
    privacy: {
      blockPrivateMessages: true,
      blockSecrets: true,
      blockPii: true,
      blockContact: true,
      dropUnsafeLines: true,
      audit: true,
      maxAuditEntries: 500,
    },
  },
  alignment: {
    enabled: true,
    priority: 'override-sync',
    injectInQQ: true,
    injectInBili: true,
    autoDetect: true,
    requireApproval: true,
    maxEntries: 200,
  },
  // 记忆卡（角色的长期记忆）：和角色卡分开——角色卡基本不变，记忆卡每天变。
  // 默认值与 src/memory-card.js 的 DEFAULT_MEMORY_CARD_CONFIG 保持同一份，避免两处漂移。
  memoryCard: {
    ...DEFAULT_MEMORY_CARD_CONFIG,
    injectMaxChars: { ...DEFAULT_MEMORY_CARD_CONFIG.injectMaxChars },
  },
  extensions: { enabled: true, disabled: [] },
  platforms: {
    enabled: ['qq', 'bili'],
    planned: ['tieba'],
    // 平台启动开关（2026-10-24 用户要求：不是所有用户都想同时开 QQ 和 B站）。
    // 这是「是否启动」的唯一真相：关掉后插件不会自动拉起该平台，也不会把它带进
    // 「一键启动」；正在跑的那一边由宿主在保存配置时停掉（见 lib/index.js）。
    // QQ 的旧开关 bridge.autoStart 只用于升级迁移，保存时会镜像回这个值。
    start: { qq: true, bili: true },
  },
  ui: { activeTab: 'overview', showAdvanced: false },
  // 组件更新（2026-10-26）：检查 SurfCore 本体 / 语音包 / 桌宠 / 未来登记的扩展。
  // 只做 git 快进；`components` 里可以自己加 `{id,name,dir,branch}` 把别的仓库纳入检查。
  updates: {
    enabled: true,
    checkOnStart: true,
    startDelayMs: 20000,
    intervalMs: 21600000,
    components: [],
    // 构建产物型组件（桌宠）走版本清单：发版时把 version.json 放到 Release 资产里。
    // 默认指向官方 Release 的 latest 直链（无 API 限流）；自建发布源就改这里。
    pet: { versionUrl: 'https://github.com/Mieksido/surfpet/releases/latest/download/version.json' },
    voice: { localVersionUrl: '', cloudVersionUrl: '' },
  },
};

export const SECRET_PATHS = new Set([
  'dsh.authToken',
  'snowluma.accessToken',
  'webSearch.apiKey',
  'consoleToken',
]);

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** 深度合并：对象递归，数组/标量直接替换；拒绝原型污染键。 */
export function deepMerge(base, patch) {
  const out = isPlainObject(base) ? { ...base } : {};
  if (!isPlainObject(patch)) return out;
  for (const [key, value] of Object.entries(patch)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    if (isPlainObject(value)) out[key] = deepMerge(out[key], value);
    else out[key] = clone(value);
  }
  return out;
}

export function getPath(object, parts) {
  let cur = object;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

export function setPath(object, parts, value) {
  let cur = object;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (!isPlainObject(cur[key])) cur[key] = {};
    cur = cur[key];
  }
  cur[parts[parts.length - 1]] = value;
}

export function readJson(file, fallback = null) {
  try {
    let text = fs.readFileSync(file, 'utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function writeTextAtomic(file, text, { mode = 0o600 } = {}) {
  ensureDirs();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, text, { encoding: 'utf8', mode });
    try { fs.chmodSync(tmp, mode); } catch {}
    fs.renameSync(tmp, file);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch {}
    throw error;
  }
}

export function writeJsonAtomic(file, value, options) {
  writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`, options);
}

export function backupFile(file, label) {
  try {
    if (!fs.existsSync(file)) return null;
    ensureDirs();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safe = String(label || path.basename(file)).replace(/[^A-Za-z0-9_.\-\u4e00-\u9fa5]/g, '_');
    const dest = path.join(BACKUP_DIR, `${safe}-${stamp}${path.extname(file) || '.json'}`);
    fs.copyFileSync(file, dest);
    pruneBackups();
    return dest;
  } catch {
    return null;
  }
}

export function pruneBackups(keep = 40) {
  try {
    // 2026-10-22 审计：旧版是「全局只留 40 条」，而「全部备份」一次就写 8 份，
    // 点 5 次就会把 persona / config 的唯一历史副本挤掉。改为**按来源分别保留**。
    const RE = /^(.*)-(\d{4}-\d{2}-\d{2}T[^-]+)$/;
    const groups = new Map();
    for (const name of fs.readdirSync(BACKUP_DIR)) {
      const full = path.join(BACKUP_DIR, name);
      let mtime = 0;
      try { mtime = fs.statSync(full).mtimeMs; } catch { continue; }
      const label = name.match(RE)?.[1] ?? name;
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push({ full, mtime });
    }
    for (const list of groups.values()) {
      list.sort((a, b) => b.mtime - a.mtime);
      for (const item of list.slice(keep)) {
        try { fs.unlinkSync(item.full); } catch {}
      }
    }
  } catch {}
}

export function listBackups(limit = 30) {
  try {
    return fs.readdirSync(BACKUP_DIR)
      .map((name) => {
        const full = path.join(BACKUP_DIR, name);
        const stat = fs.statSync(full);
        return { name, bytes: stat.size, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit);
  } catch {
    return [];
  }
}

function exampleDefaults() {
  return readJson(QQ_CONFIG_EXAMPLE, {}) ?? {};
}

/** QQ 配置：模板默认值 + 用户文件。只用于展示/合并，不改文件。 */
export function readQqConfig() {
  const defaults = exampleDefaults();
  const user = readJson(QQ_CONFIG, {}) ?? {};
  return { config: deepMerge(defaults, user), hasUserFile: Object.keys(user).length > 0 };
}

export function readBiliConfig() {
  const user = readJson(BILI_CONFIG, {}) ?? {};
  return { config: deepMerge(BIDI_DEFAULTS, user), hasUserFile: Object.keys(user).length > 0 };
}

/**
 * 平台启动开关的归一/迁移（纯函数，给单测与 readUnified 共用）。
 *
 * 优先级：显式 `platforms.start.<id>` > 旧的 `bridge.autoStart`（只对 QQ）>
 * 旧的 `platforms.enabled` 数组 > 默认值。
 * 旧 `platforms.enabled` 一直只是元数据（默认两项都在），不能压过用户真正拨过的
 * `bridge.autoStart`，否则迁移时老用户「QQ 自动启动开着」会被默认数组吞掉。
 *
 * 为什么要迁移：2026-10-24 之前 QQ 的自动启动是 `bridge.autoStart`（默认 false），
 * B站 则无条件随插件启动。直接换新字段会让老用户的显式选择丢失；这里按旧字段
 * 推导一次，用户下一次保存就落到新字段，之后不再看旧字段。
 */
export function platformStartsFrom(user = {}) {
  const explicit = isPlainObject(user?.platforms?.start) ? user.platforms.start : {};
  const enabled = Array.isArray(user?.platforms?.enabled) ? user.platforms.enabled.map(String) : null;
  const legacyAutoStart = isPlainObject(user?.bridge) && typeof user.bridge.autoStart === 'boolean'
    ? user.bridge.autoStart
    : null;
  const fromEnabled = (id, fallback) => (enabled ? enabled.includes(id) : fallback);
  return {
    qq: typeof explicit.qq === 'boolean'
      ? explicit.qq
      : (legacyAutoStart !== null ? legacyAutoStart : fromEnabled('qq', true)),
    bili: typeof explicit.bili === 'boolean' ? explicit.bili : fromEnabled('bili', true),
  };
}

export function readUnified() {
  const user = readJson(UNIFIED_FILE, {}) ?? {};
  const config = deepMerge(DEFAULT_UNIFIED, user);
  config.platforms = isPlainObject(config.platforms) ? config.platforms : {};
  config.platforms.start = platformStartsFrom(user);
  return {
    config,
    hasUserFile: Object.keys(user).length > 0,
    // 用户文件里是否**明确写过** admin。决定「空值」是显式清空还是还没配置：
    // readUnified() 会合并 DEFAULT_UNIFIED，合并结果里 admin 永远存在（默认空串），
    // 只看合并值会把升级后的旧字段（ownerQQ / owner.mid）永远当不存在。
    hasAdmin: isPlainObject(user.admin),
  };
}

export function normalizeIdList(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(/[\s,，;；]+/);
  return [...new Set(list.map((item) => String(item ?? '').trim()).filter((item) => /^\d{4,15}$/.test(item)))];
}

function finiteNumber(value, fallback, min, max, { integer = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.min(max, Math.max(min, n));
  return integer ? Math.round(clamped) : clamped;
}

function normalizeTimes(value, fallback) {
  const source = Array.isArray(value) ? value : String(value ?? '').split(/[\s,，;；]+/);
  const out = [];
  for (const item of source) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(item ?? '').trim());
    if (!match) continue;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) continue;
    out.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  }
  return out.length ? [...new Set(out)].sort() : fallback;
}

/** 保存前的 QQ 侧收敛：只做安全范围/类型校正，不认识的键原样保留。 */
export function normalizeQqConfig(input) {
  const cfg = clone(input ?? {});
  cfg.allow = isPlainObject(cfg.allow) ? cfg.allow : {};
  cfg.deny = isPlainObject(cfg.deny) ? cfg.deny : {};
  cfg.allow.private = normalizeIdList(cfg.allow.private);
  cfg.allow.groups = normalizeIdList(cfg.allow.groups);
  // deny.users = 人的黑名单（无论什么群/私聊都不响应）。保存前收敛成纯数字串数组，
  // 与桥接侧 senderBlocked() 的比较口径一致（否则 " 123 " / 123 这种写法会静默失效）。
  cfg.deny.users = normalizeIdList(cfg.deny.users);
  cfg.deny.private = normalizeIdList(cfg.deny.private);
  cfg.deny.groups = normalizeIdList(cfg.deny.groups);
  cfg.allowAllWhenEmpty = cfg.allowAllWhenEmpty === true;
  // 自定义时区：非法值在 /config 入口已被 400 拒绝；这里是兜底，落成空串（= 系统时区）而不是留一个无效值。
  {
    const tz = normalizeTimeZone(cfg.timezone);
    cfg.timezone = tz.ok ? tz.zone : '';
  }
  cfg.ownerQQ = cfg.ownerQQ == null || cfg.ownerQQ === '' ? null : normalizeIdList([cfg.ownerQQ])[0] ?? null;
  cfg.consolePort = finiteNumber(cfg.consolePort, 3100, 1024, 65535, { integer: true });
  cfg.sendDelayMs = finiteNumber(cfg.sendDelayMs, 300, 0, 60_000, { integer: true });
  cfg.questionTimeoutMs = finiteNumber(cfg.questionTimeoutMs, 300_000, 10_000, 3_600_000, { integer: true });
  cfg.fishGuard = normalizeQqFishGuard(cfg.fishGuard ?? DEFAULT_QQ_FISH_GUARD);
  cfg.role = isPlainObject(cfg.role) ? cfg.role : {};
  cfg.role.maxInjectChars = finiteNumber(cfg.role.maxInjectChars, 6000, 1000, 20_000, { integer: true });

  cfg.biliBridge = isPlainObject(cfg.biliBridge) ? cfg.biliBridge : {};
  cfg.biliBridge.enabled = cfg.biliBridge.enabled !== false;
  cfg.biliBridge.memory = isPlainObject(cfg.biliBridge.memory) ? cfg.biliBridge.memory : {};
  cfg.biliBridge.memory.enabled = cfg.biliBridge.memory.enabled !== false;
  cfg.biliBridge.memory.refreshIntervalMs = finiteNumber(cfg.biliBridge.memory.refreshIntervalMs, 600_000, 60_000, 3_600_000, { integer: true });
  cfg.biliBridge.dynamics = isPlainObject(cfg.biliBridge.dynamics) ? cfg.biliBridge.dynamics : {};
  cfg.biliBridge.dynamics.enabled = cfg.biliBridge.dynamics.enabled !== false;
  cfg.biliBridge.dynamics.pollIntervalMs = finiteNumber(cfg.biliBridge.dynamics.pollIntervalMs, 180_000, 60_000, 3_600_000, { integer: true });
  cfg.biliBridge.dynamics.groups = normalizeIdList(cfg.biliBridge.dynamics.groups);
  cfg.biliBridge.share = isPlainObject(cfg.biliBridge.share) ? cfg.biliBridge.share : {};
  cfg.biliBridge.share.enabled = cfg.biliBridge.share.enabled !== false;
  cfg.biliBridge.share.times = normalizeTimes(cfg.biliBridge.share.times, ['07:00', '11:00', '13:00', '15:00', '17:00', '19:00', '21:00', '23:00']);
  cfg.biliBridge.share.groups = normalizeIdList(cfg.biliBridge.share.groups);
  cfg.biliBridge.share.gapMs = finiteNumber(cfg.biliBridge.share.gapMs, 4000, 0, 60_000, { integer: true });
  // 卡片样式：link（默认）/ miniapp（B站小程序已下架，opt-in）/ off。
  // `card` 保留成派生值，旧代码/旧配置读它不会错；UI 只暴露 cardMode 一个开关。
  cfg.biliBridge.share.cardMode = normalizeCardMode(cfg.biliBridge.share);
  cfg.biliBridge.share.card = cfg.biliBridge.share.cardMode !== 'off';

  if (isPlainObject(cfg.socialV2)) {
    cfg.socialV2.initialPromptMaxChars = finiteNumber(cfg.socialV2.initialPromptMaxChars, 2000, 100, 8000, { integer: true });
    if (isPlainObject(cfg.socialV2.media)) {
      cfg.socialV2.media.maxBytes = finiteNumber(cfg.socialV2.media.maxBytes, 8 * 1024 * 1024, 1024 * 1024, 64 * 1024 * 1024, { integer: true });
      cfg.socialV2.media.maxPixels = finiteNumber(cfg.socialV2.media.maxPixels, 64_000_000, 1_000_000, 256_000_000, { integer: true });
      cfg.socialV2.media.maxCount = finiteNumber(cfg.socialV2.media.maxCount, 5, 1, 20, { integer: true });
    }
    if (isPlainObject(cfg.socialV2.tools)) {
      for (const [key, value] of Object.entries(cfg.socialV2.tools)) cfg.socialV2.tools[key] = value === true;
    }
  }
  return cfg;
}

/** 关键词列表：去空、去重（大小写不敏感）、限长；不认识的类型当空列表。 */
function normalizeKeywordList(value) {
  const source = Array.isArray(value) ? value : String(value ?? '').split(/[,，、\n]/);
  const out = [];
  const seen = new Set();
  for (const raw of source) {
    const label = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label.slice(0, 40));
    if (out.length >= 40) break;
  }
  return out;
}

/**
 * 偏好权重：只保留当前 like / keywords 里存在的词；0~5，保留两位小数。
 * 删掉关键词后它的权重也一起清掉，避免配置里越积越多的孤儿键。
 */
function normalizePreferenceWeights(value, labels) {
  if (!isPlainObject(value)) return {};
  const known = new Map(labels.map((label) => [label.toLowerCase(), label]));
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const label = known.get(String(rawKey ?? '').trim().toLowerCase());
    if (!label) continue;
    if (rawValue === '' || rawValue == null) continue;
    out[label] = Math.round(finiteNumber(rawValue, 1, 0, 5) * 100) / 100;
  }
  return out;
}

/** 保存前的 B 站侧收敛（沿用旧 bili-whale 设置页的边界）。 */
export function normalizeBiliConfig(input) {
  const cfg = deepMerge(BIDI_DEFAULTS, clone(input ?? {}));
  cfg.night = isPlainObject(cfg.night) ? cfg.night : {};
  if (!Array.isArray(cfg.night.windows) || cfg.night.windows.length === 0) {
    cfg.night.windows = [{ start: '20:00', end: '24:00', wakes: 1 }];
  }
  cfg.night.windows = cfg.night.windows.map((w) => ({
    start: String(w?.start ?? '20:00').slice(0, 5),
    end: String(w?.end ?? '24:00').slice(0, 5),
    wakes: finiteNumber(w?.wakes, 1, 1, 12, { integer: true }),
  }));
  cfg.night.maxWakesPerDay = finiteNumber(
    cfg.night.maxWakesPerDay,
    cfg.night.windows.reduce((sum, w) => sum + (Number(w.wakes) || 1), 0),
    0, 12, { integer: true },
  );
  cfg.night.skipChance = finiteNumber(cfg.night.skipChance, 0.3, 0, 0.95);
  cfg.night.maxVideos = finiteNumber(cfg.night.maxVideos, 5, 1, 20, { integer: true });
  cfg.night.minGapMin = finiteNumber(cfg.night.minGapMin, 20, 0, 120, { integer: true });
  cfg.quota = isPlainObject(cfg.quota) ? cfg.quota : {};
  cfg.quota.shareDaily = finiteNumber(cfg.quota.shareDaily, 3, 0, 20, { integer: true });
  // 四本账额度：越界值收敛回 [min,max]；不认识的键丢弃（只认 LIMIT_RULES 里的九个）。
  cfg.limits = normalizeLimits(cfg.limits);
  // 四类动态：只保留可编辑字段（enabled/slot/minLen/maxLen/prefix），其他键丢掉。
  cfg.dynamics = normalizeDynamics(cfg.dynamics);
  cfg.share = isPlainObject(cfg.share) ? cfg.share : {};
  // 2026-10-23 用户定：默认发自己的动态（视频卡片），不再默认去评论区 @ 主人。
  cfg.share.via = ['dynamic', 'comment', 'dm'].includes(cfg.share.via) ? cfg.share.via : 'dynamic';
  cfg.share.minScore = finiteNumber(cfg.share.minScore, 13, 0, 20, { integer: true });
  cfg.share.silentAfterDays = finiteNumber(cfg.share.silentAfterDays, 3, 0, 60, { integer: true });
  cfg.share.decayPerDay = finiteNumber(cfg.share.decayPerDay, 1, 0, 10, { integer: true });
  cfg.listen = isPlainObject(cfg.listen) ? cfg.listen : {};
  cfg.listen.commentIntervalSec = finiteNumber(cfg.listen.commentIntervalSec, 300, 60, 86_400, { integer: true });
  cfg.listen.dmScope = cfg.listen.dmScope === 'all' ? 'all' : 'owner';
  cfg.listen.liveScope = cfg.listen.liveScope === 'mention' ? 'mention' : 'owner';
  // 口味：统一在这里收敛，避免 UI 里逗号分隔/大小写变体把权重表弄脏。
  cfg.preferences = isPlainObject(cfg.preferences) ? cfg.preferences : {};
  cfg.preferences.like = normalizeKeywordList(cfg.preferences.like);
  cfg.preferences.keywords = normalizeKeywordList(cfg.preferences.keywords);
  cfg.preferences.dislike = normalizeKeywordList(cfg.preferences.dislike);
  // 同一个词同时出现在「爱看」和「额外关键词」→ 以爱看为准，避免两处各算一次。
  const likeKeys = new Set(cfg.preferences.like.map((label) => label.toLowerCase()));
  cfg.preferences.keywords = cfg.preferences.keywords.filter((label) => !likeKeys.has(label.toLowerCase()));
  cfg.preferences.weights = normalizePreferenceWeights(
    cfg.preferences.weights,
    [...cfg.preferences.like, ...cfg.preferences.keywords],
  );
  cfg.fishGuard = normalizeBiliFishGuard(cfg.fishGuard ?? DEFAULT_BILI_FISH_GUARD);
  cfg.notify = isPlainObject(cfg.notify) ? cfg.notify : {};
  cfg.notify.type = ['none', 'desktop', 'dm', 'webhook', 'command'].includes(cfg.notify.type) ? cfg.notify.type : 'none';
  cfg.notify.template = cfg.notify.template === 'markdown' ? 'markdown' : 'text';
  cfg.notify.args = Array.isArray(cfg.notify.args) ? cfg.notify.args.map(String) : [];
  cfg.diary = isPlainObject(cfg.diary) ? cfg.diary : {};
  cfg.diary.enabled = true;
  cfg.diary.push = cfg.diary.push !== false;
  cfg.toolsPath = String(cfg.toolsPath ?? '');
  return cfg;
}

/** 读给 UI：把秘密替换为 ********。 */
export function redactForUi(value, prefix = '') {
  if (Array.isArray(value)) return value.map((item, index) => redactForUi(item, `${prefix}[${index}]`));
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const next = prefix ? `${prefix}.${key}` : key;
      out[key] = SECRET_PATHS.has(next) && item ? MASK : redactForUi(item, next);
    }
    return out;
  }
  return value;
}

/** 保存时把 ******** 还原成旧值；空串表示用户明确要清空。 */
export function restoreMaskedSecrets(incoming, current, prefix = '') {
  if (!isPlainObject(incoming)) return clone(incoming);
  const out = {};
  for (const [key, value] of Object.entries(incoming)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (SECRET_PATHS.has(next) && value === MASK) {
      out[key] = getPath(current, next.split('.'));
      continue;
    }
    out[key] = isPlainObject(value) ? restoreMaskedSecrets(value, current, next) : clone(value);
  }
  return out;
}

export function readAll() {
  const qq = readQqConfig();
  const bili = readBiliConfig();
  const unified = readUnified();
  // 管理员只有一个真相入口：合体层还没写 admin 时，用旧字段（ownerQQ / owner.mid）
  // 推导出来给 UI 看；用户下一次保存就会把它落到合体层。
  const admin = adminFromSources({
    unified: unified.hasAdmin ? unified.config : { ...unified.config, admin: undefined },
    qq: qq.config,
    bili: bili.config,
  });
  const unifiedWithAdmin = { ...unified.config, admin: normalizeAdmin(admin) };
  return {
    qq: redactForUi(qq.config),
    bili: redactForUi(bili.config),
    unified: unifiedWithAdmin,
    hasUserFile: { qq: qq.hasUserFile, bili: bili.hasUserFile, unified: unified.hasUserFile },
  };
}

export function saveQqConfig(incoming) {
  const current = readQqConfig().config;
  const restored = restoreMaskedSecrets(incoming, current);
  const next = normalizeQqConfig(deepMerge(current, restored));
  const backup = backupFile(QQ_CONFIG, 'qq-config');
  writeJsonAtomic(QQ_CONFIG, next);
  return { config: redactForUi(next), backup };
}

export function saveBiliConfig(incoming) {
  const current = readBiliConfig().config;
  const restored = restoreMaskedSecrets(incoming, current);
  const next = normalizeBiliConfig(deepMerge(current, restored));
  const backup = backupFile(BILI_CONFIG, 'bili-config');
  writeJsonAtomic(BILI_CONFIG, next);
  return { config: redactForUi(next), backup };
}

export function saveUnified(incoming) {
  const current = readUnified().config;
  const next = deepMerge(current, clone(incoming ?? {}));
  next.version = 1;
  // 记忆卡上限必须按引擎的边界收敛：否则输入 999999 会原样落盘，界面显示 999999、
  // 实际注入/容量按 100000 算，用户会以为「改了没生效」。
  next.memoryCard = normalizeMemoryCardConfig(next.memoryCard);
  // 平台启动开关：只收布尔，缺省 true。旧字段 bridge.autoStart 同步镜像一次，
  // 让「降级回旧版」或手工读配置的人看到同一份选择（新代码只认 platforms.start）。
  next.platforms = isPlainObject(next.platforms) ? next.platforms : {};
  const start = isPlainObject(next.platforms.start) ? next.platforms.start : {};
  next.platforms.start = {
    qq: start.qq !== false,
    bili: start.bili !== false,
  };
  next.bridge = isPlainObject(next.bridge) ? next.bridge : {};
  next.bridge.autoStart = next.platforms.start.qq;
  const backup = backupFile(UNIFIED_FILE, 'unified-config');
  writeJsonAtomic(UNIFIED_FILE, next);
  return { config: next, backup };
}

export function pathSummary() {
  return {
    pluginRoot: PLUGIN_ROOT,
    qqbotRoot: QQBOT_ROOT,
    qqConfig: QQ_CONFIG,
    biliConfig: BILI_CONFIG,
    unifiedConfig: UNIFIED_FILE,
    dshHome: DSH_HOME,
    home: HOME,
  };
}
