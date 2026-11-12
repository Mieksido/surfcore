# 2026-10-31 · L3「同一工具和错误反复出现，本轮已停止」到底怎么回事

## 现场（gate-events.jsonl）

```
2026-10-31T07:51:48Z L3 turn-guard TURN_REPEATED_TOOL_ERROR stopped
subject: group:496972996 / session-88a2bf96…
evidence.tool: mcp__snowluma__qq_close_conversation
evidence.count: 3 / maxRepeatedErrors: 3
fingerprint: qq_close_conversation:Error: 收尾失败：对方最近一条不是你的消息…建议先 qq_send_message
```

## 结论

**不是通道故障，也不是模型"坏了"**：模型在同一个回合里连续 3 次调用 `qq_close_conversation`，
每次都被业务规则拒绝（对方最后一条不是她发的 / 还没到收尾条件），错误文案里已经写了
「建议先 qq_send_message」，但模型继续重试 → 单轮止血按阈值停掉了这一轮。

## 架构问题

`turn-guard` 把**所有工具错误**都当成"重试循环"计数：

- 环境错误（连接失败、超时、5xx）→ 重试无意义，停轮正确；
- **业务拒绝**（收尾条件不满足、白名单拒绝、参数不对）→ 自带下一步，停轮只会让用户
  看到"莫名其妙被中断"，而模型本可以改走别的操作。

## 修法

- `turn-guard` 新增 `isExpectedToolError()`：收尾失败/不能/请先/白名单/未授权/参数/格式/限流/
  未开启等**预期内拒绝不计入重复错误止血**；环境错误仍按阈值停轮；
- L3 弹窗补 `工具 / 错误摘要 / 会话`，不再只有泛化文案；
- 阈值仍可调（`socialV2.turnGuard.maxSteps / maxRepeatedErrors`）。

## 验证

- `test-gate-events`：业务拒绝重复不停轮；环境错误到阈值仍停；
- `test-client-contract`：弹窗显示工具/错误/会话；
- audit 99/99；插件测试全绿。

## 教训

**"错误"要先分类再决定要不要止血**：可预期、带下一步的业务拒绝 ≠ 环境故障。
把它们混在一起，用户会为模型的固执买单（回合被停），却看不到真正的原因。
