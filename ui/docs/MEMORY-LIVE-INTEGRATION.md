# 记忆页联调增量（v0.30）：按真实后端能力收口 + 记录检索 + 记忆空间 + 来源映射

> 前端：`surfcore-ui`；后端实现：`D:\deepseekwork\surfcore\plugins\surfcore\lib\memory-api.js`（只读，不改）。
> 契约：`FRONTEND-HANDOFF.md` §4 v1 + §9 后端回复（2026-11-11）。
> 本文是这一轮“先读后端、再画界面”的底稿；实现只动 `surfcore-ui`。

---

## 1. 后端地图（当前真正在跑的）

### 1.1 运行位置

| 层 | 位置 | 状态 |
| --- | --- | --- |
| 新内核 | `kernel/memory`、`kernel/index.js` | **未接进运行时**；`kernel-state.json` 不存在 |
| 旧运行时 | `src/memory-card.js`、`src/vector-memory.js`、`embedding-packs` | **在跑**，真实数据源 |
| API 适配层 | `plugins/surfcore/lib/memory-api.js`（`D:\deepseekwork\surfcore`） | **在跑**，前缀 `/surfcore-api/memory` |
| 路由注册 | `plugins/surfcore/lib/index.js`（约 L743） | loopback + 同源写 + DSH 会话；import 单独放行 multipart |

### 1.2 端点与真实形状

| 端点 | 真实性 | 关键形状/行为 |
| --- | --- | --- |
| `GET /overview` | ✅ | `mode/config/stats/vector/controlAvailable/capabilities/updatedAt`；`capabilities` 9 个布尔 |
| `GET /settings` | ✅ | 8 项；`writable` 字段；`dedupeDays/initialDays` 为 `false` + warning |
| `GET /narrative` | ✅ | decay 最多 80（快照）、full 上限 500；cursor 是 offset 字符串；full 现在 `nextCursor:null` 或 500 上限 |
| `GET /vector/status` | ✅ | `records/indexed/pending/failed/modelSpace/spaces`；`failed` 固定 0 |
| `GET /vector/models` | ✅ | local 含 `model/modelSpace/dim/sizeBytes/indexed/indexReady`；providers 含 `endpoint/model/modelSpace/hasKey/keyMasked/status`；runtime |
| `POST /mode` | ✅ | `saveUnified`，返回 `{mode}` |
| `POST /vector/config` | ✅ | `enabled/batchSize/maxChars/modelSpace`；未知 space 400 `vector.space-unknown` |
| `POST /vector/maintain` | ✅ | 202 + `{jobId,state}`；job 进度后端**只在完成时置 100** |
| `POST /vector/rebuild` | ✅ | 202；支持 `{modelSpace}` 或 `{modelSpaces:[...]}` |
| `GET /jobs/:id` | ✅ | 内存 job + 旧 pack job；`error` 已映射 `failed`；重启丢失；404 `memory.job-missing` |
| `POST /models/import` | ✅ | multipart file → 临时 zip → 安装 job |
| `POST /runtime/enable` | ✅ | 返回 `{enabled,status,result}`，不是 job |
| `POST /providers/:id/config` | ✅ | 保存不激活；返回 endpoint/model/modelSpace/hasKey/keyMasked；Key 不回显 |
| `POST /providers/:id/test` | ✅ | 按 id 直测；返回 `dim/latencyMs/model/modelSpace` |
| `GET /library` | ✅ | owner/admin；q 语义搜索；敏感由旧实现过滤 |
| `GET /vector/space` | ✅ | PCA3 投影；`modelSpace,limit=800`；返回 3D 坐标 + explained/total/eligible/hidden/sampled；不返回原始向量 |

### 1.3 错误码（按 code 显示，不猜）

`memory.loopback-only`(403)、`memory.cross-origin`(403)、`memory.content-type`(415)、
`memory.bad-json`/`memory.bad-mode`(400)、`vector.space-unknown`/`vector.models-empty`(400)、
`memory.job-missing`(404)、`memory.import-content-type|too-large|bad-form|no-file|not-zip`(400)、
`memory.provider-unknown|not-configured|test-empty|test-failed`(400)、`memory.route-unknown`(404)、`memory.internal`(500)。

---

## 2. 用户任务与页面

记忆页：**看状态 → 切读取方式 → 翻两套记忆 → 看向量状态 → 调配置/模型/服务商 → 查记录检索 → 调 8 项设置**。
v0.27 只对齐真实能力；v0.28.1 把后端已开放的 `/library` 接成 **向量记忆 → 第四个子 tab「记录检索」**（只读，不是第三套存储）。

---

## 3. 这一轮要改的 6 个点

| # | 问题 | 改法 | 依据 |
| --- | --- | --- | --- |
| 1 | UI 只看 `controlAvailable`，后端要求按 `capabilities` 逐按钮启用 | 页面把 `can(key)` 传给各面板；各写按钮按自己的 key 禁用 | BACKEND §9.1 |
| 2 | 服务商表单不回填已保存 endpoint/model/modelSpace | `/vector/models.providers` 已返回这些字段 → 表单初值/同步回填；Key 仍留空 | `memory-api.js` L336-346 |
| 3 | `status:'no-index'` 未映射 | 增加「已配置 · 未建索引」；测试仍可用 | L340 |
| 4 | job 进度后端只在完成时置 100 → UI 显示 0/100 像卡住 | 未上报进度时显示“进度未知（后端未上报）”+不确定进度条，不伪造百分比 | L83-96 |
| 5 | “多模型重建”只支持逐个点 | 增加多选 + 一次 `POST /vector/rebuild {modelSpaces}` | L406-430 |
| 6 | `settings.writable` 没消费；`maxRecords` 标 writable 但无 POST 路由 | 行内按 `writable:false` 禁用；`maxRecords` 明确显示“后端标注可写，但 v1 没有保存路由（待补充）” | L184-220 |
| 7 | `/library` 已开放但 UI 没有入口 | 新增「向量记忆 → 记录检索」子 tab：最近记录 + 语义搜索 + 分页；只读；按 `capabilities.library` 门禁；不放在顶层，避免被当成第三套存储 | `memory-api.js` L549-571 |
| 8 | 想看千维空间 | 新增「向量记忆 → 记忆空间」子 tab：**默认不加载**；选 modelSpace + 点「查看空间」才请求 `/vector/space`；Canvas 3D；按 `capabilities.projection` 门禁 | `memory-api.js` 新增 `/vector/space` |

---

## 4. 接口映射（增量）

| 用户动作 | 页面 | 后端依据 | 状态 | 备注 |
| --- | --- | --- | --- | --- |
| 看能力表 | 记忆页 | `overview.capabilities` | ready/unknown | 缺失时回退 `controlAvailable` |
| 切读取方式 | 弹窗/设置行 | `POST /mode` | submitting/success/failed/unknown | `capabilities.mode` |
| 启停向量 | 总配置 | `POST /vector/config` | 同上 | `vectorConfig` |
| 编码一批 | 总配置 | `POST /vector/maintain` → `/jobs/:id` | job | `maintain` |
| 重建一个/多个 | 总配置 | `POST /vector/rebuild {modelSpace\|modelSpaces}` | job | `rebuild` |
| 导入模型/运行时 | 本地/运行时 | `POST /models/import` multipart | job | `modelsImport` |
| 启停运行时 | 运行时 | `POST /runtime/enable` | success/failed | `runtime`；返回 status 不是 job |
| 保存服务商 | 服务商 | `POST /providers/:id/config` | success/failed | `providerConfig`；不激活 |
| 测试服务商 | 服务商 | `POST /providers/:id/test` | success/failed | `providerTest`；按 id 直测 |
| 改 maxRecords | 设置 | **无 POST 路由** | 禁用 | 待补充；不要用 `/vector/config` 冒充 |
| 记录检索 | 向量 → 记录检索 | `GET /library?q=&limit=20&cursor=` | loading/ready/empty/failed/unknown/unavailable | 只读；owner/admin；语义搜索走 `q` |
| 记忆空间 | 向量 → 记忆空间 | `GET /vector/space?modelSpace=&limit=800` | loading/ready/empty/failed/unknown/unavailable | 默认不请求；选模型并点「查看空间」才加载；PCA3 |

---

## 5. 状态矩阵（增量）

| 对象 | 状态 |
| --- | --- |
| capabilities | 缺失 → 按 `controlAvailable`；存在 → `key === true` 才可写；未知/不全 → 对应按钮禁用并给 title |
| provider 表单 | 已保存值回填；Key 空（只写）；保存中禁用；测试使用已保存配置 |
| job | running 且 `progress>0` → 确定进度；`progress==0` → 不确定进度 + “后端未上报”；done/failed/unknown/unavailable 不变 |
| 多选重建 | 未选 → 禁用；已选 → 确认条列出 spaces；提交中禁用；失败保留选择 |
| 记录检索 | 无 `capabilities.library` 或 overview 不可用 → 不发请求 + 说明原因；有 q 是语义搜索，`nextCursor:null` 表示没有更多；搜索失败保留输入 |
| 记忆空间 | 默认 idle（不请求）；选 space 后点「查看空间」→ loading → ready/empty/failed/unknown/unavailable；关闭空间回到 idle；explained 总和低时提示近似 |
| settings | `writable:false` → 只读；有写接口 → 可保存；`writable:true` 但无路由 → 明确“待补充” |

---

## 6. 数据更新策略（增量）

- capabilities 随 `/overview` 刷新；写成功后重拉 overview/settings。
- provider 保存成功后重拉 `/vector/models`（回填值以后端为准）；测试结果只展示，不改配置。
- rebuild 多模型：一个 job；job done 后重拉 status/models/overview。
- 其余不变：同源 HTTP、generation、abort、可见时轮询、隐藏/卸载停止、unknown 不伪装。

---

## 7. 视觉与分层

- 不新增视觉体系；复用 `sc-mem-*`、按钮/输入/标签/错误块。
- 新样式只加：索引行 checkbox 间距、多选按钮布局（沿用 `.sc-mem-inline`）。
- 分层不变：`memApi` → `useMemoryLoad/Action/Job` → 面板组件；capabilities 通过 props 下传，不建全局 store。

---

## 8. 待补充（不在本轮做）

1. `POST /settings`（`maxRecords` 写入）——后端未提供，UI 只读。
2. job 的真实增量进度（`progress` 目前 0→100）。
3. `GET /jobs` 列表/取消——离开记忆页仍会丢 jobId。
4. 记录检索：搜索词不持久化、不做搜索历史/收藏；敏感过滤完全依赖后端（owner/admin 视图）；它只覆盖向量记录，不是跨叙事+向量的统一检索。
5. 记忆空间：PCA3 降维近似、默认最多 800 点；没有聚类/时间过滤/跨空间对比；坐标是展示坐标，不是原始向量。
6. `stats.vector.failed` 固定 0；`full` 500 条上限。
