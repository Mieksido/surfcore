/**
 * B站 分享文本测试
 * 跑法：node packs/bilibili/share.test.mjs
 */
import {
  buildShareText, isShareable, httpsifyImage, videoUrl, CARD_MODES, normalizeCardMode, renderShare,
  SHARE_COOLDOWN_MS, cardFromRecord, pickShareCard, buildSharePrompt,
} from './share.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

console.log('## 纯文本：标题 + 链接（任何客户端都能点）');
{
  const t = buildShareText({ title: '猫猫视频', bvid: 'BV1xx' });
  ok(t.startsWith('【B站】'), '有平台标记');
  ok(t.includes('猫猫视频'), '有标题');
  ok(t.includes('https://www.bilibili.com/video/BV1xx'), '有链接');
  ok(!t.includes('{'), '纯文本（不是 JSON 卡片）');
}

console.log('\n## 链接优先级：给了 url 用 url，否则用 bvid 拼');
{
  ok(videoUrl({ url: 'https://b23.tv/abc' }) === 'https://b23.tv/abc', '直接给链接：用链接');
  ok(videoUrl({ bvid: 'BV9' }) === 'https://www.bilibili.com/video/BV9', '只给 bvid：拼标准地址');
  ok(videoUrl({}) === '', '都没有：空');
  ok(buildShareText({ title: 'x', url: 'https://b23.tv/1' }).includes('b23.tv'), '短链也照用');
}

console.log('\n## 边界');
{
  ok(buildShareText({}) .includes('（没标题）'), '没标题：给占位（不发半截消息）');
  ok(buildShareText({ title: 'x'.repeat(400) }).length <= 200, '受字数上限约束');
  ok(buildShareText({ title: 't', bvid: 'B', maxChars: 40 }).length <= 40, '自定义上限生效');
  ok(buildShareText({ title: '多  空格   标题' }).includes('多 空格 标题'), '多余空白被压掉');
  ok(buildShareText({ title: 't', bvid: 'B', up: '某个UP' }).includes('某个UP'), '带 UP 名');
}

console.log('\n## 图片地址升级 https');
{
  ok(httpsifyImage('http://i0.hdslb.com/a.jpg') === 'https://i0.hdslb.com/a.jpg', 'http → https');
  ok(httpsifyImage('https://x/a.jpg') === 'https://x/a.jpg', '已经是 https：不动');
  ok(httpsifyImage('') === '', '空串：空');
}

console.log('\n## 该不该分享');
{
  ok(isShareable({ title: '有标题', bvid: 'BV1' }) === true, '有标题有链接：可分享');
  ok(isShareable({ bvid: 'BV1' }) === false, '没标题：不分享');
  ok(isShareable({ title: '有标题' }) === false, '没链接：不分享');
}

console.log('\n## 分享范围（旧 share-mode）：off / text / miniapp');
{
  ok(CARD_MODES.join() === 'off,text,miniapp', '三种模式');
  ok(normalizeCardMode(null) === 'text' || normalizeCardMode({}) === 'text', '默认：text');
  ok(normalizeCardMode({ card: false }) === 'off', '旧值 card:false → off');
  ok(normalizeCardMode({ cardMode: 'link' }) === 'text', '旧值 link → text（当时以为链接能显示）');
  ok(normalizeCardMode({ cardMode: 'miniapp' }) === 'miniapp', 'miniapp 保留名字');

  const item = { title: '猫猫视频', bvid: 'BV1' };
  const text = renderShare(item, { share: { cardMode: 'text' } });
  ok(text.send === true && text.text.includes('【B站】'), 'text：系统发');

  const off = renderShare(item, { share: { card: false } });
  ok(off.send === false && off.reason.includes('角色'), 'off：系统不发，交给她写进短评');

  const mini = renderShare(item, { share: { cardMode: 'miniapp' } });
  ok(mini.send === false && mini.reason.includes('下架'), 'miniapp：不发（已下架）');

  const noLink = renderShare({ title: '有标题' }, {});
  ok(noLink.send === false, '没有链接：不发（不发明半截）');
}

console.log('\n## 从记忆记录造分享卡');
{
  const card = cardFromRecord({
    text: '视频：猫猫视频。今天看到的，很可爱',
    tags: ['bvid:BV1xx', 'up:某个UP'],
    from: { at: 1000 },
    importance: 35,
  });
  ok(card.id === 'BV1xx' && card.bvid === 'BV1xx', '有 bvid：用它当 id');
  ok(card.url === 'https://www.bilibili.com/video/BV1xx', '链接由 bvid 拼');
  ok(card.title === '猫猫视频。今天看到的，很可爱'.slice(0, 80), '标题去掉"视频："前缀');
  ok(card.up === '某个UP', 'UP 名从 tags 取');
  ok(isShareable(card), '可分享');

  const dyn = cardFromRecord({ text: '动态：今天发了一条动态', tags: ['dynamic:123'], from: { at: 2000 } });
  ok(dyn.id === '123' && dyn.url === 'https://t.bilibili.com/123', '动态：id 与链接');

  const noLink = cardFromRecord({ text: '一句话', tags: [] });
  ok(noLink.id.startsWith('rec-'), '没有平台编号：用稳定散列 id');
  ok(!isShareable(noLink), '没有链接：不可分享（不发明半截消息）');

  ok(cardFromRecord({ text: '' }) === null, '空记录：null');
  ok(cardFromRecord({}) === null, '空对象：null');
}

console.log('\n## 挑分享卡：6 天冷却 / 没有新鲜的就不发');
{
  const records = [
    { text: '视频：新的', tags: ['bvid:BV1'], from: { at: 3000 }, importance: 35 },
    { text: '视频：旧的', tags: ['bvid:BV2'], from: { at: 2000 }, importance: 80 },
  ];
  const now = 10 * 86400000;
  const first = pickShareCard(records, { now });
  ok(first.id === 'BV2', '先挑重要度高的');
  ok(SHARE_COOLDOWN_MS === 6 * 86400000, '冷却 6 天');

  const cooled = pickShareCard(records, { now, history: { BV2: new Date(now - 2 * 86400000).toISOString() } });
  ok(cooled.id === 'BV1', '冷却期内跳过刚发过的');

  const none = pickShareCard(records, {
    now,
    history: { BV1: new Date(now - 86400000).toISOString(), BV2: new Date(now - 86400000).toISOString() },
  });
  ok(none === null, '都在冷却：不发旧的（返回 null，不凑数）');

  const expired = pickShareCard(records, { now, history: { BV1: now - 7 * 86400000, BV2: now - 7 * 86400000 } });
  ok(expired !== null, '超过 6 天：可以再用');

  const rotated = pickShareCard(records, { now, slotIndex: 1 });
  ok(rotated.id === 'BV1', 'slotIndex 轮换：换一张');

  ok(pickShareCard([], { now }) === null, '没有候选：null');
  ok(pickShareCard([{ text: '没链接', tags: [] }], { now }) === null, '都不可分享：null');
}

console.log('\n## 分享提示词：只输出要发的话，不含旧工具名');
{
  const card = { title: '猫猫视频', url: 'https://www.bilibili.com/video/BV1', reason: '视频：猫猫视频。很可爱', quote: '' };
  const p1 = buildSharePrompt(card, '21:00');
  ok(p1.includes('21:00'), '带时间点');
  ok(p1.includes('猫猫视频') && p1.includes('BV1'), '带标题与链接');
  ok(p1.includes('只输出要发到群里的内容'), '说清输出什么');
  ok(!p1.includes('mcp__') && !p1.includes('reserved2'), '不含旧 MCP 工具名/运行模式');
  ok(!p1.includes('```'), '不用 Markdown 代码块');

  const p2 = buildSharePrompt(card, '21:00', { cardSent: true });
  ok(p2.includes('已经由系统发到群里'), '卡片已发：只写短评');
  ok(p2.includes('不要再发链接'), '不许重复链接');

  const long = buildSharePrompt(card, '21:00', { maxChars: 200 });
  ok(long.length <= 200, '受字数上限约束');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
