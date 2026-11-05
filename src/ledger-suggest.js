/**
 * 建议候选（第 4 件）：把对方随口说出的「关于他自己的事」挑出来，在合适的唤醒里提醒她一句。
 *
 * 为什么不照搬 B 的 `ledger-suggest.js`：B 那边候选来自一个独立的 memory-rag `/notes` 抽取服务，
 * 桥接只负责「挑、拼、记次数、判采用」。SurfCore 没有那个服务，也不该为它再养一个 LLM 抽取管线 ——
 * 而且 SurfCore 的记忆卡**本来就是自动摄取**的（`ingestInboxLines`），不存在「要不要记」的动作。
 *
 * 所以这里换的是**通路**，不是目的：目的仍然是「重要的东西别漏掉」，做法是——
 *   1. 在入站消息里用高精度规则抽出「事实候选」（称呼/生日/忌口/过敏/喜好/住处/工作/宠物）；
 *   2. 只在**主人或直接对她说的私聊**里抽，群里不抽（群聊噪声大，抽错一句就是查户口）；
 *   3. 唤醒时最多提 `perWake` 条，带次数上限与保鲜期，提过就计数，别像登记表；
 *   4. 候选本身**不写记忆卡**：她顺着聊一句，这句话自然进 inbox，插件照常摄取 —— 零新写入通路。
 *
 * 边界：纯函数 + 一个旁挂 JSON 状态文件；不碰桥接、不发消息、不写记忆档。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const SUGGEST_VERSION = 1;

/** 默认配置。改行为只需要改 `config.json` 的 `ledgerSuggest` 段。 */
export const DEFAULT_SUGGEST_CONFIG = {
  enabled: true,
  // 一次唤醒最多提几条。1 是刻意的：同时提三条就像问卷。
  perWake: 1,
  // 一条候选最多被提几次；提满就作废，不再唠叨。
  maxShows: 2,
  // 保鲜期：超过这么多天的候选不再提（那时候接话已经晚了）。
  ttlDays: 14,
  // 每个会话每天最多提几条，防止一天里连着提。
  maxPerDay: 3,
  // 事实正文下限。1 是有意的：「我不吃辣」「我养了狗」这种一个字就是全部信息，
  // 卡在 2 会把它们全丢掉；精度靠规则锚点保证，不靠字数。
  minChars: 1,
};

export function normalizeSuggestConfig(input) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const num = (value, fallback, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  };
  return {
    enabled: raw.enabled !== false,
    perWake: num(raw.perWake, DEFAULT_SUGGEST_CONFIG.perWake, 0, 5),
    maxShows: num(raw.maxShows, DEFAULT_SUGGEST_CONFIG.maxShows, 1, 10),
    ttlDays: num(raw.ttlDays, DEFAULT_SUGGEST_CONFIG.ttlDays, 1, 90),
    maxPerDay: num(raw.maxPerDay, DEFAULT_SUGGEST_CONFIG.maxPerDay, 0, 20),
    minChars: num(raw.minChars, DEFAULT_SUGGEST_CONFIG.minChars, 1, 10),
  };
}

/* ────────────────────────────── 抽取 ────────────────────────────── */

/**
 * 抽取规则。**每条都要求一个人称/句式锚点**：没有锚点的「喜欢」「住在」会把
 * 「我喜欢你这么说」「我住在公司附近吗」这类也抓出来 —— 宁可漏，不可错。
 *
 * `fact` 是抽出来的宾语（会拼进提示词），`cat` 是给她的类别提示（不是数据库字段）。
 */
const RULES = [
  // 「以后叫我阿岚」「你可以叫我老师」
  { cat: '称呼', re: /(?:以后|你可以|可以|就)?叫我\s*([\u4e00-\u9fa5A-Za-z0-9]{1,10})/ },
  // 「我生日是 3 月 14 号」「生日 12 月 1 日」
  { cat: '生日', re: /生日(?:是|在|大概)?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/, fact: (m) => `${m[1]} 月 ${m[2]} 号` },
  // 「我不吃香菜」「我吃不了辣」「我戒了烟」
  { cat: '忌口', re: /我(?:真的|特别|一点都)?(?:不吃|吃不了|受不了|戒了)\s*([^，。！？,.!?\s]{1,12})/ },
  // 「我对芒果过敏」「我海鲜过敏」
  { cat: '过敏', re: /我(?:对)?\s*([^，。！？,.!?\s]{1,10})过敏/ },
  // 「我喜欢雨天」「我超爱看恐怖片」
  { cat: '喜好', re: /我(?:最|很|超|特别|真的|一直)?(?:喜欢|爱|迷上|偏爱)(?:了|着)?\s*([^，。！？,.!?\s]{2,14})/ },
  // 「我住在城南」「我搬到杭州了」
  { cat: '住处', re: /我(?:现在)?(?:住在|家住|搬到)\s*([^，。！？,.!?\s]{2,14})/ },
  // 「我在医院上班」「我在读高三」
  { cat: '工作', re: /我在\s*([^，。！？,.!?\s]{2,14}?)\s*(?:工作|上班|上学|读书|读研|实习)/ },
  // 「我养了只橘猫」「我家有只狗」
  { cat: '宠物', re: /我(?:家)?(?:养了|养|有)(?:一只|一条|两只|三只|只)?\s*([^，。！？,.!?\s]{0,4}?(?:猫|狗|仓鼠|兔子|鸟|鱼|龟|蛇|蜥蜴|蜘蛛))/ },
];

/** 问句、反问、第二人称的句子不当事实候选（「你喜欢什么？」不是他的偏好）。 */
const QUESTION_TAIL_RE = /(?:吗|呢|么|吧)\s*[？?]?\s*$/;
const ADDRESSED_TO_ME_RE = /(?:你|妳)(?:喜欢|爱|讨厌|觉得|想要)/;
const NOT_A_FACT_RE = /(?:吗|么|呢)\s*[？?]?$/;

function clip(text, max) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function compact(text) {
  return String(text ?? '').replace(/[\s，。！？,.!?~～…]+/g, '');
}

/** 抽出来的宾语常带口头尾巴（「阿岚就行」「雨天吧」），去掉再比较/展示。 */
function trimFact(text) {
  return String(text ?? '')
    .replace(/^[,，、\s]+/, '')
    .replace(/(?:就行|就好|好了|吧|啦|啊|呀|哦|噢|嘛|了|的|呢)+\s*$/, '')
    .trim();
}

function hash(text) {
  return crypto.createHash('sha1').update(String(text)).digest('hex').slice(0, 16);
}

/** 候选编号只由「类别 + 规范化后的事实」决定：同一件事说两遍还是同一条。 */
export function suggestIdOf(cat, fact) {
  return hash(`${cat}|${compact(fact)}`);
}

/**
 * 从一句话里抽事实候选。返回 `[{ id, cat, fact, evidence }]`，一旬一条、最多 3 条。
 * 纯函数：不读盘、不看时间（`at` 由调用方补）。
 */
export function extractFacts(text, { minChars = DEFAULT_SUGGEST_CONFIG.minChars } = {}) {
  const s = String(text ?? '').trim();
  if (!s || s.length < 4) return [];
  if (ADDRESSED_TO_ME_RE.test(s) && !/我(?:不|很|超|最|特别)/.test(s)) return [];
  const out = [];
  const seen = new Set();
  // 长句按标点切成小句：一句话里塞两件事时只取有锚点的那几截，避免整段进提示词。
  const clauses = s.split(/[。！？!?；;\n]+/).map((c) => c.trim()).filter(Boolean);
  for (const clause of clauses) {
    if (clause.length < 4) continue;
    if (QUESTION_TAIL_RE.test(clause) || NOT_A_FACT_RE.test(clause)) continue;
    for (const rule of RULES) {
      const m = rule.re.exec(clause);
      if (!m) continue;
      const fact = clip(rule.fact ? rule.fact(m) : trimFact(m[1] ?? ''), 24);
      if (!fact || compact(fact).length < minChars) continue;
      // 「喜欢」类要挡掉宾语是「你/他/她」的：那不是对方的喜好，是在说人。
      if (/^(?:你|妳|你们|他|她|他们|它)/.test(compact(fact))) continue;
      // 问句化的「我记得我住在哪里」不算事实：宾语里有疑问词就是没给答案。
      if (/(?:哪里|哪儿|什么|怎么|多少|哪个|哪家|谁|几)/.test(fact)) continue;
      const id = suggestIdOf(rule.cat, fact);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, cat: rule.cat, fact, evidence: clip(clause, 60) });
      if (out.length >= 3) return out;
    }
  }
  return out;
}

/* ────────────────────────────── 状态文件 ────────────────────────────── */

export function suggestPathFor(memoryDir) {
  return path.join(String(memoryDir), 'ledger-suggest.json');
}

export function emptySuggestState() {
  return { version: SUGGEST_VERSION, updatedAt: '', items: {} };
}

export function loadSuggest(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const state = emptySuggestState();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return state;
    state.version = Number(raw.version) || SUGGEST_VERSION;
    state.updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : '';
    const items = raw.items && typeof raw.items === 'object' && !Array.isArray(raw.items) ? raw.items : {};
    for (const [id, item] of Object.entries(items)) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const cat = typeof item.cat === 'string' ? item.cat : '';
      const fact = typeof item.fact === 'string' ? item.fact.trim() : '';
      if (!cat || !fact) continue;
      state.items[id] = {
        id,
        cat,
        fact: clip(fact, 24),
        evidence: clip(item.evidence ?? '', 60),
        key: typeof item.key === 'string' ? item.key : '',
        sender: typeof item.sender === 'string' ? clip(item.sender, 40) : '',
        at: Number(item.at) || 0,
        day: typeof item.day === 'string' ? item.day : '',
        shown: Math.max(0, Number(item.shown) || 0),
        lastShownDay: typeof item.lastShownDay === 'string' ? item.lastShownDay : '',
        status: ['open', 'expired', 'dismissed'].includes(item.status) ? item.status : 'open',
      };
    }
    return state;
  } catch {
    // 坏文件不抛：候选是可再生的，读不出来就当空的（下次观察会重新抽）。
    return emptySuggestState();
  }
}

export function saveSuggest(file, state) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const body = {
      version: SUGGEST_VERSION,
      updatedAt: new Date().toISOString(),
      items: state?.items && typeof state.items === 'object' ? state.items : {},
    };
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

function dayOf(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function daysBetween(fromDay, toDay) {
  const a = Date.parse(`${fromDay}T00:00:00`);
  const b = Date.parse(`${toDay}T00:00:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}

/* ────────────────────────────── 观察 / 挑选 ────────────────────────────── */

/**
 * 记下一条入站消息里的事实候选。已有同 id 的：
 * - `open` → 刷新 evidence/at（最近一次说法更贴近当下）；
 * - `dismissed` / `expired` → 不复活（她或用户已经表示过不需要，别再提）。
 */
export function observe(state, { text, key = '', sender = '', at = Date.now() } = {}, config = {}) {
  const cfg = normalizeSuggestConfig(config);
  if (!cfg.enabled) return [];
  const facts = extractFacts(text, { minChars: cfg.minChars });
  if (!facts.length) return [];
  const day = dayOf(at);
  const added = [];
  for (const fact of facts) {
    const existing = state.items[fact.id];
    if (existing && existing.status !== 'open') continue;
    if (existing) {
      existing.evidence = fact.evidence;
      existing.at = at;
      existing.day = day;
      if (key) existing.key = key;
      if (sender) existing.sender = sender;
      continue;
    }
    state.items[fact.id] = {
      id: fact.id, cat: fact.cat, fact: fact.fact, evidence: fact.evidence,
      key, sender: clip(sender, 40), at, day, shown: 0, lastShownDay: '', status: 'open',
    };
    added.push(fact.id);
  }
  return added;
}

/** 已经写在记忆卡里的（字面包含事实正文）就不用再提了。 */
function alreadyInCard(item, cardText) {
  const card = compact(cardText);
  if (!card) return false;
  const fact = compact(item.fact);
  return fact.length >= 2 && card.includes(fact);
}

/**
 * 挑这次唤醒要提的候选。**只读**：不改状态（一次唤醒里提示词会被建两遍，
 * 谁先改谁就把候选从真正投递的那份里抹掉 —— 2026-11-06 约定那条踩过）。
 *
 * 返回 `{ ids, items, text }`；`ids` 交给投递接受点再 `markShown`。
 */
export function planSuggest(state, { key = '', today = dayOf(Date.now()), config = {}, cardText = '' } = {}) {
  const cfg = normalizeSuggestConfig(config);
  if (!cfg.enabled || cfg.perWake === 0) return { ids: [], items: [], text: '' };
  const shownToday = Object.values(state.items).filter((it) => it.key === key && it.lastShownDay === today && it.shown > 0).length;
  const room = Math.max(0, cfg.maxPerDay - shownToday);
  if (room === 0) return { ids: [], items: [], text: '' };
  const eligible = Object.values(state.items)
    .filter((it) => it.status === 'open')
    .filter((it) => !key || it.key === key)
    .filter((it) => it.shown < cfg.maxShows)
    .filter((it) => daysBetween(it.day || today, today) <= cfg.ttlDays)
    .filter((it) => !alreadyInCard(it, cardText))
    .sort((a, b) => (b.at || 0) - (a.at || 0));
  const picked = eligible.slice(0, Math.min(cfg.perWake, room));
  return { ids: picked.map((it) => it.id), items: picked, text: suggestWakeText(picked) };
}

/** 投递被接受之后才计数：没投出去的不算「提过了」。 */
export function markShown(state, ids, { today = dayOf(Date.now()), config = {} } = {}) {
  const cfg = normalizeSuggestConfig(config);
  const list = Array.isArray(ids) ? ids : [];
  let changed = 0;
  for (const id of list) {
    const it = state.items[id];
    if (!it) continue;
    it.shown = Math.max(1, (Number(it.shown) || 0) + 1);
    it.lastShownDay = today;
    if (it.shown >= cfg.maxShows) it.status = 'expired';
    changed += 1;
  }
  return changed;
}

/** 作废一条候选（控制台用）。 */
export function dismissSuggestion(state, id) {
  const it = state.items[String(id ?? '')];
  if (!it) return false;
  it.status = 'dismissed';
  return true;
}

/** 清掉落灰的条目：过期 / 作废满 14 天、或从没见过天日的孤儿。 */
export function pruneSuggest(state, { today = dayOf(Date.now()), config = {}, keepDays = 14 } = {}) {
  const cfg = normalizeSuggestConfig(config);
  let removed = 0;
  for (const [id, it] of Object.entries(state.items)) {
    const age = daysBetween(it.day || today, today);
    const stale = it.status !== 'open' && age > keepDays;
    const expired = it.status === 'open' && age > cfg.ttlDays;
    if (stale || expired) {
      delete state.items[id];
      removed += 1;
    }
  }
  return removed;
}

/** 提示词块。故意不带日期、不带「请记录」：这是搭话的由头，不是填写表格。 */
export function suggestWakeText(items, { name = '主人' } = {}) {
  const list = Array.isArray(items) ? items.filter((it) => it && it.fact) : [];
  if (!list.length) return '';
  const who = String(name || '主人');
  const lines = list.map((it) => `- ${who}刚说过：${it.fact}（${it.cat}）`);
  return [
    '【可能值得记住的】',
    ...lines,
    '这些是对方随口说出的、关于他自己的事。如果这一轮聊得动，可以自然地接一句（记下来、或者顺着问一句细节）；聊不到就放着，别像在做登记，也别一次问一串。',
  ].join('\n');
}

/** 控制台用：只给计数和列表，不外泄原文之外的字段。 */
export function suggestSummary(state, { days = 7, today = dayOf(Date.now()) } = {}) {
  const items = Object.values(state.items);
  const open = items.filter((it) => it.status === 'open');
  const recent = items
    .filter((it) => daysBetween(it.day || today, today) <= days)
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .map((it) => ({
      id: it.id, cat: it.cat, fact: it.fact, key: it.key, day: it.day,
      shown: it.shown, status: it.status, lastShownDay: it.lastShownDay,
    }));
  return { open: open.length, total: items.length, items: recent.slice(0, 200) };
}