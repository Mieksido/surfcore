# Phase 1A：调用链重建（只读）

- **日期**：2026-10-31
- **范围**：按 `wakeId` 重建 wake → turn/step → tool call 链；只读报告，不改 close/wait/send、
  不改调用上限、不改调度。
- **上游**：Phase 0A 遥测（`2026-10-31-context-telemetry.md`）。

## 1. 链路

```text
bridge deliverPromptNow
  ├─ 生成 wakeId
  ├─ contextTelemetry.wake({wakeId, reason, promptChars})
  └─ sessionWakeIds.set(sessionId, wakeId)
        ↓
DSH session/event
  turn/start / model usage / tool call/result / turn/end
        ↓
bridge 侧 contextTelemetry.ingestEvent(..., {wakeId, key})
        ↓
state/context-telemetry-bridge.jsonl（带 wakeId）
        +
~/.dsh/surfcore/context-telemetry-plugin.jsonl（全量，无 wakeId）
        ↓
scripts/context-call-chain-report.mjs
  ├─ bridge 优先、plugin 去重
  ├─ wakeId 优先；旧数据按 session + 最近 wake 兜底
  └─ 路径 / 模型调用数 / 交付 / close / 成本
```

## 2. 机制

- `wakeId` 在真正投递 prompt 时生成并写入 bridge 遥测；
- bridge 对 QQ 会话事件记录 `wakeId + key`；
- 插件仍记录所有 SurfCore 会话；
- 报告按 `(sessionId, turn, step, retry)` 去重：带 `wakeId` 的 bridge 记录优先；
- `delivered` = 路径中出现 `qq_send_*` / `qq_reply`；
- `closed` = 路径中出现 `qq_close_conversation`；
- `observedOnly` = 既没发送、也没 close/mark_read/set_wake；
- 成本按 `priceUsage` 逐次调用计算，和 Phase 0A 同一价目表。

**不改变任何行为。** 只增加 bridge 侧旁路事件记录和报告。

## 3. 实测样本（重启后约 1 小时，48 次唤醒）

```text
wake=48
model calls/wake: p50=2 p90=4 p99=11 max=15
delivered=17  closed=44  observedOnly=0  errors=6
cost/wake=¥0.0559  total=¥2.6847
```

### 路径 Top

| 路径 | 唤醒 | 模型调用 | 成本 | 交付 |
| --- | ---: | ---: | ---: | ---: |
| `close` | 26 | 52 | ¥0.699 | 0/26 |
| `send → close` | 10 | 30 | ¥0.342 | 10/10 |
| `mark_read` | 3 | 6 | ¥0.081 | 0/3 |
| `get_forward → send → wait → close` | 1 | 5 | ¥0.764 | 1/1 |
| 长路径（15 调用） | 1 | 15 | ¥0.174 | 1/1 |
| `wait → wait → close` | 1 | 4 | ¥0.040 | 0/1 |

### 交付 vs 未交付

| 类别 | 唤醒 | 模型调用 | 成本 | 平均调用 |
| --- | ---: | ---: | ---: | ---: |
| 有发送 | 17 | 76 | ¥1.80 | 4.47 |
| 无发送 | 31 | 66 | ¥0.89 | 2.13 |
| 其中 close-only | 26 | 52 | ¥0.699 | 2.00 |

**65% 唤醒没有发消息，但只占 33% 成本。**  
close-only 占 54% 唤醒、26% 成本、37% 模型调用。

> 不能把“没发消息”直接叫浪费：有些确实是自然收尾；必须按唤醒原因和语义复核。

### 按唤醒原因

| 原因 | 唤醒 | 模型调用 | 成本 | 交付 | 错误 |
| --- | ---: | ---: | ---: | ---: | ---: |
| question | 15 | 44 | ¥0.781 | 4/15 | 4 |
| keyword:大肥鱼 | 12 | 24 | ¥0.345 | 0/12 | 0 |
| backlog | 7 | 19 | ¥0.933 | 1/7 | 0 |
| atMention | 7 | 22 | ¥0.242 | 7/7 | 0 |
| poke | 4 | 11 | ¥0.124 | 3/4 | 0 |
| private | 2 | 20 | ¥0.234 | 2/2 | 2 |
| replyCheck | 1 | 2 | ¥0.025 | 0/1 | 0 |

- **backlog 7 次唤醒成本 ¥0.933**：冷启动/补历史，明显高于普通唤醒；
- **keyword 12 次全部未发送**：关键词触发噪音，需要复核是否该醒；
- **question 15 次只 4 次发送、4 次错误**：需要看是否漏回复/工具失败；
- **atMention 7/7 交付**：即时唤醒路径最健康。

## 3.1 后续样本（Phase 2 诊断，约 69 次唤醒）

运行一段时间后，同样的报告显示：

```text
wake=69 delivered=17 closed=65 cost=¥3.341
close-only: wakes=47 calls=94 cost=¥1.356
no-send question: wakes=22 calls=46 cost=¥0.645
no-send keyword:大肥鱼: wakes=19 calls=38 cost=¥0.580
backlog: wakes=10 calls=25 cost=¥1.035
```

这说明：

- close-only 不是一次性现象，而是稳定路径；
- keyword 19 次全部未发送，是稳定的噪音候选；
- backlog 仍是最贵的单类路径；
- 但 close 有真实状态副作用，不能按频率直接删除。

**Phase 2 结论：先做 backlog 合并/筛选和 keyword 退避实验，不做自动 close。**

## 4. 爆炸半径

- 新增 bridge 侧遥测事件记录；
- 不改 close/wait/send 状态机；
- 不改调用上限、不自动收尾、不合并唤醒；
- 报告只读；数据文件本地。

## 5. 取舍

- **A：直接按 close 频率删 close**：数据不足，且 close 有 closure/已读/唤醒安全状态，禁止。
- **B：先重建调用链，再语义复核**（采用）：慢一步，但能区分“必要收尾”和“重复决策”。
- **C：直接设统一调用上限**：会误伤长任务，且没有成功率指标；不做。

## 6. 生效与重启

- bridge 侧 `wakeId` 关联需要重启 QQ 桥接；
- 插件侧不需要额外配置；
- 报告随时可跑。

## 7. 验证

```bash
node scripts/test-context-call-chain.mjs
node scripts/context-call-chain-report.mjs
node scripts/context-call-chain-report.mjs --json
cd plugins/surfcore && npm test
cd ../.. && npm run test:audit
```

覆盖：

- bridge/plugin 同调用去重；
- wakeId 归属；
- 无 wakeId 旧数据兜底；
- 路径 / delivered / closed / 成本聚合。

## 8. 结论与下一步

这版只回答“链长什么样”，没有回答“哪条 close 可以删”。

下一步必须先做语义复核：

1. `close-only` 的 26 次，按原因抽样：自然结束 / 无话可说 / 工具失败 / 误触发；
2. `keyword` 12 次无交付：是否触发面太宽；
3. `backlog` 7 次 ¥0.933：能否合并成更少的唤醒；
4. `question` 4 次错误：是否漏回复；
5. 定义“成功回复/成功收尾/漏回复/重复回复”，再决定调用上限。

**在这些完成前，不改 close、不改统一调用上限、不自动合并唤醒。**
