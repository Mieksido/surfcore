# 仓库目录地图（FOLDER_MAP）

> 一句话说明每个顶层目录干什么、`scripts/` 里的命名约定是什么、哪些脚本像是过期的一次性产物。
> 本文**只描述现状**，不构成改动指令。文档索引见 [README.md](README.md)。
>
> 最后核对：2026-10-26（全项目审计；本次同时把 `state/` 里的一次性脚本与截图隔离到
> `_backups/state-residue-20261026/`）。新增目录/脚本时请顺手补一行。

---

## 一、顶层布局

```
<工作区根>/
├── surfcore/                ← 本仓库（QQ ↔ DSH 桥接 + DSH 插件 + B站 + 桌宠接口）
├── pet/                     ← 桌宠工程（独立 Electron 工程，**不在本仓库**；通过
│                               ~/.dsh/surfcore/pet/host.json 发现插件接口）
└── 重启DSH-加载语音工具.cmd  ← 工作区根的运维启动器（重启 DSH 让 MCP 工具重新挂载）
```

`surfcore/` 内部：

| 目录 | 作用 | 能不能删/动 |
| --- | --- | --- |
| `src/` | **桥接内核与共享引擎**：主程序 `bridge.js`、DSH 客户端、三个 MCP server、黑话/表情/语音共享库、鱼群保护（`fish-guard.js`）、记忆卡引擎（`memory-card.js`）、目的机制纯逻辑（`purpose-engine.js`）、对话收尾判断（`conversation-closure.js`）、**每日 token 额度纯逻辑（`token-budget.js`）+ 账本（`token-ledger.js`）**、**状态目录 ACL 收紧（`state-acl.mjs`，与 `scripts/harden-state-acl.mjs` 同一实现）**、**安全抓取（`safe-fetch.js`）**、**上线补历史（`history-catchup.js`）**、**价目表（`model-prices.js`）**、**发送语音内核（`voice-core.js` / `voice-packs.js` / `voice-tts.js`，三者职责不同：解析与探测 / 语音包安装 / 本地 TTS 客户端）** | 不能动。`bridge.js` 是主程序（**约 15,000 行**，仍是全仓库最大单体，控制台 126 条路由写在同一条 if 链里）；`voice-core.js` 与 `snowluma-conn.js` 是**独立工具也在用的单一实现**；`memory-card.js` 同时被桥接/插件/单测引用，改评分权重必须跑 `npm run test:memory-card`；`purpose-engine.js` / `token-budget.js` 是纯逻辑，改它们要跑 `npm run test:audit`。**目录里只应有 `.js`/`.mjs`**：曾经的 `bridge.js.bak-*` 会污染全局搜索并看起来像 module，2026-09-20 已移出（见下） |
| `scripts/` | 调试 / 测试 / 一次性运维脚本（见第二节命名约定） | 测试脚本不能删；`cleanup-*` / `fix-*` / `patch-*` / `diag-*` 多为历史遗留 |
| `dsh/` | 要装进 DSH 的东西：`agent-presets/qq-chat`、`agent-presets/qq-chat-v2`（preset 的**权威源**，含工具白名单 `qq-tool-restrict.mjs` 的 re-export 壳）。DSH 0.1.7 起 preset 以 bundle patch 形式安装，patch 由 `scripts/build-agent-preset-patches.mjs` 从这里的源生成到 `plugins/surfcore/presets/` | 改 preset 会影响所有人设行为；改完必须重新生成 patch |
| `plugins/` | DSH 插件：**`surfcore`（合体插件：QQ 设置 + B站养鱼 + 双向记忆 + 身份对齐 + 鱼群保护 + 目的载体（QQ / 桌宠） + 桌宠对话/语音 + token 额度 + 扩展/平台接口；含 `qq-mode` 命名空间与设置窗口）**；两个 QQ preset 行与 `qq-tool-restrict` 权威实现也在同一个 bundle 的 `presets/` 里。原 `qq-mode-console` 已并入 SurfCore，目录已从本仓库移除。桌宠相关：`lib/pet.js`（安装/启动）、`lib/pet-chat.js`（对话/语音/事件）、`lib/pet-purpose.js`（目的载体）、`lib/pet-api.js`（本地令牌接口），说明见 `plugins/surfcore/docs/PET.md`。另外：`lib/token-budget.js`（用量采集器，纯逻辑在 `src/token-budget.js`）、`lib/http-guard.js`（设置页 API 与桌宠 API **共用**的回环/同源/令牌判据） | 改了要重装/重启 DSH。⚠️ 插件通过 `../../../src/*.js` **相对路径直接引用同仓库核心模块**（12 个），其中 `src/memory-card.js` 带 `?rev=` 缓存破坏后缀——热重载前要 bump，规则见 PITFALLS #68 |
| `public/` | 浏览器静态资源：`console.html`（桥接自带控制台，127.0.0.1:3100） | 目录里只应有这一个文件；历史备份 `console.html.bak` 已移出仓库 |
| `roles/` | 人格卡的**旧布局**（`roles/*.md`；角色人格系统启动时会自动迁移到 `~/.dsh/surfcore/characters/<id>/persona.md`）：设置页「角色」页仍可查看/编辑当前人格卡 | 用户内容，别乱动 |
| `assets/` | 仓库用图片等资源（`deepseek娘.png`；`project-intro.mp4` 已改为 Release 附件、不入库） | 别加体积大的二进制 |
| `state/` | **只放运行时数据**（会话映射、模式、角色、黑话库、日志、锁、令牌）。`.gitignore` 排除。**这里不该出现 `.mjs` / 截图 / 一次性审计日志**——2026-10-26 审计一次清出 50 个（21 个一次性 `.mjs`、5 张 probe 截图、24 个日志），已隔离到 `_backups/state-residue-*/` | **用户数据，绝不删除/移动**（清理走 `_backups/`，带 README 与回滚说明） |
| `docs/` | 全部文档，按用途分子目录（见第三节） | 见第三节 |
| `node_modules/` `.npm-cache/` | 依赖与 npm 缓存 | 忽略 |
| `config.json` | 运行配置（真实配置**不入库**）；模板是 `config.example.json` | 值属于用户，别改 |

---

## 二、`scripts/` 命名约定

脚本共 141 个文件（136 个 `.mjs` + 3 个 JSON 基线 + 1 个 `.ps1`，另有 `fixtures/` 目录）；
其中 `test-*.mjs` **95 个**，被 `scripts/test-audit.mjs` 的 `tests[]` 收录的是**默认门禁**
（2026-10-26 审计后 75 个）。按前缀区分用途：

| 前缀 / 形态 | 含义 | 归宿 |
| --- | --- | --- |
| `test-*.mjs` | **自动化测试**。其中被 `scripts/test-audit.mjs` 列进 `tests[]` 的那些会跑在 `npm run test:audit` 里（离线、不发真 QQ 消息、不用生产凭据） | 保留，改动需同步 test-audit 清单 |
| `test-agent-preset-patches.mjs` | preset **防漂移**契约：`plugins/surfcore/presets/*.patch.yml` 必须与 `dsh/agent-presets/` 逐字一致、守卫行只用裸说明符（`npm run test:preset-patches`） | 保留（**2026-10-26 起进 `test:audit`**；以前它既不在门禁也没 npm script，导致 patch 静默落后于源，见 PITFALLS #71） |
| `test-core-rev-sync.mjs` | 插件 → `src/*.js` 的引用一致性：`?rev=` 三处必须相同、不许裸引用；并把「改了热重载也不生效」的模块清单打出来（PITFALLS #68） | 保留（`npm run test:core-rev-sync`） |
| `test-privacy-scan.mjs` + `privacy-rules-lib.mjs` | 隐私闸的**判据本身**：编译出的正则必须带 `g`（否则每条规则每文件只查第一个命中），以及噪音过滤的边界（PITFALLS #74） | 保留（`npm run test:privacy-scan` / `privacy-scan:strict`） |
| `test-voice-packs-default.mjs` | 语音包默认安装源必须是「仓库上级 / `voice/packages/<id>`」，不许硬编码盘符；8765/8767 与启停脚本名不能漂移 | 保留 |
| `test-dsh-*.mjs` | **需要活的 DSH**（不在 `test:audit` 里）：`test-dsh-auth.mjs`（鉴权链路）、`test-dsh-inbox-projection.mjs`（会话队列投影解析，离线）、`test-dsh-session-retire.mjs`（退役会话的端到端回归）、`test-dsh-v2-wait.mjs`（preset 工具面） | 保留（改 DSH 契约时必须跑） |
| `test-audit-*.mjs` | test-audit 的子模块（`test-audit-bridge` / `-protocol` / `-security` / `-setup` 及其 `-helpers`/`-guards`），被上一个直接运行 | 保留 |
| `test-console-ui.mjs` + `console-ui-*.json` / `console-ui-fixture.mjs` / `fixtures/` | 控制台**离线浏览器回归**与基线（`npm run test:console-ui` / `npm run preview:console`），说明见 [guides/CONSOLE-UI-TESTING.md](guides/CONSOLE-UI-TESTING.md) | 保留（基线只在后端契约真变时才重录） |
| `send-*.mjs` | 面向 SnowLuma/QQ 的**真发送**小工具（`send-voice.mjs` 走桥接；`send-test-group.mjs` 发测试群） | 保留，但注意会真的发消息 |
| `setup-*.mjs` | **安装/初始化**：把 preset、MCP 挂载写进目标设备的 DSH（`setup-dsh.mjs`，幂等） | 保留 |
| `verify-*.mjs` | **一致性校验**：`verify-dsh-020-adaptation.mjs`（DSH 适配；`npm run verify:adaptation`）、`verify-persona-config.mjs`（人格配置） | 保留 |
| `probe-*.mjs` | **探针**：用来问 DSH/SnowLuma「实际支持什么」（RPC 形状、工具清单、事件流、工作区、模型、协议帧、settings 命名空间）。鉴权统一走 `probe-auth.mjs` | 保留，按需重跑 |
| `probe-020-protocol.mjs` / `probe-020-settings.mjs` | 0.2.0 版探针：前者采样 `session/control` baseline、`session/projections`、`session/follow`、`$events`、`session/cancel` 的**原始帧结构**；后者列 settings 命名空间并**幂等写回**验证 `qq-mode` 可写。控制台「改模式不生效」时的第一手诊断 | 保留（`npm run probe:protocol` / `probe:settings`） |
| `scan-dsh-tool-names.mjs` + `dsh-tool-names.mjs` | **工具名对账**：从已安装的 DSH 包里抽真实工具名，与 QQ 守卫的 restrict 名单双向求差（防拼错假名静默失效 / 防新版本新增能力漏隐藏）。抽取实现只有 `dsh-tool-names.mjs` 一份，`test-preset-local-tools.mjs` 与 `scan-dsh-tool-names.mjs` 共用 | 保留（每次升级 DSH 后跑一次） |
| `probe-snowluma-heartbeat.mjs` | 只读探针：连 SnowLuma 的 OneBot WS，等一个 `meta_event/heartbeat`，打印载荷里的 `status.online` / **`status.good`**。桥接的上游健康主信号就是这个字段——它存不存在、拼写对不对只能拿**真实运行时**验证（SDK 不校验 data 载荷，取错字段不会报错）。不发消息、不建会话 | 保留（`npm run probe:heartbeat`） |
| `audit-bridge-harness.mjs` | 虚拟网关 + 沙箱化的桥接行为审计脚手架（被 `test-audit-bridge.mjs` 使用） | 保留 |
| `harden-state-acl.mjs` | 收紧 `state/` 目录权限（Windows 上 `mode 0o600` 是空操作，必须动 ACL）。直接试 → 失败提权重试 → 仍失败则打印可复制命令；**任何路径都以 0 退出，绝不阻断启动**。被 `start.bat` 调用 | 保留（`start.bat` 依赖） |
| `diagnose-acl.mjs` | 只读盘点：列出仓库里所有被**切断 ACL 继承**的路径，分「有意收紧（`state/`、`config.json`）」与「非预期收紧」两类，并对后者打印恢复继承的命令。背景见 [guides/SECURITY_BASELINE.md](guides/SECURITY_BASELINE.md) §2.6：DSH 沙箱的写权限只靠继承下发能力 SID，切断继承 ⇒ 沙箱里写不进去。**必须在无沙箱终端跑**（沙箱禁止以管道 stdio 拉起 icacls） | 保留（`npm run diagnose:acl`） |
| `dsh-modules.mjs` | 小工具：按路径加载 DSH 安装内的模块 | 保留 |
| `check-onebot-status.mjs` | 手工排查：查 OneBot 连通性 | 保留（运维常用） |
| `patch-*.mjs` | **补丁**（含 `postinstall` 的 `patch-snowluma-sdk.mjs`：修 `@snowluma/sdk` 的 ESM 打包 bug） | `patch-snowluma-sdk.mjs` **必须保留**（postinstall 依赖）；其余见第四节 |
| `cleanup-*.mjs` | **清理一次性残留**（probe 会话/工作区、测试会话） | 见第四节 |
| `fix-*.mjs` | **一次性修复**（针对某次运行产生的脏数据） | 见第四节 |

> ⚠️ **「写了测试」不等于「测试会跑」**：只有进 `tests[]`（或挂在 `package.json` 的 npm script 上）
> 的脚本才有门禁。2026-10-26 审计实测：92 个 `test-*.mjs` 里 20 个不在 `test:audit`，其中
> `test-agent-preset-patches.mjs` 既不在门禁、也没有 npm script —— 于是它能抓到的漂移
> （`qq-chat-v2.patch.yml` 缺了整段「对话收尾」）真的漏过去了。新增测试请顺手登记。
| `diag-*.mjs` | **诊断**（如归档并清理日志） | 见第四节 |
| `debug-*.mjs` | **调试**（如白名单逻辑对照） | 见第四节 |
| `CONSOLE-UI-TESTING.md` | 已移到 [guides/CONSOLE-UI-TESTING.md](guides/CONSOLE-UI-TESTING.md) | — |

---

## 三、`docs/` 结构

```
docs/
├── README.md     # 文档索引（每篇一句话 + 是否仍然有效）  ← 先看这个
├── FOLDER_MAP.md # 本文件
├── guides/       # 面向使用者/运维 + 2026-10-26 全仓库梳理（★ = 新写，带文件:行号）
│                 # ★ ARCHITECTURE.md      总纲：进程/分层/数据流/重启矩阵
│                 # ★ MODULE-BRIDGE.md     桥接 15k 行逐段
│                 # ★ MODULE-CORE-A.md     核心引擎（记忆/人格/目的/收尾/额度/计价）
│                 # ★ MODULE-CORE-B.md     核心引擎（B站/内容处理/接入层/语音内核）
│                 # ★ MODULE-PLUGIN.md     插件宿主（服务/调度/扩展/配置模型）
│                 # ★ UI-AND-CONSOLE.md    设置页 10 标签 + 控制台 10 页面
│                 # ★ SUBSYSTEM-BILI.md    B站 子系统
│                 # ★ SUBSYSTEM-VOICE.md   语音子系统
│                 # ★ SUBSYSTEM-PET.md     桌宠子系统
│                 # ★ AGENT-TOOLS-AND-PRESETS.md 工具面与 preset
│                 # ★ DATA-AND-CONFIG.md   配置与状态文件全表
│                 # ★ BOUNDARIES.md        能力边界与失败模式
│                 # 其余：DSH_SETUP / DSH_020_ADAPTATION / SECURITY_BASELINE /
│                 #       TOKEN_USAGE_CONSOLE / CONSOLE-UI-TESTING / PRIVACY /
│                 #       MEMORY_CARD / CHARACTER_PERSONA / PURPOSE_OUTREACH /
│                 #       CONVERSATION_CLOSURE / CROSS_PLATFORM_IDENTITY
├── design/       # 设计与规划：GEN2_SIMULATION_PLAN / SOCIAL_MODE_PLAN / DSH_QQ_TOOLS_PLAN / 真人语感策略
├── research/     # 调研：SnowLuma功能调研 / 免打扰 / 表情包 / 本地模型选型
├── audits/       # 审查与优化报告（最新的全项目体检是 AUDIT_REPORT_2026-09-20）
└── legacy/       # 历史归档（已被取代 / 问题已全部修复的旧报告）
```

> ⚠️ **哪些文档真的会进公开仓库**：`.gitignore` 第 52–64 行把
> `docs/audits/`、`docs/design/`、`docs/legacy/`、`docs/research/` 以及
> `docs/guides/PROJECT_GUIDE.md`、`docs/guides/VOICE.md` **整体排除**了
> （原因写在那里：这批文档里扫出过多份含本机真实路径的内容）。
> 也就是说：**只有 `docs/README.md`、`docs/FOLDER_MAP.md` 与 `docs/guides/` 下的其余几篇会出现在 GitHub 上**，
> 上面那份索引里指向 `audits/` `design/` `legacy/` `research/` 的链接**对公开读者是死链**，只在本机有效。
> 因此：**要公开的新文档请放 `docs/guides/`**（新写的 `DSH_020_ADAPTATION.md` 就放这里）；
> 放进那四个目录 = 只在本机可见，`git add` 会直接被 .gitignore 挡下。

规则：**根目录只留 `README.md` / `README.en.md` / `RULES.md` 三个文档**，其余一律进 `docs/` 对应子目录，
并在 [README.md](README.md) 索引里登记一行（含「仍然有效 / 被谁取代」）。

---

## 四、疑似过期的一次性脚本（未删除，待确认）

> 判断依据：`.gitignore` 已把它们列为「Local one-off dev/debug/patch scripts（machine-specific paths/IDs,
> or bound to artifacts of a single probe run under `state/`）」——也就是说作者当初就认为**它们不该进公开仓库**；
> 加上脚本内容绑定某一次运行留下的 `state/` 残留。**本次整理没有移动或删除任何脚本**，仅列出待人工确认。
>
> 例外（**不是**过期脚本，仍在用）：`scripts/clean-dead-workspaces.mjs` —— 清掉 DSH 里路径已被删、或只剩空壳的工作区；先备份会话再 archive + `workspace/delete`，默认 dry-run，加 `--apply` 才动手。旧 `surface_core` / `QQbot` / `刷B站` 三个工作区就是用它收掉的。

| 脚本 | 像是过期的理由 |
| --- | --- |
| `scripts/cleanup-probe-sessions.mjs` | 清理某次 probe 在 DSH 里建的会话；probe 产物已不在（`state/` 下 `self-test*` 目录仍有余留），脚本本身是一次性的 |
| `scripts/cleanup-probe-workspaces.mjs` | 同上，清理 probe 建的工作区 |
| `scripts/cleanup-test-sessions.mjs` | 同上，清理自测会话 |
| `scripts/fix-probe-workspace-title.mjs` | 修某次 probe 工作区标题的脏数据；一次性 |
| `scripts/diag-archive.mjs` | 诊断 + 归档日志；日志归档已手动完成，属一次性运维 |
| `scripts/debug-whitelist.mjs` | 白名单逻辑对照调试；与 `test-audit-*` 的白名单用例重复 |
| `scripts/patch-qq-chat-v2-presleep.mjs` | 给 `qq-chat-v2` preset **打一次补丁**；目标内容现已直接在 `dsh/agent-presets/qq-chat-v2/agent.cordis.yml` 里，重跑会重复插入 |
| `scripts/patch-qq-chat-v2-stickers.mjs` | 同上（表情包小节） |
| `scripts/patch-qq-chat-v2-collect-memory.mjs` | 同上（收藏 + 记忆小节） |
| `scripts/patch-web-mcp-timeout.mjs` | 给 DSH 的 web MCP 配置打超时补丁；属对**外部 DSH 安装**的一次性改动，重启/升级 DSH 后语义就变了 |
| `scripts/probe-015.mjs` | **v0.2.0 已删除**：针对 DSH **0.1.5** 的探针，结论早已被 verifier 取代，且它走的是 0.1.5 的点号协议路径。同一用途改由 `scripts/probe-020-protocol.mjs`（`npm run probe:protocol`）承担 | 已删除 |
| `scripts/probe-rpc-compat.mjs` / `probe-models.mjs` / `probe-workspace.mjs` / `probe-events.mjs` / `probe-tools.mjs` | 协议/能力探针：问完「DSH 现在长什么样」用处就小了。**v0.2.0 已修好**：它们的鉴权过去各自复制「从 guard 日志抓 launch token」，那条路在 DSH 0.1.7 起就死了（一律 401），现统一走 `probe-auth.mjs` 的离线铸造 Cookie；工作区也改到系统临时目录（`state/` 的 ACL 被收紧，沙箱里写不进去）。挂在 `npm run probe:*` 上，按需重跑 | 保留 |
| `scripts/test-onebot-connection.mjs` / `test-mcp-*.mjs`（`test-mcp-exec` / `-host` / `-safe` / `-web-search`） | **不在** `test-audit.mjs` 的清单里，属手工排查脚本而非回归套件；功能上被 `check-onebot-status.mjs` / `test-audit-security-mcp.mjs` 覆盖 |

处理建议（**没有执行**，等确认）：确认无用后整批移到一个不影响 `npm run test:audit` 的位置
（例如 `scripts/legacy/`），或直接删除——它们都不在 `package.json` 脚本里，也没有被 `test-audit.mjs` 引用，
移动不会影响任何自动化回归。反过来，**下面这些千万别当"过期脚本"清掉**：

- `scripts/patch-snowluma-sdk.mjs`（`postinstall` 依赖，删了 `npm install` 就坏）
- `scripts/test-audit.mjs` 清单里的每一个（完整清单见该文件 `tests[]` 数组）
- `scripts/console-ui-*.json` / `console-ui-fixture.mjs` / `fixtures/`（控制台回归基线）
- `scripts/audit-bridge-harness.mjs`、`scripts/dsh-modules.mjs`（被测试/工具引用）
