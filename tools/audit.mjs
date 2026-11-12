/**
 * 全局体检（架构整洁度）
 * ============================================================================
 * 适应度函数管"规则"（依赖方向/渠道名/可测性），这个管"整洁"：
 *
 *   A 编码损坏   —— GBK 乱码 / 替换符（会让人名、日志全变乱码）
 *   B 占位符     —— TODO/FIXME/XXX/HACK 不许进主干
 *   C 库代码日志 —— 内核/运行时/包里不许 console.*（要记就记审计）
 *   D 重复导出   —— 同名真定义出现两次（再导出与包契约不算）
 *   E import     —— 相对路径必须能解析（写错路径 = 运行时才炸）
 *   F 死导出     —— 定义了却全项目没人用（投机 API）
 *   G 加载       —— 每个模块都必须能被 import（语法/顶层错误）
 *
 * 跑法：node tools/audit.mjs         （exit 0 = 干净）
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['shared', 'kernel', 'runtime', 'packs', 'app', 'tools'];
const PACK_CONTRACT = new Set([
  'identity', 'capabilities', 'settings', 'open', 'send', 'health', 'close',
  'configure', 'attach', 'push', 'plan', 'setFocus', 'focusOn',
]);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) { if (!name.startsWith('_') && name !== 'node_modules') walk(p, out); }
    else if (/\.(js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

const files = DIRS.flatMap((d) => walk(path.join(ROOT, d))).sort();
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const isTest = (p) => p.endsWith('.test.mjs');
// 体检脚本自身就写着 TODO/FIXME 与乱码样本，跳过它自己
const isMeta = (p) => rel(p).startsWith('tools/');
const src = new Map(files.map((f) => [f, fs.readFileSync(f, 'utf8')]));

const report = { encoding: [], placeholders: [], logs: [], dupExports: [], badImports: [], unusedExports: [], loadFail: [], silentTests: [] };

/* A. 编码损坏（代码 + 我们自己维护的文档） */
const MOJI = /[\uFFFD]|锛|鈥|銆|涓婅|鏄|鍜|璇|绋|鎴|浣|姝|鐨|鏂|鎬|璁|鍔/g;
for (const [f, s] of src) {
  if (isMeta(f)) continue;
  const hits = [...s.matchAll(MOJI)].length;
  if (hits > 0) {
    const idx = s.split(/\r?\n/).findIndex((l) => MOJI.test(l));
    report.encoding.push({ file: rel(f), hits, firstLine: idx + 1, sample: (s.split(/\r?\n/)[idx] ?? '').slice(0, 60) });
  }
}

/* A2. 文档编码损坏：docs/persona-core 与 docs/README.md
 * （真实发生过：用 PowerShell 的 Get-Content/Set-Content 改写中文文档，
 *   会按 ANSI 读 UTF-8 再写回去，整篇变乱码。这条检查专抓这种事故。） */
const docFiles = [];
const pcDir = path.join(ROOT, 'docs', 'persona-core');
if (fs.existsSync(pcDir)) for (const n of fs.readdirSync(pcDir)) {
  if (n.endsWith('.md')) docFiles.push(path.join(pcDir, n));
}
const readme = path.join(ROOT, 'docs', 'README.md');
if (fs.existsSync(readme)) docFiles.push(readme);
for (const f of docFiles) {
  const s = fs.readFileSync(f, 'utf8');
  const hits = [...s.matchAll(MOJI)].length;
  if (hits > 0) {
    const idx = s.split(/\r?\n/).findIndex((l) => MOJI.test(l));
    report.encoding.push({ file: rel(f), hits, firstLine: idx + 1, sample: (s.split(/\r?\n/)[idx] ?? '').slice(0, 60) });
  }
}

/* B. 占位符 */
for (const [f, s] of src) {
  if (isMeta(f)) continue;
  for (const m of s.matchAll(/\b(TODO|FIXME|XXX|HACK)\b/g)) report.placeholders.push({ file: rel(f), at: m[1] });
}

/* C. 库代码里的 console.*（app/tools/测试允许） */
for (const [f, s] of src) {
  const r = rel(f);
  if (isTest(f) || r.startsWith('app/') || r.startsWith('tools/')) continue;
  s.split(/\r?\n/).forEach((l, i) => {
    if (/^\s*console\.(log|warn|error|info)\(/.test(l)) report.logs.push({ file: r, line: i + 1, text: l.trim().slice(0, 60) });
  });
}

/* D. 重复导出（只算真定义；再导出 / 包契约不算） */
const byExport = new Map();
for (const [f, s] of src) {
  if (isTest(f)) continue;
  const r = rel(f);
  for (const m of s.matchAll(/^export\s+(?:async\s+)?(?:function|const|class|let)\s+([A-Za-z0-9_$]+)/gm)) {
    const name = m[1];
    if (r.startsWith('packs/') && PACK_CONTRACT.has(name)) continue;
    if (!byExport.has(name)) byExport.set(name, []);
    byExport.get(name).push(r);
  }
}
for (const [name, where] of byExport) {
  if (new Set(where).size > 1) report.dupExports.push({ name, where: [...new Set(where)] });
}

/* E. import 能不能解析 */
for (const [f, s] of src) {
  for (const m of s.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const target = path.resolve(path.dirname(f), m[1]);
    const candidates = [target, `${target}.js`, `${target}.mjs`, path.join(target, 'index.js')];
    if (!candidates.some((c) => fs.existsSync(c))) report.badImports.push({ file: rel(f), spec: m[1] });
  }
}

/* F. 死导出：全文出现次数 <= 1（只有定义那一处） */
for (const [name, where] of byExport) {
  if (name.length < 4) continue;
  let occurrences = 0;
  for (const s of src.values()) occurrences += (s.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length;
  if (occurrences <= 1) report.unusedExports.push({ name, definedIn: where });
}

/* G. 模块能不能被加载（入口脚本有副作用，跳过） */
for (const f of files) {
  if (isTest(f)) continue;
  const r = rel(f);
  if (r.startsWith('app/') || r.startsWith('tools/')) continue;
  try { await import(pathToFileURL(f).href); }
  catch (error) { report.loadFail.push({ file: r, error: String(error?.message ?? error).slice(0, 120) }); }
}

/* H. 每个测试文件必须能"失败时退出 1"（否则门禁永远绿） */
for (const [f, s] of src) {
  if (!isTest(f)) continue;
  if (!/process\.exit\(\s*1\s*\)/.test(s)) {
    report.silentTests.push({ file: rel(f) });
  }
}

const line = (t) => console.log(`\n=== ${t} ===`);
const none = (arr) => { if (!arr.length) console.log('  ✅ 无'); };

line(`A. 编码损坏（${report.encoding.length}）`);
none(report.encoding);
for (const x of report.encoding) console.log(`  ❌ ${x.file}:${x.firstLine}  命中 ${x.hits} 处  例：${x.sample}`);

line(`B. 占位符 TODO/FIXME（${report.placeholders.length}）`);
none(report.placeholders);
for (const x of report.placeholders) console.log(`  ⚠ ${x.file}  ${x.at}`);

line(`C. 库代码里的 console.*（${report.logs.length}）`);
none(report.logs);
for (const x of report.logs) console.log(`  ⚠ ${x.file}:${x.line}  ${x.text}`);

line(`D. 重复导出名（${report.dupExports.length}）`);
none(report.dupExports);
for (const x of report.dupExports) console.log(`  ❌ ${x.name}  ←  ${x.where.join('  |  ')}`);

line(`E. import 解析失败（${report.badImports.length}）`);
none(report.badImports);
for (const x of report.badImports) console.log(`  ❌ ${x.file}  →  ${x.spec}`);

line(`F. 未见使用的导出（${report.unusedExports.length}）`);
none(report.unusedExports);
for (const x of report.unusedExports) console.log(`  ⚠ ${x.name}  (${x.definedIn.join(', ')})`);

line(`G. 模块加载失败（${report.loadFail.length}）`);
none(report.loadFail);
for (const x of report.loadFail) console.log(`  ❌ ${x.file}: ${x.error}`);

line(`H. 失败会静默通过的测试（${report.silentTests.length}）`);
none(report.silentTests);
for (const x of report.silentTests) console.log(`  ❌ ${x.file}：没有 process.exit(1)，断言失败也会 exit 0`);

const fatal = report.encoding.length + report.dupExports.length + report.badImports.length
  + report.loadFail.length + report.silentTests.length;
const warn = report.placeholders.length + report.logs.length + report.unusedExports.length;
console.log(`\n=== 体检：致命 ${fatal} 个（编码/重复导出/import/加载/静默测试）· 提醒 ${warn} 条 ===`);
process.exit(fatal ? 1 : 0);
