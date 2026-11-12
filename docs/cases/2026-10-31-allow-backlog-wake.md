# 2026-10-31 · 主人私信被忽略 + 重启后积压不唤醒 + 白名单被安装覆盖

## 现象（同一份用户报告）

1. `allow.private` 里只有**机器人自己的 UIN**（`2708810079`），主人 `1609302529` 私信被
   `忽略未授权会话 private:1609302529` 丢掉；
2. 桥接重启后，白名单群 `social-v2.json` 里 `unread>0`，但没有任何唤醒；
3. 设置页加白名单 → 之后跑一次「一键安装/诊断修复」，用户加的人丢失（`allow.private` 变回只有 owner）。

## 根因（架构层，不是单行 bug）

| # | 根因 | 说明 |
| --- | --- | --- |
| 1 | **白名单有 3 个写入点，各自拼数组** | 控制台 `/api/whitelist`、插件 `install-apply`、插件一键安装；`install-apply` 用 `priv=[owner]` 整体替换；没有任何一处保证「主人必须在、机器人自己必须不在」 |
| 2 | **唤醒只由新消息事件驱动** | 桥接重启前的 `unread` 不会触发事件；`runHistoryCatchUp` 只补「水位之后的新消息」，不处理已有 unread |
| 3 | **token-guard 的 day 拦截缺重试契约** | 返回 `blocked:true, reason:'day'` 但没有 `retryAfterMs` → 桥接重试定时器不启动 → 跨天后也不重试；且 day 拦截此前不豁免 direct（@/名字/提问/拍一拍） |
| 4 | 未授权会话日志刷屏 | 每个陌生群一条，把真实信号淹没 |

## 修法（收敛到一处规则 + 补生命周期步骤）

- 新增 `src/allowlist.js`：`normalizeAllowlist()`（去掉机器人自己、确保主人在私聊白名单、
  去重、丢弃非法值，返回 `changed/warnings`）+ `pickBacklogSessions()`（纯函数挑积压会话）；
- **桥接启动/登录/DSH 就绪时自愈**：`reconcileAllowlist()` 纠正后落盘 + 发 L1 事件；
- `/api/whitelist` 与插件 `install-apply` / 一键安装 / 设置页保存**全部走同一套归一化**，
  只追加主人、不再整体替换；
- **启动补唤醒**：reserved2 + DSH 就绪后 12 秒，挑允许范围内有 unread 且无待发定时器的会话，
  最多 5 个（按未读数降序），用新 reason `backlog` 唤醒；
- **token-guard**：day 拦截带 `retryAfterMs`（到本地零点）；direct 默认豁免 day（`directBypassDay`）；
  桥接对 day 的重试间隔放宽到 10 分钟；
- **日志节流**：未授权会话 / token-guard 跳过同类日志 10 分钟只记一次。

## 验证

- 新增 `scripts/test-allowlist.mjs`：事故现场复现（只剩机器人自己 → 换成主人）、
  保留用户条目、幂等、去重/非法值、积压挑选、三处写入与补唤醒接线；
- `test-token-guard`：day 带 retryAfterMs、direct 豁免、`directBypassDay=false` 仍拦；
- `test-blacklist` 继续通过（控制台保存不清 deny.users）；
- `npm run test:audit` 91/91；插件测试全绿。

## 教训

**同一份配置的多个写入点必须共用一个归一化函数**；否则每加一个入口就多一种"合法"写法。
**"重启后状态恢复"是生命周期步骤，不是事件**：积压、定时器、状态机都要在启动时显式处理，
不能指望下一条消息把旧问题带出来。
