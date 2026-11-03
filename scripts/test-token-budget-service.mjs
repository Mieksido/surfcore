// SurfCore 插件侧 token 用量采集 / 额度闸门回归（fake DSH，不连真宿主、不发 QQ）。
//
// 重点钉住：
// 1. 分类：QQ（qq-chat / sessions.json）、其他（黑话 + 历史 bili-whale* 会话及其子会话），
//    用户自己的 cordis 会话不计入 SurfCore 总额；
// 2. 启动回填：按事件时间只补「今天的部分」，不会把昨天的累计算进今天；
// 3. 热重载：同一天重建服务不会把已经算过的用量再算一遍；
// 4. 同一 (turn,step) 的流式 attempt 被最终 message 覆盖，不双算；
// 5. 80% 提醒返回即落盘、当天只一次；100% 拦截 QQ/B站/总额；
// 6. 保存 / 快捷加额度 / 清空。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTokenBudgetService } from '../plugins/surfcore/lib/token-budget.js';
import { readDailyUsage, readAlert, localDayKey } from '../src/token-budget.js';

let passed = 0;
let failed = 0;
function check(cond, label) {
  if (cond) { passed += 1; console.log(`✅ ${label}`); }
  else { failed += 1; console.error(`❌ ${label}`); }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

const dshHome = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-token-svc-'));
const qqStateDir = path.join(dshHome, 'state');
fs.mkdirSync(qqStateDir, { recursive: true });
fs.writeFileSync(path.join(qqStateDir, 'sessions.json'), JSON.stringify({ sessions: { 'group:1': 'qq-1' } }), 'utf8');
fs.writeFileSync(path.join(qqStateDir, 'slang-session.json'), JSON.stringify({ sessionId: 'slang-1' }), 'utf8');

const dayStart = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
const t0 = dayStart + 3 * 3600_000;
const t1 = dayStart + 4 * 3600_000;
const tokenUsage = (inp, out, hit = 0) => ({ uncachedInputTokens: inp, outputTokens: out, cacheReadTokens: hit, cacheWriteTokens: 0 });
const usageEvent = (seq, turn, step, u, at = t0, model = 'deepseek-flash') => ({
  type: 'assistant/message', seq, time: at,
  data: { turn, step, usage: u, message: { source: { provider: 'deepseek-account', model } } },
});
const modelEvent = (seq, model) => ({ type: 'model/selection', seq, time: t0, data: { model } });

const items = [
  {
    sessionId: 'qq-1', updatedAt: t1,
    projections: { values: {
      agentPreset: 'qq-chat-v2', title: '群一',
      tokenUsage: tokenUsage(1_000_000, 100_000),
      modelSelection: { lastUsed: { model: 'deepseek-flash' } },
    } },
  },
  {
    sessionId: 'bili-whale-char-1', updatedAt: t1,
    projections: { values: {
      agentPreset: 'standard', title: 'B站日记',
      tokenUsage: tokenUsage(2_000_000, 200_000),
      modelSelection: { lastUsed: { model: 'deepseek-flash' } },
    } },
  },
  {
    sessionId: 'bili-child-1', updatedAt: t1, parentSessionId: 'bili-whale-char-1',
    projections: { values: {
      agentPreset: 'standard', title: 'B站子任务',
      tokenUsage: tokenUsage(300_000, 30_000),
      modelSelection: { lastUsed: { model: 'deepseek-flash' } },
    } },
  },
  {
    sessionId: 'slang-1', updatedAt: t1,
    projections: { values: {
      agentPreset: 'qq-chat', title: '群聊黑话候选词提取',
      tokenUsage: tokenUsage(500_000, 50_000),
      modelSelection: { lastUsed: { model: 'deepseek-flash' } },
    } },
  },
  {
    sessionId: 'cordis-1', updatedAt: t1,
    projections: { values: {
      agentPreset: 'cordis', title: '和主人聊天',
      tokenUsage: tokenUsage(9_000_000, 900_000),
      modelSelection: { lastUsed: { model: 'deepseek-flash' } },
    } },
  },
];
const eventsBySession = {
  'qq-1': [modelEvent(1, 'deepseek-flash'), usageEvent(2, 1, 1, tokenUsage(1_000_000, 100_000))],
  'bili-whale-char-1': [usageEvent(1, 1, 1, tokenUsage(2_000_000, 200_000))],
  'bili-child-1': [usageEvent(1, 1, 1, tokenUsage(300_000, 30_000))],
  'slang-1': [usageEvent(1, 1, 1, tokenUsage(500_000, 50_000))],
  'cordis-1': [usageEvent(1, 1, 1, tokenUsage(9_000_000, 900_000))],
};

const ctx = {
  sessionController: {
    list: async () => ({ items }),
    inspect: async (id) => {
      const item = items.find((entry) => entry.sessionId === id);
      return {
        meta: {
          id, createdAt: t0, agentPreset: item?.projections?.values?.agentPreset,
          parentSession: item?.parentSessionId,
        },
        events: eventsBySession[id] ?? [],
      };
    },
  },
};

let clock = t1;
const service = createTokenBudgetService({
  ctx,
  dshHome,
  qqStateDir,
  getQqConfig: () => ({ dsh: { model: 'deepseek-flash' } }),
  now: () => clock,
});
service.persist = service.persist; // keep API explicit

const status = await service.status({ takeAlertFlag: true });
check(near(status.usage.qq.cost, 1.4), `QQ 今日 ¥1.40（实得 ${status.usage.qq.cost.toFixed(4)}）`);
// B站 下线后：旧 `bili-whale*` 会话的花费（¥3.22，含子会话）并进「其他」，总额不变。
check(near(status.usage.other.cost, 0.7 + 3.22), `其他 = 黑话 0.70 + 历史 B站 3.22（实得 ${status.usage.other.cost.toFixed(4)}）`);
check(near(status.usage.total.cost, 1.4 + 3.22 + 0.7), `总额 = QQ + 其他（实得 ${status.usage.total.cost.toFixed(4)}）`);
check(status.usage.bili === undefined, '用量结构里不再有 bili 分项');
check(status.sessions['qq-1'] === 'qq' && status.sessions['bili-whale-char-1'] === 'other', 'QQ 分类照旧；旧 B站 会话归入其他');
check(status.sessions['bili-child-1'] === 'other', '子会话继承父类（也是其他）');
check(status.sessions['slang-1'] === 'other', '黑话学习会话归入其他');
check(status.sessions['cordis-1'] === undefined, '用户自己的 cordis 会话不计入 SurfCore');
check(status.usage.total.tokens === 1_100_000 + 2_200_000 + 330_000 + 550_000, `总额 token 数正确（实得 ${status.usage.total.tokens}）`);

// 默认 QQ ¥8：当前 1.4 不应拦截；B站 未设额度也不拦截
check(status.blocked.qq === false && status.blocked.other === false && status.blocked.total === false, '未到上限不拦截');
check(status.alert === null, `总额 5.32 < 80%×8=6.4 时不提醒（实得 ${status.usage.total.cost}）`);

// 保存额度：QQ ¥2、其他 4M token、总额 ¥6；此时总额 5.32 已过 80%（4.8），应提醒
const saved = service.saveLimits({
  qq: { cny: 2, tokens: null },
  other: { cny: null, tokens: 4_000_000 },
  total: { cny: 6, tokens: null },
});
check(saved.qq.cny === 2 && saved.other.tokens === 4_000_000, '保存额度归一化');
const alertStatus = await service.status({ takeAlertFlag: true });
check(Boolean(alertStatus.alert), '总额到 80% 返回第一次提醒');
check(alertStatus.alert.items.some((item) => item.scope === 'total' && item.unit === 'cny'), '提醒包含总额金额项');
check(Boolean(readAlert(dshHome + '/surfcore')), '提醒返回时已落盘');
const afterAlert = await service.status({ takeAlertFlag: true });
check(afterAlert.alert === null && afterAlert.alertedToday?.day, '同一天第二次不再提醒，但保留已提醒记录');

// 把 QQ 额度压到 ¥1.2（当前 1.4）：超过 100% 才拦
service.saveLimits({
  qq: { cny: 1.2, tokens: null },
  other: { cny: null, tokens: 4_000_000 },
  total: { cny: 6, tokens: null },
});
const qqGate = await service.block('qq');
check(qqGate.blocked === true, 'QQ 分项到 100% 拦截');
check(qqGate.message.includes('QQ') && qqGate.message.includes('%'), `拦截文案含分项和比例（${qqGate.message}）`);
const otherGate = await service.block('other');
check(otherGate.blocked === false, '其他 当前 3.08M/4M token（token 维度未到）不拦');
const totalGate = await service.block('total');
check(totalGate.blocked === false, '总额 5.32/6 未到 100%，不拦');

// 快捷加额度：QQ +1 元 → 3 元；总额 +20M token
const added = service.addLimit('qq', 'cny', 1);
check(added.qq.cny === 2.2, '快捷 +1 元');
const addedToken = service.addLimit('total', 'tokens', 20_000_000);
check(addedToken.total.tokens === 20_000_000, '快捷 +20M token');

// 实时事件：同一 (turn,step) 的 attempt 被 message 覆盖，只算最终值
const session = { id: 'qq-1', header: { id: 'qq-1', agentPreset: 'qq-chat-v2' } };
const before = (await service.status({ takeAlertFlag: false })).usage.qq;
const attempt = { type: 'assistant/attempt', seq: 10, time: t1, data: { turn: 5, step: 1, stream: [{ usage: { inputTokens: 1000, outputTokens: 100 } }] } };
const message = usageEvent(11, 5, 1, { inputTokens: 2000, outputTokens: 200 }, t1);
check(service.ingestEvent(session, attempt) === true, '实时 attempt 入账');
const afterAttempt = (await service.status({ takeAlertFlag: false })).usage.qq;
check(afterAttempt.tokens > before.tokens, 'attempt 增加了用量');
check(service.ingestEvent(session, message) === true, '同一 (turn,step) 的最终 message 覆盖 attempt');
const afterMessage = (await service.status({ takeAlertFlag: false })).usage.qq;
const expectedDelta = Math.round(0.002 * 1e6) + Math.round(0.0002 * 1e6);
check(afterMessage.tokens === before.tokens + expectedDelta, `覆盖后只算最终 2200 token（实得 ${afterMessage.tokens - before.tokens}）`);
check(near(afterMessage.cost - before.cost, 0.0028, 1e-6), `覆盖后金额按最终值（实得 ${(afterMessage.cost - before.cost).toFixed(6)}）`);

// 热重载：停掉旧服务 → 用同一个 dshHome 重建 → 不应该把今天再算一遍
service.dispose();
const service2 = createTokenBudgetService({
  ctx,
  dshHome,
  qqStateDir,
  getQqConfig: () => ({ dsh: { model: 'deepseek-flash' } }),
  now: () => clock,
});
const reloaded = await service2.status({ takeAlertFlag: false });
check(near(reloaded.usage.total.cost, afterMessage.cost + 3.22 + 0.7, 1e-6), `热重载不重复计费（实得 ${reloaded.usage.total.cost.toFixed(4)}）`);

// 跨天：第二天用量归零；当日额度重置
clock = t1 + 24 * 3600_000;
const nextDay = await service2.status({ takeAlertFlag: true });
check(nextDay.usage.total.cost === 0 && nextDay.usage.total.tokens === 0, '跨天后今日用量归零');
check(Boolean(nextDay.alert) === false, '跨天但没有新用量 → 不提醒');
const nextEvent = usageEvent(20, 1, 1, tokenUsage(100_000, 10_000), clock);
check(service2.ingestEvent(session, nextEvent) === true, '第二天实时事件入账');
const nextDay2 = await service2.status({ takeAlertFlag: false });
check(nextDay2.usage.qq.tokens === 110_000, `第二天只算当天（实得 ${nextDay2.usage.qq.tokens}）`);

// 清空额度
const reset = service2.resetLimits();
check(reset.qq.cny === null && reset.total.cny === null && reset.other.tokens === null, '清空额度');

// 磁盘上的 daily 快照应与状态一致
const daily = readDailyUsage(path.join(dshHome, 'surfcore'), localDayKey(clock));
check(daily.day === nextDay2.day, 'daily 快照日期正确');
check(daily.qq.tokens === nextDay2.usage.qq.tokens, 'daily 快照 QQ 用量与状态一致');

// 回归：state 文件里只有「今天」但没有任何会话记录时，不能把累计投影当成今天。
// 之前的实现会在这种 state 上走「同一天增量」分支：seen=0，delta=整个会话累计，
// 把 10-20 创建的 B站 会话 436M token 全算进今天（真机抓到）。
{
  const dshHome2 = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-token-svc-empty-'));
  const qq2 = path.join(dshHome2, 'state');
  fs.mkdirSync(qq2, { recursive: true });
  fs.mkdirSync(path.join(dshHome2, 'surfcore'), { recursive: true });
  fs.writeFileSync(path.join(dshHome2, 'surfcore', 'token-usage-state.json'), JSON.stringify({
    version: 1, day: localDayKey(clock), updatedAt: clock, categories: {}, sessions: {},
  }), 'utf8');
  const item = {
    sessionId: 'qq-cum', updatedAt: clock,
    projections: { values: {
      agentPreset: 'qq-chat-v2', title: '累计 10M 的老会话',
      tokenUsage: tokenUsage(10_000_000, 1_000_000),
      modelSelection: { lastUsed: { model: 'deepseek-flash' } },
    } },
  };
  const ctx2 = {
    sessionController: {
      list: async () => ({ items: [item] }),
      inspect: async () => ({
        meta: { id: 'qq-cum', createdAt: t0, agentPreset: 'qq-chat-v2' },
        events: [usageEvent(1, 1, 1, tokenUsage(1_000_000, 100_000), clock)],
      }),
    },
  };
  const service3 = createTokenBudgetService({
    ctx: ctx2, dshHome: dshHome2, qqStateDir: qq2,
    getQqConfig: () => ({ dsh: { model: 'deepseek-flash' } }), now: () => clock,
  });
  const st = await service3.status({ takeAlertFlag: false });
  check(st.usage.qq.tokens === 1_100_000, `空 state 不能把累计当今天（实得 ${st.usage.qq.tokens}）`);
  check(near(st.usage.qq.cost, 1.4), `空 state 回填只算今天金额（实得 ${st.usage.qq.cost}）`);
  const state3 = JSON.parse(fs.readFileSync(path.join(dshHome2, 'surfcore', 'token-usage-state.json'), 'utf8'));
  check(state3.sessions['qq-cum']?.createdAt === t0, '回填时写入会话 createdAt');
  check(state3.sessions['qq-cum']?.lastSeq === 1, '回填时写入事件最大 seq');
  service3.dispose();
  fs.rmSync(dshHome2, { recursive: true, force: true });
}

service2.dispose();
fs.rmSync(dshHome, { recursive: true, force: true });

if (failed) {
  console.error(`\n❌ token 服务测试失败：${passed} 通过 / ${failed} 失败`);
  process.exit(1);
}
console.log(`\n🎉 token 服务测试通过（${passed} 项）`);
