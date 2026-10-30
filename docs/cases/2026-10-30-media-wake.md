# 群里发图片不回复（纯图片消息永远不触发 reserved2 唤醒）

## 现象

- 用户原话：**surfcore的qqbot，我在群里发图片不回复我**。
- 复现（2026-10-30 本机实测，`state/qq-activity.log`）：
  `11:27:26 / 11:28:55 / 11:29:23 group:100000001 [reserved2] 消息已入未读：[图片]`，
  三条之后没有任何唤醒/发送记录；`state/social-v2.json` 里 `unread` 堆着 seq 5/6/7，
  `lastReadThroughSeq=4`，`lastWakeReason=proactiveCheck`。
- 影响面：**只影响「潜水（diving）状态下的纯媒体消息」**。私聊、被 @、引用机器人、
  带关键词/提问的图文消息都照常唤醒；群友的表情包同样不唤醒（本来就不该醒）。
  不丢消息（仍在未读里，下次被别的条件唤醒时能看到），不花钱、不动密钥。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 / DSH 版本 | Windows 11 / DSH 0.2.1-rc.2 |
| SurfCore 版本 | 0.7.8（commit aa683d9） |
| 安装方式 | 本机 `<repo>`（开发树） |
| 其它 | 模式 `reserved2`；`socialV2.wake.recommendedProbability=0.05`；SnowLuma 1.14.x 在线 |

## 根因

- 代码位置：`src/bridge.js`
  - `evaluateWakeTriggerV2()`（修前 12484 行）——reserved2 唯一的唤醒判定；
  - `handleIncoming()` 的 reserved2 分支（修前 13903 行）——唯一调用点；
  - `segmentsToText()`：`image` 段只转成字符串 `[图片]`（1529 行附近）。
- 问题链条：
  1. 纯图片消息 `message=[{type:'image'}]`；`segmentsToText()` → `plainContent='[图片]'`，
     所以不会被 `if (!plainContent && !quoteTargetIsSelf) return` 丢掉，**能进未读**；
  2. 但 `evaluateWakeTriggerV2()` 的每个触发条件都读文字：
     `atMention`（要 `at` 段）、`nameMention`（要昵称字符串）、`keywords`、`question`、
     `speakerIds`（配置为空）——`[图片]` 一条都不命中；
  3. 最后只剩 `probability`（默认 0.05）：每次发图都是掷一次 5% 的骰子，
     连发三张全不中的概率 85.7% —— 用户实感就是「永远不回」；
  4. 媒体内容（`mediaList`）在 `handleIncoming` 里其实**已经提取好了**（入未读、存
     `messageMediaStore`、给模型 `qq_get_message_images` 用），只是没参与唤醒判定。
- 为什么之前没发现：所有唤醒相关测试（`test-token-economy`、`test-history-catchup` 等）
  用的都是文字消息；图片链路的测试（`test-media-search`、`test-vision-media`）只测
  「拿到图之后怎么读/怎么发」，没有一条覆盖「纯图片能不能把人叫醒」。开发机自测也都是
  @ 或带字提问。

## 完整逻辑（给用户看的那一遍）

- **链路**：SnowLuma 收到 QQ 群消息 → WebSocket → `src/bridge.js` `handleIncoming()` →
  `extractMediaFromSegments()` 得到 `mediaList` → `appendSocialV2Message()` 入未读 →
  `evaluateWakeTriggerV2()` 决定醒不醒 → `scheduleWakeV2()`（合并窗口，默认 8 秒）→
  `sendWakePromptV2()` 把「唤醒提示词 + 未读快照」投给 DSH 里这个会话的 agent →
  agent 调 `qq_get_message_images` 看图 → 调 `qq_send_message` 回复。
  读 `state/social-v2.json` 的还有：控制台状态页、`qq_get_prompt`、上线补历史、
  主动机会/收尾判断——所以新增的只是"唤醒判定"这一跳，读写契约没变。
- **机制**：reserved2 是「潜水 + 条件唤醒」模型：agent 睡下后由桥接按
  `wakeConfig.triggers` 判断要不要叫醒（每个回合都是一次真实付费的 LLM 调用）。
  触发条件严格按**文字**设计（@、名字、关键词、提问、指定成员、概率），
  纯媒体消息在这套判定里天然是「无语义」，于是掉进概率通道。
  这不是某一行写错，而是**触发条件集合缺了一类输入**：用户把图片当"说话"，
  判定层没有"媒体也算一次发言"的概念。
- **爆炸半径**：1 个进程（bridge 主循环）× 读者：`evaluateWakeTriggerV2` 只有 1 个调用点，
  `hasVisualMedia/normalizeMediaWakeMode` 是新私有函数，不导出、不改协议、不改
  `state/*.json` 结构、不新增必填配置（缺省 = owner）。静默失败=3 分 × 1 读者 = 3 分；
  唯一的"花钱"面是**唤醒次数**：默认只对 ownerQQ/admin 的图生效，群友表情包不醒，
  加上原有 `tokenGuard`（每日唤醒上限/最小间隔）仍在生效 → 成本可控。
- **取舍**：
  - A. 改 `wakeConfig.triggers` 加 `media:true`（模型每次 `qq_set_wake_config` 都要记得开，
    旧状态没有这个键、升级后老会话也不会自动开 → 对"用户已经遇到问题"的场景无效）✗；
  - B. `mediaWake` 做成 **config 级规则**（`socialV2.wake.mediaWake`，缺省 owner）：
    不动 per-会话状态、升级即生效、模型不用理解新 trigger 键，且留 off 回退 ✓（本方案）；
  - C. 任何图片都唤醒（`any` 默认）：群里斗图会持续烧 token，体验更像"复读机" ✗ 设为可选项。
- **生效与重启**：`config.json` 与 `src/bridge.js` 都只在桥接进程启动时读 →
  改完必须**重启桥接**（`start.bat`/本机 launch 的进程，见 `docs/guides/12-LESSONS-ARCHITECTURE.md` §8）。
  DSH/插件进程不用动。

## 修法

- 改了什么：
  1. `src/bridge.js` `evaluateWakeTriggerV2()`（12503–12545 行）新增第 8 个参数
     `context={mediaList,isOwner,isAdmin}`；在 `speakerIds` 之后、`probability` **之前**插入媒体分支：
     `image`/`mface` 段 → `mediaWake='any'` 任何人醒；`'owner'` 且 ownerQQ/admin → 唤醒，原因 `media`；
  2. 新私有函数 `normalizeMediaWakeMode()`（12490）收敛配置值（any/all、off/none/false/0、其余 owner）；
     `hasVisualMedia()`（12499）只认 `image`/`sticker`，QQ 小黄脸（face）不唤醒——没有可看的画面；
  3. `handleIncoming()`（13739）新增 `isAdminSender`：`admin.qq` 与 `ownerQQ` 不同号时，
     管理员的图也算"自己人"；
  4. `buildWakePromptV2()`（12846）新增 `media` 原因专用提示词：明确告诉模型
     "这条没有文字、要看图就调 `qq_get_message_images`（key/messageId）"，
     避免它对着 `[图片]` 编内容或装死；
     并在【当前唤醒】行（12806）写明 `图片/表情(主人)` / `(所有人)`，让她知道自己怎么被叫醒的；
  5. `WAKE_PRIORITY.media=45`（13101）：合并窗口里若同时来了图片和「概率唤醒」的闲聊，
     升级成 media 而不是被降级；低于 at/名字/关键词/提问。
- 为什么不用更简单的：最简单是「把 probability 调大」，但那会让所有消息都变吵（包括群友闲聊），
  且治不了"纯图片永远不醒"的确定性；`speakerIds` 配置能临时绕过，但它只在 agent 自己
  设置过的会话里生效，重启/新群就没了，还会让主人每句话都唤醒（含文字）。
- 回滚方式：
  - 最快：`config.json` → `socialV2.wake.mediaWake: "off"`，重启桥接（代码不用动）；
  - 彻底：`git revert` 本次提交。

## 验证

- 自动化：`node scripts/test-media-wake.mjs`（新增，已挂进 `test:audit`；下午扩到 **20 条**），
  初版覆盖：主人纯图片→`media`（bug 复现锚点）、群友图片默认不醒、mface 表情醒 / face 不醒、
  图文消息仍是 `atMention`（文字原因优先）、纯文字旧行为不变、`any`/`off`/坏值收敛、
  admin.qq 不同号、media 提示词含看图工具与 messageId、【当前唤醒】文案、私聊仍 `private`。
  修前跑同样夹具：`主人 纯图片 => pendingWake: false | reason: (none)`；
  修后：`pendingWake: true | reason: media`。
- 失败路径（用户看到什么 / 下一步）：纯图片不再静默——要么唤醒回复，要么 agent 判断后
  `qq_mark_read`/收尾；`mediaWake` 写错值按**概率模式**处理（不会变成"所有图都必醒"）。
  失败分支断言见 `test-media-wake.mjs` 的「坏值收敛」用例。
- 手工/集成验证：**真机端到端已通过**（见下方「验证记录」，证据来自线上 `state/` 日志）。
- 没验证到的部分：`test:audit` 里 6 个失败（`test-audit-setup`、`test-qq-model-view`、
  `test-bili-state-paths`、`test-preset-local-tools`、`test-update-*`）全部是
  `spawn EPERM`——本会话沙箱禁止再 spawn 子进程，与本次改动无关（失败点在 spawn，未进入被测代码）。

## 验证记录

```
# 夹具（VM，不连真 QQ）：修前
owner 纯图片 => unread: 1 | pendingWake: false | reason: (none)
# 修后
owner 纯图片 => unread: 1 | pendingWake: true | reason: media
群友 纯图片 => unread: 1 | pendingWake: false | reason: (none)
owner 图片+@机器人 => pendingWake: true | reason: atMention

# 真机（2026-10-30 11:48:50 桥接已带新代码重启；用户在新群里真发了一张图）：
# state/bridge.log
11:50:41 [reserved2] 会话繁忙，暂存唤醒原因 group:100000002（media@seq2，原因=pendingWakeKey）
11:51:04 [reserved2] 工具统一发送 group:100000002: 成功 1/1 条
# state/tool-calls.jsonl（ISO UTC）
03:50:55Z qq_get_message_images {"key":"group:100000002","messageId":"-123456789"} → ok
03:51:03Z qq_send_message {"messages":"行，探头探脑的，这招呼打得比打字高级多了"} → ok
```

即：纯图片 → 原因 `media` 唤醒 → 模型主动调 `qq_get_message_images` 看图 → 回了一句与图相关的话。
修前同一场景（11:27/11:28/11:29/11:46 的 `[图片]`）只有「消息已入未读」，没有任何后续。

## 遗留 / 后续

- 真机端到端：**已通过**（见上）。用户原群 `100000001` 在修复前的 3 张旧图仍留在未读里，
  下次该群被任何条件唤醒时会一并在快照里看到；不需要为它们单独补唤醒。
- 设置页还没暴露 `socialV2.wake.mediaWake`（本轮只做 config.json + 默认值）；
  要进 UI 需同步 `console-ui-contracts.json` 与 `test-console-*` 契约，另开一批做。
- 「主人纯文字（无 @/关键词）也不唤醒」是既有设计（概率 5%），本轮**没有**改；
  如果用户希望"主人在群里说什么都回"，那是另一个开关（例如 owner 消息直通），要单独评估 token 成本。

## 2026-10-30 下午调整（用户要求）：媒体唤醒改成概率 0.1、群友也参与

**用户原话**：「图片表情唤醒能改成概率唤醒吗 0.1 概率，然后群友发图也唤醒」。

**改法**：
1. `mediaWake` 新增/改为 `probability` 模式（**现在也是缺省值**）：
   - `probability`：**所有人（含主人）**的图片/表情按 `mediaWakeProbability`（0.1）概率唤醒；
   - `owner`：主人/管理员必醒，群友按比例（折中方案，保留）；
   - `any`：任何人必醒；`off`：关闭（回到旧行为 → 走普通消息 5% 概率）。
   概率没中时**直接结束，不再落回普通消息概率**——否则 `0.1` 实际会变成
   `10% + 90%×5% ≈ 14.5%`，用户设的数字不可预测（有单测钉住这条）。
2. 实际配置（用户机器 `config.json`）：
   `socialV2.wake.mediaWake: "probability"`、`mediaWakeProbability: 0.1`。

**验证**：`scripts/test-media-wake.mjs` 扩到 **20 条**（probability p=0/1、可预测不双摇、
owner 折中、any/off、坏值收敛、图文仍走 atMention、管理员必醒、默认文案"概率10%"）；
`node scripts/build-agent-preset-patches.mjs --check` 通过；桥接重启后
`qq_get_prompt` 的 `recommended` 段实测返回 `mediaWake:"probability"`、`mediaWakeProbability:0.1`。

**注意**：`probability` 模式下**主人自己发图也只推动 10% 概率**（这是用户明确要的）。
如果以后又想"主人发图必醒、群友 10%"，把 `mediaWake` 改回 `"owner"` 即可。
