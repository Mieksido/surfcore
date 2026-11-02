// p-memory sidecar 客户端（可选长期记忆后端）。
//
// 为什么要有这个文件：surfcore 的记忆卡是纯文件（memory-card.json + jsonl），没有数据库、
// 也不调模型做摘要。p-memory 恰好补的是这两件事——它把「写入 / 索引 / 检索 / 衰减」放进一个
// Rust 扩展里，中文检索开箱可用。代价是它是 PyO3 扩展，Node 调不动，只能起一个本地 sidecar
// （见 sidecars/pmemory/API.md）。
//
// 本模块的硬约束（PR 评审会看）：
//   1. 纯可选：enabled 为 false（默认）时，本模块的所有函数都直接返回 null，零网络请求。
//   2. 绝不抛错：sidecar 不在 / 超时 / 返回坏 JSON，一律吞掉并返回 null，调用方按「没有长记忆」
//      继续走。桥接不能因为一个附加记忆后端拖慢或拖死 QQ 回复。
//   3. 只连回环地址：url 的 host 必须是 127.0.0.1 / ::1 / localhost，否则视为配置错误直接禁用。
//   4. 不引入依赖：只用 Node 内置 fetch / AbortSignal。

export const DEFAULT_PMEMORY_CONFIG = Object.freeze({
  enabled: false,
  url: 'http://127.0.0.1:8791',
  token: '',
  timeoutMs: 8000,
  namespace: '',
  overviewMaxChars: 2200,
  mirrorOnMaintenance: true,
  recallLimit: 8,
});

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** 归一化 pmemory 配置；任何非法值都退回默认，绝不抛错。 */
export function normalizePmemoryConfig(input = {}) {
  const base = DEFAULT_PMEMORY_CONFIG;
  const src = input && typeof input === 'object' ? input : {};
  const num = (value, fallback, min, max) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  };
  const url = String(src.url ?? base.url).trim() || base.url;
  const out = {
    enabled: src.enabled === true,
    url,
    token: String(src.token ?? '').trim(),
    timeoutMs: num(src.timeoutMs, base.timeoutMs, 500, 60000),
    namespace: String(src.namespace ?? '').trim(),
    overviewMaxChars: num(src.overviewMaxChars, base.overviewMaxChars, 200, 10000),
    mirrorOnMaintenance: src.mirrorOnMaintenance !== false,
    recallLimit: num(src.recallLimit, base.recallLimit, 1, 30),
  };
  out.hostAllowed = isLoopbackUrl(out.url);
  if (!out.hostAllowed) out.enabled = false;
  return out;
}

/** 只允许回环地址：这个后端存的是私人记忆，不能让它悄悄连到局域网/公网。 */
export function isLoopbackUrl(url) {
  try {
    const parsed = new URL(String(url));
    if (!/^https?:$/.test(parsed.protocol)) return false;
    return LOOPBACK_HOSTS.has(parsed.hostname) || parsed.hostname === '::1';
  } catch {
    return false;
  }
}

function joinUrl(base, path) {
  const trimmed = String(base).replace(/\/+$/, '');
  return `${trimmed}${path}`;
}

function headersFor(config) {
  const headers = { 'content-type': 'application/json' };
  if (config.token) headers['x-pmemory-token'] = config.token;
  return headers;
}

/**
 * 发一个请求，永远不抛错。
 * 返回 `{ ok:true, data }` 或 `{ ok:false, error }`；调用方按 ok 判断。
 */
async function request(config, path, { method = 'GET', body, timeoutMs } = {}) {
  const cfg = config?.enabled ? config : normalizePmemoryConfig(config);
  if (!cfg.enabled || !cfg.hostAllowed) return { ok: false, error: 'disabled' };
  const ms = Math.min(Number(timeoutMs) || cfg.timeoutMs, 60000);
  try {
    const res = await fetch(joinUrl(cfg.url, path), {
      method,
      headers: headersFor(cfg),
      body: body == null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(ms),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) {
      // 把 sidecar 自己给的 error 带上：排障时「http 500」不够用。
      const detail = data && typeof data.error === 'string' ? `: ${data.error}` : '';
      return { ok: false, error: `http ${res.status}${detail}`, status: res.status, data };
    }
    if (data && data.ok === false) return { ok: false, error: data.error ?? 'sidecar error', data };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error?.name === 'TimeoutError' ? 'timeout' : String(error?.message ?? error) };
  }
}

/** 健康检查：sidecar 不在时返回 `{ ok:false }`，不抛错。 */
export async function pmemoryHealth(config, { timeoutMs } = {}) {
  return request(config, '/health', { timeoutMs: timeoutMs ?? 2000 });
}

/** 写入/更新若干条记忆（幂等，按 judgment 文本去重）。 */
export async function pmemoryConsume(config, { namespace, records } = {}) {
  const list = Array.isArray(records) ? records : [];
  if (!list.length) return { ok: false, error: 'empty' };
  const ns = String(namespace ?? config?.namespace ?? '').trim();
  return request(config, '/consume', { method: 'POST', body: { namespace: ns || undefined, records: list } });
}

/** 按查询召回若干条（这就是记忆卡的静态注入之外，真正「按语境检索」的那一半）。 */
export async function pmemoryRecall(config, { query, namespace, limit } = {}) {
  const q = String(query ?? '').trim();
  if (!q) return { ok: false, error: 'empty-query' };
  const ns = String(namespace ?? config?.namespace ?? '').trim();
  const lim = Math.min(30, Math.max(1, Math.round(Number(limit) || config?.recallLimit || 8)));
  const params = new URLSearchParams({ q, limit: String(lim) });
  if (ns) params.set('namespace', ns);
  return request(config, `/recall?${params.toString()}`);
}

/** 取一段静态概览文本（给提示词注入用）。 */
export async function pmemoryOverview(config, { namespace, maxChars } = {}) {
  const ns = String(namespace ?? config?.namespace ?? '').trim();
  const max = Math.min(10000, Math.max(200, Math.round(Number(maxChars) || config?.overviewMaxChars || 2200)));
  const params = new URLSearchParams({ maxChars: String(max) });
  if (ns) params.set('namespace', ns);
  return request(config, `/overview?${params.toString()}`);
}

/** 忘记：按 id 或按查询词删除。 */
export async function pmemoryForget(config, { namespace, ids, query } = {}) {
  const ns = String(namespace ?? config?.namespace ?? '').trim();
  const body = {};
  if (ns) body.namespace = ns;
  if (Array.isArray(ids) && ids.length) body.ids = ids.map((id) => Number(id)).filter((n) => Number.isFinite(n));
  else if (String(query ?? '').trim()) body.q = String(query).trim();
  else return { ok: false, error: 'empty' };
  return request(config, '/forget', { method: 'POST', body });
}

/** 触发一次衰减（p-memory 自己的策略；不传 policy 时用库默认）。 */
export async function pmemoryDecay(config, { namespace } = {}) {
  const ns = String(namespace ?? config?.namespace ?? '').trim();
  const body = ns ? { namespace: ns } : {};
  return request(config, '/decay', { method: 'POST', body });
}
