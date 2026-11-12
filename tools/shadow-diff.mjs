/**
 * 影子对比：旧记忆 vs 新内核影子状态（只读）
 * ============================================================================
 * 位置：四层之外的验证工具；不写任何状态。
 *
 * 只比较“文本是否覆盖”，不做语义判断；用来发现迁移丢条/多出/重复。
 */
import fs from 'node:fs';
import path from 'node:path';

function argOf(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : fallback;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch {}
  }
  return out;
}

function norm(text) { return String(text ?? '').replace(/\s+/g, ' ').trim(); }

export function diffShadow({ oldDir, stateDir } = {}) {
  if (!oldDir || !stateDir) throw new Error('需要 oldDir 和 stateDir');
  const oldCardFile = path.join(oldDir, 'memory-card.json');
  const oldFullFile = path.join(oldDir, 'memory-card-full.jsonl');
  const newFullFile = path.join(stateDir, 'memory-full.jsonl');
  if (!fs.existsSync(newFullFile)) throw new Error(`新影子全量卡不存在：${newFullFile}`);

  const oldCard = fs.existsSync(oldCardFile) ? JSON.parse(fs.readFileSync(oldCardFile, 'utf8')) : {};
  const oldCardRecords = Array.isArray(oldCard?.records) ? oldCard.records : [];
  const oldFull = readJsonl(oldFullFile);
  const newFull = readJsonl(newFullFile);

  const oldAll = [...oldCardRecords, ...oldFull];
  const oldTexts = new Set();
  const oldDup = new Set();
  for (const r of oldAll) {
    const t = norm(r?.text);
    if (!t) continue;
    if (oldTexts.has(t)) oldDup.add(t);
    else oldTexts.add(t);
  }
  const newTexts = new Set();
  const newDup = new Set();
  for (const r of newFull) {
    const t = norm(r?.text);
    if (!t) continue;
    if (newTexts.has(t)) newDup.add(t);
    else newTexts.add(t);
  }
  const missing = [...oldTexts].filter((t) => !newTexts.has(t));
  const extra = [...newTexts].filter((t) => !oldTexts.has(t));
  return {
    ok: true,
    old: { card: oldCardRecords.length, full: oldFull.length, uniqueTexts: oldTexts.size, duplicateTexts: oldDup.size },
    shadow: { full: newFull.length, uniqueTexts: newTexts.size, duplicateTexts: newDup.size },
    coverage: oldTexts.size ? Number((1 - missing.length / oldTexts.size).toFixed(4)) : 1,
    missing: missing.slice(0, 20),
    missingCount: missing.length,
    extra: extra.slice(0, 20),
    extraCount: extra.length,
  };
}

if (process.argv[1]?.endsWith('shadow-diff.mjs')) {
  try {
    const report = diffShadow({ oldDir: argOf('from'), stateDir: argOf('state') });
    if (hasFlag('json')) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`旧记忆：卡 ${report.old.card} · 全量 ${report.old.full} · 唯一文本 ${report.old.uniqueTexts} · 重复 ${report.old.duplicateTexts}`);
      console.log(`影子：全量 ${report.shadow.full} · 唯一文本 ${report.shadow.uniqueTexts} · 重复 ${report.shadow.duplicateTexts}`);
      console.log(`覆盖率：${(report.coverage * 100).toFixed(2)}% · 缺失 ${report.missingCount} · 多出 ${report.extraCount}`);
      if (report.missing.length) console.log(`缺失样例：\n- ${report.missing.join('\n- ')}`);
    }
  } catch (error) {
    console.error(`对比失败：${error?.message ?? error}`);
    process.exit(1);
  }
}

export { readJsonl };
