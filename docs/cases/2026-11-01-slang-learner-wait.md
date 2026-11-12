# 黑话学习 `waitLearnerTurn` 永远超时

日期：2026-11-01

## 1. 现象

`0.7.19 + DSH 0.2.1-rc.3`：DSH 侧答案已完成，但 `waitLearnerTurn` 永远等不到 turn 事件，120 秒超时；QQ 会话事件正常。

## 2. 根因

1. **waiter 注册晚于 prompt**：`runSlangExtraction/runSlangResearch` 先 `sessions.prompt`，再 `waitLearnerTurn`。DSH 可能在 prompt HTTP 返回前就发完 `turn/start` + `turn/end`，结果没有 waiter 接，直接丢失。
2. **collector 只认 `turn/start`**：缺 start 的 `assistant/message` / `turn/end` 不会收尾。
3. **超时错误被泛化判死**：catch 用 `/会话|session|not found|404/`，而超时文案是“等待学习会话 turn 超时”，于是每次超时都会 `invalidateSlangLearnerSession()`，下一轮重建，再超时。
4. `api.events.follow` 是同步记账，本身没问题；真正丢事件的是 waiter/collector 时序。

## 3. 修法

- `waitLearnerTurn` 改为**可取消**，带 `LEARNER_TURN_TIMEOUT` code；
- 两个 learner 任务都改成**先注册 waiter，再发 prompt**；
- prompt 失败/被拒时 `turnWait.cancel()`，不留 120 秒幽灵 waiter；
- `createTurnCollector({ tolerantStart: true })` 支持缺 `turn/start`：
  - `assistant/message` 先到也能开始累积；
  - `turn/end` 仍能收尾；
  - 默认 collector 行为不变，QQ 不受影响；
- learner 分支在 `assistant/message`/`turn/end` 且存在 waiter 时也能创建 collector；
- 超时只按显式 `LEARNER_TURN_TIMEOUT` 处理（重建 scratch 会话），不再用泛化“会话”正则；
- 其他错误只在明确 `not-found/404/session-not-found` 时 invalidate。

## 4. 生效/风险

- 重启 QQ 桥接后生效；
- 学习会话是 scratch 会话，超时重建不会影响用户聊天记忆；
- 旧 DSH 若真的不发 turn 事件，现在会在 `turn/end` 或超时给出明确结果，不再无限等；
- 若 `assistant/message` 与 `turn/end` 都缺失，仍然只能超时；
- 超时重建会丢学习会话上下文（不是用户记忆），这是有意的恢复策略；
- 事件重连/重复投递仍需真实 DSH 压测。

## 5. 验证

```text
node scripts/test-learner-turn-wait.mjs
npm run test:audit        # 117/117
cd plugins/surfcore && npm test   # 0 失败
```

测试覆盖：

- 正常 turn/start → assistant → end；
- 缺 turn/start 的 assistant → end；
- 默认 collector 不受影响；
- waiter 先于 prompt、prompt 失败可取消。
