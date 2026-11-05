// brain-feed.js · 实时脑图（/brain）的事件总线
//
// 从 B 项目（dsh-memory-brain）的 BRAIN_PATCH 移植，数据源换成 SurfCore 现成的：
// 记忆卡全量档（memory-card-full.jsonl）、memory-rag 检索、对话状态、人格层。
// B 那边的规格文档（docs/design/BRAIN_LIVE_SPEC.md、worker-kit/brain/contract.md）这边没有，
// 所以约定就写在这里：端点形状见 bridge.js 的 /api/brain/*，事件类型见下面的 TYPE_REGION，
// 轨迹字段白名单见 filterTraceRecord。
//
// 这条通道是**只读**的旁路：每用到一个记忆模块，桥接就 emit 一个事件。为了让主路径零影响：
//   - emit 同步、不抛、不 await；挂点自己出错只告警一次；
//   - 没有页面连着时不组装原文（payload.data 可以是函数，只有 active() 时才调用）；
//   - 原文只在内存（环形缓冲 + SSE）；落盘的轨迹只有编号和数字，写入前过显式白名单
//     （filterTraceRecord，测试直接测它）。删存档时自然删不到原文副本——因为根本没有副本。
//
// 与 B 的差异：B 用 tapLtm/tapDecay 包装 long-memory / memory-decay 两个「对象形状」的模块；
// SurfCore 没有这两个模块，挂点改成在 bridge.js 的调用点上显式 emit（所以这里没有包装器）。
import fs from 'node:fs';
import path from 'node:path';
import {
  FREEZE_BELOW, clarityLabelOf, clarityOf, decayCurveFor, memoryUnitId, protectedRecord, recordFidelity, recordIdOfUnit
} from './brain-decay.js';
import { strengthOf } from './memory-strength.js';

const DAY = 86400000;

// ── 白名单常量（约定 §2 / §3 / §6） ─────────────────────────────────────────
export const NODE_RE = /^(ltm|chunk|sum|ent|note|diary|msg|persona):[A-Za-z0-9:_.\-]{1,80}$/;
// 会话键：QQ 私聊/群、DSH 桌面、桌宠。SurfCore 的私聊键就是 private:<QQ>；
// desktop:/pet: 也一起收，否则那些记忆在星图上会被当成「没有归属」。
export const KEY_RE = /^(private|group|desktop|pet):[A-Za-z0-9_.\-]{1,32}$/;
const ENUM_RE = /^[a-z0-9._-]{1,32}$/;
export const ORIGINS = Object.freeze(['ai', 'bridge', 'console']);
export const REGIONS = Object.freeze(['input', 'vision', 'audio', 'working', 'hippo', 'graph', 'ltm', 'core', 'decay', 'limbic', 'life', 'output', 'introspect']);

/** 事件类型 → 脑区（约定 §3）。tool 按工具名另算（regionFor）。 */
export const TYPE_REGION = Object.freeze({
  'msg.in': 'input',
  'msg.out': 'output',
  wake: 'working',
  inject: 'output',
  search: 'core',
  recall: 'core',
  remember: 'hippo',
  update: 'hippo',
  forget: 'decay',
  'decay.review': 'decay',
  'recall.auto': 'core',
  'life.ownLife': 'life',
  'life.recall': 'life',
  'life.assoc': 'life',
  'life.promiseDue': 'life',
  'suggest.shown': 'introspect',
  'suggest.adopted': 'introspect',
  'persona.appraisal': 'limbic',
  'persona.nightly': 'introspect',
  'rag.index': 'hippo',
  'rag.distill': 'hippo',
  tool: 'output'
});
export const EVENT_TYPES = Object.freeze(Object.keys(TYPE_REGION));
const TYPE_SET = new Set(EVENT_TYPES);

const N_KEYS = new Set(['ms', 'items', 'chars', 'added', 'total', 'remainingSlots', 'score', 'tau', 'intensity', 'salience', 'R0', 'R1', 'S0', 'S1', 'rank']);
// BRAIN_PATCH（返工 A2）：加 recall / suggest —— inject 事件的两个布尔，回放从轨迹的 e 里读（约定 §6）。
const E_KEYS = new Set(['src', 'semantic', 'rating', 'kind', 'reason', 'dir', 'source', 'inject', 'pass', 'status', 'tool', 'recall', 'suggest']);

/** tool 事件的脑区：图片 / 表情 → vision；语音 → audio；短期记忆 → working；其它 → output。 */
export function toolRegion(name) {
  // 桥接送进来的是完整工具名，MCP 工具长这样：mcp__snowluma__qq_tts_voice。
  // 只认最后一段，否则所有 MCP 工具都掉进 output —— 视觉/听觉扇区会永远是空的。
  const n = String(name ?? '').split('__').pop() ?? '';
  if (n === 'qq_tts_voice' || n === 'send_voice' || /(^|_)send_voice$/.test(n)) return 'audio';
  if (/^qq_memory_/.test(n)) return 'working';
  if (/image|sticker|emoji|face/i.test(n)) return 'vision';
  return 'output';
}

export function regionFor(type, toolName) {
  if (type === 'tool') return toolRegion(toolName);
  return TYPE_REGION[type] ?? 'working';
}

/** 编号列表：只留合法编号、去重、≤ 50 个。 */
export function cleanNodes(list) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const raw of list) {
    if (typeof raw !== 'string' || !NODE_RE.test(raw) || out.includes(raw)) continue;
    out.push(raw);
    if (out.length >= 50) break;
  }
  return out;
}

/**
 * 轨迹行的显式白名单过滤（约定 §6）。不合规的字段一律丢掉；
 * 顶层缺了 id / at / type 这种必需项时整行丢掉（返回 null）。
 * msg.in / msg.out 不写轨迹（回放直接读存档），这里也返回 null。
 */
export function filterTraceRecord(rec) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
  if (!Number.isInteger(rec.id) || !Number.isInteger(rec.at)) return null;
  if (typeof rec.type !== 'string' || !TYPE_SET.has(rec.type)) return null;
  if (rec.type === 'msg.in' || rec.type === 'msg.out') return null;
  const out = { id: rec.id, at: rec.at, type: rec.type };
  out.key = typeof rec.key === 'string' && KEY_RE.test(rec.key) ? rec.key : null;
  if (ORIGINS.includes(rec.origin)) out.origin = rec.origin;
  out.nodes = cleanNodes(rec.nodes);
  if (rec.n && typeof rec.n === 'object' && !Array.isArray(rec.n)) {
    const n = {};
    for (const [k, v] of Object.entries(rec.n)) {
      if (!N_KEYS.has(k)) continue;
      if (k === 'rank') {
        if (Array.isArray(v) && v.length <= 50 && v.every((x) => typeof x === 'number' && Number.isFinite(x))) n.rank = v.slice();
        continue;
      }
      if (typeof v === 'number' && Number.isFinite(v)) n[k] = v;
    }
    if (Object.keys(n).length) out.n = n;
  }
  if (rec.e && typeof rec.e === 'object' && !Array.isArray(rec.e)) {
    const e = {};
    for (const [k, v] of Object.entries(rec.e)) {
      if (!E_KEYS.has(k)) continue;
      if (typeof v === 'boolean' || (typeof v === 'string' && ENUM_RE.test(v))) e[k] = v;
    }
    if (Object.keys(e).length) out.e = e;
  }
  if (typeof rec.shadow === 'boolean') out.shadow = rec.shadow;
  return out;
}

const pad2 = (n) => String(n).padStart(2, '0');
/** 本地日期 YYYY-MM-DD。 */
export function localDay(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function shiftDay(ts, delta) {
  const d = new Date(ts);
  return localDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta).getTime());
}

const clipChars = (s, n) => {
  const chars = [...String(s ?? '')];
  return chars.length > n ? chars.slice(0, n).join('') : chars.join('');
};

/** 面板载荷：字符串一律截到 300 字并去掉已知令牌；深度与数组长度有上限，防止意外的大对象。 */
function clipData(value, redact, depth = 0) {
  if (typeof value === 'string') {
    let s = value;
    try { s = String(redact(s)); } catch { /* redact 出错就用原样（它只是纵深防御） */ }
    return clipChars(s, 300);
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return Number.isNaN(value) ? null : value;
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') return undefined;
  if (depth > 5) return null;
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => clipData(v, redact, depth + 1)).map((v) => (v === undefined ? null : v));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const c = clipData(v, redact, depth + 1);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  return undefined;
}

export function createBrainFeed({
  log = () => {},
  now = () => Date.now(),
  bufferSize = 300,
  maxClients = 4,
  stateDir = null,
  isEnabled = () => true,
  redact = (s) => s,
  pingMs = 15000,
  retentionDays = 7
} = {}) {
  const nowMs = () => {
    try {
      const t = Number(now());
      return Number.isFinite(t) ? t : Date.now();
    } catch { return Date.now(); }
  };
  const enabled = () => {
    try { return isEnabled() !== false; } catch { return false; }
  };
  const traceDir = stateDir ? path.join(stateDir, 'brain', 'trace') : null;

  let seq = 0;
  const buffer = [];
  const clients = new Set();
  // 今天各脑区的事件数（快照用）。启动时从今天的轨迹补一次；msg.* 不写轨迹，只在内存里数。
  let countsDay = '';
  let counts = {};

  const warned = new Set();
  function warnOnce(tag, error) {
    if (warned.has(tag)) return;
    warned.add(tag);
    // 只写类别：错误信息里可能带路径，但不会带原文（原文从不进这条路径）。
    try { log(`[brain] ${tag}失败（只提示一次）：${error?.code ?? error?.name ?? 'error'}`); } catch { /* 日志也坏了就算了 */ }
  }

  function bump(region, at) {
    const day = localDay(at);
    if (day !== countsDay) { countsDay = day; counts = {}; }
    counts[region] = (counts[region] ?? 0) + 1;
  }

  function loadTodayCounts() {
    try {
      const t = nowMs();
      countsDay = localDay(t);
      counts = {};
      if (!traceDir) return;
      let text = '';
      try { text = fs.readFileSync(path.join(traceDir, `${countsDay}.jsonl`), 'utf8'); } catch { return; }
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let rec;
        try { rec = JSON.parse(line); } catch { continue; }
        if (!rec || !TYPE_SET.has(rec.type)) continue;
        // 轨迹里的 id 是上一次进程的；本进程从 1 开始（约定 §4.1），这里只数脑区、不续号。
        const r = regionFor(rec.type, rec.e?.tool);
        counts[r] = (counts[r] ?? 0) + 1;
      }
    } catch (e) { warnOnce('读今天的轨迹计数', e); }
  }

  function writeTrace(rec) {
    if (!traceDir) return;
    const clean = filterTraceRecord(rec);
    if (!clean) return;
    try {
      fs.mkdirSync(traceDir, { recursive: true, mode: 0o700 });
      fs.appendFileSync(path.join(traceDir, `${localDay(clean.at)}.jsonl`), JSON.stringify(clean) + '\n', { encoding: 'utf8', mode: 0o600 });
    } catch (e) {
      warnOnce('写轨迹', e);
    }
  }

  /** 删掉更早的轨迹：只留今天和往前 retentionDays-1 天（共 retentionDays 天，与回放的 7 天窗口一致）。 */
  function cleanupTrace() {
    if (!traceDir) return 0;
    let removed = 0;
    try {
      const oldest = shiftDay(nowMs(), -(retentionDays - 1));
      let names = [];
      try { names = fs.readdirSync(traceDir); } catch { return 0; }
      for (const name of names) {
        const m = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
        if (!m || m[1] >= oldest) continue;
        try { fs.unlinkSync(path.join(traceDir, name)); removed += 1; } catch (e) { warnOnce('清理轨迹', e); }
      }
    } catch (e) { warnOnce('清理轨迹', e); }
    return removed;
  }

  function active() { return clients.size > 0 && enabled(); }

  function clientWants(client, ev) {
    return !client.key || ev.key === null || ev.key === client.key;
  }

  function writeClient(client, text) {
    try { client.res.write(text); } catch (e) { dropClient(client); }
  }

  function sendEvent(client, ev) {
    writeClient(client, `id: ${ev.id}\nevent: brain\ndata: ${JSON.stringify(ev)}\n\n`);
  }

  function dropClient(client) {
    if (!clients.has(client)) return;
    clients.delete(client);
    try { clearInterval(client.ping); } catch {}
    try { client.res.end(); } catch {}
  }

  /**
   * 发一个事件。payload：{ key, origin, nodes, n, e, shadow, tool, data }，
   * data 可以是函数（只有页面连着时才调用）。返回事件 id；关着 / 出错返回 null。绝不抛。
   */
  function emit(type, payload = {}) {
    try {
      if (!enabled()) return null;
      if (!TYPE_SET.has(type)) return null;
      const p = payload && typeof payload === 'object' ? payload : {};
      const at = Math.round(nowMs());
      const id = ++seq;
      const key = typeof p.key === 'string' && KEY_RE.test(p.key) ? p.key : null;
      const origin = ORIGINS.includes(p.origin) ? p.origin : 'bridge';
      const nodes = cleanNodes(p.nodes);
      const toolName = type === 'tool' ? String(p.tool ?? '') : '';
      const region = regionFor(type, toolName);
      bump(region, at);
      const shadow = p.shadow === true;
      writeTrace({ id, at, type, key, origin, nodes, n: p.n, e: p.e, ...(shadow ? { shadow: true } : {}) });
      if (!active()) return id;
      let data = {};
      try {
        const raw = typeof p.data === 'function' ? p.data() : p.data;
        data = clipData(raw ?? {}, redact) ?? {};
      } catch (e) {
        warnOnce(`组装 ${type} 载荷`, e);
        data = {};
      }
      const ev = { id, at, type, key, origin, region, nodes, data, ...(shadow ? { shadow: true } : {}) };
      buffer.push(ev);
      while (buffer.length > bufferSize) buffer.shift();
      for (const client of [...clients]) if (clientWants(client, ev)) sendEvent(client, ev);
      return id;
    } catch (e) {
      warnOnce('发事件', e);
      return null;
    }
  }

  /**
   * SSE（约定 §4.3）。调用方已经做完鉴权与开关判断；headers 是控制台同款安全头。
   * 第 5 个连接回 429。
   */
  function handleEvents(req, res, { key = null, lastEventId = null, headers = {} } = {}) {
    if (clients.size >= maxClients) {
      res.writeHead(429, { 'content-type': 'application/json; charset=utf-8', ...headers });
      res.end(JSON.stringify({ ok: false, error: `实时脑图同时最多 ${maxClients} 个连接` }));
      return null;
    }
    const k = typeof key === 'string' && KEY_RE.test(key) ? key : null;
    res.writeHead(200, {
      ...headers,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive'
    });
    const client = { res, key: k, ping: null };
    clients.add(client);
    try { req.socket?.setTimeout?.(0); } catch {}
    writeClient(client, 'retry: 3000\n\n');
    // hello 里的 enabled 要说真话：页面靠它决定显示「实时」还是「已关闭」。
    writeClient(client, `event: hello\ndata: ${JSON.stringify({ enabled: enabled(), lastId: seq })}\n\n`);
    const last = Number(lastEventId);
    if (lastEventId !== null && lastEventId !== undefined && lastEventId !== '' && Number.isFinite(last)) {
      for (const ev of buffer) if (ev.id > last && clientWants(client, ev)) sendEvent(client, ev);
    }
    client.ping = setInterval(() => {
      // 开关被手改（config.json）时，最迟一次心跳内断开（POST 接口会立刻断开）。
      if (!enabled()) { closeAll(); return; }
      writeClient(client, ': ping\n\n');
    }, pingMs);
    client.ping.unref?.();
    const cleanup = () => dropClient(client);
    req.on?.('close', cleanup);
    res.on?.('close', cleanup);
    res.on?.('error', cleanup);
    return client;
  }

  /**
   * 删除跟随：从环形缓冲删掉含这些编号的事件；reload 且给了会话时，该会话的
   * msg.* / search / persona.appraisal 事件全删（页面重拉快照）。再通知所有相关页面。
   */
  function drop({ nodes = [], key = null, reload = false } = {}) {
    try {
      const ids = new Set(cleanNodes(nodes));
      const k = typeof key === 'string' && KEY_RE.test(key) ? key : null;
      const reloadTypes = new Set(['msg.in', 'msg.out', 'search', 'persona.appraisal']);
      for (let i = buffer.length - 1; i >= 0; i -= 1) {
        const ev = buffer[i];
        const hit = ev.nodes.some((n) => ids.has(n));
        const wipe = reload && k && ev.key === k && reloadTypes.has(ev.type);
        if (hit || wipe) buffer.splice(i, 1);
      }
      if (!clients.size) return;
      const text = `event: drop\ndata: ${JSON.stringify({ nodes: [...ids], key: k, reload: reload === true })}\n\n`;
      for (const client of [...clients]) {
        if (!client.key || !k || client.key === k) writeClient(client, text);
      }
    } catch (e) { warnOnce('删除跟随', e); }
  }

  function closeAll() {
    for (const client of [...clients]) dropClient(client);
  }

  function regionCounts() {
    const today = localDay(nowMs());
    if (today !== countsDay) { countsDay = today; counts = {}; }
    const out = {};
    for (const r of REGIONS) out[r] = counts[r] ?? 0;
    return out;
  }

  // ── 快照（约定 §5.4） ──────────────────────────────────────────────────────
  const CAP = 2000;
  const capLatest = (list, cap = CAP) => {
    const sorted = [...list].sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));
    return { kept: sorted.slice(0, cap), cut: Math.max(0, sorted.length - cap) };
  };

  /** memory-card 的 kind → 星图扇区。SurfCore 实际只有这几种，认不出来的一律归 other。 */
  const CATS = new Set(['owner', 'event', 'promise', 'firstMeet']);
  const catOf = (record) => {
    const k = String(record?.kind ?? '');
    if (CATS.has(k)) return k;
    const tags = Array.isArray(record?.tags) ? record.tags : [];
    if (tags.includes('owner')) return 'owner';
    return 'other';
  };

  const firstTime = (...vals) => {
    for (const v of vals) {
      // 数字就是毫秒时间戳：Date.parse('1756…') 只会给 NaN，
      // 而 NaN 会让「留最新 2000 条」变成随机砍 —— 顺手认数字，别埋这个雷。
      if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
      const t = Date.parse(String(v ?? ''));
      if (Number.isFinite(t)) return t;
    }
    return 0;
  };
  const numOr = (v, dflt) => (Number.isFinite(Number(v)) ? Number(v) : dflt);

  /**
   * 组装快照。数据全部由调用方读好传进来（测试因此不用碰盘）；任何一块出错只少那一块。
   * records = readAllFullRecords()（全量记忆卡）；config = memory-card 配置；
   * keys = 认得的会话键（private:/group:/desktop:/pet）；persona = 人格层的摘要；rag = 向量检索状态。
   */
  function snapshot({ records = [], config = {}, persona = null, rag = 'off', keys = [], labelFor = null, freezeBelow = FREEZE_BELOW, key = null } = {}) {
    const k = typeof key === 'string' && KEY_RE.test(key) ? key : null;
    const nodes = [];
    const truncated = { ltm: 0, persona: 0 };
    try {
      const all = [];
      for (const r of records) {
        if (!r?.id) continue;
        const ck = typeof r.conversationKey === 'string' && KEY_RE.test(r.conversationKey) ? r.conversationKey : null;
        if (k && ck !== k) continue;
        let exempt = false;
        let R = 1;
        let strength = null;
        try {
          strength = strengthOf(r, { now: nowMs(), config, freezeBelow });
          exempt = strength.protected === true;
          R = strength.R;
        } catch { strength = null; exempt = false; R = 1; }
        if (!strength) { try { exempt = protectedRecord(r, config); R = recordFidelity(r); } catch { exempt = false; R = 1; } }
        all.push({
          id: memoryUnitId(r.id), kind: 'ltm', key: ck,
          at: firstTime(r.lastSeenAt, r.createdAt),
          label: clipChars(r.title || r.text, 40),
          text: String(r.text ?? ''), title: String(r.title ?? ''), cat: catOf(r),
          scope: typeof r.scope === 'string' ? r.scope : null,
          platform: typeof r.platform === 'string' ? r.platform : null,
          speaker: String(r.speaker ?? ''), groupName: String(r.groupName ?? ''),
          importance: numOr(r.importance, 0), recallCount: numOr(r.recallCount, 0),
          clarity: clarityOf(r), clarityLabel: clarityLabelOf(clarityOf(r)),
          createdAt: r.createdAt ?? null, lastSeenAt: r.lastSeenAt ?? null,
          tags: Array.isArray(r.tags) ? r.tags.slice(0, 8).map(String) : [],
          pinned: !!r.pinned, initial: !!r.isInitial, archived: !!r.archivedAt,
          // 页面只读 decay.R / frozen / exempt 来定大小和亮度；S/D 给时间推演面板和悬浮提示用
          decay: {
            R,
            S: strength ? strength.S : null,
            D: strength ? strength.D : null,
            label: strength ? strength.label : null,
            frozen: R < freezeBelow && !exempt,
            exempt
          }
        });
      }
      const c = capLatest(all);
      nodes.push(...c.kept);
      truncated.ltm = c.cut;
    } catch (e) { warnOnce('快照（记忆卡）', e); }

    // 人格层：只给层名和字数，不给正文（人格卡的正文本来就属于敏感内容）
    try {
      for (const layer of persona?.layers ?? []) {
        nodes.push({
          id: `persona:${layer.key}`, kind: 'persona', key: null, at: numOr(layer.updatedAt, 0),
          label: clipChars(layer.name || layer.key, 40), name: String(layer.name ?? ''), chars: numOr(layer.chars, 0)
        });
      }
    } catch (e) { warnOnce('快照（人格层）', e); }

    const keyList = [];
    for (const kk of keys) {
      const s = String(kk ?? '');
      if (!KEY_RE.test(s) || keyList.some((x) => x.key === s)) continue;
      let label = s;
      try { label = (labelFor ? labelFor(s) : null) || s; } catch { label = s; }
      keyList.push({ key: s, kind: s.split(':')[0], label });
    }
    keyList.sort((a, b) => a.key.localeCompare(b.key));
    return { ok: true, at: Math.round(nowMs()), rag, keys: keyList, nodes, links: [], regions: regionCounts(), truncated, freezeBelow };
  }

  // ── 遗忘曲线（/api/brain/decay-curve） ─────────────────────────────────────
  /**
   * unit：ltm:<记忆 id>。findRecord(id) → 全量档里的那条记录；找不到返回 null（调用方回 404）。
   * R/S/D 走 src/memory-strength.js 的强度分（卡面清晰度只当上界用），曲线见 decayCurveFor。
   */
  function decayCurve({ unit, findRecord = null, config = {}, days = 365 } = {}) {
    const id = recordIdOfUnit(unit);
    if (!id) return null;
    let record = null;
    try { record = findRecord ? findRecord(id) : null; } catch { record = null; }
    if (!record) return null;
    const curve = decayCurveFor(record, { now: nowMs(), config, days });
    return Object.assign({ unit: memoryUnitId(id) }, curve);
  }

  loadTodayCounts();
  cleanupTrace();

  return {
    active, emit, handleEvents, snapshot, drop, closeAll, regionCounts, cleanupTrace, decayCurve,
    clients: () => clients.size,
    lastId: () => seq,
    bufferedEvents: () => buffer.slice()
  };
}
