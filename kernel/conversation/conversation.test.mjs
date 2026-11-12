/**
 * 对话窗口测试
 * 跑法：node kernel/conversation/conversation.test.mjs
 */
import { createConversationWindow, DEFAULT_WINDOW } from './index.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

const w = createConversationWindow({ maxTurns: 3, maxChars: 200, now: () => 1000 });

console.log('## 记与读');
{
  w.append({ channel: 'c1', role: 'user', actor: '主人', text: '在吗' });
  w.append({ channel: 'c1', role: 'her', text: '在呀' });
  const text = w.render('c1');
  ok(text.includes('主人：在吗'), '用户的轮次：带说话人');
  ok(text.includes('她：在呀'), '她的轮次：标"她"');
  ok(w.countOf('c1') === 2, '计数：2 轮');
}

console.log('\n## 分频道隔离');
{
  w.append({ channel: 'c2', role: 'user', actor: '别人', text: '喂' });
  ok(!w.render('c1').includes('喂'), 'c2 的话不会串到 c1');
  ok(w.render('c2').includes('喂'), 'c2 自己看得到');
  ok(w.stats().channels === 2, '两个频道各自一桶');
}

console.log('\n## 上限：挤出的旧轮次进 pending（不丢，等摘要）');
{
  for (let i = 0; i < 5; i++) w.append({ channel: 'c3', role: 'user', text: `第${i}句` });
  ok(w.countOf('c3') === 3, '最多留 3 轮（默认/配置的上限）');
  ok(w.pendingOf('c3').length === 2, '挤出去的两句进 pending');
  const text = w.render('c3');
  ok(text.includes('第0句') && text.includes('第1句'), 'pending 仍能渲染（摘要前不丢）');
  ok(text.includes('第4句'), '最新的还在');
}

console.log('\n## 摘要：攒够一批才做，做完 pending 清掉、摘要接上');
{
  const s = createConversationWindow({ maxTurns: 3, maxChars: 800 });
  for (let i = 0; i < 6; i++) s.append({ channel: 'c', role: 'user', text: `第${i}句` });
  const plan = s.compaction('c', { minTurns: 2, minChars: 999 });
  ok(plan.should === true && plan.count === 3, 'pending 够 2 轮：该摘要');
  const merged = s.applySummary('c', { text: '主人聊了第0到第2句', count: 3, maxChars: 200 });
  ok(merged.includes('第0到第2句'), '摘要写入');
  ok(s.pendingOf('c').length === 0, '被摘要覆盖的 pending 清掉');
  ok(s.render('c').includes('【更早的对话摘要】'), '渲染带摘要块');
  ok(s.render('c').includes('第3句'), '最近窗口还在');
  ok(s.stats().summaries === 1, '统计：有 1 个摘要');

  const plan2 = s.compaction('c', { minTurns: 2, minChars: 999 });
  ok(plan2.should === false, '清掉后不够：不再摘要');
}

console.log('\n## 摘要/待摘要的落盘');
{
  const s = createConversationWindow({ maxTurns: 2, maxChars: 300 });
  s.append({ channel: 'c', text: '一' });
  s.append({ channel: 'c', text: '二' });
  s.append({ channel: 'c', text: '三' });
  const archive = s.archive();
  ok(archive.summaries && archive.pending.c.length === 1, 'archive 带摘要与 pending');

  const copy = createConversationWindow({ maxTurns: 2, maxChars: 300 });
  copy.restoreArchive(archive);
  ok(copy.pendingOf('c').length === 1, '恢复 pending');
}

console.log('\n## 字数预算：从最新往回取');
{
  const small = createConversationWindow({ maxTurns: 10, maxChars: 20 });
  for (let i = 0; i < 5; i++) small.append({ channel: 'c', role: 'user', text: `这一句比较长${i}号` });
  const text = small.render('c');
  ok(text.length <= 24, `渲染长度受控（实际 ${text.length} 字符）`);
  ok(text.includes('4号'), '最新的一定保留');
}

console.log('\n## 空与清理');
{
  ok(w.render('不存在的频道') === '', '没聊过的频道：空字符串，不炸');
  ok(w.append({ channel: 'c1', text: '   ' }) === null, '空白内容：不入窗口');
  w.clear('c1');
  ok(w.render('c1') === '', 'clear 之后清空');
  ok(w.countOf('c1') === 0, '计数归零');
}

console.log('\n## 配置');
{
  ok(DEFAULT_WINDOW.maxTurns === 8, '默认保留 8 轮');
  ok(w.config().maxTurns === 3, '配置可读');
  const d = createConversationWindow();
  ok(d.stats().channels === 0 && d.stats().turns === 0, '新窗口是空的');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
