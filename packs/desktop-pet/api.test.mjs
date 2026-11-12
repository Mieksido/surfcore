/**
 * 桌宠本地接口形状测试（纯函数，不起 HTTP 服务）
 * 跑法：node packs/desktop-pet/api.test.mjs
 */
import {
  PET_API_PREFIX, PET_API_ROUTES, isLoopbackAddress, isSameOrigin, safeTokenEqual,
  buildPetHostPayload, petAudioUrl, petApiGate, matchPetRoute, describePetApi,
} from './api.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

console.log('## 回环地址');
{
  ok(isLoopbackAddress('127.0.0.1'), '127.0.0.1：本机');
  ok(isLoopbackAddress('127.0.0.2'), '127.x：本机');
  ok(isLoopbackAddress('::1'), 'IPv6 回环');
  ok(isLoopbackAddress('::ffff:127.0.0.1'), 'IPv4-mapped 回环');
  ok(isLoopbackAddress('localhost'), 'localhost');
  ok(!isLoopbackAddress('192.168.1.5'), '内网地址：不算本机');
  ok(!isLoopbackAddress(''), '空：不算');
  ok(!isLoopbackAddress('127.0.0.1.evil.com'), '伪装串：不算');
}

console.log('\n## 同源 / 令牌');
{
  ok(isSameOrigin({ origin: '', host: 'anything' }), '没有 Origin：本机客户端，放行');
  ok(isSameOrigin({ origin: 'http://127.0.0.1:3100', host: '127.0.0.1:3100' }), 'Origin 与 Host 一致：放行');
  ok(!isSameOrigin({ origin: 'http://evil.com', host: '127.0.0.1:3100' }), '跨站：拒绝');
  ok(!isSameOrigin({ origin: 'http://127.0.0.1:3100', host: '' }), '有 Origin 没 Host：拒绝');
  ok(!isSameOrigin({ origin: '不是URL', host: 'x' }), '坏 Origin：拒绝');

  ok(safeTokenEqual('abc', 'abc'), '令牌相同：true');
  ok(!safeTokenEqual('abc', 'abd'), '令牌不同：false');
  ok(!safeTokenEqual('abc', 'abcd'), '长度不同：false');
  ok(safeTokenEqual('', ''), '都空：true（由上层决定空令牌算无效）');
}

console.log('\n## 发现文件 / 音频地址');
{
  const host = buildPetHostPayload({ baseUrl: 'http://127.0.0.1:3100/', token: 't', pluginVersion: '1.2.3', now: 1000 });
  ok(host.api === PET_API_PREFIX && host.version === 1, 'host.json 带前缀与版本');
  ok(host.baseUrl === 'http://127.0.0.1:3100', 'baseUrl 去掉尾部斜杠');
  ok(host.updatedAt === new Date(1000).toISOString(), '更新时间是 ISO');

  const url = petAudioUrl('a1b2-c3!', { token: 't t' });
  ok(url === `${PET_API_PREFIX}/audio/a1b2c3.wav?token=t%20t`, '音频 key 只留十六进制；token 编码');
  ok(petAudioUrl('') === '', '空 key：空地址');
}

console.log('\n## 访问闸门');
{
  const base = { remoteAddress: '127.0.0.1', method: 'GET', expectedToken: 'good' };

  const okGet = petApiGate({ ...base, token: 'good' });
  ok(okGet.ok === true, 'GET + 本机 + 令牌：放行');
  ok(petApiGate({ ...base, queryToken: 'good' }).ok === true, '令牌也可以走 query（音频用）');
  ok(petApiGate({ ...base, token: 'bad' }).code === 'pet.bad-token', '令牌错：401');
  ok(petApiGate({ ...base }).code === 'pet.bad-token', '没带令牌：401');

  ok(petApiGate({ ...base, remoteAddress: '10.0.0.1', token: 'good' }).code === 'pet.not-loopback', '非本机：403');

  const noToken = petApiGate({ remoteAddress: '127.0.0.1', method: 'GET', expectedToken: '', token: 'x' });
  ok(noToken.code === 'pet.no-token' && noToken.status === 401, '服务端还没生成令牌：说清楚');

  const writeOk = petApiGate({
    ...base, method: 'POST', token: 'good', contentType: 'application/json; charset=utf-8',
    origin: 'http://127.0.0.1:3100', host: '127.0.0.1:3100',
  });
  ok(writeOk.ok === true, 'POST + 同源 + JSON：放行');

  ok(petApiGate({ ...base, method: 'POST', token: 'good', contentType: 'application/json', origin: 'http://evil.com', host: '127.0.0.1:3100' }).code === 'pet.cross-origin', '跨站写：403');

  ok(petApiGate({ ...base, method: 'POST', token: 'good', contentType: 'text/plain' }).code === 'pet.not-json', '写操作非 JSON：415');

  const getNoJson = petApiGate({ ...base, method: 'GET', token: 'good', contentType: 'text/plain' });
  ok(getNoJson.ok === true, 'GET 不要求 JSON');
}

console.log('\n## 路由');
{
  ok(PET_API_ROUTES.length === 11, '11 条路由');
  ok(matchPetRoute('GET', `${PET_API_PREFIX}/health`).action === 'health', 'health');
  ok(matchPetRoute('GET', '/health').action === 'health', '不带前缀也认（壳可以自己拼）');
  ok(matchPetRoute('GET', `${PET_API_PREFIX}/status/`).action === 'status', '尾部斜杠容错');
  ok(matchPetRoute('POST', `${PET_API_PREFIX}/chat`).body === 'json', '写路由标了 body=json');
  const audio = matchPetRoute('GET', `${PET_API_PREFIX}/audio/AbC123.wav`);
  ok(audio.action === 'audio' && audio.params.key === 'abc123', '音频 key 小写化');
  ok(matchPetRoute('GET', `${PET_API_PREFIX}/audio/../secret.wav`) === null, '路径穿越：不匹配');
  ok(matchPetRoute('DELETE', `${PET_API_PREFIX}/chat`) === null, '方法不对：不匹配');
  ok(matchPetRoute('GET', `${PET_API_PREFIX}/nope`) === null, '未知路径：null');

  const d = describePetApi();
  ok(d.prefix === PET_API_PREFIX && d.routes.length === 11, '摘要：前缀 + 路由数');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
