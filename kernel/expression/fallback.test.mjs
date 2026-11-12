/**
 * 模型失败降级测试
 * 跑法：node kernel/expression/fallback.test.mjs
 */
import { fallbackFor, DEFAULT_FALLBACK } from './fallback.js';
import { createKernel } from '../index.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

console.log('## 分类：临时故障 vs 永久故障');
{
  const t = fallbackFor({ code: 'model.timeout' });
  ok(t.kind === 'say' && t.text.length > 0, '超时：给一句人话');
  ok(String(t.reason).includes('临时'), '说明是临时故障');

  const auth = fallbackFor({ code: 'model.unauthorized' });
  ok(auth.kind === 'stay_silent', '鉴权失败：不说话（说也没用）');
  ok(String(auth.reason).includes('永久'), '说明是永久故障');

  ok(fallbackFor({ code: 'model.network' }).kind === 'say', '网络错误：可降级一句');
  ok(fallbackFor({ code: '瞎写' }).kind === 'stay_silent', '未知错误：保守沉默');
  ok(!/key|token|401|http/i.test(t.text), '话术里不泄漏技术细节');
}

console.log('\n## 可配置');
{
  ok(DEFAULT_FALLBACK.onTransient === 'say', '默认：临时故障说一句');
  const silent = fallbackFor({ code: 'model.timeout' }, { onTransient: 'silent' });
  ok(silent.kind === 'stay_silent', '配置成 silent：就不说');
  const custom = fallbackFor({ code: 'model.timeout' }, { text: '等我会' });
  ok(custom.text === '等我会', '话术可换');
}

console.log('\n## 接进内核：模型失败时的真实反应');
{
  const failingModel = { async complete() { return { error: { code: 'model.timeout', retryable: true } }; } };
  const k = createKernel({ now: () => 1000, persona: { name: 'T', core: 'c' }, admin: 'o', model: failingModel });
  const r = await k.respond(
    { from: { channel: 'c1', kind: 'private', actor: 'owner', at: 1000 }, text: '在吗', to: { owner: true } },
    { channelId: 'c1', kind: 'private', isOwner: true },
  );
  ok(r.wake === true, '仍然算"醒了"（不是被忽略）');
  ok(r.intents.some((i) => i.kind === 'say' && i.fallback === true), '临时失败：产出降级话术（带 fallback 标记）');
  ok(k.audit.list().some((a) => a.kind === 'model.fallback' && a.code === 'model.timeout'), '审计记下降级原因');

  const badKey = { async complete() { return { error: { code: 'model.unauthorized', retryable: false } }; } };
  const k2 = createKernel({ now: () => 1000, persona: { name: 'T', core: 'c' }, admin: 'o', model: badKey });
  const r2 = await k2.respond(
    { from: { channel: 'c1', kind: 'private', actor: 'owner', at: 1000 }, text: '在吗', to: { owner: true } },
    { channelId: 'c1', kind: 'private', isOwner: true },
  );
  ok(r2.intents.length === 1 && r2.intents[0].kind === 'stay_silent', '永久失败：只沉默，不瞎编');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
