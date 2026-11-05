// 星图事件流（src/brain-feed.js）的离线单测。
// 覆盖：脑区归类 / 编号与载荷白名单 / 轨迹只落编号 / 快照节点与衰减 / 遗忘曲线 / 开关与页面连接。
// 全部在临时目录里跑，不连 QQ、DSH 或记忆检索服务。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import {
  EVENT_TYPES, cleanNodes, createBrainFeed, filterTraceRecord, localDay, regionFor, toolRegion
} from '../src/brain-feed.js';

const temps = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-feed-test-'));
  temps.push(dir);
  return dir;
}
function traceLines(dir, day) {
  const file = path.join(dir, 'brain', 'trace', `${day}.jsonl`);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}
function feed(dir, extra = {}) {
  return createBrainFeed({ stateDir: dir, log: () => {}, ...extra });
}
after(() => {
  for (const dir of temps) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

const at = (offset) => new Date('2026-05-20T10:00:00+08:00').getTime() + offset;

// ── 脑区归类 ────────────────────────────────────────────────────────────────
test('toolRegion：MCP 全名按最后一段认脑区，语音/记忆/图片各归各的', () => {
  // 桥接送进来的是完整工具名。只看前缀的话 mcp__x__qq_tts_voice 会掉进 output，
  // 听觉扇区就永远是空的 —— 这正是这一版要钉住的行为。
  assert.equal(toolRegion('mcp__snowluma__qq_tts_voice'), 'audio');
  assert.equal(toolRegion('qq_tts_voice'), 'audio');
  assert.equal(toolRegion('mcp__snowluma__send_voice'), 'audio');
  assert.equal(toolRegion('mcp__snowluma__qq_memory_note'), 'working');
  assert.equal(toolRegion('qq_memory_recall'), 'working');
  assert.equal(toolRegion('mcp__snowluma__fetch_image'), 'vision');
  assert.equal(toolRegion('mcp__snowluma__qq_send_sticker'), 'vision');
  assert.equal(toolRegion('mcp__snowluma__qq_send_message'), 'output');
  assert.equal(toolRegion(''), 'output');
  assert.equal(regionFor('msg.in', ''), 'input');
  assert.equal(regionFor('msg.out', ''), 'output');
  assert.equal(regionFor('wake', ''), 'working');
  assert.equal(regionFor('rag.index', ''), 'hippo');
  assert.equal(regionFor('tool', 'mcp__x__fetch_image'), 'vision');
  assert.equal(regionFor('不认识的类型', ''), 'working', '未知类型兜到工作记忆，不能崩');
});

test('cleanNodes：只留合法编号、去重、最多 50 个', () => {
  assert.deepEqual(cleanNodes(['ltm:mem_1', 'ltm:mem_1', 'bad', 'msg:private:1:x', 42]), ['ltm:mem_1', 'msg:private:1:x']);
  assert.deepEqual(cleanNodes('ltm:mem_1'), [], '不是数组就给空的，不能抛');
  const many = Array.from({ length: 80 }, (_, i) => `ltm:mem_${i}`);
  assert.equal(cleanNodes(many).length, 50);
});

test('filterTraceRecord：缺 id/at/type 整行丢，未知字段一律丢，收发消息不入轨迹', () => {
  assert.equal(filterTraceRecord({ at: at(0), type: 'wake' }), null);
  assert.equal(filterTraceRecord({ id: 1, at: at(0), type: '听都没听过' }), null);
  assert.equal(filterTraceRecord({ id: 1, at: at(0), type: 'msg.in', key: 'private:1' }), null, 'msg.in 不落轨迹');
  assert.equal(filterTraceRecord({ id: 1.5, at: at(0), type: 'wake' }), null, 'id 必须是整数');
  const kept = filterTraceRecord({
    id: 7, at: at(0), type: 'inject', key: 'private:1', origin: 'ai',
    nodes: ['ltm:mem_1', '瞎写的'],
    n: { chars: 120, 危险字段: 1, rank: [1, 2] },
    e: { recall: true, source: 'bm25', 秘密: '不该出现' },
    原文: '也不该出现',
  });
  assert.deepEqual(kept, {
    id: 7, at: at(0), type: 'inject', key: 'private:1', origin: 'ai',
    nodes: ['ltm:mem_1'], n: { chars: 120, rank: [1, 2] }, e: { recall: true, source: 'bm25' },
  });
});

// ── 事件与轨迹 ──────────────────────────────────────────────────────────────
test('emit：返回递增编号；轨迹只落编号和数字；没有页面连着时不进缓冲', () => {
  const dir = tempDir();
  // now 钉死：轨迹文件名按「今天」算，不钉住的话测试会随运行日期漂。
  const f = feed(dir, { now: () => at(0) });
  const id1 = f.emit('remember', {
    key: 'private:3532251800', origin: 'bridge', nodes: ['ltm:mem_a'],
    n: { items: 1 }, e: { kind: 'event' },
    data: () => ({ node: 'ltm:mem_a', title: '她说过喜欢雨天', text: '原话在这里，但只有页面连着才会被取' }),
  });
  const id2 = f.emit('tool', { key: 'private:3532251800', tool: 'mcp__snowluma__fetch_image', e: { tool: 'mcp__snowluma__fetch_image' }, data: { tool: 'x' } });
  assert.equal(id2, id1 + 1);
  assert.equal(f.lastId(), id2);
  assert.deepEqual(f.bufferedEvents(), [], '没有页面连着就不该留缓冲');
  // 轨迹照写：它是「什么时候记了哪条」，不是聊天原文
  const day = localDay(at(0));
  const lines = traceLines(dir, day);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].type, 'remember');
  assert.deepEqual(lines[0].nodes, ['ltm:mem_a']);
  assert.equal(lines[0].data, undefined, '轨迹里不能有 data');
  assert.equal(lines[1].type, 'tool');
  assert.equal(lines[1].e.tool, 'mcp__snowluma__fetch_image');
  f.closeAll();
});

test('emit：未知类型与关闭状态都返回 null，且绝不抛', () => {
  const dir = tempDir();
  let enabled = true;
  const f = feed(dir, { isEnabled: () => enabled });
  assert.equal(f.emit('脑洞大开', { key: 'private:1' }), null);
  enabled = false;
  assert.equal(f.emit('wake', { key: 'private:1' }), null);
  enabled = true;
  assert.equal(typeof f.emit('wake', { key: 'private:1' }), 'number');
  // 传进去的东西再离谱也不该把桥接拖崩
  assert.doesNotThrow(() => f.emit('wake', null));
  assert.doesNotThrow(() => f.emit('inject', { key: 'private:1', nodes: '不是数组', data: () => { throw new Error('坏载荷'); } }));
  f.closeAll();
});

test('cleanupTrace：只留今天和往前 6 天', () => {
  const dir = tempDir();
  const traceDir = path.join(dir, 'brain', 'trace');
  fs.mkdirSync(traceDir, { recursive: true });
  for (const name of ['2026-05-13.jsonl', '2026-05-14.jsonl', '2026-05-20.jsonl', '乱七八糟.txt']) {
    fs.writeFileSync(path.join(traceDir, name), '');
  }
  const f = feed(dir, { now: () => at(0) });
  // 建 feed 时就会清一次（进程重启不该看到一周前的轨迹），所以这里先验结果再验幂等。
  assert.equal(fs.existsSync(path.join(traceDir, '2026-05-13.jsonl')), false, '05-13 超出一周，建实例时就该被清掉');
  assert.equal(fs.existsSync(path.join(traceDir, '2026-05-14.jsonl')), true);
  assert.equal(fs.existsSync(path.join(traceDir, '2026-05-20.jsonl')), true);
  assert.equal(fs.existsSync(path.join(traceDir, '乱七八糟.txt')), true, '不认识的文件不动它');
  assert.equal(f.cleanupTrace(), 0, '刚清过再清一次应该是 0（幂等，别重复删）');
  f.closeAll();
});

// ── 快照 ────────────────────────────────────────────────────────────────────
const rec = (id, extra = {}) => ({
  id, title: extra.title ?? '', text: extra.text ?? '正文', kind: 'event', scope: 'qq',
  tags: [], importance: 10, clarity: 'clear', createdAt: at(0), lastSeenAt: at(0), ...extra,
});

test('snapshot：记忆卡条目变成 ltm 节点，衰减只给 R/frozen/exempt', () => {
  const dir = tempDir();
  const f = feed(dir);
  const out = f.snapshot({
    records: [
      rec('mem_owner', { kind: 'owner', speaker: '主人', importance: 70, tags: ['owner'], clarity: 'vivid', conversationKey: 'private:3532251800' }),
      rec('mem_old', { clarity: 'fuzzy', conversationKey: 'private:3532251800' }),
      rec('mem_gone', { clarity: 'forgotten', conversationKey: 'desktop:coo' }),
    ],
    keys: ['private:3532251800', 'desktop:coo', 'private:3532251800'],
    labelFor: (key) => (key === 'private:3532251800' ? '主人' : undefined),
  });
  assert.equal(out.ok, true);
  const byId = new Map(out.nodes.map((n) => [n.id, n]));
  assert.equal(byId.get('ltm:mem_owner').decay.exempt, true, '主人 + 高重要度是免衰减的');
  assert.equal(byId.get('ltm:mem_owner').decay.R, 1);
  assert.equal(byId.get('ltm:mem_owner').cat, 'owner');
  assert.equal(byId.get('ltm:mem_old').decay.R, 0.5);
  assert.equal(byId.get('ltm:mem_old').decay.frozen, false, '0.5 还没到冻结线（冻结线是「低于 0.5」）');
  assert.equal(byId.get('ltm:mem_gone').decay.frozen, true);
  assert.equal(byId.get('ltm:mem_gone').clarityLabel, '已遗忘');
  assert.equal(byId.get('ltm:mem_old').decay.S, null, '阶梯模型没有 FSRS 的 S：给 null 比编一个数字诚实');
  assert.deepEqual(out.keys.map((k) => k.key), ['desktop:coo', 'private:3532251800'], '会话键去重并排序');
  assert.equal(out.keys.find((k) => k.key === 'private:3532251800').label, '主人');
  assert.equal(out.keys.find((k) => k.key === 'desktop:coo').label, 'desktop:coo', '没有名字就退回键本身');
  f.closeAll();
});

test('snapshot：按会话过滤、忽略没有编号的记录、人格层只给层名和字数', () => {
  const dir = tempDir();
  const f = feed(dir);
  const out = f.snapshot({
    records: [
      rec('mem_a', { conversationKey: 'private:1' }),
      rec('mem_b', { conversationKey: 'group:456', tags: ['owner'] }),
      { text: '没有 id 的脏记录' },
      rec('mem_c'),
    ],
    persona: { layers: [{ key: 'core', name: '底子', chars: 1200, updatedAt: at(0) }, { key: 'tone', name: '语气', chars: 300 }] },
    key: 'private:1',
  });
  assert.deepEqual(out.nodes.map((n) => n.id).sort(), ['ltm:mem_a', 'persona:core', 'persona:tone']);
  const persona = out.nodes.find((n) => n.id === 'persona:core');
  assert.equal(persona.kind, 'persona');
  assert.equal(persona.chars, 1200);
  assert.equal(persona.text, undefined, '人格卡正文不上图，只给字数');
  f.closeAll();
});

test('snapshot：超过上限只留最新的那批，并如实报告砍掉多少', () => {
  const dir = tempDir();
  const f = feed(dir);
  const records = Array.from({ length: 2100 }, (_, i) => rec(`mem_${i}`, { lastSeenAt: at(i), conversationKey: 'private:1' }));
  const out = f.snapshot({ records, key: 'private:1' });
  assert.equal(out.nodes.length, 2000);
  assert.equal(out.truncated.ltm, 100);
  assert.ok(out.nodes.some((n) => n.id === 'ltm:mem_2099'), '保留的是最新的');
  assert.equal(out.nodes.some((n) => n.id === 'ltm:mem_0'), false);
  f.closeAll();
});

// ── 遗忘曲线 ────────────────────────────────────────────────────────────────
test('decayCurve：按清晰度阶梯逐日推，冻结线是「低于 0.5」', () => {
  const dir = tempDir();
  const f = feed(dir);
  const record = rec('mem_old', { clarity: 'fuzzy', lastSeenAt: at(0), createdAt: at(0) });
  const curve = f.decayCurve({ unit: 'ltm:mem_old', findRecord: () => record, days: 5 });
  assert.equal(curve.ok, true);
  assert.equal(curve.shape, 'clarity-ladder', '页面上要说明白：这不是 FSRS');
  assert.equal(curve.R0, 0.5);
  assert.equal(curve.D, null);
  assert.equal(curve.points.length, 6, '0..5 天都给点');
  assert.deepEqual(curve.points.map((p) => p.R), [0.5, 0.25, 0.05, 0.05, 0.05, 0.05]);
  assert.equal(curve.frozenAtDay, 1);
  f.closeAll();
});

test('decayCurve：免衰减的不给冻结日；编号不对/找不到记录都返回 null（调用方回 404）', () => {
  const dir = tempDir();
  const f = feed(dir);
  const owner = rec('mem_owner', { kind: 'owner', tags: ['owner'], importance: 90, clarity: 'vivid' });
  const exempt = f.decayCurve({ unit: 'ltm:mem_owner', findRecord: () => owner, days: 30 });
  assert.equal(exempt.exempt, true);
  assert.equal(exempt.frozenAtDay, null, '免衰减的记忆不会「淡忘」，给个日期反而是撒谎');
  assert.equal(f.decayCurve({ unit: 'mem_owner', findRecord: () => owner }), null, '缺 ltm: 前缀');
  assert.equal(f.decayCurve({ unit: 'ltm:mem_nope', findRecord: () => null }), null);
  assert.equal(f.decayCurve({ unit: 'ltm:mem_owner', findRecord: () => { throw new Error('读盘炸了'); } }), null, 'findRecord 抛错也算找不到，不能把控制台带崩');
  f.closeAll();
});

test('regionCounts：今天的计数按脑区累加，且是只读副本', () => {
  const dir = tempDir();
  const f = feed(dir);
  f.emit('msg.in', { key: 'private:1' });
  f.emit('msg.out', { key: 'private:1' });
  f.emit('tool', { key: 'private:1', tool: 'mcp__x__fetch_image' });
  const counts = f.regionCounts();
  assert.equal(counts.input, 1);
  assert.equal(counts.output, 1);
  assert.equal(counts.vision, 1);
  counts.input = 999;
  assert.equal(f.regionCounts().input, 1, '拿到的必须是副本：页面不能反手改桥接的内部状态');
  f.closeAll();
});

test('事件类型表：页面认识的那几类都在，且是冻住的', () => {
  for (const type of ['msg.in', 'msg.out', 'wake', 'inject', 'search', 'remember', 'update', 'forget', 'rag.index', 'tool']) {
    assert.ok(EVENT_TYPES.includes(type), `${type} 应该认识`);
  }
  assert.ok(Object.isFrozen(EVENT_TYPES));
});
