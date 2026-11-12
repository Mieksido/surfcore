# Phase 3：启动补唤醒限量（backlog cap）

- **日期**：2026-10-31
- **前置**：Phase 1A 样本中 backlog 是最贵的唤醒类型（7 次 ¥0.933）。
- **范围**：只改“启动时一次补唤醒多少个会话”，不改 backlog 内容、不合并 prompt、不改模型。

## 1. 链路

```text
bridge 启动 / DSH 恢复
  → wakeBacklogConversations('boot')
  → pickBacklogSessions()
  → 按未读条数降序
  → backlogMaxSessions（默认 3，范围 1~20）
  → sendWakePromptV2(key, 'backlog')
```

## 2. 机制

- 原来硬编码 `slice(0, 5)`；
- 现在：

```js
const cap = Math.max(1, Math.min(20,
  Number(cfg.socialV2?.wake?.backlogMaxSessions) || 3));
const backlog = all.sort((a, b) => b.unread - a.unread).slice(0, cap);
```

- 默认从 5 降到 3：backlog 冷启动最贵，先处理最积压的 3 个，其余留到下一轮/自然唤醒；
- 设置页「高级设置 → 启动补唤醒最多会话数」可调 1~20；
- 不改变未读、不丢弃消息、不改唤醒配置。

## 3. 取舍

- **A：不限量**：会一次创建大量冷会话，最贵。
- **B：完全关闭 backlog**：会漏掉重启期间的消息。
- **C：默认 3、可配置**（采用）：保留补历史能力，先处理最积压的。
- 未做“跨会话合并 prompt”：不同会话上下文不能混。

## 4. 爆炸半径

- 重启后补唤醒数量减少；未处理的会话保留 unread，后续自然唤醒仍能处理；
- 不删消息、不改状态；
- 需要重启 QQ 桥接生效。

## 5. 验证

```bash
node scripts/test-backlog-cap.mjs
cd plugins/surfcore && npm test
cd ../.. && npm run test:audit
```

## 6. 回滚与残余

- 回滚：把 `socialV2.wake.backlogMaxSessions` 调回 5，或恢复硬编码；
- 未做前后 token 对照（需要重启后同场景采样）；
- 未处理 keyword 噪音和 close-only 路径。
