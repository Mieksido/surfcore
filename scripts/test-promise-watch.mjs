// 约定提醒（src/promise-watch.js）的离线单测。
//
// 覆盖：中/阿拉伯数字、日期表达式（明天/后天/下周X/月日/天后）、锚点语义、
// 「番剧名不是约定」、会话归属、状态机（sync/due/expire/fired）、状态文件读写。
//
// 刻意不覆盖桥接：本模块按设计不碰桥接、不发消息。投递闸门在 bridge.js，见
// scripts/test-promise-bridge.mjs。
import assert from 'node:assert/strict';
import fs, { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import {
  DEFAULT_PROMISE_CONFIG, deadlineOverdue, dueItems, emptyLedger, expireStale, inReminderWindow,
  ledgerPathFor, ledgerSummary, loadLedger, markFired, normalizePromiseConfig, parseDue, parseNumber,
  promiseCandidates, promiseKeyOf, promiseWakeText, saveLedger, setStatus, syncLedger,
} from '../src/promise-watch.js';

const temps = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promise-watch-test-'));
  temps.push(dir);
  return dir;
}
after(() => {
  for (const dir of temps) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

/** 本地时区的某天 12:00 —— 用 12 点做锚，避开夏令时/跨日边界把断言弄成偶发。 */
function dayAt(y, m, d, h = 12) {
  return new Date(y, m - 1, d, h, 0, 0, 0).getTime();
}

/* ───────────────────────────── 数字 ───────────────────────────── */

test('parseNumber：阿拉伯数字、单个汉字数字、十位组合', () => {
  assert.equal(parseNumber('7'), 7);
  assert.equal(parseNumber('23'), 23);
  assert.equal(parseNumber('一'), 1);
  assert.equal(parseNumber('两'), 2);
  assert.equal(parseNumber('十'), 10);
  assert.equal(parseNumber('十三'), 13);
  assert.equal(parseNumber('二十'), 20);
  assert.equal(parseNumber('二十三'), 23);
  assert.equal(parseNumber('三十一'), 31);
  // 认不出来必须给 NaN（调用方用 `>= 1` 过滤），不能悄悄当 0 或 1。
  assert.ok(Number.isNaN(parseNumber('')), '空串应是 NaN');
  assert.ok(Number.isNaN(parseNumber('abc')), '非数字应是 NaN');
  assert.ok(Number.isNaN(parseNumber('无数')), '不认识的字应是 NaN');
});

/* ───────────────────────────── 日期解析 ───────────────────────────── */

test('parseDue：相对日（明天/后天/大后天/今晚）按锚点算，不是按今天算', () => {
  const anchor = dayAt(2026, 3, 10);
  assert.equal(parseDue('明天一起去猫咪小镇', { anchor })?.date, '2026-03-11');
  assert.equal(parseDue('后天见', { anchor })?.date, '2026-03-12');
  assert.equal(parseDue('大后天再说', { anchor })?.date, '2026-03-13');
  assert.equal(parseDue('今晚一起打游戏', { anchor })?.date, '2026-03-10');
  assert.equal(parseDue('明晚聊', { anchor })?.date, '2026-03-11');
  // 关键：同一条记忆换锚点（写下的那天）就换日期 —— 否则早年约定全会算成今天到期。
  assert.equal(parseDue('明天一起去', { anchor: dayAt(2025, 1, 1) })?.date, '2025-01-02');
});

test('parseDue：周X / 下周X / 下下周X', () => {
  // 2026-03-10 是周二（ISO 周二 = 2）。
  const anchor = dayAt(2026, 3, 10);
  assert.equal(parseDue('周五见', { anchor })?.date, '2026-03-13');
  assert.equal(parseDue('下周五见', { anchor })?.date, '2026-03-20');
  assert.equal(parseDue('下下周五见', { anchor })?.date, '2026-03-27');
  // 当天就是周二、却说「周二」：算下一个周二（避免当天补一句）。
  assert.equal(parseDue('周二见', { anchor })?.date, '2026-03-17');
  // 周日/周天 都认。
  assert.equal(parseDue('周日见', { anchor })?.date, '2026-03-15');
  assert.equal(parseDue('周天见', { anchor })?.date, '2026-03-15');
});

test('parseDue：月日 / 下月X号，过去的月份按明年算', () => {
  const anchor = dayAt(2026, 11, 5);
  assert.equal(parseDue('11月20日见面', { anchor })?.date, '2026-11-20');
  // 11 月说「3 月 5 日」→ 指明年，不是今年已经过去的那个 3 月。
  assert.equal(parseDue('3月5日见面', { anchor })?.date, '2027-03-05');
  assert.equal(parseDue('下个月8号', { anchor })?.date, '2026-12-08');
  // 越界日期（2 月 31）要被挡掉，不能被 Date 悄悄滚到 3 月。
  // 注意：parseDue 返回 null（不是 {date:null}）—— 没算出日期就没有返回值。
  assert.equal(parseDue('2月31日见面', { anchor }), null);
});

test('parseDue：N天后 / N天以后', () => {
  const anchor = dayAt(2026, 5, 1);
  assert.equal(parseDue('三天后交作业', { anchor })?.date, '2026-05-04');
  assert.equal(parseDue('7天以后再说', { anchor })?.date, '2026-05-08');
  assert.equal(parseDue('二十三日后', { anchor })?.date, '2026-05-24');
  // 0 天/负数不在表里 → 不认。
  assert.equal(parseDue('0天后', { anchor }), null);
});

test('parseDue：番剧/电影档期不是约定（真实档案里的误报源）', () => {
  const anchor = dayAt(2026, 7, 1);
  assert.equal(parseDue('七月新番要开始了', { anchor }), null);
  assert.equal(parseDue('10月上映，记得去看', { anchor }), null);
  // 但同一句里的「明天」是真约定，不能被番剧噪声一起吃掉。
  assert.equal(parseDue('明天去看新番', { anchor })?.date, '2026-07-02');
});

test('parseDue：没有明确未来时间词的句子不产生 due', () => {
  const anchor = dayAt(2026, 3, 10);
  for (const text of ['以后重装还能照着来', '下次一定', '我答应你', '记得早点睡', '']) {
    assert.equal(parseDue(text, { anchor }), null, `不该认出 due：${text}`);
  }
  // 锚点非法 → null，不抛。
  assert.equal(parseDue('明天见', { anchor: 'not-a-date' }), null);
});

/* ───────────────────────────── 记录 → 约定 ───────────────────────────── */

const rec = (id, text, extra = {}) => ({
  id, text, title: '', kind: 'promise', conversationKey: 'private:123',
  createdAt: new Date(dayAt(2026, 3, 10)).toISOString(), ...extra,
});

test('promiseKeyOf：只认规范 key，或退而用 groupId；猜不出来就不投', () => {
  assert.equal(promiseKeyOf({ conversationKey: 'private:123' }), 'private:123');
  assert.equal(promiseKeyOf({ conversationKey: 'group:456' }), 'group:456');
  assert.equal(promiseKeyOf({ groupId: '456' }), 'group:456');
  // 脏 key 不能当成会话：宁可漏提醒，也不能发错人。
  assert.equal(promiseKeyOf({ conversationKey: 'private:abc' }), '');
  assert.equal(promiseKeyOf({ conversationKey: 'weird' }), '');
  assert.equal(promiseKeyOf({}), '');
});

test('promiseCandidates：以「能不能算出 due」为准，不看 kind', () => {
  const now = dayAt(2026, 3, 10);
  const records = [
    rec('a', '明天一起去猫咪小镇', { kind: 'event' }),      // kind 不是 promise，但算得出 due → 要
    rec('b', '以后重装还能照着来', { kind: 'promise' }),    // kind 是 promise，但没有 due → 不要
    rec('c', '明天见', { conversationKey: '' }),            // 不知道发给谁 → 不要
    rec('d', '下周一起看展'),
  ];
  const out = promiseCandidates(records, { now });
  assert.deepEqual(out.map((x) => x.id).sort(), ['a', 'd']);
  assert.equal(out.find((x) => x.id === 'a').dueDate, '2026-03-11');
  // 正文长度要截断，免得状态文件被长记忆撑起来。
  const long = promiseCandidates([rec('e', `明天${'很'.repeat(500)}`)], { now });
  assert.ok(long[0].text.length <= 200);
});

/* ───────────────────────────── 状态机 ───────────────────────────── */

test('syncLedger：新条目 pending；已提过的不会被扫档重置', () => {
  const now = dayAt(2026, 3, 10);
  const records = [rec('a', '明天一起去猫咪小镇')];
  const first = syncLedger(emptyLedger(), records, { now });
  assert.deepEqual(first.added, ['a']);
  assert.equal(first.ledger.items.a.status, 'pending');
  assert.equal(first.ledger.items.a.dueDate, '2026-03-11');

  // 提过一次之后再扫档（正文没变）：状态和 firedDay 都必须保持。
  // 注意 markFired 是原地改账本、返回被改的 id 数组（不是新账本）。
  assert.deepEqual(markFired(first.ledger, ['a'], { now }), ['a']);
  const again = syncLedger(first.ledger, records, { now: now + 60000 });
  assert.deepEqual(again.added, []);
  assert.equal(again.ledger.items.a.status, 'pending', '提过不等于完成');
  assert.equal(again.ledger.items.a.firedDay, '2026-03-10', '已提过的日子不能丢');
});

test('dueItems：只给到期/过期的、没提过的、没超缓冲期的', () => {
  const now = dayAt(2026, 3, 12);
  const today = '2026-03-12';
  const ledger = { version: 1, items: {
    today: { id: 'today', key: 'private:123', dueDate: '2026-03-12', status: 'pending', text: 'A' },
    late: { id: 'late', key: 'private:123', dueDate: '2026-03-10', status: 'pending', text: 'B' },
    future: { id: 'future', key: 'private:123', dueDate: '2026-03-20', status: 'pending', text: 'C' },
    fired: { id: 'fired', key: 'private:123', dueDate: '2026-03-12', status: 'pending', firedDay: today, text: 'D' },
    done: { id: 'done', key: 'private:123', dueDate: '2026-03-12', status: 'done', text: 'E' },
    stale: { id: 'stale', key: 'private:123', dueDate: '2026-03-01', status: 'pending', text: 'F' },
  } };
  const due = dueItems(ledger, { today, graceDays: 2, now });
  assert.deepEqual(due.map((x) => x.id), ['late', 'today'], '到期早的先提；超缓冲期/未来/已提/已完成的都不给');
  // 按会话过滤：别人的约定不能挤进这个会话的唤醒。
  assert.deepEqual(dueItems(ledger, { key: 'group:999', today, graceDays: 2, now }), []);
});

test('deadlineOverdue：缓冲期最后一天还算数，过了才算过期', () => {
  assert.equal(deadlineOverdue('2026-03-10', '2026-03-12', 2), false, '到期日+2 天当天仍在缓冲期内');
  assert.equal(deadlineOverdue('2026-03-10', '2026-03-13', 2), true, '再晚一天就过期');
  assert.equal(deadlineOverdue('2026-03-10', '2026-03-11', 0), true, '缓冲 0 天：次日即过期');
  assert.equal(deadlineOverdue('not-a-date', '2026-03-12', 2), true, '坏日期按过期处理，别一直提');
});

test('expireStale：只动超期的 pending，已完成的别改', () => {
  const ledger = { version: 1, items: {
    old: { id: 'old', status: 'pending', dueDate: '2026-03-01' },
    done: { id: 'done', status: 'done', dueDate: '2026-03-01' },
    fresh: { id: 'fresh', status: 'pending', dueDate: '2026-03-20' },
  } };
  const changed = expireStale(ledger, { today: '2026-03-12', graceDays: 2, now: Date.now() });
  assert.deepEqual(changed, ['old']);
  assert.equal(ledger.items.old.status, 'expired');
  assert.equal(ledger.items.done.status, 'done');
  assert.equal(ledger.items.fresh.status, 'pending');
});

/* ───────────────────────────── 提示词 & 摘要 ───────────────────────────── */

test('promiseWakeText：只给「哪天、什么事」，不露内部 id 和状态码', () => {
  const text = promiseWakeText([
    { id: 'mem_secret_id', dueDate: '2026-03-11', status: 'pending', text: '一起去猫咪小镇' },
  ], { name: '主人', today: '2026-03-11' });
  assert.match(text, /到期的约定/);
  assert.match(text, /一起去猫咪小镇/);
  assert.match(text, /2026-03-11/);
  assert.ok(!text.includes('mem_secret_id'), '不许把内部编号写进提示词');
  assert.ok(!text.includes('pending'), '不许把状态码写进提示词');
  // 空列表给空串（调用方据此决定注入不注入）。
  assert.equal(promiseWakeText([], { today: '2026-03-11' }), '');
});

test('ledgerSummary：只数 pending，标出今天到期与已提', () => {
  const s = ledgerSummary({ items: {
    a: { id: 'a', key: 'private:123', dueDate: '2026-03-12', status: 'pending', text: 'A', firedDay: '2026-03-12' },
    b: { id: 'b', key: 'private:123', dueDate: '2026-03-20', status: 'pending', text: 'B' },
    c: { id: 'c', key: 'private:123', dueDate: '2026-03-01', status: 'done', text: 'C' },
  } }, { today: '2026-03-12' });
  assert.equal(s.pending, 2);
  assert.equal(s.dueToday, 1);
  assert.equal(s.items[0].id, 'a');
  assert.equal(s.items[0].firedToday, true);
});

/* ───────────────────────────── 状态文件 ───────────────────────────── */

test('loadLedger/saveLedger：坏文件不抛，字段被白名单收敛', () => {
  const dir = tempDir();
  const file = ledgerPathFor(path.join(dir, 'char-memory'));
  assert.match(file, /char-memory[\\/]promise-due\.json$/, '状态文件跟着角色目录走');

  // 不存在 → 空账本，不抛。
  assert.deepEqual(loadLedger(file).items, {});

  // 坏 JSON → 空账本，不抛（用户手改坏了不能导致桥接起不来）。
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ 坏掉的 json');
  assert.deepEqual(loadLedger(file).items, {});

  // 写入后读回：非法 status 收敛成 pending，非法 dueDate 直接丢。
  saveLedger(file, { items: {
    ok: { id: 'ok', key: 'private:123', dueDate: '2026-03-11', status: 'weird', text: 'X' },
    bad: { id: 'bad', key: 'private:123', dueDate: '3月11日', status: 'pending', text: 'Y' },
  } });
  const back = loadLedger(file);
  assert.deepEqual(Object.keys(back.items), ['ok'], '没有规范 dueDate 的条目不能留在账本里');
  assert.equal(back.items.ok.status, 'pending');
  // 文件权限：状态文件里有约定正文，不该是所有人可写。
  if (process.platform !== 'win32') {
    const mode = fs.statSync(file).mode & 0o777;
    assert.equal(mode, 0o600, `状态文件权限应为 600，实际 ${mode.toString(8)}`);
  }
});

test('setStatus：改状态并留备注；不存在的 id 返回 null 而不是抛', () => {
  const ledger = { items: { a: { id: 'a', status: 'pending', dueDate: '2026-03-11' } } };
  const ok = setStatus(ledger, 'a', 'done', { note: '已经一起去过了' });
  assert.equal(ok.status, 'done');
  assert.equal(ok.note, '已经一起去过了');
  assert.equal(setStatus(ledger, 'nope', 'done'), null);
});

/* ───────────────────────────── 提醒窗口 ───────────────────────────── */

/** 本地时区的某个钟点（用今天，只取时分）。 */
function atClock(hh, mm = 0) {
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  return d.getTime();
}

test('inReminderWindow：at 是下限、until 是上限，闭开区间', () => {
  const cfg = { at: '10:00', until: '22:00' };
  assert.equal(inReminderWindow(atClock(9, 59), cfg), false, '太早不提');
  assert.equal(inReminderWindow(atClock(10, 0), cfg), true, 'at 那一刻算在窗口内');
  assert.equal(inReminderWindow(atClock(15, 30), cfg), true);
  assert.equal(inReminderWindow(atClock(21, 59), cfg), true);
  assert.equal(inReminderWindow(atClock(22, 0), cfg), false, 'until 那一刻已出窗口（闭开区间）');
  assert.equal(inReminderWindow(atClock(23, 30), cfg), false, '深夜绝不能被「今天到期」叫醒');
  assert.equal(inReminderWindow(atClock(3, 0), cfg), false);
});

test('inReminderWindow：at === until 视为不限结束；跨零点的窗口也要对', () => {
  // 相同 = 全天候（想让她半夜也能被约定叫醒时才这么配）
  assert.equal(inReminderWindow(atClock(3, 0), { at: '10:00', until: '10:00' }), true);
  // 跨零点：晚上 22:00 到早上 02:00
  const night = { at: '22:00', until: '02:00' };
  assert.equal(inReminderWindow(atClock(23, 0), night), true);
  assert.equal(inReminderWindow(atClock(1, 30), night), true);
  assert.equal(inReminderWindow(atClock(2, 0), night), false);
  assert.equal(inReminderWindow(atClock(12, 0), night), false);
});

test('normalizePromiseConfig：until 也要校验范围，坏值回落默认', () => {
  assert.equal(normalizePromiseConfig({}).until, DEFAULT_PROMISE_CONFIG.until);
  assert.equal(normalizePromiseConfig({ until: '07:30' }).until, '07:30');
  assert.equal(normalizePromiseConfig({ until: '25:99' }).until, DEFAULT_PROMISE_CONFIG.until, '坏钟点不能用（会变成永不提醒）');
  assert.equal(normalizePromiseConfig({ until: 'abc' }).until, DEFAULT_PROMISE_CONFIG.until);
});

test('config.example.json 里要有 promiseWake 段（装了就有，不用手改）', () => {
  // 照仓库惯例：新能力的默认值必须出现在模板里，否则新装用户拿不到。
  const example = JSON.parse(readFileSync(new URL('../config.example.json', import.meta.url), 'utf8'));
  assert.ok(example.promiseWake, 'config.example.json 缺 promiseWake 段');
  const cfg = normalizePromiseConfig(example.promiseWake);
  assert.equal(cfg.enabled, true, '默认就该开');
  // 模板值必须和默认值一致：模板里写一套、代码里另一套，用户会以为改配置没生效。
  assert.deepEqual(cfg, { ...DEFAULT_PROMISE_CONFIG }, '模板值要和代码默认值一致');
  assert.equal(cfg.until, '22:00', '必须有结束钟点，否则深夜会弹「今天到期」');
});

test('normalizePromiseConfig：默认值与越界收敛', () => {
  assert.deepEqual(normalizePromiseConfig(null), { ...DEFAULT_PROMISE_CONFIG });
  // 「关」只有显式 false 才算。
  assert.equal(normalizePromiseConfig({ enabled: false }).enabled, false);
  assert.equal(normalizePromiseConfig({ enabled: 0 }).enabled, true);
  // 时间格式不对就回落，不能变成 ''（否则永远到不了点）。
  assert.equal(normalizePromiseConfig({ at: '25:99' }).at, DEFAULT_PROMISE_CONFIG.at);
  assert.equal(normalizePromiseConfig({ at: '07:30' }).at, '07:30');
  // 数值收敛到区间内，且取整。
  assert.equal(normalizePromiseConfig({ maxPerDay: 999 }).maxPerDay, 20);
  assert.equal(normalizePromiseConfig({ maxPerDay: -5 }).maxPerDay, 0);
  assert.equal(normalizePromiseConfig({ graceDays: 3.7 }).graceDays, 4);
});