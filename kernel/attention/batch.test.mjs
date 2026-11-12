/**
 * 合批测试（纯状态机：外部推进时间）
 * 跑法：node kernel/attention/batch.test.mjs
 */
import { createBatcher, DEFAULT_BATCH } from './batch.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

const ev = (channel, text, at) => ({ from: { channel, kind: 'group', actor: 'u1', at }, text });

let t = 1000;
const b = createBatcher({ windowMs: 5000, maxItems: 3, maxChars: 200, now: () => t });

console.log('## 收集与到期');
{
  ok(b.push(ev('c1', '第一句', t)).ready === false, '第 1 条：先收着');
  t += 1000;
  ok(b.push(ev('c1', '第二句', t)).ready === false, '第 2 条：还在收');
  ok(b.pending() === 2, '积了 2 条');

  t += 3000;   // 距第一批 4000ms < 5000ms
  ok(b.due(t).length === 0, '窗口没到（4000ms）：还没到期');
  t += 1000;   // 距第一批 5000ms：到点
  const due = b.due(t);
  ok(due.length === 1, '窗口到了：取出一批');
  ok(due[0].batch.event.text === '第一句\n第二句', '两条被并成一条（换行接起来）');
  ok(due[0].batch.event.batch.count === 2, '批次里记着几条');
  ok(b.pending() === 0, '取走之后清空');
}

console.log('\n## 条数上限：到量立刻出批');
{
  const r1 = b.push(ev('c2', 'a', t));
  const r2 = b.push(ev('c2', 'b', t));
  const r3 = b.push(ev('c2', 'c', t));
  ok(r1.ready === false && r2.ready === false, '前两条不收');
  ok(r3.ready === true && r3.reason === 'max-items', '第 3 条到上限：立刻出批');
  ok(r3.batch.event.text === 'a\nb\nc', '三条并一条');
}

console.log('\n## 分频道');
{
  b.push(ev('x', '甲', t));
  b.push(ev('y', '乙', t));
  const due = b.due(t + 6000);
  ok(due.length === 2, '两个频道各出一批');
  const texts = due.map((d) => d.batch.event.text).sort();
  ok(texts.join('|') === '乙|甲' || texts.join('|') === '甲|乙', '各批内容不串');
}

console.log('\n## 字数上限与默认值');
{
  const small = createBatcher({ windowMs: 100, maxItems: 99, maxChars: 6, now: () => 0 });
  small.push(ev('c', '1234567890', 0));
  const due = small.due(200);
  ok(due[0].batch.event.text.length <= 6, '合并后受字数上限约束');
  ok(DEFAULT_BATCH.windowMs === 8000, '默认窗口 8 秒');
}

console.log('\n## 边界');
{
  ok(b.due(t + 10 ** 9).length === 0, '没有积压：due 返回空');
  const r = b.push({ text: '没有 from' });
  ok(r && r.ready === false, '没有频道信息：不炸（落到空桶）');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
