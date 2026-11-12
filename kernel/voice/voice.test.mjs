/**
 * 能力包：语音 + 共享时钟 测试
 * 跑法：node kernel/voice/voice.test.mjs
 */
import { classifyVoiceError, pickRoute, validateVoiceEntry, gateVoice } from './index.js';
import { localDayKey, minutesOfDay, inQuietHours, quietEndAfter, inWindow } from '../support/time.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

console.log('## 共享时钟（唯一日界）');
{
  const t = Date.parse('2026-11-09T02:30:00');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(localDayKey(t)), '日界格式');
  ok(minutesOfDay('08:30') === 510, '"08:30" → 510');
  ok(minutesOfDay('99:99', -1) === -1, '非法时间回退');
  ok(inQuietHours(new Date(t), '23:30', '08:30') === true, '跨午夜安静时段');
  ok(inQuietHours(new Date('2026-11-09T12:00:00'), '23:30', '08:30') === false, '中午不安静');
  const end = quietEndAfter(new Date(t), '23:30', '08:30');
  ok(end.getHours() === 8 && end.getMinutes() === 30, '安静结束时刻正确');
  ok(end.getTime() > t, '安静结束一定晚于现在');
  ok(inWindow(new Date('2026-11-09T21:00:00'), '20:00', '23:00') === true, '时间窗：在里面');
}

console.log('\n## 语音失败分类（给下一步，不只给码）');
{
  const a = classifyVoiceError({ status: 502 });
  ok(a.kind === 'engine-failed' && a.retryable === true, '502 → 引擎失败，可重试');
  ok(String(a.hint).includes('启动'), '给出下一步（去启动）');

  const b = classifyVoiceError({ status: 404 });
  ok(b.kind === 'library-miss' && b.retryable === false, '404 → 库里没有，不重试');

  const c = classifyVoiceError({ status: 401, message: 'credential invalid' });
  ok(c.kind === 'credential' && c.retryable === false, '401 → 凭据问题');
  ok(String(c.hint).includes('不要贴'), '提醒不要把密钥贴到聊天里');

  const d = classifyVoiceError({ message: 'Headers Timeout Error' });
  ok(d.kind === 'timeout' && d.retryable === true, '超时 → 可重试');

  const e = classifyVoiceError({ status: 500, message: '奇怪的东西' });
  ok(e.kind === 'unknown' && String(e.hint).includes('打字'), '未知：先给可用退路（打字）');
}

console.log('\n## 路由选择（本地/云端）');
{
  const r1 = pickRoute({ preferred: 'local', available: { local: true, cloud: true } });
  ok(r1.route === 'local' && r1.fallback === false, '首选本地且可用：直接用');

  const r2 = pickRoute({ preferred: 'local', available: { local: false, cloud: true } });
  ok(r2.route === 'cloud' && r2.fallback === true, '本地没起：回落到云端');

  const r3 = pickRoute({ preferred: 'local', available: { local: false, cloud: true }, strict: true });
  ok(r3.route === null, 'strict 模式：不许降级（旧代码的 loli12 就是这么要求的）');

  const r4 = pickRoute({ preferred: 'cloud', available: {} });
  ok(r4.route === null && String(r4.error).includes('启动'), '都没起：报错并指路');
}

console.log('\n## 语音库条目与闸门');
{
  ok(validateVoiceEntry({ name: '晚安.wav', durationMs: 3000 }).ok, '正常条目：通过');
  ok(!validateVoiceEntry({ name: '' }).ok, '没名字：拒绝');
  ok(!validateVoiceEntry({ name: '../偷偷跑出去.wav', durationMs: 1000 }).ok, '带路径分隔符：拒绝（防路径穿越）');
  ok(!validateVoiceEntry({ name: 'a.txt', durationMs: 1000 }).ok, '非音频格式：拒绝');
  ok(!validateVoiceEntry({ name: 'a.wav', durationMs: 0 }).ok, '拿不到时长（文件可能坏了）：拒绝');
  ok(!validateVoiceEntry({ name: 'a.wav', durationMs: 600000 }).ok, '超过 5 分钟：拒绝');

  ok(gateVoice({ enabled: true, chars: 10 }).ok, '闸门：正常放行');
  ok(gateVoice({ enabled: false }).code === 'voice.disabled', '闸门：总闸没开');
  ok(gateVoice({ chars: 200, maxChars: 120 }).code === 'voice.too-long', '闸门：太长');
  ok(gateVoice({ recentCount: 10, perHour: 10 }).code === 'voice.rate-limited', '闸门：频率超了');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
