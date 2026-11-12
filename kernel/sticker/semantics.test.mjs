/**
 * 表情语义测试（旧 sticker-semantics.js 的词表 + 邻近关系）
 * 跑法：node kernel/sticker/semantics.test.mjs
 */
import { EMOTIONS, NEUTRAL, normalizeEmotion, detectEmotions, emotionOf, neighborsOf, emotionScore } from './semantics.js';
import { createStickerBook } from './index.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

console.log('## 词表：说法不同，意思相近');
{
  ok(emotionOf('太好了！') === '开心', '"太好了" → 开心');
  ok(emotionOf('绷不住了') === '搞笑', '"绷不住" → 搞笑（不是只认"搞笑"两个字）');
  ok(emotionOf('笑不活了哈哈哈') === '搞笑' || emotionOf('笑不活了哈哈哈') === '开心', '多个词命中：取命中最多的');
  ok(emotionOf('我委屈') === '委屈', '"委屈" → 委屈');
  ok(emotionOf('求求你们别嘲笑了') === '委屈', '长说法也认（旧代码专门补的）');
  ok(emotionOf('今天天气不错') === NEUTRAL, '没有情绪词：平淡');
  ok(emotionOf('') === NEUTRAL, '空串：平淡');
}

console.log('\n## 归一化：中文标签进，中文标签出');
{
  ok(normalizeEmotion('开心') === '开心', '中文标签');
  ok(normalizeEmotion(' 搞笑 ') === '搞笑', '去空白');
  ok(normalizeEmotion('不存在') === '', '不认识：空（不瞎猜）');
  ok(normalizeEmotion('') === '', '空：空');
}

console.log('\n## 邻近关系：相近情绪给部分分');
{
  ok(neighborsOf('委屈').includes('难过'), '委屈 ↔ 难过');
  ok(neighborsOf('难过').includes('委屈'), '反过来也认（对称）');
  ok(neighborsOf('嘲讽').includes('得意'), '嘲讽 ↔ 得意');
  ok(emotionScore('委屈', '委屈') === 1, '完全命中：1 分');
  ok(emotionScore('委屈', '难过') === 0.45, '邻近：0.45 分');
  ok(emotionScore('委屈', '开心') === 0, '不相干：0 分');
  ok(emotionScore('不存在', '开心') === 0, '不认识的目标情绪：0 分');
}

console.log('\n## 词表本身：18 类、每类有词、兜底没有词');
{
  const withWords = EMOTIONS.filter((e) => e.words.length > 0);
  ok(withWords.length >= 16, `情绪类 ${withWords.length} 类（旧表 18 类去掉兜底）`);
  ok(EMOTIONS.every((e) => e.label), '每类都有中文标签');
  ok(!EMOTIONS.some((e) => e.label === NEUTRAL), '兜底「平淡」不在检测表里');
  const allWords = EMOTIONS.flatMap((e) => e.words);
  ok(new Set(allWords).size === allWords.length, '没有重复词（重复会抢分）');
}

console.log('\n## 接进表情库：没给情绪就从原话推断');
{
  const book = createStickerBook({ now: () => 1000 });
  book.add({ id: 's1', mediaId: 'm1', emotion: '搞笑' });
  book.add({ id: 's2', mediaId: 'm2', emotion: '委屈' });
  book.add({ id: 's3', mediaId: 'm3', emotion: '开心' });

  const picked = book.pick({ text: '绷不住了', max: 1 });
  ok(picked.length === 1 && picked[0].emotion === '搞笑', '"绷不住" → 挑搞笑的');

  const sad = book.pick({ text: '我有点难过', max: 1 });
  ok(sad.length === 1 && sad[0].emotion === '委屈', '难过 → 邻近的委屈也认');

  ok(book.pick({ emotion: '开心', max: 1 })[0].emotion === '开心', '显式给情绪：照给');

  const neutral = book.pick({ text: '今天几号', max: 3 });
  ok(neutral.length === 3, '没情绪时：不硬筛（都能挑）');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
