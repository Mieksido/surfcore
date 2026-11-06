// release-manifest --verify 必须用「被校验目录自己的清单」，不能再用本机 root 的清单。
// 这里构造一个自洽的小包，再改坏一个字节，钉住这两个行为。
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'release-manifest.mjs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'release-manifest-verify-'));
const pkg = path.join(temp, 'pkg');
const release = path.join(pkg, 'release');
fs.mkdirSync(release, { recursive: true });

function hash(text) {
  return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}
function writeManifest(files) {
  fs.writeFileSync(path.join(release, 'install-manifest.json'), `${JSON.stringify({ schemaVersion: 1, version: '0.0.0-test', files }, null, 2)}\n`);
}
function runVerify(dir = pkg) {
  return spawnSync(process.execPath, [script, '--verify', dir], { cwd: root, encoding: 'utf8' });
}

try {
  fs.writeFileSync(path.join(pkg, 'a.txt'), 'hello');
  writeManifest({ 'a.txt': hash('hello') });
  const good = runVerify();
  assert.equal(good.status, 0, good.stderr || good.stdout);
  assert.match(good.stdout, /使用 .*release[\\/]install-manifest\.json/);
  assert.match(good.stdout, /不符 0/);

  fs.writeFileSync(path.join(pkg, 'a.txt'), 'hello!');
  const bad = runVerify();
  assert.notEqual(bad.status, 0, '改坏一个字节必须失败');
  assert.match(bad.stdout, /不符 1/);

  const noManifest = path.join(temp, 'no-manifest');
  fs.mkdirSync(noManifest);
  const missing = runVerify(noManifest);
  assert.notEqual(missing.status, 0, '没有发布清单的目录必须拒绝');
  assert.match(missing.stderr, /不是发布包/);

  console.log('release-manifest verify tests OK');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
