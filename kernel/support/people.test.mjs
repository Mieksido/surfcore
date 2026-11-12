/**
 * 谁是谁（跨平台身份对齐）测试
 * 跑法：node kernel/support/people.test.mjs
 */
import { createPeople } from './people.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

const A = { source: 'one', id: '10001', name: '小明' };
const B = { source: 'two', id: '20002', name: '小明（二号）' };

console.log('## 候选：不自动变成事实');
{
  const p = createPeople({ now: () => 1000 });
  const c = p.propose({ a: A, b: B, reason: '昵称相同', score: 0.8 });
  ok(c && c.id, '提了候选');
  ok(p.stats().links === 0, '**还没链接**（猜测不是事实）');
  ok(p.resolve('one', A.id) === null, '查不到：还没认出');
  ok(p.pending().length === 1, '候选池里有 1 条');
  ok(p.stats().requireApproval === true, '默认需要批准');
}

console.log('\n## 批准后才连上');
{
  const p = createPeople({ now: () => 1000 });
  const c = p.propose({ a: A, b: B });
  const link = p.approve(c.id);
  ok(link && link.id, '批准后产生链接');
  ok(p.stats().links === 1 && p.stats().candidates === 0, '链接 +1、候选 -1');

  const r = p.resolve('one', A.id);
  ok(r && r.others.two.name.includes('二号'), '在 one 这边能认出 two 的身份');
  ok(p.resolve('one', '99999') === null, '没连过的账号：查不到');
}

console.log('\n## 隐私口径：只给昵称，不给对方账号串');
{
  const p = createPeople();
  const c = p.propose({ a: A, b: B });
  p.approve(c.id);
  const shown = p.displayName('one', A.id);
  ok(shown.includes('二号'), '能拿到对方昵称');
  ok(!shown.includes('20002'), '**不暴露对方账号**');
  ok(p.displayName('one', '99999') === '', '不认识的：空');
}

console.log('\n## 拒绝与去重');
{
  const p = createPeople();
  const c = p.propose({ a: A, b: B });
  ok(p.reject(c.id) === true, '拒绝成功');
  ok(p.pending().length === 0 && p.stats().links === 0, '拒绝后什么都不留');
  ok(p.reject('不存在') === false, '拒绝不存在的：false');

  const c1 = p.propose({ a: A, b: B, score: 0.3 });
  const c2 = p.propose({ a: B, b: A, score: 0.9 });
  ok(c1.id === c2.id, '同一对账号（正反序）：只留一条候选');
  ok(c2.score === 0.9, '分数取更高的');
  ok(p.propose({ a: A, b: { ...A } }) === null, '同平台两个号：不对齐');
  ok(p.propose({ a: A, b: null }) === null, '缺一边：不产生候选');
}

console.log('\n## 已连过的账号再提：不重复');
{
  const p = createPeople();
  p.approve(p.propose({ a: A, b: B }).id);
  ok(p.propose({ a: A, b: { source: 'three', id: '30003', name: 'x' } }) === null, '已经连过的账号：不再提候选');
}

console.log('\n## 落盘往返');
{
  const p = createPeople({ now: () => 5 });
  p.approve(p.propose({ a: A, b: B }).id);
  p.propose({ a: { source: 'three', id: '3', name: 'x' }, b: { source: 'four', id: '4', name: 'y' } });
  const snap = p.snapshot();
  const q = createPeople();
  q.restore(snap);
  ok(q.stats().links === 1 && q.stats().candidates === 1, '恢复后链接和候选都在');
  ok(q.resolve('one', A.id) !== null, '恢复后仍认得出');
}

console.log('\n## 边界');
{
  const p = createPeople({ maxCandidates: 2 });
  for (let i = 0; i < 5; i++) p.propose({ a: { source: 's1', id: `${i}`, name: 'a' }, b: { source: 's2', id: `${i}`, name: 'b' } });
  ok(p.pending().length <= 2, '候选受上限约束');
  ok(p.propose({ a: { source: '', id: '' }, b: B }) === null, '空账号：不产生候选');
  ok(p.list().length === 0, '没有链接时 list 为空');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
