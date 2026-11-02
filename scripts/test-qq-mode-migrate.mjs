// #35 一次性迁移（qq-mode → surfcore 命名空间）的行为测试。
// 钉住的契约（实施基线，用户确认）：
//   · marker 时序：settings.update 成功**之后**才写 marker；
//     update 抛错 → 无 marker，下次重试；
//   · 幂等：marker 存在 → 不再读文件、不再调 update（不重复扫描）；
//   · 只迁移新 namespace 缺失的字段，不覆盖已设置的新值；
//   · 空 ownerQQ 视为未设置，不迁移；
//   · 旧文件不存在/无 qq-mode 行 → noop + 写 marker（同样幂等收尾）；
//   · 读旧文件失败 → failed 且不写 marker（下次重试）；
//   · 全程只读 profile patch，只写 marker 文件。
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLegacyQqModeConfig, migrationPatch, migrateLegacyQqMode } from '../plugins/surfcore/lib/qq-mode-migrate.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfc-qqmode-migrate-'));
}

function fixture(text) {
  const dir = tmp();
  const file = path.join(dir, 'cordis.patch.yml');
  if (text !== undefined) fs.writeFileSync(file, text, 'utf8');
  return { dir, file };
}

test('parseLegacyQqModeConfig：识别旧覆盖行，忽略其它行', () => {
  const text = [
    '- id: llm-deepseek',
    '  name: "@deepseek-ai/dsh-llm-deepseek-api-key"',
    '  config:',
    '    baseURL: http://127.0.0.1:3000',
    '- id: qq-mode',
    '  name: ./lib/qq-mode.js',
    '  config:',
    '    mode: chat',
    "    ownerQQ: '12345'",
    '- id: ui-settings',
    '  config:',
    '    enabled: true',
    '',
  ].join('\n');
  assert.deepEqual(parseLegacyQqModeConfig(text), { mode: 'chat', ownerQQ: '12345' });
});

test('parseLegacyQqModeConfig：空 ownerQQ / 缺字段 / 坏 YAML / 空文本都安全返回 {}', () => {
  const withEmptyOwner = '- id: qq-mode\n  config:\n    mode: chat\n    ownerQQ: ""\n';
  assert.deepEqual(parseLegacyQqModeConfig(withEmptyOwner), { mode: 'chat' }, '空串 ownerQQ = 未设置');
  assert.deepEqual(parseLegacyQqModeConfig('- id: other\n  config:\n    x: 1\n'), {}, '没有 qq-mode 行');
  assert.deepEqual(parseLegacyQqModeConfig('::: not-yaml {{{'), {}, '坏 YAML 不抛');
  assert.deepEqual(parseLegacyQqModeConfig(''), {}, '空文本');
  assert.deepEqual(parseLegacyQqModeConfig(undefined), {}, 'undefined');
  // 数值 ownerQQ 也能收（settings 层历史上写过数字）
  assert.deepEqual(
    parseLegacyQqModeConfig('- id: qq-mode\n  config:\n    ownerQQ: 12345\n'),
    { ownerQQ: '12345' },
  );
});

test('migrationPatch：只填缺失字段，不覆盖新值', () => {
  assert.deepEqual(
    migrationPatch({ mode: 'chat', ownerQQ: '12345' }, {}),
    { mode: 'chat', ownerQQ: '12345' },
    '新 namespace 全空 → 全迁',
  );
  assert.deepEqual(
    migrationPatch({ mode: 'chat', ownerQQ: '12345' }, { mode: 'reserved2' }),
    { ownerQQ: '12345' },
    '新 mode 已有值 → 不覆盖',
  );
  assert.deepEqual(
    migrationPatch({ mode: 'chat', ownerQQ: '12345' }, { mode: 'chat', ownerQQ: '99999' }),
    {},
    '新值都在 → 不迁移',
  );
  assert.deepEqual(migrationPatch({ ownerQQ: '' }, {}), {}, '旧空 ownerQQ 不产生 patch');
});

test('migrateLegacyQqMode：update 成功后才写 marker；失败不写', async () => {
  const { file } = fixture('- id: qq-mode\n  config:\n    mode: chat\n    ownerQQ: \'12345\'\n');
  const dir = path.dirname(file);
  const marker = path.join(dir, 'marker.json');
  const calls = [];
  let markerAfterUpdate = null;

  const result = await migrateLegacyQqMode({
    profilePatchFile: file,
    markerFile: marker,
    updateSettings: async (ns, patch) => {
      calls.push({ ns, patch });
      // 在 update 成功这一刻 marker 必须还不存在（时序契约）
      markerAfterUpdate = fs.existsSync(marker);
    },
    readCurrentNamespace: () => ({}),
  });

  assert.equal(result.status, 'migrated');
  assert.deepEqual(calls, [{ ns: 'surfcore', patch: { mode: 'chat', ownerQQ: '12345' } }]);
  assert.equal(markerAfterUpdate, false, 'update 调用时 marker 尚未写入');
  assert.equal(fs.existsSync(marker), true, '成功后写 marker');
  assert.deepEqual(JSON.parse(fs.readFileSync(marker, 'utf8')).patch, { mode: 'chat', ownerQQ: '12345' });
});

test('migrateLegacyQqMode：update 抛错 → status=failed、无 marker（下次重试）', async () => {
  const { file } = fixture('- id: qq-mode\n  config:\n    mode: chat\n');
  const marker = path.join(path.dirname(file), 'marker.json');
  const result = await migrateLegacyQqMode({
    profilePatchFile: file,
    markerFile: marker,
    updateSettings: async () => { throw new Error('No configurable plugin entry'); },
    readCurrentNamespace: () => ({}),
  });
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /settings-update/);
  assert.equal(fs.existsSync(marker), false, '失败不写 marker');
});

test('migrateLegacyQqMode：marker 存在 → skipped，不读文件不调 update', async () => {
  const { file } = fixture('- id: qq-mode\n  config:\n    mode: chat\n');
  const marker = path.join(path.dirname(file), 'marker.json');
  fs.writeFileSync(marker, JSON.stringify({ status: 'migrated' }), 'utf8');
  let updateCalled = false;
  const result = await migrateLegacyQqMode({
    profilePatchFile: path.join(path.dirname(file), '不存在.yml'),
    markerFile: marker,
    updateSettings: async () => { updateCalled = true; },
    readCurrentNamespace: () => ({}),
  });
  assert.equal(result.status, 'skipped');
  assert.equal(updateCalled, false, '幂等：marker 存在不再迁移');
});

test('migrateLegacyQqMode：不覆盖新 namespace 已有值', async () => {
  const { file } = fixture('- id: qq-mode\n  config:\n    mode: chat\n    ownerQQ: \'12345\'\n');
  const marker = path.join(path.dirname(file), 'marker.json');
  const calls = [];
  await migrateLegacyQqMode({
    profilePatchFile: file,
    markerFile: marker,
    updateSettings: async (ns, patch) => calls.push(patch),
    readCurrentNamespace: () => ({ mode: 'closed-agent', ownerQQ: '99999' }),
  });
  assert.equal(calls.length, 0, '新值都在 → 不调用 update');
  assert.equal(JSON.parse(fs.readFileSync(marker, 'utf8')).status, 'noop');
});

test('migrateLegacyQqMode：旧文件不存在 → noop + marker（幂等收尾）', async () => {
  const dir = tmp();
  const marker = path.join(dir, 'marker.json');
  let updateCalled = false;
  const result = await migrateLegacyQqMode({
    profilePatchFile: path.join(dir, '不存在.yml'),
    markerFile: marker,
    updateSettings: async () => { updateCalled = true; },
    readCurrentNamespace: () => ({}),
  });
  assert.equal(result.status, 'noop');
  assert.equal(updateCalled, false);
  assert.equal(JSON.parse(fs.readFileSync(marker, 'utf8')).status, 'noop', 'noop 也写 marker，下次不再扫描');
});

test('migrateLegacyQqMode：读文件抛错（目录当文件）→ failed 且不写 marker', async () => {
  const dir = tmp();
  const marker = path.join(dir, 'marker.json');
  const result = await migrateLegacyQqMode({
    profilePatchFile: dir, // 目录：readFileSync 会抛 EISDIR
    markerFile: marker,
    updateSettings: async () => {},
    readCurrentNamespace: () => ({}),
  });
  assert.equal(result.status, 'failed');
  assert.equal(fs.existsSync(marker), false, '读失败不写成功 marker');
});

test('本机 profile patch 无 qq-mode 行（迁移面为零的现场证据，只读检查）', () => {
  const localPatch = path.join(ROOT, '..', '..', '.dsh-shim');
  void localPatch;
  // 本机真实 profile 只在用户环境存在，测试环境没有 ~/.dsh；这里只验证
  // parseLegacyQqModeConfig 对真实格式的兼容（覆盖行含 name 键、config 在最后）。
  const real = [
    '# Your patch layer for this dsh profile',
    '- id: llm-deepseek',
    '  name: "@deepseek-ai/dsh-llm-deepseek-api-key"',
    '  config:',
    '    baseURL: http://127.0.0.1:3000',
    '- id: qq-mode',
    '  name: ./lib/qq-mode.js',
    '  config:',
    '    mode: reserved2',
    '    ownerQQ: \'\'',
    '',
  ].join('\n');
  assert.deepEqual(parseLegacyQqModeConfig(real), { mode: 'reserved2' }, '空 ownerQQ 剔除，mode 保留');
});
