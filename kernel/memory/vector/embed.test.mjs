/**
 * 嵌入端口测试（注入假 transport/fetch，不联网）
 * 跑法：node kernel/memory/vector/embed.test.mjs
 */
import {
  cosineSimilarity, normalizeVector, createHttpEmbeddingTransport, createEmbedder, createHashingEmbedder,
} from './embed.js';
import { createVectorStore } from './store.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

console.log('## 余弦 / 归一化');
{
  ok(Math.abs(cosineSimilarity([1, 0], [1, 0]) - 1) < 1e-9, '同向：1');
  ok(cosineSimilarity([1, 0], [0, 1]) === 0, '正交：0');
  ok(cosineSimilarity([1, 0], [-1, 0]) === -1, '反向：-1');
  ok(cosineSimilarity([0, 0], [1, 1]) === 0, '零向量：0（不除零）');
  ok(cosineSimilarity([1, 2], [1, 2, 3]) === 0, '维度不一致：0');
  ok(cosineSimilarity([1, NaN], [1, 2]) === 0, '非数字：0');
  ok(cosineSimilarity(null, [1]) === 0, 'null：0');

  const n = normalizeVector([3, 4]);
  ok(Math.abs(Math.hypot(...n) - 1) < 1e-9, '单位化：模长 1');
  ok(normalizeVector([0, 0]).length === 2, '零向量原样返回（不制造 NaN）');
  ok(normalizeVector([1, 'x']) === null, '坏值：返回 null');
}

console.log('\n## HTTP 传输：只认形状，不认厂商');
{
  const calls = [];
  const t = createHttpEmbeddingTransport({
    endpoint: 'http://embed/v1/embeddings',
    apiKey: 'k',
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 200, json: async () => ({ data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }] }) };
    },
  });
  const out = await t.send({ model: 'm', input: ['a', 'b'] });
  ok(out.ok && out.vectors.length === 2, '成功：两条向量');
  ok(calls[0].opts.method === 'POST', 'POST');
  ok(JSON.parse(calls[0].opts.body).input.length === 2, 'input 原样发');
  ok(calls[0].opts.headers.authorization === 'Bearer k', 'key 走 Bearer（key 由调用方给）');

  const http = createHttpEmbeddingTransport({
    endpoint: 'http://embed', fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'bad key' } }) }),
  });
  const e401 = await http.send({ model: 'm', input: ['a'] });
  ok(!e401.ok && e401.error.code === 'embed.unauthorized' && e401.error.retryable === false, '401：不重试');
  ok(String(e401.error.hint).includes('密钥'), '401：给下一步');

  const shape = createHttpEmbeddingTransport({
    endpoint: 'http://embed', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ data: [{ nope: 1 }] }) }),
  });
  const es = await shape.send({ model: 'm', input: ['a'] });
  ok(!es.ok && es.error.code === 'embed.shape', '形状不对：结构化错误');

  const net = createHttpEmbeddingTransport({ endpoint: 'http://embed', fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  const en = await net.send({ model: 'm', input: ['a'] });
  ok(!en.ok && en.error.code === 'embed.network' && en.error.retryable === true, '网络错误：可重试');

  const to = createHttpEmbeddingTransport({ endpoint: 'http://embed', fetchImpl: async () => { throw new Error('aborted due to timeout'); } });
  ok((await to.send({ model: 'm', input: ['a'] })).error.code === 'embed.timeout', '超时：单独归类');

  let threw = 0;
  try { createHttpEmbeddingTransport({}); } catch { threw += 1; }
  ok(threw === 1, '缺 endpoint：直接报错');
  ok(!/openai|deepseek/i.test(createHttpEmbeddingTransport.toString()), '传输实现里不写死厂商名');
}

console.log('\n## 嵌入器：校验/归一/错误');
{
  const fake = { send: async ({ input }) => ({ ok: true, vectors: input.map((_, i) => [i + 1, 1]) }) };
  const emb = createEmbedder({ transport: fake, model: 'm' });
  const out = await emb.embed(['a', 'b']);
  ok(out.ok && out.vectors.length === 2, '两条输入 → 两条向量');
  ok(Math.abs(Math.hypot(...out.vectors[0]) - 1) < 1e-9, '默认归一化');
  ok(out.dim === 2 && emb.dimensions() === 2, '记住维度');

  const empty = await emb.embed([]);
  ok(!empty.ok && empty.error.code === 'embed.empty-input', '空输入：拒绝（不调服务）');

  const count = createEmbedder({ transport: { send: async () => ({ ok: true, vectors: [[1, 2]] }) }, model: 'm' });
  const c = await count.embed(['a', 'b']);
  ok(!c.ok && c.error.code === 'embed.count-mismatch' && c.error.retryable === true, '回的条数不够：可重试的错误');

  const bad = createEmbedder({ transport: { send: async () => ({ ok: true, vectors: [[1, NaN]] }) }, model: 'm' });
  ok((await bad.embed(['a'])).error.code === 'embed.bad-vector', '坏向量：拒绝');

  let dimensions = 2;
  const changing = createEmbedder({
    transport: { send: async () => ({ ok: true, vectors: [Array.from({ length: dimensions }, () => 1)] }) },
    model: 'm',
  });
  const first = await changing.embed(['a']);
  ok(first.ok && first.dim === 2, '第一次：维度 2');
  dimensions = 3;
  const mismatch = await changing.embed(['b']);
  ok(!mismatch.ok && mismatch.error.code === 'embed.dim-mismatch', '换模型后维度变了：拒绝（旧向量要重建）');
  ok(String(mismatch.error.message).includes('2 → 3'), '错误里说清维度怎么变的');

  let threw = 0;
  try { createEmbedder({ model: 'm' }); } catch { threw += 1; }
  try { createEmbedder({ transport: fake }); } catch { threw += 1; }
  ok(threw === 2, '缺 transport/model：直接报错');
}

console.log('\n## 本地散列嵌入（隔离测试用，不是真模型）');
{
  const h = createHashingEmbedder({ dimensions: 64 });
  const a = await h.embed(['今天天气真好']);
  const b = await h.embed(['今天天气真好']);
  const c = await h.embed(['完全不同的句子']);
  ok(a.ok && a.dim === 64, '输出 64 维');
  ok(cosineSimilarity(a.vectors[0], b.vectors[0]) > 0.99, '同一句：几乎一样（确定性）');
  ok(cosineSimilarity(a.vectors[0], c.vectors[0]) < 0.6, '不同句：明显更低');
  ok((await h.embed([])).error.code === 'embed.empty-input', '空输入：拒绝');
}

console.log('\n## 向量线：给了数值向量就用余弦读');
{
  const store = createVectorStore({ now: () => 1000 });
  store.put({ text: '猫', from: { channel: 'a', at: 1000 }, source: 'user' }, { vector: [1, 0] });
  store.put({ text: '狗', from: { channel: 'a', at: 1000 }, source: 'user' }, { vector: [0, 1] });
  const out = store.read({}, { text: '猫', vector: [0.9, 0.1], maxChars: 100 });
  ok(out.text.includes('猫'), '向量接近的那条被读出');
  ok(out.refs[0].score > 0.9, '相似度进 refs');

  const legacy = createVectorStore({ now: () => 1000 });
  legacy.put({ text: '今天天气真好', from: { channel: 'a', at: 1000 }, source: 'user' });
  const lo = legacy.read({}, { text: '今天天气', maxChars: 100 });
  ok(lo.text.includes('今天天气真好'), '没给向量：仍走关键词近似（老路径不破）');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
