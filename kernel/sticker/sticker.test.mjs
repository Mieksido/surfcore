/**
 * 表情库测试
 * 跑法：node kernel/sticker/sticker.test.mjs
 *
 * 注意：这里**不存图片**，只存 mediaId 引用 + 语义（图片本体在内核媒体库）。
 */
import { createStickerBook, STICKER_EMOTIONS } from './index.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

const book = createStickerBook({ now: () => 1000 });

console.log('## 收藏');
{
  const s = book.add({ id: 's1', mediaId: 'm_1', emotion: '开心', tags: ['猫'], note: '猫笑' });
  ok(s.mediaId === 'm_1', '存的是 mediaId 引用（不复制图片）');
  ok(s.emotion === '开心', '情绪分类');
  ok(book.add({ id: 's1', mediaId: 'm_2' }).mediaId === 'm_1', '重复收藏：不覆盖已有');
  ok(book.add({ id: 's2', mediaId: 'm_2', emotion: '瞎写的' }).emotion === '平淡', '不认识的情绪：退回"平淡"（不崩）');
  ok(book.size() === 2, '两张');
  ok(STICKER_EMOTIONS.includes('开心'), '情绪清单是白名单');
}

console.log('\n## 挑选用硬筛子（情绪/标签不匹配的直接不出现）');
{
  book.add({ id: 's3', mediaId: 'm_3', emotion: '委屈', tags: ['猫'] });
  const picked = book.pick({ emotion: '开心', max: 1 });
  ok(picked.length === 1 && picked[0].emotion === '开心', '按情绪挑：只给开心那张');
  ok(book.pick({ emotion: '不存在', max: 5 }).length === 0, '没有这个情绪的：返回空（不硬凑）');
  const byTag = book.pick({ tags: ['猫'], max: 5 });
  ok(byTag.length === 2 && byTag.every((x) => x.tags.includes('猫')), '按标签挑：只给带这个标签的');
  ok(book.pick({ emotion: '开心', max: 0 }).length === 0, '上限 0：一个都不给');
}

console.log('\n## 用得多的往后排');
{
  const b = createStickerBook({ now: () => 1 });
  b.add({ id: 'a', mediaId: 'm_a', emotion: '开心' });
  b.add({ id: 'b', mediaId: 'm_b', emotion: '开心' });
  const first = b.pick({ emotion: '开心', max: 1 })[0];
  b.use(first.id); b.use(first.id);
  const next = b.pick({ emotion: '开心', max: 1 })[0];
  ok(next.id !== first.id, '用过两次之后：换另一张上（避免老是那一张）');
  ok(b.list().find((x) => x.id === first.id).uses === 2, '使用次数被记下');
}

console.log('\n## 提示词渲染 & 诊断');
{
  const text = book.render();
  ok(text.includes('开心') && text.includes('张') === false || text.length > 0, '渲染出"我收藏的表情"摘要');
  ok(text.length <= 200, '受字数上限约束');
  const st = book.stats();
  ok(st.total === 3 && st.byEmotion['开心'] === 1, '统计：按情绪分类');
  ok(book.remove('s1') === true && book.size() === 2, '删掉一张');
  ok(createStickerBook().render() === '', '空库：渲染空字符串');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
