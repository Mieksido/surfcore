// 星图回放（src/brain-replay.js）的离线单测。
// 覆盖：7 天窗口 / 三路来源合成与排序 / 工具调用配对与去重 / 活动日志还原收发 / 令牌二次脱敏 / 会话过滤。
// 全部在临时目录里读自己写的夹具文件，不连 QQ、DSH。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { DAYS_BACK, createBrainReplay, dayStartMs, parseActivityLine, shortToolName } from '../src/brain-replay.js';

const temps = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-replay-test-'));
  temps.push(dir);
  return dir;
}
after(() => {
  for (const dir of temps) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

const DAY = '2026-05-20';
const T0 = Date.parse(`${DAY}T10:00:00+08:00`);
const iso = (offsetMs) => new Date(T0 + offsetMs).toISOString();
const sec = (h, m, s) => dayStartMs(DAY) + (h * 3600 + m * 60 + s) * 1000;

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

/** 一套最小但真实的夹具：轨迹 + 工具日志 + 活动日志 + 记忆卡。 */
function fixture(dir, { trace = [], tools = [], activity = [], records = [] } = {}) {
  if (trace.length) writeJsonl(path.join(dir, 'brain', 'trace', `${DAY}.jsonl`), trace);
  if (tools.length) writeJsonl(path.join(dir, 'tool-calls.jsonl'), tools);
  if (activity.length) fs.writeFileSync(path.join(dir, 'qq-activity.log'), activity.join('\n') + '\n');
  return createBrainReplay({ stateDir: dir, records: () => records, now: () => T0, log: () => {} });
}

const mem = (id, extra = {}) => ({
  id, title: extra.title ?? '', text: extra.text ?? '正文', kind: 'event', clarity: 'clear',
  lastSeenAt: iso(0), createdAt: iso(0), ...extra
});

// ── 日期窗口 ────────────────────────────────────────────────────────────────
test('checkDay：只认最近 7 天，格式不对和越界都给得出话', () => {
  const dir = tempDir();
  const r = fixture(dir);
  assert.equal(DAYS_BACK, 6);
  assert.equal(r.checkDay(DAY).day, DAY);
  assert.equal(r.checkDay('2026-05-14').ok, true, '往前 6 天仍在窗口里');
  assert.equal(r.checkDay('2026-05-13').ok, false, '第 7 天就该出窗口了');
  assert.equal(r.checkDay('2026-05-21').ok, false, '不能看未来');
  assert.equal(r.checkDay('2026/05/20').ok, false);
  assert.equal(r.checkDay('').ok, false);
  const out = r.replay({ day: '2026-05-13' });
  assert.equal(out.ok, false);
  assert.match(out.error, /只能回放 2026-05-14 到 2026-05-20/);
  assert.equal(r.replay({ day: '瞎写' }).ok, false);
});

test('dayStartMs / shortToolName / parseActivityLine：小工具函数各管各的', () => {
  assert.equal(dayStartMs('2026-05-20'), Date.parse('2026-05-20T00:00:00'));
  assert.equal(dayStartMs('2026-5-2'), null);
  assert.equal(shortToolName('mcp__snowluma__qq_send_message'), 'qq_send_message');
  assert.equal(shortToolName('plain_tool'), 'plain_tool');
  assert.equal(shortToolName(''), 'tool');
  const inbound = parseActivityLine('[10:00:05] private:3532251800 [reserved2] 消息已入未读：今天好累啊', DAY);
  assert.equal(inbound.type, 'msg.in');
  assert.equal(inbound.text, '今天好累啊');
  assert.equal(inbound.at, sec(10, 0, 5));
  assert.equal(inbound.key, 'private:3532251800');
  const outbound = parseActivityLine('[10:00:12] private:3532251800 [send] 成功 1/1 条：早点睡，明天再聊', DAY);
  assert.equal(outbound.type, 'msg.out');
  assert.equal(outbound.text, '早点睡，明天再聊');
  assert.equal(parseActivityLine('[10:00:12] private:1 连接已建立', DAY), null, '认不出的行直接跳过');
  assert.equal(parseActivityLine('没有时间戳的行', DAY), null);
});

// ── 三路来源合成 ────────────────────────────────────────────────────────────
test('replay：轨迹 + 工具日志 + 活动日志合成一条时间线，并如实报告各来源条数', () => {
  const dir = tempDir();
  const r = fixture(dir, {
    trace: [
      { id: 1, at: T0 + 1000, type: 'remember', key: 'private:3532251800', nodes: ['ltm:mem_a'], e: { kind: 'event' } },
      { id: 2, at: T0 + 2000, type: 'tool', key: 'private:3532251800', e: { tool: 'mcp__snowluma__fetch_image' } },
      { id: 3, at: T0 + 3000, type: 'msg.in', key: 'private:3532251800' }, // 轨迹里不该有收发消息：过滤掉
    ],
    tools: [
      { type: 'call', time: iso(9000), key: 'private:3532251800', sessionId: 's1', tool: 'mcp__snowluma__qq_send_message', args: { message: '晚安' } },
      { type: 'result', time: iso(9500), key: 'private:3532251800', sessionId: 's1', tool: 'mcp__snowluma__qq_send_message', ok: true },
    ],
    activity: [
      '[10:00:05] private:3532251800 [reserved2] 消息已入未读：今天好累啊',
      '[10:00:12] private:3532251800 [send] 成功 1/1 条：早点睡，明天再聊',
    ],
    records: [mem('mem_a', { title: '她说过喜欢雨天', text: '下雨那天她说喜欢雨天' })],
  });
  const out = r.replay({ day: DAY });
  assert.equal(out.ok, true);
  assert.equal(out.day, DAY);
  assert.deepEqual(out.events.map((e) => e.type), ['remember', 'tool', 'msg.in', 'tool', 'msg.out'],
    '按时间排序：轨迹两条（收发的轨迹行被丢掉）+ 活动日志两条 + 工具日志一条（result 不单独成事件）');
  assert.deepEqual(out.sources, { trace: 2, tool: 1, msg: 2 });
  assert.equal(out.partial, true, '有非轨迹来源就说明是部分重建');
  assert.equal(out.counts['msg.in'], 1);
  const remember = out.events[0];
  assert.equal(remember.id, 1, '轨迹事件保留原来的编号');
  assert.equal(remember.from, 'trace');
  assert.equal(remember.data.text, '下雨那天她说喜欢雨天', '正文从记忆卡里现取');
  assert.equal(remember.data.title, '她说过喜欢雨天');
  const synthesize = out.events[4];
  assert.ok(synthesize.id >= 1_000_000, '重建事件用大偏移编号，避免和轨迹编号撞');
  assert.equal(synthesize.shadow, true);
  assert.equal(synthesize.from, 'activity-log');
  assert.equal(synthesize.region, 'output');
  assert.equal(synthesize.data.text, '早点睡，明天再聊');
  assert.equal(out.events.find((e) => e.from === 'tool-calls').region, 'output');
  for (const ev of out.events.filter((e) => e.from === 'trace')) assert.equal(ev.shadow, false);
});

test('replay：工具调用与轨迹里同一条去重，配对超时就不给状态', () => {
  const dir = tempDir();
  const r = fixture(dir, {
    trace: [
      // 轨迹里已经有一条同工具、同一秒的 tool 事件：工具日志那条不该再冒出来
      { id: 1, at: T0 + 1000, type: 'tool', key: 'private:1', e: { tool: 'mcp__snowluma__fetch_image' } },
    ],
    tools: [
      { type: 'call', time: iso(1200), key: 'private:1', tool: 'mcp__snowluma__fetch_image', args: {} },
      { type: 'result', time: iso(1500), key: 'private:1', tool: 'mcp__snowluma__fetch_image', ok: true },
      // 这条没有结果行：状态必须是 null，不能假装成功
      { type: 'call', time: iso(20000), key: 'private:1', tool: 'mcp__snowluma__qq_send_message', args: { message: '在吗' } },
      // 结果晚到 30 秒：超出 ±5 秒配对窗口，也算没配上
      { type: 'call', time: iso(40000), key: 'private:1', tool: 'mcp__snowluma__send_voice', args: {} },
      { type: 'result', time: iso(70000), key: 'private:1', tool: 'mcp__snowluma__send_voice', ok: true },
    ],
  });
  const out = r.replay({ day: DAY });
  const tools = out.events.filter((e) => e.type === 'tool');
  assert.equal(tools.length, 3, '轨迹那条 + 两条没被去重的调用');
  assert.equal(out.sources.tool, 2);
  const unmatched = tools.find((e) => e.data.tool === 'qq_send_message');
  assert.equal(unmatched.data.status, null, '配不上结果就是未知，不能编一个「成功」');
  const voice = tools.find((e) => e.data.tool === 'send_voice');
  assert.equal(voice.region, 'audio', '语音工具落到听觉区');
  const dup = tools.filter((e) => e.data.tool === 'fetch_image');
  assert.equal(dup.length, 1, '同一秒里轨迹与工具日志只留一条');
  assert.equal(dup[0].from, 'trace');
});

test('replay：工具参数走白名单，令牌类字段一律不进回放', () => {
  const dir = tempDir();
  const r = fixture(dir, {
    tools: [
      {
        type: 'call', time: iso(1000), key: 'private:1', tool: 'mcp__x__qq_send_message',
        args: { message: '你好', token: 'sk-abcdefghijklmnop', agentToken: 'deadbeef', messages: ['a', 'b'], 秘密字段: 'x'.repeat(500) },
      },
    ],
  });
  const out = r.replay({ day: DAY });
  const args = out.events[0].data.args;
  assert.equal(args.message, '你好');
  assert.deepEqual(args.messages, ['a', 'b']);
  assert.equal(args.token, undefined, '带 token 的字段不能进回放');
  assert.equal(args.agentToken, undefined);
  assert.equal(args['秘密字段'], undefined, '不在白名单里的字段一律丢');
});

test('replay：活动日志里的令牌被二次脱敏，长文本截断', () => {
  const dir = tempDir();
  const r = fixture(dir, {
    activity: [
      `[10:00:05] private:1 [reserved2] 消息已入未读：把我的 token 记一下 sk-abcdefghijklmnopqrstuvwxyz 然后删掉`,
      `[10:00:09] private:1 [send] 成功 1/1 条：${'很长的正文'.repeat(40)}`,
    ],
  });
  const out = r.replay({ day: DAY });
  const inbound = out.events.find((e) => e.type === 'msg.in');
  assert.ok(!inbound.data.text.includes('sk-abcdefghijklmnopqrstuvwxyz'), '回放里绝不能出现令牌');
  assert.match(inbound.data.text, /已脱敏/);
  const outbound = out.events.find((e) => e.type === 'msg.out');
  assert.ok([...outbound.data.text].length <= 300, '正文再长也要截断');
});

test('replay：会话过滤只留该会话和自己的全局事件', () => {
  const dir = tempDir();
  const r = fixture(dir, {
    trace: [
      { id: 1, at: T0 + 1000, type: 'wake', key: 'private:1', e: { reason: 'message' } },
      { id: 2, at: T0 + 2000, type: 'wake', key: 'group:456', e: { reason: 'message' } },
      { id: 3, at: T0 + 3000, type: 'rag.index', key: null, n: { total: 100 } },
    ],
  });
  const out = r.replay({ day: DAY, key: 'private:1' });
  assert.equal(out.key, 'private:1');
  assert.deepEqual(out.events.map((e) => e.key), ['private:1', null], '别的会话不上这条时间线，全局事件照留');
  const all = r.replay({ day: DAY });
  assert.equal(all.events.length, 3);
});

test('replay：找回「记下 / 淡忘」的正文，编不出来的字段给 null 而不是空字符串', () => {
  const dir = tempDir();
  const r = fixture(dir, {
    trace: [
      { id: 1, at: T0 + 1000, type: 'remember', key: 'private:1', nodes: ['ltm:mem_a'], e: { kind: 'event' } },
      { id: 2, at: T0 + 2000, type: 'forget', key: 'private:1', nodes: ['ltm:mem_gone'], e: { kind: 'event' } },
      { id: 3, at: T0 + 3000, type: 'inject', key: 'private:1', nodes: ['ltm:mem_a', 'ltm:mem_b'], n: { chars: 240 }, e: { recall: true, source: 'bm25' } },
      { id: 4, at: T0 + 4000, type: 'search', key: 'private:1', n: { ms: 30, items: 2 }, e: { source: 'probe', semantic: 'ok' } },
    ],
    records: [mem('mem_a', { clarity: 'fuzzy', title: '雨天', text: '她喜欢雨天' })],
  });
  const out = r.replay({ day: DAY });
  const [remember, forget, inject, search] = out.events;
  assert.equal(remember.data.text, '她喜欢雨天');
  assert.equal(remember.data.clarityLabel, '模糊');
  assert.equal(remember.data.deleted, false);
  assert.equal(forget.data.deleted, true, '存档里找不到就是「已删除」');
  assert.equal(forget.data.text, null);
  assert.deepEqual(inject.data.ltm, ['ltm:mem_a', 'ltm:mem_b']);
  assert.equal(inject.data.chars, 240);
  assert.equal(inject.data.recall, true);
  assert.equal(search.data.query, null, '轨迹里不存查询词：查询词可能带隐私，宁可给 null');
  assert.equal(search.data.hits, 2);
  assert.equal(search.data.semantic, 'ok');
});

test('replay：notes 固定说清三件限制，没有轨迹文件时额外点名', () => {
  const emptyDir = tempDir();
  const empty = fixture(emptyDir).replay({ day: DAY });
  assert.equal(empty.events.length, 0);
  assert.equal(empty.partial, false);
  assert.ok(empty.notes.some((n) => n.includes('没有轨迹文件')));
  assert.ok(empty.notes.some((n) => n.includes('活动日志读不到')), '没有活动日志就说没有，不能假装能还原');
  assert.ok(empty.notes.some((n) => n.includes('聊天原文没有长期存档')));

  // 活动日志在的时候，改成提醒「只留 500 行、正文被截断」——这两句不能同时出现
  const loggedDir = tempDir();
  const logged = fixture(loggedDir, { activity: ['[10:00:05] private:1 [reserved2] 消息已入未读：在吗'] }).replay({ day: DAY });
  assert.ok(logged.notes.some((n) => n.includes('500 行')));
  assert.equal(logged.notes.some((n) => n.includes('活动日志读不到')), false);

  const dir = tempDir();
  const withTrace = fixture(dir, { trace: [{ id: 1, at: T0, type: 'wake', key: null, e: { reason: 'message' } }] });
  assert.equal(withTrace.replay({ day: DAY }).notes.some((n) => n.includes('没有轨迹文件')), false);
});

test('replay：损坏的轨迹行只丢那一行，不影响整天', () => {
  const dir = tempDir();
  writeJsonl(path.join(dir, 'brain', 'trace', `${DAY}.jsonl`), [
    { id: 1, at: T0 + 1000, type: 'wake', key: 'private:1', e: { reason: 'message' } },
  ]);
  fs.appendFileSync(path.join(dir, 'brain', 'trace', `${DAY}.jsonl`), '{ 这不是 JSON\n');
  fs.appendFileSync(path.join(dir, 'brain', 'trace', `${DAY}.jsonl`), `${JSON.stringify({ id: 'x', at: T0, type: 'wake' })}\n`);
  const r = fixture(dir);
  const out = r.replay({ day: DAY });
  assert.equal(out.ok, true);
  assert.equal(out.events.length, 1, '坏行与不合规行都跳过');
});

test('replay：maxEvents 有上限，且有事件时不给「空一天」的提示', () => {
  const dir = tempDir();
  const trace = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, at: T0 + i * 1000, type: 'wake', key: 'private:1', e: { reason: 'message' } }));
  const r = fixture(dir, { trace });
  assert.equal(r.replay({ day: DAY, maxEvents: 5 }).events.length, 5);
  assert.equal(r.replay({ day: DAY }).events.length, 20);
});
