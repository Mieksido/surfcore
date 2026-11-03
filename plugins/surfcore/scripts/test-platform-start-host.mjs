/**
 * 平台启动开关的宿主接线（mock ctx，不启动 DSH / 不启停真实桥接）。
 *
 * 钉住：
 *   · 开关关闭时插件加载不会启动生物钟（scheduler.running=false / disabled=true）；
 *   · /overview 暴露 platformStart；
 *   · /bridge 的 start-qq / start-bili / start-all 在开关关闭时不会偷偷拉起平台。
 *
 * 用临时 DSH_HOME，不读写真实 ~/.dsh。
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-platform-host-'));
const stateDir = path.join(tmp, 'surfcore');
fs.mkdirSync(stateDir, { recursive: true });
fs.writeFileSync(path.join(stateDir, 'config.json'), `${JSON.stringify({
  version: 1,
  bridge: { autoStart: true },
  platforms: { start: { qq: false, bili: false } },
}, null, 2)}\n`, 'utf8');

process.env.DSH_HOME = tmp;
process.env.USERPROFILE = tmp;
process.env.SURFCORE_SKIP_AUTOSTART = '1';
process.env.SURFCORE_DISABLE_CHARACTER_MIGRATION = '1';
process.env.SURFCORE_DISABLE_MEMORY_TIMER = '1';

const { apply } = await import('../lib/index.js');

const routes = [];
const effects = [];
const ctx = {
  webServer: { register(route) { routes.push(route); return () => {}; } },
  get(name) {
    if (name === 'connection') return { requestRejection: () => false };
    return null;
  },
  effect(fn) { effects.push(fn); return () => {}; },
  sessionController: {
    inspect: async () => ({ events: [] }),
    create: async () => ({}),
    prompt: async () => ({ accepted: true }),
  },
  settings: null,
};

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers ?? {}; },
    end(body = '') { this.body += body; },
  };
}
function fakeReq(method, url, body) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { host: '127.0.0.1:58750', ...(body ? { 'content-type': 'application/json' } : {}) };
  if (body) {
    process.nextTick(() => {
      req.emit('data', Buffer.from(JSON.stringify(body)));
      req.emit('end');
    });
  }
  return req;
}
async function invoke(route, method, url, body) {
  const res = fakeRes();
  await route.handler(fakeReq(method, url, body), res);
  return { status: res.statusCode, data: JSON.parse(res.body || '{}') };
}

try {
  apply(ctx);
  const api = routes.find((route) => route.path === '/dsh-surfcore/api');
  assert.ok(api, 'API 路由没有注册');

  const overview = await invoke(api, 'GET', '/dsh-surfcore/api/overview');
  assert.equal(overview.status, 200);
  // 2026-11-03：B 站下线，平台开关只剩 qq / douyin；bili 仍回显但恒为关。
  assert.equal(overview.data.platformStart.qq, false, '/overview 的 platformStart.qq 应反映开关');
  assert.equal(overview.data.platformStart.douyin, true, '抖音默认接位（true）');
  assert.equal(overview.data.platformStart.bili, false, 'B 站开关应恒为 false');
  assert.equal(overview.data.scheduler.running, false, 'B 站下线后生物钟不应运行');
  assert.equal(overview.data.scheduler.disabled, true, 'scheduler.disabled 应为 true');

  {
    const res = await invoke(api, 'POST', '/dsh-surfcore/api/bridge', { action: 'start-qq' });
    assert.equal(res.status, 409, 'start-qq 在开关关闭时应拒绝');
    assert.match(String(res.data.error ?? ''), /启动开关/, 'start-qq 的错误文案应说明开关关闭');
  }
  {
    // B 站已下线：老书签打到 start-bili 要明确回 410，而不是假装启动成功。
    const res = await invoke(api, 'POST', '/dsh-surfcore/api/bridge', { action: 'start-bili' });
    assert.equal(res.status, 410, 'start-bili 应回 410 表示已下线');
    assert.match(String(res.data.error ?? ''), /下线/, 'start-bili 的错误文案应说明已下线');
  }

  // 一键启动：两个都关 → 跳过两边，不启动任何进程。
  const all = await invoke(api, 'POST', '/dsh-surfcore/api/bridge', { action: 'start-all' });
  assert.equal(all.status, 200);
  assert.equal(all.data.bridge?.skipped, true, 'QQ 关闭时一键启动应跳过桥接');
  assert.equal(all.data.scheduler?.disabled, true, 'B站 关闭时一键启动应跳过生物钟');
  assert.equal(all.data.snowluma?.skipped, true, 'QQ 关闭时一键启动不应打开 SnowLuma');

  // 保存配置时把开关打开（跳过真实进程，只验证配置落盘与返回值）。
  const saved = await invoke(api, 'POST', '/dsh-surfcore/api/config', {
    unified: { platforms: { start: { qq: true, douyin: true } } },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.platformStart?.qq, true);
  assert.equal(saved.data.platformStart?.douyin, true);
  assert.equal(saved.data.platformStart?.bili, false, 'B 站已下线，回显恒为 false');
  const onDisk = JSON.parse(fs.readFileSync(path.join(stateDir, 'config.json'), 'utf8'));
  assert.equal(onDisk.platforms.start.qq, true);
  assert.equal(onDisk.platforms.start.douyin, true);

  console.log('platform-start host wiring OK');
} finally {
  for (const fn of effects) {
    try {
      const dispose = fn();
      if (typeof dispose === 'function') dispose();
    } catch {}
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}
