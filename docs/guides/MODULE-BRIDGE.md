# 桥接内核（src/bridge.js）

> 阅读范围：`src/bridge.js:1-14964`（全文，逐段 500 行）。
> 本文只描述**桥接这一侧**的行为；插件宿主、SnowLuma 内部、DSH 服务端的实现不在范围内。
> 所有 `src/bridge.js:行号` 都指本仓库该文件。
> **最后核对**：2026-10-26（全仓库逐行梳理）。配套阅读：总纲 [ARCHITECTURE.md](ARCHITECTURE.md) · 边界 [BOUNDARIES.md](BOUNDARIES.md) · 索引 [../README.md](../README.md)。

---

## 0. 一句话职责 + 进程位置

一句话：**把 QQ 消息变成 DSH 会话的一次 prompt，把 DSH 的回合输出变成 QQ 消息**，并在中间承担全部闸门（白名单/模式/限频/额度/审计）与状态机（唤醒、潜水、收尾、社交）。

它是一段**独立 Node 进程**，与另外两个进程通过「网络协议 + 磁盘文件」耦合，三方没有共享内存：

```
QQ 客户端
  ↕ (SnowLuma 原生 Hook，第三方专有运行时，不随仓库分发)
SnowLuma 进程   ── OneBot v11 WebSocket（默认 ws://127.0.0.1:3001）──┐
                └─ OneBot HTTP API（默认 http://127.0.0.1:3000）────┤
                                                                    ▼
                                            ┌────────────────────────────────┐
                                            │ 本进程 src/bridge.js            │
                                            │  · OneBot WS 客户端（收事件）    │
                                            │  · 控制台 HTTP 服务（回环）      │
                                            │  · 会话/唤醒/额度状态机          │
                                            └───────────────┬────────────────┘
                                                            │ DSH Web API
                                                            │ session.prompt / selectModel
                                                            │ events.mux（事件流）
                                                            ▼
                                            DSH 进程（agent 运行时 + 插件宿主 SurfCore）
```

- 链路定义在文件头注释里，两句话写完全部数据流：`src/bridge.js:1-7`。
- 依赖关系：桥接**不启动、不控制** SnowLuma 与 DSH；SnowLuma 掉线它只能告警并重连（`src/bridge.js:3542-3556`），DSH 掉线它只能把消息入队（`src/bridge.js:3144-3146`、`src/bridge.js:3520-3533`）。
- 与 DSH 的契约只有两个方向：出站 `session.prompt({mode:'queue'})`（`src/bridge.js:11261`、`src/bridge.js:13929-13933`），入站 `api.events.mux()` 事件流（`src/bridge.js:14157`）。
- 与插件的契约**只有磁盘文件**（`state/`、`$DSH_HOME/surfcore/`）：两边是不同进程，文件是唯一接口。见 `src/bridge.js:124-146`、`src/bridge.js:11578-11579`。
- 进程自持一个仅回环的控制台 HTTP 服务，供 Web GUI / CLI / MCP 工具调用（`src/bridge.js:8201-8203`）。

---

## 1. 启动序列

`main()` 是**唯一**入口，顺序即依赖顺序（`src/bridge.js:1646-14926`）。下面按代码真实顺序：

### 1.1 配置 → 权限 → 单实例 → 状态（同步段）

| 步 | 动作 | 位置 |
|---|---|---|
| 1 | `loadConfig()` 读 `config.json`（必读，损坏即抛错退出） | `src/bridge.js:1648`、`src/bridge.js:763-766` |
| 2 | `mkdirSync(state/)` | `src/bridge.js:1649` |
| 3 | `hardenStateDirAcl()` 收紧 `state/` ACL（Windows 用 icacls 断继承） | `src/bridge.js:1650`、`src/bridge.js:311-326` |
| 4 | `acquireLock()` 单实例锁（PID + 端口双判据） | `src/bridge.js:1651`、`src/bridge.js:1293-1385` |
| 5 | `loadState()` 恢复 `state/sessions.json` | `src/bridge.js:1652`、`src/bridge.js:1252-1285` |

关键点：第 3 步失败**不阻止启动**，只把 `stateDirHardened=false` 并打印手工修复命令（`src/bridge.js:317-326`），控制台 `/api/security` 会显示该状态（`src/bridge.js:4853-4859`）。第 4 步失败会 `exit(2)`（`src/bridge.js:1363`、`src/bridge.js:1369`、`src/bridge.js:1384`），守护脚本据此区分「已有实例」与「崩溃」。

### 1.2 目的机制运行时

- `PURPOSE_FILE` 跟随当前角色目录，不可写时回退 `state/purpose-outreach.json`（`src/bridge.js:1659-1672`）。
- 上次进程在回合中途退出（`lastOutcome === 'pending'`）→ 记为 `interrupted` 且 `nextFireAt=0`，**不会立刻补发**，避免重启后连发（`src/bridge.js:1676-1679`）。
- 载体缓存 30 秒读一次 `config.json` 的 `purpose.carrier`（qq / pet），切载体不必重启（`src/bridge.js:1693-1704`）；桌宠专注模式读 `$DSH_HOME/surfcore/pet/focus.json`，开着就停一切**自动**目的出发（`src/bridge.js:1706-1728`）。

### 1.3 子系统装载（按出现顺序）

1. `createBiliMemory(...)`：B站记忆（`src/bridge.js:1764`）。
2. 黑话库 `loadSlang`，失败即 `slangStoreWritable=false`（只读降级）（`src/bridge.js:1768-1778`）。
3. 表情库 `loadStickerStore`，同样只读降级（`src/bridge.js:1790-1812`），随后 `ensureStickerIndex` 补编号/情绪（`src/bridge.js:1816-1825`）。
4. 语音配置与工具函数安装（`src/bridge.js:1882-2017`）。
5. 二代会话状态 `loadSocialV2State()`（`src/bridge.js:10345`），随后 `loadInitialPrompts()`（`src/bridge.js:10347`）。
6. 启动期告警一连串（见 §2.4）。
7. DSH 端口兜底探测（`src/bridge.js:2928-2945`）。
8. 构造 `NodeApiClient`（`src/bridge.js:2946-2954`）。
9. 内存态表初始化 + 为已持久化会话补 `api.events.follow()`（`src/bridge.js:2971-3010`）。
10. token 账本 `createTokenLedger`（`src/bridge.js:3016-3025`）。

### 1.4 控制台服务

`startConsoleServer()`（`src/bridge.js:3729`）先做令牌解析（`src/bridge.js:3733-3743`）、再建 `http.createServer`、最后 `listen(port,'127.0.0.1')`（`src/bridge.js:8201-8203`）。`EADDRINUSE` → `exit(2)`（`src/bridge.js:8205-8212`）。

### 1.5 OneBot 连接

`new SnowLumaWebSocketClient({url, accessToken, reconnect:true})`（`src/bridge.js:14651-14655`），注册 `onPrivateMessage` / `onGroupMessage` / `onNotice('notify')`（`src/bridge.js:14657-14670`）、健康旁路 `onEvent`（`src/bridge.js:14680-14696`）、`onBotStatus`（`src/bridge.js:14700-14714`）、`on('open')` / `on('close')` / `on('error')`（`src/bridge.js:14716-14857`），最后 `bot.connect()`（`src/bridge.js:14860`）。

`open` 里做四件事：置 `connected`、`pollSnowlumaStatus()`、`getLoginInfo()` 拿昵称/QQ 号并 `saveQqSelfIdentity()`、finally 里 `runHistoryCatchUp('connect')`（`src/bridge.js:14716-14742`）。

### 1.6 定时器与自愈的启动点

真正的启动顺序在文件末尾，只有四行（`src/bridge.js:14922-14926`）：

```
startDshWatch();      // 5s 轮询 DSH 就绪 + 模式 + preset
startSnowlumaWatch(); // 60s 轮询上游健康 + 30s 边沿告警
startConsoleServer(); // 回环 HTTP
await pumpMux();      // DSH 事件流主循环（永不返回）
```

在此之前还发生了：表情库预热（`src/bridge.js:14872-14874`）、B站三子系统启动（`src/bridge.js:14881-14920`）。

注意 `startSocialLoop()` 在更早的位置（`src/bridge.js:11515-11517`），条件只看 `cfg.social.enabled !== false`；模式判断在每跳的 `socialLoopTick()` 第一行（`src/bridge.js:11345`）。

### 1.7 进程退出

- `SIGINT` / `SIGTERM` → `saveState()` + `releaseLock()` + `exit(0)`（`src/bridge.js:14929-14939`）。
- `unhandledRejection` → 只打日志含 stack，不退出（`src/bridge.js:14940-14943`）。
- `uncaughtException` → 记录 + `saveState()` + `releaseLock()` + `exit(1)`（`src/bridge.js:14953-14958`）。这条是 EPIPE 兜底：守护窗口消失时 `console.log` 会抛，不兜就会在重启循环里每 5 秒崩一次（注释在 `src/bridge.js:14944-14952`）。
- `exit` 钩子再 `releaseLock()` 一次（`src/bridge.js:14959`）。

---

## 2. 配置模型

配置只有一份：仓库根的 `config.json`，全量由 `loadConfig()` 归一（`src/bridge.js:763-1243`）。**没有任何运行时 schema 校验层**，所有收敛都散在这个函数里。

### 2.1 读取与失败语义

- `readJsonSafe(file, fallback, required)`：去 BOM 后 `JSON.parse`；`required=true` 时缺失/解析失败直接抛（`src/bridge.js:200-209`）。
- `readConfigObject(file)`：额外要求顶层是**普通对象**，否则抛错。这条是防止「读整份 → 改一个字段 → 写回」的控制台端点把用户配置抹成只剩本次提交字段（`src/bridge.js:222-229`）。
- 原子写：`atomicWriteJson` 走「唯一临时名 + rename」，rename 遇 `EPERM/EBUSY/EACCES` 退避重试 4 次（Windows 上被 Defender/编辑器占用很常见）（`src/bridge.js:231-264`）。文件模式 `0600`，但在 Windows 上 `mode` 基本是空操作，真正生效的是 §1.1 的 ACL 收紧（`src/bridge.js:291-310`）。

### 2.2 键与默认值（分组）

**`dsh`**：`baseUrl`（默认 `http://127.0.0.1:3080`）、`provider`（`deepseek-official`）、`model`（`deepseek-flash`）、`reasoningEffort`（`max`）、`authToken`/`authHeader`/`authPrefix`、`allowRemote`（false）（`src/bridge.js:768-783`）。

**`snowluma`**：`wsUrl`（`ws://127.0.0.1:3001`）、`accessToken`、`httpUrl`（默认 `http://127.0.0.1:3000`，在发送处兜底）、`silenceWarnMs`、`followDiscoveredEndpoint`、`homeDir`（`src/bridge.js:784`、`src/bridge.js:3581-3582`、`src/bridge.js:14772`、`src/bridge.js:8666`）。

**顶层**：`sessionCwd`（空 = 每会话在 `state/agents/` 下）、`agentPreset`（默认 `qq-chat`）、`workspaceTitle`、`ownerQQ`、`admin`、`allowAllWhenEmpty`、`ackMessage`、`sendDelayMs`（300）、`questionTimeoutMs`（5 分钟）、`consolePort`（3100）、`consoleToken`、`pricing`（`src/bridge.js:786-813`）。

**`allow` / `deny`**：均可用单数或复数键名（`group`/`groups`、`privates`/`private`）；`deny.users` 额外接受 `people`/`persons`。值一律过 `normalizeIdList`（只留纯数字字符串，`src/bridge.js:757-760`），`deny.users` 额外去重（`src/bridge.js:793-804`）。

**`security.interceptNotify`**（默认 true）（`src/bridge.js:814-817`）。

**`social`**（一代）：`triggerProbability 0.1`、`contextWindow 20`、活跃检测/回复延迟区间、`activeDurationEnabled` + 15~30 分钟上限、`idleWindowMs` 6 分钟、`idleRetryProbability 0.25`、`proactive*`、`skipProbability 0.15`、`maxReplyChars 500`、`mustReplyKeywords`、`burstEnabled` + 间隔区间、`longGapProbability`（`src/bridge.js:831-869`）。

**`socialV2`**（二代，最复杂）：`enabled`、`autoReplyCheckMs 30000`、`agentPreset qq-chat-v2`、`provideRecommendations`、`tools`（30 个开关）、`wake`（默认潜水、沉睡前观察 5 分钟、推荐关键词、`batchWindowMs 8000`、`maxWakePerMinute 1`、`maxWakePerHour 12`、`noActionLimit 3`、`maxWakeConfigReminders 2`）、`send`（`burstMaxMessages 8`、`maxSendPerMinute 8`、`maxSendPerHour 60`、`maxMessageChars 500`、`gapBaseMs 800`、`gapPerCharMs 20`）、`tokenGuard`、`wait`、`sticker`、`proactive`、`feedback`、`context`、`history`（`src/bridge.js:870-1013`）。

**深度合并的三处**（因为 `{...default, ...file}` 遇到 `undefined` 子对象会退化成「无上限」或「丢默认值」）：

- `socialV2.tools`：单独重建默认表，新增项 `slangQuery`/`slangSubmit`/`sendVoice`（默认 **false**）、`setStickerRemark`（默认 **false**）（`src/bridge.js:1018-1051`）。
- `socialV2.voice`：默认 `enabled:false`、`dir:'audio'`、`maxSeconds 300`、`maxBytes 20MB`、`maxPerMinute 2`、`maxPerHour 10`、`allowAbsolutePath:false`、`defaultVolume 1`、`tts.enabled:false`（`src/bridge.js:1067-1082`）。
- `socialV2.sticker` / `sticker.collect` / `media`（`src/bridge.js:1085-1115`）。

**`chat`**（一代普通模式）：`contextMessages`（0~100，默认 10）、按群覆盖 `groupContextMessages`、`addressFilter`、`presence`（生物钟）、`proactive`（`src/bridge.js:1155-1180`）。

**`role.maxInjectChars`**（1000~20000，默认 6000）由 `applyRoleInjectLimit` 校正，越界会打日志（`src/bridge.js:357-363`、`src/bridge.js:1148-1152`）。

**`greetings.morning`**：`{time, uin, name}`，`uin` 必须过 `normalizeIdList` 才算启用（`src/bridge.js:1183-1190`）。

**`purpose`**：交给 `normalizePurposeConfig(file.purpose, {ownerQQ})`（`src/bridge.js:1194`）。

**`biliBridge`**：`memory.refreshIntervalMs` 夹 1~60 分钟、`dynamics.pollIntervalMs` 夹 1~60 分钟、`share.times` 默认 8 个时间点（非法格式丢弃）、`share.gapMs` 夹 0~60s、`share.cardMode` 经 `normalizeCardMode`（`src/bridge.js:1197-1234`）。

### 2.3 迁移与归一（有历史包袱的地方）

| 现象 | 处理 | 位置 |
|---|---|---|
| `simulation` 是 `reserved2` 的规范名，但内部一律用历史拼写 | `MODE_INPUT_ALIASES` 收敛 + `VALID_MODES` 由它派生；输入侧 fail-closed 返回 null | `src/bridge.js:162-177` |
| DSH `settings.describe` 写完后 `value` 不刷新（issue #22） | `settingFromDshNamespace`：**user 层优先**、`value` 回退 | `src/bridge.js:189-196` |
| `sessions.json` 的 `sessionPolicies` 被手工改成数组 → 全部会话被判「权限变了」 | 加载时把数组归一化成 JSON 字符串 | `src/bridge.js:1279-1284` |
| `config.json` 里没有 `socialV2` 段时保存一次会把默认关闭的工具打开 | 保存端点用 `cfg.socialV2`（文件+默认值合并后的运行时值）兜底 | `src/bridge.js:5179-5191` |
| 旧 `chat` 配置里的 `burstProbability`/`followUp*` 已废弃 | 保存时显式 `delete` | `src/bridge.js:5055-5057` |
| 旧 `biliBridge.share.card:boolean` | `normalizeCardMode` 收敛成 `link|miniapp|off` | `src/bridge.js:1211-1213` |

### 2.4 安全相关的配置（清单）

1. `ownerQQ`：审批、管理命令、`closed-agent` 模式、私聊语音触发**全部**依赖它；缺失时启动日志明确警告「审批永远等不到回答」（`src/bridge.js:2913-2915`）。
2. `consoleToken`：16~128 位、`[A-Za-z0-9_-]`；不合法就忽略并回退到 `state/console-token` 自动生成值（`src/bridge.js:3733-3743`）。**令牌为空直接抛错拒绝启动**（`src/bridge.js:3741`）。
3. `allow` / `deny`：见 §3.1。
4. `dsh.authToken` + `allowRemote`：launch token 是进程启动凭据，默认只允许发往回环，远程 DSH 需显式 opt-in（`src/bridge.js:780-781`、`src/bridge.js:2952-2953`）。
5. `socialV2.voice.allowAbsolutePath`：**已经不再放宽 AI 通道**，只是保留兼容；AI 发的语音永远必须落在语音库内（`src/bridge.js:2034-2046`、`src/bridge.js:2916-2920`）。
6. `snowluma.followDiscoveredEndpoint`：默认 true，自愈时会把发现到的 `wsUrl` 写回 `config.json`；置 false 只自愈 token、不动 URL（`src/bridge.js:14761-14785`）。
7. `security.interceptNotify`：审计拦截时是否回一条提示到 QQ（`src/bridge.js:9074-9077`）。
8. `socialV2.media.*`：尺寸/像素/数量上限，收敛区间见 `src/bridge.js:8648-8661`。

---

## 3. 入站链路

入口是 `handleIncoming(kind, id, event, cfg)`（`src/bridge.js:13454`）。**顺序本身是安全设计**，改动顺序等于改动语义。

### 3.0 事件到达

- 私聊：过滤掉自己发的（字符串比较，网关 number/string 混用），再 `handleIncoming('private', user_id, ...)`（`src/bridge.js:14657-14662`）。
- 群聊：同样过滤自己发的（两个字段都查），再 `handleIncoming('group', group_id, ...)`（`src/bridge.js:14663-14667`）。
- 拍一拍：`onNotice('notify')` → `handlePokeNotice`（`src/bridge.js:14668-14670`、`src/bridge.js:14030`）。
- 三处 handler 都包了 `try/catch`，异常只记日志，不会中断 WS 读循环。

### 3.1 白名单 / 黑名单 / 模式（三道闸，顺序不可换）

**① 会话准入** `modeAllowed(key, kind, id, cfg, mode)`（`src/bridge.js:3247-3255`）：

- `closed-agent`：只放行 `private:<ownerQQ>` 一个 key，**白名单完全不参与**。
- 其它模式：`allowed(kind, id, cfg)`——先看 `deny[kind]`，命中即拒；再看 `allow[kind]`，非空则必须命中；`allow` 为空时返回 `allowAllWhenEmpty`（`src/bridge.js:1601-1610`）。
- 失败处理：记一行「忽略未授权会话」并 `return`（`src/bridge.js:13456-13459`）。**注意此时还没有任何副作用**。

**② 人的黑名单** `senderBlocked(event.user_id, cfg.deny.users)`（`src/bridge.js:13462-13466`、`src/bridge.js:1623-1628`）：

- 位置**必须在一切副作用之前**：不入库、不进上下文、不写记忆卡、不计鱼群、不触发唤醒（注释 `src/bridge.js:13460-13461`）。
- 为什么不能合并进 `allowed()`：`allowed` 判的是**会话**，群还在白名单时同群的黑名单用户照样能说话（`src/bridge.js:1612-1622`）。
- 历史积压也处理：启动加载时把 `deny.users` 的未读/上下文**整条剔除**（`src/bridge.js:9563-9574`）。
- 拍一拍同样拦（`src/bridge.js:14056-14061`）——否则「戳一下」就成绕过通道。

**③ 会话仍在当前模式内**：解析完引用归属后再复核一次 `isSessionAllowedInCurrentMode(key)`（`src/bridge.js:13498`）——因为中间有 `await`，期间可能切模式。

### 3.2 文本化与媒体提取

- `textContent = segmentsToText(event.message, {resolveAtName, resolveReply})`：**带**引用原文，用于让模型判断「这句在对谁说」（`src/bridge.js:13475`）。
- `plainContent = segmentsToText(..., {includeReply:false})`：**只含本条自己的文字**，用于命令判断、指向性判断、关键词触发（`src/bridge.js:13476`）。这两个值全程不混用，是很多误判的根因（注释 `src/bridge.js:13473-13474`）。
- 段类型映射：`text/at/face/mface/image/record/video/file/reply/json/markdown/forward/default`，各自退化成 `[图片]`/`[语音]`/`[引用 人：文]`/`[转发消息 id=...]` 之类的占位（`src/bridge.js:1477-1539`）。
- `extractMediaFromSegments` 保留 `file/url/subType/summary` + `emojiId/emojiPackageId/emojiKey`，并同时读 `sub_type` 与 `subType`（`src/bridge.js:1557-1599`）。这些字段缺失会让后续表情下载整条失效（`src/bridge.js:12101-12106`）。
- 媒体元数据入 `messageMediaStore`（一代）或消息对象（二代），每会话上限 500 条，超出删最旧（`src/bridge.js:13480-13494`、`src/bridge.js:8661`）。

### 3.3 引用归属判定

`quoteTargetIsSelf(...)` 在空文本过滤**之前**执行（`src/bridge.js:13497`）——否则「只引用不附文」的消息会被当成空消息丢掉（注释 `src/bridge.js:13495-13496`）。

`resolveReplyInfo`（`src/bridge.js:11979-12043`）做了强归属校验：

- `messageId` 必须能转成安全整数，否则直接拒（`src/bridge.js:11986-11990`）。
- 群消息：`raw.group_id` 缺失或不等于当前会话 → 拒（`src/bridge.js:11998-12007`）。
- 私聊：`raw` 带 `group_id` → 拒；发送者不等于会话对象且不等于自己 → 拒（`src/bridge.js:12008-12024`）。
- 缓存：`replyInfoCache`，成功 TTL 10 分钟、失败只 5 秒（防抖但不错杀）（`src/bridge.js:11965-11997`）。

### 3.4 记录「谁在说话」（语音授权的前提）

在空文本过滤之前写入 `voiceLastSpeaker` / `voiceOwnerAt`（`src/bridge.js:13501-13506`）。注释说明：漏记就是给「换个人来喊」留后门（`src/bridge.js:13499-13500`）。

然后：`!plainContent && !quoteTargetIsSelf` → `return`（`src/bridge.js:13507`）。

### 3.5 副作用开始（按序）

1. `recordMemoryInboxEvent(...)` 写记忆卡 inbox（`src/bridge.js:13513`）。规则：主人全记；群友只记「直接找她 / 引用她 / 值得记」；非主人私聊 <8 字不记（`src/bridge.js:13405-13429`）。
2. 群聊 `recordFishWindow(...)` 进鱼群窗口（`src/bridge.js:13514-13516`、`src/bridge.js:9819-9833`）。
3. 判定 `senderIsFish`（昵称或 `fishGuard.fishIds` 命中）（`src/bridge.js:13517-13518`）。

### 3.6 挂起提问 / 审批的消费

`pending.get(key)` 存在且（是提问 **或** 发送者是管理员）→ `handlePendingAnswer` 后 `return`（`src/bridge.js:13523-13527`）。

- 提问：选项文字精确匹配（忽略大小写）→ `selected`；否则走 `custom`（`src/bridge.js:13975-13996`）。
- 审批：**只有管理员**能消费（`src/bridge.js:13998-14002`），词表 `APPROVE_WORDS`/`REJECT_WORDS`（`src/bridge.js:1639-1640`），回执成功才清 pending（`src/bridge.js:14019-14020`）。
- 群友消息不会因为「审批挂起」被吞，继续走后面流程（注释 `src/bridge.js:13522`）。
- 超时：`questionTimeoutMs` 到点自动取消并回「⏰ 等待回答超时」（`src/bridge.js:14105-14112`）；新请求覆盖旧请求（`src/bridge.js:14098-14104`）。

### 3.7 静默模式 / 角色控制语 / 管理命令

- `roleState.mode === 'silent' && !isOwner` → 只记活动日志并 `return`（`src/bridge.js:13529-13534`）。
- 非管理员说「切换角色」这类词 → 直接回「仅管理员可操作」并 `return`（`src/bridge.js:13536-13540`）。
- `/` 开头的管理命令**全部由桥接执行，不进模型**，且仅管理员可用（`src/bridge.js:13542-13633`）：`/reset`|`/new`、`/status`、`/role [名|off]`、`/silent`|`/quiet`、`/active`|`/speak`；其它 `/` 内容照常交给 DSH。非管理员发 `/` 一律回「管理命令仅管理员可用」（`src/bridge.js:13544-13547`）。

### 3.8 分模式处理

#### A. `reserved2`（二代仿真）—— 只入库 + 排唤醒，不直接投递

`src/bridge.js:13636-13688`：

1. 群聊先 `ensureFishGroupName(id)` 缓存群名。
2. `appendSocialV2Message(...)` 入库：生成自增 `seq`、`tail`（尾截断）、`fish` 标记、`media` 归一化、`forwardIds` 登记；同时清空 `preSleep*` 三个标记；推入 `recent`（≤100）与 `unread`（≤30）（`src/bridge.js:12097-12171`）。
3. `feedSlangWindow` 喂黑话窗口（`src/bridge.js:13643`）。
4. `socialV2.paused` → 只记活动日志并 `return`（**不唤醒**）（`src/bridge.js:13644-13647`）。
5. `directed = !senderIsFish && (quoteTargetIsSelf || isDirectAddress(...))`。
6. 鱼群保护：`blocked` → 记日志 `return`；`rawBlocked && bypass` → 落 `fishGuardBypass`（10 分钟窗口），让发送时也能放行（`src/bridge.js:13652-13664`）。
7. `noteClosureReopenV2`：对方又开口时把「上次收尾」标记为重开（群聊只在直呼/引用/提问/道别时重开）（`src/bridge.js:13666-13669`、`src/bridge.js:10263-10274`）。
8. 首次：`bootstrapSent=true` → `scheduleWakeV2(key,'bootstrap')`（`src/bridge.js:13670-13673`）。
9. 之后：`evaluateWakeTriggerV2(...)` 求原因 → `closureSuppressesWake` 过滤普通概率唤醒 → `scheduleWakeV2(key, reason)`（`src/bridge.js:14336-14348`）。

`evaluateWakeTriggerV2` 的判定顺序（`src/bridge.js:12879`）：私聊恒 `private`；`anyMessage`；`atMention`（at 段命中 self，或引用自己）；`nameMention`（**用 plainContent**，防止引用了提到昵称的旧消息就误触）；`keywords`（≤4 位纯英文/数字用 `\b` 词边界，避免 `DS` 命中 `ADS`）；`question`（`isDirectedAtAi`）；`speakerIds`；**媒体/链接唤醒 `media`**（纯图片/表情/动图或带可打开链接的消息没有任何文字触发条件，按 `socialV2.wake.mediaWake` 决定：`probability` 默认按 `mediaWakeProbability`（0.1）摇一次，概率没中**不落回**普通概率；`owner` 只让 ownerQQ/admin 必醒、群友按比例；`any` 任何人；`off` 关闭；QQ 小黄脸 face 不算）；最后才是 `probability`。媒体唤醒的提示词会明确让模型调 `qq_get_message_images` 看图、`mcp__web-search-safe__web_fetch` 打开链接（见 PITFALLS #90、#93）。

#### B. `chat` / `reserved`（一代）

步骤（`src/bridge.js:13690-13893`）：

1. `feedSlangWindow`（群聊）。
2. 鱼群保护同一套，但用 `fishChatWindows`，且同样落 `fishGuardBypass`（修过「接收放行但发送又被拦」的 bug，`src/bridge.js:13711-13717`）。
3. `roleHint = currentRoleHint()`（v1 人格卡）。
4. `recentBlock = buildRecentChatBlock(key)`（**先取窗口，再记当前条**，`src/bridge.js:13724-13729`）。
5. 生物钟（仅 `chat` + 群聊 + 非管理员）：@ 别人**不算**叫醒；没被叫且离线 → 记活动日志 `return`；被叫则 `wakePresence`（`src/bridge.js:13733-13752`）。
6. addressFilter（仅 `chat` + 群聊 + 非管理员）：@ 别人或引用别人 → 按 `silenceWhenAddressedToOther`（默认 0.4）概率跳过；不跳过则加一段 `chimeInHint`（`src/bridge.js:13759-13780`）。
7. `appendPublicFeed(...)` 写 `state/qq-public-feed.jsonl`——**只写群聊、非命令**，私信结构上永不可能进入（`src/bridge.js:13782-13792`、`src/bridge.js:695-713`）。
8. 拼 `promptText`：`recentBlock + roleHint + biliRecall + chimeInHint + [管理员标记] + "昵称(QQ号)：正文" + mediaHint`（`src/bridge.js:13794-13807`）。发送者必须带 QQ 号，因为人格卡的称呼表按号映射（注释 `src/bridge.js:13796-13797`）。
9. 进一代社交状态机（`isSocialEnabled()` 为真时，`src/bridge.js:13812`）：
   - `exiting` → 只进摘要并 `return`（`src/bridge.js:13818-13822`）。
   - 活跃超时到点 → 触发退场并进摘要（`src/bridge.js:13825-13829`）。
   - `active`/`probing` → 回 `active`；私聊立即投递，群聊等批量检测（`src/bridge.js:13832-13855`）。
   - `idle` → `direct || Math.random()<triggerProbability` 才触发；否则进摘要（`src/bridge.js:13857-13865`）；触发则 `enterActive` + 投递（管理员私聊直接 `await`，其余延迟）（`src/bridge.js:13867-13892`）。
10. 非社交：见 §3.9。

#### C. `closed-agent`

走 §3.9 的普通分支，但 `modeAllowed` 已经把范围锁到「管理员私聊」一个会话（`src/bridge.js:3249-3251`）。

### 3.9 普通投递（chat / closed-agent / 非社交）

`src/bridge.js:13895-13947`：

1. `!dshReady` → 入 `queued`（上限 50，超了丢最旧），并按 30 秒冷却回一条「⏳ 系统服务重启中，消息已排队」（`src/bridge.js:13896-13911`）。失败处理：不丢消息，但**只有 30 秒一次**的提示，不会刷屏。
2. `ensureSession(key)`；若抛「会话创建期间已重置」→ `enqueueForRetry`（3 秒后 flush），不丢（`src/bridge.js:13913-13922`）。
3. 注入顺序固定：`withAlignmentContext(key, withSlangContext(promptText))`——黑话/时间在内，身份对齐在最外（置顶）（`src/bridge.js:13923`、`src/bridge.js:2865-2884`）。
4. 有媒体 → 转成 DSH content parts（`text` + 若干 `image`），超过上限的降级成文字占位（`src/bridge.js:13924-13927`、`src/bridge.js:8825-8868`）。
5. 投递前再复核 `isCurrentSession(key, sessionId)`，否则抛错（`src/bridge.js:13928`）。
6. `api.sessions.prompt({sessionId, mode:'queue', content})`（`src/bridge.js:13929-13933`）。
7. 被拒：把 `code: message` 回 QQ（敏感则整段隐藏）（`src/bridge.js:13934-13939`）。
8. 若返回 `command`（斜杠命令直出，不走模型）→ `mdToPlain` 后审计发送，`return`（`src/bridge.js:13940-13944`）。
9. 否则回 `ackMessage`——**`reserved2` 不回**（二代所有发言都必须走工具）（`src/bridge.js:13945`）。

### 3.10 历史补读（启动 / 上线后）

`runHistoryCatchUp(trigger)`（`src/bridge.js:13218-13257`）：

- 前提：`history.enabled`、`currentMode==='reserved2'`、`socialV2.enabled!==false`、**已拿到 selfUserId**（`src/bridge.js:13219-13228`）。没有 selfUserId 就无法区分「群友」与「自己以前发的」，宁可等下一次（`src/bridge.js:13224-13228`）。
- 目标筛选：必须 `bootstrapSent===true`（没完成首次唤醒的会话不补）、key 格式合法、`includePrivate` 允许、`isSessionAllowedInCurrentMode`（`src/bridge.js:13017-13031`）。
- 触发点三处：启动/连接后（`src/bridge.js:14737`）、账号上线边沿（`src/bridge.js:3617-3627`）、控制台手动（`src/bridge.js:5857-5866`）。
- 节流 10 秒 + 单飞（`src/bridge.js:13006`、`src/bridge.js:13229-13234`）。
- 水位**在 fetch 之前**算：否则 fetch 期间到来的实时消息会把 `lastIncomingAt` 推到现在，真正错过的历史被误判「太旧」（`src/bridge.js:13193-13195`）。
- 去重靠 `messageId` + 时间水位；黑名单用户直接过滤（`src/bridge.js:13126-13132`）。
- 自己的旧消息只进 `recent`，**不进未读**（不需要「处理」）（`src/bridge.js:13157-13161`）。
- 水位按「本次看到的最新历史消息时间」推进，且**忽略未来时间**（时钟漂移/异常网关）（`src/bridge.js:13169-13177`）。
- 补到了 `incoming > 0` 且 `history.wake !== false` → `scheduleWakeV2(key,'history')`（`src/bridge.js:13208-13211`）。
- 接口未实现（404/405/`unsupported`）→ 记入 `historyApiUnsupported`，**按 action 分别禁**，群历史可用不代表好友历史可用（`src/bridge.js:13008-13009`、`src/bridge.js:13051-13057`）。

### 3.11 唤醒判定与投递（`sendWakePromptV2`）

这是二代唯一的唤醒入口（`src/bridge.js:12652-12807`），闸门顺序：

1. `enabled` / `paused` / 模式 / 白名单 → `return`（`src/bridge.js:12653-12658`）。
2. **鱼群保护**：算 bypass（10 分钟窗口内且 direct/owner），`blocked` → 记日志 `return`（`src/bridge.js:12660-12671`）。
3. **token 防爆破 / 额度**：`tokenGuardWakeBlock`；被拦且带 `retryAfterMs` 就排一个 `tokenRetryTimer`（≤60s）重试（`src/bridge.js:12672-12687`）。
4. **防重入**：`isConversationBusyV2` → 把原因存入 `pendingWakeReasons`（≤20 条），`return`（`src/bridge.js:12688-12700`）。
5. **唤醒频率**：`maxWakePerMinute`/`maxWakePerHour`；被直呼/引用/提问/拍一拍时 `directBypass` 越过间隔（但每日次数与花费上限仍生效）。超限不是丢弃，而是排 `rateLimitRetryTimer`（≤60s）**延后补这一枪**（`src/bridge.js:12701-12742`）。
6. 真唤醒：清 `preSleep*` 三标记 → `cancelReplyCheckV2` → `wakeTimes.push` → `resetTokenTurn` → 清 `sleepUntil` 与 `sleepTimer` → 记账 → `buildWakePromptV2` → `deliverPrompt(key, prompt, {wakeReason})`（`src/bridge.js:12743-12775`）。
7. 失败回滚：`pendingWakeKeys` 删、lease 解除、`wakeTimes` 回滚；若是有限潜水唤醒还要**恢复原 `sleepUntil` 并重排定时器**（否则会话停在「无定时器」静默态）（`src/bridge.js:12767-12806`）。

### 3.12 唤醒提示词里注入了什么

`buildWakePromptV2`（`src/bridge.js:12523-12640`）按固定顺序拼：

角色名 → 身份（昵称+QQ号，`src/bridge.js:12486-12500`）→ 来源归属（哪个平台的内容，`buildProvenanceBlock`）→ 管理员规则（compact）→ B站简报 → 记忆卡 → **会话令牌** → 初始提示词（**仅 bootstrap**）→ 反AI味 → 积极性 → 对话收尾判断 → 表情策略+表情库摘要 → 表情匹配推荐 → 首回复节奏 → 此刻状态 → 当前唤醒配置 → 记忆（话题/想法/印象）→ 参与度参考 → 鱼群保护 → Token 防爆破 → 沉睡前强制等待，最后按 `reason` 追加一段（bootstrap / timeout / replyCheck / proactiveCheck / history / poke / 默认）。

`deliverPromptNow` 还会在最外层包 `withSlangContext`（时间+黑话）与 `withAlignmentContext`（群聊身份对齐，置顶）（`src/bridge.js:11251`），并在 `wakeReason` 存在时追加【本次消息快照】JSON 与 `history=true` 的说明（`src/bridge.js:11234-11249`）。

### 3.13 提问 / 审批回传

事件流中的 `question/requested`（`src/bridge.js:14569-14591`）与 `approval/requested`（`src/bridge.js:14592-14606`）：

- 先查 `reverse` 拿 key；不是当前会话 → `cancelPendingEntry` 直接拒（`src/bridge.js:14572`、`src/bridge.js:14595`）。
- 文本与选项都要过敏感正则，命中则整段替换成「（含敏感信息，已隐藏）」（`src/bridge.js:14575-14586`）。
- 发到 QQ 后 `registerPending`（带 5 分钟超时定时器）。
- 学习会话（黑话）不打扰用户：提问自动回空答案、审批自动 `rejected`（`src/bridge.js:14549-14568`）。

---

## 4. 出站链路

### 4.1 主路径：DSH 回合文本 → QQ

驱动点是 `pumpMux` 的 `turn/end`（`src/bridge.js:14262-14547`）。判定顺序本身就是语义：

1. `trackTurnEvent` 拿到 `ended`（`src/bridge.js:14129-14146`）。**只有 `turn/start` 才建 collector**；空壳 `turn/end` 也清掉——否则「会话是否繁忙」永远为真，该会话再也收不到唤醒（注释 `src/bridge.js:14119-14128`）。
2. `reserved2` 无行动兜底：本回合既没发消息也没 `mark_action` → `noActionCount++`，达 `noActionLimit`（默认 3）重置 WakeConfig。`turn/start` 丢失（重连快照补发）时**跳过计数**，避免冤枉 AI（`src/bridge.js:14264-14292`）。
3. 清 turn 相关状态 → `notePurposeTurnEnded`（目的机制回执）→ 取 `isFarewell` / 静默队列（`src/bridge.js:14293-14318`）。
4. `pendingWakeKeys` 未确认：没调 `set_wake_config` 也没 `mark_read` → 发提醒（最多 `maxWakeConfigReminders`，默认 2 次），超限则重置为默认唤醒配置（`src/bridge.js:14319-14354`）。
5. `replayPendingWakeReasonsV2(key)` 补发繁忙期暂存的唤醒（`src/bridge.js:14357`）。
6. `ended.reason.kind === 'completed'` 且有文本：
   - `plain = mdToPlain(ended.text)`；纯 Markdown/空白视为无文本（`src/bridge.js:14358-14362`、`src/bridge.js:14373`）。
   - `[SILENT]` → 不发（`src/bridge.js:14375-14389`）。
   - 本回合发送类 MCP 工具成功过 → **跳过自动转发**（防重复）（`src/bridge.js:14391-14403`、`isSendToolName` 见 `src/bridge.js:575-578`）。
   - 敏感审计（令牌/SENSITIVE_RE）→ 拦截 + 提示管理员（`src/bridge.js:14404-14422`）。
   - 分模式发送：社交模式走 `planSocialTimeline` + `sendBurstToQQ`/`sendToQQ`；`reserved2` **只记日志不转发**（一切发言必须走工具）；普通模式 `sendToQQ`（`src/bridge.js:14424-14506`）。
7. `error` → 打日志 + 回「⚠️ agent 处理出错」（旧版本只回 QQ 不写日志，PR #24）（`src/bridge.js:14507-14522`）。
8. `aborted` → 回「⏹️ 已停止」（`src/bridge.js:14523-14534`）。
9. completed 但无文本 → 只记日志（`src/bridge.js:14535-14547`）。

### 4.2 分条 / 拆句 / md 转纯文本

- `sendToQQ`（`src/bridge.js:8240-8261`）：`redactKnownTokensOnly` → `splitForQQ`（来自 `md-to-plain.js`）→ 每段走同一条 `sendChain`（全局串行）→ `withTimeout(..., SEND_TIMEOUT_MS=15000)` → 失败写 `lastSendFailed` → 每段后 `sleep(cfg.sendDelayMs)`。
- `splitLongSegment`（`src/bridge.js:8278-8353`）：超长段落先按次要标点切，再按字符硬切；**URL 用 `\u0000URL<n>\u0000` 占位且必须整块不可切**（切碎会导致 URL 丢失 + 裸 NUL + 字面量 `URL0` 被发出去，实测 13 个偏移里 5 个损坏，注释 `src/bridge.js:8298-8302`）；**绝不在代理对中间切**（半个 emoji 会变成两条乱码，`src/bridge.js:8328-8336`）。
- 一代分条信号：空格。`splitByCjkSpaces` 里「空格两侧任一侧是汉字」就断条，否则保留空格（避免误伤 `DeepSeek V3`）（`src/bridge.js:8370-8388`）。只用于 `reserved`，二代不走这条（注释 `src/bridge.js:8369`）。
- `planSocialTimeline`（`src/bridge.js:8393-8416`）：`burstEnabled=false` → 整条（仅做 `maxReplyChars` 硬拆）；否则空格拆 + 逐段硬拆。
- `sendBurstToQQ`（`src/bridge.js:8420-8461`）：条间随机间隔；有 `longGapProbability` 概率用长间隔；失败同样记 `lastSendFailed`（否则调用方会把「一条没发出去」当成「我说过话了」）。返回实际发出的数组。
- 二代的间隔由 `computeGapsV2` 算：`fixed`（可用 `gaps` 数组）/ `byLength`（`gapBaseMs + 字数*gapPerCharMs`）/ `auto`（随机 + 长间隔概率），全部过 `clampGapV2`（`min = burstIntervalMinMs`，`max = maxGapMs`）（`src/bridge.js:8971-9005`）。
- 事后软提醒：`findCjkSpaceWarning`（中文之间打空格）与 `findSplitBoundaryWarning`（在逗号或「的/了/吗」这类未完词处断条）只回提示不拦截（`src/bridge.js:11811-11856`、`src/bridge.js:6028-6031`）。

### 4.3 发送闸门（每条出站都过）

1. `captureSendGuard(key)`（`src/bridge.js:9050-9060`）：入队时取一次策略签名，**真正发送前**再比一次；模式/策略/会话任一变化就抛「发送已取消」。这是防「排队期间权限被撤，消息照样发出去」。
2. `shouldBlockSilentReply(key)`（`src/bridge.js:9062-9066`）：静默模式下除管理员私聊外全拦。
3. `fishGuardSendBlock`（`src/bridge.js:9930-9949`）：群聊 + 保护冷却 → 返回带剩余分钟的错误。
4. `tokenGuardSendBlock`（`src/bridge.js:10047-10055`）：每回合出站条数，**先占额度**（即使失败也不退，防失败重试刷 token）。
5. 频率：`sendTimes` 每分钟/每小时计数，**先预占再发**，失败路径按未发条数回滚（`src/bridge.js:6015-6044`）。
6. 内容：字数上限 `maxMessageChars`、`SENSITIVE_RE` 命中即 403。
7. `onebotSend`（`src/bridge.js:8464-8502`）：含已知 agent token → 直接抛错拒发；`[CQ:` 转全角防网关解析；15 秒超时。

### 4.4 语音

- 两条通道分开（注释 `src/bridge.js:1888-1891`）：
  - **AI 通道** `/api/socialV2/send-voice`：必须 `reserved2` + 有效 agent token + 工具开关 + 白名单 + 静默检查 + **语音触发规则**（`src/bridge.js:6654-6752`）。
  - **操作者通道** `/api/voice/send` 或 `/api/send/voice`：凭 consoleToken，跳过会话/模式闸门，但保留白名单 + 限流 + 文件名审计；带 agent token 打 `/api/send/voice` 一律 403 让改走 AI 通道（`src/bridge.js:6533-6651`）。
- 路径解析：AI 只能从语音库取文件；绝对路径也必须落在库内（`voicePathInsideLibrary` 用 `path.relative` 判逃逸）；相对路径必须 `safeJoinLibrary`（含 realpath，挡 symlink）；省略扩展名按 `AUDIO_EXTS` 逐个试；错误提示只报目录 basename，**不回显绝对路径**（`src/bridge.js:2041-2117`）。
- 触发规则 `voiceTriggerBlock`（`src/bridge.js:1919-1951`）：私聊必须主人（或 list 名单）；群聊要「主人 10 分钟内开过口」且「一条主人消息最多换一条语音」；`who='anyone'` 直接放行。
- 发送：`inspectAudio`（时长/大小）→ `processAudioVolume`（音量/响度，默认原样不动）→ 走 `sendChain` → `POST send_group_msg/send_private_msg` 带 `record` 段，60 秒超时（SILK 转码较慢）→ `finally cleanupTemp`（`src/bridge.js:2171-2253`）。
- 限额：`voiceBudgetCheck` 只检查、`voiceBudgetCommit` 在**真的发出后**才记账（避免参数错/被拦/网关失败也吃配额）（`src/bridge.js:2137-2161`）。
- 落地校验：`verifyVoiceMessageSent` 用 `get_msg` 回读，确认存在 `record` 段；只回 `confirmed + duration`，**不回 file/url**（私聊 `get_msg` 会把源文件路径塞进 url，回给模型等于把本机路径写进上下文）（`src/bridge.js:2286-2315`）。
- 转写回读 `fetch_ptt_text` 对自己发的语音通常拿不到（`src/bridge.js:2278-2285`）。

### 4.5 图片 / 表情

- 表情发送 `sendStickerV2`（`src/bridge.js:2361-2433`）：先强制 `syncStickerLibrary(true)`（刚加的能用、刚删的不会继续发）→ `findSticker` → `safeFetchBuffer(entry.url, MAX_MEDIA_BYTES)`（**在桥接内下载**，不把 URL 交给网关重新抓）→ `base64://` 图片段 → 与文本共用 `sendChain` → 发送前 `sleep(800~2000)` 模拟真人。
- 表情消息**不能带文字**（一条消息只能一张表情），要说话请先单独发文字（`src/bridge.js:6764-6767`、`src/bridge.js:2373-2374`）。
- 入站图片取字节 `fetchOneBotImage`（`src/bridge.js:8719-8797`）：表情优先 URL/CDN，普通图片优先 `get_image`；`get_image` 返回 `data`/`base64`/`file`（本地路径需在 `snowluma.homeDir` 内）/`url` 四路兜底；`file` 字段必须是「简单缓存文件名」（拒绝路径/盘符/协议/`..`）（`src/bridge.js:8677-8686`）。
- 表情 CDN 兜底：只有**纯十六进制** `emoji_id` 才拼 URL（`src/bridge.js:8692-8696`）。
- 每次取图都过格式 + 像素上限（防图片炸弹）（`src/bridge.js:8705-8717`）。
- 动图（GIF/动画表情）在文本层标 `[动图]`、`media[].animated=true`；取图时说明「只提供其中一帧」，避免模型把一帧当成整段动画。
- **长图切段**（`src/long-image.js` + `fetchMediaData()/resolveMediaList()`）：DSH 图像准入有
  「单边 ≤8192 / 总像素 ≤64MP / 字节 ≤20MB」三道闸，归一化再把超过 4MP 的图等比缩小；
  QQ 长截图（实测 1320×15378）会因单边超标被**整张拒收**（模型只看到 `[image unavailable ...]`）。
  桥接在交给 MCP/DSH 之前按 `planLongImageSlices()` 纵向切段（每段 1320×≤3000，
  落在归一化预算内所以不缩放、文字保持清晰；相邻重叠 80px、最多 12 段），
  用本机带 Pillow 的 Python 执行 `sliceImageWithPillow()`（配置 `socialV2.media.pythonPath`
  → DSH 自带运行时 → PATH 依次探测）。拿不到 Pillow 或切图失败时把可行动的原因写进工具结果，
  不静默失败；`socialV2.media.sliceLongImages:false` 可整体关闭（见 PITFALLS #91）。


### 4.6 合并转发

- 入站：`forward` 段 → `[转发消息 id=...]`（`src/bridge.js:1530-1534`），id 经 `sanitizeForwardId` 归一后登记到 `seenForwardIds`（上限 1000）。
- 读取 `/api/socialV2/forward-message`（`src/bridge.js:7482-7573`）：仅 `reserved2` + 必须 agent token + **只允许读本会话确实收到过的 id**（三个来源：recent / unread / 内存登记）；嵌套转发会自动登记并抓最多 5 条预览（每条 3 条消息、120 字符）。

### 4.7 拍一拍

- 发送 `/api/socialV2/send-poke`（`src/bridge.js:6203-6310`）：群聊必须 `targetUserId` 且**必须是本群成员**（`assertGroupMember` 失败即拒，`src/bridge.js:11906-11930`）；`captureSendGuard` 在真正发之前再校验一次（成员校验是异步的，期间可能切模式）；写 `recentMessages` 一条 `kind:'poke'` 记录。
- 接收 `handlePokeNotice`（`src/bridge.js:14030-14095`）：自己拍的忽略；非 `reserved2` 只记录；黑名单也拦；`triggers.poke` 开着才唤醒。
- 群里的人拍了拍**别人**也会唤醒并唤醒提示里说明「可能拍的是别人」（`src/bridge.js:12636-12638`）。

### 4.8 回执校验（如何确认「真的发出去了」）

- 文本：`lastSendFailed` 标记 + `lastSendSucceeded(key)`（`src/bridge.js:8235`、`src/bridge.js:8263-8266`）。**只有 `lastSendSucceeded` 为真才刷新活跃时间/`lastAiReplyAt`**（`src/bridge.js:14460-14469`）——旧代码无条件刷新，导致「群里什么都没收到但状态说我说过了」。
- 语音：`verified` = `get_msg` 回读到 `record` 段（§4.4）。
- 表情：用返回的 `message_id` 写 `recentMessages`（`src/bridge.js:6824-6839`）。

---

## 5. 会话与状态

### 5.1 三份持久化文件

| 文件 | 内容 | 上限/裁剪 | 位置 |
|---|---|---|---|
| `state/sessions.json` | `{sessions:{key→sessionId}, sessionPolicies:{key→签名}}` | 无（按 key 数） | `src/bridge.js:111`、`src/bridge.js:1245-1291` |
| `state/social-v2.json` | 每会话 wakeConfig / recent / unread / agentToken / 水位 / 记忆 / 鱼群 / 收尾 | recent ≤200、unread ≤100、wakeTimes ≤200、sendTimes ≤500、activeTopics/pendingThoughts ≤50、impressions ≤50、fishGuardLog ≤30、seenForwardIds ≤1000 | `src/bridge.js:114`、`src/bridge.js:9628-9670` |
| `state/initial-prompts.json` | 操作者预写的每会话「环境介绍」 | 单条 ≤ `initialPromptMaxChars`（100~8000，默认 2000） | `src/bridge.js:117`、`src/bridge.js:9681-9801` |

三份都是「**读坏就只读降级**」：`stateWritable` / `initialPromptsWritable` / `slangStoreWritable` / `stickerStoreWritable`。原则一致——宁可这一轮不写，也不能用内存里的空数据覆盖磁盘（`src/bridge.js:1247-1251`、`src/bridge.js:9698-9702`、`src/bridge.js:1770-1772`、`src/bridge.js:1790-1801`）。

`social-v2.json` 还多一层保护：加载前后取文件指纹（`size:mtimeMs`），变了就**跳过回写**，防两个实例互相覆盖（`src/bridge.js:9476-9488`、`src/bridge.js:9606-9621`）。

### 5.2 会话 key 与策略签名

- key 只有两种：`group:<正整数>` / `private:<正整数>`。`canonicalV2Key` 去前导零并拒绝非安全整数（`src/bridge.js:1631-1637`）。所有入口都用它归一，避免同一会话分裂成多个状态（`src/bridge.js:9422-9430`）。
- 策略签名 `sessionPolicy(key)` = `JSON.stringify([currentMode, preset, closedAgent?ownerQQ:null])`（`src/bridge.js:3301-3303`）。
- 判「是否仍是当前会话」= 模式允许 ∧ 映射一致 ∧ 签名一致（`src/bridge.js:3305-3308`）。签名一变就退役重建——这是「切模式/改白名单/改 preset 后上下文重置」的实现。

### 5.3 agentToken

- 每会话一个 32 位 hex（懒创建时随机）（`src/bridge.js:9440`），会话退役时**轮换**（`src/bridge.js:3374-3381`）。
- 脱敏集合 `KNOWN_AGENT_TOKENS` + 按会话记账的 `CONVERSATION_TOKENS`（保留当前代 + 上一代）。为什么不用硬 LRU 上限：淘汰掉仍有效的 token 等于把活令牌漏到 QQ；按会话记账后集合大小 ≈ 会话数 × 2（注释 `src/bridge.js:586-603`）。兜底上限 512，只淘汰「非活代」（`src/bridge.js:618-626`）。
- 令牌会**写进唤醒提示词**（`src/bridge.js:12545`），因此出站前有 `redactKnownTokensOnly`（`src/bridge.js:8224-8230`）与「含 token 直接拒发」（`src/bridge.js:8478-8482`）两道。

### 5.4 会话退役与重建

`retireSession(key)`（`src/bridge.js:3345-3386`）做全套清理：删映射与策略 → `forgetConversationCaches` → `reverse`/`collectors`/`sessionModels`/`modelAppliedSessions`/`sendToolSucceededSessions`/`pendingSendToolCalls`/`v2TurnStartAt`/`turnLeaseNoted`/`toolCallNames`/社交集合 → `api.events.forget`（退订，否则每次重连都重发整份快照）→ 清 pending 与所有 per-conversation 定时器 → 轮换 token → `saveState` + `saveSocialV2State` → `stopRetiredSessionWork`（先停后归档，`src/bridge.js:3316-3323`）。

`reconcileSessionPolicies()`（`src/bridge.js:3388-3402`）遍历全部会话，不满足 `isCurrentSession` 的就退役。**但 `dshPresetIds` 为空时直接 return**——否则一次网络抖动会让所有会话集体退役、上下文全丢（注释 `src/bridge.js:3389-3398`）。

重建路径 `ensureSession(key)`（`src/bridge.js:9119-9212`）：

1. 代际 `sessionEpoch` + 策略快照。
2. 已有会话且 `isCurrentSession` → `ensureChatModel`；返回 `not-found` 说明 DSH 侧会话没了（DSH 重启/归档竞态）→ `retireSession` 后重建（`src/bridge.js:9130-9139`）。
3. `sessionPromises` 去重（防并发重复创建）。
4. 创建顺序有安全含义：`workspace.create` → `rename(title)` → `sessions.create({workspaceId, agentPreset})`。
5. **`strictPreset`（非 closed-agent）拿不到 preset 就拒绝建会话**，绝不回退 DSH 默认 preset——那会把 bash/文件读写暴露给 QQ 群（`src/bridge.js:9148-9156`）。只有 `closed-agent` 允许「无 preset 降级」（`src/bridge.js:9162`、`src/bridge.js:9174-9176`）。
6. 创建后复核 epoch/policy，不一致就 archive 丢弃（`src/bridge.js:9188-9192`）。
7. 写 `state.sessions` / `sessionPolicies` / `reverse` 并 `saveState`，再 `ensureChatModel`，最后复核一次（`src/bridge.js:9193-9201`）。

### 5.5 模式切换时的处理

三处触发：`refreshMode` 轮询发现变化（`src/bridge.js:3510-3529`）、控制台 `/api/mode`（`src/bridge.js:4185-4203`）、启动就绪时（`src/bridge.js:3498-3506`）。动作：

- 离开 `reserved` → `cleanupSocialForModeChange()`（连带 reject 排队中的 prompt，防调用方永久挂起）（`src/bridge.js:10471-10485`）。
- 离开 `reserved2` → `clearAllSocialV2Timers()` + `drainAllPromptQueues('模式切换，已取消排队中的投递')`。
- 进入 `reserved2` → 对所有会话 `setupSleepTimerV2` + `scheduleProactiveCheckV2`（补回有限潜水定时器，否则「infinite=false 但没有定时器」）。
- 然后 `lastMode = currentMode`。

`/api/mode` 还会写穿 DSH settings（`src/bridge.js:4174-4182`）；写穿失败只警告，因为下一次 `refreshMode` 会把它回滚（注释 `src/bridge.js:4170-4172`）。

### 5.6 未读水位（`seq` / `readThroughSeq`）

这里是「已读」语义的核心，也是最容易误解的地方：

- 每条入站消息有一个**本地自增 `seq`**（不是 QQ messageId）（`src/bridge.js:12135`）。
- 只有「真的展示给过模型」的 seq 才算可达：`noteModelMessagesV2` 记录到 `modelSeenSeqs`（`src/bridge.js:12402-12410`），`readThroughSeqV2` 只推进到「见过」或「已被 unread 上限挤出、永远不可能再展示」的 seq（`src/bridge.js:12386-12400`）。
- `requestedReadThroughSeqV2` 拒绝超出水位的值（400）（`src/bridge.js:12412-12422`）。
- `acknowledgeMessagesV2(st, null)` 会清空全部未读——这是**有意保留的旧语义**（控制台与旧 preset 依赖），新工具都要求带水位（`src/bridge.js:12424-12436`、`src/bridge.js:5603-5606`）。
- 这条收据只存在内存里：重启后模型必须重新读未读（`src/bridge.js:12384-12385`）。

---

## 6. 控制台 HTTP API

服务只监听回环，`Host` 头必须是 `127.0.0.1|localhost|[::1]:<实际绑定端口>`（`src/bridge.js:8201`、`src/bridge.js:3863-3871`）。

**令牌图例**：

- `C` = 需要 consoleToken（`x-console-token` 头或 `?token=`）。除特别说明，**所有端点都要 C**。
- `A` = 允许带 `x-agent-token` 调用（受 §7.4 白名单约束）。
- `A!` = 带 agent token 时被显式拒绝（仅控制台）。
- `An` = 允许「无令牌的智能体调用」（`x-agent-call` 头 + 无 token），仅 `/api/status`、`/api/send/*`、`/api/images/*`（`src/bridge.js:3918-3925`）。
- 副作用列写「读写文件 / 改内存 / 发 QQ / 调 DSH」。

### 6.0 页面与状态

| 方法 | 路径 | 令牌 | 副作用 |
|---|---|---|---|
| GET | `/` | C（无令牌返回 401 提示页） | 读 `public/console.html` | `src/bridge.js:4017-4025` |
| GET | `/favicon.ico`、`/apple-touch-icon.png` | 免（204） | 无 | `src/bridge.js:3853-3857` |
| GET | `/api/status` | C；`A`/`An` 时只回最小字段 | 只读 | `src/bridge.js:4026-4096` |

`/api/status` 的 agent 视图只有 `mode/role/roleMode/dshReady/socialV2Paused`；管理端视图额外含 `root/dshBaseUrl/closedAgentPreset/ownerQQ/allowGroups/allowPrivate/purpose/closure/snowluma/activity`（`src/bridge.js:4035-4094`）。判定「是智能体」必须同时看 `x-agent-token` **和** `x-agent-call`——只看 token 会让旧的无令牌只读工具落到管理端视图（注释 `src/bridge.js:4031-4034`）。

### 6.1 B站（管理端只读 + 手动触发）

| 方法 | 路径 | 令牌 | 副作用 |
|---|---|---|---|
| GET | `/api/bili/status` | C | 只读 | `src/bridge.js:4098` |
| GET | `/api/bili/prompt-preview` | C | 只读（预览注入块） | `src/bridge.js:4112` |
| POST | `/api/bili/memory/refresh` | C | 重建记忆索引（写盘） | `src/bridge.js:4125` |
| POST | `/api/bili/share-now` | C | **发 QQ**（分享卡） | `src/bridge.js:4130` |
| POST | `/api/bili/dynamics/poll` | C | 拉 B站动态，可能**发 QQ** | `src/bridge.js:4136` |

> `/api/bili/*` 不拒绝 agent token，但也不在 agent 白名单里 → 实际被 `src/bridge.js:3984-3994` 挡住。

### 6.2 模式 / 角色 / 人格

| 方法 | 路径 | 令牌 | 副作用 |
|---|---|---|---|
| GET | `/api/presets` | C | 只读（DSH preset 清单） | `src/bridge.js:4142` |
| POST | `/api/mode` | C | 写 `state/mode.json` + 写 DSH settings + 触发模式清理 + `reconcileSessionPolicies`（可能批量退役） | `src/bridge.js:4151-4206` |
| POST | `/api/role` | C | 写 `state/current-role.json` | `src/bridge.js:4208` |
| POST | `/api/role-mode` | C | 写 `state/current-role.json`（`silent`/`active`） | `src/bridge.js:4227` |
| GET | `/api/roles` | C | 只读（列表 + 统计 + 上限） | `src/bridge.js:4237` |
| GET | `/api/roles/content` | C | 只读（正文 + 警告 + 小节生效报告） | `src/bridge.js:4250` |
| POST | `/api/roles/limit` | C | 写 `config.json` 的 `role.maxInjectChars` + 热更新内存 | `src/bridge.js:4269` |
| POST | `/api/roles/create` | C | 写 `roles/<名>.md` | `src/bridge.js:4282` |
| POST | `/api/roles/update` | C | 覆盖 `roles/<名>.md` | `src/bridge.js:4293` |
| POST | `/api/roles/rename` | C | 重命名文件；若正启用则跟随切换 | `src/bridge.js:4304` |
| POST | `/api/roles/delete` | C | **移到 `state/role-trash/`**（不是 rm），必要时清当前人格 | `src/bridge.js:4320-4337` |

### 6.3 仿真提示词（预设内置）

| 方法 | 路径 | 令牌 | 副作用 |
|---|---|---|---|
| GET | `/api/preset/sim-prompt` | C | 只读 | `src/bridge.js:4341` |
| POST | `/api/preset/sim-prompt` | C | 备份 + 写源 YAML + 同步安装副本；**需重启 DSH 生效** | `src/bridge.js:4360-4408` |
| GET | `/api/preset/sim-prompt/backups` | C | 只读 | `src/bridge.js:4410` |
| POST | `/api/preset/sim-prompt/restore` | C | 校验安全不变量后还原 + 同步安装副本 | `src/bridge.js:4420-4451` |

三处安全点：`knownPresetName` 白名单（防 `preset=..\..` 越出仓库，`src/bridge.js:485-489`）；内容没变就不写（否则「打开又保存」会把提示词块变成全删全加的 diff，`src/bridge.js:4366-4373`）；还原时必须过 `presetPromptBlockers`，否则旧备份会把弱化版提示词（缺「你没有本地工具」等不变量）写回去（`src/bridge.js:4434-4441`）。

### 6.4 黑话库

| 方法 | 路径 | 令牌 | 副作用 |
|---|---|---|---|
| GET | `/api/slang` | C | 只读（可 `?status=` 过滤） | `src/bridge.js:4455` |
| POST | `/api/slang` | C | 新增词条 + 写盘 | `src/bridge.js:4461` |
| POST | `/api/slang/clear` | C | 按 status 或全清（全清会同时清窗口/冷却/限频） | `src/bridge.js:4483` |
| POST | `/api/slang/batch-delete` | C | 删（按 ids 或 status） | `src/bridge.js:4508` |
| POST | `/api/slang/batch-confirm` | C | 批量确认（缺 meaning 的跳过） | `src/bridge.js:4535` |
| POST | `/api/slang/batch-reject` | C | 批量拒绝 | `src/bridge.js:4557` |
| PATCH | `/api/slang/<id>` | C | 改字段 | `src/bridge.js:4577` |
| POST | `/api/slang/<id>/confirm` | C | 确认（必须先有 meaning） | `src/bridge.js:4602` |
| POST | `/api/slang/<id>/reject` | C | 拒绝 | `src/bridge.js:4624` |
| DELETE | `/api/slang/<id>` | C | 删除 | `src/bridge.js:4636` |
| POST | `/api/slang/extract` | C | **触发模型回合**（学习会话） | `src/bridge.js:4646` |
| POST | `/api/slang/research` | C | **触发模型回合**（联网研究） | `src/bridge.js:4661` |
| POST | `/api/slang/config` | C | 写 `config.json` 的 `slang` + 必要时重置学习会话 | `src/bridge.js:4673-4707` |

### 6.5 会话查看 / 挂起 / 白名单

| 方法 | 路径 | 令牌 | 副作用 |
|---|---|---|---|
| GET | `/api/sessions` | C | 只读 | `src/bridge.js:4710` |
| GET | `/api/pending` | C | 只读 | `src/bridge.js:4719` |
| GET | `/api/whitelist` | C | 只读 | `src/bridge.js:4734` |
| POST | `/api/whitelist` | C | 写 `config.json` + 热更新 + `reconcileSessionPolicies`（可能批量退役） | `src/bridge.js:4738-4776` |

`deny.users` 在请求里缺省时**保留原值**而不是清空——旧控制台只提交 `private/groups`，直接覆盖会悄悄抹掉设置页拉黑的人（`src/bridge.js:4749-4755`）。

### 6.6 DSH 模型 / 思考强度

| 方法 | 路径 | 令牌 | 副作用 |
|---|---|---|---|
| GET | `/api/dsh/model` | C | 只读（读 `session.modelCatalog`，3 秒超时，失败降级内置清单） | `src/bridge.js:4780-4825` |
| POST | `/api/dsh/effort` | C | 写 `config.json` + `modelSelectionEpoch++`（下一条消息重新 selectModel） | `src/bridge.js:4827-4842` |

`globalSideEffect: true` 是明确告知：`selectModel` 会同时改 DSH 全局默认模型（`src/bridge.js:4821-4823`）。

### 6.7 安全 / 令牌 / 问候 / 目的 / 测试

| 方法 | 路径 | 令牌 | 副作用 |
|---|---|---|---|
| GET | `/api/security` | C | 只读（含 `stateDir.hardened` 与可复制命令） | `src/bridge.js:4846` |
| POST | `/api/security` | C | `rehardenStateDir:true` 重跑 ACL 收紧；否则写 `config.json` | `src/bridge.js:4863-4882` |
| POST | `/api/console/token` | C | 写 `config.json` + 写 `state/console-token` + 热更新；返回新令牌 | `src/bridge.js:4885-4914` |
| POST | `/api/greeting/test` | C | **发 QQ**（手动试发，不占当天名额） | `src/bridge.js:4919-4956` |
| GET | `/api/purpose/status` | C | 只读 | `src/bridge.js:4959` |
| POST | `/api/purpose/preview` | C | 只读（真算但不投递、不写状态） | `src/bridge.js:4973` |
| POST | `/api/purpose/run` | C | **发 QQ 私聊**（force 跳过排程/安静时段） | `src/bridge.js:4983` |
| POST | `/api/test-send` | C | **发 QQ**（强制白名单 + 模式 + 敏感正则） | `src/bridge.js:4994-5015` |

`/api/greeting/test` 的临时目标必须在私聊白名单内，避免变成「任意号码探测」（`src/bridge.js:4932-4941`）。

### 6.8 一代社交

| 方法 | 路径 | 令牌 | 副作用 |
|---|---|---|---|
| POST | `/api/social/state` | C | 改内存状态机（手动进/出活跃） | `src/bridge.js:5016` |
| GET | `/api/social` | C | 只读 | `src/bridge.js:5036` |
| POST | `/api/social` | C | 写 `config.json` 的 `social`（大量归一化/夹取/区间修正） | `src/bridge.js:5048-5092` |
| POST | `/api/social/flush` | C | **触发模型回合**（投喂摘要） | `src/bridge.js:5094` |
| POST | `/api/console/notify-ai` | C | **触发模型回合**（后台提醒，`silent`，不自动转发） | `src/bridge.js:5101-5169` |

### 6.9 二代配置 / 总开关 / 重置

| 方法 | 路径 | 令牌 | 副作用 |
|---|---|---|---|
| GET | `/api/socialV2/config` | C `A!` | 只读 | `src/bridge.js:5171` |
| POST | `/api/socialV2/config` | C `A!` | 写 `config.json`；`wake` 默认键变化时刷新所有用默认值的会话 | `src/bridge.js:5175-5357` |
| GET | `/api/socialV2/activity` | C `A!` | 只读 | `src/bridge.js:5358` |
| POST | `/api/socialV2/activity` | C `A!` | 暂停/恢复二代 AI（暂停会清所有定时器） | `src/bridge.js:5362-5379` |
| POST | `/api/socialV2/reset` | C `A!` | **清空全部二代会话状态**、停 DSH 会话、写空 `social-v2.json` | `src/bridge.js:5380-5421` |
| GET | `/api/socialV2/states` | C `A!` | 只读（全会话概览） | `src/bridge.js:5804` |

### 6.10 二代读接口（`A`）

| 方法 | 路径 | 工具开关 | 说明 |
|---|---|---|---|
| GET | `/api/socialV2/state` | `socialState` | 唤醒配置 + 水位 + 收尾状态 | `src/bridge.js:5422-5446` |
| GET | `/api/socialV2/prompt` | `getPrompt` | 角色/工具清单/推荐值/记忆/表情/收尾/语音库摘要 | `src/bridge.js:5447-5553` |
| GET | `/api/socialV2/unread` | `getUnread` | 支持 `afterSeq` 游标；带表情匹配 | `src/bridge.js:5555-5578` |
| GET | `/api/socialV2/recent` | `getRecent` | 支持 `offset` | `src/bridge.js:5579-5594` |
| GET | `/api/socialV2/my-recent` | `getMyRecent` | 自己发过的 | `src/bridge.js:7414` |
| GET | `/api/socialV2/active-members` | `getActiveMembers` | 从 recent 聚合 | `src/bridge.js:7593-7616` |
| GET | `/api/socialV2/message-detail` | `getMessageDetail` | 200 字符预览 + `textTruncated` | `src/bridge.js:7431-7480` |
| GET | `/api/socialV2/forward-message` | `getForwardMsg` | 见 §4.6 | `src/bridge.js:7482-7573` |
| POST | `/api/socialV2/forward-media` | `getForwardMsg` | 取转发里的图片字节 | `src/bridge.js:7574-7592` |
| GET | `/api/socialV2/memory` | `memory` | 三类记忆 | `src/bridge.js:7701-7726` |
| GET | `/api/socialV2/slang/query` | `slangQuery` | 已确认词条（**不含 evidence**） | `src/bridge.js:7771-7793` |
| GET | `/api/socialV2/voices`、`/api/voice/list` | `sendVoice` | 库内文件名；**不含绝对路径** | `src/bridge.js:6916-6959` |
| GET | `/api/socialV2/sticker-list` | `listStickers` | **GET 不支持 refresh**（写副作用不能挂在读接口上） | `src/bridge.js:6961-6983` |
| GET | `/api/socialV2/sticker-image` | `getStickerImage` | 取表情图字节（含像素上限） | `src/bridge.js:6312-6346` |
| GET | `/api/socialV2/self-image` | `getSelfImage` | 读 `assets/deepseek娘.png` | `src/bridge.js:6347-6363` |
| GET | `/api/socialV2/tool-log` | — `A!`（GET 也是） | 工具调用日志 | `src/bridge.js:7359` |
| GET | `/api/socialV2/feedback` | — `A!` | 反馈列表 | `src/bridge.js:7372` |

`/api/socialV2/prompt` 的 `toolMap`（30 项 flag→工具名）决定了模型看到哪些工具（`src/bridge.js:5459-5497`），`sticker` 全局开关会连带隐藏 6 个表情工具（`src/bridge.js:5493-5496`）。

### 6.11 二代写接口（`A`）

| 方法 | 路径 | 工具开关 | 副作用 |
|---|---|---|---|
| POST | `/api/socialV2/mark-read` | `markRead` | 清未读到水位（受沉睡前观察闸门约束） | `src/bridge.js:5595-5636` |
| POST | `/api/socialV2/wake-config` | `setWakeConfig` | 改唤醒配置（大段归一化 + 防永眠校验） | `src/bridge.js:5659-5803` |
| POST | `/api/socialV2/close` | `closeConversation` | 记收尾点，不改 wakeConfig | `src/bridge.js:5639-5658` |
| POST | `/api/socialV2/wake` | — `A!`（仅控制台） | **触发模型回合** | `src/bridge.js:5820-5854` |
| POST | `/api/socialV2/history-catchup` | — `A!` | 拉历史，可能唤醒 | `src/bridge.js:5857-5866` |
| GET/POST | `/api/socialV2/initial-prompt` | — `A!` | 读/写 `state/initial-prompts.json` | `src/bridge.js:5869-5922` |
| POST | `/api/socialV2/send-burst` | `sendBurst` | **发 QQ**（多段） | `src/bridge.js:5923-6048` |
| POST | `/api/socialV2/send-message` | `sendMessage` | **发 QQ**（单/多段，可引用/@） | `src/bridge.js:6050-6202` |
| POST | `/api/socialV2/send-poke` | `sendPoke` | **发 QQ**（拍一拍） | `src/bridge.js:6203-6310` |
| POST | `/api/socialV2/send-voice` | `sendVoice` | **发 QQ**（语音） | `src/bridge.js:6654-6752` |
| POST | `/api/socialV2/send-sticker` | `sendSticker` | **发 QQ**（表情） | `src/bridge.js:6754-6862` |
| POST | `/api/socialV2/collect-sticker` | `collectSticker` | 改 QQ 收藏表情 + 刷库 | `src/bridge.js:6864-6910` |
| POST | `/api/socialV2/sticker-note` | `stickerNote` | 写本地表情认知 | `src/bridge.js:6364-6386` |
| POST | `/api/socialV2/sticker-remark` | `setStickerRemark` | 改 QQ 官方备注 | `src/bridge.js:6388-6404` |
| POST | `/api/socialV2/sticker-list` | `listStickers` | 强制刷新（AI 侧最小间隔 10 秒） | `src/bridge.js:6984-7009` |
| POST | `/api/socialV2/memory-append` / `-update` / `-remove` / `-clear` | `memory` | 写会话记忆 | `src/bridge.js:7617-7768` |
| POST | `/api/socialV2/slang/submit` | `slangSubmit` | 写黑话库（限频 2/分、10/时） | `src/bridge.js:7794-7849` |
| POST | `/api/socialV2/feedback` | `feedback` | 写 `state/feedback.json`（限频 5/分、20/时） | `src/bridge.js:7383-7412` |
| POST | `/api/socialV2/feedback-clear` | — `A!` | 清空反馈 | `src/bridge.js:7376` |
| POST | `/api/socialV2/tool-log/clear` | — `A!` | 清空工具日志 | `src/bridge.js:7364` |
| POST | `/api/socialV2/wait` | `waitMessages` | **长轮询**（最长 10 分钟，占一个 HTTP handler） | `src/bridge.js:7063-7280` |
| POST | `/api/socialV2/check-send` | — | 只读（发送前探测工具是否启用） | `src/bridge.js:7282-7310` |
| POST | `/api/socialV2/record-sent` | — | **永远 403**（内部接口，防伪造历史） | `src/bridge.js:7426-7429` |

三条容易被忽略的「必须 `reserved2` + 必须 agent token」：`send-burst`（`src/bridge.js:5963-5967`）、`send-message`（`src/bridge.js:6096-6097`）、`send-sticker`（`src/bridge.js:6771-6772`）。而 `send-voice` / `send-poke` / `forward-message` 也各自显式要求。

### 6.12 管理端表情库

| 方法 | 路径 | 令牌 | 副作用 |
|---|---|---|---|
| GET | `/api/stickers` | C `A!` | 只读（不强制同步） | `src/bridge.js:7012-7024` |
| POST | `/api/stickers/sync` | C `A!` | 拉 OneBot 收藏表情 + 写盘 | `src/bridge.js:7026` |
| POST | `/api/stickers/note` | C `A!` | 写本地认知 | `src/bridge.js:7035` |
| POST | `/api/stickers/remark` | C `A!` | 改 QQ 官方备注 | `src/bridge.js:7051` |

### 6.13 Token 用量 / 花费（控制台专用）

| 方法 | 路径 | 副作用 |
|---|---|---|
| GET | `/api/tokens/summary` | 只读 | `src/bridge.js:7318` |
| GET | `/api/tokens/daily` | 只读（当日用量 + 闸门判定） | `src/bridge.js:7323` |
| GET | `/api/tokens/series` | 只读（分桶曲线） | `src/bridge.js:7330` |
| GET | `/api/tokens/turns` | 只读（某会话逐轮） | `src/bridge.js:7336` |
| GET | `/api/tokens/recent` | 只读 | `src/bridge.js:7344` |
| POST | `/api/tokens/reset` | 重置账本 | `src/bridge.js:7349` |

整族显式拒绝 agent token（`src/bridge.js:7317`），路径刻意不放在 `/api/socialV2/` 下——那个前缀对 agent 是放行的，跨群花费属于管理信息（注释 `src/bridge.js:7312-7315`）。

### 6.14 语音

| 方法 | 路径 | 令牌 | 副作用 |
|---|---|---|---|
| GET/POST | `/api/voice/rules` | C | 读/写 `config.json` 的 `socialV2.voice`（触发者、限流、TTS 路由、云价格/配额） | `src/bridge.js:6411-6454` |
| GET | `/api/voice/packs` | C | 只读 | `src/bridge.js:6461` |
| POST | `/api/voice/packs/install`、`/remove`、`/activate`、`/start`、`/stop`、`/enable`、`/test` | C | 装/删/启停本地语音引擎（**有外部下载与进程操作**） | `src/bridge.js:6465-6524` |
| GET | `/api/voice/packs/cloud-stats`、`/cloud-config` | C | 只读（云端用量/配置） | `src/bridge.js:6490-6497` |
| POST | `/api/voice/packs/cloud-config` | C | 写云端配置 | `src/bridge.js:6498` |
| GET | `/api/voice/packs/sample` | C | 返回 `audio/wav` 字节 | `src/bridge.js:6503-6514` |
| POST | `/api/voice/send`、`/api/send/voice` | C（带 agent token 走 `/api/send/voice` 直接 403） | **发 QQ** | `src/bridge.js:6533-6651` |

### 6.15 授权 / 图片 / 旧发送端点

| 方法 | 路径 | 令牌 | 副作用 |
|---|---|---|---|
| POST | `/api/authorize/read` | C；`A`（**必须**带 token） | 只读（权限探测） | `src/bridge.js:7851-7872` |
| GET | `/api/images/message` | C；`reserved2` 必须 token；`chat/reserved` 一律 403 | 取图片字节（可能下载） | `src/bridge.js:7874-7920` |
| POST | `/api/send/group` | C/`A`（`reserved2` 必须 token） | **发 QQ** | `src/bridge.js:7923-8033` |
| POST | `/api/send/private` | 同上 | **发 QQ** | 同上 |
| POST | `/api/send/reply` | 同上（`replyToMessageId` 必填） | **发 QQ**（引用） | 同上 |

`/api/send/*` 在 `chat`/`reserved` 下一律 403——常规回复已由自动转发覆盖，MCP 发送工具不该成为 prompt injection 的越权出口（`src/bridge.js:7936-7941`）。

### 6.16 重置 / 重启 / 告警

| 方法 | 路径 | 令牌 | 副作用 |
|---|---|---|---|
| POST | `/api/session/reset` | C | 删单个会话映射 + 停 DSH 会话 + 归档 + 清全部 per-key 状态 | `src/bridge.js:8035-8090` |
| POST | `/api/workspace/reset` | C | **批量**停+归档 `state/` 下所有根会话；清空全部内存表与两张 token 表；清空活动日志 | `src/bridge.js:8091-8156` |
| POST | `/api/restart` | C | 落盘 + 释放锁 + `exit(0)`（守护模式 5 秒后拉起） | `src/bridge.js:8158-8170` |
| POST | `/api/memory-card/notify` | C | **私聊管理员**（同档 10 分钟冷却） | `src/bridge.js:8172-8194` |

`/api/workspace/reset` 只处理「cwd 在 `state/` 下且非子代理」的会话（`origin==='subagent'` 或 `parentSessionId` 跳过），避免误归档子代理会话（`src/bridge.js:8102-8114`）。

---

## 7. 安全闸门

### 7.1 Host 白名单（DNS rebinding 硬化）

`Host` 头必须精确命中 `127.0.0.1:<port>` / `localhost:<port>` / `[::1]:<port>`，端口用 `server.address().port`（**实际绑定端口**，不是配置值，因为测试夹具用 `consolePort:0`）。不匹配直接 403，早于任何业务分支（`src/bridge.js:3858-3871`）。反代/端口转发会被一并拒绝，这是有意的（要在远程用请走 SSH 隧道）。

### 7.2 consoleToken

- 取值：`config.consoleToken`（16~128 位、`[A-Za-z0-9_-]`）合法则用，否则 `loadOrCreateConsoleToken()` 读/生成 `state/console-token`（`src/bridge.js:3733-3735`、`src/bridge.js:280-289`）。
- **令牌为空即抛错拒绝启动**——旧写法「令牌空 ⇒ 放行」是失败开放分支，一旦真为空，改配置/发消息/读聊天记录全部免鉴权（`src/bridge.js:3736-3741`）。
- 比较用 `crypto.timingSafeEqual` + 长度预检，防本机进程按响应时延逐字节试探（`src/bridge.js:3872-3882`）。
- 支持 `x-console-token` 头或 `?token=`（后者会进浏览器历史/日志，属于已知折中）。

### 7.3 CSRF

非 GET 必须 `content-type` 含 `application/json`（否则 415）；带 `Origin` 时必须是本机同源（否则 403）（`src/bridge.js:3928-3946`）。这条在「用户没配 consoleToken」时尤其重要——它挡住了任意网页用表单触发 `/api/restart`、`/api/workspace/reset`、`/api/role`。

配套设计：所有**有写副作用**的接口都不挂在 GET 上（`sticker-list` 的 `refresh`、`stickers` 的同步都被显式移到 POST，`src/bridge.js:6967-6970`、`src/bridge.js:7016`）。

### 7.4 agent-token 混淆代理防护（confused deputy）

这是整套鉴权里最精细的一层，分四道：

1. **集中关卡**（`src/bridge.js:3892-3927`）：请求带 `x-agent-call` 头即视为智能体调用；带了 token 就必须命中**某个活跃会话**的 token，否则 403；**没带 token 只放行三个前缀** `/api/status`、`/api/send/*`、`/api/images/*`，`/api/socialV2/` 一概不放。为什么需要这一层：各端点自己的 `if (x-agent-token && !agentTokenOk(...))` 在头缺失时整条跳过，漏传 token 会**升级成控制台全权**。
2. **端点级会话绑定**：`agentTokenOk(key, token)`——令牌必须属于**这个** key（`src/bridge.js:3755-3759`）。
3. **管理端白名单**：带 agent token 时只允许 `/api/status`、`/api/socialV2/*`、`/api/send/*`、`/api/images/*`、`/api/authorize/read`，其余 403（`src/bridge.js:3984-3994`）。
4. **显式黑名单**：`adminOnlyV2Paths`（config/activity/reset/states/wake/initial-prompt/history-catchup）+ `feedback` 的 GET + `tool-log` 的 GET + `/api/stickers/*` 全部拒绝 agent（`src/bridge.js:3968-3980`）。`initial-prompt` 尤其重要——让 AI 自己读改写给它的「环境背景」等于把管理输入交给会话主体。

另外三道纵向约束：`socialV2.paused` 时 v2/send/images 全 403（`src/bridge.js:3953-3957`）；`cfg.socialV2.enabled===false` 同样（`src/bridge.js:3958-3962`）；带 token 访问 `/api/socialV2/*` 要求 `currentMode==='reserved2'`（`src/bridge.js:3963-3967`）。

### 7.5 发送白名单

- 会话级：`allowed()` + `modeAllowed()`，每个发送端点都查（例如 `src/bridge.js:5002-5003`、`src/bridge.js:6553-6560`、`src/bridge.js:7975-7977`）。
- 拍一拍额外要求「目标必须是本群成员」，失败即拒（fail-closed，`src/bridge.js:11906-11930`）。不校验的话，群友给个任意 QQ 号就能让桥接向网关发 `group_poke`，等于把机器人变成号码探测/骚扰工具（注释 `src/bridge.js:11902-11903`）。
- 语音：目标必须在语音库里，`allowAbsolutePath` 不再放宽 AI 通道（§4.4）。
- `@all` 被禁：`atUserId` 必须正整数（`src/bridge.js:8471-8476`、`src/bridge.js:6230-6231`）。

### 7.6 敏感信息正则与令牌脱敏

- `SENSITIVE_RE`（来自 `src/sensitive.js`）命中即视为敏感：`/api/test-send` 403、发送端点 403、审计拦截（`src/bridge.js:5001`、`src/bridge.js:5995`、`src/bridge.js:9071`）。
- `redactSensitiveText` 动态给 `SENSITIVE_RE` 补 `g` 后替换，再逐个替换 `KNOWN_AGENT_TOKENS`（`src/bridge.js:658-668`）。所有日志、活动记录、反馈、工具日志都过它（`src/bridge.js:692`、`src/bridge.js:1450`、`src/bridge.js:12252`、`src/bridge.js:12279`）。
- `redactSensitive(obj)` 递归处理工具入参，键名命中 `SENSITIVE_ARG_KEYS`（token/authorization/password/cookie/session/privatekey/… 共 20 个）就替换成 `***`，并跳过 `__proto__/constructor/prototype` 防原型污染（`src/bridge.js:12307-12322`）。
- 审计范围 `shouldAuditKey`：只有 `closed-agent` 的管理员私聊跳过，其余一律审计（`src/bridge.js:9042-9048`）。
- 拦截后的行为：发一条通用提示到 QQ（`interceptNotify` 可关），**不重发原文、不把命中内容写日志**（`src/bridge.js:9069-9082`、`src/bridge.js:14404-14422`）。
- 提问/审批的文本、选项、理由、工具名都各自过一遍敏感检查，命中则整段替换（`src/bridge.js:14575-14604`）。

### 7.7 身份闸（谁在触发）

- 审批只有 `ownerQQ` 能消费（`src/bridge.js:13998-14002`）。
- 管理命令只有 `ownerQQ` 能用（`src/bridge.js:13544-13547`）。
- 角色切换只能从管理端做，群内一律拒绝（`src/bridge.js:13536-13540`）。
- 语音触发「仅主人」，判据是**桥接自己记的** `voiceLastSpeaker` / `voiceOwnerAt`，不是 AI 自己声称（`src/bridge.js:1909-1917`、`src/bridge.js:1919-1951`）。
- 静默模式例外：管理员私聊永远不受阻（`src/bridge.js:9063-9066`）。

### 7.8 其它硬化点

- 请求体上限 1MB、Content-Length 预判、30 秒读超时、必须是 JSON 对象（`src/bridge.js:3796-3849`）。
- 安全响应头：`X-Frame-Options:DENY`、CSP、`Cache-Control:no-store`、`nosniff`、`no-referrer`（`src/bridge.js:3785-3791`）。
- 空 `x-agent-token` 头一律 403（防 MCP 传空串被当成「管理端」）（`src/bridge.js:3949-3952`）。
- 预设路径穿越：`knownPresetName` 白名单在拼路径**之前**校验（`src/bridge.js:476-489`）。
- 人格名：`sanitizeRoleName` + `ROLE_NAME_MAX` + 保留名 + Windows 设备名（CON/PRN/COM1…）拒绝（`src/bridge.js:364-443`）；**读取时也校验**，因为 `state/current-role.json` 用户可编辑，`../../x` 会让 `roles/` 之外的文件被注入每条提示词（`src/bridge.js:11538-11545`）。
- 语音库路径：`safeJoinLibrary` + `path.relative` 逃逸判定 + realpath（挡 symlink）（§4.4）。
- 图片 `file` 字段：必须是简单缓存文件名（`src/bridge.js:8677-8686`），否则等于把任意本地路径/内网 URL 交给网关造成 SSRF/任意文件读。
- `state/` 的 ACL：Windows 上 `mode:0600` 是空操作，必须 `icacls` 断继承；失败要明确报「没做成」并给安全命令，而不是假装安全（`src/bridge.js:291-326`）。

---

## 8. 定时器与后台任务

### 8.1 全局轮询

| 周期 | 任务 | 失败行为 | 位置 |
|---|---|---|---|
| 5s | `checkDsh()`：探活 + `refreshMode` + preset 清单 + `reconcileSessionPolicies` + 就绪边沿动作 | 探活失败只把 `dshReady=false` 并记日志；下次照跑 | `src/bridge.js:3535-3540` |
| 60s | `pollSnowlumaStatus()`：`get_status` 拿 `online`/`good` | 8 秒超时，失败写 `goodError` 不抛 | `src/bridge.js:3713-3718` |
| 30s | `reportSnowlumaHealth()` 边沿告警兜底 | 只打日志 | `src/bridge.js:3720` |
| 5s | `socialLoopTick()`：一代社交状态机（主动开话题/活跃检测/冷场/试探/退场） | 首行按模式直接 return | `src/bridge.js:11462-11466` |
| 60s | `purposeTick()`：目的机制 | 单飞锁 + try/catch | `src/bridge.js:11007-11018` |
| 5min | `checkProactiveAt()`：一代主动搭话 | 仅 `chat` 模式 + 在线 + 阈值 | `src/bridge.js:11765-11769` |
| `biliBridge.memory.refreshIntervalMs`（默认 10min，夹 1~60min） | `biliMemory.refresh()` | 内部处理 | `src/bridge.js:14886` |
| `biliBridge.dynamics.pollIntervalMs`（默认 3min，夹 1~60min） | `biliDynamics.start()` 内部轮询 | `isReady` 依赖 SnowLuma 连接 | `src/bridge.js:14889-14899` |
| `biliBridge.share.times`（默认 8 个整点） | `biliShare.start()` 定时分享 | `isReady` 依赖 `dshReady` | `src/bridge.js:14903-14916` |

### 8.2 每会话定时器（存在 `socialV2.conversations` 里）

| 名字 | 周期 | 作用 | 位置 |
|---|---|---|---|
| `pendingWakeTimer` | `batchWindowMs`（默认 8s） | 合并窗口，窗口内按优先级升级唤醒原因 | `src/bridge.js:12944-12951` |
| `sleepTimer` | `sleepUntil - now`，>100s 分段续期 | 有限潜水到点唤醒（`reason='timeout'`） | `src/bridge.js:13259-13297` |
| `replyCheckTimer` | `autoReplyCheckMs`（默认 30s，问号×1.5、连发≥3×1.3） | 发言后回来看看有没有人回 | `src/bridge.js:12816-12839` |
| `proactiveTimer` | 30~90 分钟随机 | 主动机会（有概率修饰） | `src/bridge.js:13306-13344` |
| `rateLimitRetryTimer` | ≤60s | 唤醒频率超限后的补发 | `src/bridge.js:12727-12739` |
| `tokenRetryTimer` | ≤60s | Token 额度/频率被拦后的重试 | `src/bridge.js:12679-12685` |

为什么 `sleepTimer` 要「100 秒分段」而不是一次性睡满：Node `setTimeout` 超过 2^31-1ms 会按 1ms 触发；而用 24 天上限太粗，系统时钟被校正/跳变时纠正太慢。100 秒级续期每次都用 `Date.now()` 重算剩余（`src/bridge.js:13278-13290`）。

### 8.3 其它一次性/退避定时器

| 场景 | 时长 | 位置 |
|---|---|---|
| 已挂起的提问/审批超时 | `questionTimeoutMs`（默认 5min） | `src/bridge.js:14105-14112` |
| 唤醒防卡死租约 | 30min | `src/bridge.js:3124-3133` |
| 摘要静默名额回收 | 5min | `src/bridge.js:9225`、`src/bridge.js:14311` |
| 目的回合回执超时 | 20min | `src/bridge.js:10891-10901` |
| 补投失败退避 | `min(3s*2^n, 60s)`，>5 次退到 60s | `src/bridge.js:3449-3462` |
| 会话重置竞态重投 | 3s | `src/bridge.js:3178` |
| `/api/restart` 实际退出 | 500ms | `src/bridge.js:8160-8168` |
| 早安重试 | `GREETING_RETRY_MS` | `src/bridge.js:11178-11197` |
| DSH 事件流重连 | 3s 起，0 帧则指数退避到 30s | `src/bridge.js:14635-14646` |
| 表情库预热 | 启动即一次 | `src/bridge.js:14872-14874` |

### 8.4 健康上报（不是「心跳协议」，是诊断）

`startSnowlumaWatch()` 装配三个探针（`src/bridge.js:3713-3721`），判定逻辑在 `snowlumaHealthSnapshot()`（`src/bridge.js:3629-3662`）：

- `confirmed = good === false`：SnowLuma **自报**接收链路坏了（它的 `[Hook]` 收不到 QQ 数据）。这是权威信号，来自心跳载荷 `status.good`（免费，30 秒一次）或 `get_status` 兜底。
- `silent = 超过 silenceWarnMs（默认 10 分钟）没有任何事件包`：说明连 SnowLuma 进程/WS 都停了，是**另一个**故障面，措辞必须分开。
- 两者的 `hint` 完全不同（`src/bridge.js:3637-3646`），日志也明确写「这不是桥接的问题」（注释 `src/bridge.js:3542-3580`）。

⚠️ 代码里有两条反面经验：**不能用 `get_login_info` 取 `good`**（它只返回 `{user_id, nickname}`，字段取错不报错，`good` 永远 null，等于权威信号整条是死代码，`src/bridge.js:3569-3573`）；**不能用「有没有事件包」判断 hook 死活**（心跳是本地生成的，会一直来，`src/bridge.js:3578-3580`）。

---

## 9. 与 B站/语音/目的机制的衔接点

只列**桥接这一侧**的调用。

### 9.1 B站

| 方向 | 桥接做什么 | 位置 |
|---|---|---|
| 记忆注入 | `biliMemory.briefBlock()` 常驻（一代拼进 roleHint、二代拼进唤醒提示）；`recallBlock(text)` 按关键词检索具体那次 | `src/bridge.js:11603-11605`、`src/bridge.js:12610-12616`、`src/bridge.js:13801-13803` |
| 定时刷新 | `setInterval(biliMemory.refresh, refreshIntervalMs)` | `src/bridge.js:14886` |
| 动态同步 | `createBiliDynamicsSync({stateDir, sendToQQ, groups, isReady: snowlumaHealth.connected})` | `src/bridge.js:14889-14899` |
| 每日分享 | `createBiliShareScheduler({deliverPrompt, groups, memory, isReady: dshReady, times, sendCard})` | `src/bridge.js:14903-14916` |
| 卡片发送 | `createBiliCardSender({getShare, fetchVideoInfo, requestMiniArk, sendGroupSegments})`；默认发 link 卡，`miniapp` 需显式 opt-in（B站小程序已下架，appid 写死在网关里改不了） | `src/bridge.js:8527-8556` |
| 群列表兜底 | `share.groups`/`dynamics.groups` 为空时跟随 `allow.groups` | `src/bridge.js:14882-14883` |
| 公开经历 | 只读 `PUBLIC_FEED`（QQ→B站 单向）与 `ALIGNMENT_BRIEF`（置顶注入）；桥接**不做语义过滤**，只守「绝不写私信」这条结构边界 | `src/bridge.js:124-132`、`src/bridge.js:695-728` |
| 自我锚点 | `saveQqSelfIdentity()` 写 `state/self-identity.json`，让插件侧能认出「自己的 QQ 资料卡」 | `src/bridge.js:12506-12521` |

隐私边界：B站记忆模块「只读公开数据与公开见闻，不读任何私信文件」（注释 `src/bridge.js:1762-1763`）。

### 9.2 语音

| 层 | 桥接做什么 | 位置 |
|---|---|---|
| 库 | `listAudioFiles(voiceCfg().dir)`；`dir` 固定解析为仓库下相对目录 | `src/bridge.js:2019-2027`、`src/bridge.js:1957` |
| 检查 | `inspectAudio`（时长/字节/编码）；`processAudioVolume`（音量/响度，SnowLuma 的 record 段没有增益字段，必须本地先调好） | `src/bridge.js:2177-2197` |
| 合成 | `synthesizeToFile`（本地 voxd，8765/8767 两条路由，带 cacheVersion 防旧音色缓存） | `src/bridge.js:1995-2017`、`src/bridge.js:1976-1991` |
| 发送 | `record` 段 + `send_group_msg`/`send_private_msg`，60 秒预算（要过 SILK 转码） | `src/bridge.js:2200-2253` |
| 回读 | `get_msg` 找 `record` 段确认落地；`fetch_ptt_text` 对自己发的语音通常拿不到转写 | `src/bridge.js:2286-2315`、`src/bridge.js:2334-2353` |
| 记账 | `voiceSendTimes` 独立计数；`voiceBudgetCheck` 只查、`voiceBudgetCommit` 发后才记 | `src/bridge.js:1893`、`src/bridge.js:2143-2161` |
| 语音包 | `createVoicePacks(cfg)` 按需实例化，装/启/停/试听全走它 | `src/bridge.js:6458-6531` |

### 9.3 目的机制（主动找主人）

| 阶段 | 桥接做什么 | 位置 |
|---|---|---|
| 素材 | `collectMaterials({conversations, biliEntries, memoryRecords, roleName, ownerUin})`——QQ 会话、B站索引、记忆卡三源 | `src/bridge.js:10595-10605` |
| 人格先验 | `analyzePersona(purposePersonaText())`；人格卡优先取角色包，回退旧 `roles/*.md` | `src/bridge.js:10607-10617`、`src/bridge.js:10665` |
| 驱动 | `deriveDrives({..., materials: 只有新素材})`——同一批旧素材不重复加权重 | `src/bridge.js:10670-10682` |
| 目标假设 | `formGoalHypotheses(...)` → `goals`/`observations` 写进状态 | `src/bridge.js:10686-10696` |
| 选题 | `minePurposeSeeds` + `selectPurpose` | `src/bridge.js:10798-10826` |
| 闸门 | `evaluatePurposeTick`（安静时段/每日上限/主人正在聊天/额度/好友/专注模式） | `src/bridge.js:10729-10753` |
| 额度 | 复用 `tokenGuardWakeBlock`——主动找主人也算一次唤醒，不能绕过 | `src/bridge.js:10757-10765` |
| 好友校验 | `greetingFriendCheck(owner)`，非好友 6 小时后再试（QQ 会 result=16 拒收） | `src/bridge.js:10767-10776` |
| 投递 | `buildPurposePrompt(...)` → `deliverPrompt(key, prompt)` → 等 `turn/end` 回执 | `src/bridge.js:10829-10890` |
| 回执 | `notePurposeOutbound`（真发出去才记）→ `notePurposeTurnEnded`（sent/silent/failed + memo）→ `applyPurposeOutcome` | `src/bridge.js:11020-11050` |
| 失败 | 投递都没成功 → `countToday -= 1`（不吃当天额度），按 `retryMs` 重试 | `src/bridge.js:10912-10926` |
| 载体 | `carrier=pet` 时桥接的自动 tick 不出发，交给插件；两边共用同一份状态文件，靠 mtime 重载 | `src/bridge.js:1687-1760`、`src/bridge.js:10944-10946` |

「60 秒 tick + 回合回执」而不是「一次性长定时器」的理由写在 `src/bridge.js:10556-10560`：系统时钟跳变/停机久了都能自纠，且重启后不重发上一枪。

### 9.4 与 DSH 的其它接触点

- `ensureChatModel`：`session.selectModel({provider, model, reasoningEffort})`，2 次重试，`not-found` 是终态（`src/bridge.js:9092-9117`）。
- `fetchModelCatalog`：`api.callUnary('session.modelCatalog')`，失败回落 `session.models`（**不能**走 `api.sessions.modelCatalog` 门面，那个版本没有该方法，`src/bridge.js:2955-2970`）。
- `stopRetiredSessionWork`：`api.stopSessionWork` + `api.workspace.archiveSession`，各 15 秒超时（`src/bridge.js:3316-3323`）。
- `rebuildInFlightCollector`：重连快照里只回放「有 `turn/start` 无 `turn/end`」的回合，否则断线那一轮的回复会被静默丢弃（token 照付、QQ 无消息、日志无记录）（`src/bridge.js:3080-3120`）。

---

## 10. 边界、失败模式与已知坑

### 10.1 会**静默失败**的地方

1. **白名单为空且 `allowAllWhenEmpty=false`**：所有消息被丢弃，QQ 上毫无反应。启动日志有警告，但如果没人看日志就等于静默（`src/bridge.js:2888-2891`）。
2. **`dshPresetIds` 为空**时 `reconcileSessionPolicies` 直接 return（这是**故意的**，见 10.2），代价是「preset 一直拿不到 → 会话策略永远不校验」。
3. **`turn/end` 丢失**：会话被判忙，之后所有唤醒只进 `pendingWakeReasons`，QQ 上表现为「它不理我了」，只能等 15 分钟租约过期或重启（`src/bridge.js:2993-2999`、`src/bridge.js:12856-12877`）。
4. **`st.sleepTimer` 被清但 `sleepUntil` 还在**：会话停在「`infinite=false` 但没有定时器」的静默态。这就是为什么唤醒频率超限必须**延后重试**而不能直接丢弃（`src/bridge.js:12701-12712`），以及无行动的兜底与 `ensureWakeableV2` 存在的原因。
5. **`pendingWakeKeys` 未清**：会话永久忙。三道兜底：30 分钟租约（`src/bridge.js:3124-3133`）、`turn/end` 分支显式删（`src/bridge.js:14321-14323`）、事件流 `finally` 全清（`src/bridge.js:14625`）。
6. **图像 `file` 字段不是简单文件名**：`getImage` 直接跳过，表情/图片变成「（获取失败）」（`src/bridge.js:8749-8751`）。日志里有 `[media] …获取失败`。
7. **`emoji_id` 缺失且 `url` 也缺失**：市场表情彻底取不到（`src/bridge.js:8688-8702`）。
8. **`sessions.json` / `social-v2.json` 读坏**：只读降级 + 一行警告；表现是「重启后聊天记录还在但状态不更新」（`src/bridge.js:1256-1274`、`src/bridge.js:9623-9625`）。

### 10.2 会**降级**但继续跑的地方

| 条件 | 降级后行为 | 位置 |
|---|---|---|
| `state/` ACL 收紧失败 | 仍启动，`/api/security` 显示未收紧 + 给命令 | `src/bridge.js:317-326` |
| 黑话库/表情库读失败 | 只读不写，写接口返回 503 | `src/bridge.js:3995-4016` |
| `initial-prompts.json` 读坏 | 只读不写 | `src/bridge.js:9703-9726` |
| DSH `session.modelCatalog` 不可用 | 思考强度退回内置清单（`low/high/max`） | `src/bridge.js:4788-4811` |
| `get_status` 不可用 | 只剩心跳信号 | `src/bridge.js:3687-3711` |
| 历史接口未实现 | 按 action 记入 `historyApiUnsupported`，只跳过该接口 | `src/bridge.js:13051-13057` |
| `bot_status` 不存在（老运行时） | 只少一个上线边沿信号 | `src/bridge.js:14700-14714` |
| 好友列表查不到 | 按「可发送」继续，让发送失败去暴露 | `src/bridge.js:11084-11088` |
| presets 清单为空 | `closed-agent` 回退 DSH 默认 preset；群聊模式**拒绝建会话** | `src/bridge.js:3267-3279` |
| `cfg.socialV2.enabled=false` | agent 的 v2 工具全 403，控制台仍可管理 | `src/bridge.js:3958-3962` |

### 10.3 **必须重启**才生效的东西

| 改动 | 为什么 | 位置 |
|---|---|---|
| 仿真提示词（预设 `persona.prefix`） | preset 由 DSH 在**会话创建时**装配 | `src/bridge.js:468-469`、`src/bridge.js:4405` |
| 角色/工作区名（黑话学习） | 改了就 `invalidateSlangLearnerSession()`，下次重建 | `src/bridge.js:4698-4704` |
| `snowluma.homeDir` | 自愈靠它读网关配置 | `src/bridge.js:14865-14867` |
| 桥接进程本身（`/api/restart` 或手动） | 配置大改（如 preset 名）后最稳 | `src/bridge.js:8158-8170` |

反过来：**不需要重启**的有——人格卡（每条注入）、记忆卡（mtime 缓存）、对齐块（mtime 缓存）、黑话库、表情库、白名单、模式、思考强度（`modelSelectionEpoch` 让下一条消息重新 selectModel）。

### 10.4 最容易误解的点（按风险排序）

1. **「连上了」≠「收得到」**。WS `open` 只证明与 SnowLuma 的链路通；QQ 侧收不到是 SnowLuma 的 `[Hook]` 坏了，桥接只能诊断不能修（`src/bridge.js:3542-3580`、`src/bridge.js:14721-14723`）。
2. **一代的「空格 = 分条」在二代不成立**。二代必须用数组分条，字符串里的空格会触发软提醒（`src/bridge.js:8369`、`src/bridge.js:11811-11832`）。
3. **`reserved2` 下 AI 的文本输出不会自动发到 QQ**。只有 `sendToolSucceeded` 或工具调用才算发言；纯文本只进日志（`src/bridge.js:14471-14473`）。这也是 `ackMessage` 在二代被跳过、以及「发送工具打了一次就跳过自动转发」的原因（`src/bridge.js:13945`、`src/bridge.js:14391`）。
4. **「已读」是本地 `seq` 水位，不是 QQ messageId**。模型传错 id 会被 400 拒（`src/bridge.js:12412-12422`、`src/bridge.js:11243`）。
5. **`qq_close_conversation` 不是潜水**。它不改 `wakeConfig`、不走沉睡前观察、冷却只压普通概率唤醒（`src/bridge.js:10149`、`src/bridge.js:10263-10274`）。
6. **沉睡前观察是「潜水」的前置，不是「回复」的前置**。回复前用的是 `purpose="reply"` 的短静默（`src/bridge.js:12571-12572`）。这两句话在提示词里是分开写的，混用会导致「回复前白等 5 分钟」。
7. **`deny.private` 只拦私聊**，群里照常回应；要「彻底拉黑」必须放 `deny.users`（`src/bridge.js:2900-2909`）。
8. **`socialV2.voice.allowAbsolutePath` 已经不再放宽 AI 通道**，看到这个字段以为能读任意文件是错的（`src/bridge.js:2916-2920`）。
9. **`manage 用的 consoleToken 与 agent token 是两套权限**。MCP 进程两者都持有，所以「这次调用是谁发的」必须由请求自己声明（`x-agent-call`），否则漏传 token 会升级成管理端全权（`src/bridge.js:3892-3910`）。
10. **`snowluma.accessToken`（HTTP）与 `bot.accessToken`（WS）是两个不同的值**。config 只能存一个（HTTP 那个），所以**首次 WS 连接几乎必然会 1006**，靠 `healTokenIfStale` 自愈——这不是故障（`src/bridge.js:14753-14757`、`src/bridge.js:14859-14869`）。

### 10.5 已知的结构性坑（代码里已修但容易复发）

| 坑 | 复发方式 | 防复发机制 | 位置 |
|---|---|---|---|
| collector 只在 `turn/start` 建 | 顺手在别的事件里建 → 会话永久繁忙 | `trackTurnEvent` 单点 | `src/bridge.js:14119-14146` |
| 断线重连丢回复 | 快照不经过 `session/event` → 回放已结束回合成新回合 | 只回放未结束回合 | `src/bridge.js:3080-3120`、`src/bridge.js:14162-14165` |
| 全体会话集体退役 | preset 清单瞬时为空 → 策略签名变化 | `dshPresetIds.length===0` 直接 return | `src/bridge.js:3389-3400` |
| URL 被拆断 | 超长 token 硬切破坏占位符 | 占位符不可切 | `src/bridge.js:8298-8340` |
| 半个 emoji | 在代理对中间切 | 退一格 | `src/bridge.js:8328-8336` |
| 令牌漏到 QQ | 集合无界增长被淘汰 / 出站未脱敏 | 按会话记账 + 出站兜底 | `src/bridge.js:586-635`、`src/bridge.js:8478-8482` |
| 双实例互相覆盖状态 | 第二个实例加载后立刻回写 | 文件指纹比对 | `src/bridge.js:9606-9621` |
| 日志每写一行读整个文件 | 回退成「读回全文数行数」 | 内存计数器 + rename 轮转 | `src/bridge.js:1400-1435` |
| 状态无限膨胀 | `wakeConfig.triggers` 收任意键 | `WAKE_TRIGGER_KEYS` 白名单 | `src/bridge.js:9269-9283` |
| 原型污染 | `memberImpressions['__proto__']` | 三处黑名单 + `hasOwnProperty` | `src/bridge.js:9543`、`src/bridge.js:7672-7679`、`src/bridge.js:12315` |

---

## 11. 本次阅读未覆盖 / 不确定

⚠️ 以下内容本文只记录「桥接这一侧看到什么」，**机制本身没有在本次阅读中验证**：

1. ⚠️ **`src/md-to-plain.js` 的 `splitForQQ` / `mdToPlain` / `truncateText` 内部规则**未读。本文只说明调用点与用途（`src/bridge.js:20`、`src/bridge.js:8245`、`src/bridge.js:14359`）。
2. ⚠️ **`SENSITIVE_RE` 的实际正则**（`src/sensitive.js`）未读。本文只说「命中即拦」，没说命中什么。
3. ⚠️ **`src/history-catchup.js` 的 `selectMissedHistory` / `historyWatermark` / `summarizeHistoryCatchup`** 内部算法未读（`src/bridge.js:25-27`）。
4. ⚠️ **`src/dsh-client.js` 的鉴权链**（launch token、离线铸造浏览器 Cookie、`mintBrowserSessionCookie`、`createTurnCollector` 的合并/去重语义）未读。本文只用了「prompt 被拒返回 `{ok:false, error}`」「collector.push 返回 `ended`」这两个契约（`src/bridge.js:19`、`src/bridge.js:14135`）。
5. ⚠️ **`src/purpose-engine.js` 的全部纯函数**（`evaluatePurposeTick`/`deriveDrives`/`formGoalHypotheses`/`selectPurpose`/`planNextFire`）未读，只按桥接侧的入参/出参描述。
6. ⚠️ **`src/conversation-closure.js` 的评分模型**（`assessConversationClosure`/`closeGate`）未读，只说明「`gate.blocked` → 409」。
7. ⚠️ **`src/fish-guard.js` 的 `assessFishDensity` 判据**未读，只说明「返回 `blocked`/`reason`/`fishRatio`/`consecutiveFish`」。
8. ⚠️ **`src/sticker-semantics.js` 的相似度打分与情绪词表**未读，只说明 `rankStickers` 的 `topK`/`minScore` 参数与 0.34 左右的阈值提示（`src/bridge.js:12580-12583`）。
9. ⚠️ **`src/voice-tts.js` / `send-voice-lib.js` / `voice-packs.js` 的实现**未读。特别是 `voice-packs` 的 install 会**下载外部内容并可能启动本地进程**，本次没有核对它的来源校验与失败回滚。
10. ⚠️ **`src/state-acl.mjs` 的 `hardenDir` 与 `manualDirCommand` 的具体命令**未读。本文只说明「Windows 上必须 icacls 断继承；旧实现会清空子文件 DACL」这条历史结论（`src/bridge.js:291-310`）。
11. ⚠️ **`@snowluma/sdk` 的 `SnowLumaWebSocketClient` 重连策略**未读。所以「`bot.connect()` 失败后多久重试一次」「`reconnect:true` 的退避曲线」本文没有结论（`src/bridge.js:14651-14655`）。
12. ⚠️ **`api.events.mux` 的帧类型全集**未读。本文只列了桥接实际处理的 7 种：`session/snapshot`、`session/event`、`question/requested`、`approval/requested`、`stream/error`（`src/bridge.js:14162-14609`）。其它帧类型会被静默忽略。
13. ⚠️ **DSH `settings.describe` 的 `namespaces` 结构**只在代码使用处推断（`qq-mode` / `agent-presets` 两个命名空间），没有对照 DSH 侧 schema（`src/bridge.js:3184-3223`）。
14. ⚠️ **`api.callUnary` 覆写**的用途在注释里说「不依赖旧版客户端域方法」，但覆写实现未读（`src/bridge.js:2959`）。
15. ⚠️ **`public/console.html` 的页面行为**未读。所以 §6 的「副作用」列是从 handler 推出来的，不是从 UI 交互推的。
16. ⚠️ **`role-card.js` 的 `selectRoleText` 模式标记语法**（〔一代〕/〔二代〕）未读，只按 `GEN1_ROLE_LINE_RE` 与 `roleSectionReport` 的用法描述（`src/bridge.js:16`、`src/bridge.js:11596-11611`）。
17. ⚠️ **一处疑点**：`src/bridge.js:4337` 有一个不可达的重复 `return;`（前一行已 `return`）。无功能影响，但说明该分支经过多次手工编辑。
18. ⚠️ **一处疑似冗余**：`cfg.socialV2.sticker` 在 `src/bridge.js:1085-1106` 里 `collect` 被展开写了两次，第二次覆盖第一次。结果等价，因为两处默认值相同；但如果将来只改第一处，会出现「改了不生效」的陷阱。
19. ⚠️ **未验证**：`/api/socialV2/wait` 最长挂 10 分钟（`timeoutMs` 上限来自 `wait.maxMs` 默认 600000），单个会话同时只允许一个等待（`activeWaits` 租约 15 分钟）。并发多个会话时的 HTTP handler 占用没有实测数据。
20. ⚠️ **未验证**：`MAX_KNOWN_AGENT_TOKENS=512` 的淘汰逻辑在「会话数 × 2 > 512」（即 256 个活跃会话）时会开始淘汰旧代 token。超过这个规模的实际行为没有测试覆盖。
