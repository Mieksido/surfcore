/**
 * web 包：安全抓取测试（纯函数 + 假 DNS；不联网）
 * 跑法：node packs/web/fetch.test.mjs
 */
import { isPrivateIp, validateFetchUrl, resolveSafeAddresses, safeFetch, WebError } from './fetch.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };
const throws = async (fn, code) => {
  try { await fn(); return false; } catch (error) { return error instanceof WebError && (!code || error.code === code); }
};

console.log('## 内网地址');
{
  ok(isPrivateIp('127.0.0.1'), '127.0.0.1');
  ok(isPrivateIp('10.0.0.1'), '10/8');
  ok(isPrivateIp('172.16.0.1'), '172.16/12');
  ok(isPrivateIp('192.168.1.1'), '192.168/16');
  ok(isPrivateIp('169.254.1.1'), '链路本地');
  ok(isPrivateIp('100.64.0.1'), 'CGNAT');
  ok(isPrivateIp('0.0.0.0'), '0/8');
  ok(isPrivateIp('224.0.0.1'), '多播');
  ok(isPrivateIp('::1'), 'IPv6 环回');
  ok(isPrivateIp('fd00::1'), 'IPv6 唯一本地');
  ok(isPrivateIp('fe80::1'), 'IPv6 链路本地');
  ok(isPrivateIp('::ffff:192.168.1.1'), 'IPv4-mapped');
  ok(!isPrivateIp('8.8.8.8'), '公网 IPv4');
  ok(!isPrivateIp('1.1.1.1'), '公网 IPv4（另一个）');
  ok(isPrivateIp('不是IP'), '非法地址：当不安全');
}

console.log('\n## URL 校验');
{
  ok(validateFetchUrl('https://example.com/a?b=1').hostname === 'example.com', 'https 公网：通过');
  ok(validateFetchUrl('http://example.com').protocol === 'http:', 'http 也允许');
  ok(await throws(() => validateFetchUrl('file:///etc/passwd'), 'web.bad-protocol'), 'file：拒绝');
  ok(await throws(() => validateFetchUrl('ftp://example.com'), 'web.bad-protocol'), 'ftp：拒绝');
  ok(await throws(() => validateFetchUrl('http://localhost:3000'), 'web.private-host'), 'localhost：拒绝');
  ok(await throws(() => validateFetchUrl('http://foo.local'), 'web.private-host'), '.local：拒绝');
  ok(await throws(() => validateFetchUrl('http://127.0.0.1'), 'web.private-ip'), '环回字面量：拒绝');
  ok(await throws(() => validateFetchUrl('http://10.0.0.1'), 'web.private-ip'), '私网字面量：拒绝');
  ok(await throws(() => validateFetchUrl('http://user:pass@example.com'), 'web.credentials'), '带凭据：拒绝');
  ok(await throws(() => validateFetchUrl('不是URL'), 'web.bad-url'), '坏 URL：拒绝');
}

console.log('\n## DNS：所有结果都要检查');
{
  const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }, { address: '2606:2800:220:1::1', family: 6 }];
  const rows = await resolveSafeAddresses('example.com', { lookup: publicLookup });
  ok(rows.length === 2, '公网：全部返回');
  const mixed = async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }];
  ok(await throws(() => resolveSafeAddresses('evil.test', { lookup: mixed }), 'web.private-ip'), '只要有一个内网：拒绝（防 rebinding）');
  const empty = async () => [];
  ok(await throws(() => resolveSafeAddresses('empty.test', { lookup: empty }), 'web.dns-empty'), '空解析：拒绝');
  ok(await throws(() => resolveSafeAddresses('127.0.0.1', { lookup: publicLookup }), 'web.private-ip'), 'IP 字面量：直接查');
}

console.log('\n## safeFetch：坏地址不发出请求');
{
  ok(await throws(() => safeFetch('http://127.0.0.1'), 'web.private-ip'), '环回：拒绝');
  ok(await throws(() => safeFetch('file:///etc/passwd'), 'web.bad-protocol'), 'file：拒绝');
  ok(await throws(() => safeFetch('http://example.com', { lookup: async () => [{ address: '10.0.0.1', family: 4 }] }), 'web.private-ip'), '解析到内网：拒绝');
}

console.log('\n## safeFetch：成功/重定向（假请求，不联网）');
{
  const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const okReq = async () => ({ status: 200, contentType: 'text/plain', text: 'hello', truncated: false });
  const r = await safeFetch('https://example.com/a', { lookup: publicLookup, requestImpl: okReq });
  ok(r.ok && r.text === 'hello' && r.url === 'https://example.com/a', '成功：返回正文/URL');
  ok(r.truncated === false, '没有截断');

  let hop = 0;
  const redirectReq = async () => {
    hop += 1;
    return hop === 1
      ? { status: 302, redirect: '/b' }
      : { status: 200, contentType: 'text/plain', text: 'after', truncated: false };
  };
  const r2 = await safeFetch('https://example.com/a', { lookup: publicLookup, requestImpl: redirectReq });
  ok(r2.url === 'https://example.com/b' && r2.text === 'after', '重定向：相对路径也跟对');

  const loopReq = async () => ({ status: 302, redirect: '/loop' });
  ok(await throws(() => safeFetch('https://example.com/a', { lookup: publicLookup, requestImpl: loopReq, maxRedirects: 2 }), 'web.redirect-limit'), '重定向成环：拒绝');

  const truncReq = async () => ({ status: 200, contentType: 'text/html', text: 'x'.repeat(100), truncated: true });
  const r3 = await safeFetch('https://example.com/a', { lookup: publicLookup, requestImpl: truncReq, maxChars: 20 });
  ok(r3.text.length === 20 && r3.truncated === true, '超长：截断并标记');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
