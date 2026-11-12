/**
 * B站 轮询测试（假 fetchList + 假计时器，不联网）
 * 跑法：node packs/bilibili/poller.test.mjs
 */
import { createBiliPoller, DEFAULT_BILI_POLL } from './poller.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

function fakeTimers() {
  const timers = [];
  return {
    timers,
    setTimer(fn, ms) { const h = { fn, ms, cleared: false }; timers.push(h); return h; },
    clearTimer(h) { if (h) h.cleared = true; },
    async runNext() { const t = timers.find((x) => !x.cleared); if (!t) return false; t.cleared = true; await t.fn(); return true; },
  };
}

console.log('## 拉取 → 事件');
{
  const got = [];
  const t = fakeTimers();
  const poller = createBiliPoller({
    fetchList: async () => [{ bvid: 'BV1', title: '第一个视频' }, { bvid: 'BV2', title: '第二个视频' }],
    emit: async (ev) => got.push(ev),
    setTimer: t.setTimer, clearTimer: t.clearTimer, onLog: () => {},
  });
  poller.start();
  await t.runNext();
  ok(got.length === 2, '两条内容 → 两个事件');
  ok(got[0].from.adapter === 'bilibili', '来源是 bilibili（包的事，内核不知道）');
  ok(got[0].tags.includes('bvid:BV1'), '带 bvid 标签');
  ok(poller.status().emitted === 2, '统计：已发 2 条');
  poller.stop();
}

console.log('\n## 去重：旧内容不再发');
{
  const got = [];
  const t = fakeTimers();
  let round = 0;
  const poller = createBiliPoller({
    fetchList: async () => (round++ === 0 ? [{ bvid: 'A', title: '甲' }] : [{ bvid: 'A', title: '甲' }, { bvid: 'B', title: '乙' }]),
    emit: async (ev) => got.push(ev),
    setTimer: t.setTimer, clearTimer: t.clearTimer, onLog: () => {},
  });
  poller.start();
  await t.runNext();   // 第一轮：A
  await t.runNext();   // 第二轮：A 已见过，只剩 B
  ok(got.length === 2, '两轮只发 2 条（A 没重复）');
  ok(got[1].tags.includes('bvid:B') || got[1].tags.includes('bvid:A'), '第二条是新的那条');
  ok(poller.status().seen === 2, '记下 2 个已见');
  poller.stop();
}

console.log('\n## 一次上限：首次拉取不刷屏');
{
  const got = [];
  const t = fakeTimers();
  const many = Array.from({ length: 10 }, (_, i) => ({ bvid: `B${i}`, title: `视频${i}` }));
  const poller = createBiliPoller({
    fetchList: async () => many,
    emit: async (ev) => got.push(ev),
    maxPerTick: 2, setTimer: t.setTimer, clearTimer: t.clearTimer, onLog: () => {},
  });
  poller.start();
  await t.runNext();
  ok(got.length === 2, '一次最多 2 条');
  await t.runNext();
  ok(got.length === 4, '下一轮再拿 2 条（不丢，慢慢来）');
  poller.stop();
}

console.log('\n## 失败退避，不抛不崩');
{
  const logs = [];
  const t = fakeTimers();
  let boom = true;
  const poller = createBiliPoller({
    fetchList: async () => { if (boom) throw new Error('接口 412'); return []; },
    emit: async () => {},
    setTimer: t.setTimer, clearTimer: t.clearTimer,
    onLog: (lv, m) => logs.push(`${lv}:${m}`),
    intervalMs: 1000, backoffMs: 2000, maxBackoffMs: 8000,
  });
  poller.start();
  await t.runNext();
  ok(poller.status().errors === 1, '失败记数');
  ok(logs.some((l) => l.includes('412')), '原因进日志');
  ok(t.timers[t.timers.length - 1].ms >= 2000, '退避生效');

  boom = false;
  await t.runNext();
  ok(poller.status().errors === 0 && poller.status().delayMs === 1000, '恢复后回到正常间隔');
  poller.stop();
}

console.log('\n## 事件送不出去：不中断轮询');
{
  const t = fakeTimers();
  const poller = createBiliPoller({
    fetchList: async () => [{ bvid: 'X', title: '一' }],
    emit: async () => { throw new Error('下游拒绝'); },
    setTimer: t.setTimer, clearTimer: t.clearTimer, onLog: () => {},
  });
  poller.start();
  await t.runNext();
  ok(poller.status().running === true, '轮询继续');
  ok(poller.status().emitted === 0, '没算成已发');
  poller.stop();
}

console.log('\n## 边界');
{
  let threw = false;
  try { createBiliPoller({ emit: async () => {} }); } catch { threw = true; }
  ok(threw, '没有 fetchList：直接报错');
  let threw2 = false;
  try { createBiliPoller({ fetchList: async () => [] }); } catch { threw2 = true; }
  ok(threw2, '没有 emit：直接报错');
  ok(DEFAULT_BILI_POLL.intervalMs === 10 * 60 * 1000, '默认 10 分钟');
  const t = fakeTimers();
  const p = createBiliPoller({ fetchList: async () => [], emit: async () => {}, setTimer: t.setTimer, clearTimer: t.clearTimer, onLog: () => {} });
  p.start();
  await t.runNext();
  ok(p.status().polls === 1, '空列表：也算一次轮询');
  p.stop();
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
