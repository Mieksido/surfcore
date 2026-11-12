/**
 * 目的机制：驱动权重 / 话题多样性 / 闭环（纯函数；时间注入）
 * 跑法：node kernel/purpose/purpose.test.mjs
 */
import { createPurpose, TOPIC_REPEAT_MS, PURPOSE_NEEDS, topicKey } from './index.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

let t = Date.parse('2026-11-11T12:00:00');
const p = createPurpose({ now: () => t });

console.log('## 话题键');
{
  ok(topicKey('今天看到一只猫！') === '今天看到一只猫', '去标点/空白');
  ok(topicKey('  A B  ') === 'ab', '英文小写、去空白');
  ok(topicKey('') === '', '空：空串');
  ok(topicKey('今天看到一只猫').length <= 16, '最多 16 字');
}

console.log('\n## 驱动：不同需求不同速度，封顶/保底');
{
  const before = { ...p.state.drives };
  const after = p.tickDrives({ hours: 10 });
  ok(after.curious > after.share, '好奇涨得比分享快');
  ok(after.curious > before.curious && after.share > before.share, '10 小时：都在涨');
  ok(PURPOSE_NEEDS.every((k) => after[k] >= 0.05 && after[k] <= 1), '都在 0.05~1 之间');
  const capped = p.tickDrives({ hours: 1000 });
  ok(capped.curious <= 1, '涨得再多也封顶 1');
  ok(p.tickDrives({ hours: -5 }).share >= 0.05, '负时长不倒退（按 0 算）');
}

console.log('\n## 投递：说出去了，驱动降下来');
{
  const goal = { id: 'g1', text: '今天看到猫', need: 'share', confidence: 0.6, status: 'hypothesis' };
  p.state.goals.push(goal);
  p.state.drives.share = 0.8;
  const fired = p.fire({ goal, text: '今天看到猫，好可爱' });
  ok(fired.intent.kind === 'say' && goal.status === 'sent', '产出 say 意图');
  ok(p.state.drives.share < 0.8, '分享驱动下降（被满足了一部分）');
  ok(p.state.drives.share >= 0.05, '不降到 0 以下');
  ok(p.state.history.at(-1).topic === topicKey('今天看到猫，好可爱'), '历史里记话题键');
}

console.log('\n## 选目的：驱动高的优先，最近说过的先扣掉');
{
  const q = createPurpose({ now: () => t });
  q.state.drives.share = 0.9;
  q.state.drives.ask = 0.1;
  q.state.goals.push(
    { id: 'a', owner: 'self', text: '猫的事', need: 'share', confidence: 0.5, status: 'hypothesis' },
    { id: 'b', owner: 'self', text: '工作的事', need: 'ask', confidence: 0.5, status: 'hypothesis' },
  );
  const picked = q.select([]);
  ok(picked.id === 'a', '同等置信度：驱动高的需求优先');

  q.state.history.push({ at: t, text: '猫的事', topic: topicKey('猫的事'), need: 'share' });
  const picked2 = q.select([]);
  ok(picked2.id === 'b', '刚说过的话题：这次跳过');

  t += TOPIC_REPEAT_MS + 1000;
  const picked3 = q.select([]);
  ok(picked3.id === 'a', '过了 6 小时：同一个话题可以再说');
}

console.log('\n## 闭环：没回应 → 这个需求更欠');
{
  const q = createPurpose({ now: () => t });
  const goal = { id: 'g', owner: 'self', text: '想问的事', need: 'ask', confidence: 0.6, status: 'sent' };
  q.state.goals.push(goal);
  q.state.drives.ask = 0.3;
  q.applyOutcome({ goalId: 'g', replied: false });
  ok(goal.status === 'stale' && goal.confidence < 0.6, '没回应：置信度下降 + stale');
  ok(q.state.drives.ask > 0.3, '没回应：这个需求更欠（驱动升高）');

  const q2 = createPurpose({ now: () => t });
  const g2 = { id: 'g2', owner: 'self', text: '分享的事', need: 'share', confidence: 0.6, status: 'sent' };
  q2.state.goals.push(g2);
  q2.state.drives.share = 0.3;
  q2.applyOutcome({ goalId: 'g2', replied: true });
  ok(g2.status === 'confirmed' && g2.confidence > 0.6, '回应了：置信度上升 + confirmed');
  ok(q2.state.drives.share === 0.3, '回应了：驱动不再加码（已经满足）');
  ok(q2.applyOutcome({ goalId: 'nope' }) === null, '找不到：null');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
