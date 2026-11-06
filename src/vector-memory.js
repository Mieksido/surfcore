/**
 * 向量记忆（独立系统）——纯逻辑 + 文件存储 + 本地 Embedding 服务客户端。
 *
 * 设计契约（与 docs/handoffs/2026-11-02-vector-memory-embedding-service.md 对齐）：
 *   · 记忆数据独立存放：`vector-memory.jsonl`（append-only），不复制/不迁移叙事记忆卡；
 *   · 向量索引独立存放：`vector-memory-index.bin` + `.json`，按 model_space 隔离；
 *   · 写入方只有插件宿主；QQ 桥接只读索引，不写任何向量记忆文件；
 *   · Embedding 服务只负责「文本 → 向量」，不负责存储/检索/注入；
 *   · 读取哪个系统只由 memory.mode 决定，两个存储都继续工作。
 *
 * 这个模块不依赖宿主（DSH/插件/桥接），可以被单测、插件和桥接同时引用。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const VECTOR_MEMORY_VERSION = 1;
export const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_VECTOR_MEMORY_CONFIG = Object.freeze({
  enabled: true,
  /** local = 本机 Ollama 模型；cloud = Embedding 服务的云端 provider（OpenAI 兼容）。 */
  provider: 'local',
  model: 'bge-m3',
  modelSpace: 'bge-m3@1024-f16-v1',
  /** 云端 provider 的模型名与空间名，必须与 Embedding 服务环境变量一致。 */
  cloudModel: 'BAAI/bge-m3',
  cloudModelSpace: 'bge-m3@1024-cloud-v1',
  /** 当前选中的 embedding-pack id（空 = 外部服务/未选）。 */
  packId: '',
  /** 三个本地模型包的网盘链接（设置页展示；下载/导入由用户完成）。 */
  packLinks: Object.freeze({
    'bge-small-zh-v1.5': '',
    'qwen3-embedding-0.6b': '',
    'bge-m3': '',
  }),
  /** 四个 zip 放在同一个网盘目录时，用公用链接 + 提取码；单模型链接优先。 */
  packShareUrl: '',
  packSharePassword: '',
  packShareDir: 'embedding',
  /** 空 = 自动读发现文件；设置后直接走该 URL（例如 http://127.0.0.1:18765）。 */
  serviceUrl: '',
  /** 空 = %USERPROFILE%/.dsh/surfcore/embedding-service.json。 */
  discoveryFile: '',
  /** serviceUrl 直连时可选的 Bearer token；发现文件模式不需要。 */
  token: '',
  topK: 4,
  minScore: 0.4,
  injectMaxChars: 600,
  maxRecords: 5000,
  batchSize: 32,
  /** 每个维护 tick 最多编码多少条，避免一次阻塞太久。 */
  maxEmbedPerTick: 256,
  timeoutMs: 30000,
});

const SENSITIVE_RE = /政治|时政|新闻|大选|两会|习近平|总统|首相|政府|国务院|外交部|国防|军事|战争|俄乌|乌克兰|俄罗斯|巴以|以色列|巴勒斯坦|加沙|特朗普|拜登|普京|泽连斯基|选举|台湾|台独|南海|香港|新疆|西藏|六四|文革|法轮|股市|A股|美股|制裁|联合国|明星|娱乐圈|综艺|八卦|绯闻|恋情|分手|离婚|塌房|饭圈|偶像|爱豆|追星/;
const PLACEHOLDER_RE = /^\[(图片|表情|转发消息|拍一拍)\]/;

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function short(text, max = 80) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function hash(value, len = 16) {
  return crypto.createHash('sha1').update(String(value ?? '')).digest('hex').slice(0, len);
}

function timeOf(value, fallback) {
  const t = typeof value === 'number' ? value : Date.parse(String(value ?? ''));
  return Number.isFinite(t) ? t : fallback;
}

function iso(now) {
  return new Date(now).toISOString();
}

function dateOnly(value) {
  const t = timeOf(value, 0);
  if (!t) return '';
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 向量记忆比日志更敏感：入库前最少去掉密钥形状、手机号和长串。 */
export function redactVectorText(text, { maxChars = 1200 } = {}) {
  let s = String(text ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\r\n?/g, '\n');
  s = s.replace(/\b(token|password|passwd|secret|api[_-]?key|cookie|authorization|bearer)\b\s*[:=：]\s*[^\s，。；]+/gi, '$1=[已隐藏]');
  s = s.replace(/(密码|口令|密钥|令牌|验证码)\s*(?:是|为|[:=：])\s*[^\s，。；]+/g, '$1=[已隐藏]');
  s = s.replace(/\b(?:sk|ghp|gho|xoxb|xoxp)[-_][A-Za-z0-9_-]{8,}\b/g, '[令牌已隐藏]');
  s = s.replace(/\b1[3-9]\d{9}\b/g, '[手机号已隐藏]');
  s = s.replace(/\b[A-Za-z0-9+/_-]{32,}={0,2}\b/g, '[长串已隐藏]');
  const trimmed = s.trim();
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}…` : trimmed;
}

export function normalizeVectorMemoryConfig(input = {}) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    enabled: bool(raw.enabled, DEFAULT_VECTOR_MEMORY_CONFIG.enabled),
    provider: raw.provider === 'cloud' ? 'cloud' : 'local',
    model: String(raw.model ?? DEFAULT_VECTOR_MEMORY_CONFIG.model).trim() || DEFAULT_VECTOR_MEMORY_CONFIG.model,
    modelSpace: String(raw.modelSpace ?? DEFAULT_VECTOR_MEMORY_CONFIG.modelSpace).trim() || DEFAULT_VECTOR_MEMORY_CONFIG.modelSpace,
    cloudModel: String(raw.cloudModel ?? DEFAULT_VECTOR_MEMORY_CONFIG.cloudModel).trim() || DEFAULT_VECTOR_MEMORY_CONFIG.cloudModel,
    cloudModelSpace: String(raw.cloudModelSpace ?? DEFAULT_VECTOR_MEMORY_CONFIG.cloudModelSpace).trim() || DEFAULT_VECTOR_MEMORY_CONFIG.cloudModelSpace,
    packId: String(raw.packId ?? '').trim(),
    packLinks: Object.fromEntries(Object.keys(DEFAULT_VECTOR_MEMORY_CONFIG.packLinks).map((id) => [
      id,
      String(raw.packLinks && typeof raw.packLinks === 'object' ? (raw.packLinks[id] ?? '') : '').trim(),
    ])),
    packShareUrl: String(raw.packShareUrl ?? '').trim(),
    packSharePassword: String(raw.packSharePassword ?? '').trim(),
    packShareDir: String(raw.packShareDir ?? DEFAULT_VECTOR_MEMORY_CONFIG.packShareDir).trim() || 'embedding',
    serviceUrl: String(raw.serviceUrl ?? '').trim(),
    discoveryFile: String(raw.discoveryFile ?? '').trim(),
    token: String(raw.token ?? '').trim(),
    topK: clampInt(raw.topK, DEFAULT_VECTOR_MEMORY_CONFIG.topK, 1, 20),
    minScore: clampNumber(raw.minScore, DEFAULT_VECTOR_MEMORY_CONFIG.minScore, 0, 1),
    injectMaxChars: clampInt(raw.injectMaxChars, DEFAULT_VECTOR_MEMORY_CONFIG.injectMaxChars, 100, 4000),
    maxRecords: clampInt(raw.maxRecords, DEFAULT_VECTOR_MEMORY_CONFIG.maxRecords, 100, 20000),
    batchSize: clampInt(raw.batchSize, DEFAULT_VECTOR_MEMORY_CONFIG.batchSize, 1, 64),
    maxEmbedPerTick: clampInt(raw.maxEmbedPerTick, DEFAULT_VECTOR_MEMORY_CONFIG.maxEmbedPerTick, 1, 2000),
    timeoutMs: clampInt(raw.timeoutMs, DEFAULT_VECTOR_MEMORY_CONFIG.timeoutMs, 1000, 120000),
  };
}

/** 读取路径实际使用的模型/空间：cloud 时切到云端字段，索引隔离仍按 modelSpace。 */
export function effectiveVectorMemoryConfig(input = {}) {
  const cfg = normalizeVectorMemoryConfig(input);
  return cfg.provider === 'cloud'
    ? { ...cfg, model: cfg.cloudModel, modelSpace: cfg.cloudModelSpace }
    : cfg;
}

export function resolveVectorMemoryPaths(memoryDir) {
  const dir = String(memoryDir ?? '');
  return {
    dir,
    records: path.join(dir, 'vector-memory.jsonl'),
    indexDir: path.join(dir, 'vector-memory-index'),
    // 旧版单索引：保留读取兼容，生产写入改为按 modelSpace 分文件。
    indexJson: path.join(dir, 'vector-memory-index.json'),
    indexBin: path.join(dir, 'vector-memory-index.bin'),
  };
}

function safeIndexKey(modelSpace) {
  const text = String(modelSpace ?? '').trim() || 'default';
  const readable = text.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 72) || 'default';
  const hash = crypto.createHash('sha1').update(text).digest('hex').slice(0, 10);
  return `${readable}-${hash}`;
}

/** 每个模型空间一个索引文件；modelSpace 为空时用旧版单索引路径。 */
export function vectorIndexPaths(paths, modelSpace = '') {
  const space = String(modelSpace ?? '').trim();
  if (!space) return { json: paths.indexJson, bin: paths.indexBin, dir: paths.dir };
  const dir = paths.indexDir || path.join(paths.dir, 'vector-memory-index');
  const key = safeIndexKey(space);
  return { json: path.join(dir, `${key}.json`), bin: path.join(dir, `${key}.bin`), dir };
}

export function defaultDiscoveryFile() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return path.join(home, 'surfcore', 'embedding-service.json');
}

export function recordTextHash(text) {
  return hash(`text|${String(text ?? '')}`, 20);
}

function makeRecordId(parts) {
  return `vm_${hash(parts, 20)}`;
}

function importanceForSource(source, { isOwner = false, direct = false } = {}) {
  if (source === 'qq-owner' || source === 'pet-owner') return 75;
  if (source === 'qq-self' || source === 'pet-self') return 20;
  return direct || isOwner ? 55 : 30;
}

/** inbox 行 → 独立向量记忆记录。桥接已经做过一次脱敏，这里再做一次。 */
export function recordsFromInboxLines(lines, { now = Date.now() } = {}) {
  const out = [];
  for (const line of asArray(lines)) {
    const raw = String(line ?? '').trim();
    if (!raw) continue;
    let item;
    try { item = JSON.parse(raw); } catch { continue; }
    if (!item || typeof item !== 'object') continue;
    const text = redactVectorText(item.text, { maxChars: 1200 });
    if (!text || text.startsWith('/') || PLACEHOLDER_RE.test(text)) continue;
    const at = timeOf(item.at, now);
    const isPet = String(item.platform ?? '').toLowerCase() === 'pet';
    const isSelf = item.isSelf === true;
    const isOwner = item.isOwner === true;
    const isPrivate = item.private === true || item.kind === 'private';
    const source = isPet
      ? (isSelf ? 'pet-self' : 'pet-owner')
      : (isSelf ? 'qq-self' : (isOwner ? 'qq-owner' : 'qq-group'));
    const platform = isPet ? 'pet' : 'qq';
    const scope = isPet ? 'pet' : 'qq';
    const speaker = short(item.sender ?? (isSelf ? '角色' : (isOwner ? '主人' : '群友')), 40);
    const prefix = isPet ? '桌宠' : (isPrivate ? '私聊' : '群聊');
    const title = isOwner
      ? `${prefix} · 和主人：${short(text, 22)}`
      : (isSelf ? `${prefix} · ${speaker}说：${short(text, 22)}` : `${prefix} · ${speaker}：${short(text, 22)}`);
    out.push({
      id: makeRecordId(`${platform}|${item.senderId ?? ''}|${dateOnly(at)}|${text}`),
      text,
      title,
      platform,
      scope,
      source,
      sourceId: '',
      speaker,
      senderId: String(item.senderId ?? ''),
      groupId: String(item.groupId ?? ''),
      conversationKey: String(item.conversationKey ?? ''),
      isOwner,
      isSelf,
      private: isPrivate,
      important: isOwner,
      direct: item.direct === true || item.quoteSelf === true || isOwner,
      importance: importanceForSource(source, { isOwner, direct: item.direct === true || item.quoteSelf === true }),
      sensitive: SENSITIVE_RE.test(text),
      createdAt: iso(at),
      tags: [platform, source],
    });
  }
  return out;
}

/** bili-memory.json entries → 独立向量记忆记录。sourceId 去重。 */
export function recordsFromBiliEntries(entries, { now = Date.now() } = {}) {
  const out = [];
  const seen = new Set();
  for (const entry of asArray(entries)) {
    if (!entry || typeof entry !== 'object') continue;
    const sourceId = String(entry.id ?? '').trim();
    if (!sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);
    const type = String(entry.type ?? 'video');
    const title = redactVectorText(entry.title ?? entry.text ?? '', { maxChars: 100 });
    const body = redactVectorText(
      type === 'dynamic' ? (entry.text ?? entry.title ?? '')
        : (type === 'comment' ? (entry.note ?? entry.text ?? '')
          : (entry.reason ?? entry.quote ?? entry.anecdote ?? entry.text ?? '')),
      { maxChars: 400 },
    );
    if (!title && !body) continue;
    const text = type === 'video'
      ? `在 B 站看了《${short(title, 60)}》${body ? `：${short(body, 260)}` : ''}`
      : body;
    const at = timeOf(entry.at, timeOf(entry.date, now));
    out.push({
      id: `vm_bili_${hash(sourceId, 20)}`,
      text: redactVectorText(text, { maxChars: 600 }),
      title: type === 'video' ? `看过《${short(title, 40)}》` : short(title || body, 40),
      platform: 'bili',
      scope: 'bili',
      source: `bili-${type === 'dynamic' ? 'dynamic' : (type === 'comment' ? 'comment' : 'video')}`,
      sourceId,
      speaker: 'B站',
      groupId: '',
      conversationKey: '',
      isOwner: false,
      isSelf: false,
      private: false,
      important: entry.favorite === true,
      direct: false,
      importance: clampInt(40 + Number(entry.score || 0) * 4 + (entry.favorite === true ? 8 : 0), 40, 1, 100),
      sensitive: SENSITIVE_RE.test(`${title} ${body}`),
      createdAt: iso(at),
      tags: ['bili', type],
    });
  }
  return out;
}

/** 合并记录：id 已存在就不重复写；返回新增数量。 */
export function mergeVectorRecords(existing, incoming) {
  const seen = new Set(asArray(existing).map((record) => String(record?.id ?? '')).filter(Boolean));
  const added = [];
  for (const record of asArray(incoming)) {
    const id = String(record?.id ?? '');
    if (!id || !String(record?.text ?? '').trim() || seen.has(id)) continue;
    seen.add(id);
    added.push(record);
  }
  return { records: [...asArray(existing), ...added], added };
}

export function loadVectorRecords(paths, { maxRecords = 5000 } = {}) {
  let text = '';
  try { text = fs.readFileSync(paths.records, 'utf8'); } catch { return []; }
  const byId = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    if (!record || typeof record !== 'object' || !record.id || !String(record.text ?? '').trim()) continue;
    byId.set(String(record.id), record);
  }
  const records = [...byId.values()].sort((a, b) => timeOf(a.createdAt, 0) - timeOf(b.createdAt, 0));
  return records.slice(-Math.max(1, Number(maxRecords) || 5000));
}

export function appendVectorRecords(paths, records) {
  const list = asArray(records);
  if (!list.length) return 0;
  fs.mkdirSync(paths.dir, { recursive: true });
  const lines = list.map((record) => JSON.stringify(record)).join('\n');
  fs.appendFileSync(paths.records, `${lines}\n`, { encoding: 'utf8', mode: 0o600 });
  return list.length;
}

export function missingForIndex(records, manifest) {
  const indexed = new Map(asArray(manifest?.entries).map((entry) => [String(entry.id), String(entry.textHash ?? '')]));
  return asArray(records).filter((record) => indexed.get(String(record.id)) !== recordTextHash(record.text));
}

function normalizeVector(vector, dimension) {
  if (!Array.isArray(vector) || vector.length !== dimension || vector.some((v) => !Number.isFinite(Number(v)))) {
    return null;
  }
  let norm = 0;
  for (const value of vector) norm += Number(value) * Number(value);
  norm = Math.sqrt(norm);
  if (!norm) return null;
  return vector.map((value) => Number(value) / norm);
}

/** 原子写索引：先 bin 后 manifest；读者看到 manifest 时 bin 必已完整。 */
export function writeVectorIndex(paths, { model, modelSpace, dimension, entries, vectors, now = Date.now() }) {
  const dim = Math.max(1, Number(dimension) || 0);
  const list = asArray(entries);
  const vecs = asArray(vectors);
  if (!list.length || list.length !== vecs.length) {
    return { ok: false, code: 'vector.index-invalid', error: '索引条目与向量数量不一致', hint: '重建索引' };
  }
  fs.mkdirSync(paths.dir, { recursive: true });
  const accepted = [];
  const acceptedVectors = [];
  for (let i = 0; i < list.length; i += 1) {
    const vector = normalizeVector(vecs[i], dim);
    if (!vector) continue;
    accepted.push(list[i]);
    acceptedVectors.push(vector);
  }
  if (!accepted.length) {
    return { ok: false, code: 'vector.index-invalid', error: '没有有效向量', hint: '重新编码' };
  }
  const target = vectorIndexPaths(paths, modelSpace);
  fs.mkdirSync(target.dir, { recursive: true });
  const buffer = Buffer.alloc(accepted.length * dim * 4);
  for (let i = 0; i < acceptedVectors.length; i += 1) {
    for (let d = 0; d < dim; d += 1) buffer.writeFloatLE(acceptedVectors[i][d], (i * dim + d) * 4);
  }
  const tmpBin = `${target.bin}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpBin, buffer, { mode: 0o600 });
  fs.renameSync(tmpBin, target.bin);
  const manifest = {
    version: VECTOR_MEMORY_VERSION,
    model: String(model ?? ''),
    modelSpace: String(modelSpace ?? ''),
    dimension: dim,
    count: accepted.length,
    bytes: buffer.length,
    updatedAt: iso(now),
    entries: accepted.map((entry) => ({
      id: String(entry.id),
      offset: 0,
      textHash: recordTextHash(entry.text),
      text: String(entry.text ?? '').slice(0, 1200),
      title: String(entry.title ?? '').slice(0, 120),
      platform: String(entry.platform ?? ''),
      scope: String(entry.scope ?? ''),
      source: String(entry.source ?? ''),
      speaker: String(entry.speaker ?? '').slice(0, 60),
      senderId: String(entry.senderId ?? ''),
      groupId: String(entry.groupId ?? ''),
      conversationKey: String(entry.conversationKey ?? ''),
      private: entry.private === true,
      isOwner: entry.isOwner === true,
      importance: Number(entry.importance) || 0,
      sensitive: entry.sensitive === true,
      createdAt: String(entry.createdAt ?? ''),
    })),
  };
  // offset 用循环下标，避免 findIndex 在大索引上 O(n^2)。
  manifest.entries.forEach((entry, index) => { entry.offset = index; });
  const tmpJson = `${target.json}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpJson, `${JSON.stringify(manifest)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmpJson, target.json);
  return { ok: true, manifest };
}

function readIndexManifest(target) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(target.json, 'utf8'));
  } catch { return null; }
  if (!manifest || manifest.version !== VECTOR_MEMORY_VERSION || !Array.isArray(manifest.entries)) return null;
  const dimension = Number(manifest.dimension);
  const count = Number(manifest.count);
  if (!dimension || !count || manifest.entries.length !== count) return null;
  return manifest;
}

/** 只读 manifest（状态/列表用），不读几十 MB 的 .bin。 */
export function readVectorIndexMeta(paths, modelSpace = '') {
  const space = String(modelSpace ?? '').trim();
  if (!space) {
    const manifest = readIndexManifest({ json: paths.indexJson });
    return manifest ? { manifest } : null;
  }
  const manifest = readIndexManifest(vectorIndexPaths(paths, space));
  if (manifest && manifest.modelSpace === space) return { manifest };
  const legacy = readIndexManifest({ json: paths.indexJson });
  return legacy && legacy.modelSpace === space ? { manifest: legacy } : null;
}

export function readVectorIndex(paths, modelSpace = '') {
  const meta = readVectorIndexMeta(paths, modelSpace);
  if (!meta) return null;
  const space = String(modelSpace ?? '').trim();
  const target = vectorIndexPaths(paths, space);
  let raw;
  try { raw = fs.readFileSync(target.bin); } catch {
    // 兼容旧版单索引：只有 legacy manifest 与请求空间一致才读。
    const legacyMeta = readIndexManifest({ json: paths.indexJson });
    if (!legacyMeta || (space && legacyMeta.modelSpace !== space)) return null;
    try { raw = fs.readFileSync(paths.indexBin); } catch { return null; }
  }
  const dimension = Number(meta.manifest.dimension);
  const count = Number(meta.manifest.count);
  if (raw.length !== count * dimension * 4) return null;
  const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length);
  return { manifest: meta.manifest, vectors: new Float32Array(ab) };
}

function tokenize(text) {
  const out = new Set();
  const src = String(text ?? '').toLowerCase();
  for (const segment of src.split(/[^a-z0-9\u4e00-\u9fa5]+/)) {
    if (!segment) continue;
    if (/[\u4e00-\u9fa5]/.test(segment)) {
      for (let i = 0; i + 2 <= segment.length; i += 1) out.add(segment.slice(i, i + 2));
      if (segment.length === 1) out.add(segment);
    } else if (segment.length >= 2) out.add(segment);
  }
  return [...out];
}

export function lexicalScore(query, text) {
  const tokens = tokenize(query);
  if (!tokens.length) return 0;
  const hay = String(text ?? '').toLowerCase();
  let hit = 0;
  for (const token of tokens) if (hay.includes(token)) hit += 1;
  return hit / tokens.length;
}

export function cosine(a, b) {
  const len = Math.min(a?.length ?? 0, b?.length ?? 0);
  let dot = 0;
  for (let i = 0; i < len; i += 1) dot += a[i] * b[i];
  return dot;
}

/**
 * 检索：余弦 + 词法 + 重要度 + 新近度；只返回过阈值的前 topK。
 * platform='bili' 只允许 bili/shared；完整卡（QQ）允许其他平台，但排除 sensitive。
 */
export function rankVectorMemories({
  query = '', queryVector, index, config = {}, platform = 'qq', now = Date.now(), entryFilter = null,
} = {}) {
  const cfg = normalizeVectorMemoryConfig(config);
  if (!index || !index.manifest || !index.vectors) return [];
  const q = normalizeVector(queryVector, index.manifest.dimension);
  if (!q) return [];
  const hits = [];
  const entries = index.manifest.entries;
  for (const entry of entries) {
    if (entry.sensitive) continue;
    if (typeof entryFilter === 'function' && !entryFilter(entry)) continue;
    if (platform === 'bili' && entry.scope !== 'bili' && entry.scope !== 'shared') continue;
    if (platform === 'pet' && entry.scope !== 'pet' && entry.scope !== 'qq' && entry.scope !== 'shared') continue;
    const offset = Number(entry.offset);
    const vector = index.vectors.subarray(offset * index.manifest.dimension, (offset + 1) * index.manifest.dimension);
    const cos = cosine(q, vector);
    const lex = lexicalScore(query, `${entry.title} ${entry.text}`);
    const ageDays = Math.max(0, (now - timeOf(entry.createdAt, now)) / DAY_MS);
    const recency = Math.exp(-ageDays / 60);
    const importance = Math.min(1, Math.max(0, Number(entry.importance) / 100));
    const score = 0.65 * cos + 0.15 * lex + 0.10 * importance + 0.10 * recency;
    if (score < cfg.minScore) continue;
    hits.push({ ...entry, score, cosine: cos, lexical: lex });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, cfg.topK);
}

export function renderVectorRecallBlock(hits, { maxChars = 600 } = {}) {
  const list = asArray(hits);
  if (!list.length) return '';
  const lines = [];
  for (const hit of list) {
    const date = dateOnly(hit.createdAt) || '日期未知';
    lines.push(`· ${date} ${short(hit.text, 90)}`);
  }
  const header = '【想起的旧事】';
  const footer = '（这些是可能相关的旧事，不是当前事实；记不清就说记不清，不要编。）';
  let body = `${header}\n${lines.join('\n')}\n${footer}`;
  while (body.length > maxChars && lines.length > 1) {
    lines.pop();
    body = `${header}\n${lines.join('\n')}\n${footer}`;
  }
  if (body.length <= maxChars) return body;
  return `${body.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function resolveEmbeddingService(config = {}, { discoveryFile } = {}) {
  const cfg = normalizeVectorMemoryConfig(config);
  if (cfg.serviceUrl) {
    const base = cfg.serviceUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
    return { url: `${base}/v1/embeddings`, token: cfg.token, source: 'serviceUrl' };
  }
  const file = cfg.discoveryFile || discoveryFile || defaultDiscoveryFile();
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {
    const error = new Error('Embedding 服务发现文件不存在');
    error.code = 'vector.service-missing';
    error.hint = `启动 runtime 包（设置 → 记忆 → Embedding 功能），或检查 ${file}`;
    throw error;
  }
  const port = Number(raw?.port);
  if (!port || raw?.apiVersion !== 'v1') {
    const error = new Error('Embedding 服务发现文件无效');
    error.code = 'vector.service-invalid';
    error.hint = '重新启动 runtime 包，或删除旧发现文件';
    throw error;
  }
  return { url: `http://127.0.0.1:${port}/v1/embeddings`, token: String(raw?.token ?? ''), source: 'discovery' };
}

export async function embedTexts({ config = {}, texts = [], discoveryFile } = {}) {
  const cfg = normalizeVectorMemoryConfig(config);
  const list = asArray(texts).map((text) => String(text ?? ''));
  if (!list.length) return { vectors: [], dimension: 0, modelSpace: cfg.modelSpace, usage: {} };
  if (list.some((text) => !text.trim())) {
    const err = new Error('Embedding 输入包含空文本');
    err.code = 'vector.empty-text';
    err.hint = '过滤空记录后再编码；向量记录正文不能为空';
    throw err;
  }
  const service = resolveEmbeddingService(cfg, { discoveryFile });
  let response;
  try {
    response = await fetch(service.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(service.token ? { Authorization: `Bearer ${service.token}` } : {}),
      },
      body: JSON.stringify({ model: cfg.model, input: list, encoding_format: 'float' }),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
  } catch (error) {
    const err = new Error(`Embedding 服务不可达：${error?.message ?? error}`);
    err.code = 'vector.service-down';
    err.hint = '确认 runtime 包已启动，或检查 discoveryFile/serviceUrl';
    throw err;
  }
  let body;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) {
    const err = new Error(`Embedding 服务返回 HTTP ${response.status}`);
    err.code = body?.code ?? `vector.http-${response.status}`;
    err.hint = body?.hint ?? '检查 Embedding 服务状态与模型安装';
    throw err;
  }
  const rows = Array.isArray(body?.data) ? [...body.data].sort((a, b) => Number(a?.index ?? 0) - Number(b?.index ?? 0)) : [];
  if (rows.length !== list.length) {
    const err = new Error('Embedding 返回数量与输入不一致');
    err.code = 'vector.bad-response';
    err.hint = '检查 Embedding 服务版本与批量上限';
    throw err;
  }
  const dimension = Number(body?.dimension) || rows[0]?.embedding?.length || 0;
  if (!dimension) {
    const err = new Error('Embedding 返回空向量');
    err.code = 'vector.bad-response';
    err.hint = '检查模型是否已正确安装';
    throw err;
  }
  if (body?.model_space && body.model_space !== cfg.modelSpace) {
    const err = new Error(`模型空间不匹配：服务为 ${body.model_space}，配置为 ${cfg.modelSpace}`);
    err.code = 'vector.model-space-mismatch';
    err.hint = '把 vectorMemory.modelSpace 改成服务返回的 model_space，或重建索引';
    throw err;
  }
  const vectors = rows.map((row) => (Array.isArray(row?.embedding) ? row.embedding.map(Number) : null));
  return { vectors, dimension, modelSpace: body?.model_space ?? cfg.modelSpace, usage: body?.usage ?? {} };
}
