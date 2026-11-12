/**
 * Token 账本：只记"实际花了多少"，不猜、不替供应商算
 * ============================================================================
 * 位置：内核·支撑。它隐藏的秘密是**用量怎么归一、同一轮怎么幂等、总量怎么汇总**；
 * 它不认识任何具体模型的价格（价格是表达层的数据，由组装层注入一个 `price` 函数）。
 *
 * 三条规矩（来自旧 token-ledger.js 的事故）：
 *   ① **按已发生的成本记**，不按成功的产出记。
 *   ② **同一 (会话, 回合, 步骤, 重试) 只保留一条**；后到的 seq 更新才覆盖。
 *      重连会重发旧采样，若"相等也覆盖"，旧快照会把新数据改小，钱会凭空缩水。
 *   ③ 账本本身只做加总；算钱用注入的 `price()`，拿不到价格就标 `unpriced`，
 *      **不假装是 0 元**。
 *
 * 不碰 fs、不联网、不开 timer。落盘由调用方 snapshot()/restore()。
 */

/** 五个桶（reasoning 只做展示，不计入总量：供应商的 output 通常已包含它） */
export const TOKEN_BUCKET_KEYS = Object.freeze(['cacheMiss', 'cacheHit', 'cacheWrite', 'output', 'reasoning']);

export const ZERO_BUCKETS = Object.freeze({ cacheMiss: 0, cacheHit: 0, cacheWrite: 0, output: 0, reasoning: 0 });

/** 空桶（每次给新对象，避免调用方改到常量） */
export function emptyBuckets() {
  return { ...ZERO_BUCKETS };
}

function intOf(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/**
 * 把各种口径的 usage 归一成五个桶。
 * 同时接受：
 *   · 本账本落盘口径：cacheMiss/cacheHit/cacheWrite/output/reasoning
 *   · 外部账单口径：inputTokens（未命中）/ cacheReadTokens / cacheWriteTokens / outputTokens
 *   · OpenAI 兼容口径：prompt_tokens / completion_tokens / prompt_tokens_details.cached_tokens
 */
export function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return emptyBuckets();

  const cacheHit = intOf(usage.cacheHit ?? usage.cacheReadTokens ?? usage.prompt_cache_hit_tokens
    ?? usage.prompt_tokens_details?.cached_tokens);
  const explicitMiss = usage.cacheMiss ?? usage.uncachedInputTokens ?? usage.inputTokens
    ?? usage.prompt_cache_miss_tokens;
  const prompt = Number(usage.prompt_tokens);
  const cacheMiss = explicitMiss !== undefined
    ? intOf(explicitMiss)
    : (Number.isFinite(prompt) ? Math.max(0, Math.round(prompt) - cacheHit) : 0);

  return {
    cacheMiss,
    cacheHit,
    cacheWrite: intOf(usage.cacheWrite ?? usage.cacheWriteTokens ?? usage.prompt_cache_write_tokens),
    output: intOf(usage.output ?? usage.outputTokens ?? usage.completion_tokens),
    reasoning: intOf(usage.reasoning ?? usage.reasoningTokens ?? usage.completion_tokens_details?.reasoning_tokens),
  };
}

/** 计费总量：四个互不重叠的桶（不含 reasoning，避免与 output 重复） */
export function totalTokensOf(buckets) {
  return (buckets?.cacheMiss ?? 0) + (buckets?.cacheHit ?? 0)
    + (buckets?.cacheWrite ?? 0) + (buckets?.output ?? 0);
}

/** 桶相加 */
export function addBuckets(a = {}, b = {}) {
  const out = {};
  for (const key of TOKEN_BUCKET_KEYS) out[key] = (a?.[key] ?? 0) + (b?.[key] ?? 0);
  return out;
}

/**
 * 建一本账。
 * @param {object} opts
 *   { now, maxSamples=5000, maxExternals=500, price（可选：buckets+meta → {total,currency,tier,estimated}）}
 */
export function createTokenLedger({
  now = () => Date.now(),
  maxSamples = 5000,
  maxExternals = 500,
  price = null,
} = {}) {
  const samples = new Map();       // key → 采样
  const externals = [];            // 不经过内核的用量（外部脚本自己报）
  let autoSeq = 0;

  function priced(buckets, model, at) {
    if (typeof price !== 'function') return { cost: 0, currency: '', tier: '', estimated: false, unpriced: true };
    try {
      const out = price(buckets, { model, at });
      const total = Number(out?.total);
      return {
        cost: Number.isFinite(total) ? total : 0,
        currency: String(out?.currency ?? ''),
        tier: String(out?.tier ?? ''),
        estimated: out?.estimated === true,
        unpriced: !Number.isFinite(total),
      };
    } catch {
      // 价格函数坏了：记下 token，但明确标"没算钱"，不吞成 0 元
      return { cost: 0, currency: '', tier: '', estimated: false, unpriced: true };
    }
  }

  function trimSamples() {
    const cap = Math.max(1, Number(maxSamples) || 5000);
    if (samples.size <= cap) return;
    const rows = [...samples.values()].sort((a, b) => a.at - b.at);
    for (const row of rows.slice(0, samples.size - cap)) samples.delete(row.key);
  }

  return {
    /**
     * 记一次模型用量。
     * @returns {object|null} 被采用的那条；重复/空用量返回已存在的那条或 null
     */
    ingest({
      sessionId = 'kernel', turn = 0, step = 0, retry = 0,
      model = 'unknown', at = now(), usage, seq,
    } = {}) {
      const buckets = normalizeUsage(usage);
      const total = totalTokensOf(buckets);
      if (!total) return null;

      const key = `${String(sessionId)}|${Number(turn) || 0}|${Number(step) || 0}|${Number(retry) || 0}`;
      const n = Number(seq);
      const hasSeq = Number.isFinite(n);
      const prev = samples.get(key);
      // 没给 seq 且这个键已经有记录 → 只可能是同一条事件的重放，直接返回原记录。
      // 给了 seq 才比较：只有严格更新的 seq 才覆盖；相等的也只可能是重放。
      if (prev && !hasSeq) return prev;
      const order = hasSeq ? n : (prev ? prev.seq : ++autoSeq);
      if (prev && prev.seq >= order) return prev;

      const p = priced(buckets, String(model), Number(at) || now());
      const row = {
        key,
        sessionId: String(sessionId),
        turn: Number(turn) || 0,
        step: Number(step) || 0,
        retry: Number(retry) || 0,
        model: String(model),
        at: Number(at) || now(),
        seq: order,
        buckets,
        tokens: total,
        cost: p.cost,
        currency: p.currency,
        tier: p.tier,
        estimated: p.estimated,
        unpriced: p.unpriced,
      };
      samples.set(key, row);
      if (order > autoSeq) autoSeq = order;
      trimSamples();
      return row;
    },

    /** 外部用量：明确是"别人报进来的"，没报就没有，不假装能采集 */
    external({ name = 'external', tokens = 0, cost = 0, at = now(), currency = '' } = {}) {
      const t = intOf(tokens);
      const c = Number(cost);
      if (!t && !(Number.isFinite(c) && c > 0)) return null;
      const row = { name: String(name), at: Number(at) || now(), tokens: t, cost: Number.isFinite(c) ? c : 0, currency: String(currency) };
      externals.push(row);
      const cap = Math.max(1, Number(maxExternals) || 500);
      if (externals.length > cap) externals.splice(0, externals.length - cap);
      return row;
    },

    /** 某条会话的累计（只算这条会话自己的采样） */
    sessionTotal(sessionId) {
      const sid = String(sessionId);
      let tokens = 0; let cost = 0; let samplesInSession = 0;
      for (const row of samples.values()) {
        if (row.sessionId !== sid) continue;
        tokens += row.tokens; cost += row.cost; samplesInSession += 1;
      }
      return { sessionId: sid, tokens, cost, samples: samplesInSession };
    },

    /** 汇总：总量 / 花费 / 按模型 / 峰谷 / 没算上价的条数 */
    summary() {
      let tokens = 0; let cost = 0; let unpriced = 0; let estimated = 0;
      let currency = '';
      const byModel = {};
      const byTier = {
        peak: { tokens: 0, cost: 0, samples: 0 },
        off: { tokens: 0, cost: 0, samples: 0 },
        unknown: { tokens: 0, cost: 0, samples: 0 },
      };
      for (const row of samples.values()) {
        tokens += row.tokens;
        cost += row.cost;
        if (row.unpriced) unpriced += 1;
        if (row.estimated) estimated += 1;
        if (!currency && row.currency) currency = row.currency;
        const slot = byModel[row.model] ?? { tokens: 0, cost: 0, samples: 0 };
        slot.tokens += row.tokens; slot.cost += row.cost; slot.samples += 1;
        byModel[row.model] = slot;
        const tier = row.tier === 'peak' || row.tier === 'off' ? row.tier : 'unknown';
        byTier[tier].tokens += row.tokens;
        byTier[tier].cost += row.cost;
        byTier[tier].samples += 1;
      }
      let externalTokens = 0; let externalCost = 0;
      for (const row of externals) { externalTokens += row.tokens; externalCost += row.cost; }
      return {
        tokens,
        cost,
        externalTokens,
        externalCost,
        totalTokens: tokens + externalTokens,
        totalCost: cost + externalCost,
        currency,
        samples: samples.size,
        externals: externals.length,
        unpriced,
        estimated,
        byModel,
        byTier,
      };
    },

    /** 落盘用 */
    snapshot() {
      return { samples: [...samples.values()], externals: externals.slice(), autoSeq };
    },

    /** 读盘用：整份替换；坏行丢掉，不让一条坏数据毁掉整本账 */
    restore(snapshot = {}) {
      samples.clear();
      externals.length = 0;
      autoSeq = 0;
      for (const row of Array.isArray(snapshot?.samples) ? snapshot.samples : []) {
        if (!row || typeof row !== 'object' || !row.key) continue;
        const buckets = normalizeUsage(row.buckets);
        if (!totalTokensOf(buckets)) continue;
        samples.set(String(row.key), {
          ...row,
          buckets,
          tokens: totalTokensOf(buckets),
          seq: Number.isFinite(Number(row.seq)) ? Number(row.seq) : 0,
          at: Number(row.at) || 0,
        });
        if (Number(row.seq) > autoSeq) autoSeq = Number(row.seq);
      }
      for (const row of Array.isArray(snapshot?.externals) ? snapshot.externals : []) {
        if (row && typeof row === 'object') externals.push({ ...row });
      }
      return { samples: samples.size, externals: externals.length };
    },

    size() { return samples.size; },
  };
}
