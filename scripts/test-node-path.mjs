// DSH Desktop 的 node 只在安装目录时，findNodeExe 必须能找到它；
// 同时保留 DSH_NODE / 用户缓存 / Program Files 的回退顺序。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findNodeExe, isNodeExe } from '../src/node-path.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-node-path-'));
try {
  const install = path.join(root, 'install');
  const exe = path.join(install, 'DeepSeek Harness.exe');
  const bundled = path.join(install, 'resources', 'runtime', 'primary-runtime', 'dependencies', 'node', 'bin', 'node.exe');
  fs.mkdirSync(path.dirname(bundled), { recursive: true });
  fs.writeFileSync(bundled, '');
  fs.writeFileSync(exe, '');

  assert.equal(isNodeExe('node.exe'), true);
  assert.equal(isNodeExe('DeepSeek Harness.exe'), false);
  assert.equal(
    findNodeExe({ execPath: exe, env: {}, home: path.join(root, 'home'), dshHome: path.join(root, 'dsh') }),
    bundled,
    '必须命中 DSH Desktop 安装目录里的 node',
  );

  const cached = path.join(root, 'dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node.exe');
  fs.mkdirSync(path.dirname(cached), { recursive: true });
  fs.writeFileSync(cached, '');
  assert.equal(
    findNodeExe({ execPath: path.join(root, 'elsewhere', 'Harness.exe'), env: {}, home: path.join(root, 'home'), dshHome: path.join(root, 'dsh') }),
    cached,
    '安装目录没有时回退用户缓存',
  );

  const envNode = path.join(root, 'custom', 'node.exe');
  fs.mkdirSync(path.dirname(envNode), { recursive: true });
  fs.writeFileSync(envNode, '');
  assert.equal(
    findNodeExe({ execPath: exe, env: { DSH_NODE: envNode }, home: path.join(root, 'home'), dshHome: path.join(root, 'dsh') }),
    envNode,
    'DSH_NODE 优先级最高',
  );

  const missing = path.join(root, 'missing', 'Harness.exe');
  assert.equal(
    findNodeExe({
      execPath: missing, env: {}, home: path.join(root, 'home2'), dshHome: path.join(root, 'dsh2'),
      programFiles: path.join(root, 'no-program-files', 'node.exe'),
    }),
    missing,
    '都找不到时返回 execPath，交给调用方报明确错误',
  );

  const setup = fs.readFileSync('scripts/setup-dsh.mjs', 'utf8');
  const scheduler = fs.readFileSync('plugins/surfcore/lib/scheduler.js', 'utf8');
  assert.ok(setup.includes('findNodeExe') && setup.includes('NODE_EXE'), 'setup 的 MCP command 必须用真 node');
  assert.ok(scheduler.includes('findNodeExe') && !scheduler.includes('function findNode()'), 'scheduler 必须复用统一解析');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('✅ DSH Desktop node 路径测试通过');
