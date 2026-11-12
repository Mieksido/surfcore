/**
 * 合并转发（收）测试：拍平成文本，不假装看懂
 * 跑法：node packs/qq/forward.test.mjs
 */
import { flattenForward, lineOfMessage, forwardBlockOf, FORWARD } from './forward.js';
import { parseSegments } from './onebot.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

console.log('## 解析：合并转发段被认出来');
{
  const r = parseSegments([{ type: 'text', data: { text: '看这个' } }, { type: 'forward', data: { id: 'fw1' } }]);
  ok(r.forwards.length === 1 && r.forwards[0].id === 'fw1', '拿到转发编号');
  ok(r.text === '看这个', '正文不受影响');

  const inline = parseSegments([{ type: 'forward', data: { content: [{ nickname: '甲', content: '你好' }] } }]);
  ok(inline.forwards[0].content.length === 1, '内联内容也认');

  const card = parseSegments([{ type: 'json', data: { data: JSON.stringify({ prompt: '[聊天记录] 3 条' }) } }]);
  ok(card.forwards[0].brief.includes('聊天记录'), 'json 卡片：只取摘要');
  const badCard = parseSegments([{ type: 'json', data: { data: '不是JSON' } }]);
  ok(badCard.forwards.length === 0, '坏卡片：不产生转发（不崩）');
}

console.log('\n## 一条消息 → 一行（媒体给占位，不给 URL）');
{
  ok(lineOfMessage({ sender: { card: '小明' }, message: [{ type: 'text', data: { text: '你好' } }] }) === '- 小明：你好', '文本正常');
  const withImg = lineOfMessage({ sender: { nickname: '甲' }, message: [{ type: 'image', data: { url: 'http://x/a.jpg' } }] });
  ok(withImg.includes('[图片]') && !withImg.includes('http'), '图片给占位，URL 不进正文');
  ok(lineOfMessage({ nickname: '甲', message: [] }).includes('[空消息]'), '空消息有占位');
  ok(lineOfMessage({ sender: { card: '名'.repeat(40) }, message: 'hi' }).length < 80, '名字限长');
}

console.log('\n## 拍平：取数、截断、失败如实');
{
  const messages = Array.from({ length: 30 }, (_, i) => ({ sender: { card: `人${i}` }, message: [{ type: 'text', data: { text: `第${i}条` } }] }));
  const r = await flattenForward({ ref: { id: 'fw' }, fetchForward: async () => ({ messages }) });
  ok(r.ok === true, '取到了');
  ok(r.count === FORWARD.maxMessages, `只取前 ${FORWARD.maxMessages} 条`);
  ok(r.text.includes('还有 10 条'), '剩下的给一句提示（不假装全读了）');
  ok(r.text.length <= FORWARD.maxTotalChars + 20, '整体限长');

  const one = await flattenForward({ ref: { id: 'fw' }, fetchForward: async () => ({ messages: [{ sender: { card: '甲' }, message: '你好' }] }) });
  ok(one.ok && one.text === '- 甲：你好', '单条格式正确');

  const inline = await flattenForward({ ref: { content: [{ nickname: '乙', content: '在吗' }] } });
  ok(inline.ok && inline.text.includes('乙'), '内联内容不用取数');

  const brief = await flattenForward({ ref: { brief: '[聊天记录] 2 条' } });
  ok(brief.ok && brief.text.includes('摘要'), '只有摘要：如实标注');
}

console.log('\n## 失败：不抛，给"取不到"');
{
  const noId = await flattenForward({ ref: {} });
  ok(noId.ok === false && noId.text.includes('取不到'), '没编号：取不到');

  const noFetcher = await flattenForward({ ref: { id: 'x' } });
  ok(noFetcher.error === 'no-fetcher', '没有取数能力：明确说');

  const boom = await flattenForward({ ref: { id: 'x' }, fetchForward: async () => { throw new Error('网关拒绝'); } });
  ok(boom.ok === false && boom.text.includes('取不到'), '取数抛错：不崩');

  const badShape = await flattenForward({ ref: { id: 'x' }, fetchForward: async () => ({ 什么都不是: 1 }) });
  ok(badShape.error === 'bad-shape', '返回形状不对：明确说');

  const alt = await flattenForward({ ref: { id: 'x' }, fetchForward: async () => ({ message: [{ nickname: '丙', content: '嗯' }] }) });
  ok(alt.ok === true, '另一种返回形状（message）也认');
}

console.log('\n## 事件正文里的那一段');
{
  const block = forwardBlockOf({ ok: true, text: '- 甲：你好' });
  ok(block.startsWith('【转发的聊天记录】'), '带小标题（她能分清这是转发）');
  ok(forwardBlockOf({ ok: true, text: '' }) === '', '空的：不产出');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
