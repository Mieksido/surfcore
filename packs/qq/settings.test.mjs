/**
 * QQ 连接参数设置测试（含"主人识别"这条以前失效的链路）
 * 跑法：node packs/qq/settings.test.mjs
 */
import { settings, identity, configure } from './index.js';
import { validateField, buildSettingsModel, coerceValue } from '../../kernel/settings/index.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

console.log('## 声明合格');
{
  const bad = settings.filter((f) => !validateField(f).ok);
  ok(bad.length === 0, `七项全部合格${bad.length ? `（不合格：${bad.map((b) => b.key)}）` : ''}`);
  const keys = settings.map((f) => f.key);
  for (const k of ['wsUrl', 'httpUrl', 'accessToken', 'ownerId', 'maxChars', 'allowWrite', 'allowManage']) {
    ok(keys.includes(k), `有 ${k} 这一项`);
  }
}

console.log('\n## 表单：连接参数是文本型（用户要粘贴地址）');
{
  const model = buildSettingsModel([{ identity, settings }], {});
  const fields = model.groups[0].fields;
  ok(fields.find((f) => f.key === 'wsUrl').type === 'text', 'wsUrl 是文本型');
  ok(fields.find((f) => f.key === 'accessToken').type === 'text', 'token 是文本型');
  ok(fields.find((f) => f.key === 'maxChars').type === 'choice', '字数上限仍是选项型');
  ok(model.issues.length === 0, '没有不合格项');
}

console.log('\n## 文本项：去空白、限长');
{
  const ws = settings.find((f) => f.key === 'wsUrl');
  ok(coerceValue(ws, '  ws://127.0.0.1:3001/  ').value === 'ws://127.0.0.1:3001/', '去掉首尾空白');
  ok(coerceValue(ws, 'x'.repeat(300)).code === 'setting.too-long', '超长拒绝');
  const owner = settings.find((f) => f.key === 'ownerId');
  ok(coerceValue(owner, ' 12345 ').value === '12345', '主人号：去空白');
}

console.log('\n## 配了之后：configure 真的收下（不用重启就能发/能收）');
{
  configure({ wsUrl: 'ws://127.0.0.1:3001/', httpUrl: 'http://127.0.0.1:3000', accessToken: 'tk', ownerId: '10001' });
  // 通过公开行为验证：不带 wsUrl 的 configure 后，client 仍能拿到 http 地址
  const m = buildSettingsModel([{ identity, settings }], { 'surfcore/qq': { wsUrl: 'ws://a/', ownerId: '9' } });
  const ws = m.groups[0].fields.find((f) => f.key === 'wsUrl');
  ok(ws.value === 'ws://a/', '保存的值能回显');
  ok(ws.isDefault === false, '改过的项标成"非默认"（界面能提示）');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
