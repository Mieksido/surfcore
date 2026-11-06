/**
 * 约定提醒（第 5 件）：从记忆档里认出「带明确未来时间的约定/计划」，到期那天主动提一句。
 *
 * 为什么单独一个模块：SurfCore 的 `memory-card.js` 早就有 `PROMISE_RE`（答应/约定/说好/以后…），
 * 但它只用来给记忆打 `kind='promise'` 标签 —— 那个标签会把「以后重装还能照着来」也算成约定。
 * 真正缺的是两样东西，都不在记忆卡里：
 *   1. **到期时间**。记忆记录没有 due 字段（`normalizeRecord` 是白名单，写回去会被丢掉），
 *      所以到期日必须在**摄取时**从正文里解析出来，再用相对创建时间做锚（「明天」到底是哪天，
 *      取决于这条记忆是哪天写下的），最后旁挂到角色目录的状态文件里。
 *   2. **到点提醒**。这是调度，不是存储。
 *
 * 边界：本模块只做「纯函数 + 一个旁挂 JSON 状态文件」，不碰桥接、不发消息、不写记忆档。
 * 发不发、发给谁、走哪条唤醒通道，全部由 `bridge.js` 决定。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const PROMISE_VERSION = 1;

/** 默认配置。entries 少、字段直白：改行为只需要改 `config.json` 的 `promiseWake` 段。 */
export const DEFAULT_PROMISE_CONFIG = {
  enabled: true,
  // 每天什么时候开始可以提醒。之前一律不提醒（避免半夜弹「今天到期」）。
  at: '10:00',
  // 到点提醒的**结束**时刻：过了这个钟点就不再发起新的约定唤醒。
  // 只有 `at` 是下限、没有上限的话，深夜跑 tick 照样会弹「今天到期」—— 那是闹钟，不是记事本。
  // 两个时刻相同视为「不限结束」（想让她半夜也能被约定叫醒时才这么配）。
  until: '22:00',
  // 每人每天最多被约定提醒几次。多条约定同一天到期时合成一条，这个上限管的是「不同会话」。
  maxPerDay: 3,
  // 到期后还给几天缓冲：当天没提成（对方没上线/在睡）可以顺延；过了就标 expired，不再打扰。
  graceDays: 2,
};

export function normalizePromiseConfig(input) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  // 光有 `\d{2}:\d{2}` 形状不够：`25:99` 也照样匹配，但那是个永远不会到的钟点。
  // 这里连范围一起校验，坏值回落默认值 —— 否则用户手改配置会静默变成「永不提醒」。
  const clock = (value, fallback) => {
    const text = String(value ?? '');
    const m = /^(\d{2}):(\d{2})$/.exec(text);
    return m && Number(m[1]) <= 23 && Number(m[2]) <= 59 ? text : fallback;
  };
  const at = clock(raw.at, DEFAULT_PROMISE_CONFIG.at);
  const until = clock(raw.until, DEFAULT_PROMISE_CONFIG.until);
  const num = (value, fallback, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  };
  return {
    enabled: raw.enabled !== false,
    at,
    until,
    maxPerDay: num(raw.maxPerDay, DEFAULT_PROMISE_CONFIG.maxPerDay, 0, 20),
    graceDays: num(raw.graceDays, DEFAULT_PROMISE_CONFIG.graceDays, 0, 14),
  };
}

/* ────────────────────────────── 提醒窗口 ────────────────────────────── */

function minutesOfDay(now) {
  const d = new Date(now);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * 现在这个钟点允许发起约定提醒吗？
 *
 * `at` 是下限、`until` 是上限，**闭开区间** `[at, until)`。两个值相同视为不限结束。
 * 跨零点的写法（`at: '22:00', until: '02:00'`）也支持 —— 那种配置等于「晚上才提」。
 *
 * 为什么单独拆出来：到点闸门以前只有下限，深夜跑 tick 照样弹「今天到期」。
 * 这种 bug 只在半夜出现，靠联调很难撞上，所以必须用纯函数钉死。
 */
export function inReminderWindow(now = Date.now(), config = DEFAULT_PROMISE_CONFIG) {
  const cfg = normalizePromiseConfig(config);
  if (cfg.at === cfg.until) return true;
  const [ah, am] = cfg.at.split(':').map(Number);
  const [uh, um] = cfg.until.split(':').map(Number);
  const start = ah * 60 + am;
  const end = uh * 60 + um;
  const m = minutesOfDay(now);
  return start < end ? (m >= start && m < end) : (m >= start || m < end);
}

/* ────────────────────────────── 日期解析 ────────────────────────────── */

const CN_DIGIT = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 「二十三」「三十一」「7」→ 数字。只覆盖 0~99，约定里不会出现更大的数。 */
export function parseNumber(text) {
  const s = String(text ?? '').trim();
  if (!s) return NaN;
  if (/^\d{1,3}$/.test(s)) return Number(s);
  if (s === '十') return 10;
  const idx = s.indexOf('十');
  if (idx >= 0) {
    const head = idx === 0 ? 1 : CN_DIGIT[s[idx - 1]];
    const tail = idx === s.length - 1 ? 0 : CN_DIGIT[s[idx + 1]];
    if (head === undefined || tail === undefined) return NaN;
    return head * 10 + tail;
  }
  if (s.length === 1 && CN_DIGIT[s] !== undefined) return CN_DIGIT[s];
  return NaN;
}

const WEEKDAY = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 };

/** 番剧/电影的月份词（「七月新番」「10月上映」）不是约定。只在月份型日期上生效。 */
const DATE_NOISE_RE = /新番|番剧|季番|上映|定档|预告|PV|票房/;

const NUM = '\\d{1,2}|[一二两三四五六七八九十]{1,3}';

/**
 * 到期表达式表。**只认明确的未来时间词**：
 * 不加「下次」「以后」这种没有具体日子的说法 —— 它们永远算不出 due，加了只会天天误报。
 * 顺序有意义：先长后短（「大后天」要在「后天」之前）。
 */
const DUE_PATTERNS = [
  { kind: 'day', re: new RegExp(`大后天`) , delta: 3 },
  { kind: 'day', re: new RegExp(`后天`), delta: 2 },
  { kind: 'day', re: new RegExp(`明晚|明天晚上|明日晚上`), delta: 1 },
  { kind: 'day', re: new RegExp(`明天|明日`), delta: 1 },
  { kind: 'day', re: new RegExp(`今晚|今天晚上`), delta: 0 },
  { kind: 'week', re: new RegExp(`(下下|下)?(?:周|星期|礼拜)\\s*([一二三四五六日天1-7])`) },
  { kind: 'monthday', re: new RegExp(`(?:下个?月)?\\s*(${NUM})\\s*月\\s*(${NUM})\\s*[日号]`) },
  { kind: 'nextmonth', re: new RegExp(`下个?月\\s*(${NUM})\\s*[日号]?`) },
  { kind: 'afterdays', re: new RegExp(`(${NUM})\\s*(?:天|日)\\s*(?:后|以后|之后)`) },
];

function pad2(n) { return String(n).padStart(2, '0'); }
function dateKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function atMidnight(d) { const c = new Date(d.getTime()); c.setHours(0, 0, 0, 0); return c; }
function addDays(d, n) { const c = atMidnight(d); c.setDate(c.getDate() + n); return c; }
/** 周一为一周第一天，和 `Date#getDay()`（周日=0）错开。 */
function isoWeekday(d) { const w = d.getDay(); return w === 0 ? 7 : w; }

/**
 * 从一句话里认出到期日。
 * @param {string} text 记忆正文（title + text 都行，调用方自己拼）
 * @param {{ anchor?: number|string|Date }} opts `anchor` = 这条记忆**写下**的时间。
 *   「明天」到底是哪一天只能靠它算 —— 拿读档时间当锚，早年的约定会全部算成今天到期。
 * @returns {null | { date: string, dueText: string, kind: string }} 日期是本地时区的 `YYYY-MM-DD`
 */
export function parseDue(text, { anchor } = {}) {
  const body = String(text ?? '');
  if (!body) return null;
  const base = anchor instanceof Date ? anchor : new Date(anchor ?? Date.now());
  if (Number.isNaN(base.getTime())) return null;
  const today = atMidnight(base);
  for (const rule of DUE_PATTERNS) {
    const m = body.match(rule.re);
    if (!m) continue;
    const dueText = m[0].trim();
    if (!dueText) continue;
    if (rule.kind === 'monthday' || rule.kind === 'nextmonth') {
      // 「七月新番」「10月上映」不是约定，别拿它当到期日。
      const tail = body.slice(m.index + dueText.length, m.index + dueText.length + 6);
      if (DATE_NOISE_RE.test(dueText) || DATE_NOISE_RE.test(tail)) continue;
    }
    let date = null;
    if (rule.kind === 'day') {
      date = addDays(today, rule.delta);
    } else if (rule.kind === 'week') {
      const target = WEEKDAY[m[2]];
      if (!target) continue;
      const base2 = today;
      const cur = isoWeekday(base2);
      // 「下周X」= 下一个 ISO 周的 X；「周X/这周X」= 距今天最近的那一次（同一天算下一周，避免当天补一句）。
      if (m[1] === '下下') {
        date = addDays(base2, (8 - cur) + 7 + (target - 1));
      } else if (m[1] === '下') {
        date = addDays(base2, (8 - cur) + (target - 1));
      } else {
        let delta = (target - cur + 7) % 7;
        if (delta === 0) delta = 7;
        date = addDays(base2, delta);
      }
    } else if (rule.kind === 'monthday') {
      const month = parseNumber(m[1]);
      const day = parseNumber(m[2]);
      if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) continue;
      const candidate = new Date(base.getFullYear(), month - 1, day);
      if (Number.isNaN(candidate.getTime())) continue;
      // 日期越界（2 月 31 日）会被 Date 滚到下个月，这里挡掉。
      if (candidate.getMonth() !== month - 1) continue;
      // 已经过去的月份/日子按明年算：说「3 月 5 日」时如果现在是 11 月，指的是明年。
      date = candidate.getTime() < today.getTime() ? new Date(base.getFullYear() + 1, month - 1, day) : candidate;
    } else if (rule.kind === 'nextmonth') {
      const day = parseNumber(m[1]);
      if (!(day >= 1 && day <= 31)) continue;
      const candidate = new Date(base.getFullYear(), base.getMonth() + 1, day);
      if (Number.isNaN(candidate.getTime())) continue;
      date = candidate;
    } else if (rule.kind === 'afterdays') {
      const days = parseNumber(m[1]);
      if (!(days >= 1 && days <= 365)) continue;
      date = addDays(today, days);
    }
    if (!date) continue;
    // 算出来比「写下这天」还早的，只可能是解析错（比如「明天」被锚成了过去），丢掉。
    if (date.getTime() < today.getTime()) continue;
    return { date: dateKey(date), dueText, kind: rule.kind };
  }
  return null;
}

/* ────────────────────────────── 记录 → 约定 ────────────────────────────── */

/** 记忆记录该投递到哪个会话。`conversationKey` 是首选；老记录只有 groupId 时兜一个。 */
export function promiseKeyOf(record) {
  const key = typeof record?.conversationKey === 'string' ? record.conversationKey.trim() : '';
  if (/^(group|private):\d+$/.test(key)) return key;
  const group = String(record?.groupId ?? '').trim();
  if (/^\d+$/.test(group)) return `group:${group}`;
  return '';
}

/**
 * 从记忆记录里筛出「带到期日的约定」。**不需要再看 `kind`**：
 * `kind='promise'` 是正文命中承诺词的副产品，会把无关内容也算进来；这里以「能不能算出 due」为准。
 * @returns {Array<{id,key,text,title,dueDate,dueText,kind,createdAt}>}
 */
export function promiseCandidates(records, { now = Date.now() } = {}) {
  const out = [];
  for (const record of Array.isArray(records) ? records : []) {
    const id = String(record?.id ?? '').trim();
    if (!id) continue;
    const text = String(record?.text ?? '').trim();
    const title = String(record?.title ?? '').trim();
    if (!text && !title) continue;
    const key = promiseKeyOf(record);
    if (!key) continue; // 不知道该发给谁 —— 宁可漏，不猜。
    const created = Date.parse(String(record?.createdAt ?? ''));
    const anchor = Number.isFinite(created) ? created : now;
    const due = parseDue(`${title}\n${text}`, { anchor });
    if (!due) continue;
    out.push({
      id,
      key,
      text: text.slice(0, 200),
      title: title.slice(0, 80),
      dueDate: due.date,
      dueText: due.dueText,
      kind: due.kind,
      createdAt: Number.isFinite(created) ? new Date(created).toISOString() : '',
    });
  }
  return out;
}

/* ────────────────────────────── 旁挂状态 ────────────────────────────── */

export function emptyLedger() {
  return { version: PROMISE_VERSION, updatedAt: '', items: {} };
}

function readJson(file, fallback = null) {
  try {
    let text = fs.readFileSync(file, 'utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function atomicWriteJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch {}
    throw error;
  }
}

/** 状态文件路径：跟着当前角色走（和 `purpose-outreach.json` 同一层次）。 */
export function ledgerPathFor(characterDir) {
  return path.join(characterDir, 'promise-due.json');
}

export function loadLedger(file) {
  const raw = readJson(file, null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyLedger();
  const items = {};
  const src = raw.items && typeof raw.items === 'object' && !Array.isArray(raw.items) ? raw.items : {};
  for (const [id, item] of Object.entries(src)) {
    if (!item || typeof item !== 'object') continue;
    const dueDate = String(item.dueDate ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) continue;
    items[String(id)] = {
      id: String(id),
      key: String(item.key ?? ''),
      text: String(item.text ?? '').slice(0, 200),
      title: String(item.title ?? '').slice(0, 80),
      dueDate,
      dueText: String(item.dueText ?? ''),
      status: ['pending', 'done', 'missed', 'cancelled', 'expired'].includes(String(item.status))
        ? String(item.status) : 'pending',
      createdAt: String(item.createdAt ?? ''),
      firstSeenAt: String(item.firstSeenAt ?? ''),
      firedAt: String(item.firedAt ?? ''),
      firedDay: String(item.firedDay ?? ''),
      // 用户/模型确认后写一句备注，回看时知道为什么这条不再提。
      note: String(item.note ?? '').slice(0, 200),
      updatedAt: String(item.updatedAt ?? ''),
    };
  }
  return { version: PROMISE_VERSION, updatedAt: String(raw.updatedAt ?? ''), items };
}

export function saveLedger(file, ledger) {
  const out = { version: PROMISE_VERSION, updatedAt: new Date().toISOString(), items: { ...(ledger?.items ?? {}) } };
  atomicWriteJson(file, out);
  return out;
}

/**
 * 把记忆档里新出现的约定并进状态文件。已有条目**只更新文本，不重置 status/firedDay** ——
 * 否则每次扫档都会把「今天已经提过」的约定重新排一遍，变成反复打扰。
 * @returns {{ ledger, added: string[], refreshed: string[], kept: number }}
 */
export function syncLedger(ledger, records, { now = Date.now() } = {}) {
  const base = ledger && ledger.items ? ledger : emptyLedger();
  const items = { ...base.items };
  const candidates = promiseCandidates(records, { now });
  const added = [];
  const refreshed = [];
  let kept = 0;
  const stamp = new Date(now).toISOString();
  for (const item of candidates) {
    const prev = items[item.id];
    if (!prev) {
      items[item.id] = {
        ...item, status: 'pending', firstSeenAt: stamp, firedAt: '', firedDay: '', note: '', updatedAt: stamp,
      };
      added.push(item.id);
      continue;
    }
    kept += 1;
    // 正文被重新归并/改写后到期日可能变（比如「明天」那句被合并进新记录）：跟着正文走，
    // 但只在它没提过的时候才允许改 —— 提过的日子不能悄悄挪，不然会重复打扰。
    if (!prev.firedDay && (prev.text !== item.text || prev.dueDate !== item.dueDate)) {
      items[item.id] = { ...prev, ...item, updatedAt: stamp };
      refreshed.push(item.id);
    }
  }
  return { ledger: { version: PROMISE_VERSION, updatedAt: stamp, items }, added, refreshed, kept };
}

/** 今天该提醒谁：到期日已到、还在缓冲期、没提过、状态还是 pending。 */
export function dueItems(ledger, { key = '', today, graceDays = DEFAULT_PROMISE_CONFIG.graceDays, now = Date.now() } = {}) {
  const day = today || dateKey(new Date(now));
  const out = [];
  for (const item of Object.values(ledger?.items ?? {})) {
    if (item.status !== 'pending') continue;
    if (key && item.key !== key) continue;
    if (item.firedDay === day) continue;
    if (!(item.dueDate <= day)) continue;
    const late = deadlineOverdue(item.dueDate, day, graceDays);
    if (late) continue;
    out.push(item);
  }
  // 到期早的先提。
  return out.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}

/** 超过「到期日 + 缓冲天数」还没提成，就不再打扰。 */
export function deadlineOverdue(dueDate, today, graceDays = DEFAULT_PROMISE_CONFIG.graceDays) {
  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return true;
  const deadline = addDays(due, Math.max(0, Number(graceDays) || 0));
  const t = new Date(`${today}T00:00:00`);
  return t.getTime() > deadline.getTime();
}

/** 把到期的标成 expired（过缓冲期）。返回被改的 id。 */
export function expireStale(ledger, { today, graceDays = DEFAULT_PROMISE_CONFIG.graceDays, now = Date.now() } = {}) {
  const stamp = new Date(now).toISOString();
  const changed = [];
  for (const item of Object.values(ledger?.items ?? {})) {
    if (item.status !== 'pending') continue;
    if (!deadlineOverdue(item.dueDate, today, graceDays)) continue;
    item.status = 'expired';
    item.updatedAt = stamp;
    changed.push(item.id);
  }
  return changed;
}

/** 记「今天已经提醒过」。**先记后投**：投递失败也不重来，否则一个坏通道会每 60 秒刷一次。 */
export function markFired(ledger, ids, { now = Date.now() } = {}) {
  const stamp = new Date(now).toISOString();
  const day = dateKey(new Date(now));
  const changed = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    const item = ledger?.items?.[id];
    if (!item) continue;
    item.firedAt = stamp;
    item.firedDay = day;
    item.updatedAt = stamp;
    changed.push(id);
  }
  return changed;
}

/** 人工/模型确认状态。只允许 done / missed / cancelled / pending（pending = 撤回确认）。 */
export function setStatus(ledger, id, status, { note = '', now = Date.now() } = {}) {
  const item = ledger?.items?.[String(id ?? '')];
  if (!item) return null;
  if (!['pending', 'done', 'missed', 'cancelled'].includes(String(status))) return null;
  item.status = String(status);
  if (note) item.note = String(note).slice(0, 200);
  item.updatedAt = new Date(now).toISOString();
  if (item.status === 'pending') { item.firedDay = ''; item.firedAt = ''; }
  return item;
}

/* ────────────────────────────── 提示词 ────────────────────────────── */

const BY_LABEL = { owner: '主人答应的', self: '你答应的' };

/**
 * 唤醒提示词里的那一段。语气刻意写松：真人记着约定也不会像闹钟一样念编号和状态码。
 * 不写内部 id（模型念不出来，念了对方也不懂），只写「哪天、什么事」。
 */
export function promiseWakeText(items, { name = '主人', today } = {}) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return '';
  const head = today ? `【到期的约定】今天是 ${today}，你和${name}之前说好的事：` : `【到期的约定】你和${name}之前说好的事：`;
  const lines = list.slice(0, 5).map((item) => {
    const when = item.dueDate ? `（${item.dueDate}）` : '';
    const text = String(item.text || item.title || '').trim().slice(0, 120);
    return `- ${text}${when}`;
  });
  return [
    head,
    ...lines,
    '想提就自然地提一句，别像闹钟一样念日期；对方要是已经自己提了，就顺着接。',
    '如果这件事已经不成立了（对方说不做了/早做完了），回一句就行，不用道歉；下次不会再提它。',
  ].join('\n');
}

/** 给控制台看的紧凑摘要（不带长正文）。 */
export function ledgerSummary(ledger, { today, limit = 20 } = {}) {
  const day = today || dateKey(new Date());
  const items = Object.values(ledger?.items ?? {})
    .filter((item) => item.status === 'pending')
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0))
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      key: item.key,
      text: item.text,
      dueDate: item.dueDate,
      status: item.status,
      overdue: item.dueDate < day,
      firedToday: item.firedDay === day,
    }));
  return {
    pending: Object.values(ledger?.items ?? {}).filter((item) => item.status === 'pending').length,
    dueToday: Object.values(ledger?.items ?? {}).filter((item) => item.status === 'pending' && item.dueDate === day).length,
    items,
  };
}