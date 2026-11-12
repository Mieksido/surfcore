# 记忆切流（阶段 3：可控单写）

> 位置：宿主壳 `plugins/surfcore/lib/memory-kernel-read.js` + `memory-api.js`。
> 旧 `/surfcore-api/memory` 保留回滚；读开关默认关。

## 1. 入口

影子只读：

```text
GET /surfcore-api/memory/kernel/overview
GET /surfcore-api/memory/kernel/narrative?tab=decay|full&q=&limit=&cursor=
```

旧 API 切读开关：

```text
SURFCORE_MEMORY_READ=kernel
```

打开后：

```text
/surfcore-api/memory/overview   → 新内核
/surfcore-api/memory/narrative  → 新内核
/surfcore-api/memory/*          → 其它仍走旧运行时
```

关闭 / 不设置：

```text
全部走旧运行时
```

## 2. 已对齐

- `narrative`：decay/full、q、limit、cursor
- `overview`：mode/config/stats/vector/controlAvailable/capabilities
- `vector/status`：records/indexed/pending/failed/modelSpace/spaces
- `settings`：字段同形，`writable:false`（读切了，写没切）
- 当前 shadow 统计：decay 600 / full 3891 / vector 3891 / pending 3891
- `controlAvailable:false`：只读，不假装能控制

## 3. 已做的五步

1. 新旧 narrative 形状对比：已做（`memory-kernel-read.js` 映射 `channel/actor/scene/id`）
2. `/narrative` 切读开关：已做，`SURFCORE_MEMORY_READ=kernel`
3. `/overview` 切读：已做，同开关
4. `/settings`、`/vector/*` 只读映射：**已完成**（settings 可写标记为 false；vector 只读 status）
5. 切写：**未做**
6. 事件源灌注适配：**已做工具 + 宿主定时器**（`tools/memory-ingest.mjs` + `plugins/surfcore/lib/memory-event-host.js`，默认关）

## 4. 为什么后两步不能硬做

- `/settings` 写入会改旧配置；新内核设置还没接旧 UI 契约，所以只读视图把字段标成 `writable:false`
- 读开关打开时，所有旧写请求返回 `409 memory.write-not-cutover`，避免“读新写旧”
- `/vector/*` 新内核有状态，但模型导入/服务商/任务控制面仍在旧运行时
- 切写不是换 GET，而是接事件入口；旧事件流水线还在旧运行时
- 先切会让 UI “数据新、控制旧”，比不切更难排查

## 5. 边界

- 宿主壳：只读适配 + 读开关
- 内核：memory
- 工具：`tools/memory-ingest.mjs` 事件源灌注（不在四层内，不是新层）
- 大适配器：0 改动
- UI：不改

## 6. 事件灌注工具

```bash
node tools/memory-ingest.mjs --state state/persona-core-shadow \
  --inbox <旧 memory-inbox.jsonl> --bili <旧 bili-memory.json>
```

- 读旧事件源，写新内核状态
- 幂等：inbox 按字节游标、B站按 entry id
- `--from-start` 重放
- 不写旧状态、不发消息
- 实测：首次两条入内核，第二次 0 重灌

## 7. 宿主定时器

`plugins/surfcore/lib/memory-event-host.js`：

```text
SURFCORE_MEMORY_INGEST=1
```

打开后宿主每 15 秒读旧收件箱/B站 entries，灌新内核 shadow。

- 默认关
- 只写 shadow，不写旧卡
- 不是唯一写者；旧 memory-card 仍在写
- 用于对比/预热，不是正式切写

## 8. 正式状态提升

先把 shadow 提升成正式新内核状态（dry-run 默认）：

```bash
node tools/cutover-memory.mjs
# 确认 records 与目标不存在
node tools/cutover-memory.mjs --apply
```

- 目标默认 `state/persona-core`
- 拒绝覆盖已有正式状态
- 只复制 `kernel-state.json` / `memory-full.jsonl`
- 当前已提升：decay 600 / full 3891

## 9. 单写模式

```text
SURFCORE_MEMORY_READ=kernel
SURFCORE_MEMORY_STATE=<正式状态目录，如 state/persona-core>
SURFCORE_MEMORY_WRITE=kernel
```

打开后：

- 读 `/memory/*` 走正式新内核
- 事件定时器写同一个正式状态
- 停旧 memory-card 定时器
- 停旧向量定时器
- 旧 `/memory` 写请求 409
- 旧 `/memory-card` 写请求 409
- 旧 `runMemoryCardMaintenance` 直接返回 disabled

关闭 `SURFCORE_MEMORY_WRITE` 即回到旧写；旧卡没有删除。

**已补的一刀（本轮）**：写模式下，新内核记忆会投影成旧提示词文件；narrative 模式旧 bridge 直接读；vector 模式仍走旧向量块（见 §10）。

## 10. 提示词投影（本轮补上）

`plugins/surfcore/lib/memory-prompt-projector.js` 在写模式下：

```text
新内核可见叙事
  → memory-card-prompt-qq.md
  → memory-card-prompt-bili.md
  → memory-card-prompt-qq-groups.json（按频道）
```

旧 bridge 不需要改读法，它照旧读这些文件；per-channel map 只写公开频道到全局，私聊只通过对应频道块注入，避免串场。

仍然存在的边界：

- `memory.mode=vector` 时 bridge 仍读旧向量块；单写模式因此拒绝开启，先把模式设为 narrative。
- 旧向量控制面（模型/索引/任务）仍归旧运行时。
- 投影是宿主壳的兼容层，不是新层；最终要随 DSH 临时组合根一起删掉。
