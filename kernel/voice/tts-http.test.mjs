/**
 * 语音 HTTP 传输 + 引擎串联测试（注入假 fetch，不联网）
 * 跑法：node kernel/voice/tts-http.test.mjs
 */
import { createHttpVoiceTransport, DEFAULT_TTS_HTTP } from './tts-http.js';
import { createVoiceEngine } from './engine.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

const bytesFetch = (bytes) => async () => ({
  ok: true, status: 200,
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
});

console.log('## 传输：把请求发出去，拿回字节');
{
  const seen = [];
  const t = createHttpVoiceTransport({
    endpoint: 'http://127.0.0.1:5000/',
    fetchImpl: async (url, opts) => { seen.push({ url, opts }); return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }; },
  });
  ok(t.url === 'http://127.0.0.1:5000/tts', '地址拼对（去尾斜杠）');
  const r = await t.synthesize({ text: '晚安', voiceId: 'v1' });
  ok(r.ok === true && r.bytes.length === 3, '拿到音频字节');
  ok(seen[0].opts.method === 'POST', 'POST 出去');
  ok(JSON.parse(seen[0].opts.body).text === '晚安', '请求体是描述，不是厂商参数');
  ok(!seen[0].opts.headers.authorization, '没给 key：不带凭据');
}

console.log('\n## 传输：失败如实回');
{
  const e502 = createHttpVoiceTransport({ endpoint: 'http://x', fetchImpl: async () => ({ ok: false, status: 502 }) });
  ok((await e502.synthesize({ text: 'x' })).status === 502, '502：带回状态码');

  const empty = createHttpVoiceTransport({ endpoint: 'http://x', fetchImpl: async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) }) });
  const r = await empty.synthesize({ text: 'x' });
  ok(r.ok === false && String(r.message).includes('空音频'), '空音频：如实失败');

  const boom = createHttpVoiceTransport({ endpoint: 'http://x', fetchImpl: async () => { throw new Error('Headers Timeout Error'); } });
  ok((await boom.synthesize({ text: 'x' })).error.message.includes('Timeout'), '抛错：带回原因');

  let threw = false;
  try { createHttpVoiceTransport({}); } catch { threw = true; }
  ok(threw, '没有 endpoint：直接报错');
  ok(DEFAULT_TTS_HTTP.path === '/tts', '默认路径可读');
}

console.log('\n## 串联：传输 + 引擎 = 一条完整的语音链路');
{
  const transport = createHttpVoiceTransport({ endpoint: 'http://x', fetchImpl: bytesFetch(Buffer.from('AUDIODATA')) });
  const engine = createVoiceEngine({ transport });
  const r = await engine.speak({ text: '晚安呀', voiceId: 'v1' });
  ok(r.ok === true && r.bytes.toString() === 'AUDIODATA', '引擎拿到音频');
  ok(r.format === 'wav', '带上格式');
}

console.log('\n## 串联：服务坏了，引擎如实降级（内核会退回文字）');
{
  const transport = createHttpVoiceTransport({ endpoint: 'http://x', fetchImpl: async () => ({ ok: false, status: 502 }) });
  const engine = createVoiceEngine({ transport });
  const r = await engine.speak({ text: '晚安呀' });
  ok(r.ok === false, '失败');
  ok(r.error.kind === 'engine-failed' && r.error.retryable === true, '分类：引擎失败、可重试');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
