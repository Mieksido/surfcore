/**
 * 日常流程入口：跑所有层级的测试 + 适应度函数
 * ============================================================================
 * 架构法则 16：**让架构规则进入日常开发流程**。
 * 改完代码跑这一条就够了：node tools/run-all.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function findTests(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) { if (name !== 'node_modules') findTests(p, out); }
    else if (name.endsWith('.test.mjs')) out.push(p);
  }
  return out;
}

const tests = ['kernel', 'runtime', 'packs', 'app', 'tools'].flatMap((d) => findTests(path.join(ROOT, d))).sort();
let failed = 0;
const summary = [];

for (const file of tests) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const r = spawnSync(process.execPath, [file], { cwd: ROOT, encoding: 'utf8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const last = out.trim().split(/\r?\n/).filter(Boolean).pop() ?? '';
  if (r.status === 0) {
    summary.push(`  ✅ ${rel.padEnd(40)} ${last}`);
  } else {
    failed += 1;
    summary.push(`  ❌ ${rel.padEnd(40)} ${last}`);
    console.error(`\n--- ${rel} 输出 ---\n${out}`);
  }
}

// 词面门禁：内核/大适配器不得出现平台词或旧实现词
const words = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'platform-word-gate.mjs')], { cwd: ROOT, encoding: 'utf8' });
const wordsOut = `${words.stdout ?? ''}${words.stderr ?? ''}`.trim();
if (words.status !== 0) failed += 1;
summary.push(`  ${words.status === 0 ? '✅' : '❌'} tools/platform-word-gate.mjs${' '.repeat(12)} ${wordsOut.split(/\r?\n/).pop() ?? ''}`);

// 适应度函数：架构规则本身也要跑
const fit = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'fitness.mjs')], { cwd: ROOT, encoding: 'utf8' });
const fitOut = `${fit.stdout ?? ''}${fit.stderr ?? ''}`.trim();
if (fit.status !== 0) failed += 1;
summary.push(`  ${fit.status === 0 ? '✅' : '❌'} tools/fitness.mjs${' '.repeat(23)} ${fitOut.split(/\r?\n/).pop() ?? ''}`);

// 全局体检：编码/占位符/日志/重复导出/import/死导出/加载
const audit = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'audit.mjs')], { cwd: ROOT, encoding: 'utf8' });
const auditOut = `${audit.stdout ?? ''}${audit.stderr ?? ''}`.trim();
if (audit.status !== 0) failed += 1;
summary.push(`  ${audit.status === 0 ? '✅' : '❌'} tools/audit.mjs${' '.repeat(25)} ${auditOut.split(/\r?\n/).pop() ?? ''}`);

// 本体检查：核心只有内核 + 适配器（不含平台包 / 无二进制 / 不依赖扩展）
const core = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'core-check.mjs')], { cwd: ROOT, encoding: 'utf8' });
const coreOut = `${core.stdout ?? ''}${core.stderr ?? ''}`.trim();
if (core.status !== 0) failed += 1;
summary.push(`  ${core.status === 0 ? '✅' : '❌'} tools/core-check.mjs${' '.repeat(21)} ${coreOut.split(/\r?\n/).pop() ?? ''}`);

// 能力清单对账：登记表 ↔ 真实代码（漏登记/路径不存在/done 没证据 都会红）
const cap = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'capability-map.mjs')], { cwd: ROOT, encoding: 'utf8' });
const capOut = `${cap.stdout ?? ''}${cap.stderr ?? ''}`.trim();
if (cap.status !== 0) failed += 1;
summary.push(`  ${cap.status === 0 ? '✅' : '❌'} tools/capability-map.mjs${' '.repeat(17)} ${capOut.split(/\r?\n/).pop() ?? ''}`);

// 旧仓库基线：映射是否自洽（mappedTo 必须指向真实新模块）
const leg = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'legacy-map.mjs')], { cwd: ROOT, encoding: 'utf8' });
const legOut = `${leg.stdout ?? ''}${leg.stderr ?? ''}`.trim();
if (leg.status !== 0) failed += 1;
summary.push(`  ${leg.status === 0 ? '✅' : '❌'} tools/legacy-map.mjs${' '.repeat(22)} ${legOut.split(/\r?\n/).pop() ?? ''}`);

console.log('\n=== 测试总览 ===');
console.log(summary.join('\n'));
console.log(`\n共 ${tests.length} 个测试文件 + 适应度函数 + 全局体检；失败 ${failed} 个`);
process.exit(failed ? 1 : 0);
