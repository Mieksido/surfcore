/**
 * 对话收尾测试
 * 跑法：node kernel/closure/closure.test.mjs
 */
import { createClosure, DEFAULT_CLOSURE } from './index.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

let t = 100000;
const c = createClosure({ idleMs: 60000, maxTurns: 3, now: () => t });

console.log('## 明确道别');
{
  ok(c.shouldClose({ channel: 'c1', text: '晚安啦', at: t }).reason === 'explicit-farewell', '说"晚安"：该收');
  ok(c.shouldClose({ channel: 'c1', text: '拜拜', at: t }).close === true, '说"拜拜"：该收');
  ok(c.shouldClose({ channel: 'c1', text: '先这样吧', at: t }).close === true, '说"先这样"：该收');
  ok(c.shouldClose({ channel: 'c1', text: '明天见', at: t }).close === true, '说明天见：该收');
  ok(c.shouldClose({ channel: 'c1', text: '在吗', at: t }).close === false, '普通话：不收');
}

console.log('\n## 安静太久');
{
  c.touch('c2', t);
  ok(c.shouldClose({ channel: 'c2', text: '嗯', at: t + 30000 }).close === false, '30 秒没到：不收');
  const idle = c.shouldClose({ channel: 'c2', text: '嗯', at: t + 61000 });
  ok(idle.close === true && idle.reason === 'idle', '超过 1 分钟：该收（说清原因）');
  ok(String(idle.hint).includes('收尾'), '给出下一步');
}

console.log('\n## 聊太久');
{
  const d = createClosure({ maxTurns: 2, now: () => t });
  d.touch('c3', t); d.touch('c3', t);
  const long = d.shouldClose({ channel: 'c3', text: '继续', at: t });
  ok(long.close === true && long.reason === 'too-long', '超过轮次上限：该收');
}

console.log('\n## 收尾后重置');
{
  c.touch('c4', t); c.touch('c4', t);
  c.closed('c4', t);
  ok(c.stats('c4').turns === 0, '收尾后：轮次归零');
  ok(c.shouldClose({ channel: 'c4', text: '新话题', at: t }).reason === 'not-started', '下一段重新开始');
}

console.log('\n## 边界');
{
  ok(DEFAULT_CLOSURE.idleMs === 20 * 60 * 1000, '默认安静 20 分钟');
  ok(c.shouldClose({ channel: '没聊过', text: '喂' }).reason === 'not-started', '没聊过的频道：不算在聊');
  ok(c.config().maxTurns === 3, '配置可读');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
