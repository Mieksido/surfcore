/**
 * 适应度函数（免疫系统）
 * ============================================================================
 * 架构法则 16：把规则写成**会自动变红的检查**，并且进日常流程。
 *
 * 现在检查三条：
 *   ① 内核与运行时里不许出现渠道名字面量（法则 11：业务不认识外部世界）
 *   ② 依赖方向不许倒（法则 7/8：稳定的不依赖易变的，且不成环）
 *      · kernel/ 不许 import runtime/、packs/、tools/
 *      · runtime/ 不许 import packs/、kernel/、tools/
 *      · packs/ 不许 import kernel/、tools/
 *      · tools/ 是四层之外的开发设施：它可以读四层，四层不许读它
 *   ③ 每个"有代码的目录"必须有测试（法则 15：能单独测）
 *
 * 跑法：node tools/fitness.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHANNEL_NAMES = ['qq', 'bili', 'bilibili', 'pet', 'tieba', 'douyin', 'wechat', 'xiaohongshu'];

function walk(dir, out = [], exts = ['.js']) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) { if (name !== 'node_modules') walk(p, out, exts); }
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const problems = [];

/* ── ① 不许出现渠道名 ── */
for (const dir of ['kernel', 'runtime']) {
  for (const file of walk(path.join(ROOT, dir))) {
    const src = fs.readFileSync(file, 'utf8');
    for (const name of CHANNEL_NAMES) {
      if (new RegExp(`['"\`]${name}['"\`]`, 'i').test(src)) {
        problems.push(`[渠道名] ${rel(file)} 出现了 '${name}'（法则 11：内核/运行时不许认识渠道）`);
      }
    }
  }
}

/* ── ② 依赖方向 ── */
const FORBIDDEN = [
  { from: 'kernel/', to: ['runtime/', 'packs/', 'tools/'], why: '内核是最稳定的一层，不许依赖易变层/开发设施（法则 7）' },
  { from: 'runtime/', to: ['packs/', 'kernel/', 'tools/'], why: '运行时只是管道，不许认识平台包/内核/开发设施' },
  { from: 'packs/', to: ['kernel/', 'tools/'], why: '平台包不许直接调内核或开发设施（法则 11）' },
  { from: 'capabilities/', to: ['kernel/', 'runtime/', 'packs/', 'tools/'], why: '能力包必须能被任何平台复用，不许反向依赖（法则 7）' },
];

for (const rule of FORBIDDEN) {
  for (const file of walk(path.join(ROOT, rule.from))) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      for (const bad of rule.to) {
        if (spec.includes(bad)) {
          problems.push(`[依赖方向] ${rel(file)} 依赖了 ${spec} —— ${rule.why}`);
        }
      }
    }
  }
}

/* ── ③ 每个有代码的目录必须有测试 ── */
for (const dir of ['kernel', 'runtime', 'packs']) {
  const code = walk(path.join(ROOT, dir), [], ['.js']);
  if (!code.length) continue;
  const tests = walk(path.join(ROOT, dir), [], ['.test.mjs']);
  if (!tests.length) problems.push(`[可测性] ${dir}/ 里没有任何 *.test.mjs（法则 15）`);
}

/* ── 报告 ── */
if (!problems.length) {
  console.log('✅ 适应度函数：全部通过（渠道名 0 处 / 依赖方向正确 / 每层都有测试）');
  process.exit(0);
}
console.error(`❌ 适应度函数：${problems.length} 个问题`);
for (const p of problems) console.error('  - ' + p);
process.exit(1);
