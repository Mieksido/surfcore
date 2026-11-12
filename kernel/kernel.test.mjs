/**
 * 内核测试：衰减 / 媒体库 / 目的 / 注意力 / 预算 / 身份 / 审计 / 总装
 * 跑法：node kernel/kernel.test.mjs
 */
import { targetClarity, applyDailyDecay, decayDaysBetween, needsDailyDecay, touch, CLARITY_ORDER } from './memory/narrative/decay-card.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMediaStore } from './memory/media.js';
import { createPurpose } from './purpose/index.js';
import { localDayKey, minutesOfDay, inQuietHours } from './purpose/clock.js';
import { decideWake, batchReason, isSpamCommand, tierOf, fishDensity, REASON_PRIORITY } from './attention/index.js';
import { createAudit, createBudget, createIdentity } from './support/index.js';
import { createKernel } from './index.js';
import { createHashingEmbedder } from './memory/vector/embed.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

const DAY = 86400000;
const NOW = Date.parse('2026-11-09T12:00:00');

/* ── 衰减 ─────────────────────────────────────────────── */
console.log('## 衰减（16 条行为里的核心）');
{
  const fresh = { importance: 60, clarity: 'clear', from: { at: NOW } };
  ok(targetClarity(fresh, undefined, NOW) === 'vivid' || targetClarity(fresh, undefined, NOW) === 'clear', '刚记的：清楚');

  const old = { importance: 10, clarity: 'clear', from: { at: NOW - 200 * DAY } };
  ok(targetClarity(old, undefined, NOW) === 'forgotten', '很久且不重要：可以忘');

  const ownerVital = { importance: 90, to: { owner: true }, clarity: 'clear', from: { at: NOW - 300 * DAY } };
  ok(targetClarity(ownerVital, undefined, NOW) !== 'forgotten', '主人重要记忆：永不遗忘（保底 55）');

  const initial = { importance: 20, initial: true, clarity: 'clear', from: { at: NOW - 300 * DAY } };
  ok(targetClarity(initial, undefined, NOW) !== 'forgotten', '「最初」独立保护：不靠重要度');

  const card = { records: [old], stats: {}, lastDecayDay: null };
  applyDailyDecay(card, undefined, NOW);
  ok(card.records.length === 1 && old.clarity === 'fuzzy', '每日衰减：一次只降一档（清楚→有点模糊，不是一次消失）');
  applyDailyDecay(card, undefined, NOW + DAY);
  applyDailyDecay(card, undefined, NOW + 2 * DAY);
  ok(card.records.length === 0, '连续衰减到头：才交出来归档（这条不变量最重要）');

  // 每天最多降一档
  const oneStep = { importance: 5, clarity: 'vivid', from: { at: NOW - 200 * DAY } };
  const card2 = { records: [oneStep], stats: {}, lastDecayDay: null };
  applyDailyDecay(card2, undefined, NOW);
  ok(oneStep.clarity === 'clear', '每天最多降一档：vivid 只降到 clear，不是一次消失');

  // 复习：目标比当前高就升一档
  const reviewed = { importance: 70, clarity: 'fuzzy', from: { at: NOW }, lastSeenAt: NOW };
  const card3 = { records: [reviewed], stats: {}, lastDecayDay: null };
  applyDailyDecay(card3, undefined, NOW);
  ok(CLARITY_ORDER.indexOf(reviewed.clarity) < CLARITY_ORDER.indexOf('fuzzy'), '被重新提到：升一档');

  ok(decayDaysBetween('2026-10-01', NOW) >= 1 && decayDaysBetween('2026-10-01', NOW) <= 30, '补跑天数被夹在 1~30 天');
  ok(needsDailyDecay({ lastDecayDay: null }, undefined, Date.parse('2026-11-09T02:00:00')) === false, '凌晨 2 点不做日衰减（要等 dailyHour）');
  ok(needsDailyDecay({ lastDecayDay: null }, undefined, NOW) === true, '中午可以做日衰减');

  const t = touch({ recallCount: 2 }, NOW);
  ok(t.recallCount === 3 && t.lastSeenAt === NOW, '被提到：刷新复习次数与时间');
}

/* ── 媒体库 ───────────────────────────────────────────── */
console.log('\n## 媒体库');
{
  const store = createMediaStore({ now: () => NOW });
  const a = store.put({ kind: 'image', bytes: Buffer.from('猫的图'), caption: '一张猫图' });
  const b = store.put({ kind: 'image', bytes: Buffer.from('猫的图'), caption: '同一张' });
  ok(a.id === b.id, '内容指纹去重：同一份内容只存一次');
  ok(b.refCount === 2, '引用计数：第二次存入 +1');
  ok(store.size() === 1, '库里面只有一条');
  ok(store.release(a.id) === false, '删一次：还有别人在用，不真删');
  ok(store.release(a.id) === true && store.size() === 0, '删到 0：真删');
  const ref = store.put({ kind: 'audio', bytes: Buffer.from('语音'), caption: '一句晚安', transcript: '晚安呀' });
  const r = store.refFor(ref.id);
  ok(r.caption === '一句晚安' && typeof r.id === 'string', '记忆里该存的东西：编号 + 说明');
  ok(store.sweep() === 0, '没到保留期：不清理');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-media-'));
  const disk = createMediaStore({ dir, now: () => NOW });
  const img = disk.put({ kind: 'image', bytes: Buffer.from([1, 2, 3, 4]) });
  ok(disk.readBytes(img.id)?.length === 4, '落盘的媒体：能按编号读回字节（识图用）');
  ok(disk.readBytes(img.id, { maxBytes: 2 }) === null, '超过读取上限：不读（不把大图塞进模型）');
  ok(disk.readBytes('不存在') === null, '没有这条：null');
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ── 时钟 ─────────────────────────────────────────────── */
console.log('\n## 时钟（唯一日界）');
ok(/^\d{4}-\d{2}-\d{2}$/.test(localDayKey(NOW)), '日界格式正确');
ok(minutesOfDay('23:30') === 1410, '"23:30" → 1410 分钟');
ok(minutesOfDay('乱写', 99) === 99, '非法时间回退默认值');
ok(inQuietHours(new Date('2026-11-09T02:00:00'), '23:30', '08:30') === true, '跨午夜的安静时段：凌晨算安静');
ok(inQuietHours(new Date('2026-11-09T12:00:00'), '23:30', '08:30') === false, '中午不算安静');

/* ── 目的机制 ─────────────────────────────────────────── */
console.log('\n## 目的机制');
{
  const p = createPurpose({ now: () => NOW });
  ok(p.canFire({}).ok === false, '安静时段/冷却中：不让她说话');

  // 真实顺序：素材 → 目标假设 → 投递（不要让目标凭空存在）
  const goals = p.formGoals([{ owner: 'self', text: '今天看到一只猫', need: 'share' }]);
  ok(goals.length >= 1, '从素材形成目标假设');
  const g = goals[0];

  const fired = p.fire({ goal: g, text: '我想跟你说，今天看到一只猫' });
  ok(fired && fired.intent.kind === 'say', '投递：产出一条"说"的意图');
  ok(p.summary().countToday === 1, '投递即占次数（钱已经花了）');

  const before = g.confidence;
  p.applyOutcome({ goalId: g.id, replied: true });
  ok(g.status === 'confirmed' && g.confidence > before, '闭环：主人回了 → 置信度上升');
  p.applyOutcome({ goalId: g.id, replied: false });
  ok(g.confidence < 0.95, '闭环：没回 → 置信度下降');

  p.formGoals([{ owner: 'self', text: '今天看到一只猫', need: 'share' }]);
  ok(p.summary().observations === 1, '同一件事再次出现：观察账本 +1，不重复造目标');
}

/* ── 注意力 ───────────────────────────────────────────── */
console.log('\n## 注意力漏斗');
ok(decideWake({ kind: 'private', text: '在吗' }).wake === true, '私聊：直接醒');
ok(decideWake({ kind: 'group', text: '今天天气不错' }).wake === false, '群里没点名：不醒（省 token）');
ok(decideWake({ kind: 'group', text: '@她 在吗', mentioned: true }).wake === true, '被 @：醒');
ok(decideWake({ kind: 'group', text: '你觉得呢？', question: true }).wake === true, '被提问：醒');
ok(decideWake({ kind: 'group', text: '' }).wake === false, '空消息：不醒');
ok(isSpamCommand('#sl') === true && isSpamCommand('#alpha#话题') === false, '刷屏短指令识别，话题标签不误伤');
ok(tierOf({ memberCount: 500 }) === 'large' && tierOf({ memberCount: 20 }) === 'small', '群分层：大群/小群');
ok(fishDensity({ fishAccounts: 4, totalSenders: 6 }).blocked === true, '鱼群密度高：闭嘴');
{
  const b = batchReason([{ reason: 'keyword', priority: 60, at: NOW - 1000 }, { reason: 'atMention', priority: 90, at: NOW - 500 }], { windowMs: 8000, now: NOW });
  ok(b.reason === 'atMention', '合批：取最高优先级的理由');
  ok(REASON_PRIORITY.private > REASON_PRIORITY.anyMessage, '优先级表：私聊高于任意消息');
}

/* ── 支撑件 ───────────────────────────────────────────── */
console.log('\n## 审计 / 预算 / 身份');
{
  const a = createAudit({ now: () => NOW });
  a.record({ kind: 'x', detail: 1 });
  ok(a.size() === 1 && a.of('x').length === 1, '审计：能记能按类取');
  const b = createBudget({ limits: { primary: 100 }, now: () => NOW });
  b.commit('primary', 60);
  ok(b.canSpend('primary', 30).ok === true, '预算：没超就放行');
  ok(b.canSpend('primary', 50).ok === false, '预算：超了就拒绝（不偷偷放行）');
  ok(b.snapshot().total === 60, '预算：总额自动汇总（类别名由调用方给，内核不认识渠道）');
  const id = createIdentity({ persona: { name: '小鲸鱼', core: '我是小鲸鱼' }, admin: '10001', adminName: '主人' });
  ok(id.describe({ maxChars: 50 }).length <= 50, '身份：公开版受字数限制');
  ok(id.isOwner('10001') === true && id.isOwner('10002') === false, '身份：认得主人');
  ok(id.aliasFor('10001', { isOwner: true }) === '主人', '身份：主人有专门称呼');
  id.rememberAlias('20002', '阿零');
  ok(id.aliasFor('20002') === '阿零', '身份：别人的称呼各记各的');
}

/* ── 总装：一次真实反应 ───────────────────────────────── */
console.log('\n## 总装：内核处理一条消息');
{
  const kernel = createKernel({
    persona: { name: '小鲸鱼', core: '我是小鲸鱼' },
    admin: '10001',
    now: () => NOW,
    budgetLimits: { total: 8 },
  });

  const viewer = { channelId: 'g:1', kind: 'group', isOwner: false };
  const r1 = kernel.handle({
    from: { adapter: 'surfcore@terminal', channel: 'g:1', kind: 'group', actor: '20002', at: NOW },
    text: '今天群里好热闹',
    source: 'user',
  }, viewer);
  ok(r1.wake === false, '群里闲聊：入库但不用醒');
  ok(kernel.snapshot().records === 1, '入库永远发生（不醒也记下来）');

  const r2 = kernel.handle({
    from: { adapter: 'surfcore@terminal', channel: 'g:1', kind: 'group', actor: '20002', at: NOW },
    text: '@她 你在干嘛',
    mentioned: true,
    source: 'user',
  }, viewer);
  ok(r2.wake === true && r2.reason === 'atMention', '被 @：醒了');
  ok(r2.memoryBlock && typeof r2.memoryBlock.text === 'string', '醒了就读记忆，拿到统一记忆块');
  ok(Array.isArray(r2.memoryBlock.refs), '记忆块带引用清单');

  // 换读取方式：同一个内核，改用向量读取
  kernel.setMemoryMode('vector');
  const r3 = kernel.handle({
    from: { adapter: 'surfcore@terminal', channel: 'g:1', kind: 'group', actor: '20002', at: NOW },
    text: '@她 好热闹',
    mentioned: true,
    source: 'user',
  }, viewer);
  ok(r3.memoryBlock.mode === 'vector', '换读取方式：只影响读，不改入库');
  ok(kernel.snapshot().records === 3, '换方式后：记录还在继续增加');

  const t = kernel.tick();
  ok(typeof t.decayed === 'boolean', '心跳：能跑衰减');
  ok(kernel.snapshot().audit > 0, '审计：处理过程留痕');
}

console.log('\n## 总装：模型用量进账本（token 是事实，钱按价目表）');
{
  const kernel = createKernel({
    persona: { name: '小鲸鱼', core: '我是小鲸鱼' },
    admin: '10001',
    now: () => NOW,
    modelName: 'deepseek-flash',
    model: {
      complete: async () => ({ text: '在呀。', usage: { cacheMiss: 100, cacheHit: 50, output: 10 } }),
    },
  });

  const out = await kernel.respond({
    from: { adapter: 'surfcore@terminal', channel: 'p:1', kind: 'private', actor: '10001', at: NOW },
    text: '在吗',
    source: 'user',
  }, { channelId: 'p:1', kind: 'private', isOwner: true });

  ok(out.intents.some((i) => i.kind === 'say'), '模型说话：照常出意图');
  const sum = kernel.ledger.summary();
  ok(sum.tokens === 160, '账本记下真实用量 160（100 未命中 + 50 命中 + 10 输出）');
  ok(sum.samples === 1, '一次 respond：一条采样');
  ok(sum.cost > 0, '按价目表折成钱（不是 0）');
  ok(sum.unpriced === 0, '认识的模型：不算"没算钱"');
  ok(kernel.snapshot().ledger.tokens === 160, '快照里能看到账本');
}

console.log('\n## 总装：识图（图片进模型消息，不是只给一句话）');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-vision-'));
  const seen = [];
  const kernel = createKernel({
    stateDir: dir,
    persona: { name: '小鲸鱼', core: '我是小鲸鱼' },
    admin: '10001',
    now: () => NOW,
    model: {
      complete: async ({ messages }) => { seen.push(messages); return { text: '看到了。' }; },
    },
  });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const out = await kernel.respond({
    from: { adapter: 'one@alpha', channel: 'p:1', kind: 'private', actor: '10001', at: NOW },
    text: '看这张',
    media: [{ kind: 'image', bytes: png, caption: '一张图' }],
    source: 'user',
  }, { channelId: 'p:1', kind: 'private', isOwner: true });

  ok(out.intents.some((i) => i.kind === 'say'), '识图：照常产出意图');
  ok(Array.isArray(seen[0][1].content), '模型收到的 user 是内容数组');
  const img = seen[0][1].content.find((p) => p.type === 'image_url');
  ok(Boolean(img) && img.image_url.url.startsWith('data:image/png;base64,'), '图片以 data URL 进了模型消息');
  ok(!kernel.audit.list().some((a) => a.kind === 'vision.skipped'), '正常图片：没有"跳过"审计');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n## 总装：真实嵌入（入库与检索用同一个向量）');
{
  const embedder = createHashingEmbedder({ dimensions: 32 });
  const kernel = createKernel({
    mode: 'vector',
    persona: { name: '小鲸鱼', core: '我是小鲸鱼' },
    admin: '10001',
    now: () => NOW,
    embedder,
    model: { complete: async () => ({ text: '在呀。' }) },
  });
  const out = await kernel.respond({
    from: { adapter: 'one@alpha', channel: 'p:1', kind: 'private', actor: '10001', at: NOW },
    text: '今天看到一只猫',
    source: 'user',
  }, { channelId: 'p:1', kind: 'private', isOwner: true });
  ok(out.intents.some((i) => i.kind === 'say'), '嵌入器在：照常说话');
  const vec = kernel.memory.vector();
  ok(vec.length === 1 && vec[0].vector.values?.length === 32, '入库：向量线存了 32 维数值向量');
  ok(!kernel.audit.list().some((a) => a.kind === 'embedding.failed'), '嵌入成功：没有失败审计');

  const bad = createKernel({
    persona: { name: '小鲸鱼', core: '我是小鲸鱼' },
    admin: '10001',
    now: () => NOW,
    embedder: { embed: async () => ({ ok: false, error: { code: 'embed.network', hint: '连不上' } }) },
    model: { complete: async () => ({ text: '在呀。' }) },
  });
  const out2 = await bad.respond({
    from: { adapter: 'one@alpha', channel: 'p:1', kind: 'private', actor: '10001', at: NOW },
    text: '在吗',
    source: 'user',
  }, { channelId: 'p:1', kind: 'private', isOwner: true });
  ok(out2.intents.some((i) => i.kind === 'say'), '嵌入失败：不挡说话');
  ok(bad.audit.list().some((a) => a.kind === 'embedding.failed' && a.code === 'embed.network'), '嵌入失败：审计里看得见');
  const again = await bad.respond({
    from: { adapter: 'one@alpha', channel: 'p:1', kind: 'private', actor: '10001', at: NOW },
    text: '还在吗',
    source: 'user',
  }, { channelId: 'p:1', kind: 'private', isOwner: true });
  ok(again.intents.length > 0, '同一错误再来一次：仍然能说话');
  ok(bad.audit.list().filter((a) => a.kind === 'embedding.failed').length === 1, '同一种嵌入错误只记一次（不刷审计）');
}

console.log('\n## 总装：对话摘要（窗口挤出旧轮次 → 摘要 → 下次带摘要）');
{
  const calls = [];
  const kernel = createKernel({
    persona: { name: '小鲸鱼', core: '我是小鲸鱼' },
    admin: '10001',
    now: () => NOW,
    turnGuard: { maxPerWindow: 1000 },
    conversation: { maxTurns: 3, maxChars: 600 },
    summary: { minTurns: 2, minChars: 9999, maxChars: 200 },
    modelName: 'deepseek-flash',
    model: {
      complete: async ({ messages }) => {
        const system = String(messages?.[0]?.content ?? '');
        calls.push(system);
        if (system.includes('摘要')) return { text: '主人今天在聊猫和天气。', usage: { cacheMiss: 10 } };
        return { text: '嗯。' };
      },
    },
  });

  for (let i = 0; i < 6; i += 1) {
    await kernel.respond({
      from: { adapter: 'one@alpha', channel: 'p:1', kind: 'private', actor: '10001', at: NOW + i * 1000 },
      text: `第${i}句：今天聊猫和天气`,
      source: 'user',
    }, { channelId: 'p:1', kind: 'private', isOwner: true });
  }

  ok(calls.some((s) => s.includes('摘要')), '窗口溢出后真的调了摘要');
  ok(Boolean(kernel.conversation.summaryOf('p:1')), '摘要写进对话状态');
  ok(kernel.conversation.render('p:1').includes('【更早的对话摘要】'), '下一次渲染带摘要块');
  ok(kernel.audit.list().some((a) => a.kind === 'summary.updated'), '摘要成功进审计');
  ok(kernel.ledger.summary().samples >= 1, '摘要用量也进账本（不白花钱）');

  const bad = createKernel({
    persona: { name: '小鲸鱼', core: '我是小鲸鱼' },
    admin: '10001',
    now: () => NOW,
    turnGuard: { maxPerWindow: 1000 },
    conversation: { maxTurns: 2, maxChars: 600 },
    summary: { minTurns: 2, minChars: 9999, maxChars: 200 },
    model: {
      complete: async ({ messages }) => {
        if (String(messages?.[0]?.content ?? '').includes('摘要')) return { error: { code: 'summary.model', message: '模型挂了' } };
        return { text: '嗯。' };
      },
    },
  });
  for (let i = 0; i < 5; i += 1) {
    await bad.respond({
      from: { adapter: 'one@alpha', channel: 'p:2', kind: 'private', actor: '10001', at: NOW + i * 1000 },
      text: `第${i}句`,
      source: 'user',
    }, { channelId: 'p:2', kind: 'private', isOwner: true });
  }
  ok(bad.audit.list().some((a) => a.kind === 'summary.failed'), '摘要失败：审计可见');
  ok(bad.conversation.pendingOf('p:2').length > 0, '摘要失败：原文留在 pending（不丢）');
  ok(bad.conversation.render('p:2').includes('第0句'), '摘要失败：原文仍能渲染');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
