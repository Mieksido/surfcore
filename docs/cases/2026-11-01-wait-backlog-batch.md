# qq_wait_for_messages 积压消息不立即返回

日期：2026-11-01

## 1. 现象

用户私聊在鱼思考期间到达；SnowLuma 日志正常、消息已进桥接，但 `qq_wait_for_messages` 开始后仍要等很久才返回。用户已把私聊唤醒合并窗口 8s→3s、wait 静默 10s→1s。

## 2. 根因

1. **积压被发现后从 wait 时刻重新计时**  
   `lastNewAt = Date.now()`，不是消息到达时间；已经积压的消息还要再等一个 quietMs。
2. **turnActive 依赖 turn/start**  
   事件晚到/丢失时 baseline 回退到 `lastUnreadSeq`，积压被当成“已看过”，wait 继续等新消息。
3. **静默下限覆盖用户设置**  
   `defaultQuietMs` 设为 1s 时，`minQuietAfterNewMs` 仍可能把 quiet 抬回 10s。
4. **群聊积压没有 wait 专用上限**  
   依赖 `unreadLimit/recentLimit`，可能一次交付接近 100 条，既慢又费上下文。

## 3. 修法

- wait 开始先算 `readThroughAtStart` 和未读 backlog；agent 的 wait 只要看到 backlog，就把 baseline 降到模型已读水位，不再依赖 turnActive。
- 有 backlog 时**立即返回**，不再从 wait 时刻等 quiet。
- 返回按 `maxBatchMessages`（默认 20）和 `maxBatchChars`（默认 4000）有界：
  - 优先主人/引用自己/直接叫自己/拍自己；
  - 再用最近消息补足；
  - 超出部分给 `foldedCount/foldedPreview`。
- 群聊折叠旧未读（仍可从 recent 回看）；私聊不静默删除，宁可下次再给。
- `src/v2-wait.js` 抽出 `selectWaitBatch` 纯函数，单测覆盖。
- scheduler 的 wait 工具描述补充“有界交付”契约。

## 4. 行为

```text
purpose=messages：
  有本轮未读 → 立即返回（有界批量）
  没有 → 才等新消息
  新消息到达 → 从到达时间等 quiet，不抢话

purpose=reply：
  保持从最后来信时间计算静默，不改变原语义
```

## 5. 验证

```text
node scripts/test-v2-wait-batch.mjs
node scripts/test-audit-regressions.mjs   # R17 实测 wait 积压立即返回 + 批量上限
npm run test:audit                        # 119/119
cd plugins/surfcore && npm test           # 0 失败
```

## 6. 风险

- 群聊折叠旧消息后，模型只看到计数/短预览；需要原文可从 recent 回看。
- 批量上限可能漏掉不重要的旧群聊；私聊保留，不静默丢。
- 静默下限仍是防抢话保护；用户只改 defaultQuietMs 时，minQuietAfterNewMs 仍可能盖住，需要 UI 说明。
- 低静默可能让鱼在对方连续输入时抢话；建议私聊 1s、群聊更保守。
- 没有真实 QQ 长轮询 live 压测；R17 是桥接 harness。
