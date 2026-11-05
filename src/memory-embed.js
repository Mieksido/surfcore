/**
 * 向量化（Embedding）客户端 —— 和 llama-server 的 OpenAI 兼容 `/v1/embeddings` 说话。
 *
 * 为什么单独成模块：
 *   `memory-index.js` 只管「存/查」，向量从哪来是另一件事。以后换 API / 换模型
 *   只改这里，索引层不用动。
 *
 * 默认接本机 llama-server（Qwen3-Embedding-0.6B，1024 维）：
 *   llama-server -m Qwen3-Embedding-0.6B-Q8_0.gguf --embedding --pooling last \
 *     --host 127.0.0.1 --port 8091 -ngl 99 -c 8192 -ub 8192
 *
 * 只允许回环地址：记忆原文不外发（和 RULES.md 的隐私边界一致）。
 */
export const DEFAULT_EMBED_URL = 'http://127.0.0.1:8091/v1';
export const DEFAULT_EMBED_MODEL = 'Qwen3-Embedding-0.6B';
export const DEFAULT_EMBED_DIM = 1024;
export const QUERY_INSTRUCT = 'Given a web search query, retrieve relevant passages that answer the query';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function assertLoopback(baseUrl) {
  let url;
  try { url = new URL(baseUrl); } catch { throw new Error(`embedding 地址不合法：${baseUrl}`); }
  if (url.protocol !== 'http:' || !LOOPBACK.has(url.hostname)) {
    throw new Error('embedding 只允许本机回环地址（记忆原文不外发）');
  }
  return url;
}

/** L2 归一化：存进去就是单位向量，检索时余弦 = 点积。 */
export function normalizeVector(vec) {
  const arr = Float32Array.from(vec);
  let sum = 0;
  for (let i = 0; i < arr.length; i += 1) sum += arr[i] * arr[i];
  const norm = Math.sqrt(sum);
  if (norm > 0) for (let i = 0; i < arr.length; i += 1) arr[i] /= norm;
  return arr;
}

/**
 * 批量取向量。
 * @returns {Promise<Float32Array[]>} 与输入等长、已归一化
 */
export async function embedTexts(texts, {
  baseUrl = DEFAULT_EMBED_URL,
  model = DEFAULT_EMBED_MODEL,
  batch = 16,
  timeoutMs = 30_000,
  signal,
} = {}) {
  const list = (texts || []).map((t) => String(t ?? '').slice(0, 4000));
  if (!list.length) return [];
  assertLoopback(baseUrl);
  const out = [];
  for (let i = 0; i < list.length; i += batch) {
    const chunk = list.slice(i, i + batch);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const onAbort = () => ctrl.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, input: chunk, encoding_format: 'float' }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`embedding HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const json = await res.json();
      const rows = Array.isArray(json?.data) ? json.data : [];
      if (rows.length !== chunk.length) {
        throw new Error(`embedding 返回条数不符：要 ${chunk.length} 条，拿到 ${rows.length} 条`);
      }
      rows.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      for (const row of rows) {
        if (!Array.isArray(row.embedding) || !row.embedding.length) throw new Error('embedding 返回空向量');
        out.push(normalizeVector(row.embedding));
      }
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }
  return out;
}

/**
 * 单条查询向量。
 *
 * 默认**不加** instruct 前缀。Qwen 官方对检索任务推荐给 query 加 instruct，但实测
 * （Qwen3-Embedding-0.6B + llama-server `--pooling last`）加了之后余弦被前缀稀释：
 * 「屋里那种发蓝光的东西 / 抽屉里那根灯带是蓝色的」这对从 0.61 掉到 0.48，
 * 所有命中分数也被压平、区分度变差。要试 instruct 就传 { instruct: true }。
 */
export async function embedQuery(query, opts = {}) {
  const prefix = opts.instruct === true ? `Instruct: ${QUERY_INSTRUCT}\nQuery: ` : '';
  const [vec] = await embedTexts([`${prefix}${String(query ?? '')}`], opts);
  return vec;
}

/** 探活：返回 { ok, dim, model, error }，失败不抛。 */
export async function probeEmbedding(opts = {}) {
  try {
    const [vec] = await embedTexts(['memory index probe'], { ...opts, timeoutMs: opts.timeoutMs ?? 5000 });
    return { ok: true, dim: vec.length, model: opts.model ?? DEFAULT_EMBED_MODEL };
  } catch (err) {
    return { ok: false, dim: 0, model: opts.model ?? DEFAULT_EMBED_MODEL, error: String(err?.message || err) };
  }
}