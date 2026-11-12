/**
 * 内核运行时生命周期测试（不启进程，不联网）
 * 跑法：node kernel/runtime.test.mjs
 */
import { createKernelRuntime } from './runtime.js';

let pass = 0; let fail = 0;
const ok = (c, n) => { if (c) { pass += 1; console.log('  ✅', n); } else { fail += 1; console.error('  ❌', n); } };

let timers = [];
let cleared = [];
let clock = 1000;
const calls = [];
const kernel = {
  memory: {
    mode: 'vector',
    vectorStatus: () => ({ records: 2, indexed: 1, pending: 1, failed: 0, modelSpace: 'm1', spaces: {} }),
  },
  tick: () => { calls.push('tick'); return { decayed: false, forgotten: 0 }; },
  save: () => { calls.push('save'); return { ok: true }; },
  flushVectors: async () => { calls.push('flushVectors'); return { ok: true, encoded: 1, failed: 0 }; },
  snapshot: () => ({ records: 2 }),
};
const system = {
  start: async (opts) => { calls.push('start'); return [{ id: 'p', ok: true }]; },
  flush: async () => { calls.push('system.flush'); },
  stop: async () => { calls.push('system.stop'); },
};
const rt = createKernelRuntime({
  kernel, system,
  tickMs: 1000, vectorEveryMs: 2000, saveEveryMs: 500,
  now: () => clock,
  setTimer: (fn, ms) => { const h = { fn, ms, unref: () => {} }; timers.push(h); return h; },
  clearTimer: (h) => { cleared.push(h); },
});

console.log('## 启动');
{
  const out = await rt.start({ emit: () => {}, log: () => {} });
  ok(out.started === true && out.packs[0].id === 'p', 'start 调 system.start 并返回包');
  ok(rt.started === true, '状态 started');
  ok(timers.length === 2, '两个定时器：tick + vector');
  ok(timers[0].ms === 1000 && timers[1].ms === 2000, '间隔正确');
  const again = await rt.start();
  ok(again.started === false && again.reason === 'already-started', '重复 start 拒绝');
}

console.log('\n## tick / 保存 / 编码');
{
  calls.length = 0;
  clock += 600;
  await timers[0].fn();
  ok(calls.includes('tick'), 'tick 被调用');
  ok(calls.includes('save'), '超过保存间隔会 save');
  calls.length = 0;
  await timers[1].fn();
  ok(calls.includes('flushVectors'), 'vector 定时器会编码');
  const st = rt.status();
  ok(st.started && st.mode === 'vector' && st.records === 2, 'status 暴露运行状态');
}

console.log('\n## 停止');
{
  calls.length = 0;
  const out = await rt.stop();
  ok(out.stopped === true && out.errors.length === 0, 'stop 成功');
  ok(calls.join(',') === 'system.flush,system.stop,save', '停止顺序：flush → stop → save');
  ok(cleared.length === 2, '两个定时器都清掉');
  ok(rt.started === false, '状态 stopped');
  const again = await rt.stop();
  ok(again.stopped === false, '重复 stop 不重复执行');
}

console.log('\n## 停止失败也保存');
{
  const errSystem = {
    start: async () => [],
    flush: async () => { throw new Error('flush boom'); },
    stop: async () => { throw new Error('stop boom'); },
  };
  const errKernel = { memory: { mode: 'narrative' }, tick: () => ({}), save: () => { saved += 1; }, flushVectors: async () => ({}) };
  let saved = 0;
  const rt2 = createKernelRuntime({ kernel: errKernel, system: errSystem, tickMs: 0, vectorEveryMs: 0 });
  await rt2.start();
  const out = await rt2.stop();
  ok(out.errors.length === 2 && saved === 1, 'flush/stop 失败仍 save，并列出错误');
}

console.log('\n## 编码在飞时不叠加；停机等它落地');
{
  let resolveFlush;
  let flushCalls = 0;
  let saved = 0;
  const slowKernel = {
    memory: { mode: 'vector' },
    tick: () => ({}),
    save: () => { saved += 1; },
    flushVectors: () => {
      flushCalls += 1;
      return new Promise((resolve) => { resolveFlush = resolve; });
    },
  };
  const quietSystem = { start: async () => [], flush: async () => {}, stop: async () => {} };
  const rt3 = createKernelRuntime({ kernel: slowKernel, system: quietSystem, tickMs: 0, vectorEveryMs: 0 });
  await rt3.start();
  const a = rt3.flushVectors();
  const b = rt3.flushVectors();
  void a; void b;
  ok(flushCalls === 1, '没有并发第二次编码');
  const stopping = rt3.stop();
  await Promise.resolve();
  ok(saved === 0, '停机先等编码，不抢跑 save');
  resolveFlush({ ok: true, encoded: 1, failed: 0 });
  const out = await stopping;
  ok(out.stopped === true && saved === 1, '编码落地后再 save');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
