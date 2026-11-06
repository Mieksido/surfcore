// Node Embedding Runtime 合同测试：health/models/auth/embeddings，不启动真 Ollama。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'embedding-runtime-test-'));
const discovery = path.join(temp, 'embedding-service.json');
const port = 20000 + Math.floor(Math.random() * 20000);
const ollamaPort = 20000 + Math.floor(Math.random() * 20000);

const fakeOllama = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    if (req.url !== '/api/embed') { res.writeHead(404); res.end('no'); return; }
    const payload = JSON.parse(body || '{}');
    const inputs = Array.isArray(payload.input) ? payload.input : [payload.input];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ embeddings: inputs.map((_, index) => Array.from({ length: 512 }, (__, i) => (i === index ? 1 : 0))) }));
  });
});
await new Promise((resolve) => fakeOllama.listen(ollamaPort, '127.0.0.1', resolve));

const child = spawn(process.execPath, [path.join(import.meta.dirname, '..', 'plugins', 'surfcore', 'runtime', 'embedding-service.mjs')], {
  env: {
    ...process.env,
    SURFCORE_EMBED_PORT: String(port),
    SURFCORE_EMBED_TOKEN: 'test-token',
    SURFCORE_EMBED_DISCOVERY: discovery,
    SURFCORE_EMBED_PID_FILE: path.join(temp, 'service.pid'),
    SURFCORE_EMBED_OLLAMA_URL: `http://127.0.0.1:${ollamaPort}`,
    SURFCORE_EMBED_DEFAULT_MODEL: 'bge-small-zh-v1.5',
  },
  stdio: 'ignore',
  windowsHide: true,
});

async function waitDiscovery(ms = 8000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (fs.existsSync(discovery)) {
      try { return JSON.parse(fs.readFileSync(discovery, 'utf8')); } catch {}
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('runtime discovery 超时');
}

try {
  const info = await waitDiscovery();
  assert.equal(info.apiVersion, 'v1');
  assert.equal(info.port, port);
  assert.equal(info.token, 'test-token');

  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);

  const models = await fetch(`http://127.0.0.1:${port}/v1/models`, { headers: { Authorization: 'Bearer test-token' } });
  assert.equal(models.status, 200);
  const listed = await models.json();
  assert.ok(listed.data.some((model) => model.id === 'bge-small-zh-v1.5'));

  const unauthorized = await fetch(`http://127.0.0.1:${port}/v1/embeddings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).code, 'auth.invalid');

  const response = await fetch(`http://127.0.0.1:${port}/v1/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    body: JSON.stringify({ model: 'bge-small-zh-v1.5', input: ['你好', '世界'] }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(body.dimension, 512);
  assert.equal(body.model_space, 'bge-small-zh-v1.5@512-f16-v1');
  assert.equal(body.data.length, 2);
  const norm = Math.sqrt(body.data[0].embedding.reduce((sum, n) => sum + n * n, 0));
  assert.ok(Math.abs(norm - 1) < 1e-6, `L2 norm=${norm}`);
  console.log('embedding runtime test: pass');
} finally {
  try { child.kill(); } catch {}
  await new Promise((resolve) => fakeOllama.close(resolve));
  fs.rmSync(temp, { recursive: true, force: true });
}
