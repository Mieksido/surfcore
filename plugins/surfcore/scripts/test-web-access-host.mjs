/**
 * 设置页 Host 判据的端到端回归（服务器部署形态）。
 *
 * 背景（2026-11-17 真事故）：DSH 用 `--host 192.168.3.110` 绑 LAN 地址后，
 * 浏览器端设置页与「Token 额度」全量 403 —— `route()` 只认 `isLoopbackReq()`。
 * 单测 `test-http-guard.mjs` 钉的是纯函数；这里钉的是**接线**：
 * 注册进来的路由到底用哪份策略、`webServer.host` 有没有被真正读到。
 *
 * 做法：mock ctx（webServer.host = 服务器 LAN 地址），用真实路由发请求，
 * 断言三条：
 *   ① 回环 Host 放行；② DSH 绑定地址放行；③ 陌生域名 403 且带 code/hint。
 * 还要断言「关掉 trustBindAddress 就退回只认回环」——这条是回滚路径。
 *
 * 运行：node scripts/test-web-access-host.mjs
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-webaccess-root-'));
const tempDsh = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-webaccess-dsh-'));
const tempState = path.join(tempDsh, 'surfcore');
fs.mkdirSync(path.join(tempRoot, 'src'), { recursive: true });
fs.mkdirSync(tempState, { recursive: true });
fs.writeFileSync(path.join(tempRoot, 'src', 'bridge.js'), '// fixture\n');
fs.writeFileSync(path.join(tempRoot, 'config.json'), JSON.stringify({ consoleToken: 'fixture-token' }, null, 2));
fs.writeFileSync(path.join(tempState, 'config.json'), JSON.stringify({ version: 1 }, null, 2));

process.env.SURFCORE_ROOT = tempRoot;
process.env.DSH_HOME = tempDsh;
process.env.USERPROFILE = tempDsh;
process.env.SURFCORE_SKIP_AUTOSTART = '1';
process.env.SURFCORE_DISABLE_CHARACTER_MIGRATION = '1';
process.env.SURFCORE_DISABLE_MEMORY_TIMER = '1';

const { apply } = await import('../lib/index.js');

const BIND_HOST = '192.168.3.110';
const routes = [];
const ctx = {
  webServer: {
    host: BIND_HOST,
    protocol: 'http:',
    register(route) { routes.push(route); return () => {}; },
  },
  get(name) {
    if (name === 'connection') return { requestRejection: () => false };
    if (name === 'webServer') return { host: BIND_HOST, protocol: 'http:', port: 43120 };
    return null;
  },
  effect(fn) { return () => {}; },
  sessionController: {
    inspect: async () => ({ events: [] }),
    create: async () => ({}),
    prompt: async () => ({ accepted: true }),
  },
  settings: null,
};
apply(ctx);

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers ?? {}; },
    end(body = '') { this.body += body; },
  };
}

function fakeReq(method, url, host) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { host };
  process.nextTick(() => req.emit('end'));
  return req;
}

const health = routes.find((r) => r.path === '/dsh-surfcore/health');
assert.ok(health, 'health 路由必须注册（找不到路由说明接线断了）');

async function call(host) {
  const res = fakeRes();
  await health.handler(fakeReq('GET', '/dsh-surfcore/health', host), res);
  return res;
}

// ① 回环 Host 照旧放行：老行为不能被这次放宽弄坏。
{
  const res = await call('127.0.0.1:43120');
  assert.equal(res.statusCode, 200, '回环 Host 必须 200');
  assert.match(res.body, /"ok":true/, '回环 Host 返回健康体');
}

// ② DSH 自己绑定的地址放行：这就是服务器部署下浏览器发来的 Host。
{
  const res = await call(`${BIND_HOST}:43120`);
  assert.equal(res.statusCode, 200, 'DSH 绑定地址必须 200（本次修复的主路径）');
}

// ③ 陌生域名 403，且必须带 code + hint（AGENTS §1.7：失败可见且可行动）。
{
  const res = await call('evil.example.com');
  assert.equal(res.statusCode, 403, '非允许 Host 必须 403');
  const body = JSON.parse(res.body);
  assert.equal(body.ok, false);
  assert.equal(body.code, 'HOST_NOT_ALLOWED', '403 必须带机器可读 code');
  assert.ok(String(body.hint ?? '').length > 0, '403 必须带可执行的 hint');
}

// ④ 跨站发起一律拒绝：Host 再对也不放行。
{
  const res = fakeRes();
  const req = fakeReq('GET', '/dsh-surfcore/health', `${BIND_HOST}:43120`);
  req.headers['sec-fetch-site'] = 'cross-site';
  process.nextTick(() => req.emit('end'));
  await health.handler(req, res);
  assert.equal(res.statusCode, 403, 'sec-fetch-site=cross-site 必须 403');
}

// ⑤ 回滚路径：关掉 trustBindAddress 就退回「只认回环」。
{
  const unifiedFile = path.join(tempState, 'config.json');
  fs.writeFileSync(unifiedFile, JSON.stringify({ version: 1, webAccess: { trustBindAddress: false } }, null, 2));
  const res = await call(`${BIND_HOST}:43120`);
  assert.equal(res.statusCode, 403, 'trustBindAddress=false 时绑定地址必须被拒（回滚可用）');
  const loop = await call('127.0.0.1:43120');
  assert.equal(loop.statusCode, 200, 'trustBindAddress=false 时回环仍放行');
}

// ⑥ 白名单：写进 unified 的 trustedHosts 必须真的生效。
{
  const unifiedFile = path.join(tempState, 'config.json');
  fs.writeFileSync(unifiedFile, JSON.stringify({
    version: 1,
    webAccess: { trustBindAddress: false, trustedHosts: ['dsh.example.com'] },
  }, null, 2));
  const res = await call('dsh.example.com:43120');
  assert.equal(res.statusCode, 200, '白名单里的主机名必须放行');
  const other = await call('dsh2.example.com:43120');
  assert.equal(other.statusCode, 403, '白名单外的主机名必须被拒');
}

console.log('✅ web-access host 接线回归通过');
