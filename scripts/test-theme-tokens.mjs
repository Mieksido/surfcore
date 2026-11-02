// 主题/对比度约束（2026-11-01）：深色/浅色都不许出现低对比。
// 纯静态检查 + 对 fallback 颜色做 WCAG 计算；不需要浏览器。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

let failures = 0;
const ok = (cond, label, extra = '') => {
  if (cond) console.log(`✅ ${label}`);
  else { failures += 1; console.error(`❌ ${label} ${extra}`); }
};

const source = fs.readFileSync(path.resolve('plugins/surfcore/lib/client.js'), 'utf8');

// DSH Theme provider 实际提供的 token（2026-11-01 通过 client Theme inspect 核对）
const DSH_TOKENS = new Set([
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-overlay',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-brand-primary',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-idle-primary',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-warn-primary',
  '--dsw-specific-sidebar-fill',
]);

const usedDsh = [...new Set(source.match(/--dsw-alias-[a-z0-9-]+/g) ?? [])];
const unknownDsh = usedDsh.filter((t) => !DSH_TOKENS.has(t));
ok(unknownDsh.length === 0, '只用 DSH 真实存在的 token（不能有 label-tertiary）', unknownDsh.join(', '));

// --qbw-* 必须先定义再使用
const defined = new Set([...source.matchAll(/--qbw-([a-z0-9-]+)\s*:/g)].map((m) => `--qbw-${m[1]}`));
const used = [...new Set(source.match(/--qbw-[a-z0-9-]+/g) ?? [])];
const undefinedVars = used.filter((t) => !defined.has(t));
ok(undefinedVars.length === 0, '--qbw-* 变量都有定义（不再有 --qbw-bg2 这类空变量）', undefinedVars.join(', '));

// 弹窗必须跟随主题
ok(/\.qbw-modal\{[^}]*background:var\(--qbw-surface\)[^}]*color:var\(--qbw-text\)/.test(source), 'qbw-modal 使用主题表面色 + 前景色');
ok(!/\.qbw-modal\{[^}]*#1c1f24/.test(source), 'qbw-modal 不再硬编码深色底');
ok(!source.includes('--qbw-bg2'), '安装弹窗不再用未定义的 --qbw-bg2');
ok(!source.includes('label-tertiary'), '不再引用不存在的 label-tertiary');

// 状态可见性
ok(source.includes('.qbw-btn2:hover:not(:disabled)'), '次要按钮有 hover 样式');
ok(source.includes('.qbw-btn:focus-visible'), '按钮有 focus-visible 样式');
ok(/\.qbw-btn:disabled,\.qbw-btn2:disabled/.test(source), '禁用状态有统一处理');

// 对比度：对 fallback（token 全缺失时）做 WCAG 计算，必须 >= 4.5
const lum = (hex) => {
  const rgb = hex.replace('#', '').match(/../g).map((x) => parseInt(x, 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
};
const ratio = (a, b) => {
  const x = lum(a); const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const pairs = [
  ['#1f2328', '#ffffff', '正文/浅色底'],
  ['#5b6472', '#ffffff', '次要文字/浅色底'],
  ['#ffffff', '#2f6fed', '主按钮字/品牌蓝'],
  ['#1f2328', '#f2f4f7', '正文/浅灰底'],
];
for (const [fg, bg, label] of pairs) {
  const r = ratio(fg, bg);
  ok(r >= 4.5, `fallback 对比度 ${label} = ${r.toFixed(2)}:1`);
}

if (failures) { console.error(`\n${failures} 项失败`); process.exit(1); }
console.log('\n✅ 主题/对比度约束通过');
