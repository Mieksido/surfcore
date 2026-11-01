import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectLinuxBridgePid } from '../lib/linux-bridge-identity.js';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-pid-'));
  const root = path.join(dir, 'qq');
  const procRoot = path.join(dir, 'proc');
  const proc = path.join(procRoot, '42424');
  const script = path.join(root, 'src', 'bridge.js');

  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.mkdirSync(proc, { recursive: true });
  fs.writeFileSync(script, '// test only\n');
  fs.symlinkSync(root, path.join(proc, 'cwd'));
  fs.symlinkSync(process.execPath, path.join(proc, 'exe'));
  fs.writeFileSync(
    path.join(proc, 'cmdline'),
    Buffer.from(`${process.execPath}\0${script}\0`)
  );
  fs.writeFileSync(
    path.join(proc, 'status'),
    'Name:\tnode\nUid:\t1000\t1000\t1000\t1000\n'
  );

  const fields = ['S', ...Array(21).fill('0')];
  fields[19] = '123456';

  fs.writeFileSync(
    path.join(proc, 'stat'),
    `42424 (node) ${fields.join(' ')}\n`
  );

  return {
    dir, root, procRoot, proc, script,
    options: {
      root, procRoot,
      nodeExecutable: process.execPath,
      uid: 1000, euid: 1000,
    },
    clean() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('匹配的桥接进程通过只读检查', () => {
  const f = fixture();
  try {
    const result = inspectLinuxBridgePid(42424, f.options);
    assert.deepEqual(result, {
      ok: true, pid: 42424, startTicks: '123456',
    });
  } finally { f.clean(); }
});

test('PID 指向其他脚本时拒绝', () => {
  const f = fixture();
  try {
    fs.writeFileSync(
      path.join(f.proc, 'cmdline'),
      Buffer.from(`${process.execPath}\0${process.execPath}\0`)
    );
    assert.equal(
      inspectLinuxBridgePid(42424, f.options).ok, false
    );
  } finally { f.clean(); }
});

test('其他用户的进程被拒绝', () => {
  const f = fixture();
  try {
    fs.writeFileSync(
      path.join(f.proc, 'status'),
      'Uid:\t2000\t2000\t2000\t2000\n'
    );
    assert.equal(
      inspectLinuxBridgePid(42424, f.options).ok, false
    );
  } finally { f.clean(); }
});

test('工作目录不一致时拒绝', () => {
  const f = fixture();
  try {
    fs.unlinkSync(path.join(f.proc, 'cwd'));
    fs.symlinkSync(f.dir, path.join(f.proc, 'cwd'));
    assert.equal(
      inspectLinuxBridgePid(42424, f.options).ok, false
    );
  } finally { f.clean(); }
});

test('缺少 proc 信息或 PID 无效时拒绝', () => {
  const f = fixture();
  try {
    assert.equal(
      inspectLinuxBridgePid(99999, f.options).ok, false
    );
    assert.equal(
      inspectLinuxBridgePid(0, f.options).ok, false
    );
  } finally { f.clean(); }
});

test('进程启动时间无法验证时拒绝', () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.proc, 'stat'), 'invalid\n');
    assert.equal(
      inspectLinuxBridgePid(42424, f.options).ok, false
    );
  } finally { f.clean(); }
});
