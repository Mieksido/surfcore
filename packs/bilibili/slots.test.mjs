/**
 * B站 分享槽位测试（纯计算，不联网、不碰 timer）
 * 跑法：node packs/bilibili/slots.test.mjs
 */
import {
  DEFAULT_SHARE_TIMES, SHARE_CATCH_UP_MS,
  normalizeShareTimes, nextShareSlot, lastShareSlot, shareSlotKey,
  pruneShareSlots, dueShareSlot, planShareSchedule,
} from './slots.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };
const at = (s) => Date.parse(s);

console.log('## 时间点归一');
{
  const list = normalizeShareTimes(['23:00', '7:00', '07:00', '25:90', '坏值', ' 9：05 ']);
  ok(list[0] === '07:00', '个位数小时补零 07:00');
  ok(list.includes('09:05'), '中文冒号/空格也能认，补零 09:05');
  ok(new Set(list).size === list.length, '重复的点只留一个');
  ok(list[0] <= list[1] && list[1] <= list[2], '升序');
  ok(normalizeShareTimes(['25:90'])[0] === '23:59', '越界夹到 23:59（不丢）');
  ok(normalizeShareTimes([]).length === 0, '空表就是空表（调用方决定回退默认）');
  ok(DEFAULT_SHARE_TIMES.length === 8, '默认 8 个点');
}

console.log('\n## 下一个 / 上一个槽位');
{
  const now = at('2026-11-10T20:00:00');
  const next = nextShareSlot({ now, times: DEFAULT_SHARE_TIMES });
  ok(next.label === '21:00' && next.at === at('2026-11-10T21:00:00'), '20:00 → 今天 21:00');
  ok(next.key === '2026-11-10 21:00', '槽位键带日期（同一点第二天算新槽）');

  const late = nextShareSlot({ now: at('2026-11-10T23:30:00'), times: DEFAULT_SHARE_TIMES });
  ok(late.label === '07:00' && late.at === at('2026-11-11T07:00:00'), '23:30 → 明天 07:00');

  const last = lastShareSlot({ now: at('2026-11-10T20:00:00'), times: DEFAULT_SHARE_TIMES });
  ok(last.label === '19:00', '20:00 的"上一个点"是 19:00');
  ok(lastShareSlot({ now: at('2026-11-10T06:00:00'), times: DEFAULT_SHARE_TIMES }) === null, '06:00 之前没有"上一个点"');
  ok(shareSlotKey(at('2026-11-10T19:00:00'), '19:00') === '2026-11-10 19:00', '键 = 本地日期 + 时间点');
}

console.log('\n## 该不该跑（去重 + 10 分钟补跑）');
{
  const times = DEFAULT_SHARE_TIMES;
  const exactly = dueShareSlot({ now: at('2026-11-10T21:00:00'), times });
  ok(exactly.due && exactly.slot.label === '21:00', '正好 21:00：该跑');

  const fiveMin = dueShareSlot({ now: at('2026-11-10T21:05:00'), times });
  ok(fiveMin.due, '过了 5 分钟：仍在补跑窗口内');

  const tooLate = dueShareSlot({ now: at('2026-11-10T21:11:00'), times });
  ok(!tooLate.due && tooLate.reason === 'missed-window', '过了 11 分钟：错过就错过（不半夜补）');

  const used = dueShareSlot({ now: at('2026-11-10T21:05:00'), times, state: { lastSlots: { '2026-11-10 21:00': '2026-11-10T13:00:05.000Z' } } });
  ok(!used.due && used.reason === 'already-used', '这个点跑过了：不重复');

  const before = dueShareSlot({ now: at('2026-11-10T06:30:00'), times });
  ok(!before.due && before.reason === 'before-first-slot', '第一个点之前：不跑');

  const wide = dueShareSlot({ now: at('2026-11-10T21:30:00'), times, catchUpMs: 60 * 60 * 1000 });
  ok(wide.due, '补跑窗口可调（60 分钟时 21:30 还算）');
  ok(SHARE_CATCH_UP_MS === 600000, '默认补跑窗口 10 分钟');
}

console.log('\n## 状态清理与一次算完');
{
  const old = '2026-10-01T00:00:00.000Z';
  const fresh = '2026-11-09T13:00:00.000Z';
  const pruned = pruneShareSlots({ lastSlots: { old: old, fresh } }, { now: at('2026-11-10T20:00:00') });
  ok(!pruned.lastSlots.old, '30 天前的槽位清掉');
  ok(pruned.lastSlots.fresh === fresh, '30 天内的保留');

  const plan = planShareSchedule({
    now: at('2026-11-10T21:05:00'),
    times: DEFAULT_SHARE_TIMES,
    state: { lastSlots: { old: old } },
  });
  ok(plan.due === true, '计划：该跑');
  ok(plan.next.label === '23:00', '计划里带下一个点（23:00）');
  ok(Object.keys(plan.state.lastSlots).length === 0, '计划顺手清过期状态');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
