// 抖音分享链路自检：素材池 → 挑卡 → 到点投递 → 记录去重。
// 不碰真实插件目录（注入假路径），不发网络请求（deliverPrompt / sendCard 都是桩）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createDouyinMemory } from '../../../src/douyin-memory.js';
import { buildShareCardText, buildSharePrompt, createDouyinShareScheduler } from '../../../src/douyin-share-scheduler.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-share-'));
const stateDir = path.join(tmp, 'state');
const memoryDir = path.join(tmp, 'memory');
const reportsDir = path.join(memoryDir, 'reports', 'videos');
fs.mkdirSync(path.join(memoryDir, 'persona'), { recursive: true });
fs.mkdirSync(reportsDir, { recursive: true });

const now = Date.now();
const observations = [
  { videoId: '7001', url: 'https://www.douyin.com/video/7001', title: '猫在键盘上睡着了，主人完全没法工作', author: '橘猫日记', observedAt: now - 60_000 },
  { videoId: '7002', url: 'https://www.douyin.com/video/7002', title: '深夜食堂：一个人也要好好吃饭', author: '小厨娘', observedAt: now - 3_600_000 },
  { videoId: '7003', url: 'https://www.douyin.com/video/7003', title: '广告', author: '某商家', observedAt: now - 120_000 },
  { videoId: '7004', url: 'https://www.douyin.com/video/7004', title: '短', author: 'x', observedAt: now - 180_000 },
  { videoId: '7005', url: '', title: '没有链接的作品也要跳过不然发出去没法点', author: 'y', observedAt: now - 240_000 },
  // 重复的 videoId：只应出现一次。
  { videoId: '7001', url: 'https://www.douyin.com/video/7001', title: '猫在键盘上睡着了，主人完全没法工作', author: '橘猫日记', observedAt: now - 60_000 },
];
fs.writeFileSync(path.join(memoryDir, 'persona', 'state.json'), JSON.stringify({ version: 1, observations }, null, 2));
fs.writeFileSync(path.join(reportsDir, '2026-11-03.md'), '# 今日观看\n- 看了几只猫\n', 'utf8');

const fakePaths = {
  pluginDir: tmp,
  stateDir: path.join(tmp, 'plugin-state'),
  memoryDir,
  reportsDir,
  controlDir: path.join(tmp, 'control'),
  profileDir: path.join(tmp, 'profile'),
  locationFile: path.join(tmp, 'location.json'),
};

const memory = createDouyinMemory({ stateDir, resolvePluginPaths: () => fakePaths });

// ① 素材池：去重、过滤广告/过短/无链接
const pool = memory.sharePool();
assert.deepEqual(pool.map((c) => c.videoId).sort(), ['7001', '7002'],
  `素材池应只剩两条正常作品，实际 ${JSON.stringify(pool.map((c) => c.videoId))}`);

// ② 挑卡：slotIndex 轮转，不随机
const c0 = memory.pickShareCard({ slotIndex: 0 });
const c1 = memory.pickShareCard({ slotIndex: 1 });
const c2 = memory.pickShareCard({ slotIndex: 2 });
assert.equal(c0.videoId, '7001', 'slot 0 应挑最新那条');
assert.equal(c1.videoId, '7002', 'slot 1 应轮转到第二条');
assert.equal(c2.videoId, c0.videoId, 'slot 2 应回到第一条（池子只有两条）');
assert.ok(c0.url.startsWith('https://www.douyin.com/'), '挑出的卡必须带链接');
assert.match(c0.reason, /@橘猫日记/, 'reason 里应带作者');

// ③ 纯文本卡片
const cardText = buildShareCardText(c0);
assert.match(cardText, /^【抖音】/, '卡片文本应以【抖音】开头');
assert.ok(cardText.includes(c0.url), '卡片文本应包含链接');

// ④ 提示词：卡片已发 / 未发两种口径
const withCard = buildSharePrompt(c0, '09:00', { cardSent: true });
assert.match(withCard, /已经由系统发到群里/, 'cardSent 时应说明链接已发');
assert.match(withCard, /50~100 字/, '应限制短评字数');
assert.ok(!withCard.includes('链接照抄'), 'cardSent 时不该再让她贴链接');
const noCard = buildSharePrompt(c0, '09:00', { cardSent: false });
assert.match(noCard, /链接照抄素材里的那一条/, '没发卡片时应要求她照抄链接');
for (const need of ['不要输出 [SILENT]', '不聊政治']) {
  assert.ok(withCard.includes(need), `提示词应包含约束：${need}`);
}

// ⑤ 调度器：到点投两个群，投递成功才记 slot
const prompts = [];
const cards = [];
const scheduler = createDouyinShareScheduler({
  stateDir,
  log: () => {},
  deliverPrompt: async (key, text) => { prompts.push({ key, text }); },
  groups: ['111', '222'],
  memory,
  gapMs: 0,
  sendCard: async (key, card) => { cards.push({ key, title: card.title }); return true; },
  times: ['09:00', '15:00'],
});
const first = await scheduler.fire('09:00');
assert.equal(first.ok, true, '第一次分享应当成功');
assert.equal(first.sent, 2, '两个群都应发出');
assert.equal(cards.length, 2, '两个群都应先收到标题+链接');
assert.equal(prompts.length, 2, '两个群都应收到提示词');
assert.ok(prompts[0].text.includes(c0.title), '提示词里应带作品标题');
assert.match(cards[0].key, /^group:\d+$/, '会话 key 必须是 group:<群号>');

// ⑥ 同一个时间点不重复跑
const again = await scheduler.fire('09:00');
assert.equal(again.skipped, true, '同一 slot 第二次应跳过');
assert.equal(prompts.length, 2, '跳过时不应再投递');

// ⑦ 分享过的作品 6 天内不再进池
const poolAfter = memory.sharePool();
assert.deepEqual(poolAfter.map((c) => c.videoId), ['7002'], '刚分享的作品应从池里消失');

// ⑧ 池子空了要明确报「没有新鲜素材」，而不是发旧内容
await scheduler.fire('15:00');
const empty = await scheduler.fire('23:00');
assert.equal(empty.ok, false);
assert.equal(empty.why, '没有新鲜素材', '池子空时应返回明确原因');

// ⑨ 停用开关时直接跳过
const offScheduler = createDouyinShareScheduler({
  stateDir: path.join(tmp, 'state2'),
  log: () => {},
  deliverPrompt: async () => { throw new Error('不该被调用'); },
  groups: ['111'],
  memory,
  gapMs: 0,
  isEnabled: () => false,
});
const off = await offScheduler.fire('09:00');
assert.equal(off.skipped, true);
assert.equal(off.why, 'douyin-disabled');

// ⑩ 手动分享：不受 slot 去重限制，但仍然只发一条
// （前面 ⑧ 已经把池子掏空了，这里清掉分享历史当作「过了 6 天」）
fs.rmSync(path.join(stateDir, 'douyin-share-history.json'), { force: true });
const manualStateDir = path.join(tmp, 'state3');
const manualPrompts = [];
const manual = createDouyinShareScheduler({
  stateDir: manualStateDir,
  log: () => {},
  deliverPrompt: async (key, text) => { manualPrompts.push({ key, text }); },
  groups: ['111'],
  memory,
  gapMs: 0,
  sendCard: null,
  times: ['09:00'],
});
const m1 = await manual.fireNow();
assert.equal(m1.ok, true, '手动分享应成功');
assert.equal(manualPrompts.length, 1);
assert.match(manualPrompts[0].text, /链接照抄/, '没配卡片时应要求她贴链接');
const st = manual.status();
assert.equal(st.groups.length, 1);
assert.ok(Array.isArray(st.times) && st.times.length === 1, 'status 应回显时间点');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('test-douyin-share: PASS');
