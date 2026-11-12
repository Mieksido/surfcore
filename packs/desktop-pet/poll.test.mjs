/**
 * 桌宠长轮询测试（假 transport + 假计时器，不联网、不真等待）
 * 跑法：node packs/desktop-pet/poll.test.mjs
 */
import { createPoller, DEFAULT_POLL } from './poll.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

/** 假计时器：记下回调，测试手动触发 */
function fakeTimers() {
  const timers = [];
  return {
    timers,
    setTimer(fn, ms) { const h = { fn, ms, cleared: false }; timers.push(h); return h; },
    clearTimer(h) { if (h) h.cleared = true; },
    async runNext() { const t = timers.find((x) => !x.cleared); if (!t) return false; t.cleared = true; await t.fn(); return true; },
  };
}

console.log('## 取回消息 → 交给 push');
{
  const got = [];
  const t = fakeTimers();
  let round = 0;
  const poller = createPoller({
    transport: { async fetch() { round += 1; return { items: [{ id: `m${round}`, actor: 'owner', text: `第${round}句`, at: round }], nextToken: `t${round}` }; } },
    onBatch: (items) => got.push(...items),
    onLog: () => {}, setTimer: t.setTimer, clearTimer: t.clearTimer, intervalMs: 100,
  });

  poller.start();
  ok(poller.status().running === true, '启动后：运行中');
  await t.runNext();
  ok(got.length === 1 && got[0].text === '第1句', '第一轮：取到一条并交出去');
  ok(poller.status().token === 't1', '游标被记住（下次从这儿取）');

  await t.runNext();
  ok(got.length === 2 && got[1].text === '第2句', '第二轮：继续取');
  ok(poller.status().delivered === 2, '统计：已投递 2 条');
  poller.stop();
  ok(poller.status().running === false, '停止后：不在运行');
}

console.log('\n## 去重（对方可能重发）');
{
  const got = [];
  const t = fakeTimers();
  const poller = createPoller({
    transport: { async fetch() { return { items: [{ id: 'same', actor: 'u', text: '同一句' }] }; } },
    onBatch: (items) => got.push(...items),
    onLog: () => {}, setTimer: t.setTimer, clearTimer: t.clearTimer,
  });
  poller.start();
  await t.runNext(); await t.runNext(); await t.runNext();
  ok(got.length === 1, '同一条消息：只交出去一次');
  poller.stop();
}

console.log('\n## 失败退避，不抛不崩');
{
  const logs = [];
  const t = fakeTimers();
  let fail = true;
  const poller = createPoller({
    transport: { async fetch() { if (fail) throw new Error('连不上桌宠'); return { items: [] }; } },
    onBatch: () => {},
    onLog: (lv, msg) => logs.push(`${lv}:${msg}`),
    setTimer: t.setTimer, clearTimer: t.clearTimer, intervalMs: 100, backoffMs: 200, maxBackoffMs: 500,
  });
  poller.start();
  await t.runNext();
  ok(poller.status().errors === 1, '失败一次：记下来');
  ok(logs.some((l) => l.includes('连不上桌宠')), '失败原因写日志');
  const nextDelay = t.timers[t.timers.length - 1].ms;
  ok(nextDelay >= 200, `退避：${nextDelay}ms 后再试`);

  fail = false;
  await t.runNext();
  ok(poller.status().errors === 0, '恢复后：错误计数清零');
  ok(poller.status().delayMs === 100, '恢复后：回到正常间隔');
  poller.stop();
}

console.log('\n## onBatch 抛错不影响轮询');
{
  const t = fakeTimers();
  const poller = createPoller({
    transport: { async fetch() { return { items: [{ id: 'x' }] }; } },
    onBatch: () => { throw new Error('处理炸了'); },
    onLog: () => {}, setTimer: t.setTimer, clearTimer: t.clearTimer,
  });
  poller.start();
  await t.runNext();
  ok(poller.status().running === true, '处理出错：轮询继续（不倒）');
  poller.stop();
}

console.log('\n## 边界');
{
  let threw = false;
  try { createPoller({}); } catch { threw = true; }
  ok(threw, '没有 transport：直接报错');
  ok(DEFAULT_POLL.intervalMs === 2000, '默认 2 秒一次');
  const t = fakeTimers();
  const p = createPoller({ transport: { async fetch() { return {}; } }, setTimer: t.setTimer, clearTimer: t.clearTimer, onLog: () => {} });
  p.start();
  await t.runNext();
  ok(p.status().polls === 1, '空返回：也算一次轮询，不炸');
  p.stop();
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
