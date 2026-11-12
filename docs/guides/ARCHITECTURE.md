# 架构总览（SurfCore）

> 这份文档回答四个问题：**这套东西由哪些进程组成**、**代码分成哪几层**、**一条消息/一次主动行为是怎么走完全程的**、**改了什么需要重启什么**。
>
> 逐模块的细节不在这里，见文末 [文档地图](#10-文档地图)。本文只描述**现状**，所有结论都能在代码里对上（关键处标了 `文件:行号`）。
> **最后核对**：2026-10-26（全仓库逐行梳理）。配套阅读：总纲 [ARCHITECTURE.md](ARCHITECTURE.md) · 边界 [BOUNDARIES.md](BOUNDARIES.md) · 索引 [../README.md](../README.md)。

---

## 0. 一句话定位

SurfCore 让一个 **DeepSeek Harness（DSH）agent** 活在一个真实的人身上：

- **QQ 侧**：把 QQ 群/私聊消息变成 DSH 会话里的用户消息，把 agent 的回复、提问、工具审批发回 QQ；
  更进一步，让 agent **自己决定**看消息、发言、引用、发表情、发语音、等待、潜水、收尾。
- **B站 侧**：让同一个角色以「一个 B站 用户」的身份活动——看视频、打分、评论、回帖、发动态、分享，
  有自己的作息、额度、偏好和鱼群守则。
- **记忆与人格**：QQ / B站 / 桌宠 三个场景共享**同一份角色人格卡 + 同一张衰减记忆卡**，并有一个
  「主动找主人」的目的机制。
- **桌宠**：仓库外的 Electron 桌宠通过本地令牌接口跟插件对话，也可以成为「主动搭话」的载体，
  和 QQ **互斥**（同一时刻只有一个执行者）。

一句话：**它不是"把模型接进 QQ"，而是"给模型一个身份、一套记忆、一个作息和两只手（QQ/B站）"。**

---

## 1. 进程与端口拓扑

```
                    ┌──────────────────────────── 用户可见的界面 ────────────────────────────┐
                    │  DSH Web GUI（动态端口）       浏览器控制台 :3100     桌宠窗口（Electron） │
                    └───────────┬──────────────────────────┬──────────────────────┬─────────┘
                                │                          │                      │ HTTP + 令牌
┌───────────────────────────────▼──────────────────────────▼──────────────────────▼─────────┐
│ DSH 宿主进程（Electron / Harness.exe）                                                      │
│   └─ surfcore 插件（bundle: surfcore + qq-mode）                                            │
│        · 设置页 UI（client.js）      · 设置页 API  /dsh-surfcore/api/*                      │
│        · 桌宠 API /dsh-surfcore/pet-api/*   · B站 调度器 / 记忆卡维护 / token 采集           │
└───────────────────────────────┬─────────────────────────────────────────────────────────────┘
                                │ ① HTTP（会话 Cookie，桥接自己铸造）
                                │ ② 子进程管理（spawn node src/bridge.js）
┌───────────────────────────────▼─────────────────────────────────────────────────────────────┐
│ QQ 桥接进程（node src/bridge.js，单实例锁）                                                  │
│   · OneBot WS 客户端  · DSH Web API 客户端  · 控制台 HTTP :3100                             │
│   · 三个 MCP server（stdio）· 目的机制 tick · 会话映射 · 安全闸门                            │
└──────┬───────────────────────────────┬───────────────────────────────┬──────────────────────┘
       │ OneBot v11 WS                 │ MCP (stdio)                    │ HTTP 127.0.0.1
┌──────▼──────────────┐   ┌────────────▼──────────────┐   ┌─────────────▼──────────────┐
│ SnowLuma2（第三方）  │   │ DSH 的 MCP 客户端          │   │ 语音引擎（仓库外）           │
│ 登录/收发/媒体 CDN    │   │  snowluma / -host / search │   │ 本地 :8765 / 云端 :8767      │
└─────────────────────┘   └───────────────────────────┘   └────────────────────────────┘
```

| 进程 / 服务 | 谁启动 | 通信 | 挂了会怎样 |
| --- | --- | --- | --- |
| **DSH 宿主 + surfcore 插件** | 用户启动 DSH | 进程内 | 设置页、桌宠、B站调度、记忆卡全停（QQ 桥接仍运行，但 agent 回复没人接） |
| **QQ 桥接**（`src/bridge.js`） | 插件按开关拉起 / 手动 `npm start` | HTTP+WS 到 DSH、WS 到 SnowLuma | QQ 收发全停；插件 2 分钟内自愈重启它（`plugins/surfcore/lib/index.js:2181`） |
| **SnowLuma2** | 用户自己（EULA §5.4，本程序只探测不部署） | OneBot v11 WS | 桥接显示"未连接"，消息进不来 |
| **三个 MCP server** | DSH 的 MCP 客户端按 profile 配置拉起（stdio） | stdio | agent 失去 QQ 工具/搜索能力（表现为"只会说话不做事"） |
| **语音引擎**（本地包 / 云包） | 设置页「启动」按钮 / `run.bat` | HTTP | 合成失败 → 返回 502 → 模型改回打字（不会伪造"我发了语音"） |
| **桌宠**（仓库外 Electron） | 用户自己 | HTTP + `x-pet-token` | 目的载体回落 QQ；对话不可用 |

**端口一览**

| 端口 | 谁 | 说明 |
| --- | --- | --- |
| DSH Web（**动态**） | DSH | 会漂移（见过 3080/48994/57981/14293）。桥接与插件都靠 `discoverDshBaseUrl()` / `state/dsh-port.json` 发现，**不要硬编码** |
| `3100` | 桥接控制台 | 可在 `config.json` 的 `consolePort` 改；鉴权 = `consoleToken`（未配置时自动生成到 `state/console-token`） |
| `8765` | 本地语音包 | 本地 TTS 引擎（`voice-local`） |
| `8767` | 云端语音包 | 云端 TTS 引擎（`voice-cloud`） |

---

## 2. 代码分层

依赖方向**只能从上往下**（下层的代码不 import 上层）：

```
┌───────────────────────────────────────────────────────────────────────┐
│ 表现层    plugins/surfcore/lib/client.js（设置页 14 个标签）           │
│           public/console.html（桥接控制台 10 个页面）                  │
├───────────────────────────────────────────────────────────────────────┤
│ 宿主装配  plugins/surfcore/lib/index.js（服务 + API + 生命周期）        │
│           store.js（配置模型）  paths.js（路径解析）                   │
├───────────────────────────────────────────────────────────────────────┤
│ 领域服务  plugins/surfcore/lib/{scheduler,memory,memory-card,align,     │
│           characters,privacy,automation,extensions,platforms,          │
│           token-budget,pet-*,bridge}.js                                │
├───────────────────────────────────────────────────────────────────────┤
│ QQ 桥接   src/bridge.js（进程主程序）+ src/mcp-*.js（工具面）           │
├───────────────────────────────────────────────────────────────────────┤
│ 纯引擎    src/*.js（无宿主依赖）：记忆卡/目的/收尾/额度/计价/人格/       │
│           B站/内容处理/接入层/语音内核                                 │
└───────────────────────────────────────────────────────────────────────┘
```

**为什么这样分**：`src/` 里的纯引擎被**三方**复用——桥接进程、DSH 插件、仓库外的独立工具（语音 CLI/GUI）。
它们不读全局单例、不碰配置，全部"把配置传进来"，所以能离线单测（`scripts/test-*.mjs` 大多测这层）。

**已知的耦合代价**（写在这里提醒后来人）：

- 插件通过 `../../../src/*.js` **相对路径**直接引用 11 个核心模块共 26 处；
  其中 `src/memory-card.js` 挂了 `?rev=` 缓存破坏后缀（同一字符串硬编码在 3 个文件里）。
  改了核心模块而没 bump rev → 热重载后插件仍在跑旧代码（PITFALLS #68）。现在有 `scripts/test-core-rev-sync.mjs` 钉一致性。
- `src/bridge.js` 是**全仓库最大单体**（约 15,000 行），控制台 **126 条路径**（按域归约约 110 个端点）
  写在同一段 `if (url.pathname === …)` 链里。拆分是路线图上的事，见 `docs/RISK_REGISTER.md` 的 A1。

---

## 3. 两个世界 + 三个共享引擎

| | QQ 世界 | B站 世界 |
| --- | --- | --- |
| 身份 | 一个 QQ 号（SnowLuma 登录） | 一个 B站 账号（cookie 在 `bili/credentials.json`） |
| 消息单位 | 私聊 / 群聊 | 视频 / 动态 / 评论 / 私信 / 直播 |
| 会话模型 | 每个 QQ 会话一个 DSH 会话 | 每个 B站 会话（`bili-whale-*`）一个 DSH 会话 |
| 谁在驱动 | 桥接进程 | 插件里的 B站 调度器 |
| 人格/记忆 | **共享** | **共享** |

三个共享引擎（`src/`）：

1. **记忆卡（`memory-card.js`）**：一份衰减卡（会遗忘、有清晰度、有容量告警）+ 一份全量卡（append-only 存档，不进提示词）。
   QQ / B站 / 桌宠 都往同一个 inbox 里写，由**插件**统一维护、渲染出两份场景化的注入块。
2. **目的机制（`purpose-engine.js`）**：从近期记忆里提炼"我想弄明白/想做点什么"，定期主动找主人。
   载体可切 QQ / 桌宠，**互斥、可回落**。
3. **每日 token 额度（`token-budget.js` + `token-ledger.js`）**：按 QQ / B站 / 其他 / 总额四个口径记账，
   峰谷分时计价，80% 提醒、100% 停直接参与（唤醒/叫醒/评论）。

---

## 4. 运行时目录（两套 state + 三个仓库外目录）

> ⚠️ 这是最容易记混的地方：**桥接和插件的运行时数据不在同一个根**。

| 根 | 归属 | 放什么 |
| --- | --- | --- |
| `<仓库根>/state/` | **QQ 桥接** | `sessions.json`（QQ 会话 ↔ DSH 会话映射 + 每会话 agentToken）、`mode.json`、`social-v2.json`（二代仿真状态）、`console-token`、`bridge.lock`、`bridge.log`、`qq-activity.log`、`slang.json`、`stickers.json`、`tool-calls.jsonl`、`token-usage.jsonl`、`greetings.json`、`self-identity.json`、`feedback.json`、`voice-packs/`、`voice-tts/` |
| `~/.dsh/surfcore/` | **插件** | `config.json`（合体层配置）、`bili.config.json`、`memory/`（记忆卡全套 + 双向记忆 md）、`backups/`、`audit.jsonl`、`plugin.log`、`characters/<id>/`（角色包）、`pet/`（`host.json` / `host-token` / `chat/` / `focus.json`）、`token-budget.json` 等额度文件、`bili/credentials.json`、`bili/owner-credentials.json` |
| `<仓库根>/roles/*.md` | 用户 | 旧布局人格卡（有角色系统后会自动迁移到角色包） |
| `<仓库根>/config.json` | 用户 | QQ 桥接配置（模板 `config.example.json`，**它同时是运行时的默认层**） |
| `<工作区>/voice/` | 仓库外 | 语音引擎与语音包安装源 |
| `<工作区>/pet/` | 仓库外 | 桌宠 Electron 工程 |

细节（每个文件的写者/读者/生命周期）见 [DATA-AND-CONFIG.md](DATA-AND-CONFIG.md)。

---

## 5. 关键数据流

### 5.1 入站：群友说了一句话，到 agent 看见

```
QQ 群 ──► SnowLuma ──WS──► 桥接
                            ├─ ① 会话在 allow 里吗？（deny.users 黑名单先拦人）
                            ├─ ② 当前模式允许吗？（chat / closed-agent / reserved / reserved2）
                            ├─ ③ 敏感/被拉黑？丢弃并记审计
                            ├─ ④ 落进 social-v2 未读池（含引用解析、图片/表情元数据、转发展开）
                            ├─ ⑤ 唤醒判定：@、叫名字、提问、关键词、拍一拍、概率、主人发言、上一条是自己在等回复…
                            ├─ ⑥ 唤醒 → 组提示词（人格 + 记忆卡注入块 + 收尾状态 + 未读 + 目的心事）
                            │     未读只带**最近一窗**（`wakeMessageLimit`，默认 12）；更早的折叠成
                            │     `folded` 计数并明确"别逐条回"（PITFALLS #76；`context.wakeFoldOld=false` 恢复旧行为）
                            └─ ⑦ 调 DSH `session.prompt`（每会话独立 DSH 会话 + 独立 agentToken）
DSH agent ──► 决定用工具发言 / 或（reserved 一代）直接输出文本
```

- **两代仿真模式的差别**：`reserved2` 里**文本输出不会自动发到 QQ**（文本只是思考），发言必须调工具；
  `reserved` 一代是"模型输出即消息"，按空格分句。
- **上线补历史**：桥接启动或 QQ 重新上线时，用 `get_group_msg_history` / `get_friend_msg_history`
  把掉线期间白名单会话的消息补进未读（去重靠 messageId + 时间水位），可配置是否顺手醒一次。

### 5.2 出站：agent 说了一句，到 QQ

```
agent 调 qq_send_message / qq_reply / qq_send_burst / qq_send_voice / qq_send_sticker
  └─► MCP server（stdio）→ 控制台 HTTP（带 x-agent-token + x-agent-call）
        ├─ ① 会话令牌有效？命中活跃会话？（防"漏传令牌升级成管理端全权"的 confused deputy）
        ├─ ② 目标在白名单里？（发送白名单是硬闸，和管理端无关）
        ├─ ③ 模式允许？工具开关打开？AI 暂停？token 额度到 100%？
        ├─ ④ 敏感信息正则（路径/凭据/手机号/住址…）拦不拦？
        ├─ ⑤ 长度/条数硬上限（单条 >500 字 400；一次最多 8 条）
        ├─ ⑥ md→纯文本、拆条、发送间隔
        ├─ ⑦ 写审计（tool-calls.jsonl），按 messageId 校验回执
        └─ ⑧ 回执成功 → 记进 social-v2（自己的发言、未读水位、收尾判断的输入）
```

### 5.3 唤醒与潜水（二代仿真）

- 唤醒配置存在 `social-v2.json`：模式（active/diving）、触发器（@ / 名字 / 关键词 / 提问 / 拍一拍 / 指定成员 / 概率 / 任意消息）、
  批处理窗口、频率上限。
- **沉睡前观察**：决定潜水/收尾前必须先做一次 `qq_wait_for_messages(timeoutMs=300000)` 的静默观察，
  桥接会校验"确实等够了"。这是防止"刚说完就跑"的硬约束。
- **对话收尾**：`qq_close_conversation` 不发消息、只记录"收在哪 / 下次怎么接"，并保持唤醒配置；
  对方明确提问/求助时桥接**拒绝**收尾。

### 5.4 记忆：三个场景写进同一张卡

```
QQ 消息 ─┐
B站 行为 ─┼─► memory-inbox.jsonl ─►（插件，每 10 分钟）─► memory-card.json（衰减卡）
桌宠对话 ─┘                                              ├─► memory-card-prompt-qq.md   （桥接读）
                                                         └─► memory-card-prompt-bili.md （调度器读）
                        └─► memory-card-full.jsonl（全量存档，永不遗忘，**不进提示词**）
```

- **谁写**：桥接只**append inbox**（不做合并、不写卡）；插件是**唯一写卡者**（单进程内 promise 链串行）。
- **衰减规则**：新记忆前 7 天不降档，超过 7 天开始变"模糊"，60 天且重要度低可彻底遗忘；
  和主人相关且重要度 ≥ 65 的永不遗忘。容量 80/90/100% 三档告警，可自动压缩到 90%。
- **隐私**：每条记忆带 `scope`（qq / bili / pet / shared）；B站 的注入只取 `bili/shared`，
  共享 scope 会脱敏 5–12 位连续数字；时政/娱乐圈等 `sensitive` 不进 B站。

### 5.5 目的机制：主动找主人

```
近期记忆 + 人格卡 + 记忆卡骨架
   └─► 注意力打分 → 需求（9 类）/ 情绪 → 目标假设（归属/置信度/价值/紧迫度/风险）
         └─► 选一个行为：分享 🧀 / 索取 / 邀请 / 倾诉 / 好奇 / 追问
               └─► 排程（间隔随机 + 安静时段 + 每日上限）→ 载体执行
                     ├─ 载体 = QQ：桥接自己发（60 秒 tick；桌宠开着时让位）
                     └─ 载体 = 桌宠：插件 tick 推气泡（QQ 侧让位，30 秒内生效）
```

硬闸门：安静时段、每日上限、主人正在聊、token 额度、好友关系、专注模式。
载体没在线时**回落 QQ**（不会两边同时收到）。回执走 `turn/end` + 发送记录，20 分钟看门狗。

### 5.6 B站：一次"醒来"做什么

```
调度器 tick（默认 60 秒）
  ├─ 到作息窗口了吗？（night.windows：几点到几点、每次醒看几个视频、一天最多醒几次、跳过概率）
  ├─ 额度还有吗？（quota.json：分享/评论/私信 四本账）→ 没有就静默跳过
  ├─ 选视频（偏好加权 + 去重 + 观看历史）→ 看 → 打分 / 收藏 / 评论 / 聚拢鱼群
  ├─ 生成记忆（bili-memory.json/md）→ 既喂给 B站 自己的下一次提示词，也喂给 QQ 记忆卡
  └─ 可选：发动态 / 分享视频卡 / 回私信 / 挂直播间监听
```

---

## 6. 配置模型：三份文件，一份真相

| 文件 | 谁用 | 特点 |
| --- | --- | --- |
| `<仓库根>/config.json` | **桥接**（QQ 侧） | 模板 `config.example.json`。⚠️ 模板不只是文档：插件 `readQqConfig()` 会把它当**默认层** deepMerge（`plugins/surfcore/lib/store.js`），所以模板缺键 = 那项没有默认值 |
| `~/.dsh/surfcore/config.json` | **插件**（合体层） | 记忆同步、身份对齐、管理员、扩展/平台、UI 偏好。写入自动备份 + 原子替换；读给 UI 时脱敏，保存时 `********` 表示"保持原值" |
| `~/.dsh/surfcore/bili.config.json` | **B站 工具链** | 账号、作息窗口、偏好、额度、鱼群守则、四类动态 |

设计原则写得很明确（`plugins/surfcore/lib/store.js:1-12`）：**不搬家、不制造第二份真相**——
QQ 仍读仓库根的 `config.json`，B站 仍读自己的配置，插件只是把它们装进同一个窗口。

> ⚠️ 已知缺口：`config.example.json` 缺 `chat` / `platforms.start` / `pet` / `tokenBudget` 四段。
> 功能不受影响（各处有 `??` 兜底），但"模板即默认层"这层缺键会让新装用户看不见这些能力。
> 详见 `docs/RISK_REGISTER.md` 的 A5。

---

## 7. 安全模型

威胁主体与边界（完整版见 [SECURITY_BASELINE.md](SECURITY_BASELINE.md) 与 [RULES.md](../../RULES.md)）：

| 威胁 | 边界 | 落点 |
| --- | --- | --- |
| 群友让 agent 干本机的事 | 仿真会话的**工具白名单**（fail-closed） | `plugins/surfcore/qq-tool-restrict.mjs`：只放行 QQ MCP + 搜索，其余一律拒绝 |
| 群友让 agent 给陌生人发消息 | **发送白名单**是硬闸（不带"管理员例外"） | 桥接 `allowed()` + MCP 侧再校验一次 |
| 群友诱导外发本机信息 | 出站审计（路径/凭据/手机号/住址正则）+ 身份闸（不许冒用别人账号标识） | `src/sensitive.js`、`src/identity-guard.js` |
| 本机其它程序改配置 | 控制台令牌（定长比较）+ Host 白名单 + 同源 + JSON 强制；插件 API 走 DSH 自己的鉴权 | 桥接入口集中关卡（153 个端点分支**之前**） |
| 网页通过浏览器打本机 | Host/Origin 校验（浏览器不能伪造 Host）+ 写操作必须 `application/json` | 同上 |
| 提示注入让 agent 读内网 | SSRF 防护：仅 http(s)、禁内网/环回/链路本地/CGNAT、DNS 解析后逐地址校验、重定向每跳复核 | `src/safe-fetch.js` |
| 密钥落盘被别的用户读 | `state/` 用 icacls 切断继承（只留当前用户/SYSTEM/Administrators）；令牌 0600 | `src/state-acl.mjs` |
| 桌宠接口被别的进程调用 | `x-pet-token`（24B 随机）+ 回环 + 同源 + 定长比较 | `plugins/surfcore/lib/pet-api.js` + `http-guard.js` |

**明确的取舍**：

- 不代用户操作账号（SnowLuma 只探测不部署、不代扫码，EULA §5.4）。
- 不采集、不外发没有授权的东西；出机清单写在 `LICENSE`。
- 不可逆删除 = 事故：清理一律 `rename → _backups/` 或 `~/.dsh/_quarantine/`，可回滚。
- 控制台是**单机回环** Web UI，不做多用户/远程管理。

---

## 8. 启动/重启矩阵（改了什么要重启什么）

| 你改了什么 | 需要做什么 | 生效范围 |
| --- | --- | --- |
| `src/*.js`（核心引擎） | **重启 DSH**（插件侧） + 重启桥接（桥接侧） | 两边都换了代码 |
| `plugins/surfcore/lib/*.js` | 热重载插件（`plugin_manager` 关/开）或重启 DSH | 插件；`src/memory-card.js` 还要 bump `?rev=` |
| `dsh/agent-presets/*` | `node scripts/build-agent-preset-patches.mjs` → 重装/重启 DSH | preset 提示词与工具面 |
| `config.json`（QQ 侧） | 控制台保存即生效；改动结构大的字段建议重启桥接 | 桥接 |
| `~/.dsh/surfcore/config.json` | 设置页保存即生效（服务自行重读） | 插件 |
| `bili.config.json` | 设置页保存即生效；调度器下一次 tick 读新值 | B站 |
| 语音包 | 设置页「启动/切换」；⚠️ `socialV2.voice.tts.route` / `trigger` / `tts.enabled` 改完要**重启桥接**（桥接在启动时把语音配置读进内存），只有**桌宠**每次合成前重读磁盘 | 语音 |
| 桌宠工程 | 重新构建（`npm run selftest`） | 桌宠 |
| DSH 本体升级 | 先 `npm run guard:check`（asar 补丁会被覆盖）→ `npm run verify:adaptation` → `npm run test:audit` | 全部 |

---

## 9. 术语表

| 术语 | 含义 |
| --- | --- |
| **桥接** | `src/bridge.js` 那个独立 node 进程，负责 QQ ↔ DSH |
| **插件 / 合体插件** | `plugins/surfcore`，装进 DSH 的 bundle（设置页 + B站 + 记忆 + 桌宠接口） |
| **reserved / reserved2** | 一代仿真 / 二代仿真模式（二代"一切皆工具"） |
| **目标假设** | 目的机制里的结构化念头：归属 + 置信度 + 价值 + 紧迫度 + 风险 |
| **载体** | 主动搭话由谁执行：QQ 或桌宠（互斥） |
| **收尾（closure）** | 判断这段对话可以自然结束；不是"永久不理"，下次会带着结束点回来 |
| **沉睡前观察** | 潜水前必须完成的一次 5 分钟静默等待（桥接校验） |
| **记忆卡 / 全量卡** | 衰减卡（进提示词、会遗忘） / 全量卡（存档、永不遗忘、不进提示词） |
| **角色包** | `~/.dsh/surfcore/characters/<id>/`：人格卡 + 记忆卡 + B站 行为账本 |
| **唤醒配置（WakeConfig）** | 什么条件叫醒 agent：@/名字/关键词/提问/拍一拍/概率/指定成员 |
| **鱼群守则** | 判断"这堆人是不是在刷屏/围攻"并决定忽略还是聚拢的规则 |
| **PITFALLS** | `docs/PITFALLS.md`，踩坑档案（每条都有现象/根因/处置/验证） |

---

## 10. 文档地图

| 想知道 | 看 |
| --- | --- |
| **总览、进程、数据流、重启矩阵** | 本文 |
| 桥接 15,000 行里的每个功能 | [MODULE-BRIDGE.md](MODULE-BRIDGE.md) |
| 核心引擎逐个（记忆/人格/目的/收尾/额度/计价） | [MODULE-CORE-A.md](MODULE-CORE-A.md) |
| 核心引擎逐个（B站/内容处理/接入层/语音内核） | [MODULE-CORE-B.md](MODULE-CORE-B.md) |
| 插件宿主（服务、调度、扩展、配置模型） | [MODULE-PLUGIN.md](MODULE-PLUGIN.md) |
| 两套界面：设置页 14 个标签 + 控制台 10 个页面 | [UI-AND-CONSOLE.md](UI-AND-CONSOLE.md) |
| 语音全链路 | [SUBSYSTEM-VOICE.md](SUBSYSTEM-VOICE.md) |
| 桌宠全链路 | [SUBSYSTEM-PET.md](SUBSYSTEM-PET.md) |
| B站 子系统（34 个命令 / 生物钟 / 鱼群） | [SUBSYSTEM-BILI.md](SUBSYSTEM-BILI.md) |
| 模型侧工具面与 preset | [AGENT-TOOLS-AND-PRESETS.md](AGENT-TOOLS-AND-PRESETS.md) |
| 所有状态文件、所有配置键 | [DATA-AND-CONFIG.md](DATA-AND-CONFIG.md) |
| 做不到什么、会在哪里坏 | [BOUNDARIES.md](BOUNDARIES.md) |
| 装到新机器 | [DSH_SETUP.md](DSH_SETUP.md) |
| 记忆卡设计 | [MEMORY_CARD.md](MEMORY_CARD.md) |
| 角色系统 | [CHARACTER_PERSONA.md](CHARACTER_PERSONA.md) |
| 目的机制 | [PURPOSE_OUTREACH.md](PURPOSE_OUTREACH.md) |
| 对话收尾 | [CONVERSATION_CLOSURE.md](CONVERSATION_CLOSURE.md) |
| 安全基线 | [SECURITY_BASELINE.md](SECURITY_BASELINE.md) |
| 踩过的坑 | [../PITFALLS.md](../PITFALLS.md) |
| 风险台账 | [../RISK_REGISTER.md](../RISK_REGISTER.md) |
