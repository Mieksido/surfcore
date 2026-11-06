/**
 * 向量记忆（插件宿主侧维护器）。
 *
 * 与叙事记忆卡完全独立：
 *   · 自己摄取 `memory-inbox.jsonl` + `bili-memory.json`，写自己的
 *     `vector-memory.jsonl` 与 `vector-memory-index.{json,bin}`；
 *   · 不读/不写 memory-card.*，不依赖记忆卡维护器；
 *   · 两个存储各自有开关：memoryCard.enabled / vectorMemory.enabled；
 *   · memory.mode 只决定读取哪一套，不影响这里是否继续摄取。
 *
 * 单写者：只有本模块写向量记忆文件（插件进程内 promise 链串行化）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { QQ_STATE_DIR, maskPath } from './paths.js';
import { activeMemoryPaths, activePlatformStateDir } from '../../../src/character-persona.js';
import { readUnified } from './store.js';
import {
  DEFAULT_VECTOR_MEMORY_CONFIG, appendVectorRecords, effectiveVectorMemoryConfig, embedTexts,
  loadVectorRecords, mergeVectorRecords, missingForIndex, normalizeVectorMemoryConfig, rankVectorMemories, readVectorIndex, readVectorIndexMeta,
  recordTextHash, recordsFromBiliEntries, recordsFromInboxLines, resolveEmbeddingService,
  resolveVectorMemoryPaths, vectorIndexPaths, writeVectorIndex,
} from '../../../src/vector-memory.js';

const TICK_MS = 10 * 60 * 1000;
const EMPTY_CONFIG = normalizeVectorMemoryConfig({});

let chain = Promise.resolve();
let lastError = null;
let lastRunAt = 0;

function serialized(task) {
  const next = chain.then(task, task);
  chain = next.catch(() => {});
  return next;
}

/** 切换角色前等这里清空：避免半截写入旧角色的向量目录。 */
export function vectorMemoryIdle() {
  return chain.catch(() => {});
}

export function vectorMemoryPathsNow() {
  return resolveVectorMemoryPaths(activeMemoryPaths().dir);
}

export function vectorMemoryConfig(unified = readUnified().config) {
  return normalizeVectorMemoryConfig(unified?.vectorMemory ?? EMPTY_CONFIG);
}

function biliStateDir() {
  return activePlatformStateDir(QQ_STATE_DIR);
}

function readBiliEntries() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(biliStateDir(), 'bili-memory.json'), 'utf8'));
    return Array.isArray(raw?.entries) ? raw.entries : [];
  } catch {
    return [];
  }
}

function readInboxLines() {
  const lines = [];
  const inbox = activeMemoryPaths().inbox;
  // 桥接在 1MB 时把当前文件轮转成 .1；两段都要读，重复由 id 去重。
  for (const file of [`${inbox}.1`, inbox]) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      for (const line of text.split('\n')) if (line.trim()) lines.push(line);
    } catch {}
  }
  return lines.slice(-4000);
}

function emptyStatus(extra = {}) {
  return {
    ok: true,
    enabled: true,
    mode: 'narrative',
    records: 0,
    indexed: 0,
    pending: 0,
    model: EMPTY_CONFIG.model,
    modelSpace: EMPTY_CONFIG.modelSpace,
    dimension: 0,
    updatedAt: '',
    lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : '',
    lastError,
    service: { ok: false, source: '', error: 'not checked' },
    paths: {},
    ...extra,
  };
}

/** 只读状态：给控制台/总览用，不做网络请求、不写盘。 */
export function vectorMemoryStatusNow(config = vectorMemoryConfig()) {
  const paths = vectorMemoryPathsNow();
  const unified = readUnified().config;
  const mode = unified?.memory?.mode === 'vector' ? 'vector' : 'narrative';
  const effective = effectiveVectorMemoryConfig(config);
  const records = loadVectorRecords(paths, { maxRecords: config.maxRecords });
  const index = readVectorIndexMeta(paths, effective.modelSpace);
  const spaceMatches = Boolean(index);
  const indexPaths = vectorIndexPaths(paths, effective.modelSpace);
  const indexed = spaceMatches ? index.manifest.count : 0;
  let service = { ok: false, source: '', error: '' };
  try {
    const resolved = resolveEmbeddingService(effective);
    service = { ok: true, source: resolved.source, error: '' };
  } catch (error) {
    service = { ok: false, source: '', error: error?.code ?? 'vector.service-missing' };
  }
  const pending = records.filter((record) => {
    if (!spaceMatches) return true;
    const entry = index.manifest.entries.find((item) => item.id === record.id);
    return !entry || entry.textHash !== recordTextHash(record.text);
  }).length;
  return emptyStatus({
    enabled: config.enabled !== false,
    mode,
    provider: effective.provider,
    records: records.length,
    indexed,
    pending,
    model: effective.model,
    modelSpace: effective.modelSpace,
    dimension: spaceMatches ? index.manifest.dimension : 0,
    updatedAt: spaceMatches ? index.manifest.updatedAt : '',
    service,
    paths: {
      dir: maskPath(paths.dir),
      records: maskPath(paths.records),
      indexJson: maskPath(indexPaths.json),
      indexBin: maskPath(indexPaths.bin),
    },
  });
}

function rebuildEntries(index, dimension) {
  const entries = [];
  const vectors = [];
  if (!index) return { entries, vectors };
  for (const entry of index.manifest.entries) {
    const offset = Number(entry.offset);
    const vector = Array.from(index.vectors.subarray(offset * dimension, (offset + 1) * dimension));
    entries.push(entry);
    vectors.push(vector);
  }
  return { entries, vectors };
}

/**
 * 一次维护：摄取 → 只编码缺的/变了的记录 → 原子写索引。
 * forceRebuild=true 时忽略旧索引，从这一批重新编码（索引可能暂时只含一部分，
 * 下一个 tick 继续补齐；不会丢记录）。
 */
export function runVectorMemoryMaintenance({
  config = vectorMemoryConfig(), now = Date.now(), forceRebuild = false,
} = {}) {
  return serialized(async () => {
    lastRunAt = now;
    if (config.enabled === false) {
      return { ok: true, disabled: true, changed: false, status: vectorMemoryStatusNow({ ...config, enabled: false }) };
    }
    const effective = effectiveVectorMemoryConfig(config);
    const paths = vectorMemoryPathsNow();
    const existing = loadVectorRecords(paths, { maxRecords: config.maxRecords });
    const incoming = [
      ...recordsFromInboxLines(readInboxLines(), { now }),
      ...recordsFromBiliEntries(readBiliEntries(), { now }),
    ];
    const merged = mergeVectorRecords(existing, incoming);
    const added = merged.added;
    if (added.length) appendVectorRecords(paths, added);
    const records = merged.records;

    let index = readVectorIndex(paths, effective.modelSpace);
    const spaceMatches = Boolean(index);
    let baseEntries = [];
    let baseVectors = [];
    let missing = records;
    if (spaceMatches && !forceRebuild) {
      const rebuilt = rebuildEntries(index, index.manifest.dimension);
      baseEntries = rebuilt.entries;
      baseVectors = rebuilt.vectors;
      missing = missingForIndex(records, index.manifest);
      // 文本变了的记录不能只 append（会留下旧向量+重复 id）：整索引重编码。
      const changed = missing.some((record) => baseEntries.some((entry) => entry.id === record.id));
      if (changed) {
        baseEntries = [];
        baseVectors = [];
        missing = records;
      }
    }

    if (!missing.length) {
      lastError = null;
      return {
        ok: true, changed: added.length > 0, added: added.length, embedded: 0,
        status: vectorMemoryStatusNow(config),
      };
    }

    let service;
    try {
      service = resolveEmbeddingService(config);
    } catch (error) {
      lastError = { code: error?.code ?? 'vector.service-missing', error: error?.message ?? String(error), hint: error?.hint ?? '', at: new Date(now).toISOString() };
      return { ok: false, code: lastError.code, error: lastError.error, hint: lastError.hint, added: added.length, embedded: 0, status: vectorMemoryStatusNow(config) };
    }

    const limit = Math.min(config.maxEmbedPerTick, missing.length);
    const batch = missing.slice(0, limit);
    const embeddedEntries = [];
    const embeddedVectors = [];
    let dimension = spaceMatches ? index.manifest.dimension : 0;
    try {
      for (let offset = 0; offset < batch.length; offset += config.batchSize) {
        const slice = batch.slice(offset, offset + config.batchSize);
        const result = await embedTexts({ config: effective, texts: slice.map((record) => record.text) });
        if (!dimension) dimension = result.dimension;
        if (dimension !== result.dimension) {
          const error = new Error(`Embedding 维度不一致：索引 ${dimension}，服务 ${result.dimension}`);
          error.code = 'vector.dimension-mismatch';
          error.hint = '检查 vectorMemory.model / modelSpace 是否与 Embedding 服务一致';
          throw error;
        }
        if (result.vectors.length !== slice.length) {
          const error = new Error('Embedding 返回数量与请求不一致');
          error.code = 'vector.bad-response';
          error.hint = '检查 Embedding 服务版本';
          throw error;
        }
        for (let i = 0; i < slice.length; i += 1) {
          const record = slice[i];
          embeddedEntries.push({
            id: record.id, textHash: record.textHash || '', text: record.text, title: record.title,
            platform: record.platform, scope: record.scope, source: record.source, speaker: record.speaker,
            importance: record.importance, sensitive: record.sensitive === true, createdAt: record.createdAt,
          });
          embeddedVectors.push(result.vectors[i]);
        }
      }
      if (!dimension) {
        const error = new Error('Embedding 没有返回维度');
        error.code = 'vector.bad-response';
        error.hint = '检查 Embedding 服务与模型';
        throw error;
      }
      const saved = writeVectorIndex(paths, {
        model: effective.model,
        modelSpace: effective.modelSpace,
        dimension,
        entries: [...baseEntries, ...embeddedEntries],
        vectors: [...baseVectors, ...embeddedVectors],
        now,
      });
      if (!saved.ok) throw new Error(saved.error);
      lastError = null;
      return {
        ok: true,
        changed: added.length > 0 || embeddedEntries.length > 0,
        added: added.length,
        embedded: embeddedEntries.length,
        status: vectorMemoryStatusNow(config),
      };
    } catch (error) {
      lastError = { code: error?.code ?? 'vector.maintain-failed', error: error?.message ?? String(error), hint: error?.hint ?? '', at: new Date(now).toISOString() };
      return {
        ok: false, code: lastError.code, error: lastError.error, hint: lastError.hint,
        added: added.length, embedded: embeddedEntries.length,
        status: vectorMemoryStatusNow(config),
      };
    }
  });
}

export function vectorMemorySnapshot(config = vectorMemoryConfig(), { limit = 30 } = {}) {
  const paths = vectorMemoryPathsNow();
  const records = loadVectorRecords(paths, { maxRecords: config.maxRecords });
  const index = readVectorIndexMeta(paths, effectiveVectorMemoryConfig(config).modelSpace);
  const status = vectorMemoryStatusNow(config);
  return {
    ...status,
    recent: records.slice(-Math.max(1, Math.min(200, Number(limit) || 30))).map((record) => ({
      id: record.id,
      text: record.text,
      title: record.title,
      platform: record.platform,
      scope: record.scope,
      source: record.source,
      createdAt: record.createdAt,
      importance: record.importance,
      sensitive: record.sensitive === true,
    })),
    indexed: index ? index.manifest.count : 0,
  };
}

/** 重建：一次调用循环到 pending=0，避免用户点一次只前进 maxEmbedPerTick 条。 */
export async function rebuildVectorMemory(config = vectorMemoryConfig()) {
  let embedded = 0;
  let last = null;
  for (let round = 0; round < 500; round += 1) {
    const result = await runVectorMemoryMaintenance({ config, forceRebuild: round === 0 });
    last = result;
    if (!result.ok) return { ...result, embedded: embedded + (result.embedded ?? 0), rebuilt: false };
    embedded += result.embedded ?? 0;
    const pending = Number(result.status?.pending) || 0;
    if (pending <= 0) return { ...result, embedded, rebuilt: true };
    if ((result.embedded ?? 0) <= 0) {
      return {
        ...result,
        ok: false,
        embedded,
        rebuilt: false,
        code: 'vector.rebuild-stalled',
        error: `重建停滞：仍有 ${pending} 条待编码`,
        hint: '检查 Embedding 服务/模型是否可用，然后重试',
      };
    }
  }
  return {
    ...(last ?? {}),
    ok: false,
    embedded,
    rebuilt: false,
    code: 'vector.rebuild-limit',
    error: '重建达到最大轮数仍未完成',
    hint: '检查服务稳定性，或调大 maxEmbedPerTick 后重试',
  };
}

/**
 * 给多个模型各建一套索引：记录共享，索引按 modelSpace 分文件；不切换全局配置。
 * 调用方需先把模型注册进 runtime 自带 Ollama，并保证 runtime 在跑。
 */
export async function rebuildAllVectorIndexes(config, models = []) {
  // 只补没有索引的模型；已有索引的模型不重建（重建全部请用单模型「重建索引」）。
  const targets = models.filter((item) => item && item.model && item.modelSpace && item.indexReady !== true);
  const skippedModels = models
    .filter((item) => item && item.model && item.modelSpace && item.indexReady === true)
    .map((item) => item.model);
  if (!targets.length) {
    return {
      ok: true,
      skipped: true,
      results: [],
      skippedModels,
      status: vectorMemoryStatusNow(config),
    };
  }
  const results = [];
  for (const item of targets) {
    const target = normalizeVectorMemoryConfig({
      ...config,
      provider: 'local',
      model: item.model,
      modelSpace: item.modelSpace,
    });
    const result = await rebuildVectorMemory(target);
    results.push({
      id: item.id,
      model: item.model,
      modelSpace: item.modelSpace,
      ok: result.ok !== false,
      embedded: result.embedded ?? 0,
      rebuilt: result.rebuilt === true,
      error: result.error ?? '',
      hint: result.hint ?? '',
    });
    if (result.ok === false) break;
  }
  return {
    ok: results.length > 0 && results.every((item) => item.ok),
    skipped: false,
    results,
    skippedModels,
    status: vectorMemoryStatusNow(config),
  };
}

export function startVectorMemoryTimer({ log = () => {}, config = null } = {}) {
  if (process.env.SURFCORE_DISABLE_VECTOR_TIMER === '1') {
    return { stop() {}, started: false };
  }
  let stopped = false;
  let timer = null;
  const tick = async () => {
    if (stopped) return null;
    try {
      const cfg = config ? normalizeVectorMemoryConfig(config) : vectorMemoryConfig();
      if (cfg.enabled === false) return null;
      const result = await runVectorMemoryMaintenance({ config: cfg });
      if (result.status?.pending > 0 && result.ok) {
        log(`向量记忆：新增 ${result.added ?? 0} 条，编码 ${result.embedded ?? 0} 条，仍待编码 ${result.status.pending} 条`);
      } else if (result.changed) {
        log(`向量记忆已整理：新增 ${result.added ?? 0} 条，编码 ${result.embedded ?? 0} 条，索引 ${result.status.indexed} 条`);
      }
      if (!result.ok) log(`向量记忆整理失败：${result.code} ${result.error}`);
      return result;
    } catch (error) {
      log('向量记忆整理异常：', error?.message ?? error);
      return null;
    }
  };
  // 有积压就 30 秒后续跑，直到 pending=0；没积压/服务失败再回到 10 分钟。
  // 这样新记忆不需要用户手点「立即整理」，也不会每 10 分钟才前进一批。
  const schedule = (ms) => {
    if (stopped) return;
    timer = setTimeout(async () => {
      timer = null;
      const result = await tick();
      const pending = Number(result?.status?.pending) || 0;
      schedule(result?.ok && pending > 0 ? 30_000 : TICK_MS);
    }, ms);
    timer.unref?.();
  };
  schedule(15_000);
  return {
    started: true,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

export const VECTOR_MEMORY_DEFAULTS = DEFAULT_VECTOR_MEMORY_CONFIG;

function libraryRecord(record) {
  return {
    id: record.id,
    text: String(record.text ?? '').slice(0, 1000),
    title: record.title ?? '',
    platform: record.platform ?? '',
    scope: record.scope ?? '',
    source: record.source ?? '',
    speaker: record.speaker ?? '',
    importance: Number(record.importance) || 0,
    createdAt: record.createdAt ?? '',
  };
}

/** 记忆库：最近记录（只读；默认不展示敏感记录）。 */
export function listVectorMemoryRecords({ config = vectorMemoryConfig(), limit = 30, offset = 0 } = {}) {
  const paths = vectorMemoryPathsNow();
  const records = loadVectorRecords(paths, { maxRecords: config.maxRecords });
  const visible = records.filter((record) => record.sensitive !== true);
  visible.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 30));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const effective = effectiveVectorMemoryConfig(config);
  return {
    ok: true,
    total: records.length,
    visible: visible.length,
    offset: safeOffset,
    limit: safeLimit,
    model: effective.model,
    modelSpace: effective.modelSpace,
    items: visible.slice(safeOffset, safeOffset + safeLimit).map(libraryRecord),
  };
}

/** 记忆库：用一句话做语义搜索（只读；不写索引/记录）。 */
export async function searchVectorMemoryRecords({ config = vectorMemoryConfig(), query = '', limit = 20 } = {}) {
  const q = String(query ?? '').trim();
  if (!q) return { ok: false, code: 'vector.query-empty', error: '请输入要搜索的内容', hint: '例如：主人最近是不是很累' };
  if (q.length > 300) return { ok: false, code: 'vector.query-too-long', error: '搜索内容太长（最多 300 字）', hint: '只输入一句关键词或短句' };
  const effective = effectiveVectorMemoryConfig(config);
  const paths = vectorMemoryPathsNow();
  const index = readVectorIndex(paths, effective.modelSpace);
  if (!index) {
    return {
      ok: false, code: 'vector.index-missing',
      error: `当前模型 ${effective.model} 还没有索引`,
      hint: '先到「向量记忆」点「重建索引」，建完再搜',
    };
  }
  try {
    const result = await embedTexts({ config: effective, texts: [q] });
    const hits = rankVectorMemories({
      query: q,
      queryVector: result.vectors[0],
      index,
      config: { ...effective, topK: Math.max(1, Math.min(50, Number(limit) || 20)), minScore: 0.2 },
      platform: 'all',
    });
    return {
      ok: true,
      query: q,
      model: effective.model,
      modelSpace: effective.modelSpace,
      dimension: result.dimension,
      total: index.manifest.count,
      hits: hits.map((hit) => ({
        ...libraryRecord(hit),
        score: Number(hit.score) || 0,
        cosine: Number(hit.cosine) || 0,
      })),
    };
  } catch (error) {
    return {
      ok: false,
      code: error?.code ?? 'vector.search-failed',
      error: `语义搜索失败：${String(error?.message ?? error).slice(0, 160)}`,
      hint: String(error?.hint ?? '确认 Embedding 运行时已启动、当前模型可用'),
    };
  }
}
