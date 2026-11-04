// 管理员卡片输入框不能再超框：box-sizing + max-width 必须存在。
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync('plugins/surfcore/lib/client.js', 'utf8');
assert.match(src, /\.qbw-input,\.qbw-select,\.qbw-textarea\{[^}]*box-sizing:border-box/,
  '基础输入控件必须 border-box，否则 width:100% 会加 padding/border 溢出');
assert.match(src, /\.qbw-admin-field \.qbw-input\{[^}]*max-width:240px/,
  '管理员输入框必须有最大宽度');
assert.match(src, /\.qbw-admin-field \.qbw-select\{[^}]*max-width:240px/,
  '管理员下拉框必须有最大宽度');
console.log('✅ 管理员输入框盒模型测试通过');
