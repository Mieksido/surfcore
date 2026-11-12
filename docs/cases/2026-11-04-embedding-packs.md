# 2026-11-04 Embedding 模型/运行时/云端按需安装包

## 现象

- 向量记忆的三个本地模型（48 MB / 639 MB / 1.2 GB）和运行时如果塞进 SurfCore，更新包会膨胀到 GB 级，不装向量记忆的用户也被迫下载；
- 之前只有开发机 `D:\ollama` + 外部 `surfcore-embedding` 模式，设置页只填 discovery 路径，没有“安装/选择/启动/卸载”；
- 云端只有 provider 配置，没有独立的云端包/key 管理；
- 用户要求：像语音包一样按需安装，不能打包进 SurfCore。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 | Windows 11 |
| 分支 | `feat/vector-memory-impl`（已合并 dev `82addb7`） |
| 运行时 | Node 版 `embedding-service.mjs`；本机 Ollama 0.40.13 `127.0.0.1:11434` |
| 包 | runtime、bge-small、qwen3、bge-m3、cloud（外部目录，不进仓库） |

## 根因

- SurfCore 是更新包/zip 分发，模型权重和 Python/Ollama 运行时属于“可选资产”，不能进入 `release/install-manifest.json`；
- 旧代码没有包根目录、manifest 校验、安装/卸载、启动/停止 API；设置页只认 `discoveryFile`/`serviceUrl`；
- 云端 key 没有本地存储，只靠服务环境变量；用户无法在 UI 完成配置。

## 完整逻辑

- **链路**：
  - 设置页「Embedding 功能（可选安装）」→ `/api/embedding-packs` → 插件 `lib/embedding-packs.js`；
  - 安装：本地 zip/目录或 URL → 解压/下载 → `src/embedding-packs.js` 校验 manifest/SHA → 复制到 `state/embedding-packs/<id>/` → 原子 rename；
  - 启动：runtime 包 `run.bat` → Node `embedding-service.mjs` → 自带 Ollama CPU 运行时（`127.0.0.1:11435`）→ 自动 `ollama create` 注册模型 → 写 discovery；本地走 Ollama `/api/embed`，云端走 OpenAI 兼容 endpoint；
  - 选择：把 `packId/model/modelSpace`（云端为 `cloudModel/cloudModelSpace`）写入合体层 `vectorMemory`；向量维护器下一 tick 用新模型；桥接下一轮读新配置。
- **机制**：
  - 包是独立目录，卸载 rename 到 `_quarantine/embedding-packs/`，不硬删；
  - 安装前校验 `files[].sha256/size`，坏包/缺文件/路径逃逸都拒绝并给 `code/hint`；
  - 下载是后台 job，UI 轮询 `/api/embedding-packs?job=` 显示 bytes/total；
  - 云端 key 写在 `state/embedding-packs/cloud/config.json`，状态接口只返回 `hasKey/keyMasked`，不返回明文；
  - 运行时启动时从云端包配置注入 `SURFCORE_EMBED_CLOUD_*` 环境变量。
- **爆炸半径**：新增 1 个核心模块、1 个插件模块、1 个 Node 运行时、1 个设置页区块、1 个 API；不碰叙事记忆格式/出站/密钥；包目录不在安装清单。
- **取舍**：
  - A（采用）：runtime + model + cloud 三类包，独立目录/独立升级；
  - B：每个模型一个“大包内置 runtime”；简单但重复几百 MB，否决；
  - C：继续外部服务；开发可用，用户不可用，否决。
- **生效与重启**：设置页保存后插件下一 tick 生效；桥接每轮读 `config.json`；启动/停止运行时由包管理器执行；安装新包后需在「选择」里切换。

## 修法

- 新增 `src/embedding-packs.js`：manifest/路径/校验/安装/卸载/列表；
- 新增 `plugins/surfcore/lib/embedding-packs.js`：job 下载/解压、选择、启动/停止、云端配置、状态；
- 新增 `plugins/surfcore/runtime/embedding-service.mjs`：Node `/v1/embeddings` 运行时（本地 Ollama + 云端 OpenAI 兼容）；
- `plugins/surfcore/lib/index.js`：`/api/embedding-packs` 路由；
- `plugins/surfcore/lib/client.js`：设置页「Embedding 功能（可选安装）」；
- `src/vector-memory.js`：`packId` 配置字段；
- 测试：`test-embedding-packs*`、`test-embedding-runtime`；安装清单排除包/权重。

## 验证

- 自动化：`test-embedding-packs` 4/4、`test-embedding-packs-plugin` 通过、`test-embedding-runtime` 通过、`test-embedding-packs-wiring` 4/4；`npm run test:audit` 见最终提交。
- 真实验收（临时 DSH_HOME + **无系统 Ollama**，runtime 自带 Ollama CPU）：
  - 安装 runtime + bge-small → 选择 → 启动 → 自动 `ollama create` → `POST /v1/embeddings` 512 维、L2=1 → 停止 → 卸载；
  - qwen3 639MB → 1024 维；bge-m3 1.2GB → 1024 维；三个模型都在 bundled runtime 上跑通；
  - 云端：本地 mock OpenAI provider，key 只出现在运行时环境变量，状态/接口不泄露；真实 key 未测。
- 干净环境：无包状态返回 `installed:false + hint`，不抛错；无系统 Ollama 的临时 DSH_HOME 通过；干净 Windows VM 仍未跑。

## 遗留 / 后续

- 干净 Windows VM 验收（无系统 Ollama 的本机临时环境已过）；
- 真实云端 key、Windows ACL 加固、大包 CDN/断点续传；
- 切换模型后自动重建索引的 UI 提示（当前手动「重建索引」）；
- GPU 加速包可选（当前 runtime 用 CPU 版 Ollama，~80 MB）；
- 安装包在 `state/embedding-packs/`，与 SurfCore 更新隔离。

## 发布交接块

```text
【本批：Embedding 按需安装包】
分支：feat/vector-memory-impl
提交：见分支 HEAD
范围：pack manager（runtime/model/cloud）、Node embedding runtime（自带 Ollama CPU）、设置页可选安装、/api/embedding-packs
验证：pack 4/4、plugin 通过、runtime 通过、wiring 4/4；无系统 Ollama 下 bge-small/qwen3/bge-m3 真 embedding；云端 mock
风险：干净 Windows VM 未验；真实云 key 未验；切换模型需手动重建索引；GPU 加速未做
回滚：卸载包（quarantine）；关闭 vectorMemory.enabled；回退分支
```
