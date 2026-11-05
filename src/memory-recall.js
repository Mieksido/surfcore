/**
 * 记忆召回胶水层：把 `memory-index.js` 的检索能力接到「唤醒提示词」和「控制台」上。
 *
 * 两个入口，故意分开：
 *   · `recallBlock()` —— **同步、纯 BM25**。唤醒提示词是同步拼的，不能在这里 await 一个
 *     HTTP 服务（embedding 服务挂了/慢了会把唤醒卡住）。索引是本地 SQLite，几十毫秒。
 *   · `searchMemoryAsync()` —— 异步混合检索（BM25 + 向量 RRF），给控制台/API 用；
 *     向量服务不可用时自己降级成 BM25。
 *
 * 边界：只读记忆档，只读派生库；任何异常都不许冒到唤醒路径上（返回空串）。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  ensureMemoryIndexFresh, memoryIndexPathFor, memoryIndexStats, memoryTokens, searchMemoryHybrid,
  searchMemoryIndex, tokenDocumentCounts,
} from './memory-index.js';

/** 只负责「有没有在回忆」的问法；真正喂给 FTS 的是去掉这些词之后的内容词。 */
export const RECALL_TRIGGER_RE = /记得|还记得|想起来|上次|上回|之前|以前|曾经|说过|提过|聊过|那个|那次|那时候|当时|是不是|有没有|哪次|什么时候|我跟你/;

/**
 * 回忆问句里的虚词二元组：它们命中一切记忆，留着只会把无关条目抬进提示词。
 * 只放「回忆句式专用」的词，不放「你/我/他」这种——那些单字本来就不进 FTS。
 */
const RECALL_STOP = new Set([
  '记得', '得吗', '还记', '记不', '不记', '想起', '起来', '上次', '上回', '之前', '以前',
  '曾经', '说过', '提过', '聊过', '那个', '这次', '那次', '时候', '候那', '当时', '是不是',
  '不是', '有没', '没有', '哪次', '什么', '么时', '跟你', '我们', '到底', '那个', '说的',
  '过的', '的吗', '了吗', '呢吗', '还是', '就是', '真的', '知道', '告诉',
]);

/** 二元组切分会在词边界造出「你还」「我上」「过我」这种碎片，它们能命中任何记忆。 */
const FN_CHARS = new Set([...'我你他她它们的了吗呢吧啊哦嗯嘛呀是在有就都也还和与把被给让对从到为所以及才又再很太更最什么那这']);

function isFragment(token) {
  const chars = [...token];
  return FN_CHARS.has(chars[0]) || FN_CHARS.has(chars[chars.length - 1]);
}

/** 「记得/说过/什么」这些字本身没有信息量：单字兜底时一律排除，否则「记」会命中「记忆」。 */
const RECALL_STOP_CHARS = new Set([...RECALL_STOP].flatMap((w) => [...w]));

/** 单字实体兜底：「那只猫」里的「猫」是二元组切不出来的，只在这种短查询里用。 */
export function recallUnigrams(message) {
  const chars = [...recallQuery(message)]
    .filter((ch) => CJK_OR_WORD.test(ch) && !FN_CHARS.has(ch) && !RECALL_STOP_CHARS.has(ch));
  return [...new Set(chars)].slice(0, 6);
}

/** 从回忆问句里抽「内容词」（≥2 字，去掉回忆句式虚词），用来做 FTS 查询与命中校验。 */
export function recallTokens(message) {
  const all = memoryTokens(recallQuery(message))
    .filter((t) => [...t].length >= 2 && !RECALL_STOP.has(t) && !isFragment(t));
  return [...new Set(all)].slice(0, 16);
}

const CJK_OR_WORD = /[\p{Script=Han}a-zA-Z0-9]/u;

/** 从一条消息里提出能用来检索的查询串（去 CQ 码、链接、多余空白）。 */
export function recallQuery(raw) {
  return String(raw ?? '')
    .replace(/\[CQ:[^\]]*\]/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

export function shouldRecall(message) {
  const q = recallQuery(message);
  if (q.length < 2) return false;
  const hits = q.match(/[\p{Script=Han}a-zA-Z0-9]/gu)?.length ?? 0;
  if (hits < 2) return false;
  return RECALL_TRIGGER_RE.test(q);
}

/**
 * 记忆档必须真的存在：否则 SQLite 会落到默认派生库，把「别的角色/上一次的索引」
 * 当成这个角色的记忆注入（目录传错就串档）。宁可什么都不注入，也不能张冠李戴。
 */
function archiveReady(memoryDir) {
  try {
    return fs.existsSync(path.join(String(memoryDir ?? ''), 'memory-card-full.jsonl'));
  } catch {
    return false;
  }
}

function dayOf(record) {
  const raw = String(record?.createdAt ?? '');
  const d = raw ? new Date(raw) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function oneLine(text, max = 140) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** 已经写进记忆卡正文的条目不必再注入一遍（避免同一件事说两遍）。 */
function alreadyInCard(record, cardText) {
  if (!cardText) return false;
  const title = String(record?.title ?? '').trim();
  if (title.length >= 6 && cardText.includes(title)) return true;
  const text = String(record?.text ?? '').trim();
  if (text.length >= 16 && cardText.includes(text.slice(0, 16))) return true;
  return false;
}

/**
 * 命中的硬条件：正文/标题里真的出现过查询的内容词。
 * BM25 绝对值跟着语料规模走（几百条时好命中 5~11，只有一条时会被四舍五入成 0），
 * 不能当准入阈值；「词真的出现过」才挡得住「你还…」这种碎片带来的噪声。
 */
function matchHits(hits, terms) {
  const list = (Array.isArray(terms) ? terms : []).filter(Boolean);
  if (!list.length) return [];
  return hits.filter((hit) => {
    const hay = `${hit.title ?? ''} ${hit.text ?? ''}`.toLowerCase();
    return list.some((t) => hay.includes(String(t).toLowerCase()));
  });
}

/**
 * 唤醒时用的同步召回块。没触发词 / 分数不够 / 出任何错 → 返回 ''。
 *
 * @param {string} memoryDir 角色 memory 目录
 * @param {string} message 刚收到的消息（或用户这轮说的话）
 * @returns {string} 可直接拼进提示词的一段文本（可能为空）
 */
export function recallBlock(memoryDir, message, {
  dbPath,
  avoidText = '',
  limit = 3,
  maxChars = 600,
  minScore = 0,
  now = Date.now(),
  onHits = null,
} = {}) {
  try {
    const query = recallQuery(message);
    if (!query || !CJK_OR_WORD.test(query)) return '';
    if (!shouldRecall(query)) return '';
    if (!archiveReady(memoryDir)) return '';
    const tokens = recallTokens(query);
    if (!tokens.length) return '';
    // 派生库必须跟着**这个**档案目录走：以前 dbPath 缺省就是那一个生产库，
    // 任何别的目录（测试夹具/另一个角色）都会读写同一份库、互相顶掉对方的记录。
    const db = dbPath || memoryIndexPathFor(memoryDir);
    ensureMemoryIndexFresh(memoryDir, { dbPath: db, now });
    // 两遍：先按内容二元组查；一条都没有时退回「实体单字」兜底
    // （「还记得那只猫吗」的「猫」切不出二元组，但确实是这一句里唯一的内容）。
    let matched = matchHits(searchMemoryIndex(query, {
      dbPath: db, tokens, limit: Math.max(limit * 4, 12), maxChars: 400,
    }), tokens);
    if (!matched.length) {
      const total = memoryIndexStats(db).total || 0;
      const unigrams = recallUnigrams(message).filter((ch) => !tokens.includes(ch));
      if (unigrams.length && total) {
        // 单字必须「少见」才算实体：「记/说/过」命中一半记忆，拿它兜底等于随机挑三条。
        const df = tokenDocumentCounts(unigrams, { dbPath: db });
        const rarity = Math.max(3, Math.ceil(total * 0.08));
        const rare = unigrams.filter((ch) => (df[ch] || 0) > 0 && df[ch] <= rarity);
        if (rare.length) {
          matched = matchHits(searchMemoryIndex(query, {
            dbPath: db, tokens: rare, limit: Math.max(limit * 4, 12), maxChars: 400,
          }), rare);
        }
      }
    }
    if (!matched.length) return '';
    // 相对截断：明显不如第一名的丢掉（一条查不到时 best=0，就不截）。
    const best = Math.max(...matched.map((h) => Number(h.score) || 0));
    const floor = best > 0 ? Math.max(Number(minScore) || 0, best * 0.45) : 0;
    const picked = [];
    const pickedMeta = [];
    let used = 0;
    const seen = new Set();
    for (const hit of matched) {
      if (picked.length >= limit) break;
      if ((Number(hit.score) || 0) < floor) continue;
      const text = oneLine(hit.text || hit.title, 140);
      if (!text) continue;
      const key = text.slice(0, 24);
      if (seen.has(key)) continue;
      if (alreadyInCard(hit, avoidText)) continue;
      const line = `- ${dayOf(hit) ? `${dayOf(hit)} ` : ''}${text}`;
      if (used + line.length > maxChars) break;
      used += line.length;
      seen.add(key);
      picked.push(line);
      // 星图（实时脑图）要知道这次注入了哪几条：编号交出去，正文不外传。
      pickedMeta.push({ id: hit.id ?? null, score: Number(hit.score) || 0, day: dayOf(hit) || null });
    }
    if (!picked.length) return '';
    try {
      if (typeof onHits === 'function') onHits(pickedMeta.filter((m) => m.id));
    } catch { /* 回调只给观测用：它出错不该连累记忆注入 */ }
    return ['【记忆检索（和刚说的话相关；自然回忆，别照读，别提"记忆库"）】', ...picked].join('\n');
  } catch {
    return '';
  }
}

/**
 * 异步混合检索（控制台 / API）。返回结构化结果，失败也返回 ok:false 而不是抛。
 */
export async function searchMemoryAsync(memoryDir, query, {
  dbPath,
  limit = 8,
  scope = '',
  kinds = [],
  maxChars = 400,
  embed = {},
  hybrid = true,
} = {}) {
  const q = recallQuery(query);
  if (!q) return { ok: false, code: 'query.empty', error: '查询为空', hint: '传 query=关键词' };
  if (!archiveReady(memoryDir)) {
    return {
      ok: false,
      code: 'archive.missing',
      error: `找不到记忆档：${path.join(String(memoryDir ?? ''), 'memory-card-full.jsonl')}`,
      hint: '确认当前角色目录（characters/current.json）下存在 memory-card-full.jsonl',
    };
  }
  try {
    const db = dbPath || memoryIndexPathFor(memoryDir);
    if (!hybrid) {
      ensureMemoryIndexFresh(memoryDir, { dbPath: db });
      const items = searchMemoryIndex(q, { dbPath: db, limit, scope, kinds, maxChars });
      return { ok: true, mode: 'bm25', reason: '', items };
    }
    const res = await searchMemoryHybrid(memoryDir, q, { dbPath: db, limit, scope, kinds, maxChars, embed });
    const mode = res.mode ?? 'bm25';
    return {
      ok: true,
      mode,
      reason: res.reason ?? '',
      items: res.items ?? [],
      hint: mode === 'bm25' && res.reason
        ? '向量服务不可用，已降级纯关键词检索；启动 memory-rag/start-embed.ps1 可恢复语义检索'
        : '',
    };
  } catch (err) {
    return {
      ok: false,
      code: 'memory.search-failed',
      error: String(err?.message ?? err),
      hint: '检查 state/memory-rag/index.db 是否可读；删掉它会自动重建',
    };
  }
}