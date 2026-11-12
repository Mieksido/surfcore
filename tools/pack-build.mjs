/**
 * 单独出一个平台包（不进本体）
 * ============================================================================
 * 用法：
 *   node tools/pack-build.mjs --pack qq          # → dist/qq-<版本>.zip
 *   node tools/pack-build.mjs --pack bilibili
 *   node tools/pack-build.mjs --all              # 所有包各出一个
 *
 * 流程：先过 pack-check（共用 pack-rules），再压缩，再回读校验条目。
 * **本体分发包不含任何 packs**；这些 zip 由使用者/发行渠道单独分发。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { scanDir, explain } from '../runtime/pack-rules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKS = path.join(ROOT, 'packs');
const DIST = path.join(ROOT, 'dist');

const argv = process.argv.slice(2);
const argOf = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 ? (argv[i + 1] ?? true) : d; };

/** 用系统 tar 打 zip（Windows 10+ 自带 bsdtar，支持 -a 自动按扩展名压缩） */
function makeZip(packDir, outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  if (fs.existsSync(outFile)) fs.rmSync(outFile, { force: true });
  const name = path.basename(packDir);
  // 分发物只带运行期代码：测试文件是开发期产物，不随包发
  const r = spawnSync('tar', ['-a', '-cf', outFile, '--exclude', '*.test.mjs', '-C', path.dirname(packDir), name], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`tar 打包失败：${r.stderr ?? ''}`);
  return fs.statSync(outFile).size;
}

function verifyZip(outFile, name) {
  const r = spawnSync('tar', ['-tf', outFile], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`回读 zip 失败：${r.stderr ?? ''}`);
  const entries = r.stdout.split(/\r?\n/).filter(Boolean);
  const outside = entries.filter((e) => !e.replace(/\\/g, '/').startsWith(`${name}/`));
  return { entries, outside };
}

function build(name) {
  const dir = path.join(PACKS, name);
  if (!fs.existsSync(dir)) { console.error(`没有这个包：${name}`); return false; }

  // 出站闸门：和入站共用同一份规则
  const check = scanDir(dir);
  if (!check.ok) {
    console.error(`❌ ${name}：${explain(check)}`);
    for (const h of check.hits) console.error(`   - ${h.path}（${h.id}）`);
    return false;
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8').replace(/^\uFEFF/, ''));
  const out = path.join(DIST, `${name}-${manifest.version}.zip`);
  const bytes = makeZip(dir, out);
  const { entries, outside } = verifyZip(out, name);

  if (outside.length) { console.error(`❌ ${name}：zip 里有包目录之外的条目：${outside.slice(0, 3).join(', ')}`); return false; }

  console.log(`✅ ${path.relative(ROOT, out).replace(/\\/g, '/')}  ${entries.length} 个条目 / ${(bytes / 1024).toFixed(1)} KB  （${manifest.publisher}/${manifest.name}@${manifest.version}）`);
  return true;
}

const all = argv.includes('--all');
const one = argOf('--pack');
if (!all && !one) {
  console.error('用法：node tools/pack-build.mjs --pack <包名> | --all');
  process.exit(2);
}

const names = all
  ? fs.readdirSync(PACKS).filter((n) => !n.startsWith('_') && fs.existsSync(path.join(PACKS, n, 'pack.json')))
  : [String(one)];

let ok = 0;
for (const n of names) if (build(n)) ok += 1;

console.log(`\n出包完成：${ok}/${names.length}`);
console.log('注意：这些 zip 是**扩展**，不进本体分发包；本体只有 kernel/ + runtime/。');
process.exit(ok === names.length ? 0 : 1);
