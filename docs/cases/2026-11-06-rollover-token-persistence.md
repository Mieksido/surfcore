# 2026-11-06 · 换会话 P0：触发轮回复丢失 + P1 状态不持久化

## P0：换会话那一轮 token 失效

现象：22:56 触发 `[rollover]` 后，同一轮 AI 输出报“会话令牌校验失败”，用户侧表现为她突然不说话。

根因：`deliverPromptNow()` 在**本轮投递前**调用 `maybeRollSessionV2()`；到阈值时
`retireSession()` 立即轮换 `agentToken`，而这一轮模型已经拿到的提示词/工具参数可能还是旧 token。

修法（不牺牲滚动）：

- 到阈值时先 `st.rolloverPending = true`，**本轮不 retire**；
- 当前轮照常使用旧会话/旧 token 跑完；
- 下一次投递开始前，看到 `rolloverPending` 再执行 retire、生成交接、建新会话；
- 新提示词此时才构建，token 一定是新的。

日志会显示：

```
已到阈值（...），下一轮投递开始前换会话（本轮不轮换，避免 token 失效）
...
已用 ... 换新会话（带交接）
```

目的机制的 prompt 是自己拼的（不走 `buildWakePromptV2`），所以在 `runPurposeOnce` 拼 token
**之前**调用 `maybeRollSessionV2(key, { forceRoll: true })`：该滚就直接滚，prompt 拿到新 token，
不会出现「purpose 已拼好旧 token → deliverPromptNow 再轮换」的同类 403。

## P1：滚动状态不持久化

`saveSocialV2State()` 是白名单写法，之前漏了：

- `sessionTurns`
- `sessionTokens`
- `sessionBaseTokens`
- `handoffPending`
- `rolling`（内存态，不能持久化 true）
- 新增 `rolloverPending`

现在：

- 前 4 个字段和 `rolloverPending` 落盘；
- `rolling` 加载时固定 `false`，崩溃后不会永久卡住；
- 重启后 `handoffPending` 仍会注入下一条新会话。

## 验证

```
test-session-rollover   187 项全过（新增 P0/P1 断言）test:audit              153/153
```

未在真机复现完整 P0 场景；需要 dev13 测试机在长会话上触发一次滚动确认回复不再丢。

## 未处理

- `batchWindowMs` 真机仍是 8000：这是配置迁移/产品决定，未改；
- 安装目录 audit 的环境性失败、state ACL 告警：另案。
