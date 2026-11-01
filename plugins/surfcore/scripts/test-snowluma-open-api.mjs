import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// 本测试必须在 Debian 独立网络命名空间中执行。
if (process.env.SURFCORE_API_TEST_ISOLATED !== '1') {
  throw new Error('拒绝执行：未标记为隔离测试环境');
}
assert.equal(process.platform, 'linux');
assert.equal(process.env.DISPLAY, undefined);
assert.equal(process.env.WAYLAND_DISPLAY, undefined);

const tmp = fs.mkdtempSync(
  path.join(os.tmpdir(), 'surfcore-snowluma-api-')
);
const qqRoot = path.join(tmp, 'qq');
const dshRoot = path.join(tmp, 'dsh');
const snowRoot = path.join(tmp, 'snow');

fs.mkdirSync(path.join(qqRoot, 'src'), { recursive: true });
fs.mkdirSync(path.join(dshRoot, 'surfcore'), { recursive: true });
fs.mkdirSync(path.join(snowRoot, 'app', 'config'), { recursive: true });

fs.writeFileSync(
  path.join(qqRoot, 'src', 'bridge.js'),
  '// Isolated test marker only\n'
);

function writeQqConfig(allowLaunch) {
  fs.writeFileSync(
    path.join(qqRoot, 'config.json'),
    JSON.stringify({
      snowluma: { allowLaunch, launcherPath: snowRoot },
    })
  );
}

writeQqConfig(false);
fs.writeFileSync(
  path.join(dshRoot, 'surfcore', 'config.json'),
  JSON.stringify({
    version: 1,
    platforms: { start: { qq: false, bili: false } },
  })
);

process.env.DSH_HOME = dshRoot;
process.env.USERPROFILE = tmp;
process.env.SURFCORE_ROOT = qqRoot;
process.env.SURFCORE_DISABLE_CHARACTER_MIGRATION = '1';
process.env.SURFCORE_DISABLE_MEMORY_TIMER = '1';

// 插件初始化期间禁止自动启动。
process.env.SURFCORE_SKIP_AUTOSTART = '1';

const { apply } = await import('../lib/index.js');
const routes = [];
const ctx = {
  webServer: {
    register(route) {
      routes.push(route);
      return () => {};
    },
  },
  get(name) {
    if (name === 'connection') {
      return { requestRejection: () => false };
    }
    return null;
  },
  effect() { return () => {}; },
  sessionController: {
    inspect: async () => ({ events: [] }),
    create: async () => ({}),
    prompt: async () => ({ accepted: true }),
  },
  settings: null,
};

let server;

function fakeResponse() {
  return {
    statusCode: 200,
    body: '',
    writeHead(code) { this.statusCode = code; },
    end(value = '') { this.body += value; },
  };
}

async function invoke(api) {
  const req = new EventEmitter();
  req.method = 'POST';
  req.url = '/dsh-surfcore/api/bridge';
  req.headers = {
    host: '127.0.0.1:58750',
    'content-type': 'application/json',
  };

  const res = fakeResponse();
  process.nextTick(() => {
    req.emit('data', Buffer.from(
      JSON.stringify({ action: 'start-snowluma' })
    ));
    req.emit('end');
  });

  await api.handler(req, res);
  return {
    status: res.statusCode,
    data: JSON.parse(res.body || '{}'),
  };
}

try {
  apply(ctx);

  const api = routes.find(
    route => route.path === '/dsh-surfcore/api'
  );
  assert.ok(api, 'API 路由必须注册');

  // 仅测试显式 API 操作。初始化已结束。
  delete process.env.SURFCORE_SKIP_AUTOSTART;

  await test('未授权时拒绝启动 SnowLuma', async () => {
    const result = await invoke(api);
    assert.equal(result.status, 200);
    assert.equal(result.data.ok, false);
    assert.match(String(result.data.error), /未开启/);
  });

  await test('模拟 WebUI 在线时无桌面环境不打开浏览器', async () => {
    server = net.createServer(socket => socket.end());

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    const port = server.address().port;
    assert.notEqual(port, 3000);
    assert.notEqual(port, 3001);

    fs.writeFileSync(
      path.join(snowRoot, 'app', 'config', 'runtime.json'),
      JSON.stringify({ webuiPort: port })
    );
    writeQqConfig(true);

    const result = await invoke(api);
    const url = 'http:' + '//127.0.0.1:' + port;

    assert.equal(result.status, 200);
    assert.equal(result.data.ok, true);
    assert.equal(result.data.needsLogin, true);
    assert.equal(result.data.opened, false);
    assert.equal(result.data.webui, url);
    assert.match(result.data.message, /所在设备/);
  });
} finally {
  process.env.SURFCORE_SKIP_AUTOSTART = '1';

  if (server?.listening) {
    await new Promise(resolve => server.close(resolve));
  }

  fs.rmSync(tmp, { recursive: true, force: true });
}
