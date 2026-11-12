# 私聊「不回我」：回访吃掉每日额度，且额度用尽不可见

日期：2026-11-03

对应：GitHub PR #30

## 现象

- 晚上私聊连发几条 + 「在吗？」，QQ 上完全没有回复。
- 设置页/概览没有提示；桥接日志里只有：

```text
Token 防爆破：这个会话今天已经醒了 10/10 次，今天不再自动唤醒
```

- 同一份体检还报：

```text
⚠️ SnowLuma 在线 · onebot-rejected · 多半是 accessToken 不匹配
```

但桥接其实连着。

## 根因

### A. 回访也吃每日次数

`wakeTimes` 一条时间线同时承担：

```text
最小间隔
每分钟/每小时限频
每天最多醒
```

`replyCheck`（回复后 30 秒回访）也走 `sendWakePromptV2`，并 `push` 进 `wakeTimes`。

结果：

```text
一次对话 = 真实消息醒 1 次 + 回访醒 1 次
私聊 10 次/天 = 只够 5 轮
```

### B. 体检拿配置当桥接状态

旧代码：

```js
diagnoseSnowLuma(config.snowluma)
```

配置里没有 `connected`，函数第一行永远 false；只要 3000/3001 在听，就报 `onebot-rejected`。

### C. 额度用尽没有界面

`tokenGuardWakeBlock` 拦下只写日志；`/api/status`、设置页、体检都不带这个状态。

## 修法

### 1. 拆分「全量唤醒」和「计费唤醒」

`src/token-guard.js`：

```js
replyCheckFree: true
isFreeWakeReason(reason, guard)
evaluateWakeBudget({ ..., budgetTimes, reason })
```

`src/bridge.js`：

- 会话状态新增 `wakeBudgetTimes`；
- 旧状态回填 `wakeTimes` 快照，升级当天不会凭空多额度；
- `replyCheck` 仍写 `wakeTimes`（间隔/限频），但不写 `wakeBudgetTimes`；
- `purpose` 属于真实对话，写两条线；
- 投递失败回滚两条线。

### 2. 额度用尽可见

- `/api/status` 新增 `wakeGuard`；
- `/api/socialV2/states` 每会话带 `wakeGuard`；
- 插件 `mapStatusPayload` 透出；
- 概览顶部黄条 +「去调高额度」；
- 体检新增「唤醒额度」项（warn，不判失败）；
- 设置页新增「回复后回访不占次数」开关。

### 3. 体检使用桥接状态

- `installChecks()` 传 `runtimeBridge?.snowluma`；
- `diagnoseSnowLuma(bridgeSnow, { bridge })` 新增 `bridge-down` / `bridge-error`；
- `doctor.js` 按状态给不同修法，桥接没跑时不再让人查 token。

## 没有做

- 没有做桥接级 VM 测试（回访不计次、重启后 `wakeBudgetTimes` 不丢）。
- `lastWakeBlock` 只存在内存，桥接重启后历史不保留（计数仍按时间线计算）。
- 没有真实 QQ 跑满一天观察额度曲线。
- 没有改 `directBypassDay`：当前 @/提问仍可越过日额度。

## 风险

- 升级当天：旧状态没有 `wakeBudgetTimes`，必须回填；否则会凭空多额度。
- 回访免费会增加模型回合数，仍受间隔/限频/每日花费上限约束。
- `directBypassDay` 与 PR 旧测试的假设不同；直接合旧补丁会回退当前行为。
- `wakeGuard` 依赖桥接状态；桥接没跑时体检不显示额度项，避免误报。
- 设置页黄条只在额度用完时出现；历史拦截原因不持久化。
- 多入口（status / states / 插件 / 体检）必须同步，少一个就还是“看不见”。

## 验证

```text
node scripts/test-token-guard.mjs
node plugins/surfcore/scripts/test-doctor.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
