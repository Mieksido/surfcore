/**
 * 组装层测试：内核 + 包 + 管道 接起来（全离线，不需要任何平台）
 * 跑法：node app/compose.test.mjs
 */
import { composeSystem } from './compose.js';
import { createBatcher } from '../kernel/attention/batch.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

/** 假包：open 时自己上报一条事件；send 把意图记下来 */
function makePack({ name = 'demo', emitOnOpen = true, sendResult = { status: 'delivered' } } = {}) {
  const sent = [];
  const pack = {
    identity: { publisher: 'acme', name, version: '1.0.0', source: name, channel: `${name}:1` },
    capabilities: {
      timing: 'realtime', shape: 'single', identityMode: 'known',
      direction: 'both', frequency: 'human', modality: 'text',
      special: { recall: false, edit: false, readReceipt: false },
    },
    settings: [{ key: 'k', label: 'K', defaultValue: 1, options: [1, 2], cost: '代价', group: 'basic' }],
    async open(ctx) {
      if (emitOnOpen) {
        ctx.emit({
          from: { channel: `${name}:1`, kind: 'private', actor: 'owner', at: 1000 },
          text: '你好', source: 'user', to: { owner: true },
        });
      }
    },
    async send(intent) { sent.push(intent); return sendResult; },
    async health() { return { status: 'ok' }; },
    _sent: sent,
  };
  return pack;
}

function makeKernel({ wake = true, intents = [{ kind: 'say', text: '嗨' }] } = {}) {
  const calls = [];
  return {
    calls,
    async respond(event, viewer) {
      calls.push({ event, viewer });
      return wake ? { wake: true, intents: intents.map((i) => ({ ...i })), memoryBlock: { text: 'm' } } : { wake: false, intents: [] };
    },
    snapshot: () => ({ records: 3, mode: 'narrative' }),
  };
}

console.log('## 接线：事件 → 内核 → 意图 → 包');
{
  const kernel = makeKernel();
  const pack = makePack();
  const sys = composeSystem({ makeBatcher: createBatcher, kernel, packs: [{ id: 'acme/demo', pack }] });

  ok(sys.adapters.length === 1, '一个包 → 一个适配器');
  const started = await sys.start({ log: () => {} });
  ok(started[0].ok, '启动成功');

  // open 里 emit 是同步触发的，等一轮微任务让 async 回合跑完
  await new Promise((r) => setTimeout(r, 10));

  ok(kernel.calls.length === 1, '内核被调用了一次');
  ok(kernel.calls[0].viewer.kind === 'private', '查询者类型推对了（私聊）');
  ok(kernel.calls[0].viewer.isOwner === true, '查询者是不是主人：推对了');
  ok(pack._sent.length === 1, '意图被送到包里');
  ok(pack._sent[0].text === '嗨', '送的是内核给的意图');
  ok(pack._sent[0].channel === 'demo:1', '意图带上了目标频道（包据此决定发哪）');
  ok(typeof pack._sent[0].id === 'string' && pack._sent[0].id.length > 0, '意图有唯一编号（幂等靠它）');
}

console.log('\n## 不醒的时候什么都不发');
{
  const kernel = makeKernel({ wake: false });
  const pack = makePack();
  const sys = composeSystem({ makeBatcher: createBatcher, kernel, packs: [{ id: 'acme/demo', pack }] });
  await sys.start({ log: () => {} });
  await new Promise((r) => setTimeout(r, 10));
  ok(kernel.calls.length === 1, '内核还是被调用了（入库发生在内核里）');
  ok(pack._sent.length === 0, '不醒 → 一个意图都不发');
}

console.log('\n## 幂等：同一意图不会被发两次');
{
  const kernel = makeKernel({ intents: [{ kind: 'say', text: '一次' }] });
  const pack = makePack();
  const sys = composeSystem({ makeBatcher: createBatcher, kernel, packs: [{ id: 'acme/demo', pack }] });
  await sys.start({ log: () => {} });
  await new Promise((r) => setTimeout(r, 10));

  // 手动用同一个编号再投一次（模拟重放）
  const { adapter } = sys.adapters[0];
  const first = pack._sent[0];
  const again = await adapter.pipes.deliver({ ...first });
  ok(again.duplicate === true, '同编号重放：被幂等表挡住');
  ok(pack._sent.length === 1, '包没有收到第二次');
}

console.log('\n## 失败隔离：一个包起不来，不影响其它');
{
  const kernel = makeKernel();
  const good = makePack({ name: 'good' });
  const bad = makePack({ name: 'bad' });
  bad.open = async () => { throw new Error('连不上'); };

  const sys = composeSystem({ makeBatcher: createBatcher, kernel, packs: [{ id: 'acme/good', pack: good }, { id: 'acme/bad', pack: bad }] });
  const res = await sys.start({ log: () => {} });
  ok(res[0].ok === true, '好包：启动成功');
  ok(res[1].ok === false, '坏包：启动失败被记录');
  ok(String(res[1].error).includes('连不上'), '失败原因带出来（不吞）');
  await new Promise((r) => setTimeout(r, 10));
  ok(good._sent.length === 1, '好包照常工作（失败被隔离）');
}

console.log('\n## 状态与停机');
{
  const kernel = makeKernel();
  const a = makePack({ name: 'a', emitOnOpen: false });
  const b = makePack({ name: 'b', emitOnOpen: false });
  const order = [];
  a.open = async () => { order.push('a-open'); };
  b.open = async () => { order.push('b-open'); };
  a.close = async () => { order.push('a-close'); };
  b.close = async () => { order.push('b-close'); };

  const sys = composeSystem({ makeBatcher: createBatcher, kernel, packs: [{ id: 'acme/a', pack: a }, { id: 'acme/b', pack: b }] });
  await sys.start({});
  ok(order.join(',') === 'a-open,b-open', '启动是顺序的（按声明顺序）');

  const st = await sys.status();
  ok(st.kernel.records === 3, '状态里带内核快照');
  ok(st.packs.length === 2, '状态里带每个包');
  ok(st.packs[0].adapter === 'acme@a@1.0.0', '状态里带发布人@名字@版本');
  ok(st.packs[0].health.status === 'ok', '状态里带健康');

  await sys.stop();
  ok(order.join(',') === 'a-open,b-open,b-close,a-close', '停机是倒序的（后来先关）');
}

console.log('\n## 组装要求');
{
  let threw = false;
  try { composeSystem({ makeBatcher: createBatcher, packs: [] }); } catch { threw = true; }
  ok(threw, '没有内核：直接报错（不带病组装）');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
