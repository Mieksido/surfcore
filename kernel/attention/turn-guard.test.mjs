/**
 * 轮次守卫测试
 * 跑法：node kernel/attention/turn-guard.test.mjs
 */
import { createTurnGuard, DEFAULT_TURN_GUARD } from './turn-guard.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

let t = 1000000;
const g = createTurnGuard({ windowMs: 10000, maxPerWindow: 3, minGapMs: 0, now: () => t });

console.log('## 窗口内限次');
{
  ok(g.check({ actor: 'a' }).allow, '第 1 轮：放行');
  ok(g.check({ actor: 'a' }).allow, '第 2 轮：放行');
  ok(g.check({ actor: 'a' }).allow, '第 3 轮：放行');
  const blocked = g.check({ actor: 'a' });
  ok(blocked.allow === false && blocked.reason === 'too-many-turns', '第 4 轮：挡住（窗口内上限 3）');
  ok(blocked.count === 3, '挡住时报告窗口内已有几轮');

  ok(g.check({ actor: 'b' }).allow, '换个人：不受影响（按人独立计）');
  t += 10001;
  ok(g.check({ actor: 'a' }).allow, '窗口滑过去：又能说话了');
}

console.log('\n## 最小间隔（默认关闭）');
{
  ok(DEFAULT_TURN_GUARD.minGapMs === 0, '默认不限制最小间隔（连发两条是正常行为）');
  let t2 = 0;
  const strict = createTurnGuard({ minGapMs: 1500, maxPerWindow: 99, now: () => t2 });
  ok(strict.check({ actor: 'a' }).allow, '第一条：放行');
  const fast = strict.check({ actor: 'a' });
  ok(!fast.allow && fast.reason === 'too-fast', '1.5 秒内第二条：挡住');
  t2 += 1600;
  ok(strict.check({ actor: 'a' }).allow, '过了间隔：放行');
}

console.log('\n## 边界');
{
  const g2 = createTurnGuard({ maxPerWindow: 2, now: () => 0 });
  ok(g2.check({}).allow === true, '没有 actor：放行（匿名渠道不挡）');
  ok(g2.check({ actor: '' }).reason === 'no-actor', '空 actor：说明原因');

  g2.check({ actor: 'x' }); g2.check({ actor: 'x' });
  ok(!g2.check({ actor: 'x' }).allow, '到上限后挡住');
  g2.reset();
  ok(g2.check({ actor: 'x' }).allow, 'reset 后重新计');
  ok(g2.config().maxPerWindow === 2, '配置可读');
  ok(g2.countOf('x') === 1, 'countOf 可用');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
