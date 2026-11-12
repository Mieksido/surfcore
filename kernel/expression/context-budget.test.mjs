/**
 * 上下文预算测试
 * 跑法：node kernel/expression/context-budget.test.mjs
 */
import { estimateTokens, trimToTokens, fitPrompt } from './context-budget.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

console.log('## token 估算');
{
  ok(estimateTokens('') === 0, '空串：0');
  const cjk = estimateTokens('这是一句中文');
  ok(cjk >= 3 && cjk <= 6, `六个汉字 ≈ ${cjk} token（1.6 字/token）`);
  const en = estimateTokens('hello world');
  ok(en >= 2 && en <= 4, `11 个 ASCII ≈ ${en} token`);
  const mixed = estimateTokens('中文abc');
  ok(mixed >= estimateTokens('中文') && mixed <= estimateTokens('中文') + estimateTokens('abc'), '中英混排：落在两者之间（ceil 不可加）');
}

console.log('\n## 截断');
{
  const long = '啊'.repeat(500);
  const cut = trimToTokens(long, 50);
  ok(cut.trimmed === true, '超限：被截');
  ok(cut.text.endsWith('…'), '截断处有省略号');
  ok(estimateTokens(cut.text) <= 50, '截完不超预算');
  ok(trimToTokens('短句', 50).trimmed === false, '没超：原样返回');
  ok(trimToTokens('任意', 0).text === '', '预算 0：返回空');
}

console.log('\n## 装进预算（先剪记忆，人格不剪）');
{
  const system = '你是小鲸鱼。'.repeat(5);          // 人格：不许剪
  const user = '【记忆】\n' + '- 过去的一件事\n'.repeat(80) + '【现在】你在私聊里，主人对你说：\n在吗';
  const fitted = fitPrompt({ system, user, maxTokens: 200, reserveForOutput: 50 });

  ok(fitted.system === system, '人格部分：一个字没剪');
  ok(fitted.trimmed.memory === true, '记忆块：被剪了');
  ok(fitted.user.includes('【现在】'), '现场部分保留（会剪记忆但不会把"现在"剪掉）');
  ok(fitted.user.includes('在吗'), '当前这句话保留');
  ok(fitted.tokens <= 150, `总量装进预算（实际 ${fitted.tokens} ≤ 150）`);
}

console.log('\n## 不超预算时不动');
{
  const fitted = fitPrompt({ system: '你是她', user: '你好', maxTokens: 1000 });
  ok(fitted.trimmed.memory === false && fitted.trimmed.user === false, '没超：什么也不剪');
  ok(fitted.system === '你是她' && fitted.user === '你好', '内容原样');
}

console.log('\n## 极端：连正文都装不下');
{
  const fitted = fitPrompt({ system: '短', user: '啊'.repeat(2000), maxTokens: 100 });
  ok(fitted.trimmed.user === true, '正文被剪');
  ok(fitted.tokens <= 100, '仍然不超预算');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
