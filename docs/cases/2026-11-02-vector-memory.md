# 2026-11-02 向量记忆（独立系统）接入

## 现象

- 用户要求：在 SurfCore 里新增「向量记忆」，与现有「叙事记忆」（衰减卡 + 全量卡）并列，用户可二选一读取；两套存储各自继续写入，除非用户单独关闭。
- 复现：设置页「记忆」→ 只能看到叙事记忆卡，没有记忆方式切换；QQ 唤醒永远注入预渲染记忆卡。
- 影响面：新增能力，不改变现有记忆卡；不迁移数据；没有向量记忆时行为与旧版完全一致。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 | Windows 11 |
| SurfCore | `feat/vector-memory-impl`（基于 dev `a5e19be`） |
| Embedding 服务 | `surfcore-embedding 1.0.0`，Ollama 0.40.13，`D:\ollama` |
| 模型 | bge-m3 / qwen3-embedding-0.6b / bge-small-zh-v1.5 |

## 根因

- 旧代码只有 `memoryCard` 一条读取/注入链路：`src/bridge.js` 的 `buildWakePromptV2()` 固定调用 `memoryCardPromptBlock()`。
- 没有任何独立于记忆卡的向量存储/索引/检索；`memory.mode` 不存在。
- 用户要求“存储和读取解耦” + “两套系统并列”，现有数据结构无法表达。

## 完整逻辑

- **链路**：
  - 写：QQ 桥接 append `memory-inbox.jsonl`；B站/桌宠沿用同一 inbox；插件 `lib/vector-memory.js` 每 10 分钟摄取，写角色 `memory/vector-memory.jsonl`，调用 `surfcore-embedding` 编码，原子写 `vector-memory-index.bin/.json`；记忆卡维护器独立继续写 `memory-card.*`。
  - 读：桥接每轮读合体层 `config.json` 的 `memory.mode`；`narrative` 读预渲染记忆卡，`vector` 调本机 Embedding 服务编码当前消息，读索引检索，注入 `【想起的旧事】`。
  - 读者：桥接只读索引；插件是唯一写者；设置页通过 `/api/vector-memory` 读状态/触发维护。
- **机制**：
  - `memory.mode` 只管读取，不控制写入；两个存储各自有 `enabled` 开关。
  - 索引按 `model_space` 隔离；换模型必须重建，避免不同向量空间混查。
  - 索引先写 bin 再写 manifest；读者看到 manifest 时 bin 必完整。
  - 维护器每 tick 只编码缺的/变了的记录（`textHash`），有上限，不阻塞插件；失败只影响向量索引，不影响叙事记忆。
  - 桥接检索失败（服务未启动/空间不匹配/超时）→ 不注入、节流日志、不阻塞唤醒。
- **爆炸半径**：新增 2 个文件写入（vector-memory.jsonl / index）+ 桥接只读 + 1 个设置页区块；不碰记忆卡格式、不碰 QQ 出站、不花钱（本地模型）；涉及用户记忆文本，已过滤 sensitive 且入库再脱敏。
- **取舍**：
  - A（采用）：独立存储 + 独立索引；满足“两套存储都继续、读取二选一”，不改记忆卡。
  - B：只给记忆卡建向量索引；实现更小，但关掉叙事记忆会断向量来源，违反用户要求。
  - C：把记忆搬进 SQLite（GPT 实验台）；引入 Python 常驻服务与双真相，否决。
- **生效与重启**：配置由设置页保存到合体层 `config.json`；桥接每轮按 mtime 读取，无需重启；插件维护器随宿主启动，改 `vectorMemory` 配置下一 tick 生效；装/换 Embedding 服务需重启服务本身。

## 修法

- 新增 `src/vector-memory.js`：记录模型、inbox/B站摄取、JSONL 存储、二进制索引、检索打分、注入渲染、Embedding 客户端与错误码。
- 新增 `plugins/surfcore/lib/vector-memory.js`：独立维护器、状态、重建、定时器。
- `plugins/surfcore/lib/index.js`：启动/停止维护器、`/api/vector-memory`、overview 状态、角色切换等待。
- `plugins/surfcore/lib/store.js`：`memory.mode` 与 `vectorMemory` 默认值/归一化；新增 `provider/cloudModel/cloudModelSpace`，云端 provider 走 Embedding 服务环境变量。
- `src/bridge.js`：读 `memory.mode`；`buildWakePromptV2(..., vectorBlock)`；`vectorRecallBlockForWake()`；只在 vector 模式注入检索块；本地/云端按 effective model/space 检索。
- `plugins/surfcore/lib/client.js`：记忆页新增「记忆方式 / 本地或云端 provider / 向量模型 / 云端模型名与空间 / 向量存储开关 / 发现文件 / 状态 / 立即整理 / 重建索引」；桌宠记忆开关文案改为「写进记忆（叙事/向量）」。
- `plugins/surfcore/lib/pet-chat.js`：桌宠对话写 inbox 不再只看 `memoryCard.enabled`，只要叙事或向量任一存储开着就继续写，避免关掉叙事记忆把独立向量记忆饿死。
- 回滚：设置页切回叙事记忆，或关闭 `vectorMemory.enabled`；删除 `vector-memory*` 文件；代码回退分支即可。

## 验证

- 自动化：
  - `node scripts/test-vector-memory.mjs`（8 项：摄取/索引/检索/过滤/客户端/本地与云端 effective 配置）
  - `node scripts/test-vector-memory-wiring.mjs`（5 项：桥接/插件/配置/桌宠共享 inbox 接线）
  - `node scripts/test-vector-memory-plugin.mjs`（临时 DSH_HOME + 假服务，端到端 2 条 → 索引）
  - `node scripts/test-vector-memory-bridge.mjs`（vector/narrative 注入二选一）
  - `npm run test:audit`：130/130；`plugins/surfcore` `npm test` 通过
- 失败路径：
  - 服务未启动 → `vector.service-missing` / `vector.service-down`，状态页红字，记录继续写；
  - 模型空间不一致 → `vector.model-space-mismatch`，不写索引；
  - 维度不一致 → `vector.dimension-mismatch`；
  - 注入块有硬上限；无命中不注入。
- 手工/集成：真实 `D:\ollama` 三模型已单独验收（1024/1024/512、digest、413/200）；SurfCore 侧尚未在真实 QQ 唤醒里肉眼确认 `【想起的旧事】`（需要重启桥接 + 真消息）。
- 云 provider：Embedding 服务已实现 OpenAI 兼容 provider（endpoint/key/space 走服务环境变量，有 mock 测试）；SurfCore 侧已接 `provider=cloud` + `cloudModel/cloudModelSpace` 配置与 UI，但**没有真实 key，未做真实云端调用**。
- 桌宠：`buildPetMemoryEvents` 的一问一答写共享 inbox；`rememberEvents` 现在只要叙事或向量任一存储开着就继续写（有接线测试）。
- 未验证：真实 QQ 端到端、B站 唤醒的 vector 读取（v1 只接了 QQ 唤醒）、设置页实际点击、真实云端、Recall@5/MRR 效果评测。

## 遗留 / 后续

- B站 调度器读取路径（`memory.mode=vector` 时 B站 仍读记忆卡）。
- `qq_get_prompt` 的 `memoryCard` 字段未按模式切换（只影响工具回显）。
- Recall@5/MRR 评测与默认模型选择。
- 设置页保存后是否需要用 mtime 热更新确认（桥接每轮读，插件下一 tick 读）。
- 包安装/分发：已定契约 [`../guides/EMBEDDING_PACKS.md`](../guides/EMBEDDING_PACKS.md)；模型/运行时/云端 pack manager 尚未实现，当前分支仍是外部服务模式。

## 发布交接块（可直接转发）

```text
【本批：向量记忆（独立系统）】
分支：feat/vector-memory-impl
提交：见分支 HEAD（含云端 provider 配置与桌宠共享 inbox 修复）
范围：新增 src/vector-memory.js、plugins/surfcore/lib/vector-memory.js；改 bridge/index/store/client/pet-chat、测试与文档
验证：test-vector-memory 8/8、wiring 5/5、plugin 端到端、bridge 注入 2/2、test:audit 130/130
风险：真实 QQ 唤醒未肉眼验证；真实云端未验证；B站 读取路径未接；默认模型待评测
回滚：设置页切回叙事记忆 / 关闭 vectorMemory.enabled / 回退分支
```
