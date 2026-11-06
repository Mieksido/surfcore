# 2026-11-06 · 额度页省钱入口 + 成本标签 + 每会话额度 + 表情频率

## 背景

上一版把「怎么省 token」入口做进了 QQ 页，用户要求的是 **Token 额度页最上方**。
本批修正位置，并补齐第 8/13 条遗漏项。

## 改动

- `plugins/surfcore/lib/client.js`：
  - `SaveTokenEntry` + `SaveTokenTipsModal` 放到 Token 额度页最上方（预算卡片之前）；
  - 额度页加按会话花费表（今日花费 / 换会话）；
  - `FIELD_META` 成本标签表 + `F()` 自动 badge；需要重启的项标「改完需重启 DSH」；
  - 新增 `sticker.matchEveryNWakes`、`tokenGuard.perGroupEnabled`、`tokenGuard.perGroupDailyCostCNY` 设置项。
- `src/bridge.js`：
  - `stickerMatchDueV2()`：每 N 次读取/唤醒才带表情推荐，默认 1 = 每次都带；
  - `perGroupSpentToday()`（60s 缓存）+ `tokenGuardWakeBlock` 每会话额度判断，默认关；
  - 超限返回 `reason=per-group-budget`，只拦该会话。
- `config.example.json`：三个新默认值。
- 测试：`test-session-rollover` 148 项（新增位置/行为断言）；`test-stickers` 更新赋值行断言并钉默认行为。

## 验证

```
test-session-rollover      148 项全过
test:audit                 152/152
plugins/surfcore npm test  0 失败
```

## 未验证

- 机器模式真机、真 QQ 端到端、并行工具抓包；
- 每会话额度需要真实 token 账本数据验证；
- 表情频率调大后只在第 N 次带推荐，需真机看语气是否自然。

## 回滚

- 额度入口/标签：还原 `client.js`；
- 每会话额度：`tokenGuard.perGroupEnabled=false`；
- 表情频率：`sticker.matchEveryNWakes=1`；
- 不涉及版本号、tag、发布。
