// memory-associate 纯函数测试：「联想」挑谁、冷却、文案、状态文件容错。
//
// 这里不验「检索准不准」（那是 test-memory-recall），验的是**政策**：
//   · 只挑 R 落在区间里的（太牢不用提，太淡提了也白提）；
//   · 太新的事不提（刚聊过再提像复读）、保护类不提（钉住的/最初的/主人重要的不淡忘）；
//   · 提过的要冷却，冷却期按日历日算；
//   · 配置写错不能静默失效（区间写反要交换、负数要收敛）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  DEFAULT_ASSOCIATE_CONFIG, associatePathFor, associateWakeText, emptySeen, loadSeen,
  markSeen, normalizeAssociateConfig, pickAssociations, pruneSeen, saveSeen, seenRecently,
} from '../src/memory-associate.js';

const NOW = Date.parse('2026-11-06T12:00:00+08:00');
const DAY = 24 * 60 * 60 * 1000;

/** 一条「n 天前、没复习过」的普通记录：R 会随天数自然衰减。 */
function recordAged(id, days, extra = {}) {
  const at = new Date(NOW - days * DAY).toISOString();
  return {
    id, title: `旧事 ${id}`, text: `关于 ${id} 的一件小事`,
    kind: 'fact', scope: 'qq', speaker: '主人', tags: [], importance: 50,
    clarity: 'clear', createdAt: at, lastSeenAt: at,
    ...extra,
  };
}
const hit = (id) => ({ id, title: `旧事 ${id}`, text: `关于 ${id} 的一件小事`, score: 1 });

test('只挑 R 落在区间里的：太牢不提、太淡不提', () => {
  // 实测（clarity=clear、重要度 50）：R 在头 20 多天被卡面上界压在 0.75，
  // 之后才按 S·D 衰减 —— 120 天约 0.46，1200 天已跌破 0.2。
  const strong = recordAged('strong', 5, { clarity: 'vivid' });
  const fading = recordAged('fading', 120, { clarity: 'vivid' });
  const gone = recordAged('gone', 1200, { clarity: 'vivid' });
  const out = pickAssociations(
    [hit('strong'), hit('fading'), hit('gone')],
    { records: [strong, fading, gone], today: '2026-11-06', now: NOW },
  );
  assert.equal(out.length, 1, '默认 maxPerWake=1');
  assert.equal(out[0].id, 'fading');
  assert.ok(out[0].R >= DEFAULT_ASSOCIATE_CONFIG.rMin && out[0].R <= DEFAULT_ASSOCIATE_CONFIG.rMax);
});

test('maxPerWake 收得住的更多，且按 R 从低到高（最先要忘的排前面）', () => {
  const a = recordAged('a', 3);
  const b = recordAged('b', 7);
  const c = recordAged('c', 12);
  const out = pickAssociations([hit('a'), hit('b'), hit('c')], {
    records: [a, b, c], today: '2026-11-06', now: NOW,
    config: { ...DEFAULT_ASSOCIATE_CONFIG, maxPerWake: 3, rMin: 0, rMax: 1, minAgeDays: 0 },
  });
  assert.equal(out.length, 3);
  assert.ok(out[0].R <= out[1].R && out[1].R <= out[2].R, `要按 R 升序，实际 ${out.map((o) => o.R)}`);
});

test('太新的事不提（刚聊过再提像复读）', () => {
  const today = recordAged('today', 0);
  const out = pickAssociations([hit('today')], { records: [today], today: '2026-11-06', now: NOW });
  assert.equal(out.length, 0);
});

test('保护类不提：钉住 / 最初 / 主人重要都不淡忘', () => {
  const pinned = recordAged('pinned', 30, { pinned: true });
  const initial = recordAged('initial', 30, { isInitial: true });
  const out = pickAssociations([hit('pinned'), hit('initial')], {
    records: [pinned, initial], today: '2026-11-06', now: NOW,
    config: { ...DEFAULT_ASSOCIATE_CONFIG, maxPerWake: 3, rMin: 0, rMax: 1 },
  });
  assert.equal(out.length, 0);
});

test('命中里没有记录的不挑（R 是算出来的，不能凭命中瞎猜）', () => {
  const out = pickAssociations([hit('missing')], { records: [], today: '2026-11-06', now: NOW });
  assert.equal(out.length, 0);
});

test('冷却：提过的在 cooldownDays 内不再提，过了冷却可以再提', () => {
  const rec = recordAged('fading', 120, { clarity: 'vivid' });
  const seen = markSeen(emptySeen(), ['fading'], '2026-11-01');
  const blocked = pickAssociations([hit('fading')], { records: [rec], seen, today: '2026-11-06', now: NOW });
  assert.equal(blocked.length, 0, '5 天前提过，冷却 7 天，不该再提');
  const allowed = pickAssociations([hit('fading')], { records: [rec], seen, today: '2026-11-09', now: NOW });
  assert.equal(allowed.length, 1, '第 8 天冷却结束');
  assert.equal(seenRecently(seen, 'never', '2026-11-06', 7), false);
});

test('enabled=false 时一条都不挑', () => {
  const rec = recordAged('fading', 5);
  const out = pickAssociations([hit('fading')], {
    records: [rec], today: '2026-11-06', now: NOW, config: { enabled: false },
  });
  assert.equal(out.length, 0);
});

test('配置收敛：区间写反要交换、负数收敛、非数字回落默认', () => {
  const broken = normalizeAssociateConfig({ rMin: 0.8, rMax: 0.2, maxPerWake: -3, cooldownDays: 'x', minAgeDays: 99999 });
  assert.ok(broken.rMax >= broken.rMin, '写反的区间要交换回来，不能静默永不触发');
  assert.equal(broken.maxPerWake, 0);
  assert.equal(broken.cooldownDays, DEFAULT_ASSOCIATE_CONFIG.cooldownDays);
  assert.equal(broken.minAgeDays, 3650);
  assert.equal(normalizeAssociateConfig(null).enabled, true);
});

test('文案：带【忽然想起】、带「搭不上别硬提」的出口；空列表给空串', () => {
  const text = associateWakeText([{ id: 'x', text: '去年冬天在河边看到的那只白猫' }]);
  assert.ok(text.includes('【忽然想起】'));
  assert.ok(text.includes('白猫'));
  assert.ok(text.includes('别硬提'));
  assert.equal(associateWakeText([]), '');
  assert.equal(associateWakeText(null), '');
});

test('冷却记录会自清理：超过 60 天的旧行在写盘时丢掉，新行保留', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assoc-prune-'));
  const file = associatePathFor(dir);
  const state = { version: 1, seen: { ancient: '2026-01-01', recent: '2026-11-01' } };
  const saved = saveSeen(file, state);
  assert.equal(saved.seen.ancient, undefined, '半年前的冷却记录已经没有意义了');
  assert.equal(saved.seen.recent, '2026-11-01');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(raw.seen.ancient, undefined, '写进文件的也不能留');
  // 基准是「现有记录里最新的一天」，所以不依赖今天，结果可复现。
  const kept = pruneSeen({ version: 1, seen: { a: '2026-09-01', b: '2026-11-01' } }, { keepDays: 30 });
  assert.equal(kept, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('状态文件：坏 JSON 当空、只留合法日期、路径跟角色目录', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assoc-'));
  const file = associatePathFor(dir);
  assert.equal(file, path.join(dir, 'memory-associate.json'));

  assert.deepEqual(loadSeen(file), emptySeen(), '文件不存在时给空状态');
  fs.writeFileSync(file, '{ not json');
  assert.deepEqual(loadSeen(file), emptySeen(), '坏 JSON 不能抛');

  fs.writeFileSync(file, JSON.stringify({ version: 1, seen: { a: '2026-11-01', b: '2026-11-01T00:00:00Z', c: 'x' } }));
  const loaded = loadSeen(file);
  assert.deepEqual(Object.keys(loaded.seen), ['a'], '只保留 YYYY-MM-DD');

  const saved = saveSeen(file, markSeen(loaded, ['d'], '2026-11-06'));
  assert.equal(saved.seen.d, '2026-11-06');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).seen.a, '2026-11-01');
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});