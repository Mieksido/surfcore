/**
 * web 包：工具面测试（注入假抓取/假搜索；不联网）
 * 跑法：node packs/web/web.test.mjs
 */
import { createWebTools, mapSearchResults } from './tools.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

console.log('## 工具声明');
{
  const web = createWebTools({ enabled: true });
  const decls = web.declarations();
  ok(decls.length === 2, '两个工具：fetch/search');
  ok(decls.find((d) => d.name === 'web_fetch').parameters.required.includes('url'), 'fetch 必填 url');
  ok(decls.find((d) => d.name === 'web_search').parameters.required.includes('query'), 'search 必填 query');
  ok(web.has('web_fetch') && web.has('web_search'), 'has() 认得');
  ok(!web.has('web_nope'), '没这个工具');

  const off = createWebTools({ enabled: false });
  ok(off.declarations().length === 0 && !off.has('web_fetch'), '关掉：不出现、不可调');
  ok((await off.run('web_fetch', { url: 'https://x' })).error.code === 'web.disabled', '关掉：调用明确拒绝');
}

console.log('\n## web_fetch：结构化成功/失败');
{
  const calls = [];
  const web = createWebTools({
    safeFetch: async (url, opts) => { calls.push({ url, opts }); return { ok: true, url, status: 200, contentType: 'text/html', text: '正文', truncated: false }; },
  });
  const r = await web.run('web_fetch', { url: 'https://example.com', maxChars: 100 });
  ok(r.ok && r.data.text === '正文', '成功：返回正文');
  ok(calls[0].opts.maxChars === 100, 'maxChars 传给抓取');

  const bad = createWebTools({
    safeFetch: async () => { const e = new Error('拒绝内网'); e.code = 'web.private-ip'; e.hint = '只能公网'; throw e; },
  });
  const err = await bad.run('web_fetch', { url: 'http://127.0.0.1' });
  ok(!err.ok && err.error.code === 'web.private-ip' && err.error.hint === '只能公网', '失败：结构化 code/hint');

  const missing = await web.run('web_fetch', {});
  ok(!missing.ok && missing.error.code === 'web.missing-url', '缺 url：拒绝');
}

console.log('\n## web_search：没配端点就明说');
{
  const web = createWebTools({});
  const r = await web.run('web_search', { query: '天气' });
  ok(!r.ok && r.error.code === 'web.search-unconfigured', '没配：结构化错误');
  ok(String(r.error.hint).includes('SURFCORE_WEB_SEARCH_ENDPOINT'), '告诉怎么配');
}

console.log('\n## web_search：配了端点（假 fetch）');
{
  const calls = [];
  const web = createWebTools({
    searchEndpoint: 'https://search.example.com/api',
    searchKey: 'k',
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 200, json: async () => ({ results: [{ title: '结果一', url: 'https://a', content: '摘要一' }] }) };
    },
  });
  const r = await web.run('web_search', { query: '猫', maxResults: 3 });
  ok(r.ok && r.data.results[0].title === '结果一', '成功：返回结果');
  ok(calls[0].url === 'https://search.example.com/api', '打到端点');
  ok(calls[0].opts.method === 'POST' && calls[0].opts.headers.authorization === 'Bearer k', 'POST + Bearer');
  ok(JSON.parse(calls[0].opts.body).query === '猫', 'body 带 query');

  const unauthorized = createWebTools({
    searchEndpoint: 'https://search.example.com/api',
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'bad key' } }) }),
  });
  const u = await unauthorized.run('web_search', { query: 'x' });
  ok(!u.ok && u.error.code === 'web.search-unauthorized' && u.error.retryable === false, '401：不重试');

  const empty = createWebTools({
    searchEndpoint: 'https://search.example.com/api',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) }),
  });
  ok((await empty.run('web_search', { query: 'x' })).error.code === 'web.search-empty', '空结果：明确');

  const badEndpoint = createWebTools({ searchEndpoint: 'http://127.0.0.1/api' });
  ok((await badEndpoint.run('web_search', { query: 'x' })).error.code === 'web.private-ip', '搜索端点也不许内网');
}

console.log('\n## 搜索结果形状');
{
  ok(mapSearchResults({ results: [{ title: 'a', url: 'u', snippet: 's' }] })[0].snippet === 's', 'results/title/url/snippet');
  ok(mapSearchResults({ data: [{ name: 'n', link: 'l', description: 'd' }] })[0].url === 'l', 'data/name/link/description');
  ok(mapSearchResults({ web: { results: [{ title: 'w' }] } })[0].title === 'w', 'web.results');
  ok(mapSearchResults({ results: Array.from({ length: 20 }, (_, i) => ({ title: String(i) })) }, { maxResults: 3 }).length === 3, '受 maxResults 限制');
  ok(mapSearchResults({}) .length === 0, '没结果：空数组');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
