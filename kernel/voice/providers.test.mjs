/**
 * 语音服务商公开档案（纯函数）
 * 跑法：node kernel/voice/providers.test.mjs
 */
import { normalizeVoiceProvider, pickVoiceProvider } from './providers.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass += 1; console.log('  ✅', n); } else { fail += 1; console.error('  ❌', n); } };

console.log('## 归一');
{
  const r = normalizeVoiceProvider({ id: 'local-1', kind: 'local', endpoint: 'http://127.0.0.1:8765/', voiceId: 'v1' });
  ok(r.ok && r.value.endpoint === 'http://127.0.0.1:8765', '去掉尾斜杠');
  ok(r.value.configured === true && r.value.hasKey === false, '本地不需要 Key');
  const c = normalizeVoiceProvider({ id: 'cloud-1', kind: 'cloud', vendor: 'volcano', endpoint: 'https://api.example/v1', model: 'm', voiceId: 'v', appId: 'app-123', accessKey: 'secret-key', speaker: 'S_speaker' });
  ok(c.ok && c.value.configured && c.value.hasAccessKey && c.value.hasAppId, '云端有完整配置');
  ok(c.value.appIdMasked === 'app****23' && c.value.accessKeyMasked === 'sec****ey', 'AppID/AccessKey 只回掩码');
  ok(!JSON.stringify(c.value).includes('secret-key') && !JSON.stringify(c.value).includes('app-123'), '原始 Key/AppID 不落公开档案');
  ok(normalizeVoiceProvider({ id: 'cloud-2', kind: 'cloud', endpoint: 'https://x', appId: 'a' }).value.configured === false, '缺 Key/复刻 ID 未配置');
  ok(normalizeVoiceProvider({ id: 'x', kind: 'weird', endpoint: 'http://x' }).error.code === 'voice-provider.bad-kind', 'kind 拒绝');
  ok(normalizeVoiceProvider({ id: 'x', kind: 'local', endpoint: 'ftp://x' }).error.code === 'voice-provider.bad-endpoint', 'endpoint 拒绝');
  ok(normalizeVoiceProvider({ kind: 'local', endpoint: 'http://x' }).error.code === 'voice-provider.no-id', '缺 id');
}

console.log('\n## 选择');
{
  const list = [
    { id: 'a', kind: 'local', endpoint: 'http://a', configured: true },
    { id: 'b', kind: 'cloud', endpoint: 'http://b', configured: true },
    { id: 'c', kind: 'cloud', endpoint: '', configured: true },
  ];
  ok(pickVoiceProvider(list, { activeId: 'b' })?.id === 'b', 'active 优先');
  ok(pickVoiceProvider(list, { preferKind: 'cloud' })?.id === 'b', 'kind 偏好');
  ok(pickVoiceProvider(list)?.id === 'a', '默认第一个可用');
  ok(pickVoiceProvider([]) === null, '空列表 null');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
