// 界面可见性回归：防止"浅色底 + 浅色字"和"未限定作用域的全局覆盖"再次出现。
//
// 背景：2026-10-27 深色主题下更新弹窗像白膜（白底浅字）；
// 2026-11-01 反过来：一键安装弹窗写死深色，浅色主题下深底深字。
// 现在规则：**所有弹窗必须跟随主题 token**，不允许写死深/浅色。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'client.js');
const css = fs.readFileSync(file, 'utf8');

// 1) 弹窗必须成对使用主题表面色/前景色，不能写死颜色
const modal = /\.qbw-modal\{([^}]*)\}/.exec(css)?.[1] ?? '';
assert.ok(modal, '找不到 .qbw-modal 样式');
assert.match(modal, /background:\s*var\(--qbw-surface\)/, '.qbw-modal 背景必须用 --qbw-surface（跟随深浅主题）');
assert.match(modal, /color:\s*var\(--qbw-text\)/, '.qbw-modal 文字必须用 --qbw-text');
assert.ok(!/#[0-9a-f]{3,8}/i.test(modal), '.qbw-modal 不允许写死颜色');

// 2) 主题语义层必须存在，且映射 DSH 的 light/dark token
for (const token of ['--qbw-surface', '--qbw-text', '--qbw-muted', '--qbw-line', '--qbw-brand']) {
  assert.ok(css.includes(`${token}:`), `缺少主题变量 ${token}`);
}
assert.ok(css.includes('var(--dsw-alias-bg-overlay') && css.includes('var(--dsw-alias-label-primary'),
  '--qbw-* 必须映射 DSH 主题 token');

// 3) 禁止未限定作用域的固定浅色文字覆盖（会污染所有页面）
const globalLightText = [/^\.qbw-hint\{color:#/m, /^\.qbw-chip\{background:rgba\(255,255,255/m];
for (const bad of globalLightText) {
  assert.ok(!bad.test(css), `发现未限定作用域的浅色覆盖：${bad}`);
}

// 4) 旧的“弹窗强制浅色”补丁必须已经删除
assert.ok(!css.includes('#9aa3ad'), '弹窗不允许再写死 #9aa3ad');
assert.ok(!/\.qbw-modal[^{]*\{[^}]*color:\s*#f2f5f7/i.test(css), '弹窗不允许强制浅色文字');

// 5) 交互状态必须可见（hover / focus-visible / disabled）
assert.ok(css.includes('.qbw-btn2:hover:not(:disabled)'), '次要按钮缺少 hover 样式');
assert.ok(css.includes('.qbw-btn:focus-visible'), '按钮缺少 focus-visible 样式');
assert.ok(/\.qbw-btn:disabled/.test(css), '按钮缺少 disabled 样式');

// 6) 主要文字使用主题 label token（而不是写死 #fff）
assert.match(css, /\.qbw-app\{[^}]*color:var\(--dsw-alias-label-primary\)/, '.qbw-app 的文字颜色应跟随主题 label-primary');

console.log('✅ 界面可见性检查通过');
