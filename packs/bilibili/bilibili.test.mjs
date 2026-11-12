/**
 * B站 包内部逻辑测试（不联网）
 * 跑法：node packs/bilibili/bilibili.test.mjs
 */
import { createQuota, planNight, pickVideos, QUOTA_KINDS } from './logic.js';
import { plan } from './index.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

// 2026-11-09 21:00（在 20:00-23:00 窗口里）
const NIGHT = Date.parse('2026-11-09T21:00:00');
const NOON = Date.parse('2026-11-09T12:00:00');
const at = (s) => Date.parse(s);

console.log('## 四本额度账');
{
  const q = createQuota({ limits: { share: 1, comment: 3 }, now: () => NOON });
  ok(QUOTA_KINDS.length === 4, '四本账：分享/评论/私信/弹幕');
  ok(q.canDo('comment').ok, '评论还有额度');
  q.commit('comment'); q.commit('comment');
  ok(q.canDo('comment').ok, '用了 2 条还有 1 条');
  q.commit('comment');
  const no = q.canDo('comment');
  ok(!no.ok && no.reason === 'exceeded', '第 4 条：超了');
  ok(String(no.hint).includes('明天'), '超了要给下一步（明天再来）');
  ok(!q.canDo('share').ok === false, '分享还有 1 次');
  q.commit('share');
  ok(!q.canDo('share').ok, '分享用完');
  ok(!q.canDo('dm').ok, '没配额度：直接拒绝（不默认放行）');
}

console.log('\n## 生物钟');
{
  const windows = [{ start: '20:00', end: '23:00', videosPerWake: 2 }];
  const r1 = planNight({ windows, now: () => NIGHT, countToday: 0, skipProbability: 0, rng: () => 0.9 });
  ok(r1.wake === true && r1.videosPerWake === 2, '在窗口内：醒，且带"看几个"');

  const r2 = planNight({ windows, now: () => NOON, skipProbability: 0, rng: () => 0.9 });
  ok(r2.wake === false && r2.reason === 'not-in-window', '不在窗口：不醒');

  const r3 = planNight({ windows, now: () => NIGHT, countToday: 3, maxPerDay: 3 });
  ok(r3.wake === false && r3.reason === 'daily-cap', '今天醒够了：不醒');

  const r4 = planNight({ windows, now: () => NIGHT, skipProbability: 0.5, rng: () => 0.1 });
  ok(r4.wake === false && r4.reason === 'skip-random', '随机跳过（免得像定时机器人）');
  ok(String(r4.hint).includes('随机'), '跳过要说清原因');
}

console.log('\n## 选片');
{
  const candidates = [
    { id: 'a', title: '看过的', tags: ['vtuber'], heat: 9000 },
    { id: 'b', title: '没看过+偏好命中', tags: ['vtuber', '音乐'], heat: 100 },
    { id: 'c', title: '没看过+无偏好', tags: [], heat: 500 },
  ];
  const picked = pickVideos({ candidates, seenIds: ['a'], prefs: ['vtuber', '音乐'], limit: 2 });
  ok(picked.length === 2, '按上限取两个');
  ok(picked[0].id === 'b', '偏好命中且没看过的排第一（不是按热度）');
  ok(!picked.some((p) => p.id === 'a'), '看过的不选');
  ok(picked.every((p) => typeof p._score === 'number'), '带打分明细（便于排查为什么选它）');

  ok(pickVideos({ candidates: [], limit: 1 }).length === 0, '没有候选：返回空');
  ok(pickVideos({ candidates, limit: 0 }).length === 0, '上限 0：一个都不选');
}

console.log('\n## 平台包的 plan()：把生物钟 + 选片 + 额度合成一次计划');
{
  const candidates = [{ id: 'v1', title: '新片', tags: [], heat: 100 }, { id: 'v2', title: '老片', tags: [], heat: 900 }];
  const p1 = plan({ candidates, seenIds: ['v2'], countToday: 0, skipProbability: 0, now: NIGHT });
  ok(p1.wake === true, '窗口内 + 有候选 + 有额度：该醒');
  ok(p1.videos.length === 2 && p1.videos[0].id === 'v1', '挑出没看过的（看过的排后面/被排除）');
  ok(p1.quota.share.ok === true, '计划里带额度检查结果');

  const noon = plan({ candidates, countToday: 0, skipProbability: 0, now: NOON });
  ok(noon.wake === false && noon.reason === 'not-in-window', '不在窗口：不醒（并说清原因）');

  const empty = plan({ candidates: [], countToday: 0, skipProbability: 0, now: NIGHT });
  ok(empty.wake === false && empty.reason === 'nothing-to-watch', '没有可选内容：不醒，并指路去扩充候选池');
}

console.log('\n## 分享槽位接进 plan()：固定点才醒，错过不追');
{
  const candidates = [{ id: 'v1', title: '新片', tags: [], heat: 100 }];
  const shareTimes = ['07:00', '21:00', '23:00'];
  const night = at('2026-11-09T21:05:00');

  const due = plan({ candidates, countToday: 0, skipProbability: 0, now: night, shareTimes, slotState: {} });
  ok(due.wake === true && due.slot?.label === '21:00', '21:05 在补跑窗口内：醒，并说明是哪个槽');
  ok(due.slot.key === '2026-11-09 21:00', '计划里带槽位键（调用方投递成功后写状态）');

  const used = plan({
    candidates, countToday: 0, skipProbability: 0, now: night, shareTimes,
    slotState: { lastSlots: { '2026-11-09 21:00': '2026-11-09T13:00:00.000Z' } },
  });
  ok(used.wake === false && used.reason === 'already-used', '这个点跑过：不醒');
  ok(String(used.hint).includes('下一个点'), '不醒也要给下一步');
  ok(Boolean(used.nextAt), '带下一个点的时间');

  const missed = plan({ candidates, countToday: 0, skipProbability: 0, now: at('2026-11-09T21:20:00'), shareTimes });
  ok(missed.wake === false && missed.reason === 'missed-window', '过了 10 分钟：这一场就不追了');

  const noSlot = plan({ candidates, countToday: 0, skipProbability: 0, now: at('2026-11-09T08:00:00'), shareTimes });
  ok(noSlot.wake === false && noSlot.reason === 'missed-window', '07:00 的点在 08:00 已过期：不补');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
