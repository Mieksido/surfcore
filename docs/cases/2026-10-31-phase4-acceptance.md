# Phase 4：模型/推理强度验收与架构差异

- **日期**：2026-10-31
- **范围**：补交付延迟、成本/交付指标；**不改 reasoningEffort、不改模型、不加统一调用上限**。
- **原因**：没有“成功回复/漏回复”的正式定义前，直接降思考强度可能省 token 但变笨。

## 1. 新增验收指标

调用链报告新增：

- `deliveredLatency.p50 / p90 / avg`：从 wake 到第一次发送的耗时；
- `avgCostDelivered`：每次“有发送”的唤醒平均成本；
- `review.closeOnly`：close-only 的唤醒/调用/成本/未读/历史计数；
- `review.noSendByReason`：按原因看未发送的分布。

## 2. 当前样本（约 106 次唤醒）

```text
wake=106
delivered=24  closed=102  close-only=77  errors=13
model calls/wake: p50=2 p90=4 p99=5 max=15
cost/wake=¥0.0447  total=¥4.7396
delivered latency: p50=3386ms p90=5272ms avg=6911ms
cost/delivered=¥0.1002
```

含义：

- 有发送的唤醒平均 ¥0.10；非发送更便宜；
- close-only 77 次，是稳定路径，不是偶发；
- p90 交付延迟 5.3 秒，暂未出现显著不可用延迟；
- 误差/失败 13 次，需要语义复核，不能只用成本判断。

## 3. 为什么本批不改模型/思考强度

历史账单：

- 输出 token 占成本 10.8%；
- `dsh.reasoningEffort` 当前默认 `max`；
- 没有 A/B 对照，也没有“成功回复/漏回复”指标。

如果现在直接把 `max` 降到 `medium`：

- 账面可能降 5–10%；
- 但工具选择错误、回复质量下降、重复回复可能上升；
- 无法证明是“省钱”还是“变笨”。

所以本批只做**验收框架**，不启用模型策略。

## 4. Phase 4 验收门（将来启用前必须过）

1. 固定 prompt、工具、模型、时段；
2. 仅改变 reasoningEffort 一个变量；
3. 同一批任务类型（QQ 回复/主动/B站/桌宠）对照；
4. 指标：
   - 每成功任务成本；
   - 每次成功回复延迟；
   - 工具选择正确率；
   - 漏回复/重复回复率；
   - 失败率；
   - 超预算次数。
5. 任一质量指标明显下降 → 回滚，不发布。

## 5. 当前架构差异

见 [ARCHITECTURE-DELTA-TOKEN.md](../ARCHITECTURE-DELTA-TOKEN.md)：

- 人格分层；
- 遥测；
- 调用链；
- backlog 上限；
- 没有 close/keyword/模型改动。

## 6. 验证

```bash
node scripts/test-context-call-chain.mjs
node scripts/context-call-chain-report.mjs
node scripts/context-telemetry-report.mjs
cd plugins/surfcore && npm test
cd ../.. && npm run test:audit
```

## 7. 回滚与残余

- 本批没有模型行为改动，无需回滚；
- 延迟指标是观测值，不是性能承诺；
- 交付延迟只统计到第一次发送，不含 QQ 实际到达；
- 样本仍受重启/backlog 影响，不能当稳定基线。
