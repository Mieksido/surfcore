/**
 * QQ 文本处理：CQ 转义 / 拆条 / Markdown 清理
 * 跑法：node packs/qq/text.test.mjs
 */
import { escapeCq, unescapeCq, safeText, splitForSend, markdownToPlain } from './text.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass += 1; console.log('  ✅', n); } else { fail += 1; console.error('  ❌', n); } };

console.log('## CQ 转义');
{
  ok(escapeCq('[CQ:at,qq=1]') === '&#91;CQ:at,qq=1&#93;', '方括号被转义');
  ok(unescapeCq(escapeCq('a[b]c&d')) === 'a[b]c&d', '可逆');
  ok(safeText('\u0000abc') === 'abc', '控制字符剥掉');
}

console.log('\n## 拆条');
{
  ok(splitForSend('短句', 10).length === 1, '短句不拆');
  const parts = splitForSend('第一句。第二句。第三句。', 6);
  ok(parts.length >= 2 && parts.every((p) => p.length <= 6), '按标点拆且不超长');
  const emoji = '😀'.repeat(10);
  ok(splitForSend(emoji, 3).every((p) => !/^[\uDC00-\uDFFF]/.test(p)), '不劈代理对');
}

console.log('\n## Markdown → 纯文本');
{
  ok(markdownToPlain('**加粗**') === '加粗', '加粗');
  ok(markdownToPlain('## 标题') === '标题', '标题');
  ok(markdownToPlain('*斜体*') === '斜体', '斜体');
  ok(markdownToPlain('`code`') === 'code', '行内代码');
  ok(markdownToPlain('```js\nconst a = 1;\n```') === 'const a = 1;', '围栏代码去围栏');
  ok(markdownToPlain('[官网](https://example.com)') === '官网（https://example.com）', '链接保留文字和地址');
  ok(markdownToPlain('> 引用') === '引用', '引用');
  ok(markdownToPlain('---') === '', '分隔线');
  ok(markdownToPlain('普通文本 **不要** 变成 Markdown') === '普通文本 不要 变成 Markdown', '混合文本');
  ok(markdownToPlain('a\n\n\n\nb') === 'a\n\nb', '压缩空行');
  ok(markdownToPlain('snake_case_name') === 'snake_case_name', '下划线不误伤');
  ok(markdownToPlain('2 * 3 * 4') === '2 * 3 * 4', '乘号不误伤');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
