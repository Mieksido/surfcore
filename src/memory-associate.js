// memory-associate.js · 「联想」：让快淡忘的旧事在对的时机被顺口提起（第 6 件）
//
// 为什么不是照抄 B 的 associate 服务：B 的联想链挂在生活回路上（定时向 memory-rag 的
// /associate 要「和最近话题相关的旧事」，然后主动发一条消息）。SurfCore 不用定时器打扰人，
// 而是把联想当成**唤醒时的一层薄注入**：这次醒来如果本来就要说话，顺带让她想起一条
// 快忘掉的老事；不谈就不提，不额外发消息。
//
// 挑谁：不用「最相关的」（那是第 1 件记忆检索的活），而用**快淡忘的**——
// 可提取性 R 落在 [rMin, rMax] 区间里的老事。理由是间隔重复：R 太低说明已经想不起来了，
// 提了也没用；R 太高说明还记着，用不着提；中间那一段才是「提一句能续上」的。
//
// 纯函数 + 旁挂状态文件；不写记忆卡、不改档案、不发消息。

import fs from 'node:fs';
import path from 'node:path';
import { strengthOf } from './memory-strength.js';

export const ASSOCIATE_VERSION = 1;

export const DEFAULT_ASSOCIATE_CONFIG = Object.freeze({
  enabled: true,
  maxPerWake: 1,
  cooldownDays: 7,
  rMin: 0.2,
  // 上限取 0.7 而不是更高：卡面档位本身就把 R 压在「牢 0.9 / 稳 0.8 / 差 0.7」这几档上，
  // 只有开始真正衰减的（fuzzy 及以下）才落到 0.7 以内。0.7 正好是「开始模糊」的那一档。
  rMax: 0.7,
  minAgeDays: 2,
  maxChars: 120,
});

const DAY_MS = 24 * 60 * 60 * 1000;

function num(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeAssociateConfig(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const rMin = num(raw.rMin, DEFAULT_ASSOCIATE_CONFIG.rMin, { min: 0, max: 1 });
  const rMaxRaw = num(raw.rMax, DEFAULT_ASSOCIATE_CONFIG.rMax, { min: 0, max: 1 });
  // 区间写反了不让它静默失效：交换回来，否则「配了却永远不触发」比报错更难查。
  const rMax = rMaxRaw < rMin ? rMin : rMaxRaw;
  return {
    enabled: raw.enabled !== false,
    maxPerWake: Math.round(num(raw.maxPerWake, DEFAULT_ASSOCIATE_CONFIG.maxPerWake, { min: 0, max: 3 })),
    cooldownDays: Math.round(num(raw.cooldownDays, DEFAULT_ASSOCIATE_CONFIG.cooldownDays, { min: 0, max: 365 })),
    rMin,
    rMax,
    minAgeDays: Math.round(num(raw.minAgeDays, DEFAULT_ASSOCIATE_CONFIG.minAgeDays, { min: 0, max: 3650 })),
    maxChars: Math.round(num(raw.maxChars, DEFAULT_ASSOCIATE_CONFIG.maxChars, { min: 20, max: 400 })),
  };
}

/** 状态文件跟着角色目录走：换角色就换一套「最近提过谁」。 */
export function associatePathFor(memoryDir) {
  return path.join(String(memoryDir ?? ''), 'memory-associate.json');
}

export function emptySeen() {
  return { version: ASSOCIATE_VERSION, seen: {} };
}

/** 坏 JSON / 结构不对一律当空：联想是锦上添花，读不出来就该静默跳过，而不是把唤醒搞挂。 */
export function loadSeen(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object') return emptySeen();
    const seen = {};
    for (const [id, day] of Object.entries(raw.seen && typeof raw.seen === 'object' ? raw.seen : {})) {
      if (typeof id === 'string' && id && typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)) seen[id] = day;
    }
    return { version: ASSOCIATE_VERSION, seen };
  } catch {
    return emptySeen();
  }
}

/**
 * 清掉太老的冷却记录：`seen` 只增不减，一条记忆提过就留一行；
 * 冷却最长 7 天，所以超过 60 天的记录已经没有任何判断价值，留着只是让文件慢慢变大。
 *
 * 不用 `now`，用现有记录里最新的那一天当基准 —— 这样「今天」无关，结果可复现、好测。
 * 返回删掉的条数（原地改 state）。
 */
export const SEEN_KEEP_DAYS = 60;

export function pruneSeen(state, { keepDays = SEEN_KEEP_DAYS } = {}) {
  const seen = state?.seen && typeof state.seen === 'object' ? state.seen : null;
  if (!seen) return 0;
  const days = Object.values(seen).filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (!days.length) return 0;
  const newest = days[days.length - 1];
  const keep = Math.max(0, Number(keepDays) || 0);
  let removed = 0;
  for (const [id, day] of Object.entries(seen)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day))) { delete seen[id]; removed += 1; continue; }
    if (daysBetween(day, newest) > keep) { delete seen[id]; removed += 1; }
  }
  return removed;
}

export function saveSeen(file, state) {
  pruneSeen(state);
  const out = { version: ASSOCIATE_VERSION, seen: { ...(state?.seen ?? {}) } };
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  return out;
}

/** today 是本地日（YYYY-MM-DD）。冷却按日历日算，和约定账本同一口径。 */
function daysBetween(fromDay, toDay) {
  const a = Date.parse(`${fromDay}T00:00:00`);
  const b = Date.parse(`${toDay}T00:00:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.round((b - a) / DAY_MS);
}

export function seenRecently(seen, id, today, cooldownDays) {
  const day = seen?.seen?.[id];
  if (!day) return false;
  const gap = daysBetween(day, today);
  if (!Number.isFinite(gap)) return false;
  return gap >= 0 && gap < Math.max(0, cooldownDays);
}

/**
 * 从检索命中里挑「值得顺口提一句」的旧事。
 *
 * hits: `[{id, title, text, score}]`（来自 memory-recall / 索引检索）
 * records: 记忆档记录数组（要 R/S/D，所以必须有真记录，不能只看命中）
 * 返回 `[{id, text, R, clarity}]`，按 R 从低到高（最先要忘的排前面）。
 */
export function pickAssociations(hits, { records = [], seen = emptySeen(), config = DEFAULT_ASSOCIATE_CONFIG, today, now = Date.now() } = {}) {
  const cfg = normalizeAssociateConfig(config);
  if (!cfg.enabled) return [];
  const byId = new Map();
  for (const r of Array.isArray(records) ? records : []) {
    const id = String(r?.id ?? '');
    if (id) byId.set(id, r);
  }
  const out = [];
  const used = new Set();
  for (const hit of Array.isArray(hits) ? hits : []) {
    const id = String(hit?.id ?? '');
    if (!id || used.has(id)) continue;
    const record = byId.get(id);
    if (!record) continue;
    let st;
    try {
      st = strengthOf(record, { now, config: {} });
    } catch {
      continue;
    }
    if (!st || st.protected === true) continue;
    // 太新的事不算「旧事」：刚聊过的提起来像复读。
    if (Number(st.elapsedDays) < cfg.minAgeDays) continue;
    const R = Number(st.R);
    if (!Number.isFinite(R) || R < cfg.rMin || R > cfg.rMax) continue;
    if (seenRecently(seen, id, today, cfg.cooldownDays)) continue;
    const text = String(hit?.title || hit?.text || record?.title || record?.text || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    used.add(id);
    out.push({ id, text: text.slice(0, cfg.maxChars), R, clarity: record.clarity ?? '' });
    if (out.length >= cfg.maxPerWake) break;
  }
  out.sort((a, b) => a.R - b.R);
  return out;
}

/** 记下「这几条提过」，冷却从今天重新算起。 */
export function markSeen(state, ids, today) {
  const out = { version: ASSOCIATE_VERSION, seen: { ...(state?.seen ?? {}) } };
  for (const id of Array.isArray(ids) ? ids : []) {
    const s = String(id ?? '');
    if (s) out.seen[s] = today;
  }
  return out;
}

/**
 * 提示词。刻意留了「无关就别提」的出口：联想的价值在于**她自己也觉得自然**，
 * 硬把旧事塞进不相干的话题里，比不想起来更像失忆。
 */
export function associateWakeText(items, { maxChars = 120 } = {}) {
  const list = Array.isArray(items) ? items.filter((it) => it && it.text) : [];
  if (!list.length) return '';
  const lines = list.map((it) => `- ${String(it.text).slice(0, maxChars)}`).join('\n');
  return [
    '【忽然想起】',
    lines,
    '（这是你自己记忆里的一件旧事，没有谁提起它。如果这一轮正好聊得到，可以顺口说一句；搭不上就别硬提，也别当成对方刚说的话。）',
  ].join('\n');
}