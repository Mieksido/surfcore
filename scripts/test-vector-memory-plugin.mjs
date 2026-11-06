// 插件维护器端到端（临时 DSH_HOME + 假 Embedding 服务，不碰真实用户数据）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeVectorRecords, resolveVectorMemoryPaths, vectorIndexPaths } from '../src/vector-memory.js';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-memory-plugin-'));
const dsh = path.join(temp, 'dsh');
const surfcore = path.join(dsh, 'surfcore');
const memoryDir = path.join(surfcore, 'memory');
fs.mkdirSync(memoryDir, { recursive: true });
process.env.DSH_HOME = dsh;
// 隔离 legacy 仓库根：否则 readBiliEntries() 会读真实 state/bili-memory.json，
// 测试结果会随本机数据变化（2026-11-04 主工作区合并后踩到）。
const repoRoot = path.join(temp, 'repo');
fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
fs.writeFileSync(path.join(repoRoot, 'config.json'), '{}');
fs.writeFileSync(path.join(repoRoot, 'src', 'bridge.js'), '');
process.env.SURFCORE_ROOT = repoRoot;

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const payload = JSON.parse(body || '{}');
    const inputs = Array.isArray(payload.input) ? payload.input : [payload.input];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      object: 'list', model: payload.model, model_space: 'bge-m3@1024-f16-v1', dimension: 4,
      data: inputs.map((text, index) => ({ object: 'embedding', index, embedding: [1, index / 10, 0, 0] })),
      usage: { prompt_tokens: inputs.length },
    }));
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const discovery = path.join(surfcore, 'embedding-service.json');
fs.writeFileSync(discovery, JSON.stringify({ schema: 1, apiVersion: 'v1', port: server.address().port, token: 't' }));
const config = {
  enabled: true, model: 'bge-m3', modelSpace: 'bge-m3@1024-f16-v1',
  discoveryFile: discovery, batchSize: 2, maxEmbedPerTick: 10,
};
fs.writeFileSync(path.join(surfcore, 'config.json'), JSON.stringify({ memory: { mode: 'narrative' }, vectorMemory: config }));

const inbox = path.join(memoryDir, 'memory-inbox.jsonl');
fs.writeFileSync(inbox, [
  JSON.stringify({ at: '2026-11-01T10:00:00+08:00', kind: 'private', senderId: '1', isOwner: true, text: '主人今天有点累，想抱抱' }),
  JSON.stringify({ at: '2026-11-01T10:05:00+08:00', kind: 'group', senderId: '2', groupId: '9', sender: '群友', text: '今天聊了很多游戏的事' }),
].join('\n') + '\n');

const mod = await import('../plugins/surfcore/lib/vector-memory.js?test=plugin');
try {
  const first = await mod.runVectorMemoryMaintenance({ config: mod.vectorMemoryConfig() });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.embedded, 2);
  const status = mod.vectorMemoryStatusNow(config);
  assert.equal(status.records, 2);
  assert.equal(status.indexed, 2);
  assert.equal(status.pending, 0);
  assert.equal(status.mode, 'narrative');
  assert.ok(fs.existsSync(path.join(memoryDir, 'vector-memory.jsonl')));
  const indexPaths = vectorIndexPaths(resolveVectorMemoryPaths(memoryDir), config.modelSpace);
  assert.ok(fs.existsSync(indexPaths.json));
  assert.ok(fs.existsSync(indexPaths.bin));
  const second = await mod.runVectorMemoryMaintenance({ config: mod.vectorMemoryConfig() });
  assert.equal(second.ok, true);
  assert.equal(second.embedded, 0);
  fs.appendFileSync(path.join(memoryDir, 'vector-memory.jsonl'), JSON.stringify({ id: 'blank-1', text: '   ', platform: 'qq', createdAt: '2026-11-01T10:10:00.000Z' }) + '\n');
  assert.equal(mod.vectorMemoryStatusNow(config).records, 2);
  assert.equal(mergeVectorRecords([], [{ id: 'blank-2', text: ' \n ' }]).added.length, 0);
  const rebuilt = await mod.rebuildVectorMemory(config);
  assert.equal(rebuilt.ok, true, JSON.stringify(rebuilt));
  assert.equal(rebuilt.rebuilt, true);
  assert.equal(rebuilt.status?.pending, 0);

  const listed = await mod.listVectorMemoryRecords({ config, limit: 10 });
  assert.equal(listed.ok, true);
  assert.equal(listed.total, 2);
  assert.equal(listed.visible, 2);
  assert.equal(listed.items.length, 2);
  fs.appendFileSync(path.join(memoryDir, 'vector-memory.jsonl'), JSON.stringify({
    id: 'sensitive-1', text: '敏感测试正文', platform: 'qq', source: 'qq-owner',
    sensitive: true, createdAt: '2026-11-01T10:11:00.000Z',
  }) + '\n');
  const hidden = await mod.listVectorMemoryRecords({ config, limit: 10 });
  assert.equal(hidden.total, 3);
  assert.equal(hidden.visible, 2);
  assert.equal(hidden.items.some((item) => item.id === 'sensitive-1'), false);

  const searched = await mod.searchVectorMemoryRecords({ config, query: '主人今天有点累', limit: 5 });
  assert.equal(searched.ok, true, JSON.stringify(searched));
  assert.ok(searched.hits.length > 0);
  assert.equal(searched.hits.some((hit) => hit.id === 'sensitive-1'), false);

  const disabled = await mod.runVectorMemoryMaintenance({ config: { ...config, enabled: false } });
  assert.equal(disabled.disabled, true);
  console.log('vector-memory plugin test: pass');
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(temp, { recursive: true, force: true });
}
