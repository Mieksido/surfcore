# Token 账单文件（A+B）

> 每个角色包一份，每个 QQ 群/私聊一份；自动刷新，不调用模型。

## 输出位置

```text
~/.dsh/surfcore/billing/
  index.md                         # 总索引
  characters/<角色id>/summary.md   # 角色包账单
  conversations/group_<群号>.md    # 群账单
  conversations/private_<QQ号>.md  # 私聊账单
```

## 数据来源

| 数据 | 来源 |
| --- | --- |
| token / 金额 / 按天 / 最贵回合 | `state/token-usage.jsonl`（历史完整） |
| 唤醒原因 / 工具 / 交付 / 延迟 | `state/context-telemetry-bridge.jsonl` + `~/.dsh/surfcore/context-telemetry-plugin.jsonl` |
| 角色归因 | 遥测里的 `characterId`；只有一个角色时旧数据归到当前角色 |

## 刷新方式

- 插件启动 30 秒后生成一次；
- 之后每 **10 分钟**刷新；
- 也可以手动：

```bash
node scripts/billing-report.mjs
node scripts/billing-report.mjs --out /tmp/billing
```

只读；不调用模型；不发送消息。

## 归因规则

- **群/私聊账单**：按 `group:<群号>` / `private:<QQ号>` 精确聚合；
- **角色账单**：
  - 优先按遥测 `characterId` 归因；
  - 只有一个角色时，历史 token 全部归到当前角色（明确标 `single-character`）；
  - 多角色且无遥测时，归到 `_unattributed`，不猜。

## 每个文件包含

- 总览：调用、输入、缓存命中/未命中、输出、总成本；
- 按天；
- 按唤醒原因（次数、模型调用、成本、平均 prompt 字符）；
- 工具（调用、平均结果字符、错误）；
- 交付：唤醒、有发送、close、首次发送延迟 P50/P90；
- 最贵回合 Top 12；
- 数据质量说明。

## 限制

- 金额是本地价目表估算，不是服务商发票；
- 没有遥测的旧数据只有 token/金额，没有唤醒/工具/延迟；
- 群成员个人成本无法精确分摊；**群账单只到群，不按群友拆**；
- 账单不记录消息正文。

## 出问题

| 症状 | 检查 |
| --- | --- |
| 没有 billing 目录 | 插件是否重启；`billing.start()` 是否在运行 |
| 角色账单为空 | `characters/index.json` 是否有角色；遥测是否有 `characterId` |
| 群账单没有工具/延迟 | 遥测是否覆盖该时段；bridge 是否重启 |
| 金额和服务商不一致 | 本地价目表/高峰判断不同；以服务商账单为准 |
| 角色归错 | 是否多角色但没有遥测；检查 `characterId` |
