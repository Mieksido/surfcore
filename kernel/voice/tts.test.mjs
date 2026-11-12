/**
 * 语音合成请求/判读测试 + 设置文本项测试（合一个文件：都是"内容层"新增）
 * 跑法：node kernel/voice/tts.test.mjs
 */
import { buildSynthRequest, interpretSynthResponse, DEFAULT_SYNTH } from './tts.js';
import { validateField, coerceValue } from '../settings/index.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

console.log('## 合成请求：与厂商无关');
{
  const r = buildSynthRequest({ text: '晚安呀', voiceId: 'v1' });
  ok(r.ok === true, '正常文本：能造请求');
  ok(r.request.text === '晚安呀' && r.request.voiceId === 'v1', '带上文本与音色');
  ok(!/openai|azure|vendor|service/i.test(JSON.stringify(r.request)), '请求里不写死任何服务名');

  ok(buildSynthRequest({ text: '   ' }).error.code === 'voice.empty', '空文本：拒绝（改成打字）');
  const long = buildSynthRequest({ text: '啊'.repeat(200) });
  ok(long.error.code === 'voice.too-long', '太长：拒绝');
  ok(String(long.error.hint).includes('打字'), '拒绝时给退路');
  ok(DEFAULT_SYNTH.maxChars === 120, '默认上限 120 字');
}

console.log('\n## 判读返回：复用既有失败分类');
{
  ok(interpretSynthResponse({ status: 200, body: { path: '/tmp/a.wav' } }).ok === true, '200 + 路径：成功');
  const noPath = interpretSynthResponse({ status: 200, body: {} });
  ok(noPath.ok === false && String(noPath.error.hint).includes('路径'), '没有路径：如实失败');
  const e502 = interpretSynthResponse({ status: 502, body: { message: 'synthesis failed' } });
  ok(e502.ok === false && e502.error.kind === 'engine-failed', '502：引擎失败');
  ok(e502.error.retryable === true, '502：可重试');
  const e401 = interpretSynthResponse({ status: 401, body: {} });
  ok(e401.error.kind === 'credential', '401：凭据问题（与既有分类一致）');
  const netErr = interpretSynthResponse({ error: new Error('Headers Timeout Error') });
  ok(netErr.error.kind === 'timeout', '网络超时：归入 timeout');
}

console.log('\n## 设置模型：文本项');
{
  const textField = { key: 'k', label: 'K', type: 'text', defaultValue: '', maxChars: 20, cost: '代价', group: 'basic' };
  ok(validateField(textField).ok, '文本项：合格');
  ok(validateField({ ...textField, maxChars: undefined }).errors.some((e) => e.includes('maxChars')), '文本项没 maxChars：拒绝');
  ok(validateField({ ...textField, defaultValue: 1 }).errors.some((e) => e.includes('字符串')), '文本项默认值不是字符串：拒绝');
  ok(!validateField({ ...textField, type: 'select' }).ok, '不认识的类型：拒绝');

  ok(coerceValue(textField, '  a   b ').value === 'a b', '文本值：去多余空白');
  ok(coerceValue(textField, 'x'.repeat(30)).code === 'setting.too-long', '超长：拒绝');
  ok(coerceValue(textField, 'x'.repeat(30)).error.includes('20'), '拒绝时说清上限');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
