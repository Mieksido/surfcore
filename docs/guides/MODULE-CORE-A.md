# 核心纯逻辑模块 A 卷：记忆 · 人格 · 目的 · 收尾 · 计费 · 身份

本文覆盖 11 个 `src/` 模块，共 7,815 行。它们构成 SurfCore 的「人格与账本」底座：
几乎都是**纯逻辑 + 小文件 I/O**，副作用（发 QQ、叫醒模型、写平台状态）留在
`src/bridge.js` 与 `plugins/surfcore/lib/*`。目标不是复述代码，而是让改动前知道三件事：
**哪些数值是阈值**、**谁在依赖这个行为**、**坏了会怎么坏**。

> 阅读约定：行号写成 `文件:行号`，指向该结论的实现处；`<DSH_HOME>` 指 DSH 用户数据目录（用户主目录下的 `.dsh`，可用环境变量覆盖）；
> 仓库内路径一律相对；账号例子用 `<主人QQ>` / `<群号>` / `<mid>` 占位；「N 行」按当前版本实际行数记，改动后同步更新标题。
> **最后核对**：2026-10-26（全仓库逐行梳理）。配套阅读：总纲 [ARCHITECTURE.md](ARCHITECTURE.md) · 边界 [BOUNDARIES.md](BOUNDARIES.md) · 索引 [../README.md](../README.md)。

## 模块总表

| 模块 | 行数 | 职责 | I/O |
| --- | --- | --- | --- |
| `src/memory-card.js` | 2070 | 衰减记忆卡 + 全量存档 JSONL | 读写 JSON/JSONL/MD |
| `src/character-persona.js` | 657 | 角色目录包、当前指针、快照/迁移 | 读写目录树 |
| `src/purpose-engine.js` | 2284 | 主动搭话：排程/素材/候选/提示词/状态迁移 | 零 |
| `src/conversation-closure.js` | 523 | 六类信号 → continue/linger/close | 零 |
| `src/token-budget.js` | 464 | 每日额度、用量快照、80% 提醒 | 4 个 JSON |
| `src/token-ledger.js` | 997 | 会话×回合 token 账本与计价 | JSONL |
| `src/model-prices.js` | 290 | 价目表 + 峰谷分时 + 桶归一 | 零 |
| `src/admin-identity.js` | 236 | 管理员 QQ⇄B站 同一人 + 温柔提示词 | 零 |
| `src/self-identity.js` | 188 | 跨平台自我识别 + 来源判断 | 读 1 个 JSON |
| `src/identity-guard.js` | 66 | 出站账号标识硬闸 | 零 |
| `src/share-mode.js` | 40 | 分享形态收敛与分享文本 | 零 |

**数据流**：

```
character-persona ─activeMemoryPaths()→ memory-card ─prompts→ bridge / scheduler 注入
        │                                  └records→ purpose-engine.collectMaterials
        └activePersonaFile()→ bridge / 桌宠                 │
admin-identity ─adminPromptBlock→ 提示词        selectPurpose ─→ bridge 投递 ─→ applyPurposeOutcome
self-identity ─buildSelfIdentityBlock→ 提示词                     │
identity-guard ─findIdentityLeaks→ B站 出站工具                   ▼
model-prices ◄─ token-ledger（计价）/ token-budget（比例）◄─ DSH session 事件
```

**版本号**：`MEMORY_CARD_VERSION=1`（`src/memory-card.js:33`）、`FULL_MEMORY_CARD_VERSION=2`（`:660`，v1 单品 JSON → v2 JSONL，旧文件改名 `.legacy-<ts>`）、`CHARACTER_VERSION=1`（`src/character-persona.js:24`）、`PURPOSE_STATE_VERSION=1`（`src/purpose-engine.js:21`）、`BUDGET_VERSION=1`（`src/token-budget.js:25`）、`PRICE_TABLE_VERSION='2026-11-04'`（`src/model-prices.js:21`，改价目表必须改它）。
除全量卡外都**没有逐版本迁移**，读盘时按结构逐字段容错、坏值回默认。

---
## 记忆卡引擎（src/memory-card.js，2070 行）

**职责一句话**：维护角色自己的长期记忆：QQ/桌宠/B站 原料评分入库 → 按人类遗忘曲线每天降一档清晰度 →
容量告警时压缩 → 渲染成「人看的 md」与「QQ/B站 两份带字数上限的提示词块」；
另有一条只追加、永不衰减的全量存档通道（JSONL）。

#### 对外接口
**常量/配置**：`CLARITY_ORDER=['vivid','clear','fuzzy','trace','forgotten']`（`:40`，只允许按序逐格变）；
`MEMORY_CAPACITY_THRESHOLDS=[0.8,0.9,1.0]`（`:37`）；`DEFAULT_MEMORY_CARD_CONFIG`（`:49`）：
`injectMaxChars.qq=2200/bili=2000`、`recentDays=7`、`fuzzyAfterDays=7`、`forgetAfterDays=60`、
`dailyHour=4`、`minOwnerImportance=65`、`maxRecords=600`、`warnChars=60000`、`fullMaxBytes=10GB`、
`fullMarkdownMaxBytes=5MB`；`INITIAL_WINDOW_DAYS=30`（`:403`）。
`normalizeMemoryCardConfig(input)`（`:136`）：坏值回默认；字数 `0=不限`、正数最小 2000（`:124`）；
`injectMaxChars` 夹 400–8000（`:152`）、`maxRecords` 夹 100–2000（`:163`）、
`fullMaxBytes` 只接受 0 或 10MB–100GB（`:141`）。

**路径**：`resolveMemoryCardPaths(memoryDir)`（`:170`）只拼路径不建目录，返回
`json/markdown/promptQq/promptBili/inbox/fullJsonl/fullStats/fullMarkdown/fullJson`。

**脱敏/评分**：`redactForMemory(text,{scope='qq',maxChars=600})`（`:228`）依次隐藏
键值密钥（`:233`）、中文密钥（`:234`）、`sk-/ghp-/xoxb-` 形状（`:236`）、32+ 长串（`:237`）、
手机号（`:239`）、15–19 位证件/银行卡（`:240`）、URL（`:242`），并在 **`scope!=='qq'` 时把
5–12 位数字整体打码**（`:244`），最后裁到 100–4000（`:248`）。
`detectEmotionScore`（`:253`）= `min(24, 强×8 + 中×3 + 感叹号)`，词表 `:100`/`:101`。
`looksNoteworthyMessage(text,{names})`（`:263`）：长度 <6 直接 false（`:265`），否则情绪/第一次/
约定/冲突/「主人」/角色名任一命中即 true。`scoreMemory(input,config)`（`:1080`）见算法。
`initialProbabilityForOffset(day)`（`:405`）：`<10→0.9`、`<20→0.55`、`<30→0.3`、否则 `0.03`。

**卡读写**：`createEmptyCard`（`:272`）；`loadMemoryCard`（`:313`）坏文件返回 **null**（不覆盖）；
`normalizeCard`（`:322`）超过 2000 条先保 pinned 再留最近（`:342`）、水位数组各留 5000（`:334`）；
`refreshInitialState`（`:430`）；`designateFirstMeeting`（`:504`，失败返回 `{ok:false,error}` 不抛）；
`mergeMemories`（`:583`，≥2 条且禁止合并 `firstMet`，`:585`/`:588`）；`clearFirstMeeting`（`:645`）。

**入库**：`addMemoryRecord`（`:1230`）返回 `{added,record}`，重复只刷新 `lastSeenAt/recallCount`
（`:1235`），超限按「不重要→老」淘汰（`:1245`）；`touchMemories`（`:1259`，文本 <4 字返回 0，最多碰 5 条）；
`ingestInboxLines`（`:1278`）→ `{added,addedPet,touched}`；`ingestBiliEntries`（`:1478`，单次上限 300）；
`archiveDecayedToFull`（`:790`）只 append、先算 initial（`:793`）、追加成功才打 `fullArchivedAt`（`:819`）；
`addManualMemory`（`:2005`，默认重要度 60，scope 仅 qq/bili/shared）；
`appendMemoryInboxEvent`（`:2025`，>1MB 轮转 `.1`，失败返回 false）。

**衰减/渲染/状态**：`targetClarity`（`:1533`）、`applyDailyDecay`（`:1562`）、
`decayDaysBetween`（`:1607`，1–30）、`needsDailyDecay`（`:1615`）、
`compactMemoryCard`（`:1636`，默认 `targetRatio=0.85`，循环上限 5000）、
`renderMemoryCard`（`:1769`，`full=true` 出完整 md，`platform=qq|bili` 出注入块，缺省 `all`）、
`readPromptBlock`（`:1846`）、`memoryCardStatus`（`:1856`）、`saveMemoryCardOutputs`（`:1906`，原子写 4 文件）、
`maintainMemoryCard`（`:1940`）、`shouldNotifyOwner`（`:2060`，同档 12h）、`markOwnerNotified`（`:2066`）。

**全量卡**：`createEmptyFullStats`（`:669`）、`loadFullStats`（`:684`）、`ensureFullArchive`（`:745`）、
`readAllFullRecords`（`:833`，超 `maxBytes` 返回 **null**）、`renderFullMemoryCard`（`:853`，7 分区）、
`fullMemoryCardStatus`（`:902`，按字节算比例）、`tailFullRecords`（`:955`）、`scanFullRecords`（`:982`）、
`recallFullMemory`（`:1025`，空 query 退化为尾部 N 条且 `matchScore=0`）、`saveFullMemoryCard`（`:1043`）。

**数据结构**：`memory-card.json`（`createEmptyCard`，`:272`）：`version/createdAt/updatedAt/lastMaintenanceAt/
lastDecayDate` + `meta`（`inboxSeen[]`、`sourceSeen[]`、`firstOwnerRecordId`、`firstOwnerAt`、
`firstMetSource(空|auto|manual)`、`firstMetAt`、`firstMetRecordIds≤20`、`firstMetEventId`）+
`alerts`（`level 0-3`、`at`、`acknowledgedLevel/At`、`lastNotified{level:ts}`）+
`stats`（`ingested/fromBili/fromQq/decayed/compacted/forgotten/last*At`）+ `records[]`。

单条记录（`normalizeRecord`，`:353`）：`id/source/sourceId/platform(qq|bili|shared|pet)/
scope(同四值，缺省 qq)`、`kind/title≤80`、`text≤1200`、`detail≤600`、`tags≤12`、
`importance 1-100(缺省20)`、`importanceReasons`、`emotional 0-24`、`pinned/anchor/clarity/
createdAt/lastSeenAt/decaySteps/recallCount`、`speaker/groupId/private/manual/sensitive/
fullArchivedAt`、`botReply≤600/isSelf/conversationKey`、`initialTier(first10|mid10|late10|after|
first-meet)/initialProbability/isInitial/firstMet/mergedFrom`。

`SOURCE_PLATFORM`（`:84`）把 `pet-*`→pet、`bili-*`→bili、`manual/system`→shared；
但**缺失 `scope` 的旧记录回落到 `qq`**（`:364`），所以手写记录可能出现
「`platform=shared` 但 `scope=qq`」——B站 注入按 `scope` 判断，这类记录会被挡掉。

全量卡（`:662` 注释 + 实现）：`memory-card-full.jsonl` 唯一真相、只追加（`:790`）；
`memory-card-full-stats.json`（`:669`）字段 `records/chars/bytes/counts{owner,bili,qq,other}/
lastArchiveAt/lastMigratedAt`——注意 `counts` 里没有 `pet`，只有真出现 pet 记录时才被加出来（`:701`）；
`memory-card-full.md` ≤`fullMarkdownMaxBytes` 才生成；旧 `.json` 迁移后改名 `.legacy-<ts>`（`:771`）。

inbox 行（`appendMemoryInboxEvent`，`:2037`）：`at/platform(qq|pet)/kind/private/sender/
senderId/groupId/isOwner/isSelf/conversationKey/direct/quoteSelf/text≤500`；去重键
`hash(日期|senderId|text,20)`（`:1293`）**只按天去重**——同日重复不重入，隔天再刷会再进一条。

#### 算法/规则
**① 评分 `scoreMemory`**（`:1080`），起点 8（`:1090`）：主人私聊 +42（`:1092`）/主人在群 +32（`:1093`）/
直接对她说 +8（`:1096`）/情绪 +0…24（`:1100`）/第一次 +30（`:1104`）/约定 +16（`:1108`）/
矛盾道歉 +14（`:1112`）/关于自己 +5（`:1116`）/B站 打分 `clamp(0,18)`（`:1121`）/收藏 +8（`:1123`）/
日记 +4（`:1124`）/文本 <6 字 −12（`:1126`）；`manualImportance` **覆盖**全部加减（`:1130`）。
`kind` 顺序（`:1135`）：first→owner→emotion(≥14)→conflict→promise→event。
`pinned`：显式 true，或「isFirst 且（isOwner 或 ≥60）」（`:1142`）；`isFirst && isOwner` 直接 100 且 pinned
（`:1143`）；最终夹 1–100（`:1147`）；标签自动补 `owner/emotion(≥8)/first/bili/qq`（`:1150`）。

**② 初始清晰度**（`makeRecord`，`:1193`）：pinned→vivid；`importance≥65`→vivid；否则 clear。
正文入库前已脱敏（`:1171`）；`sensitive` 由话题黑名单补标（`:1202`，表在 `:109`）。

**③ 遗忘曲线 `targetClarity`**（`:1533`），顺序即规则：① pinned→vivid（`:1535`）；
② 算 `ageDays/sinceSeenDays`（`:1536`）；③ **彻底遗忘闸**：`ageDays>60 && importance<50 &&
非主人重要 && 非 isInitial` → forgotten（`:1540`，唯一会删记录的路径）；
④ `retention = importance + min(12, recallCount×2) + 18(7天内) + 8(2天内 seen)`（`:1543`–`:1546`）；
⑤ 扣 `min(80, max(0, ageDays−fuzzyAfterDays) × penaltyRate)`，penaltyRate = 0.12（主人重要/最初）
否则 0.35（`:1547`）；⑥ 地板 55（受保护）/50（7 天内）（`:1549`/`:1550`）；
⑦ 分档 `≥68 vivid / ≥46 clear / ≥24 fuzzy / ≥12 trace / 否则 forgotten`（`:1551`）。
`ownerImportant` = `tags` 含 owner 且 `importance≥65`（`:1528`）。

**④ 每日衰减**（`:1562`）：每天一次（`lastDecayDate===today` 直接 return，`:1565`），`steps` 夹 1–30
（`:1566`）；每条每轮**最多移动一格**（`:1576`）：目标更低→降一档，若下一档是 forgotten 则
**删记录并累加 `stats.forgotten`**（`:1578`）；目标更高（复习）→一天恢复一档（`:1586`）。

**⑤ 「最初」判定**（`:430` + `:405`）：只看 `tags` 含 owner 的记录（`:433`）；`firstOwnerAt` 取
「已存值」与「最早 owner 记录」较小者（`:438`）；手动指定存活时优先（`:441`），否则自动取最早（`:451`）。
初次相遇记录强制 `pinned/anchor/importance=100/tier='first-meet'/prob=1`（`:472`）；
其余按 `offsetDays=(createdAt−firstAt)/天`（`:486`）取 0.9/0.55/0.3/0.03，
`isInitial = sha1(id+':initial')前8位/2^32 < 概率`（`:421`、`:492`）——**确定性**，重读不变。
「最初」独立于重要度：`isInitial` 不会被彻底遗忘，最差保持「清楚」（`:1539`）。

**⑥ 容量与告警**：字数按 `renderMemoryCard(full=true).length`（`:1858`）；`maxChars>0` 按硬上限算比例，
`maxChars===0` 时比例/档位改看 `warnChars`（`:1860`–`:1865`），但 `ratio` 仍是硬上限语义，
**自动压缩只认 ratio**（`:1970`）；100% 且 `autoCompact` → 压到 90%（`:1970`）；
告警档位取压缩前后的较大者（`peakLevel`，`:1969`/`:1975`），所以「刚满过再压回」仍会提醒；
容量回落后 `level` 与 `acknowledgedLevel` 一起清零（`:1983`），下次再满重弹。

**⑦ 渲染/裁剪**（`:1769`）：分区优先级（`:1781`）初次相遇 120、锚点 100、最初 45、主人 40、
桌宠 36、最近 30、B站 22、QQ 20、模糊 10。注入条数上限（`:1778`）：B站 `{anchors:4,recent:6,
bili:8,fuzzy:3}` 其余 0（**B站 看不到**初次相遇/最初/主人/QQ/桌宠）；QQ `{firstMet:1,anchors:5,
initial:6,owner:8,recent:8,bili:4,qq:8,pet:4,fuzzy:4}`。可见性（`:1695`）：`sensitive` 只在
`platform='all'` 出现（`:1698`）；B站 只放 bili/shared，`includeQqInBili` 开时才放 qq（`:1701`）。
超字数从**优先级最低且 <100** 的分区尾部逐条弹（`:1833`），仍超则硬截断（`:1840`）。
空卡：完整 md 给占位、提示词块返回**空串**（`:1817`）。`fuzzy` 改写「（细节记不清了）」（`:1680`）、
`trace` 改写「好像有「…」…（想不起来了）」（`:1682`）。B站 块里渲染 qq 记录时按 **bili 口径**脱敏（`:1676`）。

**⑧ 维护顺序 `maintainMemoryCard`**（`:1940`）是契约：load（坏卡→新建，`:1952`）→ B站 摄取（`:1954`）→
inbox 摄取（`:1956`）→ **先归档再衰减**（`:1960`，注释 `:1958`）→ 每日衰减（`steps=forceDecay?1:
decayDaysBetween`，`:1964`）→ 状态 → ≥100% 压缩（`:1970`）→ 写告警（`:1977`）→ 写 4 文件（`:1991`）→
写全量 md（`:1992`）。先归档的原因：刚进来的旧记忆可能同一次补跑就被忘掉，没归档即永久丢失。

**谁在调用它**：桥接（`src/bridge.js:67`）只 import 三个函数；`MEMORY_CARD_PATHS` 在**进程启动时解析一次**（`:143`，
注释 `:138`「切换角色 = 停桥接→换指针→启桥接」）；写 inbox 在 `:13415`/`:13438`，群友消息先过
`looksNoteworthyMessage`（`:13412`），读 QQ 注入块直接读文件（`:11583`–`:11586`）。
插件宿主是**唯一写卡者**：`plugins/surfcore/lib/memory-card.js:21`–`:26` 导入 21 个符号，
每 10 分钟维护（`TICK_MS` `:29`、定时器 `:500`、调 `maintainMemoryCard` `:299`），
控制台操作落在 `:377`（designate）/:382（clear）/:387（merge）/:223（recall）/:456、:466（告警）。
B站/桌宠只读注入块：`plugins/surfcore/lib/pet-chat.js:24`、`plugins/surfcore/lib/scheduler.js:35`。
测试：`scripts/test-memory-card.mjs:10`–`:14`（幂等 `:250`/`:257`、归档 `:307`、召回 `:339`、
`shouldNotifyOwner` `:202`）、`scripts/test-memory-card-wiring.mjs`。
**无生产调用方的导出**：`readPromptBlock`（`:1846`）——桥接自己读文件、插件用 `renderMemoryCard`。

#### 边界与失败模式
- **坏 JSON**：`loadMemoryCard` 返回 null（`:317`），维护流程随即**新建空卡并整份覆盖**（`:1952`），
  原文件不会自动备份；手工修卡前先复制。
- **坏记录**：`normalizeRecord` 对 `text`/`title` 双空返回 null（`:357`）直接丢弃，其余字段全容错。
- **并发**：模块内**无锁**，设计上「只有插件写、桥接只 append」（`:2024`）；接进第二个写进程即读-改-写覆盖。
- **两个条数上限**：读盘容 2000（`:342`），日常维护 600（`:74`）——不是同一个数。
- **全量卡体积**：`fullMaxBytes` 只是**告警阈值**，不阻止写入（`:929` 只算比例）；md >5MB 变占位（`:1047`）；
  `readAllFullRecords` 超限返回 null（`:836`），调用方必须处理（`saveFullMemoryCard` 用 `?? []`，`:1055`）。
- **时区**：`todayKey/dateOnly/decayDaysBetween` 全用本机本地时间（`:189`/`:212`/`:1609`），
  跨时区迁移会得到 ±1 天补跑步数；上限 30 天。
- **时钟回拨**：`ageDays/sinceSeenDays` 都有 `max(0,…)`（`:1536`），只表现为「不衰减」。
- **敏感内容**：`sensitive` 只在 `platform='all'` 可见（`:1698`），但**仍占容量**并按正常曲线衰减——
  完整卡字数可能包含注入看不到的条目，这是刻意的。
- **隐私开关**：`includeQqInBili` 默认 false（`:72`），打开后 QQ 记忆进 B站 提示词；渲染会按 bili 口径
  脱敏（`:1676`），但素材本身仍是 QQ 内容，属用户显式选择的风险。
- **告警状态**：`alerts.level` 由维护流程写（`:1977`）；手工清零不重置 `lastNotified`，12h 节流仍有效。

---
## 角色人格目录包（src/character-persona.js，657 行）

**职责一句话**：把「一个角色」落成 `characters/<id>/` 目录包，维护 `current.json`（当前角色 + epoch）与
`index.json`（列表），并提供 `activeMemoryPaths()` 这类路径解析与快照/回档/迁移能力。

#### 对外接口
**常量/路径**：`HOME/DSH_HOME/SURFCORE_DIR/CHARACTERS_DIR/CURRENT_FILE/INDEX_FILE`（`:25`–`:30`）、
旧布局 `LEGACY_MEMORY_DIR/LEGACY_BILI_DIR`（`:31`–`:32`）。`BILI_BEHAVIOR_FILES`（`:34`）是允许
进快照/迁移的 B站 行为白名单（约 40 个文件名；凭证/表情包/二进制工具**刻意不在**，注释 `:634`）。
`MEMORY_FILES`（`:49`）、`MEMORY_APPEND_FILES=['memory-card-full.jsonl']`（`:54`，单独走硬链接）。
`sanitizeCharacterId`（`:104`，非 `[a-z0-9_-]` 换 `-`，空则 `char-<base36 时间>` `:108`）、
`isValidCharacterId`（`:111`，`/^[a-z0-9][a-z0-9_-]{0,39}$/`）、`characterDir`（`:115`，非法 **抛错**）、
`characterPaths`（`:120`，返回 `dir/manifest/persona/memoryDir/memory*/biliDir/snapshotsDir`）。

**路径解析**：`legacyMemoryPaths`（`:143`）、`activeMemoryPaths`（`:161`，有角色用角色 `memory/`，否则旧布局）、
`activeBiliDir`（`:181`）、`activePlatformStateDir`（`:187`）、`activePersonaFile`（`:192`）。
`readCurrentCharacter`（`:197`）带缓存（键 = `mtime:size`，`:201`），文件缺失/坏 JSON/id 非法/目录不存在
→ **null**（`:203`/`:208`）。`isCurrentEpoch`（`:224`）、`bumpEpoch`（`:230`，只对当前角色生效 `:232`）。

**目录/清单**：`readIndex`（`:248`，索引不可用时按目录重建但**不写盘** `:251`）、
`listCharacters`（`:278`，含 `current/fullMemoryBytes/personaChars/snapshots`）、`readManifest`（`:300`）、
`characterPersonaMeta`（`:305`，清单没名字时从人格卡标题补）、`personaNameFromText`（`:330`）、
`createCharacter`（`:346`，名字必填否则抛 `:348`，id 冲突加 `-2/-3` `:335`）、
`updateCharacter`（`:382`，清单不存在抛 `:385`）、`touchCharacter`（`:403`）。

**切换/快照/回档/删除/迁移**：`switchCharacter`（`:413`，已是当前返回 `already:true` `:419`）；
`snapshotCharacter`（`:461`）；`listSnapshots`（`:502`，按 createdAt 倒序，manual 看 reason 前缀 `:518`）；
`removeSnapshot`（`:526`，路径必须在 `snapshots/` 下 `:529`）；`archiveCharacter`（`:536`，**拒绝当前角色**
`:538`，整目录 rename 到 `backups/deleted-character-<ISO>-<id>` `:540`）；
`restoreSnapshot`（`:558`，先拍 `pre-restore-<ISO>` `:564`）；`snapshotSize`（`:584`，单行写法，改时别把
函数体挤掉）；`migrateLegacy`（`:602`，幂等 `:604`、备份目录 `:612`、全量 JSONL 走 `linkOrCopy` `:631`、
`stateDir` 分享排期单独迁 `:645`、最后 `switchCharacter` `:655`）。

**数据结构**：`current.json`（`:423`）：`{version,id,name,epoch,dir,switchedAt}`，**唯一真相**，原子整文件替换。
`index.json`（`:264`）：`{version,currentId,epoch,characters[]}`，按 `name` 用 `zh-CN` 排序（`:272`）；
只是**派生展示数据**，丢/坏可再生（`:251`）。
`character.json`（`:364`）：`version/id/name/createdAt/updatedAt/source/persona/memory/bili/
personaMeta{name}` + 后续 `lastLoadedAt`；`personaMeta.name` 是 B站 提示词取名来源（`:374` 注释）。
`snapshots/<slot>/snapshot.json`（`:447`）：`{version,characterId,slot,reason,createdAt,fullMemoryMode}`，
`fullMemoryMode ∈ link-or-copy|failed|missing`（`:476`–`:489`）。
`persona.md` 人格卡原文；`memory/` 记忆全套；`bili/` 白名单行为账本。

#### 算法/规则
**快照写入**（`:461`）：slot 名清洗到 `\w`+中文+`.`+`-`、≤80（`:465`）→ 建 `dest.tmp-<pid>-<now>` →
写 `snapshot.json`、复制人格卡/清单/`MEMORY_FILES`、全量 JSONL 用 `linkOrCopy`（硬链接优先，失败复制 `:92`）→
B站 只复制白名单内的普通文件（`:482`）→ 回填 `fullMemoryMode`（`:489`）→ 目标存在时先 rename 到
`<dest>.old-…`、换入、再删旧（`:491`，Windows 不能 rename 覆盖非空目录，注释 `:490`）→ 换入失败删临时目录并抛
「快照写入失败」（`:494`）。

**回档的「不回退」清单**：只覆盖 `memory-card.json/md/prompt-qq/prompt-bili/inbox`（`:567`），
**不恢复** `memory-card-full.jsonl`、`full-stats`、`sync-state.json`——因为全量卡 append-only，
截断会把「回档后真实发生过的事」也删掉（`:556` 注释）。

**删除语义**：`archiveCharacter` 只 rename 不 rm（`:535`）；`removeSnapshot` 真删但限制路径前缀（`:529`）。
**迁移取舍**：先建备份目录（`:612`）把 ≤8MB 源文件复制留证（`:615`），大文件不复制（`:618`）——
源目录继续当冷备份（`:599`）。

**epoch 语义**：切角色 = epoch+1（`:422`），回档/导入后 `bumpEpoch` 让旧任务失效（`:229`）。
但生产路径**没有调用 `isCurrentEpoch`**（grep 仅 `scripts/audit-bridge-harness.mjs:265` 与
`scripts/test-character-store.mjs:41`）；桥接在启动时把 epoch 抓成常量（`src/bridge.js:141`），
靠重启而不是运行中比对。把它当「预留契约」而不是既成事实。

`sanitizeCharacterId` 的 `uniqueId`（`:335`）在目录**存在**时才加后缀，所以「删了索引但目录还在」
会得到 `-2` 角色——修指针前别重建。

**谁在调用它**：桥接（`src/bridge.js:70`）用 `activeMemoryPaths/activePersonaFile/activePlatformStateDir/characterPaths/
readCurrentCharacter`，启动时解析（`:140`/`:143`/`:144`），读人格卡 `:10608`/`:11527`。
插件：`plugins/surfcore/lib/index.js:35`（`touchCharacter` `:849`/`:867`）；
`plugins/surfcore/lib/characters.js:12`–`:15` 是完整服务层（自动存档 `:38`、手动 `:65`、切换前 `:74`、
回档+`bumpEpoch` `:169`–`:170`）；`memory.js:32`、`persona.js:15`、
`pet-chat.js:25`（按角色拼 `purposeStateFile` `:277`–`:285`）、`scheduler.js:38`。
B站 记忆：`src/bili-memory.js:17`（`characterPersonaMeta` `:179`）。
测试/夹具：`scripts/test-character-store.mjs:14`（`:41`/`:65`/`:103`/`:118`）、
`scripts/test-bili-state-paths.mjs:16`、`scripts/audit-bridge-harness.mjs:30`/`:247`/`:265`、
`scripts/purpose-inspect.mjs:17`。

#### 边界与失败模式
- **非法 id 抛错**（`:116`）：把用户输入直接当 id 会 500，上层必须先校验/清洗。
- **`current.json` 指向不存在的目录** → `readCurrentCharacter` null（`:208`），上层全部回退旧布局，
  看起来像「角色没了」，实际是目录被移走/回档失败。
- **索引与目录不一致**：只补「索引完全不可用」（`:250`），少一条不会补齐；`listCharacters` 会漏，
  但 `switchCharacter` 直读清单仍能切（`:415`）。删/改索引让它重建即可。
- **并发切换**：无锁，四步（读 index → 算 epoch → 写 current → 写 index）可能同 epoch 或 currentId 落后；
  设计上切换只由插件串行发起。
- **快照与硬链接**：全量 JSONL 是硬链接、与源共享 inode；后续若有人原地 truncate 源文件快照会一起变。
  当前所有写入都是 append 或原子替换，改成原地重写会破坏这个假设。
- **`archiveCharacter` 失败**：rename 失败抛「归档角色失败」（`:549`），目录与索引不变，可重试（幂等）。
- **迁移重复**：`current.json` 有值即 `skipped`（`:604`）；但**指针坏而目录在**时会再建一个角色，
  得到两个目录——修指针前别跑迁移。
- **环境变量**：`DSH_HOME/USERPROFILE` 在**模块加载时**求值（`:25`–`:26`），运行中改无效；
  测试须在 `import` 前设（`test-character-store.mjs:11`–`:14`）。

---
## 目的引擎（src/purpose-engine.js，2284 行）

**职责一句话**：把「定期主动找主人说话」拆成可单测纯逻辑：排程（什么时候可以）、素材（从哪来）、目的假设
（想做什么/是谁的目标/多可信/多危险）、候选选择（这次说哪件）、提示词（怎么说）、
回执与状态迁移（说完之后世界变成什么样）。

#### 对外接口
**配置/状态/时钟**：`DEFAULT_PURPOSE_CONFIG`（`:24`）：`gapMinMs=150min`、`gapMaxMs=300min`、
`initialDelayMinMs=30min`、`dailyMax=4`、`quietStart='23:30'`、`quietEnd='08:30'`、
`idleThresholdMs=30min`、`materialWindowHours=72`、`biliWindowDays=7`、`maxMaterials=36`、
`minMaterials=2`、`retryMs=15min`、`maxAttempts=3`、`historyLimit=60`、`pendingTtlDays=14`、
`maxCandidates=6`、`promptMaxChars=16000`。
`parseClock`（`:83`，非法回退 fallback 再回 `08:00` `:92`）、`inQuietHours`（`:102`，
`quietStart===quietEnd` 视为**不启用** `:105`，跨零点 `m>=s||m<e` `:109`）、
`quietEndAfter`（`:113`）、`nextDayStartAfter`（`:122`，无安静时段取次日 `00:05` `:127`）、
`localDateKey`（`:73`）、`normalizePurposeConfig`（`:132`，全部夹紧、`ownerUin` 只留数字 ≤12 位 `:134`、
只有显式 `false` 才关 `:139`）、`createPurposeState`（`:162`）、`normalizePurposeState`（`:232`）。

**排程**：`ensurePurposeDay`（`:263`，跨天清 `countToday` 不动 `nextFireAt`）、
`ensurePurposeSchedule`（`:273`）、`planNextFire`（`:288`）、`evaluatePurposeTick`（`:321`，
返回 `{action:'wait'|'run',reason,nextFireAt}`）、`markPurposeDelivered`（`:348`，投递即占次数 `:347`）、
`markPurposeSkip`（`:358`）、`applyPurposeOutcome`（`:368`）、`prunePurposeState`（`:464`）。

**素材**：`collectMaterials`（`:497`）→ `{items, stats:{qq,bili,memory,thought,total,included,windowStart}}`。
**需求/驱动**：`PURPOSE_NEEDS`（`:774`，play/learn/install/connect/care/share/identity/create/consume）、
`NEED_LABELS`（`:778`）、`ACTION_LABELS`（`:783`）、`EMOTION_LABELS`（`:787`）、
`DEFAULT_DRIVES`（`:793`，play .20 / learn .12 / install .10 / connect .28 / care .22 / share .20 /
identity .14 / create .05 / consume .05）、`normalizeDrives`（`:832`）、`needAffinity`（`:843`）、
`analyzePersona`（`:866`）、`extractTopic`（`:898`）、`deriveDrives`（`:941`）、
`appraiseMaterial`（`:989`）、`satisfyDrives`（`:1007`）。
**相似/去重**：`textSimilarity`（`:743`，中文双字+英文词袋 Jaccard）、`isDuplicateText`（`:752`，默认 0.55）。
**目标假设**：`GOAL_OWNERS`（`:1026`）、`GOAL_OWNER_LABELS`（`:1027`）、`GOAL_STATUSES`
（`:1028`，hypothesis/active/confirmed/rejected/done/expired）、`updateObservations`（`:1087`）、
`normalizeGoals`（`:1170`）、`applyGoalFeedback`（`:1438`）、`pruneGoals`（`:1472`）、
`formGoalHypotheses`（`:1528`）→ `{goals,observations}`、`goalToCandidate`（`:1590`）。
**候选/提示词**：`minePurposeSeeds`（`:1677`）、`selectPurpose`（`:1803`）→
`{purpose,candidates,fromPending}`、`formatMaterialLine`（`:1978`）、`buildPurposePrompt`（`:2001`）。
**回执/摘要**：`parsePurposeMemo`（`:2148`，解析不到返回 null `:2171`）、`addPendingPurpose`（`:2183`）、
`resolvePendingPurpose`（`:2221`，相似度 ≥0.5 才算推进过 `:2231`）、`summarizePurposeState`（`:2239`，
**不含提示词全文** `:2238`）。

**数据结构**：`purpose-outreach.json`（本模块只处理内存对象，`createPurposeState` `:162`）：
`version/day/countToday`、`lastRunAt/lastAttemptAt/lastSentAt`、`lastOutcome`
（sent/silent/failed/delivery-failed/pending）、`lastPurpose/lastText/nextFireAt/attempts`、
`drives`+`drivesAt`（跨天保留、随时间衰减 `:175`）、`goals[]`、`observations[]`、`pending[]`、
`history[]`、`lastSkip{at,reason}`。

`goal`（`normalizeGoal`，`:1132`）：`id/owner/domain/object{type,name}/intent/evidence[]{id,text,
source,at}/confidence/value/urgency/risk/action/nextStep/status/emotion/createdAt/lastSeenAt/
expiresAt/attempts/lastActionAt/lastFeedbackAt/sightings/source`；四个 0–1 值缺省 0.3/0.4/0.2/0.1（`:1151`）。
`object.type` 由领域决定（`:1070`）：play→game、install→plugin、identity→relationship、care→plan、其余 topic。
`observation`（`:1087`）：`{key,domain,object,count,firstAt,lastAt,subjects[],positive,negative,seenIds[]}`，
key = `domain|object.name.toLowerCase()`（`:1083`）。
`pending`（`:214`）：`{id,kind,need,action,emotion,text≤120,source,createdAt,expiresAt,hits}`；
相似度 ≥0.7 视为同一条只 `hits+1`（`:2195`），总数裁到 12（`:2217`），TTL 由 `pendingTtlDays`（`:2204`）。
`history`（`:193`）落盘 ≤200、按 `historyLimit` 裁（`:471`）。

#### 算法/规则
**① 排程 `planNextFire`**（`:288`）：`min=max(5min,gapMin)`、`max=max(min,gapMax)`（`:295`）→
`gap=min+rand×(max−min)`（`:297`）→ 若次数用尽 `nextDayStartAfter`（`:299`）→ 否则
`at=lastRunAt+gap`，**早于 `now+2min` 就抬到 now+2min**（`:304`，停机后只补一枪）→ 无 lastRunAt 时
`now+max(1min,min(initialDelay,min))`（`:306`）→ 落在安静时段则 `quietEndAfter+rand×20min`（`:308`）。

**② tick 判定顺序 `evaluatePurposeTick`**（`:321`）：enabled（`:323`，wait 且 `nextFireAt=0`）→
`modeOk` +5min（`:324`）→ `dshReady` +5min（`:325`）→ `paused` +10min（`:326`）→
`ownerAllowed` +1h（`:327`）→ 安静时段（`:328`）→ 次数用尽（`:332`）→ `now<nextFireAt`（`:335`）→
`busy` +5min（`:336`）→ `ownerIdleMs<idleThreshold` 等 `min(30min,剩余)`（`:338`）→
`friendOk` +6h（`:342`）→ `budgetBlocked` +30min（`:343`）→ run（`:344`）。
第 10 条语义：`ownerIdleMs` 是「主人已安静多久」，**小于**阈值说明主人正活跃所以要等；
`undefined` 不命中（`:338` 的 `Number.isFinite`）。

**③ 状态迁移 `applyPurposeOutcome`**（`:368`）：先 `ensurePurposeDay`，固定写 `lastRunAt/lastOutcome/
lastPurpose/lastText`（`:377`–`:381`）；目标记账 `sent`→hypothesis 升 active、置信 +0.03（上限 .95），
`silent`→−0.03（下限 .05），`attempts` 上限 20（`:391`–`:399`）；驱动交给 `satisfyDrives`（`:402`）；
`sent` 时 `attempts=0`，备忘「待续」写 pending（`:408`）、「完成」→`resolvePendingPurpose`（`:418`）、
`planned.fromPending` 未说状态则默认推进过一轮（`:420`）；写 history（`:439`）；
**重试**：outcome 既非 sent 也非 silent（即 failed/delivery-failed）且 `attempts<maxAttempts` →
`nextFireAt=now+retryMs`，否则 `planNextFire`（`:455`）；最后 `prunePurposeState`（`:460`）。

**④ 素材五源 `collectMaterials`**（`:497`）：① 主人私聊最近 30 条按 72h 过滤（`:520`–`:540`）；
② 群聊取最近活跃 **3 群**（`:553`）、每群最近 16 条里按分数挑 **5 条**（`:573`，打分：含角色名 +3、
疑问 +2、长度 ≥12 +1、`@` +1，`:566`–`:569`），她的「回头/下次」承诺另收最多 2 条（`:562`/`:586`）；
③ B站 7 天内 video/dynamic/thought，权重 = 收藏×2 + 分数≥12 + 优先级/10（`:627`）取前 10；
④ 记忆卡：`pinned/anchor/isInitial/firstMet` **不受 30 天限制**（`:647`），其余要 `importance≥35`
或 `emotional≥6`（`:651`），权重 `importance/100+emotional/20+0.5(salient)`（`:662`）取前 8；
⑤ 她自己的惦记：`activeTopics` 权重 1.4、未过期 `pendingThoughts` 权重 1.5（`:672`–`:707`）。
统一排序 `rank={owner:0,self:1,thought:2,video:3,dynamic:4,memory:5,member:6}`、同 rank 按时间倒序（`:709`），
截到 `max(6,maxMaterials)`（`:716`）；`stats.total` 是截断前、`included` 是截断后（`:717`）。

**⑤ 驱动 `deriveDrives`**（`:941`）：向默认值衰减 `decay=0.5^(h/8)`（8h 半衰期，`:951`）；
人格先验只抬**地板** `max(cur, default+min(0.3,bias))`（`:961`，防几十轮后全顶到 1）；
`connect += min(0.5, hoursSinceMaster/24×0.4)` 上限 .95（`:967`，`lastMasterAt=0` 按 24h `:965`）；
最近前 24 条素材各抬 `affinity×0.045`（`:969`–`:974`）。

**⑥ 需求亲和 `needAffinity`**（`:843`）：命中数 /2.5 封顶 1（`:850`）；无命中给 `share=0.3`（`:854`）；
交叉增强 `install+identity`→identity+0.2（`:857`）、`play+connect`→play+0.15（`:858`）；词表 `:798`。

**⑦ 人格先验 `analyzePersona`**（`:866`）：`bias=min(0.28, 命中×0.07)`（`:874`），traits 按命中降序，
目标层只取前 3（`:1569`）；词表 `:813`。

**⑧ 事件→目标假设 `hypothesesForEvent`**（`:1228`）：`persistenceScore=min(1,(persistence−1)/3)`（`:1232`）；
`baseConfidence=0.15+0.22×selfRel+0.2×persistence+stanceBonus+0.1×credibility+0.08×drive`，下限 .15（`:1234`），
stanceBonus want .1/praise .08/question .03（`:1233`）；`value=0.3+0.35×drive+0.2×selfRel+0.15×persistence`
下限 .4（`:1238`）；`urgency=0.15+0.35(主人)+0.2(未解决)+0.1(want)` 下限 .2（`:1239`）。
`selfRelevance`（`:1060`）：self 1 / selfRef .8 / 被点名 .6 / owner .35 / 其余 .2；
`credibility`（`:1068`）：owner .9 / self .8 / bili .55 / 其余 .45。
主体分支（`:1252` 起）：**owner** 群聊发言**直接不生成**（`:1263`，属群聊回合）、寒暄/过短不生成（`:1264`）、
非生活话题只生成低置信度「想接着聊」（`:1265`）、生活/计划→置信 0.78 TTL 10 天（`:1279`）、
主人说想玩→额外「想一起」低置信目标（`:1287`）；**self** 过去普通聊天不生成、只有承诺才追问（`:1300`）、
记忆→0.5「突然想起」（`:1313`）、其余按 `actionForNeed/intentForNeed`（`:1321`）；
**member** 只有被点名/自我相关/落 play learn install identity 才生成（`:1331`），归属记 `member`（`:1335`），
`persistence≥3` 且（自我相关或玩学）才升级 `self`（`:1344`）；**media** install 仅「重复或明确夸好用」归 self（`:1357`）、
identity/关系→self confide（`:1366`）、`persistence≥2` 或自我相关→self（`:1376`）、否则归 media（`:1385`）。
风险表 `riskFor`（`:1174`）：install .55(ask)/.82；consume .6/.85；identity/care/connect .05；
play .1；learn .15；create/share .1；其余 .2。

**⑨ 合并 `mergeGoal`**（`:1398`）：键 `owner|domain|object.name.toLowerCase()`；存在时延长
`lastSeenAt/expiresAt`，**`fresh=false` 直接返回**（`:1406`，防同一批旧素材每轮抬置信度，注释 `:1404`）；
`fresh=true` 时 `sightings+1`、证据去重留 4、`value/urgency/risk` 取 max、置信 `min(.95,max(旧,新)+.02)`（`:1420`）；
`rejected` 目标除非新证据高出 .2 否则不复活（`:1417`）。

**⑩ 反馈 `applyGoalFeedback`**（`:1438`）：只处理有 attempts 且 lastActionAt 的目标（`:1443`）；
取 `max(lastActionAt,lastFeedbackAt)` 之后 24h 内主人发言（`:1446`）；**先判否定再判肯定**（`:1431`）；
否定→rejected、置信 −.25、价值 −.1；肯定→confirmed、+ .15/+ .05；中性 +.02；
没回复且 `attempts≥2` 且 >24h → −.08，低于 .15 置 expired（`:1462`）。

**⑪ 裁剪 `pruneGoals`**（`:1472`）：过滤 expired；过期但「问过且 14 天内」保留（`:1475`）；
按 `confidence×value` 降序；**每领域最多 5**、总数 30（`:1479`–`:1486`）。

**⑫ 种子 `minePurposeSeeds`**（`:1677`）只产出「明确说出口/明确欠着」：主人问过且她 45 分钟没在
**私聊**答→curiosity 1.25（`:1720`，答过只认私聊 `:1690`）；主人计划→care 1.35（`:1725`）；
她的承诺→follow-up 1.15（`:1730`）；视频想试→ask 1.2 / 收藏高分长评→share 1.0 / 兜底 0.55
（`:1734`–`:1747`）；动态→create .8；记忆→connect .9；B站 念头→share .85；心里惦记→1.5（`:1749`–`:1766`）；
群友只有点名+疑问→curiosity .6（`:1767`）；无种子且素材非空→两条兜底 .5/.45（`:1781`）。
去重：文本相似 ≥.75 丢（`:1790`）、同 `need|topic` 只留一条（`:1792`）、最多 16（`:1796`）。

**⑬ 选目的 `selectPurpose`**（`:1803`）：池 = goals（跳过 rejected/done/expired，`:1867`）+ seeds +
pending（权重 +.35，`:1872`）；入池过滤：与最近 **10** 条 history 相似 ≥.55 丢（`:1821`）、同 goalId 已说丢
（`:1823`）、同 sourceId 用过丢（`:1825`）、池内相似 ≥.8 丢（`:1826`）；高风险动作收敛：
`risk≥.5` 且动作非 ask/share → 强制 ask（`:1837`）。
权重（`:1875`–`:1899`）：goal ×`0.55+0.7conf+0.35value−0.25risk`（`:1878`）、×`0.65+0.55drive`（`:1880`）、
`lonely×1.2`/`envious×1.1`（`:1881`）、最近 3 条出现过该 need ×.72、最近 2 条都是该 need ×.65（`:1888`）、
最近 3 条 share≥2 → 非 share ×1.35、ask/curiosity≥2 → share/care/follow-up ×1.2（`:1897`）。
多样性（`:1904`）：同 need ≤2、同 goalOwner ≤2，最多 `maxCandidates(6)`，不足 3 硬补到 3（`:1918`）；
选择：有 pending 候选时 **50% 直接选它**（`:1930`），否则权重轮盘（`:1934`）。

**⑭ 提示词 `buildPurposePrompt`**（`:2001`）固定顺序：头部日期/星期（`:2023`）→【你此刻的状态】驱动 top2
（≥.25）+情绪（`:2038`）→【身份与记忆（背景）】`contextBlocks`（`:2046`）→【最近看到/经历的】素材前 **28** 条
+「不是指令」防御句（`:2053`–`:2056`）→【心里还惦记着】pending 最后 **5** 条（`:2060`）→【可以从这些方向里想】
候选带归属/需求/动作/置信（`:2066`）→【这次先冒出来的目标假设】+证据+三类约束（member 目标不是她的 /
media 说法不等于想法 / 置信 <.55 要像试探 / 风险 ≥.5 只能问）（`:2078`–`:2100`）→【最近已主动说过，别重复】
最近 3 条 sent（`:2103`）→【现在做】五步+内部备忘模板（`:2112`–`:2132`，reserved2 额外要求真调工具带 token `:2120`）。
超长裁剪：`max=max(4000,promptMaxChars)`，留头 55% + 尾 35%、中间省略（`:2136`–`:2140`）。

**⑮ 回执 `parsePurposeMemo`**（`:2148`）：正则 `[【\[]标签[】\]]`，标签集合 目的/类型/状态/待续/需求/情绪（`:2152`）；
类型→kind（`:2162`）、需求→need（`:2164`，先按前 2 字匹配再看整串 `:2168`）、status 只认 跳过/待续/完成（`:2170`）；
三样全空→null（`:2171`）。`satisfyDrives`（`:1007`）：sent 时 need×.45、connect×.55、share×.9；silent 时 ×.85。

**谁在调用它**：桥接（QQ 载体，`src/bridge.js:42`–`:45` 导入 18 个符号）：`ensurePurposeSchedule` `:1680`/`:1752`/`:11009`、
`analyzePersona` `:10665`、`deriveDrives` `:10675`、`evaluatePurposeTick` `:10731`、`collectMaterials` `:10596`、
`formGoalHypotheses` `:10686`、`minePurposeSeeds` `:10798`/`:10980`、`selectPurpose` `:10807`/`:10989`、
`buildPurposePrompt` `:10829`、`markPurposeDelivered` `:10874`、`applyPurposeOutcome` `:10896`/`:10916`/`:11039`、
`parsePurposeMemo` `:11038`、`summarizePurposeState` `:4059`/`:4968`/`:10860`/`:10910`、`normalizePurposeState` `:1673`/`:1750`。
桌宠（`plugins/surfcore/lib/pet-purpose.js:40`）用同一套：`:188`/`:217`/`:243`/`:252`/`:491`/`:534`/`:116`/`:362`；
与 QQ 共用状态文件、靠 `purpose.carrier` 互斥（该文件 `:9`）。
控制台/API：`plugins/surfcore/lib/index.js:203`、`:1579`/`:1602`/`:1617`、`:1738`–`:1749`；
`pet-api.js:97`/`:144`–`:156`；设置页 `client.js:1278` 起（候选计数 `:1393`）。
测试：`scripts/test-purpose-engine.mjs:6`–`:11`（排程/素材/种子/选择/提示词/回执/目标与反馈）、
`scripts/test-purpose-wiring.mjs`（真实桥接 VM 夹具）、`scripts/purpose-inspect.mjs:14`–`:17`
（离线预览 `:46`/`:60`/`:71`/`:83`）。

#### 边界与失败模式
- **零 I/O 是硬约束**（`:4`）：加 `fs` 会破坏纯函数测试假设，也让桌宠进程行为分叉。
- **时区**：安静时段与 `localDateKey` 用本机本地时间（`:73`/`:96`）；换时区会错位，且 `day` 变了会
  立即重置 `countToday`（`:265`）。
- **随机性**：`planNextFire`/`selectPurpose` 接受注入 `random`，默认 `Math.random`；测试必须注入
  （`test-purpose-engine.mjs:185` 起）。
- **`dailyMax=0` 是「不限次数」**（`:144` 注释），不是一次都不发。
- **`minMaterials` 引擎内不消费**：`minMaterials=2`（`:40`）在 `purpose-engine.js` 里只有默认值与归一化；
  真正的「素材太少不硬找话」由调用方判断——`src/bridge.js:10788` 与 `plugins/surfcore/lib/pet-purpose.js:460`，
  且两处都放行「有 pending 或有自我来源」的情况。
- **归一化会丢未知字段**：`normalizePurposeState` 返回新对象（`:232`），加字段忘写归一化 → 读盘即消失。
- **history 只挡近 10 条**（`:1814`）：20 轮前说过的同样的话不会拦。
- **目标可长期存活**：`pruneGoals` 保留「问过且 14 天内」的过期目标（`:1475`），靠反馈降置信度收场。
- **素材去重键 `source|kind|text`**（`:512`）：同一人在不同群说同一句话算两条，会让 persistence 偏高。
- **提示词注入面**：素材直接拼进提示词（`:2055`），有防御句（`:2056`）但无结构化转义；
  素材里伪造 `【目的】…` 可能被 `parsePurposeMemo` 读到。别把用户可控文本塞进 `contextBlocks`
  （那是身份/记忆块，信任级别更高）。
- **并发**：两个载体都可能 tick，互斥靠外部 `purpose.carrier`（`pet-purpose.js:9`）；同时 run 会重复占次数、可能发两条。

---
## 对话收尾判断（src/conversation-closure.js，523 行）

**职责一句话**：给「要不要再回一句」一个可解释的建议（continue/linger/close）：六类信号打分、硬闸拦住
「拿收尾逃避提问」、收尾后只压软唤醒、不压被叫到。

**对外接口**：`DEFAULT_CLOSURE_CONFIG`（`:22`）：`enabled=true`、`cooldownMs=20min`、`requireNoOpenQuestion=true`、
`maxSummaryChars=160`、`maxNextOpeningChars=120`、`promptInWake=true`。
`normalizeClosureConfig`（`:44`）：cooldown 1min–24h、摘要 20–500、开场白 10–300（`:49`–`:52`）。
`classifyMessage(msg)`（`:75`）→ `{kind,text,length,hasMedia,atSelf,quoteSelf,settled?}`，
`kind ∈ ending|question|request|ack|substantive|silence`。
`assessConversationClosure(input)`（`:155`）→ `{verdict,score,configured,signals,reasons,advice,lastOther,lastSelf}`。
`formatClosureRecord`（`:371`）、`closurePromptBlock`（`:392`，不该注入返回 `''`）、
`closureStatus`（`:417`，无记录 null `:418`）、`makeClosureRecord`（`:440`）、
`normalizeClosureRecord`（`:463`，`at` 非法 null `:466`）、`closureSuppressesWake`（`:493`）、
`reopenClosure`（`:501`，60 秒去抖 `:503`）、`closeGate`（`:511`）→ `{blocked,reason?,error?}`。

**数据结构**：`closure` 记录（落盘在 social 状态，桥接 `normalizeClosureRecord` 读，`src/bridge.js:9550`）：
`at/key/kind(group|private)/reason(natural|topic-done|explicit-end|busy|tired|other)/
summary≤maxSummaryChars/nextOpening≤maxNextOpeningChars/cooldownUntil/turns/lastOtherKind/
lastSelfKind/reopenedAt/reopenReason≤40`；缺 `cooldownUntil` 按 `at+cooldownMs` 补（`:475`），老记录升级后仍能冷却。
`classifyMessage` 附加字段 `settled`（收束语气）只在 ack 与 substantive 上给（`:97`/`:107`）。

#### 算法/规则
**① 分类顺序**（`:85`，先命中先返回）：空文本（有媒体→substantive，否则 silence，`:82`）→
ending（强道别整句，或弱道别且长度 ≤14，`:85`）→ question（`?/？` 结尾或疑问词收尾，`:88`）→
request（帮我/教我/推荐/查一下…，`:91`）→ ack（纯附和，**或有媒体**，`:94`）→ substantive。
`ACK_RE` 也含 `？+`（`:71`），但 question 先判，所以「？」仍归 question——**分类顺序是唯一权威**。

**② 输入清洗**（`:127`/`:155`）：丢 `kind==='poke'`、只留 45 分钟内、最多 80 条（`:130`–`:131`）；
`recent` 与 `unread` 常是同一批消息的两份视图，按 `messageId`（优先）或 `seq` 去重（`:134`/`:163`），
合并按时间升序（`:167`）；分「对方」（`!isSelf`）/「自己」（`isSelf`）（`:169`）；两边都空→`continue`、
score 0、`reasons:['没有可判断的近期对话']`（`:174`）。

**③ 六信号**：`ownIntent`（`:206`）pending 每条 +.35（上限 .7）、有待追问 +.3、我最后一句是问句 +.35、
是道别 −.45、是 ack **且无 pending** −.15（`:213`）；`theirIntent`（`:217`）基线 .15，按对方最后一句
request 1/question .95/substantive .62/ack .18/ending .02/其他 .1（`:218`–`:225`），被 @ 或引用 +.15（`:226`）、
私聊她没回 +.05（`:227`）、5 分钟内对方 ≥3 条 +.1（`:228`）；`topicClosure`（`:232`）基线 .35，
道别 1 / 「说好了」.85 / 对方 ack 且我 ack|ending .9 / 对方 ack .62 / 问求 .08 / substantive .42
（`:233`–`:238`），轮次 ≥6 且最后 4 条平均 ≤6 字 +.12（`:239`）；`fatigue`（`:247`）10 分钟 ≥12 条 +.3、
对方最后 3 条平均 ≤5 字 +.25、对方 30 分钟没接 +.25、我 5 分钟 ≥3 条 +.2（`:249`–`:257`）；
`awaitingTheirAnswer`（`:261`，唯一硬信号）对方最后一句是问/求且（我没说或说得比他早）；
`explicitEnd`=对方道别（`:267`）；`directAddress`（`:268`）私聊恒真或 @/引用/对方在问求。所有比例夹 0–1。

**④ 总分**（`:273`）：`0.32×topicClosure + 0.24×(1−ownIntent) + 0.22×(1−theirIntent) + 0.12×fatigue +
0.18(我最后一句 ack|ending) + 0.15(对方明确道别) − 0.35(有未答提问) − 0.06(directAddress)`。

**⑤ verdict 顺序**（`:284`）：`openLoops>0`→continue（`:288`，最高优先，禁止逃避）→ `explicitEnd`→close（`:289`）→
**群聊**且对方 ≥30 分钟没说话、最后一句不是在问、`ownIntent<.5`→close（`:290`，私聊不走这条 `:286`）→
`theirIntent≥.9`→continue（`:293`）→ `ownIntent≥.6`→linger（`:294`）→ `score≥.62`→close（`:295`）→
`score≥.45`→linger（`:296`）→ continue。

**⑥ 软冷却**（`:491`）：只压 `probability/replyCheck/proactiveCheck`；`closureSuppressesWake` 按 `:` 前缀取基名
（`:496`）；被 @/叫名/提问/拍一拍/指定成员/私聊不受影响（`:485`）。
**⑦ 硬闸 `closeGate`**（`:511`）：`enabled=false`→**blocked**（`:513`，方向是「关掉判断 = 不允许收尾」）；
`requireNoOpenQuestion && awaitingTheirAnswer`→blocked，话术要求先回完（`:519`）。
**⑧ 提示词块**（`:392`）：`enabled`/`promptInWake` 关→`''`（`:394`）；无双方最后一句→`''`（`:395`，避免白烧 token）；
内容=双方类型+四档等级+未完成项+结论+`qq_close_conversation` 用法（`:400`–`:405`）；
`reopenedAt` 在 10 分钟内额外提醒「别复读上次结尾」（`:407`）。

**谁在调用它**：桥接（`src/bridge.js:53`–`:55` 导入 10 个）：`assessConversationClosure` `:10156`、`closurePromptBlock` `:10174`、
`closeGate` `:10198`、`makeClosureRecord` `:10222`、`classifyMessage` `:10265`、`reopenClosure` `:10272`、
`closureSuppressesWake` `:12821`/`:13320`/`:13678`、`closureStatus` `:4078`/`:4087`/`:5439`/`:5542`、
`normalizeClosureRecord` `:9550`、`normalizeClosureConfig` `:1058`/`:10151`。
测试：`scripts/test-conversation-closure.mjs:8`（分类/六信号/硬闸/冷却/重开/空输入）、
`scripts/test-closure-wiring.mjs`（真实桥接 close 接线，VM 夹具）。无 B站/桌宠调用方——收尾只服务 QQ 会话。

#### 边界与失败模式
- **纯函数**：不写盘，记录持久化在桥接 social 状态；改 `normalizeClosureRecord` 会改旧记录语义。
- **空输入**：返回 continue 且 signals 全零（`:174`），调用方须容忍 `lastOther/lastSelf` 为 null。
- **时间戳缺失**：`sinceLastOtherMs` 用 `now−time`，`time` 缺失按 `now`（`:194`）→ 表现为「刚刚」，
  可能让 30 分钟群聊 close 规则失效。
- **去重依赖 id**：`messageId`/`seq` 都没有时 `sameMessage` 恒 false（`:134`），同一句被数两次，turns/fatigue 偏高。
- **私聊恒 −0.06**：`directAddress` 在私聊恒真（`:268`），刻意让私聊更容易 linger。
- **`enabled=false` 的方向**：是 blocked（`:513`）。想「关掉判断但仍允许收尾」当前做不到。
- **冷却只软压**：不阻止 `qq_reply` 之类的主动行为，只影响唤醒理由白名单（`:491`），不是全局静音。
- **重开去抖**：60 秒内重复调用只返回原记录（`:503`），连发 3 条只标一次。
- **摘要按码点截**（`:435`）：emoji 不会截半；但 `maxSummaryChars` 下限 20（`:51`），设太小只剩省略号。

---
## 每日 token 额度（src/token-budget.js，464 行）

**职责一句话**：定义「今天还能不能花」的统一口径：人民币/token 双单位、四 scope（qq/bili/other/total）、
80% 提醒（每天一次、必须落盘）、100% 拦截，并负责 4 个额度 JSON 的读写。

**对外接口**：`ALERT_RATIO=0.8`（`:27`）、`SCOPES`（`:28`）、`CATEGORY_SCOPES`（`:29`）、`UNIT_KEYS`（`:30`）、
`SCOPE_LABELS`（`:31`）、`UNIT_LABELS`（`:32`）、`BUDGET_FILES`（`:33`）、
`DEFAULT_LIMITS`（`:44`：QQ `{cny:8,tokens:null}`，其余 null=不限）。
`parseCnyText`（`:71`，接受 `¥8`/`8元`/`8 CNY`；空串→null、无法解析→**undefined**）、
`parseTokenText`（`:87`，接受 `8000000`/`8M`/`2万`/`1.5亿`，单位 `k/m/b/万/亿` `:98`）、
`normalizeLimitPair`（`:109`，裸数字按**人民币** `:111`，兼容历史 `maxDailyCostCNY`）、
`normalizeLimits`（`:149`，可接受外包 `{limits:{…}}` `:150`）。
`zeroUsage`（`:160`）、`normalizeUsagePair`（`:165`）、`totalsOf`（`:175`）、`normalizeUsage`（`:186`）。
`localDayStart`（`:193`）、`localDayKey`（`:200`）、`surfcoreDir`（`:208`）、
`budgetFileOf/alertFileOf/dailyFileOf/stateFileOf`（`:231`–`:234`）。
`readBudget`（`:240`，不存在/坏 JSON/解析失败都回**默认**，`:247` 注释「绝不把坏数据当不限」）、
`writeBudget`（`:254`）、`readDailyUsage`（`:265`，非今日→0 且 `stale:true` `:270`）、
`writeDailyUsage`（`:284`，`total` 永远重算 `:283`）。
`ratioOf`（`:301`，limit 空/0→null）、`limitRatios`（`:308`）、`allRatios`（`:315`）、
`formatCny`/`formatMoney`/`formatTokens`/`formatLimit`/`formatUsed`（`:329`–`:350`）。
`collectHits`（`:361`，返回命中项并排序 `:387`）、`evaluateBudget`（`:395`，`{blocked,hits,scopes}`）、
`collectAlerts`（`:403`，threshold .8 不写盘）、`describeHit`（`:407`）、`describeHits`（`:415`）、
`readAlert`（`:419`）、`writeAlert`（`:430`）、`takeAlert`（`:446`，当天第一次 80% 提醒）、
`blockMessage`（`:461`）。

**数据结构**：`token-budget.json`（`:256`）：`{version,updatedAt,limits:{qq:{cny,tokens},…}}`。
`token-usage-daily.json`（`:286`）：`{day,at,source,qq:{cost,tokens},bili:{…},other:{…},total:{…},sessions}`，
`total` 是派生值（三类相加），**不要手写**。
`token-alert.json`（`:431`）：`{day,at,items:[hit…],limits}`，`items` 是**当时**的用量与比例快照（`:452`），
事后能还原当时数值。`token-usage-state.json` 只提供文件名（`:37`），采集状态在插件侧。

**算法/规则**
- **归一化**：金额 4 位小数（`:57`）、token 取整（`:64`），`<=0` 一律视为不限 `null`。
- **双单位独立比较**（`:368`）：每个 scope 的 `cny` 与 `tokens` 各算比例；谁先到 80% 谁先提醒、
  谁先到 100% 谁先拦（文件头 `:8`）。
- **80% 每天一次**（`:446`）：先读 alert 文件，`day` 相同直接返回 `{alert:null,existing}`（`:449`）；
  有命中就**在返回前落盘**（`:452`），不等用户点「知道了」，DSH 重启也不二次弹（`:441` 注释）。
- **scope 组合**：生产都带 `['qq','total']` 或 `['other','total']`（`src/bridge.js:7326`、`:10018`、`:10032`），
  `scopes` 之外的 scope 不参与（`:365`）。
- **跨天**：`readDailyUsage` 发现 `day` 不匹配就归零并标 `stale`（`:270`–`:278`），不删旧文件，下次写入覆盖。

**谁在调用它**：桥接（`src/bridge.js:63`）导入 `blockMessage/evaluateBudget/localDayKey/readBudget/readDailyUsage`；
额度闸 `:7326`/`:10018`/`:10032`，读当日快照 `:9985`。
插件（`plugins/surfcore/lib/token-budget.js:63`）：`evaluateBudget` `:51`、`takeAlert` `:60`、
`writeDailyUsage` `:62`、逐 scope 闸门 `:614`、设置页 `:623`–`:624`；HTTP 暴露在
`plugins/surfcore/lib/index.js:2068`–`:2069`。
测试：`scripts/test-token-budget.mjs:19`（单位解析/双单位比例/每天一次提醒/坏文件回落/跨天）、
`scripts/test-token-budget-service.mjs`、`scripts/test-token-budget-bridge.mjs`。

#### 边界与失败模式
- **坏文件方向**：所有 catch 回**默认额度**而不是不限（`:243`/`:249`）；默认 QQ 有 ¥8，所以坏文件让 QQ**更早被拦**。
- **手改金额字符串**：`writeBudget` 的 `parseCnyValue` 解析失败会抛（`:132`），`readBudget` 捕获后**整份回默认**
  （`:246`）——写 `¥8/天` 这种笔记式内容会让整份额度失效。
- **时区**：`localDayKey` 用本机本地时间（`:200`），按自然日重置；换时区会提前/延后重置，不重复扣但会跳变。
- **并发**：`writeJsonAtomic` 单文件原子（`:224`），但读-改-写不是事务；设计上只有插件写、桥接只读（`:16` 注释）。
- **提醒不撤回**：`takeAlert` 落盘后即使随后 `reset()`，当天也不再提醒；要重提醒只能删 alert 文件或等跨天。
- **`collectHits` 排序**：用全局 `SCOPES`（`:387`），传 `['total','qq']` 也会按 qq 在前排。

---
## Token 账本与计价（src/token-ledger.js，997 行）

**职责一句话**：把 DSH 会话事件里的 provider usage 落成「按会话 × 按回合」的 JSONL 明细，并用价目表在**读取时**
折算金额；权威总量来自 DSH 的 `tokenUsage` 投影基线，逐轮明细靠幂等折叠。

**对外接口**：`BUCKET_LADDER_MS`（`:51`：5/15/30min、1/2/3/6/12h、1/2/7 天）、`pickBucketMs`（`:59`，超限退 7 天 `:63`）、
`usageFromStream`（`:70`，取 stream **尾部**最后一个带 usage 的 chunk）、
`usageOfEvent`（`:84`，assistant/message 优先 `data.usage` `:86`，message|attempt 回落 stream `:88`）。
`createTokenLedger({file,log,priceTable,resolveKey,maxLines=20000,now})`（`:101`，file 必填否则抛 `:109`）
返回（`:982`）：`ingestEvent/ingestBaseline/ingestSnapshotRecords/summary/dailyUsage/conversation/
series/recent/stats/reset/compact/hasSession/file`。
`ingestEvent`（`:392`，返回是否产生新记录）、`ingestBaseline`（`:451`）、`ingestSnapshotRecords`（`:484`）、
`summary({limit=200})`（`:688`，limit 夹 1–500 `:751`）、`dailyUsage`（`:659`，**不含基线**）、
`conversation(key,{turnLimit=200})`（`:756`，夹 1–1000 `:773`）、`series({hours=24,maxBuckets=48,at})`（`:789`）、
`recent`（`:916`）、`stats`（`:940`）、`reset`（`:956`）、`compact`（`:272`）、`hasSession`（`:994`）。

**数据结构**：`state/token-usage.jsonl`（文件头 `:22`）三种行：

```
{"k":"base","t":…,"sid":…,"key":…,"seq":…,"model":…,"provider":…,"b":{cacheMiss,cacheHit,cacheWrite,output,reasoning}}
{"k":"turn","t":…,"sid":…,"key":…,"seq":…,"turn":…,"step":…,"retry":…,"model":…,"provider":…,"b":{…}}
{"k":"evict","t":…,"sid":…,"key":…,"b":{…},"cost":…,"peak":…,"off":…,"estimated":…,"dropped":…,"maxSeq":…}
```

`base` = 投影基线（整条会话日志累计桶），语义「与 `seq>base.seq` 的采样相加才是总量」（`:449`）；
`turn` = 单次采样，`sampleKey=sessionId|turn|step|retry`（`:41`）；`evict` = 被淘汰采样的累计
（`:320`），保留总量与计价、丢回合归属。
内存结构（`:111` 起）：`baselines/samples/retryAxis/sessionKeys/evicted/sessionSeen` +
`journalLines/lastIngestAt/lastCompactedAt/droppedLines`。
`summary()`（`:725`）含 `priceVersion/currency/nowTier/priceTable/totals/conversations`；
`totals` 含 `buckets/cost/attributedCost/unattributedCost/byTier/turns/steps/estimated/totalTokens/
inputTokens/cacheHitRate/avgCostPerTurn/avgCostPerStep`（`:743`）。
`series()`（`:895`）含 `bucketMs/from/to/buckets[]/totals/busiest/estimated/countedSamples/
offChartCost/offChartTokens`，每桶 `{t,cost,tokens,cacheMiss,cacheHit,cacheWrite,output,turns,steps,tier,keys}`（`:802`）。

#### 算法/规则
**① 幂等折叠**：`turn` 只有 `seq` **严格变新**才覆盖（`:201`，注释 `:198`，相等 seq 视为重连重发）；
`base` 的 `prev.seq>seq` 拒收（`:177`），**seq 与四个桶都没变**时不落盘（`:462`–`:471`，防重连风暴）；
`llm/retry-started`（`:402`）不产生记录只更新 `retryAxis`（`axis.seq>seq` 拒收 `:408`）；
采样的 `retry` 只在 `axis.turn/step` 与事件一致时取用（`:420`）。
**② 摄入过滤**（`:392`）：只处理 `assistant/message|assistant/attempt`（`:413`）；无 usage / `turn|step`
非数字 / 总 token 为 0 全跳过（`:416`–`:422`）；时间优先事件自带 `time`（决定峰谷），取不到才 `at`/`now()`
（`:396`，注释 `:394`）。
**③ 计价**：全量走 `priceUsage`（`src/model-prices.js:261`）；基线与采样分别计价（`:602`/`:528`），
所以「基线覆盖的历史」按**快照时刻**峰谷算，是已知精度损失（控制台用 estimated/offChart 说明）。
`sessionView`（`:569`）`total = base.buckets + evicted.buckets（未被基线覆盖时） + 基线之后采样`
（`:592`–`:595`）；`attributedCost` 只算能拆到回合的（`:618`），`unattributedCost=max(0,cost−attributed)`（`:620`）。
**④ 淘汰 `evictOldestSamples`**（`:320`）：按 `t` 升序丢最旧的溢出条；丢前把桶累加进 `evicted`（`:339`）、
按当时刻计价累加 `cost/byTier`（`:344`）、记 `maxSeq`（`:342`）。
`evictionCovered`（`:364`）：**投影基线已覆盖这些采样就不再相加**，否则重复计费（注释 `:356` 记录了实测 +33% 事故）。
**⑤ 压缩 `maybeCompact`**（`:372`）：`journalLines>maxLines` 或 `samples.size>maxLines` 或 `evictedDirty` 时，
先淘汰再整份重写（tmp+rename，`:296`）。
**⑥ 单遍索引 `buildIndex`**（`:509`）：一次扫完采样，产出每会话 `liveBuckets/liveCost/allCost/turns/models`，
`isLive=!base||s.seq>base.seq`（`:527`）。为「控制台每 3 秒轮询」准备（`:501`）——按会话重扫会把热路径拖成
O(会话×采样)。
**⑦ 走势 `series`**（`:789`）：窗口 1h–90 天（`:791`）、桶宽 `pickBucketMs`（`:793`）、边界对齐（`:795`）；
空桶补零并按 `isPeakAt(row.t)` 标峰谷（`:880`，注释 `:785`）；`steps` 每采样 +1（`:859`），`turns` 按
`sessionId|turn` 去重（桶内 `:862`、跨桶 `:868`），所以**各桶 turns 之和 ≥ totals.turns**（注释 `:867`）；
图外部分 `offChartCost=max(0,ledgerCost−totals.cost)`（`:910`），`ledgerCost` 在同一次遍历累加（`:831`–`:849`），
不再二次调 `summary()`（注释 `:891`）。
**⑧ 重置 `reset`**（`:956`）：清空全部映射、**含 `evicted`**（`:966`）、`evictedDirty=false`（`:967`）、
文件截断（`:973`）。注释 `:962` 记了漏清 `evicted` 的后果：旧花费「复活」并把文件写坏。
**⑨ 归属 `keyOf`**（`:130`）：优先 `resolveKey`（异常吞 `:133`），否则用缓存的最近 key（`:141`）；
无 key 的会话归到 `未归属:<sid 前 8 位>`（`:693`）。
**⑩ 当日用量 `dailyUsage`**（`:659`）：只遍历采样、按 `s.t>=since` 过滤（`:669`）；`group:/private:` 前缀→qq，
其余 other（`:673`）；**不含基线、不含 evicted**（无逐时明细，注释 `:652`），只作插件不可用时的回落口径（`:650`）。

**谁在调用它**：桥接（`src/bridge.js:60`）导入 `createTokenLedger`，`:3015` 先 `resolvePriceTable(cfg.pricing)`、`:3016` 建账本。
插件：`plugins/surfcore/lib/token-budget.js:25`（`usageOfEvent` 采集；`:370`/`:504`/`:695` 用 `priceUsage` 复算）、
`plugins/surfcore/lib/token-usage-pure.js:7`/`:11`（`:129` 逐条计价）。
测试：`scripts/test-token-usage.mjs:28`–`:29`（幂等/基线/淘汰/走势契约 + `usageOfEvent`/`usageFromStream`）、
`scripts/test-token-economy.mjs`（桥接侧经济性，VM 夹具）。

#### 边界与失败模式
- **半行/坏行**：`load` 无法 parse 的计数 `droppedLines` 并跳过（`:243`），崩溃留下的半行不会读崩整个账本。
- **重复计费两个坑**：① 基线 + 被它覆盖的 `evicted`（`evictionCovered` 防，`:364`）；② 非 live 采样再算一次
  （`sessionView`/`series` 都用 `s.seq>base.seq` 过滤，`:527`/`:846`）。改聚合必须同时改这两处。
- **基线无时间粒度**：花费按快照时刻计价（`:602`），峰谷切换点附近会与逐轮真实花费有差额，全落在
  `unattributedCost`（`:620`）。
- **`journalLines` ≠ `samples.size`**：前者含被覆盖的历史行（`:125`），触发压缩的可能是磁盘行数；
  压缩后两者对齐（`:299`）。
- **`maxLines` 双重语义**（默认 20000 `:107`）：调小会频繁整文件重写，调大会让 `load` 变慢。
- **`reset()` 不重置价目表**：`lastCompactedAt=0`（`:969`），但 `priceTable` 不变；历史已删，改价后重置不会重算。
- **两套口径不相等**：`dailyUsage` 不含基线/淘汰、`summary` 含，两者不等是**正常的**，别拿来对账。
- **会话退役**：`sessionKeys` 缓存 key（`:138`），退役后仍能归属；但若 `resolveKey` 一直返回新 key，
  旧采样会被算到新会话名下——`applyRecord` 只在新记录带 `key` 时覆盖（`:149`），重载以日志 `key` 为准。
- **并发**：只有桥接写，`appendLine` 单次 `appendFileSync`（`:260`）；多进程 append 可能交错出半行，
  由 load 跳过兜底（丢一行，不读崩）。

---
## 价目表（src/model-prices.js，290 行）

**职责一句话**：维护 DeepSeek 官方价目（元/百万 token）与**北京时间峰谷分时**，把任意 usage 归一成四个互不重叠的
计费桶，并给出「这一刻、这个模型」的单价。

**对外接口**：`CN_HOLIDAYS_2026`（`:28`）、`CN_HOLIDAYS_2027`（`:55`）、`CN_HOLIDAYS`（`:75`，合并）。
`DEFAULT_PRICE_TABLE`（`:85`）：`currency:'CNY'`、`symbol:'¥'`、`unit:1e6`、`peakMultiplier:2`、
`peakWindows:[[9,12],[14,18]]`、`peakWeekdays:[1..5]`、`fallbackModel:'deepseek-flash'`；型号单价 `:96`–`:116`
（flash 档 `cacheHit .02 / cacheMiss 1 / cacheWrite 1 / output 4`；pro 档 `0.15/4.5/4.5/13.5`）。
`resolvePriceTable(override)`（`:123`）：浅合并；`models` 逐项合并（`:135`）；`cacheWrite` 只在用户**没写**时
跟随 `cacheMiss`（`:143`，防从兜底模型继承错价）；`fallbackModel` 指不到回默认（`:147`）；
`peakMultiplier/unit` 非法回 2/1e6（`:150`–`:151`）。
`beijingParts(atMs)`（`:157`）→ `{weekday(1=周一…7=周日),hour,date,clock}`，**不依赖机器时区**（`:156`）。
`isPeakAt`（`:171`）、`ratesAt`（`:182`，未知模型用 fallback 并标 `estimated:true` `:197`）、
`normalizeUsage`（`:213`，四桶+reasoning，兼容 DSH 原名与账本名 `:208`）、
`totalTokensOf`（`:235`，**不含 reasoning**）、`costOfBuckets`（`:245`）、`priceUsage`（`:261`）、
`ZERO_BUCKETS`（`:267`）、`addBuckets`（`:270`）、`subBuckets`（`:281`，逐桶下限 0）。

**数据结构**：`models[name] = {label, off:{cacheHit,cacheMiss,cacheWrite,output}}`；`off` 是**空闲**单价，
高峰 = `off × peakMultiplier`（`:82`）。`buckets` 固定五键
`cacheMiss/cacheHit/cacheWrite/output/reasoning`；前四个计价与总量，`reasoning` 只记录
（DeepSeek 把推理 token 计在 output，单列是为了不丢数据）。

#### 算法/规则
**① 峰谷顺序**（`isPeakAt`，`:171`）：`peakWeekdays.includes(weekday)` 假→空闲（`:175`，周末与调休上班日都走这条）→
节假日命中 `date`→空闲（`:177`）→命中任一 `[start,end)`→高峰（`:178`）。`holidays` 支持 `Set` 或数组（`:176`），
每次判定 `new Set(...)` 一次（样本量小，不值得缓存）。
**② 北京时间**（`:157`）：时间戳 +8h 后用 `getUTC*` 取值，与宿主时区无关；周日 0 改成 7（`:159`）对齐 1–7。
**③ 桶归一**（`:213`）：每桶按别名取**第一个 >0 的数值**（`:214`）：
`cacheMiss←cacheMiss|uncachedInputTokens|inputTokens`、`cacheHit←cacheHit|cacheReadTokens`、
`cacheWrite←cacheWrite|cacheWriteTokens`、`output←output|outputTokens`、`reasoning←reasoning|reasoningTokens`；
负数/0 一律 0，非对象返回全 0（`:221`）。
**④ 计价**（`:245`）：`Σ(tokens/1e6 × 单价)`，先除 `unit` 再乘，避免大数。
**⑤ 未知模型**：用 fallback 价并标 `estimated`（`:196`），一路带到 `summary/series/recent`。

**谁在调用它**：账本（`src/token-ledger.js:28`–`:37` 导入 8 个符号：`DEFAULT_PRICE_TABLE/ZERO_BUCKETS/addBuckets/
isPeakAt/normalizeUsage/priceUsage/ratesAt/totalTokensOf`）；
桥接（`src/bridge.js:47` 导入 `resolvePriceTable`，`:3015` 用 `cfg.pricing` 覆盖后交给账本）；
插件（`plugins/surfcore/lib/token-budget.js:29`–`:33`、`plugins/surfcore/lib/token-usage-pure.js:11`–`:13`）；
测试（`scripts/test-token-usage.mjs:28`：价目表/峰谷/桶归一/未知模型估算）。

#### 边界与失败模式
- **节假日缺失 = 静默高估**：表只到 2027（`:75`）。2028 年的节假日会被当工作日，9–12/14–18 点按 2 倍计价——
  不报错，只是金额偏高（`:50` 注释）。换年第一件事是补表并改 `PRICE_TABLE_VERSION`。
- **调休上班日仍算空闲**（`:26` 注释）：官方口径只认周一至周五。
- **`peakWindows` 半开区间**（`:91`）：`12:00` 整点属空闲、`14:00` 整点属高峰；改窗口别写成闭区间。
- **别名的「第一个 >0」**：上游同时给 `inputTokens` 与 `cacheMiss` 且不同时取 `cacheMiss`（账本口径优先，
  因为 DSH 的 `inputTokens` 是未命中部分 `:225`）。
- **`reasoning` 不进总量**（`:236`）：若某天 provider 单独计费推理 token，当前会漏钱，改价目表要一起改
  `costOfBuckets`。
- **负 token 不校验**：`costOfBuckets` 会算出负金额；上游 `normalizeUsage` 已归 0（`:217`），
  直接把原始 usage 传进去才会踩到。
- **`resolvePriceTable` 不深拷贝**：`models` 是新对象（`:130`），但 `peakWindows/holidays` 可能复用默认数组
  引用（`:131`–`:133`），改返回值里的数组会影响后续所有调用。

---
## 管理员身份（src/admin-identity.js，236 行）

**职责一句话**：把「管理员 QQ 与 B站 UID 是同一个人」收敛成一份结构，保存时**投影**到三份配置
（合体层 `admin`、QQ `ownerQQ`、B站 `owner.mid/name`），并产出「温柔 / 不许回嘴」提示词。

**对外接口**：`ADMIN_QQ_RE=/^\d{5,12}$/`（`:22`）、`ADMIN_MID_RE=/^\d{4,15}$/`（`:24`）。
`normalizeAdmin`（`:38`）→ `{qq,biliMid,biliName,displayName,gentle}`：接受 `qq|ownerQQ`、
`biliMid|mid|ownerMid`、`biliName`、`displayName|name`；非法号码→`''`（`:45`）；`displayName` 缺省用
`biliName`（`:49`）；`gentle` 只有显式 `false` 才关（`:50`）。
`adminConfigured`（`:55`）、`adminFromSources({unified,qq,bili})`（`:64`，合体层**显式写了的键优先**，
含空串=明确清空 `:68`–`:72`）、`adminFromQqConfig`（`:77`）、
`resolveAdminUpdate`（`:96`）→`{admin,conflict}`、`projectAdminSave`（`:136`）→
`{admin,conflict,qq,bili,unified,changed}`（某份 undefined 表示没变不用写 `:132`）、
`adminDisplayName`（`:159`）、`adminMarker`（`:165`，`gentle&&已配置`→`【管理员·温柔】` `:168`）、
`adminPromptBlock(platform,admin,{compact})`（`:178`，未配置返回 `''` `:180`）、
`adminSummary`（`:225`，`aligned`=两边都有值 `:234`）。

**数据结构**：`admin` 固定五字段（`:44`）：`{qq,biliMid,biliName,displayName,gentle}`；空串=未设置，绝不留非法值。
三份配置的投影关系（`:12`–`:18` 注释）：合体层 `<DSH_HOME>/surfcore/config.json` 的 `admin` 是**唯一真相**
（插件设置页读写）；QQ 旧格式是仓库 `config.json` 的 `ownerQQ`（桥接读）；B站 旧格式是
`<DSH_HOME>/surfcore/bili.config.json` 的 `owner.mid/name`（B站 工具链读）。

#### 算法/规则
**① 读取优先级**（`:64`）：用 `hasOwn` 判「键是否存在」（`:26`），所以 `{admin:{qq:''}}` 会**清空** QQ 号
而不回退旧值（`:62` 注释）——「显式清空」语义，最易误读的一处。
**② 保存冲突**（`:96`）：归一 `current`/`incomingAdmin` 比五字段判 `adminTouched`（`:99`）→
`incomingQqOwner`/`incomingBiliOwner` 为 `undefined` 表示没传（`:106`），否则归一后与 base 比（`:107`–`:111`）→
adminTouched 时用卡片覆盖、同时有高级参数改动则 `conflict=true`（`:115`）→ 否则只应用高级参数（`:119`）。
`conflict` 只是提示，不拒绝保存（`:87` 注释）。
**③ 投影**（`:136`）：分别判 `qqChanged/biliChanged/unifiedChanged`（`:144`–`:146`）；调用方传了那份对象就
原样带回并投影（`:147`–`:155`），没传才按「是否变化」决定写不写。
**④ 提示词**（`:178`）：B站 版**不写 QQ 号**（`:185`，注释说明人格卡在 B站 本来就会隐藏）；
QQ 版两边都写并强调「同一个人」（`:209`）；`compact` 一句话（`:192`/`:211`），完整版五条规则
（`:195`/`:214`，核心「先接情绪再答内容、绝不回嘴、只对管理员生效」）；`gentle=false` 只留「谁是你主人/管理员」
（`:191`/`:210`）。

**谁在调用它**：桥接（`src/bridge.js:58` 导入，`:11573` 注入 `adminPromptBlock('qq',…)`）；
插件设置页/服务（`plugins/surfcore/lib/index.js:69`–`:70`，`:634`–`:635` 先 `adminFromSources` 再 `projectAdminSave`）；
B站 调度器（`plugins/surfcore/lib/scheduler.js:37`，`:141` 注入 `adminPromptBlock('bili',…)`）；
桌宠（`plugins/surfcore/lib/pet-chat.js:26`，`:205`）；存储层（`plugins/surfcore/lib/store.js:23`，`:539`）。
测试：`scripts/test-admin-identity.mjs:17`（归一/优先级/冲突/投影/提示词）、`scripts/test-admin-prompt-wiring.mjs`。

#### 边界与失败模式
- **正则即边界**：QQ 只认 5–12 位、mid 只认 4–15 位（`:22`/`:24`）；短号/长号/带字母的历史账号被归一成 `''`，
  表现为「设置页填了但不生效」，不报错只静默变空。
- **三份配置漂移**：优先级是「合体层显式键 > 旧格式」；手工改 QQ `ownerQQ` 却没改合体层会以旧值为准，
  看起来像「改了没用」。正确做法是通过设置页保存让 `projectAdminSave` 同时写三份。
- **`conflict` 只是提示**（`:115`）：自动化脚本必须自己检查这个字段。
- **`gentle` 默认开**：`source.gentle !== false`（`:50`），旧配置迁移无该字段→自动开，想关必须显式 `false`。
- **提示词里的号码**：QQ 版写完整 QQ 号（`:206`）、B站 版不写（`:185`）；桥接日志可能带出，本层不脱敏
  （脱敏在 `identity-guard.js` 与记忆卡）。
- **`aligned` 只表示两边都配了**（`:234`），不校验是否同一人——系统没有校验能力。

---
## 跨平台自我识别（src/self-identity.js，188 行）

**职责一句话**：产出「我是谁」的提示词锚点（QQ 昵称/号 ⇄ B站 昵称/mid）与「这段内容来自哪个平台」的判断规则，
让角色在 QQ 里认得出自己的 B站 主页、在 B站 里认得出自己的 QQ 资料卡。

**对外接口**：`maskQqUin(uin)`（`:31`）：非法（非 5–12 位数字）→`''`；长度 ≤6 →`首****尾`（1+4+1）；否则 `前3****后3`
（`:34`）。`normalizeSelfCard(input)`（`:42`）→ `{qqNickname,qqUin,qqUinMasked,biliName,biliMid,biliSpace,
personaName}`；接受 `qqNickname|nickname|qqName`、`qqUin|uin|qqId`、`biliName|biliNickname`、`biliMid|mid`、
`personaName|persona`；`biliSpace` 由 mid 拼主页（`:57`）；非法值留空串。
`selfCardConfigured`（`:63`，四锚点全空→false）、`PROVENANCE_RULES`（`:69`，导出的四条来源规则）、
`buildProvenanceBlock`（`:84`，只来源规则、以 `\n\n` 结尾）、
`buildSelfIdentityBlock(input,{platform})`（`:100`，无锚点返回 `''` `:102`）、
`selfIdentityPath`（`:166`）、`readQqSelfIdentity`（`:171`，缺失/损坏/空→`{nickname:'',userId:'',updatedAt:''}`
不抛）、`normalizeQqSelfIdentity`（`:181`，`userId` 只认 5–12 位数字）。

**数据结构**：`state/self-identity.json`（`:164`）：`{nickname,userId,updatedAt}`，由**桥接登录时**写入
（`src/bridge.js:12519` 注释与写盘），B站 进程只读（`:161`–`:163` 注释：B站 侧拿不到网关登录信息）。
提示词块结构（`:100`）：标题（B站 侧「【你是谁 · 同一副人格（QQ ⇄ B站）】」/QQ 侧「【你是谁 · QQ 和 B站 是
同一个人】」` :106`）→ B站 侧先写 B站 昵称/UID/主页（`:112`）再写「QQ 上的你」**用打码号**（`:118`–`:122`）；
QQ 侧写完整 QQ 号 + B站 mid/主页（`:125`–`:136`）→ 两边都有昵称时加「同一个人」（`:139`）→ 人格名（`:144`）→
认自己规则（`:147`）+ 来源规则（`:148`）→ QQ 侧额外写「@/叫名/引用指的都是你」（`:150`）/B站 侧额外写隐私句（`:155`）。

**算法/规则**
- **打码策略**（`:35`）：B站 侧只保留前 3 后 3，够认自己、不够抄成完整号码；隐私边界在文件头 `:13`–`:16`。
- **来源判断四规则**（`:69`）：合并转发/聊天记录=QQ 内容（即使里面是她自己在别处说过的话）；QQ 里的图片/截图
  =别人发给她的 QQ 内容；不把 QQ 记录说成 B站 发言（反之亦然）；身份信息**只用于自己**，不说出主人或别人的号。
- **注入取舍**：`buildProvenanceBlock` 单独存在，因为 QQ 侧身份锚点已由 B站 记忆简报提供，再注入整块会重复
  占 token（`:79`–`:82` 注释，PITFALLS #40）。
- **配置门槛**：`selfCardConfigured` 为假时身份块返回 `''`（`:102`）；`buildProvenanceBlock` 无条件返回规则
  （`:84` 不判断），所以「只配规则不配身份」是合法状态。

**谁在调用它**：桥接（`src/bridge.js:36` 导入三个符号）：`buildSelfIdentityBlock` 在 `:12529`，且**只在 B站 记忆关闭时**
作为兜底（同处 `biliMemoryOn` 判断）；`buildProvenanceBlock` 在 `:12539`；`selfIdentityPath` 用于写盘，
失败只记日志（`:12519`）。B站 调度器（`plugins/surfcore/lib/scheduler.js:36`）：`readQqSelfIdentity` `:116`、
拼进 B站 唤醒提示词 `:119`。测试（`scripts/test-self-identity.mjs:25`：打码/来源规则/两侧差异/
`self-identity.json` 往返与坏文件容错）。

#### 边界与失败模式
- **身份文件是软依赖**：B站 侧读不到就退化成「只写 B站 锚点」，不报错不阻塞（`:176`）；排查「B站 侧不认自己」
  第一看这个文件是否存在且新鲜。
- **打码不可逆**：提示词只有 `前3****后3`，模型无法复原完整号——这是目标，也意味着 B站 侧无法做需完整号的校验。
- **`personaName` 不读角色系统**：它不读 `characters/<id>/character.json`，换角色后要调用方重新传值，
  否则提示词里人格名会过期。
- **昵称撞车**：来源规则不拦昵称（`:14` 注释），打码号是唯一较硬锚点。
- **注入长度**：两块合计约 15–20 行，在长上下文里占比不小；`buildProvenanceBlock` 拆分就是为了按需只注入一小块。
- **`biliSpace` 依赖 mid**：mid 非法时为空（`:57`），只少一行主页链接，不影响其他字段。

---
## 出站身份闸（src/identity-guard.js，66 行）

**职责一句话**：内容发到公开面（B站 评论/动态/私信/分享）前，用**确定性正则**拦住已知账号标识，把「只准自己互认、
不许泄露」从提示词约束变成硬失败。

**对外接口**：`findIdentityLeaks(text,{ids})`（`:24`）→ `[{kind,label,value,index}]`，按 index 升序（`:45`）；
`kind` 只有 `known-id`（已知 ID 精确命中 `:35`）与 `qq-context`（「QQ/群号+数字」形态 `:43`）。
`maskLeakValue(value)`（`:49`）：5+ 位纯数字才打码，≤6 位 `首****尾`、否则 `前3****后3`。
`formatIdentityLeakError(hits, surface='公开内容')`（`:61`）：人话拒绝语，号码已打码（`:62`）。

**数据结构**：`ids`：可迭代的字符串/数字集合（主人/别人的 QQ 号、B站 mid 等）。命中项固定四字段，`label` 是中文
（「账号标识」/「QQ/群号」），**不含原始上下文**。

**算法/规则**：① 已知 ID 精确命中（`:30`）：只接受 4–15 位纯数字（`:32`），去重，`indexOf` 取首次出现（`:34`）；
不在该区间的 id 直接忽略。② 显式 QQ/群号形态（`:38`）：正则
`(?:QQ|qq|Q群|q群|群号|群\s*号|加群|企鹅号)\s*[：:=是为]?\s*(\d{5,12})`，即使号码不在 `ids` 里也拦
（`:37` 注释：这是在往外递联系方式）。③ 去重键：已知 ID 用号码本身、形态命中用 `pattern:<号码>`（`:41`）。
④ 排序按 index 升序。⑤ **不拦普通数字**（年份/播放量/楼层/BV 号数字）**与昵称**（`:13`–`:14` 注释，
撞车误伤成本高于收益）——刻意收窄，不是漏做。

**谁在调用它**：唯一生产调用方是 B站 出站工具：`plugins/surfcore/tools/lib/outbound-guard.mjs:20` 导入
`findIdentityLeaks/formatIdentityLeakError`，由它读配置、收集受保护 ID、抛错（exit 9）；
按 `RULES.md:49`，覆盖评论/私信/动态/转发动态四个写操作。
测试：`scripts/test-identity-guard.mjs:18`（纯函数 + 四个写操作的接线断言，`:69` 起用临时目录），
已登记进 `test:audit`。**QQ 群侧没接这个闸**，只靠提示词规则（`RULES.md:49` 明确写了差异）。

#### 边界与失败模式
- **只认精确 ID**：加空格、全角数字、拆成两段都能绕过——它不是完整防泄漏方案，只是「已知 ID 的最后一道」。
- **昵称不拦**：对齐表的 `label` 仍可能被公开，靠提示词约束（`:14`）。
- **数字误伤**：`known-id` 只在传入 `ids` 时生效，控制权在调用方；把「BV 号里的数字」当 id 传进来会误拦正常内容。
- **空文本**：返回空数组（`:26`），调用方不用特判。
- **错误信息本身要脱敏**（`:62`）：错误可能进日志/回给模型，直接拼原始 `value` 会二次泄漏。
- **无 I/O**：不读配置，`ids` 必须由调用方收集；收集漏了等于闸门漏了。

---
## 分享范围（src/share-mode.js，40 行）

**职责一句话**：把「B站 分享用什么形态」在桥接与插件之间收敛成三个值（`off/text/miniapp`），并生成
「【B站】标题 + 链接」的分享文本。

**对外接口**：`CARD_MODES=['off','text','miniapp']`（`:13`）；`normalizeCardMode(share)`（`:24`）→三值之一；
`buildBiliShareText({title,jumpUrl})`（`:36`）→`【B站】<标题>\n<链接>`，标题缺省「B站视频」（`:37`），
链接为空则只有标题行。

**数据结构**：输入是 `biliBridge.share` 对象（`{card?:boolean, cardMode?:string}`），输出是字符串枚举。
旧值映射（`:24`）：`cardMode:'text'`→text、`'link'`（2026-10-23 中间值）→text（`:26`）；
`'off'`→off、`'miniapp'`→miniapp（`:27`）；其他/拼错落到 `card:false→off`，否则 `text`（`:28`）。
即**默认 text**（`:13` 注释：先发「【B站】标题+链接」文本，再发角色短评）。

**算法/规则**：先取 `cardMode` 并 `trim().toLowerCase()`（`:25`）再匹配，**显式 `cardMode` 优先于 `card` 布尔**；
拼错（如 `'mini app'`）不会静默变 off，而是回落 `card` 布尔或默认 text（`:28`）——刻意的「坏值不降级成关闭」。
`buildBiliShareText` 把标题压成单行（`\s+`→空格）并截 120 字（`:32`）；链接不校验原样拼（`:38`），
QQ 会把第二行识别成可点链接（`:35` 注释）。三模式语义（`:8`–`:11`）：`text` 先文本再短评、
`miniapp` 是已下架的小程序卡（opt-in）、`off` 系统不发交给角色写进短评。

**谁在调用它**：桥接经 `src/bili-card.js` 转出：`:21` 再导出、`:22` 自用；实际使用 `:119`（模式收敛）、`:142`（发文本分享）；
`src/bridge.js:74` 导入 `normalizeCardMode`，`:1213` 收敛 `b.share`。
插件：`plugins/surfcore/lib/store.js:25`（`:393` 写回 `cfg.biliBridge.share.cardMode`）、
`plugins/surfcore/lib/automation.js:17`（`:145` 用于自动化）。
测试：`scripts/test-bili-card-ark.mjs:19`（`CARD_MODES` 顺序、全部旧值映射、拼错回落、分享文本、
以及「桥接必须用同一个 `normalizeCardMode`」接线断言 `:166`–`:167`）。

#### 边界与失败模式
- **为什么单独一个文件**：DSH 热重载只重新求值插件目录内文件，`src/` 下**同路径**模块会被 Node ESM 缓存留住
  旧版本；纯逻辑换新路径才能让运行中的插件加载到新代码（`:3`–`:6` 注释，PITFALLS 记了「卡片改成 text 后
  设置页仍报 link」的事故）。**给这个文件改名/合并会让那个事故复现。**
- **`miniapp` 已下架**：点开提示已下架，所以默认不是它（`:10` 注释），只在用户显式 opt-in 时使用。
- **无运行时能力校验**：`normalizeCardMode` 不会因平台不支持 `miniapp` 而回退，能力判断在发送侧（`bili-card.js` 的 sender）。
- **标题截断**：截 120 字（`:32`），长标题丢尾部；含换行的 URL 会把文本结构弄乱（上游应先 `trim`）。
- **`card:true` 的历史包袱**：老配置只有 `card` 布尔，映射到 text（`:28`）；以为还是「小程序卡」的用户会看到行为变化。

---
## 跨模块契约（改一处要一起看的地方）

1. **记忆卡路径只由 `character-persona` 决定**：`activeMemoryPaths()`（`src/character-persona.js:161`）是唯一入口；
   桥接启动时把它固化成常量（`src/bridge.js:143`），插件每次重解析（`plugins/surfcore/lib/memory-card.js:37`）。
   别在桥接里改成每次重算，否则「切角色=停桥接→换指针→启桥接」的假设（`src/bridge.js:138`）会被打破。
2. **桥接只 append inbox、插件独占写卡**（`src/memory-card.js:2024`、`plugins/surfcore/lib/memory-card.js:12`）；
   让桥接也调 `maintainMemoryCard` 会引入读-改-写竞态。
3. **全量卡 append-only**：`archiveDecayedToFull`（`:790`）只追加，回档（`src/character-persona.js:558`）刻意不回退它；
   想让「回档=回到过去」必须同时改两处，并接受丢掉回档后真实记忆的代价。
4. **目的状态一份、载体互斥**：QQ 与桌宠共用 `purpose-outreach.json`，靠 `purpose.carrier` 决定谁执行
   （`plugins/surfcore/lib/pet-purpose.js:9`）；两个载体同时 tick 会重复占 `countToday`。
5. **额度口径唯一**：桥接闸门（`src/bridge.js:7326`/`:10018`/`:10032`）与插件设置页
   （`plugins/surfcore/lib/token-budget.js:614`）都调 `evaluateBudget`；任何「先在本地算个大概」都会造成
   「页面没到、桥接说超了」（`src/token-budget.js:4`）。
6. **计价只在读取时发生**：账本落盘 `buckets` 不是金额（`src/token-ledger.js:22`），改价目表会影响历史
   （除了已写进 `evict` 行的 `cost`）——这是刻意的。
7. **身份有两条出口**：提示词（`admin-identity` + `self-identity`）与出站闸（`identity-guard`）；前者概率约束、
   后者确定性拦截。只加提示词不加闸=漏，只加闸不加提示词=模型反复撞墙。
8. **收尾不是潜水**：`closeGate` 的 blocked 只影响 `qq_close_conversation`（`src/bridge.js:10198`），
   冷却只压三类软唤醒（`src/conversation-closure.js:491`）；把冷却接进「所有唤醒」会让「结束」变成「关掉」。

## 失败模式速查表

| 症状 | 最可能位置 | 先查什么 |
| --- | --- | --- |
| 记忆卡不更新 | `maintainMemoryCard` 未跑 | 插件定时器（`plugins/surfcore/lib/memory-card.js:500`）、inbox 是否在涨 |
| 记忆突然全忘 | `applyDailyDecay` 补跑 | `lastDecayDate` 间隔（`src/memory-card.js:1607`，上限 30 天）× `forgetAfterDays` |
| 切角色后记忆写错人 | 桥接路径固化 | `src/bridge.js:143` 是否在重启后重新求值 |
| B站 看到她不该看的 QQ 记忆 | `includeQqInBili`/`scope` | `src/memory-card.js:1699` 与记录 `scope` |
| 到点不主动说话 | tick 早退 | `lastSkip.reason`（`src/purpose-engine.js:358`）与 tick 顺序 |
| 反复说同一件事 | 去重阈值 | `isDuplicateText` 的 0.55（`:752`）、history 窗口 10（`:1814`） |
| 目的像「群友想玩=她想玩」 | 目标归属 | member 分支是否被误升级（`src/purpose-engine.js:1335`/`:1344`） |
| 收尾工具一直拒绝 | 硬闸 | `awaitingTheirAnswer`（`src/conversation-closure.js:261`）与 `closeGate`（`:511`） |
| 额度显示与桥接不一致 | 单位/口径 | `evaluateBudget` 的 `scopes`（`src/token-budget.js:395`）、`readDailyUsage` 的 `stale` |
| 账本金额偏高 | 重复计费 | `evictionCovered`（`src/token-ledger.js:364`）与 `isLive`（`:527`） |
| 账本金额偏低 | 桶读成 0 | `normalizeUsage` 别名（`src/model-prices.js:213`）与写入端键名 |
| 峰谷算错 | 节假日表 | `CN_HOLIDAYS` 是否覆盖当年（`:75`）、`PRICE_TABLE_VERSION` 是否更新 |
| 管理员改了不生效 | 三份配置漂移 | 合体层 `admin` 是否有显式旧值（`src/admin-identity.js:64`） |
| B站 认不出自己 | 身份文件 | `<stateDir>/self-identity.json` 是否存在/新鲜（`src/self-identity.js:171`） |
| 公开内容带出账号 | 出站闸没接 | `plugins/surfcore/tools/lib/outbound-guard.mjs:20` 是否在写操作前调用 |

## 验证命令

改动任一模块后至少跑 `npm run test:audit`（清单见 `scripts/test-audit.mjs`）。针对性单跑：
记忆卡 `scripts/test-memory-card.mjs` / `test-memory-card-wiring.mjs`；角色包 `test-character-store.mjs`；
目的 `test-purpose-engine.mjs` / `test-purpose-wiring.mjs`；收尾 `test-conversation-closure.mjs` /
`test-closure-wiring.mjs`；额度 `test-token-budget.mjs` / `test-token-budget-service.mjs` /
`test-token-budget-bridge.mjs`；账本/价目 `test-token-usage.mjs`（`npm run test:tokens`）；
身份 `test-admin-identity.mjs` / `test-admin-prompt-wiring.mjs` / `test-self-identity.mjs` /
`test-identity-guard.mjs`；分享 `test-bili-card-ark.mjs`。碰协议/桥接再加 `npm run test:regressions`。

## 延伸阅读

记忆卡：`docs/guides/MEMORY_CARD.md`；目的：`docs/guides/PURPOSE_OUTREACH.md`；
收尾：`docs/guides/CONVERSATION_CLOSURE.md`；身份：`docs/guides/CROSS_PLATFORM_IDENTITY.md`；
额度：`docs/guides/TOKEN_USAGE_CONSOLE.md`；踩坑与复现：`docs/PITFALLS.md`
（记忆卡维护顺序、账本重复计费、ESM 缓存、身份错位）。
