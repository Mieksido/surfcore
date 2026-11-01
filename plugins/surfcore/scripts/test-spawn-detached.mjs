import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { spawnDetached } from '../lib/spawn-detached.js';

function fakeSpawn(mode, calls) {
  return (command, args, options) => {
    calls.push({ command, args, options });

    if (mode === 'throw') {
      throw new Error('同步启动失败');
    }

    const child = new EventEmitter();
    child.pid = 12345;
    child.unrefCount = 0;
    child.unref = () => { child.unrefCount++; };

    queueMicrotask(() => {
      if (mode === 'error') {
        child.emit('error', new Error('ENOENT'));
      } else {
        child.emit('spawn');
        if (mode === 'late-error') {
          queueMicrotask(() => {
            child.emit('error', new Error('later error'));
          });
        }
      }
    });

    return child;
  };
}

test('正常启动返回 PID', async () => {
  const calls = [];
  const result = await spawnDetached(
    'node',
    ['src/bridge.js'],
    { detached: true, stdio: 'ignore' },
    fakeSpawn('ok', calls)
  );

  assert.deepEqual(result, { ok: true, pid: 12345 });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['src/bridge.js']);
  assert.equal(calls[0].options.detached, true);
});

test('同步启动失败返回错误', async () => {
  const result = await spawnDetached(
    'node', [], {},
    fakeSpawn('throw', [])
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /同步启动失败/);
});

test('异步 ENOENT 返回错误', async () => {
  const result = await spawnDetached(
    '/missing/node', [], {},
    fakeSpawn('error', [])
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /ENOENT/);
});

test('启动后再次收到 error 不产生未处理异常', async () => {
  const result = await spawnDetached(
    'node', [], {},
    fakeSpawn('late-error', [])
  );

  assert.equal(result.ok, true);
  await new Promise((resolve) => setImmediate(resolve));
});
