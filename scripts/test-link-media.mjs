// 链接 / 链接卡片 / 动图 的「能看见 + 按图片媒体概率唤醒」回归（2026-10-30 用户要求）。
//
// 用户原话：「动图，链接和链接卡片，也要适配到 bot 能看，回应概率依托之前看图媒体的」。
//
// 背景（真实聊天记录驱动）：
//   · 主人私聊发来一张 QQ 链接卡片，桥接只渲染成「[卡片消息]」，模型回「我点不开」；
//   · 正文里的普通链接以前既不算媒体，也不会按图片的 30% 概率唤醒；
//   · QQ 动图（GIF/动画表情）在文本层只标「[图片]」，模型会把"只看到一帧"当成看完了整段。
//
// 本测试分两层：
//   A. src/link-card.js 纯函数：卡片 JSON/XML 解析、实体解码、正文 URL 抽取、去重/限长；
//   B. 真 bridge.js（VM 夹具）：链接/卡片进 links、媒体唤醒概率、提示词、动图标注、落库字段。
// 不连真 QQ / DSH（audit-bridge-harness 提供虚拟网关）。
// 运行：node scripts/test-link-media.mjs
import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';
import {
  LINK_LIMITS, decodeEntities, describeLink, linkItemsFromSegments, normalizeLinkUrl,
  parseCardJson, parseCardXml, urlsInText,
} from '../src/link-card.js';
import { compactModelMessage } from '../src/qq-model-view.js';

let failures = 0;
function check(name, run) {
  try {
    run();
    console.log('PASS', name);
  } catch (error) {
    failures++;
    console.error('FAIL', name, '—', error?.stack ?? error);
  }
}
async function test(name, run, options = {}) {
  const h = await bridgeHarness(options.harness ?? {});
  try {
    h.setMode('reserved2');
    h.setSelfIdentity('小鲸鱼', 111);
    seedWakeState(h, options.key ?? 'group:456', options.triggers ?? {});
    await run(h);
    console.log('PASS', name);
  } catch (error) {
    failures++;
    console.error('FAIL', name, '—', error?.stack ?? error);
  } finally {
    await h.close();
  }
}

// ── A. 纯函数 ────────────────────────────────────────────────────────────
const NEWS_CARD = JSON.stringify({
  app: 'com.tencent.structmsg',
  config: { ctime: 1, forward: true },
  desc: '新闻',
  meta: {
    news: {
      title: '一篇值得看的文章',
      desc: '讲的是桥接怎么解析卡片',
      jumpUrl: 'https://example.com/news?a=1&amp;b=2',
      preview: 'https://example.com/cover.jpg',
    },
  },
  prompt: '[分享]一篇值得看的文章',
});

check('卡片 JSON（news）：标题/摘要/URL 都解出来，&amp; 解码', () => {
  const [card] = parseCardJson(NEWS_CARD);
  assert.ok(card, '必须解析出卡片');
  assert.equal(card.title, '一篇值得看的文章');
  assert.equal(card.desc, '讲的是桥接怎么解析卡片');
  assert.equal(card.url, 'https://example.com/news?a=1&b=2');
  assert.equal(card.source, 'card');
  assert.equal(card.cardType, 'news');
});

check('卡片 JSON（detail_1）：qqdocurl 也能当链接', () => {
  const [card] = parseCardJson(JSON.stringify({
    app: 'com.tencent.structmsg',
    meta: { detail_1: { title: 'B站视频', desc: 'UP 主的新片', qqdocurl: 'https://b23.tv/abc' } },
  }));
  assert.equal(card.title, 'B站视频');
  assert.equal(card.url, 'https://b23.tv/abc');
});

check('卡片 JSON（小程序 / ark）：没有 http 链接也保留标题，不抛错', () => {
  const [mini] = parseCardJson(JSON.stringify({
    app: 'com.tencent.miniapp_01',
    meta: { detail_1: { title: '某某小程序', desc: '点开看看', preview: 'https://x/y.jpg' } },
  }));
  assert.equal(mini.title, '某某小程序');
  assert.equal(mini.url, '');
  const [ark] = parseCardJson(JSON.stringify({
    app: 'com.tencent.ark',
    prompt: '[QQ小程序]签到',
    meta: { ark: { title: '签到卡片', desc: '每天签到' } },
  }));
  assert.equal(ark.title, '签到卡片');
});

check('卡片 JSON：坏 JSON / 空值不抛错，返回空数组', () => {
  assert.deepEqual(parseCardJson('{not json'), []);
  assert.deepEqual(parseCardJson(''), []);
  assert.deepEqual(parseCardJson(null), []);
});

check('卡片 XML：CDATA + brief 兜底 + 实体解码', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<msg serviceID="1" templateID="1" brief="[分享]一篇文章" url="https://example.com/a?x=1&amp;y=2">
  <item layout="2">
    <title><![CDATA[一篇文章的标题]]></title>
    <summary><![CDATA[摘要 &amp; 更多]]></summary>
    <url>https://example.com/a?x=1&amp;y=2</url>
  </item>
</msg>`;
  const [card] = parseCardXml(xml);
  assert.equal(card.title, '一篇文章的标题');
  assert.equal(card.desc, '摘要 & 更多');
  assert.equal(card.url, 'https://example.com/a?x=1&y=2');
});

check('正文 URL：去掉中文句号/右括号等尾随符号，图片直链不算链接', () => {
  const urls = urlsInText('看这个 https://example.com/a?b=1。还有（https://example.com/b）和图片 https://example.com/x.jpg');
  assert.deepEqual(urls, ['https://example.com/a?b=1', 'https://example.com/b']);
});

check('normalizeLinkUrl：只收 http(s)，mqqapi/tencent 协议不算可打开链接', () => {
  assert.equal(normalizeLinkUrl('mqqapi://card/show_pslcard?uin=1'), '');
  assert.equal(normalizeLinkUrl('//example.com/x'), 'https://example.com/x');
});

check('linkItemsFromSegments：json 卡片 + 正文 URL 合并去重并限条数', () => {
  const items = linkItemsFromSegments([
    { type: 'json', data: { data: NEWS_CARD } },
    { type: 'text', data: { text: '同一个 https://example.com/news?a=1&b=2 再贴一次' } },
    { type: 'text', data: { text: '另一个 https://example.com/other' } },
  ]);
  assert.equal(items.length, 2, '同一 URL 只留一条');
  assert.equal(items[0].title, '一篇值得看的文章');
  assert.equal(items[1].url, 'https://example.com/other');
});

check('linkItemsFromSegments：超过上限时截断，不做无上限注入', () => {
  const batch = (base) => Array.from({ length: 3 }, (_, i) => `https://example.com/${base}-${i}`).join(' ');
  const items = linkItemsFromSegments([
    { type: 'text', data: { text: batch('a') } },
    { type: 'text', data: { text: batch('b') } },
    { type: 'text', data: { text: batch('c') } },
  ], { max: LINK_LIMITS.maxPerMessage });
  assert.equal(items.length, LINK_LIMITS.maxPerMessage);
});

check('describeLink：标题 · 摘要 · URL 一行可读，超长截断', () => {
  const line = describeLink({ title: '标题', desc: '摘要', url: 'https://example.com/x' });
  assert.equal(line, '标题 · 摘要 · https://example.com/x');
  assert.ok(describeLink({ title: '长'.repeat(500) }).length <= LINK_LIMITS.title + 1);
});

check('decodeEntities：十进制/十六进制实体都能解', () => {
  assert.equal(decodeEntities('&#20320;&#x597d;&amp;'), '你好&');
});

check('qq-model-view：links 保留（有内容才留），false 布尔字段被省略', () => {
  const compact = compactModelMessage({
    seq: 3, links: [{ kind: 'link', source: 'card', cardType: 'news', title: 'T', url: 'https://example.com/x' }],
    hasLinks: true, hasMedia: false, media: [],
  });
  assert.equal(compact.links.length, 1);
  assert.equal(compact.links[0].url, 'https://example.com/x');
  assert.equal(compact.hasLinks, true);
  assert.equal('hasMedia' in compact, false, 'false 字段不该占上下文');
  const empty = compactModelMessage({ seq: 4, links: [], hasLinks: false });
  assert.equal('links' in empty, false);
});

// ── B. 真 bridge（VM 夹具）────────────────────────────────────────────────
function seedWakeState(h, key, overrides = {}) {
  const st = h.getSocialV2State(key);
  st.bootstrapSent = true;
  st.wakeConfig = {
    mode: 'diving', infinite: true, sleepUntil: null,
    triggers: {
      atMention: true, nameMention: true, speakerIds: [], keywords: ['小鲸鱼'],
      question: true, poke: true, anyMessage: false, probability: 0,
      ...overrides,
    },
    batchWindowMs: 60000, lastWakeAt: 0, wakeCount: 0, noActionCount: 0,
    confirmedAt: Date.now(), confirmedBy: 'set_wake_config',
  };
  return st;
}

function baseEvent({ groupId = 456, userId = 123, messageId = 4001, nickname = 'owner' } = {}) {
  return {
    post_type: 'message',
    message_type: 'group',
    group_id: groupId,
    user_id: userId,
    self_id: 111,
    message_id: messageId,
    sender: { user_id: userId, nickname },
  };
}

const cardEvent = (opts = {}) => ({
  ...baseEvent(opts),
  message: [{ type: 'json', data: { data: NEWS_CARD } }],
});
const urlTextEvent = (opts = {}, text = '这个挺好 https://example.com/article?id=9。') => ({
  ...baseEvent(opts),
  message: [{ type: 'text', data: { text } }],
});
const animatedEvent = (opts = {}) => ({
  ...baseEvent(opts),
  message: [{
    type: 'image',
    data: { file: 'ABC.gif', url: 'https://example.invalid/abc.gif', summary: '[动画表情]', sub_type: '1' },
  }],
});
const staticStickerEvent = (opts = {}) => ({
  ...baseEvent(opts),
  message: [{
    type: 'image',
    data: { file: 'DEF.png', url: 'https://example.invalid/def.png', summary: '[表情]', sub_type: '1' },
  }],
});
const plainTextEvent = (opts = {}) => ({
  ...baseEvent(opts),
  message: [{ type: 'text', data: { text: '随便聊两句' } }],
});

function wakeState(h, key = 'group:456') {
  const st = h.getSocialV2State(key);
  return { scheduled: Boolean(st.pendingWakeTimer), reason: st.pendingWakeReason || '' };
}

function lastStored(h, key = 'group:456') {
  const st = h.getSocialV2State(key);
  return st.unread[st.unread.length - 1];
}

const cfgWith = (mediaWake, extra = {}) => ({ harness: { config: { socialV2: { wake: { mediaWake, ...extra } } } } });
const PROB = (p) => cfgWith('probability', { mediaWakeProbability: p });

await test('链接卡片（p=1）：按图片媒体概率唤醒，原因是 media', async (h) => {
  await h.handleIncoming('group', '456', cardEvent(), h.cfg);
  assert.equal(wakeState(h).reason, 'media');
}, PROB(1));

await test('链接卡片（p=0）：不唤醒，也不落回普通消息概率（不双摇）', async (h) => {
  await h.handleIncoming('group', '456', cardEvent(), h.cfg);
  assert.equal(wakeState(h).scheduled, false);
}, { ...PROB(0), triggers: { probability: 1 } });

await test('正文链接（p=1）：同样按媒体概率唤醒', async (h) => {
  await h.handleIncoming('group', '456', urlTextEvent(), h.cfg);
  assert.equal(wakeState(h).reason, 'media');
}, PROB(1));

await test('纯文字（没有链接/图片）：媒体规则不误伤，p=1 也不醒', async (h) => {
  await h.handleIncoming('group', '456', plainTextEvent(), h.cfg);
  assert.equal(wakeState(h).scheduled, false);
}, PROB(1));

await test('链接卡片落库：text 里有标题+URL，links 字段可直接给模型', async (h) => {
  await h.handleIncoming('group', '456', cardEvent(), h.cfg);
  const msg = lastStored(h);
  assert.match(msg.text, /\[链接卡片\]/, '文本层必须让模型看到这是卡片');
  assert.match(msg.text, /一篇值得看的文章/, '标题不能丢');
  assert.match(msg.text, /https:\/\/example\.com\/news\?a=1&b=2/, 'URL 不能丢');
  assert.equal(msg.links.length, 1);
  assert.equal(msg.links[0].url, 'https://example.com/news?a=1&b=2');
  assert.equal(msg.hasLinks, true);
  assert.equal(msg.media.length, 0, '链接不是图片，不能混进 media（图片工具读不了网页）');
  assert.equal(msg.hasMedia, false);
});

await test('正文链接落库：去掉尾随中文标点，links.source=text', async (h) => {
  await h.handleIncoming('group', '456', urlTextEvent(), h.cfg);
  const msg = lastStored(h);
  assert.equal(msg.links.length, 1);
  assert.equal(msg.links[0].url, 'https://example.com/article?id=9');
  assert.equal(msg.links[0].source, 'text');
});

await test('动图：文本标 [动图]、media.animated=true、仍按媒体概率唤醒', async (h) => {
  await h.handleIncoming('group', '456', animatedEvent(), h.cfg);
  const msg = lastStored(h);
  assert.equal(msg.text, '[动图]');
  assert.equal(msg.media.length, 1);
  assert.equal(msg.media[0].animated, true);
  assert.equal(wakeState(h).reason, 'media');
}, PROB(1));

await test('静态表情图（sub_type=1 但非 gif/动画）：标 [表情]，不冒充动图', async (h) => {
  await h.handleIncoming('group', '456', staticStickerEvent(), h.cfg);
  const msg = lastStored(h);
  assert.equal(msg.text, '[表情]');
  assert.notEqual(msg.media[0].animated, true);
});

await test('媒体提示：图片给 qq_get_message_images，链接给 mcp__web-search-safe__web_fetch', async (h) => {
  const imageHint = h.mediaHintFor('group:456', '4001', [{ kind: 'image', file: 'a.jpg', url: 'https://example.invalid/a.jpg' }], []);
  assert.match(imageHint, /qq_get_message_images/);
  const linkHint = h.mediaHintFor('group:456', '4001', [], [{ kind: 'link', source: 'card', title: 'T', url: 'https://example.com/x' }]);
  assert.match(linkHint, /【链接】/);
  assert.match(linkHint, /mcp__web-search-safe__web_fetch/, '要告诉模型链接该用什么工具打开');
  assert.match(linkHint, /https:\/\/example\.com\/x/);
});

await test('media 唤醒提示词：覆盖动图只看到一帧 + 链接用 mcp__web-search-safe__web_fetch', async (h) => {
  const prompt = h.buildWakePromptV2('group:456', 'media');
  assert.match(prompt, /链接卡片/, '提示词要解释卡片是什么');
  assert.match(prompt, /mcp__web-search-safe__web_fetch/, '链接要能打开');
  assert.match(prompt, /只看到其中一帧/, '动图不能按"看完整段"描述');
});

if (failures > 0) {
  console.error(`\n${failures} 条链接/动图回归失败`);
  process.exit(1);
}
console.log('\nlink-media 回归全部通过');
