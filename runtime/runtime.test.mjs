/**
 * 大适配器（运行时）测试：契约词段的槽位校验 + 三管管道
 * 跑法：node runtime/runtime.test.mjs
 */
import { createAdapter, validatePack, CAPABILITY_AXES } from './index.js';

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✅', name); }
  else { fail++; console.error('  ❌', name); }
}

/** 一个最小的合法平台包 */
function makePack(over = {}) {
  return {
    identity: { publisher: 'acme', name: 'fake', version: '1.0.0', source: 'fake', channel: 'fake:1' },
    capabilities: {
      timing: 'realtime', shape: 'single', identityMode: 'known',
      direction: 'both', frequency: 'human', modality: 'text',
      special: { recall: false, edit: false, readReceipt: false },
    },
    send: async (intent) => ({ status: 'delivered' }),
    ...over,
  };
}

console.log('## 契约词段的槽位校验（fail-closed）');

ok(validatePack(makePack()).ok, '合法平台包：通过');
ok(!validatePack({}).ok, '空对象：拒绝');
ok(!validatePack(makePack({ send: undefined })).errors.join().includes('缺') === false, '缺 send：报错');
ok(validatePack(makePack({ send: undefined })).errors.some((e) => e.includes('send')), '缺 send：错误里点名 send');
ok(validatePack(makePack({ capabilities: {} })).errors.some((e) => e.includes('timing')), '缺能力轴：点名是哪一条');
ok(validatePack(makePack({ identity: { publisher: 'x' } })).errors.some((e) => e.includes('name')), '缺身份字段：点名是哪一条');
{
  let threw = false;
  try { createAdapter(makePack({ send: undefined })); } catch { threw = true; }
  ok(threw, '不合规的平台包：装配时直接抛，不带病运行');
}

console.log('\n## 三管管道：下行 + 回执');

{
  const called = [];
  const adapter = createAdapter(makePack({ send: async (intent) => { called.push(intent); return { status: 'delivered' }; } }));
  const ack = await adapter.pipes.deliver({ id: 'a1', kind: 'say', text: 'hi' });
  ok(ack.status === 'delivered', '正常意图：回执 delivered');
  ok(ack.intentId === 'a1' && typeof ack.at === 'number', '回执被自动补齐 intentId 与时间');
  ok(called.length === 1, '平台包的 send 被调用了一次');
}
{
  const adapter = createAdapter(makePack());
  const first = await adapter.pipes.deliver({ id: 'dup', kind: 'say' });
  const second = await adapter.pipes.deliver({ id: 'dup', kind: 'say' });
  ok(first.status === 'delivered' && second.duplicate === true, '幂等：同编号第二次只回执（管道负责，平台包不用管）');
}
{
  const adapter = createAdapter(makePack());
  const ack = await adapter.pipes.deliver({ id: 'm1', kind: 'send_media', media: [{ id: 'x' }] });
  ok(ack.status === 'unsupported', '能力门：纯文本渠道收到发媒体 → unsupported');
  ok(ack.error?.code === 'adapter.unsupported-capability', '能力门：带结构化错误码');
}
{
  const adapter = createAdapter(makePack({ send: async () => { throw new Error('网断了'); } }));
  const ack = await adapter.pipes.deliver({ id: 'e1', kind: 'say' });
  ok(ack.status === 'failed', '平台包抛异常：被包成 failed，不冒泡');
  ok(ack.error?.code === 'adapter.send-failed' && ack.error.retryable === true, '失败：带错误码与可重试标记');
}
{
  const adapter = createAdapter(makePack({ send: async () => ({ status: '瞎写的状态' }) }));
  const ack = await adapter.pipes.deliver({ id: 'x1', kind: 'say' });
  ok(ack.status === 'delivered', '平台包给了非法状态：管道兜底成 delivered（不制造假状态）');
}

console.log('\n## 三管管道：上行盖章');

{
  const events = [];
  const adapter = createAdapter(makePack(), { onEvent: (e) => events.push(e) });
  const emitted = [];
  await adapter.lifecycle.start({ emit: (e) => emitted.push(e), log: () => {} });
  // 平台包自己报事时，故意自称是别人
  adapter.capabilities; // 仅为可读性
  const ctx = { emit: (e) => events.push(e) };
  // 通过生命周期的 ctx 报一条：来源戳必须被改写成 acme@fake
  const innerCtx = { emit: (e) => {}, log: () => {} };
  const realAdapter = createAdapter(makePack(), { onEvent: (e) => events.push(e) });
  // 用 open 拿到真实 ctx
  const packWithOpen = makePack({ open: async (c) => c.emit({ from: { adapter: '冒充者' }, text: 'hi' }) });
  await createAdapter(packWithOpen, { onEvent: (e) => events.push(e) }).lifecycle.start(innerCtx);
  ok(events.length === 1, '上行：事件被管道接住');
  ok(events[0].from.adapter === 'acme@fake', '上行：来源戳由大适配器盖章，冒充无效');
  ok(events[0].from.channel === 'fake:1', '上行：频道被补齐');
  ok(typeof events[0].from.at === 'number', '上行：时间被补齐');
}

console.log('\n## 生命周期代理');

{
  let opened = false, closed = false;
  const adapter = createAdapter(makePack({ open: async () => { opened = true; }, close: async () => { closed = true; } }));
  await adapter.lifecycle.start({});
  ok(opened, '上班：代理到平台包的 open');
  ok((await adapter.lifecycle.heartbeat()).status === 'ok', '报平安：没写 health 时给默认 ok');
  await adapter.lifecycle.stop();
  ok(closed, '下班：代理到平台包的 close');
  ok((await adapter.lifecycle.heartbeat()).status === 'down', '下班之后：报平安返回 down');
  ok(adapter.settings.length === 0, '菜单：没写就是空清单');
  ok(CAPABILITY_AXES.length === 6, '六条能力轴：常量完整');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
