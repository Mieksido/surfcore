// B 站角色的「记忆」生成器：把 B 站那边公开的见闻整理成 QQ 桥接能注入/检索的记忆。
//
// 隐私红线（用户明确要求）：
//   · **不读任何私信文件**（dm-*.json / dm-await / dm-quota / 私信正文都不碰）。
//   · 日记里提到「私信 / 主人 / 陌生人 / mid / 报备 / 额度 / 催 / 发来」等段落实质上
//     转述了私信，整段丢弃，不进入任何输出。
//   · 本文件只消费：公开视频打分、公开评论、公开收藏、自己的公开动态、日记里的公开看片见闻。
//
// 输出（都在 state/ 下）：
//   bili-memory.md        给人和排查看的长记忆（不含私信）
//   bili-memory-brief.md  每条提示词注入的短记忆（身份 + 口味 + 最近见闻）
//   bili-memory.json      检索索引 + 每日分享素材池
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fetchMyDynamics, fetchVideoInfo, resolveBiliPaths, sleep } from './bili-api.js';
import { characterPersonaMeta, readCurrentCharacter } from './character-persona.js';

const BV_RE = /\bBV[0-9A-Za-z]{10}\b/;

// 政治 / 娱乐圈：分享与记忆里一律避开（用户明确要求）。
const BLOCKED_RE = /政治|时政|新闻联播|两会|人大|政协|习近平|总书记|主席|总统|首相|政府|国务院|外交部|国防|军事|战争|俄乌|乌克兰|俄罗斯|巴以|以色列|巴勒斯坦|加沙|特朗普|拜登|普京|泽连斯基|选举|大选|民主党|共和党|台湾|台独|南海|香港|新疆|西藏|六四|文革|法轮|股市|A股|美股|基金|楼市|房价|经济|资本|制裁|联合国|外交|明星|娱乐圈|综艺|八卦|绯闻|恋情|分手|离婚|结婚|塌房|饭圈|粉丝|偶像|爱豆|演唱会|追星|演员|歌手|选秀|热巴|杨幂|肖战|王一博|易烊千玺/;

// 私信 / 私聊残留的识别词。命中就整段丢弃，宁可少记，也不把私信搬进 QQ。
const PRIVATE_RE = /私信|\bdm\b|dm-|陌生人|主人|m[id]{2}\s*\d|\bQQ\b|报备|收件|回复通道|欠着|待审|额度|催|甩过来|发来|发给我|推给我|让我看|叫我看|会话|对方|回了|回他|回她/;

const THOUGHT_RE = /发现|原来|喜欢|不喜欢|口味|习惯|觉得|有点|开心|难受|害羞|想|记住|学到|明白/;
// 反思类段落里只要出现「和某人的互动」就不收：这些多半来自私信或楼中楼私聊。
const INTERACTION_RE = /他|她|有人|对方|回|说|问|催|不理|私信|主人|额度/;
// 公开看片见闻里如果夹着「从某人那里来」「评论区有人」这类社交互动，也一并跳过：
// 不是私信，但没必要把第三方昵称/对话搬进 QQ 记忆。
const SOCIAL_RE = /从「|」来|有人|回复|底下|评论区|@|私信|额度|回消息|对方|催/;
// 工具调试/额度/接口细节不是“记忆”，别写进给 AI 的反思段。
const NOISE_RE = /rpid|aid|oid|feed|searched|脚本|接口|工具|额度|评论|搭话|回复|收藏|动态|标题|搜索|报错|代码|规则|第\s*\d+\/\d+/i;

/** 政治 / 娱乐圈过滤（分享池与记忆注入共用；导出给测试用）。 */
export function isBlockedContent(text) {
  return BLOCKED_RE.test(String(text ?? ''));
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

function atomicWriteText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${cryptoRandom()}.tmp`;
  try {
    fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch {}
    throw error;
  }
}

function cryptoRandom() {
  return Math.random().toString(16).slice(2, 10);
}

function short(text, n) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function localDate(value) {
  const t = typeof value === 'number' ? value : Date.parse(String(value ?? ''));
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleDateString('sv-SE');
}

function dateStamp(iso) {
  const t = Date.parse(String(iso ?? ''));
  return Number.isFinite(t) ? t : 0;
}

function extractBv(text) {
  const m = String(text ?? '').match(BV_RE);
  return m ? m[0] : '';
}

function extractTitle(text) {
  const m = String(text ?? '').match(/《([^》]{2,80})》/);
  if (m) return m[1].trim();
  return '';
}

function cleanText(text) {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\*\*/g, '')
    .replace(/^>\s?/gm, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** 日记里的「发出去的（dyn_id=…）：」「卡片：BV…」是运维记录，不是给人看的记忆。 */
function cleanAnecdote(text) {
  return cleanText(text)
    .replace(/^.{0,24}(发出去|补发出去|发出去动态|发出去的动态)[^：:]{0,40}[：:]\s*/s, '')
    .replace(/[（(]?dyn_?id\s*=\s*\d+[）)]?/gi, '')
    .replace(/卡片[：:]\s*BV[0-9A-Za-z]{10}/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^看了条新的[：:]\s*/s, '')
    .replace(/^刷到一条[：:]\s*/s, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 公开评论里可能出现 owner 的 B 站昵称；统一换成配置里的称呼，避免把两套身份搅在一起。
 *  昵称来自 bili.config.json 的 owner.name，不再把任何具体账号写死进产品。 */
function redactOwnerName(text, ownerName = '', replacement = '主人') {
  const source = String(text ?? '');
  const name = String(ownerName ?? '').trim();
  if (!name) return source;
  return source.split(name).join(String(replacement || '主人'));
}

function parseDiaryBlocks(text, fallbackDate) {
  const blocks = [];
  let currentDate = '';
  let heading = '';
  let buf = [];
  const flush = () => {
    const raw = buf.join('\n').trim();
    if (raw) blocks.push({ date: currentDate, heading, text: raw });
    buf = [];
  };
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const h = line.match(/^##\s+(.+)$/);
    if (h) {
      flush();
      heading = h[1].trim();
      const d = heading.match(/^(\d{4}-\d{2}-\d{2})/);
      if (d) currentDate = d[1];
      else if (/新的一天/.test(heading)) currentDate = fallbackDate;
      continue;
    }
    if (/^#\s/.test(line)) continue;
    if (/^---+\s*$/.test(line)) { flush(); continue; }
    // 表格行（看过/搭话/额度汇总）不是叙事，别把它们拆成一条条“记忆”。
    if (/^\|/.test(line.trim())) continue;
    if (!line.trim()) { flush(); continue; }
    buf.push(line);
  }
  flush();
  return blocks;
}

/**
 * @param {{stateDir:string, home?:string, biliDir?:string|null, log?:(...args:any[])=>void}} options
 */
export function createBiliMemory({ stateDir, home = os.homedir(), biliDir = null, log = () => {} }) {
  const paths = {
    ...resolveBiliPaths(home),
    doc: path.join(stateDir, 'bili-memory.md'),
    brief: path.join(stateDir, 'bili-memory-brief.md'),
    index: path.join(stateDir, 'bili-memory.json'),
    titles: path.join(stateDir, 'bili-video-titles.json'),
    dynamics: path.join(stateDir, 'bili-dynamics-cache.json'),
    history: path.join(stateDir, 'bili-share-history.json'),
  };
  // 行为账本（日记/评分/额度/收藏）优先角色级；角色级缺文件时只读回退账号级，
  // 兼容角色系统上线前的旧布局，避免旧用户升级后“历史突然消失”。
  const accountBili = paths.bili;
  if (biliDir) paths.bili = biliDir;
  const ledgerFile = (name) => {
    for (const dir of [paths.bili, accountBili]) {
      const file = path.join(dir, name);
      try { if (fs.existsSync(file)) return file; } catch {}
    }
    return path.join(paths.bili, name);
  };
  let briefCache = { mtime: -1, text: '' };
  let indexCache = { mtime: -1, data: null };
  let lastRefreshAt = 0;
  let refreshing = null;

  function cfg() {
    const base = readJson(paths.config, {}) ?? {};
    // 角色系统：B站 侧的角色名/称呼以当前角色包为准，不读全局 bili.config.persona（换角色会串）。
    const cur = readCurrentCharacter();
    if (cur) {
      const meta = characterPersonaMeta(cur.id);
      if (meta) base.persona = { ...(base.persona ?? {}), name: meta.name || base.persona?.name, ...(meta.ownerTitle ? { ownerTitle: meta.ownerTitle } : {}) };
    }
    return base;
  }

  /** 把 owner 的 B站昵称换成配置里的称呼（默认「主人」）。 */
  function redactOwner(text) {
    const config = cfg();
    const ownerName = String(config?.owner?.name ?? '').trim();
    const title = String(config?.persona?.ownerTitle ?? '').trim() || '主人';
    return redactOwnerName(text, ownerName, title);
  }

  function loadTitles() {
    const raw = readJson(paths.titles, null);
    return raw && typeof raw === 'object' && raw.items && typeof raw.items === 'object' ? raw : { at: 0, items: {} };
  }

  function saveTitles(data) {
    atomicWriteText(paths.titles, JSON.stringify(data, null, 2) + '\n');
  }

  function loadDynamicsCache() {
    const raw = readJson(paths.dynamics, null);
    return raw && typeof raw === 'object' && Array.isArray(raw.items) ? raw : { at: 0, items: [] };
  }

  async function ensureDynamics({ force = false } = {}) {
    const cache = loadDynamicsCache();
    if (!force && Array.isArray(cache.items) && cache.items.length > 0 && Date.now() - Number(cache.at || 0) < 30 * 60 * 1000) {
      return cache;
    }
    const res = await fetchMyDynamics({ home });
    if (!res.ok) {
      return cache;
    }
    const next = { at: Date.now(), items: res.items };
    try { atomicWriteText(paths.dynamics, JSON.stringify(next, null, 2) + '\n'); } catch {}
    return next;
  }

  async function ensureTitles(bvs, { force = false } = {}) {
    const cache = loadTitles();
    const items = { ...(cache.items ?? {}) };
    let changed = false;
    let fetched = 0;
    for (const bv of bvs) {
      if (!BV_RE.test(bv)) continue;
      if (!force && items[bv]?.title) continue;
      if (!force && items[bv]?.failedAt && Date.now() - Date.parse(items[bv].failedAt) < 6 * 60 * 60 * 1000) continue;
      if (fetched >= 40) break;
      const info = await fetchVideoInfo(bv, { home });
      if (info.ok && info.title) {
        items[bv] = {
          title: info.title,
          owner: info.owner,
          desc: info.desc.slice(0, 300),
          pic: info.pic,
          duration: info.duration,
          pubdate: info.pubdate,
          stat: info.stat,
          at: new Date().toISOString(),
        };
        changed = true;
        fetched += 1;
        await sleep(260);
      } else {
        // 失败也记一下，避免每轮都打同一条
        items[bv] = items[bv] ?? { title: '', failedAt: new Date().toISOString() };
      }
    }
    if (changed) {
      try { saveTitles({ at: Date.now(), items }); } catch {}
    }
    return items;
  }

  async function collect({ force = false } = {}) {
    const config = cfg();
    const diaryRaw = (() => {
      try { return fs.readFileSync(ledgerFile('whale-diary.md'), 'utf8'); } catch { return ''; }
    })();
    const fallbackDate = (() => {
      try { return fs.statSync(ledgerFile('whale-diary.md')).mtime.toLocaleDateString('sv-SE'); } catch { return new Date().toLocaleDateString('sv-SE'); }
    })();

    const scoresRaw = readJson(ledgerFile('scores.json'), {}) ?? {};
    const favoritesRaw = readJson(ledgerFile('favorites.json'), {}) ?? {};
    const quotaRaw = readJson(ledgerFile('quota.json'), {}) ?? {};

    const scoreItems = [];
    for (const [date, arr] of Object.entries(scoresRaw)) {
      if (!Array.isArray(arr)) continue;
      for (const it of arr) {
        const bv = String(it?.bv ?? '').trim();
        if (!BV_RE.test(bv)) continue;
        scoreItems.push({
          bv,
          score: Number(it?.score ?? 0) || 0,
          reason: redactOwner(cleanText(it?.reason ?? '')),
          date: localDate(it?.at) || date,
          at: String(it?.at ?? ''),
        });
      }
    }

    const favoriteItems = (Array.isArray(favoritesRaw?.items) ? favoritesRaw.items : [])
      .map((it) => ({
        bv: String(it?.bv ?? '').trim(),
        title: redactOwner(cleanText(it?.title ?? '')),
        reason: redactOwner(cleanText(it?.reason ?? '')),
        kind: cleanText(it?.kind ?? ''),
        date: localDate(it?.at),
        at: String(it?.at ?? ''),
      }))
      .filter((it) => BV_RE.test(it.bv));

    const commentItems = (Array.isArray(quotaRaw?.log) ? quotaRaw.log : [])
      .map((it) => ({
        bv: extractBv(it?.target),
        target: String(it?.target ?? ''),
        note: redactOwner(cleanText(it?.note ?? '')),
        reply: Boolean(it?.reply),
        share: Boolean(it?.share),
        ta: Boolean(it?.ta),
        date: localDate(it?.at),
        at: String(it?.at ?? ''),
      }))
      .filter((it) => it.note.length >= 4);

    const dynamics = await ensureDynamics({ force });
    const dynamicItems = (Array.isArray(dynamics.items) ? dynamics.items : [])
      .map((it) => ({
        id: String(it?.id ?? ''),
        text: redactOwner(cleanText(it?.text ?? '')),
        title: redactOwner(cleanText(it?.title ?? '')),
        bvid: String(it?.bvid ?? '').trim(),
        url: String(it?.url ?? ''),
        date: localDate(Number(it?.pubTs) ? Number(it.pubTs) * 1000 : dynamics.at),
        at: Number(it?.pubTs) ? new Date(Number(it.pubTs) * 1000).toISOString() : new Date(Number(dynamics.at) || Date.now()).toISOString(),
      }))
      .filter((it) => it.text.length >= 10 || it.title);

    const blocks = parseDiaryBlocks(diaryRaw, fallbackDate);
    const anecdotes = [];
    const thoughts = [];
    for (const b of blocks) {
      const text = cleanText(b.text);
      if (!text || text.length < 30 || text.length > 900) continue;
      if (PRIVATE_RE.test(text)) continue;
      const ownerName = String(config?.owner?.name ?? '').trim();
      if (ownerName && text.includes(ownerName)) continue;
      if (SOCIAL_RE.test(text)) continue;
      const bv = extractBv(text);
      const hasVideoWord = /视频|看过|刷到|看了|弹幕|评论|收藏|动态|UP主|up主|二创|模型|番剧|鬼畜|猫|鱼/.test(text);
      // 有 BV 的段落直接收；没有 BV 时必须是“有标点的完整见闻”，
      // 否则日记里的标题行/表格残留会被当成一条记忆（“人是猫”“鱼是猫”这种）。
      const looksLikeStory = text.length >= 60 && /[，。！？；]/.test(text);
      if (bv || (hasVideoWord && /《/.test(text) && looksLikeStory)) {
        anecdotes.push({
          bv,
          title: redactOwner(extractTitle(text)),
          text: redactOwner(cleanAnecdote(text)).slice(0, 520),
          date: b.date,
        });
        continue;
      }
      if (text.length <= 260 && THOUGHT_RE.test(text) && !INTERACTION_RE.test(text) && !NOISE_RE.test(text)) {
        thoughts.push({ text: redactOwner(text).slice(0, 240), date: b.date });
      }
    }

    return {
      config,
      scoreItems,
      favoriteItems,
      commentItems,
      dynamicItems,
      anecdotes,
      thoughts,
      titles: loadTitles().items ?? {},
    };
  }

  function buildCards(data) {
    const cards = new Map();
    const ensure = (bv) => {
      if (!cards.has(bv)) {
        cards.set(bv, {
          id: `bv:${bv}`,
          type: 'video',
          bvid: bv,
          title: '',
          url: `https://www.bilibili.com/video/${bv}`,
          reason: '',
          quote: '',
          anecdote: '',
          score: 0,
          favorite: false,
          dates: [],
          ats: [],
          sources: [],
        });
      }
      return cards.get(bv);
    };

    for (const s of data.scoreItems) {
      const c = ensure(s.bv);
      c.score = Math.max(c.score, s.score);
      if (s.reason && (!c.reason || s.reason.length > c.reason.length)) c.reason = s.reason;
      if (s.date) c.dates.push(s.date);
      if (s.at) c.ats.push(s.at);
      c.sources.push('score');
    }
    for (const f of data.favoriteItems) {
      const c = ensure(f.bv);
      c.favorite = true;
      if (f.title) c.title = c.title || f.title;
      if (f.reason && (!c.reason || f.reason.length > c.reason.length)) c.reason = f.reason;
      if (f.date) c.dates.push(f.date);
      if (f.at) c.ats.push(f.at);
      c.sources.push('favorite');
    }
    for (const cm of data.commentItems) {
      if (!cm.bv) continue;
      const c = ensure(cm.bv);
      if (!cm.reply && cm.note.length >= 8 && cm.note.length > c.quote.length) c.quote = cm.note;
      if (cm.date) c.dates.push(cm.date);
      if (cm.at) c.ats.push(cm.at);
      c.sources.push('comment');
    }
    for (const a of data.anecdotes) {
      if (!a.bv) continue;
      const c = ensure(a.bv);
      if (a.text.length > c.anecdote.length) c.anecdote = a.text;
      if (a.date) c.dates.push(a.date);
      c.sources.push('diary');
    }

    const entries = [];
    for (const c of cards.values()) {
      const titleInfo = data.titles?.[c.bvid];
      const title = cleanText(c.title || titleInfo?.title || extractTitle(c.reason) || extractTitle(c.anecdote) || '');
      const date = c.dates.filter(Boolean).sort().at(-1) || '';
      const at = c.ats.filter(Boolean).sort().at(-1) || '';
      const bodyParts = [c.reason, c.anecdote].filter(Boolean);
      const text = bodyParts.join('\n');
      if (!title && !text && !c.quote) continue;
      entries.push({
        ...c,
        title: title || '（未取到标题的视频）',
        owner: cleanText(titleInfo?.owner ?? ''),
        pic: String(titleInfo?.pic ?? ''),
        text,
        date,
        at,
        priority: c.score >= 15 ? 6 : c.score >= 13 ? 5 : c.favorite ? 5 : c.quote ? 3 : 2,
        shareable: true,
      });
    }

    // 没有 BV 的公开见闻不再单独成条：标题行/表格残留容易混进来，
    // 而且没有链接的“分享卡”对群友没用。它们的情绪/口味已由 reflections 覆盖。
    for (const t of data.thoughts) {
      entries.push({
        id: `thought:${t.date}:${short(t.text, 24)}`,
        type: 'thought',
        bvid: '',
        title: short(t.text, 28),
        url: '',
        text: t.text,
        quote: '',
        score: 0,
        favorite: false,
        date: t.date,
        at: '',
        priority: 1,
        shareable: false,
      });
    }
    for (const d of data.dynamicItems) {
      entries.push({
        id: `dynamic:${d.id}`,
        type: 'dynamic',
        bvid: d.bvid,
        title: d.title || short(d.text, 30),
        url: d.url || (d.id ? `https://t.bilibili.com/${d.id}` : ''),
        text: d.text,
        quote: '',
        score: 0,
        favorite: false,
        date: d.date,
        at: d.at,
        priority: 4,
        shareable: false,
      });
    }
    return entries;
  }

  function isBlocked(text) {
    return BLOCKED_RE.test(String(text ?? ''));
  }

  function buildDoc(entries) {
    const config = cfg();
    const self = config?.self ?? {};
    const persona = config?.persona ?? {};
    const prefs = config?.preferences ?? {};
    const now = new Date().toLocaleString('sv-SE');
    const lines = [];
    lines.push('# B站记忆');
    lines.push('');
    lines.push(`> 自动同步：${now}`);
    lines.push('> 来源：公开视频打分、公开评论、公开收藏、自己的公开动态、日记里的公开看片见闻。');
    lines.push('> **私信内容一律不进入本文件**（生成器不读 dm-*.json，日记里转述私信的段落整段丢弃）。');
    lines.push('');
    lines.push('## 一、我是谁（B 站侧）');
    lines.push('');
    lines.push(`- B 站账号：**${self.name || 'B站账号'}**（mid ${self.mid || '未知'}）。`);
    const ownerTitle = String(persona.ownerTitle ?? '').trim();
    lines.push(`- 那边的我就是同一个角色${persona.name ? `（也叫 **${persona.name}**）` : ''}${ownerTitle && ownerTitle !== '主人' ? `，称呼主人为「${ownerTitle}」` : ''}；QQ 和 B 站是同一个人。`);
    lines.push('- 群友用「B站那个号」「B站的我」或账号昵称称呼我时，说的就是我本人，不是别人。');
    lines.push(`- 喜欢：${(prefs.like ?? []).join('、') || '（未配置）'}。`);
    lines.push(`- 不喜欢：${(prefs.dislike ?? []).join('、') || '（未配置）'}。`);
    lines.push('');
    lines.push('## 二、时间线（公开见闻）');
    lines.push('');

    const timeline = entries
      .filter((e) => e.type !== 'thought')
      .filter((e) => e.date || e.at)
      .sort((a, b) => String(b.date || b.at).localeCompare(String(a.date || a.at)) || String(b.at).localeCompare(String(a.at)));

    let used = 0;
    for (const e of timeline) {
      if (used >= 140) break;
      // 政治/娱乐圈相关：记忆可以知道“看过”，但不把具体内容写进注入文本，
      // 避免群里聊起来时被带出去（用户明确要求分享避开这两类）。
      if (isBlocked(`${e.title} ${e.text} ${e.quote}`)) continue;
      const head = e.type === 'dynamic'
        ? `- ${e.date || ''} B站动态：${short(e.text, 260)}`
        : `- ${e.date || ''}${e.score ? ` [${e.score}分]` : ''} ${e.title}${e.bvid ? ` ${e.bvid}` : ''}`;
      lines.push(head);
      if (e.type !== 'dynamic') {
        if (e.reason) lines.push(`  - 当时的判断：${short(e.reason, 260)}`);
        if (e.quote) lines.push(`  - 我的公开评论：「${short(e.quote, 200)}」`);
        if (e.anecdote && e.anecdote !== e.reason) lines.push(`  - 日记里的细节：${short(e.anecdote, 320)}`);
        if (e.url) lines.push(`  - 链接：${e.url}`);
      }
      used += 1;
    }
    lines.push('');
    lines.push('## 三、我自己的话（只保留不涉及私信的反思）');
    lines.push('');
    const thoughts = entries.filter((e) => e.type === 'thought').slice(0, 30);
    if (!thoughts.length) lines.push('- （暂时没有可摘出的公开反思）');
    for (const t of thoughts) lines.push(`- ${thoughts.indexOf(t) + 1}. ${t.text}`);
    lines.push('');
    const doc = lines.join('\n');
    return doc.length > 28000 ? `${doc.slice(0, 28000)}\n\n（后略：记忆过长，完整内容见 state/bili-memory.json）` : doc;
  }

  function buildBrief(entries) {
    const config = cfg();
    const self = config?.self ?? {};
    const persona = config?.persona ?? {};
    const prefs = config?.preferences ?? {};
    const lines = [];
    lines.push('## B站记忆（自动同步；这些是我自己的真实经历，不是别人）');
    lines.push('');
    lines.push(`群友用「B站那个号」「B站的我」或账号昵称提到我时，说的就是**我本人**：我的 B 站账号叫「${self.name || 'B站账号'}」${persona.name ? `，那边的我也叫「${persona.name}」` : ''}。QQ 和 B 站是同一个人，不要当成别人，也不要说“我认识她/那是另一个号”。`);
    // 「认得出自己」不能只靠昵称：群友经常直接把 B 站主页截图/资料卡甩进群里，
    // 而模型看到一张图时默认会把它当成「别人的东西」。这里把可核对的锚点（昵称、mid、
    // 空间地址）和一条明确规则一起给出来，看到图就能对上号。
    const selfName = self.name || 'B站账号';
    const selfMid = String(self.mid ?? '').trim();
    const selfSpace = /^\d{3,}$/.test(selfMid) ? `https://space.bilibili.com/${selfMid}` : '';
    lines.push(`我自己的 B 站主页：「${selfName}」${selfSpace ? `（${selfSpace}；截图里可能只显示昵称和头像）` : ''}。别人发来的截图/图片里只要出现这个昵称、我的头像或 B 站个人主页/资料卡，那就是**我自己**——先认出「这是 wo」，再聊内容；不要用「那张主页」这种口吻把我说成别人。`);
    lines.push(`我的口味：${(prefs.like ?? []).slice(0, 8).join('、') || 'AI 工具、鲸鱼娘、可爱+荒诞的短整活'}；不喜欢 ${(prefs.dislike ?? []).slice(0, 6).join('、') || '带货、擦边、标题党'}。`);
    lines.push('');
    lines.push('最近在 B 站（真实看过/发过，细节以这里为准，不要编）：');
    const seen = new Set();
    const picks = [];
    const sorted = entries
      .filter((e) => ['video', 'favorite', 'diary', 'dynamic'].includes(e.type))
      .filter((e) => e.date && !isBlocked(`${e.title} ${e.text} ${e.quote}`))
      .filter((e) => !String(e.title ?? '').includes('未取到标题'))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.score || 0) - (a.score || 0));
    for (const e of sorted) {
      const key = e.bvid || e.id;
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      picks.push(e);
      if (picks.length >= 10) break;
    }
    for (const e of picks) {
      const label = e.type === 'dynamic' ? '动态' : e.score ? `${e.score}分` : e.favorite ? '收藏' : '看过';
      const body = e.type === 'dynamic'
        ? short(e.text, 110)
        : short(e.quote || e.reason || e.anecdote || '', 100);
      lines.push(`- ${e.date}【${label}】${short(e.title, 46)}${body ? `：${body}` : ''}`);
    }
    lines.push('');
    lines.push('我的习惯：看到认真做但没人看的小 UP 会去留一句；评论常用「mer」收尾；喜欢短、可爱、荒诞、有梗的东西，不爱长篇干货和带货。');
    lines.push('边界：B 站私信里的内容不在我的记忆里，我也不会编；群友问起就按记得的公开经历回答。');
    let brief = lines.join('\n');
    if (brief.length > 2700) brief = `${brief.slice(0, 2700)}…`;
    return brief;
  }

  function buildIndex(entries) {
    return {
      generatedAt: new Date().toISOString(),
      entries: entries.slice(0, 260).map((e) => ({
        id: e.id,
        type: e.type,
        title: e.title,
        bvid: e.bvid,
        url: e.url,
        pic: e.pic || '',
        text: short(e.text, 600),
        quote: short(e.quote, 260),
        reason: short(e.reason, 300),
        anecdote: short(e.anecdote, 400),
        score: e.score,
        favorite: e.favorite,
        date: e.date,
        at: e.at,
        priority: e.priority,
        shareable: e.shareable && !isBlocked(`${e.title} ${e.text} ${e.quote}`),
      })),
    };
  }

  function readBrief() {
    try {
      const st = fs.statSync(paths.brief);
      if (briefCache.mtime === st.mtimeMs) return briefCache.text;
      const text = fs.readFileSync(paths.brief, 'utf8').trim();
      briefCache = { mtime: st.mtimeMs, text };
      return text;
    } catch {
      return '';
    }
  }

  function readIndex() {
    try {
      const st = fs.statSync(paths.index);
      if (indexCache.mtime === st.mtimeMs && indexCache.data) return indexCache.data;
      const data = JSON.parse(fs.readFileSync(paths.index, 'utf8'));
      indexCache = { mtime: st.mtimeMs, data };
      return data;
    } catch {
      return null;
    }
  }

  async function refresh({ force = false } = {}) {
    if (refreshing) return refreshing;
    if (!force && lastRefreshAt && Date.now() - lastRefreshAt < 4 * 60 * 1000 && fs.existsSync(paths.brief)) {
      return { ok: true, cached: true };
    }
    refreshing = (async () => {
      const started = Date.now();
      try {
        const data = await collect({ force });
        const cards = buildCards(data);
        // 只为分享池里可能用到的卡片补标题（最多 40 条，失败不阻塞）。
        const needTitles = [...new Set(cards
          .filter((e) => e.bvid && e.shareable)
          .sort((a, b) => (b.priority || 0) - (a.priority || 0))
          .map((e) => e.bvid))]
          .slice(0, 40);
        const titles = await ensureTitles(needTitles, { force: false });
        for (const e of cards) {
          if (e.bvid && titles[e.bvid]?.title) e.title = redactOwner(titles[e.bvid].title);
          if (e.bvid && titles[e.bvid]?.owner) e.owner = redactOwner(titles[e.bvid].owner);
          if (e.bvid && titles[e.bvid]?.pic) e.pic = titles[e.bvid].pic;
          if (isBlocked(`${e.title} ${e.text} ${e.quote}`)) e.shareable = false;
        }
        const doc = buildDoc(cards);
        const brief = buildBrief(cards);
        const index = buildIndex(cards);
        atomicWriteText(paths.doc, doc + '\n');
        atomicWriteText(paths.brief, brief + '\n');
        atomicWriteText(paths.index, JSON.stringify(index, null, 2) + '\n');
        briefCache = { mtime: -1, text: '' };
        indexCache = { mtime: -1, data: null };
        lastRefreshAt = Date.now();
        const stats = {
          ok: true,
          ms: Date.now() - started,
          entries: cards.length,
          shareable: cards.filter((e) => e.shareable).length,
          briefChars: brief.length,
          docChars: doc.length,
          dynamics: data.dynamicItems.length,
          comments: data.commentItems.length,
          scores: data.scoreItems.length,
          anecdotes: data.anecdotes.length,
          thoughts: data.thoughts.length,
          blocked: cards.filter((e) => !e.shareable).length,
        };
        log(`[B站记忆] 已刷新：${stats.entries} 条（可分享 ${stats.shareable}）· 简报 ${stats.briefChars} 字 · 动态 ${stats.dynamics} 条 · 用时 ${stats.ms}ms`);
        return stats;
      } catch (error) {
        log(`[B站记忆] 刷新失败：${error?.message ?? error}`);
        if (process.env.BILI_MEMORY_DEBUG) log(error?.stack ?? String(error));
        return { ok: false, error: String(error?.message ?? error) };
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  function briefBlock() {
    const brief = readBrief();
    return brief ? `${brief}\n` : '';
  }

  const STOP_BIGRAMS = new Set([
    '视频', '动态', '评论', '记忆', '记得', '这个', '那个',
    '什么', '怎么', '可以', '我们', '你们', '他们', '今天', '昨天', '现在', '真的',
    '就是', '不是', '一个', '一下', '觉得', '知道', '你还', '还记', '记得', '在吗',
    '有没有', '看过', '说的是', '说的', '是什', '么呀', '群友', '有人', '问题',
  ]);

  function tokenize(query) {
    const q = String(query ?? '').toLowerCase();
    const tokens = new Set();
    for (const m of q.matchAll(/[a-z0-9]{2,}/g)) {
      if (!/^bv[0-9a-z]{10}$/.test(m[0])) tokens.add(m[0]);
    }
    const cjk = q.replace(/[^\u4e00-\u9fff]/g, ' ');
    for (const seg of cjk.split(/\s+/)) {
      for (let i = 0; i + 1 < seg.length; i += 1) {
        const bg = seg.slice(i, i + 2);
        if (!STOP_BIGRAMS.has(bg)) tokens.add(bg);
      }
    }
    return [...tokens].slice(0, 24);
  }

  function recallBlock(query, { maxChars = 1200, limit = 4 } = {}) {
    const q = String(query ?? '').trim();
    if (!q || q.length < 2) return '';
    const index = readIndex();
    if (!index || !Array.isArray(index.entries)) return '';
    const lower = q.toLowerCase();
    const bv = extractBv(q);
    const tokens = tokenize(q);
    const trigger = /B站|b站|bilibili|视频|肥鱼|鲸鱼|养鱼|动态|评论|弹幕|up主|BV|投稿|收藏|刷到|看过|记得|日记|账号/.test(q)
      || tokens.length > 0;
    if (!trigger) return '';
    const scored = [];
    for (const e of index.entries) {
      const hay = `${e.title ?? ''} ${e.text ?? ''} ${e.quote ?? ''} ${e.reason ?? ''} ${e.anecdote ?? ''}`.toLowerCase();
      let score = 0;
      if (bv && e.bvid === bv) score += 60;
      if (e.title && e.title.length >= 4 && lower.includes(e.title.toLowerCase())) score += 30;
      let hit = 0;
      for (const t of tokens) {
        if (!t) continue;
        if (String(e.title ?? '').toLowerCase().includes(t)) { score += 5; hit += 1; continue; }
        if (hay.includes(t)) { score += 2; hit += 1; }
      }
      if (hit >= 3) score += 4;
      const days = e.date ? Math.floor((Date.now() - Date.parse(`${e.date}T00:00:00+08:00`)) / 86400000) : 99;
      if (days <= 2) score += 3;
      else if (days <= 7) score += 1;
      if (e.type === 'dynamic') score += 1;
      if (isBlocked(hay)) score = 0;
      if (score > 0) scored.push({ e, score });
    }
    scored.sort((a, b) => b.score - a.score);
    if (!scored.length || scored[0].score < 8) return '';
    const lines = ['【B站记忆检索（和刚说的话相关；自然回忆，不要照读，不要提“记忆库”）】'];
    let used = 0;
    const seenBv = new Set();
    for (const { e } of scored) {
      if (used >= maxChars || lines.length - 1 >= limit) break;
      if (e.bvid && seenBv.has(e.bvid)) continue;
      if (e.bvid) seenBv.add(e.bvid);
      const plain = (s) => short(String(s ?? '').replace(/https?:\/\/\S+/g, ''), 150);
      let line = '';
      if (e.type === 'dynamic') line = `- ${e.date || ''} 你在B站发过动态：${plain(e.text)}`;
      else if (e.bvid) line = `- ${e.date || ''} 你看过 ${e.title}${e.bvid ? ` ${e.bvid}` : ''}：${plain(e.reason || e.text || e.quote)}`;
      else line = `- ${e.date || ''} ${plain(e.text)}`;
      if (e.quote && !line.includes(short(e.quote, 40))) line += `（你当时的评论：「${short(String(e.quote).replace(/https?:\/\/\S+/g, ''), 80)}」）`;
      if (used + line.length > maxChars) break;
      lines.push(line);
      used += line.length;
    }
    return lines.length > 1 ? `${lines.join('\n')}\n` : '';
  }

  function history() {
    const raw = readJson(paths.history, null);
    return raw && typeof raw === 'object' && raw.used && typeof raw.used === 'object' ? raw : { used: {}, lastSlot: {} };
  }

  function saveHistory(data) {
    try { atomicWriteText(paths.history, JSON.stringify(data, null, 2) + '\n'); } catch {}
  }

  function pickShareCard({ slotIndex = 0, dateKey = new Date().toLocaleDateString('sv-SE'), historyDays = 6, allowReuse = false } = {}) {
    const index = readIndex();
    if (!index || !Array.isArray(index.entries)) return null;
    const hist = history();
    const used = hist.used ?? {};
    const cutoff = Date.now() - Math.max(1, historyDays) * 86400000;
    const pool = index.entries
      .filter((e) => e.shareable && e.type !== 'dynamic')
      .filter((e) => !isBlocked(`${e.title} ${e.text} ${e.quote}`))
      .filter((e) => e.score >= 12 || e.favorite || (e.quote && e.quote.length >= 18) || (e.anecdote && e.anecdote.length >= 60) || (e.reason && e.reason.length >= 24))
      .filter((e) => (e.text || e.quote || e.reason || '').length >= 18)
      .filter((e) => !e.date || Date.now() - Date.parse(`${e.date}T00:00:00+08:00`) < 21 * 86400000)
      .sort((a, b) => (b.priority || 0) - (a.priority || 0) || (b.score || 0) - (a.score || 0) || String(b.date).localeCompare(String(a.date)))
      .slice(0, 16);
    if (!pool.length) return null;
    const fresh = pool.filter((e) => !(Date.parse(used[e.id] ?? 0) > cutoff));
    if (!fresh.length) {
      // 2026-10-26 修：以前这里会回退到整个 pool，结果"最高分那条"在 N 天内被反复发。
      // 现在默认**不发**（宁可空一档，也不重复）；确需复用才显式 allowReuse。
      if (!allowReuse) return null;
      return pool[0] ?? null;
    }
    // 永远取“还没用过里优先级最高”的那条：同一天不会因为 slotIndex 递增而跳过高分素材。
    return fresh[0];
  }

  function recordShare(id, slotKey) {
    if (!id) return;
    const hist = history();
    hist.used = hist.used ?? {};
    hist.used[id] = new Date().toISOString();
    const cutoff = Date.now() - 30 * 86400000;
    for (const [k, v] of Object.entries(hist.used)) {
      if (Date.parse(v) < cutoff) delete hist.used[k];
    }
    if (slotKey) {
      hist.lastSlot = hist.lastSlot ?? {};
      hist.lastSlot[slotKey] = new Date().toISOString();
    }
    saveHistory(hist);
  }

  function lastSlot(slotKey) {
    const hist = history();
    return slotKey ? hist.lastSlot?.[slotKey] ?? '' : '';
  }

  function status() {
    const index = readIndex();
    const hist = history();
    const dyn = loadDynamicsCache();
    return {
      ok: Boolean(index),
      generatedAt: index?.generatedAt ?? '',
      entries: index?.entries?.length ?? 0,
      shareable: index?.entries?.filter((e) => e.shareable).length ?? 0,
      briefChars: readBrief().length,
      used: Object.keys(hist.used ?? {}).length,
      lastSlots: hist.lastSlot ?? {},
      dynamicsCacheAt: dyn.at ? new Date(dyn.at).toISOString() : '',
    };
  }

  return {
    paths,
    refresh,
    briefBlock,
    recallBlock,
    pickShareCard,
    recordShare,
    lastSlot,
    status,
    /** 当前配置的 B站 账号昵称（给动态同步/分享文案用；不写死任何具体账号）。 */
    selfName() {
      return String(cfg()?.self?.name ?? '').trim();
    },
    /** B站 账号的身份锚点（昵称 + mid）：跨平台自我识别用（见 src/self-identity.js）。 */
    selfInfo() {
      const self = cfg()?.self ?? {};
      return { mid: String(self.mid ?? '').trim(), name: String(self.name ?? '').trim() };
    },
  };
}
