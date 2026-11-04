// DSH 端口探测回归：只碰本机回环上的临时服务器，不读真实配置、不发 QQ 消息。
//
// 为什么值得一条测试：这条兜底决定「桥接到底把消息投给谁」。端口探测错了不会崩，
// 只会让每条 QQ 消息都 401/超时——表现为「QQ 有消息、DSH 毫无反应」，是最难自查的一类。
import assert from 'node:assert/strict';
import http from 'node:http';
import { isLoopbackBaseUrl, looksLikeDsh, probeDshBaseUrl } from '../src/dsh-port.js';

/** 起一个可控的小服务器，返回 { port, close }。 */
async function serve(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}

// 1) 未鉴权的 DSH 回 401：算活着。
const unauthorized = await serve((req, res) => { res.statusCode = 401; res.end('unauthorized'); });
assert.equal(await looksLikeDsh(unauthorized.port), true, '401 说明端口上有 DSH');
assert.equal(await probeDshBaseUrl(`http://127.0.0.1:${unauthorized.port}`), true);
await unauthorized.close();

// 2) 200 + SERVER: dsh 也算（部分构建的根路径会直接返回页面）。
const dsh200 = await serve((req, res) => { res.setHeader('server', 'dsh/0.2.1'); res.statusCode = 200; res.end('ok'); });
assert.equal(await looksLikeDsh(dsh200.port), true);
await dsh200.close();

// 2.5) 桌面内嵌宿主没有 server: dsh，但 /api/status 形状是 DSH：也要认。
const embedded = await serve((req, res) => {
  if (req.url.startsWith('/api/status')) {
    res.setHeader('content-type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, modelConnection: { module: 'coo' }, latestEventCursor: 12 }));
    return;
  }
  res.statusCode = 200;
  res.end('<!doctype html><title>DSH Desktop</title>');
});
assert.equal(await probeDshBaseUrl(`http://127.0.0.1:${embedded.port}`), true,
  'HTTP 通且 /api/status 像 DSH 时不能误报连不上');
await embedded.close();

// 3) 端口上的东西不像 DSH（200 但没有 dsh 头）：不能认。
const stranger = await serve((req, res) => { res.setHeader('server', 'nginx'); res.statusCode = 200; res.end('hi'); });
assert.equal(await looksLikeDsh(stranger.port), false, '别把别的 Web 服务当成 DSH');
assert.equal(await probeDshBaseUrl(`http://127.0.0.1:${stranger.port}`), false);
await stranger.close();

// 4) 端口没人听：探测必须快速失败，不能挂住启动。
const gone = await serve(() => {});
const deadPort = gone.port;
await gone.close();
assert.equal(await looksLikeDsh(deadPort, 500), false);
assert.equal(await probeDshBaseUrl(`http://127.0.0.1:${deadPort}`, 500), false);
assert.equal(await probeDshBaseUrl('', 500), false, '空地址直接 false');

// 5) 只有回环地址才允许被本地探测覆盖（远程 DSH 是用户显式配置的）。
assert.equal(isLoopbackBaseUrl('http://127.0.0.1:42212'), true);
assert.equal(isLoopbackBaseUrl('http://localhost:3080/'), true);
assert.equal(isLoopbackBaseUrl('http://[::1]:3080'), true);
assert.equal(isLoopbackBaseUrl('https://dsh.example.com'), false);
assert.equal(isLoopbackBaseUrl('http://192.168.1.20:3080'), false);
assert.equal(isLoopbackBaseUrl(''), false);

console.log('dsh-port tests OK');
