/**
 * B站 网络层测试（注入假 fetch，不联网）
 * 跑法：node packs/bilibili/api.test.mjs
 */
import { createBiliClient, explainBiliCode } from './api.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

const jsonOk = (payload) => async () => ({ ok: true, status: 200, json: async () => payload });

console.log('## 不需要登录的调用');
{
  const calls = [];
  const client = createBiliClient({
    fetchImpl: async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ code: 0, data: { title: '一个视频' } }) }; },
  });
  const r = await client.videoInfo({ bvid: 'BV1xx' });
  ok(r.ok && r.data.title === '一个视频', '取视频信息：成功');
  ok(calls[0].url.includes('bvid=BV1xx'), '参数进了 query');
  ok(!calls[0].opts.headers.cookie, '没给 cookie：不带凭据');
}

console.log('\n## 需要登录的调用（cookie 由调用方给）');
{
  const calls = [];
  const client = createBiliClient({
    cookie: 'SESSDATA=abc',
    fetchImpl: async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ code: 0, data: { rpid: 1 } }) }; },
  });
  const r = await client.postComment({ oid: 123, message: '好看' });
  ok(r.ok, '发评论：成功');
  ok(calls[0].opts.method === 'POST', '用的是 POST');
  ok(calls[0].opts.headers.cookie === 'SESSDATA=abc', '带上调用方给的 cookie');
  ok(String(calls[0].opts.body).includes('message='), '表单里带正文');
}

console.log('\n## 读：动态 / 评论 / 名片（只读公开数据）');
{
  const calls = [];
  const client = createBiliClient({
    cookie: 'SESSDATA=abc',
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 200, json: async () => ({ code: 0, data: { items: [] } }) };
    },
  });

  const feed = await client.spaceDynamics({ mid: 42, offset: 2 });
  ok(feed.ok, '空间动态：成功');
  ok(calls[0].url.includes('feed/space') && calls[0].url.includes('host_mid=42'), '动态接口带 host_mid');
  ok(calls[0].url.includes('offset=2'), '翻页参数进 query');
  ok(calls[0].opts.headers.cookie === 'SESSDATA=abc', '带调用方给的 cookie（有就带）');

  const detail = await client.dynamicDetail({ id: '123' });
  ok(detail.ok && calls[1].url.includes('detail') && calls[1].url.includes('id=123'), '动态详情：按 id 取');

  const replies = await client.replies({ oid: 9, type: 12, pn: 2, ps: 10, sort: 0 });
  ok(replies.ok, '评论列表：成功');
  ok(calls[2].url.includes('oid=9') && calls[2].url.includes('type=12'), '评论参数 oid/type 进 query');
  ok(calls[2].url.includes('pn=2') && calls[2].url.includes('ps=10') && calls[2].url.includes('sort=0'), '分页与排序进 query');

  const card = await client.userCard({ mid: 7 });
  ok(card.ok && calls[3].url.includes('card') && calls[3].url.includes('mid=7'), '用户名片：按 mid 取');
}

console.log('\n## 业务错误码 → 下一步');
{
  ok(explainBiliCode(0) === null, '0：没有错误');
  ok(explainBiliCode(-101).kind === 'login', '-101：登录态失效');
  ok(explainBiliCode(-412).kind === 'risk', '-412：风控');
  ok(String(explainBiliCode(-352).hint).includes('别急'), '风控提示"别急着重试"');
  ok(explainBiliCode(12002).kind === 'closed', '12002：评论关闭');

  const client = createBiliClient({ fetchImpl: jsonOk({ code: -101, message: '账号未登录' }) });
  const r = await client.postComment({ oid: 1, message: 'x' });
  ok(!r.ok && r.error.code === 'bili.login', '业务错误：结构化错误码');
  ok(r.error.retryable === false, '登录失效：不重试');
  ok(String(r.error.hint).includes('cookie'), '给下一步（重新登录）');
}

console.log('\n## 网络与 HTTP');
{
  const bad = createBiliClient({ fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  const r = await bad.nav();
  ok(!r.ok && r.error.code === 'bili.network' && r.error.retryable === true, '网络错误：可重试');

  const to = createBiliClient({ fetchImpl: async () => { throw new Error('aborted due to timeout'); } });
  ok((await to.nav()).error.code === 'bili.timeout', '超时：单独归类');

  const e412 = createBiliClient({ fetchImpl: async () => ({ ok: false, status: 412, json: async () => ({}) }) });
  const r412 = await e412.nav();
  ok(r412.error.status === 412 && r412.error.retryable === false, 'HTTP 412：判风控，不重试');
  ok(String(r412.error.hint).includes('风控'), '412 给风控提示');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
