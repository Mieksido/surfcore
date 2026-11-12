# SurfCore 向量记忆 · Embedding 服务交接书

| 项 | 内容 |
| --- | --- |
| 文档编号 | `SC-HANDOFF-2026-11-02-01` |
| 版本 | `1.0`（契约冻结候选） |
| 日期 | 2026-11-02 |
| 状态 | 待实现；实现完成并通过第 13 节验收后转为“已交付” |
| 交付方 | Embedding 服务实现（GPT） |
| 接收方 | DSH / SurfCore 接入（本会话） |
| 关联系统 | 现有叙事记忆（记忆卡：衰减卡 + 全量卡）**保持不变**；本服务只是新系统「向量记忆」的向量后端 |

---

## 0. 摘要

SurfCore 将新增一套与现有「叙事记忆」并列的记忆系统，命名为 **向量记忆（Vector Memory）**。用户可在设置里二选一启用，默认仍为叙事记忆。

本文只交接**向量记忆所需的 Embedding 服务**：一个跑在用户本机的独立 HTTP 服务，支持三种本地模型（`bge-m3`、`qwen3-embedding-0.6b`、`bge-small-zh-v1.5`）和可选云端 provider。

**你不需要实现向量记忆本身**（索引、检索、提示词注入、设置页都属于 SurfCore 侧）。你只需要保证本服务满足第 6 节的 HTTP 契约、第 11 节的许可证要求、第 13 节的验收标准。

---

## 1. 术语与命名（先统一语言）

### 1.1 两套记忆系统并列

| | 叙事记忆（现有，保持） | 向量记忆（新增） |
| --- | --- | --- |
| 面向用户的名字 | **叙事记忆** | **向量记忆** |
| 数据层名字 | 记忆卡（衰减卡 + 全量卡），文件不变 | 不新建记忆库；索引是同一批记忆的派生只读视图 |
| 英文/代码名 | Narrative Memory / `memory-card`（数据层） | Vector Memory / `memory-vector` |
| 注入方式 | 写侧预渲染 `memory-card-prompt-*.md`，读侧整块注入 | 读侧按当前消息检索，命中才注入 `【想起的旧事】` |
| 遗忘 | 清晰度衰减、遗忘即删除正文 | 自动召回只取“未遗忘”的记录；全量档案只用于显式搜索 |
| 默认 | ✅ 默认启用 | 用户手动切换后启用 |
| 状态 | **代码、数据、文件格式全部不改** | 新增 `memory-vectors.bin/json` 与开关 |

### 1.2 命名表（代码/文件/错误码）

| 概念 | 名称 | 代码/文件 |
| --- | --- | --- |
| 现有系统（用户可见） | **叙事记忆** | 数据层仍是 `memory-card.*`；文件与代码不改 |
| 新产品功能（用户可见） | **向量记忆** | 设置项 `memory.mode = "narrative" \| "vector"` |
| 索引 | 向量索引 | `memory-vectors.bin` + `memory-vectors.json`（角色 `memory/` 目录） |
| 检索 | 向量检索 | `src/memory-vector.js`（SurfCore 侧） |
| 注入块 | 向量注入 | `【想起的旧事】`，≤600 字 |
| 错误码前缀 | — | `vector.*`（SurfCore 侧）；服务侧错误码见 6.5 |
| 本文服务 | Embedding 服务 | 包名 `surfcore-embedding`，命令 `surfcore-embedding` |

**命名分层**：系统面向用户叫「叙事记忆」（现有）和「向量记忆」（新增）；数据层仍叫「记忆卡」，`memory-card.json/md`、`memory-card-full.jsonl` 一行不改。老用户看到的文件名不变，新用户能理解两种回忆方式的区别。

### 1.3 用户选择与数据关系（设计决定）

1. **单选**：`memory.mode` 只能是 `narrative` 或 `vector`，默认 `narrative`。两套同时注入会重复、抢预算，v1 不做混合模式。
2. **同一批数据**：向量记忆不复制、不迁移记忆；它索引 `memory-card.json`（衰减卡，当前 600 条封顶）和 `memory-card-full.jsonl`（全量档案，当前 1478 条）。记忆卡维护器（叙事记忆的写者）仍是唯一写者。
3. **切换只影响注入路径**：从 `narrative` 切到 `vector`，叙事记忆继续维护（衰减/遗忘照常），只是不再注入预渲染块；切回 `narrative` 立即恢复，无需重建记忆。
4. **就绪才允许切换**：Embedding 服务健康 + 模型已安装 + 索引已构建，三者齐备才允许把 `memory.mode` 设为 `vector`；否则保持 `narrative` 并给出设置引导，不允许静默降级。
5. **索引空间隔离**：索引记录 `model_space`；换模型/换量化必须重建，不允许混查。

> 以上是 SurfCore 侧的设计，写在这里是为了让你理解“为什么需要这个服务”。你不需要实现 1.3 的任何一条。

---

## 2. 范围与边界

### 2.1 你交付

- 一个独立 Python 包/服务 `surfcore-embedding`，**不要**塞进现有 `vector_memory` 的记忆库（那个项目继续当实验台）。
- 三种本地模型的安装、加载、推理、HTTP 暴露。
- 可选云端 OpenAI 兼容 provider 代理。
- 模型清单、许可证文件、校验和、安装/卸载命令。
- 健康检查、状态、结构化错误、日志脱敏。
- 测试、文档、Windows 启动说明。

### 2.2 你不交付（也不要做）

- 向量记忆的索引、检索、注入、设置页；
- 记忆卡/衰减/全量卡；
- DSH 插件、SurfCore 代码；
- 替用户决定用哪个模型（用户选，服务只执行）。

### 2.3 我交付（SurfCore 侧，供你了解接口用途）

- JS 客户端：发现、启动/停止、健康检查；
- `memory-vectors.*` 索引构建与检索；
- `memory.mode` 开关与就绪检查；
- `【想起的旧事】` 注入与 token 预算；
- 失败降级与状态展示。

---

## 3. 系统上下文

```
QQ 消息 / B站 唤醒
        │
        ▼
┌───────────────────────────┐
│ SurfCore 桥接 / 调度器     │
│  memory.mode = narrative ?    │
│    ├─ 是：读预渲染记忆卡块  │
│    └─ 否：向量检索          │
│          │                 │
│          ▼                 │
│   memory-vectors.bin ───────┼── 由插件构建（唯一写者）
│          │                 │
│          ▼                 │
│   POST /v1/embeddings ─────┼──► surfcore-embedding（本服务）
│          │                 │         │
│          ▼                 │         ├─ 本地 Ollama / llama.cpp
│   【想起的旧事】≤600 字     │         └─ 云端 provider（可选）
└───────────────────────────┘
```

---

## 4. 模型清单（唯一清单）

| API 模型 ID | 模型 | 维度 | 许可 | 目标体积 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `bge-m3` | BAAI/bge-m3 | 1024 | MIT | 1.2GB F16 | 默认推荐；8K；免指令；100+ 语言 |
| `qwen3-embedding-0.6b` | Qwen/Qwen3-Embedding-0.6B | 1024 | Apache-2.0 | 639MB Q8 | 体积更小；32K；查询侧建议加指令 |
| `bge-small-zh-v1.5` | BAAI/bge-small-zh-v1.5 | 512 | MIT | ~50MB F16 | 低配机 |

**模型空间 ID**（写进索引，必须稳定）：

- `bge-m3@1024-f16-v1`
- `qwen3-embedding-0.6b@1024-q8-v1`
- `bge-small-zh-v1.5@512-f16-v1`

> 量化方式、预处理、revision 任一变化 → 必须换新的 space ID，禁止复用旧 ID。

---

## 5. 运行时选择

### 方案 A（v1 必须）：Ollama 后端

- 检测本机 Ollama（默认 `127.0.0.1:11434`）；
- `bge-m3`、`qwen3-embedding:0.6b` 走 `ollama pull`；
- `bge-small-zh-v1.5` 不在 Ollama 官方库，由你提供 GGUF，用 `ollama create` 注册；
- 优点：模型管理、并发、GPU 交给 Ollama；服务只做网关。

### 方案 B（v1 可选，不阻塞）：自带 llama.cpp 后端

- 随包带 `llama-server.exe`（MIT）或 `llama-cpp-python`（MIT）+ GGUF；
- 不依赖 Ollama；
- 必须验证 Windows 10/11 x64、无管理员权限、CPU 可跑。

**要求**：v1 至少把 A 跑通；B 作为可选后端，接口不变。不要为 B 拖延 A。

---

## 6. HTTP 接口规范（规范性，冻结）

> 本节使用 MUST / SHOULD / MAY 表示约束强度。所有字段名、路径、错误码在 v1 内冻结；变更必须升 `apiVersion` 并提前通知。

### 6.1 通用

- 只绑定 `127.0.0.1`；MUST NOT 监听 `0.0.0.0`。
- 默认端口 **18765**；可用环境变量 `SURFCORE_EMBED_PORT` 覆盖。
- UTF-8；`Content-Type: application/json`；请求体上限 2 MiB。
- 所有响应带 `X-Request-Id`（与错误体 `request_id` 一致）。
- 不得在日志中记录：请求原文、向量、API key、token。

### 6.2 发现文件

服务启动成功后 MUST 写入：

```
%USERPROFILE%\.dsh\surfcore\embedding-service.json
```

```json
{
  "schema": 1,
  "apiVersion": "v1",
  "port": 18765,
  "pid": 1234,
  "startedAt": "2026-11-02T10:00:00+08:00",
  "token": "<随机串>",
  "defaultModel": "bge-m3",
  "backend": "ollama"
}
```

- 文件 MUST 仅当前用户可读（Windows ACL）。
- 服务退出时 SHOULD 删除该文件。
- 端口被占 MUST 以非零码退出，错误里给 `hint`；不得静默换端口。

### 6.3 认证

- 除 `/health` 外，所有请求 MUST 带 `Authorization: Bearer <token>`。
- token 缺失/错误 → 401，错误体见 6.5。
- token 由服务生成并写入发现文件；不得写入普通日志。

### 6.4 端点

#### `GET /health`

```json
{"ok": true, "service": "surfcore-embedding", "version": "1.0.0", "uptime_s": 123}
```

#### `GET /v1/models`

```json
{
  "object": "list",
  "data": [
    {
      "id": "bge-m3",
      "object": "model",
      "provider": "local",
      "dimension": 1024,
      "model_space": "bge-m3@1024-f16-v1",
      "installed": true,
      "loaded": false,
      "size_bytes": 1200000000,
      "license": "MIT",
      "backend": "ollama",
      "context": 8192
    }
  ]
}
```

- MUST 列出全部三种本地模型（即使未安装，`installed=false`）。
- 配置了云端时，云模型也出现在列表里，`provider="cloud"`。

#### `POST /v1/embeddings`

请求：

```json
{"model": "bge-m3", "input": "今天加班到很晚", "encoding_format": "float"}
```

批量：

```json
{"model": "bge-m3", "input": ["句子一", "句子二"], "encoding_format": "float"}
```

成功：

```json
{
  "object": "list",
  "data": [
    {"object": "embedding", "index": 0, "embedding": [0.1, -0.2, "..."]}
  ],
  "model": "bge-m3",
  "model_space": "bge-m3@1024-f16-v1",
  "dimension": 1024,
  "usage": {"prompt_tokens": 12}
}
```

约束：

- 向量 MUST 做 L2 归一化。
- 批量 MUST 按输入顺序返回，`index` 从 0 连续。
- 单次批量上限 64 条；超过 → `request.invalid`。
- 单条文本超过模型上下文 → `request.too-long`，不得静默截断（除非显式传 `truncate=true`，v1 不支持）。
- `dimension` MUST 与 `model_space` 一致。
- 中文、emoji、换行按 UTF-8 原样处理。

#### `GET /v1/status`

```json
{
  "ok": true,
  "backend": "ollama",
  "loaded_model": "bge-m3",
  "loaded_since": "2026-11-02T10:00:00+08:00",
  "models_dir": "C:\\Users\\...\\embedding\\models",
  "cloud": {"enabled": false},
  "last_error": null
}
```

- MUST NOT 返回 key、token、原文、完整路径中的用户名（可脱敏）。

### 6.5 错误契约

所有非 2xx MUST 同时满足：

```json
{
  "ok": false,
  "code": "model.not-installed",
  "error": "模型 bge-m3 尚未安装",
  "hint": "运行 surfcore-embedding models install bge-m3",
  "request_id": "req_...",
  "error_obj": {
    "message": "模型 bge-m3 尚未安装",
    "type": "invalid_request_error",
    "code": "model.not-installed"
  }
}
```

> `error_obj` 用于兼容 OpenAI 风格客户端；SurfCore 读顶层 `code/error/hint`。

| code | HTTP | 含义 |
| --- | --- | --- |
| `request.invalid` | 400 | 参数/结构错误 |
| `request.too-long` | 413 | 文本超长 |
| `model.unknown` | 404 | 模型 ID 不在清单 |
| `model.not-installed` | 424 | 模型未安装 |
| `model.load-failed` | 500 | 加载失败（GGUF 损坏等） |
| `backend.unavailable` | 503 | Ollama 未启动/不可达 |
| `backend.timeout` | 504 | 推理超时 |
| `dimension.mismatch` | 500 | 维度与 space 不一致 |
| `cloud.not-configured` | 503 | 云未配置 |
| `cloud.auth-failed` | 502 | 云 key 无效 |
| `cloud.rate-limited` | 429 | 云限流 |
| `cloud.unavailable` | 502 | 云不可达 |
| `internal.error` | 500 | 兜底 |

错误体 MUST NOT 包含密钥、原始请求文本、provider 原始响应全文。

### 6.6 版本与兼容

- 所有路径以 `/v1` 开头；破坏性变更升 `/v2`。
- 新增可选字段是兼容的；删除/重命名字段必须升版本。
- `apiVersion` 同时出现在发现文件和 `X-API-Version` 响应头。

---

## 7. 模型生命周期

- 启动时 MUST NOT 强制加载模型（服务要能在无模型时正常启动）。
- 按需懒加载；默认同时只加载一个模型；切换时卸载旧模型。
- 加载/卸载 MUST 串行化，避免并发写坏。
- `GET /v1/models` 的 `installed/loaded` MUST 实时准确。
- 模型缺失时 `/v1/embeddings` 返回 `model.not-installed`，服务不崩。
- 可选：空闲 10 分钟卸载（默认关闭，配置项控制）。

---

## 8. 模型安装与目录

```
surfcore-embedding models list
surfcore-embedding models install bge-m3
surfcore-embedding models install qwen3-embedding-0.6b
surfcore-embedding models install bge-small-zh-v1.5
surfcore-embedding models verify
surfcore-embedding serve
```

目录：

```
%USERPROFILE%\.dsh\surfcore\embedding\
  models\
    bge-m3\model.gguf
    qwen3-embedding-0.6b\model.gguf
    bge-small-zh-v1.5\model.gguf
  manifest.json
  config.json
  logs\
  licenses\
```

`manifest.json` MUST 记录：`id / file / sha256 / dimension / model_space / license / source_url / revision / quantization`。

- 安装 MUST 显式触发，不静默下载。
- 下载 MUST 校验 sha256；不符 → `model.load-failed` + hint。
- 支持断点/重试（SHOULD）。

---

## 9. 云端 provider（可选，但接口要预留）

配置（不得落明文 key）：

```json
{
  "cloud": {
    "enabled": true,
    "endpoint": "https://api.siliconflow.cn/v1/embeddings",
    "model": "BAAI/bge-m3",
    "model_space": "bge-m3@1024-cloud-v1",
    "api_key_env": "SURFCORE_EMBED_API_KEY",
    "allow_remote": true,
    "timeout_s": 30,
    "retries": 1
  }
}
```

要求：

- key 只从环境变量读；不写配置、不写日志、不回显。
- 只允许 HTTPS（本机回环 HTTP 除外）；拒绝私网/链路本地/回环（除显式 allowlist）。
- 超时、重试、限流、鉴权失败映射到 6.5 的 `cloud.*` 错误码。
- 云端响应中的 `usage` MUST 原样透传（SurfCore 要记账）。
- 云与本地可同时配置；一次请求只走一个，由 `model` 选择。

---

## 10. 安全与隐私

- 仅回环监听；默认要求 token。
- 不记录原文/向量/密钥。
- 请求体大小、批量大小、并发数必须有上限。
- 云端默认关闭；开启需显式配置 + 用户知情。
- 错误信息不得泄露服务器绝对路径中的用户名（可脱敏为 `%USERPROFILE%`）。

---

## 11. 许可证与再分发（硬要求）

| 模型 | 许可 | 可否随包分发 |
| --- | --- | --- |
| bge-m3 | MIT | ✅ |
| qwen3-embedding-0.6b | Apache-2.0 | ✅ |
| bge-small-zh-v1.5 | MIT | ✅ |

随包 MUST 带：

- `licenses/MIT.txt`、`licenses/Apache-2.0.txt`；
- 每个模型的 `MODEL_CARD.md`（名称、来源 URL、revision、许可、量化/转换说明）；
- `THIRD_PARTY_NOTICES.md`（若打包 Ollama / llama.cpp 等）；
- `manifest.json` 中的 sha256。

MUST NOT 打包：

- Jina v3（CC BY-NC 4.0）；
- EmbeddingGemma（Gemma 使用条款）；
- 来路不明的第三方 GGUF；
- 任何未声明许可的权重。

若对 bge-small-zh 做 GGUF 转换/量化，MUST 在模型卡中注明“converted/quantized，权重未改变/有损量化”。

---

## 12. 性能目标（在测试机上报实测）

| 模型 | 冷加载 | 单句 CPU | 批量 32 句 | 常驻内存 |
| --- | --- | --- | --- | --- |
| bge-small-zh-v1.5 | ≤ 2s | ≤ 20ms | ≤ 400ms | ≤ 500MB |
| qwen3-embedding-0.6b | ≤ 10s | ≤ 120ms | ≤ 2s | ≤ 1.5GB |
| bge-m3 | ≤ 10s | ≤ 120ms | ≤ 2s | ≤ 2.5GB |

必须报实测值 + 机器配置（CPU/内存/GPU）。达不到要说明瓶颈与优化选项，不得用“应该”代替数字。

---

## 13. 测试与验收

### 13.1 必须有的测试

1. 三个模型分别返回 1024 / 1024 / 512 维；
2. 同一文本两次调用，向量一致（同后端内）；
3. 批量顺序/数量正确；
4. 中文、英文、emoji、换行不报错；
5. 模型未安装 → `model.not-installed` + hint，服务不崩；
6. 模型切换：A → B，旧模型卸载、新模型加载，`/v1/models` 状态正确；
7. Ollama 未启动 → `backend.unavailable` + hint；
8. 云 provider 用 mock 测：成功、401、429、超时；
9. 错误体同时含顶层 `code/error/hint` 与 `error_obj`；
10. token 缺失/错误 → 401；
11. 端口被占 → 明确失败；
12. 许可证文件齐全；
13. 日志中无原文、无 key、无 token；
14. 发现文件可被外部正确读取，退出后删除。

### 13.2 交付物

- [ ] `surfcore-embedding` 包/服务，Windows 无管理员权限可跑；
- [ ] `README.md`：安装、启动、配置、模型安装、故障排查；
- [ ] `openapi.json`；
- [ ] 实测性能表；
- [ ] 许可证包；
- [ ] 一份 `curl` 示例：三个模型 + 一个错误；
- [ ] 一个可运行实例 + 发现文件，供契约联调。

### 13.3 验收判据

- 第 6 节契约逐条通过（含错误码、发现文件、token、维度）；
- 三个模型都能在同一台机器上切换运行；
- 断网时本地模型可用；云配置错误时错误码正确、不崩；
- 许可证包完整；
- 我这边能用 JS 客户端完成“启动 → 健康 → 建模索引 → 查询”闭环。

---

## 14. 建议排期

| 天 | 内容 |
| --- | --- |
| 1 | 服务骨架 + `/health` + 发现文件 + token + 错误契约 |
| 2 | Ollama 后端 + bge-m3 跑通 |
| 3 | qwen3-0.6b + bge-small-zh（GGUF / `ollama create`）+ 模型切换 |
| 4 | 云端 provider + 错误映射 + 安全校验 |
| 5 | 测试、性能实测、许可证包、文档 |
| 6 | 可运行实例 + `openapi.json`，契约联调 |

---

## 15. 明确不要做

1. 不要做记忆库/SQLite/衰减/tenant——那是 `vector_memory` 的事；
2. 不要做向量记忆的索引、检索、注入、设置页；
3. 不要做 DSH 插件、不要碰 SurfCore 代码；
4. 不要静默下载模型；
5. 不要在未配置时把文本发到云端；
6. 不要日志记录原文/密钥；
7. 不要打包 CC BY-NC / Gemma 条款模型；
8. 不要要求管理员权限；
9. 不要改模型名冒充官方。

---

## 16. 我这边会依赖的冻结项

SurfCore JS 客户端只依赖以下内容：

1. 发现文件路径与字段：`port / token / apiVersion / defaultModel`；
2. `GET /health` 作为启动探测；
3. `GET /v1/models` 的 `id / dimension / model_space / installed / loaded / provider`；
4. `POST /v1/embeddings` 的请求/响应结构；
5. 6.5 的错误码表；
6. `model_space` 作为索引隔离与重建依据。

**以上任何一项改动，必须升 `apiVersion` 并提前通知。**

---

## 17. 待你确认/回报的事项

1. `bge-small-zh-v1.5` 的 GGUF 来源：官方/社区/自行转换？若是自行转换，给出转换脚本与校验；
2. 方案 B（自带 llama.cpp）是否能在 v1 内完成；不能则明确写“v1 仅 Ollama”；
3. 实测性能与机器配置；
4. 云端默认接哪家（建议硅基流动 `BAAI/bge-m3`），以及 `usage` 字段是否可用；
5. 发现文件在 Windows 上的 ACL 实现方式（是否用 `icacls`）。

---

*本文是 SurfCore 侧的设计与契约，不是 `vector_memory` 的扩展说明。向量记忆的索引、检索、注入和设置页由 SurfCore 实现；本服务只负责“文本 → 向量”。*
