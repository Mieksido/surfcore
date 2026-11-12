/**
 * 记忆内核测试：可见性政策 + 入库/读取接口 + 「内核不认识渠道」适应度函数
 * 跑法：node kernel/memory/memory.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRecord, allowed } from './identity.js';
import { createMemoryKernel } from './index.js';
import { createNarrativeReader } from './narrative/reader.js';

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✅', name); }
  else { fail++; console.error('  ❌', name); }
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ══════════════════════════════════════════════════════════════════
 * 一、可见性政策（五条规则，全部来自旧代码，但不含渠道名）
 * ══════════════════════════════════════════════════════════════════ */
console.log('## 可见性政策');

const groupA = 'g:a';
const groupB = 'g:b';
const dmOwner = 'dm:owner';

const inGroupA = makeRecord({ text: '群A里说的话', from: { adapter: 'x', channel: groupA, kind: 'group' }, source: 'user' });
const inGroupB = makeRecord({ text: '群B里说的话', from: { adapter: 'x', channel: groupB, kind: 'group' }, source: 'user' });
const inDm = makeRecord({ text: '私聊里说的话', from: { adapter: 'x', channel: dmOwner, kind: 'private' }, source: 'user' });
const secret = makeRecord({ text: '敏感内容', from: { adapter: 'x', channel: groupA, kind: 'group' }, source: 'user', to: { sensitive: true } });

// ① 私聊记忆永不进群
ok(!allowed(inDm, { channelId: groupA, kind: 'group' }), '私聊记忆不进群');
// ② 自己群里的记忆，自己群里可见（默认同圈含自己）
ok(allowed(inGroupA, { channelId: groupA, kind: 'group' }), '同群可见');
// ③ 跨群默认不可见
ok(!allowed(inGroupB, { channelId: groupA, kind: 'group' }), '跨群默认不可见');
// ③' 放到同圈就可见
const circled = makeRecord({
  text: '同圈的话', from: { adapter: 'x', channel: groupB, kind: 'group' }, source: 'user',
  to: { circle: [groupB, groupA] },
});
ok(allowed(circled, { channelId: groupA, kind: 'group' }), '同圈（互通）可见');
// ④ 敏感：不进提示词，只给管理员视图
ok(!allowed(secret, { channelId: groupA, kind: 'group' }), '敏感内容不进普通视图');
ok(allowed(secret, { channelId: groupA, kind: 'group', isAdmin: true }), '敏感内容只给管理员');
// ⑤ 私聊只看自己的私聊
ok(allowed(inDm, { channelId: dmOwner, kind: 'private', isOwner: true }), '自己的私聊可见');
ok(!allowed(inDm, { channelId: 'dm:other', kind: 'private', isOwner: true }), '别人的私聊不可见');

// ⑥ 群记忆进私聊：只给主人 + 显式开启 + 白名单
const ownerReader = { channelId: dmOwner, kind: 'private', isOwner: true };
ok(!allowed(inGroupA, ownerReader), '未开启时：群记忆不进私聊');
ok(!allowed(inGroupA, { ...ownerReader, ownerReadsCircles: true }), '开启但白名单空且未 allowAll：不放行');
ok(allowed(inGroupA, { ...ownerReader, ownerReadsCircles: true, allowAllWhenEmpty: true }), '显式 allowAll 时才放行');
ok(!allowed(inGroupA, { ...ownerReader, ownerReadsCircles: true, allowOnly: [groupB] }), '白名单不含该群：不放行');
ok(allowed(inGroupA, { ...ownerReader, ownerReadsCircles: true, allowOnly: [groupA] }), '白名单含该群：放行');
ok(!allowed(inGroupA, { ...ownerReader, ownerReadsCircles: true, allowAllWhenEmpty: true, deny: [groupA] }), '黑名单优先：拦住');
// ⑦ 非主人私聊看不到群记忆
ok(!allowed(inGroupA, { channelId: 'dm:x', kind: 'private', isOwner: false, ownerReadsCircles: true, allowAllWhenEmpty: true }), '非主人私聊看不到群记忆');

/* ══════════════════════════════════════════════════════════════════
 * 二、入库 + 统一读取
 * ══════════════════════════════════════════════════════════════════ */
console.log('\n## 入库与读取');

const kernel = createMemoryKernel({
  mode: 'narrative',
});

kernel.ingest({ text: '今天她说想吃火锅', from: { adapter: 'x', channel: groupA, kind: 'group', at: Date.now() - 90000 }, source: 'user', importance: 40 });
kernel.ingest({ text: '主人说周五见面', from: { adapter: 'x', channel: dmOwner, kind: 'private', at: Date.now() - 80000 }, source: 'user', importance: 80, to: { owner: true } });
kernel.ingest({ text: '群里有人在聊游戏', from: { adapter: 'x', channel: groupA, kind: 'group', at: Date.now() - 70000 }, source: 'user', importance: 10 });
ok(kernel.snapshot().length === 3, '三条都入库了');

const r1 = kernel.read({ channelId: groupA, kind: 'group' });
ok(r1.text.includes('火锅'), '读取：能看到本群记忆');
ok(!r1.text.includes('周五见面'), '读取：看不到主人私聊');
ok(Array.isArray(r1.refs) && r1.refs.length >= 1, '读取：带引用清单');
ok(r1.mode === 'narrative', '读取：报告当前模式');

// 排序：重要度高的先出现
ok(r1.text.indexOf('火锅') < r1.text.indexOf('游戏'), '读取：重要的排在前面');

// 预算：给很小的字数就把内容截掉
const r2 = kernel.read({ channelId: groupA, kind: 'group' }, { maxChars: 60 });
ok(r2.text.length <= 80, '读取：遵守字数预算');
ok(r2.refs.length <= r1.refs.length, '读取：预算小时引用更少');

// 换模式：叙事与向量是**两条独立的线**，切换只换读哪条
ok(kernel.setMode('vector') === 'vector', '切换模式成功');
const r3 = kernel.read({ channelId: groupA, kind: 'group' });
ok(r3.mode === 'vector' && Array.isArray(r3.refs), '切到向量线：能读，形状不变');
ok(r3.refs.length > 0, '向量线有自己的数据（不是空壳）');
const st = kernel.stats();
ok(st.narrative > 0 && st.vector > 0 && st.full > 0, '两条线各自存了一份（双存储，不是投影）');
kernel.setMode('narrative');

/* 注：「内核里不许出现渠道名」这条检查已经搬到 tools/fitness.mjs 与
 * tools/core-check.mjs（单一真相）。测试文件里不再重复实现——重复的那份
 * 既会漂移，也会让测试文件自己带上渠道名字面量。 */

/* ── 真实嵌入接线：入库带向量，读取用同一个向量 ─────────────────── */
console.log('\n## 向量线：入库带向量，读取用余弦');
{
  const vk = createMemoryKernel({ mode: 'vector' });
  const at = Date.now();
  vk.ingest({ text: '猫猫图', from: { adapter: 'x', channel: 'c', kind: 'group', at }, source: 'user' }, { vector: [1, 0] });
  vk.ingest({ text: '狗狗图', from: { adapter: 'x', channel: 'c', kind: 'group', at }, source: 'user' }, { vector: [0, 1] });
  vk.ingest({ text: '只给主人看的私聊', from: { adapter: 'x', channel: 'dm:o', kind: 'private', at }, to: { owner: true }, source: 'user' }, { vector: [1, 0] });
  const snap = vk.vector();
  ok(snap.length === 3 && Array.isArray(snap[0].vector.values), '入库：向量线存的是数值向量（不是关键词）');
  const groupViewer = { channelId: 'c', kind: 'group' };
  const r = vk.read(groupViewer, { text: '猫', vector: [0.95, 0.05], maxChars: 200 });
  ok(r.text.includes('猫猫图'), '读取：余弦更近的那条排前面');
  ok(!r.text.includes('狗狗图') || r.text.indexOf('猫猫图') < r.text.indexOf('狗狗图'), '读取：向量近的在前');
  ok(!r.text.includes('只给主人看的私聊'), '向量线也按 viewer 过滤：私聊不进群');
  const fallback = vk.read(groupViewer, { text: '狗狗图', maxChars: 200 });
  ok(fallback.text.includes('狗狗图'), '不给向量：仍能按关键词读（老路径不破）');
  const empty = vk.read(groupViewer, { text: 'zzzz-not-found', maxChars: 200 });
  ok(!empty.text.includes('猫猫图') && !empty.text.includes('狗狗图'), '无相似：不拿“最近”冒充语义命中');
  const top = vk.read(groupViewer, { text: '猫', vector: [1, 0], topK: 1, maxChars: 200 });
  ok(top.refs.length === 1, 'topK：只取指定条数');
  const floor = vk.read(groupViewer, { text: '猫', vector: [1, 0], minScore: 2, maxChars: 200 });
  ok(floor.text === '', 'minScore：低于阈值不注入');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
