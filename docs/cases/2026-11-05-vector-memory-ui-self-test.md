# 向量记忆：UI 去重、一键启动、真实自检与完整重建

## 现象

- 用户看到什么（原话尽量保留）：
  - 「向量记忆 tab 里本地模型和 embedding 来源，你不觉得重复且多余吗。不如直接把 embedding 功能展开后做成两个 tab，本地模型和云端模型两个 tab」；
  - 「我怎么确定我点了启动之后真的启动呢」；
  - 用户点「重建索引」时遇到 `Embedding 服务发现文件不存在；启动 surfcore-embedding...`；
  - 索引显示 1536 条，但实际活跃记录 3267 条（raw 4107 行，unique 3273）。
- 复现步骤：
  1. 启动 DSH，打开设置 → 记忆 → 向量记忆；
  2. 在「向量记忆」和「Embedding 功能」两处都能改 provider/model，配置来源重复；
  3. 重启 DSH 后 `embedding-service.json` 还在，但 runtime 进程已经被带走；旧 UI 仍显示“运行中”；
  4. 点「重建索引」只编码 `maxEmbedPerTick=256` 条就返回，需要反复点；
  5. 循环重建到 3072 条时遇到一条空文本，整批返回 `HTTP 400`，重建停在 195 条 pending。
- 影响面：
  - 不影响叙事记忆；向量记录继续写；
  - 会让用户误以为索引已全量、服务已启动，实际检索只覆盖一部分记录或直接失败；
  - 不丢数据；索引可重建。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 / DSH 版本 | Windows / DSH 0.2.1-rc.5 |
| SurfCore 版本 | 0.8.8-dev.1（`feat/vector-memory-next`） |
| 安装方式 | git worktree + `~/.dsh/plugins/surfcore` junction |
| 其它相关版本 | bge-m3 / bge-small / Qwen3-Embedding；runtime 1.1.0 |

## 根因

- 代码位置：
  - `plugins/surfcore/lib/client.js`：`EmbeddingPackPanel` / `MemoryTab`；两处 provider/model 控件；
  - `plugins/surfcore/lib/embedding-packs.js`：`serviceStatus()` 只看 discovery；`startEmbeddingRuntime()` 只看 `.runtime-pid`；`testEmbeddingPack()` 只查 `/health`；
  - `plugins/surfcore/lib/vector-memory.js`：`rebuildVectorMemory()` 只调用一次 `runVectorMemoryMaintenance({forceRebuild:true})`。
- 问题链条：
  1. UI 两处写同一份 `vectorMemory.provider/model`，用户不知道哪边生效；
  2. DSH 重启时子进程退出，但 discovery 文件没被清；`serviceStatus` 只看文件 → 假在线；
  3. `/health` 只证明 HTTP 进程活着，不证明模型能编码；
  4. `runVectorMemoryMaintenance` 单次最多编码 `maxEmbedPerTick` 条；`rebuild` 没循环 → 一次只前进一批；
  5. 单模型空间索引只覆盖已编码记录，检索自然缺后半段；
  6. 维护器把 `merged.records` 直接送进 embedding；`loadVectorRecords` 只过滤了空字符串，但 `mergeVectorRecords` 的 incoming 仍可能带空白正文，服务端 `input 不能为空` 返回 400，整批 32 条一起失败。
- 为什么之前没发现：
  - 开发机一直有手工启动的服务，discovery 大多数时候是真的；
  - 单测用 fake service，只验证维护一批；
  - UI 没做“真实编码”验收。

## 完整逻辑（给用户看的那一遍）

- **链路**：
  - 设置页 `client.js` → `/dsh-surfcore/api/embedding-packs` → `lib/embedding-packs.js` → `state/embedding-packs/runtime/run.bat` → Node `embedding-service.mjs` + 内置 Ollama（11435）→ discovery（18765）；
  - `vector-memory.js` 维护器读 `vector-memory.jsonl`，按当前 `modelSpace` 写 `vector-memory-index/<space>.json/.bin`；
  - 检索：bridge/scheduler 调 `recallVectorMemories`，读同一份索引。
- **机制**：
  - 记录共享、索引按 `modelSpace` 分文件；切换模型只换读取索引；
  - `service.pid` 是 runtime 自己写的进程号；discovery 只是发现文件，不是存活证明；
  - `/health` 是 HTTP 层，`/v1/embeddings` 才是模型层；
  - `maxEmbedPerTick` 是“单次维护上限”，不是“重建总量”。
- **爆炸半径**：
  - 进程数：1 个 runtime + 1 个 Ollama；重启会短暂中断编码，不影响叙事记忆；
  - 读者：向量维护器、bridge 唤醒、B站 scheduler、设置页状态；静默错误影响面 3；
  - 不碰密钥；自检只发一条固定短文本到本机服务（云端模式会发到用户配置的 provider）。
- **取舍**：
  - A：只改 UI 文案，让用户多点几次重建（成本低，但违背“一键”预期）；
  - B：重建循环到 `pending=0`（本次选 B；代价是一次请求可能几分钟，收益是一次点击真正完成）；
  - C：引入后台任务 + 进度轮询（体验最好，但本轮不扩大改动面；列为后续）。
- **生效与重启**：
  - `client.js` 改动需要完整重启 DSH（不是刷新页面）；
  - `embedding-packs.js` / `vector-memory.js` 由插件宿主加载，同样需要重启 DSH；
  - runtime 进程重启只影响编码，不影响已有 JSONL。

## 修法

- **UI 去重**：
  - Embedding 功能内分「本地模型 / 云端模型」两个 Tab；
  - 本地 Tab：runtime 行 + 三模型行，每行右侧「导入」；三模型各一个单选；
  - 「一键启动 runtime + 选中模型」：写 `packId/model/modelSpace` → 启动/复用 runtime → 注册选中模型 → 真实自检；
  - 云端 Tab：provider 表单 + 「一键启动 runtime + 云端」；配置改了会先停旧 runtime 再启动（endpoint/key 是启动时环境变量）；
  - 「向量记忆」栏只留启用开关、状态、整理/重建，不再放 provider/model/发现文件。
- **启动可信**：
  - `serviceStatus` 增加 `service.pid` 存活检查，进程死了返回 `vector.service-stale`，不再假在线；
  - `testEmbeddingPack` 改为真实 `/v1/embeddings` 自检，返回 model/dimension/latency/norm；
  - `startEmbeddingRuntime` 返回 `verified/verification`；一键启动 toast 显示自检结果，失败显示警告；
  - 顶部总览显示「最近自检」。
- **启动性能**：
  - 只注册当前选中的模型，不再每次注册全部模型；
  - 已在跑的 runtime 不重复拉进程；仍补注册当前模型。
- **重建完整**：
  - `rebuildVectorMemory` 循环调用维护器直到 `pending=0`（或停滞/出错/500 轮上限）；
  - UI 提示「重建完成 / 已重建一批」。
- **空文本防线**：
  - `loadVectorRecords` 用 `String(text).trim()` 过滤；
  - `mergeVectorRecords` 对 incoming 也过滤空白正文；
  - `embedTexts` 在发 HTTP 前抛 `vector.empty-text`，不再让服务端 400 吞掉整批。
- **回滚**：
  - 代码：`git revert` 本批提交；
  - 配置：`~/.dsh/surfcore/config.json` 的 `vectorMemory` 可手工改回；
  - 索引：删/改名 `vector-memory-index/<space>.*` 后重建；不要动 `vector-memory.jsonl`。

## 验证

- 自动化：
  - `npm run test:audit` → 151/151；
  - `npm run test:regressions` → 全部通过；
  - `plugins/surfcore` `npm test` → 通过；
  - `node scripts/test-vector-memory-plugin.mjs` → 新增 rebuild 循环断言通过；
  - `node scripts/test-embedding-packs-wiring.mjs`、`test-client-contract.mjs`、`test-ui-contrast.mjs` → 通过。
- 失败路径：
  - 服务进程死了但 discovery 在：`embeddingPacksStatus().service = {ok:false, code:'vector.service-stale', error:'discovery 还在，但 runtime 进程已退出', hint:'点「启动」...'}`；
  - 没有 runtime：`pack.runtime-missing` + hint；
  - 自检失败：`vector.self-test-failed` + hint；
  - 重建停滞：`vector.rebuild-stalled` + 剩余 pending。
- 手工/集成验证：
  - 真实 runtime：11435/18765 listening；
  - 真实自检：`bge-m3` 1024 维，2541ms，L2 norm≈1；
  - 真实索引：`bge-m3@1024-f16-v1` 从 1536 条补到 **3267 / 3267，pending 0**；
  - 全量重建第一次在 3072 条遇到空文本 400 中断（耗时 355s，pending 195）；修掉 incoming 空文本后，一次维护补完 195 条；
  - 真实检索：查询「主人今天有点累，想抱抱」返回 5 条，top score 0.633；
  - 真实召回块：QQ 查询「今天有点累，想让你陪我聊会儿」4 条，top 0.675；
    B站 查询「这个视频转绘的一致性怎么样，有没有 AI 味」4 条，top 0.587，输出均以 `【想起的旧事】` 开头；
  - 记录文件 raw 4107 行 / unique 3273；状态 active 3267（其余为同 id 覆盖/过滤）。
- 没验证到的部分：
  - 一次点击 3267 条全量重建的最终耗时/进度条（本轮分段验证）；
  - B站/QQ 真机注入后的最终提示词；
  - 云端真实 key；
  - 干净 Windows VM。

## 遗留 / 后续

- 需要补的测试：
  - 真实服务下的全量 rebuild 集成测试（可 mock embeddings 但保留循环）；
  - stale discovery + 真实 pid 的失败分支测试；
  - 云端一键启动的 stop/start 时序测试。
- 需要改的文档：
  - `docs/guides/EMBEDDING_PACKS.md`（已补 Tab/自检）；
  - `docs/guides/VECTOR_MEMORY.md`（已补重建循环）；
  - 发布前把本 case 加进交接块。
