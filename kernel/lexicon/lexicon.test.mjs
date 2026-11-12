/**
 * 黑话库测试
 * 跑法：node kernel/lexicon/lexicon.test.mjs
 */
import { createLexicon } from './index.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

const lx = createLexicon({ now: () => 1000 });

console.log('## 候选：只收不认');
{
  const a = lx.propose({ word: '绝绝子', context: '群里有人这么说', actor: 'u1' });
  ok(a && a.word === '绝绝子', '提交候选：收下');
  const again = lx.propose({ word: '绝绝子', context: '又说了一次' });
  ok(again.hits === 2, '同一个词再出现：只加计数，不重复存');
  ok(lx.pending().length === 1, '候选池里只有一条');

  ok(lx.lookup('绝绝子') === null, '**未确认的词：她还不认识**（不进提示词）');
  ok(lx.render() === '', '渲染为空（没确认的词不出现）');
}

console.log('\n## 确认之后才算学会');
{
  lx.confirm({ word: '绝绝子', meaning: '太厉害了（夸张说法）', tags: ['夸'] });
  ok(lx.lookup('绝绝子')?.meaning.includes('太厉害'), '确认后：能查到含义');
  ok(lx.pending().length === 0, '确认后：从候选里移走');
  const text = lx.render();
  ok(text.includes('绝绝子') && text.includes('太厉害'), '渲染里出现词与含义');
}

console.log('\n## 拒绝');
{
  lx.propose({ word: '脏话例子' });
  ok(lx.reject('脏话例子') === true, '拒绝：从候选删掉');
  ok(lx.lookup('脏话例子') === null, '拒绝后：永远不认识');
}

console.log('\n## 边界与统计');
{
  ok(lx.propose({ word: '' }) === null, '空词：不收');
  ok(lx.propose({ word: 'x'.repeat(30) }) === null, '过长的词：不收');
  const s = lx.stats();
  ok(s.confirmed === 1 && s.candidates === 0, '统计：1 个确认词');

  const small = createLexicon({ maxConfirmed: 2, now: () => 1000 });
  small.confirm({ word: 'a1', count: 1 });
  small.confirm({ word: 'a2', count: 9 });
  small.confirm({ word: 'a3', count: 5 });
  ok(small.stats().confirmed === 2, '上限：超出的被挤掉');
  ok(small.lookup('a1') === null && small.lookup('a2') !== null, '按出现次数留（用得最少的先出局）');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
