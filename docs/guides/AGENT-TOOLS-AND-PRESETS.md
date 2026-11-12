# 工具面与 preset（AGENT-TOOLS-AND-PRESETS）

> 这份文档回答：**agent 的手从哪来**（三个 MCP server + 39 个 `qq_*` 工具）、**哪些手被绑住**
> （五层闸门 + fail-closed 守卫）、**她戴哪张面具**（`qq-chat` / `qq-chat-v2` 两代 preset）、
> **这些是怎么装进 DSH 的**。
> **最后核对**：2026-10-26（全仓库逐行梳理）。配套阅读：总纲 [ARCHITECTURE.md](ARCHITECTURE.md) · 边界 [BOUNDARIES.md](BOUNDARIES.md) · 索引 [../README.md](../README.md)。

---

## 0. 一句话

**两个 MCP 手 + 一张面具。**

- `snowluma`（39 个 `qq_*` 工具）是主力手：读消息、发消息、等待、表情、语音、记忆。
- `snowluma-host`（1 个）是探活手：只问 SnowLuma 在不在，**没有启停能力**（EULA）。
- `web-search-safe`（2 个）是外部信息手：只读搜索与抓取，带 SSRF 防护。
- preset 决定"她是谁、在哪说话"：`qq-chat`（一代/普通）与 `qq-chat-v2`（二代仿真）。

---

## 1. 三个 MCP server

| server | 入口 | 工具 | 挂载 | 边界 |
| --- | --- | --- | --- | --- |
| `snowluma` | `src/mcp-snowluma-safe.js`（1,410 行） | 39 个 `qq_*` | `~/.dsh/profiles/<profile>/cordis.patch.yml`（`setup-dsh.mjs` 写入） | 发送必须命中白名单；会话绑定 `x-agent-token`；工具开关逐项可控 |
| `snowluma-host` | `src/mcp-host-server.js`（93 行） | `snowluma_status` | 同上 | **只读探活**；v0.1.5 起移除了 `start_snowluma`/`stop_snowluma` |
| `web-search-safe` | `src/mcp-web-search-safe.js`（92 行） | `web_search`、`web_fetch` | 同上 | 只读；禁内网/环回/CGNAT；DNS 解析后逐地址校验；重定向每跳复核 |

三者都是 **stdio** transport，由 DSH 的 MCP 客户端按 profile 配置拉起，进程生命周期归 DSH 管。

> 为什么要把 host 单独拆出来：SnowLuma 的登录态查询（`get_login_info`）与"操控进程"是两类能力，
> 前者无副作用、后者触碰 EULA §5.4。拆成两个 server 后，MCP 配置里可以只挂前者的能力。

---

## 2. `qq_*` 工具全表（39 个）

**配置开关**列对应 `config.json` 的 `socialV2.tools.<key>`（`true` 才注册；默认只有
`setStickerRemark` 与 `sendVoice` 是 `false`）。**需要令牌**列：二代模式下所有 `qq_*` 调用都要带
`x-agent-token`（会话令牌）+ `x-agent-call: 1`。

### 2.1 只读：状态与名单

| 工具 | 作用 | 开关 |
| --- | --- | --- |
| `qq_status` | 查机器人登录状态与账号信息 | —（常驻） |
| `qq_list_groups` | 列出机器人所在的全部群 | — |
| `qq_get_group_members` | 群成员列表（号/昵称/群名片） | — |
| `qq_get_group_history` | 群最近消息历史（可按 messageSeq 往前翻） | — |
| `qq_get_active_members` | 最近活跃成员（判断话题参与者） | `getActiveMembers` |
| `qq_get_self_image` | 看自己的 Q 版形象（DeepSeek 小鲸鱼） | `getSelfImage` |
| `qq_list_voices` | 语音库清单（名字/时长/大小） | `sendVoice` |
| `qq_list_stickers` | 收藏表情清单（编号/情绪/内容/关键词） | `listStickers` |

### 2.2 只读：消息与上下文

| 工具 | 作用 | 开关 |
| --- | --- | --- |
| `qq_get_prompt` | 当前提示词/角色/推荐值/可用工具/唤醒配置 | `getPrompt` |
| `qq_get_unread_messages` | 未读消息（**不自动标记已读**；支持 `afterSeq` 从水位补读） | `getUnread` |
| `qq_get_recent_messages` | 最近消息（支持 offset 往前翻） | `getRecent` |
| `qq_get_my_recent_messages` | 自己最近发过的话（防重复/保持人设） | `getMyRecent` |
| `qq_get_message_detail` | 单条消息的发送者/引用/正文（≤200 字，长文不给） | `getMessageDetail` |
| `qq_get_message_images` | 把消息里的图片/表情**直接返回给视觉模型** | `getImages` |
| `qq_get_forward_msg` | 展开合并转发（含嵌套转发与图片） | `getForwardMsg` |
| `qq_social_state` | 该会话的 WakeConfig/未读数/上次唤醒原因/上次发言 | `socialState` |

### 2.3 发送

| 工具 | 作用 | 开关 | 硬约束 |
| --- | --- | --- | --- |
| `qq_send_group_message` | 群里发一条纯文本（可引用） | `sendGroup` | 白名单 + 模式 + 500 字 + 频率 |
| `qq_send_private_message` | 私聊发一条（可引用） | `sendPrivate` | 同上 |
| `qq_reply` | 引用某条消息发送 | `reply` | 必须给出真实 messageId |
| `qq_send_message` | **统一发送**：一条或多条、可引用、可自定义条间间隔 | `sendMessage` | 最多 8 条 |
| `qq_send_burst` | 分多条发（随机真人间隔） | `sendBurst` | 最多 8 条 |
| `qq_send_poke` | 拍一拍（群聊需 targetUserId） | `sendPoke` | 频率限制 |
| `qq_send_sticker` | 发一张收藏表情（一条只能一张，不能带文字） | `sendSticker` | 同上 |
| `qq_send_voice` | 发语音：`text` 现场合成 / `voice` 用语音库现成文件 | `sendVoice`（默认**关**） | 需引擎；120 字；2/分钟 |

### 2.4 等待与状态机

| 工具 | 作用 | 开关 |
| --- | --- | --- |
| `qq_wait_for_messages` | 长轮询等消息。`purpose="reply"` 是"首答前补静默"；默认用途是"等新消息 / 沉睡前观察" | `waitMessages` |
| `qq_mark_read` | 标记已读到某个水位（推荐总带 `throughSeq`，否则会清空全部未读） | `markRead` |
| `qq_close_conversation` | **自然收尾**：不发消息，记录"收在哪/下次怎么接"，保持唤醒配置 | `closeConversation` |
| `qq_set_wake_config` | 设置唤醒条件（@/名字/关键词/提问/拍一拍/概率/任意消息/指定成员）与潜水时长 | `setWakeConfig` |

> **沉睡前观察**是硬约束：决定潜水/收尾前必须先用 `qq_wait_for_messages(timeoutMs=300000)` 完成一次
> 静默观察，桥接会校验；`purpose="reply"` 的短静默**不能**代替它。

### 2.5 记忆、黑话、表情管理、反馈

| 工具 | 作用 | 开关 |
| --- | --- | --- |
| `qq_memory_append` / `qq_memory_query` / `qq_memory_remove` / `qq_memory_clear` | 轻量记忆（进行中的话题 / 想说的话 / 对某人的印象） | `memory` |
| `qq_slang_query` / `qq_slang_submit` | 查已确认的群聊黑话 / 提交候选词 | `slangQuery` / `slangSubmit` |
| `qq_collect_sticker` | 收藏别人发的表情，并写情绪/内容/关键词 | `collectSticker` |
| `qq_sticker_note` | 给自己的收藏表情写语义（本地记忆，不改 QQ 备注） | `stickerNote` |
| `qq_get_sticker_image` | 看某个收藏表情长什么样 | `getStickerImage` |
| `qq_set_sticker_remark` | 改 QQ 官方备注（写操作，默认**关**） | `setStickerRemark` |
| `qq_report_feedback` | 向控制台反馈问题/困惑 | `feedback` |

---

## 3. 工具闸门：五层，从外到内

```
① 进程/传输    DSH 的 MCP 客户端（stdio）——只有装进 profile 的 server 才存在
② 工具是否注册 socialV2.tools.<key> 为 true（false 时该工具压根不在 schema 里）
③ 调用方身份   x-agent-call: 1 + x-agent-token 必须命中一个**活跃会话**；
              漏传令牌不会升级成管理端全权（防 confused deputy）
④ 运行状态    AI 暂停（socialV2.paused）/ 二代总开关关闭 / 该会话不在当前模式允许范围
⑤ 业务闸门    发送白名单、敏感信息、长度与条数、频率、token 额度、鱼群守则
```

失败码语义（模型据此改策略，而不是硬试）：

| 码 | 含义 | 模型应该做什么 |
| --- | --- | --- |
| `400` | 参数不合法 / 单条超长 / JSON 错误 | 改参数或缩短 |
| `401` | 令牌无效/过期 | 重新读提示词里的会话令牌（或放弃） |
| `403` | 白名单外 / 模式不允许 / 工具未启用 / 额度到 100% | **不要重试**，换目标或等 |
| `404` | 目标不存在（群/消息/音频） | 停 |
| `409` | 状态冲突（例如正在跑） | 等一下再试 |
| `415` | 写操作不是 `application/json` | 修请求 |
| `429` | 频率超限 | 放慢/减少条数 |
| `502` | 上游失败（TTS 引擎/发送失败） | 降级（改回打字） |

---

## 4. 工具守卫：fail-closed 的两段式

文件：`plugins/surfcore/qq-tool-restrict.mjs`（204 行，**唯一权威实现**）。
两个 preset 目录下的同名文件只是 `export * from` 的壳，避免两份实现漂移。

**名单规模（实测）**

| 名单 | 条数 | 内容 |
| --- | --- | --- |
| `LOCAL_EXECUTION_TOOLS` | **49** | `pwsh` `bash` `read` `write` `edit` `glob` `grep` `str_replace_editor` `load_workspace_dependencies` `subagent*` `send_message` `interrupt_agent` `list_agents` `workflow` `ralph` `cordis_inspect_*` `dsh_snapshot` `dsh_rollback` `incident_resolved` `job_*` `skill` `present` `*_goal` `list_mcp_resources` `read_mcp_resource` `subagent_codex` `subagent_claude_code` `spawn_teammate` `team_task_*` `plugin_manager` `schedule_*` `dev_mode_*` |
| `KNOWN_DANGEROUS_GLOBAL_TOOLS` | 49 + 18 = **67** | 上面 49 个 + 18 个 `dev_*`（插件注入/打包/自测） |
| `SAFE_PREFIXES` | 3 | `mcp__snowluma__`、`mcp__snowluma-host__`、`mcp__web-search-safe__` |
| `SAFE_EXACT` | 2 | `ask_user_question`、`todo_write` |

**为什么必须两段**（这是设计要点，不是啰嗦）：

1. `ctx.tools.restrict({ deny })` 把它们从**工具清单/schema** 里隐藏（注册期）。
2. `ctx.tools.guard(fn)` 白名单兜底：执行期任何不在允许范围的调用一律拒绝并返回可读原因。

只做第 2 段不够——工具名仍会出现在模型面前，既违反"仿真会话不得拥有本地执行能力"，
也会诱导模型去调它。反过来只做第 1 段也不够——别的 composition 可能再把名字注册进全局层。

**历史教训（写进代码注释里）**：名单初版把 `pwsh_persistent`/`bash_persistent`/`cordis`/`goal_write`
当成工具名，这五个**根本不存在**；而 `tools.restrict()` 对未知名字会抛错、被逐条 try/catch 吞掉，
于是坏名字**静默失效**。现在 `scripts/test-preset-local-tools.mjs` 与
`scripts/scan-dsh-tool-names.mjs` 会拿 DSH 真实工具名与名单双向求差——**每次升级 DSH 都要跑**。

---

## 5. 两代 preset

| | `qq-chat`（order 10） | `qq-chat-v2`（order 11） |
| --- | --- | --- |
| 用在哪 | 一代 `social` / 普通 `chat` / 黑话学习会话 | 二代 `reserved2`（DSH 里默认） |
| 文本输出 | **就是消息**（桥接直接发） | **只是思考**，发言必须调工具 |
| 分条 | 按空格分句 | 用 `qq_send_message` 的数组 |
| 唤醒 | 桥接按概率/关键词唤醒 | 模型自己 `qq_set_wake_config` 决定下次怎么醒 |
| 工具面 | 同样挂 `qq-tool-restrict` + QQ MCP | 同 |
| 人格 | `agent.cordis.yml` 的 `persona.prefix`（约 9 个 plugin 行 + 人格段） | 同结构 + 二代协议/工具规则 |

**共同点**：两个 preset 都是"一条 `@deepseek-ai/dsh-agent-preset` 行"，人格正文与工具面都写在
`dsh/agent-presets/<name>/agent.cordis.yml` 里，由生成器转成 bundle patch。

**差异要点（改之前先想清楚）**：

- 二代**不自动转发文本**。如果工具没挂上，模型会"说了话但群里没反应"——这是最常见的误配症状。
- 一代的 `[SILENT]` 是潜水信号；二代没有这个约定（用 `mark_read` + `set_wake_config` 潜水）。
- 二代有 `qq_close_conversation`；一代没有（一代靠状态机自行退场）。

---

## 6. 装配流程

```
dsh/agent-presets/<preset>/{preset.yml, agent.cordis.yml}      ← 权威源（人改这里）
        │  scripts/build-agent-preset-patches.mjs（--check 防漂移）
        ▼
plugins/surfcore/presets/<preset>.patch.yml                    ← 生成物（勿手改）
        │  scripts/setup-dsh.mjs（幂等）
        ▼
~/.dsh/profiles/<profile>/package.json       → 注册 bundle: surfcore（link: 依赖）
~/.dsh/profiles/<profile>/cordis.patch.yml   → 挂三个 MCP server + 两条 preset 行
```

- **为什么需要生成器**：DSH 0.1.7 起 preset 不再是目录，而是一行 loader，
  它的 `config.plugins` 必须是内联列表，只能由 bundle patch 插入。于是同一份行列表必然有两种表示
  （源/产物），生成器是唯一转换器。
- **守卫行的引用方式**：必须是**从 profile 目录可解析的裸说明符**（`surfcore/qq-tool-restrict.mjs`），
  不能是 `./qq-tool-restrict.mjs`——子行 name 按 profile 目录解析，相对路径会找不到文件（正是 0.1.7 的坑）。
- **安装是幂等的**：重复跑 `setup-dsh.mjs` 不会重复插入。
- **DSH 升级后**：重新 `npm run test:preset-patches` → `node scripts/setup-dsh.mjs` → 重启 DSH。
  工具名对账：`npm run scan:tool-names`。

---

## 7. 边界与失败模式

| 现象 | 根因 | 处理 |
| --- | --- | --- |
| 模型只会说话，群里没反应 | 二代文本不自动发；工具没挂上/没开 | 检查 MCP 挂载 + `socialV2.tools.sendMessage` |
| 工具调用 403「不在白名单内」 | 目标不在 `allow.*` | 加白名单（这是硬闸，没有管理员例外） |
| 403「该接口仅控制台可用」 | 某端点只允许管理端 | 换工具，不要绕 |
| 401「会话令牌无效」 | 会话被重置/退役，旧 token 失效 | 让桥接重新注入提示词（重新唤醒） |
| 429 | 频率超限 | 减条数/放慢 |
| 工具名拼错 → 静默失效 | `restrict()` 对未知名字抛错被吞 | 跑 `npm run scan:tool-names` |
| DSH 升级后工具集体消失 | MCP 配置被覆盖 / preset 行没重建 | 重跑 `setup-dsh.mjs` |
| `qq_send_voice` 一直 502 | 语音引擎没启动 | 设置页语音页启动对应包 |
| `qq_wait_for_messages` 报「必须先做沉睡前观察」 | 直接 `set_wake_config` 潜水 | 先 wait 300000 |

---

## 8. 还没覆盖的部分（⚠️）

- `src/mcp-snowluma-safe.js` 里每个工具**完整的参数 schema 与逐条校验顺序**没有在本文件展开
  （只给出了能力面与闸门层级）。要改某个工具时，直接读该工具定义附近的代码。
- `mcp-host-server.js` / `mcp-web-search-safe.js` 的传输细节与错误透传没有逐行展开。
- preset 的人格正文（`persona.prefix`，数千字）没有全文抄进本文档——它是产品内容，直接看源文件。

> 相关文档：[ARCHITECTURE.md](ARCHITECTURE.md)（工具面在整体里的位置）、
> [BOUNDARIES.md](BOUNDARIES.md)（失败模式总表）、[DSH_SETUP.md](DSH_SETUP.md)（安装细节）、
> [../PITFALLS.md](../PITFALLS.md)（#71 preset 漂移、守卫名单对账的历史教训）。
