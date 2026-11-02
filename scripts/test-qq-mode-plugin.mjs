// #35 结构不变量：surfcore 客户端包只允许一个 active Loader 来源。
//
// DSH 的 @deepseek-ai/dsh-client-modules 在 reconcilePackage（client/modules
// src/index.ts:1042-1054）里对「同一包 ≥2 个不同行名来源」抛
// ClientPackageCompositionError；modules 是 required 插件，宿主直接起不来。
// 0.8.6 及之前的第二条 `- id: qq-mode / name: ./lib/qq-mode.js` 行就是踩的它
// （Mieksido/surfcore#35）。这条测试按 DSH 的来源解析语义重演：
//
//   · 裸说明符：无 `/` 无 `:` 才算包名（exactPackageSpecifier，
//     client/modules src/client/manifest.ts:201-207）；
//   · 相对路径：锚定在 patch 文件所在目录，再 nearestPackage 上溯找最近
//     的 package.json（src/index.ts:892-953 的路径分支）；
//   · 子路径说明符（如 surfcore/qq-tool-restrict.mjs）：不是包根，跳过
//     （不参与客户端行判定，preset 守卫行因此安全）；
//   · cordis:/node:/file: 内建/URL 形式：跳过；
//   · 同一 entry id 在多个 patch 文件重复声明不算多来源（cordis 同 id 行
//     覆盖合并），只有**不同 id/行名**解析到同一包才算（sourceKey 语义，
//     src/index.ts:955-957 是 `${baseUrl}\0${loaderName}`）。
//
// 解析失败按「可能违规」处理（fail-closed），不当作安全放行。
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'js-yaml';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PLUGIN_DIR = path.join(ROOT, 'plugins', 'surfcore');

/** DSH exactPackageSpecifier 的最小重演（manifest.ts:201-207）。 */
function exactPackageSpecifier(specifier) {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.length === 2 && parts.every(Boolean) ? specifier : undefined;
  }
  return specifier.length > 0 && !specifier.includes('/') && !specifier.includes(':') ? specifier : undefined;
}

/** 从一个模块说明符解析「它落在哪个包」：返回包名，解析不了返回 undefined。 */
function resolvePackageName(specifier, patchDir) {
  if (typeof specifier !== 'string' || !specifier) return undefined;
  if (specifier.startsWith('cordis:') || specifier.startsWith('node:') || specifier.startsWith('file:')) return undefined;
  const bare = exactPackageSpecifier(specifier);
  if (bare) return bare;
  const pathLike = specifier.startsWith('.') || specifier.startsWith('file:') || path.isAbsolute(specifier);
  if (!pathLike) return undefined; // 子路径说明符（name 包含 / 但不是 ./ 开头）→ 非包根
  let dir = path.resolve(patchDir, specifier);
  for (;;) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      try {
        const name = JSON.parse(fs.readFileSync(candidate, 'utf8')).name;
        if (typeof name === 'string' && name) return name;
      } catch { /* 损坏的中间 manifest 不能拥有模块，继续上溯 */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** 收集一个 patch 文档里所有 loader 行：[{ id, name }]。 */
function loaderRows(doc) {
  const rows = [];
  for (const op of doc) {
    if (!op || typeof op !== 'object' || !Array.isArray(op.insert)) continue;
    for (const entry of op.insert) {
      if (entry && typeof entry === 'object' && typeof entry.name === 'string') {
        rows.push({ id: typeof entry.id === 'string' ? entry.id : entry.name, name: entry.name });
      }
    }
  }
  return rows;
}

test('cordis.patch.yml 只有一条解析到 surfcore 包的 Loader 来源', () => {
  const patchFile = path.join(PLUGIN_DIR, 'cordis.patch.yml');
  const doc = yaml.load(fs.readFileSync(patchFile, 'utf8'));
  assert.ok(Array.isArray(doc), 'patch 根必须是数组');

  const rows = loaderRows(doc);
  const sources = rows
    .map((row) => ({ ...row, pkg: resolvePackageName(row.name, path.dirname(patchFile)) }))
    .filter((row) => row.pkg === 'surfcore');

  const describe = sources.map((s) => `id=${s.id} name=${s.name}`).join('; ') || '(无)';
  assert.equal(
    sources.length, 1,
    `surfcore 包必须只有一个 active Loader 来源（DSH client-modules 单包单来源，#35）。实际 ${sources.length} 条：${describe}`,
  );
  assert.equal(sources[0].id, 'surfcore', '主行 id 必须等于包名，否则设置页/插件详情找不到');
});

test('resolvePackageName 重演 DSH 语义：子路径/内建/URL 不算包根', () => {
  // preset 守卫行是子路径说明符：不参与客户端行判定（这正是它安全的原因）。
  assert.equal(resolvePackageName('surfcore/qq-tool-restrict.mjs', PLUGIN_DIR), undefined);
  assert.equal(resolvePackageName('cordis:group', PLUGIN_DIR), undefined);
  assert.equal(resolvePackageName('@deepseek-ai/dsh-agent-preset', PLUGIN_DIR), '@deepseek-ai/dsh-agent-preset');
  assert.equal(resolvePackageName('./lib/index.js', PLUGIN_DIR), 'surfcore');
});

test('主模块导出 Config / name / inject（含 settings）', async () => {
  const mod = await import(pathToFileURL(path.join(PLUGIN_DIR, 'lib', 'index.js')).href);
  assert.equal(mod.name, 'surfcore');
  assert.ok(mod.Config, '主模块必须导出 Config —— mode/ownerQQ 的 schema 现在由主行承载（#35）');
  assert.ok(Array.isArray(mod.inject) && mod.inject.includes('settings'),
    'inject 必须声明 settings，命名空间才随 settings seam 就绪');
});

test('Config 是可用的 schemastery schema，且 mode/ownerQQ 带 volatile', async () => {
  const mod = await import(pathToFileURL(path.join(PLUGIN_DIR, 'lib', 'index.js')).href);
  const resolved = mod.Config({});
  assert.equal(resolved.mode, 'reserved2', 'Config 默认 mode 应为 reserved2');
  assert.throws(() => mod.Config({ mode: 'bogus' }), '非法 mode 必须被拒绝');
  for (const mode of ['chat', 'closed-agent', 'reserved', 'reserved2', 'simulation']) {
    assert.equal(mod.Config({ mode }).mode, mode, `${mode} 应被接受`);
  }
  const json = mod.Config.toJSON();
  const refs = json.refs ?? {};
  const root = refs[String(json.uid)] ?? json;
  const volatileFields = [];
  for (const [key, node] of Object.entries(root.dict ?? {})) {
    if (refs[String(node)]?.meta?.volatile === true) volatileFields.push(key);
  }
  assert.ok(volatileFields.includes('mode'), `mode 字段应带 volatile，实际：${volatileFields.join(', ') || '(无)'}`);
  assert.ok(volatileFields.includes('ownerQQ'), `ownerQQ 字段应带 volatile，实际：${volatileFields.join(', ') || '(无)'}`);
});
