// brain-replay.js · 回放最近 7 天（星图页面的「回放」）
//
// 为什么是「现场重建」而不是读一份记录：轨迹文件只落编号和数字（见 brain-feed.js 顶部说明），
// 原文从来不落盘。所以回放时按编号去现成的文件里把内容补回来——只读，不缓存，不写任何文件：
//   - state/brain/trace/<YYYY-MM-DD>.jsonl  事件骨架（id/at/type/key/nodes/n/e）
//   - state/tool-calls.jsonl                工具调用与结果（发送类工具的正文被截断记在里面）
//   - state/qq-activity.log                 活动日志里还留着的那段「消息已入未读 / 成功 N 条」，
//                                           是回放里收发消息的唯一来源（只留 500 行，通常只有今天）
//   - 记忆卡全量档（由调用方传进来）          用 mem_xxx 编号补出「记下 / 改了 / 淡忘」的正文
//
// 已知限制（会作为 notes 显示在页面上）：
//   1) 聊天原文没有长期存档，收发消息只能还原活动日志里还留着的那一部分；
//   2) 轨迹是这个功能上线之后才有的，更早的日子只剩工具调用；
//   3) 回放不改变任何状态：它只读文件、只拼事件。
import fs from 'node:fs';
import path from 'node:path';
import { KEY_RE, filterTraceRecord, localDay, regionFor } from './brain-feed.js';
import { clarityLabelOf, clarityOf, memoryUnitId, recordFidelity, recordIdOfUnit } from './brain-decay.js';

/** 回放窗口：今天 + 往前 6 天（与 brain-feed 的轨迹保留 7 天一致）。 */
export const DAYS_BACK = 6;
const MAX_EVENTS = 5000;
const MAX_TEXT = 300;
const PAIR_MS = 5000;
/** 重建事件用一个大偏移的 id，免得和轨迹里本进程的 id 撞上（页面只用它做去重）。 */
const SYNTH_ID_BASE = 1_000_000;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 二次脱敏：回放响应里绝不能出现令牌（第一道在 appendActivity 写入时）。 */
const TOKENISH_RE = /(sk-[A-Za-z0-9_-]{8,}|[A-Za-z0-9_-]{32,}|token\s*[:=]\s*\S{8,})/gi;

const clip = (s, n = MAX_TEXT) => {
  const chars = [...String(s ?? '')];
  return chars.length > n ? chars.slice(0, n).join('') : chars.join('');
};
const noToken = (s) => String(s ?? '').replace(TOKENISH_RE, '（已脱敏）');
const plain = (s) => noToken(String(s ?? '').replace(/\s+/g, ' ').trim());
const finite = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

function readText(file, { maxBytes = 8 * 1024 * 1024 } = {}) {
  if (!file) return '';
  try {
    if (fs.statSync(file).size > maxBytes) return '';
    return fs.readFileSync(file, 'utf8');
  } catch { return ''; }
}

function readJsonl(file, opts) {
  const out = [];
  for (const line of readText(file, opts).split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const rec = JSON.parse(s);
      if (rec && typeof rec === 'object') out.push(rec);
    } catch { /* 坏行跳过：日志总有可能被中断写坏 */ }
  }
  return out;
}

/** 本地日期 → 当天 0 点的毫秒；写坏了返回 null。 */
export function dayStartMs(day) {
  if (typeof day !== 'string' || !DAY_RE.test(day)) return null;
  const t = Date.parse(`${day}T00:00:00`);
  return Number.isFinite(t) ? t : null;
}

/** 工具名统一取末尾一段（mcp__snowluma__qq_send_message → qq_send_message）。 */
export function shortToolName(name) {
  const s = plain(name);
  const i = s.lastIndexOf('__');
  return (i >= 0 ? s.slice(i + 2) : s).slice(0, 40) || 'tool';
}

/**
 * 活动日志的一行：`[HH:MM:SS] key [tag] 正文`。
 * 只认两种（其余行没有对应的事件类型，直接跳过）：
 *   消息已入未读：/（静默模式）群友 …        → 收到消息
 *   成功 N/M 条（[send] 或工具统一发送）      → 发出消息
 */
export function parseActivityLine(line, day) {
  const m = /^\[(\d{2}):(\d{2}):(\d{2})\]\s+(\S+)\s+(.*)$/.exec(String(line ?? '').trim());
  if (!m) return null;
  const base = dayStartMs(day);
  if (base === null) return null;
  const at = base + (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000;
  const key = KEY_RE.test(m[4]) ? m[4] : null;
  const rest = m[5];
  if (/消息已入未读：|群友\s*\d+：|（静默模式）/.test(rest)) {
    const text = plain(rest.split('：').slice(1).join('：'));
    return text ? { at, key, type: 'msg.in', text, truncated: true } : null;
  }
  const outbound = /成功\s*(\d+)\/(\d+)\s*条/.exec(rest);
  if (outbound) {
    return {
      at, key, type: 'msg.out',
      text: plain(rest.split('：').slice(1).join('：')),
      count: Number(outbound[1]), total: Number(outbound[2]), truncated: true
    };
  }
  return null;
}

/**
 * @param {object} opts
 * @param {string} opts.stateDir        桥接的 state 目录（轨迹 / 工具日志 / 活动日志都在这里）
 * @param {() => any[]} [opts.records]  返回记忆卡全量档记录（补正文用；出错就当成没有）
 * @param {() => number} [opts.now]
 */
export function createBrainReplay({ stateDir = null, records = null, now = () => Date.now(), log = () => {} } = {}) {
  const nowMs = () => {
    try {
      const t = Number(now());
      return Number.isFinite(t) ? t : Date.now();
    } catch { return Date.now(); }
  };
  const traceFile = (day) => (stateDir ? path.join(stateDir, 'brain', 'trace', `${day}.jsonl`) : null);
  const toolLogFile = stateDir ? path.join(stateDir, 'tool-calls.jsonl') : null;
  const activityFile = stateDir ? path.join(stateDir, 'qq-activity.log') : null;

  function checkDay(day) {
    if (typeof day !== 'string' || !DAY_RE.test(day)) return { ok: false, error: 'day 要写成 YYYY-MM-DD' };
    const today = localDay(nowMs());
    const oldest = localDay(nowMs() - DAYS_BACK * 86400000);
    if (day > today || day < oldest) return { ok: false, error: `只能回放 ${oldest} 到 ${today}` };
    return { ok: true, day };
  }

  /** 记忆卡全量档 → id → 记录（只用于补正文；每次回放临时建，不缓存）。 */
  function recordIndex() {
    const map = new Map();
    let list = [];
    try { list = records ? records() : []; } catch { list = []; }
    for (const r of Array.isArray(list) ? list : []) {
      if (r?.id) map.set(String(r.id), r);
    }
    return map;
  }

  function recordNode(id, index) {
    const r = index.get(String(id));
    if (!r) return null;
    const clarity = clarityOf(r);
    return {
      id: memoryUnitId(r.id), kind: 'ltm', cat: String(r.kind ?? 'other'),
      text: clip(r.text ?? r.title ?? ''), title: clip(r.title ?? '', 80),
      clarity, clarityLabel: clarityLabelOf(clarity), R: recordFidelity(r),
      at: Date.parse(String(r.lastSeenAt ?? r.createdAt ?? '')) || 0,
      scope: r.scope ?? null
    };
  }

  function traceEvents(day) {
    const out = [];
    for (const raw of readJsonl(traceFile(day))) {
      const rec = filterTraceRecord(raw); // 轨迹可能被手改过：再过滤一次，不合规的整行丢
      if (!rec) continue;
      out.push({
        id: rec.id, at: rec.at, type: rec.type, key: rec.key ?? null,
        origin: rec.origin ?? 'bridge', region: regionFor(rec.type, rec.e?.tool),
        nodes: rec.nodes ?? [], n: rec.n ?? {}, e: rec.e ?? {}, shadow: rec.shadow === true, from: 'trace'
      });
    }
    return out;
  }

  /** 工具参数里只留「看得懂又不会带出私密内容」的几项。 */
  function clipArgs(args) {
    if (!args || typeof args !== 'object') return null;
    const out = {};
    const keys = ['message', 'messages', 'query', 'keyword', 'summary', 'nextOpening', 'reason', 'text', 'title', 'key', 'groupId', 'userId', 'day'];
    for (const k of keys) {
      if (/token/i.test(k)) continue;
      const v = args[k];
      if (typeof v === 'string' && v) out[k] = clip(v, 160);
      else if (Array.isArray(v)) out[k] = v.slice(0, 8).map((x) => clip(x, 120));
    }
    return Object.keys(out).length ? out : null;
  }

  /** type=call / type=result 各一行，用「工具 + key + 秒」配上对（允许 ±5 秒）。 */
  function toolEvents(day, traceList) {
    if (!toolLogFile) return [];
    const start = dayStartMs(day);
    if (start === null) return [];
    const end = start + 86400000;
    const calls = [];
    const results = new Map();
    for (const rec of readJsonl(toolLogFile)) {
      const t = Date.parse(String(rec?.time ?? ''));
      if (!Number.isFinite(t) || t < start || t >= end) continue;
      const tool = shortToolName(rec.tool ?? '');
      if (!tool || tool === 'tool') continue;
      const key = KEY_RE.test(rec.key) ? rec.key : null;
      if (rec.type === 'result') {
        results.set(`${tool}|${key ?? ''}|${Math.floor(t / 1000)}`, { ok: rec.ok !== false });
        continue;
      }
      if (rec.type !== 'call') continue;
      let args = null;
      try { args = typeof rec.args === 'string' ? JSON.parse(rec.args) : rec.args; } catch { args = null; }
      calls.push({ at: t, key, tool, args });
    }
    const out = [];
    for (const c of calls) {
      // 轨迹里已经有同一个工具的 tool 事件（±5 秒）就不再重复造一条。
      // 两边都要先归一化成短名：轨迹里存的是 MCP 全名（mcp__x__qq_send_message），
      // 工具日志这边已经是短名，直接比会永远不相等 —— 表现就是每个工具在回放里出现两次。
      if (traceList.some((ev) => ev.type === 'tool' && shortToolName(ev.e?.tool ?? '') === c.tool && Math.abs(ev.at - c.at) <= PAIR_MS)) continue;
      const sec = Math.floor(c.at / 1000);
      let result = results.get(`${c.tool}|${c.key ?? ''}|${sec}`) ?? null;
      for (let d = 1; d <= PAIR_MS / 1000 && !result; d += 1) {
        result = results.get(`${c.tool}|${c.key ?? ''}|${sec + d}`) ?? results.get(`${c.tool}|${c.key ?? ''}|${sec - d}`) ?? null;
      }
      out.push({
        at: c.at, key: c.key, type: 'tool', origin: 'bridge',
        // 脑区由工具名决定：写死 output 的话，回放里语音和图片都会被画到「输出」那一格。
        region: regionFor('tool', c.tool),
        nodes: [], n: {},
        e: { tool: c.tool, ...(result && result.ok === false ? { status: 'error' } : {}) },
        data: { tool: c.tool, args: clipArgs(c.args), ok: result ? result.ok : null, status: result ? (result.ok ? 'ok' : 'error') : null },
        shadow: true, from: 'tool-calls'
      });
    }
    return out;
  }

  function msgEvents(day) {
    const out = [];
    for (const line of readText(activityFile, { maxBytes: 1024 * 1024 }).split('\n')) {
      const parsed = parseActivityLine(line, day);
      if (!parsed) continue;
      out.push({
        at: parsed.at, key: parsed.key, type: parsed.type, origin: 'bridge',
        region: parsed.type === 'msg.in' ? 'input' : 'output',
        nodes: [], n: {}, e: { dir: parsed.type === 'msg.in' ? 'in' : 'out' },
        data: {
          dir: parsed.type === 'msg.in' ? 'in' : 'out', name: '',
          text: parsed.text, truncated: true,
          ...(parsed.count ? { count: parsed.count, total: parsed.total } : {})
        },
        shadow: true, from: 'activity-log'
      });
    }
    return out;
  }

  /** 按事件类型把 data 补成页面要的样子（轨迹里只有编号和数字）。 */
  function fillData(ev, index) {
    const node = Array.isArray(ev.nodes) && ev.nodes.length ? ev.nodes[0] : null;
    const rec = node ? recordNode(recordIdOfUnit(node) ?? '', index) : null;
    const n = ev.n ?? {};
    const e = ev.e ?? {};
    switch (ev.type) {
      case 'remember':
      case 'update':
      case 'forget':
        return {
          node, unit: node, text: rec?.text ?? null, title: rec?.title ?? null,
          cat: rec?.cat ?? e.kind ?? null, clarityLabel: rec?.clarityLabel ?? null,
          deleted: ev.type === 'forget' || !rec,
          replaces: Array.isArray(ev.nodes) && ev.nodes.length > 1 ? ev.nodes[1] : null
        };
      case 'inject':
        return { ltm: (ev.nodes ?? []).slice(0, 50), chars: finite(n.chars), recall: e.recall ?? false, source: e.source ?? null };
      case 'wake':
        return { reason: e.reason ?? 'message' };
      case 'search':
      case 'recall':
        return { query: null, items: [], source: e.source ?? e.src ?? null, semantic: e.semantic ?? null, ms: finite(n.ms), hits: finite(n.items) };
      case 'recall.auto':
        return { tau: finite(n.tau), candidates: (ev.nodes ?? []).map((id) => ({ node: id })) };
      case 'decay.review':
        return { unit: node, rating: e.rating ?? null, before: null, after: { R: finite(n.R1) } };
      case 'tool':
        // 轨迹里存的是 MCP 全名，工具日志那边是短名：展示时统一成短名，
        // 否则同一种工具在回放里会以两个名字出现（筛也筛不出来）。
        return { tool: e.tool ? shortToolName(e.tool) : null, status: e.status ?? null, args: null };      case 'persona.appraisal':
        return { rating: e.rating ?? null };
      default:
        return {};
    }
  }

  /**
   * 重建一天的镜头。返回 { ok, day, key, events, partial, notes, counts }；
   * day 不合法时返回 { ok:false, error }（调用方回 400）。
   */
  function replay({ day, key = null, maxEvents = MAX_EVENTS } = {}) {
    const checked = checkDay(day);
    if (!checked.ok) return checked;
    const k = typeof key === 'string' && KEY_RE.test(key) ? key : null;
    const index = recordIndex();
    const trace = traceEvents(day);
    const notes = [];
    if (!trace.length) notes.push('这天没有轨迹文件：轨迹从星图上线那天开始记，更早的日子只能看到工具调用。');
    if (!readText(activityFile, { maxBytes: 1024 * 1024 })) notes.push('活动日志读不到，收发消息这一路是空的。');
    else notes.push('收发消息只能从活动日志还原（它只保留最后 500 行），正文还被截断到 80 字。');
    notes.push('聊天原文没有长期存档：回放只重建「当时被记下来过」的部分。');
    const raw = [...trace, ...toolEvents(day, trace), ...msgEvents(day)]
      .filter((ev) => (k ? ev.key === null || ev.key === k : true))
      .sort((a, b) => a.at - b.at)
      .slice(0, Math.max(1, Math.min(MAX_EVENTS, Math.round(Number(maxEvents) || MAX_EVENTS))));
    const events = raw.map((ev, i) => ({
      id: Number.isInteger(ev.id) && ev.from === 'trace' ? ev.id : SYNTH_ID_BASE + i,
      at: ev.at, type: ev.type, key: ev.key ?? null, origin: ev.origin ?? 'bridge',
      region: ev.region ?? regionFor(ev.type, ev.e?.tool),
      nodes: Array.isArray(ev.nodes) ? ev.nodes.slice(0, 50) : [],
      n: ev.n ?? {}, e: ev.e ?? {},
      data: ev.data ?? fillData(ev, index),
      shadow: ev.shadow === true, from: ev.from ?? 'trace'
    }));
    const counts = {};
    for (const ev of events) counts[ev.type] = (counts[ev.type] ?? 0) + 1;
    return {
      ok: true, day, key: k, events,
      partial: events.some((ev) => ev.from !== 'trace'),
      notes, counts,
      sources: {
        trace: trace.length,
        tool: events.filter((e) => e.from === 'tool-calls').length,
        msg: events.filter((e) => e.from === 'activity-log').length
      }
    };
  }

  return { checkDay, replay, version: 1 };
}
