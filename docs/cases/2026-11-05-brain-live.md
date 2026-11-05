# 星图：把 B 项目的「记忆实时脑图 + 7 天回放」搬进 SurfCore（数据源整条换掉）

## 现象

- 需求原话（跨会话交接）：「把 B 项目（`dsh-memory-brain`）独有的能力搬进 SurfCore」共 6 件，第 1 件是记忆检索（已完成，见 `docs/cases/2026-11-05-memory-rag-index.md`），**第 2 件是星图**；本会话的指令是「这一步做完了，做完的话继续进行下一步」。
- 之前的实际行为：SurfCore 里既没有脑图页面，也没有任何「她刚才用到哪条记忆」的实时视图；记忆检索只在唤醒提示词里留下一段文字，事后无法回答「刚才那次注入到底用了哪几条」。
- 影响面：纯新增。唯一的既有行为改动是唤醒提示词组装处多了一次 `onHits` 回调（只读观测，出错不影响注入），以及回放会去读 `state/tool-calls.jsonl` 与 `state/qq-activity.log`（只读）。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 / DSH 版本 | Windows 11 / DSH 0.2.1-rc.5 |
| SurfCore 版本 | v0.8.8（分支 `main`，未提交；`src/bridge.js` 带 skip-worktree 位） |
| 安装方式 | git |
| 对照项目 | `D:\DSH_Dragonfly\tmp\ref-b`（= `y083245/dsh-memory-brain` 工作副本） |
| 其它相关版本 | Node v26.13.0；本地向量服务 `127.0.0.1:8091`（llama.cpp + Qwen3-Embedding-0.6B） |

## 根因

- B 项目的星图由三块组成：`src/brain-feed.js`（事件 → 轨迹 + SSE）、`src/brain-replay.js`（7 天回放）、`public/brain.html`（页面）。
- 三块的**数据源在 SurfCore 里全都不存在**：`brain-feed.js` 依赖 `src/memory-decay.js` 的 FSRS 评分；`brain-replay.js` 依赖 `long-memory/archive`、`people.json`、`recall-shadow`、`persona/*/appraisals`、`life-loop.json`；页面文案讲的是「账本 / 话题块 / 摘要 / 实体 / 日记 / 五路检索 / 自己的生活」。
- 所以这不是「复制三个文件」，而是「保留事件模型与页面形态，把每一格输出换成 SurfCore 真有的东西」。直接把 B 版三个文件放进来会得到一页看着正常、实际全是空扇区的界面——比没有更坏，因为它会让人以为数据是真的。

## 完整逻辑（给用户看的那一遍）

- **链路**：
  - `src/brain-feed.js`（B 版 767 行 → 现 513 行）：事件总线 + 轨迹 + SSE。数据源换成记忆卡全量档（`characters/<角色>/memory/memory-card-full.jsonl`）与人格层；`snapshot()` 由「回调式、可能异步」改成**同步纯函数**（记录数组进、节点数组出）。
  - `src/brain-decay.js`（新，111 行）：用 SurfCore 现有的**清晰度阶梯**（`vivid/clear/fuzzy/trace/forgotten` → R = 1 / 0.75 / 0.5 / 0.25 / 0.05）投影一年曲线；`decayCurveFor()` 逐日复刻 `applyDailyDecay()` 的「每天最多降一档」，`frozenAtDay` = 首个 R < 0.5 的天数。**D 恒为 null** —— FSRS 是移植计划第 3 件，不假装有。
  - `src/brain-replay.js`（B 版 782 行 → 整体重写为 328 行）：7 天回放，三路现场合成 —— 当天的轨迹文件（`state/brain/trace/<YYYY-MM-DD>.jsonl`，经 `filterTraceRecord` 二次过滤）+ 工具调用日志（`tool-calls.jsonl`，call/result 按「工具 + 会话 + 秒」±5 秒配对，与轨迹同工具 ±5 秒去重）+ 活动日志（`qq-activity.log`，`消息已入未读：` → `msg.in`、`成功 N/M 条` → `msg.out`），记忆卡全量档按编号补正文。
  - `src/bridge.js`：import 三处新增；main() 内一块「星图」（开关 / feed / replay / 标签 / 快照 / 20 秒 tick）；控制台 7 条路由；4 处事件挂点；唤醒提示词处收集注入编号。
  - `public/brain.html`（B 版 1812 行 → 1742 行）：UI 与交互不动，术语、数据形状、扇区说明按 SurfCore 改写。
- **机制**：
  - **只在她正在看时才画**：`emit()` 只在 SSE 有连接（`active()`）时才求值 `payload.data` 并做字段白名单 + 脱敏，没人在看就只落一行轨迹。轨迹只写编号和数字（`remember` / `update` / `forget` / `rag.index` / `tool` / `search` / `wake` / `inject`），不写原文。
  - **轨迹白名单**：`filterTraceRecord()` 逐字段过滤，`N_KEYS`/`E_KEYS` 之外一律丢；`msg.in`/`msg.out` 不落轨迹。
  - **图上只出现真实发生过的事**：`msg.in` 挂在 `handleIncoming` 的权限 / 黑名单 / 模式闸门**之后**（被拒会话不上图）；`msg.out` 挂在 `auditAndSend` 的 `lastSendSucceeded()` 之后（发送失败不画）；`wake`/`inject` 挂在 `deliverPromptNow` 里投递**被接受**之后，注入编号来自 `buildWakePromptV2` 里 `recallBlock(..., {onHits})` 回调真正挑中的条目。
  - **降级与容错**：探针（`POST /api/brain/probe`）打的是真实混合检索，2 秒节流；向量服务没开时返回 `semantic:'off'` 且 `source:'keyword'`，页面标黄提示。`snapshot()` 任何一块出错只少那一块；`decayCurve()` 找不到编号回 `null`（路由给 404 `brain.unit-missing`）。
  - **agent 双闸不用自己加**：控制台原有的「无令牌 agent 只放行白名单」与「带 agent token 只放行 CONSOLE_ONLY 白名单」两道关卡天然挡住 `/api/brain/*`，测试里已用带活跃 agent token 的请求验证回 403 `CONSOLE_ONLY`。
- **爆炸半径**：进程数 1（桥接）× 读者数 1（只读 `memory-card-full.jsonl` / `tool-calls.jsonl` / `qq-activity.log`）× 静默 3 = 3 分。不碰密钥、不花钱、不写记忆原文；写盘只有两处 —— `config.json` 的 `brain.enabled`（开关）和 `state/brain/trace/*.jsonl`（轨迹，7 天自动清）。SSE 最多 4 条连接（第 5 条 429），关掉开关会把已连的连接立刻断开。
- **取舍**：
  - 页面**整页沿用 B 版**（1812 行 UI、交互、配色、时间轴都不重写），只改术语与数据形状。重写一页等价的脑图要几百行、且没有测试能覆盖「好不好看」，收益为负。
  - 无来源的扇区（神经图谱 / 生活回路 / 内省）**保留图例并把话说清楚**（「B 项目里这里是……SurfCore 还没有，所以这格不会有光点」），不删扇区也不编造光点。删掉会让「13 个脑区」的语义变样，编造则是这一版最不能犯的错。
  - `brain-feed.js` 的 `tapLtm` / `tapDecay` 包装器（B 项目用来包「对象形状」模块的透明度技巧）**整段删除**：SurfCore 没有那套模块，改为在桥接调用点显式 `brainEmit()`，谁发的、发在哪一行一目了然。
  - 事件类型词表里 `life.*` / `suggest.*` / `persona.nightly` / `rag.distill` **留着不发**：页面遇到陌生类型才不会变空白，将来接线也不用改词表。
- **生效与重启**：**需要重启桥接才生效**（改的是 `src/bridge.js`，控制台路由挂在 `startConsoleServer()` 里）。页面本身每次请求都现读，改文案不需要重启。
- **回滚与残余**：
  - 软回滚：`config.json` 设 `"brain": { "enabled": false }` —— 路由还在、页面还能打开（会显示「已关闭」），但不再记事件、不再落轨迹；也可以直接停页面。
  - 硬回滚：删掉 `src/brain-feed.js`、`src/brain-replay.js`、`src/brain-decay.js`、`public/brain.html`、`scripts/test-brain-*.mjs`（4 个），撤 `package.json` 的 `test:brain`、撤 `scripts/test-audit.mjs` 里 4 行，再手工撤桥接五处（`src/bridge.js` 被 git 设了 **skip-worktree** 位，`git diff`/`git restore` 看不到也不会还原它）：

```
# 1) 删 import（4 行）
import { createBrainFeed, localDay as brainLocalDay } from './brain-feed.js';
import { createBrainReplay } from './brain-replay.js';
import { memoryIndexStats, vectorIndexStats } from './memory-index.js';
# 并把 memory-card.js 那行的 DEFAULT_MEMORY_CARD_CONFIG / readAllFullRecords 撤回去（若没有别的用处）

# 2) 删 main() 里的「星图」整块（BRAIN_CONFIG_FILE … brainTick 与 setInterval）
# 3) 删控制台 7 条路由（GET /brain、/brain.html、/api/brain/events|snapshot|replay|decay-curve、
#    POST /api/brain/probe、GET|POST /api/brain/control）
# 4) 删 4 处事件挂点：handleIncoming 的 msg.in、auditAndSend 的 msg.out、
#    工具日志处的 tool、deliverPromptNow 的 wake/inject
# 5) 撤 buildWakePromptV2 里的 brainHits 收集与 brainLastInject.set(...)
```

  - 残余：`state/brain/trace/*.jsonl`（每天一个文件，7 天自动清）可留可删；`src/memory-recall.js` 的 `onHits` 是个可选参数，留着无副作用。

## 修法

- 新增 5 个文件：`src/brain-decay.js`（111 行）、`scripts/test-brain-feed.mjs`（255 行）、`scripts/test-brain-replay.mjs`（269 行）、`scripts/test-brain-bridge.mjs`（317 行）、`scripts/test-brain-page.mjs`（81 行）。
- 搬入后改造 2 个文件：`src/brain-feed.js`（767 → 513 行）、`src/brain-replay.js`（782 → 328 行，整体重写）；页面 `public/brain.html`（1812 → 1742 行）。
- 改 5 处：`src/bridge.js`（import + 星图块 + 7 路由 + 4 挂点 + 唤醒收集）、`src/memory-recall.js`（`onHits` 回调）、`scripts/audit-bridge-harness.mjs`（注入 `brainFeed`/`brainReplay`/`memoryIndexStats`/`vectorIndexStats`/`brainLocalDay`，并导出 `auditAndSend`）、`scripts/test-audit.mjs`（加 4 条）、`package.json`（`test:brain`）。
- **测试暴露并修掉的 6 个真 bug**（都不是测试写错，是代码真错）：
  1. `firstTime()` 对数字毫秒直接 `Date.parse` → `NaN` → 所有节点 `at = 0` → 「只留最新 2000 条」退化成随机砍。
  2. `toolRegion()` 只匹配前缀，而桥接送的是 MCP 全名（`mcp__snowluma__qq_tts_voice`）→ 看图 / 语音两个扇区永远是空的。改成按 `__` 取尾段再匹配。
  3. 回放去重：轨迹里存的是全名、工具日志里是短名，两边永远不相等 → 每个工具在回放里出现两次。两边都归一化成短名。
  4. 回放重建的 tool 事件脑区写死 `'output'` → 语音、图片都画错格，改成 `regionFor('tool', 短名)`。
  5. SSE 的 `hello` 把 `enabled` 写死 `true` → 关掉星图后页面仍以为在实时。改成如实回报。
  6. `clients` 导出成 Set、控制台却按 `.size` 读（后来导出成函数后按函数调）与 tool 事件 payload 少 `tool` 键（桥接只看 `p.tool` 定脑区，只给 `e.tool` 会全落 output）—— 一个让 `/api/brain/control` 的 GET 直接抛，一个让所有工具事件挤进同一格。
- **活体验证又抓出四处「能跑但画错」**（自动化没覆盖到的，因为夹具只断言了路由与形状，没断言载荷能被页面读懂）：
  7. `rag.index` 在重启后第一拍读到正在重建的半个索引（2 条）→ 被当成「刚索引了 106 条」。改成一拍不算数：只有**连着两拍条数一样**才认基线。
  8. `rag.index` 载荷只有 `n:{total,items}`，页面读的是 `d.added` / `d.total` → 永远显示「新增 0，共 ?」。补 `data:{added,total}`。
  9. `search` 把 `items` 发成**条数**（`items: items.length`），页面按数组读 → 永远「→ 0 段」且不画粒子。改成发 `items:[{node,title,summary}]` 与 `ranked:[{node,sources}]`，条数留在 `n.items`。
  10. `tool` 事件在 **`tool/call`** 就发 —— 那一刻还不知道成败，页面按 `d.ok` 只能猜「成功」，失败的工具会被画成一件成功的事。改成 call 时只把参数存进 `brainToolArgs`（`${sessionId}:${callId}`），到 `tool/result` 才连同 `ok` / `status` / 参数一起发一次。
  11. `msg.in` 不带说话人（`name: ''`）→ 事件条看不出是谁在说话。按群名片 → 群昵称 → QQ 号退，私聊统一写「私聊」。
  12. 页面 `WAKE_REASON` 只有 `message/timer/other` 三个值，而桥接真实发的是 `anyMessage / atMention / nameMention / private / question / probability` + `timeout / replyCheck / proactiveCheck / bootstrap / admin / history / backlog` + `purpose / dsh-ready / boot` → 事件条和回放里会直接露出英文内部代号。补齐成 17 项中文表，表里没有的值显示原值。
- `brainToolArgs` 的生命周期跟 `toolCallNames` 对齐：会话退役、状态清空时一并清掉，否则一次没等到结果的调用（回合被打断、桥接重启）会留下孤儿参数。
- **测试自己也踩过一个坑**：`test-brain-bridge.mjs` 最初把「发送失败」打成 `h.api.sendPrivateMsg` 失败，但桥接走的是注入的 `bot.sendPrivateMessage` —— 不报错的假绿。改成打 `h.bot.sendPrivateMessage` 抛错。
- 页面侧一处契约修正：探针面板原本要求先选「在哪个会话里查」，但 SurfCore 的记忆卡**不按会话切**，后端根本不读这个字段。删掉这个下拉框（留着就是骗人），关键词输入框则真的并进查询串（`{query, keywords}`）。

## 验证

- 自动化：
  - `node scripts/test-brain-feed.mjs` → **13 个用例全过**（脑区归类 / 轨迹白名单 / 无人在看不求值 / 快照字段与截断 / 衰减曲线阶梯与豁免 / 无来源事件不影响）。
  - `node scripts/test-brain-replay.mjs` → **11 个用例全过**（7 天窗口、三路合成顺序与去重、±5 秒配对、args 白名单、令牌二次脱敏、会话过滤、notes 三条限制）。
  - `node scripts/test-brain-bridge.mjs` → **10 个用例全过**（起真实控制台夹具：页面 200、快照/曲线/回放/探针形状、`brain.bad-day`、`brain.unit-missing`、探针 2 秒 429、开关落盘只合并 `brain.enabled`、鉴权与 `CONSOLE_ONLY` 403、SSE hello/推送/关掉即断/第 5 条 429、被拒会话与发失败都上不了图、索引重建的中间条数不会被报成「刚索引了 N 条」）。
  - `node scripts/test-brain-page.mjs` → **全过**（页面内联脚本可编译；不引外部资源、不用 `innerHTML`/`eval`；**页面调用的每个 `/api/brain/*` 都在 `src/bridge.js` 里存在**；正文里不再出现账本 / 话题块 / 五路 / own-life / memory-rag / FSRS-5 这些 B 项目词；页面认识的 kind 与 `brain-feed.js` 发的一一对应）。
  - `scripts/test-brain-page.mjs` 新增两段静态契约检查（活体验证之后补的）：
    - **事件载荷**：从 `src/bridge.js` 里按类型抓出 `brainEmit('<type>'…)` 那段代码（往前带 1600 字符，因为 `search` 的字段先攒成 `dataset` 字面量），逐字段断言页面要读的键真的出现在里面（`rag.index:added,total` / `search:query,items,ms,source` / `tool:name,ok` / `wake:reason` / `inject:ltm,chars` / `remember:node,text` / `msg.in:name,text` / `msg.out:name,text`）。用词边界而不是 `includes`，否则 `token` 会命中 `tool`。
    - **唤醒原因**：断言页面的 `WAKE_REASON` 覆盖桥接会发的 14 个值（`anyMessage` … `purpose`），漏一个就会在界面上露出英文代号。
  - `npm run test:audit` → **148/149**（本件新增 4 条全绿；唯一失败仍是既有的 `scripts/test-media-search.mjs:182` `fetchMediaData` media summary，与本件无关，改前就是红的）。
  - `npm run test:regressions` → **17/17 全部通过**。
- 活体（重启之后，PID 38648 → 43016 → 36408）：
  - `GET /brain` → 200 `text/html`，115995 字节。
  - `GET /api/brain/control` → `{ok:true,enabled:true,clients:0}`。
  - `GET /api/brain/snapshot` → 109 个节点（108 记忆卡 + 1 人格层）、2 个会话键、`truncated` 全 0；**`at=0` 的节点 0 个**（时间戳那个 bug 在真实数据上确认修好）；按 `key` 过滤后 46 个节点且全部同键。
  - `GET /api/brain/replay?day=<今天>` → 103 条事件（工具 26 + 活动日志 77 + 轨迹 0，今天还没写过轨迹）。
  - `POST /api/brain/probe` → hybrid、8 条命中、`routes {bm25:8,vector:8}`；2 秒内第二次 → 429。
  - `GET /api/brain/decay-curve` → `shape:'clarity-ladder'`、366 个点、一条清晰条目 `S=44`、一条模糊条目 `S=7`。
  - SSE：连上先收 `retry: 3000` + `hello`，探针推下 `search` 事件，且**载荷里 `items` 确实是 8 元素数组**（第 9 条修好后的现场确认）。
- 没验证到的部分：
  - 页面的**视觉/交互**没有自动化覆盖（无头浏览器没接进审计）：只做了静态契约检查 + 活体 `GET /brain` 返回 200。
  - **真实聊天触发**没在活体上走过一遍：`msg.in` / `msg.out` / `wake` / `inject` / `tool` 这几个挂点目前只有夹具覆盖，要等下一次真的有人跟她说话才能在页面上看到。
  - 活体验证本身又暴露了 6 处载荷问题（上面第 7–12 条）——这说明**「载荷能不能被页面读懂」是夹具测不到的一类**，已经补进 `test-brain-page.mjs` 的静态契约检查（见下）。

## 遗留 / 后续

- `state/qq-activity.log` 只留 500 行、正文截 80 字，且**只有走 `/api/send` 的那条发送路径带正文**（工具统一发送的那条不带）——回放里的 `msg.out` 因此可能只有计数没有内容。这是数据源本身的边界，已写进回放的 `notes` 在界面上如实提示。
- 轨迹清理目前是「每天首次 tick」触发，若桥接跨天不重启、且一直没人开页面（`brainTick` 只在有连接时才有意义？——不，tick 是常驻定时器，与页面无关），清理照常。
- 无来源的三个扇区（神经图谱 / 生活回路 / 内省）等移植计划的后续件；FSRS 是第 3 件，接上之后 `brain-decay.js` 的 `D` 才会从 `null` 变成真值（**2026-11-06 已接上，见文末更新**）。
- 后续 4 件（FSRS 分 / 建议候选 / 约定提醒 / 唤醒前联想注入）未开工（**其中约定提醒 2026-11-05 完成、FSRS 2026-11-06 完成；剩建议候选与联想注入**）。

## 交接块

```
改了哪些文件：新增 src/brain-decay.js（111 行）、scripts/test-brain-feed.mjs（255）、
  scripts/test-brain-replay.mjs（269）、scripts/test-brain-bridge.mjs（317）、
  scripts/test-brain-page.mjs（81）；搬入并改造 src/brain-feed.js（767→513）、
  src/brain-replay.js（782→328，整体重写）、public/brain.html（1812→1742）；
  src/bridge.js（import + 星图块 + 7 路由 + 4 处事件挂点 + 唤醒注入编号收集）；
  src/memory-recall.js（recallBlock 加可选 onHits）；scripts/audit-bridge-harness.mjs
  （注入 brainFeed/brainReplay/memoryIndexStats/vectorIndexStats/brainLocalDay、导出 auditAndSend）；
  scripts/test-audit.mjs 加 4 条；package.json 加 test:brain（未改 version）。
测过什么：test-brain-feed 13/13；test-brain-replay 11/11；test-brain-bridge 10/10；
  test-brain-page 全过（含「载荷字段」与「唤醒原因」两段静态契约）；npm run test:audit 148/149
  （当时唯一失败是 media summary 用例 —— 事后查清**不是既有的**：工作区本地补丁
  `stickerTextOnly` 让表情默认不走下载分支，与仓库用例冲突，HEAD 副本跑同一测试 15/15 全过；
  已在 2026-11-05 18:5x 按「补元数据 + 分开两条用例」修好，audit 转 149/149）；npm run test:regressions 17/17；重启后活体逐接口验
  （页面 200、快照 109 节点且 at=0 的为 0、回放 103 条、探针 hybrid 8 命中且 SSE 载荷里 items
  真是数组、衰减曲线 366 点、2 秒节流 429）。修掉 12 个真 bug：前 6 个由测试暴露（时间戳 NaN、
  MCP 全名脑区归类、回放去重、回放脑区写死、SSE hello 谎报、clients 形状 + tool payload 缺 key），
  后 6 个由活体验证暴露（rag.index 误报与缺 added/total、search 把数组发成条数、tool 事件在调用
  时就发、msg.in 不带说话人、页面 WAKE_REASON 只认 3 个值）。
建议：minor（纯新增能力，有开关，默认开）。
case 文档：docs/cases/2026-11-05-brain-live.md
改动层级：实现层新增 + 控制台 7 条路由 + 唤醒提示词观测回调；模型工具层未动。
失败路径：config.brain.enabled=false → 不记事件、断开已有连接；向量服务挂 → 探针降级关键词
  并标 semantic:'off'；找不到条目编号 → 404 brain.unit-missing；页面调了不存在的路由 →
  test-brain-page 直接红。
还没验证：重启后的活体打开与真实聊天触发（重启才生效）。桥接改动在 git 里不可见
  （skip-worktree），回滚需手工撤五处，块见本文件「回滚与残余」。
```

## 2026-11-06 更新：第 3 件接上，衰减曲线换成真的 R/S/D

本文第 108 行记的 `shape:'clarity-ladder'`、`D:null` 是当时的正确形状，**现在已经变了**：

- `src/memory-strength.js`（新，271 行纯函数）提供 FSRS 形状的强度分：`S` 稳固度（天）、
  `D` 难度（1~10）、`R` 可提取性，曲线 `R = (1 + 19/81·t/S)^(-0.5)`（`R(t=S)=0.9`）。
  卡面清晰度只当 R 的**上界**，不再自己当曲线。
- `decayCurveFor()` 出 `shape:'fsrs-strength'`；`S` 变成稳固度、`D` 变成真难度、
  「第几天跌破冻结线」搬到 `frozenAtDay`，另给 `dueInDays` / `daysToFreeze` / `assumedSpread`。
- 页面时间推演改成三块瓦片（R / S / D）；节点 `decay` 带 `label`。
- 完整说明、验证与残余见 [记忆强度分](2026-11-06-memory-strength.md)。
- 注意：`S` 的语义变了，**页面与桥接必须同版本**（已写进 `docs/PITFALLS.md`）。
