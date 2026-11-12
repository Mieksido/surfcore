# A+B Token 账单写入 Markdown

- **日期**：2026-10-31
- **口径**：每个角色包一份；每个 QQ 群/私聊一份。
- **范围**：只读 token 账本 + 遥测，写 Markdown；不调用模型、不发送消息。

## 1. 产物

```text
~/.dsh/surfcore/billing/
  index.md
  characters/<角色id>/summary.md
  conversations/group_<群号>.md
  conversations/private_<QQ号>.md
```

## 2. 归因

- 群/私聊：按 token 账本 key 精确聚合；
- 角色：优先 `characterId`；
- 只有一个角色：旧数据整体归当前角色，并标 `single-character`；
- 多角色无遥测：`_unattributed`，不猜。

## 3. 自动刷新

- 插件启动 30 秒后生成一次；
- 之后每 10 分钟刷新；
- 手动：`node scripts/billing-report.mjs`。

## 4. 每个账单包含

- 总览、按天、唤醒原因、工具、交付延迟、最贵回合、数据质量；
- 唤醒原因带“遥测模型调用/成本”；
- 角色账单带会话排行。

## 5. 限制

- 金额为本地价目表估算；
- 无遥测的旧数据没有工具/延迟；
- 群内个人成本不精确分摊；
- 不记录正文。

## 6. 验证

```bash
node scripts/test-billing-report.mjs
node scripts/test-billing-service.mjs
node scripts/billing-report.mjs
```

## 7. 回滚

- 删除 `billing/` 目录；
- 移除插件里的 `createBillingService` 启动/定时器；
- 不影响对话、唤醒、token 账本。
