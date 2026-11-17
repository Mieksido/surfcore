// 本机 HTTP 护栏（lib/http-guard.js）的单测：设置页 API 与桌宠 API 共用这一份判据。
//
// 为什么值得单独钉：这两个函数是**唯一**挡在网页 / 跨站请求前面的判据，
// 剩下那层（DSH 的 requestRejection、桌宠的 x-pet-token）各管一边。
// 判据写错的表现是"接口照样能用"，不会报错——所以必须有回归测试。
import assert from 'node:assert/strict';
import { isAllowedHost, isLoopbackReq, json, readBody, sameOrigin, safeEqual } from '../lib/http-guard.js';

let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log(`✅ ${label}`);
  else { failures += 1; console.error(`❌ ${label}`); }
};

console.log('## 1. 只接受回环 Host');
{
  const req = (host) => ({ headers: host === undefined ? {} : { host } });
  for (const host of ['127.0.0.1:3100', 'localhost:57981', '[::1]:8080', '::1', 'LOCALHOST:1']) {
    ok(isLoopbackReq(req(host)), `放行回环 Host：${host}`);
  }
  for (const host of ['192.168.1.5:3100', 'evil.com', '127.0.0.1.evil.com', '', undefined, '0.0.0.0:3100']) {
    ok(!isLoopbackReq(req(host)), `拒绝非回环 Host：${host === undefined ? '(缺失)' : JSON.stringify(host)}`);
  }
}

console.log('## 1b. 设置页 Host 允许策略（2026-11-17：服务器部署要能远程打开网页端）');
{
  const req = (host, extra = {}) => ({ headers: { host, ...extra } });
  // 默认策略：信任 DSH 绑定地址，白名单为空。
  const serverPolicy = { bindHost: '192.168.3.110', trustBindAddress: true, trustedHosts: [] };
  ok(isAllowedHost(req('192.168.3.110:43120'), serverPolicy), '放行 DSH 绑定的地址（服务器部署的主路径）');
  ok(isAllowedHost(req('127.0.0.1:43120'), serverPolicy), '回环照旧放行');
  ok(!isAllowedHost(req('192.168.3.111:43120'), serverPolicy), '同网段别的 IP 不放行（绑定地址才受信）');
  ok(!isAllowedHost(req('evil.com'), serverPolicy), '外部域名不放行');
  ok(!isAllowedHost(req('192.168.3.110.evil.com'), serverPolicy), '后缀伪装不放行');

  // 关掉「信任绑定地址」= 回到旧行为（只认回环）。
  const loopbackOnly = { bindHost: '192.168.3.110', trustBindAddress: false, trustedHosts: [] };
  ok(!isAllowedHost(req('192.168.3.110:43120'), loopbackOnly), 'trustBindAddress=false 时绑定地址也不放行（可回退）');
  ok(isAllowedHost(req('127.0.0.1:1'), loopbackOnly), 'trustBindAddress=false 仍放行回环');

  // 用户白名单：不带端口 = 任意端口；带端口 = 精确匹配那个端口。
  const withList = { bindHost: '192.168.3.110', trustBindAddress: false, trustedHosts: ['dsh.example.com', '10.0.0.5:8443'] };
  ok(isAllowedHost(req('dsh.example.com'), withList), '白名单主机名（无端口）放行任意端口');
  ok(isAllowedHost(req('DSH.Example.com:43120'), withList), '白名单匹配大小写不敏感');
  ok(isAllowedHost(req('10.0.0.5:8443'), withList), '白名单带端口精确匹配');
  ok(!isAllowedHost(req('10.0.0.5:43121'), withList), '白名单带端口时别的端口不放行');

  // 跨站发起一律拒绝：Host 再对也不放行（与 DSH 的 sec-fetch-site 判据同源）。
  ok(!isAllowedHost(req('192.168.3.110:43120', { 'sec-fetch-site': 'cross-site' }), serverPolicy), 'sec-fetch-site=cross-site 一律拒绝');

  // 坏输入 fail-closed。
  ok(!isAllowedHost({ headers: {} }, serverPolicy), '没有 Host → 拒绝');
  ok(!isAllowedHost(req('[::1'), serverPolicy), '方括号没闭合 → 拒绝');
  ok(!isAllowedHost(req('192.168.3.110:43120'), {}), '没有 bindHost 也没有白名单 → 拒绝（默认不放开）');
}

console.log('## 2. 写操作同源校验');
{
  const req = (origin, host = '127.0.0.1:57981') => ({ headers: origin === undefined ? { host } : { origin, host } });
  ok(sameOrigin(req(undefined)), '没带 Origin（curl / 桌宠主进程）放行');
  ok(sameOrigin(req('http://127.0.0.1:57981')), 'Origin 与 Host 一致放行');
  ok(!sameOrigin(req('http://evil.com')), '跨站 Origin 拒绝');
  ok(!sameOrigin(req('http://127.0.0.1:9999')), '端口不同（不同源）拒绝');
  ok(!sameOrigin(req('not a url')), 'Origin 解析失败时拒绝（fail-closed）');
  ok(!sameOrigin({ headers: { origin: 'http://127.0.0.1:57981' } }), 'Origin 存在但缺 Host（无从比对）→ 拒绝');
}

console.log('## 3. 令牌定长比较');
{
  ok(safeEqual('abc123', 'abc123'), '相同令牌 → true');
  ok(!safeEqual('abc123', 'abc124'), '等长不同 → false');
  ok(!safeEqual('abc', 'abc123'), '长度不同 → false（不抛）');
  ok(!safeEqual(undefined, 'abc'), '缺失令牌 → false');
  ok(!safeEqual('', ''), '空对空 → false（空令牌永不通过，fail-closed）');
  ok(safeEqual(12345, '12345'), '数字与同值字符串按字符串比较 → true（调用方负责先校验非空）');
}

console.log('## 4. readBody 上限');
{
  const fakeReq = (payload, limit) => {
    const handlers = {};
    const req = {
      on: (evt, fn) => { handlers[evt] = fn; return req; },
      destroy: () => { req.destroyed = true; },
      destroyed: false,
    };
    readBody(req, limit).then(
      (text) => { req.text = text; },
      (error) => { req.error = error.message; },
    );
    handlers.data?.(Buffer.from(payload));
    handlers.end?.();
    return req;
  };
  const under = fakeReq('{"a":1}', 1024);
  const over = fakeReq('x'.repeat(2048), 1024);
  await new Promise((resolve) => setTimeout(resolve, 30));
  ok(under.text === '{"a":1}', '小于上限时原样读出');
  ok(over.error === '请求体过大', '超过上限时报「请求体过大」而不是静默截断');
}

console.log('## 5. json 响应');
{
  const res = {
    statusCode: 0,
    headers: null,
    body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
    end(text) { this.body = text; },
  };
  json(res, 201, { ok: true, n: 2 });
  ok(res.statusCode === 201, '状态码原样写入');
  ok(String(res.headers?.['Content-Type'] ?? '').includes('application/json'), 'Content-Type = application/json');
  ok(res.headers?.['Cache-Control'] === 'no-store', '缓存一律 no-store（配置/记忆不能被浏览器缓存）');
  ok(res.body === '{"ok":true,"n":2}', '响应体是 JSON');
  // res 已关闭不能再抛：上层还会写日志，抛出去会变成 500 噪音。
  let threw = false;
  try { json({ writeHead() { throw new Error('closed'); }, end() {} }, 200, {}); } catch { threw = true; }
  ok(!threw, 'res 已关闭时不抛');
}

console.log(failures === 0 ? '\n✅ http-guard 通过' : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
