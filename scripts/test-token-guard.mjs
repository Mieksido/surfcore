// Token 防爆破纯逻辑回归（不启桥接、不发 QQ）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_TOKEN_GUARD, localDayStart, evaluateWakeBudget, evaluateOutbound, isFreeWakeReason,
} from '../src/token-guard.js';

const now = new Date('2026-10-23T15:00:00+08:00').getTime();
const todayStart = localDayStart(now);
assert.equal(todayStart, new Date('2026-10-23T00:00:00+08:00').getTime());

// 每天唤醒上限：群 20 / 私聊 10
const group20 = Array.from({ length: 20 }, (_, i) => now - 60_000 * (20 - i));
const groupBlocked = evaluateWakeBudget({ key: 'group:402', wakeTimes: group20, now, guard: { ...DEFAULT_TOKEN_GUARD, minWakeGapMs: 0 } });
assert.equal(groupBlocked.blocked, true);
assert.equal(groupBlocked.reason, 'day');
assert.equal(groupBlocked.dayCount, 20);
const group19 = evaluateWakeBudget({ key: 'group:402', wakeTimes: group20.slice(1), now, guard: { ...DEFAULT_TOKEN_GUARD, minWakeGapMs: 0 } });
assert.equal(group19.blocked, false);
const private10 = Array.from({ length: 10 }, (_, i) => now - 60_000 * (10 - i));
const privateBlocked = evaluateWakeBudget({ key: 'private:123', wakeTimes: private10, now, guard: { ...DEFAULT_TOKEN_GUARD, minWakeGapMs: 0 } });
assert.equal(privateBlocked.blocked, true);
assert.equal(privateBlocked.reason, 'day');

// 两次苏醒最小间隔：30 秒前刚醒，要求 120 秒 → 还差 90 秒
const gap = evaluateWakeBudget({
  key: 'private:123', wakeTimes: [now - 30_000], now,
  guard: { ...DEFAULT_TOKEN_GUARD, minWakeGapMs: 120_000, privateMaxWakesPerDay: 10 },
});
assert.equal(gap.blocked, true);
assert.equal(gap.reason, 'gap');
assert.equal(gap.retryAfterMs, 90_000);
// 被直接 @ / 叫到：可越过 2 分钟间隔，立即醒；每日次数/花费上限仍然生效
const direct = evaluateWakeBudget({
  key: 'group:402', wakeTimes: [now - 30_000], now, direct: true,
  guard: { ...DEFAULT_TOKEN_GUARD, minWakeGapMs: 120_000, maxDailyCostCNY: 0 },
});
assert.equal(direct.blocked, false);
const directOff = evaluateWakeBudget({
  key: 'group:402', wakeTimes: [now - 30_000], now, direct: true,
  guard: { ...DEFAULT_TOKEN_GUARD, directBypassGap: false, minWakeGapMs: 120_000, maxDailyCostCNY: 0 },
});
assert.equal(directOff.blocked, true);
assert.equal(directOff.reason, 'gap');

// 回复后回访（replyCheck）不占每日次数（2026-10-30）：
// 一次真实对话以前要花 2 次额度（回复 + 回访），私聊 10 次/天实际只能聊 5 轮。
const filled = Array.from({ length: 10 }, (_, i) => now - 60_000 * (10 - i));
const replyCheckFree = evaluateWakeBudget({
  key: 'private:123', wakeTimes: filled, budgetTimes: filled, reason: 'replyCheck', now,
  guard: { ...DEFAULT_TOKEN_GUARD, minWakeGapMs: 0 },
});
assert.equal(replyCheckFree.blocked, false, 'replyCheck 不该占每日次数');
assert.equal(replyCheckFree.free, true);
assert.equal(replyCheckFree.dayCount, 10);
const realMessageBlocked = evaluateWakeBudget({
  key: 'private:123', wakeTimes: filled, budgetTimes: filled, reason: 'private', now,
  guard: { ...DEFAULT_TOKEN_GUARD, minWakeGapMs: 0 },
});
assert.equal(realMessageBlocked.blocked, true, '真实消息仍然要吃每日次数');
assert.equal(realMessageBlocked.reason, 'day');
assert.equal(realMessageBlocked.free, false);
// 关掉这个开关 = 退回旧语义（回访也计次）
const freeOff = evaluateWakeBudget({
  key: 'private:123', wakeTimes: filled, budgetTimes: filled, reason: 'replyCheck', now,
  guard: { ...DEFAULT_TOKEN_GUARD, minWakeGapMs: 0, replyCheckFree: false },
});
assert.equal(freeOff.blocked, true);
// 全量时间线（间隔）与计费时间线分开：只要 interval 内醒过就拦，与日额度无关
const gapWins = evaluateWakeBudget({
  key: 'private:123',
  wakeTimes: [now - 60_000, ...filled],
  budgetTimes: filled.slice(0, 9),
  reason: 'private', now,
  guard: { ...DEFAULT_TOKEN_GUARD, minWakeGapMs: 120_000 },
});
assert.equal(gapWins.blocked, true);
assert.equal(gapWins.reason, 'gap');
// 理由归一化：'replyCheck:xxx' 同属一类
assert.equal(isFreeWakeReason('replyCheck'), true);
assert.equal(isFreeWakeReason('replyCheck:extra'), true);
assert.equal(isFreeWakeReason('private'), false);
assert.equal(isFreeWakeReason('proactiveCheck'), false);

// 近 24h 花费上限
const costBlocked = evaluateWakeBudget({ key: 'group:402', wakeTimes: [now - 10 * 60_000], now, guard: { ...DEFAULT_TOKEN_GUARD, minWakeGapMs: 0, maxDailyCostCNY: 6 }, cost: 6.01 });
assert.equal(costBlocked.blocked, true);
assert.equal(costBlocked.reason, 'cost');
const costOk = evaluateWakeBudget({ key: 'group:402', wakeTimes: [now - 10 * 60_000], now, guard: { ...DEFAULT_TOKEN_GUARD, minWakeGapMs: 0, maxDailyCostCNY: 6 }, cost: 5.99 });
assert.equal(costOk.blocked, false);

// 单次醒来发 10 条 → 硬拦；8 条刚好；第 9 条拦
const ten = evaluateOutbound({ used: 0, count: 10, guard: DEFAULT_TOKEN_GUARD });
assert.equal(ten.blocked, true);
assert.equal(ten.max, 8);
assert.match(ten.error, /总结/, '10 条被拦时要明确让模型先总结，而不是只报数字');
assert.match(ten.error, /10 条/, '拦截文案要点出「拆 10 条」这个具体场景');
const eight = evaluateOutbound({ used: 0, count: 8, guard: DEFAULT_TOKEN_GUARD });
assert.equal(eight.blocked, false);
assert.equal(eight.next, 8);
const ninth = evaluateOutbound({ used: 8, count: 1, guard: DEFAULT_TOKEN_GUARD });
assert.equal(ninth.blocked, true);
assert.equal(ninth.next, 9);

// 关闭后全放行
assert.equal(evaluateWakeBudget({ key: 'group:402', wakeTimes: group20, now, guard: { ...DEFAULT_TOKEN_GUARD, enabled: false } }).blocked, false);
assert.equal(evaluateOutbound({ used: 99, count: 99, guard: { ...DEFAULT_TOKEN_GUARD, enabled: false } }).blocked, false);

// 桥接接线：鱼群守则在 token 守则之前，且发送/唤醒两处都接
const bridge = fs.readFileSync(new URL('../src/bridge.js', import.meta.url), 'utf8');
assert.ok(bridge.includes('evaluateWakeBudget'));
assert.ok(bridge.includes('evaluateOutbound'));
assert.ok(bridge.includes('directBypassGap'), '桥接没有接 directBypassGap');
assert.ok(bridge.includes('directWake'), '桥接没有识别直呼唤醒');
const wakeFish = bridge.indexOf('const fishWake = evaluateConversationFishGuard');
const wakeToken = bridge.indexOf('const tokenWake = tokenGuardWakeBlock');
assert.ok(wakeFish >= 0 && wakeToken > wakeFish, '唤醒顺序必须是鱼群守则 → Token 防爆破');
assert.ok((bridge.match(/fishGuardSendBlock\(key, st\)/g) || []).length >= 4, '发送前的鱼群守则接线不足');
assert.ok((bridge.match(/tokenGuardSendBlock\(key, st/g) || []).length >= 4, '发送前的 Token 防爆破接线不足');

// 每日额度（2026-10-23）：桥接不再只看自己的近 24h 账本，要读插件写的
// 三类当日快照（QQ + B站 + 其他），否则「总额度」在 QQ 侧永远看不到 B站 的花费。
assert.ok(bridge.includes('readDailyUsage'), '桥接没有读插件当日用量快照');
assert.ok(bridge.includes('evaluateBudget'), '桥接没有接 100% 额度闸');
assert.ok(bridge.includes('bridgeDailyUsage'), '桥接没有当日用量合并函数');
assert.ok(bridge.includes('learnerBudgetBlock'), '黑话学习没有接「其他/总额」额度闸');
assert.ok(bridge.includes('当日 token 额度'), '唤醒提示词没有把「近 24h 花费」改成当日额度');
assert.ok(bridge.includes('5000 字'), '唤醒提示词没有覆盖「5000 字长文」场景');
assert.ok(bridge.includes('拆成 10 条'), '唤醒提示词没有明确拒绝「拆成 10 条」');
const mcp = fs.readFileSync(new URL('../src/mcp-snowluma-safe.js', import.meta.url), 'utf8');
assert.ok(mcp.includes('一次最多 8 条'), 'MCP 发送工具描述没有写一次最多 8 条');
assert.ok(mcp.includes('不要拆成 10 条'), 'MCP 发送工具描述没有覆盖长文拆 10 条');
const preset = fs.readFileSync(new URL('../dsh/agent-presets/qq-chat-v2/agent.cordis.yml', import.meta.url), 'utf8');
assert.ok(preset.includes('5000 字长文不要逐条搬运'), 'reserved2 preset 没有覆盖长文/拆 10 条');
const scheduler = fs.readFileSync(new URL('../plugins/surfcore/lib/scheduler.js', import.meta.url), 'utf8');
assert.ok(scheduler.includes("tokenBudget.block('bili')"), 'B站 调度器没有接额度闸');
assert.ok(scheduler.includes('promptBili('), 'B站 调度器 prompt 没有统一走额度检查');
assert.ok(scheduler.includes('budgetBlockedNow'), 'B站 调度器没有在 tick 前检查额度');
const client = fs.readFileSync(new URL('../plugins/surfcore/lib/client.js', import.meta.url), 'utf8');
assert.ok(client.includes('function TokenTab'), '设置页缺少 Token 额度页');
assert.ok(client.includes('Token 额度'), '设置页缺少 Token 额度标签');
assert.ok(client.includes('今日 token 额度已用到 80%'), '设置页缺少 80% 弹窗');
assert.ok(client.includes('今天唯一一次'), '弹窗没有说明「每天只提醒一次」');

// 2026-10-30：回复后回访不再吃每日额度 + 额度用尽必须看得见（不能只写日志）
assert.ok(bridge.includes('wakeBudgetTimes'), '桥接没有拆分「计费唤醒」时间线');
assert.ok(bridge.includes('isFreeWakeReason'), '桥接没有接「回复后回访不占次数」');
assert.ok(bridge.includes('lastWakeBlock'), '桥接没有记录最近一次被拦（界面看不到额度用完）');
assert.ok(bridge.includes('wakeGuard'), '桥接状态没有暴露今日唤醒额度');
const pluginBridge = fs.readFileSync(new URL('../plugins/surfcore/lib/bridge.js', import.meta.url), 'utf8');
assert.ok(pluginBridge.includes('wakeGuard: payload.wakeGuard'), '设置页拿不到桥接的今日唤醒额度');
assert.ok(client.includes('今天叫不醒它'), '概览没有显示「唤醒额度已用完」');
assert.ok(client.includes('replyCheckFree'), '设置页没有「回复后回访不占次数」开关');

console.log('token guard tests OK');
