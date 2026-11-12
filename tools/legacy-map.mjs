/**
 * 旧仓库能力基线：生成对照表 + 覆盖率
 * ============================================================================
 * 目的：以后拿新架构的能力清单**逐条比对**，看功能有没有完全复刻。
 *
 * 它做三件事：
 *   ① 校验基线：mappedTo 指向的新模块必须真实存在（在 capability-map.json 里）
 *   ② 算覆盖率：旧的能力条目里，多少已复刻 / 部分 / 未做 / 红线排除
 *   ③ 渲染 docs/persona-core/LEGACY-CAPABILITY-MAP.md（文档由它生成）
 *
 * 跑法：
 *   node tools/legacy-map.mjs           # 渲染 + 校验（映射错了 exit 1）
 *   node tools/legacy-map.mjs --check   # 只校验
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY = path.join(ROOT, 'docs', 'persona-core', 'legacy-capability-map.json');
const CURRENT = path.join(ROOT, 'docs', 'persona-core', 'capability-map.json');
const OUTPUT = path.join(ROOT, 'docs', 'persona-core', 'LEGACY-CAPABILITY-MAP.md');
const CHECK_ONLY = process.argv.includes('--check');

const STATUSES = new Set(['done', 'partial', 'missing', 'forbidden']);
const ICON = { done: '✅', partial: '🟡', missing: '⬜', forbidden: '⛔' };
const LABEL = { done: '已复刻', partial: '部分', missing: '未做', forbidden: '红线排除' };

const problems = [];
const read = (p, what) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) { console.error(`读不了${what}：${error?.message ?? error}`); process.exit(1); }
};

const legacy = read(LEGACY, '旧仓库基线');
const current = read(CURRENT, '新架构清单');
const currentIds = new Set((current.modules ?? []).map((m) => m.id));
const areas = Array.isArray(legacy.areas) ? legacy.areas : [];

/* ① 校验 */
for (const a of areas) {
  if (!a.id) problems.push('有条目缺少 id');
  if (!STATUSES.has(a.status)) problems.push(`${a.id}：status 不合法（${a.status}）`);
  if (a.mappedTo && !currentIds.has(a.mappedTo)) problems.push(`${a.id}：mappedTo 指向不存在的新模块 ${a.mappedTo}`);
  if (!Array.isArray(a.files) || !a.files.length) problems.push(`${a.id}：没有关联文件`);
  if (!Array.isArray(a.capabilities) || !a.capabilities.length) problems.push(`${a.id}：没有能力条目`);
  for (const f of a.files ?? []) {
    if (!f.path) problems.push(`${a.id}：有文件条目缺 path`);
    if (f.lines === undefined) problems.push(`${a.id} / ${f.path}：缺行数`);
  }
}

/* ② 统计：域级别 + 条目归属（条目状态不单列，避免把"域的部分"说成"条目的部分"） */
const counts = { done: 0, partial: 0, missing: 0, forbidden: 0 };
const capCounts = { done: 0, partial: 0, missing: 0, forbidden: 0 };
for (const a of areas) {
  counts[a.status] = (counts[a.status] ?? 0) + 1;
  for (const _ of a.capabilities ?? []) capCounts[a.status] = (capCounts[a.status] ?? 0) + 1;
}
const totalCaps = Object.values(capCounts).reduce((x, y) => x + y, 0);
const areaTotal = areas.length;
const areaDonePct = areaTotal ? Math.round((counts.done / areaTotal) * 100) : 0;

/* 按状态给小标题排序 */
const order = { done: 0, partial: 1, missing: 2, forbidden: 3 };
const sorted = [...areas].sort((a, b) => (order[a.status] - order[b.status]) || String(a.id).localeCompare(String(b.id)));

/* ③ 渲染 */
const L = [];
L.push('# 旧仓库能力基线（对照用）');
L.push('');
L.push('> **本文件由 `tools/legacy-map.mjs` 生成**，不要手改；改 `legacy-capability-map.json` 后重跑。');
L.push(`> 基线来源：\`${legacy.source}\``);
L.push(`> 旧仓库规模：**${legacy.totals.files} 个文件 / ${legacy.totals.lines.toLocaleString()} 行**`
  + `（src ${legacy.totals.srcFiles} 文件 ${legacy.totals.srcLines.toLocaleString()} 行；lib ${legacy.totals.libFiles} 文件 ${legacy.totals.libLines.toLocaleString()} 行）`);
L.push('');
L.push('## 复刻进度');
L.push('');
L.push(`**按域**：${areaTotal} 个域 —— ${ICON.done} 已复刻 ${counts.done}　${ICON.partial} 部分 ${counts.partial}　${ICON.missing} 未做 ${counts.missing}　${ICON.forbidden} 红线 ${counts.forbidden}（域完全复刻率 ${areaDonePct}%）`);
L.push('');
L.push(`**按能力条目**：共 ${totalCaps} 条，按所属域的状态归属如下（条目本身不做逐条判定）：`);
L.push('');
L.push('| 所属域状态 | 条目数 | 占全部条目 |');
L.push('| --- | --- | --- |');
for (const s of ['done', 'partial', 'missing', 'forbidden']) {
  const p = totalCaps ? Math.round((capCounts[s] / totalCaps) * 100) : 0;
  L.push(`| ${ICON[s]} ${LABEL[s]} | ${capCounts[s]} | ${p}% |`);
}
L.push('');
L.push('> 读法：\"部分\"表示**那个域**已经有新实现但还不完整，不代表这一条能力只做了一半。');
L.push('> 逐条是否复刻，以新架构的 `CAPABILITY-MAP.md` 为准。');
L.push('');
L.push('## 逐域对照');
L.push('');
L.push('| 域 | 状态 | 新位置 | 旧代码 |');
L.push('| --- | --- | --- | --- |');
for (const a of sorted) {
  const files = (a.files ?? []).filter((f) => f.lines > 0).map((f) => `${f.path} <sub>${f.lines}</sub>`).join('<br>');
  L.push(`| ${a.area} | ${ICON[a.status]} ${LABEL[a.status]} | ${a.mappedTo ? `\`${a.mappedTo}\`` : (a.newPath ?? '—')} | ${files} |`);
}
L.push('');

for (const a of sorted) {
  L.push(`### ${ICON[a.status]} ${a.area}`);
  L.push('');
  if (a.mappedTo) L.push(`**新架构对应**：\`${a.mappedTo}\``);
  else if (a.newPath) L.push(`**新架构落位**：${a.newPath}`);
  if (a.note) L.push(`**说明**：${a.note}`);
  L.push('');
  L.push('**旧文件**：');
  L.push('');
  L.push('| 文件 | 行数 | 它做什么 |');
  L.push('| --- | --- | --- |');
  for (const f of a.files ?? []) L.push(`| \`${f.path}\` | ${f.lines} | ${f.what ?? ''} |`);
  L.push('');
  L.push(`**该域的能力**：${(a.capabilities ?? []).join('；')}`);
  L.push('');
}

L.push('---');
L.push('');
L.push('## 怎么用这份基线');
L.push('');
L.push('```powershell');
L.push('node tools/legacy-map.mjs            # 重新生成（映射错了会 exit 1）');
L.push('node tools/capability-map.mjs        # 看新架构当前能力清单');
L.push('```');
L.push('');
L.push('对照方法：拿本文件"逐域对照"表，逐个域看新架构那份清单里的同一条能力是否 ✅；');
L.push('发现对不上的，先改 `legacy-capability-map.json` 的 `mappedTo` 或 `capability-map.json` 的条目，再重跑。');
L.push('');

const md = L.join('\n');
if (!CHECK_ONLY) fs.writeFileSync(OUTPUT, md);

console.log(`旧仓库基线：${areaTotal} 个域 / ${totalCaps} 条能力`);
console.log(`按域：${ICON.done}${counts.done} 已复刻 ${ICON.partial}${counts.partial} 部分 ${ICON.missing}${counts.missing} 未做 ${ICON.forbidden}${counts.forbidden} 红线（域完全复刻率 ${areaDonePct}%）`);
if (!CHECK_ONLY) console.log(`已生成：${path.relative(ROOT, OUTPUT).replace(/\\/g, '/')}`);

if (problems.length) {
  console.error(`\n❌ 基线有问题 ${problems.length} 处：`);
  for (const p of problems) console.error(`   - ${p}`);
  process.exit(1);
}
console.log('✅ 基线自洽：状态合法 / mappedTo 都指向真实的新模块');
