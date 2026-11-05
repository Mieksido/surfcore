// 建议候选（第 4 件）单测：抽取精度优先 —— 宁可漏，不可错。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_SUGGEST_CONFIG, normalizeSuggestConfig, extractFacts, suggestIdOf, emptySuggestState,
  loadSuggest, saveSuggest, suggestPathFor, observe, planSuggest, markShown, dismissSuggestion,
  pruneSuggest, suggestWakeText, suggestSummary,
} from '../src/ledger-suggest.js';

const T0 = Date.parse('2026-11-06T10:00:00');
const day = (offset) => {
  const d = new Date(T0 + offset * 86400000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const TODAY = day(0);

function stateWith(items) {
  const s = emptySuggestState();
  for (const it of items) s.items[it.id] = { shown: 0, lastShownDay: '', status: 'open', ...it };
  return s;
}

test('抽取：称呼 / 生日 / 忌口 / 过敏 / 喜好 / 住处 / 工作 / 宠物', () => {
  const cases = [
    ['以后叫我阿岚就行', '称呼', '阿岚'],
    ['我生日是 3 月 14 号，记得啊', '生日'],
    ['我不吃香菜', '忌口', '香菜'],
    ['我对芒果过敏', '过敏', '芒果'],
    ['我特别喜欢雨天', '喜好', '雨天'],
    ['我搬到杭州了', '住处', '杭州'],
    ['我在医院上班', '工作', '医院'],
    ['我养了只橘猫', '宠物'],
  ];
  for (const [text, cat, fact] of cases) {
    const got = extractFacts(text);
    const hit = got.find((x) => x.cat === cat);
    assert.ok(hit, `「${text}」应抽出 ${cat}，实际 ${JSON.stringify(got)}`);
    if (fact) assert.equal(hit.fact, fact, `「${text}」的宾语`);
  }
});

test('抽取：问句 / 第二人称 / 空话 一律不抽', () => {
  const bad = [
    '你喜欢什么？', '我喜欢你', '我喜欢你这样说', '我今天好累啊', '我有点饿',
    '我住的地方远吗', '你说我住在哪里比较好', '我明天要上班', '我记得我住在哪儿来着',
  ];
  for (const text of bad) assert.deepEqual(extractFacts(text), [], `不该抽：${text}`);
});

test('抽取：同义重复只留一条，编号由类别+事实决定', () => {
  assert.equal(suggestIdOf('忌口', '香菜'), suggestIdOf('忌口', ' 香菜 '));
  const got = extractFacts('我不吃香菜，我真的不吃香菜。');
  assert.equal(got.filter((x) => x.cat === '忌口').length, 1);
});

test('抽取：一旬多事最多三条，且每条都有证据小句', () => {
  const got = extractFacts('我不吃香菜。我对芒果过敏。我喜欢雨天。我养了只猫。');
  assert.ok(got.length >= 3);
  assert.ok(got.length <= 3);
  for (const x of got) assert.ok(x.evidence.length > 0 && x.evidence.length <= 60);
});

test('观察：新的入池，重复的刷新证据，已作废的不复活', () => {
  const s = emptySuggestState();
  const a = observe(s, { text: '我不吃香菜', key: 'private:1', sender: '主人', at: T0 }, {});
  assert.equal(a.length, 1);
  const id = a[0];
  assert.equal(s.items[id].shown, 0);
  assert.equal(s.items[id].status, 'open');

  observe(s, { text: '我不吃香菜', key: 'private:1', sender: '主人', at: T0 + 1000 }, {});
  assert.equal(Object.keys(s.items).length, 1, '重复不该新增');
  assert.equal(s.items[id].at, T0 + 1000, '证据应刷新到最近一次');

  s.items[id].status = 'dismissed';
  observe(s, { text: '我不吃香菜', key: 'private:1', sender: '主人', at: T0 + 2000 }, {});
  assert.equal(s.items[id].status, 'dismissed', '作废的不复活');
});

test('观察：配置关掉就不抽', () => {
  const s = emptySuggestState();
  assert.deepEqual(observe(s, { text: '我不吃香菜', key: 'private:1', at: T0 }, { enabled: false }), []);
});

test('挑选：perWake 上限 / 会话隔离 / 只挑 open', () => {
  const s = stateWith([
    { id: 'a', cat: '忌口', fact: '香菜', key: 'private:1', at: T0, day: TODAY },
    { id: 'b', cat: '喜好', fact: '雨天', key: 'private:1', at: T0 - 1000, day: TODAY },
    { id: 'c', cat: '住处', fact: '杭州', key: 'private:2', at: T0, day: TODAY },
  ]);
  const one = planSuggest(s, { key: 'private:1', today: TODAY, config: { perWake: 1 } });
  assert.equal(one.items.length, 1);
  assert.equal(one.items[0].id, 'a', '按时间新→旧');
  assert.equal(one.ids.length, 1);
  assert.ok(one.text.includes('香菜'));
  assert.ok(!one.text.includes('杭州'), '别人会话的候选不能串');

  const two = planSuggest(s, { key: 'private:1', today: TODAY, config: { perWake: 2 } });
  assert.equal(two.items.length, 2);

  s.items.a.status = 'dismissed';
  const after = planSuggest(s, { key: 'private:1', today: TODAY, config: { perWake: 2 } });
  assert.deepEqual(after.ids, ['b'], '作废的不再挑');
});

test('挑选：提满次数 / 过期 / 已在卡里 都不再提', () => {
  const s = stateWith([
    { id: 'a', cat: '忌口', fact: '香菜', key: 'private:1', at: T0, day: TODAY, shown: 2 },
    { id: 'b', cat: '喜好', fact: '雨天', key: 'private:1', at: T0, day: day(-30) },
    { id: 'c', cat: '住处', fact: '杭州', key: 'private:1', at: T0, day: TODAY },
  ]);
  const cfg = { perWake: 3, maxShows: 2, ttlDays: 14 };
  assert.deepEqual(planSuggest(s, { key: 'private:1', today: TODAY, config: cfg }).ids, ['c'], 'a 提满、b 过期');
  const withCard = planSuggest(s, {
    key: 'private:1', today: TODAY, config: cfg, cardText: '2026-11-03 主人说他不喜欢杭州',
  });
  assert.deepEqual(withCard.ids, [], '卡里已有的不再提');
});

test('挑选：每会话每日上限（maxPerDay）', () => {
  const s = stateWith([
    { id: 'a', cat: '忌口', fact: '香菜', key: 'private:1', at: T0, day: TODAY, shown: 1, lastShownDay: TODAY },
  ]);
  const none = planSuggest(s, { key: 'private:1', today: TODAY, config: { perWake: 2, maxPerDay: 1 } });
  assert.deepEqual(none.ids, [], '今天已经提过 1 条，上限 1');
  const other = planSuggest(s, { key: 'private:2', today: TODAY, config: { perWake: 2, maxPerDay: 1 } });
  assert.deepEqual(other.ids, [], '别的会话没有候选');
});

test('计数：接受后才累加，提满自动过期', () => {
  const s = stateWith([{ id: 'a', cat: '忌口', fact: '香菜', key: 'private:1', at: T0, day: TODAY }]);
  assert.equal(markShown(s, ['a', 'nope'], { today: TODAY, config: { maxShows: 2 } }), 1);
  assert.equal(s.items.a.shown, 1);
  assert.equal(s.items.a.status, 'open');
  assert.equal(s.items.a.lastShownDay, TODAY);
  markShown(s, ['a'], { today: TODAY, config: { maxShows: 2 } });
  assert.equal(s.items.a.shown, 2);
  assert.equal(s.items.a.status, 'expired');
});

test('挑选不改状态（提示词会建两遍）', () => {
  const s = stateWith([{ id: 'a', cat: '忌口', fact: '香菜', key: 'private:1', at: T0, day: TODAY }]);
  const snapshot = JSON.stringify(s);
  const p1 = planSuggest(s, { key: 'private:1', today: TODAY, config: {} });
  const p2 = planSuggest(s, { key: 'private:1', today: TODAY, config: {} });
  assert.deepEqual(p1.ids, p2.ids);
  assert.equal(JSON.stringify(s), snapshot, 'planSuggest 必须是只读的');
});

test('清理：过期的 open 清掉，久远的历史状态保留窗口', () => {
  const s = stateWith([
    { id: 'a', cat: '忌口', fact: '香菜', key: 'private:1', at: T0, day: day(-30) },
    { id: 'b', cat: '喜好', fact: '雨天', key: 'private:1', at: T0, day: TODAY, status: 'dismissed' },
  ]);
  assert.equal(pruneSuggest(s, { today: TODAY, config: { ttlDays: 14 }, keepDays: 14 }), 1);
  assert.equal(s.items.a, undefined);
  assert.ok(s.items.b, '刚作废的还留着（留作审计）');
});

test('作废与摘要', () => {
  const s = stateWith([{ id: 'a', cat: '忌口', fact: '香菜', key: 'private:1', at: T0, day: TODAY }]);
  assert.equal(dismissSuggestion(s, 'a'), true);
  assert.equal(dismissSuggestion(s, 'nope'), false);
  const sum = suggestSummary(s, { days: 7, today: TODAY });
  assert.equal(sum.open, 0);
  assert.equal(sum.total, 1);
  assert.equal(sum.items[0].fact, '香菜');
});

test('文案：带事实、带类别、不念日期、不像表格', () => {
  const text = suggestWakeText([{ fact: '香菜', cat: '忌口' }], { name: '主人' });
  assert.ok(text.includes('主人刚说过：香菜（忌口）'));
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(text));
  assert.ok(text.includes('别像在做登记'));
  assert.equal(suggestWakeText([]), '');
});

test('配置：越界收敛、缺省回落', () => {
  const cfg = normalizeSuggestConfig({ perWake: 99, maxShows: 0, ttlDays: -1, maxPerDay: 999 });
  assert.equal(cfg.perWake, 5);
  assert.equal(cfg.maxShows, 1);
  assert.equal(cfg.ttlDays, 1);
  assert.equal(cfg.maxPerDay, 20);
  assert.equal(normalizeSuggestConfig(null).perWake, DEFAULT_SUGGEST_CONFIG.perWake);
});

test('状态文件：坏 JSON 不抛、写读往返、POSIX 下 0600', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suggest-'));
  const file = suggestPathFor(dir);
  assert.deepEqual(loadSuggest(file).items, {});
  fs.writeFileSync(file, '{坏掉的', 'utf8');
  assert.deepEqual(loadSuggest(file).items, {});
  const s = emptySuggestState();
  observe(s, { text: '我不吃香菜', key: 'private:1', at: T0 }, {});
  assert.equal(saveSuggest(file, s), true);
  const back = loadSuggest(file);
  assert.equal(Object.keys(back.items).length, 1);
  const [id] = Object.keys(back.items);
  assert.equal(back.items[id].fact, '香菜');
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('状态文件：非法条目逐条丢弃，不影响其它', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suggest-'));
  const file = suggestPathFor(dir);
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    items: {
      ok: { id: 'ok', cat: '忌口', fact: '香菜', shown: 0, status: 'open', day: TODAY, at: T0 },
      noCat: { id: 'noCat', fact: '没类别' },
      badStatus: { id: 'badStatus', cat: '喜好', fact: '雨天', status: '???' },
      notObj: 42,
    },
  }), 'utf8');
  const s = loadSuggest(file);
  assert.ok(s.items.ok);
  assert.equal(s.items.noCat, undefined);
  assert.equal(s.items.badStatus.status, 'open', '未知状态回落 open');
  assert.equal(s.items.notObj, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});