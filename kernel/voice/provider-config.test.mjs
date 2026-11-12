/**
 * 语音服务商配置（内核 voice）
 * 跑法：node kernel/voice/provider-config.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readVoiceProviders, upsertVoiceProvider, listVoiceProviders, removeVoiceProvider, resolveVoiceProvider, applyCloudProviderConfig } from './provider-config.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass += 1; console.log('  ✅', n); } else { fail += 1; console.error('  ❌', n); } };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-voice-config-'));
const file = path.join(dir, 'providers.json');

console.log('## 新增/掩码');
{
  const r = upsertVoiceProvider({ file, provider: { id: 'local', kind: 'local', endpoint: 'http://127.0.0.1:8765', voiceId: 'v1' } });
  ok(r.ok && r.provider.configured, '本地 provider 可保存');
  const c = upsertVoiceProvider({ file, provider: { id: 'cloud', kind: 'cloud', vendor: 'volcano', endpoint: 'https://api.example/v1', model: 'm', voiceId: 'v', appId: 'app-123', accessKey: 'secret-key', speaker: 'S_speaker' } });
  ok(c.ok && c.provider.accessKeyMasked === 'sec****ey' && c.provider.appIdMasked === 'app****23', 'AppID/AccessKey 只回掩码');
  ok(c.provider.speaker === 'S_speaker' && c.provider.configured, '复刻 ID 可回显、配置完整');
  const list = listVoiceProviders({ file });
  ok(list.length === 2 && !JSON.stringify(list).includes('secret-key'), '列表不含原始 Key');
  ok(readVoiceProviders(file).find((p) => p.id === 'cloud').accessKey === 'secret-key', '落盘保留 accessKey（供探测）');
}

console.log('\n## 写入模型工件');
{
  const artifact = path.join(dir, 'cloud-model');
  fs.mkdirSync(path.join(artifact, 'voices', 'age12-cloud'), { recursive: true });
  fs.writeFileSync(path.join(artifact, 'config.toml'), 'cloud_app_id = ""\ncloud_access_key = ""\ncloud_resource = "old"\n', 'utf8');
  fs.writeFileSync(path.join(artifact, 'voices', 'age12-cloud', 'voice.json'), JSON.stringify({ engine: 'cloud', speaker: '' }), 'utf8');
  const p = resolveVoiceProvider({ file, id: 'cloud' });
  const applied = applyCloudProviderConfig({ artifactDir: artifact, provider: p, voiceId: 'age12-cloud' });
  ok(applied.ok, '写入 config.toml / voice.json');
  const toml = fs.readFileSync(path.join(artifact, 'config.toml'), 'utf8');
  ok(toml.includes('cloud_app_id = "app-123"') && toml.includes('cloud_access_key = "secret-key"') && toml.includes('cloud_resource = "seed-icl-2.0"'), 'config.toml 字段正确');
  ok(JSON.parse(fs.readFileSync(path.join(artifact, 'voices', 'age12-cloud', 'voice.json'), 'utf8')).speaker === 'S_speaker', 'voice.json speaker 正确');
  ok(!JSON.stringify(applied).includes('secret-key'), '写入结果不回显 Key');
}

console.log('\n## 更新不清 Key');
{
  const r = upsertVoiceProvider({ file, provider: { id: 'cloud', endpoint: 'https://api2.example/v1', model: 'm2' } });
  ok(r.ok && resolveVoiceProvider({ file, id: 'cloud' }).accessKey === 'secret-key', '未传 key 保留旧 key');
  ok(r.ok && resolveVoiceProvider({ file, id: 'cloud' }).speaker === 'S_speaker', '未传 speaker 保留旧值');
  ok(r.provider.endpoint === 'https://api2.example/v1', 'endpoint 更新');
}

console.log('\n## 删除');
{
  const r = removeVoiceProvider({ file, id: 'local' });
  ok(r.ok && listVoiceProviders({ file }).length === 1, '删除');
  ok(removeVoiceProvider({ file, id: 'nope' }).ok === false, '不存在明确失败');
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
