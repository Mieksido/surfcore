# 向量记忆（独立系统）设计与使用

> 状态：`feat/vector-memory-impl` 首个实现；契约文档见
> [`../handoffs/2026-11-02-vector-memory-embedding-service.md`](../handoffs/2026-11-02-vector-memory-embedding-service.md)。
> 叙事记忆卡（衰减卡 + 全量卡）保持不变；两套系统并列，用户二选一读取。

## 1. 和叙事记忆的关系

| | 叙事记忆（现有） | 向量记忆（新增） |
| --- | --- | --- |
| 数据 | `memory-card.json` / `memory-card-full.jsonl` | `vector-memory.jsonl`（独立） |
| 写入 | 记忆卡维护器 | 向量记忆维护器（独立） |
| 读取 | 预渲染 `memory-card-prompt-qq.md` | 按当前消息检索，命中才注入 |
| 遗忘 | 清晰度衰减 / 遗忘 | 不衰减；按重要度/新近度排序 |
| 开关 | `memoryCard.enabled` | `vectorMemory.enabled` |
| 读取选择 | `memory.mode = narrative` | `memory.mode = vector` |

**存储和读取解耦**：不管 `memory.mode` 选哪个，两个存储都继续写入（除非用户单独关闭对应开关）；切换只改变“读哪一套”。

## 2. 数据流

```
QQ / 桌宠 / B站 事件
   │
   ├─ 记忆卡维护器 → memory-card.*（叙事，不变）
   │
   └─ 向量记忆维护器（插件，每 10 分钟）
          │ 摄取 memory-inbox.jsonl / bili-memory.json
          ▼
     vector-memory.jsonl（append-only，独立记录）
          │ 只编码缺的/变了的记录（按 textHash）
          ▼
     POST /v1/embeddings（本机 Embedding 服务）
          ▼
     vector-memory-index/<modelSpace>.bin + .json（按 model_space 分文件）
          │
          ▼
     桥接唤醒：读索引 → 查询向量 → 余弦/词法/重要度/新近度 → topK
          ▼
     【想起的旧事】≤600 字（只注入命中项）
```

## 3. 文件与所有权

每个角色 `memory/` 目录：

- `vector-memory.jsonl`：记录，append-only；id 去重；只由插件写；**三个模型共享这一份**；
- `vector-memory-index/<modelSpace>.json`：每个模型空间一份 manifest（模型、空间、维度、条目、offset、textHash、文本/元数据）；
- `vector-memory-index/<modelSpace>.bin`：Float32 小端向量，顺序与 manifest entries 一致；
- 旧版 `vector-memory-index.json/.bin` 仍可读，只在空间完全匹配时作为兼容回退；
- `memory-inbox.jsonl`：桥接 append，向量记忆与记忆卡共同读取。

**单写者**：插件维护器写；桥接只读索引和记录，不写任何向量记忆文件。

## 4. 摄取规则

- **QQ**：主人私聊/群聊、直接对她说、有情绪的公开发言（桥接已过滤）；
- **桌宠**：`platform=pet`，scope=pet；只要 `memoryCard.enabled` 与 `vectorMemory.enabled` **任意一个**开着，桌宠对话就继续写共享 inbox（`pet.chat.remember` 是总开关）；
- **B站**：`bili-memory.json` 的 entries，scope=bili；
- 跳过命令、图片/表情/转发/拍一拍占位、空文本；
- 入库前再做一次脱敏（密钥形状、手机号、长串）；
- 敏感话题记录 `sensitive=true`，检索时排除；
- 同一 `platform|sender|日期|文本` 生成稳定 id，重复摄取不会重复写入。

## 5. 索引与模型空间

- `model` / `modelSpace` 必须与 Embedding 服务一致；
- 服务返回的 `model_space` 不一致 → `vector.model-space-mismatch`，不写索引；
- 维度不一致 → `vector.dimension-mismatch`；
- 换模型：`vector-memory.jsonl` 记录不复制；每个 `modelSpace` 一份自己的索引；
  - 第一次切到某个模型：维护器/「重建索引」用该模型编码一份新索引；
  - 已经建过的模型：切回去直接读旧索引，不需要重新摄取/重建；
- 索引写入先 bin 后 manifest；读者看到 manifest 时 bin 必完整；
- 每次维护最多编码 `maxEmbedPerTick` 条，剩下的下一个 tick 继续，不阻塞插件；手动「重建索引」会循环到 `pending=0`（可能几分钟），不是只编一批；
- 服务未启动：记录仍继续写，索引暂不更新；状态显示待编码数量与错误。

## 6. 检索与注入

- 查询：
  - QQ：当前最后一条非自身消息（截 300 字）；
  - B站：本次 prompt 的最后一段文本（截 300 字，最多取 600 字上下文）；
  由 Embedding 服务编码；
- 打分：`0.65*余弦 + 0.15*词法 + 0.10*重要度 + 0.10*新近度`；
- 阈值：`minScore`（默认 0.4）；topK 默认 4；
- 过滤：`sensitive` 永不出现在注入块；B站 平台只允许 bili/shared；QQ 允许全部非敏感；
- 注入：`【想起的旧事】`，≤`injectMaxChars`（默认 600 字）；无命中不注入；
- B站：`memory.mode=vector` 时不再注入 `memory-card-prompt-bili.md`；`promptBili` 把检索块插到 prompt 最前面；
- `qq_get_prompt`：vector 模式下 `memoryCard` 返回空，并带 `memoryMode/memoryHint`，避免工具回显整张叙事卡；
- 检索失败（服务未启动/空间不匹配）：不注入、写节流日志；不阻塞 QQ 唤醒或 B站 本轮 prompt、不影响叙事记忆。

## 6.1 记忆库（只读预览）

设置页「记忆 → 向量记忆」里有可折叠的记忆库：

- 「最近记录」：按 `createdAt` 倒序读最近 30 条，不需要 Embedding 服务；
- 「语义搜索」：输入一句话，用当前模型编码后在当前 `modelSpace` 索引里检索，显示日期、平台/来源、正文、相似度；
- 只读，不写 `vector-memory.jsonl` / 索引；
- 默认隐藏 `sensitive: true` 的记录，列表会显示隐藏数量；
- 搜索失败会显示可行动错误：
  - `vector.query-empty`：没输入；
  - `vector.index-missing`：当前模型没建索引，先去重建；
  - `vector.service-down`：runtime 没启动。

对应 action：`library-list` / `library-search`。

## 7. 配置

合体层 `~/.dsh/surfcore/config.json`：

```json
{
  "memory": { "mode": "narrative" },
  "vectorMemory": {
    "enabled": true,
    "provider": "local",
    "model": "bge-m3",
    "modelSpace": "bge-m3@1024-f16-v1",
    "cloudModel": "BAAI/bge-m3",
    "cloudModelSpace": "bge-m3@1024-cloud-v1",
    "packId": "bge-m3",
    "packShareUrl": "https://pan.example/s/xxxx?pwd=xxxx",
    "packSharePassword": "xxxx",
    "packShareDir": "embedding",
    "discoveryFile": "D:\\ollama\\embedding-service.json",
    "topK": 4,
    "minScore": 0.4,
    "injectMaxChars": 600,
    "batchSize": 32,
    "maxEmbedPerTick": 256
  }
}
```

说明：

- `provider`：`local` = 本机 Ollama；`cloud` = Embedding 服务里的 OpenAI 兼容 provider；
- `packId`：当前选中的 `state/embedding-packs/<id>`；由设置页「Embedding 功能」选择；
- `packShareUrl` / `packSharePassword` / `packShareDir`：四个 zip 放在同一个网盘目录时，设置页的公用链接/提取码/目录名；单模型 `packLinks` 有值时优先；
- `cloudModel` / `cloudModelSpace`：云端必须用**独立 modelSpace**（例如 `bge-m3@1024-cloud-v1`），
  不要和本地 `bge-m3@1024-f16-v1` 混用；
- 云端 endpoint / API key 保存在本机
  `state/embedding-packs/cloud/config.json`（mode 0600），设置页只显示掩码；
  启动 runtime 时会转成 `SURFCORE_EMBED_CLOUD_ENDPOINT` / `SURFCORE_EMBED_API_KEY`；
- 云端索引可以点「为多个模型重建索引」，在弹出的多选里勾选对应云端服务商；
  也可以选中云端后单独用「重建索引」；
  切换到云端后，自动补索引也会按云端 modelSpace 计算 pending；
- 云端会把记忆正文发给 provider，设置页会显示明确警告；
- `discoveryFile` 留空 = `%USERPROFILE%\.dsh\surfcore\embedding-service.json`；
- 也可以直接配 `serviceUrl`（如 `http://127.0.0.1:18765`）+ `token`；
- `memory.mode`：`narrative` 或 `vector`，默认 `narrative`；
- 两个存储开关独立：`memoryCard.enabled` / `vectorMemory.enabled`。

## 8. API

- `GET /dsh-surfcore/api/vector-memory`：状态 + 最近记录；
- `POST /dsh-surfcore/api/vector-memory`：
  - `{"action":"maintain"}`：立即摄取 + 编码一批；
  - `{"action":"rebuild"}`：忽略旧索引，重新编码（分批，状态可见）。

失败返回 `{ok:false, code, error, hint}`。

## 9. 失败与降级

| 情况 | 行为 |
| --- | --- |
| Embedding 服务未启动 | 记录继续写；索引停更；状态/设置页红字；不影响叙事记忆 |
| 模型空间不一致 | 不写索引；提示重建；桥接不注入 |
| 维度不一致 | 不写索引；提示检查 model/modelSpace |
| 索引损坏/缺失 | 桥接不注入；可重建 |
| 服务超时 | 本次跳过；下个 tick 重试 |
| 用户关闭向量存储 | 不再摄取/编码；已有索引保留；读取向量模式时无新内容 |

## 10. 模型 / 运行时打包（不能塞进 SurfCore）

三个本地模型（48MB / 639MB / 1.2GB）和 Embedding 运行时都**不进 SurfCore 本体**，按语音包的方式做可选安装包：

- 模型包、运行时包、云端包分开；
- 安装到 `state/embedding-packs/`，不进 `release/install-manifest.json`，SurfCore 更新不碰；
- 云端包没有权重，只有 provider 配置 + key，密钥不写进 SurfCore；
- 详细契约见 [`EMBEDDING_PACKS.md`](EMBEDDING_PACKS.md)。

当前分支已实现 pack manager（runtime/model/cloud + 设置页 + API）；runtime 自带 Ollama CPU，模型包自动注册，本机无系统 Ollama 验收通过。干净 Windows VM、真实云端 key、GPU 加速仍待补，详见 [`EMBEDDING_PACKS.md`](EMBEDDING_PACKS.md)。

## 11. 验证

```powershell
node scripts/test-vector-memory.mjs
node scripts/test-vector-memory-wiring.mjs
node scripts/test-vector-memory-plugin.mjs
node scripts/test-vector-memory-bridge.mjs
npm run test:audit
```

真实链路（需要 `D:\ollama` 或本机 Embedding 服务）：

1. 启动 `surfcore-embedding`；
2. 设置页「记忆」→「记忆方式」切到向量记忆；
3. 「立即整理」→ 状态 `已索引` 增长；
4. QQ 发一条会命中旧事的消息 → 提示词出现 `【想起的旧事】`；
5. 切回叙事记忆 → 恢复 `【记忆卡】` 注入。

## 12. 回滚

- 设置页切回 `narrative`：立即恢复记忆卡注入；
- 关闭 `vectorMemory.enabled`：停止摄取/编码；
- 删除 `vector-memory*` 三个文件：只丢向量索引/记录，不影响记忆卡；
- 代码层：回退 `feat/vector-memory-impl` 分支即可；没有数据迁移、没有改 `memory-card.*` 格式。
