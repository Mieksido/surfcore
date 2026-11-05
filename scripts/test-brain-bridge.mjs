// 星图接线（src/bridge.js 的 /brain 与 /api/brain/*）的回归。
// 用真实 bridge.js 的 VM 夹具（audit-bridge-harness）起一个控制台，走真实 HTTP：
// 不连 QQ、不连 DSH，也不会碰真实记忆目录（夹具把 activeMemoryPaths 指向临时目录）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const TOKEN = 'fixture-console-token';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(fn, ms = 2000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (fn()) return true;
    await sleep(25);
  }
  return false;
}

function todayDay() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const privateEvent = (userId, text = '在吗') => ({
  post_type: 'message', message_type: 'private', user_id: userId, self_id: 1,
  message_id: 5000 + (Number(userId) % 900) + Math.floor(Math.random() * 100),
  sender: { user_id: userId, nickname: `fixture-${userId}` },
  message: [{ type: 'text', data: { text } }],
});
const groupEvent = (userId, text = '你好') => ({
  post_type: 'message', message_type: 'group', group_id: 456, user_id: userId, self_id: 1,
  message_id: 6000 + (Number(userId) % 900) + Math.floor(Math.random() * 100),
  sender: { user_id: userId, nickname: `fixture-${userId}` },
  message: [{ type: 'text', data: { text } }],
});

const MEMORY_RECORDS = [
  {
    id: 'mem_owner', title: '主人喜欢雨天', text: '她说喜欢雨天', kind: 'owner', scope: 'qq', speaker: '主人',
    tags: ['owner'], importance: 80, clarity: 'vivid', conversationKey: 'private:123',
    createdAt: '2026-05-01T02:00:00.000Z', lastSeenAt: '2026-05-19T02:00:00.000Z',
  },
  {
    id: 'mem_event', title: '去看了展', text: '周末去看了展', kind: 'event', scope: 'qq', speaker: '主人',
    tags: [], importance: 10, clarity: 'fuzzy', conversationKey: 'private:123',
    createdAt: '2026-04-01T02:00:00.000Z', lastSeenAt: '2026-04-10T02:00:00.000Z',
  },
];

const day = todayDay();
// 夹具的 ROOT 是临时目录，页面得放进去；用真实的 public/brain.html，
// 这样「路由把页面端出来」这条也顺带验的是真货。
const REAL_PAGE = fs.readFileSync(new URL('../public/brain.html', import.meta.url), 'utf8');

async function withConsole(run, options = {}) {
  const h = await bridgeHarness({
    files: {
      'public/brain.html': REAL_PAGE,
      'dsh/surfcore/memory/memory-card-full.jsonl': MEMORY_RECORDS.map((r) => JSON.stringify(r)).join('\n') + '\n',
    },
    ...options,
  });
  const server = h.startConsoleServer();
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  const call = (method, p, { body, headers = {}, agentCall = false, consoleToken = TOKEN } = {}) => new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1', port, path: p, method,
      headers: {
        'content-type': 'application/json',
        ...(consoleToken === null ? {} : { 'x-console-token': consoleToken }),
        ...(agentCall ? { 'x-agent-call': '1' } : {}),
        ...headers,
      },
    }, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: data }));
    });
    request.on('error', reject);
    request.setTimeout(4000, () => request.destroy(new Error('request hung')));
    request.end(body === undefined ? undefined : JSON.stringify(body));
  });
  try {
    await run({ h, server, port, call });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await h.close();
  }
}

/** 开一条 SSE 长连接，把收到的所有字节攒起来供断言。 */
function openStream(port, { key = '', headers = {} } = {}) {
  const state = { chunks: [], ended: false };
  const request = http.request({
    host: '127.0.0.1', port,
    path: `/api/brain/events${key ? `?key=${encodeURIComponent(key)}` : ''}`,
    headers: { 'x-console-token': TOKEN, ...headers },
  }, (response) => {
    state.status = response.statusCode;
    state.headers = response.headers;
    response.on('data', (chunk) => state.chunks.push(String(chunk)));
    response.on('end', () => { state.ended = true; });
  });
  request.on('error', () => { state.ended = true; });
  request.end();
  state.text = () => state.chunks.join('');
  state.close = () => request.destroy();
  return state;
}

let failures = 0;
async function test(name, run, options) {
  try {
    await run();
    console.log('PASS', name);
  } catch (error) {
    failures += 1;
    console.error('FAIL', name, error.message);
  }
}

// ── 只读面：页面 / 快照 / 曲线 / 回放 ───────────────────────────────────────
await test('页面与三条只读接口：形状对得上页面要的东西', async () => {
  await withConsole(async ({ call }) => {
    const page = await call('GET', '/brain');
    assert.equal(page.status, 200);
    assert.match(page.headers['content-type'], /text\/html/);
    assert.ok(page.body.includes('brain'), '返的应该是星图页面');

    const snap = await call('GET', '/api/brain/snapshot');
    assert.equal(snap.status, 200);
    const snapBody = JSON.parse(snap.body);
    assert.equal(snapBody.ok, true);
    const nodes = snapBody.nodes ?? [];
    assert.ok(nodes.some((n) => n.id === 'ltm:mem_owner'), '记忆卡条目要出现在快照里');
    assert.ok(nodes.some((n) => n.id === 'ltm:mem_event'));
    assert.ok(snapBody.keys.some((k) => k.key === 'private:123'), '会话键要带上');
    assert.equal(typeof snapBody.freezeBelow, 'number');
    assert.ok(Array.isArray(snapBody.regions) || typeof snapBody.regions === 'object');

    const curve = await call('GET', '/api/brain/decay-curve?unit=ltm:mem_event');
    assert.equal(curve.status, 200);
    const curveBody = JSON.parse(curve.body);
    assert.equal(curveBody.ok, true);
    assert.equal(curveBody.shape, 'clarity-ladder', '页面要据此说明这不是 FSRS');
    assert.equal(curveBody.points.length, 366, '一年 365 天 + 第 0 天');
    assert.equal(curveBody.D, null);

    const missing = await call('GET', `/api/brain/decay-curve?unit=${encodeURIComponent('ltm:mem_不存在')}`);
    assert.equal(missing.status, 404);
    assert.equal(JSON.parse(missing.body).code, 'brain.unit-missing');
  });
});

await test('回放：日期不合法回 400，合法日期即使什么都没发生也回 ok', async () => {
  await withConsole(async ({ call }) => {
    const bad = await call('GET', '/api/brain/replay?day=1999-01-01');
    assert.equal(bad.status, 400);
    assert.equal(JSON.parse(bad.body).code, 'brain.bad-day');
    const badFormat = await call('GET', '/api/brain/replay');
    assert.equal(badFormat.status, 400);

    const ok = await call('GET', `/api/brain/replay?day=${todayDay()}`);
    assert.equal(ok.status, 200);
    const body = JSON.parse(ok.body);
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.events));
    assert.ok(body.notes.some((n) => n.includes('聊天原文没有长期存档')), '已知限制要如实告诉页面');
  });
});

await test('探针：真跑一次检索，且 2 秒内第二次直接 429', async () => {
  await withConsole(async ({ call }) => {
    // 夹具的记忆目录是空的派生库：检索可能成功也可能报「档案缺失」，两种都算正常应答。
    const first = await call('POST', '/api/brain/probe', { body: { query: '雨天' } });
    assert.ok([200, 400].includes(first.status), `首次探针应该是 200 或 400，实际 ${first.status}`);
    const second = await call('POST', '/api/brain/probe', { body: { query: '雨天' } });
    assert.equal(second.status, 429);
    assert.equal(JSON.parse(second.body).code, 'brain.probe-throttled');
  });
});

await test('开关：写进 config.json 的 brain.enabled，读回来跟得上', async () => {
  await withConsole(async ({ call, h }) => {
    const before = JSON.parse((await call('GET', '/api/brain/control')).body);
    assert.equal(before.ok, true);
    assert.equal(before.enabled, true, '缺省是开着');
    assert.equal(before.clients, 0);

    const off = JSON.parse((await call('POST', '/api/brain/control', { body: { enabled: false } })).body);
    assert.equal(off.enabled, false);
    // 落盘是这份功能的可见凭据：用户重启桥接后开关要还在
    const onDisk = JSON.parse(fs.readFileSync(path.join(h.temp, 'config.json'), 'utf8'));
    assert.equal(onDisk.brain.enabled, false, '开关必须写进 config.json');
    assert.equal(JSON.parse((await call('GET', '/api/brain/control')).body).enabled, false);
    // 其它配置不能被顺手抹掉
    assert.ok(onDisk.ownerQQ !== undefined || onDisk.allow, '只合并 brain.enabled，别把整份配置覆盖掉');

    const on = JSON.parse((await call('POST', '/api/brain/control', { body: { enabled: true } })).body);
    assert.equal(on.enabled, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(h.temp, 'config.json'), 'utf8')).brain.enabled, true);
  });
});

await test('鉴权：星图面只给控制台，智能体调用一律挡在外面', async () => {
  await withConsole(async ({ call, h }) => {
    const noToken = await call('GET', '/api/brain/snapshot', { consoleToken: null });
    assert.notEqual(noToken.status, 200, '没有控制台令牌不能读快照');

    const agentNoToken = await call('GET', '/api/brain/snapshot', { agentCall: true, consoleToken: null });
    assert.ok([401, 403].includes(agentNoToken.status), `不带令牌的智能体调用必须被挡住，实际 ${agentNoToken.status}`);

    h.setMode('reserved2');
    const agentToken = h.getSocialV2State('private:123').agentToken;
    assert.ok(agentToken, '夹具里应该有一个活跃会话令牌');
    const agent = await call('GET', '/api/brain/snapshot', { agentCall: true, headers: { 'x-agent-token': agentToken } });
    assert.equal(agent.status, 403);
    assert.equal(JSON.parse(agent.body).code, 'CONSOLE_ONLY', '会话主体不该能读整张脑图');
    const writeViaAgent = await call('POST', '/api/brain/control', { body: { enabled: false }, agentCall: true, headers: { 'x-agent-token': agentToken } });
    assert.equal(writeViaAgent.status, 403, '更不能让会话主体自己关掉星图');
  });
});

// ── 实时流与事件挂点 ────────────────────────────────────────────────────────
await test('SSE：先给 hello，再按会话把 msg.in / msg.out 推下来', async () => {
  await withConsole(async ({ h, port }) => {
    h.setMode('reserved2');
    const stream = openStream(port, { key: 'private:123' });
    try {
      assert.ok(await waitFor(() => stream.text().includes('event: hello')), '连上就该收到 hello');
      assert.equal(stream.status, 200);
      assert.match(stream.headers['content-type'], /text\/event-stream/);
      assert.ok(stream.text().includes('retry: 3000'), '要告诉浏览器重连间隔');

      await h.handleIncoming('private', '123', privateEvent(123, '今天好累啊'), h.cfg);
      assert.ok(await waitFor(() => /"type":"msg\.in"/.test(stream.text())), '收到消息要在图上亮一下');
      assert.ok(stream.text().includes('今天好累啊'), '事件里带着正文摘要');

      await h.auditAndSend('private:123', '早点睡，明天再聊');
      assert.ok(await waitFor(() => /"type":"msg\.out"/.test(stream.text())), '真的发出去了才算说了话');
      assert.ok(stream.text().includes('早点睡，明天再聊'));

      // 会话过滤：别的会话的消息不该出现在这条私有流里
      const before = stream.text().length;
      await h.handleIncoming('group', '456', groupEvent(123, '群里的消息'), h.cfg);
      await sleep(300);
      assert.equal(stream.text().length, before, '过滤了别的会话，就不该多出字节');
    } finally {
      stream.close();
    }
  });
});

await test('SSE：关掉星图会立刻断开页面连接，不再假装还连着', async () => {
  await withConsole(async ({ h, port, call }) => {
    h.setMode('reserved2');
    const stream = openStream(port);
    try {
      assert.ok(await waitFor(() => stream.text().includes('event: hello')));
      const hello = JSON.parse(/event: hello\ndata: (\{.*?\})\n/.exec(stream.text())[1]);
      assert.equal(hello.enabled, true);

      await call('POST', '/api/brain/control', { body: { enabled: false } });
      assert.ok(await waitFor(() => stream.ended), '关掉之后连接要被断开，不能留着一条沉默的长连接');
    } finally {
      stream.close();
    }
  });
});

await test('SSE：连接数到上限（4）之后第 5 条回 429', async () => {
  await withConsole(async ({ h, port, call }) => {
    const streams = [1, 2, 3, 4].map(() => openStream(port));
    try {
      assert.ok(await waitFor(() => streams.every((s) => s.text().includes('event: hello'))));
      const fifth = await call('GET', '/api/brain/events');
      assert.equal(fifth.status, 429, '浏览器开太多标签页时要有明确拒绝，不是静默失败');
    } finally {
      for (const s of streams) s.close();
    }
  });
});

await test('挂点：被拒绝的会话与发失败的消息都不上图', async () => {
  await withConsole(async ({ h, port, call }) => {
    h.setMode('reserved2');
    const stream = openStream(port, { key: 'private:999' });
    try {
      assert.ok(await waitFor(() => stream.text().includes('event: hello')));
      // 999 不在 allow.private 里：消息会被闸门拦下，图上不该出现它
      await h.handleIncoming('private', '999', privateEvent(999, '陌生人'), h.cfg);
      await sleep(200);
      assert.equal(stream.text().includes('陌生人'), false, '被拒绝的会话连一个点都不该有');
    } finally {
      stream.close();
    }
    // 发送失败：把网关打成失败，msg.out 不该出现
    const stream2 = openStream(port, { key: 'private:123' });
    try {
      assert.ok(await waitFor(() => stream2.text().includes('event: hello')));
      // 桥接走的是注入的 bot（sendToQQ 里 bot.sendPrivateMessage），不是 api：弄错对象就是假绿
      h.bot.sendPrivateMessage = async () => { throw new Error('fixture: 网关挂了'); };
      await h.auditAndSend('private:123', '这条发不出去');
      await sleep(300);
      assert.equal(stream2.text().includes('这条发不出去'), false, '发失败不能假装说了话');
    } finally {
      stream2.close();
    }
  });
});

await test('记账：索引整库重建时的中间条数不会被报成「刚索引了 N 条」', async () => {
  // 真机踩到的：重启后第一拍读到正在重建的半个索引（2 条），第二拍读到 108 条，
  // 于是页面弹「刚索引了 106 条」——其实什么都没新增。基线的规矩是「连着两拍一样」。
  let total = 2;
  await withConsole(async ({ h, port }) => {
    const stream = openStream(port);
    try {
      assert.ok(await waitFor(() => stream.text().includes('event: hello')));
      h.brainTick();            // 第一拍：只有一个样本，还不能当基线
      h.brainTick();            // 第二拍：与上一拍一致，基线 = 2
      total = 0; h.brainTick(); // 重建中途：条数掉下去
      total = 108; h.brainTick();
      total = 108; h.brainTick(); // 重建完成后的第二拍：静默地把基线挪到 108
      await sleep(150);
      assert.equal(stream.text().includes('rag.index'), false, '重建不是「新增」，不该弹索引事件');

      total = 110; h.brainTick(); // 真新增两条
      assert.ok(await waitFor(() => stream.text().includes('rag.index')), '真变多要报出来');
      const line = stream.text().split('event: brain').find((s) => s.includes('rag.index'));
      // 页面的事件条读 data.added / data.total（见 public/brain.html 的 evSummary）
      assert.match(line, /"added":2/, '报的应该是「多了几条」，不是总数');
      assert.match(line, /"total":110/);
    } finally {
      stream.close();
    }
  }, { globals: { memoryIndexStats: () => ({ exists: true, total }) } });
});

if (failures) process.exitCode = 1;
console.log(failures ? `\n${failures} 项失败` : '\nbrain bridge tests OK');
