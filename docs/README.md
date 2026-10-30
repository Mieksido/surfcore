# 文档索引（docs/README.md）

> 根目录只留 `README.md` / `README.en.md` / `RULES.md` 三个文档，其余全部在本目录下。
> 仓库目录结构与 `scripts/` 命名约定见 **[FOLDER_MAP.md](FOLDER_MAP.md)**。
>
> **状态标记**：✅ 仍然有效（按它做就对） · ⚠️ 部分过时（见备注） · 🗄️ 已被取代（保留作背景）

---

## 工程纪律（每次开工先读，**优先级高于本索引其余部分**）

| 文档 | 一句话说明 | 状态 |
| --- | --- | --- |
| [../AGENTS.md](../AGENTS.md) | 本工作区自动注入的干活纪律：开工动线、十条铁律、环境事实、交付定义 | ✅ DSH 会自动加载 |
| [ROADMAP.md](ROADMAP.md) | **路线守则**（先分析→算收益→不佳就回退→不补屎山→不盲跑探针）+ 项目目标/底线/可接受妥协 + 路线候选 + 人工决策点 + 已放弃路线 | ✅ 改路线先改这里 |
| [PITFALLS.md](PITFALLS.md) | 踩坑档案：现象 / 根因 / 处置 / 怎么验证 / 残余风险（含 2026-10-22 会话日志事故全流程） | ✅ 新坑先记这里 |
| [HANDOFF.md](HANDOFF.md) | 交接快照：现在做到哪、什么没验证、下一步顺序、环境指纹、收工检查单 | ✅ 每次收工更新 |
| [RISK_REGISTER.md](RISK_REGISTER.md) | 风险台账：风险 / 影响 / 现有缓解 / 状态 / 残余风险，按严重度排序 | ✅ 发现新风险就加一行 |
| [RELEASE-QUEUE.md](RELEASE-QUEUE.md) | **发布待办队列**：编辑会话每次「总结这次的改动」追加带时间戳/覆盖提交的批次 + 可直接复制的交接块；发布会话从这里取 | ✅ 2026-10-29 新增 |

---

## guides/ —— 面向使用者 / 运维

| 文档 | 一句话说明 | 状态 |
| --- | --- | --- |
| ~~guides/PROJECT_GUIDE.md~~ | **（已不在工作区）** 旧的「权威项目说明书」（113 KB / 1450+ 行）。2026-10-26 逐行梳理后由 `ARCHITECTURE.md` + `MODULE-*.md` + `SUBSYSTEM-*.md` 这套**带 `文件:行号`** 的新文档取代 | 🗄️ 已被取代；本机文件已不存在（`.gitignore` 排除的那批历史文档之一），链接点不开属预期 |
| [guides/DSH_SETUP.md](guides/DSH_SETUP.md) | DSH 端安装说明：`qq-chat` / `qq-chat-v2` preset 与三个 MCP server 怎么挂到目标设备的 DSH 上 | ✅ |
| [guides/TOKEN_USAGE_CONSOLE.md](guides/TOKEN_USAGE_CONSOLE.md) | 控制台「令牌与花费」看板：数据来源、计价口径（峰谷分时）、API、配置 | ✅ |
| [guides/CONSOLE-UI-TESTING.md](guides/CONSOLE-UI-TESTING.md) | 控制台离线预览（`npm run preview:console`）与离线浏览器回归（`npm run test:console-ui`）怎么用 | ✅ 2026 整理时自 `scripts/` 移入 |
| [guides/SECURITY_BASELINE.md](guides/SECURITY_BASELINE.md) | **安全基线与威胁模型**：威胁主体、已实现的边界（准入/工具面/出站/控制台/落盘/网络）、已知残余风险、发布前回归清单、改动检查单 | ✅ **改动安全相关代码前必读**（2026-09-20 新增） |
| [guides/MEMORY_CARD.md](guides/MEMORY_CARD.md) | **记忆卡设计与使用**：衰减卡 vs 全量卡、重要度评分、「最初」30 天概率与初次相遇指定、清晰度/遗忘、80/90/100% 容量告警、压缩、全量存档/召回、隐私 scope、配置/API/验证 | ✅ 2026-10-22 新增 |
| [guides/CHARACTER_PERSONA.md](guides/CHARACTER_PERSONA.md) | **角色人格系统**：每角色目录包（人格卡 + 记忆卡 + B站行为账本）、切换序列与隔离矩阵、12 槽自动存档/回档、旧数据迁移、API、已知边界 | ✅ 2026-10-23 新增 |
| [guides/CROSS_PLATFORM_IDENTITY.md](guides/CROSS_PLATFORM_IDENTITY.md) | **跨平台自我识别与来源判断**：为什么转发记录会被说成 B站 内容、自我卡（昵称/ID/主页/人格名）、标签与规则双写、隐私打码、以后接贴吧照做的四条策略、验收用例 | ✅ 2026-10-23 新增 |
| [guides/PURPOSE_OUTREACH.md](guides/PURPOSE_OUTREACH.md) | **目的机制（主动找主人）**：从近期 QQ+B站 记忆提炼「目的」→ 定期搭话（分享🧀/索取）；**载体 QQ / 桌宠**（2026-10-25）与互斥/回落、排程与硬闸门、素材/候选/提示词、内部备忘与 pending、状态文件、API、配置、预览/试一次、验证与回滚 | ✅ 2026-10-25 更新 |
| [../plugins/surfcore/docs/PET.md](../plugins/surfcore/docs/PET.md) | **桌宠栏目**：安装/启动、**文本/语音对话**、气泡与「回复」按钮、主动搭话的桌宠载体、`pet-api` 本地令牌接口、数据位置与排障 | ✅ 2026-10-25 更新 |
| [guides/CONVERSATION_CLOSURE.md](guides/CONVERSATION_CLOSURE.md) | **对话收尾判断**：六类信号 → continue/linger/close；`qq_close_conversation` 与 mark_read/潜水的边界；未答提问硬闸、冷却与重开、结束点记录、配置/验证/回滚 | ✅ 2026-10-24 新增 |

### 2026-10-26 全仓库梳理（新，建议按顺序读）

> 这一组是**逐行读代码**重新写出来的：每条结论都带 `文件:行号`，取代此前零散的口头描述。
> 与旧文档冲突时**以这一组为准**。
>
> **规模**：12 篇 / **8,737 行** / 3,150 处 `文件:行号` 引用。**推荐入口**：
> 根目录 [README.md](../README.md)（5 分钟）→ [ARCHITECTURE.md](guides/ARCHITECTURE.md)（总纲）→ 按需分册。
>
> **当天同步修掉的问题**：桌宠安装目录删除面（R34）、B站 三处 ReferenceError（R30，其中直播间监听按"未实现"处理）、
> 控制台语音死页（R32）；发现但未修的见 [RISK_REGISTER.md](RISK_REGISTER.md) 的 R33/R35–R39。

| 文档 | 一句话说明 | 状态 |
| --- | --- | --- |
| [guides/ARCHITECTURE.md](guides/ARCHITECTURE.md) | **总纲**：进程/端口拓扑、五层代码分层、两个世界（QQ/B站）+ 三个共享引擎、6 条关键数据流、两套状态根、三份配置、安全模型、**启动/重启矩阵**、术语表、文档地图 | ✅ 2026-10-26 新增，先读这篇 |
| [guides/MODULE-BRIDGE.md](guides/MODULE-BRIDGE.md) | **桥接内核逐段**（`src/bridge.js` 约 15,000 行）：启动序列、入站/出站全链路、会话与状态、控制台 API 分组、安全闸门、定时器、失败模式 | ✅ 2026-10-26 新增 |
| [guides/MODULE-CORE-A.md](guides/MODULE-CORE-A.md) | **核心引擎 A**：记忆卡、角色人格、目的机制、对话收尾、每日额度、token 账本、价目表、管理员/自我/身份闸、分享范围 | ✅ 2026-10-26 新增 |
| [guides/MODULE-CORE-B.md](guides/MODULE-CORE-B.md) | **核心引擎 B**：B站 API/记忆/动态/卡片、鱼群、表情语义、黑话、md→纯文本、转发展开、补历史、问候、SSRF 防护、联网搜索、DSH 客户端、语音内核、ACL | ✅ 2026-10-26 新增 |
| [guides/MODULE-PLUGIN.md](guides/MODULE-PLUGIN.md) | **插件宿主**：装配顺序、配置模型（脱敏/原子写/备份保留）、设置页 API 动作面、B站 调度器、记忆与对齐、token 采集、扩展/平台接口、桥接自愈 | ✅ 2026-10-26 新增 |
| [guides/UI-AND-CONSOLE.md](guides/UI-AND-CONSOLE.md) | **两套界面**：插件设置页 14 个标签逐页逐卡片（控件↔配置键↔API）、浏览器控制台 10 个页面、分工与重叠 | ✅ 2026-10-26 新增 |
| [guides/SUBSYSTEM-BILI.md](guides/SUBSYSTEM-BILI.md) | **B站 子系统**：账号与凭据、生物钟、内容生产/消费、34 个 CLI 命令与 23 个库、四本账额度、鱼群、脱敏、配置全解 | ✅ 2026-10-26 新增 |
| [guides/SUBSYSTEM-VOICE.md](guides/SUBSYSTEM-VOICE.md) | **语音子系统**：三条链路（语音库/现场合成/语音包）、状态机、本地↔云端路由、合成契约、发送全链路、触发规则、配置全解 | ✅ 2026-10-26 新增 |
| [guides/SUBSYSTEM-PET.md](guides/SUBSYSTEM-PET.md) | **桌宠子系统**：拓扑、发现与鉴权、pet-api 端点、对话链路、事件队列、目的载体与互斥、记忆写入、语音与回音、专注模式、桌宠侧契约 | ✅ 2026-10-26 新增 |
| [guides/AGENT-TOOLS-AND-PRESETS.md](guides/AGENT-TOOLS-AND-PRESETS.md) | **工具面与 preset**：三个 MCP server、39 个 `qq_*` 工具全表与开关、权限与会话绑定、fail-closed 工具守卫、两代 preset、装配流程 | ✅ 2026-10-26 新增 |
| [guides/DATA-AND-CONFIG.md](guides/DATA-AND-CONFIG.md) | **配置与数据**：三份配置逐段全解（含默认值/生效时机）、约 95 个状态文件全表（谁写谁读/能不能删）、角色包结构、备份与迁移 | ✅ 2026-10-26 新增 |
| [guides/BOUNDARIES.md](guides/BOUNDARIES.md) | **能力边界**：环境边界、能力矩阵（能做/有条件/不做）、失败模式 → 恢复动作表、安全承诺与不承诺、资源与数据出机边界 | ✅ 2026-10-26 新增 |
| [guides/12-LESSONS-ARCHITECTURE.md](guides/12-LESSONS-ARCHITECTURE.md) | **12 课总结 + 修 bug 手册**：可直接粘贴的提示词模板、底层机制（进程/连接/文件/时间/身份/状态/契约/配置/消息/AI）、SurfCore 链路与状态所有权表、已知 bug 候选、十问清单与爆炸半径 | ✅ 2026-10-29 新增（当提示词用） |
| [guides/ERROR-REPORTING.md](guides/ERROR-REPORTING.md) | **报错与建议规范（刚性）**：`ok/code/error/hint/tried` 结构、弹窗 vs toast 判据、禁止清单、交付自检；对应 AGENTS 1.7 | ✅ 2026-10-29 新增 |
| [guides/TIMEZONE.md](guides/TIMEZONE.md) | **自定义时区**：为什么需要、怎么设、各进程怎么生效、设计取舍 | ✅ 新增 |
| [guides/PERMISSIONS.md](guides/PERMISSIONS.md) | **权限清单**：身份判定唯一来源、7 项主人特权（判定/代码/审计/测试状态）、关系与称呼不参与授权、变更检查单 | ✅ 2026-10-29 新增 |

## design/ —— 设计与规划（读设计意图用）

> ⚠️ `design/`、`research/`、`audits/`、`legacy/` 四个目录**当前不在工作区**（它们在 `.gitignore` 里，
> 本机文件已在历史清理中移除）。下面这几张表是**历史索引**，链接点不开属预期；
> 需要追溯时用 `git log -- docs/design` 或 `git show <commit>:docs/design/...`。

| 文档 | 一句话说明 | 状态 |
| --- | --- | --- |
| [design/GEN2_SIMULATION_PLAN.md](design/GEN2_SIMULATION_PLAN.md) | 二代仿真（`reserved2`）「一切皆工具」实施计划：WakeConfig 唤醒调度、MCP 工具集、控制台参数、`qq-chat-v2` preset | ⚠️ 骨架/API/调度/MCP/UI 均已落地，文中「状态：实施中」与残留 TODO 以当前代码为准 |
| [design/SOCIAL_MODE_PLAN.md](design/SOCIAL_MODE_PLAN.md) | 一代仿真模式（`reserved`）的头脑风暴定案：规则引擎管「何时说」、LLM 管「说什么」 | ⚠️ 描述的一代状态机已实现；`reserved2` 已是默认模式，设计背景仍有效 |
| [design/DSH_QQ_TOOLS_PLAN.md](design/DSH_QQ_TOOLS_PLAN.md) | 「一切皆工具」总路线与交接文档：当前能力盘点、安全性设计、分阶段计划 | ⚠️ 阶段计划大部分已完成，作为路线/安全设计参考仍有效 |
| [design/真人语感策略.md](design/真人语感策略.md) | 拟人化策略：短句碎片、接梗、错别字、话题漂移、选择性沉默、括号用法 | ⚠️ 文首已自注：部分「现状」写于旧版随机分句时期，最新行为以 PROJECT_GUIDE / 代码为准 |

## research/ —— 调研记录（结论可直接引用，过程可能过时）

| 文档 | 一句话说明 | 状态 |
| --- | --- | --- |
| [research/SnowLuma功能调研.md](research/SnowLuma功能调研.md) | SnowLuma 除「OneBot WS + 基础收发」之外还有哪些 QQ 相关功能与机制（API 面、可扩展点） | ✅ 调研对象 v1.14.9；换 SnowLuma 大版本后需复核 |
| [research/RESEARCH_QQ_MESSAGE_DND.md](research/RESEARCH_QQ_MESSAGE_DND.md) | QQ 群「消息免打扰」到底影响不影响 SnowLuma 收发消息 —— 结论：不影响，只是不提醒 | ✅ |
| [research/RESEARCH_SNOWLUMA_EMOJI_STICKER.md](research/RESEARCH_SNOWLUMA_EMOJI_STICKER.md) | SnowLuma 的表情包/收藏表情能力（`fetch_custom_face*` 等），本仓库收藏表情功能的依据 | ✅ |
| [research/LOCAL_MODEL_SIZING.md](research/LOCAL_MODEL_SIZING.md) | 若要本地复刻：本项目对模型的真实负载、显存门槛、27–35B 起步、双 3090 是性价比拐点 | ✅ 调研日期 2026-09-17 |

## audits/ —— 审查 / 体检 / 优化报告（按时间读，越新越权威）

| 文档 | 一句话说明 | 状态 |
| --- | --- | --- |
| [guides/DSH_020_ADAPTATION.md](guides/DSH_020_ADAPTATION.md) | **DSH 0.2.0 适配改动记录**（v0.1.7 → v0.2.0）：逐条列出为适配 0.2.0-rc.2 做的改动（现象/为什么必须改/证据/怎么验证），并单独列出「复核后判定兼容、因此没改」的部分与「同批但不属于适配」的改动 | ✅ **最新**；升级 DSH 前先读 §10 的操作清单。放在 `guides/` 是因为 `audits/`、`design/`、`legacy/`、`research/` 都在 `.gitignore` 里（见该文件第 52–64 行），放进那几处的文档**不会进公开仓库** |
| [audits/AUDIT_FIXES_2026-09-20.md](audits/AUDIT_FIXES_2026-09-20.md) | **那一轮（第二轮）三路并行审计与修复记录**：桥接内核 / 控制台与打包 / 文档基线；逐条列出已修、已确认无问题、列为规划 | ✅（取代下面那份的结论；`CODE_AUDIT` 中当时未修完的项已在此结清）⚠️ **本文件不在公开仓库里**（`docs/audits/` 被 `.gitignore` 排除），只在本地可见 |
| [audits/CODE_AUDIT_2026-09-20.md](audits/CODE_AUDIT_2026-09-20.md) | 同日较早的代码体检（P0/P1/P2/P3 清单与实现细节、指标统计：monolith 度量、重复代码盘点） | ⚠️ **多数已修**：修复状态以 AUDIT_FIXES 为准；本文的实现细节与度量仍有参考价值（2026-09-20 补登进索引） |
| [audits/AUDIT_REPORT_2026-09-20.md](audits/AUDIT_REPORT_2026-09-20.md) | 全项目体检：四条独立审计线（状态机与重连、安全边界、健壮性与资源、配置/脚本/文档一致性）+ 按影响排序的修复 | ✅ 结论仍有效（取代 2026-09-18 那份） |
| [audits/CONSOLE_FEATURES_REPORT.md](audits/CONSOLE_FEATURES_REPORT.md) | 控制台功能增强：人格管理、两层提示词（仿真层/人格层）、DSH 思考强度 | ✅ |
| [audits/CONSOLE_UI_REDESIGN_REPORT.md](audits/CONSOLE_UI_REDESIGN_REPORT.md) | 控制台改版报告：九页导航 + 全局搜索 + 浅色/深色主题，纯前端改造 | ⚠️ 页数已增至 10（新增「令牌与花费」），其余仍有效 |
| [audits/TOKEN_OPTIMIZATION.md](audits/TOKEN_OPTIMIZATION.md) | `reserved2` 的 token 开销优化与消息水位协议、升级与回退说明（README 直接引用它） | ✅ |
| [audits/TOKEN_COST_ANALYSIS.md](audits/TOKEN_COST_ANALYSIS.md) | token 成本实测档案与优化清单（含本文档形成时的个人用量数据） | ⚠️ 数据是当时的实测快照；结论方向仍被 TOKEN_OPTIMIZATION 引用，具体数字别当现值 |

## legacy/ —— 历史归档（**不要照着做**，留作背景与追溯）

| 文档 | 一句话说明 | 为什么归档 |
| --- | --- | --- |
| [legacy/PROJECT_GUIDE.public-condensed.md](legacy/PROJECT_GUIDE.public-condensed.md) | 面向公开仓库的**精简版**项目说明书（约 375 行、10 节，末行自述「公开版文档，不包含本地开发历史与个人配置」） | 🗄️ **被 `guides/PROJECT_GUIDE.md` 取代**：内容更全的那份一直持续更新到 2026-09-11（新增「近期更新」章节到第 25 节），精简版只覆盖到早期的 10 节；两份同名文档并存正是「界面叫法不同步」的来源（见 CONSOLE_UI_REDESIGN_REPORT 第 6 条）。**未删除**，保留以便需要对外发布脱敏版时取用 |
| [legacy/AUDIT_REPORT_2026-09-18.md](legacy/AUDIT_REPORT_2026-09-18.md) | 2026-09-18 的架构审查与修复报告（基线 `3c54e6b`，P0~P3 清单） | 🗄️ **被 `audits/AUDIT_REPORT_2026-09-20.md` 取代**：后者是对同一代码库的更新一轮体检，并已覆盖前者的待办 |
| [legacy/ARCH_REVIEW.md](legacy/ARCH_REVIEW.md) | 2026-08-18 的架构审查：严重 #1~#6、中等 #7~#15、轻微 #16~#20、新增 #21~#30 | 🗄️ **问题已全部修复**：文首两份「修复状态」清单逐条标 ✅（含复查残留项），属已结案的历史记录 |

---

## 想找什么 → 去哪看

| 我想…… | 看这个 |
| --- | --- |
| 开工前先知道规矩/上次做到哪 | [../AGENTS.md](../AGENTS.md)、[ROADMAP.md](ROADMAP.md)、[HANDOFF.md](HANDOFF.md) |
| 搞懂整体架构 / 全部配置项 | [guides/ARCHITECTURE.md](guides/ARCHITECTURE.md)（总纲）、[guides/DATA-AND-CONFIG.md](guides/DATA-AND-CONFIG.md)（配置与状态文件全表） |
| 在新设备上把 qq-bridge 接进 DSH | [guides/DSH_SETUP.md](guides/DSH_SETUP.md) |
| 看 AI 烧了多少钱 / 计价口径 | [guides/TOKEN_USAGE_CONSOLE.md](guides/TOKEN_USAGE_CONSOLE.md)、[audits/TOKEN_COST_ANALYSIS.md](audits/TOKEN_COST_ANALYSIS.md) |
| 改控制台界面并做离线回归 | [guides/CONSOLE-UI-TESTING.md](guides/CONSOLE-UI-TESTING.md)、[audits/CONSOLE_UI_REDESIGN_REPORT.md](audits/CONSOLE_UI_REDESIGN_REPORT.md) |
| 搞懂角色记得什么 / 怎么遗忘 / 容量告警 | [guides/MEMORY_CARD.md](guides/MEMORY_CARD.md) |
| 让 AI 知道一段对话什么时候该结束（而不是每句都回） | [guides/CONVERSATION_CLOSURE.md](guides/CONVERSATION_CLOSURE.md) |
| 多角色切换 / 存档回档 / 旧数据迁移 | [guides/CHARACTER_PERSONA.md](guides/CHARACTER_PERSONA.md) |
| 改代码前先知道有哪些坑 | [guides/DSH_020_ADAPTATION.md](guides/DSH_020_ADAPTATION.md)（最新，DSH 适配）、[audits/AUDIT_FIXES_2026-09-20.md](audits/AUDIT_FIXES_2026-09-20.md)、[audits/AUDIT_REPORT_2026-09-20.md](audits/AUDIT_REPORT_2026-09-20.md) |
| 动安全相关代码 / 做发布前检查 | [guides/SECURITY_BASELINE.md](guides/SECURITY_BASELINE.md) |
| 知道某个目录/脚本是干什么的 | [FOLDER_MAP.md](FOLDER_MAP.md) |
| 权限边界与安全承诺 | [../RULES.md](../RULES.md) |
| 这个项目要往哪走（QSH） | 上位目录的 `../../QSH-plan/`（总索引 `README.md`；另有工具面/技能/云部署/新仓库与官网四份专项） |
