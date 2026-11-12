# 两套界面（插件设置页 + 浏览器控制台）

> 本文精读两个前端实现的源码，按「代码里真的有什么」写，不按文档/README 声称的写。
> 覆盖对象与读法约定：
>
> - **插件设置页**：[`plugins/surfcore/lib/client.js`](../../plugins/surfcore/lib/client.js)（4349 行，单文件 React/`createElement` 风格）——DSH「设置 → SurfCore」那个窗口。
> - **浏览器控制台**：[`public/console.html`](../../public/console.html)（5416 行 / 约 259 KB，内联 CSS + 内联 `<script>`，无构建）——桥接进程自己起的 `http://127.0.0.1:3100` 页面（默认端口见 `client.js:717`）。
> - **本地化文件**：[`plugins/surfcore/locale/zh.json`](../../plugins/surfcore/locale/zh.json)、[`plugins/surfcore/locale/en.json`](../../plugins/surfcore/locale/en.json)（各 6 行）。
>
> 引用格式统一为 `文件名:行号`（`client.js:1204` / `console.html:2760` / `bridge.js:4749`）。
> 少量行号来自后端 `src/bridge.js`，只在「鉴权 / 归属」这类必须看服务端才能定的结论上使用，并会标 `（桥接侧）`。
> 为遵守脱敏要求，代码里出现的 QQ 号/群号/B站 mid 示例、本机绝对路径示例一律不复制，只标「示例值（已略）」。
> **最后核对**：2026-10-26（全仓库逐行梳理）。配套阅读：总纲 [ARCHITECTURE.md](ARCHITECTURE.md) · 边界 [BOUNDARIES.md](BOUNDARIES.md) · 索引 [../README.md](../README.md)。

---

## 一、插件设置页

### 0. 外壳与数据流（先立总图）

页面本体是 `QQBIliWhaleSection`（`client.js:4079`）。它不是一个「表单页」，而是**一个带草稿的配置编辑器 + 若干运行时操作台**拼在一个壳里：

- 壳：`qbw-app` → `qbw-head`（标题 + 版本徽标 + 三颗状态点）→ `qbw-tabs`（14 个按钮）→ `qbw-body`（`max-height:min(68vh,760px)` 内部滚动，`client.js:45`）→ `qbw-foot`（保存条，`position:sticky`，`client.js:73`）。
- 数据流：`本组件 ⇄ /dsh-surfcore/api/*（同源 fetch）⇄ 三份原生配置`（`client.js:7-9`、`client.js:28`）。
- 三份配置分别对应三个草稿 state：`qq`（`<surfcore>/config.json`）、`bili`（`~/.dsh/surfcore/bili.config.json`）、`unified`（跨域合体配置）；读取入口统一在 `loadConfig()`（`client.js:4124-4133`），一次 `GET /config` 把三份都拿回来。
- 挂载位置：`ctx.slots.register({name:"settings.section", id:"surfcore", order:7, label:() => "SurfCore"})`（`client.js:4325-4337`）。
- 样式：`CSS` 常量一次性注入 `<style id="surfcore/console.css">`（`client.js:31-168`、`client.js:217-227`）。

### 1. 标签页总览

`TABS` 是**唯一**的标签定义（`client.js:4061-4076`），共 14 项。要点先说清：

1. **代码里没有 icon 字段**。`TABS` 每项只有 `[id, 标题]` 两个元素，渲染时只输出文字（`client.js:4281-4283`），没有图标、没有 `disabled`、没有权限位。
2. **代码里也没有「是否高级」标记**。判断一个标签页「高级不高级」只能看它是否把主体塞进了 `AdvancedSettings` 抽屉（`client.js:380-382`，本质是默认折叠的 `Section`）。
3. 「高级设置」抽屉是**每个标签页各一个**，不是全局一个；抽屉内部再用 `collapsible={false}` 的 `Section` 分组，避免「折叠套折叠」（注释见 `client.js:378-379`）。

| # | id | 标题 | 图标 | 「高级设置」抽屉（折叠） | 抽屉内容概览 |
| --- | --- | --- | --- | --- | --- |
| 1 | `overview` | 概览 | 无 | 有（`client.js:1204`） | SnowLuma 安装、扩展与平台 |
| 2 | `characters` | 角色 | 无 | 有（`client.js:3655`） | 存档槽 / 回档 |
| 3 | `purpose` | 目的 | 无 | **无**（页面主体用 5 个 `<details>` 折叠，`client.js:1420` 起） | — |
| 4 | `qq` | QQ | 无 | 有（`client.js:1761`） | 鱼群触发卡、对话收尾卡、搜索、早安问候、19+ 组参数 |
| 5 | `voice` | 语音 | 无 | **无** | — |
| 6 | `pet` | 桌宠 | 无 | **无** | — |
| 7 | `bili` | B站 | 无 | 有（`client.js:2461`） | 鱼群状态、自动化快照、依赖体检、凭据、待审核、口味权重、12 组参数 |
| 8 | `tokens` | Token 额度 | 无 | **无**（页面自带「保存额度」按钮，`client.js:3943`） | — |
| 9 | `watch` | 观看历史 | 无 | **无** | — |
| 10 | `memory` | 记忆 | 无 | 有（`client.js:3186`） | 记忆卡规则/最近记忆/全量卡/同步范围/审计 |
| 11 | `align` | 对齐 | 无 | 有（`client.js:3332`） | 候选对齐 |
| 12 | `extensions` | 扩展 | 无 | 有（`client.js:3395`） | 平台接入、扩展目录说明 |
| 13 | `advanced` | 全部参数 | 无 | **无**（本身即高级，`client.js:3419-3458`） | — |
| 14 | `diag` | 诊断 | 无 | 有（`client.js:3541`） | 备份 / 恢复 / 插件与桥接日志 |

标签与组件的绑定是一次 `if` 链，不是查表（`client.js:4253-4269`），新增标签要同时改 `TABS` 和 `renderTab()`。

### 2. 每个标签页的卡片与控件

下面逐页写，顺序与 TABS 基本一致（只把 B站 提到语音/桌宠之前，方便和 QQ 页对照）。控件类型指的是 `Field` 支持的 kind：`switch / number / select / list / times / textarea / json / password / text`（`client.js:288-327`）；`list` 与 `times` 都走 `ListInput`（逗号分隔、本地保留原始文本、失焦规范化，`client.js:252-286`），`json` 走 `JsonCell`（解析失败只在控件下方显示红字，不阻断保存，`client.js:347-362`）。

#### 2.1 概览 `overview`（`OverviewTab`，`client.js:1112-1225`）

| 卡片 | 内容 | 控件/只读 | 数据源与动作 |
| --- | --- | --- | --- |
| 顶部 info 条 | 「一个窗口管两边：QQ 仍由原桥接进程收发，B站仍用同一份 bili.config.json」 | 只读文本 | `client.js:1143-1145` |
| **QQ 桥接** | 状态点、端口、PID、模式、群白名单数量、私聊白名单数量 | 只读 kv（键值行） | `overview.bridge.*`、`overview.mode.*`（`client.js:1148-1153`） |
| 同上 | 启动 / 重启 / 停止 三个按钮 | 写操作 | `POST /bridge {action:"start"\|"restart"\|"stop"}`（`client.js:1134-1141`、`client.js:1154-1157`） |
| **B站** | 状态点、记忆同步开关态、简报字数、生成时间、隐私复检 | 只读 | `overview.bili.*`（`client.js:1159-1163`） |
| 同上 | 「刷新 B站记忆」 | 写操作 | `POST /memory {action:"refresh-bili"}`（`client.js:1165-1168`） |
| **合体层** | 生物钟是否在跑、身份对齐条数/候选数、两条记忆同步开关、隐私策略版本 | 只读 | `overview.scheduler/alignment/memory/privacyPolicyVersion`（`client.js:1170-1174`） |
| 同上 | 「刷新 B站记忆」 | 写操作 | 走 `act("refresh-bili")` → `POST /bridge`（`client.js:1176`）——与上一张卡的同一个功能用了**两个不同端点**，见 §三 |
| **启动** | QQ/B站各自「启动开关开/关 · 是否运行」；一键启动（含 SnowLuma）、启动QQ、启动B站；去 QQ 页、去 B站 页 | 按钮 | `POST /bridge {action:"start-all"\|"start-qq"\|"start-bili"}`（`client.js:1189-1195`） |
| 同上 | 「一键启动成功后弹窗提示」 | switch | 读 `unified.bridge.startupNotify`，写同一键（`client.js:1196-1202`），随底部「保存」落盘 |
| 高级设置 → **SnowLuma 安装** | 当前安装目录、打开官方下载页、检测已安装的 SnowLuma、只打开 SnowLuma | 只读 + 按钮 | `snow.launcherPath`；`window.open(snow.downloadUrl \|\| 官方 releases)`（`client.js:1205-1213`）；检测走 `POST /bridge {action:"detect-snowluma"}`（`client.js:1122-1133`） |
| 高级设置 → **扩展与平台** | 已启用扩展 `n/m`、平台列表（含「预留」标注）、「贴吧已预留接口」 | 只读 | `overview.extensions`、`overview.platforms`（`client.js:1214-1218`） |
| 底部动作条 | 刷新状态、立即备份配置 | 按钮 | `reload`；`POST /diagnostics {action:"backup"}`（`client.js:1219-1224`） |
| **更新**（2026-10-26 新） | 状态点（可更新/最新）、上次检查时间、各组件一行状态；「检查更新」「查看详情」 | 按钮 + 弹窗 | `overview.updates`（插件启动后 20s 自动检查一次、之后每 6h）；`POST /updates {action:"check"\|"apply"\|"dismiss"}`。有更新且本次未 dismiss 时，**打开概览页会自动弹窗**（`UpdatesModal`）；弹窗里可逐组件勾选、勾「不再提示本次更新」后关闭即 dismiss（按远端 commit 记） |

注意：概览页**不轮询**，只在首次挂载（`client.js:4134`）和手动「刷新状态」时更新；所以页面开着不动，端口/PID 会一直是旧值。

#### 2.2 角色 `characters`（`CharactersTab` + `PersonaEditor`，`client.js:3550-3667` / `client.js:2515-2561`）

| 卡片 | 字段 | 控件 | 配置键 / API | 只读 | 折叠 |
| --- | --- | --- | --- | --- | --- |
| **角色人格**（`qbw-admin` 大卡） | 当前角色名 + epoch、记忆卡百分比 + 存档数、立即存档、更新自动存档、管理记忆卡、新建角色 | 只读 kv + 按钮 | `GET/POST /characters`（`action: snapshot/auto-snapshot`，`client.js:3566-3577`） | 只读展示 | 否 |
| **人格卡**（`PersonaEditor`） | 人格卡文件路径 | text | `unified.persona.file`（`client.js:2541-2549`） | 否 | 否 |
| 同上 | 人格卡正文（大 textarea，`qbw-textarea card` 360px 高） | textarea | 读 `GET /persona`，写 `POST /persona {text}`（`client.js:2520-2531`） | 否 | 否 |
| 同上 | 保存人格卡、重新读取 | 按钮 | 同上 | — | 否 |
| 同上 | 人格卡历史备份（文件名/体积/时间 + 恢复） | 按钮 | `POST /persona {action:"restore", name}`（`client.js:2532-2536`、`client.js:2557-2560`） | 否 | 是（`Section` 默认折叠） |
| **新建角色** | 角色名、人格卡 Markdown（文件选择或粘贴）、记忆卡 JSON、全量记忆 JSONL、创建并加载 / 只创建 | input/file/textarea/按钮 | `POST /characters {action:"create", name, personaText, memoryCard, fullRecords, load?}`（`client.js:3605-3641`） | 否 | 是（点「新建角色」展开） |
| **全部角色** | 每个角色：名字、是否当前、存档数、人格字数、全量记忆体积、更新时间；加载 / 删除 | 按钮 | `action:"load"` / `action:"delete"`（删除是归档到 `backups/deleted-character-*`，不是硬删，`client.js:3651-3654`） | 否 | 否（`defaultOpen`） |
| 高级 → **存档** | 槽位名、时间、原因、记忆体积；回档 | 按钮 | `action:"restore" {id, slot}`（`client.js:3655-3666`） | 否 | 是 |

#### 2.3 目的 `purpose`（`PurposeTab`，`client.js:1618-1629`；子卡见 1489/1279/1569）

| 卡片 | 字段 | 控件 | 配置键 / API | 只读 |
| --- | --- | --- | --- | --- |
| **触发载体**（`PurposeCarrierCard`，`client.js:1489-1566`） | 两张可点选卡：QQ 私聊（默认）/ 桌宠气泡·语音；每张卡下方显示该载体实况 | 自绘卡（`role="button"`） | 写 `purpose.carrier`（`client.js:1499-1502`） | 否 |
| 同上 | 桌宠主动搭话形式：文本 / 语音（分段按钮） | 自绘 seg | 写 `purpose.petModality`（`client.js:1551-1556`） | 否 |
| 同上 | 桌宠没开着时回落到 QQ | switch | 写 `purpose.petFallbackToQQ`（`client.js:1558-1564`） | 否 |
| 同上 | 载体现状（桌宠未安装/未运行/在线、桥接是否在跑） | 只读 | `GET /purpose/status`（`client.js:1493-1496`） | 只读 |
| **主动找主人 · 目的机制**（`PurposeCard`，`client.js:1279-1484`） | 开/关徽标、载体徽标、专注中徽标、今日 n/上限、上次结果、下次时间、上次目的、最近没出发原因、pending | 只读 + 「刷新状态」 | `GET /purpose/status`（`client.js:1288-1295`） | 只读 |
| 同上 `<details open>` **它是怎么想的 · 当前链路** | 素材/观察/目标假设/候选/今天 五个步进块；当前驱力前 5；目标假设前 3；最近情绪 | 只读 | `status.state.*`（`client.js:1368-1394`、`client.js:1420-1434`） | 只读 |
| 同上 节奏预设 | 保守 / 默认 / 活跃 —— 只改 `gapMinMs,gapMaxMs,dailyMax,quietStart,quietEnd,initialDelayMinMs` 六键，**不自动保存** | 按钮 | `client.js:1332-1342` | 否 |
| 同上 `<details open>` **节奏与安静** | 启用目的机制（switch）、两次之间至少/最多（分钟→ms）、启动后先等、每天最多几次、安静时段（两个 HH:MM 输入框）、你空闲多久才打扰 | switch / number / 两个 text | `purpose.enabled / gapMinMs / gapMaxMs / initialDelayMinMs / dailyMax / quietStart / quietEnd / idleThresholdMs`（`client.js:1442-1455`） | 否 |
| 同上 `<details>` **素材与目标** | QQ 记忆窗口（小时）、B站 记忆窗口（天）、最多素材、最少素材、提示词最多几个方向 | number | `purpose.materialWindowHours / biliWindowDays / maxMaterials / minMaterials / maxCandidates`（`client.js:1457-1463`） | 否 |
| 同上 `<details>` **重试 / 上限 / 目标** | 失败重试间隔（分钟）、最多重试、提示词硬上限、找哪个 QQ（留空=ownerQQ） | number / text | `purpose.retryMs / maxAttempts / promptMaxChars / ownerUin`（`client.js:1465-1470`） | 否 |
| 同上 动作 | 预览这一轮（不发）、立即试一次（真发，二次确认文案随载体变化） | 按钮 | `POST /purpose/preview {}`、`POST /purpose/run {force:true}`（`client.js:1297-1330`、`client.js:1472-1474`） | 否 |
| 同上 预览结果 | `<details>` 里只读 textarea 显示整段提示词 | textarea readOnly | `preview.prompt`（`client.js:1476-1478`） | 只读 |
| **桌宠对话**（`PetChatTestCard`，`client.js:1569-1616`） | 在线徽标、角色/模型/语音路由/历史条数；一句话输入 + 文本/语音选择 + 发一句试试 | input/select/按钮 | `GET /pet/status`、`POST /pet/chat-test {text, modality}`（`client.js:1576-1589`） | 否 |
| 底部 | 「桌宠的安装/启动在桌宠页」+「去「桌宠」页」 | 按钮 | `goTab("pet")`（`client.js:1626-1628`） | — |

#### 2.4 QQ `qq`（`QQTab`，`client.js:1689-1822`）

自上而下 7 块，前三块是 2.4.1–2.4.3 的三个**共用大卡**（组件在文件前半部分，QQ/B站 两页都挂）。

**① 平台启动卡**（`PlatformStartCard`，`client.js:643-664`；挂载 `client.js:1733-1740`）

| 字段 | 控件 | 配置键 | 说明 |
| --- | --- | --- | --- |
| 是否启动 | switch | 读 `overview.platformStart.qq`，写 `unified.platforms.start.qq`（`client.js:1736-1737`） | 未保存时提示「保存后会启动并纳入一键启动 / 停掉正在运行的一边」（`client.js:658-663`） |
| 当前状态 | 只读 | `running` prop | 「运行中 / 未运行；可点单平台启动或一键启动」 |

**② 管理员卡**（`AdminCard`，`client.js:396-463`；挂载 `client.js:1741`）

| 字段 | 控件 | 配置键 | 只读 | 备注 |
| --- | --- | --- | --- | --- |
| 管理员 QQ | input（`inputMode="numeric"`，onChange 里剔除非数字） | `unified.admin.qq`（`client.js:416-423`） | 否 | 宿主保存时投影到 `qq.ownerQQ`（注释 `client.js:392-395`） |
| 管理员 B站 UID | input（同上剔非数字） | `unified.admin.biliMid`（`client.js:424-431`） | 否 | 投影到 `bili.owner.mid` |
| 怎么称呼 TA | text | `unified.admin.displayName`（`client.js:432-439`） | 否 | 留空用 B站 昵称 |
| B站 昵称 | text | `unified.admin.biliName`（`client.js:440-447`） | 否 | — |
| 对管理员更温柔、绝不回嘴 | switch | `unified.admin.gentle`（默认 `!== false`，`client.js:448-456`） | 否 | — |
| 徽标 | 只读 | `aligned/configured` 推导 | 只读 | 「同一个人 ✓ / 只填了一边 / 未设置」（`client.js:403-404`） |
| 两条告警 | 只读 | 管理员 QQ 不在 `allow.private`、或只填了一边（`client.js:457-462`） | 只读 | 告警不阻断保存 |

**③ 白名单卡**（`WhitelistCard`，`client.js:515-565`；挂载 `client.js:1742-1748`）

| 字段 | 控件 | 配置键 | 备注 |
| --- | --- | --- | --- |
| 群白名单 | `IdListEditor`（逗号/空格分隔，chips 可单个删，非 4–15 位数字的 chip 标红，`client.js:475-513`） | `qq.allow.groups`（`client.js:532-537`） | 空时提示「机器人不会在任何群响应」 |
| 私聊白名单 | 同上，管理员 chip 前加「管理员」并高亮 | `qq.allow.private`（`client.js:539-547`） | — |
| 白名单为空时全部放行（不推荐） | switch | `qq.allowAllWhenEmpty`（`client.js:1747`） | 打开时出现红框警告（`client.js:554-556`） |
| 管理员不在私聊白名单 | 一键「把管理员加进去」 | 写 `allow.private`（`client.js:548-553`） | 条件渲染 |
| 脚注 | 只读 | — | 「黑名单优先于白名单，在下面的卡里设」 |

**④ 黑名单卡**（`BlacklistCard`，`client.js:575-636`；挂载 `client.js:1749-1753`）

| 字段 | 配置键 | 控件 | 说明 |
| --- | --- | --- | --- |
| 拉黑的人 | `qq.deny.users` | `IdListEditor` | 任何群/私聊都不响应（`client.js:595-602`） |
| 拉黑的群 | `qq.deny.groups` | `IdListEditor` | 即使在该群白名单里也不响应（`client.js:603-611`） |
| 仅拦私聊 | `qq.deny.private` | `IdListEditor` | 群里照常回（`client.js:612-620`）；若有人只填在这里，出现警告 + 一键移到 `deny.users`（`client.js:621-626`） |
| 管理员在黑名单里 | — | 红框 + 「把管理员移出黑名单」（`client.js:627-632`） | 条件渲染 |
| 脚注 | — | — | 「只拦入站；不会删已记进记忆卡的内容」（`client.js:633-635`） |

**⑤ 目的机制指路卡**（`client.js:1754-1760`）：「已独立成「目的」栏目」+「去「目的」页设置」。这是刻意的去重（注释 `client.js:1754`）。

**⑥ 高级设置抽屉**（`client.js:1761-1816`）

| 块 | 字段 | 控件 | 配置键 / API |
| --- | --- | --- | --- |
| QQ 鱼群保护 · 最近触发（`QqFishGuardStatusCard`，`client.js:1230-1274`） | 保护中的群数徽标、最近 30 次触发、今天次数；每条：群名、保护中/已结束、原因（不同鱼/连续/单鱼连发/占比/冷却续期）、剩余分钟、`n 条鱼 / n 条鱼消息`；底部规则摘要 | 只读 + 刷新 | `GET /fish-guard/qq`（`client.js:1234`）；数据落盘在 `social-v2.json`（`client.js:1229`） |
| 对话收尾判断（`ClosureCard`，`client.js:1634-1686`） | 开/关徽标、最近一次（key/时间/原因/收在/下次可以接/当前判断/软冷却/依据）、6 个开关与数值 | switch/number | `socialV2.closure.*`（`enabled, cooldownMs, requireNoOpenQuestion, promptInWake, maxSummaryChars, maxNextOpeningChars`，`client.js:1667-1681`）；状态读 `overview.bridge.closure`（`client.js:1638`） |
| 参数搜索 | 输入即过滤 `QQ_FIELDS` 各组字段（按 `组名 标签 提示 路径` 子串，`client.js:1720-1722`） | input | 纯前端 |
| 「查看模式」 | 只读弹 toast | 按钮 | `GET /mode`（`client.js:1766`） |
| 写入说明 | 「QQ 参数写入 `<surfcore>/config.json`；保存后需重启桥接；B站 下一轮生效」 | 只读 | `client.js:1767-1769` |
| 定时分享视频到群（指路） | 只解释 + 「去 B站 页设置」 | 按钮 | `client.js:1771-1775` |
| QQ 早安问候 | 启用、问候时间、要问候的 QQ、怎么称呼 TA；「立即试发」 | switch/text/text/text/按钮 | `greetings.enabled / morning.time / morning.uin / morning.name`（`client.js:1783-1802`）；试发 `POST /bridge {action:"greeting-test"}`（`client.js:1724-1730`） |
| 19+ 组参数（`FieldGroups`，`client.js:1806-1816`） | 见下表 | 混合 | `QQ_FIELDS`（`client.js:691-912`）+ 动态追加 3 组（`client.js:1693-1719`） |
| 组内附加：运行模式 | select：chat / reserved / reserved2 / closed-agent / simulation（=reserved2） | select | `POST /mode {mode}`，即时保存、不走底部保存（`client.js:1811-1815`） |

`QQ_FIELDS` 的分组与键（`client.js:691-912`，全部写在 `<surfcore>/config.json`；带 `readOnly` 的两项在 `client.js:942-943` 定义、在 `client.js:1810` 强制只读）：

| 组 | 键（`F(path,label,hint,kind)` 的 path） |
| --- | --- |
| 连接与身份 | `dsh.baseUrl`、`dsh.provider`、`dsh.model`、`dsh.reasoningEffort`、`dsh.authToken`(password)、`dsh.allowRemote`(switch)、`agentPreset`、`workspaceTitle`、`sessionCwd` |
| SnowLuma | `snowluma.wsUrl`、`httpUrl`、`accessToken`(password)、`followDiscoveredEndpoint`(switch)、`silenceWarnMs`、`allowLaunch`(switch)、`launcherPath`、`launchScript`、`homeDir` |
| 控制台 | `consolePort`、`consoleToken`(password)、`ackMessage`、`sendDelayMs`、`questionTimeoutMs` |
| 安全通知 | `security.interceptNotify`(switch) |
| 人格与注入 | `role.maxInjectChars` |
| 一代仿真（reserved，24 项） | `social.enabled`、`maxReplyChars`、`mustReplyKeywords`(list)、`contextWindow`、`triggerProbability`、`activeCheckMinMs\|MaxMs`、`idleWindowMs`、`idleRetryProbability`、`proactiveEnabled`、`proactiveIdleThresholdMs`、`proactiveCheckMinMs\|MaxMs`、`proactiveProbability`、`activeReplyDelayMinMs\|MaxMs`、`activeDurationEnabled`、`activeDurationMinMs\|MaxMs`、`skipProbability`、`surrenderProbability`、`idleRetryWaitMs`、`burstEnabled`、`burstIntervalMinMs\|MaxMs`、`longGapProbability`、`longGapMinMs\|MaxMs` |
| 二代仿真（reserved2，5 项） | `socialV2.enabled`、`autoReplyCheckMs`、`agentPreset`、`provideRecommendations`、`initialPromptMaxChars` |
| 鱼群判定关键词（QQ） | `fishGuard.namePrefixes/nameContains/nameSuffixes/groupNameSuffixes/fishIds/exemptNames/exemptIds`（全 list） |
| 鱼群保护（QQ，15 项） | `fishGuard.enabled`、`windowMs`、`cooldownMs`、`maxFish`、`maxConsecutiveFish`、`singleFishMaxConsecutive`、`maxFishMessages`、`maxFishRatio`、`minSample`、`minFishSendersForRatio`、`groupNestMaxFish`、`groupNestIds`、`bypassDirectAddress`、`blockSends` |
| Token 防爆破（6 项） | `socialV2.tokenGuard.enabled`、`maxWakesPerDay`、`privateMaxWakesPerDay`、`minWakeGapMs`、`directBypassGap`、`maxOutboundPerTurn` |
| 二代 · 唤醒与潜水（19 项） | `socialV2.wake.defaultMode`(select diving/active)、`preSleepWaitEnabled`、`preSleepWaitMs`、`recommendedDefaultInfinite`、`sleepMinMs`、`sleepMaxMs`、`recommendedSleepMinMs`、`recommendedSleepMaxMs`、`recommendedProbability`、`recommendedKeywords`(list)、`recommendedAtMention`、`recommendedNameMention`、`recommendedQuestion`、`recommendedPoke`、`batchWindowMs`、`maxWakePerMinute`、`maxWakePerHour`、`noActionLimit`、`maxWakeConfigReminders`、`recommendedHint`(textarea) |
| 二代 · 对话收尾判断（6 项） | `socialV2.closure.enabled`、`cooldownMs`、`requireNoOpenQuestion`、`promptInWake`、`maxSummaryChars`、`maxNextOpeningChars` |
| 二代 · 上线补历史（5 项） | `socialV2.history.enabled`、`limit`、`maxAgeMinutes`、`wake`、`includePrivate` |
| 二代 · 发送与节奏（14 项） | `socialV2.send.burstEnabled`、`burstMaxMessages`、`burstIntervalMinMs\|MaxMs`、`longGapProbability`、`longGapMinMs\|MaxMs`、`maxSendPerMinute`、`maxSendPerHour`、`maxMessageChars`、`maxGapMs`、`gapBaseMs`、`gapPerCharMs`、`recommendedHint`(textarea) |
| 二代 · 等待与上下文（12 项） | `socialV2.wait.defaultMs/minMs/maxMs/defaultQuietMs/minQuietAfterNewMs`、`context.recentLimit/unreadLimit/contextWindow/inlineWakeMessages/wakeMessageLimit/wakeRecentLimit/wakeMaxChars` |
| 二代 · 主动与反馈（10 项） | `socialV2.proactive.enabled/checkIntervalMinMs/checkIntervalMaxMs/idleThresholdMs/probability`、`feedback.maxLength/notifyOwnerOnError`、`media.maxBytes/maxPixels/maxCount` |
| 群聊（chat 模式，11 项） | `chat.contextMessages`、`chat.groupContextMessages`(json)、`chat.addressFilter.enabled/silenceWhenAddressedToOther`、`chat.presence.enabled/onlineShare/offlineMinMs/wakeWindowMs`、`chat.proactive.enabled/minIntervalMs/minMessages` |
| 黑话学习（8 项） | `slang.enabled`、`extractMinMessages`、`extractCooldownMs`、`inferenceThresholds`(list)、`injectMax`、`learnerPreset`、`workspaceTitle`、`autoResearch` |
| 联网搜索（9 项） | `webSearch.provider`(select auto/deepseek/bing)、`apiKeyEnv`、`apiKey`(password)、`baseURL`、`model`、`maxUses`、`maxTokens`、`maxResults`、`timeoutMs` |
| 二代 · 工具开关（动态） | 由 `cfg.socialV2.tools` 的现有键生成，标签取 `TOOL_LABELS`（27 个中文名映射，`client.js:914-922`），写 `socialV2.tools.<key>`（`client.js:1693-1695`） |
| 表情包（9 项） | `socialV2.sticker.enabled/syncTtlMs/maxListCount/includeInPrompt/promptMaxStickers/collect.enabled/collect.maxPerMinute/collect.maxPerHour/collect.maxRemarkChars`（`client.js:1696-1706`） |
| 语音（11 项） | `socialV2.voice.enabled/dir/maxSeconds/maxBytes/maxPerMinute/maxPerHour/allowAbsolutePath/defaultVolume/loudness/ffmpegPath/autoReadback`（`client.js:1707-1719`） |

**⑦ 底部动作条**（`client.js:1817-1821`）：只有「重启 QQ 桥接」→ `POST /bridge {action:"restart"}`；`platforms.start.qq === false` 时禁用并给 title 提示。

#### 2.5 B站 `bili`（`BiliTab`，`client.js:2383-2510`）

| 块 | 字段 | 控件 | 配置键 / API | 折叠 |
| --- | --- | --- | --- | --- |
| 平台启动卡 | 是否启动 B站 生物钟 | switch | 读 `overview.platformStart.bili`，写 `unified.platforms.start.bili`（`client.js:2442-2449`） | 否 |
| 管理员卡 | 同 §2.4② | — | 同一份 `unified.admin`（`client.js:2450`） | 否 |
| **B站 账号** | 登录态、隐私复检、扫码登录小肥鱼 | 只读 + 按钮 | `overview.bili.available/briefChars/blocked`；按钮开 `BiliQrModal target="fish"`（`client.js:2451-2457`、`client.js:2501-2509`） | 否 |
| **定时分享视频到群**（`QqShareSection`，`client.js:1857-1900`） | 开关、分享时间点（HH:MM 列表）、只发这些群、卡片到短评间隔、分享形式（text/miniapp/off）、B站 桥接开关、动态同步开关、动态轮询间隔、动态只发这些群 | switch/times/list/number/select | `biliBridge.*` 9 键（`QQ_BILI_SHARE_FIELDS`，`client.js:925-937`）；写入 QQ 侧 `config.json` | ✅ 默认展开（`client.js:1884`） |
| 同上 | 状态行（开关/今天最后一班/下一班/群数/形式）+「立即分享一次」 | 只读 + 按钮 | 先 `GET /bridge` 检查 `snowluma.connected`，再 `POST /bili/share-now {action:"share-now"}`（`client.js:1867-1874`） | 同上 |
| **作息窗口** | 每个窗口：开始 `HH:MM`、结束 `HH:MM`、醒来次数（1–12）；`+ 添加窗口`；删除（只剩 1 个时禁用） | 每行 3 个 input + 按钮 | `night.windows[]`（`WindowsEditor`，`client.js:1056-1076`、挂载 `client.js:2459-2460`） | ✅ 默认展开 |
| 高级 → **鱼群保护 · 运行状态**（`FishGuardStatusCard`，`client.js:1905-2005`） | 今天点赞 `n/上限`、累计成功/失败缓存、登录态、上次点赞（尝试/成功/失败 + 首个失败原因）、风控冷却、最近 6 条鱼群检查、最近 10 条点赞历史（含 B站 视频链接） | 只读 + 刷新 + 修复会话权限 | `GET /bili/fish-guard`；`POST /bili/session-permission {}`（`client.js:1914-1921`） | 是 |
| 高级 → **今天（只读）**（`AutomationCard`，`client.js:1826-1852`） | 普通评论/回找我的人/主动搭话/动态回复四类用量与上限、分享型用量、四类动态状态串、下一类、QQ 分享排班 | 只读 | `GET /bili/automation`（`client.js:2394-2397`）；读不到时提示「重启 DSH 后 /bili/automation 才可用」（`client.js:1839`） | 是 |
| 高级 → 工具行 | B站 参数搜索、依赖体检、发条通知测试 | input + 2 按钮 | `GET /bili/deps`（`client.js:2408-2417`）；`GET /bili/notify-config` + `POST /bili/notify {action:"notify-test"}`（`client.js:2427-2431`） | 是 |
| 高级 → 3 张小卡 | B站 状态；手动粘贴凭据（SESSDATA / bili_jct / buvid3 → `POST /bili/cookie`，`client.js:2418-2426`）；待审核队列（`GET /bili/pending`，发/删 → `POST /bili/pending {action,id}`，`client.js:2432-2439`） | 只读 / 3 个凭据输入 / 按钮 | 凭据写 `~/.dsh/surfcore/bili/credentials.json`，**永不回显**（`client.js:2470`） | 是 |
| 高级 → **口味权重 / 一键抓取**（`TasteEditor`，`client.js:2222-2381`） | 每个「爱看 / 额外关键词」一个 0–5 滑块（0=停用，写 `preferences.weights[label]`）、`×` 删除（同时删权重）、新关键词输入、抓取目标（主人/小肥鱼/两者）、一键抓取、候选 chips（已有置灰）、加入爱看 / 选前 6 个 / 清空选择 | range/text/select/buttons | `preferences.weights`、`preferences.like`、`preferences.keywords`（`client.js:2234-2314`）；`GET /preferences/scan?sources=history,favorites,local&limit=24&target=`（`client.js:2263`）；账号状态 `GET /bili/accounts`（`client.js:2232`） | 是（组内 `collapsible:false`） |
| 高级 → 12 组参数（`FieldGroups`，`client.js:2499`） | 见下表 | 混合 | `BILI_FIELDS`（`client.js:939-1052`），写 `bili.config.json` | 是 |
| 高级 → 依赖体检输出 | 多行文本 | 只读 `qbw-out` | `client.js:2500` | 是 |

`BILI_FIELDS` 分组（`client.js:939-1052`）：

| 组 | 关键键 |
| --- | --- |
| 她自己（只读） | `self.mid`、`self.name`（`readOnly:true`，`client.js:942-943`） |
| 作息 | `night.skipChance`、`night.maxVideos`、`night.maxWakesPerDay`、`night.minGapMin` |
| 口味（文本） | `preferences.like`(list)、`dislike`(list)、`keywords`(list) |
| 分享 | `share.enabled`、`share.via`(select dynamic/comment/dm)、`quota.shareDaily`、`share.minScore`、`share.silentAfterDays`、`share.decayPerDay` |
| 额度（代码闸门） | `limits.daily`、`replyDaily`、`taDaily`、`mineDaily`、`minePerPerson`、`globalMin`、`perUpMin`、`perVideoMin`、`perThreadMin` |
| 四类动态 | `dynamics.enabled`、`dynamics.gapMin` + 循环生成 4 类 × 5 键（`enabled/slot/minLen/maxLen/prefix`，`client.js:978-989`） |
| 鱼群判定关键词（B站） | `fishGuard.namePrefixes/nameContains/nameSuffixes/extraFishMids/exemptNames/exemptMids` |
| 鱼群保护（B站，20 项） | `fishGuard.enabled/sampleSize/maxFishTopLevel/maxFishMids/maxFishRatio/minSample/includeHotSample/gatherEnabled/forceGather/gatherMaxReplies/gatherMaxFishReplies/gatherMaxAgeHours/gatherCooldownHours/likeEnabled/maxLikesPerDay/maxLikesPerRun/likeFishReplies/likeAfterCommentMs/likeGapMinMs/likeGapMaxMs/failedLikeCooldownHours/failCooldownMinutes` |
| B站 会话权限 | `agent.sandbox`(select `danger-full-access`/`workspace-write`；hint 里带了一个本机绝对路径示例，已略) |
| 倾听 | `listen.comment`、`commentIntervalSec`、`scope`(both/reply)、`oncePerPerson`、`allDay`、`dm`、`dmScope`(owner/all)、`live`、`liveRoom`、`liveScope`(owner/mention) |
| 日记与推送 | `diary.push`、`diary.enabled`（**`readOnly:true`**，`client.js:1042`）、`notify.type`(none/desktop/dm/webhook/command)、`notify.url`、`notify.template`、`notify.cmd`、`notify.args`(json) |
| 工具链 | `toolsPath` |

**B站 扫码弹窗**（`BiliQrModal`，`client.js:2118-2216`）：`POST /bili/qr/start {target, allowSameAsOwner}` 拿 `{id, image(dataURI), expected}`；随后每 **1500 ms** 轮询 `GET /bili/qr/poll?id=`（`client.js:2170`），处理 `confirmed / scanned / expired / wrong-account / failed` 五态；关闭或卸载时 `POST /bili/qr/cancel`（`client.js:2174-2185`）。`target="fish"` 时多一个「我只有一个 B站 号（主人=小肥鱼）」复选框（`client.js:2205-2207`）；扫错号会被拒绝（`client.js:2209-2211`）。客户端**拿不到 cookie**，只拿到 `mid/昵称`（注释 `client.js:2114-2117`）。

#### 2.6 语音 `voice`（`VoiceTab`，`client.js:2966-3109`）

| 块 | 内容 | 控件 | 端点 / 键 |
| --- | --- | --- | --- |
| 说明 | 「语音引擎不随插件分发，不装也能聊天」 | 只读 | `client.js:3064-3065` |
| **使用** | 单选「本地 / 云端」+ 启动/停止 + 系统状态 + 当前包名 | radio + 按钮 | `GET /voice/packs`、`POST /voice/packs/activate`、`/voice/packs/stop`（`client.js:2989-3018`） |
| **包卡**（每包一张） | 名称、体积、端口、安装进度/运行态、简介、pros/cons、计费说明、安装路径；安装/卸载按钮 | 按钮 | `POST /voice/packs/install`、`POST /voice/packs/remove`（`client.js:3020-3031`、`client.js:3039-3060`）；安装后 1.5 s 轮询进度，最多 240 次（`client.js:2989-3001`） |
| **云端包配置**（`CloudForm`，`client.js:2913-2964`） | 云端用量（模型/今日/本月/估算费用/剩余额度，**每 5 秒**刷新）、AppID、Access Key（password，已配置时 placeholder 显示打码值，留空=不改）、音色 ID、保存、测试连接、参考音频下载 | input/按钮 | `GET /voice/packs/cloud-stats?id=voice-cloud`（`client.js:2877`）、`GET/POST /voice/packs/cloud-config`、`POST /voice/packs/test`（`client.js:2919-2941`） |
| **触发规则** | 允许谁触发（仅主人/任何人/指定成员）、每分钟/每小时上限、允许 AI 主动发语音（默认关） | select/number/switch | `GET/POST /voice/rules`（`client.js:2982`、`client.js:3034-3037`、`client.js:3091-3108`） |

只读项：体积、端口、运行态、云端用量、`config.toml` 落盘说明（`client.js:2962-2963`）。此页**没有**高级设置抽屉。

#### 2.7 桌宠 `pet`（`PetTab`，`client.js:3947-4058`）

| 卡片 | 字段 | 控件 | 端点 / 键 |
| --- | --- | --- | --- |
| **运行状态** | 状态、版本、占用、目录（`<code>`）；安装/启动/停止/卸载（按状态互斥出现） | 只读 + 按钮 | `GET /pet/status`（`client.js:3955-3963`）；`POST /pet/{install\|start\|stop\|remove}`（`client.js:3965-3974`） |
| **安装设置** | 安装包地址（zip 本地路径或 http(s)）、Electron 路径、安装目录（留空 = `~/.dsh/surfcore/pet/app`） | 3 个 text + 保存设置 | `POST /pet/config`（`client.js:4009-4019`） |
| **对话** | 在线徽标 + 是否主动搭话载体；角色/模型/语音路由/历史条数；专注模式（switch，即时调用）、启用桌宠对话、写进记忆卡、文本回复上限、语音回复上限、上下文轮数、思考强度（off/low/high/max） | switch/number/select | 专注模式 `POST /pet/focus {enabled}`（`client.js:3977-3986`，**立即生效、不走底部保存**）；其余写 `unified.pet.chat.*`（`client.js:4036-4049`） |
| **内置形象** | 形像 chips（`st.skins`） | 只读 | `client.js:4053-4056` |

#### 2.8 Token 额度 `tokens`（`TokenTab`，`client.js:3823-3944`）

| 块 | 字段 | 控件 | 键 / API |
| --- | --- | --- | --- |
| 顶部摘要 | 今日日期（「每天 00:00 重置」）、总花费、总 token、总额度已用比例；徽标：总额已达上限 / 今天已提醒过 / 价目表版本 / 数据源 | 只读 | `budget.day/usage.total/ratios.total/blocked.total/alertedToday/priceTable.version/source`（`client.js:3840-3855`） |
| **QQ / B站 / 其他花费** 三张卡 | 每张：今日花费 + token、人民币额度、token 额度、快捷加数 chips（+1/+3/+5/+10 元；+20M/+50M/+100M/+200M）、清空、两条进度条 | `LimitField`（文本输入，`client.js:3714-3748`）+ chips | `limits.qq/bili/other.{cny,tokens}`（`BudgetScopeCard`，`client.js:3776-3821`） |
| **SurfCore 总额度** 卡 | 同上 + 快捷：设为 ¥8 / 设为 8M / = QQ+B站+其他 之和 / 只留总额度 / 清空总额 | 同上 + 5 个 chip | `limits.total`（`client.js:3890-3936`） |
| 脚注 + 保存 | 「金额与 token 是两套独立额度」「80% 弹窗每天只弹第一次」「保存后立即生效」+「保存额度」 | 按钮 | `onSave` → 主组件 `save(false)`（`client.js:4259`）；提交 `POST /token-budget {limits}`（`client.js:4194-4198`） |

输入解析在 `parseBudgetInput()`（`client.js:3680-3696`）：人民币接受 `¥ / ￥ / 元 / 块 / CNY` 与千分位；token 接受 `k/m/b/万/亿` 后缀。渲染回填在 `formatBudgetInput()`（`client.js:3699-3706`）。初值 `GET /token-budget`（`client.js:4117-4120`），**每 30 秒**轮询一次，但轮询不会覆盖正在改的草稿（`client.js:4137-4140`、`client.js:4106-4116`）。

#### 2.9 观看历史 `watch`（`WatchTab`，`client.js:2010-2112`）

| 块 | 内容 | 控件 |
| --- | --- | --- |
| info 条 | 数据来自 `debrief` / `watch-video` 写入 `watch-history.jsonl`；旧角色从 B站 记忆补出；操作列来自评论记账+收藏+动态 | 只读（`client.js:2068-2072`） |
| 4 张统计卡 | 今天 / 最近 7 天 / 深看·抽帧 / 不同视频（含「其中 n 条来自旧记忆」） | 只读（`client.js:2073-2077`） |
| 工具行 | 搜标题/UP/BV、刷新、去 B站 页 | input + 2 按钮（`client.js:2078-2081`） |
| 操作汇总 / 兼容提示 | 「评论 n（主评论/聚拢/回复/搭话/分享）· 收藏 · 动态 · 仅看」；旧宿主没返回 `actions` 时提示「重启 DSH 后可用」 | 只读（`client.js:2082-2086`） |
| 表格 | 时间、视频（外链）、UP、时长、读法徽标（浅看/深看/抽帧/旧记忆）、评分 `n/20`、操作（最多 3 条，可展开 `+n`） | 只读（`client.js:2091-2108`、`client.js:2048-2066`） |
| 页脚 | 共 n 条（过滤后 n）· 数据文件 | 只读（`client.js:2110-2111`） |

数据：`GET /watch-history?limit=300`（`client.js:2017`），本地 `useMemo` 过滤（`client.js:2022-2027`）。

#### 2.10 记忆 `memory`（`MemoryTab` 外壳 + 两个记忆卡组件）

`MemoryCardPanel`（`client.js:2566-2799`）用 `view` 参数在同一页渲染三块：`summary`（`client.js:2644-2703`）、`details`（`client.js:2704-2795`）、`all`。`MemoryTab` 用 `summary` + `details` 分两处挂（`client.js:3151`、`client.js:3187`）。

| 块 | 字段 | 控件 | 键 / API |
| --- | --- | --- | --- |
| 顶部提示 | 当前加载「衰减记忆卡」；全量卡只存档不注入；两个注入文件路径 | 只读 | `status.loadedLabel/paths`（`client.js:2645-2650`） |
| 容量卡 | 进度条 + 级别 chip +「字数/上限（百分比）」+ 五种清晰度计数 + 最初/锚点；`maxChars`（0=不限）、`warnChars`（默认 60000）；立即整理、压缩到 80%、手动记一条、确认提醒 | number ×2 + 按钮 | `unified.memoryCard.maxChars/warnChars`（`client.js:2667-2686`）；`POST /memory-card {action:"maintain"\|"compact"\|"ack"}`（`client.js:2589-2601`） |
| 手动记一条 | 内容、重要度 1–100、scope（QQ/B站/共享） | textarea/number/select | `POST /memory-card {action:"add", text, importance, scope}`（`client.js:2636-2640`、`client.js:2692-2703`） |
| 记忆卡规则（`Section`） | 启用、全量卡上限（GB）、QQ/B站 注入上限、最近 N 天保持清楚、多少天后模糊/可遗忘、每日整理时间、满 100% 自动压缩、容量告警私聊管理员、B站 提示词带 QQ 记忆 | switch/number | 全部写 `unified.memoryCard.*`（`client.js:2634-2635`、`client.js:2705-2734`） |
| 最近记忆 | 初次相遇（来源/日期/合并条数/预览）、多选操作（设为初次相遇 / 合并为一个事件 / 恢复自动）、合并标题 + 合并后置顶、每条：清晰度/平台/合并/她自己说的/最初/重要度/置顶 + 置顶/忘记 | checkbox/number/按钮 | `POST /memory-card {action:"pin"\|"forget"\|"merge-memories"\|"set-first-meet"\|"clear-first-meet"}`（`client.js:2602-2633`、`client.js:2735-2782`） |
| 两份注入预览 | QQ / B站 注入文本（`<pre>` 滚动） | 只读 | `data.promptQq/promptBili`（`client.js:2783-2789`） |
| 完整记忆卡 | `memory-card.md` 原文 | 只读 | `client.js:2790-2791` |
| 备份 | 文件、体积、时间、恢复（二次确认） | 按钮 | `POST /memory-card {action:"restore", name}`（`client.js:2792-2795`） |
| **全量记忆卡**（`FullMemoryCardPanel`，`client.js:2802-2863`） | 只存档说明、条数/体积/上限、软上限告警、损坏告警、搜索框 + 搜索/显示最近、条目列表（平台/重要度/匹配分）、原文预览 | input/按钮 | `GET /memory-card/full?q=&limit=40`（`client.js:2810`） |
| **双向脱敏同步** | 隐私红线（锁定不可关）、B站→QQ（开关 + 简报字数/时间 + 隐私复检 + 立即刷新）、QQ→B站（开关 + 上次同步/保留条数/丢弃数 + 立即同步 / 扫描身份候选 / 清空） | switch + 按钮 | B站→QQ 先写 `unified.__biliToQqToggle`（`client.js:3124-3126`），保存时折算进 `qq.biliBridge.memory.enabled`（`client.js:4173-4183`）；QQ→B站 写 `memory.qqToBili.*`；`POST /memory {action:"sync"\|"scan-align"\|"purge"\|"refresh-bili"}`（`client.js:3129-3148`） |
| 同步范围与隐私参数 | 回看天数、最多消息条数、记忆最大字符、包含管理员消息、使用群昵称、只同步这些群（`IdListEditor`） | number/switch/列表 | `memory.qqToBili.*`（`client.js:3189-3206`） |
| 同步审计 | 每条：方向、成功/失败、扫描/保留/丢弃/脱敏处数、时间 | 只读 | `client.js:3214-3218` |

#### 2.11 对齐 `align`（`AlignTab`，`client.js:3223-3353`）

| 块 | 字段 | 控件 | 端点 |
| --- | --- | --- | --- |
| info 条 | 对齐层高于记忆同步开关；只存「平台账号 ↔ 平台账号」映射，不存对话 | 只读 | `client.js:3296-3299` |
| 旧宿主告警 | `labelsSupported !== true` 时禁用称呼输入并提示「重启 DSH 后能用」 | 只读 + 禁用 input | `client.js:3231-3232`、`client.js:3300-3301` |
| **手动添加** | 称呼（优先于群名片/B站昵称/人格卡称呼表）、QQ 号、群昵称、所在群号、B站 mid、B站 昵称、备注 | text ×7 + 按钮 | `POST /align {action:"add", link}`（`client.js:3236-3251`），附加 `confidence:1, verified:true, source:"manual"` |
| 同上工具行 | 扫描候选、导出（下载 JSON）、导入（本地文件 → `action:"import", merge:true`） | 按钮/file | `action:"scan"`（`client.js:3267-3271`）、`client.js:3272-3294` |
| 高级 → 候选人 | 每条：平台+名字 → 对端、来源、置信度、证据；确认/否定 | 按钮 | `action:"approve"` / `action:"reject"`（`client.js:3333-3341`） |
| **已对齐** | 表格：QQ、B站、称呼（`AliasCell` 行内编辑，Enter 或「保存」提交）、来源、删除 | 行内 input + 按钮 | `action:"update" {link:{label}}`（`client.js:3259-3266`、`client.js:3342-3351`）；`action:"remove"` |

#### 2.12 扩展 `extensions`（`ExtensionsTab`，`client.js:3356-3417`）

- info 条：后续功能从扩展接（杀戮尖塔启动器 / B站 自主直播 / 贴吧），扩展默认关闭，开启等于允许在本机执行代码（`client.js:3392-3394`）。
- 高级 → 平台接入卡：每个平台 `名称 + 已接入/预留 + 能力串 + id/内置或扩展`（`client.js:3395-3403`）。
- **功能扩展**：每个扩展一张卡：名称、状态徽标（运行中/已启用/关闭）、描述、`id · v版本 · 作者 · 能力`、路由；启用/停用、重载；`Section 配置 JSON（高级）` + 保存配置（`client.js:3405-3415`）。配置是**自由 JSON**，保存前 `JSON.parse` 失败只弹 toast（`client.js:3376-3384`）。
- 端点：`GET/POST /extensions {action:"toggle"\|"config"\|"reload"}`（`client.js:3360-3389`）。

#### 2.13 全部参数 `advanced`（`AdvancedTab`，`client.js:3420-3458`）

- 红框警告：「真正全部」的参数树，改完仍要按底部保存（`client.js:3439-3441`）。
- scope 选择：`QQ config.json` / `B站 bili.config.json` / `合体 unified config`（`client.js:3443-3446`），三个草稿各自独立。
- 参数来自 `flattenFields()`：把对象扁平化成 `path/label/kind/value`，`inferKind()` 按值类型推控件（boolean→switch、number→number、字符串数组→list、对象→json、>160 字字符串→textarea，`client.js:1079-1109`）。
- 分组键 = 路径前两段（`client.js:3429-3437`）；查询只匹配 `label + 路径`（`client.js:3426-3428`）；每组 `Section` 在搜索时或组数 <8 时默认展开（`client.js:3449`）。
- 每个字段的 hint 被强制改成完整路径（`client.js:3452`），所以这一页同时是「配置键字典」。

#### 2.14 诊断 `diag`（`DiagnosticsTab`，`client.js:3461-3546`）

| 块 | 内容 | 端点 |
| --- | --- | --- |
| 动作条 | 重新体检、备份全部配置 | `GET /diagnostics`、`POST /diagnostics {action:"backup"}`（`client.js:3467-3494`） |
| 体检卡 | 每条 `✓/✗ 名称` + 详情；整体徽标「通过/有项不可用」 | `diag.checks`（`client.js:3506-3508`、`client.js:3523-3525`） |
| 路径卡 | `diag.paths` 的键值 | `client.js:3509-3511`、`client.js:3526-3528` |
| 高级 → 日志 | 「读取日志」→ 插件日志 + 桥接日志两段 `<pre>` | `GET /logs?lines=160`（`client.js:3480-3486`） |
| 高级 → 备份 | 备份列表（名称/体积/时间/恢复，含 confirm） | 列表取 `GET /config` 的 `backups`（`client.js:3473-3476`）；恢复 `POST /diagnostics {action:"restore", name}`（`client.js:3495-3504`） |

#### 2.15 外壳、底部与两个全局弹窗

- 头部：标题 `SurfCore` + 版本徽标 `v…` + 三颗状态点（QQ / B站 / 生物钟），点色由 `platformStart` 与该平台运行态共同决定（`client.js:4272-4280`）。
- 底部（`client.js:4287-4294`）：「保存」「保存并重启 QQ 桥接」「撤销改动」「重新读取」四个按钮；右侧 dirty 文案「● 有改动还没保存（改了不点保存 = 没生效）」或「已保存」；`toast` 文本也贴在右侧（4 秒后自清，`client.js:4101-4104`）。
- 加载态：三份配置任一为空时只渲染头 + 「正在读取配置…」+「重试」（`client.js:4240-4245`）。
- **token 80% 弹窗**（`client.js:4295-4306`）：「今天第一次也是唯一一次」，列出已达 80% 的分项/总额；按钮「去调高额度」「知道了」；点遮罩关闭。
- **记忆卡容量弹窗**（`client.js:4307-4318`）：80/90/100% 三档；按钮「立即压缩到 80%」「去记忆页看看」「2 小时后再提醒」「本次不再提醒」。触发靠**每 60 秒**拉一次 `/memory-card` 并比较 `level > acknowledgedLevel`（`client.js:4142-4162`），「2 小时后」靠 `memorySnoozeRef` 本地计时（`client.js:4230-4238`）。

### 3. 交互与状态

**3.1 草稿模型（核心）**

- 三份草稿 + 一份基线：`qq` / `bili` / `unified` 是可变草稿，`saved` 是 `JSON.stringify({qq,bili,unified})` 的快照字符串（`client.js:4131`）。
- `dirty` = 三份草稿的 JSON 与基线不等 **或** 额度草稿与服务端额度不等（`client.js:4169-4170`）。没有字段级 dirty，也没有逐字段校验；比较整串意味着键顺序/空白变化也会算「有改动」。
- 所有编辑都走 `setQqPath/setBiliPath/setUnifiedPath`：`clone → setPath → setState`（`client.js:4164-4166`）。`setPath` 接受数组或 `"a.b"` 字符串并归一化（`client.js:177-188`；2026-10-24 的字符串按字符遍历 bug 记录在 `client.js:173-176`）。
- 表单里混着几种「立即生效、绕开草稿」的控件：运行模式 select（`client.js:1812`）、桌宠专注模式（`client.js:3977`）、目的页预览/试一次（`client.js:1297-1330`）、以及各类「立即同步/刷新」按钮。

**3.2 保存顺序与副作用**

`save(restartBridge)`（`client.js:4191-4209`）顺序固定：

1. 若额度脏：先 `POST /token-budget {limits}` 并回填（`client.js:4194-4198`）→ **额度先落盘**；后续配置保存若失败，额度已经生效（部分成功）。
2. `POST /config {qq: normalizedQq, bili, unified: normalizedUnified, restartBridge}`（`client.js:4199`）。
3. 用响应回填三份草稿并更新基线；`notify` 汇总「已保存 / 桥接已重启 / 桥接重启失败 / 有提示」；`warnings` 拼进顶部 `err` 区（`client.js:4200-4207`）。
4. `loadOverview()` 刷新概览（`client.js:4207`）。

注意：**任一标签页点保存都会重写三份配置**（请求体带全部三份），所以「在 QQ 页改一个开关」也会把 B站/unified 草稿整份提交。

**3.3 轮询与定时器（插件侧）**

| 位置 | 周期 | 内容 |
| --- | --- | --- |
| 额度 | 30 s | `GET /token-budget`（`client.js:4137-4140`） |
| 记忆卡容量 | 60 s | `GET /memory-card`，用于弹窗判定（`client.js:4142-4162`） |
| 云端语音用量 | 5 s | `GET /voice/packs/cloud-stats`（`client.js:2870-2884`） |
| 语音包安装 | 1.5 s ×240 | `GET /voice/packs`（`client.js:2989-3001`） |
| B站 扫码 | 1.5 s | `GET /bili/qr/poll`（`client.js:2150-2172`） |
| 概览/其余页面 | **不轮询** | 只有首次挂载与手动刷新（`client.js:4134`、`client.js:1219-1220`） |

**3.4 提示与错误**

- 顶层 `err` 放在 body 顶部红字（`client.js:4285`），不自动消失；`toast` 4 秒消失（`client.js:4101-4104`）。
- 卡片内自成体系的提示：`qbw-ok / qbw-err / qbw-warnbox / qbw-dangerbox / qbw-infobox`（`client.js:75-96`），例如扫码结果、分享结果、依赖体检、凭据写入。
- 危险动作一律 `confirm`：删除角色（`client.js:3652`）、忘记记忆（`client.js:2604`）、恢复备份（`client.js:2795`、`client.js:3496`）、立即分享到群（`client.js:1862`）、立即试一次（`client.js:1313-1315`）、清空 QQ→B站 记忆（`client.js:3140`）。
- 旧宿主兼容提示是「文案级」的：接口 404/「未知接口」时追加「宿主插件还是旧代码：重启 DSH 或重载 surfcore」（`client.js:2136-2140`、`client.js:2266-2270`、`client.js:2085-2086`、`client.js:3300-3301`）。

**3.5 脱敏与只读**

- `password` 类控件只显示「已设置（保持 ******** 不变）」占位，不回显真值（`client.js:321-322`）；云端 Access Key 回显的是服务端给的打码值（`client.js:2956`）。
- B站 cookie 写完即清空本地 state（`client.js:2423`），且明确「永不回显」（`client.js:2470`）。
- 强制只读：`self.mid` / `self.name`（`client.js:1810`）、`diary.enabled`（`client.js:1042`）、全量卡与注入预览（纯展示）。
- 但「全部参数」页会把 `dsh.authToken`、`snowluma.accessToken`、`consoleToken`、`webSearch.apiKey` 等 password 键以同样控件暴露（`client.js:3420-3458`），只是值不回显、可覆盖。

**3.6 保存/重启提示的措辞差异（容易误会）**

- QQ 侧统一说「保存后需重启桥接」（`client.js:1769`、`client.js:1685`）。
- B站 侧说「下一轮生效，不用重启 DSH」（`client.js:964-965`、`client.js:1023`）。
- 记忆卡/人格卡说「保存即生效」（`client.js:2556`）。
- 目的页分成两句：载体=桌宠时「保存即生效」，载体=QQ 时「节奏参数要重启桥接」（`client.js:1480-1481`）。

### 4. 组件清单（内部函数组件）

| 组件 | 用途 | 复用位置 |
| --- | --- | --- |
| `Row` | 标签 + 提示 + 右侧控件的行布局 | 几乎所有卡片（`client.js:241-247`） |
| `ListInput` | 逗号分隔列表输入，保留原始文本、失焦规范化 | `Field` 的 list/times（`client.js:252-286`） |
| `Field` | 按 `kind` 渲染 9 种控件 | `FieldGroups`、QQ 早安问候、全部参数（`client.js:288-327`） |
| `FieldGroups` | 按组渲染 `Section` + 字段 | QQ 页、B站 页（`client.js:330-345`） |
| `JsonCell` | JSON 文本框 + 解析错误提示 | `Field(kind:"json")`（`client.js:347-362`） |
| `Section` | 可折叠分组（`collapsible=false` 时强制展开） | 全局（`client.js:364-376`） |
| `AdvancedSettings` | 默认折叠的「高级设置」抽屉 | 8 个标签页（`client.js:1204`/`1761`/`2461`/`3186`/`3332`/`3395`/`3541`/`3655`） |
| `StatusDot` | 三色状态点 | 头部、概览卡（`client.js:384-386`） |
| `Btn` | 按钮（`kind` 决定 `qbw-btn2/3/danger`） | 全局（`client.js:388-390`） |
| `AdminCard` | 管理员 QQ ⇄ B站 身份卡 | QQ 页、B站 页（`client.js:396-463`） |
| `IdListEditor` | ID 列表 + chips + 单删 + 格式标红 | 白名单、黑名单、同步范围（`client.js:475-513`） |
| `WhitelistCard` | 群/私聊白名单 + 全放行开关 | QQ 页（`client.js:515-565`） |
| `BlacklistCard` | 人/群/私聊三档黑名单 | QQ 页（`client.js:575-636`） |
| `PlatformStartCard` | 平台启动开关 + 未保存提示 | QQ 页、B站 页（`client.js:643-664`） |
| `AliasCell` | 对齐表「称呼」行内编辑（Enter 提交） | 对齐页（`client.js:669-686`） |
| `WindowsEditor` | B站 作息窗口列表编辑器 | B站 页（`client.js:1056-1076`） |
| `OverviewTab` | 概览 | `overview`（`client.js:1112`） |
| `QqFishGuardStatusCard` | QQ 鱼群最近触发 | QQ 高级（`client.js:1230`） |
| `PurposeCard` | 目的机制设置/状态/预览 | 目的页（`client.js:1279`） |
| `PurposeCarrierCard` | 目的载体选择（QQ/桌宠） | 目的页（`client.js:1489`） |
| `PetChatTestCard` | 桌宠对话试发 | 目的页（`client.js:1569`） |
| `PurposeTab` | 目的页外壳 | `purpose`（`client.js:1618`） |
| `ClosureCard` | 对话收尾判断 | QQ 高级（`client.js:1634`） |
| `QQTab` | QQ 页 | `qq`（`client.js:1689`） |
| `AutomationCard` | B站 今日用量只读卡 | B站 高级（`client.js:1826`） |
| `QqShareSection` | B站→QQ 定时分享 | B站 页（`client.js:1857`） |
| `FishGuardStatusCard` | B站 鱼群/点赞运行状态 | B站 高级（`client.js:1905`） |
| `WatchTab` | 观看历史 | `watch`（`client.js:2010`） |
| `BiliQrModal` | B站 扫码登录/绑定弹窗 | B站 页、口味抓取（`client.js:2118`） |
| `TasteEditor` | 口味权重 + 一键抓取 | B站 高级（`client.js:2222`） |
| `BiliTab` | B站 页 | `bili`（`client.js:2383`） |
| `PersonaEditor` | 人格卡编辑 + 备份恢复 | 角色页（`client.js:2515`） |
| `MemoryCardPanel` | 衰减记忆卡三视图 | 记忆页 summary/details（`client.js:2566`） |
| `FullMemoryCardPanel` | 全量记忆卡检索 | 记忆高级（`client.js:2802`） |
| `CloudStats` / `CloudForm` | 云端语音用量 / 密钥表单 | 语音页（`client.js:2870` / `client.js:2913`） |
| `VoiceTab` | 语音页 | `voice`（`client.js:2966`） |
| `MemoryTab` | 记忆页外壳 + 双向同步 | `memory`（`client.js:3111`） |
| `AlignTab` | 身份对齐 | `align`（`client.js:3223`） |
| `ExtensionsTab` | 扩展管理 | `extensions`（`client.js:3356`） |
| `AdvancedTab` | 全部参数树 | `advanced`（`client.js:3420`） |
| `DiagnosticsTab` | 诊断/备份/日志 | `diag`（`client.js:3461`） |
| `CharactersTab` | 角色包管理 + 人格卡 | `characters`（`client.js:3550`） |
| `LimitField` / `BudgetChips` / `BudgetMeter` / `BudgetScopeCard` | 额度输入 / 快捷加数 / 进度条 / 分项卡 | Token 额度页（`client.js:3714` / `3750` / `3761` / `3776`） |
| `TokenTab` | Token 额度页 | `tokens`（`client.js:3823`） |
| `PetTab` | 桌宠页 | `pet`（`client.js:3947`） |
| `QQBIliWhaleSection` | 总壳（head/tabs/body/foot + 两个弹窗 + 保存逻辑） | 设置页唯一入口（`client.js:4079`） |

非组件但被多处复用的工具：`api()`（`client.js:196-215`）、`useStyleOnce()`（`client.js:217-227`）、`fmtTime/fmtBytes`（`client.js:229-238`）、`parseIdListText`（`client.js:469-471`）、`parseBudgetInput/formatBudgetInput`（`client.js:3680-3706`）。

## 二、浏览器控制台

页面由桥接进程直接返回：`GET /` → `readFileSync(ROOT/public/console.html)`（`bridge.js:4020`）。没有构建、没有外部 JS/CSS，全部内联（`console.html:21-1758` 是 `<style>`，`console.html:2744-5414` 是唯一的 `<script>`）。

### 1. 导航与页面

侧栏是三段式：品牌 → `nav-label` 分组（工作空间 / 聊天行为 / 管理）→ `#mainNav` 里 11 个按钮（`console.html:1763-1782`）。每个按钮只有 `data-view`，没有路由组件；切换页面 = 给所有 `[data-page]` 元素设 `hidden`（`console.html:4601`）。

| 顺序 | 按钮（图标） | `data-view` | 页面 key | 该页可见的 section |
| --- | --- | --- | --- | --- |
| 1 | 运行总览 ◫ | `overview` | `overview` | `#overviewSummary`（`1793`）、`#section-mode`（`1801`）、`#section-activity`（`1823`）、`#section-silent`（`2559`）、`#section-dsh`（`2567`） |
| 2 | 会话与审批 ☷ + 计数 | `sessions` | `sessions` | `#section-sessions`（`1815`）、`#section-pending`（`1819`） |
| 3 | 人格与角色 ◉ | `persona` | `persona` | `#section-persona`（`1827`） |
| 4 | ~~语音 ♪（可选安装）~~ | `voice` | **已删除导航入口**（2026-10-26，RISK R32） | 区块 `#section-voice` 保留但去掉 `data-page` + 加 `hidden`，永不显示 |
| 5 | 二代仿真 ◈（V2） | `social-v2` | `social-v2` | `#section-social-v2`（`2081`） |
| 6 | 一代仿真 ◇（V1） | `social-v1` | `social-v1` | `#section-social-v1`（`1900`） |
| 7 | 黑话词库 ▤ | `slang` | `slang` | `#section-slang`（`2408`） |
| 8 | 令牌与花费 ◧ | `usage` | `usage` | `#section-usage`（`2661`） |
| 9 | 访问与安全 ⊙ | `access` | `access` | `#section-whitelist`（`2541`）、`#section-security`（`2579`）、`#section-token`（`2605`） |
| 10 | 调试与运维 ⌘ | `operations` | `operations` | `#section-test-send`（`2615`）、`#section-maintenance`（`2632`）、`#section-notify`（`2644`） |
| 11 | 工具参考 ⓘ | `reference` | `reference` | `#section-reference`（`2524`） |

页面注册表是 `consolePages` 一个对象，共 **10 项**（`console.html:4577-4588`），每项三句话：面包屑标题 / `h1` 主标题 / 副标题——这也是切页时唯一被改的文案（`console.html:4608-4611`）。

其他与导航有关的约定：

- **顺序排版**：`#section-mode`、`#section-silent`、`#section-activity` 用 CSS `order` 重排（`console.html:673-700`），因为它们和别的卡片共享 `overview` 页。
- **深链接**：切页写 `history.pushState(…#page)`（`console.html:4612`），监听 `hashchange`（`console.html:4624-4627`），首屏用当前 hash 初始化（`console.html:5199`）。
- **两个「链接式」入口**：概览底部「管理访问范围 →」和指标卡本身都能跳页（`console.html:1797-1798`、`console.html:2714`），靠 `data-view` + 冒泡委托（`console.html:4621-4623`）。
- **顶栏**：状态徽标 `#statusText`、主题按钮 `#themeToggle`、刷新按钮 `#refreshConsole`（`console.html:1786`）；刷新不是整页 reload，而是 `Promise.allSettled([refresh, refreshSessions, refreshPending, refreshSocialStatus, refreshV2Activity])` 后弹 toast（`console.html:4667-4672`）。

### 2. 每个页面的功能与对应端点

| 页面 | 功能块 | 端点 | 行号 |
| --- | --- | --- | --- |
| 全站 | 状态轮询（模式/角色/活动日志/preset 选中项） | `GET /api/status` | `2831` |
| 总览 | 四个模式卡（聊天/封闭 Agent/一代/二代），点即保存 | `POST /api/mode {mode, closedAgentPreset}` | `1801-1808`、`2863-2879` |
| 总览 | 封闭 Agent 的 DSH preset 下拉 | `GET /api/presets` | `2843-2861` |
| 总览 | 静默开关（静默时群友消息不投递） | `POST /api/role-mode {mode:"silent"\|"active"}` | `2559-2565`、`3258-3259` |
| 总览 | DSH 模型与思考强度（下一句生效，写入全局默认） | `GET /api/dsh/model`、`POST /api/dsh/effort` | `2567-2578`、`3053-3082`、`3248-3257` |
| 会话 | 会话映射表 + 单条「清除上下文」 | `GET /api/sessions`、`POST /api/session/reset {key}` | `3095-3116` |
| 会话 | 挂起审批 / 提问列表（只读） | `GET /api/pending` | `3118-3135` |
| 人格 | 人格列表、载入编辑、新建/改名/删除/副本 | `GET /api/roles`、`/api/roles/content?name=`、`/create`、`/update`、`/rename`、`/delete` | `2937-3003`、`3152-3196` |
| 人格 | 切换 / 清除当前人格 | `POST /api/role` | `3147-3151` |
| 人格 | 注入上限（1000–20000） | `POST /api/roles/limit {maxInjectChars}` | `3237-3245` |
| 人格 | 仿真提示词：读 / 存 / 还原备份（两代各一份） | `GET/POST /api/preset/sim-prompt`、`POST …/restore` | `3024-3050`、`3210-3234` |
| 一代仿真 | 表单回填 / 保存 / 立刻投喂摘要 / 手动切状态 | `GET/POST /api/social`、`POST /api/social/flush`、`POST /api/social/state {key,phase}` | `4062-4157`、`4163-4172` |
| 二代仿真 | 参数读取与保存（15 个折叠组 + 工具开关） | `GET/POST /api/socialV2/config` | `3369-3558` |
| 二代仿真 | 暂停 / 恢复 / 重置 / 立即唤醒 | `GET/POST /api/socialV2/activity`、`/reset`、`/wake {key,reason}` | `3996-4030` |
| 二代仿真 | 会话状态 / 全部会话状态 / 唤醒状态格式化 | `GET /api/socialV2/state?key=`、`/states` | `3560-3565`、`3778-3843`、`4031-4034` |
| 二代仿真 | 工具调用日志（表格，单元格点击展开全 JSON） | `GET /api/socialV2/tool-log?limit=200`、`POST …/tool-log/clear` | `3646-3680`、`4047-4059` |
| 二代仿真 | AI 反馈：加载 / 清空 | `GET /api/socialV2/feedback`、`POST …/feedback-clear` | `4035-4046` |
| 二代仿真 | 轻量记忆：加载 / 清空全部 / 单条清空 / 编辑 / 删除 | `GET /api/socialV2/memory?key=`、`/memory-clear`、`/memory-update`、`/memory-remove` | `3682-3776` |
| 二代仿真 | 初始提示词：按 key 加载/保存/删除，空 key 时列出全部 | `GET/POST /api/socialV2/initial-prompt` | `3846-3936` |
| 二代仿真 | 上线补历史「立即检查一次」 | `POST /api/socialV2/history-catchup {force:true}` | `3966-3993` |
| 二代仿真 | 语音库列表 / 试发（走与 AI 相同的校验与限流） | `GET /api/voice/list?probe=1`、`POST /api/voice/send {target,file,dryRun}` | `3308-3337`、`3339-3366` |
| 二代仿真 | 白名单会话快速选择（把 key 填进 4 个输入框） | `GET /api/status` 的 `allowGroups/allowPrivate` | `3938-3962` |
| 语音 | 语音包安装/启动/停止/试听/卸载、云端配置与测试、触发规则 | `GET/POST /api/voice/packs*`、`/api/voice/rules` | `5231-5411`（页面不可达，见 §四.1） |
| 黑话 | 三态列表 + 搜索 + 分页条数 + 全选 + 批量确认/拒绝/删除/恢复/研究 | `GET /api/slang`、`POST /api/slang/research`、`/batch-confirm`、`/batch-reject`、`/batch-delete`、`PATCH /api/slang/<id>` | `4238-4441` |
| 黑话 | 单条确认/编辑（弹窗）、拒绝、恢复、删除 | `POST /api/slang/<id>/confirm`、`PATCH/DELETE /api/slang/<id>` | `4324-4463` |
| 黑话 | 手动添加、立即提取、研究全部、参数保存 | `POST /api/slang`、`/extract`、`/config` | `4465-4518` |
| 访问与安全 | 白名单/黑名单/管理员保存 | `GET/POST /api/whitelist` | `3084-3093`、`3260-3269` |
| 访问与安全 | 安全拦截通知 + `state/` 权限状态与「重新检测」 | `GET/POST /api/security {interceptNotify\|rehardenStateDir}` | `4520-4550` |
| 访问与安全 | 控制台令牌：保存 / 生成随机 | `POST /api/console/token {token}` | `4552-4574` |
| 调试与运维 | 测试发送（群/私聊） | `POST /api/test-send {kind,id,message}` | `3270-3278` |
| 调试与运维 | 重启桥接 / 清空 QQ 聊天工作区 | `POST /api/restart`、`POST /api/workspace/reset` | `3279-3290` |
| 调试与运维 | 后台控制端引导（投递一条提醒给指定会话的 agent） | `POST /api/console/notify-ai {key,message}` | `3291-3300` |
| 令牌与花费 | 汇总卡 + 按会话表 + 价目表 + 逐轮 + 最近流水 + 清空账本 | `GET /api/tokens/summary?limit=200`、`/turns?key=&limit=200`、`/recent?limit=40`、`POST /api/tokens/reset` | `5113-5197` |
| 令牌与花费 | 消耗走势（手写 SVG，可切 24/72/168/720 小时与 cost/token 轴） | `GET /api/tokens/series?hours=` | `4808-4928` |
| 工具参考 | 纯静态 MCP 工具表（无接口） | — | `2524-2540` |

端点约定（看代码总结出来的，不是文档承诺）：

- 全部 JSON；除黑话单条用 `PATCH` / `DELETE` 外，其余只用 `GET` / `POST`（`console.html:4297`、`console.html:4304`、`console.html:4449`）。
- 失败约定是 `{ok:false,error}`；`api()` 本身**不检查 `ok`**，HTTP 200 + `ok:false` 也算「请求到达」，所以每个调用点都要自己判一次（`console.html:2755-2774` 对比 `console.html:3267-3268`）。
- 前缀统一 `/api/`，无版本号；命名有两种风格：小写连字符（`/api/test-send`、`/api/console/notify-ai`、`/api/workspace/reset`）与驼峰（`/api/socialV2/*`，唯一一组）。
- 有 3 个端点 GET 同时承担「读配置 + 读列表」：`/api/social`（`console.html:4064`）、`/api/whitelist`（`console.html:3086`）、`/api/slang`（`console.html:4315`、`console.html:4491` 各取一部分）。
- 少数端点把参数放 query 而不是 body：`/api/roles/content?name=`、`/api/socialV2/state?key=`、`/api/socialV2/initial-prompt?key=`、`/api/tokens/turns?key=&limit=`。

### 3. 鉴权与令牌输入流程

1. **入口带 token**：桥接启用鉴权后，根路径会重定向到带 `?token=` 的地址；页面第一段脚本把它存进 `localStorage.consoleToken`，并用 `history.replaceState` 把 token 从地址栏抹掉（`console.html:2745-2753`）。
2. **每次请求带 token**：`api()` 统一加 `x-console-token` 头（`console.html:2755-2759`）。
3. **401 交互**：收到 401 时 `prompt()` 让用户粘贴令牌，最多重试 2 次；仍失败则清掉本地令牌并抛 `未授权`（`console.html:2760-2772`）。注意 `prompt()` 被取消（返回空）也会清令牌并直接失败。
4. **改令牌**：访问与安全页底部「控制台访问令牌」——password 输入框 + 保存令牌 / 生成随机令牌（`console.html:2605-2613`）。前端校验「至少 16 位」（`console.html:4556-4559`），保存成功后把新值写回 `localStorage` 让当前页继续可用（`console.html:4568-4569`）；「显示令牌」按钮是后来插入的（`console.html:4765-4774`），页面 HTML 里没有这个按钮。
5. **失败观感**：401 会触发顶部横幅「访问令牌无效或已取消输入。请使用启动日志中的控制台链接重新打开。」（`console.html:4664`），并把 DSH/SnowLuma 指标置为「未知 / 过期」（`console.html:4653-4662`）。

服务端侧（桥接侧）对应实现：

- 令牌来源：`config.consoleToken`，非法/为空则回退到自动生成并持久化到 `state/console-token`；**为空时拒绝以无鉴权方式启动控制台 API**（`bridge.js:3731-3745`）。
- 校验：每个请求都要 `x-console-token` 头**或** `?token=` 查询参数，不匹配则 401（浏览器导航请求回一段 HTML 提示，XHR 回 JSON `{ok:false,error:"未授权：请提供控制台访问令牌"}`，`bridge.js:3872-3889`）。
- 免鉴权例外：`/favicon.ico`、`/apple-touch-icon.png` 直接 204，避免 DevTools 刷 401 噪音（`bridge.js:3850-3853`）。
- 无令牌的「智能体调用」默认拒绝，只对 `/api/status` 放行一个最小对象（`bridge.js:3919`、`bridge.js:3985`）。
- 令牌更换：`POST /api/console/token` 会同时改内存与 `state/console-token`（`bridge.js:4907-4911`）。
- 特例：云端语音「参考音频下载」把令牌拼在 query 上开新窗口（`console.html:5406-5408`），因为 `<a>` 无法带头。

### 4. 前端约定

- **主题**：`<head>` 里先跑一段内联脚本，在样式表之前决定 `data-theme`，避免首屏闪一下浅色（`console.html:8-20`）；浅色变量在 `:root`（`console.html:22-105`），深色在 `[data-theme="dark"]` 整段覆盖（`console.html:1337-1412`）；切换按钮逻辑在 `console.html:5206-5229`：写 `localStorage` 的 `qq-console-theme`，没存过就跟随系统 `prefers-color-scheme` 并监听变化；`aria-pressed` / `aria-label` / `title` 同步更新（`console.html:5213-5221`）。
- **布局**：固定 234px 侧栏 + `margin-left` 主区（`console.html:183-194`、`console.html:302-305`）；两个断点 1180px / 760px（`console.html:1044-1323`，760px 以下侧栏变成横向滚动导航、`#mainNav` 隐藏图标与计数）；装饰性光斑 `.bg-decor` 固定层 + 内容层 `z-index:1`（`console.html:1414-1458`）；`prefers-reduced-motion` 关掉所有动画（`console.html:1324-1331`、`console.html:1706-1721`）。
- **搜索**：索引在页面加载时一次性建好——每个 section 的 `h2` + 每个 `details>summary` + 每个 `input/textarea/select`（`console.html:4700-4708`）；匹配串是「页面标题 + 条目文本 + 控件 id」（`console.html:4714`），最多 12 条；点击后：切页 → 逐层展开祖先 `details` → 若是黑话分页则先切 tab → `scrollIntoView` + `focus` + 2 秒高亮（`console.html:4721-4733`）。键盘：`Esc` 关闭，`↓/Enter` 把焦点移进结果（`console.html:4740-4743`）；点空白处关闭（`console.html:4744`）。**按钮文字、表格内容、`<option>` 文本不在索引里**。
- **键盘与无障碍**：`skip-link`（`console.html:1762`、`console.html:4628-4632`）；加载时给所有没标签的控件自动补 `aria-label`，成对的 min/max 输入还会加「（下限）/（上限）」（`console.html:4675-4690`）；主要动作按钮统一加 `.primary`（`console.html:4692-4693`）；消息元素加 `role="status"`（`console.html:4694`）；黑话弹窗用 `MutationObserver` 管理焦点进出 + `Tab` 循环 + `Esc` 关闭（`console.html:4748-4764`）。
- **提示**：全局 toast 固定底部居中、4.2 秒消失（`console.html:4591-4597`、`console.html:997-1010`）；连接类错误走 `#connectionAlert` 横幅（`console.html:4653-4666`）；表单级反馈统一是 `.meta.ok` / `.meta.err` 行内文本；破坏性操作一律 `confirm`，失败用 `alert`（如 `console.html:3109-3113`、`console.html:4288-4292`）。
- **轮询**：核心 5 个刷新函数每 **3 秒**一次（`console.html:5202`）；用量看板另有一条 3 秒定时器，但只在当前页是 `usage` 时执行（`console.html:5204`）；语音库**不**进轮询，只在首次进二代页或点「刷新语音库」时探测（`console.html:4614-4615`、`console.html:3308-3309`）；轮询时刻意跳过正在编辑的控件（`console.html:2839`、`console.html:4061`、`console.html:4987-4988`）。
- **图表与安全**：控制台 CSP 是 `default-src 'self'`，所以不引图表库，走势图用 `createElementNS` 手写 SVG（注释 `console.html:4775-4788`）；所有外部数据插值都要过 `esc()`（`console.html:2775`），语音库文件名甚至专门写了注释说明「放一个恶意文件名即可注入」（`console.html:3325-3331`），价目表单价的覆盖值也走 `esc()`（`console.html:5100-5102`）。

## 三、两套界面的分工与重叠

先给结论：**两套界面写的是同一批配置文件，但覆盖的「面」不同**——设置页是「配置 + 内容管理」，控制台是「运行时观测 + 应急操作 + 黑话/人格/用量」。重叠区集中在「运行模式、白/黑名单、一代/二代参数、人格文件、语音包、重启」。

| 能力 | 插件设置页 | 浏览器控制台 | 权威 / 冲突 |
| --- | --- | --- | --- |
| 运行模式 | QQ 高级里一个 select，5 个选项（多加 `simulation`）（`client.js:1811-1815`） | 总览 4 张卡 + 封闭 Agent preset 下拉（`console.html:1801-1813`、`console.html:2863-2879`） | 同一份 `config.mode`。控制台多了 preset 与「写穿失败」告警；设置页多了 `simulation` 别名。两边都能改，**后写者赢** |
| 群/私聊白名单 | `allow.groups` / `allow.private` + 全放行开关 + 管理员一键加入（`client.js:515-565`） | 两个逗号分隔输入框（`console.html:2541-2558`），提交时**不校验格式**、只 `Number()` 过滤（`console.html:3261`） | 同一份 `config.allow`。控制台缺 `allowAllWhenEmpty`；设置页缺「保存后立即生效」的原子提示 |
| 黑名单 | 三档：`deny.users` / `deny.groups` / `deny.private`（`client.js:575-636`） | 只有群与私聊两档（`console.html:2550-2553`） | 桥接对 `deny.users` 做了「请求没带就保留原值」的保护（`bridge.js:4749-4755`），所以控制台保存不会抹掉人的黑名单；**但**控制台读失败时输入框为空（`console.html:3092` 的 `catch {}`），此时保存会清空群/私聊两份名单 |
| 管理员 | 独立卡片，QQ + B站 mid + 称呼 + 温柔开关（`client.js:396-463`） | 一个 `ownerQQ` 输入框（`console.html:2547-2549`） | 控制台保存空值 = 清除管理员并 fail-closed（`bridge.js:4756-4765`）；设置页是双平台身份，信息更全 |
| 一代仿真参数 | 19 组、约 100 个字段（`client.js:691-912`） | 一页 20 来个字段（`console.html:1900-2001`），单位是「秒/分」（`console.html:4066-4092`） | 同键同义但**单位与默认值各写一份**；设置页用 ms，控制台分/秒来回换算会四舍五入丢精度（如 90 秒 ↔ 2 分钟） |
| 二代参数 | 10 组：唤醒/收尾/历史/发送/等待/上下文/主动/反馈/表情/语音/工具/媒体（`client.js:759-877`、`client.js:1693-1719`） | 15 个折叠组（`console.html:2081-2407`，保存逻辑 `3458-3558`） | 重叠 9 组；设置页独有 `closure`（对话收尾）、`tokenGuard`（防爆破）、`media`、`initialPromptMaxChars`；控制台独有工具开关 UI、逐会话初始提示词、轻量记忆、唤醒状态、工具日志、AI 反馈、暂停/重置/立即唤醒 |
| 语音包 | 安装/启停/云端密钥/试听/触发规则（`client.js:2966-3109`） | 同样一套（`console.html:2002-2079`、`5231-5411`）+ 二代页里的调试面板（`console.html:2138-2157`） | 能力重复度最高；控制台那页**实际打不开**（§四.1），所以运行态权威在设置页 + 二代页调试面板 |
| 人格提示词 | 编辑当前角色全文 + 历史备份（`client.js:2515-2561`） | 列表/新建/改名/删除/副本 + 注入上限 + **仿真提示词**（`console.html:2827-3234`） | 同一批 `roles/*.md`；控制台多了「仿真提示词」（预设源文件 → DSH preset 目录）与按代分小节；设置页多了备份恢复与「人格卡跟着角色走」的绑定 |
| 记忆卡 | 衰减卡/全量卡/双向同步/审计（`client.js:2566-2863`、`client.js:3111-3219`） | **完全没有** | 权威在设置页 |
| 黑话 | 只有「黑话学习」参数组（`client.js:891-900`） | 完整词库：候选/确认/拒绝、批量、深度研究、参数（`console.html:2408-2523`、`4174-4518`） | 词条权威在控制台；参数两边同键（`slang.*`），都可写 |
| Token | 额度上限（`client.js:3823-3944`） | 用量/花费看板 + 清空账本（`console.html:2661-2712`） | 不同维度、不冲突；命名容易混（控制台还有「控制台访问令牌」） |
| 重启 | 概览启动/重启/停止 + 底部「保存并重启」+ QQ 页「重启 QQ 桥接」（`client.js:1154-1157`、`client.js:4289`、`client.js:1817-1821`） | 「桥接控制」一个按钮（`console.html:2632-2642`） | 语义相同（`/bridge restart` vs `/api/restart`），三处入口 |
| B站 自动化/鱼群/分享/桌宠/目的 | 全部在设置页 | 无 | 权威在设置页 |
| 模型与思考强度 | QQ 参数 `dsh.model` / `dsh.reasoningEffort`（`client.js:695-696`） | 独立卡片，且会写 DSH **全局**默认（`console.html:2567-2578`、`console.html:3075-3077`） | 同名概念、不同层：控制台改全局、设置页改 QQ 会话参数；调完一处会让人觉得另一处「没生效」 |

**同键双写清单**（这些键在两边都有输入框，改前先确认另一处不会被顺手覆盖）：

- `allow.groups` / `allow.private`：`client.js:532-547` ↔ `console.html:3263`。
- `deny.groups` / `deny.private`：`client.js:603-619` ↔ `console.html:3264`（`deny.users` 只有设置页，`client.js:595-601`）。
- `ownerQQ`：设置页经 `unified.admin.qq` 投影（`client.js:392-395`）↔ 控制台直接写（`console.html:3265`）。
- `mode`：`client.js:1812` ↔ `console.html:2867`（控制台还带 `closedAgentPreset`）。
- `social.*`：`client.js:729-758` ↔ `console.html:4125-4153`（控制台按 POST body 逐字段提交，`console.html:4123-4157`）。
- `socialV2.*`：`client.js:759-877` ↔ `console.html:3458-3552`（控制台按 15 个分组整体提交；表单里没有的子键不会出现在 body 里，是否保留取决于后端合并策略，改前先看 `saveV2Config` 的 body 形状）。
- `slang.*`：`client.js:891-900` ↔ `console.html:4503-4513`。
- `roles/<name>.md`：`client.js:2524-2531` ↔ `console.html:3163-3164`（同一个文件，后写者覆盖）。
- 语音包目录与 `voice/rules`：`client.js:3020-3037` ↔ `console.html:5310-5398`。

**一句话权威表**：配置内容（白/黑名单、模式、参数）→ 两处都能写，以最后保存者为准；内容资产（人格卡、记忆卡、角色包、B站 行为账本）→ 设置页；黑话词库、运行观测、会话/审批、用量、应急重启 → 控制台。

## 四、边界与已知问题

1. **控制台的「语音」页打不开（代码级 bug，2026-10-26 已修）**：`#section-voice` 声明 `data-page="voice"`（`console.html:2002`），导航按钮也是 `data-view="voice"`，但 `consolePages` 没有 `voice` 键（`console.html:4577-4588`），而 `setConsolePage()` 对未知 page 直接回退到 `overview`（`console.html:4599`）。结果是点「语音」落到运行总览，`#section-voice` 永远 `hidden`。
   **修法（已采用）**：删掉导航按钮，并把区块改成**没有 `data-page`、自带 `hidden`**——
   这样 `data-view` 与 `data-page` 仍然一一对应（10/10，控制台静态契约测试要求），
   区块也永远不会被 `setConsolePage` 显示出来。
   ⚠️ 区块本身**保留没删**：页内还有 JS 绑在它的元素上（`vpLoad()` 等），删区块会连带坏掉控制台初始化。
2. **两类 401 互不相通**：控制台 `/api/*` 要 `x-console-token` / `?token=`（`bridge.js:3872-3889`）；设置页 `/dsh-surfcore/api/*` 要 DSH 会话，非 DSH 客户端会被 `connection.requestRejection` 拦成 401（`pet-api.js:5`、`index.js:2151` 注释），所以桌宠改用独立 `pet-api` 令牌口。拿控制台令牌去调设置页 API（或反之）一定失败。
3. **设置页保存的爆炸半径**：任一标签页点「保存」都会把三份配置整份 POST（`client.js:4199`）；「全部参数」页能改任意键（包括各类 token 键），没有按页隔离、也没有 version/ETag 乐观锁——两个窗口同时编辑，后保存者静默覆盖。
4. **额度先落盘、配置后落盘**：`save()` 先提交 `/token-budget` 再提交 `/config`（`client.js:4194-4199`），第二步失败时额度已生效，界面只显示一条错误。
5. **JSON 字段静默失败**：`JsonCell` 解析失败只显示红字，父组件保留上一次合法值，用户仍可点保存（`client.js:347-362`）；扩展配置的 `JSON.parse` 失败只弹 toast（`client.js:3376-3384`）。
6. **控制台白名单保存的「空表单覆盖」**：`refreshWhitelist()` 把异常吞掉（`console.html:3092`），GET 失败时输入框保持空；此时点「保存白名单」会提交空数组（`console.html:3260-3269`），等于清空白/黑名单，且 `ownerQQ` 也被清成空 → fail-closed。
7. **控制台切模式可能被回滚**：桥接写穿 DSH 失败时返回 `dshSynced:false`，前端只 `alert` 一次（`console.html:2870-2874`）；随后 3 秒轮询（注释里写的是「5 秒」，实际定时器 3000ms，见 `console.html:5202`）用服务端值覆盖按钮状态。
8. **只在某些模式/平台出现的控件**：
   - `chat.*` 一组只在 chat 模式生效，reserved2 下照常显示但无效（hint 自带说明，`client.js:878-890`）。
   - 设置页模式下拉含 `simulation`（`client.js:1815`），控制台只有 4 种（`console.html:1804-1807`）。
   - 桌宠相关（载体选择、对话、形象）依赖本机安装，未安装时只显示指引（`client.js:3989-4056`）。
   - 云端语音表单只在装了 `voice-cloud` 时出现（`client.js:3089`、`console.html:5251-5253`）。
   - `state/` 权限告警只在 Windows 未提权时出现，并给出可复制的命令（`console.html:2589-2596`、`console.html:4523-4532`）；B站 会话权限 hint 里也带了一处本机路径示例（`client.js:1024`，本文已略）。
   - 旧宿主兼容分支：`labelsSupported`、`actions`、`/bili/automation`、`/bili/qr/start` 都有「重启 DSH 后可用」的降级文案（`client.js:1839`、`client.js:2085`、`client.js:3231`、`client.js:2136`）。
9. **纯只读展示（不能改）**：设置页的概览 kv、`AutomationCard`、观看历史、鱼群/点赞历史、云端用量、两份注入预览、全量记忆卡、同步审计、体检与路径、`self.mid/name`、`diary.enabled`；控制台的会话表、挂起列表、工具参考表、工具日志/记忆/唤醒状态（只提供清空与有限编辑）。
10. **深色主题下的硬编码颜色**：`PurposeCard` / `PurposeCarrierCard` 用的是固定浅色（`#e3e6ee`、`#fafbff`、`#6aa9ff` 等，`client.js:1370`、`client.js:1503-1527`），在 DSH 深色主题里会显得突兀；语音页也用了 `#fff` / `#e66` / `#67c23a`（`client.js:2896-2908`、`client.js:3077-3078`）。控制台没有这个问题（全走 CSS 变量）。
11. **控制台的残余转义缺口**：语音库文件名已转义（`console.html:3325-3331`），但 `vpCard()` 直接拼 `p.name`、`about.summary/pros/cons`（`console.html:5260-5296`）。这些字段目前来自服务端常量，属残余风险而非可利用路径。
12. **控制台搜索覆盖面有限**：只索引 section 标题、`details>summary`、表单控件（`console.html:4700-4708`）；按钮文案、表格内容、`<option>` 文本搜不到，所以搜「立即分享」「分享时间点」多半没结果。
13. **设置页 dirty 判定过粗**：整串 `JSON.stringify` 比较（`client.js:4170`），服务端回写只要键序或数字格式有差异就会一直显示「有改动还没保存」；没有字段级回滚。
14. **安装/探测类操作没有超时提示**：语音包安装轮询上限 240 × 1.5 s ≈ 6 分钟，超时后**静默停止**、界面仍显示安装中（`client.js:2989-2991`）。
15. **控制台 3 秒重绘黑话页**：每次 `refreshSlang()` 都重建表格与事件监听（`console.html:4238-4310`、`console.html:5202`），词条多时是明显性能点，也会打断正在进行的多选（`slangSelected` 是 Set，选中态保留，但滚动位置会跳）。
16. **插件侧没有本地化**：`locale/zh.json` / `en.json` 只有 `meta.title` 与 `meta.description` 两句（`zh.json:2-5`），标签页标题、导航名（`client.js:4077`、`client.js:4330`）和全部 UI 文案都是硬编码中文；控制台同样零 i18n。

17. **两套界面的叫法不统一（会误导排查）**：同一个东西在不同地方叫不同名字——限流/花费那块，设置页叫「Token 额度」、控制台叫「令牌与花费」（且控制台另有「控制台访问令牌」）；模式在代码里是 `reserved`/`reserved2`，控制台显示「一代仿真/二代仿真」；控制台的「会话映射」「工具参考」在设置页完全没有对应页，而设置页的「目的」「桌宠」「观看历史」「对齐」在控制台也没有入口（`client.js:4061-4076` ↔ `console.html:4577-4588`）。报障时先对齐叫法，否则容易两边各改一半。

## 五、未覆盖与复核建议

**已覆盖**：`client.js` 全 4349 行（11 段连续读完；其中 451–606 段被输出上限截断，下一段从 607 续读，无跳读）、`console.html` 全 5416 行（12 段连续读完）、两个 locale 文件；另按需查阅了 `src/bridge.js` 的鉴权、白名单合并、控制台静态页三处实现，用于确认「谁能覆盖谁」。

**未覆盖 / 未验证**：

- 没有启动桥接或 DSH，**所有行为判断都来自代码路径，不是实测**（包括 401、空表单覆盖、模式回滚）。
- 没有逐条核对 `/dsh-surfcore/api/*` 每个 handler 的字段语义（例如 `/purpose/*` 的载体路由、`/characters` 的存档槽规则），只以客户端调用点与返回字段名为准。
- 没有覆盖 DSH 侧 `settings.section` 的宿主渲染行为（`order:7` 的实际排序、`label()` 何时被调用）。

**复核建议（按收益排序）**：

1. 用 `npm run preview:console` 离线预览：侧栏现在**没有**「语音」入口（2026-10-26 已删）。
   控制台的语音包/试发面板停在 `#section-voice` 里、永不显示；要恢复整页需同时把区块的 `data-page="voice"`、
   `consolePages.voice`、导航按钮一起加回来，并重新验证页内脚本。
2. 给设置页保存加 `version`/ETag（后端 `/config` 返回 revision，`POST` 带上），消除多窗口静默覆盖。
3. 把单位换算与默认值收敛到单一常量表（ms 为唯一存储单位，控制台只在渲染层换算），避免 90 秒 → 2 分钟这类丢精度。
4. 控制台白名单页加「读取失败禁用保存」，或保存前先 GET 一次做 diff，避免空表单清库。
5. 把本文 §三 的表当变更检查单：任何新增配置键，先决定归属（设置页 / 控制台 / 两者），再决定谁权威，并在表里加一行。




## 附录、配置键 → 界面入口（反查表）

用户问「这个键在哪改」时用这张表；同一键出现在两处时会标出（冲突判断见 §三）。

| 配置键（组） | 所在文件 | 设置页入口 | 备注 |
| --- | --- | --- | --- |
| `dsh.baseUrl/provider/model/reasoningEffort/authToken/allowRemote`、`agentPreset`、`workspaceTitle`、`sessionCwd` | QQ `config.json` | QQ 高级「连接与身份」（`client.js:692-704`） | 「运行模式」select 也在这组里插入（`client.js:1811`） |
| `snowluma.*` | QQ | QQ 高级「SnowLuma」（`client.js:705-715`） | `allowLaunch` 默认关 |
| `consolePort`、`consoleToken` | QQ | QQ 高级「控制台」（`client.js:716-722`）；控制台访问页另有一套令牌 UI（`console.html:2605-2613`） | 两处写的是同一个键 |
| `allow.groups/private`、`allowAllWhenEmpty`、`deny.users/groups/private` | QQ | QQ 页三张卡（`client.js:515-636`）；控制台访问页（`console.html:2541-2558`） | 控制台没有 `deny.users` 与 `allowAllWhenEmpty` |
| `ownerQQ` | QQ | 由 `unified.admin.qq` 投影（`client.js:392-395`）；控制台直接输入（`console.html:2547-2549`） | 控制台清空 = fail-closed |
| `mode` | QQ | QQ 高级运行模式（`client.js:1811-1815`）；控制台总览（`console.html:1801-1813`） | 控制台附带 `closedAgentPreset` |
| `social.*`（一代，24 项） | QQ | QQ 高级「一代仿真」（`client.js:729-758`）；控制台一代页（`console.html:1900-2001`） | 单位/默认值两套 |
| `socialV2.*`（含 wake/send/wait/proactive/context/history/feedback） | QQ | QQ 高级多组（`client.js:759-877`）；控制台二代页（`console.html:2081-2407`） | 重叠 9 组 |
| `socialV2.tools.*` | QQ | QQ 高级动态「二代 · 工具开关」（`client.js:1693-1695`）；控制台工具开关（`console.html:2101-2133`） | 同一份工具面 |
| `socialV2.closure.*` | QQ | QQ 高级「对话收尾判断」卡（`client.js:1634-1686`） | 控制台没有 |
| `socialV2.tokenGuard.*` | QQ | QQ 高级「Token 防爆破」（`client.js:791-798`） | 控制台没有 |
| `socialV2.sticker.*` | QQ | QQ 高级「表情包」（`client.js:1696-1706`）；控制台「表情包参数」（`console.html:2269-2295`） | — |
| `socialV2.voice.*` | QQ | QQ 高级「语音」（`client.js:1707-1719`）；控制台「语音库与语音发送（调试）」（`console.html:2138-2157`） | 控制台只做调试/试发 |
| `fishGuard.*`（QQ 侧：`fishIds/exemptIds/groupNestIds` 等） | QQ | QQ 高级「鱼群判定关键词 / 鱼群保护」（`client.js:766-790`）+ QQ 触发卡（`client.js:1230-1274`） | 触发卡只读 |
| `fishGuard.*`（B站 侧：`extraFishMids/gather*/like*`） | B站 | B站 高级同名两组（`client.js:991-1022`）+ 运行状态卡（`client.js:1905-2005`） | 两侧同名不同文件 |
| `chat.*` | QQ | QQ 高级「群聊（chat 模式）」（`client.js:878-890`） | 只在 chat 模式生效 |
| `slang.*` | QQ | QQ 高级「黑话学习」（`client.js:891-900`）；控制台「黑话系统参数」（`console.html:2492-2522`） | 词条本身只在控制台 |
| `webSearch.*` | QQ | QQ 高级「联网搜索」（`client.js:901-911`） | — |
| `biliBridge.*` | QQ（写在 QQ 文件里） | B站 页顶部「定时分享视频到群」（`client.js:925-937`、`client.js:1857-1900`） | 名字像 B站、文件在 QQ |
| `greetings.*` | QQ | QQ 高级「QQ 早安问候」（`client.js:1776-1805`） | 需要互为好友 |
| `night.*` | B站 | B站 页「作息窗口」编辑器（`client.js:1056-1076`）+ 作息组（`client.js:945-950`） | — |
| `preferences.*`（含 `weights`） | B站 | B站 高级「口味权重 / 一键抓取」（`client.js:2222-2260`）+ 口味组（`client.js:951-955`） | 权重是对象，不是数组 |
| `share.*`、`quota.shareDaily`、`limits.*`、`dynamics.*` | B站 | B站 高级「分享 / 额度 / 四类动态」（`client.js:956-990`） | 见下方同名警告 |
| `listen.*`、`diary.*`、`notify.*` | B站 | B站 高级「倾听 / 日记与推送」（`client.js:1028-1048`） | `diary.enabled` 只读 |
| `agent.sandbox`、`toolsPath` | B站 | B站 高级「会话权限 / 工具链」（`client.js:1023-1027`、`client.js:1049-1051`） | — |
| `admin`、`platforms.start.{qq,bili}`、`bridge.startupNotify`、`persona.file`、`pet.chat.*`、`memoryCard.*`、`memory.qqToBili.*` | `unified` | 分别在管理员卡/平台启动卡/概览启动卡/角色页/桌宠页/记忆页（`client.js:4168`、`1737`、`1201`、`2547`、`3953`、`2634`、`3128`） | `__biliToQqToggle` 只是过渡键，保存前被删（`client.js:4184-4189`） |
| Token 预算 `limits.qq/bili/other/total.{cny,tokens}` | 桥接侧额度账本 | Token 额度页（`client.js:3776-3944`） | **与 B站 的 `limits.daily/replyDaily/…` 同名但完全无关**：一个管钱/token，一个管评论条数 |

