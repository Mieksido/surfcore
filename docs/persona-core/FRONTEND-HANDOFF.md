# 前端交接：SurfCore UI（设计 + 实现）

> 交接对象：**前端设计/实现对话**
> 后端：`surfcore-persona-core` 对话（只做内核 / API，不再改 UI）
> 目标：前后端**分开、可同时运行**，通过一份冻结的 JSON API 契约集成。

---

## 0. 一句话

**你拥有 `D:\deepseekwork\surfcore-ui` 的一切；我拥有 `D:\deepseekwork\surfcore-persona-core` 的一切。**
你不 import 内核，我不改 UI。中间只认 **HTTP JSON API 契约**。

---

## 1. 目录与所有权

| 目录 | 谁改 | 说明 |
| --- | --- | --- |
| `D:\deepseekwork\surfcore-ui` | **你（前端）** | 壳；页面/组件/Hooks/API/类型/Store/构建/安装 |
| `D:\deepseekwork\surfcore-persona-core` | **我（后端）** | 内核/包/状态/API 服务/门禁 |
| `docs/persona-core/UI-DESIGN-RULES.md` | 共享只读 | UI 准则 + 浓缩提示词 |
| `docs/persona-core/FRONTEND-HANDOFF.md` | 共享只读 | 本文件 |
| `MEMORY-API-CONTRACT`（本文件第 4 节） | 双方 | **改契约要双方确认 + 版本号** |

**禁止**：

- 前端改 `kernel/`、`runtime/`、`packs/`、`tools/`（需要新接口 → 提给后端）。
- 后端改 `surfcore-ui/`（需要页面/交互 → 提给前端）。
- 前端直接 import 内核或用构建时文件当“实时数据”。
- 后端在 UI 里写业务逻辑。

---

## 2. 先读什么

1. [`UI-DESIGN-RULES.md`](UI-DESIGN-RULES.md) —— 必读；含页面/状态/接口映射/视觉/浓缩提示词。
2. [`ARCHITECTURE-MAP.md`](ARCHITECTURE-MAP.md) —— 四段边界；UI 是壳。
3. `surfcore-ui/HANDOFF.md` —— 当前壳版本、组件、构建/安装/刷新。
4. 本文件第 4 节 —— 记忆 API 契约。

---

## 3. 当前 UI 状态（交接点）

- 版本：**UI v0.25.9**
- 位置：`D:\deepseekwork\surfcore-ui`
- 技术：`client.template.js`（唯一手写源）→ `build.mjs` → `client.js`；DSH Client 插件；`index.js` Host 半边目前为空。
- 已有：内核四入口（意识/记忆/感官/其他）、适配器星环、区块页、模块占位页、记忆页骨架。
- 记忆页当前是**只读构建快照**：
  - 使用说明按钮 → 空页（内容待补）；
  - 读取方式弹窗 → 只能预览，保存接口未接；
  - 叙事双 tab（衰减/全量）→ 只读快照；
  - 向量总配置/本地模型/四服务商 → 按钮禁用，标「后端待补充」；
  - 设置区 8 项只读。
- **你的第一件事**：不要假装这些按钮已经能用；按第 4 节契约，把 API 层和状态机接上；API 未就绪时保持「待接入」禁用态。

构建 / 安装 / 刷新：

```powershell
cd D:\deepseekwork\surfcore-ui
node build.mjs
node --check client.js
node smoke.mjs
# 改版本号后 remove_bundle + install_bundle @local/surfcore-ui
# 浏览器 Ctrl+R；HUD 右上角看 UI vX.Y.Z
```

---

## 4. 记忆 API 契约（v1）

> Base：同源 `/surfcore-api/memory`（后端负责在 Host 侧提供；前端只 fetch 同源路径，不硬编码端口）。
> 所有响应统一信封；所有时间毫秒时间戳；所有错误必须有 `code/message/hint/retryable`。

### 4.1 响应信封

```json
{ "ok": true, "data": { } }
```

```json
{
  "ok": false,
  "error": {
    "code": "memory.control-not-wired",
    "message": "记忆控制接口未接入",
    "hint": "后端补 Host 路由后重试",
    "retryable": false
  }
}
```

### 4.2 读

#### `GET /surfcore-api/memory/overview`

```json
{
  "mode": "narrative",
  "config": {
    "enabled": true,
    "modelSpace": "default",
    "batchSize": 8,
    "maxChars": 1200
  },
  "stats": { "decay": 0, "full": 0, "vector": 0 },
  "vector": {
    "records": 0,
    "indexed": 0,
    "pending": 0,
    "failed": 0,
    "modelSpace": "default",
    "spaces": {
      "default": { "indexed": 0, "pending": 0, "failed": 0 }
    }
  },
  "controlAvailable": true,
  "capabilities": {
    "mode": true, "settingsWrite": true, "vectorConfig": true, "maintain": true, "rebuild": true,
    "jobsList": true, "modelsImport": true, "runtime": true, "providerConfig": true, "providerTest": true,
    "library": true, "projection": true
  },
  "updatedAt": 1700000000000
}
```

- `controlAvailable=false` → 所有写按钮禁用并标「后端待补充」。
- `spaces` 是**已有索引**，不是已安装模型清单。

#### `GET /surfcore-api/memory/settings`

返回 `kernel.settings.model()` 的 `surfcore/kernel` 组：

```json
{
  "groupId": "surfcore/kernel",
  "fields": [
    {
      "key": "memory.mode",
      "label": "记忆方式",
      "description": "读取哪一套…",
      "type": "choice",
      "value": "narrative",
      "defaultValue": "narrative",
      "options": ["narrative", "vector"],
      "cost": "…",
      "group": "basic",
      "isDefault": true,
      "warning": null
    }
  ]
}
```

#### `GET /surfcore-api/memory/jobs`

```json
{ "items": [ { "jobId": "mem_…", "kind": "maintain", "state": "running", "progress": 0, "total": 100, "startedAt": 0 } ] }
```

- 进程内 job；重启后清空。
- 单条详情用 `GET /jobs/:id`；旧 pack 安装 job 仍可按 id 查。

#### `POST /surfcore-api/memory/settings`

```json
{ "key": "memory.maxRecords", "value": 777 }
```

或一次多项：

```json
{ "values": { "memory.maxRecords": 777, "memory.vector.maxChars": 900 } }
```

- 可写：`memory.mode`、`memory.vector.enabled`、`memory.vector.modelSpace`、`memory.vector.batchSize`、`memory.vector.maxChars`、`memory.maxRecords`。
- 只读：`memory.dedupeDays`、`memory.initialDays`（400 `settings.read-only`）。
- 未知 key：400 `settings.unknown`；modelSpace 必须命中已装模型/已保存服务商。
- 返回 `{updated:[...], settings:{...}}`，前端可直接用返回的 settings 重绘。

#### `GET /surfcore-api/memory/narrative?tab=decay|full&q=&limit=50&cursor=`

```json
{
  "items": [
    {
      "id": "…",
      "at": 1700000000000,
      "text": "…",
      "channel": "…",
      "kind": "group",
      "actor": "…",
      "importance": 63,
      "initial": false,
      "pinned": false,
      "source": "user"
    }
  ],
  "nextCursor": null
}
```

- `tab=decay`：衰减卡；`tab=full`：全量卡（关键词 `q` 过滤）。
- 分页必须有 `limit` / `cursor`；后端没分页时先返回全部并 `nextCursor:null`，前端不能假设永远只有一页。
- 原始记录必须已按**可见性**过滤；UI 不自己猜隐私。

#### `GET /surfcore-api/memory/vector/status`

同 `overview.vector`。用于局部刷新，不重复拉全量。

#### `GET /surfcore-api/memory/vector/models`

```json
{
  "local": [
    { "id": "local-1", "name": "模型一", "version": "1.0.0", "dim": 1024, "sizeBytes": 0, "status": "installed|not-installed|running" }
  ],
  "providers": [
    { "id": "siliconflow", "name": "硅基流动", "configured": false, "status": "unconfigured|ready|error" }
  ],
  "runtime": { "status": "not-installed|installed|running", "version": null }
}
```

- 没有安装/检测能力时返回空数组，前端显示空态，不编造模型。
- 模型清单是“已检测到安装的”，不是固定三/四个假卡片。

#### `GET /surfcore-api/memory/vector/space?modelSpace=<space>&limit=800`

只读：把该模型索引里的高维向量投影成 3D 点，给「记忆空间」画布。**不返回原始 1024 维向量。**

```json
{
  "modelSpace": "bge-m3@1024-f16-v1",
  "model": "bge-m3",
  "dim": 1024,
  "method": "pca3",
  "explained": [0.23, 0.14, 0.08],
  "total": 1200,
  "eligible": 1180,
  "hidden": 20,
  "returned": 800,
  "sampled": true,
  "limit": 800,
  "points": [
    { "id": "vm_…", "x": -0.42, "y": 0.18, "z": 0.77,
      "importance": 63, "at": 1700000000000,
      "channel": "qq / group / 群名", "scene": "public|private",
      "text": "记忆正文（截断 160 字）" }
  ]
}
```

- `method` 固定 `pca3`；x/y/z 已按轴归一化到 `[-1,1]`。
- 最多 1000 点；超过按索引均匀采样，`sampled:true`，前端显示 `returned/total`。
- `sensitive` 记录不投影，计入 `hidden`；`total` 是索引总数，`eligible` 是可展示数。
- 缺失索引 → `404 memory.space-not-found`；没有 modelSpace → `400 memory.space-missing`。
- 按 `updatedAt + count + limit` 缓存；重建/编码后自动失效。
- 前端只读；不读 state 文件，不拿 `/library` 的 score 冒充坐标。

#### `GET /surfcore-api/memory/library?q=&limit=20&cursor=`

```json
{
  "items": [{ "id": "…", "text": "…", "at": 0, "score": 0.87, "channel": "…" }],
  "nextCursor": null
}
```

- **必须做可见性过滤**；没有该能力前，前端不要提供普通用户记忆库入口（标「待补充」）。

### 4.3 写

#### `POST /surfcore-api/memory/mode`

```json
{ "mode": "narrative" }
```

→ `{ "mode": "vector" }`。只改读取，不停止两套写入。

#### `POST /surfcore-api/memory/vector/config`

```json
{ "enabled": true, "modelSpace": "bge-m3@1024-cloud-v1", "batchSize": 8, "maxChars": 1200 }
```

→ 返回 `overview` 的 `config`。

#### `POST /surfcore-api/memory/vector/maintain`

```json
{ "limit": 8 }
```

→ 立即返回 job：

```json
{ "jobId": "job_…", "state": "running" }
```

#### `POST /surfcore-api/memory/vector/rebuild`

```json
{ "modelSpace": "bge-m3@1024-cloud-v1" }
```

也支持多选：

```json
{ "modelSpaces": ["bge-m3@1024-cloud-v1", "qwen3-0.6b@1024"] }
```

→ job（重建后需要再 maintain 编码）。

#### `GET /surfcore-api/memory/jobs/:id`

```json
{ "jobId": "job_…", "state": "running|done|failed", "progress": 12, "total": 50, "error": null }
```

- 前端只在页面可见且 job 运行时轮询（建议 2s，退避）；离开页面停止。
- 不允许全局 `setInterval`。

#### `POST /surfcore-api/memory/models/import`

`multipart/form-data`：`file`（zip）、`kind=local-model|runtime`。

```json
{ "jobId": "job_…", "state": "running" }
```

- 返回 `202 {jobId,state:'running'}`；job 进度走 `GET /jobs/:id`。
- 坏 zip/缺文件返回 `400` + `pack.*` code；不返回假进度。

#### `POST /surfcore-api/memory/runtime/enable`

```json
{ "enabled": true }
```

→ job 或 `{ "status": "running|not-installed|failed" }`。

#### `POST /surfcore-api/memory/providers/:id/config`

```json
{ "endpoint": "https://…/v1/embeddings", "model": "bge-m3", "apiKey": "…", "modelSpace": "bge-m3@1024-cloud-v1" }
```

→ `{ "provider": "siliconflow", "configured": true, "status": "ready" }`。  
Key 只写不回显；前端显示 `********`。

#### `POST /surfcore-api/memory/providers/:id/test`

→ `{ "ok": true, "dim": 1024, "latencyMs": 320 }` 或结构化错误。

### 4.4 动作状态

所有写操作统一：

```text
idle → submitting → success
                 → failed
                 → unknown（超时/断线）
```

- 提交中按钮禁用，文案“启动中/保存中/重建中”；
- 成功才更新业务状态；
- 失败显示 `code/message/hint` + 重试；
- 未知显示“状态未知”，不能显示已成功。

---

## 5. 同时开发怎么不撞车

| 事项 | 规则 |
| --- | --- |
| 代码 | 前端只改 `surfcore-ui`；后端只改 `surfcore-persona-core` |
| 分支/工作树 | 各自仓库/工作树；不要互相 `git switch/merge` |
| 契约 | 第 4 节冻结；改字段/新增 endpoint 先双方确认并升 `v1 → v2` |
| 数据 | 后端 API 未就绪 → 前端显示「待接入」禁用态；**禁止 mock 成功** |
| 构建 | 前端自己 `build.mjs`/`smoke`/安装；后端不跑 UI 构建 |
| 门禁 | 后端自己 `npm run test:arch`；前端自己 `smoke` + 手测 |
| 运行时 | 同一时间只允许一个进程写内核状态；UI 只通过 API，不直接写 state 文件 |
| 联调 | 后端先给 `/overview` 只读；前端接读；再逐个开写接口 |
| 版本 | UI `package.json` 升版本后 remove/install；后端 API 契约版本单独记 |

**可以同时运行**：只要 API 契约先定，前端做页面/组件/状态机/空态/错误态，后端做路由/数据/动作/job；两边用契约对齐，最后联调。

---

## 6. 前端第一轮交付（建议）

1. 读 `UI-DESIGN-RULES.md` + 本文件 + `UI HANDOFF`。
2. 把现有 `MemoryPage` 拆成：`MemoryPage`（布局）/ `MemoryUsagePage` / `MemoryModeDialog` / `NarrativePane` / `VectorPane` / `MemorySettings`；API 层单独文件/模块；Hooks 管请求与状态；不写巨大组件。
3. 接 `/overview` + `/settings` + `/narrative` 只读；API 未就绪显示「后端待接入」，不读构建快照冒充实时。
4. 写按钮先按 `controlAvailable` 禁用；不要假成功。
5. 统一视觉：沿用深蓝/青科幻 tokens，不整页纯白/纯黑。
6. 输出：页面结构、组件树、接口映射表、状态矩阵、空/错/加载态、数据更新策略。
7. 自测：`build.mjs` + `node --check client.js` + `smoke.mjs` + 刷新；记录验证限制。

---

## 7. 给前端对话的交接消息（可直接复制）

```text
你是 SurfCore 的前端设计/实现对话。你拥有 D:\deepseekwork\surfcore-ui；后端对话只改 D:\deepseekwork\surfcore-persona-core。双方通过 HTTP JSON API 契约集成，互不改对方目录。

先读：
1) D:\deepseekwork\surfcore-persona-core\docs\persona-core\UI-DESIGN-RULES.md
2) D:\deepseekwork\surfcore-persona-core\docs\persona-core\FRONTEND-HANDOFF.md
3) D:\deepseekwork\surfcore-ui\HANDOFF.md
4) 本交接第 4 节 API 契约

边界：
- 你只改 surfcore-ui；不 import 内核、不直接读/写 state 文件、不把构建快照当实时数据。
- 后端 API 未就绪时，按钮显示「后端待接入」并禁用；禁止 mock 成功、禁止乐观改业务状态。
- 每个交互必须有接口依据；没有接口写「待补充」。
- 状态至少 idle/submitting/success/failed/unknown；提交中禁用；未知不伪装成功。
- 不随意 setInterval；job 只在页面可见时轮询，离开停止。
- 沿用现有科幻视觉 tokens，禁止整页纯白/纯黑突变。

当前目标：重做记忆页
- 顶部「使用说明」→ 独立空页（内容待补）
- 「记忆读取方式」→ 叙事/向量选择；两套都存储，只改读取
- Tabs：叙事记忆（衰减/全量）/ 向量记忆
- 向量：总配置（多模型重建/导入运行时/启用）+ 本地模型（3 个 zip 槽位）+ 服务商模型（硅基流动/智谱/百炼/OpenAI 四 tab，Endpoint/模型/Key/测试）
- 底部 8 项可调设置
- API 未接前保持禁用/待接入；按 FRONTEND-HANDOFF 第 4 节接读接口和动作

先输出：后端地图、页面清单、接口映射表、状态矩阵、数据更新策略、组件/API/Store 分层；再改代码。
```

---

## 8. 后端承诺（我这边）

- 只改 `surfcore-persona-core`；不碰 `surfcore-ui`。
- 先实现只读 `/overview`、`/settings`、`/narrative`，再实现 mode/config/maintain/rebuild。
- 模型清单/导入/运行时/服务商配置/测试 → 已按第 4 节落地；按 id 直测 provider 仍是 v2，未实现返回 `501 + code`，不返回假数据。
- 每个接口带 `ok/error(code,message,hint,retryable)`；动作有 job 状态。
- 保持大适配器 0 改动；UI 只通过 API 访问，不直接调内核。

---

## 9. 后端回复（2026-11-11）

**已按 A + C 路线落地**：旧运行时适配层，API 契约不变，后续换新内核只换实现。

### 9.1 已实现（旧插件 `plugins/surfcore/lib/memory-api.js`）

路由前缀：`/surfcore-api/memory`，与本文件第 4 节一致。

| 端点 | 状态 | 说明 |
| --- | --- | --- |
| `GET /overview` | ✅ | 真实旧状态；带 `capabilities` 按动作可用表 |
| `GET /settings` | ✅ | 8 项；`dedupeDays/initialDays` 的 `writable:false` + warning |
| `POST /settings` | ✅ | 单 key 或 values；只读项/未知项明确 400 |
| `GET /narrative?tab=decay\|full` | ✅ | 衰减卡 / 全量卡；admin 视图；full 暂 `nextCursor:null` |
| `GET /vector/status` | ✅ | 旧 `vectorMemoryStatusNow` + `spaces` |
| `GET /vector/models` | ✅ | 本地模型 / runtime / 四家 provider；不回显 key |
| `POST /mode` | ✅ | `saveUnified`；桥接/调度器按配置重读 |
| `POST /vector/config` | ✅ | `maxChars→injectMaxChars`；未知 modelSpace 400 |
| `POST /vector/maintain` | ✅ | 202 + job |
| `POST /vector/rebuild` | ✅ | 202 + job；支持 `{modelSpace}` 或 `{modelSpaces:[...]}` 多模型 |
| `GET /jobs/:id` | ✅ | 内存 job + 旧 pack job 统一读取；重启丢失 |
| `GET /jobs` | ✅ | 当前进程的内存 job 列表；重启清空 |
| `POST /models/import` | ✅ | multipart `file` zip → 临时文件 → `startEmbeddingPackInstall` → job |
| `POST /runtime/enable` | ✅ | `{enabled:true/false}` → start/stop；返回 running/stopped |
| `POST /providers/:id/config` | ✅ | 保存不激活（`activate:false`）；Key 不回显 |
| `POST /providers/:id/test` | ✅ | 按 id 直测：用该 provider 的 endpoint/model/key；返回 dim/latency，不切 active，不回显 Key |
| `GET /library` | ✅ | owner/admin 视图；`q` 走语义搜索，否则最近记录；敏感记录仍由旧实现过滤 |
| `GET /vector/space` | ✅ | PCA3 投影；最多 1000 点；敏感过滤；缓存；不返回原始向量 |

`overview.capabilities`：

```json
{
  "mode": true,
  "settingsWrite": true,
  "vectorConfig": true,
  "maintain": true,
  "rebuild": true,
  "jobsList": true,
  "modelsImport": true,
  "runtime": true,
  "providerConfig": true,
  "providerTest": true,
  "library": true,
  "projection": true
}
```

**UI 应按 `capabilities` 逐按钮启用，不要只看 `controlAvailable`。** 失败时按 `code` 显示具体原因。

### 9.2 六件事的答复

1. **A 还是 B**：A + C。旧状态适配先跑，契约不变，后续换新内核只换实现。
2. **loopback**：v1 只允许本机回环；远程会 403 `memory.loopback-only`，UI 显示请求失败而不是待接入。
3. **provider 保存**：已实现，`activate:false`；切换当前索引用 `POST /vector/config {modelSpace}`，不自动切 active。测试已支持按 id 直测，不切 active。
4. **v2 字段**：接受；`capabilities`、`writable`、`GET /jobs`、provider 回读（endpoint/model/modelSpace）、按 id 直测已给；其余按 v2 再扩。
5. **dedupeDays/initialDays**：只读 + warning，不提供写入；等内核迁移再开放。
6. **可见性**：v1 明确 owner/admin 视图；`GET /library` 已开，但使用旧实现的敏感过滤（`sensitive !== true`）；不是 viewer 级过滤。

### 9.3 注意

- 旧插件改动需要**重启 DSH / 重载插件**才生效；不是 UI 刷新就够。
- `jobs` 是进程内 Map，重启丢失；前端 `404 memory.job-missing` 要能处理。
- `narrative` 的 full 暂时 `nextCursor:null`；不要做无限滚动假设。
- `vector/config` 的 modelSpace 必须命中已装模型或已保存 provider，否则 400。
- 旧实现 `vectorMemory.jsonl` 当前可能 0 条，但 `spaces` 有老索引；UI 要显示“记录源为空/索引存在”，不要自己解释成有 12 条数据。
- 旧插件测试：`node scripts/test-memory-api.mjs`（33 条）+ `npm run test:audit` 通过。
