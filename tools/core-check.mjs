/**
 * 本体检查：确认"核心只有内核 + 适配器"
 * ============================================================================
 * 检查项：
 *   A 核心文件里没有二进制/依赖目录/第三方运行时（复用 pack-rules 的规则）
 *   B 核心代码不 import 任何扩展（packs/）——依赖方向不许倒
 *   C 核心代码里没有渠道名字面量（比 fitness 覆盖面更宽）
 *   D 核心包清单里**一个平台包都不含**
 *
 * 跑法：node tools/core-check.mjs         （exit 0 = 干净）
 */
import fs from 'node:fs';
import path from 'node:path';
import { CORE_PATHS, EXTENSION_PATHS, DEV_PATHS, listCoreFiles, describeCore } from './core-manifest.mjs';
import { scanPaths, explain } from '../runtime/pack-rules.mjs';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..');
const problems = [];

/* A 内容 */
const files = listCoreFiles();
const content = scanPaths(files);
if (!content.ok) {
  problems.push(`[内容] 核心里有禁止内容：${explain(content)}`);
  for (const h of content.hits.slice(0, 5)) problems.push(`      ${h.path}（${h.id}）`);
}

/* B 依赖方向：核心不许 import packs */
let importHits = 0;
for (const rel of files) {
  if (!/\.(js|mjs)$/.test(rel)) continue;
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    if (/(^|\/)packs\//.test(m[1])) { problems.push(`[依赖] ${rel} 依赖了扩展：${m[1]}`); importHits += 1; }
  }
}

/* C 渠道名（比 fitness 更宽） */
const CHANNELS = ['qq', 'bili', 'bilibili', 'pet', 'tieba', 'douyin', 'wechat', 'xiaohongshu'];
let channelHits = 0;
for (const rel of files) {
  if (!/\.(js|mjs)$/.test(rel)) continue;
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  for (const c of CHANNELS) {
    if (new RegExp(`['"\`]${c}['"\`]`, 'i').test(src)) { problems.push(`[渠道名] ${rel} 出现 '${c}'`); channelHits += 1; }
  }
}

/* D 核心包里不许有平台包 / 开发期目录 */
const coreHasPacks = files.some((f) => f.startsWith(`${EXTENSION_PATHS[0]}/`));
if (coreHasPacks) problems.push(`[边界] 核心清单里出现了 ${EXTENSION_PATHS[0]}/`);
for (const dev of DEV_PATHS) {
  if (files.some((f) => f.startsWith(`${dev}/`))) problems.push(`[边界] 核心清单里出现了开发期目录 ${dev}/`);
}

/* 报告 */
const lines = files.reduce((n, rel) => n + fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/).length, 0);
console.log(`本体：${describeCore()}`);
console.log(`核心文件：${files.length} 个 / ${lines} 行；其中平台包：${coreHasPacks ? '有（❌）' : '0 个'}`);

if (!problems.length) {
  console.log('✅ 本体干净：无二进制 / 不依赖扩展 / 无渠道名 / 不含平台包');
  process.exit(0);
}
console.error(`\n❌ 本体检查发现 ${problems.length} 个问题：`);
for (const p of problems) console.error(`   - ${p}`);
process.exit(1);
