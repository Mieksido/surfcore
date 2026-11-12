/**
 * web 包模块：两个模型工具 web_fetch / web_search
 * ============================================================================
 * 位置：平台包（web）内部。它把"外部世界"封成工具：
 *   · 内核只看到工具声明与结果，不认识"网页/搜索厂商"；
 *   · 这个小适配器（packs/web/index.js）负责把工具交给模型；
 *   · 搜索端点/密钥由设置或环境给；没配就明确报错，不假装搜过。
 */
import { safeFetch, validateFetchUrl, WebError } from './fetch.js';

/** 把各种搜索 API 的常见返回形状收敛成 [{title,url,snippet}] */
export function mapSearchResults(payload, { maxResults = 8 } = {}) {
  const rows = Array.isArray(payload?.results) ? payload.results
    : Array.isArray(payload?.data) ? payload.data
      : Array.isArray(payload?.web?.results) ? payload.web.results
        : Array.isArray(payload?.items) ? payload.items
          : [];
  const cap = Math.max(1, Number(maxResults) || 8);
  return rows.slice(0, cap).map((row) => ({
    title: String(row?.title ?? row?.name ?? '').trim().slice(0, 200),
    url: String(row?.url ?? row?.link ?? '').trim().slice(0, 500),
    snippet: String(row?.snippet ?? row?.content ?? row?.description ?? row?.summary ?? '').replace(/\s+/g, ' ').trim().slice(0, 400),
  })).filter((row) => row.title || row.url || row.snippet);
}

const err = (code, message, hint = '', retryable = false) => ({ ok: false, error: { code, message, hint, retryable } });

/**
 * @param {object} opts { enabled, safeFetch（测试注入）, fetchImpl, searchEndpoint, searchKey, maxChars, timeoutMs }
 */
export function createWebTools({
  enabled = true,
  safeFetch: fetchSafe = safeFetch,
  fetchImpl = globalThis.fetch,
  searchEndpoint = '',
  searchKey = '',
  maxChars = 50000,
  timeoutMs = 15000,
} = {}) {
  const on = enabled !== false;
  const endpoint = String(searchEndpoint ?? '').trim();

  return {
    name: 'web',
    enabled: on,

    declarations() {
      if (!on) return [];
      return [
        {
          name: 'web_fetch',
          description: '只读抓取一个公网 http(s) 网页的正文（禁内网/本机；限量/超时）',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: '完整 http(s) 地址' },
              maxChars: { type: 'number', description: '最多返回多少字符（默认 50000）' },
            },
            required: ['url'],
            additionalProperties: false,
          },
        },
        {
          name: 'web_search',
          description: '联网搜索（需要部署配置搜索端点；没配会明确说没配）',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '搜索词' },
              maxResults: { type: 'number', description: '最多几条（默认 8）' },
            },
            required: ['query'],
            additionalProperties: false,
          },
        },
      ];
    },

    has(name) {
      return on && (name === 'web_fetch' || name === 'web_search');
    },

    async run(name, args = {}) {
      if (!on) return err('web.disabled', '联网工具没开', '设置 SURFCORE_WEB_TOOLS=on');
      if (name === 'web_fetch') {
        const url = String(args?.url ?? '').trim();
        if (!url) return err('web.missing-url', 'web_fetch 缺少 url');
        try {
          const out = await fetchSafe(url, {
            maxChars: Number(args?.maxChars) > 0 ? Number(args.maxChars) : maxChars,
            timeoutMs,
          });
          return { ok: true, data: out };
        } catch (error) {
          if (error instanceof WebError || (error?.code && String(error.code).startsWith('web.'))) {
            return err(error.code, error.message, error.hint, /timeout|network|dns/.test(error.code));
          }
          return err('web.failed', String(error?.message ?? error), '稍后再试');
        }
      }

      if (name === 'web_search') {
        const query = String(args?.query ?? '').trim();
        if (!query) return err('web.missing-query', 'web_search 缺少 query');
        if (!endpoint) {
          return err('web.search-unconfigured', '没有配置搜索端点', '设置 SURFCORE_WEB_SEARCH_ENDPOINT + SURFCORE_WEB_SEARCH_KEY；或先用 web_fetch 抓已知网址');
        }
        try { validateFetchUrl(endpoint); }
        catch (error) { return err(error.code ?? 'web.bad-endpoint', error.message, error.hint); }
        if (typeof fetchImpl !== 'function') return err('web.no-fetch', '没有可用的 fetch');

        let res;
        try {
          res = await fetchImpl(endpoint, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(searchKey ? { authorization: `Bearer ${searchKey}` } : {}),
            },
            body: JSON.stringify({ query, max_results: Number(args?.maxResults) || 8 }),
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (error) {
          const msg = String(error?.message ?? error);
          const timeout = /timeout|abort/i.test(msg);
          return err(timeout ? 'web.search-timeout' : 'web.search-network', msg, '可重试；持续失败检查搜索服务', true);
        }
        const payload = await res.json().catch(() => null);
        if (!res.ok) {
          const unauthorized = res.status === 401 || res.status === 403;
          return err(unauthorized ? 'web.search-unauthorized' : 'web.search-http', String(payload?.error?.message ?? payload?.message ?? `HTTP ${res.status}`), unauthorized ? '检查搜索密钥' : '可重试；持续失败看服务状态', !unauthorized && res.status >= 500);
        }
        const results = mapSearchResults(payload, { maxResults: Number(args?.maxResults) || 8 });
        if (!results.length) return err('web.search-empty', '搜索没有返回结果', '换个搜索词');
        return { ok: true, data: { query, results } };
      }

      return err('web.unknown-tool', `没有这个联网工具：${name}`);
    },
  };
}
