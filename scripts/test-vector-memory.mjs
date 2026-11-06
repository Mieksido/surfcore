// 向量记忆纯逻辑/存储/客户端单测（不依赖 DSH、插件或真实 Embedding 服务）。
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import {
  appendVectorRecords, effectiveVectorMemoryConfig, embedTexts, loadVectorRecords, mergeVectorRecords,
  missingForIndex, normalizeVectorMemoryConfig, rankVectorMemories, readVectorIndex, recordTextHash,
  recordsFromBiliEntries, recordsFromInboxLines, renderVectorRecallBlock, resolveVectorMemoryPaths,
  vectorIndexPaths, writeVectorIndex,
} from '../src/vector-memory.js';

const temps = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-memory-test-'));
  temps.push(dir);
  return dir;
}
after(() => {
  for (const dir of temps) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

const NOW = Date.parse('2026-11-02T12:00:00+08:00');

test('配置归一化：非法值收敛到安全范围，默认模型空间稳定', () => {
  const cfg = normalizeVectorMemoryConfig({ topK: 999, minScore: -3, injectMaxChars: 99999, batchSize: 0 });
  assert.equal(cfg.topK, 20);
  assert.equal(cfg.minScore, 0);
  assert.equal(cfg.injectMaxChars, 4000);
  assert.equal(cfg.batchSize, 1);
  assert.equal(cfg.model, 'bge-m3');
  assert.equal(cfg.modelSpace, 'bge-m3@1024-f16-v1');
  assert.equal(cfg.provider, 'local');
  const links = normalizeVectorMemoryConfig({ packLinks: { 'bge-m3': 'https://example.com/bge-m3.zip' } });
  assert.equal(links.packLinks['bge-m3'], 'https://example.com/bge-m3.zip');
  assert.equal(links.packLinks['bge-small-zh-v1.5'], '');
  const share = normalizeVectorMemoryConfig({ packShareUrl: 'https://pan.example/s/abc?pwd=1', packSharePassword: '1', packShareDir: 'embedding' });
  assert.equal(share.packShareUrl, 'https://pan.example/s/abc?pwd=1');
  assert.equal(share.packSharePassword, '1');
  assert.equal(share.packShareDir, 'embedding');
  const cloud = effectiveVectorMemoryConfig({ provider: 'cloud', cloudModel: 'BAAI/bge-m3', cloudModelSpace: 'bge-m3@1024-cloud-v1' });
  assert.equal(cloud.provider, 'cloud');
  assert.equal(cloud.model, 'BAAI/bge-m3');
  assert.equal(cloud.modelSpace, 'bge-m3@1024-cloud-v1');
});

test('inbox 摄取：主人/群聊/桌宠/自发/命令/占位符/脱敏', () => {
  const lines = [
    JSON.stringify({ at: '2026-11-01T10:00:00+08:00', platform: 'qq', kind: 'private', senderId: '1', isOwner: true, text: '今天有点累，想抱抱' }),
    JSON.stringify({ at: '2026-11-01T10:01:00+08:00', platform: 'qq', kind: 'group', senderId: '2', groupId: '9', sender: '群友A', text: '我也喜欢那个游戏', direct: true }),
    JSON.stringify({ at: '2026-11-01T10:02:00+08:00', platform: 'pet', isSelf: true, text: '主人今天回来得好晚' }),
    JSON.stringify({ at: '2026-11-01T10:03:00+08:00', platform: 'qq', kind: 'group', senderId: '3', text: '[图片]' }),
    JSON.stringify({ at: '2026-11-01T10:04:00+08:00', platform: 'qq', kind: 'group', senderId: '4', text: '/reset' }),
    JSON.stringify({ at: '2026-11-01T10:05:00+08:00', platform: 'qq', kind: 'private', senderId: '5', isOwner: true, text: '我的手机号 13800138000，密码是 abcdef' }),
  ];
  const records = recordsFromInboxLines(lines, { now: NOW });
  assert.equal(records.length, 4);
  assert.ok(records.some((r) => r.source === 'qq-owner' && r.isOwner === true));
  assert.ok(records.some((r) => r.source === 'qq-group' && r.platform === 'qq'));
  assert.ok(records.some((r) => r.source === 'pet-self' && r.scope === 'pet'));
  const redacted = records.find((r) => r.text.includes('手机号'));
  assert.ok(redacted.text.includes('[手机号已隐藏]'));
  assert.ok(!redacted.text.includes('abcdef'));
  assert.ok(records.every((r) => r.id.startsWith('vm_')));
  assert.equal(new Set(records.map((r) => r.id)).size, records.length);
});

test('B站摄取：sourceId 去重、scope=bili、收藏加权', () => {
  const entries = [
    { id: 'bv1', type: 'video', title: '一个视频', reason: '好看', date: '2026-10-01' },
    { id: 'bv1', type: 'video', title: '重复', date: '2026-10-01' },
    { id: 'd1', type: 'dynamic', text: '今天发了一条动态', at: '2026-10-02T12:00:00+08:00', favorite: true },
  ];
  const records = recordsFromBiliEntries(entries, { now: NOW });
  assert.equal(records.length, 2);
  assert.ok(records.every((r) => r.platform === 'bili' && r.scope === 'bili'));
  const expectedId = 'vm_bili_' + crypto.createHash('sha1').update('bv1').digest('hex').slice(0, 20);
  assert.ok(records.some((r) => r.id === expectedId));
});

test('合并/追加/加载：重复 id 不重复写，加载按时间排序', () => {
  const dir = tempDir();
  const paths = resolveVectorMemoryPaths(dir);
  const a = recordsFromInboxLines([JSON.stringify({ at: '2026-11-01T10:00:00+08:00', senderId: '1', isOwner: true, text: '第一条' })], { now: NOW });
  const b = recordsFromInboxLines([JSON.stringify({ at: '2026-11-01T11:00:00+08:00', senderId: '1', isOwner: true, text: '第二条' })], { now: NOW });
  const merged = mergeVectorRecords(a, [...a, ...b]);
  assert.equal(merged.records.length, 2);
  assert.equal(merged.added.length, 1);
  appendVectorRecords(paths, merged.records);
  const loaded = loadVectorRecords(paths);
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0].text, '第一条');
  assert.equal(loaded[1].text, '第二条');
});

test('索引：二进制往返、missingForIndex、维度/空间校验', () => {
  const dir = tempDir();
  const paths = resolveVectorMemoryPaths(dir);
  const entries = [
    { id: 'a', text: '主人今天很累', title: 't1', platform: 'qq', scope: 'qq', createdAt: '2026-11-01T10:00:00+08:00', importance: 70 },
    { id: 'b', text: 'B站看了一个视频', title: 't2', platform: 'bili', scope: 'bili', createdAt: '2026-10-01T10:00:00+08:00', importance: 40 },
  ];
  const saved = writeVectorIndex(paths, {
    model: 'bge-m3', modelSpace: 'bge-m3@1024-f16-v1', dimension: 4, entries,
    vectors: [[1, 0, 0, 0], [0, 1, 0, 0]], now: NOW,
  });
  assert.equal(saved.ok, true);
  assert.equal(fs.existsSync(vectorIndexPaths(paths, 'bge-m3@1024-f16-v1').json), true);
  assert.equal(readVectorIndex(paths), null, '旧版单索引不应被生产写入');
  const index = readVectorIndex(paths, 'bge-m3@1024-f16-v1');
  assert.equal(index.manifest.count, 2);
  assert.equal(index.manifest.dimension, 4);
  assert.equal(index.vectors.length, 8);
  assert.equal(missingForIndex(entries, index.manifest).length, 0);
  assert.equal(missingForIndex([...entries, { id: 'c', text: '新记录' }], index.manifest).length, 1);
  const changed = [{ ...entries[0], text: '改过的文本' }, entries[1]];
  assert.equal(missingForIndex(changed, index.manifest).length, 1);
  assert.equal(recordTextHash('abc'), recordTextHash('abc'));
  assert.notEqual(recordTextHash('abc'), recordTextHash('abd'));

  // 两个模型空间各一份索引，互不覆盖；记录仍共享。
  const second = writeVectorIndex(paths, {
    model: 'bge-small-zh-v1.5', modelSpace: 'bge-small-zh-v1.5@512-f16-v1', dimension: 4, entries,
    vectors: [[0, 1, 0, 0], [0, 0, 1, 0]], now: NOW,
  });
  assert.equal(second.ok, true);
  assert.notEqual(vectorIndexPaths(paths, 'bge-m3@1024-f16-v1').json, vectorIndexPaths(paths, 'bge-small-zh-v1.5@512-f16-v1').json);
  assert.equal(readVectorIndex(paths, 'bge-m3@1024-f16-v1').manifest.modelSpace, 'bge-m3@1024-f16-v1');
  assert.equal(readVectorIndex(paths, 'bge-small-zh-v1.5@512-f16-v1').manifest.modelSpace, 'bge-small-zh-v1.5@512-f16-v1');
  assert.equal(readVectorIndex(paths, 'unknown@4'), null);
});

test('检索：余弦优先、阈值、topK、平台过滤、敏感排除', () => {
  const entries = [
    { id: 'a', text: '主人今天加班很累', title: '和主人', platform: 'qq', scope: 'qq', createdAt: '2026-11-01T10:00:00+08:00', importance: 80 },
    { id: 'b', text: 'B站看了一个游戏视频', title: '视频', platform: 'bili', scope: 'bili', createdAt: '2026-11-01T10:00:00+08:00', importance: 40 },
    { id: 'c', text: '主人今天心情不好，想抱抱', title: '情绪', platform: 'qq', scope: 'qq', createdAt: '2026-11-01T10:00:00+08:00', importance: 60, sensitive: true },
  ];
  const index = {
    manifest: { modelSpace: 'x', dimension: 4, entries: entries.map((entry, offset) => ({ ...entry, offset })) },
    vectors: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]),
  };
  const hits = rankVectorMemories({ query: '今天加班好累', queryVector: [0.9, 0, 0, 0.1], index, config: { topK: 2, minScore: 0.1 }, platform: 'qq' });
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].id, 'a');
  assert.ok(!hits.some((hit) => hit.id === 'c'));
  const biliHits = rankVectorMemories({ query: '游戏视频', queryVector: [0, 0.9, 0, 0.1], index, config: { topK: 5, minScore: 0.1 }, platform: 'bili' });
  assert.ok(biliHits.every((hit) => ['bili', 'shared'].includes(hit.scope)));
  const none = rankVectorMemories({ query: '完全无关', queryVector: [0, 0, 0, 1], index, config: { topK: 5, minScore: 0.99 }, platform: 'qq' });
  assert.equal(none.length, 0);
});

test('注入块：不超过 maxChars，空命中不注入', () => {
  const hits = [
    { createdAt: '2026-11-01T10:00:00+08:00', text: '主人说今天加班到十点，很累' },
    { createdAt: '2026-10-01T10:00:00+08:00', text: '在B站看了一个很长的视频，讲的是游戏制作' },
  ];
  const block = renderVectorRecallBlock(hits, { maxChars: 120 });
  assert.ok(block.startsWith('【想起的旧事】'));
  assert.ok(block.length <= 120);
  assert.equal(renderVectorRecallBlock([], { maxChars: 120 }), '');
});

test('Embedding 客户端：发现文件 + 批量 + 空间校验 + 缺失/错空间错误', async () => {
  const dir = tempDir();
  const discovery = path.join(dir, 'embedding-service.json');
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const payload = JSON.parse(body || '{}');
      const inputs = Array.isArray(payload.input) ? payload.input : [payload.input];
      const space = payload.model === 'bad-space' ? 'other@1-v1' : 'bge-m3@1024-f16-v1';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        object: 'list', model: payload.model, model_space: space, dimension: 4,
        data: inputs.map((_, index) => ({ object: 'embedding', index, embedding: [1, 0, 0, index] })),
        usage: { prompt_tokens: inputs.length },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(discovery, JSON.stringify({ schema: 1, apiVersion: 'v1', port: server.address().port, token: 't' }));
  try {
    const result = await embedTexts({ config: { discoveryFile: discovery, model: 'bge-m3', modelSpace: 'bge-m3@1024-f16-v1' }, texts: ['a', 'b'] });
    assert.equal(result.dimension, 4);
    assert.equal(result.vectors.length, 2);
    await assert.rejects(
      embedTexts({ config: { discoveryFile: discovery, model: 'bad-space', modelSpace: 'bge-m3@1024-f16-v1' }, texts: ['a'] }),
      (error) => error.code === 'vector.model-space-mismatch',
    );
    await assert.rejects(
      embedTexts({ config: { discoveryFile: path.join(dir, 'missing.json') }, texts: ['a'] }),
      (error) => error.code === 'vector.service-missing',
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
