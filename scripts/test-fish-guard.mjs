// QQ / B站「鱼群保护」的离线回归。
// 只测纯逻辑与 dry-run；不发 QQ 消息、不访问 B站、不点赞。
// ⚠️ 2026-10-23：likeFishComments 会落盘 lastLikeRun / likeBlockedUntil。
//   以前测试没传 stateFile，假 fetch 的 -509 被写进真实 fish-guard.json，
//   让「上次点赞失败」看起来像真的。现在所有写状态的用例都必须用临时文件。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_QQ_FISH_GUARD, assessFishDensity, fishGuardReasonText, isFishName as qqIsFish, normalizeQqFishGuard,
} from '../src/fish-guard.js';
import {
  DEFAULT_BILI_FISH_GUARD, assessFishFlood, fishGuardStateSummary, isFishName as biliIsFish, isFishComment,
  likeFishComments, normalizeBiliFishGuard, planFishGuard, recordFishGuardCheck,
} from '../plugins/surfcore/tools/lib/fish-guard.mjs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-fish-guard-'));
const tmpState = () => path.join(tmpDir, `state-${Math.random().toString(36).slice(2)}.json`);

const now = Date.now();
const qqMsg = (name, secondsAgo, extra = {}) => ({
  sender: name, userId: extra.userId ?? String(1000 + Math.floor(secondsAgo)), time: now - secondsAgo * 1000, ...extra,
});

// ── QQ：名字识别 ───────────────────────────────────────────────────────────
assert.equal(qqIsFish('测试肥鱼'), true);
assert.equal(qqIsFish('littlefish'), true);
assert.equal(qqIsFish('摸鱼糕手'), false);
assert.equal(qqIsFish('肥鱼', { ...DEFAULT_QQ_FISH_GUARD, exemptNames: ['肥鱼'] }), false);
assert.equal(qqIsFish('测试肥鱼', normalizeQqFishGuard({ nameSuffixes: ['肥鱼'] })), true);
assert.equal(qqIsFish('测试肥鱼2'), true, '尾部数字不应成为绕过');
assert.equal(qqIsFish('测试肥鱼✨'), true, '尾部装饰符不应成为绕过');
// 2026-10-23 用户定：最后一个字是「鱼」也算；接受极小概率误伤真人
assert.equal(qqIsFish('咸鱼'), true);
assert.equal(qqIsFish('摸鱼'), true);
assert.equal(qqIsFish('鱼'), true);
assert.equal(qqIsFish('鱼糕'), false, '鱼在中间/不是结尾不算');
assert.equal(qqIsFish('咸鱼', { ...DEFAULT_QQ_FISH_GUARD, exemptNames: ['咸鱼'] }), false, '豁免优先级更高');
// 2026-10-23 用户定：名字里只要包含「肥鱼」就算（位置不限）
assert.equal(qqIsFish('肥鱼观察员'), true);
assert.equal(qqIsFish('大肥鱼研究员'), true);
assert.equal(qqIsFish('观察员肥鱼'), true);
assert.equal(qqIsFish('肥鱼观察员', { ...DEFAULT_QQ_FISH_GUARD, exemptNames: ['肥鱼观察员'] }), false, '豁免优先级更高');
// 2026-10-23 用户可配三条独立规则：开头 / 中间 / 结尾，任一命中就算鱼
const prefixCfg = { ...DEFAULT_QQ_FISH_GUARD, namePrefixes: ['DSH'], nameContains: [], nameSuffixes: [] };
assert.equal(qqIsFish('DSH小助手', prefixCfg), true, '开头词要能命中');
assert.equal(qqIsFish('我是DSH小助手', prefixCfg), false, '开头词不能命中中间');
const middleCfg = { ...DEFAULT_QQ_FISH_GUARD, namePrefixes: [], nameContains: ['吃白饭'], nameSuffixes: [] };
assert.equal(qqIsFish('爱吃白饭的鱼', middleCfg), true, '中间词要能命中');
assert.equal(qqIsFish('吃白饭', middleCfg), true);
const suffixCfg = { ...DEFAULT_QQ_FISH_GUARD, namePrefixes: [], nameContains: [], nameSuffixes: ['DSH'] };
assert.equal(qqIsFish('小助手DSH', suffixCfg), true, '结尾词要能命中');
assert.equal(qqIsFish('DSH小助手', suffixCfg), false, '结尾词不能命中间');
assert.equal(qqIsFish('DSH小助手'), false, '默认不配 DSH 时不该误判');
assert.deepEqual(normalizeQqFishGuard({}).namePrefixes, [], '默认开头词为空');
assert.deepEqual(normalizeQqFishGuard({ namePrefixes: ['DSH'] }).namePrefixes, ['DSH']);

// ── QQ：不同鱼 ≥5 → 拦 ────────────────────────────────────────────────────
{
  const messages = [
    qqMsg('测试肥鱼', 30, { userId: '1' }),
    qqMsg('大肥鱼', 20, { userId: '2' }),
    qqMsg('fish', 10, { userId: '3' }),
    qqMsg('摸鱼的大肥鱼', 5, { userId: '4' }),
    qqMsg('鱼鱼', 2, { userId: '5', fish: true }),
    qqMsg('真人', 1, { userId: '9' }),
  ];
  const result = assessFishDensity(messages, { now, guard: DEFAULT_QQ_FISH_GUARD });
  assert.equal(result.blocked, true, JSON.stringify(result));
  assert.equal(result.reason, 'fish-count');
  assert.equal(result.fishCount, 5);
}

// ── QQ：连续 5 条鱼（中间有真人就断开）→ 拦 ────────────────────────────────
{
  const messages = [
    qqMsg('真人', 60, { userId: '9' }),
    ...Array.from({ length: 5 }, (_, i) => qqMsg('测试肥鱼', 10 - i, { userId: String(i + 1) })),
  ];
  const result = assessFishDensity(messages, { now, guard: { ...DEFAULT_QQ_FISH_GUARD, maxFish: 99 } });
  assert.equal(result.blocked, true);
  assert.equal(result.reason, 'fish-streak');
}

// ── QQ：冷却文案不能写死 10 分钟（设置页 cooldownMs 可改）──────────────────
{
  const text = fishGuardReasonText({
    reason: 'cooldown', blocked: true, rawBlocked: true,
    until: Date.now() + 5 * 60 * 1000,
  });
  assert.match(text, /还剩约 5 分钟/);
}

// ── QQ：单只鱼连续 4 条不拦、5 条拦 ───────────────────────────────────────
{
  const four = Array.from({ length: 4 }, (_, i) => qqMsg('测试肥鱼', 10 - i, { userId: '1' }));
  const a = assessFishDensity(four, { now, guard: DEFAULT_QQ_FISH_GUARD });
  assert.equal(a.blocked, false);
  const five = Array.from({ length: 5 }, (_, i) => qqMsg('测试肥鱼', 20 - i, { userId: '1' }));
  const b = assessFishDensity(five, { now, guard: DEFAULT_QQ_FISH_GUARD });
  assert.equal(b.blocked, true);
  assert.equal(b.reason, 'fish-streak-single');
}

// ── QQ：中间有自己说话 → 连续计数断开 ─────────────────────────────────────
{
  const messages = [
    ...Array.from({ length: 4 }, (_, i) => qqMsg('测试肥鱼', 10 - i, { userId: String(i + 1) })),
    { sender: '我', isSelf: true, time: now - 5000 },
    ...Array.from({ length: 4 }, (_, i) => qqMsg('测试肥鱼', 4 - i, { userId: String(i + 5) })),
  ];
  const result = assessFishDensity(messages, { now, guard: DEFAULT_QQ_FISH_GUARD });
  assert.equal(result.reason, 'fish-count');
  assert.notEqual(result.reason, 'fish-streak');
}

// ── QQ：鱼窝群收紧阈值 5→3 ────────────────────────────────────────────────
{
  const messages = [
    qqMsg('测试肥鱼', 20, { userId: '1' }),
    qqMsg('大肥鱼', 15, { userId: '2' }),
    qqMsg('fish', 10, { userId: '3' }),
    qqMsg('真人', 5, { userId: '9' }),
  ];
  const result = assessFishDensity(messages, { now, guard: DEFAULT_QQ_FISH_GUARD, groupName: '摸鱼肥鱼窝' });
  assert.equal(result.groupIsFishNest, true);
  assert.equal(result.effectiveMaxFish, 3);
  assert.equal(result.blocked, true);
}

// ── QQ：窗口外的鱼不计入 ──────────────────────────────────────────────────
{
  const messages = Array.from({ length: 5 }, (_, i) => qqMsg('测试肥鱼', 700 + i, { userId: String(i) }));
  const result = assessFishDensity(messages, { now, guard: DEFAULT_QQ_FISH_GUARD });
  assert.equal(result.blocked, false, JSON.stringify(result));
}

// ── B站：名字识别 + 泛滥判定 ───────────────────────────────────────────────
assert.equal(biliIsFish('测试肥鱼'), true);
assert.equal(biliIsFish('肥鱼观察员'), true, '名字里包含肥鱼也算（2026-10-23 用户定）');
assert.equal(biliIsFish('fish', { ...DEFAULT_BILI_FISH_GUARD, exemptNames: ['fish'] }), false);
// 2026-10-23 用户定：最后一个字是「鱼」也算（咸鱼/摸鱼/鱿鱼…），接受极小概率误伤真人
assert.equal(biliIsFish('大咸鱼'), true);
assert.equal(biliIsFish('摸鱼'), true);
assert.equal(biliIsFish('鱼'), true);
assert.equal(biliIsFish('鱼糕'), false, '鱼在中间/不是结尾不算');
assert.equal(biliIsFish('咸鱼', { ...DEFAULT_BILI_FISH_GUARD, exemptNames: ['咸鱼'] }), false, '豁免优先级更高');
// 2026-10-23 用户定：名字里只要包含「肥鱼」就算（位置不限）
assert.equal(biliIsFish('大肥鱼研究员'), true);
assert.equal(biliIsFish('观察员肥鱼'), true);
assert.equal(biliIsFish('这条肥鱼不太冷'), true);
assert.equal(biliIsFish('肥鱼观察员', { ...DEFAULT_BILI_FISH_GUARD, exemptNames: ['肥鱼观察员'] }), false, '豁免优先级更高');
// B站同样支持 开头 / 中间 / 结尾 三条独立规则
const biliPrefix = { ...DEFAULT_BILI_FISH_GUARD, namePrefixes: ['DSH'], nameContains: [], nameSuffixes: [] };
assert.equal(biliIsFish('DSH小助手', biliPrefix), true);
assert.equal(biliIsFish('我是DSH小助手', biliPrefix), false);
const biliMiddle = { ...DEFAULT_BILI_FISH_GUARD, namePrefixes: [], nameContains: ['吃白饭'], nameSuffixes: [] };
assert.equal(biliIsFish('爱吃白饭的鱼', biliMiddle), true);
const biliSuffix = { ...DEFAULT_BILI_FISH_GUARD, namePrefixes: [], nameContains: [], nameSuffixes: ['DSH'] };
assert.equal(biliIsFish('小助手DSH', biliSuffix), true);
assert.equal(biliIsFish('DSH小助手', biliSuffix), false);
assert.deepEqual(normalizeBiliFishGuard({}).namePrefixes, [], 'B站默认开头词为空');
assert.deepEqual(normalizeBiliFishGuard({ namePrefixes: ['DSH'] }).namePrefixes, ['DSH']);

const biliComment = (rpid, uname, { rcount = 0, like = 0, ctime = now, mid = rpid } = {}) => ({
  rpid: String(rpid), root: String(rpid), parent: '0', mid: String(mid), uname,
  message: '路过', like, rcount, ctime, kind: 'root',
});
const biliReply = (rpid, root, uname, { mid = rpid, ctime = now } = {}) => ({
  rpid: String(rpid), root: String(root), parent: String(root), mid: String(mid), uname,
  message: '楼中楼', like: 0, rcount: 0, ctime, kind: 'reply',
});

{
  const topLevel = [
    biliComment(1, '测试肥鱼', { rcount: 1 }),
    biliComment(2, '大肥鱼', { rcount: 8 }),
    biliComment(3, 'fish', { rcount: 0 }),
    biliComment(4, '真人甲'),
    biliComment(5, '真人乙'),
    biliComment(6, '真人丙'),
    biliComment(7, '真人丁'),
    biliComment(8, '真人戊'),
  ];
  const repliesByRoot = {
    1: [biliReply(11, 1, '小鱼fish'), biliReply(12, 1, '真人')],
    2: [],
    3: [biliReply(31, 3, '测试肥鱼')],
  };
  const result = assessFishFlood({ topLevel, repliesByRoot, config: DEFAULT_BILI_FISH_GUARD, selfMid: '999', ownerMid: '888' });
  assert.equal(result.flooded, true);
  assert.equal(result.fishTopLevel, 3);
  assert.equal(result.gatherTarget.rpid, '3', '应优先选回复最少（0 条）的鱼楼');
  assert.ok(result.likeTargets.some((x) => x.rpid === '1'));
  assert.ok(result.likeTargets.some((x) => x.rpid === '11'), '楼里的鱼回复也要点赞');
  assert.ok(!result.gatherTarget || result.gatherTarget.rpid !== '2', '回复太多的鱼楼不该被聚拢');
}

// ── B站：2026-10-23 强制聚拢 ───────────────────────────────────────────────
// 所有鱼楼都不满足“回复少/新鲜”的条件，但 forceGather=true 时仍要选一条；
// forceGather=false 时保持旧行为（没有合适鱼楼 → null）。
{
  const topLevel = [
    biliComment(1, '测试肥鱼', { rcount: 9 }),
    biliComment(2, '大肥鱼', { rcount: 10 }),
    biliComment(3, 'fish', { rcount: 11 }),
    biliComment(4, '真人甲'), biliComment(5, '真人乙'), biliComment(6, '真人丙'),
    biliComment(7, '真人丁'), biliComment(8, '真人戊'),
  ];
  const old = assessFishFlood({ topLevel, repliesByRoot: {}, config: DEFAULT_BILI_FISH_GUARD, selfMid: '999', ownerMid: '888' });
  assert.equal(old.flooded, true);
  assert.equal(old.gatherTarget, null, '旧行为：没有满足条件的鱼楼就不聚拢');
  assert.equal(old.gatherFallback, false);

  const forced = assessFishFlood({
    topLevel, repliesByRoot: {}, config: DEFAULT_BILI_FISH_GUARD, selfMid: '999', ownerMid: '888',
    forceGather: true,
  });
  assert.ok(forced.gatherTarget, '强制模式必须选一条鱼楼');
  assert.equal(forced.gatherTarget.rpid, '1', '强制模式优先选回复最少的那条');
  assert.equal(forced.gatherFallback, true, '日志要能区分“强制聚拢”');
}

// 配置默认开；显式 false 可关
assert.equal(normalizeBiliFishGuard({}).forceGather, true);
assert.equal(normalizeBiliFishGuard({ forceGather: false }).forceGather, false);

// ── B站：主人/自己/已赞的鱼不计入点赞目标 ───────────────────────────────
{
  const topLevel = [
    biliComment(1, '测试肥鱼', { mid: '999' }),
    biliComment(2, '大肥鱼', { mid: '888' }),
    biliComment(3, 'fish', { mid: '777' }),
  ];
  const result = assessFishFlood({
    topLevel,
    repliesByRoot: {},
    config: DEFAULT_BILI_FISH_GUARD,
    selfMid: '999',
    ownerMid: '888',
    state: { liked: { 3: new Date().toISOString() }, gathered: {}, daily: {} },
  });
  assert.deepEqual(result.likeTargets, []);
}

// ── B站：点赞 dry-run 不写状态、不访问网络 ────────────────────────────────
{
  const state = { version: 1, liked: {}, gathered: {}, daily: {} };
  const result = await likeFishComments({
    targets: [{ rpid: '1', uname: '测试肥鱼', kind: 'root' }],
    oid: '123',
    cred: { sessdata: 'x', bili_jct: 'x', buvid3: 'x' },
    state,
    stateFile: tmpState(),
    config: normalizeBiliFishGuard({ ...DEFAULT_BILI_FISH_GUARD, maxLikesPerDay: 2, likeGapMinMs: 0, likeGapMaxMs: 0 }),
    dry: true,
    fetchImpl: () => { throw new Error('dry-run 不应访问网络'); },
  });
  assert.equal(result.liked.length, 1);
  assert.equal(state.liked['1'], undefined);
}

// ── B站：抓取必须带 cookie（否则游客态只回 0~3 条评论）─────────────────
{
  let seenCookie = '';
  const fakeFetch = async (url, options = {}) => {
    if (String(url).includes('/reply/reply')) {
      return { json: async () => ({ code: 0, data: { replies: [] } }) };
    }
    seenCookie = String(options.headers?.cookie ?? '');
    return { json: async () => ({ code: 0, data: { replies: [{
      rpid: 1, member: { uname: '测试肥鱼', mid: 100 }, content: { message: '鱼' }, like: 0, rcount: 0, ctime: Math.floor(now / 1000),
    }] } }) };
  };
  const planned = await planFishGuard({
    oid: '123', bvid: 'BV1xx411c7mD',
    cred: { sessdata: 'S', bili_jct: 'J', buvid3: 'B' },
    config: { ...DEFAULT_BILI_FISH_GUARD, likeFishReplies: false, gatherEnabled: false },
    state: { liked: {}, gathered: {}, daily: {} },
    fetchImpl: fakeFetch,
  });
  assert.equal(planned.ok, true, JSON.stringify(planned));
  assert.match(seenCookie, /SESSDATA=S/, '评论抓取必须带 SESSDATA');
  assert.match(seenCookie, /bili_jct=J/, '评论抓取必须带 bili_jct');
  assert.equal(planned.loggedIn, true);
}

// ── B站：mid 白名单能认出改名的鱼，也不能漏掉豁免 mid ─────────────────────
{
  const cfg = normalizeBiliFishGuard({ ...DEFAULT_BILI_FISH_GUARD, extraFishMids: ['555555'], exemptMids: ['666666'] });
  assert.equal(isFishComment({ mid: '555555', uname: '改名的鱼' }, cfg), true);
  assert.equal(isFishComment({ mid: '666666', uname: '测试肥鱼' }, cfg), false);
  const result = assessFishFlood({
    topLevel: [
      { rpid: '1', mid: '555555', uname: '改名的鱼', like: 0, rcount: 0, ctime: now },
      { rpid: '2', mid: '777777', uname: '真人', like: 0, rcount: 0, ctime: now },
    ],
    config: cfg,
    state: { liked: {}, gathered: {}, daily: {} },
  });
  assert.equal(result.fishTopLevel, 1);
  assert.ok(result.likeTargets.some((x) => x.rpid === '1'));
}

// ── B站：抓取 + 判定（mock fetch，不访问真站）──────────────────────────────
{
  const rawTop = [
    ...Array.from({ length: 3 }, (_, i) => ({
      rpid: i + 1, member: { uname: i === 2 ? 'fish' : '测试肥鱼', mid: 100 + i },
      content: { message: '鱼的楼层' }, like: 1, rcount: i === 0 ? 1 : 0, ctime: Math.floor(now / 1000),
    })),
    ...Array.from({ length: 5 }, (_, i) => ({
      rpid: 10 + i, member: { uname: '真人' + i, mid: 200 + i },
      content: { message: '人类的楼层' }, like: 0, rcount: 0, ctime: Math.floor(now / 1000),
    })),
  ];
  const fakeFetch = async (url) => ({
    json: async () => {
      const u = String(url);
      if (u.includes('/reply/reply')) {
        return { code: 0, data: { replies: [{
          rpid: 99, root: 1, parent: 1, member: { uname: '小鱼fish', mid: 777 },
          content: { message: '楼里的鱼' }, like: 0, rcount: 0, ctime: Math.floor(now / 1000),
        }] } };
      }
      return { code: 0, data: { replies: rawTop } };
    },
  });
  const planned = await planFishGuard({
    oid: '123', bvid: 'BV1xx411c7mD', config: DEFAULT_BILI_FISH_GUARD, state: { liked: {}, gathered: {}, daily: {} }, fetchImpl: fakeFetch,
  });
  assert.equal(planned.ok, true, JSON.stringify(planned));
  assert.equal(planned.flooded, true);
  assert.equal(planned.gatherTarget.rpid, '2', 'rpid=2 的鱼楼回复最少');
  assert.ok(planned.likeTargets.some((x) => x.rpid === '99'), '楼里的鱼回复应进入点赞目标');
}

// ── B站：成功点赞写「给谁点的」历史（设置页点赞历史）────────────────────
{
  const state = { version: 1, liked: {}, gathered: {}, daily: {}, likeFailed: {} };
  const stateFile = tmpState();
  const ok = await likeFishComments({
    targets: [{
      rpid: '77', root: '77', uname: '测试肥鱼', kind: 'root', like: 3,
      message: '这条是测试鱼评论，应该出现在点赞历史里。',
    }],
    oid: '123', bvid: 'BV1xx411c7mD',
    cred: { sessdata: 'x', bili_jct: 'x', buvid3: 'x' }, state, stateFile,
    config: normalizeBiliFishGuard({ ...DEFAULT_BILI_FISH_GUARD, likeGapMinMs: 0, likeGapMaxMs: 0 }),
    fetchImpl: async () => ({ json: async () => ({ code: 0 }) }),
  });
  assert.equal(ok.liked.length, 1);
  assert.equal(state.likeLog.length, 1, '成功点赞要写 likeLog');
  assert.equal(state.likeLog[0].uname, '测试肥鱼');
  assert.equal(state.likeLog[0].bvid, 'BV1xx411c7mD');
  assert.equal(state.likeLog[0].rpid, '77');
  assert.match(state.likeLog[0].message, /测试鱼评论/);
  const summary = fishGuardStateSummary(state, DEFAULT_BILI_FISH_GUARD);
  assert.equal(summary.likeHistory.length, 1);
  assert.equal(summary.likeHistory[0].uname, '测试肥鱼');
  assert.equal(summary.likedCount, 1);
}

// ── B站：风控码触发熔断，后续点赞直接跳过；失败与最后一次结果落临时状态 ─────
{
  const state = { version: 1, liked: {}, gathered: {}, daily: {}, likeFailed: {} };
  const stateFile = tmpState();
  const fake = async () => ({ json: async () => ({ code: -509, message: 'too frequent' }) });
  const first = await likeFishComments({
    targets: [{ rpid: '9', uname: '测试肥鱼', kind: 'root' }],
    oid: '123', cred: { sessdata: 'x', bili_jct: 'x', buvid3: 'x' }, state, stateFile,
    config: normalizeBiliFishGuard({ ...DEFAULT_BILI_FISH_GUARD, failCooldownMinutes: 30, likeGapMinMs: 0, likeGapMaxMs: 0 }),
    fetchImpl: fake,
  });
  assert.equal(first.ok, false);
  assert.ok(state.likeBlockedUntil, '风控码应写入冷却');
  assert.equal(state.likeFailed['9'].code, -509, '失败原因要写进状态，设置页才能显示');
  assert.equal(state.lastLikeRun.failed[0].code, -509);
  const second = await likeFishComments({
    targets: [{ rpid: '9', uname: '测试肥鱼', kind: 'root' }],
    oid: '123', cred: { sessdata: 'x', bili_jct: 'x', buvid3: 'x' }, state, stateFile,
    config: normalizeBiliFishGuard({ ...DEFAULT_BILI_FISH_GUARD, failCooldownMinutes: 30, likeGapMinMs: 0, likeGapMaxMs: 0 }),
    fetchImpl: fake,
  });
  assert.ok(second.skipped.some((x) => x.includes('风控冷却')));
}

// ── B站：鱼群检查记录（设置页「最近鱼群检查」）────────────────────────────
{
  const file = tmpState();
  const state = { version: 1, liked: {}, gathered: {}, daily: {}, likeFailed: {}, fishGuardLog: [] };
  const plan = {
    ok: true,
    flooded: true,
    loggedIn: true,
    gatherTarget: { rpid: '321', uname: '测试肥鱼' },
    gatherFallback: true,
    likeTargets: [{ rpid: '321' }, { rpid: '322' }],
    stats: { fishTopLevel: 4, fishMids: 3, fishRatio: 0.5, totalSample: 20, fishNames: ['测试肥鱼'] },
  };
  const rec = recordFishGuardCheck({ state, plan, oid: '123', bvid: 'BV1xx411c7mD', source: 'comment', stateFile: file });
  assert.equal(rec.flooded, true);
  assert.equal(rec.gatherFallback, true);
  assert.equal(rec.gather.rpid, '321');
  assert.equal(rec.likeTargets, 2);
  assert.equal(state.fishGuardLog.length, 1);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.fishGuardLog[0].bvid, 'BV1xx411c7mD');
  const summary = fishGuardStateSummary(saved, DEFAULT_BILI_FISH_GUARD);
  assert.equal(summary.checkCount, 1);
  assert.equal(summary.records[0].source, 'comment');
  assert.equal(summary.records[0].fishTopLevel, 4);
  // 上限 50 条
  for (let i = 0; i < 60; i += 1) {
    recordFishGuardCheck({ state, plan, oid: '123', bvid: 'BV1xx411c7mD', source: 'comment', stateFile: file });
  }
  assert.equal(state.fishGuardLog.length, 50);
  assert.equal(fishGuardStateSummary(state, DEFAULT_BILI_FISH_GUARD).records.length, 10);
}

// 2026-11-03：B站 CLI（tools/commands/comment.mjs）已随 B站下线删除，
// 「聚拢回复走 comment 账」那条跨文件契约随之失效；QQ 侧鱼群保护逻辑本身仍在上面的用例里。

console.log('fish guard tests OK');
