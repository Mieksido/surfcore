# 跨平台自我识别与来源判断（QQ ⇄ B站，可扩展到贴吧）

> 2026-10-23 用户实测后提出。本文回答四件事：**为什么会认错、现在怎么处理、以后接新平台怎么照做、怎么验收**。
> 相关代码：`src/self-identity.js`（唯一权威）、`src/forward.js`、`src/bridge.js`、`plugins/surfcore/lib/scheduler.js`。

---

## 0. 一句话

同一个人跨平台活动，模型要同时搞清三件不同的事：

| 问题 | 本质 | 谁负责 |
| --- | --- | --- |
| **来源**：这条内容属于哪个平台？ | 元数据（载体） | 工具返回字段 + 每轮提示词规则 |
| **自我**：这是我自己的东西吗？ | 身份锚点（昵称 / ID / 主页 / 人格名） | `src/self-identity.js` 生成的自我卡 |
| **他人**：这个人是谁？ | 账号映射 | 身份对齐表（`alignments.json` + 待审候选） |

三者混在一起就会出现「把 QQ 聊天记录说成 B站 评论」这类错误。

---

## 1. 已发生的两件事（问题 → 根因 → 处置）

### 1.1 群里转发她在别的群的聊天记录，她说成「这是 wo 在B站说过的话」

- **现象**：`state/social-v2.json` 里她的原话：「诶？这是 wo 在B站说过的话呀 / 弥叭连评论都翻出来了 mer」。
- **根因**：合并转发的工具返回里**只有内容，没有平台**；而 B站 记忆简报里恰好有她自己的公开评论，
  模型只能按"内容像不像"去猜，于是把 QQ 聊天记录归档到了 B站。
- **处置（双保险）**：
  1. `formatForwardResponse()` 现在固定返回 `platform: 'QQ'`、`source: 'forwarded-chat-record'` 和一条
     `notice`（"这是从 QQ 聊天里合并转发过来的聊天记录（不是 B站 动态/评论，也不是刚发来的新消息）…"）；
     `qq_get_forward_msg` 的工具描述同步写明。模型最先读到的就是这份 JSON。
  2. 每次唤醒提示（`buildWakePromptV2`）都带一段【来源判断】：合并转发 = QQ 聊天内容；
     QQ 里的图片/截图也算 QQ 内容；不要把聊天记录说成「我在 B站 说过的话」，反之亦然。
- **验证**：`scripts/test-forward.mjs`（平台字段 / notice）+ `scripts/test-self-identity.mjs`（来源规则文案）。

### 1.2 看到自己的 B站 主页图能不能认出自己

- **QQ 侧：能，别过度设计。** B站 记忆简报（`src/bili-memory.js` 的 `buildBrief`）已经给了
  昵称 + mid + `space.bilibili.com` 主页，并写了「截图里出现这个昵称/主页就是你自己」。
  2026-10-23 用户确认：**自己主页能认，别的鱼的主页也不会认成自己**。
- **B站 侧：以前根本不可能。** 那一侧的提示词里只有 B站 账号和人格名，没有任何 QQ 侧信息
  （人设卡里的 QQ 号还被 `sanitizePersonaForBili` 主动抹掉），所以别人递来她的 QQ 资料卡截图，
  她只能当陌生人。
- **处置**：B站 唤醒的固定上下文里新增自我卡（`scheduler.js` 的 `selfIdentityBlockForBili()`）：
  - B站 昵称 / UID / 主页 / 人格名 ← `bili.config.json` 的 `self`、`persona`；
  - QQ 昵称 / **打码的 QQ 号**（`328****288`）← 桥接登录时落的 `state/self-identity.json`；
  - 规则：QQ 资料卡/主页截图里出现这些标识就是你自己；公开内容里不许写出完整 QQ 号/群号。

---

## 2. 策略：以后接新平台照这四条做

### 2.1 自我卡唯一（Single source of truth）

`src/self-identity.js` 是唯一实现，两侧（QQ 桥接、B站 生物钟）都调它，**不要在任何地方手拼身份句**。
新平台接入时只做两件事：给 `normalizeSelfCard()` 加字段（如 `tiebaName` / `tiebaUid`），
在 `buildSelfIdentityBlock()` 里加一行锚点；两侧自动同时生效。

锚点四件套（缺一不可）：

1. **昵称**（各平台可以不同，但都要给）；
2. **稳定 ID**（QQ 号 / B站 UID / 贴吧 uid）——昵称会变、会撞，ID 不会（见 PITFALLS #13）；
3. **主页/资料页地址**（截图里常出现）；
4. **人格名**（让人知道两边是同一副人格，不是两个角色）。

### 2.2 来源由载体决定，不靠内容相似度

任何进入模型的内容都必须能回答「这是哪个平台的」：

| 载体 | 平台 | 带标签的位置 |
| --- | --- | --- |
| QQ 普通消息 / 引用 | QQ | 唤醒提示的发送者行（昵称 + QQ 号） |
| QQ 合并转发 | QQ | 工具返回 `platform/source/notice` + 提示词【来源判断】 |
| QQ 图片 / 截图 | QQ | 同上（规则明确"图片也是 QQ 内容"） |
| B站 链接 / 卡片 | B站 | 链接本身 + 记忆简报 |
| B站 工具（comment/dm/dynamic…） | B站 | 工具的返回值 |
| 对齐表 / 记忆卡 | 对应平台 | 记录里的 `platform` 字段 |

**不要**写「如果内容看起来像你的B站评论」这种按内容猜的规则 —— 内容天然会撞（她两边都说过类似的话）。

### 2.3 标签与规则双写

- **标签**写进工具返回（模型第一眼看到的数据）；
- **规则**写进每轮提示词（模型想不起来时兜底）。

只写标签：模型可能忽略字段；只写规则：模型可能根本没看到那段话。两边都写才稳。

### 2.4 隐私分级

| 场景 | 给什么 |
| --- | --- |
| QQ 侧 → 自己 | 完整 QQ 号 + B站 mid（mid 本来就是公开的） |
| B站 侧 → 自己 | B站 昵称/UID + QQ 昵称 + **打码** QQ 号（`328****288`），并禁止写进公开内容 |
| 任何公开输出（评论/动态/私信） | 不写完整 QQ 号、QQ 群号、别人的联系方式 |

打码的实现是 `maskQqUin()`；它有测试钉住（`test-self-identity.mjs`）。

### 2.5 只准自己互认：公开面硬闸（2026-10-23 用户追加）

互认信息只能用来认人，**不能外传**。光靠提示词不够（模型会被绕、会忘），所以 B站 写操作前加了一层确定性闸：

- **受保护 ID**：主人 QQ / 主人 B站 mid（合体层 `admin` + `bili.config.json` 的 `owner.mid`）、
  `alignments.json` 里每个人的各平台 id、任何「QQ / 群号 + 数字」形态；
- **不拦**：她自己的 B站 mid（公开资料）、昵称（会撞、误伤成本高）、普通数字（年份/播放量/楼层）；
- **覆盖**：`comment.mjs`（评论）、`dm.mjs`（私信）、`dynamic.mjs`（动态）、`share-dynamic.mjs`（转发动态）；
  命中就**不发**（exit 9），错误信息里的号码也打码（`328****288`）；
- **边界**：QQ 群里的回复**没有**加这层硬闸 —— 群成员本来就看得到彼此的 QQ 号，硬拦会误伤正常回话；
  QQ 侧靠提示词规则（【只用于自己】）约束。要加的话得先定一套更窄的规则（例如只拦主人的 B站 mid）。

实现：`src/identity-guard.js`（纯函数）+ `plugins/surfcore/tools/lib/outbound-guard.mjs`（读配置、收集 ID、抛错）。

---

## 3. 代码地图

| 位置 | 作用 |
| --- | --- |
| `src/self-identity.js` | `normalizeSelfCard` / `buildSelfIdentityBlock(card,{platform})` / `buildProvenanceBlock()` / `maskQqUin()` / `readQqSelfIdentity()` / `selfIdentityPath()` |
| `src/bridge.js` | `saveQqSelfIdentity()`（登录时写 `state/self-identity.json`）、`buildWakePromptV2()`（身份 + 来源规则）、B站记忆关闭时用自我卡兜底 |
| `src/forward.js` | `formatForwardResponse()` 增加 `platform` / `source` / `notice` |
| `src/mcp-snowluma-safe.js` | `qq_get_forward_msg` 工具描述写明「这是 QQ 聊天记录」 |
| `plugins/surfcore/lib/scheduler.js` | `selfIdentityBlockForBili()` → `identityContextLines()`（B站 每轮唤醒第一条上下文） |
| `src/identity-guard.js` | 出站身份闸纯函数：已知 ID 精确命中 + 「QQ/群号+数字」形态；不拦普通数字与昵称 |
| `plugins/surfcore/tools/lib/outbound-guard.mjs` | 读主人/对齐表 → 受保护 ID → 接到评论/私信/动态/分享发送前（命中即不发） |
| `plugins/surfcore/lib/bili-memory.js` | `briefBlock()`（QQ 侧 B站 锚点）与 `selfInfo()`（B站 昵称/mid） |
| `state/self-identity.json` | 桥接落的 QQ 侧自我身份（`{nickname,userId,updatedAt}`，不含任何聊天内容） |

---

## 4. 验收用例（黑盒，改完必须走一遍）

| # | 操作 | 期望 |
| --- | --- | --- |
| 1 | QQ 群里转发「她在别的群的聊天记录」 | 认得出可能是自己说过的话，但明确按 **QQ 聊天记录** 对待；不说「我在B站说过」 |
| 2 | QQ 群发她自己的 B站 主页截图 | 认成自己（已确认 OK） |
| 3 | QQ 群发别的鱼的主页截图 | 不认成自己（已确认 OK） |
| 4 | B站 侧（生物钟唤醒/私信）收到自己的 QQ 资料卡截图或描述 | 认成自己，且不把完整 QQ 号写进公开内容 |
| 5 | 关掉 `biliBridge.memory.enabled` 后再发她的 B站 主页图 | 仍认得（桥接用自我卡兜底，不依赖记忆简报） |

> 用例 4 的"收到图片"取决于 B站 侧有没有图片输入通道；没有图片时，至少文字描述里的昵称/号码要对得上。

---

## 5. 已知边界

- 视觉识别仍然是**模型判断**，不是 OCR 白名单：锚点给全 + 规则写清能把错误率压下来，但不能保证 100%。
- B站 侧没有取图能力时，只能靠文字（昵称/UID/号码）对齐。
- 关闭 B站 记忆同步时，B站 的「经历」不会再进 QQ 提示词；只剩自我锚点（这是刻意的隐私默认）。
- 打码的 QQ 号不能用于"精确反查"；需要认领某个号时，问一句比猜更可靠。
