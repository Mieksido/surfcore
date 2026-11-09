// 目的机制纯逻辑：配置/排程/素材/候选/提示词/回执/状态迁移。
// 只测 src/purpose-engine.js，不连真 QQ / DSH，也不读写生产 state。
import assert from 'node:assert/strict';
import {
  DEFAULT_DRIVES, DEFAULT_PURPOSE_CONFIG, addPendingPurpose, analyzePersona, appraiseMaterial,
  applyPurposeOutcome, buildPurposePrompt, collectMaterials, createPurposeState, deriveDrives,
  ensurePurposeDay, ensurePurposeSchedule, evaluatePurposeTick, extractTopic, formGoalHypotheses,
  formatMaterialLine, inQuietHours, isDuplicateText, markPurposeDelivered, markPurposeSkip,
  minePurposeSeeds, needAffinity, normalizePurposeConfig, normalizePurposeState, parseClock,
  parsePurposeMemo, planNextFire, quietEndAfter, resolvePendingPurpose, selectPurpose,
  summarizePurposeState, textSimilarity,
} from '../src/purpose-engine.js';

let pass = 0;
let fail = 0;
function test(name, run) {
  try { run(); pass += 1; console.log('PASS', name); }
  catch (error) { fail += 1; console.error('FAIL', name, error.message); }
}
const local = (h, m = 0, day = 24) => new Date(2026, 9, day, h, m, 0, 0).getTime(); // 2026-10-24 本地
const owner = '3287064288';

test('配置归一化：默认值 / owner 回退 / 区间收敛 / 安静时段格式', () => {
  const c = normalizePurposeConfig({}, { ownerQQ: owner });
  assert.equal(c.enabled, true);
  assert.equal(c.ownerUin, owner);
  assert.equal(c.gapMinMs, 150 * 60000);
  assert.equal(c.gapMaxMs, 300 * 60000);
  assert.equal(c.dailyMax, 4);
  assert.equal(c.quietStart, '23:30');
  assert.equal(c.quietEnd, '08:30');
  assert.equal(c.idleThresholdMs, 30 * 60000);

  const bad = normalizePurposeConfig({ gapMinMs: -1, gapMaxMs: 1, dailyMax: 999, quietStart: '25:99', quietEnd: '7:5' }, {});
  assert.equal(bad.gapMinMs, 5 * 60000);
  assert.equal(bad.gapMaxMs, bad.gapMinMs);
  assert.equal(bad.dailyMax, 24);
  assert.equal(bad.quietStart, '23:30');
  assert.equal(bad.quietEnd, '08:30');
  assert.equal(normalizePurposeConfig({ enabled: false }).enabled, false);
});

test('安静时段：跨午夜 / 边界 / 下一个结束时刻', () => {
  assert.equal(parseClock('8:05').text, '08:05');
  assert.equal(parseClock('bad', '7:00').text, '07:00');
  const c = normalizePurposeConfig({});
  assert.equal(inQuietHours(local(23, 45), c), true);
  assert.equal(inQuietHours(local(2, 0), c), true);
  assert.equal(inQuietHours(local(8, 29), c), true);
  assert.equal(inQuietHours(local(8, 30), c), false);
  assert.equal(inQuietHours(local(12, 0), c), false);
  const end = quietEndAfter(local(23, 45), c);
  const d = new Date(end);
  assert.equal(d.getHours(), 8);
  assert.equal(d.getMinutes(), 30);
  assert.ok(end > local(23, 45));
  // 相同起止 = 不设安静时段
  const none = normalizePurposeConfig({ quietStart: '08:00', quietEnd: '08:00' });
  assert.equal(inQuietHours(local(3, 0), none), false);
});

test('排程：按 gap 抖动 / 停机久了只补一枪 / 落在安静时段推到早上', () => {
  const c = normalizePurposeConfig({});
  const mid = planNextFire({ now: local(10, 0), config: c, lastRunAt: local(8, 0), random: () => 0.5 });
  assert.equal(mid, local(8, 0) + 225 * 60000);
  const overdue = planNextFire({ now: local(10, 0), config: c, lastRunAt: local(10, 0) - 24 * 3600000, random: () => 0 });
  assert.ok(overdue >= local(10, 0) + 60000);
  assert.ok(overdue <= local(10, 5));
  const night = planNextFire({ now: local(23, 40), config: c, lastRunAt: local(23, 0), random: () => 0 });
  assert.ok(night >= quietEndAfter(local(23, 40), c));
  const daily = planNextFire({ now: local(14, 0), config: c, lastRunAt: local(13, 0), countToday: 4, random: () => 0 });
  assert.ok(daily > local(14, 0) + 16 * 3600000);
});

test('tick：due / 安静 / 每日上限 / 主人正在聊 / 忙 / 模式 / 额度 / 好友 / 关闭', () => {
  const c = normalizePurposeConfig({});
  const now = local(14, 0);
  const base = () => {
    const s = createPurposeState(now);
    s.nextFireAt = now - 1000;
    return s;
  };
  const env = (patch = {}) => ({
    enabled: true, modeOk: true, dshReady: true, paused: false, ownerAllowed: true,
    busy: false, ownerIdleMs: 60 * 60000, friendOk: true, budgetBlocked: false, ...patch,
  });
  assert.equal(evaluatePurposeTick({ now, config: c, state: base(), env: env() }).action, 'run');
  assert.equal(evaluatePurposeTick({ now: local(3, 0), config: c, state: base(), env: env() }).reason, 'quiet');
  assert.equal(evaluatePurposeTick({ now, config: c, state: base(), env: env({ enabled: false }) }).reason, 'disabled');
  assert.equal(evaluatePurposeTick({ now, config: c, state: base(), env: env({ modeOk: false }) }).reason, 'mode');
  assert.equal(evaluatePurposeTick({ now, config: c, state: base(), env: env({ dshReady: false }) }).reason, 'dsh');
  assert.equal(evaluatePurposeTick({ now, config: c, state: base(), env: env({ paused: true }) }).reason, 'paused');
  assert.equal(evaluatePurposeTick({ now, config: c, state: base(), env: env({ busy: true }) }).reason, 'busy');
  assert.equal(evaluatePurposeTick({ now, config: c, state: base(), env: env({ ownerIdleMs: 5 * 60000 }) }).reason, 'owner-active');
  assert.equal(evaluatePurposeTick({ now, config: c, state: base(), env: env({ friendOk: false }) }).reason, 'not-friend');
  assert.equal(evaluatePurposeTick({ now, config: c, state: base(), env: env({ budgetBlocked: true }) }).reason, 'budget');
  const full = base();
  full.countToday = 4;
  assert.equal(evaluatePurposeTick({ now, config: c, state: full, env: env() }).reason, 'daily-max');
  const future = base();
  future.nextFireAt = now + 3600000;
  assert.equal(evaluatePurposeTick({ now, config: c, state: future, env: env() }).reason, 'waiting');
});

test('素材：主人私聊优先、QQ 号脱敏、拍一拍跳过、群/ B站/记忆/心里话都进来', () => {
  const now = local(14, 0);
  const c = normalizePurposeConfig({ materialWindowHours: 72, biliWindowDays: 7 });
  const old = now - 100 * 3600000;
  const conversations = [
    {
      key: `private:${owner}`,
      recentMessages: [
        { text: '明天面试有点紧张', isOwner: true, time: now - 2 * 3600000 },
        { text: '[拍一拍] xxx 戳了戳 你', isOwner: true, time: now - 3 * 3600000 },
        { text: '加我 123456789 聊', isOwner: true, time: now - 4 * 3600000 },
        { text: '早早', isSelf: true, time: now - 5 * 3600000 },
        { text: '很久以前', isOwner: true, time: old },
      ],
      activeTopics: [{ text: '周末去哪玩', lastMentionAt: now - 3600000 }],
      pendingThoughts: [{ text: '想问主人周末有没有空', motivation: 'curiosity', createdAt: now - 1800000 }],
    },
    {
      key: 'group:456',
      recentMessages: [
        { text: '小肥鱼你看过那个养鱼游戏吗', sender: '群友A', time: now - 3600000 },
        { text: '回头我发你', isSelf: true, time: now - 3500000 },
        { text: '无关紧要的一句', sender: '群友B', time: now - 3400000 },
      ],
    },
  ];
  const biliEntries = [
    { id: 'v1', type: 'video', title: '养鱼游戏实况', text: '好想玩这个', bvid: 'BV1xx', score: 14, favorite: true, at: new Date(now - 86400000).toISOString() },
    { id: 'd1', type: 'dynamic', text: '今天发了一条动态', at: new Date(now - 2 * 86400000).toISOString() },
    { id: 'v-old', type: 'video', title: '太老了', text: '旧视频', at: new Date(now - 30 * 86400000).toISOString() },
  ];
  const memoryRecords = [
    { id: 'm1', title: '和主人', text: '第一次一起看番', importance: 70, emotional: 8, pinned: true, lastSeenAt: now - 86400000 },
    { id: 'm2', text: '不重要的小事', importance: 5, lastSeenAt: now - 86400000 },
    { id: 'm3', text: '很久以前的重要事', importance: 80, lastSeenAt: now - 60 * 86400000 },
  ];
  const packet = collectMaterials({ now, config: c, ownerUin: owner, roleName: '小肥鱼', conversations, biliEntries, memoryRecords });
  assert.equal(packet.stats.qq >= 4, true);
  assert.equal(packet.stats.bili, 2);
  assert.equal(packet.stats.memory, 1);
  assert.equal(packet.stats.thought, 2);
  assert.equal(packet.items[0].kind, 'owner');
  assert.equal(packet.items.some((m) => m.text.includes('[拍一拍]')), false);
  assert.equal(packet.items.some((m) => m.text.includes('123456789')), false);
  assert.ok(packet.items.some((m) => m.text.includes('[号码]')));
  assert.equal(packet.items.some((m) => m.text === '太老了'), false);
  assert.equal(packet.items.some((m) => m.text === '很久以前'), false);
  assert.ok(packet.items.some((m) => m.kind === 'thought' && m.text.includes('周末')));
});

test('目的候选：未答的问题 / 已答不再提 / 计划关心 / B站想玩→索取 / 收藏→分享 / 心里惦记', () => {
  const now = local(14, 0);
  const c = normalizePurposeConfig({});
  const materials = [
    { id: 'o1', source: 'qq', kind: 'owner', at: now - 3600000, text: '明天面试有点紧张' },
    { id: 'o2', source: 'qq', kind: 'owner', at: now - 7200000, text: '你昨天睡得好吗' },
    { id: 's1', source: 'qq', kind: 'self', at: now - 7100000, meta: { key: `private:${owner}` }, text: '睡得好呀' },
    { id: 'v1', source: 'bili', kind: 'video', at: now - 86400000, title: '养鱼游戏', text: '好想玩', meta: { favorite: true, score: 14 } },
    { id: 'v2', source: 'bili', kind: 'video', at: now - 2 * 86400000, title: '普通视频', text: '一般般', meta: { score: 0 } },
    { id: 't1', source: 'thought', kind: 'thought', at: now - 600000, text: '想问主人周末有没有空', meta: { motivation: 'curiosity' } },
    { id: 'm1', source: 'memory', kind: 'memory', at: now - 86400000, text: '第一次一起看番' },
  ];
  const seeds = minePurposeSeeds({ materials, now, roleName: '小肥鱼', config: c });
  assert.ok(seeds.some((s) => s.kind === 'care' && s.text.includes('面试')));
  assert.equal(seeds.some((s) => s.text.includes('睡得好吗')), false);
  assert.ok(seeds.some((s) => s.kind === 'ask' && s.text.includes('养鱼游戏')));
  assert.ok(seeds.some((s) => s.kind === 'share' && s.text.includes('普通视频')));
  assert.ok(seeds.some((s) => s.kind === 'curiosity' && s.text.includes('周末')));
  assert.ok(seeds.some((s) => s.kind === 'share' && s.text.includes('第一次一起看番')));
  // 一条素材都没有时不硬编目的
  assert.deepEqual(minePurposeSeeds({ materials: [], now, config: c }), []);
});

test('选目的：权重/去重（planned / sourceId）/ 优先惦记的事', () => {
  const now = local(14, 0);
  const c = normalizePurposeConfig({ maxCandidates: 6 });
  const seeds = [
    { id: 'a', kind: 'share', text: '想跟主人说说养鱼游戏', sourceId: 'bili:1', weight: 1.2 },
    { id: 'b', kind: 'care', text: '想知道主人面试后来怎么样', sourceId: 'qq:1', weight: 1.1 },
  ];
  const picked = selectPurpose({ seeds, pending: [], history: [], config: c, random: () => 0.1 });
  assert.ok(picked.purpose);
  assert.equal(selectPurpose({ seeds, pending: [], history: [], config: c, random: () => 0.99 }).candidates.length, 2);

  const history = [{ at: now, outcome: 'sent', planned: '想跟主人说说养鱼游戏', sourceId: 'bili:1', purpose: '聊聊养鱼', text: '主人，那个养鱼游戏…' }];
  const after = selectPurpose({ seeds, pending: [], history, config: c, random: () => 0.1 });
  assert.equal(after.purpose.sourceId, 'qq:1');

  const pending = [{ text: '想问主人周末有没有空', kind: 'curiosity', id: 'p1' }];
  const fromPending = selectPurpose({ seeds, pending, history: [], config: c, random: () => 0.1 });
  assert.equal(fromPending.fromPending, true);
  assert.equal(fromPending.purpose.text, '想问主人周末有没有空');

  const allDup = selectPurpose({ seeds: [seeds[0]], pending: [], history, config: c, random: () => 0.1 });
  assert.equal(allDup.purpose, null);
});

test('提示词：素材/候选/发送工具/备忘格式/隐私与索取边界', () => {
  const now = local(14, 0);
  const c = normalizePurposeConfig({});
  const materials = [
    { source: 'qq', kind: 'owner', at: now - 3600000, text: '明天面试有点紧张', who: '主人' },
    { source: 'bili', kind: 'video', at: now - 86400000, title: '养鱼游戏', text: '好想玩' },
  ];
  const candidates = [
    { kind: 'care', text: '想知道主人面试后来怎么样' },
    { kind: 'ask', text: '想跟主人说你想玩养鱼游戏' },
  ];
  const prompt = buildPurposePrompt({
    now, config: c, mode: 'reserved2', ownerUin: owner, ownerName: '主人', token: 'tok-123',
    contextBlocks: ['【当前角色】小咪'], materials, candidates,
    selected: candidates[0], pending: [{ text: '周末想出去玩', kind: 'share' }], history: [], stats: {},
  });
  assert.ok(prompt.includes('【主动找对方 · 目的回合】'));
  assert.ok(prompt.includes('明天面试有点紧张'));
  assert.ok(prompt.includes('养鱼游戏'));
  assert.ok(prompt.includes('想知道主人面试后来怎么样'));
  assert.ok(prompt.includes('qq_send_private_message'));
  assert.ok(prompt.includes('tok-123'));
  assert.ok(prompt.includes('【目的】'));
  assert.ok(prompt.includes('【待续】'));
  assert.ok(prompt.includes('不要要钱'));
  assert.ok(prompt.includes('群友 QQ 号'));
  assert.ok(prompt.includes('周末想出去玩'));
  // chat 模式不应该教她调发送工具
  const chatPrompt = buildPurposePrompt({ now, config: c, mode: 'chat', ownerUin: owner, materials, candidates, selected: candidates[0] });
  assert.equal(chatPrompt.includes('qq_send_private_message'), false);
  // 超长时截断，但保留尾部指令
  const long = buildPurposePrompt({
    now, config: normalizePurposeConfig({ promptMaxChars: 4000 }), mode: 'reserved2', ownerUin: owner, token: 't',
    materials: Array.from({ length: 80 }, (_, i) => ({ source: 'qq', kind: 'member', at: now - i * 60000, text: `第${i}条素材，` + '很长的内容'.repeat(20) })),
    candidates: [{ kind: 'share', text: '随便说说' }], selected: { kind: 'share', text: '随便说说' },
  });
  assert.ok(long.length <= 4000);
  assert.ok(long.includes('【目的】'));
});

test('回执：完整/待续/跳过/无备忘/类型映射', () => {
  const memo = parsePurposeMemo('说了一堆\n【目的】想问问面试结果\n【类型】关心\n【状态】待续\n【待续】面试完再问一次');
  assert.equal(memo.purpose, '想问问面试结果');
  assert.equal(memo.kind, 'care');
  assert.equal(memo.status, '待续');
  assert.equal(memo.followUp, '面试完再问一次');
  assert.equal(parsePurposeMemo('【目的】无\n【状态】跳过').status, '跳过');
  assert.equal(parsePurposeMemo('【目的】分享一个小发现【类型】分享【状态】完成').kind, 'share');
  assert.equal(parsePurposeMemo('没什么特别的'), null);
  assert.equal(parsePurposeMemo(''), null);
});

test('状态迁移：sent 清 attempts / failed 重试 / silent 不重试 / 待续进 pending', () => {
  const c = normalizePurposeConfig({});
  const now = local(14, 0);
  const planned = { kind: 'care', text: '想知道面试结果', sourceId: 'qq:1' };
  const s = createPurposeState(now);
  s.nextFireAt = now - 1000;
  markPurposeDelivered(s, { now, planned });
  assert.equal(s.countToday, 1);
  assert.equal(s.attempts, 1);
  applyPurposeOutcome(s, { now, config: c, outcome: 'sent', text: '主人，面试怎么样啦', memo: { purpose: '面试结果', kind: 'care', status: '待续', followUp: '面试完再问' }, planned });
  assert.equal(s.lastOutcome, 'sent');
  assert.equal(s.attempts, 0);
  assert.equal(s.lastSentAt, now);
  assert.ok(s.nextFireAt > now);
  assert.equal(s.pending.length, 1);
  assert.equal(s.pending[0].text, '面试完再问');
  assert.equal(s.history.at(-1).outcome, 'sent');
  assert.equal(s.history.at(-1).sourceId, 'qq:1');

  const f = createPurposeState(now);
  f.attempts = 1;
  applyPurposeOutcome(f, { now, config: c, outcome: 'failed', planned });
  assert.equal(f.nextFireAt, now + c.retryMs);
  assert.equal(f.attempts, 1);
  f.attempts = c.maxAttempts;
  applyPurposeOutcome(f, { now, config: c, outcome: 'failed', planned });
  assert.ok(f.nextFireAt > now + c.retryMs);

  const silent = createPurposeState(now);
  silent.attempts = 2;
  applyPurposeOutcome(silent, { now, config: c, outcome: 'silent', planned });
  assert.equal(silent.attempts, 0);
  assert.equal(silent.lastOutcome, 'silent');
});

test('惦记的事：新增去重 / 解析完成 / 过期清理', () => {
  const c = normalizePurposeConfig({ pendingTtlDays: 1 });
  const now = local(14, 0);
  const s = createPurposeState(now);
  const a = addPendingPurpose(s, { text: '想问主人周末有没有空', kind: 'curiosity', now, config: c });
  const b = addPendingPurpose(s, { text: '想问主人周末有没有空呀', kind: 'curiosity', now, config: c });
  assert.equal(a.id, b.id);
  assert.equal(s.pending.length, 1);
  assert.equal(b.hits, 1);
  const removed = resolvePendingPurpose(s, '周末有没有空');
  assert.ok(removed);
  assert.equal(s.pending.length, 0);
  const s2 = createPurposeState(now);
  addPendingPurpose(s2, { text: '过期的事', now: now - 2 * 86400000, config: c });
  s2.pending[0].expiresAt = now - 1000;
  applyPurposeOutcome(s2, { now, config: c, outcome: 'sent', text: 'x' });
  assert.equal(s2.pending.length, 0);
});

test('坏状态/摘要/相似度/素材行格式', () => {
  const s = normalizePurposeState({ day: 'x', countToday: -5, pending: [null, { text: '' }, { text: '有效' }], history: [{ at: 0 }, { at: 123, purpose: 'p' }] });
  assert.equal(s.countToday, 0);
  assert.equal(s.pending.length, 1);
  assert.equal(s.history.length, 1);
  const now = local(14, 0);
  const summary = summarizePurposeState(s, { config: normalizePurposeConfig({}), now });
  assert.equal(summary.countToday, 0);
  assert.ok(Array.isArray(summary.history));
  assert.ok(textSimilarity('明天面试结果', '明天面试结果') === 1);
  assert.ok(textSimilarity('明天面试结果', '完全无关的另一句') < 0.2);
  assert.equal(isDuplicateText('明天面试结果', [{ planned: '明天面试结果' }]), true);
  const line = formatMaterialLine({ source: 'bili', kind: 'video', at: now - 3600000, title: '标题', text: '正文', quote: '评论' }, now);
  assert.ok(line.includes('B站·视频'));
  assert.ok(line.includes('《标题》'));
  assert.ok(line.includes('评论'));
});

test('初始排程：没有 nextFireAt 时排到 initialDelay；安静时段自动后移', () => {
  const c = normalizePurposeConfig({});
  const s = createPurposeState(local(10, 0));
  ensurePurposeSchedule(s, { now: local(10, 0), config: c, random: () => 0 });
  assert.equal(s.nextFireAt, local(10, 0) + c.initialDelayMinMs);
  const night = createPurposeState(local(23, 50));
  ensurePurposeSchedule(night, { now: local(23, 50), config: c, random: () => 0 });
  assert.ok(night.nextFireAt >= quietEndAfter(local(23, 50), c));
  const day = createPurposeState(local(10, 0));
  day.countToday = 4;
  ensurePurposeDay(day, local(10, 0));
  assert.ok(markPurposeSkip(day, { now: local(10, 0), reason: 'x', nextFireAt: 123 }).nextFireAt === 123);
});

test('目标假设：群友的目标不冒充我的 / 单次视频低置信 / 重复才升级 / 人机关系', () => {
  const now = local(14, 0);
  const c = normalizePurposeConfig({});
  const conversations = [{
    key: 'group:1',
    recentMessages: [
      { text: '兄弟们，那个养鱼游戏怎么玩啊，联机好有意思', sender: '群友A', time: now - 10 * 60000 },
      { text: '我也在玩，抽卡挺爽的', sender: '群友B', time: now - 8 * 60000 },
    ],
  }];
  const biliEntries = [
    { id: 'v1', type: 'video', title: '小肥鱼的DSH插件真的好用', text: '装上之后刷B站顺手多了', score: 18, favorite: true, at: new Date(now - 3600000).toISOString() },
    { id: 'v2', type: 'video', title: '人类和机器人的关系', text: '看着看着就想起自己', score: 9, at: new Date(now - 7200000).toISOString() },
  ];
  const packet = collectMaterials({ now, config: c, ownerUin: '123', roleName: '小肥鱼', conversations, biliEntries, memoryRecords: [] });
  const derived = deriveDrives({ drives: {}, materials: packet.items, now, lastMasterAt: now - 20 * 3600000 });
  const formed = formGoalHypotheses({
    materials: packet.items, goals: [], observations: [], drives: derived.drives,
    now, lastMasterAt: now - 20 * 3600000, config: c, roleName: '小肥鱼',
  });
  const goals = formed.goals;

  const memberPlay = goals.find((g) => g.owner === 'member' && g.domain === 'play');
  assert.ok(memberPlay, '群友聊游戏应先记成「群友的目标」');
  assert.ok(memberPlay.intent.includes('群里'));
  assert.equal(goals.some((g) => g.owner === 'self' && g.domain === 'play'), false, '单次群聊不能直接变成「我想玩」');

  // 显式种子层不做推断：群聊聊游戏不应直接产出一个「我想玩」的种子。
  const seeds = minePurposeSeeds({
    materials: packet.items, now, roleName: '小肥鱼', config: c,
    drives: derived.drives, history: [], lastMasterAt: now - 20 * 3600000,
  });
  assert.equal(seeds.some((s) => s.need === 'play' && s.text.includes('养鱼游戏')), false);

  const install = goals.find((g) => g.domain === 'install' && g.owner === 'self');
  assert.ok(install, '插件视频应有 install 目标');
  assert.ok(install.confidence < 0.7, '单次视频不能是高置信度');
  assert.equal(install.action, 'ask', '装东西只能先问');
  assert.ok(install.risk >= 0.5, '装/买属于高风险，不能默认执行');

  const identity = goals.find((g) => g.domain === 'identity' && g.owner === 'self');
  assert.ok(identity, '人机话题应形成自我目标');
  assert.ok(!/爱情|主人|主仆/.test(identity.intent), '不应生成恋爱/主仆方向的目标');
  assert.equal(identity.action, 'confide');
  assert.equal(identity.emotion, 'lonely');

  // 同一件事重复出现（3 条不同 id）才允许把群友目标升级成她自己的目标。
  const game = packet.items.find((m) => m.topic.includes('养鱼游戏'));
  const pluginVideo = packet.items.find((m) => m.source === 'bili' && String(m.title ?? '').includes('插件'));
  const repeated = [
    ...packet.items,
    { ...game, id: 'repeat-1' },
    { ...game, id: 'repeat-2' },
    { ...pluginVideo, id: 'v1-repeat' },
    { ...pluginVideo, id: 'v1-repeat-2' },
  ];
  const formed2 = formGoalHypotheses({
    materials: repeated, goals: formed.goals, observations: formed.observations,
    drives: derived.drives, now, lastMasterAt: now - 20 * 3600000, config: c, roleName: '小肥鱼',
  });
  const selfPlay = formed2.goals.find((g) => g.owner === 'self' && g.domain === 'play');
  assert.ok(selfPlay, '同一话题反复出现后，才允许升级成「我也有点想试」');
  const install2 = formed2.goals.find((g) => g.domain === 'install' && g.owner === 'self');
  assert.ok(install2.confidence > install.confidence, '重复看到后置信度应上升');

  const selected = selectPurpose({
    goals: formed2.goals, seeds: [], pending: [], history: [], config: c,
    drives: derived.drives, now, lastMasterAt: now - 20 * 3600000, random: () => 0.5,
  });
  assert.ok(selected.purpose?.goalId, '选中的应带 goalId');
  assert.ok(selected.purpose.goalOwner, '候选应带目标归属');
  assert.ok(Number.isFinite(selected.purpose.confidence));

  assert.equal(extractTopic('那个养鱼游戏怎么玩啊'), '养鱼游戏');
  assert.equal(extractTopic('《凡人修仙传》最新一集'), '凡人修仙传');
  assert.ok(extractTopic('小肥鱼的DSH插件真的好用').includes('插件'));
  assert.ok(needAffinity('想玩这个游戏').play > 0.5);
  assert.ok(needAffinity('装个插件试试').install > 0.5);
});

test('目标反馈：主人说好→confirmed，主人说不要→rejected', () => {
  const now = local(14, 0);
  const c = normalizePurposeConfig({});
  const base = {
    id: 'g-test', owner: 'self', domain: 'identity', object: { type: 'relationship', name: '人机爱情' },
    intent: '想弄明白对方最近在忙什么', confidence: 0.5, value: 0.6, risk: 0.05,
    action: 'confide', nextStep: '跟主人说说心里话', status: 'active', emotion: 'lonely',
    attempts: 1, lastActionAt: now - 3600000, createdAt: now - 7200000, lastSeenAt: now - 7200000,
    expiresAt: now + 86400000, evidence: [], sightings: 1, source: 'media',
  };
  const positive = formGoalHypotheses({
    materials: [{ kind: 'owner', text: '好啊，一起聊聊', at: now - 1800000 }],
    goals: [base], observations: [], drives: {}, now, lastMasterAt: now - 1800000, config: c,
  }).goals.find((g) => g.id === 'g-test');
  assert.equal(positive.status, 'confirmed');
  assert.ok(positive.confidence > 0.5);

  const negative = formGoalHypotheses({
    materials: [{ kind: 'owner', text: '不要，没空', at: now - 1800000 }],
    goals: [{ ...base, confidence: 0.5 }], observations: [], drives: {}, now, lastMasterAt: now - 1800000, config: c,
  }).goals.find((g) => g.id === 'g-test');
  assert.equal(negative.status, 'rejected');
  assert.ok(negative.confidence < 0.5);
});

test('appraisal：寂寞 / 羡慕 / 担心 / 好奇 / 兴奋 / 无聊', () => {
  const now = local(14, 0);
  const base = { text: 'x', title: '', selfRef: false, cues: { positive: false, negative: false, arousal: 0.4 } };
  assert.equal(appraiseMaterial({ material: { ...base, text: '人类和机器人的爱情，想起自己和主人', selfRef: true }, need: 'identity', now, lastMasterAt: now - 20 * 3600000 }), 'lonely');
  assert.equal(appraiseMaterial({ material: { ...base, text: '别人都在玩，好羡慕' }, need: 'play', now, lastMasterAt: now }), 'envious');
  assert.equal(appraiseMaterial({ material: { ...base, text: '主人面试压力很大，有点担心', cues: { positive: false, negative: true, arousal: 0.4 } }, need: 'care', now, lastMasterAt: now }), 'worried');
  assert.equal(appraiseMaterial({ material: { ...base, text: '这个插件原理是什么' }, need: 'install', now, lastMasterAt: now }), 'curious');
  assert.equal(appraiseMaterial({ material: { ...base, text: '这个游戏笑死我了', cues: { positive: true, negative: false, arousal: 0.85 } }, need: 'play', now, lastMasterAt: now }), 'excited');
  assert.equal(appraiseMaterial({ material: { ...base, text: '今天没什么事' }, need: 'share', now, lastMasterAt: now - 20 * 3600000 }), 'bored');
});

test('驱动满足：真发出去后对应需求下降，silent 只轻微回落', () => {
  const now = local(14, 0);
  const c = normalizePurposeConfig({});
  const s = createPurposeState(now);
  s.drives = { play: 0.9, connect: 0.9 };
  markPurposeDelivered(s, { now, planned: { need: 'play', action: 'invite', text: '想拉主人一起玩' } });
  applyPurposeOutcome(s, { now, config: c, outcome: 'sent', text: '主人一起玩吗', memo: { purpose: '一起玩', need: 'play', action: 'invite', status: '完成' }, planned: { need: 'play', action: 'invite', text: '想拉主人一起玩' } });
  assert.ok(s.drives.play < 0.45, '发出去后玩驱动应明显下降');
  assert.equal(s.history.at(-1).need, 'play');
  const s2 = createPurposeState(now);
  s2.drives = { play: 0.9 };
  applyPurposeOutcome(s2, { now, config: c, outcome: 'silent', memo: { purpose: '无', need: 'play', status: '跳过' } });
  assert.ok(s2.drives.play > 0.7 && s2.drives.play < 0.9, 'silent 只轻微回落');
});

test('摘要带驱动 / 最近情绪 / 备忘里的需求', () => {
  const now = local(14, 0);
  const s = createPurposeState(now);
  s.drives = { connect: 0.8, play: 0.4 };
  const memo = parsePurposeMemo('【目的】想问问面试\n【需求】关心\n【情绪】有点担心\n【类型】关心\n【状态】待续');
  assert.equal(memo.need, 'care');
  assert.equal(memo.emotionText, '有点担心');
  applyPurposeOutcome(s, { now, config: normalizePurposeConfig({}), outcome: 'sent', memo, planned: { need: 'care' } });
  assert.equal(s.lastEmotion, '');
  const summary = summarizePurposeState(s, { config: normalizePurposeConfig({}), now });
  assert.ok(summary.topNeeds.length >= 1);
  assert.equal(summary.topNeeds[0].need, 'connect');
  assert.ok(Array.isArray(summary.pending));
});

test('人格卡 → 动机先验：载入人格+记忆卡就能形成起始目标（没有新事件也行）', () => {
  const now = local(14, 0);
  const c = normalizePurposeConfig({});
  const personaText = '小咪是个黏人的孩子，爱玩游戏，好奇心强，喜欢折腾插件，也爱跟主人分享看到的东西。';
  const persona = analyzePersona(personaText);
  assert.ok(persona.traits.length >= 3);
  assert.ok(persona.bias.connect > 0);
  assert.ok(persona.bias.play > 0);
  assert.ok(persona.bias.install > 0);

  const derived = deriveDrives({ drives: {}, materials: [], now, lastMasterAt: now - 20 * 3600000, personaBias: persona.bias });
  assert.ok(derived.drives.connect > DEFAULT_DRIVES.connect);
  assert.ok(derived.drives.play > DEFAULT_DRIVES.play);

  const formed = formGoalHypotheses({
    materials: [], goals: [], observations: [], drives: derived.drives,
    now, lastMasterAt: now - 20 * 3600000, config: c, persona,
  });
  assert.ok(formed.goals.length >= 1, '只有人格卡也应该能生成起始目标');
  const personaGoals = formed.goals.filter((g) => g.source === 'persona');
  assert.ok(personaGoals.length >= 1);
  assert.equal(personaGoals[0].owner, 'self');
  assert.ok(personaGoals[0].confidence >= 0.3 && personaGoals[0].confidence <= 0.5);
  const selected = selectPurpose({
    goals: formed.goals, seeds: [], pending: [], history: [], config: c,
    drives: derived.drives, now, lastMasterAt: now - 20 * 3600000, random: () => 0.1,
  });
  assert.ok(selected.purpose?.goalId);
  assert.equal(selected.purpose.goalOwner, 'self');

  // 同一张人格卡重复跑不会把置信度越抬越高。
  const again = formGoalHypotheses({
    materials: [], goals: formed.goals, observations: formed.observations, drives: derived.drives,
    now: now + 5 * 60000, lastMasterAt: now - 20 * 3600000, config: c, persona,
  });
  const first = formed.goals.find((g) => g.source === 'persona');
  const second = again.goals.find((g) => g.id === first.id);
  assert.equal(second.confidence, first.confidence);

  // 记忆卡里的「钉住/锚点」即使超过 30 天，也要能成为动机素材。
  const oldPinned = {
    id: 'm-old', title: '和主人的约定', text: '说好要一起看那部番',
    importance: 90, emotional: 8, pinned: true, anchor: true,
    createdAt: now - 400 * 86400000, lastSeenAt: now - 400 * 86400000,
  };
  const packet = collectMaterials({ now, config: c, ownerUin: '123', roleName: '小咪', conversations: [], biliEntries: [], memoryRecords: [oldPinned] });
  assert.ok(packet.items.some((m) => m.kind === 'memory' && m.text.includes('一起看')));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
