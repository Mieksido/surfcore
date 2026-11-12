# 2026-11-07 · 会话滚动改为「当前上下文」，默认关闭；开启后 50 万

## 现象

测试机反馈：

```text
23:15:55 [rollover] group:239276380 已用 3925403 token / 2 次唤醒，换新会话
23:18:09 [rollover] group:239276380 已用 3889253 token / 2 次唤醒，换新会话
23:23:54 [rollover] group:239276380 已用 1832370 token / 2 次唤醒，换新会话
23:32:54 [rollover] private:878543861 已用 6975800 token / 2 次唤醒，换新会话
```

一条正常会话两轮唤醒就超过 80 万～700 万，从 23:15 之后连续滚了 40 次，会话映射散成
`private:878543861 -> session-47da7395` 等多个旧 id。

## 根因

`maybeRollSessionV2()` 之前用：

```js
tokenLedger.sessionTotal(sessionId) - sessionBaseTokens
```

`sessionTotal()` 是**这条会话历史累计计费量**：

- 每轮请求都会把整段上下文重新发一遍；
- 工具调用、重试、缓存命中都计入；
- 一条正常长会话 2 轮就能到几百万。

所以 `rolloverTokens = 80000` 实际是「累计账单到 8 万就换」，不是「当前上下文到 8 万」。
一个正常会话每次唤醒都超过 8 万账单，于是每次都换。

## 修法

### 1. 指标改为当前上下文

`src/token-ledger.js` 新增：

```js
sessionContextTokens(sessionId)
```

取该会话**最近一次 assistant usage** 的 input 桶：

```text
cacheMiss + cacheHit + cacheWrite
```

不含 output，不累加历史。没有采样时返回 0，不拿累计账单兜底。

### 2. 配置改为新字段，且默认关闭

- **默认关闭**：`rolloverEnabled=false`，新用户不主动换会话；
- 用户手动开启时，UI 弹出确认，明确说明：
  - 下一轮会新建 DSH 会话；
  - 旧会话停止归档，聊天上下文不再续接，只靠交接摘要和记忆卡接上；
  - 可能遗忘前文、回答不连贯；
  - 换会话后缓存重建，短期费用/延迟可能上升。
- 新字段：`socialV2.context.rolloverContextTokens`
- 开启后的默认阈值：`500000`（50 万当前上下文）
- 旧字段 `rolloverTokens` **不再作为上下文阈值**；老配置里的 80000 不会误触发。
- 设置页、省钱预设、`config.example.json`、bridge 默认值全部同步：
  - 省钱：20 万
  - 均衡：50 万
  - 活跃：80 万

### 3. 日志可区分

滚动日志同时打出：

```text
上下文 420000 / 累计 3900000 token / 2 次唤醒
```

以后一眼能看出是上下文真的太大，还是累计账单大。

### 4. 保留 P0 延时

到阈值仍然只是 `rolloverPending`，下一轮投递开始前才退休；当前轮不会因为轮换 token 丢回复。

## 验证

```
node scripts/test-token-usage.mjs       通过（新增 sessionContextTokens 断言）
node scripts/test-session-rollover.mjs  191 项全过（默认关闭 / 500000 / 旧字段 80000 被忽略）
npm run test:audit                      153/153
```

新增断言：

- 同一会话两步累计 5700 token，但最近上下文只有 400；
- 重试后上下文取最后一次请求 input；
- 当前上下文 499,999 不滚，500,000 才滚；
- 旧 `rolloverTokens: 80000` 不再被当作上下文阈值。

## 回滚

- 软回滚：设置页关「会话太长自动换新会话」；
- 或把 `rolloverContextTokens` 调到 0 且 `rolloverTurns` 调到 0；
- 代码回滚：恢复 `maybeRollSessionV2` 使用 `sessionTotal()`，并还原字段名。

## 残余

- 当前上下文指标依赖 DSH 上报 assistant usage；没有采样时只按轮数/开关判断；
- 50 万是给 100 万上下文窗口留余量，具体模型可按设置页调小/调大。
