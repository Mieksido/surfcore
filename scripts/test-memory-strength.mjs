// 记忆强度分（src/memory-strength.js）的离线单测。
//
// 这个文件要钉住的是**模型的性质**，不是具体数字：
//   · R(t = S) 必须正好是 0.9（FSRS 曲线的定义性质，也是这条曲线号称「FSRS 形状」的全部依据）；
//   · R 随天数单调下降、随 S 单调上升；
//   · 复习把 S 拉长、遗忘把 S 打短，但都有上下限，不许算成 0 或无穷；
//   · 重放次序是「先遗忘、后复习」（和字段自洽的那一种），不能反过来；
//   · 受保护的记忆（钉住 / 最初 / 主人重要）掉不到冻结线以下；
//   · 同一份记录在同一时刻算两次必须完全一样（纯函数，不掺 Date.now）。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DAY_MS } from '../src/memory-card.js';
import {
  D_MAX, D_MIN, DEFAULT_TARGET_RETENTION, FREEZE_R, S_MAX_DAYS, S_MIN_DAYS,
  daysUntilRetention, initialDifficulty, initialStability, protectedRecord,
  replayHistory, retrievability, retrievabilityInDays, strengthLabel, strengthOf,
} from '../src/memory-strength.js';

const NOW = Date.parse('2026-11-06T12:00:00+08:00');
const daysAgo = (n) => new Date(NOW - n * DAY_MS).toISOString();

function record(extra = {}) {
  return {
    id: 'mem_1', title: '说好一起去猫咪小镇', text: '明天一起去猫咪小镇',
    kind: 'promise', scope: 'qq', speaker: '主人', tags: [], importance: 60,
    clarity: 'clear', createdAt: daysAgo(30), lastSeenAt: daysAgo(3),
    decaySteps: 0, recallCount: 0,
    ...extra,
  };
}

test('FSRS 曲线的定义性质：R(t = S) = 0.9，且反解与正解互逆', () => {
  for (const S of [1, 3.5, 12, 100, 1000]) {
    assert.ok(Math.abs(retrievability(S, S) - 0.9) < 1e-9, `R(S=S) 必须是 0.9，S=${S}`);
  }
  assert.ok(Math.abs(daysUntilRetention(10, DEFAULT_TARGET_RETENTION) - 10) < 1e-9, '反解 R=0.9 得到的就是 S 天');
  // 目标保留率越低，允许拖得越久。
  assert.ok(daysUntilRetention(10, 0.8) > daysUntilRetention(10, 0.9));
  // 冻结线 0.5 落在 R 轴上更低的地方，用时应比 0.9 长得多（≈12.8 倍 S）。
  const freezeDays = daysUntilRetention(10, FREEZE_R);
  assert.ok(freezeDays > 120 && freezeDays < 140, `S=10 到冻结线应该约 128 天，实际 ${freezeDays}`);
});

test('R 单调：越久越低、越牢越高；t=0 时是 1', () => {
  assert.equal(retrievability(10, 0), 1);
  const series = [0, 1, 3, 10, 30, 365].map((t) => retrievability(10, t));
  for (let i = 1; i < series.length; i += 1) assert.ok(series[i] < series[i - 1], 'R 必须单调下降');
  assert.ok(retrievability(30, 10) > retrievability(10, 10), '同样过了 10 天，S 大的更清楚');
  assert.ok(series.every((r) => r >= 0 && r <= 1), 'R 必须落在 0~1');
});

test('S / D 初值：重要度高 → 更牢更容易；有上下限', () => {
  const low = initialStability(record({ importance: 5 }));
  const high = initialStability(record({ importance: 95 }));
  assert.ok(high > low);
  assert.ok(initialStability(record({ importance: 0 })) >= S_MIN_DAYS);
  assert.ok(initialStability(record({ importance: 100, pinned: true })) <= S_MAX_DAYS);

  assert.ok(initialDifficulty(record({ importance: 95 })) < initialDifficulty(record({ importance: 5 })), '越重要越不难');
  for (const importance of [0, 50, 100]) {
    for (const kind of ['promise', 'fact', 'event', 'emotion', 'place', 'unknown-kind']) {
      const d = initialDifficulty({ importance, kind });
      assert.ok(d >= D_MIN && d <= D_MAX, `D 必须落在 ${D_MIN}~${D_MAX}：${importance}/${kind} → ${d}`);
    }
  }
  assert.ok(initialDifficulty({ importance: 50, kind: 'promise' }) < initialDifficulty({ importance: 50, kind: 'event' }), '「说好的事」比「一次性的经过」好记');
});

test('重放：复习拉长 S、遗忘打短 S；次序是先遗忘后复习', () => {
  const base = { importance: 60, kind: 'fact' };
  const fresh = replayHistory(base);
  const reviewed = replayHistory({ ...base, recallCount: 3 });
  const lapsed = replayHistory({ ...base, decaySteps: 3 });
  assert.ok(reviewed.S > fresh.S, '复习过的更牢');
  assert.ok(lapsed.S < fresh.S, '降过档的更松');
  assert.ok(reviewed.D <= fresh.D && lapsed.D > fresh.D, 'D 随遗忘上升、不随复习下降');

  // 次序敏感：3 次遗忘 + 3 次复习，两种次序给出不同结果 —— 我们固定用「先遗忘后复习」。
  const both = replayHistory({ ...base, decaySteps: 3, recallCount: 3 });
  const reviewsFirst = (() => {
    let S = initialStability(base);
    let D = initialDifficulty(base);
    for (let i = 0; i < 3; i += 1) S *= 1 + (0.9 * (D_MAX + 1 - D)) / D_MAX;
    for (let i = 0; i < 3; i += 1) { S *= 0.45; D = Math.min(D_MAX, D + 0.7); }
    return S;
  })();
  assert.ok(Math.abs(both.S - reviewsFirst) > 1e-6, '两种次序结果不同 —— 说明次序确实被固定住了');
  assert.equal(both.reviews, 3);
  assert.equal(both.lapses, 3);

  // 极值不许算成 0 / 无穷 / NaN。
  const wild = replayHistory({ importance: 100, kind: 'promise', recallCount: 200, decaySteps: 200 });
  assert.ok(Number.isFinite(wild.S) && wild.S >= S_MIN_DAYS && wild.S <= S_MAX_DAYS);
  assert.ok(wild.D >= D_MIN && wild.D <= D_MAX);
});

test('保护：钉住 / 最初 / 主人重要不随时间淡忘（R 报卡面档位，不给到期/冻结天数）', () => {
  // 三年前的主人条目，卡面还是 vivid：不随时间淡（memory-card 的 targetClarity 就是这样，曲线必须一致）
  const old = record({ createdAt: daysAgo(3000), lastSeenAt: daysAgo(3000), clarity: 'vivid', tags: ['owner'], importance: 90 });
  assert.equal(protectedRecord(old, { minOwnerImportance: 65 }), true);
  const s = strengthOf(old, { now: NOW });
  assert.equal(s.protected, true);
  assert.equal(s.R, 1, '不随时间淡：卡面 vivid 就报 1');
  assert.equal(s.dueInDays, null, '不会淡忘的记忆没有「该复习了」');
  assert.equal(s.daysToFreeze, null, '也不给「还有几天冻结」，那是撒谎');
  assert.ok(s.S > 0, '稳固度照样算，只用于显示');
  assert.equal(strengthOf(record({ pinned: true, clarity: 'clear' }), { now: NOW }).R, 0.75, '钉住但卡面 clear：报 clear 的档位');
  assert.equal(strengthOf(record({ isInitial: true, clarity: 'fuzzy' }), { now: NOW }).protected, true);

  const unprotected = strengthOf(record({ createdAt: daysAgo(3000), lastSeenAt: daysAgo(3000), decaySteps: 8, importance: 20 }), { now: NOW });
  assert.equal(unprotected.protected, false);
  assert.ok(unprotected.R < 0.5, '没人管、又久又降过档的，应该已经过了冻结线');
  assert.equal(unprotected.daysToFreeze, 0);
  assert.equal(strengthLabel(unprotected.R), '将忘');
});

test('strengthOf：给出 R/S/D/标签/到期天数，且是纯函数', () => {
  const rec = record({ recallCount: 2, decaySteps: 1 });
  const a = strengthOf(rec, { now: NOW });
  const b = strengthOf(rec, { now: NOW });
  assert.deepEqual(a, b, '同一时刻算两次必须完全一样');

  assert.ok(a.R > 0 && a.R <= 1);
  assert.ok(a.S > 0 && a.D >= D_MIN);
  assert.equal(a.reviews, 2);
  assert.equal(a.lapses, 1);
  assert.equal(a.assumedSpread, true, '有多个事件时必须承认「时刻是假设的」');
  assert.equal(strengthOf(record(), { now: NOW }).assumedSpread, false, '一次都没复习过就没有假设');
  assert.match(a.label, /^(牢|稳|松|摇|将忘)$/);

  // lastSeenAt 越久远，R 越低（注意 createdAt 也要一起往前挪：见过的时间不可能早于创建）。
  const recent = strengthOf(record({ createdAt: daysAgo(4), lastSeenAt: daysAgo(1) }), { now: NOW });
  const stale = strengthOf(record({ createdAt: daysAgo(120), lastSeenAt: daysAgo(90) }), { now: NOW });
  assert.ok(recent.R > stale.R, `没提过更久的 R 应该更低：recent=${recent.R} stale=${stale.R}`);
  assert.ok(stale.dueInDays < recent.dueInDays, '很久没提过的，更早该「再看一眼」');
});

test('卡面上界：清晰度档位是「已经承认的事实」，不能比预测更乐观', () => {
  // 刚记下、时间上「应该很新」，但卡面已经被降成 forgotten —— R 必须跟着卡面走。
  const forgotten = strengthOf(record({ createdAt: daysAgo(0), lastSeenAt: daysAgo(0), clarity: 'forgotten' }), { now: NOW });
  assert.equal(forgotten.R, 0.05, '卡面说忘了就是忘了，不许因为「刚记下」报成 1');
  assert.equal(forgotten.daysToFreeze, 0, '已经在线下，不是「还有几天」');
  assert.equal(strengthOf(record({ createdAt: daysAgo(0), lastSeenAt: daysAgo(0), clarity: 'fuzzy' }), { now: NOW }).R, 0.5);
  // 受保护的记忆不吃这个上界（它们不随时间淡，R 就是卡面档位本身）。
  const owner = strengthOf(record({ createdAt: daysAgo(2000), lastSeenAt: daysAgo(2000), clarity: 'clear', tags: ['owner'], importance: 90 }), { now: NOW });
  assert.equal(owner.protected, true);
  assert.equal(owner.R, 0.75, `受保护的报卡面档位，不该被时间压下去：R=${owner.R}`);
  // 反过来：卡面比预测乐观时，取预测（时间说了算）。
  const stale = strengthOf(record({ createdAt: daysAgo(200), lastSeenAt: daysAgo(200), clarity: 'clear' }), { now: NOW });
  assert.ok(stale.R < 0.75, `很久没提过的，就算卡面还写着 clear 也得低于 0.75，R=${stale.R}`);
  assert.equal(stale.observedR, 0.75);
});

test('retrievabilityInDays：星图推演用，起点与 R 一致、和上界同一套规则', () => {
  const s = strengthOf(record(), { now: NOW });
  assert.ok(Math.abs(retrievabilityInDays(s, 0) - s.R) < 1e-9, '推演曲线的起点必须等于现在的 R');
  // 曲线**非增**即可：卡面上界在上界还没被预测追平的这段是平台（连续，不跳变），不是错。
  const series = [0, 1, 5, 30, 120, 365].map((d) => retrievabilityInDays(s, d));
  for (let i = 1; i < series.length; i += 1) assert.ok(series[i] <= series[i - 1], '推演曲线必须非增');
  assert.ok(series.at(-1) < series[0], '一年后总要比现在低');
  assert.ok(retrievabilityInDays(s, -5) === retrievabilityInDays(s, 0), '负数天数按 0 处理');
  // 卡面上界是「持续成立」的：一条 fuzzy 的卡，推演到 10 天后仍然是 0.5（预测还没跌下去）。
  const fuzzy = strengthOf(record({ createdAt: daysAgo(0), lastSeenAt: daysAgo(0), clarity: 'fuzzy' }), { now: NOW });
  assert.equal(retrievabilityInDays(fuzzy, 10), 0.5);
});
