/**
 * 能力清单对账：登记表 ↔ 真实代码
 * ============================================================================
 * 目的（准则 012/013）：**每个模块的能力与位置，一眼可见，且不会漂移。**
 *
 * 做三件事：
 *   ① 校验登记表：模块路径存在吗？status 合法吗？有没有模块漏登记？
 *   ② 渲染 docs/persona-core/CAPABILITY-MAP.md（文档由它生成，不手改）
 *   ③ --check 模式：有漂移就 exit 1（接进日常门禁）
 *
 * 跑法：
 *   node tools/capability-map.mjs           # 渲染 + 校验（漂移时 exit 1）
 *   node tools/capability-map.mjs --check   # 只校验，不写文件
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = path.join(ROOT, 'docs', 'persona-core', 'capability-map.json');
const OUTPUT = path.join(ROOT, 'docs', 'persona-core', 'CAPABILITY-MAP.md');
const CHECK_ONLY = process.argv.includes('--check');
const STATUSES = new Set(['done', 'partial', 'missing']);
const LEVELS = new Set(['function', 'wired', 'persisted', 'device']);
const LEVEL_LABEL = { function: '函数', wired: '接线', persisted: '落盘', device: '真机' };
const LAYER_ORDER = ['shared', 'kernel', 'runtime', 'packs', 'app', 'dev'];
const LAYER_LABEL = { dev: 'dev（四层之外 · 开发设施，不是一层）' };
const ICON = { done: '✅', partial: '🟡', missing: '⬜' };

const problems = [];
let registry;
try {
  registry = JSON.parse(fs.readFileSync(REGISTRY, 'utf8').replace(/^\uFEFF/, ''));
} catch (error) {
  console.error(`读不了登记表：${error?.message ?? error}`);
  process.exit(1);
}

const modules = Array.isArray(registry.modules) ? registry.modules : [];

/* ① 校验：路径存在、状态合法、能力非空、层级合法 */
for (const m of modules) {
  const target = path.join(ROOT, m.path);
  if (!fs.existsSync(target)) problems.push(`模块 ${m.id}：路径不存在 ${m.path}`);
  if (!LAYER_ORDER.includes(m.layer)) problems.push(`模块 ${m.id}：层级不合法 ${m.layer}`);
  if (!m.role) problems.push(`模块 ${m.id}：缺少 role（它是干什么的）`);
  if (!Array.isArray(m.capabilities) || !m.capabilities.length) problems.push(`模块 ${m.id}：没有任何能力条目`);
  for (const c of m.capabilities ?? []) {
    if (!c.name) problems.push(`模块 ${m.id}：有能力的 name 为空`);
    if (!STATUSES.has(c.status)) problems.push(`模块 ${m.id} / ${c.name}：status 不合法（${c.status}）`);
    if (c.level !== undefined && !LEVELS.has(c.level)) problems.push(`模块 ${m.id} / ${c.name}：level 不合法（${c.level}）`);
    if (c.status === 'done' && !c.evidence) problems.push(`模块 ${m.id} / ${c.name}：标了 done 却没给 evidence`);
    // done 但连"接线"都没到 → 提醒（顾问审阅指出的口径问题）
    if (c.status === 'done' && c.level === 'function') {
      problems.push(`模块 ${m.id} / ${c.name}：done 但只到"函数"级（还没接线）——请改 level 或降为 partial`);
    }
  }
  // 依赖可以写模块 id，也可以写层名（kernel/runtime/...），或 xxx.*
  const ids = new Set(modules.map((x) => x.id));
  const layers = new Set(LAYER_ORDER);
  for (const dep of m.position?.dependsOn ?? []) {
    if (!ids.has(dep) && !layers.has(dep) && !dep.endsWith('.*')) {
      problems.push(`模块 ${m.id}：依赖了未登记的 ${dep}（既不是模块 id，也不是层名）`);
    }
  }
}

/* ② 反向检查：有没有代码模块漏登记（按目录前缀匹配） */
const registered = modules.map((m) => m.path.replace(/\/$/, ''));
const CODE_DIRS = ['shared', 'kernel', 'runtime', 'packs', 'app', 'tools'];
const orphans = [];
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
for (const d of CODE_DIRS) {
  for (const f of walk(path.join(ROOT, d))) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    if (rel.endsWith('.test.mjs')) continue;
    const covered = registered.some((r) => rel === r || rel.startsWith(`${r}/`) || (r.endsWith('.js') && rel === r));
    if (!covered) orphans.push(rel);
  }
}
for (const o of orphans) problems.push(`未登记的文件：${o}`);

/* ③ 渲染 */
const lines = [];
lines.push('# 能力清单（模块 × 位置 × 做没做）');
lines.push('');
lines.push('> **本文件由 `tools/capability-map.mjs` 生成**，不要手改；改 `capability-map.json` 后重跑。');
lines.push(`> 最后更新：${registry.updatedAt ?? '—'}　·　检查命令：\`node tools/capability-map.mjs --check\``);
lines.push('');

const counts = { done: 0, partial: 0, missing: 0 };
for (const m of modules) for (const c of m.capabilities ?? []) counts[c.status] = (counts[c.status] ?? 0) + 1;
lines.push(`**合计**：${modules.length} 个模块　·　能力 ${counts.done + counts.partial + counts.missing} 项 —— `
  + `${ICON.done} 已做 ${counts.done}　${ICON.partial} 部分 ${counts.partial}　${ICON.missing} 未做 ${counts.missing}`);
lines.push('');
lines.push('> **证据等级**（顾问审阅要求）：`函数`=有实现有单测；`接线`=运行时真被调用；'
  + '`落盘`=重启后还在；`真机`=对着真实平台/服务跑通过。'
  + '没有标等级的条目，默认只到"函数"级——**别把 ✅ 当"已经保住"**。');
lines.push('');

for (const layer of LAYER_ORDER) {
  const group = modules.filter((m) => m.layer === layer);
  if (!group.length) continue;
  lines.push(`## ${LAYER_LABEL[layer] ?? `${layer}/`}`);
  lines.push('');
  for (const m of group) {
    const pos = m.position ?? {};
    lines.push(`### ${m.id}　\`${m.path}\``);
    lines.push('');
    lines.push(`**它是什么**：${m.role}`);
    lines.push('');
    lines.push('**它的位置**：'
      + `依赖 ${(pos.dependsOn ?? []).join('、') || '（无）'}；`
      + `被 ${(pos.dependedBy ?? []).join('、') || '（无）'} 依赖；`
      + `**不许依赖** ${(pos.mustNot ?? []).join('、') || '（无限制）'}`);
    lines.push('');
    lines.push('| 能力 | 状态 | 证据 / 出处 |');
    lines.push('| --- | --- | --- |');
    for (const c of m.capabilities ?? []) {
      const evidence = c.status === 'done'
        ? (c.evidence ?? '—')
        : (c.legacy ? `旧代码：${c.legacy}` : (c.note ?? '—'));
      const phase = c.status === 'done' ? '' : (c.phase ? `　<sub>${c.phase}期</sub>` : '');
      const level = c.level ? `　<sub>${LEVEL_LABEL[c.level] ?? c.level}</sub>` : '';
      lines.push(`| ${c.name} | ${ICON[c.status]} | ${evidence}${level}${phase} |`);
    }
    lines.push('');
  }
}

lines.push('---');
lines.push('');
lines.push('## 判据（怎么算"放对位置"）');
lines.push('');
lines.push('| 这件事是… | 就放在… |');
lines.push('| --- | --- |');
lines.push('| 关于"她"的判断（记不记、说不说、用不用语音） | 内核 |');
lines.push('| 关于"怎么运"的机械动作（重试、脱敏、限流、装包） | 运行时 |');
lines.push('| 关于"那个平台"的规矩（消息段、审批、限速） | 平台包 |');
lines.push('| 界面 / 更新 / 诊断 | 本体外（app、tools） |');
lines.push('');

const md = lines.join('\n');

if (!CHECK_ONLY) {
  fs.writeFileSync(OUTPUT, md);
}

/* ④ 报告 */
const done = modules.length;
console.log(`能力清单：${done} 个模块 · 能力 ${counts.done + counts.partial + counts.missing} 项`
  + `（${ICON.done}${counts.done} ${ICON.partial}${counts.partial} ${ICON.missing}${counts.missing}）`);
if (!CHECK_ONLY) console.log(`已生成：${path.relative(ROOT, OUTPUT).replace(/\\/g, '/')}`);

if (problems.length) {
  console.error(`\n❌ 漂移 ${problems.length} 处：`);
  for (const p of problems) console.error(`   - ${p}`);
  process.exit(1);
}
console.log('✅ 无漂移：登记表与代码一致（路径存在 / 无漏登记 / done 都有证据）');
