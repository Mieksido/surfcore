# 记忆页设计（v1 · UI v0.30.0）

> 归属：`D:\deepseekwork\surfcore-ui`（前端）。后端实现只在 `D:\deepseekwork\surfcore`（旧运行时 + `plugins/surfcore/lib/memory-api.js`）；架构/契约文档在 `surfcore-persona-core`。
> 集成方式：同源 HTTP JSON API，契约见 `docs/persona-core/FRONTEND-HANDOFF.md` 第 4 节（v1）。
> 后端落地路线（旧运行时适配 vs 新内核接线）见 [`BACKEND-ADAPTER-PLAN.md`](BACKEND-ADAPTER-PLAN.md)。
> 当前联调增量（capabilities / provider 回填 / job 进度 / 多模型重建）见 [`MEMORY-LIVE-INTEGRATION.md`](MEMORY-LIVE-INTEGRATION.md)。
> 本文是「先读后端、再画页面」的交付物：后端地图、页面清单、接口映射、状态矩阵、数据更新策略、分层。
> 实现：`client.template.js` 的记忆页区块（唯一手写源）。

---

## 1. 边界（不改的东西）

- 不 import 内核、不读 `state/`、不读构建快照当实时数据。
- 不 mock 成功、不乐观改业务状态；写操作只在后端确认后更新展示。
- 每个交互都要有接口依据；没有接口的按钮禁用并标「待补充」。
- 不随意 `setInterval`；job 只在页面可见时轮询，卸载/隐藏停止。
- 沿用深蓝/青科幻 tokens，不整页纯白/纯黑。

---

## 2. 后端地图（读契约 + 读内核之后）

### 2.1 内核真实能力（后端内部，UI 不直接调）

模块：`kernel/memory`（`index.js` 暴露；`narrative/*`、`vector/*` 是内部实现）。

| 能力 | 方法（后端内部） | 数据/状态 | UI 对应 |
| --- | --- | --- | --- |
| 读取方式 | `setMode('narrative'\|'vector')` / `READER_MODES` | 只改读取，两套都写入 | 记忆读取方式 |
| 叙事卡 | `snapshot()` / `read(viewer,query)` / `visible(viewer)` | 衰减卡数组、全量卡 | 叙事 tab |
| 全量卡 | `fullCard.recall({query,limit,withinDays})` / `stats()` | 原始记录（需可见性投影） | 全量 tab |
| 向量状态 | `vectorStatus(space)` / `vectorConfig()` | records/indexed/pending/failed/spaces | 向量状态 |
| 编码 | `vectorPending(limit)` / `encodePending({embed,limit,modelSpace})` | 需要 embedder | 编码待处理 |
| 重建 | `rebuildVectors({modelSpace})` | 每个模型一套索引 | 重建 |
| 检索 | `searchVector({text,vector,limit,modelSpace})` | 无 viewer 级过滤（owner/admin 视图） | 只读记录检索（向量 tab → 记录检索） |
| 设置声明 | `kernel/settings/limits.js` → `KERNEL_SETTINGS`（8 项） | 声明 + `kernel-state.json` 当前值 | 底部 8 项 |

### 2.2 HTTP 契约（v1，前端唯一入口）

Base：同源 `/surfcore-api/memory`。信封：`{ok:true,data}` / `{ok:false,error:{code,message,hint,retryable}}`。

| 方法/路径 | 入参 | 出参 | 状态 |
| --- | --- | --- | --- |
| `GET /overview` | — | mode/config/stats/vector/controlAvailable/updatedAt | 只读 |
| `GET /settings` | — | `{groupId,fields[]}` | 只读 |
| `GET /narrative` | `tab=decay\|full,q,limit,cursor` | `{items[],nextCursor}` | 只读、分页 |
| `GET /vector/status` | — | 同 `overview.vector` | 只读 |
| `GET /vector/models` | — | `{local[],providers[],runtime}` | 只读 |
| `GET /library` | `q,limit,cursor` | `{items[],nextCursor}` | 只读；owner/admin；UI 在「向量 → 记录检索」 |
| `POST /mode` | `{mode}` | `{mode}` | 写 |
| `POST /vector/config` | `{enabled,modelSpace,batchSize,maxChars}` | `config` | 写 |
| `POST /vector/maintain` | `{limit}` | `{jobId,state}` | 写 → job |
| `POST /vector/rebuild` | `{modelSpace}` | `{jobId,state}` | 写 → job |
| `GET /jobs/:id` | — | `{jobId,state,progress,total,error}` | 轮询 |
| `POST /models/import` | multipart `file,kind=local-model\|runtime` | `{jobId,state}`；未实现 `501 + memory.import-not-wired` | 写 → job |
| `POST /runtime/enable` | `{enabled}` | job 或 `{status}` | 写 |
| `POST /providers/:id/config` | `{endpoint,model,apiKey,modelSpace}` | `{provider,configured,status}` | 写；Key 只写不回显 |
| `POST /providers/:id/test` | — | `{dim,latencyMs}` 或结构化错误 | 写 |

### 2.3 缺口（2026-11-11 更新）

1. **后端实现位置**：`/surfcore-api/memory` 已由旧运行时适配层 `D:\deepseekwork\surfcore\plugins\surfcore\lib\memory-api.js` 提供；新内核 `kernel/memory` 仍未接进运行时。UI 遇到 404 / 非 JSON 仍显示「后端待接入」，写按钮禁用，不读快照冒充。
2. **设置写入缺口**：`maxRecords` 标 `writable:true` 但 v1 没有 `POST /settings` 路由 → 只读并标「待补充」；`dedupeDays/initialDays` 是 `writable:false`（旧运行时无生效点）。
3. **服务商回读已补**：`GET /vector/models.providers` 返回 endpoint/model/modelSpace/hasKey/keyMasked；UI 已回填，Key 仍不回显。
4. **记录检索**：`GET /library` 已开放（owner/admin，敏感由旧实现过滤）；UI 接成「向量记忆 → 记录检索」子 tab，只读。
5. **job 生命周期**：没有 job 列表、没有取消接口；内存 job 重启丢失。离开页面后 jobId 只保留在页面状态里。
6. **模型/运行时安装**：清单/导入/启停已实现；导入是 multipart → 临时 zip → 安装 job。

---

## 3. 用户任务与页面清单

用户要完成的事：看记忆是怎么被读的 → 切读取方式 → 翻两套记忆 → 看向量索引状态 → 修向量配置/模型/服务商 → 查记录检索 → 调阈值。

| 页面/区块 | 目标 | 入口 | 返回 | 依据 |
| --- | --- | --- | --- | --- |
| 记忆主页 | 总览 + 两个 tab + 8 项设置 | 内核 → 记忆 | 右键/HUD 返回 | `/overview`,`/settings` |
| 使用说明（独立页） | 说明书占位，内容待补 | 主页「使用说明」 | 页内「← 返回记忆」/右键 | 无接口 |
| 记忆读取方式（弹窗） | 叙事/向量二选一，只改读取 | 主页按钮 | 取消/保存 | `GET /overview.mode` + `POST /mode` |
| 叙事记忆 | 衰减卡/全量卡浏览、关键词过滤、分页 | tab「叙事记忆」 | 切 tab | `/narrative` |
| 向量记忆 · 总配置 | 状态、启停、编码、重建、运行时 | tab「向量记忆」 | 切 tab | `/vector/status`,`/vector/models`,`/vector/config`,`/vector/maintain`,`/vector/rebuild`,`/models/import`,`/runtime/enable` |
| 向量记忆 · 本地模型 | 3 个 zip 槽位 + 导入 | 子 tab | 切子 tab | `/vector/models`,`/models/import` |
| 向量记忆 · 服务商模型 | 四家服务商配置 + 测试 | 子 tab | 切子 tab | `/vector/models`,`/providers/:id/config`,`/providers/:id/test` |
| 记录检索 | 最近记录 + 语义搜索 + 分页（只读） | 向量记忆 → 子 tab「记录检索」 | 切子 tab | `/library` |
| 记忆空间 | 选 modelSpace → 查看 → PCA3 3D 点云（只读、惰性加载） | 向量记忆 → 子 tab「记忆空间」 | 切子 tab | `/vector/status`,`/vector/models`,`/vector/space` |
| 可调设置（底部） | 8 项，能保存的保存 | 主页底部 | — | `/settings` + 写接口 |

**不做的页面**：模型市场、调试数据页。

---

## 4. 接口映射表（每个交互）

| 用户动作 | 页面 | 后端依据 | 数据来源 | 状态 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 看当前读取方式/统计 | 主页顶部 | `GET /overview` | 实时 | loading/ready/failed/unknown/unavailable | `controlAvailable=false` → 写全禁用 |
| 看 8 项设置当前值 | 底部 | `GET /settings` | 实时 | 同上 | 读不到时只显示构建声明（值未知、禁用） |
| 打开使用说明 | 独立页 | 无 | — | — | 内容待补，不放操作 |
| 切换叙事/向量 | 弹窗 | `POST /mode` | 实时 | idle/submitting/success/failed/unknown | 成功后用响应 `mode` 作为已确认值，再刷 overview |
| 看衰减卡 | 叙事 tab | `GET /narrative?tab=decay&limit=50` | 实时 | loading/ready/empty/failed/unknown/unavailable | `nextCursor` 分页 |
| 看全量卡 | 叙事 tab | `GET /narrative?tab=full&limit=50` | 实时 | 同上 | 只读档案 |
| 关键词过滤 | 全量 tab | `GET /narrative?...&q=` | 实时 | 防抖 320ms | 后端过滤，不是语义检索 |
| 加载更多 | 列表底部 | `GET /narrative?...&cursor=` | 实时 | loading-more | 不自动无限滚动 |
| 刷新列表 | 列表右上 | 同 `GET /narrative` | 手动 | loading | 旧请求带 generation，不覆盖新状态 |
| 看向量状态 | 总配置 | `GET /vector/status` | 实时 | 同上 | 失败时回退 `overview.vector` 并标注来源 |
| 启用/停用向量存储 | 总配置 | `POST /vector/config` | 实时 | idle/submitting/success/failed/unknown | 提交体必须带全 config（enabled/modelSpace/batchSize/maxChars） |
| 编码一批 | 总配置 | `POST /vector/maintain {limit}` → `GET /jobs/:id` | 实时 | 动作 + job | `limit` 用 batchSize |
| 重建某个模型索引 | 总配置 | `POST /vector/rebuild {modelSpace}` → job | 实时 | 确认 → 动作 → job | 一次一个 modelSpace；重建后还要编码 |
| 看模型/运行时清单 | 本地/服务商/运行时 | `GET /vector/models` | 实时 | loading/ready/empty/failed/unknown/unavailable | 空数组 = 空态，不造模型 |
| 导入本地模型 zip | 本地槽位 | `POST /models/import` multipart | 实时 | 动作 → job | 501 → 该槽位转「后端待接入」 |
| 导入运行时 zip | 运行时 | `POST /models/import` kind=runtime | 实时 | 动作 → job | 未安装时启用按钮禁用 |
| 启用/停用运行时 | 运行时 | `POST /runtime/enable {enabled}` | 实时 | 动作 → job/status | 运行时未安装 → 禁用 |
| 保存服务商配置 | 服务商 | `POST /providers/:id/config` | 实时 | 动作 | Key 留空 = 不修改；Key 永不回显 |
| 测试服务商 | 服务商 | `POST /providers/:id/test` | 实时 | 动作 | 用已保存配置；未配置时禁用并提示先保存 |
| 保存读取方式（设置行） | 底部 | `POST /mode` | 实时 | 行内动作 | 与弹窗同一接口 |
| 保存向量设置（4 项） | 底部 | `POST /vector/config` | 实时 | 行内动作 | 合并当前 config 后提交 |
| 保存 maxRecords/dedupeDays/initialDays | 底部 | 无 | — | 禁用 | **待补充**：契约 v1 没有设置写入 |
| 轮询任务进度 | 向量页 | `GET /jobs/:id` | 轮询 | running/done/failed/unknown/unavailable | 仅可见时；2s 起，失败退避到 8s，连续 4 次失败 → 未知 |
| 记录检索/搜索 | 向量 → 记录检索 | `GET /library?q=&limit=20&cursor=` | 实时 | loading/ready/empty/failed/unknown/unavailable | owner/admin 视图；`q` 走后端语义检索；只读分页 |
| 看记忆空间 | 向量 → 记忆空间 | `GET /vector/space?modelSpace=&limit=800` | 实时 | loading/ready/empty/failed/unknown/unavailable | 默认不请求；选模型并点「查看空间」才加载；PCA3 展示坐标 |

---

## 5. 状态矩阵

### 5.1 读取资源（overview/settings/narrative/status/models）

| 状态 | 触发 | UI |
| --- | --- | --- |
| `loading` | 首次/重载 | 骨架 + 「正在读取…」；刷新按钮禁用 |
| `ready` | `ok:true` 且有数据 | 数据 + 数据源徽标（实时 · 时间） |
| `empty` | `ok:true` 但空 | 空态文案（区分衰减/全量/模型/索引） |
| `failed` | `ok:false` 且可重试 | 错误块：`code/message/hint` + 重试 |
| `unknown` | 超时/断线 | 「状态未知」+ 重试；不显示成空数据 |
| `unavailable` | 404/501/非 JSON/`*-not-wired` | 「后端待接入」+ 接口依据 + 重试；写按钮禁用 |
| 旧数据 + 新失败 | 重载失败但已有数据 | 数据保留 + 来源标「读取失败」，不清空 |

### 5.2 动作（写）

| 状态 | UI |
| --- | --- |
| `idle` | 按钮可点 |
| `submitting` | 按钮禁用 + 「保存中/重建中/导入中…」；防重复提交（busy ref） |
| `success` | 行内「已保存 · 时间」；随后刷新相关读资源（以后端为准） |
| `failed` | 行内错误块 `code/message/hint` + 重试；业务状态不变 |
| `unknown` | 「状态未知，点刷新确认」；不显示成功、不回滚成失败 |
| `notWired` | 该动作转「后端待接入」并禁用，直到手动刷新 |
| `controlAvailable=false` | 全部写按钮禁用 + 顶部只读横幅 |

### 5.3 job

| 状态 | UI |
| --- | --- |
| `running` | 进度条（有 total 显示 n/total，否则不确定进度）+ jobId |
| `done` | 「任务完成」+ 自动刷新 status/models/overview |
| `failed` | 错误块（code/message/hint） |
| `unknown` | 连续轮询失败 → 「无法确认任务状态」+ 刷新状态 |
| `unavailable` | `/jobs/:id` 未挂载 → 「后端待接入」 |
| 页面隐藏 | 停止轮询；回到可见恢复 |
| 页面/子页卸载 | 停止轮询；jobId 留在记忆页状态，回来可续看 |

### 5.4 组件级空/错/禁用

- 叙事：无卡 → 空态；搜索无结果 → 「没有匹配的全量记忆」；不可见数据由后端过滤，UI 不猜。
- 本地模型：接口无数据 → 空槽 + 「清单接口待接入」；导入期间全部槽位禁用。
- 服务商：清单没返回某家 → 该 tab 标「清单未返回」；未配置 → 测试禁用。
- 设置：无写接口 → 控件禁用 + 「待补充」；`controlAvailable=false` → 「后端待补充」。
- 重建：先内联确认（会重新编码该模型索引），确认后提交。

---

## 6. 数据更新策略

| 数据 | 方式 | 时机 | 停止 |
| --- | --- | --- | --- |
| overview/settings | HTTP GET | 页面挂载；手动刷新；写成功后 | 卸载 abort |
| narrative | HTTP GET | 子 tab/关键词（防抖 320ms）；手动刷新；加载更多 | 切 tab/卸载 abort |
| vector/status | HTTP GET | 向量页挂载；手动刷新；job done/failed | 卸载 abort |
| vector/models | HTTP GET | 向量页挂载；导入/运行时动作后；job done | 卸载 abort |
| job | `GET /jobs/:id` 轮询 | 动作返回 jobId 后 | done/failed、隐藏、卸载、连续失败 |

- 无 WebSocket/SSE（契约没有）；不新增全局 `setInterval`。
- 每个读请求带 `generation`：只有最新一代能写状态；旧响应丢弃。
- 请求 12s 超时（导入 120s、测试 30s）；超时归 `unknown`。
- 写请求不主动 abort（避免半途状态）；卸载后忽略结果。
- 写成功后重新拉取受影响资源；`POST /mode` 的响应可立即作为「已确认读取方式」，但随后仍以 `/overview` 刷新为准。
- job 轮询：首轮 0.5s，之后 2s；连续失败 1.2s→3s→4.8s 退避，连续 4 次失败归 `unknown`。
- 构建快照只在「后端待接入/失败」时以**折叠、明确标注非实时**的形式出现，不参与任何写入或状态判断。

---

## 7. 分层（组件 / API / Hooks / Store）

```
client.template.js
├─ 常量        MEM_API_BASE / MEM_PROVIDER_TABS / MODEL_STATUS / MEM_GROUP_LABEL
├─ API         memRequest()（信封/超时/abort/错误归一） + memApi.*（契约 v1 的唯一出口）
├─ Hooks       useMemoryLoad()  读取资源：loading/ready/empty/failed/unknown/unavailable + generation + abort
│              useMemoryAction() 动作状态机：idle/submitting/success/failed/unknown + busy 防重
│              useMemoryJob()    job 轮询：可见才跑、退避、done/failed/unknown/unavailable、卸载停止
├─ 页面        MemoryPage（布局 + overview/settings + tab + activeJob）
├─ 区块        MemoryGuidePage / MemoryModeDialog
│              NarrativePane
│              VectorPane → VectorConfigTab / LocalModelsTab(+LocalModelSlot) / ProviderModelsTab(+ProviderForm)
│              MemorySettingsPanel → MemorySettingRow
├─ 通用        MemSource / MemErrorBlock / MemLoading / MemEmpty / MemJobBar / MemPill / MemorySnapshotNote
└─ 数据注入    MEMORY（构建快照，仅快照参考用）
```

- **Store**：不新增全局 store。记忆数据只有本页消费；页面级 `activeJob` 让「切到叙事再切回向量」能续看同一个 job。跨页共享（如全局作业条）等真有第二个消费者再做。
- **类型**：契约形状写在注释里（本仓库无 TS）；组件对缺字段做防御。
- **为什么不拆文件**：`client.template.js` 是唯一手写源，`build.mjs` 只做占位符注入；拆源文件要改构建协议，本轮不做（风险大于收益）。分层靠区块边界与命名，不靠文件数。

---

## 8. 视觉

- 沿用现有 tokens：`#03060d/#06101f` 背景、`rgba(8,20,38,.85)` 面板、`#22d3ee/#7dd3fc` 强调、`#cfe6ff/#eaf9ff` 主文字、`#5f8fbb/#8fb6da` 次文字、成功 `#22c55e`、警告 `#eab308`、错误 `#f87171`。
- 新增类：`.sc-mem-toolbar` `.sc-mem-source` `.sc-mem-state` `.sc-mem-job` `.sc-mem-row` `.sc-mem-index` `.sc-mem-confirm` `.sc-mem-pill` `.sc-mem-setrow` `.sc-mem-seg` `.sc-mem-switch` `.sc-mem-snapshot` `.sc-mem-input` `.sc-spin`。
- 圆角/间距/字号沿用：卡片 12–16、按钮/输入 8、胶囊 999；10/11/12/13 字号；4/8/12/16 间距。
- 动效只用于 loading 旋转与进度条；`prefers-reduced-motion` 下关闭。

---

## 9. 风险与待补充（给后端）

1. 挂 `/surfcore-api/memory`：404 → 前端「后端待接入」，不是白屏。
2. `controlAvailable` 必须真实反映 Host 控制路由是否可用；false 时前端全禁用。
3. 每个错误都带 `code/message/hint/retryable`；501 用 `*-not-wired` 后缀，前端据此禁用对应动作。
4. 服务商 `providers[]` 已补 `endpoint/model/modelSpace/hasKey/keyMasked`；UI 已回填，Key 仍不回显。
5. 设置写入：建议 `POST /settings`（按 key 白名单）或 `POST /settings/:key`，覆盖剩余 3 项；`maxRecords` 目前标 writable 但无路由。
6. `narrative` 的 `q` 只用于 `tab=full`；分页 `cursor` 必须可续。
7. job 需要 `progress/total` 才有确定进度；没有就显示不确定进度，前端不编造百分比。
8. 记录检索只覆盖向量记录；要跨叙事+向量的统一检索，需要后端新契约，前端不拼。
9. `POST /models/import` 已实现（multipart → 临时 zip → job）；坏包返回 `pack.*`，不返回假 jobId。

---

## 10. 验证与回滚

验证：

```powershell
cd D:\deepseekwork\surfcore-ui
node build.mjs
node --check client.js
node smoke.mjs
node test-memory-api.mjs      # 32 项：信封 / 404 / 非 JSON / 超时 / 方法 / 编码 / multipart
node test-memory-hooks.mjs    # 29 项：读状态机 / 动作状态机 / job 可见性与异常状态
# 浏览器 Ctrl+R；HUD 右上角 UI vX.Y.Z
```

实现为测试暴露了 `__pages` / `__memoryApi` / `__memoryRequest` / `__memoryHooks`（factory 返回值，仅供上面三个脚本）；运行时只走 `inject` + `apply`。

- 后端未挂载时：页面顶部/各卡应显示「后端待接入」，写按钮禁用；不得出现数字冒充实时。
- 挂载只读接口后：overview/settings/narrative 应显示「实时接口 · 时间」；写按钮仍按 `controlAvailable` 禁用。
- 联调 job：重建/编码/导入期间进度可见；切到叙事 tab 后轮询停止；切回续看；隐藏标签页停止。

回滚：`package.json` 版本降回、`node build.mjs` 重新生成、remove/install 旧包；记忆页实现集中在 `client.template.js` 一个区块和一段 CSS，可整段回退。
