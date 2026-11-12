# 2026-11-06 · 换会话/交接下沉到 deliverPromptNow + runtime run.bat 修复

## 现象

1. 私聊会话累计 4000 万 token，目的机制回合没有触发 `[rollover]`；
2. 唤醒时贴好的交接块 / 机器模式说明，模型实际没收到；
3. 没装 embedding 包时，仓库自带 `runtime/run.bat` 调 `service.mjs`，但文件叫
   `embedding-service.mjs` → 永远 `service-missing`。

## 根因

- `maybeRollSessionV2()` 只写在 `sendWakePromptV2()` 里；目的机制走 `deliverPrompt()`，
  不经过这个函数，所以永远不换会话；
- `deliverPromptNow()` 在 `opts.wakeReason` 分支里会重新 `buildWakePromptV2()`，
  把 `sendWakePromptV2()` 已经贴好的交接块/形态说明整段覆盖；
- `run.bat` 入口文件名写错。

## 修法

- `maybeRollSessionV2(key)` 下沉到 `deliverPromptNow()`，位置在 `ensureSession()` **之前**，
  唤醒 / 目的 / 历史 / 分享所有投递路径共用；
- 交接块与形态说明改到 `deliverPromptNow()` 正文最终重建**之后**再贴：
  顺序为「形态说明 → 交接块 → 正文」；
- `sendWakePromptV2()` 不再自己拼正文/消费交接，只传 `wakeReason + vectorBlock`，
  避免重复消费；
- `runtime/run.bat`：`node service.mjs` → `node embedding-service.mjs`。

## 验证

```
test-session-rollover      152 项全过（断言改为按 deliverPromptNow 内位置关系）
test:audit                 152/152
plugins/surfcore npm test  0 失败
```

## 预期运行行为

- 测试机 `private:3287064288`（4061 万 token）和 `group:1107801059`（324 万 token）
  下一次投递会各换一次会话，日志出现 `[rollover]`，带交接块；
- 交接块只注入一次，不会在后续回合重复；
- 目的机制路径也会按阈值换会话。

## 未验证

- 真 QQ 端到端（SnowLuma 未启动/已启动但未做完整消息链路）；
- 机器模式真机；
- embedding 模型包安装后向量记忆端到端。

## 回滚

- 还原 `src/bridge.js` 的 `deliverPromptNow` / `sendWakePromptV2`；
- `run.bat` 改回原入口即可；
- 不改版本、不打 tag、不发布。
