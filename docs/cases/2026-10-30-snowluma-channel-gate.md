# SnowLuma 断线时主动唤醒空烧 token：通道闸门 + 失败挂起

- **日期**：2026-10-30
- **来源**：用户文档（v0.6.22，SnowLuma 未启动/掉线，`proactiveCheck` 仍跑完整 LLM，
  发送失败只写 bridge.log；一天 QQ 侧 ¥4.76 多数为掉线空转）。
- **目标**：通道断了就不创建 DSH 会话、不跑模型；失败要可见、可行动。

## 1. 链路

```
QQ ↕ SnowLuma（HTTP :3000 / WS :3001）
        ↕
SurfCore bridge（src/bridge.js）
  ├─ [P0] sendWakePromptV2 开头：qqSendChannelStatus()
  │      └─ 不健康 → 直接 return，不 ensureSession、不投 prompt
  ├─ [P1] sendToQQ()/onebotSend() 成功/失败 → noteSendSuccess/noteSendFailure
  │      ├─ 连续 3 次失败 → 该会话 wakeSuspendedUntil += 30min
  │      └─ 成功 / SnowLuma open / 新消息 → 解除
  └─ [P2] gateEvents.record()
         ├─ send-failed（首次，L1）
         ├─ send-channel-down（close，L2）
         ├─ wake-suspended-after-send-failures（L2）
         └─ send-channel-restored（L1）
```

## 2. 机制

- **P0 通道闸门**在 `sendWakePromptV2` 最前面，覆盖 proactiveCheck / timeout / replyCheck /
  history / bootstrap 以及直接唤醒；只要 SnowLuma WS 未连接或最近 2 分钟发送失败，就
  **不创建 DSH 会话**，日志只写一次/10 分钟。
- **P1 跨回合挂起**：`sendFailureStreak` / `wakeSuspendedUntil` 持久化到 `social-v2.json`；
  `scheduleProactiveCheckV2` 在暂停期内不再排下一次；成功发送或 SnowLuma open 后恢复。
- **P2 可观测**：
  - 首次发送失败 L1（通知中心，不弹窗）；
  - 通道关闭 L2（弹窗 + 建议：启动/重启 SnowLuma，确认 3000/3001）；
  - 连续 3 次失败挂起 L2；
  - UI 的 SnowLuma 安装卡显示 `diagnosis.hint`，给出下一步。
- 失败原因不包含消息正文；事件只存 key/错误摘要，不存 token。

## 3. 爆炸半径

- 改 `src/bridge.js` 的唤醒入口和发送结果记录；影响所有 QQ 唤醒/发送路径；
- 通道不可用时**跳过唤醒**，不会多发消息；恢复后自动继续；
- 写 `social-v2.json` 和 `gate-events.jsonl`；不改配置、不删除数据；
- 阈值暂停 30 分钟是保守值；可在代码常量调整。

## 4. 取舍

- **A：只加连续失败熔断**（仍会先烧一轮才停；不选）。
- **B：唤醒前健康闸门 + 失败挂起 + 事件**（本批采用；能零 token 跳过）。
- **C：只靠每日预算**（预算到才停，太晚；不选）。

## 5. 生效与重启

- 改的是桥接；**重启 QQ 桥接**（或重启 DSH，让插件拉起桥接）后生效；
- 不需要改 `config.json`；默认开启。
- 没有新增设置页开关；特殊部署（网关与 bot 分机）后续再加 opt-out。

## 6. 验证

```bash
node scripts/test-snowluma-channel-gate.mjs
# 通道断开/发送失败暂停时：不创建 DSH 会话；恢复后能创建
npm run test:audit   # 89/89
plugins/surfcore npm test
```

未手测：真实停掉 SnowLuma 观察零 token 增长、真实 close 弹窗、桥接重启恢复。
真实环境按文档步骤：停 SnowLuma → 下个 proactiveCheck 应只出现
`[channel-gate] 跳过唤醒`，不出现 `设置会话模型` / `工具统一发送`。

## 7. 回滚与残余

- 回滚：移除 `sendWakePromptV2` 的 channel gate 与 `noteSend*` 接线；
  `social-v2.json` 的新字段可保留，不影响旧代码。
- 残余：
  - 首次 HTTP 发送失败前无法预知（P0 只能看 WS/最近失败）；
  - 挂起期间收到真实入站消息是否会解除：目前靠发送成功/SnowLuma open 恢复，
    极端场景下需人工恢复；
  - “已耗 token 但发送失败”的精确金额还没有在账本里标 `wasted`（当前是事件 + 日志）；
  - 端口/进程体检仍未覆盖 SnowLuma 进程本身。
