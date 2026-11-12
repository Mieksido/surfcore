/**
 * QQ 桥接语义工具测试（注入假 transport/fetch，不联网）
 * 跑法：node packs/qq/bridge-tools.test.mjs
 */
import {
  QQ_BRIDGE_TOOLS, bridgeToolDeclarations, createBridgeTransport, createBridgeToolRunner, describeBridgeTools,
} from './bridge-tools.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

console.log('## 工具表：读写分级 / 声明');
{
  ok(QQ_BRIDGE_TOOLS.length === 18, '18 个桥接语义工具');
  const kinds = QQ_BRIDGE_TOOLS.reduce((acc, t) => { acc[t.kind] = (acc[t.kind] ?? 0) + 1; return acc; }, {});
  ok(kinds.read === 16 && kinds.write === 2, '16 读 / 2 写（mark_read、wait）');
  const decls = bridgeToolDeclarations();
  ok(decls.length === 16, '默认只给 16 个只读工具的声明（写工具 fail-closed）');
  ok(decls.every((d) => d.parameters.type === 'object'), '参数是 JSON Schema 对象');
  ok(decls.every((d) => !JSON.stringify(d).includes('agentToken')), '声明里不带令牌');
  const withWrite = bridgeToolDeclarations({ includeWrite: true });
  ok(withWrite.length === 18, 'includeWrite 后 18 个');
  ok(withWrite.find((d) => d.name === 'qq_mark_read').parameters.required.includes('key'), '必填 key 进 required');
  const noKey = bridgeToolDeclarations({ includeKey: false, includeWrite: true }).find((d) => d.name === 'qq_get_unread_messages');
  ok(!noKey.parameters.properties.key && !noKey.parameters.required.includes('key'), 'includeKey=false：key 不交给模型');
  const d = describeBridgeTools();
  ok(d.total === 18 && d.write.includes('qq_mark_read'), '描述摘要');
}

console.log('\n## 执行器：只读默认可用');
{
  const calls = [];
  const transport = { request: async (req) => { calls.push(req); return { ok: true, data: { echoed: req } }; } };
  const runner = createBridgeToolRunner({ transport });

  const r = await runner.run('qq_get_unread_messages', { key: 'group:123' });
  ok(r.ok, '读工具：成功');
  ok(calls[0].method === 'GET' && calls[0].path === '/api/socialV2/unread', 'GET /unread');
  ok(calls[0].query.key === 'group:123' && calls[0].query.limit === 30, 'key 原样、limit 用默认 30');

  await runner.run('qq_get_context_snapshot', { key: 'private:9', include: ['unread', 'recent'], textChars: 80 });
  ok(calls[1].query.include.length === 2, '数组参数原样交给传输（传输负责拼逗号）');
  ok(calls[1].query.textChars === 80, '显式参数覆盖默认');

  await runner.run('qq_get_prompt', { key: 'group:1' });
  ok(calls[2].query.mode === undefined, '没给的可选参数不发空值');

  await runner.run('qq_list_stickers', { key: 'group:1' });
  ok(calls[3].method === 'POST' && calls[3].body.refresh === false, '表情列表用 POST（避开 GET 写副作用），refresh 默认 false');
}

console.log('\n## 执行器：写操作默认关');
{
  const transport = { request: async () => ({ ok: true, data: {} }) };
  const closed = createBridgeToolRunner({ transport });
  const denied = await closed.run('qq_mark_read', { key: 'group:1', throughSeq: 5 });
  ok(!denied.ok && denied.error.code === 'qq.bridge-tool-denied', 'mark_read：默认拒绝');
  ok(String(denied.error.hint).includes('写操作'), '拒绝时说清怎么开');

  const refresh = await closed.run('qq_list_stickers', { key: 'group:1', refresh: true });
  ok(!refresh.ok && refresh.error.code === 'qq.bridge-tool-denied', '表情 refresh：也算写，默认拒绝');

  const open = createBridgeToolRunner({ transport, allowWrite: true });
  const wrote = await open.run('qq_mark_read', { key: 'group:1', throughSeq: 5 });
  ok(wrote.ok, '打开写：mark_read 放行');
  const waited = await open.run('qq_wait_for_messages', { key: 'group:1', purpose: 'reply', quietMs: 12000 });
  ok(waited.ok, '打开写：wait 放行');
}

console.log('\n## 执行器：参数校验');
{
  const transport = { request: async () => ({ ok: true, data: {} }) };
  const runner = createBridgeToolRunner({ transport, allowWrite: false });

  ok((await runner.run('nope', {})).error.code === 'qq.bridge-tool-unknown', '没这个工具：结构化错误');
  ok((await runner.run('qq_get_unread_messages', {})).error.code === 'qq.bridge-tool-missing-arg', '缺 key：拒绝');
  ok((await runner.run('qq_get_message_detail', { key: 'group:1' })).error.code === 'qq.bridge-tool-missing-arg', '缺 messageId：拒绝');
  const bad = await runner.run('qq_get_unread_messages', { key: 'group:abc' });
  ok(!bad.ok && bad.error.code === 'qq.bridge-tool-bad-key', 'key 格式不对：拒绝并说格式');
}

console.log('\n## 传输：头 / 解包 / 失败');
{
  const calls = [];
  const t = createBridgeTransport({
    baseUrl: 'http://127.0.0.1:3100/',
    consoleToken: 'console-123',
    agentToken: 'agent-abc',
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 200, json: async () => ({ ok: true, unreadCount: 2 }) };
    },
  });
  const r = await t.request({ method: 'GET', path: '/api/socialV2/unread', query: { key: 'group:1', limit: 30, probe: true, include: ['a', 'b'], empty: '' } });
  ok(r.ok && r.data.unreadCount === 2, '成功：返回整个 body（不解 data.data）');
  ok(calls[0].opts.headers['x-agent-call'] === '1', 'x-agent-call:1（不可省）');
  ok(calls[0].opts.headers['x-agent-token'] === 'agent-abc', 'x-agent-token 由运行时注入');
  ok(calls[0].opts.headers['x-console-token'] === 'console-123', 'console token 有就带');
  ok(calls[0].url.includes('include=a%2Cb'), '数组拼逗号');
  ok(calls[0].url.includes('probe=1'), '布尔→1/0');
  ok(!calls[0].url.includes('empty='), '空值不发');
  ok(calls[0].url.startsWith('http://127.0.0.1:3100/api/'), 'baseUrl 尾部斜杠被剥掉');

  const post = createBridgeTransport({
    agentToken: 'a',
    fetchImpl: async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ ok: true }) }; },
  });
  await post.request({ method: 'POST', path: '/x', body: { key: 'group:1' } });
  const last = calls[calls.length - 1];
  ok(last.opts.headers['content-type'] === 'application/json', 'POST 带 JSON content-type');
  ok(JSON.parse(last.opts.body).key === 'group:1', 'POST body 是 JSON');

  const noToken = createBridgeTransport({ fetchImpl: async () => { throw new Error('不该发'); } });
  const n = await noToken.request({ path: '/x' });
  ok(!n.ok && n.error.code === 'qq.bridge-no-token', '没令牌：不请求，直接给下一步');

  const denied = createBridgeTransport({
    agentToken: 'a',
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ ok: false, error: '令牌不对', hint: '看设置页' }) }),
  });
  const d = await denied.request({ path: '/x' });
  ok(!d.ok && d.error.code === 'qq.bridge-unauthorized' && d.error.retryable === false, '403：不重试');
  ok(d.error.hint === '看设置页', '桥接给的 hint 要带出来');

  const failed = createBridgeTransport({
    agentToken: 'a',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: false, code: 'PRE_SLEEP_WAIT_REQUIRED', error: '要先观察', hint: '等 5 分钟', nextStep: 'x' }) }),
  });
  const f = await failed.request({ path: '/x' });
  ok(!f.ok && f.error.code === 'PRE_SLEEP_WAIT_REQUIRED', '200+ok:false：保住桥接的业务 code');
  ok(f.error.hint === '等 5 分钟', '200+ok:false：保住 hint');

  const net = createBridgeTransport({ agentToken: 'a', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  const e = await net.request({ path: '/x' });
  ok(!e.ok && e.error.code === 'qq.bridge-network' && e.error.retryable === true, '网络错误：可重试');

  const to = createBridgeTransport({ agentToken: 'a', fetchImpl: async () => { throw new Error('aborted due to timeout'); } });
  ok((await to.request({ path: '/x' })).error.code === 'qq.bridge-timeout', '超时：单独归类');
}

console.log('\n## 图片工具：base64 → 字节，交给模型；坏数据不假装成功');
{
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const b64 = png.toString('base64');
  const calls = [];
  const transport = {
    request: async (req) => {
      calls.push(req);
      if (req.path.includes('/images/message')) {
        return { ok: true, data: { images: [{ data: b64, mimeType: 'image/png', kind: 'image', text: '猫' }, { data: '', mimeType: 'image/png' }], note: '共 2 张' } };
      }
      return { ok: true, data: { image: { data: b64, mimeType: 'image/png' }, sticker: { id: 's1', desc: '猫猫' } } };
    },
  };
  const runner = createBridgeToolRunner({ transport });

  const msg = await runner.run('qq_get_message_images', { key: 'group:1', messageId: -9 });
  ok(msg.ok, '消息图片：成功');
  ok(msg.media.length === 1 && Buffer.isBuffer(msg.media[0].bytes), '图片变成字节（Buffer）');
  ok(msg.media[0].bytes.equals(png), '字节和原图一致');
  ok(msg.data.count === 1 && msg.data.total === 2 && msg.data.dropped[0].reason === 'no-data', '坏图进 dropped，数据里说清');
  ok(!JSON.stringify(msg.data).includes(b64), 'base64 不留在 data 里（避免重复塞进上下文）');
  ok(calls[0].query.messageId === -9, '负数 messageId 原样发');

  const sticker = await runner.run('qq_get_sticker_image', { key: 'group:1', stickerId: 's1' });
  ok(sticker.ok && sticker.media.length === 1 && sticker.data.sticker.id === 's1', '表情图片：字节 + 元数据');
  ok(calls[1].query.stickerId === 's1', 'stickerId 进 query');

  const broken = createBridgeToolRunner({
    transport: { request: async () => ({ ok: true, data: { images: 'nope' } }) },
  });
  const empty = await broken.run('qq_get_message_images', { key: 'group:1', messageId: 1 });
  ok(empty.ok && empty.data.count === 0 && !empty.media, '返回形状不对：0 张，不炸');
}

console.log('\n## 传输 + 执行器：一条真链路（假 fetch）');
{
  const calls = [];
  const transport = createBridgeTransport({
    agentToken: 'a',
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 200, json: async () => ({ ok: true, markedCount: 2, readThroughSeq: 9 }) };
    },
  });
  const runner = createBridgeToolRunner({ transport, allowWrite: true });
  const r = await runner.run('qq_mark_read', { key: 'group:1', throughSeq: 9 });
  ok(r.ok && r.data.markedCount === 2, '端到端：mark_read 返回数据');
  ok(calls[0].url.endsWith('/api/socialV2/mark-read'), '打到 mark-read');
  ok(JSON.parse(calls[0].opts.body).throughSeq === 9, 'throughSeq 进 body');
  ok(!calls[0].url.includes('token='), '令牌不进 URL');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
