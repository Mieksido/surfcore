// surfcore 插件的 qq-mode 命名空间登记期静态检验。
//
// 合体后 qq-mode 由 `plugins/surfcore/lib/qq-mode.js` 提供（不再是旧
// qq-mode-console 包）。钉住的东西不变：① entry id = qq-mode；② 导出 Config；
// ③ 至少一个 volatile 字段；④ 不调用 0.2.0 已删除的 ctx.settings.register()。
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { unwrapSchemaValue } from '../src/schema-values.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PLUGIN_DIR = path.join(ROOT, 'plugins', 'surfcore');
const NS = 'qq-mode';

const mod = await import(pathToFileURL(path.join(PLUGIN_DIR, 'lib', 'qq-mode.js')).href);
// schemastery 3.18.3+ 把 volatile 字段解析成带 get() 的包装对象；统一取纯值再断言。
const resolveConfig = (value) => Object.fromEntries(
  Object.entries(value).map(([key, item]) => [key, unwrapSchemaValue(item)]),
);
const patchText = fs.readFileSync(path.join(PLUGIN_DIR, 'cordis.patch.yml'), 'utf8');
const source = fs.readFileSync(path.join(PLUGIN_DIR, 'lib', 'qq-mode.js'), 'utf8');

test('插件导出 name / inject / Config / apply', () => {
  assert.equal(mod.name, 'surfcore/qq-mode');
  assert.deepEqual(mod.inject, ['settings'], 'inject 必须声明 settings，命名空间才随 settings seam 就绪');
  assert.ok(mod.Config, '必须导出 Config —— 0.2.0 里这就是命名空间的 schema 来源');
  assert.equal(typeof mod.apply, 'function');
});

test('cordis.patch.yml 的 entry id 恰好等于命名空间名', () => {
  // ① 是三点契约里最容易写错的一条：id 写成插件包名（qq-mode-console）会让
  //    settings 定位失败并抛 No configurable plugin entry "qq-mode"。
  const ids = [...patchText.matchAll(/^\s*-\s*id:\s*(\S+)\s*$/gm)].map((m) => m[1]);
  assert.ok(ids.includes(NS), `patch 里应有 id: ${NS}，实际 ${ids.join(', ')}`);
  assert.ok(!ids.includes('qq-mode-console'), 'entry id 不应是插件包名');
});

test('qq-mode 是独立 host-only 包，不再解析回 surfcore 客户端包', () => {
  const qqPkg = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'qq-mode', 'package.json'), 'utf8'));
  assert.equal(qqPkg.name, 'surfcore-qq-mode');
  assert.equal(qqPkg.dsh?.client, undefined, 'qq-mode 不能声明 dsh.client');
  assert.ok(patchText.includes('name: ./qq-mode/index.js'), 'Loader 必须指向独立包入口');
  assert.ok(!patchText.includes('name: ./lib/qq-mode.js'), '不能再让 qq-mode 解析回 surfcore');
});

test('Config 是可用的 schemastery schema，且带 volatile 字段', () => {
  const resolved = resolveConfig(mod.Config({}));
  assert.equal(resolved.mode, 'reserved2', 'Config 默认 mode 应为 reserved2');

  // ③ volatile 标记。注意 schemastery 的 toJSON() 是**引用表**形状：
  //    顶层可能是 { uid, refs: { '<uid>': <node> } }，真正的 dict/字段在 refs 里，
  //    而不是顶层直接挂 dict。所以要先把顶层 uid 解析回节点。
  const json = mod.Config.toJSON();
  const refs = json.refs ?? {};
  const root = refs[String(json.uid)] ?? json;
  const volatileFields = [];
  for (const [key, node] of Object.entries(root.dict ?? {})) {
    if (refs[String(node)]?.meta?.volatile === true) volatileFields.push(key);
  }
  assert.ok(
    volatileFields.length > 0,
    'Config 至少一个字段必须带 .extra(\'volatile\', true)，否则 settings 写入会抛 "has no volatile fields"；'
    + `实际 volatile 字段：${volatileFields.join(', ') || '(无)'}`,
  );
  assert.ok(volatileFields.includes('mode'), `mode 字段应带 volatile，实际：${volatileFields.join(', ')}`);
});

test('schema 接受全部规范/历史 mode 拼写，拒绝非法值', () => {
  for (const mode of ['chat', 'closed-agent', 'reserved', 'reserved2', 'simulation']) {
    assert.equal(resolveConfig(mod.Config({ mode })).mode, mode, `${mode} 应被接受`);
  }
  assert.throws(() => mod.Config({ mode: 'bogus' }), '非法 mode 必须被拒绝');
});

test('不再调用 0.2.0 已删除的 ctx.settings.register', () => {
  // 只看可执行代码：注释里会提到 register 做历史说明。
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.ok(
    !/settings\s*\.\s*register\s*\(/.test(code),
    'ctx.settings.register() 在 DSH 0.2.0 已不存在：调用它会让 apply 抛 TypeError。'
    + '命名空间由 entry id + 导出的 Config 推导，无需注册。',
  );
  // configure() 也要谨慎：auto:false 会关掉自动设置页策略，与默认行为相反。
  assert.ok(!/settings\s*\.\s*configure\s*\(/.test(code), 'apply 不应调用 settings.configure()');
});

test('apply 在缺少 settings 服务时也不抛（静默降级）', () => {
  assert.doesNotThrow(() => mod.apply({}), 'apply 必须容忍没有 ctx.settings 的环境');
});
