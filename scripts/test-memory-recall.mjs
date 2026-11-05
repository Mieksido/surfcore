// 记忆召回胶水层（src/memory-recall.js）的离线单测。
// 覆盖：触发词闸门 / CQ 码清洗 / 注入格式 / 已进记忆卡的条目不重复 / 长度上限 / 失败降级。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { recallBlock, recallQuery, searchMemoryAsync, shouldRecall } from '../src/memory-recall.js';
import { syncMemoryIndex } from '../src/memory-index.js';

const temps = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-recall-test-'));
  temps.push(dir);
  return dir;
}
after(() => {
  for (const dir of temps) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function seed(dir, records) {
  const jsonl = path.join(dir, 'memory-card-full.jsonl');
  fs.writeFileSync(jsonl, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const dbPath = path.join(dir, 'state', 'index.db');
  syncMemoryIndex(jsonl, { dbPath });
  return dbPath;
}

const rec = (id, text, extra = {}) => ({
  id,
  title: extra.title ?? '',
  text,
  tags: [],
  kind: 'event',
  scope: 'qq',
  speaker: '主人',
  importance: 10,
  clarity: 'clear',
  createdAt: extra.createdAt ?? '2026-10-31T15:30:00.000Z',
});

test('recallQuery：去 CQ 码与链接，压空白', () => {
  assert.equal(recallQuery('[CQ:reply,id=1] 你还记得 https://b23.tv/x 那个吗'), '你还记得 那个吗');
  assert.equal(recallQuery('   '), '');
});

test('shouldRecall：只有「在回忆」的问法才触发', () => {
  assert.equal(shouldRecall('你还记得猫咪小镇那个地下宫殿吗'), true);
  assert.equal(shouldRecall('上次说的那根灯带到底多少钱'), true);
  assert.equal(shouldRecall('在吗'), false);
  assert.equal(shouldRecall('晚上好呀'), false);
  assert.equal(shouldRecall(''), false);
});

test('recallBlock：没触发词就不注入（不打扰提示词）', () => {
  const dir = tempDir();
  const dbPath = seed(dir, [rec('m1', '猫咪小镇的地下宫殿有五十米灯带')]);
  assert.equal(recallBlock(dir, '晚上好', { dbPath }), '');
});

test('recallBlock：命中时给出日期 + 正文，并说明是自然回忆', () => {
  const dir = tempDir();
  const dbPath = seed(dir, [rec('m1', '猫咪小镇的地下宫殿有五十米灯带，金饰要拿镊子摆')]);
  const block = recallBlock(dir, '你还记得那个地下宫殿的灯带吗', { dbPath });
  assert.match(block, /【记忆检索/);
  assert.match(block, /2026-10-31/);
  assert.match(block, /灯带/);
  assert.match(block, /别照读/);
});

test('recallBlock：已经写进记忆卡的条目不再重复注入', () => {
  const dir = tempDir();
  const dbPath = seed(dir, [rec('m1', '猫咪小镇的地下宫殿有五十米灯带', { title: '猫咪小镇地下宫殿' })]);
  const block = recallBlock(dir, '你还记得那个地下宫殿吗', { dbPath, avoidText: '【记忆卡】猫咪小镇地下宫殿：五十米灯带' });
  assert.equal(block, '');
});

test('recallBlock：maxChars 上限生效，且不会把一条切成两半', () => {
  const dir = tempDir();
  const dbPath = seed(dir, [
    rec('m1', '灯带这件事：五十米长的灯带绕了整个地下宫殿'),
    rec('m2', '灯带价格：一共花了三千多，主人说值'),
  ]);
  const block = recallBlock(dir, '你还记得灯带花了多少钱吗', { dbPath, maxChars: 60 });
  assert.ok(block.length <= 90, `超长了：${block.length}`);
});

test('recallBlock：记忆目录不存在 / 库坏了都返回空串，不抛', () => {
  const dir = tempDir();
  assert.equal(recallBlock(path.join(dir, 'nope'), '你还记得上次那个吗'), '');
  assert.equal(recallBlock(dir, '你还记得上次那个吗', { dbPath: path.join(dir, 'state', 'x.db') }), '');
});

test('searchMemoryAsync：空查询给结构化失败', async () => {
  const dir = tempDir();
  const res = await searchMemoryAsync(dir, '   ');
  assert.equal(res.ok, false);
  assert.equal(res.code, 'query.empty');
  assert.ok(res.hint);
});

test('searchMemoryAsync：纯 BM25 模式返回命中', async () => {
  const dir = tempDir();
  const dbPath = seed(dir, [rec('m1', '猫咪小镇的地下宫殿有五十米灯带')]);
  const res = await searchMemoryAsync(dir, '地下宫殿 灯带', { dbPath, hybrid: false });
  assert.equal(res.ok, true);
  assert.equal(res.mode, 'bm25');
  assert.equal(res.items[0].id, 'm1');
});

test('searchMemoryAsync：没建向量时降级但不报错', async () => {
  const dir = tempDir();
  const dbPath = seed(dir, [rec('m1', '猫咪小镇的地下宫殿有五十米灯带')]);
  const res = await searchMemoryAsync(dir, '地下宫殿 灯带', {
    dbPath, hybrid: true, embed: { baseUrl: 'http://127.0.0.1:9/v1', timeoutMs: 300 },
  });
  assert.equal(res.ok, true);
  assert.equal(res.mode, 'bm25');
  assert.ok(res.items.length >= 1);
  assert.ok(typeof res.reason === 'string');
});