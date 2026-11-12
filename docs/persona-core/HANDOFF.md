# SurfCore Persona Core — 交接文档

> 交接时间：2026-11-10 23:0x（Asia/Shanghai）
> 分支：`feat/persona-core-design`（工作树 `D:\deepseekwork\surfcore-persona-core`）
> 最近功能提交：旧配置迁移（只读预览/--apply）+ 四段纵切图 + 全包契约体检；联网/摘要/语音导入在前
> 随后文档提交：QQ 旧 42 工具对账（`QQ-TOOL-MAP.md`）
> 本轮改动：**已提交**（工作区干净）
> 门禁状态：**六条全绿**（提交时 pre-commit 再跑一次，退出码 0）

> **开工必读（顺序）**：
> 1. [`ARCHITECTURE-LAWS.md`](ARCHITECTURE-LAWS.md) —— 结构法则（边界/依赖/可测性/适应度）
> 2. [`DESIGN-PRINCIPLES.md`](DESIGN-PRINCIPLES.md) —— 产品与交互的宪法（含准则 000/007/012/013）
> 3. [`ARCHITECTURE-MAP.md`](ARCHITECTURE-MAP.md) —— 四段景观与功能落位
> 4. 本文件 —— 做到哪、下一步
>
> **做 UI 前另读**：[`UI-DESIGN-RULES.md`](UI-DESIGN-RULES.md)（后端地图→用户任务→页面→接口映射→状态→视觉；含可复制的浓缩提示词）。
> **前端交接**：[`FRONTEND-HANDOFF.md`](FRONTEND-HANDOFF.md)（UI 归前端、内核归后端；含记忆 API 契约 + 可复制交接消息）。
> **来源显示交接**：[`UI-PLATFORM-SOURCE-HANDOFF.md`](UI-PLATFORM-SOURCE-HANDOFF.md)（sourceId → QQ/B站/桌宠/网页，UI 唯一映射）。
> **语音 UI 同源接口**：[`VOICE-UI-API.md`](VOICE-UI-API.md)（前端只调 16460 `/surfcore-api/voice/*`；不填地址/token）。
> **语音真机探测**：[`VOICE-REAL-PROBE.md`](VOICE-REAL-PROBE.md)（本地 200/43KB/900ms；服务商 200/48KB/1004ms；内核 model 公共面均通过）。
> **旧 zip 真机导入**：[`VOICE-LEGACY-ZIP-PROBE.md`](VOICE-LEGACY-ZIP-PROBE.md)（local/cloud 两个真实 zip 均 ok）。
>
> **补记（2026-11-11）**：上一版交接只引用了景观图，漏了前两份；这是交接的漏项，不是它们不重要。

---

## 0. 一句话现状

四段刚性架构站住：**内核 61 文件 / 7,675 行**、**大适配器 8 文件 / 1,003 行（冻结，本轮 0 改动）**、
**小适配器 + 模块 28 文件 / 4,085 行**、**93 个测试文件全绿**。
能力清单 **27 模块 / 236 条（✅230 / 🟡3 / ⬜3）**；旧功能 **22 域（✅5 / 🟡16 / ⬜0 / ⛔1）**。

**下一步主线**：旧域 ⬜ 已清零（兼容迁移已做配置部分）；把 🟡16 个"部分移植"逐个收口；
本轮新加的纯模块（动态增量、桥接写工具、桌宠 API、嵌入）要接到运行入口/壳里才算"真机"。

---

## 1. 刚性架构（不可动）

```
内核 kernel/（灵魂：目的/记忆/时机/表达/语音/识图/黑话/表情/收尾/设置/支撑/账本）
   ↑ 三种消息（event / intent / receipt，结构固定）
大适配器 runtime/（冻结：管道/宿主/组装/发件箱/白名单/界面声明/媒体限额/包规则）
   ↑ 小适配器（每包一个 index.js：契约六件 + 收/发/诊/关 + 工具）
模块（QQ / B站 / 桌宠 / web：各自平台/世界的全部规矩）
开发设施 tools/（四层之外，不是一层：六条门禁 + CLI + 打包 + hook）
壳（UI，仓库外 D:\deepseekwork\surfcore-ui）
```

> **拍板（2026-11-11）**：web 保留为**第四个扩展**（`packs/web` 小适配器 + 模块），
> 不是第五层；默认不启用，用 `node tools/cli.mjs enable web` 打开。
> `tools/` 是四层之外的开发设施；四层不许 import 它。

完整景观图（大图、每个模块写明 QQ/B站/桌宠、每条老功能落在哪）：
[`ARCHITECTURE-MAP.md`](ARCHITECTURE-MAP.md)。逐文件/逐导出/契约矩阵：
[`GLOBAL-INVENTORY.md`](GLOBAL-INVENTORY.md)。

**依赖事实（`tools/fitness.mjs` 每次强制检查）**

| 关系 | 结果 |
| --- | --- |
| kernel → runtime / packs | 0 处 import |
| runtime → kernel / packs | 0 处 import |
| packs → kernel | 0 处 import |
| tools → kernel / runtime / packs | 允许（唯一可以"什么都知道"的地方） |
| kernel / runtime 中的平台名 | **0 处**（`core-check` 连测试字面量也查） |

---

## 2. 数字（2026-11-10 晚实测）

| 项 | 数字 |
| --- | --- |
| kernel | 61 文件 / 7,675 行 |
| runtime（冻结） | 8 文件 / 1,003 行 |
| packs | 28 文件 / 4,085 行（QQ 1,809 / B站 1,164 / 桌宠 437 / web 516） |
| 测试 | **93 个测试文件，全绿** |
| 门禁 | 适应度 ✅ · 体检 ✅（致命 0，提醒 1）· 本体检查 ✅ · 能力清单 ✅ 无漂移 · 旧功能基线 ✅ · 单测 ✅ |
| 能力 | 27 模块 / 236 条（done 230 / partial 3 / missing 3） |
| 旧功能 | 22 域（done 3 / partial 16 / missing 2 / forbidden 1） |

复跑一条命令：

```powershell
cd D:\deepseekwork\surfcore-persona-core
npm run test:arch          # 期望最后一行：失败 0 个，退出码 0
```

---

## 3. 本轮新增/改动（按位置，逐条）

### 内核

| 文件 | 行数 | 是什么 | 层级 |
| --- | --- | --- | --- |
| `kernel/support/ledger.js` | 225 | Token 账本：五桶归一 / 幂等（同会话·回合·步骤·重试）/ 按模型汇总 / 外部用量 / 落盘快照 | 内核·支撑 |
| `kernel/support/ledger.test.mjs` | — | 44 条断言（含"重放不能把钱改小"） | 测试 |
| `kernel/support/ledger-report.js` | 90 | 账本报表：按模型/峰谷/没算价/估算；只读 | 内核·支撑 |
| `kernel/support/ledger-report.test.mjs` | — | 24 条断言 | 测试 |
| `kernel/expression/prices.js` | 182 | 价目表：峰谷/节假日/未知模型兜底/覆盖合并；给账本的 `ledgerPrice()` | 内核·表达层数据 |
| `kernel/expression/prices.test.mjs` | — | 36 条断言（北京时间、峰谷、金额） | 测试 |
| `kernel/memory/vector/embed.js` | 198 | 嵌入端口：HTTP `/embeddings` 传输 + 校验/归一/维度锁 + 本地散列假实现 + 余弦 | 内核·记忆·向量 |
| `kernel/memory/vector/embed.test.mjs` | — | 38 条断言（含"没给向量仍走关键词"） | 测试 |
| `kernel/memory/index.js` | 376 | 双存储 + 记忆方式切换 + 向量开关 + 多模型索引 + 待编码/重建/状态/检索 | 内核·记忆 |
| `kernel/memory/identity.js` | 106 | 记忆记录 + 可见性政策 + 场合标签（只有主人私聊是 private） | 内核·记忆 |
| `kernel/memory/scene.test.mjs` | — | 11 条断言（主人私聊/非主人/群聊/适配器乱标/refs） | 测试 |
| `kernel/memory/vector/store.js` | 251 | 多模型索引（每个 modelSpace 一套）+ pending/ready/failed + 重建 + 记忆库搜索 | 内核·记忆 |
| `kernel/memory/vector-index.test.mjs` | — | 26 条断言（双写/多索引/编码失败/重建/落盘） | 测试 |
| `kernel/settings/limits.js` | 99 | 新增记忆方式/向量开关/modelSpace/批量/注入上限 5 项设置 | 内核·设置 |
| `kernel/expression/vision.js` | 67 | 识图：图片 → 模型内容段（2 张/5MB；读不到/太大/格式不认跳过并审计） | 内核·表达 |
| `kernel/expression/vision.test.mjs` | — | 25 条断言 | 测试 |
| `kernel/memory/media.js` | 124 | 加 `readBytes(id,{maxBytes})`：按编号读原件（识图/转写用） | 内核·记忆 |
| `kernel/expression/model-http.js` | 117 | 改：把供应商 `usage` 归一后随返回值交上去；没报就不编 | 内核·表达 |
| `kernel/expression/index.js` | — | 改：`onUsage` 回调（带 turn/step）；记账失败进 `errors`（可见，不拖垮对话） | 内核·表达 |
| `kernel/index.js` | — | 改：建账本、注入价目表、respond 传 turn、save/load 带 ledger、snapshot 暴露 ledger；**嵌入器注入：respond 前算一次向量，入库/检索共用** | 内核·总装 |
| `kernel/runtime.js` | 118 | 新增：内核运行时生命周期（start/tick/向量积压/保存/stop；system 注入） | 内核·运行时 |
| `kernel/runtime.test.mjs` | — | 18 条断言（生命周期/定时保存/停止顺序/失败仍保存/编码不叠加） | 测试 |
| `kernel/purpose/index.js` | 191 | 改：不同需求不同驱动速率/说出去了降/没回应加码/话题 6 小时内不重复 | 内核·目的 |
| `kernel/purpose/purpose.test.mjs` | — | 21 条断言（驱动/多样性/闭环） | 测试 |
| `kernel/conversation/index.js` | 187 | 改：窗口溢出进 pending（不丢）；摘要/pending 落盘；渲染“摘要 + pending + 最近” | 内核·对话 |
| `kernel/conversation/summary.js` | 79 | 新增：摘要提示词/清理/合并（纯函数） | 内核·对话 |
| `kernel/conversation/summary.test.mjs` | — | 28 条断言 | 测试 |
| `kernel/voice/import.js` | 60 | 新增：音频文件 → 语音库条目（扩展名/去重/上限/情绪标签） | 内核·语音 |
| `kernel/voice/import.test.mjs` | — | 22 条断言 | 测试 |
| `kernel/expression/expression.test.mjs` / `model-http.test.mjs` / `kernel.test.mjs` / `persistence.test.mjs` | — | 加"用量进账本 / 记账失败可见 / 重启后账本仍在" | 测试 |

### B站（模块策略，不动接口结构）

| 文件 | 行数 | 是什么 |
| --- | --- | --- |
| `packs/bilibili/slots.js` | 131 | 分享槽位：时间点归一 / 下一个点 / 去重 / 10 分钟补跑 / 30 天清理 |
| `packs/bilibili/slots.test.mjs` | — | 25 条断言 |
| `packs/bilibili/dynamics.js` | 106 | 动态解析 / 排版 / 增量计划（首次只建基线；只推新的；已见上限 300） |
| `packs/bilibili/dynamics.test.mjs` | — | 29 条断言 |
| `packs/bilibili/api.js` | 100 | 加：`spaceDynamics` / `dynamicDetail` / `replies` / `userCard`（只读公开数据） |
| `packs/bilibili/api.test.mjs` | — | 加动态/评论/名片 4 组断言 |
| `packs/bilibili/share.js` | 180 | 加：从记忆记录还原分享卡 / 6 天冷却挑选 / 分享提示词 |
| `packs/bilibili/job.js` | 148 | 分享任务：到点→选卡→提示词→模型→逐群发送；成功才推进状态 |
| `packs/bilibili/job.test.mjs` | — | 35 条断言（含"没新鲜素材不发旧的""模型失败一条都不发"） |
| `packs/bilibili/index.js` | — | `plan()` 可加 `shareTimes/slotState` 闸门；不传行为不变 |
| `packs/bilibili/bilibili.test.mjs` | — | 加"分享槽位接进 plan()" 6 条断言 |

### QQ（QQ 小适配器 + QQ 模块）

| 文件 | 行数 | 是什么 |
| --- | --- | --- |
| `packs/qq/bridge-tools.js` | 473 | 18 个桥接语义工具（读 16 / 写 2）+ HTTP 传输 + 结构化失败 + key 自动补；**新增按消息/表情 id 取图（base64→字节）** |
| `packs/qq/bridge-tools.test.mjs` | — | 54 条断言（写默认关 / 令牌不进 URL / 图片字节/dropped） |
| `packs/qq/tools.js` | 104 | 加 `get_group_msg_history`（OneBot，可选 messageSeq） |
| `packs/qq/tools.test.mjs` | — | 加群历史 2 条断言 |
| `packs/qq/index.js` | — | 加 3 个设置（bridgeUrl/bridgeToken/bridgeConsoleToken）；`runTool` 先 OneBot 再桥接；`toolDeclarations` 配了令牌才给模型；重连补群历史 |
| `packs/qq/history.js` | 103 | 新增：水位/去重/OneBot 历史转事件/补历史器（只补群） |
| `packs/qq/history.test.mjs` | — | 11 条断言（水位/去重/转换/假 client 两次补） |
| `packs/qq/text.js` | 88 | 加 `markdownToPlain`（标题/加粗/斜体/代码/链接/引用→纯文本） |
| `packs/qq/text.test.mjs` | — | 18 条断言（CQ/拆条/Markdown） |
| `packs/qq/receiver.js` | — | 加 `onOpen` 回调（重连后触发补历史；不改事件结构） |
| `kernel/index.js` | — | `silent=true` 只入记忆，不唤醒、不推进收尾/轮次 |
| `kernel/silent-wake.test.mjs` | — | 4 条断言（静默不醒/入库/普通消息仍醒） |
| `packs/qq/qq.test.mjs` | — | 加"桥接工具：令牌→声明→key 自动补→写拒绝" 8 条断言 |

### 桌宠

| 文件 | 行数 | 是什么 |
| --- | --- | --- |
| `packs/desktop-pet/api.js` | 145 | 本地 API 形状：11 条路由 + 回环/同源/JSON/令牌闸门 + host.json 形状 + 音频地址 |
| `packs/desktop-pet/api.test.mjs` | — | 42 条断言 |

### web

| 文件 | 行数 | 是什么 |
| --- | --- | --- |
| `packs/web/pack.json` | — | 清单：surfcore/web 0.1.0，trust network.out |
| `packs/web/index.js` | 141 | **web 小适配器**（四块 + open/send/health/close + toolDeclarations/runTool） |
| `packs/web/fetch.js` | 233 | 安全抓取（禁内网/环回/私有 IP、DNS 全量检查、固定地址防 rebinding、手动重定向、限量/超时） |
| `packs/web/tools.js` | 142 | web_fetch / web_search 工具面；搜索端点由设置或环境给 |
| `packs/web/{fetch,web,pack}.test.mjs` | — | 77 条断言（纯函数/假 DNS/假搜索/契约） |

### 开发设施（四层之外，不是层）

| 文件 | 改动 |
| --- | --- |
| `tools/cli.mjs` | 加 `ledger`（账本报表，只读）；`voice list/import`（语音库）；`bili due [--mark]`（槽位）；`bili run [--dry-run]`（分享任务）；`bili sync [--dry-run]`（动态同步）；`migrate --from`（旧配置预览/应用）；嵌入/语音引擎由 `SURFCORE_EMBED_*` / `SURFCORE_TTS_*` 环境变量装配；各带 `--json` |
| `tools/migrate-memory.mjs` | 新增：旧记忆 → 新内核，默认 dry-run；`--apply --state` 才写新状态；拒绝覆盖已有 kernel-state |
| `tools/migrate-memory.test.mjs` | 9 条断言（dry-run 不写/apply 落盘/private 保留/拒绝覆盖） |
| `tools/shadow-tap.mjs` | 新增：只读旧 inbox，增量灌新内核影子状态；`--watch` 常驻；不发消息 |
| `tools/shadow-tap.test.mjs` | 7 条断言（增量/不重复/坏行/private） |
| `tools/shadow-diff.mjs` | 新增：旧记忆 vs 影子全量卡的文本覆盖对比（只读） |
| `tools/shadow-diff.test.mjs` | 5 条断言（计数/缺失/多出/覆盖率） |
| `tools/voice-control-server.mjs` | 新增：本机语音模型控制面（status/models/providers/probe；token+CORS） |
| `tools/voice-control-server.test.mjs` | 13 条断言（鉴权/CORS/provider/模型/select） |
| `tools/voice-api-router.mjs` | 新增：宿主/控制面共用的 voice HTTP 路由（无鉴权/CORS） |
| `kernel/voice/artifact.js` | 新增：模型工件 manifest 归一 + 路径安全 + 哈希比对（纯函数） |
| `kernel/voice/artifact.test.mjs` | 16 条断言（kind/model/version/voice/weights/路径/哈希/runtime/旧 manifest） |
| `kernel/voice/tts-voxd.js` | 新增：voxd `/v1/speak/file` 传输（本地/云端通用） |
| `kernel/voice/tts-voxd.test.mjs` | 10 条断言（WAV 时长/协议/失败） |
| `kernel/voice/providers.js` | 新增：provider 公开档案 + active/kind 选择（纯函数） |
| `kernel/voice/providers.test.mjs` | 11 条断言（URL/kind/Key 掩码/选择） |
| `kernel/voice/provider-config.js` | 新增：provider 配置持久化（0600；更新不清 Key） |
| `kernel/voice/provider-config.test.mjs` | 8 条断言（掩码/更新/删除） |
| `kernel/voice/model-runtime.js` | 新增：模型装载/卸载/状态（中性 runtime；不认扩展脚本） |
| `kernel/voice/model-runtime.test.mjs` | 12 条断言（状态/选择/装载/卸载/无 runtime） |
| `kernel/voice/model-runtime.integration.test.mjs` | 6 条断言（zip→删除源→load→probe→unload） |
| `kernel/voice/models.js` | 新增：model 公共面（modelId/kind/voiceId/state；不暴露 dir/port/start/stop） |
| `kernel/voice/models.test.mjs` | 12 条断言（公共字段/状态/provider/deleteSource） |
| `kernel/voice/wav.js` | 新增：WAV 头时长解析（坏文件 0） |
| `tools/cli.mjs` | 加 `voice probe` + `SURFCORE_TTS_PROTOCOL=http|voxd` |
| `kernel/voice/model-store.js` | 新增：模型工件 inspect/import（校验后复制；默认拒绝覆盖） |
| `kernel/voice/model-store.test.mjs` | 11 条断言（合法/哈希/复制/拒绝覆盖/旧 manifest/runtime 推导） |
| `tools/migrate.mjs` | 旧 config.json → 新设置：白名单/QQ 连接/搜索端点；默认只预览，`--apply` 只写新状态，旧文件不动 |
| `tools/migrate.test.mjs` | 18 条断言（映射/不泄密/警告/只写新设置） |
| `packs/contract.test.mjs` | 新增：全包契约体检（清单/身份一致、六件齐全、settings/工具名不重复） |

### 文档

| 文件 | 改动 |
| --- | --- |
| `docs/persona-core/QQ-TOOL-MAP.md` | 新增：旧 42 个渠道工具逐个对账（5 OneBot + 16 桥接 + 12 由 intent 取代 + 9 个明确缺口） |
| `docs/persona-core/ARCHITECTURE-MAP.md` | 重写：四段纵切大图 + 每层文件 + 每个包写明 QQ/B站/桌宠/web + 老功能落位 |
| `docs/persona-core/GLOBAL-INVENTORY.md` | 新增：逐文件/逐导出/契约矩阵/能力清单（全局审计） |
| `docs/persona-core/UI-DESIGN-RULES.md` | 新增：UI 设计准则 + 每次设计前可复制的浓缩提示词 |
| `docs/persona-core/FRONTEND-HANDOFF.md` | 新增：前端交接（UI/内核分治、记忆 API 契约、可复制交接消息） |
| `docs/persona-core/UI-PLATFORM-SOURCE-HANDOFF.md` | 新增：来源 sourceId → UI 显示名（QQ/B站/桌宠/网页）交接 |
| `docs/persona-core/capability-map.json` | 238 条（+内核运行时/记忆场合标签/记忆方式/多模型索引/待编码；+全包契约/迁移/语音跨适配器）；`CAPABILITY-MAP.md` 由工具重生成 |
| `docs/persona-core/legacy-capability-map.json` | sticker/closure → done；budget/bili/qq/vector 备注更新；`LEGACY-CAPABILITY-MAP.md` 由工具重生成 |
| `docs/persona-core/HANDOFF.md` | 本文件 |

**大适配器 `runtime/` 本轮 0 改动。**

---

## 4. 接口内容变更报备（本轮）

按用户规矩：**结构没动**；动的是"信封里必须写什么"，逐条说明：

| # | 改的是谁 | 人话解释 | 影响 |
| --- | --- | --- | --- |
| 1 | **QQ 小适配器**（`packs/qq/index.js`） | 新增 3 个设置项（桥接地址/令牌/控制台令牌）；`runTool` 在"OneBot 不认识这个工具"时会去问桥接；`toolDeclarations` 在配了桥接令牌时多给 14 个只读工具；会话 key 由包从频道自动补，模型不用填 | 只影响 QQ 包自己；没配令牌时行为和以前完全一样 |
| 2 | **QQ 模块**（`bridge-tools.js`） | 工具的失败形状改成 `{ok:false,error:{code,message,hint}}`（旧 MCP 只有一行中文）；写工具默认拒绝 | 只影响调这些工具的人（模型/命令行） |
| 3 | **B站 模块**（`packs/bilibili/index.js` 的 `plan()`） | 多接受两个可选参数 `shareTimes/slotState`；不传时和以前一样 | 只影响 B站 包的排程调用方 |
| 4 | **内核表达层**（`model port`） | HTTP 模型端口多返回一个 `usage` 字段；`onUsage` 回调把用量交给账本；记账失败会出现在 `errors` 里 | 只影响内核内部组装；不碰 event/intent/receipt |
| 5 | **内核记忆**（向量线） | `put` 可选第二参 `{vector}`；`read` 可选 `query.vector`；没给仍走关键词 | 老路径不破；不新增事件字段 |
| 6 | **内核表达层**（模型消息） | user 消息从"一段文本"可以变成"文本 + 图片段"（OpenAI 兼容的 image_url/data URL）；没图片时仍是纯字符串 | 只影响模型端口与离线桩；**不碰** event/intent/receipt，也**不碰**大适配器/包契约 |
| 7 | **内核总装**（`createKernel` / `handle`） | 可选注入 `embedder`；`respond` 前算一次向量，`handle` 第三参收 `{vector}`；没配就完全走旧路径 | 只影响内核内部组装；**不碰** event/intent/receipt |
| 8 | **内核表达层**（工具往返） | 工具结果可以带图片字节；tool 消息只留文字，图片另起一条 user 消息给模型。没图时完全不变 | 只影响工具往返；**不碰** event/intent/receipt，也不碰包契约 |
| 9 | **内核对话/总装**（摘要） | 窗口挤出去的旧轮次先留在 pending；攒够一批**多调一次模型**做摘要；`conversationArchive` 多存摘要/pending。失败保留原文。 | 只影响内核内部状态与一次额外模型调用；摘要用量进账本；**不碰** event/intent/receipt |
| 10 | **web 小适配器**（`packs/web/index.js` + 模块） | 新增一个完整的 web 包：四块契约 + open/send/health/close + toolDeclarations/runTool；模块里是安全抓取与搜索。模型因此多看到 `web_fetch`/`web_search` 两个工具。 | 这是**动了一个小适配器的接口内容**（新增包），**不是大适配器**；不碰 event/intent/receipt；不新增层。 |
| 11 | **B站 / 桌宠小适配器** | 补上 `ui` 声明（菜单 + 设置页），让六件契约真正齐全；设置项数量不变，行为不变。 | 这是**动了两个小适配器的接口内容**（B站、桌宠），不是大适配器；不碰 event/intent/receipt。 |
| 12 | **内核记忆**（`kernel/memory/*` + `kernel/settings/limits.js`） | 两套存储仍同时写；新增「记忆方式」切换、向量开关、每个模型一套索引、待编码/编码/失败重试/重建/状态/记忆库检索。 | 这是**内核的接口内容**（新增设置项与内核方法）；**不是小适配器、不是大适配器**；不碰 event/intent/receipt。 |

**没有动**：event / intent / receipt 的形状、大适配器、包的六件名称。

### 4.1 对照宪法（2026-11-11 复读 `ARCHITECTURE-LAWS` + `DESIGN-PRINCIPLES`）

| 准则 | 本轮落地 |
| --- | --- |
| 000 旧代码是需求，不是骨架 | 联网工具只搬"禁内网/限量/重定向/DNS 检查"这些**要求**，没有搬旧 MCP 宿主结构 |
| 001/002 选项给默认值；底线不给开关 | 搜索端点/密钥由部署给；不提供"关掉 SSRF 检查"的开关 |
| 003 适配器声明、界面归内核、配置属于用户 | 包只交 settings 声明；UI 仍在壳 |
| 007 内核不联网、不认识渠道名、记忆单写者 | 联网能力在 `packs/web`（小适配器 + 模块）；`web_fetch` 不 import 内核；记忆仍只有 kernel.memory 写 |
| 008 承重上限必须有，裁剪必须可见 | 识图 2 张/5MB 是承重上限；跳过留 `vision.skipped` 审计；摘要失败留 `summary.failed` |
| 009 信封/未知事件忽略 | 没改 event 结构；本轮的图片/摘要都在模型消息与内核状态里 |
| 010 适配器不可信、默认拒绝 | web 包默认不启用；QQ 写工具默认关；桥接令牌由包注入；联网工具只读 |
| 012 能力清单治理 | `capability-map.json` 增 `pack.web`；每个能力带证据/等级 |
| 013 形状固定、条目开放 | 工具声明形状固定；新增 `web_fetch/web_search` 不改契约 |

**登记表口径（2026-11-11 修正）**：`tools/` 是**四层之外的开发设施**，不是第五层。
`capability-map.json` 里 `tools.gate.layer` 从 `tools` 改成 `dev`；`fitness` 增加
“内核/大适配器/小适配器都不许 import `tools/`”。它像 `.github/`：可以读四层，四层不许读它。

---

## 5. 还没接的（下一步，按优先级）

| # | 功能 | 现在到哪 | 下一步放哪 | 为什么放那 |
| --- | --- | --- | --- | --- |
| 1 | B站 分享任务 | `bili run` 已能到点选卡→模型→发群；触发由外部计划任务 | 把 `bili due`/`bili run` 写进计划任务 | 定时器/投递是"怎么运"，不是平台规矩 |
| 2 | 媒体→模型端口（识图） | **当前消息图片 + 工具取回图片都已进模型**（2 张/5MB；坏图 dropped） | 视频关键帧/音频转写仍可继续扩 | 识图是"她怎么看"，端口在内核；取图是 QQ 模块 |
| 3 | B站 动态增量 | **已接**：`bili sync` 拉一次、首次建基线、只推新的、入库；定时交给外部 | 把 `bili sync` 写进计划任务 | 定时是"怎么运"，不是平台规矩 |
| 4 | QQ 剩余工具 | 已对账：42 个里 35 个有落点（5 OneBot + 18 桥接 + 12 intent），**7 个明确缺口** | 按理由不做；表情备注可低优先补 | 工具属于通道；发送走 intent |
| 5 | 向量真嵌入 | **已接**：`respond` 前算一次向量，入库与检索共用；没配 `SURFCORE_EMBED_*` 就退回关键词；嵌入失败不挡说话且审计 | 嵌入包安装/选择（旧 embedding-packs 的目录管理）未做 | 嵌入是记忆的港口实现；装包是工具/壳 |
| 6 | 计费报表 | 命令行已完成（总量/按模型/峰谷/没算价）；没有控制台可视化 | 壳读 `kernel.snapshot().ledger` 或 `ledger-report.js` | 报表是界面，不是内核 |
| 7 | 语音真引擎 / 模型导入 | 音频库导入/列表、模型工件 manifest/导入、model 公共面、voxd 传输、WAV 时长、`voice probe`、provider 档案/配置、本机 HTTP 控制面、**本地+服务商真机**已做；浏览器上传/安装进度未做 | `kernel/voice` 的 model/provider/transport；地址/Key 进 provider 配置 | 模型和运行时归内核语音；控制面是壳 |
| 8 | 桌宠 HTTP 服务器 | 形状 + 闸门已好；服务器在壳 | 壳（`surfcore-ui` 或 DSH 插件）调 `matchPetRoute`/`petApiGate` | HTTP 服务是壳，不是四段 |
| 9 | 联网工具（旧 `web-search.js`/`safe-fetch.js`） | **已接**：`packs/web` 小适配器 + 模块；`web_fetch` 安全抓取 + `web_search` 可配端点；默认不启用 | 设置页填搜索端点/密钥；或用环境兜底 | 内核不联网；这是 web 小适配器，不是工具层 |
| 10 | 兼容与迁移 | 🟡 部分：旧 config.json → 新设置已做（默认只预览，`--apply` 只写新状态，旧文件不动）；旧接口门面不再需要，旧状态迁移未做 | `tools/migrate.mjs` + `tools/cli.mjs migrate` | 一次性工具，属四层之外 |

### 5.1 架构岔路：B站"到点之后谁投递"

旧 `bili-share-scheduler.js` 做的是：到点 → 给每个群投递一段**提示词** → 角色回复 → 发到 QQ。
新架构里"到点"没有入口：三种消息只有 event/intent/receipt，**没有一个"定时触发"的输入路径**。
直接伪造一条 event 会污染语义（她会被当成"有人说话"），所以先拍板、再落地：

| 方案 | 做法 | 改不改结构 | 取舍 |
| --- | --- | --- | --- |
| **A 外部计划任务（已落地）** | `tools/cli.mjs bili run`：读 state → 选卡 → 组装分享提示词 → 调模型 → 用 QQ 包的 `send` 发；`bili sync` 拉动态入库。由 Windows 计划任务/外部定时器调用 | **不改** | 旧行为最接近；四段不动；“定时”在四段之外（外部计划任务） |
| B 内核新增 trigger 概念 | 内核加一个 `trigger()` 输入（不是 event 字段） | **改接口结构** | 最干净，但违反当前"结构不动"的约束，需要用户明确批准 |
| C 并入 purpose | B站只提供素材，由内核 purpose 决定何时主动说 | 不改 | 时机不再固定 8 个点；分享会变成"她主动搭话"的一部分 |

**当前选择：A（已实现）。** 计划任务示例（Windows）：

```powershell
# 每 10 分钟看一次该不该分享；到点才跑
node tools/cli.mjs bili due --times 07:00,11:00,13:00,15:00,17:00,19:00,21:00,23:00
node tools/cli.mjs bili run --times 07:00,11:00,13:00,15:00,17:00,19:00,21:00,23:00
# 每 3 分钟拉一次动态（首次只建基线）
node tools/cli.mjs bili sync
```

`bili run` 成功发出至少一个群才写 `lastSlots` / `shareHistory`；全失败不写，下一轮还能补。
`bili run` 不自己开定时器：这是故意的——四段里没有"定时输入"，定时属于工具/计划任务。

---

## 5.5 记忆复现（2026-11-11）

已做：

- **双写**：叙事（衰减卡+全量卡）与向量库各写一份；`memory.mode` 只决定读哪条。
- **设置**：`memory.mode` / `memory.vector.enabled` / `modelSpace` / `batchSize` / `maxChars` 五项，`settings.set` 立刻生效。
- **多模型索引**：`entry.vectors[modelSpace]`，每个模型一套；换模型不污染旧索引。
- **待编码**：`pending → ready/failed`；`encodePending` 失败保留可重试；`rebuildVectors` 只重建当前模型。
- **状态/检索**：`vectorStatus`（records/indexed/pending/failed/每个 space）、`searchVector`。
- **CLI**：`memory status|mode|maintain|rebuild|search`。
- **落盘**：多模型索引随 `kernel-state` 一起保存/恢复。
- **旧记忆迁移（dry-run）**：`tools/migrate-memory.mjs` 读旧 `memory-card.json` + `memory-card-full.jsonl`；实测 4253 条 → 灌入 3843、重复 410、失败 0；默认不写新状态。
- **迁移落盘（独立影子状态）**：已写入 `state/persona-core-shadow`：衰减卡 600、全量/向量 3891；未动线上旧状态。
- **shadow tap（离线回放）**：`tools/shadow-tap.mjs` 只读旧 `memory-inbox.jsonl`，增量灌影子内核；实测 49 行 → 48 条、重复 1、private 12；不发消息。`read(private:owner)` 得到 16 条 refs，全部 `scene=private`。
- **shadow diff**：旧 4253 行 / 2686 unique text → 影子 3891 行 / 2685 unique；覆盖率 99.96%，仅 1 条因内核“同人同文本去标点”判重被抑制（`@板栗 token回` vs `@板栗 token回！`），无多出。
- **记忆空间**：旧运行时 API 增加只读 PCA3 投影 `GET /vector/space`（800 点默认，敏感过滤，不返回原始向量）。

未做（按你拍板）：

- 本地 runtime 的安装/一键启停（最终从初始页一键启动；架构未定，先不做）。
- 云端 provider 预设/Key UI；目前用 `SURFCORE_EMBED_ENDPOINT/MODEL/KEY/SPACE` 注入。
- 记忆设置页的向量面板（UI 仍只显示能力 + 设置项，操作走 CLI）。

---

## 6. 改动该放哪一层（判断口诀）

| 你想改的东西 | 层 | 例子 |
| --- | --- | --- |
| 三种消息的字段、语义 | **接口结构**（不许动） | `event/intent/receipt` |
| 契约内容（身份/能力/设置/界面的含义、错误码、阈值含义） | **接口内容**（动要报备，并说清是"大适配器"还是"某个包的小适配器"） | 给 `to` 加 `memberCount`、桥接 key 自动补 |
| 某个平台自己的规矩 | **模块策略**（在 `packs/<平台>/` 里） | B站槽位、QQ 拆条、桌宠专注闸 |
| 数值/开关 | **可调参数**（`settings` 声明 + 选项/代价） | 分享时间点、每日评论额度、跳过概率 |
| 落的盘、缓存的形状 | **数据** | `state/persona-core/*.json` |
| 价目表 | **数据** | `kernel/expression/prices.js` |

---

## 7. 怎么加一个新能力（照抄流程）

1. 先想清楚**它属于谁**：平台的规矩 → `packs/<平台>/`；人的灵魂 → `kernel/<块>/`；搬运 → 不能加（runtime 冻结）。
2. 写纯函数模块 + 同名 `*.test.mjs`（不联网、不摸盘、时间/随机由参数注入）。
3. 在 `packs/<平台>/index.js` 或 `kernel/<块>/index.js` 里导出/接线。
4. 在 `docs/persona-core/capability-map.json` 加一条能力（`name/status/evidence/level`），
   `status=done` 必须有证据，且 **`level=function` 的不能标 done**（必须是 wired/persisted/device）。
5. 在 `docs/persona-core/legacy-capability-map.json` 把对应旧域从 `partial` 往 `done` 推。
6. 跑 `npm run test:arch`；pre-commit hook 会在提交时再跑一次。
7. 更新 `ARCHITECTURE-MAP.md` 的图（新增节点/位置），并在 `docs/cases/` 留一条记录。

---

## 8. 验证（每次改完必跑）

```powershell
cd D:\deepseekwork\surfcore-persona-core
npm run test:arch                     # 六条门禁，最后一行必须是"失败 0 个"
node tools/capability-map.mjs         # 能力清单无漂移
node tools/legacy-map.mjs             # 旧功能基线自洽
```

**为什么必须两条都看**：单测绿只说明代码对；`capability-map` 绿才说明"登记表 = 代码"；
`legacy-map` 绿才说明"旧功能状态"没吹牛。

---

## 9. 坑（本轮新增的，写在最前面）

| 坑 | 现象 | 正确做法 |
| --- | --- | --- |
| 账本幂等：不给 seq | 同一 key 再记一次会当成新采样，总量翻倍/钱变大 | 没 seq 且 key 已存在 → 直接返回原记录；只有**严格更新**的 seq 才覆盖 |
| 桥接 `200 + ok:false` | 旧 MCP 丢了 code/hint，调用方没法分支 | 新传输必须保住 `payload.code` 与 `payload.hint`（已用测试钉住） |
| 桥接工具"只读"有副作用 | `get_prompt` 可能刷新表情缓存；`list_stickers` 的 `refresh:true` 会落盘 | `refresh` 当写操作，默认关；别把"只读"当"零副作用" |
| 写工具交给模型 | 模型可能自己 mark_read/等消息，改水位 | `bridgeToolDeclarations({includeWrite:false})` 是默认；写要显式打开 |
| 重复导出名 | `tools/audit.mjs` 会红（同名真定义出现两次） | 新函数起名前 grep 全仓；跨包同名要么改名，要么确认不在 PACK_CONTRACT |
| 内核测试里写渠道字面量 | `core-check` 连测试也查 | 用中性词（`one`/`alpha`/`carrier`） |
| 能力标 done 但 level=function | `capability-map` 会红 | 要么接线到 wired，要么降 partial |
| PowerShell 读 UTF-8 中文 | `Get-Content` 乱码、`ConvertFrom-Json` 报错 | 用 `read` 工具或 `node -e` 读文件 |
| 多行 `git commit -m` | "did not match any file(s)" | 写消息文件，`git commit -F msg.txt` |
| `git add -A` | 会把别人的脏文件带进来 | 只 add 明确路径 |

旧坑（PowerShell 编码、`git add -A`、内核平台名、`media kind` 白名单、合并转发"发"、门禁绕过）见上一版交接与
[`docs/PITFALLS.md`](../PITFALLS.md)。

---

## 10. UI 壳（仓库外，单独交接）

`D:\deepseekwork\surfcore-ui\`：DSH 客户端插件，画内核环 / 星环 / 三栏菜单。
**不进四段、不进仓库、不参与门禁**；它的交接见 `D:\deepseekwork\surfcore-ui\HANDOFF.md`。
它只读 `pack.json` / `capability-map.json` / `limits.js` / 状态文件，不改任何契约。
本轮新增的 `kernel.snapshot().ledger` 和 `packs/desktop-pet/api.js` 的形状，壳可以直接读。

---

## 11. 下一步（按顺序）

1. **模型工件时长探测 + 真引擎地址配置**：manifest/导入/运行时已做；ffprobe 时长、真引擎地址/凭据属于配置细节。
2. **嵌入包安装/选择**：旧 `embedding-packs` 的目录管理放工具/壳；内核只保留 embedder 端口。
3. **旧状态迁移收口**：旧记忆/账本/黑话/表情状态迁到新 state（旧配置迁移已做；状态迁移未做）。
4. **B站自动触发**：把 `bili sync`/`bili run` 写进计划任务；不建议为此改内核结构。
5. **桌面端/控制台**：账本报表、包状态、提醒的 UI 由壳读取，不改四段。
6. **QQ 表情备注**：`qq_sticker_note` 的低优先补法（内核表情库加 `annotate`，不碰 QQ 账号）。

每步完成后更新两张地图（`ARCHITECTURE-MAP.md` / `capability-map.json` / `legacy-capability-map.json`）并跑门禁。
