# 2026-11-06 · B站峰时闸门 + 云端 embedding 记账

## 1. 峰时闸门补到插件 scheduler

背景：Token 优化批只在桥接进程里加了 `backgroundTasksAllowed()`；B站插件的
`plugins/surfcore/lib/scheduler.js` 有独立定时器，绕过了它。

修法：

- 引入 `src/model-prices.js` 的 `isPeakAt` / `resolvePriceTable`；
- 新增 `peakOffloadActive()` 和 `peakBlockedNow()`，读
  `socialV2.cost.peakOffload`（默认 true）和 `pricing`；
- 给 5 个后台入口加闸门：
  - 生物钟 `tick`
  - 私信 `dmTick`
  - 评论区 `listenTick`
  - 直播间 `liveTick`（峰时还会停掉已挂的 danmaku 子进程）
  - 动态提醒 `dynTick`
- 每 30 分钟最多写一条“峰时顺延”日志，避免刷屏。

## 2. 云端 embedding 记账

背景：云端 embedding 走 HTTP，不进 DSH 会话用量；`token-ledger` 的
`/api/tokens/external` 已支持外部渠道，但 embedding 侧没调用。

修法分两条路径：

### runtime 路径（正常搜索 / 维护）

- `embedding-packs.js` 启动 runtime 时注入：
  - `SURFCORE_LEDGER_URL=http://127.0.0.1:<consolePort>/api/tokens/external`
  - `SURFCORE_LEDGER_TOKEN=<consoleToken>`
- `runtime/embedding-service.mjs` 云端 `/v1/embeddings` 成功后：
  - 优先用 provider 返回的 `usage.total_tokens/prompt_tokens`；
  - 没有就按文本长度估算；
  - `POST /api/tokens/external`，`channel=embedding-cloud`、`cost=0`、`note=model`；
  - 失败只写一行日志，不影响编码。

### 插件直连路径（多模型建索引 / 直连云端重建）

- `plugins/surfcore/lib/vector-memory.js` 新增 `reportDirectCloudUsage()`；
- 只在 `provider=cloud` 且有 `serviceUrl`（直连，不经 runtime）时上报；
- 维护/搜索的 `embedTexts` 返回后调用，避免 runtime 路径重复记账。

## 3. 口径

- 只记 token，不猜钱：云端 embedding 各服务商价格不同，当前 `cost=0`；
- 账本里落在 `totals.external.byChannel['embedding-cloud']`；
- 本地 Ollama embedding 不记账（不产生 API 费用）。

## 4. 验证

```
test-session-rollover     123 项全过（新增 6 条：5 个 tick + 记账接线）
test:audit                152/152
plugins/surfcore npm test 0 失败
```

## 5. 残余

- 真实云端 key 的端到端记账未验（需要 provider 可用）；
- 峰时闸门只覆盖 scheduler 的 5 个后台入口；用户手动点“立即”仍可执行。
