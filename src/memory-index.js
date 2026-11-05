/**
 * 记忆索引（Memory Index）—— 给「全量记忆卡」建本地检索索引。
 *
 * 为什么要它：
 *   `memory-card.js` 的 `recallFullMemory()` 是**线性扫档**：每次检索把 JSONL 从头
 *   读到尾、逐行 substring 匹配。档案到几十万行时，一次唤醒要几十毫秒到几秒，
 *   而且只能命中字面相同的词（「火锅」找不到「涮羊肉」）。
 *   这里把全量档案建成 SQLite 索引：FTS5 + BM25 + 中文二元分词，查询走索引而不是扫盘。
 *
 * 边界（和 RULES.md 一致）：
 *   · 只读 `memory-card-full.jsonl`，不改记忆卡本身；派生库随时可删可重建。
 *   · 派生库放在 `<DSH_HOME>/surfcore/state/memory-rag/index.db`，不进角色目录。
 *   · 纯 Node 模块（`node:sqlite`），不依赖 Python / 外部服务；不联网。
 *
 * 中文分词为什么自己写：
 *   FTS5 自带的 unicode61 不切中文（整句当一个词）。这里按「汉字二元组 + 拉丁词」
 *   预切好再入库，查询同样切法。二元组对中文 BM25 够用，也不需要 jieba/词典。
 *
 * 增量：
 *   meta 表记 `offset`（已消费到的字节数）和 `head`（文件头部指纹）。
 *   JSONL 只追加，所以下次从 offset 继续读；文件被截断/替换（指纹不符）就整库重建。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { surfcoreDir } from './token-budget.js';
import { DEFAULT_EMBED_MODEL, embedQuery, embedTexts } from './memory-embed.js';

export const MEMORY_INDEX_VERSION = 1;

/** 默认派生库路径：<DSH_HOME>/surfcore/state/memory-rag/index.db */
export function defaultMemoryIndexPath(env = process.env) {
  return path.join(surfcoreDir(env), 'state', 'memory-rag', 'index.db');
}

/** 当前角色目录（只读 characters/current.json，不 import 角色模块，避免循环依赖）。 */
function activeCharacterDir(env = process.env) {
  try {
    const file = path.join(surfcoreDir(env), 'characters', 'current.json');
    const dir = JSON.parse(fs.readFileSync(file, 'utf8'))?.dir;
    return dir ? path.resolve(String(dir)) : '';
  } catch {
    return '';
  }
}

/**
 * 派生库路径：**按档案目录分家**。
 *
 * 所有入口以前都把 `dbPath` 默认成那一个生产库，于是任何别的 `memoryDir`
 * （测试夹具、另一个角色）都会读写同一个库；而库的增量游标 (`meta.fingerprint` +
 * `offset`) 是**按某一份档案**记的，换档案就会整库重建。
 * 实测代价：一次星图回归用种子记忆把生产库重建成了 2 条，108 条真实记忆的检索当场失效。
 *
 * 规则：当前角色目录 → 默认路径；其它目录 → `state/memory-rag/archives/<sha1(dir)>.db`。
 */
export function memoryIndexPathFor(memoryDir, env = process.env) {
  const dir = String(memoryDir ?? '').trim();
  if (!dir) return defaultMemoryIndexPath(env);
  const resolved = path.resolve(dir);
  const active = activeCharacterDir(env);
  // 调用方给的有可能是角色的 memory 子目录，也有可能直接是角色目录。
  if (active && (resolved === active || resolved === path.join(active, 'memory'))) {
    return defaultMemoryIndexPath(env);
  }
  const key = crypto.createHash('sha1').update(resolved).digest('hex').slice(0, 16);
  return path.join(path.dirname(defaultMemoryIndexPath(env)), 'archives', `${key}.db`);
}

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/u;
const WORD_RE = /[0-9a-z\u00c0-\u024f]/u;

/**
 * 二元组/整串的边界停用字：词边界上切出来的「的东」「里那」「那种」在 FTS 里
 * 反而很"稀有"，会被 BM25 当成强特征（实测「屋里那种发蓝光的东西」靠「的东」
 * 把一条讲飞机的动态顶到第一）。索引侧就丢掉，别让它们进 FTS。
 * 单字不动：单字查询（「猫」）和中文字典本身要靠它们。
 */
const EDGE_STOP_CHARS = new Set([...'我你他她它们的了吗呢吧啊哦嗯嘛呀是在有就都也还和与把被给让对从到为所以及才又再很太更最什么那这']);

function junkEdge(token) {
  const chars = [...token];
  return EDGE_STOP_CHARS.has(chars[0]) || EDGE_STOP_CHARS.has(chars[chars.length - 1]);
}

/** 把一段文本切成检索用 token（汉字二元组 + 单字 + 拉丁词）。 */
export function memoryTokens(text) {
  const src = String(text ?? '').normalize('NFKC').toLowerCase();
  const tokens = [];
  let cjk = '';
  let word = '';
  const flushCjk = () => {
    if (!cjk) return;
    const chars = [...cjk];
    // 单字也入库：中文里「猫」这种单字查询必须能命中「猫咪」。
    for (const ch of chars) tokens.push(ch);
    for (let i = 0; i + 1 < chars.length; i += 1) {
      const gram = chars[i] + chars[i + 1];
      if (!junkEdge(gram)) tokens.push(gram);
    }
    if (chars.length >= 3 && chars.length <= 6 && !junkEdge(cjk)) tokens.push(cjk);
    cjk = '';
  };
  const flushWord = () => {
    if (!word) return;
    tokens.push(word);
    word = '';
  };
  for (const ch of src) {
    if (CJK_RE.test(ch)) {
      flushWord();
      cjk += ch;
    } else if (WORD_RE.test(ch)) {
      flushCjk();
      word += ch;
    } else {
      flushCjk();
      flushWord();
    }
  }
  flushCjk();
  flushWord();
  return tokens;
}

/** 记录里参与检索的正文（标题 + 内容 + 说话人 + 标签）。 */
export function memorySearchText(record = {}) {
  const tags = Array.isArray(record.tags) ? record.tags.join(' ') : String(record.tags ?? '');
  return [record.title, record.text, record.detail, record.speaker, record.groupName, tags]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
    .join('\n');
}

function openDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  // 桥接和控制台可能同时写：忙等 5 秒，不要立刻抛 SQLITE_BUSY。
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT '',
      speaker TEXT NOT NULL DEFAULT '',
      importance INTEGER NOT NULL DEFAULT 0,
      clarity TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '',
      length INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS memories_created ON memories(created_at);
    CREATE INDEX IF NOT EXISTS memories_scope ON memories(scope);
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      tokens,
      title_tokens,
      id UNINDEXED,
      tokenize = 'unicode61'
    );
    -- 向量层：一条记忆一条单位向量（float32 blob）。模型/维度记在 meta 里，
    -- 换模型时整层重算，不和关键词索引混在一起。
    CREATE TABLE IF NOT EXISTS vectors (
      id TEXT PRIMARY KEY,
      dim INTEGER NOT NULL,
      vec BLOB NOT NULL
    );
  `);
}

function getMeta(db, key) {
  try {
    const row = db.prepare('SELECT v FROM meta WHERE k = ?').get(key);
    return row ? row.v : null;
  } catch {
    return null;
  }
}

function setMeta(db, key, value) {
  db.prepare('INSERT INTO meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
    .run(key, String(value));
}

function rowToRecord(row) {
  let tags = [];
  try { tags = JSON.parse(row.tags || '[]'); } catch { tags = []; }
  return {
    id: row.id,
    title: row.title,
    text: row.text,
    tags,
    kind: row.kind,
    scope: row.scope,
    speaker: row.speaker,
    importance: row.importance,
    clarity: row.clarity,
    createdAt: row.created_at,
  };
}

/**
 * 打开派生库（不存在就建）。返回 { db, close }。
 */
export function openMemoryIndex(dbPath = defaultMemoryIndexPath()) {
  const db = openDb(dbPath);
  ensureSchema(db);
  return { db, path: dbPath, close: () => { try { db.close(); } catch {} } };
}

/** 单条记录写库（幂等 upsert，同时维护 FTS 表；FTS 用 memories 的 rowid 对应，删除是 O(1)）。 */
function upsertRecord(db, record, stmts) {
  const id = String(record?.id ?? '').trim();
  if (!id) return false;
  const searchText = memorySearchText(record);
  const tokens = memoryTokens(searchText).join(' ');
  const titleTokens = memoryTokens(record?.title ?? '').join(' ');
  stmts.insert.run(
    id,
    String(record?.createdAt ?? ''),
    String(record?.kind ?? ''),
    String(record?.scope ?? ''),
    String(record?.speaker ?? ''),
    Number(record?.importance) || 0,
    String(record?.clarity ?? ''),
    String(record?.title ?? ''),
    String(record?.text ?? ''),
    JSON.stringify(Array.isArray(record?.tags) ? record.tags : []),
    searchText.length,
  );
  // 不用 lastInsertRowid：ON CONFLICT DO UPDATE 走的是 UPDATE，last_insert_rowid 不会更新。
  const rid = stmts.selectRowid.get(id)?.rid;
  if (!rid) return false;
  stmts.deleteFts.run(rid);
  stmts.insertFts.run(rid, tokens, titleTokens, id);
  return true;
}

/**
 * 把一批记录写进索引。返回 { added, updated }（updated 目前按主键冲突计）。
 */
export function indexMemoryRecords(db, records, { now = Date.now() } = {}) {
  ensureSchema(db);
  const insertStmt = db.prepare(`
    INSERT INTO memories(id, created_at, kind, scope, speaker, importance, clarity, title, text, tags, length)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      created_at = excluded.created_at, kind = excluded.kind, scope = excluded.scope,
      speaker = excluded.speaker, importance = excluded.importance, clarity = excluded.clarity,
      title = excluded.title, text = excluded.text, tags = excluded.tags, length = excluded.length
  `);
  const deleteFts = db.prepare('DELETE FROM memories_fts WHERE rowid = ?');
  const insertFts = db.prepare('INSERT INTO memories_fts(rowid, tokens, title_tokens, id) VALUES(?, ?, ?, ?)');
  const selectRowid = db.prepare('SELECT rowid AS rid FROM memories WHERE id = ?');
  const stmts = { insert: insertStmt, deleteFts, insertFts, selectRowid };
  const exists = db.prepare('SELECT 1 FROM memories WHERE id = ?');
  let added = 0;
  let updated = 0;
  db.exec('BEGIN');
  try {
    for (const record of records) {
      const id = String(record?.id ?? '').trim();
      if (!id) continue;
      const present = Boolean(exists.get(id));
      if (upsertRecord(db, record, stmts)) {
        if (present) updated += 1;
        else added += 1;
      }
    }
    setMeta(db, 'indexed_at', now);
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    throw err;
  }
  return { added, updated };
}

function fileFingerprint(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(64);
    const read = fs.readSync(fd, head, 0, 64, 0);
    fs.closeSync(fd);
    // 只取文件头：追加不会改头，换档案/重建才会。路径不进指纹（同一角色目录可能搬家）。
    return head.subarray(0, read).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * 从 JSONL 增量同步索引。
 * @returns {{ added:number, updated:number, scanned:number, rebuilt:boolean, total:number }}
 */
export function syncMemoryIndex(jsonlPath, {
  dbPath = defaultMemoryIndexPath(),
  force = false,
  maxScanBytes = 512 * 1024 * 1024,
  now = Date.now(),
} = {}) {
  const { db, close } = openMemoryIndex(dbPath);
  try {
    const fp = fileFingerprint(jsonlPath);
    if (!fp || !fs.existsSync(jsonlPath)) {
      return { added: 0, updated: 0, scanned: 0, rebuilt: false, total: countRecords(db), missing: true };
    }
    const storedFp = getMeta(db, 'fingerprint');
    let rebuilt = false;
    if (force) {
      db.exec('DELETE FROM memories; DELETE FROM memories_fts; DELETE FROM meta;');
      rebuilt = true;
    } else if (storedFp && storedFp !== fp) {
      // 文件被换掉了（另一份档案）：文件头对不上就整库重建。
      db.exec('DELETE FROM memories; DELETE FROM memories_fts; DELETE FROM meta;');
      rebuilt = true;
    }
    setMeta(db, 'fingerprint', fp);

    let offset = force || rebuilt ? 0 : Number(getMeta(db, 'offset') || 0);
    const size = fs.statSync(jsonlPath).size;
    if (offset > size) { offset = 0; }
    if (offset === size) {
      return { added: 0, updated: 0, scanned: 0, rebuilt, total: countRecords(db) };
    }
    // 分块读：一次最多 32MB，避免大档案把 maxScanBytes（默认 512MB）整个 alloc 进内存。
    const budget = Math.max(0, Number(maxScanBytes) || 0);
    const CHUNK = 32 * 1024 * 1024;
    let spent = 0;
    let added = 0;
    let updated = 0;
    let scanned = 0;
    while (offset < size && spent < budget) {
      const want = Math.min(size - offset, budget - spent, CHUNK);
      if (want <= 0) break;
      const fd = fs.openSync(jsonlPath, 'r');
      let buf;
      try {
        buf = Buffer.alloc(want);
        const read = fs.readSync(fd, buf, 0, want, offset);
        if (read < want) buf = buf.subarray(0, read);
      } finally {
        fs.closeSync(fd);
      }
      if (!buf.length) break;
      const text = buf.toString('utf8');
      const lastNewline = text.lastIndexOf('\n');
      if (lastNewline < 0) {
        // 整个分块都是半行（正在写），下次再来。
        break;
      }
      const usable = text.slice(0, lastNewline + 1);
      const records = [];
      for (const line of usable.split('\n')) {
        if (!line.trim()) continue;
        try { records.push(JSON.parse(line)); } catch {}
      }
      const res = indexMemoryRecords(db, records, { now });
      added += res.added;
      updated += res.updated;
      scanned += records.length;
      const consumed = Buffer.byteLength(usable, 'utf8');
      offset += consumed;
      spent += consumed;
      setMeta(db, 'offset', offset);
      // 分块里剩下的都是半行：等文件写完再来。
      if (consumed < want) break;
    }
    if (scanned === 0) setMeta(db, 'offset', offset);
    return { added, updated, scanned, rebuilt, total: countRecords(db) };
  } finally {
    close();
  }
}

function countRecords(db) {
  try {
    const row = db.prepare('SELECT COUNT(*) AS n FROM memories').get();
    return Number(row?.n) || 0;
  } catch {
    return 0;
  }
}

/** 索引概况。 */
export function memoryIndexStats(dbPath = defaultMemoryIndexPath()) {
  if (!fs.existsSync(dbPath)) return { exists: false, path: dbPath, total: 0 };
  const { db, close } = openMemoryIndex(dbPath);
  try {
    const total = countRecords(db);
    const byScope = db.prepare('SELECT scope, COUNT(*) AS n FROM memories GROUP BY scope ORDER BY n DESC').all();
    const newest = db.prepare('SELECT created_at FROM memories ORDER BY created_at DESC LIMIT 1').get();
    return {
      exists: true,
      path: dbPath,
      total,
      byScope: byScope.map((r) => ({ scope: r.scope, count: Number(r.n) })),
      newest: newest?.created_at ?? '',
      indexedAt: Number(getMeta(db, 'indexed_at') || 0) || null,
      sizeBytes: (() => { try { return fs.statSync(dbPath).size; } catch { return 0; } })(),
    };
  } finally {
    close();
  }
}

/**
 * 构造 FTS5 查询：多个 token 之间用 OR（BM25 自动按命中给分）。
 *
 * 单字很吵：中文里「的/是/我/了」几乎命中每一条，混在 OR 里会把无关记忆抬上来
 * （实测「屋里那种发蓝光的东西」靠单字凑出 40 条命中，top1 BM25 10.5 分）。
 * 所以优先只用二元及以上；整句都是单字（查询就是「猫」这种）才退回单字。
 */
function ftsQueryFromTokens(all) {
  const list = [...new Set((all || []).filter(Boolean))];
  if (!list.length) return '';
  const multi = list.filter((t) => [...t].length >= 2);
  const tokens = multi.length ? multi : list;
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
}

function ftsQuery(query) {
  return ftsQueryFromTokens(memoryTokens(query));
}

/**
 * 检索。
 * @returns {Array<{id,title,text,tags,kind,scope,speaker,importance,clarity,createdAt,score}>}
 */
export function searchMemoryIndex(query, {
  dbPath = defaultMemoryIndexPath(),
  limit = 8,
  scope = '',
  kinds = [],
  maxChars = 1200,
  tokens = null,
} = {}) {
  const q = String(query ?? '').trim();
  if (!q) return [];
  if (!fs.existsSync(dbPath)) return [];
  const { db, close } = openMemoryIndex(dbPath);
  try {
    // tokens 显式给出时不再二次分词：调用方（唤醒召回）已经去过停用词，
    // 再切一遍会把「下宫」这种跨词碎片放进来。
    const expr = Array.isArray(tokens) && tokens.length ? ftsQueryFromTokens(tokens) : ftsQuery(q);
    if (!expr) return [];
    const max = Math.max(1, Math.min(50, Number(limit) || 8));
    const overFetch = Math.max(30, max * 5);
    const rows = db.prepare(`
      SELECT m.id, m.created_at, m.kind, m.scope, m.speaker, m.importance, m.clarity,
             m.title, m.text, m.tags, bm25(memories_fts) AS rank
      FROM memories_fts JOIN memories m ON m.id = memories_fts.id
      WHERE memories_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(expr, overFetch);
    const scopeFilter = String(scope || '').trim();
    const kindFilter = new Set((kinds || []).map(String));
    const out = [];
    for (const row of rows) {
      if (scopeFilter && row.scope !== scopeFilter) continue;
      if (kindFilter.size && !kindFilter.has(row.kind)) continue;
      const rec = rowToRecord(row);
      const text = String(rec.text ?? '');
      out.push({
        ...rec,
        text: text.length > maxChars ? `${[...text].slice(0, maxChars).join('')}…` : text,
        score: Math.round((Number(row.rank) || 0) * -10000) / 10000,
      });
      if (out.length >= max) break;
    }
    return out;
  } finally {
    close();
  }
}

/**
 * 每个 token 命中了多少条记忆（文档频次）。用来判断「这个词是不是太常见」：
 * 单字兜底时，命中一半语料的字（记/说/过）不可能是选择题眼。
 */
export function tokenDocumentCounts(tokens, { dbPath = defaultMemoryIndexPath() } = {}) {
  const list = [...new Set((tokens || []).map((t) => String(t)).filter(Boolean))];
  if (!list.length || !fs.existsSync(dbPath)) return {};
  const { db, close } = openMemoryIndex(dbPath);
  try {
    const stmt = db.prepare('SELECT COUNT(*) AS n FROM memories_fts WHERE memories_fts MATCH ?');
    const out = {};
    for (const token of list) {
      try {
        out[token] = Number(stmt.get(`"${token.replace(/"/g, '""')}"`)?.n) || 0;
      } catch {
        out[token] = 0;
      }
    }
    return out;
  } finally {
    close();
  }
}

// 唤醒路径上不能每次都同步：同一次唤醒里可能查好几次，用 mtime+size 做节流。
const lastSync = new Map();
const SYNC_THROTTLE_MS = 30_000;

function fileStamp(file) {
  try {
    const st = fs.statSync(file);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return '';
  }
}

/**
 * 需要时把索引同步到最新（节流 30 秒）。给桥接/控制台调用，失败不抛。
 * @returns {{ synced:boolean, added:number, total:number }}
 */
export function ensureMemoryIndexFresh(memoryDir, {
  dbPath = '',
  now = Date.now(),
} = {}) {
  const jsonl = path.join(String(memoryDir ?? ''), 'memory-card-full.jsonl');
  const db = dbPath || memoryIndexPathFor(memoryDir);
  try {
    if (!fs.existsSync(jsonl)) return { synced: false, added: 0, total: 0 };
    const stamp = `${jsonl}|${fileStamp(jsonl)}`;
    const last = lastSync.get(jsonl);
    if (last && last.stamp === stamp && last.db === db && now - last.at < SYNC_THROTTLE_MS) {
      return { synced: false, added: 0, total: last.total };
    }
    const res = syncMemoryIndex(jsonl, { dbPath: db, now });
    lastSync.set(jsonl, { stamp, at: now, total: res.total, db });
    return { synced: true, added: res.added, total: res.total };
  } catch {
    return { synced: false, added: 0, total: 0 };
  }
}

/**
 * 一步到位：从角色 memory 目录检索（自动增量同步）。
 * 桥接以后用这个，而不是自己拼 paths。
 */
export function searchMemory(memoryDir, query, {
  dbPath = '',
  limit = 8,
  scope = '',
  kinds = [],
  maxChars = 1200,
  now = Date.now(),
} = {}) {
  const db = dbPath || memoryIndexPathFor(memoryDir);
  ensureMemoryIndexFresh(memoryDir, { dbPath: db, now });
  return searchMemoryIndex(query, { dbPath: db, limit, scope, kinds, maxChars });
}
// ─────────────────────────── 向量层（语义检索） ───────────────────────────
//
// 关键词索引解决「字面命中」，向量解决「意思接近但用词不同」（火锅 ↔ 涮羊肉）。
// 两者不是替代关系：混合检索用 RRF 融合两路排名，单路挂了另一路照常出结果。

const VEC_MODEL_KEY = 'vec_model';
const VEC_DIM_KEY = 'vec_dim';
const RRF_K = 60;

function vecToBlob(vec) {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

function blobToVec(buf) {
  const copy = Buffer.from(buf);
  const ab = copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength);
  return new Float32Array(ab);
}

function vectorText(row) {
  // 标题 + 正文：标题通常是人/物/句眼，正文给上下文；不含时间与标签，避免噪声。
  const title = String(row.title ?? '').trim();
  const text = String(row.text ?? '').trim();
  return `${title}${title && text ? '。' : ''}${text}`.slice(0, 2000);
}

/** 向量层状态：{ exists, count, dim, model }，失败返回 exists=false。 */
export function vectorIndexStats(dbPath = defaultMemoryIndexPath()) {
  if (!fs.existsSync(dbPath)) return { exists: false, count: 0, memories: 0, dim: 0, model: '' };
  let db;
  try {
    db = openDb(dbPath);
    ensureSchema(db);
    const count = Number(db.prepare('SELECT COUNT(*) AS c FROM vectors').get()?.c ?? 0);
    const memories = Number(db.prepare('SELECT COUNT(*) AS c FROM memories').get()?.c ?? 0);
    const dim = Number(getMeta(db, VEC_DIM_KEY) ?? 0);
    const model = getMeta(db, VEC_MODEL_KEY) ?? '';
    return { exists: count > 0, count, memories, dim, model };
  } catch {
    return { exists: false, count: 0, dim: 0, model: '' };
  } finally {
    try { db?.close(); } catch {}
  }
}

/**
 * 给还没向量的记忆补向量（增量）。换模型会自动清空重算。
 * 失败抛错，由调用方决定是降级还是一直重试。
 */
export async function syncVectors({
  memoryDir = '',
  jsonlPath = '',
  dbPath = '',
  embed = {},
  force = false,
  batch = 16,
  onProgress,
} = {}) {
  const jsonl = jsonlPath || (memoryDir ? path.join(String(memoryDir), 'memory-card-full.jsonl') : '');
  const dbPathResolved = dbPath || memoryIndexPathFor(memoryDir || path.dirname(jsonl));
  if (!jsonl || !fs.existsSync(jsonl)) return { embedded: 0, total: 0, dim: 0, reason: 'no-archive' };
  // 向量是挂在 memories 行上的：先把关键词索引补到最新。
  syncMemoryIndex(jsonl, { dbPath: dbPathResolved });
  const model = embed.model || DEFAULT_EMBED_MODEL;
  const { db, close } = openMemoryIndex(dbPathResolved);
  try {
    const storedModel = getMeta(db, VEC_MODEL_KEY);
    if (force || (storedModel && storedModel !== model)) {
      db.exec('DELETE FROM vectors');
    }
    const rows = db.prepare(`
      SELECT m.id, m.title, m.text
      FROM memories m LEFT JOIN vectors v ON v.id = m.id
      WHERE v.id IS NULL AND (m.title <> '' OR m.text <> '')
      ORDER BY m.rowid
    `).all();
    if (!rows.length) {
      const total = Number(db.prepare('SELECT COUNT(*) AS c FROM vectors').get()?.c ?? 0);
      return { embedded: 0, total, dim: Number(getMeta(db, VEC_DIM_KEY) ?? 0), model };
    }
    const insert = db.prepare('INSERT OR REPLACE INTO vectors(id, dim, vec) VALUES(?, ?, ?)');
    let embedded = 0;
    let dim = 0;
    for (let i = 0; i < rows.length; i += batch) {
      const chunk = rows.slice(i, i + batch);
      const vecs = await embedTexts(chunk.map(vectorText), embed);
      if (!Array.isArray(vecs) || vecs.length !== chunk.length) {
        const err = new Error(`embedding 返回数量不符：要 ${chunk.length} 条，拿到 ${Array.isArray(vecs) ? vecs.length : '非数组'}`);
        err.code = 'embed.count-mismatch';
        throw err;
      }
      db.exec('BEGIN');
      try {
        chunk.forEach((row, j) => {
          const vec = vecs[j];
          if (!vec?.length) {
            const err = new Error(`embedding 返回空向量：${row.id}`);
            err.code = 'embed.empty-vector';
            throw err;
          }
          dim = vec.length;
          insert.run(row.id, vec.length, vecToBlob(vec));
        });
        db.exec('COMMIT');
      } catch (err) {
        try { db.exec('ROLLBACK'); } catch {}
        throw err;
      }
      embedded += chunk.length;
      onProgress?.({ done: i + chunk.length, total: rows.length });
    }
    if (dim) {
      setMeta(db, VEC_DIM_KEY, dim);
      setMeta(db, VEC_MODEL_KEY, model);
    }
    const total = Number(db.prepare('SELECT COUNT(*) AS c FROM vectors').get()?.c ?? 0);
    return { embedded, total, dim, model };
  } finally {
    close();
  }
}

/**
 * 余弦检索（向量已归一化，等价于点积）。
 * candidateIds 非空时只在这些 id 里算，用于大档案降级。
 */
export function searchVectors(queryVec, {
  dbPath = defaultMemoryIndexPath(),
  limit = 40,
  minScore = 0,
  candidateIds = null,
} = {}) {
  if (!queryVec?.length) return [];
  if (!fs.existsSync(dbPath)) return [];
  const { db, close } = openMemoryIndex(dbPath);
  try {
    let rows;
    if (candidateIds && candidateIds.length) {
      const marks = candidateIds.map(() => '?').join(',');
      rows = db.prepare(`SELECT id, dim, vec FROM vectors WHERE id IN (${marks})`).all(...candidateIds);
    } else {
      rows = db.prepare('SELECT id, dim, vec FROM vectors').all();
    }
    const out = [];
    for (const row of rows) {
      if (row.dim !== queryVec.length) continue;
      const vec = blobToVec(row.vec);
      let dot = 0;
      for (let i = 0; i < vec.length; i += 1) dot += vec[i] * queryVec[i];
      if (dot < minScore) continue;
      out.push({ id: row.id, score: dot });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, Math.max(1, limit));
  } finally {
    close();
  }
}

let pendingVectorSync = null;

/** 后台补向量（同一进程内只跑一份），失败静默——下次检索再试。 */
function kickVectorSync(memoryDir, dbPath, embed) {
  if (pendingVectorSync) return;
  pendingVectorSync = syncVectors({ memoryDir, dbPath, embed })
    .catch(() => {})
    .finally(() => { pendingVectorSync = null; });
}

/**
 * 混合检索：BM25 + 向量，RRF 融合。
 * 向量服务不可用/没建向量时自动退回纯 BM25（reason 里说明），唤醒路径不会因此断。
 */
export async function searchMemoryHybrid(memoryDir, query, {
  dbPath = '',
  limit = 8,
  scope = '',
  kinds = [],
  maxChars = 1200,
  embed = {},
  vectorLimit = 40,
  minScore = 0.2,
  vectorMargin = 0.15,
  now = Date.now(),
} = {}) {
  const q = String(query ?? '').trim();
  if (!q) return { items: [], mode: 'empty' };
  const db = dbPath || memoryIndexPathFor(memoryDir);
  ensureMemoryIndexFresh(memoryDir, { dbPath: db, now });

  const lexical = searchMemoryIndex(q, { dbPath: db, limit: Math.max(limit * 5, 40), scope, kinds, maxChars });
  const stats = vectorIndexStats(db);
  if (!stats.exists) return { items: lexical.slice(0, limit), mode: 'bm25', reason: 'no-vectors' };
  // 新记忆还没向量：这次先用旧的，后台补上，不拖慢唤醒。
  if (stats.count < stats.memories) kickVectorSync(memoryDir, db, embed);

  let queryVec;
  try {
    queryVec = await embedQuery(q, embed);
  } catch (err) {
    return { items: lexical.slice(0, limit), mode: 'bm25', reason: `embed-failed: ${err?.message || err}` };
  }
  let semantic = searchVectors(queryVec, { dbPath: db, limit: vectorLimit, minScore });
  // 绝对阈值在不同问法下不可靠（换个说法整体余弦就掉到 0.3），
  // 再按「离最好那条差太远就丢」做一次相对截断，避免把无关条目塞进 RRF。
  if (semantic.length) {
    const best = semantic[0].score;
    const cutoff = Math.max(minScore, best - vectorMargin);
    semantic = semantic.filter((h) => h.score >= cutoff).slice(0, vectorLimit);
  }
  const fused = new Map();
  lexical.forEach((item, i) => {
    fused.set(item.id, { item, rank: 1 / (RRF_K + i + 1), via: ['bm25'] });
  });
  semantic.forEach((hit, i) => {
    const share = 1 / (RRF_K + i + 1);
    const hitScore = Math.round(hit.score * 10000) / 10000;
    if (fused.has(hit.id)) {
      fused.get(hit.id).rank += share;
      fused.get(hit.id).via.push(`vec:${hitScore}`);
    } else {
      fused.set(hit.id, { item: { id: hit.id, score: hitScore }, rank: share, via: [`vec:${hitScore}`] });
    }
  });

  // 只走向量的条目要回表补正文
  const missing = [...fused.values()].filter((e) => e.item.title === undefined).map((e) => e.item.id);
  if (missing.length) {
    const { db: readDb, close } = openMemoryIndex(db);
    try {
      const marks = missing.map(() => '?').join(',');
      const rows = readDb.prepare(`SELECT * FROM memories WHERE id IN (${marks})`).all(...missing);
      const byId = new Map(rows.map((r) => [r.id, rowToRecord(r)]));
      for (const entry of fused.values()) {
        if (entry.item.title !== undefined) continue;
        const rec = byId.get(entry.item.id);
        if (!rec) continue;
        const text = String(rec.text ?? '');
        entry.item = {
          ...rec,
          text: text.length > maxChars ? `${[...text].slice(0, maxChars).join('')}…` : text,
          score: entry.item.score,
        };
      }
    } finally {
      close();
    }
  }

  const scopeFilter = String(scope || '').trim();
  const kindFilter = new Set((kinds || []).map(String));
  const items = [...fused.values()]
    .filter((e) => !scopeFilter || e.item.scope === scopeFilter)
    .filter((e) => !kindFilter.size || kindFilter.has(e.item.kind))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map((e) => ({ ...e.item, rrf: Math.round(e.rank * 1e6) / 1e6, via: e.via }));
  return { items, mode: 'hybrid' };
}
