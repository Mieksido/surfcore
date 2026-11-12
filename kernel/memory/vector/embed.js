/**
 * 嵌入端口：把文字变成向量（"真实嵌入"的那一段，只有接口，没有厂商）
 * ============================================================================
 * 位置：内核·记忆·向量线。它隐藏的秘密是**向量怎么校验、怎么归一、怎么比相似度**；
 * 它不认识任何具体模型/服务——地址、模型名、鉴权都由调用方给（法则 9/11）。
 *
 * 三个实现：
 *   · createHttpEmbeddingTransport：OpenAI 兼容的 /embeddings（只认 HTTP 形状）
 *   · createEmbedder：校验 + 归一 + 统一错误（真实现和假实现都走它）
 *   · createHashingEmbedder：本地确定性向量（隔离测试/离线演示用，明确不是真模型）
 *
 * 不做的事：不读盘、不缓存、不重试、不开 timer。重试与缓存属于调用方。
 */

/** 余弦相似度：任一为空/维度不一致/全零 → 0（不抛） */
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return 0;
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = Number(a[i]); const y = Number(b[i]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
    dot += x * y; na += x * x; nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** L2 归一化（零向量原样返回，交给上层判无效） */
export function normalizeVector(values) {
  const arr = (Array.isArray(values) ? values : []).map(Number);
  let sum = 0;
  for (const v of arr) { if (!Number.isFinite(v)) return null; sum += v * v; }
  if (!sum) return arr;
  const len = Math.sqrt(sum);
  return arr.map((v) => v / len);
}

/**
 * HTTP 传输：只认"POST 一个 JSON，拿回 data[].embedding"这个形状。
 * @param {object} opts { endpoint（完整地址）, apiKey, fetchImpl, timeoutMs }
 */
export function createHttpEmbeddingTransport({
  endpoint,
  apiKey = '',
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
} = {}) {
  if (!endpoint) throw new Error('嵌入传输需要 endpoint（地址由调用方给，不写死厂商）');

  return {
    name: 'http',
    /**
     * @param {object} req { model, input（字符串数组） }
     * @returns {Promise<{ok:true, vectors:number[][]}|{ok:false, error:object}>}
     */
    async send({ model, input } = {}) {
      if (typeof fetchImpl !== 'function') {
        return { ok: false, error: { code: 'embed.no-fetch', message: '没有可用的 fetch', retryable: false } };
      }
      let res;
      try {
        res = await fetchImpl(String(endpoint), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({ model, input }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const msg = String(error?.message ?? error);
        const timeout = /timeout|abort/i.test(msg);
        return {
          ok: false,
          error: {
            code: timeout ? 'embed.timeout' : 'embed.network',
            message: msg,
            retryable: true,
            hint: timeout ? '嵌入服务超时：可重试（没有副作用）' : '连不上嵌入服务：检查地址与网络',
          },
        };
      }

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const unauthorized = res.status === 401 || res.status === 403;
        return {
          ok: false,
          error: {
            code: unauthorized ? 'embed.unauthorized' : 'embed.http',
            status: res.status,
            message: String(payload?.error?.message ?? payload?.message ?? `HTTP ${res.status}`),
            retryable: !unauthorized,
            hint: unauthorized ? '密钥/权限不对：换一个 key 或检查模型是否开通' : '嵌入服务报错：可重试，持续失败看服务状态',
          },
        };
      }

      const rows = Array.isArray(payload?.data) ? payload.data : [];
      const vectors = rows.map((row) => (Array.isArray(row?.embedding) ? row.embedding : null));
      if (!vectors.length || vectors.some((v) => !v)) {
        return { ok: false, error: { code: 'embed.shape', message: '嵌入服务返回的形状不对（缺 data[].embedding）', retryable: false, hint: '检查 endpoint 是不是兼容 /embeddings 的服务' } };
      }
      return { ok: true, vectors };
    },
  };
}

/**
 * 嵌入器：校验 + 归一 + 统一错误。
 * @param {object} opts { transport（实现 send）, model, normalize=true }
 */
export function createEmbedder({ transport, model, normalize = true } = {}) {
  if (!transport || typeof transport.send !== 'function') throw new Error('嵌入器需要 transport.send()');
  if (!model) throw new Error('嵌入器需要 model（模型名由调用方给）');
  let dim = 0;

  return {
    name: 'embedder',
    model,

    /**
     * @param {string[]} texts
     * @returns {Promise<{ok:true, vectors:number[][], dim:number}|{ok:false, error:object}>}
     */
    async embed(texts = []) {
      const list = (Array.isArray(texts) ? texts : []).map((t) => String(t ?? '').trim()).filter(Boolean);
      if (!list.length) return { ok: false, error: { code: 'embed.empty-input', message: '没有可嵌入的文字', retryable: false } };

      const sent = await transport.send({ model, input: list });
      if (!sent?.ok) return { ok: false, error: sent?.error ?? { code: 'embed.transport-failed', message: '嵌入传输失败', retryable: false } };

      const vectors = [];
      for (const raw of sent.vectors ?? []) {
        const normalized = normalizeVector(raw);
        if (!normalized || !normalized.length) {
          return { ok: false, error: { code: 'embed.bad-vector', message: '嵌入返回了空向量/非数字', retryable: false } };
        }
        if (dim && normalized.length !== dim) {
          return { ok: false, error: { code: 'embed.dim-mismatch', message: `向量维度变了（${dim} → ${normalized.length}）：换模型后旧向量要重建`, retryable: false } };
        }
        if (!dim) dim = normalized.length;
        vectors.push(normalize ? normalized : raw.map(Number));
      }

      if (vectors.length !== list.length) {
        return { ok: false, error: { code: 'embed.count-mismatch', message: `要了 ${list.length} 条向量，只回来 ${vectors.length} 条`, retryable: true } };
      }
      return { ok: true, vectors, dim };
    },

    dimensions() { return dim; },
  };
}

/**
 * 本地确定性嵌入（FNV-1a 散列到桶）。**明确不是真模型**：
 * 它只用于隔离测试/离线演示，证明"换嵌入只改这一处"。
 */
export function createHashingEmbedder({ dimensions = 256 } = {}) {
  const dim = Math.max(8, Math.floor(Number(dimensions) || 256));

  function hash(token) {
    let h = 0x811c9dc5;
    for (let i = 0; i < token.length; i += 1) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  function tokensOf(text) {
    const s = String(text ?? '').toLowerCase();
    const out = [];
    for (const w of s.match(/[a-z0-9]{2,}/g) ?? []) out.push(w);
    const cn = s.replace(/[^\u4e00-\u9fa5]/g, '');
    for (let i = 0; i < cn.length - 1; i += 1) out.push(cn.slice(i, i + 2));
    return out;
  }

  return {
    name: 'hashing',
    model: `hashing-${dim}`,
    async embed(texts = []) {
      const list = (Array.isArray(texts) ? texts : []).map((t) => String(t ?? '').trim()).filter(Boolean);
      if (!list.length) return { ok: false, error: { code: 'embed.empty-input', message: '没有可嵌入的文字', retryable: false } };
      const vectors = list.map((text) => {
        const out = new Array(dim).fill(0);
        for (const token of tokensOf(text)) out[hash(token) % dim] += 1;
        return normalizeVector(out);
      });
      return { ok: true, vectors, dim };
    },
    dimensions() { return dim; },
  };
}
