// p-memory 长期记忆后端（可选件）的离线单测。
//
// 覆盖：配置归一与回环限制 / 卡记录映射 / 客户端 fail-soft / 维护后同步（成功·连不上·禁用）/
// 注入文件与状态文件的落盘。默认全程离线——用一个自建的 HTTP 桩冒充 sidecar，
// 只有显式给了 PMEMORY_TEST_URL 时才去跑真 sidecar 的联调用例。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import {
  DEFAULT_PMEMORY_CONFIG, isLoopbackUrl, normalizePmemoryConfig, pmemoryHealth, pmemoryRecall,
} from '../src/pmemory-client.js';
import {
  PMEMORY_PROMPT_FILE, PMEMORY_STATUS_FILE, recordsFromCard, syncPmemory,
} from '../plugins/surfcore/lib/pmemory-backend.js';

const temps = [];
const servers = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmemory-test-'));
  temps.push(dir);
  return dir;
}
after(() => {
  for (const server of servers) {
    try { server.close(); } catch {}
  }
  for (const dir of temps) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

/** 起一个桩 sidecar：`routes` 是 {路径前缀: (req, body) => [status, payload]}。 */
async function stubServer(routes) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://127.0.0.1');
      for (const [prefix, handler] of Object.entries(routes)) {
        if (url.pathname === prefix) {
          const [status, payload] = handler(url, body ? JSON.parse(body) : null);
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(payload));
          return;
        }
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
    });
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test('配置归一：默认关闭；非法值退回默认；非回环地址强制禁用', () => {
  const empty = normalizePmemoryConfig({});
  assert.equal(empty.enabled, false);
  assert.equal(empty.url, DEFAULT_PMEMORY_CONFIG.url);
  assert.equal(empty.timeoutMs, DEFAULT_PMEMORY_CONFIG.timeoutMs);
  assert.equal(empty.hostAllowed, true);

  const broken = normalizePmemoryConfig({
    enabled: true, url: 'not a url', timeoutMs: 'abc', overviewMaxChars: 9e9, recallLimit: 0,
  });
  assert.equal(broken.enabled, false, '非法 url 必须直接禁用');
  assert.equal(broken.timeoutMs, DEFAULT_PMEMORY_CONFIG.timeoutMs);
  assert.equal(broken.overviewMaxChars, 10000, '超大值夹到上限');
  assert.equal(broken.recallLimit, 1, '0 夹到下限');

  const lan = normalizePmemoryConfig({ enabled: true, url: 'http://192.168.1.9:8791' });
  assert.equal(lan.hostAllowed, false);
  assert.equal(lan.enabled, false, '私人记忆后端只许连回环');
});

test('回环判定：只认 127.0.0.1 / localhost / ::1，且必须是 http(s)', () => {
  for (const url of ['http://127.0.0.1:8791', 'https://localhost:1', 'http://[::1]:8791']) {
    assert.equal(isLoopbackUrl(url), true, url);
  }
  for (const url of ['http://10.0.0.2:8791', 'ftp://127.0.0.1', 'http://example.com', '', null]) {
    assert.equal(isLoopbackUrl(url), false, String(url));
  }
});

test('客户端 fail-soft：禁用不联网；连不上不抛错', async () => {
  const disabled = normalizePmemoryConfig({ enabled: false });
  assert.deepEqual(await pmemoryHealth(disabled), { ok: false, error: 'disabled' });
  assert.deepEqual(await pmemoryRecall(disabled, { query: '测试' }), { ok: false, error: 'disabled' });

  // 关掉的端口：ENOENT/ECONNREFUSED 必须被吃成 {ok:false}，不能冒泡。
  const dead = normalizePmemoryConfig({ enabled: true, url: 'http://127.0.0.1:1', timeoutMs: 800 });
  const failed = await pmemoryHealth(dead);
  assert.equal(failed.ok, false);
  assert.ok(typeof failed.error === 'string' && failed.error.length > 0);

  // 空查询词直接拒绝，不打网络。
  assert.deepEqual(await pmemoryRecall(dead, { query: '   ' }), { ok: false, error: 'empty-query' });
});

test('卡记录映射：丢掉空文本、补上 importance 与时间戳、遵守上限', () => {
  const card = {
    records: [
      {
        id: 'm1', text: '主人在写药学作业', title: '主人日常', kind: 'owner', scope: 'owner',
        importance: 72, tags: ['学业'], createdAt: '2026-11-01T10:00:00.000Z', speaker: '主人',
      },
      { id: 'm2', text: '   ', title: '空', kind: 'owner', importance: 50 },
      { id: 'm3', text: '群友在聊训练', title: '群聊', kind: 'group', importance: 30, createdAt: 'bad date' },
    ],
  };
  const records = recordsFromCard(card);
  assert.equal(records.length, 2);
  assert.equal(records[0].text, '主人在写药学作业');
  assert.equal(records[0].importance, 72);
  assert.deepEqual(records[0].tags, ['学业']);
  assert.equal(records[0].surfcoreId, 'm1');
  assert.equal(records[0].createdAt, Date.parse('2026-11-01T10:00:00.000Z'), '毫秒时间戳，与契约一致');
  assert.equal(records[1].createdAt, undefined, '坏日期不硬造时间戳');

  assert.equal(recordsFromCard(card, { limit: 1 }).length, 1);
  assert.deepEqual(recordsFromCard({}), []);
});

test('维护后同步：成功时写注入文件与状态，镜像条数如实记账', async () => {
  let consumed = null;
  const url = await stubServer({
    '/health': () => [200, { ok: true, engine: 'p-memory', engineVersion: '0.3.4', schemaVersion: 15, total: 2 }],
    '/consume': (_u, body) => { consumed = body; return [200, { ok: true, upserted: body.records.length, skipped: 0, total: 2 }]; },
    '/overview': () => [200, { ok: true, text: '【长期记忆 · 全量库（p-memory）】\n- 主人在写药学作业', count: 1, total: 2 }],
  });
  const dir = tempDir();
  const card = { records: [{ id: 'm1', text: '主人在写药学作业', importance: 72, kind: 'owner' }] };
  const status = await syncPmemory({
    config: normalizePmemoryConfig({ enabled: true, url, mirrorOnMaintenance: true }),
    card,
    paths: { dir },
    now: Date.parse('2026-11-02T12:00:00+08:00'),
  });
  assert.equal(status.state, 'synced');
  assert.equal(status.mirrored, 1);
  assert.equal(consumed.records.length, 1);
  assert.equal(consumed.records[0].text, '主人在写药学作业');

  const prompt = fs.readFileSync(path.join(dir, PMEMORY_PROMPT_FILE), 'utf8');
  assert.match(prompt, /主人在写药学作业/);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, PMEMORY_STATUS_FILE), 'utf8'));
  assert.equal(saved.state, 'synced');
  assert.equal(saved.engineVersion, '0.3.4');
});

test('维护后同步：连不上时保留旧注入文件（一次重启不该清空长记忆）', async () => {
  const dir = tempDir();
  const promptFile = path.join(dir, PMEMORY_PROMPT_FILE);
  fs.writeFileSync(promptFile, '【长期记忆】旧内容\n', 'utf8');
  const status = await syncPmemory({
    config: normalizePmemoryConfig({ enabled: true, url: 'http://127.0.0.1:1', timeoutMs: 600 }),
    card: null,
    paths: { dir },
  });
  assert.equal(status.state, 'unreachable');
  assert.equal(fs.readFileSync(promptFile, 'utf8'), '【长期记忆】旧内容\n');
  const saved = JSON.parse(fs.readFileSync(path.join(dir, PMEMORY_STATUS_FILE), 'utf8'));
  assert.equal(saved.state, 'unreachable');
});

test('维护后同步：没开时清空注入文件（设置关了就不能留着旧提示词）', async () => {
  const dir = tempDir();
  const promptFile = path.join(dir, PMEMORY_PROMPT_FILE);
  fs.writeFileSync(promptFile, '【长期记忆】旧内容\n', 'utf8');
  const status = await syncPmemory({ config: normalizePmemoryConfig({ enabled: false }), card: null, paths: { dir } });
  assert.equal(status.state, 'disabled');
  assert.equal(fs.readFileSync(promptFile, 'utf8'), '');
});

test('维护后同步：sidecar 回 500 时按不可用处理，不抛错', async () => {
  const url = await stubServer({
    '/health': () => [200, { ok: true, engine: 'p-memory' }],
    '/overview': () => [500, { ok: false, error: 'boom' }],
  });
  const dir = tempDir();
  const status = await syncPmemory({
    config: normalizePmemoryConfig({ enabled: true, url, mirrorOnMaintenance: false }),
    card: null,
    paths: { dir },
  });
  assert.equal(status.state, 'unreachable');
  assert.match(String(status.error), /boom/);
});

// 真 sidecar 联调：只有显式设置 PMEMORY_TEST_URL 才跑，例如
//   $env:PMEMORY_TEST_URL='http://127.0.0.1:8791'; node --test scripts/test-memory-pmemory-backend.mjs
const LIVE_URL = process.env.PMEMORY_TEST_URL;
test('联调（需真 sidecar）：写入后中文关键词能召回', { skip: !LIVE_URL && '未设置 PMEMORY_TEST_URL' }, async () => {
  const config = normalizePmemoryConfig({ enabled: true, url: LIVE_URL, namespace: 'surfcore-test', timeoutMs: 15000 });
  const health = await pmemoryHealth(config);
  assert.equal(health.ok, true, `sidecar 不可用：${health.error}`);
  const { pmemoryConsume } = await import('../src/pmemory-client.js');
  const written = await pmemoryConsume(config, {
    namespace: 'surfcore-test',
    records: [{ text: '主人在复习药理学的受体激动剂分类', type: 'owner', importance: 66, tags: ['药理学'] }],
  });
  assert.equal(written.ok, true, JSON.stringify(written));
  const hits = await pmemoryRecall(config, { query: '受体激动剂' });
  assert.equal(hits.ok, true, JSON.stringify(hits));
  assert.ok(Array.isArray(hits.data.hits) && hits.data.hits.length >= 1, '中文检索必须命中');
});
