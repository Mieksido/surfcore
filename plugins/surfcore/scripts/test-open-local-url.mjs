import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createLocalUrlOpener } from '../lib/open-local-url.js';

const URL = 'http://127.0.0.1:13132';

function mockSpawn(calls, mode = 'ok') {
  return (command, args, options) => {
    calls.push({ command, args, options });

    if (mode === 'throw') throw new Error('synchronous failure');

    const child = new EventEmitter();
    child.unref = () => {};

    queueMicrotask(() => {
      if (mode === 'error') {
        child.emit('error', new Error('ENOENT'));
      } else {
        child.emit('spawn');
        if (mode === 'late-error') {
          queueMicrotask(() => child.emit('error', new Error('late')));
        }
      }
    });

    return child;
  };
}

test('拒绝非本机 WebUI URL', async () => {
  const calls = [];
  const open = createLocalUrlOpener({
    platform: 'darwin', env: {}, spawnProcess: mockSpawn(calls),
  });

  for (const url of [
    'https://127.0.0.1:13132',
    'http://example.com:13132',
    'http://127.0.0.1:13132/path',
    'http://127.0.0.1:13132?x=1',
  ]) {
    assert.equal(await open(url), false);
  }
  assert.equal(calls.length, 0);
});

test('跳过自动启动开关', async () => {
  const calls = [];
  const open = createLocalUrlOpener({
    platform: 'win32',
    env: { SURFCORE_SKIP_AUTOSTART: '1' },
    spawnProcess: mockSpawn(calls),
  });
  assert.equal(await open(URL), false);
  assert.equal(calls.length, 0);
});

test('Windows 保留 cmd.exe 启动参数', async () => {
  const calls = [];
  const open = createLocalUrlOpener({
    platform: 'win32', env: {}, spawnProcess: mockSpawn(calls),
  });
  assert.equal(await open(URL), true);
  assert.equal(calls[0].command, 'cmd.exe');
  assert.deepEqual(calls[0].args, [
    '/d', '/c', 'start', '""', `"${URL}"`,
  ]);
  assert.equal(calls[0].options.windowsVerbatimArguments, true);
});

test('macOS 使用 open', async () => {
  const calls = [];
  const open = createLocalUrlOpener({
    platform: 'darwin', env: {}, spawnProcess: mockSpawn(calls),
  });
  assert.equal(await open(URL), true);
  assert.equal(calls[0].command, 'open');
  assert.deepEqual(calls[0].args, [URL]);
});

test('Linux 无图形会话时不启动浏览器', async () => {
  const calls = [];
  const open = createLocalUrlOpener({
    platform: 'linux', env: {}, spawnProcess: mockSpawn(calls),
  });
  assert.equal(await open(URL), false);
  assert.equal(calls.length, 0);
});

test('Linux 图形会话使用 xdg-open', async () => {
  const calls = [];
  const open = createLocalUrlOpener({
    platform: 'linux',
    env: { DISPLAY: ':0' },
    spawnProcess: mockSpawn(calls),
  });
  assert.equal(await open(URL), true);
  assert.equal(calls[0].command, 'xdg-open');
  assert.deepEqual(calls[0].args, [URL]);
});

test('同步和异步启动错误都返回 false', async () => {
  for (const mode of ['throw', 'error']) {
    const open = createLocalUrlOpener({
      platform: 'darwin',
      env: {},
      spawnProcess: mockSpawn([], mode),
    });
    assert.equal(await open(URL), false);
  }
});

test('启动后出现 error 事件也不会无人监听', async () => {
  const open = createLocalUrlOpener({
    platform: 'darwin',
    env: {},
    spawnProcess: mockSpawn([], 'late-error'),
  });
  assert.equal(await open(URL), true);
  await new Promise((resolve) => setImmediate(resolve));
});
