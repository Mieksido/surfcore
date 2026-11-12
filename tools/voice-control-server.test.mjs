/**
 * 语音模型控制面 HTTP 测试（回环 + token；不启语音进程）
 * 跑法：node tools/voice-control-server.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createVoiceControlServer } from './voice-control-server.mjs';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass += 1; console.log('  ✅', n); } else { fail += 1; console.error('  ❌', n); } };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-voice-control-'));
const svc = createVoiceControlServer({ port: 0, stateDir: dir, token: 'test-token' });
const info = await svc.start();
const base = `http://127.0.0.1:${info.port}`;
const headers = { 'x-voice-token': 'test-token', 'content-type': 'application/json' };

try {
  console.log('## health/auth');
  {
    const h = await fetch(`${base}/health`);
    ok(h.status === 200, 'health 公开');
    const no = await fetch(`${base}/voice/status`);
    ok(no.status === 401, '无 token 401');
    const s = await fetch(`${base}/voice/status`, { headers });
    const j = await s.json();
    ok(s.status === 200 && j.ok && Array.isArray(j.models) && Array.isArray(j.providers), 'status 有 models/providers');
    ok(!JSON.stringify(j).includes('"dir"') && !JSON.stringify(j).includes('"port"'), 'status 不含 dir/port');
  }

  console.log('\n## provider 配置');
  {
    const r = await fetch(`${base}/voice/providers`, { method: 'POST', headers, body: JSON.stringify({ id: 'local', kind: 'local', endpoint: 'http://127.0.0.1:8765', voiceId: 'v1' }) });
    const j = await r.json();
    ok(r.status === 200 && j.ok && j.provider.hasKey === false, '创建本地 provider');
    const list = await (await fetch(`${base}/voice/providers`, { headers })).json();
    ok(list.providers.length === 1 && !JSON.stringify(list).includes('secret'), '列表无 Key');
    const del = await fetch(`${base}/voice/providers/local`, { method: 'DELETE', headers });
    ok(del.status === 200, '删除 provider');
  }

  console.log('\n## 选择当前模型');
  {
    fs.writeFileSync(path.join(dir, 'voice-models.json'), JSON.stringify({ version: 1, active: '', models: { local: { id: 'local', kind: 'local', voiceId: 'v1', label: '本地', runtime: { endpoint: 'http://127.0.0.1:1', transport: 'voxd' } } } }));
    const r = await fetch(`${base}/voice/models/select`, { method: 'POST', headers, body: JSON.stringify({ modelId: 'local' }) });
    const j = await r.json();
    ok(r.status === 200 && j.ok && j.active === 'local', 'select 返回 active');
    const s = await (await fetch(`${base}/voice/status`, { headers })).json();
    ok(s.active === 'local', 'status 带 active');
  }

  console.log('\n## 模型操作错误路径');
  {
    const r = await fetch(`${base}/voice/models/load`, { method: 'POST', headers, body: JSON.stringify({ modelId: 'nope' }) });
    const j = await r.json();
    ok(r.status === 400 && j.ok === false && j.error.code === 'voice-model.unknown', '未知模型明确失败');
    const p = await fetch(`${base}/voice/models/synthesize`, { method: 'POST', headers, body: JSON.stringify({ modelId: 'nope', text: 'x' }) });
    const pj = await p.json();
    ok(p.status === 400 && pj.error.code === 'voice-model.unknown', '未知模型合成失败');
  }

  console.log('\n## CORS');
  {
    const r = await fetch(`${base}/voice/status`, { headers: { ...headers, origin: 'http://127.0.0.1:16460' } });
    ok(r.headers.get('access-control-allow-origin') === 'http://127.0.0.1:16460', '本机源放行');
    const evil = await fetch(`${base}/voice/status`, { headers: { ...headers, origin: 'https://evil.example' } });
    ok(!evil.headers.get('access-control-allow-origin'), '外部源不加 CORS');
  }
} finally {
  await svc.stop();
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
