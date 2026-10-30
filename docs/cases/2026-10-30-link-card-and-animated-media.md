# 动图 / 链接 / 链接卡片：模型看不见，也不按图片概率唤醒

## 现象

- 用户原话：**「动图，链接和链接卡片，也要适配到 bot 能看，回应概率依托之前看图媒体的」**。
- 复现（2026-10-30 本机真实会话）：
  - 12:26 私聊发来一张 QQ 链接卡片 → `state/qq-activity.log` 只记到
    `[12:26:12] private:1000000001 [reserved2] 消息已入未读：[卡片消息]`；
    12:29 模型输出：「主人发了张卡片过来。我这边读到的只有「[卡片消息]」四个字……
    点开看详情，只有发送人和这四个字，没有链接也没有图」。
  - 12:44 群里依次发「动图 / 链接 / 链接卡片」三条测试文本（`state/qq-activity.log` 83–86 行），
    确认桥接的文本层对这三类内容都只有占位符。
  - `state/social-v2.json` 里动图消息（`file: "<hash>.gif"`、`summary: "[动画表情]"`、
    `sub_type: "1"`）能进 `media`，但 `segmentsToText()` 只输出 `[图片]`，
    模型无从知道那是动图、只看到其中一帧。
- 影响面：
  - **链接/卡片**：模型永远看不到标题和 URL → 只能回「我点不开」，等于这条消息白收；
  - **动图**：图片本身能取到（DSH 会做静图归一化），但模型不知道是动图，
    容易描述成"看完了整段动画"或按静图敷衍；
  - **唤醒**：链接/卡片消息没有任何文字触发条件，只掉进普通 5% 概率；
    用户当时已把 `mediaWakeProbability` 调到 0.3，但链接不在媒体判定里，调了也不生效。
  - 不丢消息（仍在未读/最近里），不花钱（只影响是否唤醒）；改动只碰入站解析与唤醒判定。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 / DSH 版本 | Windows 11 / DSH 0.2.1-rc.2（GUI 端口 10936） |
| SurfCore 版本 | 0.7.17 基线 + 本机改动（up-base 分支） |
| 安装方式 | 本机 `<repo>`（开发树，桥接由 start.bat 守护） |
| 其它 | 模式 `reserved2`；`socialV2.wake.mediaWake=probability`、`mediaWakeProbability=0.3`；SnowLuma 在线 |

## 根因

- 代码位置：
  - `src/bridge.js` `segmentsToText()`：`case 'json': out.push('[卡片消息]')`（修前 1601 行）；
  - `src/bridge.js` `extractMediaFromSegments()`：只收 `image` / `mface` / `face`，
    `json` / `xml` 段直接丢掉（修前 1635–1677 行）；
  - `src/bridge.js` `hasVisualMedia()` / `evaluateWakeTriggerV2()`：媒体唤醒只认
    `kind === 'image' || kind === 'sticker'`（修前 12824/12865 行）；
  - `src/bridge.js` `handleIncoming()`：`mediaList` 之外没有任何链接提取；
  - `src/qq-model-view.js`：模型视图里没有 `links` 字段的概念。
- 问题链条：
  1. QQ 分享卡片在 OneBot 里是 `json` 段（`data.data` 是一段卡片 JSON：`meta.news` /
     `meta.detail_1` / `meta.music` / `meta.mini_app_ark` / `meta.ark` 等），
     部分实现给的是 `xml` 段（`<msg brief=...><item><title>…</title><url>…</url>`）；
  2. 桥接的文本渲染对这两种段一律输出 `[卡片消息]`，既没解析标题，也没保留 URL；
  3. 唤醒判定只读文本 + `mediaList`（图片/表情）：卡片消息文本是 `[卡片消息]`、
     不在 `mediaList` 里 → 所有触发条件都不命中，只剩普通 5% 概率；
  4. 动图是 `image` 段（`sub_type=1`、`file=.gif`、`summary=[动画表情]`），
     取图链路能工作，但文本层一律 `[图片]`，模型没有"这是动图、只有一帧"的信息。
- 为什么之前没发现：
  - `test-media-search` 只测「拿到 media 之后怎么取图/字段保真」，没有一条卡片消息用例；
  - `extractMediaFromSegments` 的注释里明确写"图片/表情元数据"，链接不在设计范围内；
  - 开发自测都是 @ 或带文字提问，纯卡片/纯动图这两条路径没被真实用户消息覆盖过。

## 完整逻辑（给用户看的那一遍）

- **链路**：SnowLuma WebSocket → `src/bridge.js` `handleIncoming()`：
  - `segmentsToText()` 生成 `textContent`（现在卡片会变成 `[链接卡片]标题 · 摘要 · URL`）；
  - `extractMediaFromSegments()` 生成 `mediaList`（图片/表情/动图，`animated` 标记）；
  - 新增 `linkItemsFromSegments()`（`src/link-card.js`）生成 `links`（卡片 + 正文 URL）；
  - `appendSocialV2Message()` 把 `media` / `media.animated` / `links` / `hasLinks` 一起写进
    `state/social-v2.json` 的未读与最近消息；
  - `evaluateWakeTriggerV2()` 把「有图片/表情 **或** 有链接」统一走 `mediaWake` 概率；
  - `sendWakePromptV2()` 的 media 唤醒提示词 + `mediaHintFor()` 把「怎么看图 / 怎么打开链接」
    告诉模型；快照 JSON 里 `links` 字段随消息一起进上下文；
  - 模型用 `qq_get_message_images` 看图、用 `mcp__web-search-safe__web_fetch` 打开链接，再 `qq_send_message` 回复。
  - 读 `state/social-v2.json` 的其它读者（控制台状态页、`qq_get_prompt`、上线补历史、
    收尾判断）只是**多看到** `links` 字段，旧字段语义不变；`files` 里没有新文件。
- **机制**：这是"入站消息归一化"缺了一类输入，不是某一行写错：
  文字触发条件（@/名字/关键词/提问/成员/概率）按"消息有没有语义"设计，
  图片被补成 `media` 参与唤醒，**链接却既不是文字触发也不是媒体**——它卡在两个集合之间。
  卡片同理：协议层是结构化 JSON，渲染层却退化成一个占位符字符串。
  修的思路是把"可打开的内容"建模成和图片并列的一类媒体（`links`），
  唤醒只多一个 `|| links.length`，提示词只多一段"链接怎么读"，不引入新的触发条件。
- **爆炸半径**：1 个进程（bridge 主循环）× 读者：
  `linkItemsFromSegments` 由 `handleIncoming`、`segmentsToText`、`forward.js` 调用（只读、纯函数）；
  `evaluateWakeTriggerV2` 只有 1 个调用点；`state/*.json` 只在消息对象上新增 `links`/`hasLinks`
  （旧文件没有这两个键也能读）。静默失败面：解析失败会退回 `[卡片消息]` 并保留原占位，
  **不会**静默把一条链接当成纯文本丢掉；`mcp__web-search-safe__web_fetch` 打不开时提示词要求模型如实说。
  会多花的钱：链接消息按 `mediaWakeProbability`（当前 0.3）参与唤醒，与图片同一预算，
  仍受 tokenGuard 的唤醒上限/最小间隔约束。
- **取舍**：
  - A. 链接放进 `media` 数组：改动最小，但 `qq_get_message_images` 会拿它去取图、
    `fetchOneBotImage` 必然失败，还会污染"有几张图"的语义 ✗；
  - B. 单独 `links` 字段 + 统一唤醒概率（本方案）：语义干净、图片工具不受影响、
    提示词能分别说"看图用图片工具、看链接用 mcp__web-search-safe__web_fetch" ✓；
  - C. 链接也做一次桥接侧抓取（把正文塞进上下文）：能"看见"但引入 SSRF/权限/成本问题，
    而且模型本来就有 `mcp__web-search-safe__web_fetch`，没必要在桥接里再养一个网页抓取器 ✗。
- **生效与重启**：解析/唤醒/落库都在 `src/bridge.js` → **重启桥接**（本机由 start.bat 守护，
  `POST /api/restart` 后约 5 秒自动拉起）；新增文件 `src/link-card.js` 随桥接进程加载。
  `src/mcp-snowluma-safe.js` 的工具描述与 `dsh/agent-presets/qq-chat-v2/agent.cordis.yml`
  的提示词由 DSH 宿主/插件进程加载 → **完全退出 DSH 再打开**才对新会话生效；
  老 QQ 会话要拿到新工具面/新提示词，发 `/reset` 新建会话。

## 修法

- 改了什么：
  1. 新增 `src/link-card.js`（纯函数，无 IO）：
     `parseCardJson()` / `parseCardXml()` 解析 QQ 卡片（news/detail_1/music/video_share/
     mini_app_ark/ark/xml；解码 `&amp;` 等实体、只收 http(s)、标题/摘要/URL 限长）；
     `urlsInText()` 抽取正文 URL（去中文尾标点、排除图片/音视频直链、最多 3 条）；
     `linkItemsFromSegments()` 合并卡片与正文 URL，去重、一条消息最多 5 条；
     `describeLink()` 统一成「标题 · 摘要 · URL」一行。
  2. `src/bridge.js`：
     - `segmentsToText()`：`json`/`xml` 段优先解析成 `[链接卡片]标题 · 摘要 · URL`，
       解析失败才退回 `[卡片消息]`；`image` 段按证据标 `[动图]` / `[表情]` / `[图片]`；
     - `extractMediaFromSegments()`：图片段新增 `animated`（`.gif`/`.webp`/`[动画表情]`）；
     - `handleIncoming()`：新增 `linkList`，随消息落库（`options.links`），
       并传入唤醒判定 `context.links`、`mediaHintFor(..., linkList)`；
     - `evaluateWakeTriggerV2()`：媒体分支改为 `hasWakeableMedia(mediaList, links)`
       （图片/表情/动图 **或** 链接），概率与"不双摇"规则不变；
     - `mediaHintFor()`：图片提示与链接提示分开（图片 → `qq_get_message_images`；
       链接 → `mcp__web-search-safe__web_fetch`，并列出标题+URL）；
     - media 唤醒提示词：覆盖动图"只看到一帧"、卡片/链接"用 mcp__web-search-safe__web_fetch 打开，打不开就说"；
     - 唤醒触发行改成 `图片/表情/动图/链接(概率30%)`；
     - `appendSocialV2Message()`：落库 `links`（source/cardType/title/desc/url，限长去重）、
       `hasLinks`，并把 `animated` 保留到 `media`；
     - `resolveMediaList()` / `fetchMediaData()`：动图文本标注「只提供其中一帧」。
  3. `src/qq-model-view.js`：`links` 保留、`hasLinks=false` 省略；
     `src/conversation-closure.js`：`[链接卡片]`/`[动图]` 也算媒体消息，不被当成纯闲聊；
     `src/forward.js`：合并转发里的卡片同样解析标题+URL。
  4. `src/mcp-snowluma-safe.js`：`qq_get_message_images` / `qq_get_unread_messages` /
     `qq_get_recent_messages` 描述里说明 `media` 与 `links` 的区别。
  5. `dsh/agent-presets/qq-chat-v2/agent.cordis.yml`：看图条目补 `动图`（只看到一帧）、
     新增「链接与卡片用 mcp__web-search-safe__web_fetch」子条；同步重新生成 `plugins/surfcore/presets/qq-chat-v2.patch.yml`。
  6. 测试：新增 `scripts/test-link-media.mjs`（22 组），注册进 `test-audit.mjs`；
     `scripts/audit-bridge-harness.mjs` 注入 `src/link-card.js` 并导出解析/提示函数；
     `scripts/test-media-wake.mjs` 的触发行断言跟随新文案。
- 为什么选这个方案：链接是"有内容但不在文字里"的消息，最自然的归属是媒体唤醒；
  做成独立 `links` 字段既不破坏图片工具，又让模型拿到标题/URL 后自行决定读不读。
  比"桥接代抓网页"少一个网络攻击面，比"只改提示词"多一条真正生效的唤醒通道。
- 回滚方式：`git revert` 本批提交即可。运行期无持久化迁移：`state/social-v2.json`
  里多出的 `links`/`hasLinks` 旧代码会忽略；`config.json` 不需要改。
  回滚后重启桥接（必要时重启 DSH 使 preset 恢复）。

## 验证

- 自动化：
  - `node scripts/test-link-media.mjs` → **22/22**（卡片 JSON/XML、实体、尾标点、限长、
    落库字段、概率模式 p=0/1、不双摇、动图/表情标注、提示词与工具指引、模型视图）；
  - `node scripts/test-media-wake.mjs` → 20/20；`test-long-image`、`test-media-search`、
    `test-forward`（27/29，2 条是控制台令牌环境问题，与本批无关）、
    `test-audit-regressions`、`test-fish-ignore`、`test-closure-wiring`、`test-token-guard` 全过；
  - `node scripts/test-audit.mjs` → **88/90**（剩余 2 个是本会话沙箱环境项：
    `test-audit-setup` 的 dsh 插件安装、`test-release-manifest` 的 git blob 对比，
    失败点都在环境/工作区，不在被测代码）。
- 失败路径（用户/模型看到什么）：
  - 卡片解析失败：不抛错，文本退回 `[卡片消息]`（有测试：坏 JSON/空值 → 空数组）；
  - 链接打不开：提示词要求模型如实说、不要编页面内容；
  - 动图判断不了：文本标 `[动图]`、图片结果带「只提供其中一帧」，模型不许说"看完整段"。
- 手工/集成验证：
  - 桥接重启日志出现 `桥接已启动` / `DSH 已就绪（模式: reserved2）`；
  - 真机验证建议：群里发一张链接卡片 → bot 未读里应出现 `[链接卡片]标题 · 摘要 · URL`，
    命中 30% 时唤醒提示词含「用 mcp__web-search-safe__web_fetch 打开 URL」；发 gif → 文本 `[动图]`、
    `media[0].animated=true`。
- 没验证到的部分：真实 QQ 卡片模板只覆盖 news/detail_1/music/mini_app_ark/ark/xml 常见形状；
  视频号/直播/位置/文件等冷门卡片可能只解析出标题或退回 `[卡片消息]`（已降级不报错）。

## 遗留 / 后续

- 需要补的测试：更多真实卡片样本（从 `state/social-v2.json` 抓原始 json 段）做参数化用例；
  动图多帧理解（当前只给一帧，属于模型能力边界，不在桥接内解决）。
- 需要改的文档：`docs/guides/DATA-AND-CONFIG.md`（mediaWake 覆盖范围）、
  `README.md` 能力表（图片/动图/链接/卡片）、`docs/PITFALLS.md`（卡片/动图各一条）。
