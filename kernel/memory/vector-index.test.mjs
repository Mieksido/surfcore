/**
 * 多模型向量索引 / 待编码队列 / 重建（不联网）
 * 跑法：node kernel/memory/vector-index.test.mjs
 */
import { createMemoryKernel } from './index.js';
import { createKernel } from '../index.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };
const at = 1_700_000_000_000;
const from = { adapter: 'x', channel: 'c', kind: 'group', at };
const ev = (text) => ({ text, from, source: 'user' });
const fakeEmbed = async (texts) => ({
  ok: true,
  vectors: texts.map((t) => (t.includes('猫') ? [1, 0] : [0, 1])),
});

console.log('## 双写：叙事 + 向量；向量先 pending');
{
  const k = createMemoryKernel({ mode: 'vector', now: () => at, vector: { modelSpace: 'm1', batchSize: 4 } });
  k.ingest(ev('我喜欢猫'), {});
  k.ingest(ev('今天下雨'), {});
  ok(k.snapshot().length === 2, '叙事：两条');
  ok(k.vector().length === 2, '向量：两条（独立存储）');
  ok(k.vectorStatus().pending === 2 && k.vectorStatus().indexed === 0, '向量状态：两条待编码');
  ok(k.vector()[0].vectors.m1.status === 'pending', '每条有 m1 索引槽（pending）');
}

console.log('\n## 编码一批：pending → ready');
{
  const k = createMemoryKernel({ mode: 'vector', now: () => at, vector: { modelSpace: 'm1', batchSize: 4 } });
  k.ingest(ev('我喜欢猫'), {});
  k.ingest(ev('今天下雨'), {});
  const r = await k.encodePending({ embed: fakeEmbed, limit: 4 });
  ok(r.ok && r.encoded === 2, '编码 2 条');
  const st = k.vectorStatus();
  ok(st.indexed === 2 && st.pending === 0, '状态：2 已索引 / 0 待编码');
  const out = k.read({ channelId: 'c', kind: 'group' }, { text: '猫', vector: [1, 0], maxChars: 200 });
  ok(out.mode === 'vector' && out.text.includes('猫'), '读取：向量模式命中猫');
}

console.log('\n## 每个模型一套索引');
{
  const k = createMemoryKernel({ mode: 'vector', now: () => at, vector: { modelSpace: 'm1' } });
  k.ingest(ev('我喜欢猫'), {});
  k.ingest(ev('今天下雨'), {});
  await k.encodePending({ embed: fakeEmbed, limit: 4 });
  ok(k.vectorStatus('m1').indexed === 2, 'm1：2 条已索引');

  k.configureVector({ modelSpace: 'm2' });
  ok(k.vectorStatus('m2').pending === 2, 'm2：同一批记录待编码（独立索引）');
  ok(k.vectorStatus('m1').indexed === 2, 'm1：旧索引仍在，不被清掉');
  k.ingest(ev('新的一条猫'), { vector: [1, 0] });
  ok(k.vectorStatus('m2').indexed === 1 && k.vectorStatus('m2').pending === 2, 'm2：新记录直接 ready，旧的仍 pending');
  ok(k.vectorStatus('m1').indexed === 2, 'm1：没被新模型污染');
}

console.log('\n## 重建只动当前模型');
{
  const k = createMemoryKernel({ mode: 'vector', now: () => at, vector: { modelSpace: 'm1' } });
  k.ingest(ev('我喜欢猫'), { vector: [1, 0] });
  k.configureVector({ modelSpace: 'm2' });
  k.ingest(ev('今天下雨'), { vector: [0, 1] });
  const r = k.rebuildVectors({ modelSpace: 'm1' });
  ok(r.rebuilt === 2, 'm1 重建：2 条退回 pending');
  ok(k.vectorStatus('m1').pending === 2, 'm1：待编码');
  ok(k.vectorStatus('m2').indexed === 1, 'm2：索引不受影响');
}

console.log('\n## 关闭向量存储：叙事照写，向量不增');
{
  const k = createMemoryKernel({ mode: 'narrative', now: () => at, vector: { enabled: false, modelSpace: 'm1' } });
  k.ingest(ev('我喜欢猫'), {});
  ok(k.snapshot().length === 1, '叙事：照写');
  ok(k.vector().length === 0, '向量：不写');
  const r = await k.encodePending({ embed: fakeEmbed });
  ok(r.ok && r.encoded === 0, '关闭时没有待编码');
}

console.log('\n## 失败保留 pending，可重试');
{
  const k = createMemoryKernel({ mode: 'vector', now: () => at, vector: { modelSpace: 'm1' } });
  k.ingest(ev('我喜欢猫'), {});
  const bad = await k.encodePending({ embed: async () => ({ ok: false, error: { code: 'embed.network', message: '断网' } }) });
  ok(!bad.ok && bad.failed === 1, '失败 1 条');
  ok(k.vectorStatus().failed === 1 && k.vectorStatus().pending === 0, '标 failed，不是静默丢');
  const good = await k.encodePending({ embed: fakeEmbed });
  ok(good.ok && good.encoded === 1, '重试成功');
  ok(k.vectorStatus().indexed === 1, '最终已索引');
}

console.log('\n## 落盘/读盘：多模型索引一起回来');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-vec-'));
  const opts = {
    now: () => at,
    stateDir: dir,
    persona: { name: 'T', core: 'c' },
    admin: 'o',
    mode: 'vector',
    embedder: { embed: fakeEmbed },
    settingsValues: { 'surfcore/kernel': { 'memory.vector.modelSpace': 'm1' } },
  };
  const a = createKernel(opts);
  a.handle(ev('我喜欢猫'), {});
  const flushed = await a.flushVectors();
  ok(flushed.encoded === 1, '入库后补编码 1 条');
  a.save();

  const b = createKernel(opts);
  b.load();
  ok(b.memory.mode === 'vector', '读盘：记忆方式回来');
  ok(b.memory.vectorStatus('m1').indexed === 1, '读盘：m1 索引回来');
  const out = b.memory.read({ channelId: 'c', kind: 'group' }, { text: '猫', vector: [1, 0], maxChars: 200 });
  ok(out.text.includes('猫'), '读盘后还能按向量读');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
