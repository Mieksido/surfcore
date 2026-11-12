/**
 * 对话摘要纯函数测试
 * 跑法：node kernel/conversation/summary.test.mjs
 */
import {
  DEFAULT_SUMMARY, shouldSummarize, buildSummaryPrompt, normalizeSummary, mergeSummary, renderSummaryBlock,
} from './summary.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

console.log('## 该不该摘要');
{
  ok(shouldSummarize({ pendingTurns: 4, pendingChars: 10 }) === true, '够 4 轮：摘要');
  ok(shouldSummarize({ pendingTurns: 2, pendingChars: 500 }) === true, '够 400 字：摘要');
  ok(shouldSummarize({ pendingTurns: 1, pendingChars: 20 }) === false, '太少：不摘要');
  ok(shouldSummarize({ pendingTurns: 100, minTurns: 5 }) === true, '阈值可调');
  ok(DEFAULT_SUMMARY.maxChars === 600, '默认摘要上限 600 字');
}

console.log('\n## 提示词');
{
  const p = buildSummaryPrompt({
    turns: [
      { role: 'user', actor: '主人', text: '今天看到一只猫' },
      { role: 'her', text: '什么猫？' },
      { role: 'user', actor: '主人', text: '橘猫，很胖' },
    ],
  });
  ok(p.system.includes('摘要'), 'system 说清任务');
  ok(p.user.includes('主人：今天看到一只猫'), '带说话人');
  ok(p.user.includes('她：什么猫？'), '带她的轮次');
  ok(p.user.includes('不要编造'), '明确不许编');
  ok(p.user.includes('不超过'), '有长度要求');
  ok(p.turns === 3, '记下轮次数');

  const withPrev = buildSummaryPrompt({ previous: '主人养了一只猫', turns: [{ role: 'user', text: '它叫咪咪' }] });
  ok(withPrev.user.includes('已有摘要') && withPrev.user.includes('咪咪'), '有旧摘要：要合并');

  const empty = buildSummaryPrompt({ turns: [] });
  ok(empty.turns === 0, '空轮次：0');
}

console.log('\n## 清理模型输出');
{
  ok(normalizeSummary('  “主人今天在聊猫。”  ') === '主人今天在聊猫。', '去引号/空白');
  ok(normalizeSummary('摘要：主人在聊猫') === '主人在聊猫', '去“摘要：”前缀');
  ok(normalizeSummary('```text\n主人在聊猫\n```') === '主人在聊猫', '去代码围栏');
  ok(normalizeSummary('[SILENT]') === null, '沉默：null');
  ok(normalizeSummary('[沉默]') === null, '中文沉默：null');
  ok(normalizeSummary('') === null, '空：null');
  ok(normalizeSummary('x'.repeat(900), { maxChars: 100 }).length === 100, '受上限约束');
}

console.log('\n## 合并');
{
  ok(mergeSummary('旧事实', '新事实').includes('旧事实') && mergeSummary('旧事实', '新事实').includes('新事实'), '旧+新都保留');
  ok(mergeSummary('', '新事实') === '新事实', '没旧：只用新');
  ok(mergeSummary('旧事实', '') === '旧事实', '没新：保留旧');
  ok(mergeSummary('旧事实', '旧事实') === '旧事实', '重复：不重复写');
  ok(mergeSummary('x'.repeat(700), 'y', { maxChars: 100 }).length === 100, '合并也受上限');
}

console.log('\n## 渲染块');
{
  ok(renderSummaryBlock('主人在聊猫') === '【更早的对话摘要】\n主人在聊猫', '有摘要：带标题');
  ok(renderSummaryBlock('') === '', '没摘要：空串');
  ok(renderSummaryBlock(null) === '', 'null：空串');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
