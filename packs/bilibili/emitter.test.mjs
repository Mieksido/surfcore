/**
 * B站 事件化测试（不联网）
 * 跑法：node packs/bilibili/emitter.test.mjs
 */
import { toEvent, toEvents, IMPORTANCE_HINT } from './emitter.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

const NOW = 1000;

console.log('## 翻译成统一事件');
{
  const ev = toEvent({ type: 'video', item: { bvid: 'BV1xx', title: '一个视频', author: 'UP主', authorId: 7 }, at: NOW });
  ok(ev.from.adapter === 'bilibili', '来源：只有一个值（这就是"渠道"的全部）');
  ok(ev.from.channel === 'bilibili:feed', '频道由类型决定');
  ok(ev.from.actor === '7', '作者编号进 actor');
  ok(ev.from.at === NOW, '时间带上');
  ok(ev.text.includes('视频：') && ev.text.includes('一个视频'), '正文带类型前缀');
  ok(ev.tags.includes('bvid:BV1xx') && ev.tags.includes('up:UP主'), '平台信息进 tags（不新增字段）');
  ok(Number.isFinite(ev.importance), '带重要度提示');
}

console.log('\n## 重要度按平台语义给提示');
{
  const fav = toEvent({ type: 'favorite', item: { title: 'x' }, at: NOW });
  const dyn = toEvent({ type: 'dynamic', item: { content: 'y' }, at: NOW });
  const vid = toEvent({ type: 'video', item: { title: 'z' }, at: NOW });
  ok(fav.importance === IMPORTANCE_HINT.favorite && fav.importance > dyn.importance, '收藏 > 动态');
  ok(dyn.importance > vid.importance, '动态 > 普通视频');
  ok(fav.importance <= 100 && vid.importance >= 0, '在 0~100 内');
}

console.log('\n## 边界');
{
  ok(toEvent({ type: 'video', item: {}, at: NOW }) === null, '没内容：不造事件（不占记忆）');
  ok(toEvent({ type: 'unknown', item: { title: 't' }, at: NOW }).from.channel === 'bilibili:feed', '不认识的类型：按视频处理');
  const many = toEvents(Array.from({ length: 12 }, (_, i) => ({ title: `第${i}个` })), { at: NOW, max: 5 });
  ok(many.length === 5, '批量：受上限约束');
  ok(toEvents([]).length === 0, '空列表：空结果');
  ok(toEvent({ type: 'video', item: { title: 'a', desc: 'b' }, at: NOW }).text.includes('a。b'), '标题和描述拼起来');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
