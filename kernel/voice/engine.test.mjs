/**
 * 语音引擎接入测试（注入假服务，不联网）
 * 跑法：node kernel/voice/engine.test.mjs
 */
import { createVoiceEngine } from './engine.js';
import { createKernel } from '../index.js';
import { createScriptedModel } from '../expression/model-port.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

const NOW = 1000;
const mkKernel = (extra) => createKernel({ now: () => NOW, persona: { name: 'T', core: 'c' }, admin: 'owner', ...extra });
const EVENT = (text = '在吗') => ({ from: { channel: 'c1', kind: 'private', actor: 'owner', at: NOW }, text, source: 'user', to: { owner: true } });
const VIEWER = { channelId: 'c1', kind: 'private', isOwner: true };

console.log('## 引擎端口：拿回音频');
{
  const eng = createVoiceEngine({ transport: { async synthesize(req) { return { ok: true, bytes: Buffer.from(`AUDIO:${req.text}`) }; } } });
  const r = await eng.speak({ text: '晚安', voiceId: 'v1' });
  ok(r.ok && r.bytes.length > 0, '返回音频字节');
  ok(r.format === 'wav', '带上格式');
  ok(!/openai|azure|http/i.test(JSON.stringify(eng.config())), '配置里不写死服务名');

  const byPath = createVoiceEngine({ transport: { async synthesize() { return { ok: true, path: '/tmp/a.wav' }; } } });
  ok((await byPath.speak({ text: 'x' })).path === '/tmp/a.wav', '也支持返回路径');
}

console.log('\n## 失败：如实回，不假发');
{
  const bad = createVoiceEngine({ transport: { async synthesize() { return { ok: false, status: 502 }; } } });
  const r = await bad.speak({ text: '晚安' });
  ok(!r.ok && r.error.kind === 'engine-failed', '502：引擎失败');
  ok(r.error.retryable === true, '502：可重试');

  const thrower = createVoiceEngine({ transport: { async synthesize() { throw new Error('Headers Timeout Error'); } } });
  ok((await thrower.speak({ text: 'x' })).error.kind === 'timeout', '抛超时：归类 timeout');

  const empty = createVoiceEngine({ transport: { async synthesize() { return { ok: true }; } } });
  ok((await empty.speak({ text: 'x' })).error.hint.includes('音频'), '成功但没音频：如实失败');

  const tooLong = createVoiceEngine({ transport: { async synthesize() { return { ok: true, bytes: Buffer.from('x') }; } } });
  ok((await tooLong.speak({ text: '啊'.repeat(500) })).error.code === 'voice.too-long', '太长：合成前就拒绝');

  let threw = false;
  try { createVoiceEngine({}); } catch { threw = true; }
  ok(threw, '没有 transport：直接报错');
}

console.log('\n## 接进内核：语音消息变成媒体意图');
{
  const engine = createVoiceEngine({ transport: { async synthesize(req) { return { ok: true, bytes: Buffer.from(`A:${req.text}`) }; } } });
  const k = mkKernel({ voice: { enabled: true, available: true }, voiceEngine: engine, model: createScriptedModel([{ toolCalls: [{ name: 'say', args: { text: '晚安呀', voice: true } }] }]) });

  const r = await k.respond(EVENT(), VIEWER);
  const m = r.intents.find((i) => i.kind === 'send_media');
  ok(Boolean(m), '合成成功：say 转成 send_media（意图种类没新增）');
  ok(m.media[0].kind === 'audio', '媒体种类是音频');
  ok(m.text === undefined, '原来的文字不重复发（语音已经念了）');
  ok(k.audit.list().every((a) => a.kind !== 'voice.degraded'), '没有降级记录');
}

console.log('\n## 接进内核：合成失败退回文字');
{
  const engine = createVoiceEngine({ transport: { async synthesize() { return { ok: false, status: 502 }; } } });
  const k = mkKernel({ voice: { enabled: true, available: true }, voiceEngine: engine, model: createScriptedModel([{ toolCalls: [{ name: 'say', args: { text: '晚安呀', voice: true } }] }]) });

  const r = await k.respond(EVENT(), VIEWER);
  const say = r.intents.find((i) => i.kind === 'say');
  ok(Boolean(say) && say.voice === undefined, '合成失败：退回纯文字（不带 voice）');
  ok(say.text === '晚安呀', '内容不丢');
  ok(k.audit.list().some((a) => a.kind === 'voice.degraded'), '降级进审计（可见）');
}

console.log('\n## 没有引擎：保持原样（只带 voice 标记）');
{
  const k = mkKernel({ voice: { enabled: true, available: true }, model: createScriptedModel([{ toolCalls: [{ name: 'say', args: { text: '晚安呀', voice: true } }] }]) });
  const r = await k.respond(EVENT(), VIEWER);
  const say = r.intents.find((i) => i.kind === 'say');
  ok(Boolean(say) && say.voice === true, '没引擎：仍是 say + voice 标记（交给包决定）');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
