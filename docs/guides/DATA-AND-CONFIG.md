# 数据与配置（DATA-AND-CONFIG）

> 这份文档回答：**配置写在哪、每个键管什么、改了什么时候生效**；**运行时数据存在哪、谁写谁读、能不能删**。
>
> 一句话记住：**三份配置、两个状态根、一个角色包**。
> **最后核对**：2026-10-26（全仓库逐行梳理）。配套阅读：总纲 [ARCHITECTURE.md](ARCHITECTURE.md) · 边界 [BOUNDARIES.md](BOUNDARIES.md) · 索引 [../README.md](../README.md)。

---

## 0. 一张图

```
<仓库根>/config.json                 ← QQ 桥接配置（模板 config.example.json，同时是插件的默认层）
   │  桥接直接读；插件 readQqConfig() 读「模板 + 用户」合并结果
   ▼
<仓库根>/state/                       ← 桥接的运行时数据（gitignore）
   sessions.json  mode.json  social-v2.json  console-token  bridge.log  …
   voice-packs/  voice-tts/

~/.dsh/surfcore/                     ← 插件的运行时数据（gitignore 不到的机外目录）
   config.json                       ← 合体层配置（记忆同步/身份对齐/管理员/扩展/平台/UI）
   bili.config.json                  ← B站 配置
   characters/<id>/                  ← 角色包：人格卡 + 记忆卡 + B站 行为账本
   memory/                           ← 当前角色的记忆卡（有角色时在角色包里）
   pet/                              ← 桌宠发现文件与令牌
   bili/credentials.json, owner-credentials.json
   backups/  plugin.log  audit.jsonl

<仓库根>/roles/*.md                   ← 旧布局人格卡（角色系统会迁移）
<工作区>/voice/, <工作区>/pet/          ← 仓库外的语音引擎与桌宠工程
```

---

## 1. `config.json`（QQ 桥接）

> 模板：`config.example.json`（410 行）。**模板不是纯文档**：插件的 `readQqConfig()` 会把它当默认层
> deepMerge（`plugins/surfcore/lib/store.js:272-280`），所以模板里没有的键 = 插件视图中没有默认值。

### 1.1 DSH 连接与会话

| 键 | 默认 | 作用 | 备注 |
| --- | --- | --- | --- |
| `dsh.baseUrl` | `http://127.0.0.1:3080` | DSH Web 地址 | ⚠️ **会漂移**；只在 `DSH_WEB_URL` 缺失时用作回环兜底，正常走 `discoverDshBaseUrl()` |
| `dsh.provider` / `dsh.model` | `deepseek-official` / `deepseek-flash` | 会话用哪个模型 | 桥接按会话 `session.selectModel` 固定 |
| `dsh.reasoningEffort` | `max` | 思考强度 | 可选 `high` / `low`，下一条消息生效 |
| `dsh.authToken` / `authHeader` / `authPrefix` | 空 / `authorization` / `Bearer` | 直连 DSH 的静态凭据（一般留空，走离线铸造 Cookie） | |
| `dsh.allowRemote` | `false` | 是否允许非回环的 DSH 地址 | 默认关：本机之外的地址一律不认 |
| `sessionCwd` | 空 | DSH 会话的工作目录 | 空 = 用 DSH 默认 |
| `agentPreset` | `qq-chat` | 一代/普通模式用的 preset | `reserved2` 用 `socialV2.agentPreset` |
| `workspaceTitle` | `QQ 聊天` | 会话统一归到哪个工作区 | 不再散落未分组 |
| `role.maxInjectChars` | `6000` | 人格卡注入上限 | 超了截断并告警 |

### 1.2 B站 桥接（`biliBridge`）

| 键 | 默认 | 作用 |
| --- | --- | --- |
| `enabled` | `true` | 桥接是否读 B站 记忆并注入 QQ |
| `memory.enabled` | `true` | B站 → QQ 记忆（只读公开内容，私信/日记转述整段丢弃） |
| `memory.refreshIntervalMs` | `600000` | 刷新周期 |
| `dynamics.enabled` / `pollIntervalMs` | `true` / `180000` | 动态轮询；新动态可推到指定群 |
| `dynamics.groups` | `[]` | 推到哪些群 |
| `share.enabled` / `times` / `groups` / `gapMs` | `true` / 8 个整点 / `[]` / `4000` | **B站 视频分享到 QQ** 的时间表与间隔 |
| `share.card` / `cardMode` | `true` / `text` | 分享用卡片还是纯链接（小程序卡在 QQ 侧已下架，默认文本链接卡） |

### 1.3 SnowLuma（`snowluma`）

| 键 | 默认 | 作用 |
| --- | --- | --- |
| `wsUrl` / `httpUrl` | `ws://127.0.0.1:3001` / `http://127.0.0.1:3000` | OneBot WS 与 HTTP |
| `accessToken` | 空 | SnowLuma 的 token（**HTTP 与 WS 可能是两个不同值**） |
| `followDiscoveredEndpoint` | `true` | 端点自愈：跟随 SnowLuma 实际监听的地址（会覆盖你手写的 `wsUrl`） |
| `silenceWarnMs` | `600000` | 多久没消息告警（注意：心跳是本地生成的，不能用来判断 hook 死活） |
| `launcherPath` / `launchScript` | 空 | 「一键打开」用的路径（**只打开，不安装、不部署、不代扫码**） |
| `allowLaunch` | `false` | 是否允许设置页打开 SnowLuma 窗口 |
| `homeDir` / `downloadUrl` | 空 / GitHub Releases | 安装检测与提示 |

### 1.4 身份：`ownerQQ` / `admin`

- `ownerQQ`：主人 QQ 号。`closed-agent` 模式只认这个人。
- `admin`：管理员双身份（QQ + B站 mid）。合体层是唯一真相，保存时投影到 `ownerQQ` 与 `bili.config.json` 的 `owner`。
- 注入规则：开了 `gentle`（默认开）后，QQ 人设 / B站 每次醒来都会带"对管理员更温柔、绝不回嘴"的硬规则；B站 提示词里**不出现**管理员 QQ 号。

### 1.5 准入：`allow` / `deny` / `allowAllWhenEmpty`

| 键 | 默认 | 作用 |
| --- | --- | --- |
| `allow.private` / `allow.groups` | `[]` | 白名单：不在里面 = 不响应（发送侧也是硬闸） |
| `deny.users` | `[]` | 人的黑名单：这个人说什么都不响应（**拦截点在入库/唤醒之前**） |
| `deny.private` / `deny.groups` | `[]` | 会话黑名单，优先级高于白名单 |
| `allowAllWhenEmpty` | `false` | 白名单为空时是否放行**所有**会话。默认 false = 空白名单等于谁都不响应（而不是全放行） |

### 1.6 控制台与交互

| 键 | 默认 | 作用 |
| --- | --- | --- |
| `timezone` | 空 | 自定义时区（覆盖系统时区）：IANA 名或 `UTC+8`；空 = 跟随系统。环境变量 `SURFCORE_TIMEZONE` 优先。见 [TIMEZONE.md](TIMEZONE.md) |
| `consolePort` | `3100` | 控制台端口（`stop-qq-bot.ps1` 也读它） |
| `consoleToken` | 空 | 控制台令牌；空 = 自动生成到 `state/console-token` 并在日志打印前 6 位 |
| `ackMessage` | 空 | 收到消息时的回执文本（空 = 不回执） |
| `sendDelayMs` | `300` | 连续发送的基础间隔 |
| `questionTimeoutMs` | `300000` | agent 提问等 QQ 回复的超时 |

### 1.7 计价与安全

| 键 | 默认 | 作用 |
| --- | --- | --- |
| `pricing.models` | 见模板示例 | 自定义模型价目（`label` + 分档单价），覆盖内置价目表 |
| `security.interceptNotify` | `true` | 拦截 agent 想"通知用户"类的越权动作 |

### 1.8 鱼群保护（`fishGuard`）

判"这堆人是不是在刷屏/围攻"，默认开。关键键：`windowMs`（10 分钟窗口）、`cooldownMs`、`maxFish`（鱼数阈值）、
`maxConsecutiveFish`、`maxFishRatio` + `minSample` + `minFishSendersForRatio`（比例判定要先有样本量）、
`namePrefixes/Suffixes/Contains`（怎么算"鱼"）、`groupNameSuffixes`（"肥鱼"群整体降权）、
`exemptIds/exemptNames/fishIds`（白/黑名单）、`bypassDirectAddress`（被 @ 时绕过）、`blockSends`（触发后是否拦发送）。

### 1.9 黑话学习（`slang`）

`enabled`、`extractMinMessages`（攒够多少条才提炼）、`extractCooldownMs`、`inferenceThresholds`（出现几次才敢用）、
`injectMax`（注入几条）、`learnerPreset`、`workspaceTitle`、`autoResearch`（是否允许把词条交给搜索后端——
关掉可减少出机数据）。

### 1.10 一代仿真（`social`）

观望/活跃/试探/退场状态机：`triggerProbability`（0.1）、`activeCheckMinMs/MaxMs`、`idleWindowMs`、
`mustReplyKeywords`（必须回的词）、`contextWindow`、`burstEnabled` + 分条间隔、`skipProbability`、
`proactiveEnabled` + 空闲阈值与主动搭话概率。**分条规则**：一代按空格分句。

### 1.11 二代仿真（`socialV2`）

| 子段 | 关键键 | 作用 |
| --- | --- | --- |
| 总开关 | `enabled`、`autoReplyCheckMs`、`agentPreset`（`qq-chat-v2`）、`provideRecommendations` | 二代是"一切皆工具"，文本不自动发送 |
| `tools` | 31 个布尔开关 | **逐个工具的开关**：发消息/引用/分条/等待/表情/语音/记忆/黑话/收尾…默认全开，`setStickerRemark` 与 `sendVoice` 默认**关** |
| `wake` | `defaultMode`（diving）、`preSleepWaitEnabled`、`preSleepWaitMs`（300000）、`batchWindowMs`、`maxWakePerMinute/Hour`、`noActionLimit`、`recommended*` | 唤醒调度与"沉睡前观察"的强制窗口 |
| `closure` | `enabled`、`cooldownMs`（20 分钟）、`requireNoOpenQuestion`、`promptInWake`、`maxSummaryChars`、`maxNextOpeningChars` | 对话收尾：冷却只压普通概率唤醒，@/提问/私聊不压 |
| `send` | `burstMaxMessages`（8）、`maxSendPerMinute/Hour`、`maxMessageChars`（500）、`gap*` | 发送节流与硬上限（超长 400、超条数 429） |
| `tokenGuard` | `maxWakesPerDay`（群 20 / 私聊 10）、`minWakeGapMs`（2 分钟）、`directBypassGap`、`maxOutboundPerTurn`、`maxDailyCostCNY` | 防爆破：@/引用/拍一拍可越过 2 分钟间隔，但每日次数仍生效 |
| `wait` | `defaultMs`、`minMs/maxMs`、`defaultQuietMs`、`minQuietAfterNewMs` | `qq_wait_for_messages` 的参数边界 |
| `sticker` | `syncTtlMs`、`maxListCount`、`includeInPrompt`、`promptMaxStickers`、`match.topK/minScore`、`collect.*` | 表情包语义化与收藏限流 |
| `voice` | 见 §1.11.1 | 语音 |
| `proactive` | `enabled`、`checkInterval*`、`idleThresholdMs`、`probability` | 二代自己的主动搭话（与目的机制是**两套**，可分别关） |
| `feedback` | `maxLength`、`notifyOwnerOnError` | `qq_report_feedback` 工具 |
| `context` | `recentLimit`、`unreadLimit`、`contextWindow`、`inlineWakeMessages`、`wakeMessageLimit`、`wakeRecentLimit`、`wakeMaxChars`、`wakeFoldOld` | 注入多少上下文（token 成本的主要旋钮）。`wakeFoldOld`（默认 `true`）= 唤醒只带**最近一窗**、更早未读折叠成计数（PITFALLS #76）；设 `false` 恢复"从最早未读开始塞"的旧行为 |
| `history` | `enabled`、`limit`、`maxAgeMinutes`、`wake`、`includePrivate` | 上线补历史 |
| `initialPromptMaxChars` | `2000` | 每会话首次唤醒的"环境说明"上限 |
| `media` | `maxBytes`（8MB）、`maxPixels`（64MP）、`maxCount`（5） | 图片/表情/动图限制 |

#### 1.11.1 语音（`socialV2.voice`）

| 键 | 默认 | 作用 |
| --- | --- | --- |
| `enabled` | **`false`** | 语音总开关（没装引擎时开着只会一串 502） |
| `dir` | `audio` | 语音库目录（相对仓库根；`allowAbsolutePath` 控制能否写绝对路径） |
| `maxSeconds` / `maxBytes` | 300 / 20MB | 单个音频上限 |
| `maxPerMinute` / `maxPerHour` | 2 / 10 | 发送频率 |
| `defaultVolume` / `loudness` | 1 / `normal` | 默认音量与响度归一 |
| `ffmpegPath` | 空 | 自定义 ffmpeg（音量/时长探测） |
| `autoReadback` | `true` | 发完回读校验 |
| `tts.enabled` | **`false`** | 本地 TTS 现场合成开关 |
| `tts.baseUrl` | `http://127.0.0.1:8765` | 合成服务地址 |
| `tts.timeoutMs` / `maxChars` | 60000 / 120 | 超时与单次合成字数 |
| `tts.character` | 空 | 音色/角色 |
| `tts.route` + `tts.endpoints` | `local` / 8765+8767 | **本地 / 云端切换**；桌宠每次合成前重读磁盘，**桥接要重启才生效**（见 §1.11.1 末注） |
| `trigger.who` / `groups` / `members` | `owner` / `[]` / `[]` | 谁能触发语音（默认只主人） |

### 1.12 联网搜索 / 目的 / 问候

- `webSearch`：`provider`（`auto` → DeepSeek 优先、Bing 兜底）、`apiKey` / `apiKeyEnv`（默认 `DEEPSEEK_API_KEY`）、
  `model`、`maxUses`、`maxTokens`、`maxResults`、`timeoutMs`。
- `purpose`：`enabled`、`gapMinMs/gapMaxMs`（15–30 分钟随机间隔）、`initialDelayMinMs`、`dailyMax`（4）、
  `quietStart/quietEnd`（23:30–08:30）、`idleThresholdMs`（主人空闲 30 分钟）、`materialWindowHours`、
  `biliWindowDays`、`maxMaterials`、`minMaterials`、`retryMs`、`maxAttempts`、`maxCandidates`、`promptMaxChars`。
  ⚠️ 新版本还有 `carrier`（qq/pet）、`petModality`、`petFallbackToQQ`，**模板里没有**。
- `greetings.morning`：`time`（08:00）、`uin`、`name`；默认整体关。

### 1.13 ⚠️ 模板缺的四段

`config.example.json` **没有** `chat`、`platforms.start`、`pet`、`tokenBudget` 四段。
功能不受影响（代码各处有 `??` 兜底），但这意味着"模板即默认层"这一层缺键，新装用户从模板看不到这些能力。
修法要先定"哪一层是权威默认"（这是 RISK A5，刻意没动）。

---

## 2. `~/.dsh/surfcore/config.json`（合体层）

由插件 `store.js` 管理：**读给 UI 时脱敏**（`SECRET_PATHS`：`dsh.authToken`、`snowluma.accessToken`、
`webSearch.apiKey`、`consoleToken`），保存时 `********` 表示"保持原值"；写入前自动备份、原子替换；
`__proto__`/`prototype`/`constructor` 被禁止（防原型污染）。

| 段 | 关键键 | 说明 |
| --- | --- | --- |
| `version` / `qqbotRoot` | `1` / 自动探测 | 仓库根（插件可能以 link: 安装，不能假设层级） |
| `bridge` | `autoStart`、`startupNotify`、`consoleBase`、`startScript` | 桥接进程管理；`autoStart` 已迁移为 `platforms.start.qq` |
| `persona` | `file`、`injectInBili`、`compactChars`（2200） | 人格卡路径与注入预算 |
| `admin` | `qq`、`biliMid`、`biliName`、`displayName`、`gentle` | 管理员双身份 |
| `memory.qqToBili` | `enabled`（**默认 false**）、`lookbackDays`、`maxMessages`、`maxChars`、`intervalMs`、`includeOwner`、`includeAgentReplies`、`useNicknames`、`includeGroups` | QQ → B站 方向（默认关：公开平台要谨慎） |
| `memory.biliToQq` | `previewOnly` | 真正开关在 QQ 配置的 `biliBridge.memory.enabled` |
| `memory.privacy` | `blockPrivateMessages`、`blockSecrets`、`blockPii`、`blockContact`、`dropUnsafeLines`、`audit`、`maxAuditEntries` | 隐私闸门（默认全开） |
| `alignment` | `enabled`、`priority`（override-sync）、`injectInQQ/Bili`、`autoDetect`、`requireApproval`、`maxEntries` | 身份对齐（候选 → 审批 → 生效） |
| `memoryCard` | 见下 | 记忆卡配置，默认值直接 spread 自 `src/memory-card.js` 的 `DEFAULT_MEMORY_CARD_CONFIG` |
| `extensions` | `enabled`、`disabled` | 扩展总开关与禁用列表 |
| `platforms` | `enabled`（qq/bili）、`planned`（tieba）、`start.qq/bili` | **平台启动开关的唯一真相**（关掉即停，打开即启） |
| `ui` | `activeTab`、`showAdvanced` | 界面偏好 |
| `updates` | `enabled`、`checkOnStart`、`startDelayMs`（20s）、`intervalMs`（6h）、`components[]`、`pet.versionUrl`、`voice.localVersionUrl`、`voice.cloudVersionUrl` | **组件更新**（2026-10-26）：一个面板同时查 SurfCore 本体 / 两个语音包 / 桌宠 / 自定义组件。两条通道：**git**（`fetch` 只读 + `merge --ff-only`，本地有改动或未推送提交被拒）与 **release**（比 `version.json` 里的版本号，下 zip → sha256 校验 → 交给组件自己的安装器；桌宠走这条，更新时保留 `data/`，见 PITFALLS #77）。`components[]` 每项 `{id,name,dir,kind,branch,versionUrl}` 可把别的仓库纳入检查。状态落 `updates.json`（`dismissed[id]=remote commit 或版本号`，"不再提示本次"只对这一版生效） |

记忆卡子键（`memoryCard.*`，完整语义见 [MEMORY_CARD.md](MEMORY_CARD.md)）：
`enabled`、`maxChars`、`warnChars`（60000）、`injectMaxChars.qq/bili`（2200/2000）、`recentDays`（7）、
`fuzzyAfterDays`（7）、`forgetAfterDays`（60）、`dailyHour`（4）、`minOwnerImportance`（65）、
`compactTo`、`maxRecords`（600）、`fullMaxBytes`、`fullMaxRecords` 等。

---

## 3. `bili.config.json`（B站）

位置：`~/.dsh/surfcore/bili.config.json`（可用 `SURFCORE_BILI_CONFIG` 覆盖）。
**按 mtime/size 缓存**：改完下一轮 tick 生效（不是进程内永久缓存）。

| 段 | 关键键 | 说明 |
| --- | --- | --- |
| `persona` | `name`、`ownerTitle`、`selfClaim`、`diaryTitle` | 称呼与自称 |
| `preferences` | `like`、`dislike`、`weights`（每个关键词 0–5 权重） | 选题偏好；权重决定每轮给该词分几条 |
| `owner` | `mid`、`name` | 主人 B站 身份（分享型评论要 @ 的人） |
| `quota` | `shareDaily` | 分享型上限 |
| `limits` | 四本账 + 冷却（`DEFAULT_LIMITS`） | 普通评论 / 回找我的人 / 主动搭话 / 动态回复 |
| `dynamics` | `enabled`、`gapMin`、`kinds` | 四类动态（只存被改过的字段，缺省在 `kinds.mjs`） |
| `share` | `enabled`、`via`（dynamic/comment）、`minScore`（13）、`silentAfterDays`、`decayPerDay` | 分享阈值与衰减 |
| `listen` | `comment`、`commentIntervalSec`、`scope`、`oncePerPerson`、`allDay`、`dm`、`dmScope`、`live`、`liveRoom`、`liveScope` | 评论区/私信/直播监听 |
| `night` | `windows[]`（start/end/wakes）、`skipChance`、`maxVideos`、`maxWakesPerDay`（硬上限 3）、`minGapMin` | **作息窗口**：每天允许醒的时段 |
| `fishGuard` | 同 QQ 侧的判定参数（B站 版） | 评论区鱼群保护 |
| `agent` | `sandbox`（默认 `danger-full-access`） | B站 自己的 DSH 会话权限（`workspace-write` 在用户目录会因 WRITE_OWNER 起不了命令） |
| `notify` | `type`（none/desktop/webhook/command）、`url`、`template`、`cmd` | 通知渠道 |
| `aliases` | 历史昵称 | 兜底识别自己 |

---

## 4. 状态文件全表

> 约定：`<state>` = `<仓库根>/state/`（桥接），`<home>` = `~/.dsh/surfcore/`（插件）。
> **W** = 写者，**R** = 读者。带 🔒 的绝不能随手删。

### 4.1 `<仓库根>/state/`（桥接）

| 文件 | W | R | 说明 |
| --- | --- | --- | --- |
| `sessions.json` 🔒 | 桥接 | 桥接/插件 | QQ 会话 ↔ DSH 会话映射 + **每会话 agentToken** + 退役记录。删了 = 所有会话重新开会话（上下文丢） |
| `mode.json` | 桥接/控制台 | 桥接 | 运行模式（chat/closed-agent/reserved/reserved2） |
| `social-v2.json` 🔒 | 桥接 | 桥接/插件/桌宠 | 二代仿真全部状态：未读池、唤醒配置、收尾记录、表情、鱼群、token 计数。（单文件约 400KB 量级） |
| `console-token` 🔒 | 桥接 | 控制台 | 自动生成的控制台令牌 |
| `bridge.lock` | 桥接 | 桥接 | 单实例锁（PID + 端口二次判据） |
| `bridge.log` / `.log.1` | 桥接 | 控制台 | 运行日志（滚一代）；`qq-activity.log` 是"说了什么"的活动日志（500 行） |
| `slang.json` / `stickers.json` | 桥接 | 桥接/控制台 | 黑话库、表情库（含语义标注） |
| `tool-calls.jsonl` | 桥接 | 控制台 | 工具调用审计（按时间追加） |
| `token-usage.jsonl` | 桥接 | 控制台 | 逐轮 token 用量明细（看板数据源） |
| `greetings.json` | 桥接 | 桥接 | 早安问候状态（今天发没发、重试次数） |
| `self-identity.json` | 桥接 | 插件/桌宠 | 跨平台自我识别（QQ 资料卡、B站 mid、主页） |
| `feedback.json` | 桥接 | 控制台 | agent 反馈（`qq_report_feedback`） |
| `current-role.json` | 控制台/插件 | 桥接/插件 | 当前角色（人格卡文件路径 + id） |
| `alignment-brief.md` | 插件 | 桥接 | 身份对齐的注入摘要 |
| `initial-prompts.json` | 桥接 | 桥接 | 二代"会话初始提示词"（每会话只注入一次） |
| `pending-replies.json` | 桥接 | 桥接 | 待回复队列（提问/审批等待中的消息） |
| `bili-memory.json/.md`、`bili-dynamics-*.json`、`bili-share-*.json`、`bili-video-titles.json` | 桥接 | 桥接/插件 | 桥接侧的 B站 记忆镜像（有角色时改用角色包） |
| `voice-packs/`、`voice-tts/` | 桥接 | 桥接/插件 | 语音包安装目录（**几百 MB 到几 GB**，用户素材）与 TTS 缓存 |
| `boot-target.json` | 启动器 | 桥接 | 「这次重启要去哪」的意图标记 |

### 4.2 `~/.dsh/surfcore/`（插件）

| 文件/目录 | W | R | 说明 |
| --- | --- | --- | --- |
| `config.json` 🔒 | 插件 | 插件 | 合体层配置 |
| `bili.config.json` 🔒 | 插件/工具 | 插件/工具 | B站 配置 |
| `memory/memory-card.json` 🔒 | **插件（唯一写者）** | 插件 | 衰减卡真相（记录、清晰度、重要度、scope） |
| `memory/memory-card.md` | 插件 | 人 | 给人看的人话版 |
| `memory/memory-card-prompt-{qq,bili}.md` | 插件 | 桥接 / 调度器 | **两份场景化注入块**（读取方不解析 JSON） |
| `memory/memory-inbox.jsonl` | 桥接/桌宠（只 append） | 插件 | 待摄取事件（`platform=qq/bili/pet`） |
| `memory/memory-card-full.jsonl` + `-stats.json` + `.md` | 插件 | 人 | 全量卡：append-only 存档，**永不进提示词** |
| `memory/qq-for-bili.md` / `bili-for-qq.md` | 插件 | 桥接/调度器 | 双向记忆的成品文本 |
| `characters/<id>/` 🔒 | 插件 | 插件/桥接 | 角色包（见 §4.3） |
| `pet/host.json` | 插件（每 2 分钟） | 桌宠 | 发现文件：baseUrl + token + api + version |
| `pet/host-token` 🔒 | 插件 | 插件 | 24B 随机令牌（`0600`） |
| `pet/focus.json` | 插件/桌宠 | 插件/桥接/桌宠 | **专注模式的单一真相** |
| `pet/chat/history-<role>.json` | 插件 | 插件 | 桌宠对话历史（按角色） |
| `bili/credentials.json` 🔒 | B站 工具 | B站 工具 | 鱼的 cookie（`sessdata`/`bili_jct`/`buvid3`） |
| `bili/owner-credentials.json` 🔒 | 工具 | 工具 | 主人的 B站 cookie（**只用于只读抓偏好**，绝不用于发评论） |
| `token-budget.json`、`token-usage-daily.json`、`token-usage-state.json`、`token-alert.json` | 插件/工具 | 插件 | 每日额度、当日用量、事件水位、80% 提醒去重 |
| `alignments.json` / `align-candidates.json` | 插件 | 桥接/插件 | 身份对齐已生效项 / 待审批候选 |
| `extensions.json` | 插件 | 插件 | 扩展启用状态与各自配置 |
| `backups/` | 插件 | 人 | 配置/人格/记忆卡的写前备份（**按来源分别保留 40 份**） |
| `audit.jsonl` | 插件 | 控制台 | 隐私闸门审计（哪些行被丢弃） |
| `plugin.log` | 插件 | 人 | 插件日志（2MB 滚一代） |
| `bridge-supervisor.log` | 插件 | 人 | 拉起/重启桥接的记录 |

### 4.3 角色包 `~/.dsh/surfcore/characters/<id>/`

```
character.json         角色清单（id/name/epoch/创建时间/主题色…）
persona.md             人格卡正文（人设、语气、规则）
memory/                这一角色的记忆卡全套（同 §4.2 的 memory/*）
bili/                  这一角色的 B站 行为账本（quota/watch-history/scores/…）
snapshots/             自动存档（每 6 小时一份，滚动保留）
```

- `id` 必须匹配 `^[a-z0-9][a-z0-9_-]{0,39}$`（`src/character-persona.js:111`），路径由 `characterDir()` 统一校验。
- 切换角色 = 换**整包**（人格 + 记忆 + B站 账本），不是只换提示词。
- 旧布局（`roles/*.md`、`state/bili-*`）在第一次启动时由插件迁移。

### 4.4 仓库外的运行时数据

| 位置 | 归属 | 说明 |
| --- | --- | --- |
| `<工作区>/voice/` | 语音引擎（voxd）与语音包安装源 | surfcore 只调用、不打包 |
| `<工作区>/pet/` | 桌宠 Electron 工程 | 通过 `host.json` 发现插件接口 |
| `<home>/dsh-runtimes/` | DSH | 插件用它找真正的 `node.exe`（Electron 的 execPath 跑不了部分脚本） |

---

## 5. 备份、保留与回滚

| 机制 | 位置 | 规则 |
| --- | --- | --- |
| 配置/人格/记忆卡写前备份 | `<home>/backups/` | 文件名带来源与时间戳；**按来源分别保留 40 份**（不是全局 40） |
| 角色自动存档 | `<home>/characters/<id>/snapshots/` | 每 6 小时一份，滚动保留，可回档 |
| 会话/工作区清理 | `_backups/`、`~/.dsh/_quarantine/` | 先 rename 再确认，禁止 `fs.rmSync` 直删 |
| 本仓库的清理 | `_backups/<用途>-<时间>/` + `README.md` | 带"怎么回滚"说明（例：`state-residue-20261026/`） |

**回滚优先级**：`_backups/` 里的副本 → `git` 历史 → 角色快照 → 全量记忆卡（只增不删）。

---

## 6. 迁移与兼容

| 旧形态 | 新形态 | 触发时机 |
| --- | --- | --- |
| `roles/*.md` 单人格卡 | `characters/<id>/persona.md` | 插件首次启动 |
| `state/bili-*.json` 平铺账本 | `characters/<id>/bili/*` | 插件首次启动（有角色时） |
| `state/dsh-port.json` 端口缓存 | 仍在用 | 端口发现失败时的兜底 |
| `bridge.autoStart` | `platforms.start.qq` | 首次读配置时迁移 |
| `agent-presets/` 目录机制（DSH ≤0.1.6） | bundle patch 插入 `@deepseek-ai/dsh-agent-preset` 行 | `setup-dsh.mjs` |
| `app.asar` 会话护栏补丁 | 每次 DSH 升级后需重打 | `npm run guard:check` |

---

## 7. 清理约定（什么能删、什么绝不能删）

**可以删（会自动重建）**：`bridge.log*`、`qq-activity.log*`、`plugin.log*`、`backups/` 里的旧备份、
`voice-tts/` 缓存、`snapshots/` 里的旧快照、`state/*.jsonl` 的历史（想省磁盘时）。

**绝不能删**：`sessions.json`、`console-token`、`mode.json`、`social-v2.json`、
`characters/`（人格与记忆）、`bili/credentials.json`、`bili.config.json`、`config.json`、
`token-*.json`（删了当日额度重置，会重复花钱）。

**判断原则**：**删之前问一句"重建它要不要重新登录/重新教她一遍/重新花钱"**——要，就别删。
