# 功能缺口：对照旧 SurfCore 逐文件（2026-11-10）

> 目的：回答"要复现完整功能，新架构还缺什么、每件放哪层"。
> **硬约束：不动任何架构约定**（三层边界、三种消息、意图/回执种类、双存储、单写者、媒体编号不进包、网关不随包）。
> 每条落位都给"用哪个现有槽位"，凡需要新模块的，也会说明它为什么不新增约定。

## 0. 规模对照（实测）

| 仓库 | 文件 | 行数 |
| --- | --- | --- |
| 旧 `src/` | 77 | 41,125 |
| 旧 `plugins/surfcore/lib/` | 35 | 25,941 |
| **旧合计** | **112** | **67,066** |
| 新本体（kernel+runtime+shared） | 35 | 4,149 |
| 新扩展（packs） | 8 | 971 |

新代码是旧代码的 **7.7%**，但覆盖的是"骨架 + 关键判断"，不是逐行翻译。

---

## 1. 已复现（有测试，可运行）

| 旧文件 | 行 | 新位置 | 说明 |
| --- | --- | --- | --- |
| `memory-card.js` | 2,296 | `kernel/memory/narrative/{decay-card,full-card,reader}.js` | 双卡模型、五档清晰度、每天最多降一档、复习升档、主人保底、全量卡只追加 |
| `vector-memory.js` | 629 | `kernel/memory/vector/store.js` | 独立存储（关键词向量），与叙事同级、只读一条 |
| `purpose-engine.js` | 2,302 | `kernel/purpose/{index,materials}.js` | 驱动向量、目标假设、观察账本、闭环反馈、投递即占次数、安静时段 |
| `wake-filter.js` + `fish-guard.js` + `group-policy.js` | 485 | `kernel/attention/index.js` | 唤醒分级、合批、群分层、鱼群密度、刷屏短指令 |
| `persona-layers.js` + `character-persona.js`(部分) | ~850 | `kernel/support` + `kernel/expression/prompt.js` | 人格分层、公开版字数限制 |
| `admin-identity.js` + `self-identity.js` | 435 | `kernel/support`（identity） | 主人判定、称呼归属 |
| `token-ledger.js` + `token-budget.js`(部分) | 1,657 | `kernel/support`（budget） | 按已发生成本记账、超限拒绝 |
| `owner-audit.js`(部分) | 145 | `kernel/support`（audit） | 只追加审计 |
| `voice-diagnostics.js` + `voice-core.js`(部分) | 537 | `kernel/voice/index.js` | 失败分类+下一步、本地/云端路由、库条目校验、三闸门 |
| `safe-text.js` | 74 | `packs/qq/text.js` | CQ 转义、不劈代理对的拆条 |
| `snowluma-conn.js` | 234 | `packs/qq/receiver.js` | **替换实现**：自研 WS（令牌走 query、心跳看门狗、指数退避、畸形帧守卫） |
| `scheduler.js`(部分：生物钟/额度) | ~400 | `packs/bilibili/logic.js` | 四本额度账、窗口内醒+随机跳过、选片去重 |
| `pet*.js`(部分：气泡/专注/语音决策) | ~300 | `packs/desktop-pet/index.js` | 气泡 TTL、专注硬停、载体互斥、语音三条件 |

---

## 2. 缺口（按**五期工程**排序，口径统一）

> 全项目只用这套编号：**一期 ~ 五期**。旧文档里的 P1–P5 已废止，避免两套编号打架。
> 进度以 `CAPABILITY-MAP.md` 为准（每条能力带状态与证据）。

### 一期 · 让她"能真的聊起来"

| 缺口 | 旧文件（行） | 放哪层 | 用哪个槽位 | 状态 |
| --- | --- | --- | --- | --- |
| **真实模型对接** | `dsh-client.js` 1,137 · `dsh-port.js` 101 · `dsh-model-follow.js` 71 · `preset-prompt.js` 157 | **内核**（`expression/model-http.js`） | 现有 `complete()` 端口，不新增消息类型 | ✅ HTTP 端口；DSH 专用客户端 ⬜ |
| **上下文预算** | `context-telemetry.js` 245 · `context-snapshot.js` 145 | **内核**（`expression/context-budget.js`） | 只影响提示词内容，不改信封 | ✅ |
| **轮次守卫** | `turn-guard.js` 112 | **内核**（`attention/turn-guard.js`） | 现有唤醒判断的输入 | ✅ |
| **多轮对话历史** | 旧桥内联 | **内核**（`conversation/`） | 提示词里的【刚才】段 | ✅ |
| **合批机制** | `wake-batch.js` 58 | **内核**（`attention/batch.js`） | 纯状态机，外部时钟驱动 | ✅ 机制；接进回路 ⬜ |
| **发件箱/重试** | `outbox.js` 138 | **运行时**（`runtime/outbox.js`） | `deliver` 的失败重试；回执已有 `retryable` | ✅ |
| **回合结转** | `session-rollover.js` 136 | **内核**（`conversation/` 的清理策略） | 无新消息 | ⬜ |
| **历史补读** | `history-catchup.js` 144 | **平台包**（包自己的补历史能力） | 走现有 `ctx.emit`，标 `silent:true` | ✅ |

### 二期 · 表达力（她"会做什么"）

| 缺口 | 旧文件（行） | 放哪层 | 槽位 |
| --- | --- | --- | --- |
| **表情包**（收藏/语义/发送） | `sticker-lib.js` 356 · `sticker-semantics.js` 562 | 库在**内核**（她的收藏），发送走 `send_media`；"收下这张"= `act` | 现有 `send_media` + `act` |
| **合并转发** | `forward.js` 231 | **平台包** | `send_media` 的 `kind:'forward'`（媒体种类，不是新意图） |
| **长文转纯文本** | `md-to-plain.js` 117 | **平台包**（呈现） | 显示格式 |
| **对话收尾** | `conversation-closure.js` 523 | **内核**（新增 `closure` 模块，状态机） | 现有 `close` 意图 |
| **黑话学习** | `slang-learner.js` 382 | **内核**（新增 `lexicon` 小模块） | 学到的词进记忆，不新增消息 |
| **表情/图片理解** | 旧桥内联 | **内核**（表达层把媒体描述拼进提示词） | 现有 `media` 字段 |

### 三期 · 渠道能力（QQ / B站 / 桌宠）

| 缺口 | 旧文件（行） | 放哪层 | 说明 |
| --- | --- | --- | --- |
| **QQ 工具面**（42 个 MCP 工具） | `mcp-snowluma-safe.js` 1,540 | **`packs/qq` 私有模块** + 内核工具面声明 | 渠道动作走 `act`（意图已有 `act` 类），**不新增意图种类** |
| **QQ 白名单/群策略** | `allowlist.js` 85 · `qq-model-view.js` 80 | **运行时策略**（`packs/_policy.json` 已就位） | 谁能跟她说话 = 部署策略 |
| **B站 网络层** | `bili-api.js` 150 · `bili-dynamics.js` 187 · `bili-card.js` 169 | **`packs/bilibili`** | cookie 用户自备 |
| **B站 记忆/工作区** | `bili-memory.js` 882 · `bili-workspace.js` 19 | **`packs/bilibili`**（渠道专属记忆） | 不进内核 |
| **桌宠 长轮询/API** | `pet.js` 770 · `pet-chat.js` 949 · `pet-api.js` 230 | **`packs/desktop-pet`** | 通道在仓库外 |
| **桌宠 主动搭话** | `pet-purpose.js` 632 | **内核**（`purpose/` 的载体选择）+ 包呈现 | 载体互斥由内核决定 |

### 四期 · 语音（完整链路）

| 缺口 | 旧文件（行） | 放哪层 |
| --- | --- | --- |
| 语音包管理/导入 | `voice-packs.js` 1,295 · `voice-pack-import.js` 496 · `voice-health.js` 71 | **内核 `voice/`**（库与包元数据）+ **运行时**（文件落盘校验） |
| TTS 合成 | `voice-tts.js` 150 | **外部服务**（内核只发请求，不含引擎） |
| 语音发送 | `send-voice-lib.js` | **平台包**（QQ 语音条 / 桌宠播放） |

### 五期 · 运维与外壳（最不紧急，但量最大）

| 缺口 | 旧文件（行） | 放哪层 |
| --- | --- | --- |
| 控制台 180 路由 | `plugins/surfcore/index.js` 4,514 | **未来 UI 层**（不进内核；内核只提供 `settings.model()`/`snapshot()`） |
| 更新器 | `updates.js` 2,020 | **发行层 `tools/`**（且不得触碰第三方运行时） |
| 定时器/心跳 | `scheduler.js` 1,373（剩余部分） | **`app/`**（组合根起一个循环调 `kernel.tick()`） |
| 状态存储 | `store.js` 694 | ✅ 已有（`kernel/store`），剩迁移逻辑 |
| 隐私/脱敏 | `privacy.js` 218 | **运行时**（管道里脱敏）+ 内核（进提示词前） |
| 平台注册表 | `platforms.js` 165 · `extensions.js` 287 | ✅ 已有（`runtime/host.js` + `pack.json`） |
| 自检 | `self-test.js` 118 · `doctor.js` 117 | **`tools/`**（诊断脚本） |
| 联网搜索 | `web-search.js` 601 · `safe-fetch.js` 385 | **内核技能**（判断）+ **shared HTTP**（传输）；需内网/SSRF 防护 |
| 兼容层 | `compat.js` 431 · `compat-rules.js` 44 | **一次性迁移工具**，不进本体 |

### 不可复现（红线，永久排除）

| 旧文件 | 原因 |
| --- | --- |
| `snowluma-install.js` 149 | R1/R2：不得复制/部署第三方运行时 |
| 一键启动/关闭（旧桥 + GUI） | R2：不程序化部署/启停 |
| `_snowluma-catalog.json` 快照 | 不进发布物（且摘要文本属他人表达） |
| `@snowluma/sdk` / `@snowluma/mcp` 依赖 | 发布物不得含第三方运行时 |
| `mcp-snowluma-safe.js` 里的**协议透传**部分 | 只保留"我们自己的 OneBot 实现"，不透传其私有接口 |

---

## 3. 落位规则（把上面所有缺口套进来都不破约定）

| 如果这件事是… | 就放… | 用哪个现有槽位 |
| --- | --- | --- |
| 关于"她"的判断（记不记、说不说、用不用语音、惊不惊喜） | **内核** | 现有九件套 |
| 关于"怎么运"的机械动作（重试、脱敏、限流、装包） | **运行时** | `deliver` / `emit` / `host` |
| 关于"那个平台"的规矩（消息段、审批、限速） | **平台包** | `send()` 收 `act`/`send_media` |
| 需要动"她收藏的东西"（表情、语音库、黑话） | **内核**（数据）+ 包（发送） | `send_media` |
| 界面/更新/诊断 | **本体外**（`app/` `tools/`） | 读 `snapshot()`/`settings.model()` |

**新增模块的判据**：只要它①不 import 上层 ②不新增消息类型 ③不把渠道名写进内核，
就是"新模块"而不是"改约定"。上面一期到五期全部满足。

---

## 4. 五期路线（**唯一口径**）

| 期 | 内容 | 为什么这个顺序 | 当前 |
| --- | --- | --- | --- |
| **一期** | 真实模型对接 + 上下文预算 + 轮次守卫 + **多轮历史** + **合批机制** + 发件箱 | 没有真模型，其它都是空转；这几项直接决定"能不能聊" | **5/6 ✅**（合批接进回路 ⬜） |
| **二期** | 表情包 + 对话收尾 + 黑话 + 媒体理解 + 长期摘要 | 决定"像不像人" | 0/5 |
| **三期** | QQ 工具面（42 工具分三批：读、写、管理）+ 白名单 | 决定"能不能干活"；工具实现全在包里 | 0/2 |
| **四期** | B站网络层 + 桌宠长轮询 + 语音完整链路 | 渠道铺开 | 0/3 |
| **五期** | 控制台 / 更新器 / 自检 | 外壳，最后做；控制台是 UI 层，不进内核 | 0/3 |

---

## 5. 一句话结论

**结构不用再动，缺的是"内容"**：把旧代码里那些"她怎么想/怎么说/怎么做"的规则
一条条搬进内核对应模块，把渠道手艺搬进包，把界面搬出本体。
每搬一条都要过门禁：`npm run test:arch`（测试 + 适应度 + 体检 + 本体检查）。
