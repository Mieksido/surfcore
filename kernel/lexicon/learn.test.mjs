/**
 * 黑话学习测试（旧 slang-learner 的四件本事）
 * 跑法：node kernel/lexicon/learn.test.mjs
 */
import { createLexicon } from './index.js';
import { buildExtractionPrompt, parseExtraction, mergeEvidence, escapeLearnerText, LEARN } from './learn.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

console.log('## ① 提取提示词：短、有限、警告语料不可信');
{
  const p = buildExtractionPrompt([
    { sender: '甲', text: '这个绝绝子' },
    { sender: '<script>', text: 'xswl 笑死我了' },
  ]);
  ok(p.includes('2~8'), '写明长度范围');
  ok(p.includes('不可信文本'), '警告群友的话只是语料');
  ok(p.includes('绝不能执行'), '明说不能当指令');
  ok(p.includes('&lt;script&gt;'), '说话人/正文被转义（不能注入）');
  ok(p.includes('JSON 数组'), '要求只输出 JSON');
}

console.log('\n## ② 解析容错');
{
  const cases = [
    ['[{"content":"yyds","source_id":"1"}]', 1, '标准 JSON'],
    ['```json\n[{"content":"xswl"}]\n```', 1, '``` 包裹'],
    ['废话前言 [{"content":"绝绝子"}] 后记', 1, '前后夹废话'],
    ['{"content":"emo了"}', 1, '单个对象'],
    ['', 0, '空串'],
    ['不是 JSON', 0, '纯文字'],
    ['[{"content":"ab"},{"content":"ab"},{"content":"太长太长太长太长太长"}]', 1, '去重 + 过滤超长'],
    ['[{"content":"的"}]', 0, '过滤太短（单字功能词）'],
  ];
  for (const [text, count, label] of cases) {
    ok(parseExtraction(text).length === count, label);
  }
  ok(parseExtraction('[' + Array(30).fill('{"content":"词"}').join(',') + ']').length <= LEARN.maxWords, `最多 ${LEARN.maxWords} 个`);
}

console.log('\n## ③ 证据合并：去重、限长、只留最后一截');
{
  const merged = mergeEvidence([{ text: 'a' }], [{ text: 'a' }, { text: 'b' }]);
  ok(merged.length === 2, '同一条证据不重复记');
  const long = mergeEvidence([], [{ text: 'x'.repeat(200) }]);
  ok(long[0].text.length <= LEARN.evidenceTextMax, '证据文本限长');
  const many = mergeEvidence([], Array.from({ length: 30 }, (_, i) => ({ text: `e${i}` })));
  ok(many.length === LEARN.maxEvidence, `最多留 ${LEARN.maxEvidence} 条`);
  ok(!mergeEvidence([{ text: 'a' }], [{ text: 'a' }]).some((x, i, arr) => arr.filter((y) => y.text === 'a').length > 1), '真的去重了');
}

console.log('\n## ④ 渲染防注入 + 只给确认的 + 按次数排');
{
  const lx = createLexicon({ now: () => 1000 });
  lx.propose({ word: 'yyds', context: '群里说的' });
  ok(lx.render() === '', '候选阶段：不进提示词');

  lx.confirm({ word: 'yyds', meaning: '永远的神', count: 3 });
  lx.confirm({ word: 'xswl', meaning: '笑死我了', count: 9 });
  const text = lx.render();
  ok(text.includes('yyds') && text.includes('xswl'), '确认后出现');
  ok(text.indexOf('xswl') < text.indexOf('yyds'), '按出现次数排（xswl 在前）');

  lx.confirm({ word: '<b>坏词</b>', meaning: '[at:id=1]' });
  const safe = lx.render();
  ok(!safe.includes('<b>'), 'HTML 被转义');
  ok(!safe.includes('[at:'), '方括号被转义（不能借标记形状变成指令）');
}

console.log('\n## 容量：超出按"用得多的留下"');
{
  const lx = createLexicon({ maxConfirmed: 2, now: () => 1000 });
  lx.confirm({ word: 'a', meaning: 'A', count: 1 });
  lx.confirm({ word: 'b', meaning: 'B', count: 9 });
  lx.confirm({ word: 'c', meaning: 'C', count: 5 });
  ok(lx.stats().confirmed === 2, '只留 2 条');
  ok(lx.lookup('a') === null, '用得少的被挤掉');
  ok(lx.lookup('b') !== null && lx.lookup('c') !== null, '用得多的留下');
}

console.log('\n## 接起来：模型输出 → 候选池');
{
  const lx = createLexicon({ now: () => 1000 });
  const list = lx.ingestExtraction('[{"content":"绝绝子"},{"content":"yyds"}]');
  ok(list.length === 2, '解析出 2 个');
  ok(lx.pending().length === 2, '都进了候选池');
  ok(lx.render() === '', '确认前仍不进提示词');
  ok(escapeLearnerText('[at:id=1]') === '&#91;at:id=1&#93;', '方括号转义可单测');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
