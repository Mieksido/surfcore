# 记忆 API 落地路线：旧运行时适配层（给后端会话）

> 写于 2026-11-11。前端：`surfcore-ui` v0.26.3；后端：`surfcore-persona-core`。
> 目的：让 `/surfcore-api/memory` 在**不先改造运行时**的前提下，尽快返回真实数据。
> 结论先行：**先做旧状态适配层，不要先接线新内核。**

---

## 1. 观察到的现状（读代码 + 只读核对 state）

### 1.1 两套记忆实现

| 实现 | 位置 | 是否在跑 | 数据 |
| --- | --- | --- | --- |
| 旧：记忆卡 + 全量卡 | `src/memory-card.js`、`plugins/surfcore/lib/memory-card.js` | **是**（插件调度/桥接注入） | `~/.dsh/surfcore/memory/memory-card.json`（115 KB）、`memory-card-full.jsonl`（3.8 MB） |
| 旧：向量记忆 | `src/vector-memory.js`、`plugins/surfcore/lib/vector-memory.js` | **是**（与记忆卡并行） | `~/.dsh/surfcore/memory/vector-memory.jsonl`（当前不存在 = 0 条）；索引按 modelSpace 分文件 |
| 旧：Embedding 包 | `src/embedding-packs.js`、`plugins/surfcore/lib/embedding-packs.js` | **是** | `~/.dsh/surfcore/embedding-packs/`：`bge-m3`、`bge-small-zh-v1.5`、`qwen3-embedding-0.6b`、`runtime`、`cloud` |
| 新：内核记忆 | `kernel/memory/index.js`、`kernel/index.js` | **否** | `state/persona-core/kernel-state.json` **不存在**；`createKernel` 没有被 `src/` 或 `plugins/` import |

新内核是完整的、带测试的，但**只被 `kernel/index.js` 总装使用，而总装没有接进运行时**。所以现在让 API 读新内核，只会返回空。

### 1.2 运行时配置（`~/.dsh/surfcore/config.json`）

```text
memory.mode = narrative
vectorMemory.enabled = true
vectorMemory.provider = local
vectorMemory.modelSpace = bge-m3@1024-f16-v1
vectorMemory.batchSize = 32
vectorMemory.injectMaxChars = 600
memoryCard.maxRecords = 600
```

云端 `cloud/config.json`：四个 provider（`siliconflow` / `zhipu` / `alibaba` / `openai`）都已保存 endpoint/model/modelSpace/key（`hasKey=true`，活动 provider 是 `siliconflow`）。**Key 绝对不能回显**；旧代码已有 `publicCloudProfile()` 只返回 `hasKey/keyMasked`。

---

## 2. 推荐路线

### A. 旧状态适配层（推荐，先做）

在 `plugins/surfcore/lib/index.js` 新增一个**独立路由前缀** `/surfcore-api/memory`，只做契约投影，复用现有函数：

- 读：`memoryCardSnapshot`、`fullMemoryCardSnapshot`、`vectorMemoryStatusNow`、`embeddingPacksStatus`
- 写：`saveUnified`（mode / vectorMemory）、`runVectorMemoryMaintenance`、`rebuildVectorMemory`、`startEmbeddingPackInstall`、`startEmbeddingRuntime` / `stopEmbeddingRuntime`、`saveCloudPackConfig`、`getCloudProviderProfile` + `embedTexts`
- job：复用 `embedding-packs.js` 的 `JOBS`，再加一个进程内 registry 管 maintain/rebuild

优点：**今天就能出真实数据**；UI 已按契约写好，几乎不用改。
代价：契约形状由适配层负责；旧实现与新内核语义有差异（见第 5 节）；未来换内核时保持 API 不变、换内部实现即可。

### B. 先接线新内核（不推荐现在做）

需要：把 `createKernel` 接进桥接/插件、决定 ingest 入口、迁移旧 `memory-card`/`memory-card-full`/向量索引、双写与回滚、改提示词读取路径。风险大、周期长，而且 UI 在新内核积累数据前会一直空。

### C. 混合（推荐落地方式）

**A 的 API 外壳 + 稳定的契约**；新内核接线作为后续独立任务，完成后只换实现，API/UI 不动。契约版本保持 v1，新增字段走 v2。

---

## 3. 端点映射（契约 → 旧实现）

| 契约 | 建议实现 | 备注 |
| --- | --- | --- |
| `GET /overview` | mode=`readUnified().config.memory.mode`；config=`vectorMemory`；stats=卡/全量/向量；vector=`vectorMemoryStatusNow` + spaces；controlAvailable=路由已挂载 | `maxChars` = `injectMaxChars`；`modelSpace` 用 effective（cloud 时 `cloudModelSpace`） |
| `GET /settings` | 字段声明用 `KERNEL_SETTINGS`（label/cost/options/group），值从 legacy config 映射 | 6 项有真实生效点；`dedupeDays`/`initialDays` 旧实现没有（见 5.4） |
| `GET /narrative?tab=decay` | `memoryCardSnapshot` / 轻量 `loadMemoryCard` 投影 | 旧快照最多 80 条、已排序；cursor 用 offset |
| `GET /narrative?tab=full` | `recallFullMemory(paths, q, {limit})` 或 `tailFullRecords` | 初始 `nextCursor=null`；大档案不要整份读 |
| `GET /vector/status` | `vectorMemoryStatusNow(config)` + 每个已装模型/云 provider 的 `readVectorIndexMeta` | `spaces` 由后者拼 |
| `GET /vector/models` | `embeddingPacksStatus()` → local/runtime/providers | `dimension→dim`；runtime 状态由 `service.ok` + runtime 包判断；provider 只回 `configured/status` |
| `POST /mode` | `saveUnified({ memory: { mode } })` | 桥接按 mtime 重读；调度器每轮读 unified |
| `POST /vector/config` | `saveUnified({ vectorMemory: { enabled, batchSize, injectMaxChars, … } })` | `maxChars→injectMaxChars`；`modelSpace` 必须能解析到已装模型或已存 provider，否则 400，不要写一个没有模型的 space |
| `POST /vector/maintain` | `runVectorMemoryMaintenanceNow({config})` → job | 旧实现是 async，包成 job；`limit` 可覆盖 `maxEmbedPerTick` |
| `POST /vector/rebuild` | `rebuildVectorMemory(targetConfig)` 或 `rebuildAllVectorIndexes` → job | 只重建指定 modelSpace；完成后 pending 可能仍需 maintain |
| `GET /jobs/:id` | 统一 registry：pack job + maintain/rebuild job | 旧 job `state` 是 `running/done/error` → 映射 `error→failed`；`progress` 0–100，`total=100` 或字节 |
| `POST /models/import` | 保存上传 zip 到临时文件 → `startEmbeddingPackInstall({source})` → job | **现有 `route()` 写操作强制 JSON，multipart 会被 415**，新前缀必须单独放行 multipart |
| `POST /runtime/enable` | `startEmbeddingRuntime` / `stopEmbeddingRuntime` | 可返回 job 或 `{status}`；UI 两者都支持 |
| `POST /providers/:id/config` | `saveCloudPackConfig({provider:id,…,activate:false})` | 建议保存不激活；切换读取由 modelSpace / 单独启用动作完成 |
| `POST /providers/:id/test` | `getCloudProviderProfile(id)` + `embedTexts`（用该 profile，不切活动 provider） | 返回 `dim/latencyMs`；不要写日志里的 key |
| `GET /library` | `listVectorMemoryRecords` / `searchVectorMemoryRecords` | UI 暂不开放入口；若要开放先补可见性规则 |

---

## 4. 路由与鉴权（必须照现有约定）

现有插件路由在 `plugins/surfcore/lib/index.js`：

- `route('prefix', '/dsh-surfcore/api', …)`（约 L712/L4287）包装器做了：只允许 loopback、写操作必须同源、写操作 `content-type: application/json`、`connection.requestRejection`（DSH 会话）、统一 try/catch。
- 新前缀 `/surfcore-api/memory` 建议复用同样的 guard，但**为 import 单独放宽 multipart**；错误仍用统一信封 `{ok:false,error:{code,message,hint,retryable}}`。
- UI 的 fetch 是同源、带 cookie；POST JSON 带 `content-type`，import 用 `FormData`（不手写 content-type）。
- 如果希望远程访问也能用，需要去掉 `isLoopbackReq` 但保留 `connection.requestRejection` + 同源写保护；否则远程会 403，UI 会显示「请求失败」而不是「待接入」。

---

## 5. 语义差异（写适配层时必须处理）

1. **`maxChars`**：契约叫 `maxChars`，旧配置叫 `injectMaxChars`；必须双向映射，否则 UI 显示 600、保存 1200 却无效。
2. **`modelSpace`**：旧实现分 local/cloud 两套字段（`modelSpace` / `cloudModelSpace`）。契约只给一个 `modelSpace`，适配层要按它解析到：
   - 已安装 model pack → `provider:'local', model, modelSpace, packId`
   - 已保存 cloud provider → `provider:'cloud', cloudModel, cloudModelSpace, packId:'cloud'`
   - 都解析不到 → `400 vector.space-unknown`，不要落一个没有模型的 space。
3. **provider id**：旧实现是 `siliconflow/zhipu/alibaba/openai`；前端已兼容 `alibaba`/`bailian`/“阿里云百炼”。新契约若想用 `dashscope`，需要后端显式映射，别两边各叫一套。
4. **`dedupeDays` / `initialDays`**：只在**新内核**里有生效点（`kernel/settings/limits.js` → `memory.configure`）。旧 `memory-card` 没有这两个阈值。适配层不要“存了但没用”：建议返回 `warning: "当前运行时未使用（等内核迁移）"` 且**不提供写入**；或先只返回 6 项。`memory.maxRecords` 有旧生效点（`memoryCard.maxRecords`），可以开放。
5. **job 状态**：旧 pack job 用 `state:'error'`，契约写 `failed`；适配层必须映射。前端已兜底：`error→failed`，认不出的状态 → `unknown` 并停止轮询，不会无限转圈。
6. **`full` 分页**：旧全量卡是 append-only JSONL，没有 cursor。先 `nextCursor=null`；要真分页用 `scanFullRecords` + offset/时间游标，不要一次读整份 3.8MB+。
7. **可见性**：旧 `memoryCardSnapshot` 不按 viewer 过滤；`visibleFor(card, platform='all')` 是管理员视图（敏感也可见）。DSH 面板是 owner/admin 控制台，建议明确按 **admin 视图**返回并写进契约；如果将来做观众视图，再加 viewer 参数。不要一边说“已过滤”一边直接 `snapshot()`。
8. **状态一致性**：`vectorMemoryStatusNow().records` 来自 `vector-memory.jsonl`（当前 0 条），而 `spaces` 可能从索引 manifest 读出非 0。适配层要用同一数据源或明确标注“索引存在但记录源为空”。不要让 UI 出现“records=0 但 spaces.indexed=12”而不解释。

---

## 6. 分阶段交付（建议顺序）

| 阶段 | 内容 | 完成标志 |
| --- | --- | --- |
| 0 | 新前缀 + 统一信封 + loopback/同源/会话 guard | `GET /overview` 200，404 不再出现 |
| 1 | `/overview`、`/settings`、`/narrative`（decay/full）只读 | UI 顶部显示「实时接口」；叙事两 tab 有真实卡 |
| 2 | `/mode`、`/vector/config` | 切换读取方式真实生效；config 字段映射正确 |
| 3 | `/vector/status`、`/vector/models` | 3 个本地模型 + runtime + 4 家 provider 正确显示 |
| 4 | `/jobs/:id` + `/vector/maintain` + `/vector/rebuild` | 编码/重建有进度；`error→failed` |
| 5 | `/models/import` multipart + `/runtime/enable` | 导入 zip 有 job；runtime 启停可见 |
| 6 | `/providers/:id/config`、`/providers/:id/test` | 保存不激活、测试返回 dim/latency、Key 不回显 |
| 7 | v2：`capabilities`、`settings.fields[].writable`、`providers[]` 回读 endpoint/model/modelSpace、`GET /jobs` 列表 | UI 不再靠 501 试探；表单可回填 |

---

## 7. 验收（前后端一起看）

1. 打开记忆页：顶部不再「后端待接入」，显示 `读取方式 · 叙事记忆` + `实时接口`。
2. 叙事 tab：衰减卡有数据；全量卡能按关键词召回；加载更多不重复。
3. 切「向量记忆」：状态数字与 `vector-memory.jsonl`/索引 manifest 一致；3 个本地模型、runtime、4 家 provider 状态正确。
4. 切读取方式：`POST /mode` 后 overview 变；桥接/调度器下一轮读的是新方式（需要后端确认 mtime 重读）。
5. 编码/重建：job 进度前进；完成后 pending 下降；失败显示 code/hint。
6. 导入 zip：multipart 不被 415；job 进度；坏包显示 `pack.*` 错误，不假装成功。
7. 服务商：保存后不自动切活动 provider；测试用该 provider 的 key；任何响应/日志都不出现完整 key。
8. 未知/断线：UI 显示「状态未知」，不显示成功；job 不停在 running。

---

## 8. 需要后端拍板的 6 件事

1. 走 A（旧状态适配）还是 B（先接新内核）？**建议 A。**
2. `/surfcore-api/memory` 是否只允许 loopback？（远程 UI 会被 403）
3. provider 保存是否 `activate:false`？切换当前索引用哪个动作？
4. 是否接受 v2 字段：`capabilities`、`settings[].writable`、`providers[]` 回读、`GET /jobs`？
5. `dedupeDays`/`initialDays` 先只读标注，还是等内核迁移再出现？
6. 可见性按 owner/admin（`platform='all'`）还是按 viewer 过滤？
