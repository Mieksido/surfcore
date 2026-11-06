// 记忆索引（src/memory-index.js）的离线单测。
// 覆盖：中文分词 / 建库 / 增量追加 / 换档案重建 / 检索排序 / scope 过滤 / 空查询。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import http from 'node:http';
import {
  memoryIndexPathFor, memoryIndexStats, memorySearchText, memoryTokens, searchMemory, searchMemoryHybrid,
  searchMemoryIndex, searchVectors, syncMemoryIndex, syncVectors, vectorIndexStats,
} from '../src/memory-index.js';

const temps = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-index-test-'));
  temps.push(dir);
  return dir;
}
after(() => {
  for (const dir of temps) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function writeJsonl(file, records) {
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

const base = (id, text, extra = {}) => ({
  id,
  title: extra.title ?? '',
  text,
  tags: extra.tags ?? ['qq'],
  kind: extra.kind ?? 'event',
  scope: extra.scope ?? 'qq',
  speaker: extra.speaker ?? '',
  importance: extra.importance ?? 10,
  clarity: extra.clarity ?? 'clear',
  createdAt: extra.createdAt ?? '2026-11-01T00:00:00.000Z',
});

test('分词：汉字出单字+二元组，拉丁词按词切，标点与空白断开', () => {
  const tokens = memoryTokens('她养了一只橘猫，叫 DouBao！');
  assert.ok(tokens.includes('猫'), '单字要能命中「猫」');
  assert.ok(tokens.includes('橘猫'), '二元组要能命中「橘猫」');
  assert.ok(tokens.includes('doubao'), '拉丁词统一小写');
  assert.ok(!tokens.some((t) => t.includes('，')), '标点不参与分词');
  assert.deepEqual(memoryTokens(''), []);
});

test('检索文本包含标题、正文、说话人和标签', () => {
  const text = memorySearchText({ title: '第一次见面', text: '她说以后就是一家人了', speaker: '主人', tags: ['owner', 'first'] });
  assert.match(text, /第一次见面/);
  assert.match(text, /一家人/);
  assert.match(text, /主人/);
  assert.match(text, /owner/);
});

test('建库 → 统计 → 增量追加只扫新行', () => {
  const dir = tempDir();
  const jsonl = path.join(dir, 'memory-card-full.jsonl');
  const dbPath = path.join(dir, 'index.db');
  writeJsonl(jsonl, [
    base('m1', '主人说想养一只橘猫'),
    base('m2', 'B站看了猫咪小镇的地下宫殿，五十米灯带'),
  ]);
  const first = syncMemoryIndex(jsonl, { dbPath });
  assert.equal(first.added, 2);
  assert.equal(first.total, 2);

  const again = syncMemoryIndex(jsonl, { dbPath });
  assert.equal(again.added, 0);
  assert.equal(again.scanned, 0, '没有新行就不该再扫');

  fs.appendFileSync(jsonl, JSON.stringify(base('m3', '她又提起那只橘猫，说要叫年糕')) + '\n');
  const third = syncMemoryIndex(jsonl, { dbPath });
  assert.equal(third.added, 1);
  assert.equal(third.total, 3);

  const stats = memoryIndexStats(dbPath);
  assert.equal(stats.total, 3);
  assert.equal(stats.exists, true);
  assert.ok(stats.byScope.some((s) => s.scope === 'qq' && s.count === 3));
});

test('换档案（内容被替换）时整库重建，不残留旧记录', () => {
  const dir = tempDir();
  const jsonl = path.join(dir, 'memory-card-full.jsonl');
  const dbPath = path.join(dir, 'index.db');
  writeJsonl(jsonl, [base('old1', '旧档案里的猫'), base('old2', '旧档案里的狗')]);
  syncMemoryIndex(jsonl, { dbPath });
  assert.equal(memoryIndexStats(dbPath).total, 2);

  writeJsonl(jsonl, [base('new1', '新档案里的兔子')]);
  const res = syncMemoryIndex(jsonl, { dbPath });
  assert.equal(res.rebuilt, true);
  assert.equal(res.total, 1);
  assert.equal(searchMemoryIndex('猫', { dbPath }).length, 0, '旧记录必须被清掉');
  assert.equal(searchMemoryIndex('兔子', { dbPath }).length, 1);
});

test('检索：中文相关度排序、limit 生效、scope 过滤', () => {
  const dir = tempDir();
  const jsonl = path.join(dir, 'memory-card-full.jsonl');
  const dbPath = path.join(dir, 'index.db');
  writeJsonl(jsonl, [
    base('a', '猫咪小镇的地下宫殿，五十米灯带、一百多颗灯珠，全是实拍'),
    base('b', '今天天气不错，出去走了走'),
    base('c', '猫把杯子推下桌子，碎了一地', { scope: 'bili' }),
  ]);
  syncMemoryIndex(jsonl, { dbPath });

  const hits = searchMemoryIndex('灯带 宫殿', { dbPath, limit: 5 });
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].id, 'a');
  assert.ok(hits[0].score > 0);

  const single = searchMemoryIndex('猫', { dbPath, limit: 1 });
  assert.equal(single.length, 1, 'limit 必须生效');
  assert.match(single[0].text, /猫/);

  const qqOnly = searchMemoryIndex('猫', { dbPath, scope: 'qq', limit: 10 });
  assert.ok(qqOnly.every((h) => h.scope === 'qq'));
  assert.ok(qqOnly.some((h) => h.id === 'a'));

  assert.deepEqual(searchMemoryIndex('   ', { dbPath }), [], '空查询直接返回空');
});

test('派生库不存在时检索返回空数组，不抛错', () => {
  const dir = tempDir();
  assert.deepEqual(searchMemoryIndex('猫', { dbPath: path.join(dir, 'nope.db') }), []);
  assert.equal(memoryIndexStats(path.join(dir, 'nope.db')).exists, false);
});

test('searchMemory：从 memory 目录检索，追加的新记忆会自动进索引', () => {
  const dir = tempDir();
  const dbPath = path.join(dir, 'index.db');
  writeJsonl(path.join(dir, 'memory-card-full.jsonl'), [base('m1', '主人说想养一只橘猫')]);
  const before = searchMemory(dir, '橘猫', { dbPath });
  assert.equal(before.length, 1);
  assert.equal(before[0].id, 'm1');

  fs.appendFileSync(
    path.join(dir, 'memory-card-full.jsonl'),
    JSON.stringify(base('m2', '她给猫起名叫年糕')) + '\n',
  );
  // 同一毫秒内 mtime 可能不变，强制换时间戳绕过节流
  const later = Date.now() + 60_000;
  const after = searchMemory(dir, '年糕', { dbPath, now: later });
  assert.equal(after.length, 1);
  assert.equal(after[0].id, 'm2');
});
// ── 向量层：用一个假的 OpenAI 兼容服务验证接线（不打真模型） ──

const KEYWORDS = [['猫', '喵'], ['狗', '汪'], ['年糕', '吃'], ['灯', '蓝']];

/** 假向量：一组关键词命中数 + 偏置，归一化。同样的词→同样的向量。 */
function fakeVector(text) {
  const s = String(text);
  const dims = KEYWORDS.map((words) => words.reduce((n, w) => n + (s.split(w).length - 1), 0));
  dims.push(0.05);
  const norm = Math.hypot(...dims) || 1;
  return dims.map((v) => v / norm);
}

async function startFakeEmbed() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const inputs = Array.isArray(payload.input) ? payload.input : [payload.input ?? ''];
        const data = inputs.map((t, index) => ({ index, embedding: fakeVector(t) }));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data }));
      } catch (err) {
        res.writeHead(400).end(String(err));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('syncVectors：补全向量、记录维度；重复跑不重复写', async () => {
  const dir = tempDir();
  const dbPath = path.join(dir, 'index.db');
  writeJsonl(path.join(dir, 'memory-card-full.jsonl'), [
    base('m1', '家里的橘猫最近很黏人'),
    base('m2', '院子里有条狗在叫'),
  ]);
  const fake = await startFakeEmbed();
  try {
    const first = await syncVectors({ memoryDir: dir, dbPath, embed: { baseUrl: fake.baseUrl } });
    assert.equal(first.embedded, 2);
    assert.equal(first.total, 2);
    assert.ok(first.dim > 0);
    const again = await syncVectors({ memoryDir: dir, dbPath, embed: { baseUrl: fake.baseUrl } });
    assert.equal(again.embedded, 0);
    assert.equal(again.total, 2);
    const stats = vectorIndexStats(dbPath);
    assert.equal(stats.exists, true);
    assert.equal(stats.count, 2);
    assert.equal(stats.dim, first.dim);
  } finally {
    await fake.close();
  }
});

test('searchVectors：余弦排序正确，按 id 取回', async () => {
  const dir = tempDir();
  const dbPath = path.join(dir, 'index.db');
  writeJsonl(path.join(dir, 'memory-card-full.jsonl'), [
    base('cat', '家里的橘猫最近很黏人'),
    base('dog', '院子里有条狗在叫'),
  ]);
  const fake = await startFakeEmbed();
  try {
    await syncVectors({ memoryDir: dir, dbPath, embed: { baseUrl: fake.baseUrl } });
    const hits = searchVectors(fakeVector('猫 喵'), { dbPath, limit: 5 });
    assert.equal(hits.length, 2);
    assert.equal(hits[0].id, 'cat');
    assert.ok(hits[0].score > hits[1].score);
  } finally {
    await fake.close();
  }
});

test('searchMemoryHybrid：BM25+向量融合，向量独有条目会回表补正文', async () => {
  const dir = tempDir();
  const dbPath = path.join(dir, 'index.db');
  writeJsonl(path.join(dir, 'memory-card-full.jsonl'), [
    base('cat', '家里的橘猫最近很黏人', { title: '橘猫' }),
    base('dog', '院子里有条狗在叫', { title: '狗' }),
    base('lamp', '抽屉里那根灯带是蓝色的', { title: '灯带' }),
  ]);
  const fake = await startFakeEmbed();
  try {
    await syncVectors({ memoryDir: dir, dbPath, embed: { baseUrl: fake.baseUrl } });
    const res = await searchMemoryHybrid(dir, '猫', { dbPath, limit: 3, embed: { baseUrl: fake.baseUrl } });
    assert.equal(res.mode, 'hybrid');
    assert.equal(res.items[0].id, 'cat');
    for (const item of res.items) {
      assert.equal(typeof item.title, 'string');
      assert.ok(item.text !== undefined);
    }
    assert.ok(res.items.some((i) => (i.via || []).some((v) => v.startsWith('vec:'))));
  } finally {
    await fake.close();
  }
});

test('searchMemoryHybrid：embedding 服务挂了会自动降级成纯 BM25', async () => {
  const dir = tempDir();
  const dbPath = path.join(dir, 'index.db');
  writeJsonl(path.join(dir, 'memory-card-full.jsonl'), [base('m1', '家里的橘猫最近很黏人')]);
  const fake = await startFakeEmbed();
  const baseUrl = fake.baseUrl;
  await syncVectors({ memoryDir: dir, dbPath, embed: { baseUrl } });
  await fake.close();
  const res = await searchMemoryHybrid(dir, '橘猫', { dbPath, embed: { baseUrl, timeoutMs: 800 } });
  assert.equal(res.mode, 'bm25');
  assert.match(res.reason, /embed-failed/);
  assert.equal(res.items[0].id, 'm1');
});

test('syncMemoryIndex：maxScanBytes 限制时按需分次推进，最后能追平', () => {
  const dir = tempDir();
  const dbPath = path.join(dir, 'index.db');
  const jsonl = path.join(dir, 'memory-card-full.jsonl');
  const records = [];
  for (let i = 0; i < 40; i += 1) records.push(base(`m${i}`, `第 ${i} 条记忆：家里那只猫又在窗台上晒太阳`));
  writeJsonl(jsonl, records);
  const first = syncMemoryIndex(jsonl, { dbPath, maxScanBytes: 1024 });
  assert.ok(first.scanned < 40, `第一次应只扫一部分，实际 ${first.scanned}`);
  let guard = 0;
  while (memoryIndexStats(dbPath).total < 40 && guard++ < 50) {
    syncMemoryIndex(jsonl, { dbPath, maxScanBytes: 1024 });
  }
  assert.equal(memoryIndexStats(dbPath).total, 40);
});

test('同一条记忆更新后，旧内容不再命中（FTS 不残留）', () => {
  const dir = tempDir();
  const dbPath = path.join(dir, 'index.db');
  const jsonl = path.join(dir, 'memory-card-full.jsonl');
  writeJsonl(jsonl, [base('m1', '她养了一只叫年糕的橘猫')]);
  syncMemoryIndex(jsonl, { dbPath });
  assert.equal(searchMemoryIndex('年糕', { dbPath }).length, 1);
  // 同 id 覆盖写（全量档案本身只追加，但换档/纠错时会出现同 id 新内容）
  fs.appendFileSync(jsonl, `${JSON.stringify(base('m1', '她养了一只叫团子的柴犬'))}\n`);
  syncMemoryIndex(jsonl, { dbPath, force: true });
  assert.equal(searchMemoryIndex('年糕', { dbPath }).length, 0, '旧 token 必须被删掉');
  assert.equal(searchMemoryIndex('团子', { dbPath })[0]?.id, 'm1');
});

test('两个不同档案目录不共用派生库（否则一个档案会顶掉另一个）', () => {
  const env = { ...process.env, DSH_HOME: tempDir() };
  const dirA = path.join(env.DSH_HOME, 'characters', 'char-a', 'memory');
  const dirB = path.join(env.DSH_HOME, 'characters', 'char-b', 'memory');
  for (const [dir, text] of [[dirA, 'A 档案：她喜欢在雨天听爵士'], [dirB, 'B 档案：他攒了一柜子旧相机']]) {
    fs.mkdirSync(dir, { recursive: true });
    writeJsonl(path.join(dir, 'memory-card-full.jsonl'), [base('m1', text)]);
  }
  const pathA = memoryIndexPathFor(dirA, env);
  const pathB = memoryIndexPathFor(dirB, env);
  assert.notEqual(pathA, pathB, '不同档案目录必须算出不同的库');

  // 两个档案各自同步、各自检索：A 的库不该出现 B 的记录，反之亦然。
  syncMemoryIndex(path.join(dirA, 'memory-card-full.jsonl'), { dbPath: pathA });
  syncMemoryIndex(path.join(dirB, 'memory-card-full.jsonl'), { dbPath: pathB });
  assert.equal(searchMemoryIndex('爵士', { dbPath: pathA }).length, 1);
  assert.equal(searchMemoryIndex('爵士', { dbPath: pathB }).length, 0, 'A 的记录不能出现在 B 的库里');
  assert.equal(searchMemoryIndex('相机', { dbPath: pathB }).length, 1);
  assert.equal(searchMemoryIndex('相机', { dbPath: pathA }).length, 0, 'B 的记录不能出现在 A 的库里');
  assert.equal(memoryIndexStats(pathA).total, 1);
  assert.equal(memoryIndexStats(pathB).total, 1);
});
