/**
 * 全包契约测试（每个小适配器都必须过）
 * ============================================================================
 * 这不是某个平台的功能测试，而是“四段里的第三层”自己的体检：
 *   · pack.json 与 index.js 的身份必须一致；
 *   · 六件契约（identity/capabilities/settings/ui/open/send/health/close）必须齐；
 *   · settings 的 key 不许重复；ui 的 menu/page id 不许重复；
 *   · toolDeclarations 若存在，必须是数组。
 *
 * 跑法：node packs/contract.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validatePack } from '../runtime/index.js';
import { validateManifest } from '../runtime/host.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const PACKS = path.join(ROOT, 'packs');
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

const dirs = fs.readdirSync(PACKS, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
  .map((e) => e.name)
  .sort();

console.log(`## 全包契约（${dirs.length} 个）`);
for (const name of dirs) {
  const dir = path.join(PACKS, name);
  const manifestPath = path.join(dir, 'pack.json');
  if (!fs.existsSync(manifestPath)) { ok(false, `${name}：有 pack.json`); continue; }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
  const mv = validateManifest(manifest, name);
  ok(mv.ok, `${name}：清单合法 ${mv.errors.join('；')}`);

  let pack;
  try { pack = (await import(pathToFileURL(path.join(dir, 'index.js')).href)).default; }
  catch (error) { ok(false, `${name}：index.js 可加载（${error.message}）`); continue; }

  const v = validatePack(pack);
  ok(v.ok, `${name}：validatePack 通过 ${v.errors.join('；')}`);

  for (const key of ['identity', 'capabilities', 'settings', 'ui', 'open', 'send', 'health', 'close']) {
    ok(pack[key] !== undefined, `${name}：有 ${key}`);
  }
  ok(pack.identity?.publisher === manifest.publisher, `${name}：publisher 与清单一致`);
  ok(pack.identity?.name === manifest.name, `${name}：name 与清单一致`);
  ok(pack.identity?.version === manifest.version, `${name}：version 与清单一致`);

  if (Array.isArray(pack.settings)) {
    const keys = pack.settings.map((s) => s.key);
    ok(new Set(keys).size === keys.length, `${name}：settings key 不重复（${keys.length} 项）`);
    ok(keys.every((k) => typeof k === 'string' && k), `${name}：settings key 都是非空字符串`);
  }
  if (pack.ui) {
    const ids = [...(pack.ui.menu ?? []), ...(pack.ui.pages ?? [])].map((x) => x.id);
    ok(new Set(ids).size === ids.length, `${name}：ui id 不重复（${ids.length} 个）`);
  }
  if (pack.toolDeclarations !== undefined) {
    const decls = pack.toolDeclarations();
    ok(Array.isArray(decls), `${name}：toolDeclarations 返回数组`);
    ok(new Set(decls.map((d) => d.name)).size === decls.length, `${name}：工具名不重复（${decls.length} 个）`);
  }
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
