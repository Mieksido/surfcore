// Embedding 包纯逻辑测试：manifest/路径/校验/安装/卸载/不静默坏包。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import {
  fileSha256, installPackFromDirectory, listEmbeddingPacks, normalizePackId, packDir,
  readPackManifest, resolveInstalledPack, safePackRelativePath, uninstallPack,
  validatePackManifest, verifyPackFiles,
} from '../src/embedding-packs.js';

const temps = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'embedding-pack-test-'));
  temps.push(dir);
  return dir;
}
after(() => {
  for (const dir of temps) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

async function makePack(root, { id = 'bge-small-zh-v1.5', payload = 'fake-model' } = {}) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  const data = Buffer.from(payload);
  fs.writeFileSync(path.join(dir, 'model.gguf'), data);
  const sha = await fileSha256(path.join(dir, 'model.gguf'));
  const manifest = {
    schema: 1, id, kind: 'model', name: '测试小模型', version: '1.0.0',
    model: 'bge-small-zh-v1.5', modelSpace: 'bge-small-zh-v1.5@512-f16-v1', dimension: 512,
    license: 'MIT', sizeBytes: data.length, requires: ['runtime>=1.0.0'],
    files: [{ path: 'model.gguf', sha256: sha, size: data.length }],
  };
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify(manifest));
  return { dir, manifest, data, sha };
}

test('manifest：合法包通过，非法 id/路径/哈希/大小被拒绝', async () => {
  const root = tempDir();
  const { manifest } = await makePack(root);
  const ok = validatePackManifest(manifest, { expectedId: 'bge-small-zh-v1.5' });
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));

  assert.equal(validatePackManifest({ ...manifest, id: '../x' }).ok, false);
  assert.equal(validatePackManifest({ ...manifest, kind: 'nope' }).ok, false);
  assert.equal(validatePackManifest({ ...manifest, dimension: 0 }).ok, false);
  assert.equal(validatePackManifest({ ...manifest, files: [{ path: '../evil', size: 1, sha256: manifest.files[0].sha256 }] }).ok, false);
  assert.equal(validatePackManifest({ ...manifest, files: [{ path: 'model.gguf', size: 1, sha256: 'nope' }] }).ok, false);
  assert.equal(validatePackManifest({ ...manifest, sizeBytes: 999 }).ok, false);
  assert.equal(normalizePackId('BGE-Small'), 'bge-small');
  assert.equal(normalizePackId('../x'), '');
  assert.equal(safePackRelativePath('models/a.gguf'), 'models/a.gguf');
  assert.equal(safePackRelativePath('../evil'), '');
});

test('文件校验：缺失/大小不符/哈希不符都可见', async () => {
  const root = tempDir();
  const { dir, manifest, data, sha } = await makePack(root);
  const good = await verifyPackFiles(dir, manifest);
  assert.equal(good.ok, true);

  fs.writeFileSync(path.join(dir, 'model.gguf'), Buffer.from('changed'));
  const bad = await verifyPackFiles(dir, { ...manifest, files: [{ ...manifest.files[0], sha256: sha, size: data.length }] });
  assert.equal(bad.ok, false);
  assert.equal(bad.mismatch[0].path, 'model.gguf');

  fs.rmSync(path.join(dir, 'model.gguf'));
  const missing = await verifyPackFiles(dir, manifest);
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missing, ['model.gguf']);
});

test('安装/列表/重复拒绝/覆盖备份/卸载到 quarantine', async () => {
  const root = tempDir();
  const sourceRoot = tempDir();
  const installRoot = path.join(root, 'embedding-packs');
  const quarantine = path.join(root, '_quarantine');
  const { dir } = await makePack(sourceRoot);

  const installed = await installPackFromDirectory(dir, { root: installRoot, quarantineDir: quarantine });
  assert.equal(installed.ok, true, JSON.stringify(installed));
  assert.equal(fs.existsSync(path.join(installRoot, 'bge-small-zh-v1.5', 'model.gguf')), true);

  const list = listEmbeddingPacks(installRoot);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'bge-small-zh-v1.5');
  assert.equal(list[0].valid, true);
  assert.equal(list[0].kind, 'model');
  assert.equal(resolveInstalledPack(installRoot, { modelSpace: 'bge-small-zh-v1.5@512-f16-v1' }).id, 'bge-small-zh-v1.5');

  const duplicate = await installPackFromDirectory(dir, { root: installRoot });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.code, 'pack.exists');

  const overwrite = await installPackFromDirectory(dir, { root: installRoot, overwrite: true, quarantineDir: quarantine });
  assert.equal(overwrite.ok, true);
  assert.ok(overwrite.backup);
  assert.equal(fs.existsSync(path.join(overwrite.backup, 'pack.json')), true);

  const removed = uninstallPack(installRoot, 'bge-small-zh-v1.5', { quarantineDir: quarantine });
  assert.equal(removed.ok, true);
  assert.equal(fs.existsSync(path.join(installRoot, 'bge-small-zh-v1.5')), false);
  assert.equal(fs.existsSync(path.join(removed.removedTo, 'pack.json')), true);
});

test('坏包也列出来（不静默跳过）', () => {
  const root = tempDir();
  const bad = path.join(root, 'broken-pack');
  fs.mkdirSync(bad, { recursive: true });
  fs.writeFileSync(path.join(bad, 'pack.json'), JSON.stringify({ schema: 1, id: 'broken-pack', kind: 'model' }));
  const list = listEmbeddingPacks(root);
  assert.equal(list.length, 1);
  assert.equal(list[0].valid, false);
  assert.equal(list[0].kind, 'invalid');
  assert.ok(list[0].error);
  assert.equal(readPackManifest(bad, { expectedId: 'broken-pack' }).ok, false);
  assert.equal(packDir(root, 'broken-pack'), bad);
});
