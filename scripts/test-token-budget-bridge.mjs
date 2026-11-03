// QQ 桥接侧的每日额度闸门（真实 bridge.js，fixture 对端，不发 QQ）。
//
// 关键点：
// 1. 桥接读插件写的 token-usage-daily.json，看见的是 QQ + B站 + 其他三类总额；
// 2. QQ 分项到 100%、或总额到 100%，唤醒直接拦；80% 不拦；
// 3. 黑话学习走「其他 / 总额」闸，不能后台偷烧；
// 4. 快照过期时回落桥接自己的 ledger，不会把插件没写文件当成「今天 0 花费」。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { bridgeHarness } from './audit-bridge-harness.mjs';
import { localDayKey } from '../src/token-budget.js';

const day = localDayKey();
const now = Date.now();
const files = {
  'dsh/surfcore/token-budget.json': {
    version: 1,
    updatedAt: now,
    limits: {
      qq: { cny: 8, tokens: null },
      other: { cny: null, tokens: null },
      total: { cny: null, tokens: null },
    },
  },
  'dsh/surfcore/token-usage-daily.json': {
    day,
    at: now,
    source: 'surfcore-plugin',
    qq: { cost: 9, tokens: 9_000_000 },
    other: { cost: 0, tokens: 0 },
    total: { cost: 9, tokens: 9_000_000 },
    sessions: {},
  },
};

const h = await bridgeHarness({
  config: {
    socialV2: {
      tokenGuard: {
        enabled: true,
        maxWakesPerDay: 20,
        privateMaxWakesPerDay: 10,
        minWakeGapMs: 0,
        directBypassGap: true,
        maxOutboundPerTurn: 8,
        maxDailyCostCNY: 8,
      },
    },
  },
  files,
});
const writeJson = (rel, value) => {
  const target = path.join(h.temp, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value));
};

const dailyPath = 'dsh/surfcore/token-usage-daily.json';
const budgetPath = 'dsh/surfcore/token-budget.json';

try {
  // 1. QQ 今日 ¥9 / ¥8 → 拦
  const blocked = h.tokenGuardWakeBlock('group:456', { wakeTimes: [] });
  assert.ok(blocked, 'QQ 超过额度后必须拦唤醒');
  assert.equal(blocked.reason, 'budget');
  assert.match(blocked.error, /QQ/);
  assert.match(blocked.error, /¥9\.00/);
  assert.match(blocked.error, /¥8\.00/);

  // 额度是独立闸：关掉「Token 防爆破」总开关，每日额度仍然要拦。
  h.cfg.socialV2.tokenGuard.enabled = false;
  assert.ok(h.tokenGuardWakeBlock('group:456', { wakeTimes: [] }), '关掉 Token 防爆破后额度闸仍生效');
  h.cfg.socialV2.tokenGuard.enabled = true;

  // 2. 80% 不拦（¥6.4 / ¥8 = 80%）
  writeJson(dailyPath, {
    day, at: now, source: 'surfcore-plugin',
    qq: { cost: 6.4, tokens: 640_000 },
    other: { cost: 0, tokens: 0 },
    total: { cost: 6.4, tokens: 640_000 },
    sessions: {},
  });
  assert.equal(h.tokenGuardWakeBlock('group:456', { wakeTimes: [] }), null, '80% 只提醒不拦唤醒');

  // 3. 总额度：QQ ¥1 + 旧账本里的 B站 ¥5，总额上限 ¥5 → 拦。
  //    这条同时钉住「B站 下线后，旧文件里的 bili 花费仍然算进总额」——
  //    漏掉的话，升级当天的花费会凭空少一截。
  writeJson(dailyPath, {
    day, at: now, source: 'surfcore-plugin',
    qq: { cost: 1, tokens: 100_000 },
    bili: { cost: 5, tokens: 500_000 },
    other: { cost: 0, tokens: 0 },
    total: { cost: 6, tokens: 600_000 },
    sessions: {},
  });
  writeJson(budgetPath, {
    version: 1, updatedAt: now,
    limits: {
      qq: { cny: 8, tokens: null },
      other: { cny: null, tokens: null },
      total: { cny: 5, tokens: null },
    },
  });
  const totalBlocked = h.tokenGuardWakeBlock('group:456', { wakeTimes: [] });
  assert.ok(totalBlocked, '总额度到 100% 必须拦 QQ 唤醒');
  assert.equal(totalBlocked.reason, 'budget');
  assert.match(totalBlocked.error, /总额/);
  assert.match(totalBlocked.error, /¥6\.00/);
  assert.match(totalBlocked.error, /¥5\.00/);

  // 4. 旧文件里残留的 bili 额度键被忽略（不再有 B站 分项），不会误拦 QQ 唤醒
  writeJson(budgetPath, {
    version: 1, updatedAt: now,
    limits: {
      qq: { cny: 8, tokens: null },
      bili: { cny: 1, tokens: null }, // 旧键：应被忽略
      other: { cny: null, tokens: null },
      total: { cny: null, tokens: null },
    },
  });
  assert.equal(h.tokenGuardWakeBlock('group:456', { wakeTimes: [] }), null, '旧 bili 额度键被忽略，不拦 QQ 唤醒');

  // 5. 黑话学习：其他 ¥2 / ¥1 → 拦；总额到顶也拦
  writeJson(dailyPath, {
    day, at: now, source: 'surfcore-plugin',
    qq: { cost: 0, tokens: 0 },
    other: { cost: 2, tokens: 200_000 },
    total: { cost: 2, tokens: 200_000 },
    sessions: {},
  });
  writeJson(budgetPath, {
    version: 1, updatedAt: now,
    limits: {
      qq: { cny: 8, tokens: null },
      other: { cny: 1, tokens: null },
      total: { cny: null, tokens: null },
    },
  });
  assert.ok(h.learnerBudgetBlock(), '其他额度到 100% 时黑话学习必须停');
  writeJson(budgetPath, {
    version: 1, updatedAt: now,
    limits: {
      qq: { cny: 8, tokens: null },
      other: { cny: null, tokens: null },
      total: { cny: 2, tokens: null },
    },
  });
  assert.ok(h.learnerBudgetBlock(), '总额度到 100% 时黑话学习必须停');

  // 6. 快照过期：不能把插件没写文件当成 0 花费；回落 bridge-ledger（这里没有采样 → 0，不拦）
  writeJson(dailyPath, {
    day, at: now - 20 * 60 * 1000, source: 'surfcore-plugin',
    qq: { cost: 9, tokens: 9_000_000 },
    other: { cost: 0, tokens: 0 },
    total: { cost: 9, tokens: 9_000_000 },
    sessions: {},
  });
  writeJson(budgetPath, {
    version: 1, updatedAt: now,
    limits: {
      qq: { cny: 8, tokens: null },
      other: { cny: null, tokens: null },
      total: { cny: null, tokens: null },
    },
  });
  const fallback = h.bridgeDailyUsage();
  assert.equal(fallback.source, 'bridge-ledger', '过期快照回落 bridge-ledger');
  assert.equal(fallback.stale, true, '过期快照标记 stale');
  assert.equal(h.tokenGuardWakeBlock('group:456', { wakeTimes: [] }), null, '桥接账本无今天采样时按 0 处理，不误拦');
} finally {
  await h.close();
}

console.log('token budget bridge tests OK');
