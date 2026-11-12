/**
 * 向量读取器 / 多模型索引（主路径）
 * ============================================================================
 * 定位（用户 2026-11-09 拍板）：**向量是长期方向，叙事是兼容层**。
 *
 * 多模型：**每个模型一套索引**（用户 2026-11-11 拍板）。
 *   entry.vectors = {
 *     [modelSpace]: { status:'pending'|'ready'|'failed', values?, dim?, at, error? }
 *   }
 * 读取时只认当前 modelSpace；没编码的记录用关键词回退，不假装语义检索。
 *
 * 输出必须和叙事读取器完全一致：{ text, refs }。
 */
import { cosineSimilarity } from './embed.js';

const SPACE_RE = /^[a-z0-9][a-z0-9._:@/-]{0,79}$/i;
const normSpace = (s) => {
  const v = String(s ?? '').trim();
  return SPACE_RE.test(v) ? v : 'default';
};

/** 把一句话切成可比较的碎片：中文按双字，英文按词 */
export function tokenize(text) {
  const s = String(text ?? '').toLowerCase();
  const out = new Set();
  for (const w of s.match(/[a-z0-9]{2,}/g) ?? []) out.add(w);
  const cn = s.replace(/[^\u4e00-\u9fa5]/g, '');
  for (let i = 0; i < cn.length - 1; i += 1) out.add(cn.slice(i, i + 2));
  return out;
}

/** 两段文字的相似度 0~1（Jaccard；够用就好，不是用来做学术的） */
export function similarity(a, b) {
  const A = tokenize(a); const B = tokenize(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
}

/**
 * 向量记忆库（与叙事记忆**同级**的独立存储）。
 * 入库时各写一份：这里存"向量视角的记录"；读取时由 memory.mode 决定要不要用它。
 */
export function createVectorStore({ now = () => Date.now(), modelSpace = 'default', enabled = true } = {}) {
  const entries = [];
  let activeSpace = normSpace(modelSpace);
  let on = enabled !== false;

  const indexOf = (entry, space = activeSpace) => entry?.vectors?.[space] ?? null;

  return {
    get enabled() { return on; },
    get modelSpace() { return activeSpace; },

    configure({ enabled, modelSpace: space } = {}) {
      if (enabled !== undefined) on = enabled !== false;
      if (space !== undefined) activeSpace = normSpace(space);
      return { enabled: on, modelSpace: activeSpace };
    },

    /**
     * 入库（唯一写入口）。
     * @param {object} record
     * @param {object} [ctx] { vector?:number[], modelSpace?:string, enabled?:boolean }
     */
    put(record, { vector = null, modelSpace: space, enabled: use = on } = {}) {
      if (!record || use === false) return null;
      const s = normSpace(space ?? activeSpace);
      const values = Array.isArray(vector) ? vector.map(Number) : (Array.isArray(record.vector) ? record.vector : null);
      const numeric = values && values.length && values.every(Number.isFinite) ? values : null;
      const vectors = { ...(record.vectors ?? {}) };
      vectors[s] = numeric
        ? { status: 'ready', values: numeric, dim: numeric.length, at: now() }
        : { status: 'pending', at: now() };

      const entry = {
        ...record,
        vectors,
        // 兼容旧读法/旧测试：当前 space 的那份也镜像到 vector
        vector: numeric ? { values: numeric, dim: numeric.length, at: now() } : { tokens: [...tokenize(record.text)], at: now() },
      };
      entries.push(entry);
      return entry;
    },

    entries() { return entries; },
    size() { return entries.length; },

    /** 当前 space 的待编码/失败项（给 encodePending 用） */
    pending({ space = activeSpace, limit = 8, includeFailed = true } = {}) {
      const s = normSpace(space);
      const out = [];
      for (let i = 0; i < entries.length; i += 1) {
        const idx = indexOf(entries[i], s);
        const status = idx?.status ?? 'pending';
        if (status === 'pending' || (includeFailed && status === 'failed')) {
          out.push({ index: i, entry: entries[i], text: String(entries[i].text ?? ''), status });
          if (out.length >= Math.max(1, Number(limit) || 8)) break;
        }
      }
      return out;
    },

    /** 编码成功：写当前 space 的索引；旧的 vector 镜像也更新 */
    applyVector(index, vector, { space = activeSpace } = {}) {
      const s = normSpace(space);
      const entry = entries[index];
      const values = Array.isArray(vector) ? vector.map(Number) : null;
      if (!entry || !values || !values.length || !values.every(Number.isFinite)) return false;
      const prev = entry.vectors?.[s];
      if (prev?.dim && prev?.values?.length && prev.values.length !== values.length) return false;   // 维度锁
      entry.vectors = { ...(entry.vectors ?? {}) };
      entry.vectors[s] = { status: 'ready', values, dim: values.length, at: now() };
      if (s === activeSpace) entry.vector = { values, dim: values.length, at: now() };
      return true;
    },

    /** 编码失败：保留原文，标 failed，记录错误（重试仍可再取） */
    markFailed(index, error, { space = activeSpace } = {}) {
      const s = normSpace(space);
      const entry = entries[index];
      if (!entry) return false;
      entry.vectors = { ...(entry.vectors ?? {}) };
      entry.vectors[s] = { status: 'failed', at: now(), error: { code: String(error?.code ?? 'embed.failed'), message: String(error?.message ?? error ?? '') } };
      return true;
    },

    /** 重建：当前 space 全部退回 pending（不清记忆，不清其他模型的索引） */
    rebuild({ space = activeSpace } = {}) {
      const s = normSpace(space);
      let n = 0;
      for (const entry of entries) {
        entry.vectors = { ...(entry.vectors ?? {}) };
        entry.vectors[s] = { status: 'pending', at: now() };
        if (s === activeSpace) entry.vector = { tokens: [...tokenize(entry.text)], at: now() };
        n += 1;
      }
      return n;
    },

    /** 当前/指定模型索引状态；spaces 列出所有模型 */
    status({ space = activeSpace } = {}) {
      const s = normSpace(space);
      let indexed = 0; let pending = 0; let failed = 0;
      const spaces = new Map();
      for (const entry of entries) {
        const idx = indexOf(entry, s);
        const status = idx?.status ?? 'pending';
        if (status === 'ready') indexed += 1;
        else if (status === 'failed') failed += 1;
        else pending += 1;
        for (const [name, value] of Object.entries(entry.vectors ?? {})) {
          const row = spaces.get(name) ?? { indexed: 0, pending: 0, failed: 0 };
          if (value?.status === 'ready') row.indexed += 1;
          else if (value?.status === 'failed') row.failed += 1;
          else row.pending += 1;
          spaces.set(name, row);
        }
      }
      return { records: entries.length, indexed, pending, failed, modelSpace: s, spaces: Object.fromEntries(spaces) };
    },

    /** 读取：与叙事读取器输出同样的形状；records 必须由上层按 viewer 过滤后传入 */
    read(viewer = {}, query = {}, records = entries) {
      return createVectorReader({ now, modelSpace: query.modelSpace ?? activeSpace }).build({ records, viewer, query });
    },

    /** 记忆库：最近记录 / 语义搜索（只读） */
    search({ text = '', vector = null, limit = 10, space = activeSpace } = {}) {
      const s = normSpace(space);
      const probe = String(text ?? '');
      const scored = entries.map((r, index) => {
        const idx = indexOf(r, s);
        const sim = vector && idx?.values
          ? cosineSimilarity(vector, idx.values)
          : (probe ? similarity(probe, r.text) : 0);
        const ageDays = Math.max(0, (now() - (r.from?.at ?? now())) / 86400000);
        const fresh = 1 / (1 + ageDays / 30);
        return { index, entry: r, score: sim * 0.7 + fresh * 0.2 + (Number(r.importance) || 0) / 500, sim, status: idx?.status ?? 'pending' };
      }).sort((a, b) => b.score - a.score);
      return scored.slice(0, Math.max(1, Number(limit) || 10));
    },

    /** 落盘用：把向量线自己的一份交出去（不是从叙事卡投影出来的） */
    snapshot() { return entries.slice(); },

    /** 读盘用：整份替换（含已从衰减卡里消失的旧记录——这正是双存储的意义） */
    restore(list = []) {
      entries.length = 0;
      for (const r of Array.isArray(list) ? list : []) {
        const entry = { ...r };
        // 旧状态：只有 vector.values/tokens，没有 vectors → 归到 default
        if (!entry.vectors && entry.vector) {
          entry.vectors = {
            default: entry.vector.values
              ? { status: 'ready', values: entry.vector.values, dim: entry.vector.dim ?? entry.vector.values.length, at: entry.vector.at ?? now() }
              : { status: 'pending', at: entry.vector.at ?? now() },
          };
        }
        entries.push(entry);
      }
      return entries.length;
    },
  };
}

export function createVectorReader({ now = () => Date.now(), modelSpace = 'default' } = {}) {
  const space = normSpace(modelSpace);
  return {
    name: 'vector',

    /**
     * @param {object} ctx { records（已按可见性过滤）, query:{ text, vector, maxChars } }
     * @returns {{text:string, refs:object[]}}
     */
    build({ records = [], query = {} } = {}) {
      const maxChars = Number(query.maxChars) > 0 ? Number(query.maxChars) : 1200;
      const topK = Number(query.topK) > 0 ? Number(query.topK) : 0;
      const minScore = Number.isFinite(Number(query.minScore)) ? Number(query.minScore) : null;
      const probe = String(query.text ?? '');
      const probeVector = Array.isArray(query.vector) ? query.vector : null;

      const scored = records.map((r) => {
        const idx = r.vectors?.[space] ?? (space === 'default' ? r.vector : null);
        const sim = probeVector && idx?.values
          ? cosineSimilarity(probeVector, idx.values)
          : (probe ? similarity(probe, r.text) : 0);
        const ageDays = Math.max(0, (now() - (r.from?.at ?? now())) / 86400000);
        const fresh = 1 / (1 + ageDays / 30);            // 越新越靠前
        const score = sim * 0.7 + fresh * 0.2 + (Number(r.importance) || 0) / 500;
        return { r, score, sim };
      }).sort((a, b) => b.score - a.score);

      const lines = [];
      const refs = [];
      let used = 0;
      for (const { r, sim } of scored) {
        if (topK && lines.length >= topK) break;
        // 有查询时，零相似不注入：向量模式不能因为“新”就把无关旧事塞进提示词。
        if ((probe || probeVector) && sim <= 0) continue;
        if (minScore !== null && sim < minScore) continue;
        let body = r.text;
        if (r.media?.length) body += `（另有 ${r.media.length} 份媒体）`;
        const line = `- ${body}`;
        if (used + line.length > maxChars) break;
        lines.push(line);
        refs.push({ channel: r.from.channel, at: r.from.at, score: Number(sim.toFixed(3)), source: r.source, scene: r.from?.scene ?? 'public' });
        used += line.length;
      }

      if (!lines.length) return { text: '', refs: [] };
      return { text: ['【相关记忆】', ...lines].join('\n'), refs };
    },
  };
}
