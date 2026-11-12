/**
 * 记忆切流：把 shadow 状态提升成正式新内核状态（工具，不属于四层）
 * ============================================================================
 * 默认 dry-run；--apply 才复制。拒绝覆盖已有正式状态。
 * 只复制新内核状态文件，不动旧 memory-card。
 */
import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}

export function planCutover({ from, to } = {}) {
  const src = path.resolve(String(from ?? 'state/persona-core-shadow'));
  const dest = path.resolve(String(to ?? 'state/persona-core'));
  const srcFile = path.join(src, 'kernel-state.json');
  if (!fs.existsSync(srcFile)) return { ok: false, code: 'memory.cutover.source-missing', error: `没有源状态：${srcFile}` };
  if (path.resolve(src) === path.resolve(dest)) return { ok: false, code: 'memory.cutover.same-path', error: '源和目标是同一目录' };
  let records = 0;
  try { records = Array.isArray(JSON.parse(fs.readFileSync(srcFile, 'utf8')).records) ? JSON.parse(fs.readFileSync(srcFile, 'utf8')).records.length : 0; } catch {}
  const targetExists = fs.existsSync(path.join(dest, 'kernel-state.json'));
  return { ok: true, src, dest, records, targetExists, files: ['kernel-state.json', 'memory-full.jsonl'].filter((f) => fs.existsSync(path.join(src, f))) };
}

export function applyCutover({ from, to } = {}) {
  const plan = planCutover({ from, to });
  if (!plan.ok) return plan;
  if (plan.targetExists) return { ok: false, code: 'memory.cutover.target-exists', error: `目标已有正式状态，拒绝覆盖：${plan.dest}` };
  fs.mkdirSync(plan.dest, { recursive: true });
  for (const file of plan.files) fs.copyFileSync(path.join(plan.src, file), path.join(plan.dest, file));
  fs.writeFileSync(path.join(plan.dest, 'cutover.json'), `${JSON.stringify({ version: 1, from: plan.src, at: Date.now(), records: plan.records }, null, 2)}\n`, 'utf8');
  return { ...plan, applied: true };
}

if (process.argv[1]?.endsWith('cutover-memory.mjs')) {
  const from = arg('from', 'state/persona-core-shadow');
  const to = arg('to', 'state/persona-core');
  const apply = process.argv.includes('--apply');
  try {
    const out = apply ? applyCutover({ from, to }) : planCutover({ from, to });
    console.log(JSON.stringify(out, null, 2));
    if (!out.ok) process.exit(1);
  } catch (error) {
    console.error(`切流失败：${error?.message ?? error}`);
    process.exit(1);
  }
}
