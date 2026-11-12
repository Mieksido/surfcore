# Embedding 包：模型 / 运行时 / 云端，按需安装

> 状态：核心/插件/API/UI/runtime 已实现（2026-11-04）。runtime 自带 Ollama CPU 运行时，模型包安装后自动 `ollama create` 注册；bge-small、qwen3、bge-m3 在本机无系统 Ollama 的情况下完成安装/选择/启动/检索验收；干净 Windows VM 待跑。
> 目标：SurfCore 本体**不打包**模型权重、不打包 Python/Ollama 运行时；像语音包一样按需安装、独立升级、可卸载。

## 1. 为什么不能塞进 SurfCore

| 东西 | 体积 | 放进本体的问题 |
| --- | --- | --- |
| bge-small-zh-v1.5 | ~48 MB | 小，但会让「不装向量记忆」的用户也下载 |
| qwen3-embedding-0.6b | ~639 MB | 更新包翻倍，流量/安装时间不可接受 |
| bge-m3 | ~1.2 GB | 同上；低配机器根本用不到 |
| Embedding 运行时 | 几十~几百 MB | Python/Ollama 依赖，跟 SurfCore 版本解耦 |
| 云端 provider | 0 权重 | 只是 endpoint/model/space + key，不该占包体 |

SurfCore 主体只保留：**适配器代码 + 包目录 + 安装器 UI/API**。模型、运行时、云端配置都走 `state/embedding-packs/`。

## 2. 三类包

| 类型 | 内容 | 体积 | 是否必需 |
| --- | --- | --- | --- |
| `runtime` | Node `embedding-service.mjs` + Ollama CPU 运行时（`ollama.exe` + `lib/ollama`）+ `run.bat`/`stop.bat` | ~80 MB（CPU） | 本地和云端都必需（云端也走该服务） |
| `model` | 一个 GGUF/模型文件 + `pack.json` | 48 MB / 639 MB / 1.2 GB | 至少装一个本地模型，或只用云端 |
| `cloud` | 无权重；endpoint/model/space 模板 + key 输入 | <1 MB | 可选 |

> 云端模型不是权重包：它只是「provider 预设 + 密钥」。不要把云端模型名/密钥写进 SurfCore 本体。

## 3. 目录

安装根目录：

```
state/embedding-packs/
  runtime/
    embedding-runtime.json
    bin/...
    run.bat
    stop.bat
  bge-small-zh-v1.5/
    pack.json
    model.gguf
  qwen3-embedding-0.6b/
    pack.json
    model.gguf
  bge-m3/
    pack.json
    model.gguf
  cloud/
    pack.json
    config.json          ← endpoint/model/space；key 单独存，ACL 限制
```

- 与 SurfCore 安装目录分离；`release/install-manifest.json` **不包含**这些文件；
- SurfCore 自动更新**不碰** `state/embedding-packs/`；
- 卸载 = rename 到 `_quarantine/`，不硬删。

## 4. `pack.json` 契约

```json
{
  "schema": 1,
  "id": "bge-small-zh-v1.5",
  "kind": "model",
  "name": "bge-small-zh-v1.5（低配）",
  "model": "bge-small-zh-v1.5",
  "modelSpace": "bge-small-zh-v1.5@512-f16-v1",
  "dimension": 512,
  "sizeBytes": 48326944,
  "license": "MIT",
  "requires": ["runtime>=1.0.0"],
  "files": [
    { "path": "model.gguf", "sha256": "d03ac128...", "size": 48326944 }
  ],
  "source": "https://github.com/<owner>/<repo>/releases/download/embedding-pack-bge-small-v1/...",
  "notes": "512 维，适合低配/无独显；中文短文本够用"
}
```

校验顺序：`schema` → `kind` → `id` 与目录一致 → `files[].sha256/size` → `modelSpace` → `requires` → 解压到临时目录再原子 rename。任何一步失败都不覆盖现有包。

## 5. 安装 / 启动 / 卸载

设置页新增「Embedding 功能（可选安装）」：

- 顶部总览：安装状态、服务状态、「浏览器打开网盘链接」「测试服务」；
  - 「测试服务」会真实编码一条短文本，返回 model / dimension / latency，不是只查 `/health`；
  - discovery 还在但 runtime 进程已退出时，状态会报 `vector.service-stale`，不会假显示“运行中”；
- 「本地模型 / 云端模型」两个 Tab；
- 本地 Tab：runtime 行 + 三个模型行，每行右侧「导入」；三个模型各一个单选，选好后点「一键启动 runtime + 选中模型」；
- 云端 Tab：endpoint / 模型名 / 空间 / API Key / allowRemote；「一键启动 runtime + 云端」会在需要时重启 runtime 以加载新的云端配置；
- 高级折叠：公用网盘链接/提取码/目录、手动 zip/URL 安装、发现文件；
- 卸载：停止 → rename 到 `_quarantine/`。

失败必须可见：缺包、校验失败、运行时启动失败、端口占用、模型加载失败，都要返回 `{ok:false, code, error, hint}`，并在设置页显示下一步。

### API

- `GET /dsh-surfcore/api/embedding-packs`：列表 + runtime/model/cloud + 服务状态 + 云端配置（key 只回掩码）；
- `GET /dsh-surfcore/api/embedding-packs?job=<id>`：安装任务进度（bytes/total/phase）；
- `POST`：
  - `{"action":"install","path":"D:\\packs\\x.zip"}` 或 `{"action":"install","url":"https://…/x.zip","overwrite":false}` → 返回 jobId；
  - `{"action":"select","id":"bge-small-zh-v1.5"}`；
  - `{"action":"remove","id":"…"}`；
  - `{"action":"start"}` / `{"action":"stop"}` / `{"action":"test"}`；
  - `{"action":"save-cloud","provider":"zhipu","endpoint":"…","model":"…","modelSpace":"…","apiKey":"…","activate":false}`（保存单个服务商）；
- `{"action":"activate-cloud","provider":"zhipu"}`（启用已保存的服务商）。

## 6. 云端包

- `kind: "cloud"`，无 `files` 权重；
- `config.json` schema 2：
  - `active`：当前启用的服务商；
  - `providers.<id>`：每个服务商各自的 endpoint / model / modelSpace / allowRemote / apiKey；
  - 四个 tab 可分别保存，顶部单选切换启用；旧单份配置读取时会自动迁移；
- API key **不写进 SurfCore 本体**，只在本机 `state/embedding-packs/cloud/config.json`（mode 0600），UI 只显示掩码；
- 安装时必须显示「记忆正文会出机」的隐私警告；
- 云端 provider 仍需 runtime（如果走 `surfcore-embedding`）；若以后 SurfCore 直连 HTTPS，可去掉 runtime 依赖，但 key 存储/ACL 要单独设计；
- 真实 key 验证是发布前门禁，mock 不算。

### 普通用户配置步骤

1. 在服务商注册并创建 API Key，确认它提供 **embeddings** 接口；
2. 设置 → 记忆 → 向量记忆 →「Embedding 功能」→「云端模型」；
3. 填：
   - Endpoint：服务商文档里的完整地址，通常以 `/v1/embeddings` 结尾；
   - 模型名：服务商文档里的 embedding 模型 ID；
   - 模型空间：独立名字，例如 `bge-m3@1024-cloud-v1`；不能和本地 `bge-m3@1024-f16-v1` 混用；
   - 维度：服务商返回多少维会自动识别，不需要手填；模型空间里的维度只是给人看的；
   - API Key：只存本机；智谱 / 阿里云百炼 / OpenAI 的 Key 通常只在创建时显示一次，**创建后立刻粘贴并保存**，关掉控制台就只能重新创建；
   - 允许远程 provider：云端通常必须打开（本机代理才关）；
4. 点「保存这个服务商」→ 顶部单选启用它 →「一键启动 runtime + 云端」；
5. 点「测试服务」，确认返回 model / dimension / latency；
6. 去「向量记忆」点一次「重建索引」，建云端独立索引；
7. 切回本地时，本地索引仍然保留，不需要重建。

常用示例（以服务商文档为准）：

```text
硅基流动
  endpoint   https://api.siliconflow.cn/v1/embeddings
  model      BAAI/bge-m3
  modelSpace bge-m3@1024-cloud-v1

OpenAI
  endpoint   https://api.openai.com/v1/embeddings
  model      text-embedding-3-small
  modelSpace text-embedding-3-small@1536-cloud-v1
```

注意：`为三个模型建索引` 只处理本地模型；云端索引必须用单模型「重建索引」。

如果阿里云百炼的模型广场里只搜到 **Qwen-Embedding**（`qwen3.7-text-embedding-flash`），
而不是 `text-embedding-v3/v4`，用这组：

```text
endpoint   https://maas.qianwenaiapi.com/compatible-mode/v1/embeddings
model      qwen3.7-text-embedding-flash
modelSpace qwen3.7-text-embedding-flash@cloud-v1
```

维度以「测试服务」自检为准，不要手写未确认的维度。
这组使用千问AI平台的 API Key；百炼 Key 和它不通用。

## 7. 和 SurfCore 更新的关系

- SurfCore 更新包只带：`src/vector-memory.js`、插件、包目录/安装器；
- `install-manifest.json` 校验不包含 `state/embedding-packs/`；
- 包升级独立：新版本装到新目录，旧的保留；设置页切换/回滚；
- 语音包已有同样纪律（见 [`../VOICE-PACKS.md`](../VOICE-PACKS.md)）：**不自动更新、不进安装清单**。

## 8. 当前实现状态

已完成（本机验收，外部目录 `D:\deepseekwork\surfcore-embedding-packs`）：

- `src/embedding-packs.js`：manifest 校验、SHA256/大小校验、目录安装、quarantine 卸载、坏包可见；
- 插件 `plugins/surfcore/lib/embedding-packs.js`：下载/解压、安装任务进度、选择、启动/停止、测试、云端配置；
- 设置页「Embedding 功能（可选安装）」：列表、安装、选择、启动/停止/测试、云端表单、未安装提示；
- Node 运行时 `plugins/surfcore/runtime/embedding-service.mjs`：`/health`、`/v1/models`、`/v1/embeddings`、`/v1/status`，本地走 Ollama `/api/embed`，云端走 OpenAI 兼容 endpoint；
- 本机包：runtime（~80 MB，含 Ollama CPU）、bge-small（48 MB）、qwen3（639 MB）、bge-m3（1.2 GB）、cloud；
- runtime 自带 Ollama CPU 运行时，启动时监听 `127.0.0.1:11435`，模型包自动 `ollama create` 注册；无系统 Ollama 也能跑；
- 真实验收：安装 → 选择 → 启动 → bge-small/qwen3/bge-m3 各出 512/1024/1024 维、L2=1 → 停止 → 卸载；云端用本地 mock provider 验证路由与 key 掩码。

**仍未完成：**

1. 干净 Windows VM 验收未做；本机验收证明“无系统 Ollama 也能启动/注册/检索”，但没在全新 OS 上跑过；
2. 真实云端 key 没测（只有 mock provider）；key 的 Windows ACL 还没单独加固；
3. 大包下载源/CDN、断点续传、许可证随包分发还没定；
4. 模型切换后自动重建索引的 UI 提示还没有（当前需手动「重建索引」）；
5. runtime 使用 CPU 版 Ollama（~80 MB）；如需 GPU 加速，CUDA/Vulkan 运行时需另做可选“加速包”。

## 9. 落地顺序（更新）

1. ~~runtime + bge-small 小包，安装/选择/启动/检索/卸载~~ ✅ 本机通过；
2. ~~qwen3 / bge-m3 大包，安装/选择/切换~~ ✅ 本机通过；
3. ~~云端包配置 + mock provider 路由~~ ✅ 本机通过；真实 key 待验；
4. ~~runtime 自包含：Ollama CPU + 模型自动注册~~ ✅ 本机无系统 Ollama 通过；
5. 干净 Windows VM 验收 → 合并 `dev`。

## 10. 待决问题

- 大模型分发：GitHub Release asset / 镜像 / 离线 zip，是否需要断点续传；
- 默认包：低配默认 `bge-small`，还是首次安装让用户三选一；
- 云端是否允许绕过运行时直连（影响 key 存储与依赖体积）；
- GPU 加速包是否作为单独可选包（当前 CPU 版优先保证能跑）。
