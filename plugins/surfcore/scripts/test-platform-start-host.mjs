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
  assert.deepEqual(overview.data.platformStart, { qq: false, bili: false },
    '/overview 的 platformStart 应反映开关');
  assert.ok(overview.data.launch?.qq && overview.data.launch?.bili && overview.data.launch?.pet && overview.data.launch?.voice, 'overview 必须带统一 launch 状态');
  assert.equal(overview.data.scheduler.running, false, 'B站 开关关闭时生物钟不应运行');
  assert.equal(overview.data.scheduler.disabled, true, 'B站 开关关闭时 scheduler.disabled 应为 true');

  for (const action of ['start-qq', 'start-bili']) {
    const res = await invoke(api, 'POST', '/dsh-surfcore/api/bridge', { action });
    assert.equal(res.status, 409, `${action} 在开关关闭时应拒绝`);
    assert.match(String(res.data.error ?? ''), /启动开关/, `${action} 的错误文案应说明开关关闭`);
  }

  // 新的一键启动：多选 + 每项结构化结果；平台开关关闭时不允许偷偷拉起。
  const selected = await invoke(api, 'POST', '/dsh-surfcore/api/bridge', {
    action: 'start-selected', components: ['qq', 'bili'], voicePack: 'voice-local',
  });
  assert.equal(selected.status, 200);
  assert.equal(selected.data.ok, false, '平台开关关闭时一键启动不能报成功');
  assert.equal(selected.data.items?.length, 2, '每个勾选项都要有独立结果');
  for (const item of selected.data.items) {
    assert.equal(item.ok, false, `${item.id} 应失败`);
    assert.ok(item.code && item.hint, `${item.id} 失败必须有 code/hint`);
  }
  const empty = await invoke(api, 'POST', '/dsh-surfcore/api/bridge', { action: 'start-selected', components: [] });
  assert.equal(empty.data.code, 'NO_COMPONENTS', '空选择必须结构化拒绝');
  assert.ok(empty.data.hint, '空选择必须给下一步');

  const stopped = await invoke(api, 'POST', '/dsh-surfcore/api/bridge', {
    action: 'stop-selected', components: ['qq', 'bili', 'pet', 'voice'],
  });
  assert.equal(stopped.status, 200);
  assert.equal(stopped.data.items?.length, 4, '一键停止要覆盖四项');
  assert.ok(stopped.data.items.every((x) => x.ok), '未运行的服务停止应幂等成功');
  // 2026-11-17：一键停止要和一键启动对称——QQ 这一项也要收掉 SnowLuma。
  const qqStop = stopped.data.items.find((x) => x.id === 'qq');
  assert.equal(qqStop?.detail?.snowluma?.skipped, true, '测试环境必须跳过真实的 SnowLuma 关闭（不能误杀开发机进程）');
  assert.match(String(qqStop?.message || ''), /SnowLuma/, 'QQ 停止项的结果说明里要写清 SnowLuma 怎么处置');

  // 一键启动：两个都关 → 跳过两边，不启动任何进程。
  const all = await invoke(api, 'POST', '/dsh-surfcore/api/bridge', { action: 'start-all' });
  assert.equal(all.status, 200);
  assert.equal(all.data.bridge?.skipped, true, 'QQ 关闭时一键启动应跳过桥接');
  assert.equal(all.data.scheduler?.disabled, true, 'B站 关闭时一键启动应跳过生物钟');
  assert.equal(all.data.snowluma?.skipped, true, 'QQ 关闭时一键启动不应打开 SnowLuma');

  // 保存配置时把开关打开（跳过真实进程，只验证配置落盘与返回值）。
  const saved = await invoke(api, 'POST', '/dsh-surfcore/api/config', {
    unified: { platforms: { start: { qq: true, bili: true } } },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.platformStart?.qq, true);
  assert.equal(saved.data.platformStart?.bili, true);
  const onDisk = JSON.parse(fs.readFileSync(path.join(stateDir, 'config.json'), 'utf8'));
  assert.deepEqual(onDisk.platforms.start, { qq: true, bili: true });

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
