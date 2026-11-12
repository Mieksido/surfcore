# 2026-10-31 · 回合进行中到达的消息看不到 / 要晚一轮

## 现象

模型收到唤醒开始跑，到调用 `qq_wait_for_messages` 之间用户新发的消息：
当前回合看不到；只有本轮结束后，桥接补一次唤醒才被重新看到。

## 真实机制（先纠正描述）

- 消息**没有丢**：会话忙时桥接把唤醒原因放进 `pendingWakeReasons`，`turn/end` 时
  `replayPendingWakeReasonsV2` 补投成下一次唤醒（`isConversationBusyV2` 判忙）；
- DSH 没有「往进行中回合插消息」的接口，所以新消息无法主动推进当前上下文；
- 唯一能在同一回合拿到新消息的入口是 `qq_wait_for_messages`。

## 但 wait 本身也有 bug（本次修复的核心）

`wait` 的非 reply 分支：

```js
const requestSeq = st.lastUnreadSeq;          // 请求这一刻的未读水位
const baseline = replyWait ? readThroughSeqV2(st) : requestSeq;
```

模型开始本轮 → 思考 → 才调 wait，这期间到的消息已经让 `lastUnreadSeq` 前进，
被算进 baseline → **wait 永远看不到它们**；而且非 reply 的 `history` 只取
`recentMessages`、不取 `unread` → 即使调了 wait 也拿不到。

结果就是用户说的：「只有等这一轮结束，又把中间丢失的信息再投一遍」。

## 修法

| 项 | 改动 |
| --- | --- |
| 基线 | 本回合正在进行（`v2TurnStartAt` 有值）且历史工具可用时，基线用 `readThroughSeqV2(st)`（模型已看水位），而不是请求时的 `lastUnreadSeq`；回合外/短等待保持旧语义 |
| 来源 | wait 的 `history` 同时包含 `unread` 与 `recentMessages`（各自由 getUnread/getRecent 开关控制），不再只读 recent |
| 提醒 | 工具返回新增 `unseenCount` / `unreadNotice`：本轮还有 N 条没看过，想看就现在调 wait/unread，别等下一轮（state / snapshot / unread / recent / wait） |
| 说明 | wait 工具 description 补上「本轮开始后、调用前到的消息也会返回」 |

## 验证

- `test-reply-wait`：本轮开始后到 wait 前的消息立即返回（不等到超时）；wait 后提醒消失；
- `test-token-economy`：4 条「in-flight wait 权限撤销」用例保持通过（回合外/短等待语义未变）；
- audit 107/107；插件测试全绿。

## 残余

DSH 侧仍无「插话」接口：模型若**完全不调** wait/unread/snapshot，就只能在 turn/end 后由补唤醒看到；
现在至少每个工具返回都会提醒它「还有没看的消息」，并把入口说清楚。
