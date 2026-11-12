/**
 * 记忆场合标签：public / private
 * 跑法：node kernel/memory/scene.test.mjs
 */
import { makeRecord } from './identity.js';
import { createMemoryKernel } from './index.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };
const at = 1_700_000_000_000;
const from = (kind, actor = 'u') => ({ adapter: 'x', channel: `${kind}:${actor}`, kind, actor, at });
const to = (owner = false) => ({ owner });

console.log('## 收敛规则');
{
  ok(makeRecord({ text: 'a', from: from('private', 'owner'), to: to(true) }).from.scene === 'private', '主人私聊 → private');
  ok(makeRecord({ text: 'b', from: from('private', 'stranger'), to: to(false) }).from.scene === 'public', '非主人私聊 → public');
  ok(makeRecord({ text: 'c', from: from('group', 'owner'), to: to(true) }).from.scene === 'public', '群聊（哪怕主人）→ public');
  ok(makeRecord({ text: 'd', from: { ...from('private', 'stranger'), scene: 'private' }, to: to(false) }).from.scene === 'public', '适配器乱标 private → 降回 public');
  ok(makeRecord({ text: 'e', from: { ...from('private', 'owner'), scene: 'public' }, to: to(true) }).from.scene === 'private', '主人私聊标错 public → 收敛为 private');
}

console.log('\n## 读取回来的 refs 带场合');
{
  const k = createMemoryKernel({ mode: 'narrative', now: () => at });
  k.ingest({ text: '主人私聊说的话', source: 'user', from: from('private', 'owner'), to: to(true) });
  k.ingest({ text: '群里说的话', source: 'user', from: from('group', 'u'), to: to(false) });
  const r = k.read({ channelId: 'private:owner', kind: 'private', isOwner: true }, { maxChars: 2000 });
  ok(Array.isArray(r.refs) && r.refs.length >= 1, '读到记录');
  ok(r.refs.some((x) => x.scene === 'private'), 'refs 里有 private');
  ok(r.refs.some((x) => x.scene === 'public') || r.refs.length === 1, 'refs 场景可区分');
  const snap = k.snapshot();
  ok(snap.find((x) => x.text.includes('私聊')).from.scene === 'private', '快照里也带标签');
}

console.log('\n## 向量读取 refs 也带场合');
{
  const k = createMemoryKernel({ mode: 'vector', now: () => at, vector: { modelSpace: 'm1' } });
  k.ingest({ text: '猫猫', source: 'user', from: from('private', 'owner'), to: to(true) }, { vector: [1, 0] });
  k.ingest({ text: '狗', source: 'user', from: from('group', 'u'), to: to(false) }, { vector: [0, 1] });
  const r = k.read({ channelId: 'private:owner', kind: 'private', isOwner: true }, { text: '猫', vector: [1, 0], maxChars: 1000 });
  ok(r.refs.every((x) => x.scene === 'private' || x.scene === 'public'), '向量 refs 都有 scene');
  ok(r.refs.some((x) => x.scene === 'private'), '向量 refs 里 private');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
