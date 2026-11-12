/**
 * 出站包检查（打包前跑）
 * ============================================================================
 * 用法：
 *   node tools/pack-check.mjs --src packs/qq            # 检查一个包目录
 *   node tools/pack-check.mjs --src dist/qq.zip --zip   # 检查 zip 内容（只读清单）
 *   node tools/pack-check.mjs --src <目录> --list       # 只列被拒的条目
 *
 * 规则来自 runtime/pack-rules.mjs（**单一真相**）：
 * 入站（装包）与出站（发包）用同一份，避免"两份规则漂移，漏的是漂移那份"。
 *
 * 退出码：0 = 干净；1 = 有禁止内容（并逐条列出）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { scanDir, scanPaths, explain } from '../runtime/pack-rules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const argOf = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? true) : fallback;
};

const src = argOf('--src');
const zip = argv.includes('--zip');
const listOnly = argv.includes('--list');

if (!src) {
  console.error('用法：node tools/pack-check.mjs --src <包目录|zip> [--zip] [--list]');
  process.exit(2);
}

/* zip：不自己解压，借用系统的 tar（Windows 10+ 自带 bsdtar 能读 zip） */
function zipEntries(file) {
  const r = spawnSync('tar', ['-tf', file], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`读不了 zip：${r.stderr ?? ''}`);
    process.exit(2);
  }
  return r.stdout.split(/\r?\n/).filter(Boolean).map((p) => p.replace(/\\/g, '/'));
}

const target = path.resolve(ROOT, String(src));
if (!fs.existsSync(target)) {
  console.error(`路径不存在：${target}`);
  process.exit(2);
}

const result = zip
  ? scanPaths(zipEntries(target))
  : scanDir(target);

if (result.ok) {
  console.log(`✅ ${explain(result)}`);
  if (!zip) console.log(`   扫描了 ${result.scanned} 个条目：${path.relative(ROOT, target).replace(/\\/g, '/')}`);
  process.exit(0);
}

console.error(`❌ ${explain(result)}`);
for (const hit of result.hits) {
  console.error(`   - ${hit.path}  [${hit.id}]  ${listOnly ? '' : hit.why}`);
}
console.error('\n这些内容不许进包：第三方运行时/二进制/依赖目录/凭据。');
console.error('判据：连接它 ≠ 分发它。包里只放我们自己写的协议实现。');
process.exit(1);
