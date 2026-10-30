# MODULE-CORE-B：B站、内容处理、接入层、语音内核

> 范围：`src/` 下 29 个模块，共 7812 行（`wc -l` 实测）。本文按「B站链路 → 内容理解 → QQ 文本适配 → 预设/角色 → 出站网络 → DSH/SnowLuma 接入 → 语音 → 落盘安全」分组精读，最后给出关键设计速查与回归入口。
>
> 约定：结论后的 `(文件:行号)` 指向实现位置；只写当前代码行为，不把历史注释当现状；敏感值统一用 `<QQ号>`、`<群号>`、`<mid>`、`<token>`、`<用户名>`、`<DSH home>`、`<仓库同级目录>` 占位。本文不含任何真实账号、群号、令牌或本机绝对路径。
> **最后核对**：2026-10-26（全仓库逐行梳理）。配套阅读：总纲 [ARCHITECTURE.md](ARCHITECTURE.md) · 边界 [BOUNDARIES.md](BOUNDARIES.md) · 索引 [../README.md](../README.md)。

---

## 0. 模块地图与覆盖清单

### 0.1 分层

```
DSH Web API（外部进程）
  ▲ dsh-client.js（鉴权 / RPC / 事件流）
src/bridge.js（总装线，import 下列模块）
  ├─ B站：bili-api → bili-memory → bili-share-scheduler；bili-dynamics；bili-card + share-mode
  ├─ 内容：fish-guard；sticker-lib + sticker-semantics；slang-learner
  ├─ QQ 文本/协议：md-to-plain；qq-model-view；forward；history-catchup；greeting-schedule；v2-wait
  ├─ 预设/角色：preset-prompt；role-card；sensitive
  ├─ 出站：safe-fetch ← web-search
  ├─ 接入：dsh-port；snowluma-conn；self-test
  ├─ 语音：voice-core ← send-voice-lib；voice-packs；voice-tts
  └─ 落盘：state-acl
```

`src/bridge.js` 是唯一总装线：它 import 这些模块并接到控制台 API、定时器和 QQ 收发上（`src/bridge.js:65`、`src/bridge.js:72-75`、`src/bridge.js:14885-14916`）。本文只描述被引模块本身，桥接只作为调用方出现。

### 0.2 覆盖清单（逐文件、逐区间）

| 模块 | 行数 | 覆盖区间 | 本文节 |
| --- | ---: | --- | --- |
| `src/bili-api.js` | 150 | 1-150 | 1.1 |
| `src/bili-memory.js` | 866 | 1-866 | 1.2 |
| `src/bili-dynamics.js` | 187 | 1-187 | 1.3 |
| `src/bili-share-scheduler.js` | 296 | 1-296 | 1.4 |
| `src/bili-card.js` | 169 | 1-169（另含 `share-mode.js` 1-40） | 1.5 |
| `src/fish-guard.js` | 286 | 1-286 | 2.1 |
| `src/sticker-lib.js` | 356 | 1-356 | 2.2 |
| `src/sticker-semantics.js` | 562 | 1-562 | 2.3 |
| `src/slang-learner.js` | 382 | 1-382 | 2.4 |
| `src/md-to-plain.js` | 117 | 1-117 | 3.1 |
| `src/qq-model-view.js` | 80 | 1-80 | 3.2 |
| `src/forward.js` | 231 | 1-231 | 3.3 |
| `src/history-catchup.js` | 144 | 1-144 | 3.4 |
| `src/greeting-schedule.js` | 119 | 1-119 | 3.5 |
| `src/v2-wait.js` | 27 | 1-27 | 3.6 |
| `src/preset-prompt.js` | 157 | 1-157 | 4.1 |
| `src/role-card.js` | 108 | 1-108 | 4.2 |
| `src/sensitive.js` | 15 | 1-15 | 4.3 |
| `src/safe-fetch.js` | 385 | 1-385 | 5.1 |
| `src/web-search.js` | 496 | 1-496 | 5.2 |
| `src/dsh-client.js` | 978 | 1-978 | 6.1 |
| `src/dsh-port.js` | 88 | 1-88 | 6.2 |
| `src/snowluma-conn.js` | 223 | 1-223 | 6.3 |
| `src/self-test.js` | 118 | 1-118 | 6.4 |
| `src/voice-core.js` | 469 | 1-469 | 7.1 |
| `src/voice-packs.js` | 484 | 1-484 | 7.2 |
| `src/voice-tts.js` | 150 | 1-150 | 7.3 |
| `src/send-voice-lib.js` | 29 | 1-29 | 7.4 |
| `src/state-acl.mjs` | 140 | 1-140 | 8.1 |

---

## 1. B站链路

### 1.1 `bili-api.js`（150 行）

**职责**
只读 B站公开数据：自己的空间动态与单条视频公开信息；不评论、不点赞、不发私信、不读私信文件（`src/bili-api.js:1-6`）。凭据只从 DSH home 下的 B站账号文件读取，不写日志、不回显（`src/bili-api.js:4-5`、`src/bili-api.js:37-61`）。

**对外接口**

| 导出 | 行为 | 依据 |
| --- | --- | --- |
| `resolveBiliPaths(home)` | 返回 `dsh/bili/config/credentials` 四个路径 | `src/bili-api.js:13-21` |
| `loadBiliAccount({home})` | 读配置与凭据，拼 Cookie/UA/Referer | `src/bili-api.js:37-61` |
| `parseDynamicItem(item)` | 空间动态 item 归一化 | `src/bili-api.js:64-88` |
| `fetchMyDynamics({home,timeoutMs})` | 拉自己的动态，失败返回 `ok:false` 不抛 | `src/bili-api.js:94-112` |
| `fetchVideoInfo(bv,{home,timeoutMs})` | 拉单条视频公开信息，先校验 BV 格式 | `src/bili-api.js:117-146` |
| `sleep(ms)` | 可等待的最小实现 | `src/bili-api.js:148-150` |

**数据结构**
账号视图 `{paths,config,cred,mid,name,hasCredentials,headers}`；Cookie 只由 `SESSDATA`、`bili_jct`、`buvid3` 拼成，三者齐备才算有凭据（`src/bili-api.js:43-54`）。动态条目 `{id,type,pubTs,pubText,text,bvid,title,images,url}`，图片取 `draw.items[].src|url`（`src/bili-api.js:77-87`）。视频信息含标题、UP 名、简介、封面、时长、发布时间与播放/弹幕/评论统计（`src/bili-api.js:128-142`）。

**规则与算法**
- 固定桌面 Chrome UA；`Referer` 跟随 `self.mid` 指向自己的空间动态，没有 mid 时退回主站（`src/bili-api.js:11`、`src/bili-api.js:57`）。
- 空间动态走 `web-dynamic/v1/feed/space?host_mid=...`；`code!==0` 失败并带状态码（`src/bili-api.js:99-104`）。
- 视频先匹配 `^BV[0-9A-Za-z]{10}$`，避免任意字符串拼进 URL（`src/bili-api.js:119`）。
- 两个请求都有 `AbortSignal.timeout`（默认 15s / 8s）；JSON 解析失败退回 `{}`（`src/bili-api.js:101-103`、`src/bili-api.js:123-125`）。

**谁调用**
`src/bili-memory.js:16` 引 `fetchMyDynamics/fetchVideoInfo/resolveBiliPaths/sleep`；`src/bili-dynamics.js:10` 引 `fetchMyDynamics`；`src/bridge.js:75` 引 `fetchVideoInfo` 给分享卡补标题；测试/探针在 `scripts/test-bili-card.mjs`、`scripts/probe-bili-card-formats.mjs`。

**边界与失败模式**
- 缺 `self.mid` 或三件套不齐，直接返回 `ok:false` 与中文原因，不发请求（`src/bili-api.js:96-97`）。
- 网络错误/超时/非零 code 全部收敛为 `ok:false`，调用方无需 try/catch（`src/bili-api.js:104-110`、`src/bili-api.js:126-145`）。
- 本模块**没有**私信接口；即使磁盘上有 `dm-*` 也不会读（`src/bili-api.js:3-6`）。
- `fetchVideoInfo` 不要求 `hasCredentials`，无 Cookie 时仍会尝试公开接口（`src/bili-api.js:117-126`）。

### 1.2 `bili-memory.js`（866 行）

**职责**
把 B站公开见闻整理成三种产物：人看的 `bili-memory.md`、每条提示词注入的 `bili-memory-brief.md`、检索/分享用的 `bili-memory.json`（`src/bili-memory.js:9-12`）。隐私红线：不读任何私信文件；日记里出现私信/主人/陌生人/额度等段落整段丢弃（`src/bili-memory.js:3-7`、`src/bili-memory.js:25`）。

**对外接口**
- `isBlockedContent(text)`：政治/娱乐圈过滤（`src/bili-memory.js:37-39`）。
- `createBiliMemory({stateDir,home,log})`：返回带缓存与刷新去重的对象（`src/bili-memory.js:159-168`、`src/bili-memory.js:847-866`）。

工厂对象：`paths`（`src/bili-memory.js:160-168`）、`refresh({force})`（`src/bili-memory.js:640-697`）、`briefBlock()`（`src/bili-memory.js:699-702`）、`recallBlock(query,{maxChars,limit})`（`src/bili-memory.js:727-778`）、`pickShareCard({slotIndex,dateKey,historyDays})`（`src/bili-memory.js:789-808`）、`recordShare(id,slotKey)`（`src/bili-memory.js:810-824`）、`lastSlot(slotKey)`（`src/bili-memory.js:826-829`）、`status()`（`src/bili-memory.js:831-845`）、`selfName()/selfInfo()`（`src/bili-memory.js:856-864`）。

**数据结构**
索引条目 `{id,type,bvid,title,url,reason,quote,anecdote,score,favorite,dates,ats,sources,date,at,priority,shareable}`（`src/bili-memory.js:368-385`、`src/bili-memory.js:429-439`）。`type` 只有 `video`（按 BV 聚合）、`thought`（无 BV 的反思）、`dynamic`（自己的公开动态）（`src/bili-memory.js:444-477`）。输出上限：doc 时间线 140 条/反思 30 条/全文 28000 字，brief 10 条/2700 字，index 260 条（`src/bili-memory.js:515-541`、`src/bili-memory.js:570-613`）。

**规则与算法**
- *采集*：只消费 `scores.json`、`favorites.json`、`quota.json.log`、自己的动态、`whale-diary.md` 的公开见闻（`src/bili-memory.js:257-361`）；打分/收藏要求合法 BV，评论 note≥4 字，动态正文≥10 字或带标题（`src/bili-memory.js:270-321`）。
- *日记切块*：按 `##` 标题切；标题里的 `YYYY-MM-DD` 作日期，「新的一天」用文件 mtime 兜底；表格行/空行/分隔线都切块（`src/bili-memory.js:125-154`）。块级过滤：长度 30–900、命中私信词/owner 昵称/社交互动词即丢弃（`src/bili-memory.js:326-332`）。
- *见闻与反思*：见闻要求有 BV，或「视频类词 + 《标题》 + ≥60 字带标点」；反思要求 ≤260 字、命中反思词、不命中互动/噪声词（`src/bili-memory.js:333-349`）。
- *卡片聚合*：同 BV 合并；分数取最大值；reason 取最长；收藏打标；非回复且 ≥8 字的最长评论做 quote；日记细节取最长；日期取最新；标题回退链「收藏标题→标题缓存→reason 的《》→日记的《》」（`src/bili-memory.js:387-440`）。
- *过滤*：政治/娱乐圈命中的卡片在 doc/brief/index/分享池/检索一律排除或降级（`src/bili-memory.js:520`、`src/bili-memory.js:567`、`src/bili-memory.js:611`、`src/bili-memory.js:661`、`src/bili-memory.js:755`）。
- *检索*：英文/数字 ≥2 字、中文相邻双字，停用 30 个高频双字，最多 24 token（`src/bili-memory.js:704-725`）；命中 B站相关词或能分出 token 才检索（`src/bili-memory.js:735-737`）。条目得分：BV 精确 +60、完整标题 +30、token 命中标题 +5/正文 +2、≥3 个 token +4、≤2 天 +3 / ≤7 天 +1、动态 +1、命中屏蔽词归零（`src/bili-memory.js:742-755`）；`score<8` 不返回（`src/bili-memory.js:758-759`）。
- *身份锚点*：brief 不只给昵称，还给 mid 与空间地址，防止模型把群友发来的主页截图当成别人（`src/bili-memory.js:552-559`）。
- *刷新*：4 分钟节流 + 单飞；只为分享池补最多 40 个标题、每个 sleep 260ms、失败 6 小时退避；写盘原子且 `mode:0o600`（`src/bili-memory.js:640-697`、`src/bili-memory.js:221-255`、`src/bili-memory.js:51-61`）。

**B站打分的权重（消费端）**

上游 0–20「标尺」：分享型评论 `--score` 必填且达到 `share.minScore`（配置默认 13），只允许当天第一名（`plugins/surfcore/tools/commands/comment.mjs:134-149`、默认值见 `plugins/surfcore/lib/store.js:59`）；评分账按天存 `scores.json`，同 BV 同日取最高（`plugins/surfcore/tools/lib/scores.mjs:1-6`、`plugins/surfcore/tools/lib/scores.mjs:27-38`）。`bili-memory` 不重新打分，只消费：

| 消费位置 | 权重/阈值 | 依据 |
| --- | --- | --- |
| 同 BV 聚合 | `Math.max`，只升不降 | `src/bili-memory.js:389` |
| 分享优先级 | ≥15→6；≥13→5；收藏→5；有公开评论→3；其余→2 | `src/bili-memory.js:437` |
| 分享池准入 | 12 分，或收藏/quote≥18/anecdote≥60/reason≥24 | `src/bili-memory.js:798` |
| 简报排序 | 日期倒序，同日按分数倒序 | `src/bili-memory.js:565-569` |
| 检索加权 | BV 60、标题 30、token 5/2、多命中 4、时效 3/1、动态 1 | `src/bili-memory.js:742-754` |
| 检索最低分 | 8 | `src/bili-memory.js:759` |
| 分享去重 | 6 天 | `src/bili-memory.js:789` |

一句话：上游 0–20 是绝对标尺（分享阈值 13）；本模块把它当**排序/准入门槛**（priority 15/13、分享池 12、检索 60/30/5/2）。低于 13 仍入记忆，低于 12 基本只在检索/简报出现（`src/bili-memory.js:437`、`src/bili-memory.js:798`）。

**谁调用**
`src/bridge.js:65` import、`src/bridge.js:1764` 创建；启动强制刷新并起周期定时器（`src/bridge.js:14885-14888`）；控制台读 `status/briefBlock/recallBlock` 与手动 `refresh`（`src/bridge.js:4101-4126`）；每条提示词注入 brief（`src/bridge.js:10626`、`src/bridge.js:11604`、`src/bridge.js:12611`）；有消息时按内容 `recallBlock`（`src/bridge.js:13802-13876`）；分享调度用 `pickShareCard/recordShare`（`src/bridge.js:14904-14916`）。离线脚本 `scripts/bili-memory-sync.mjs` 也直接创建同一工厂。

**边界与失败模式**
- 读写都 `try/catch`；坏 JSON 退回空对象/缓存，不炸调用方（`src/bili-memory.js:41-49`、`src/bili-memory.js:193-205`）。
- `refresh` 并发复用同一 Promise；非强制 4 分钟内返回 `cached:true`（`src/bili-memory.js:641-644`）。
- DSH/网络失败只影响标题/动态缓存，旧文件继续可读（`src/bili-memory.js:212-218`、`src/bili-memory.js:229-230`）。
- 失败日志只写消息，`BILI_MEMORY_DEBUG` 才打印栈（`src/bili-memory.js:688-691`）。
- doc/brief 是截断，不是分页；超长时尾部丢失（`src/bili-memory.js:541`、`src/bili-memory.js:588`）。

### 1.3 `bili-dynamics.js`（187 行）

**职责**
轮询自己发的公开动态；第一次只建基线，不把历史倒进群，之后只推新动态，正文+链接原样发，不让模型二次改写（`src/bili-dynamics.js:1-5`）。

**对外接口**
`formatDynamicMessage(item,{selfName})`（`src/bili-dynamics.js:40-51`）；`createBiliDynamicsSync({stateDir,log,sendToQQ,groups,isReady,intervalMs,selfName})` 返回 `{start,stop,pollOnce,status,formatDynamicMessage}`（`src/bili-dynamics.js:63-71`、`src/bili-dynamics.js:186`）。

**数据结构**
状态 `state/bili-dynamics-state.json`：`{version:1,baselineAt,seen:{id:iso},lastPollAt}`（`src/bili-dynamics.js:78-87`）；缓存 `{at,items}`（`src/bili-dynamics.js:93-95`）；消息最多三行：标题、正文/标题/图片数/无文字、去重链接（`src/bili-dynamics.js:44-50`）。

**规则与算法**
- 默认 180 秒轮询、最小 60 秒；启动 8 秒先探一次（`src/bili-dynamics.js:69`、`src/bili-dynamics.js:160-163`）。
- `running` 互斥；`isReady()` 为假跳过（`src/bili-dynamics.js:98-99`、`src/bili-dynamics.js:152-154`）。
- 首次运行把当前动态全写入 `seen` 并记 `baselineAt`，一条不发（`src/bili-dynamics.js:110-118`）。
- 新动态 = 有 id、不在 `seen`、非初始化轮；按 `pubTs` 升序发送（`src/bili-dynamics.js:120-123`）。
- 每条对每个群 `sendToQQ`；发送失败只记日志，仍标记已见（`src/bili-dynamics.js:125-136`）。
- `seen` 最多 300 条，按时间裁（`src/bili-dynamics.js:138-145`）。

**谁调用**
`src/bridge.js:72` import；启动时用白名单群创建并 `start()`（`src/bridge.js:14890-14901`）；控制台「立即轮询」调 `pollOnce()`（`src/bridge.js:4138`）。

**边界与失败模式**
- 拉取失败保留旧状态，不推进基线（`src/bili-dynamics.js:102-106`）。
- 状态写失败只记日志；缓存写失败静默（`src/bili-dynamics.js:89-95`）。
- **发送失败仍标记已见**：避免同一动态每轮重发，但某群那轮掉线就永久收不到（`src/bili-dynamics.js:127-136`）。
- 没有白名单群时桥接不启动（`src/bridge.js:14900-14901`）；正文 >420 字截断（`src/bili-dynamics.js:45-48`）。

### 1.4 `bili-share-scheduler.js`（296 行）

**职责**
每天 8 个固定时间点向白名单群分享「最近在 B站碰到的最有趣的事」，用角色口吻评论；素材由 `bili-memory` 分享池挑，已过滤政治/娱乐圈（`src/bili-share-scheduler.js:1-7`）。

**对外接口**
`buildSharePrompt(card,timeLabel,{mode,cardSent})`（`src/bili-share-scheduler.js:39-82`）；`createBiliShareScheduler({stateDir,log,deliverPrompt,groups,memory,isReady,times,gapMs,getMode,sendCard})` 返回 `{start,stop,fire,fireNow,status,buildSharePrompt}`（`src/bili-share-scheduler.js:96-107`、`src/bili-share-scheduler.js:288-295`）。

**数据结构**
默认时间 `07:00/11:00/13:00/15:00/17:00/19:00/21:00/23:00`（`src/bili-share-scheduler.js:11`）。状态 `{lastSlot,lastRunAt,lastSlots:{slotKey:iso}}`（`src/bili-share-scheduler.js:114-129`）；`slotKey` 为 `<日期> <HH:MM>`，手动为 `<日期> manual <HH:MM>`（`src/bili-share-scheduler.js:171-173`）。

**规则与算法**
- 时间只接受 `H:MM`/`HH:MM`，夹到 0–23/0–59，去重升序（`src/bili-share-scheduler.js:13-23`）。
- 下一次触发取今天未过的第一个点（留 1 秒余量），都过了排明天第一个点（`src/bili-share-scheduler.js:25-37`）。
- 同一 `slotKey` 只跑一次；手动不受限（`src/bili-share-scheduler.js:174-179`）。
- DSH 离线**不跳过**：`deliverPrompt` 进离线队列，恢复后补投（`src/bili-share-scheduler.js:180-181`）。
- `running` 互斥；每群先 `sendCard`，随后无论卡片是否成功都投提示词；群间默认 4 秒（`src/bili-share-scheduler.js:165-168`、`src/bili-share-scheduler.js:190-213`）。
- 只有至少一个群成功才 `recordShare` + `markSlot`；全失败不记（`src/bili-share-scheduler.js:214-220`）。
- 启动补跑：落在某点后 0–10 分钟内且未跑过，延迟 1.5 秒补一次，只补最早一个（`src/bili-share-scheduler.js:244-260`）。
- `lastSlots` 超 30 天的键删除（`src/bili-share-scheduler.js:144-154`）。

*提示词*：清洗「记了 N 分」「rpid」「@昵称」等噪声（`src/bili-share-scheduler.js:42-51`）；`cardSent=true` 时只补 2~3 句短评，不再发链接/BV/标题（`src/bili-share-scheduler.js:55-58`、`src/bili-share-scheduler.js:69-73`）；`reserved2` 必须调 `mcp__snowluma__qq_send_message`，否则纯文本不会自动发（`src/bili-share-scheduler.js:76-80`）；固定要求不聊政治/时政/娱乐圈（`src/bili-share-scheduler.js:75`）。

**谁调用**
`src/bridge.js:73` import；启动时以 `deliverPrompt/biliMemory/sendCard` 构造并 `start()`（`src/bridge.js:14904-14916`）；控制台「立即分享」调 `fireNow()`（`src/bridge.js:4132`）。

**边界与失败模式**
- 没有白名单群不启动（`src/bridge.js:14917-14918`）；`fire` 内再校验 `groups/memory`（`src/bili-share-scheduler.js:169-170`）。
- 分享池为空返回 `ok:false`，不写状态（`src/bili-share-scheduler.js:186-189`）。
- 卡片抛错只记日志，仍投提示词；此时按 `cardSent=false` 要求模型自己带 BV/链接（`src/bili-share-scheduler.js:194-202`）。
- 定时器都 `unref`，不阻止进程退出（`src/bili-share-scheduler.js:236`、`src/bili-share-scheduler.js:257`）。

### 1.5 `bili-card.js`（169 行）

**职责**
往群里发 B站分享。真机结论：小程序卡在 QQ 侧已下架；手拼 `com.tencent.structmsg` 被「发送者版本过低」拒绝。所以默认纯文本「【B站】标题 + 链接」，小程序只保留 opt-in（`src/bili-card.js:1-12`）。文件只做三件事：转发 `share-mode` 纯逻辑、保留 ARK 给诊断、把发送/抓标题/缓存注入（`src/bili-card.js:14-17`）。

**对外接口**
再导出 `CARD_MODES/normalizeCardMode/buildBiliShareText`（`src/bili-card.js:21`）；`httpsifyImage(url)`（`src/bili-card.js:25-29`）；`buildBiliCardArk(input)`（`src/bili-card.js:44-86`）；`createBiliCardSender(deps)` 返回 `sendBiliCard(key,card)`（`src/bili-card.js:106-168`）。

**数据结构**
ARK 顶层 `{app:'com.tencent.structmsg',config,desc,extra,meta:{news},prompt,ver,view}`（`src/bili-card.js:66-85`）；分享文本第一行 `【B站】标题`、第二行链接（`src/share-mode.js:35-40`）。

**规则与算法**
- 模式：`text`/`link`→`text`；`off`/`miniapp` 原样；否则 `card:false`→`off`，其余→`text`（`src/share-mode.js:21-30`）。
- `off` 返回 `false`；key 必须是 `group:<纯数字>`；bvid 必须匹配 BV 正则（`src/bili-card.js:117-126`）。
- 缺标题（miniapp 还缺封面）时调注入的 `fetchVideoInfo` 补；仍无标题返回 `false`（`src/bili-card.js:127-135`）。
- 描述按 reason→quote→text→info.desc→title 取第一个非空，压到 120 字（`src/bili-card.js:137`）。
- 文本路径发一个 `text` 段（`src/bili-card.js:140-148`）；miniapp 同 bvid 的 ARK 5 分钟内复用，发 `json` 段，抛错落回文本（`src/bili-card.js:150-165`）。
- `httpsifyImage` 只替换开头 `http://`（`src/bili-card.js:25-29`）。

**谁调用**
`src/bridge.js:74` import `createBiliCardSender/normalizeCardMode`；`src/bridge.js:8532-8536` 注入依赖；分享调度作为 `sendCard`（`src/bridge.js:14914`）。

**边界与失败模式**
- 依赖全注入；未配置发送/小程序通道时默认函数抛「没有配置…」，由调用方兜底（`src/bili-card.js:107-113`）。
- 非群聊 key、非 BV、无标题都返回 `false` 不抛（`src/bili-card.js:117-135`）。
- 文本发送失败返回 `false` 并记日志（`src/bili-card.js:140-148`）。
- miniapp 生成成功也可能显示已下架，所以是 opt-in（`src/bili-card.js:11-12`、`src/bili-card.js:160-164`）。

---

## 2. 内容理解与社交保护

### 2.1 `fish-guard.js`（286 行）

**职责**
QQ 群「鱼群保护」纯函数层：只做判定，不碰网络/状态；冷却、落盘、硬拦发送由桥接负责（`src/fish-guard.js:1-12`、`src/fish-guard.js:261-263`）。目标是「多条同类角色同群时不要集体刷屏」。

**对外接口**

| 导出 | 行为 | 依据 |
| --- | --- | --- |
| `DEFAULT_QQ_FISH_GUARD` | 冻结默认阈值 | `src/fish-guard.js:14-45` |
| `normalizeQqFishGuard(raw)` | 逐字段夹取/清洗 | `src/fish-guard.js:63-91` |
| `isFishName(name,guard)` | 昵称开头/包含/结尾任一命中 | `src/fish-guard.js:113-128` |
| `isFishGroupName(name,guard)` | 群名是否像鱼窝 | `src/fish-guard.js:130-140` |
| `assessFishDensity(messages,opts)` | 统计密度并给 `blocked/reason` | `src/fish-guard.js:156-226` |
| `fishGuardReasonText(assessment)` | 中文原因（含冷却剩余分钟） | `src/fish-guard.js:228-247` |
| `fishGuardPromptLine(assessment,{bypass})` | 给模型看的保护提示 | `src/fish-guard.js:250-257` |
| `appendFishGuardTrigger(state,opts)` | 追加触发记录，最多 30 条 | `src/fish-guard.js:268-285` |

**数据结构**
窗口消息只需 `{sender,userId,isSelf,isOwner,time,kind,fish}`（`src/fish-guard.js:153-155`）。结果含 `enabled/blocked/reason/fishCount/fishMessages/totalMessages/fishRatio/consecutiveFish/consecutiveFishSenders/groupIsFishNest/effectiveMaxFish/windowMs/fishNames`（`src/fish-guard.js:158-172`、`src/fish-guard.js:211-225`）。触发记录含群号、群名、原因、四项统计与 `until`（`src/fish-guard.js:271-283`）。

**规则与算法**

| 阈值 | 默认 | 含义 |
| --- | ---: | --- |
| `windowMs` / `cooldownMs` | 10 分钟 / 10 分钟 | 统计窗口 / 触发后冷却 |
| `maxFish` | 5 | 不同鱼发送者数 |
| `maxConsecutiveFish` | 5 | 连续鱼消息（且 ≥2 条鱼） |
| `singleFishMaxConsecutive` | 5 | 单只鱼连续消息 |
| `maxFishMessages` / `maxFishRatio` | 8 / 0.6 | 补充：鱼消息条数/占比 |
| `minSample` / `minFishSendersForRatio` | 8 / 2 | 占比规则最小样本/最少鱼账号 |
| `groupNestMaxFish` | 3 | 群名像鱼窝时阈值收紧 |
| `nameContains` | `肥鱼` | 昵称包含即算鱼 |
| `nameSuffixes` | `肥鱼`、`fish`、`鱼` | 昵称结尾即算鱼 |
| `groupNameSuffixes` | `肥鱼`、`fish` | 群名判断只看这两个 |

夹取范围：窗口 1 分钟–24 小时；`maxFish` 2–20；连续类 2–30/50；占比 0–1；群号/QQ 号只接受 4–15 位数字（`src/fish-guard.js:65-87`）。昵称归一化去零宽、尾部标点/空白、尾部数字、emoji，再去空白转小写，于是 `同类bot2`、`同类_bot_2`、带装饰 emoji 的变体都能命中同一关键词（`src/fish-guard.js:93-102`）。`exemptNames` 先排除（`src/fish-guard.js:117`）；`isSelf/isOwner` 不算鱼，`exemptIds` 先排除，`fishIds` 强制算鱼，否则看 `fish` 标志或昵称（`src/fish-guard.js:142-148`）。

密度统计过滤 `poke` 与窗口外消息，`recentOthers` 排除自己；群名像鱼窝或群号在 `groupNestIds` 时 `effectiveMaxFish=min(maxFish,groupNestMaxFish)`（`src/fish-guard.js:175-185`）。`fishCount` 按 `userId`（无则归一化昵称）去重；连续鱼从最新往回数，遇非鱼即停（`src/fish-guard.js:187-202`）。判定短路顺序：不同鱼 ≥ `effectiveMaxFish` → `fish-count`；连续 ≥ `maxConsecutiveFish` 且不同鱼 ≥2 → `fish-streak`；连续 ≥ `singleFishMaxConsecutive` → `fish-streak-single`；样本/条数/占比/账号数全达标 → `fish-ratio`（`src/fish-guard.js:204-209`）。

> 边界：连续鱼统计包含自己的消息，所以自己插一句会打断 streak；`fishCount`/占比只算他人（`src/fish-guard.js:177-200`）。保护的是「鱼占满对话」，不是「鱼总数」。

**谁调用**
`src/bridge.js:49-50` 引入；收消息打 `fish` 标记（`src/bridge.js:9829`）；评估时传群名/群号（`src/bridge.js:9876`）；命中后写状态并追加记录（`src/bridge.js:9898-9910`）；发送硬拦用原因文案（`src/bridge.js:9942`）；提示词注入（`src/bridge.js:9954`）；唤醒/回复跳过日志（`src/bridge.js:12669`、`src/bridge.js:13657`）。

**边界与失败模式**
- `enabled=false`、非群聊、无消息返回 `blocked:false` 空结果（`src/fish-guard.js:166-173`）。
- 本模块**不实现冷却**：`reason='cooldown'` 与 `until` 由桥接补（`src/bridge.js:9867-9940`、`src/fish-guard.js:230-235`）。
- 昵称匹配宁可误伤真人也不漏鱼，用户可配 `exemptNames/exemptIds` 兜底（`src/fish-guard.js:32-40`）。
- **B站评论区是另一套实现**：默认样本 40 条、鱼顶层 ≥3、不同鱼账号 ≥3、占比 ≥0.4、样本 ≥8，另有聚拢/点赞/风控熔断（`plugins/surfcore/tools/lib/fish-guard.mjs:24-68`）。两套阈值不能互套。

### 2.2 `sticker-lib.js`（356 行）

**职责**
本地表情知识库：读写 `state/stickers.json`、合并 SnowLuma 返回的 QQ 收藏表情、按 id/md5/URL/编号查找、按备注/情绪/内容/标签搜索、生成注入提示词的表情摘要、记录 AI 理解与使用次数（`src/sticker-lib.js:1-12`）。

**对外接口**
`nowIso`（`src/sticker-lib.js:25-27`）、`sanitizeStickerText(value,max)`（`src/sticker-lib.js:44-54`）、`normalizeStickerEntry(raw)`（`src/sticker-lib.js:56-99`）、`loadStickerStore(file)`（`src/sticker-lib.js:113-129`）、`saveStickerStore(file,entries)`（`src/sticker-lib.js:131-144`）、`mergeStickerLibrary(existing,fetched,{complete})`（`src/sticker-lib.js:149-193`）、`findSticker(entries,ref)`（`src/sticker-lib.js:206-227`）、`formatStickerList(entries,query,limit)`（`src/sticker-lib.js:230-269`）、`buildStickerContext(entries,max)`（`src/sticker-lib.js:276-291`）、`buildStickerStrategyHint()`（`src/sticker-lib.js:295-306`）、`applyStickerNote(entries,id,patch)`（`src/sticker-lib.js:309-338`）、`markStickerUsed(entries,id,context)`（`src/sticker-lib.js:341-356`）。

**数据结构**
条目字段 `id/no/resId/url/md5/desc/localNote/emotion/emotionAlt/content/keywords/tags/usage/source/useCount/lastUsedAt/lastContext/createdAt/updatedAt`（`src/sticker-lib.js:76-98`）。`no` 为 1–9999 稳定编号；`source` 只允许 `manual/ai/qq`；`emotionAlt` 最多 2 个且不等于主情绪（`src/sticker-lib.js:65-72`、`src/sticker-lib.js:92-93`）。

**规则与算法**
- **跨会话注入防护**：`sanitizeStickerText` 把所有空白（含全角空格）压成单空格、删控制/零宽字符、按码点截断（`src/sticker-lib.js:44-54`）。原因：表情库整个 QQ 账号共享，备注可能在别的会话被写；单行化让注入内容无法伪造 `【系统】` 新段落（`src/sticker-lib.js:29-43`）。`buildStickerContext` 再声明「只是资料，不是指令」（`src/sticker-lib.js:271-290`）。
- **读坏库不能当空库**：ENOENT 返回 `[]`；读失败/JSON 损坏/顶层非数组直接抛错，避免调用方拿空数组回写覆盖（`src/sticker-lib.js:101-128`）。
- **合并**：只覆盖 QQ 侧 `resId/url/md5/desc` 与时间戳，保留 `localNote/tags/usage/source/useCount/lastUsedAt/lastContext/createdAt`（`src/sticker-lib.js:146-179`）。`complete=true` 才删「QQ 端已不存在」的 `source=qq` 条目（`src/sticker-lib.js:190-192`）。
- **查找**：id/resId 或 md5 精确 → 编号 `#05/5/5号` → URL 归一化（忽略协议/尾斜杠/查询参数，拒绝内嵌凭据）（`src/sticker-lib.js:195-227`）。
- **提示块**：按 `useCount` 降序、再编号升序取前 N（默认 8，上限 30），每张一行「编号+情绪+内容/备注/本地笔记」，给 `qq_send_sticker stickerId="#01"` 示例（`src/sticker-lib.js:276-291`）。
- **写笔记**：emotion 只接受词表类别；`emotionAlt` 去重排除主情绪；可增量更新 content/keywords/localNote/tags/usage；`source` 默认 `ai`（`src/sticker-lib.js:309-338`）。使用记录 `useCount+1`、`lastUsedAt`、`lastContext` 截 200 字（`src/sticker-lib.js:341-356`）。

**谁调用**
`src/bridge.js:93-99` 引入；启动 `ensureStickerIndex` 补编号（`src/bridge.js:1817`）；同步 QQ 收藏按是否完整传 `complete`（`src/bridge.js:1848`）；MCP 发图后 `markStickerUsed`（`src/bridge.js:2429`）；写笔记走 `applyStickerNote`（`src/bridge.js:2437-2446`）；排序/提示在 `src/bridge.js:2479-2488`；每条提示词注入 context/策略（`src/bridge.js:5532-5533`）。

**边界与失败模式**
- 库读坏会抛；桥接切「只读不写」并留醒目日志（`src/bridge.js:1793` 附近注释、`src/sticker-lib.js:104-111`）。
- 保存失败主动删临时文件，避免 `stickers.json.<pid>.<hex>.tmp` 残留（`src/sticker-lib.js:131-144`）。
- 归一化保持纯函数，不自动补编号，补号必须整库一起算否则撞号（`src/sticker-lib.js:63-66`）。
- 截断按码点，避免切开 emoji 产生孤立代理（`src/sticker-lib.js:52-53`）。

### 2.3 `sticker-semantics.js`（562 行）

**职责**
表情语义层：稳定编号、情绪分类（主+0~2 副）、内容/关键词、本地注意力编码、按语境排序并生成「表情匹配」提示（`src/sticker-semantics.js:1-19`）。注释明确它不是预训练 Transformer，而是**固定随机权重、未训练**的单层自注意力编码器；相似度主要来自字/词重叠与情绪词表扩展（`src/sticker-semantics.js:9-16`）。

**对外接口**
`STICKER_EMOTIONS`/`EMOTION_KEYS`/`EMOTION_LABELS`（`src/sticker-semantics.js:24-52`）、`isStickerEmotion`/`normalizeEmotionKey`/`emotionLabel`（`src/sticker-semantics.js:77-91`）、`parseStickerNumber`（`src/sticker-semantics.js:97-102`）、`detectEmotions`（`src/sticker-semantics.js:121-142`）、`tokenize`（`src/sticker-semantics.js:153-166`）、`encodeText`（`src/sticker-semantics.js:238-294`）、`dot`/`cosine`（`src/sticker-semantics.js:296-304`）、`stickerVector`/`clearStickerVectorCache`/`stickerSearchText`（`src/sticker-semantics.js:324-359`）、`inferStickerMeta`（`src/sticker-semantics.js:366-388`）、`ensureStickerIndex`（`src/sticker-semantics.js:397-432`）、`rankStickers`（`src/sticker-semantics.js:481-531`）、`buildStickerMatchHint`（`src/sticker-semantics.js:536-561`）。

**数据结构**
情绪项 `{key,label,words}`，共 19 类（含 `neutral`）（`src/sticker-semantics.js:24-48`）。相邻情绪表对称，代码只写一边，`neighborsOf` 自动补反向（`src/sticker-semantics.js:55-75`、`src/sticker-semantics.js:104-114`）。排序结果 `{no,id,emotion,emotionLabel,content,desc,score,emotionScore,contentScore,reason}`（`src/sticker-semantics.js:516-527`）。

**规则与算法**
- *情绪识别*：每词按出现次数累加，单次最多计 2 次；词长 ≥3 权重 1.6、2 字 1、1 字 0.5；按得分降序，再除以最高分得到 `weight∈(0,1]`（`src/sticker-semantics.js:121-142`）。长词权重更高用于区分「别嘲笑」/「嘲笑」这类方向（`src/sticker-semantics.js:133-134`）。
- *分词*：英文/数字整体成 token；中文输出每个单字 + 每个相邻双字（`src/sticker-semantics.js:145-166`）。
- *编码器*：`DIM=128`、`MAX_TOKENS=64`、`SEED=0x9e3779b9`、`τ=0.12`、`MIX=0.45`（`src/sticker-semantics.js:174-178`）；固定种子 `mulberry32` 生成 128×128 随机矩阵（`src/sticker-semantics.js:200-210`）；FNV-1a → `col=(hash>>>1)%128`、`sign=hash&1?1:-1`，逐 token L2（`src/sticker-semantics.js:245-260`）；自注意力 `softmax(cos/τ)`、混入 0.45、残差（`src/sticker-semantics.js:262-284`）；均值池化 + 整体 L2（`src/sticker-semantics.js:286-294`）。
- *向量缓存*：key = 条目 id + `fnv1a(语义文本签名)`，签名覆盖 emotion/alt/content/desc/localNote/usage/keywords/tags；上限 400 FIFO，不落盘（`src/sticker-semantics.js:306-338`）。
- *编号*：已有合法且不重复的保留；新号从「现有最大号+1」开始，**不复用**空号，避免 `#03` 在不同对话指到两张图；重复号就地修正（`src/sticker-semantics.js:394-420`）。
- *自动标注*：显式 emotion 优先；没有取词表最高分，再没有 `neutral`；副情绪最多 2 个；content 回退 desc/localNote；**关键词不自动抽取**（无词典双字会切出噪声）（`src/sticker-semantics.js:361-388`）。
- *排序*：查询截 800 字；识别情绪后把中文标签拼进查询向量（`src/sticker-semantics.js:482-492`）；内容分 `clamp01((dot-0.02)/0.5)`（`src/sticker-semantics.js:499-500`）；情绪分精确 1/副情绪 0.82/相邻 0.6 再乘识别权重取最大（`src/sticker-semantics.js:448-463`）；关键词每词 +1、2 个满分（`src/sticker-semantics.js:465-472`）；总分 `0.46*情绪+0.38*内容+0.16*关键词`（`src/sticker-semantics.js:438-440`、`src/sticker-semantics.js:503`）；使用次数 ≤+0.03，15 分钟内用过 −0.08、1 小时内 −0.03（`src/sticker-semantics.js:504-509`）；`minScore=0.34`、topK=3（上限 10）（`src/sticker-semantics.js:441-442`、`src/sticker-semantics.js:486-487`）。
- *提示*：`strongScore=0.72`，达到时把「可以发」写成更强建议，否则「真的贴合才发」；注释记录 0.83 推荐仍被模型自我审查的实测（`src/sticker-semantics.js:545-556`）。

**谁调用**
`src/sticker-lib.js:18-23` 用情绪标签/校验/编号解析；`src/bridge.js:100-105` 引入 `EMOTION_LABELS/rankStickers/buildStickerMatchHint/ensureStickerIndex`；`src/bridge.js:1817` 补索引；`src/bridge.js:2479-2488` 排序并生成 hint；`src/mcp-snowluma-safe.js:22` 用 `EMOTION_LABELS` 做工具参数枚举。

**边界与失败模式**
- 纯计算：不读文件、不发请求、不执行任何东西（`src/sticker-semantics.js:18`）。
- 空文本/空库返回空数组/零向量（`src/sticker-semantics.js:238-242`、`src/sticker-semantics.js:483-485`）。
- 情绪词表未命中时只靠内容向量与关键词（`src/sticker-semantics.js:122-124`、`src/sticker-semantics.js:448-449`）。
- `ensureStickerIndex` 原地修改条目（`src/sticker-semantics.js:421-430`），调用方需知道这是写操作；向量缓存不自动失效，跨进程不共享（`src/sticker-semantics.js:306-338`）。

### 2.4 `slang-learner.js`（382 行）

**职责**
群聊黑话/网络用语学习：`state/slang.json` 读写与 CRUD、从消息提取候选、生成联网考究提示词、把已确认词条格式化成注入表（`src/slang-learner.js:1-9`）。用 JSON + 控制台人工确认，不引入数据库（`src/slang-learner.js:9`）。

**对外接口**
`SLANG_STATUS`（`src/slang-learner.js:16-20`）、`nowIso/createId`（`src/slang-learner.js:29-35`）、`SLANG_MAX_ENTRIES`（`src/slang-learner.js:37-46`）、`normalizeSlangEntry`（`src/slang-learner.js:51-83`）、`capSlangEntries`（`src/slang-learner.js:89-100`）、`loadSlang`（`src/slang-learner.js:111-140`）、`saveSlang`（`src/slang-learner.js:142-157`）、`createSlangEntry`（`src/slang-learner.js:159-174`）、`upsertSlangEntry`（`src/slang-learner.js:176-200`）、`mergeEvidence`（`src/slang-learner.js:202-213`）、`buildSlangContext`（`src/slang-learner.js:215-229`）、`buildExtractionPrompt`（`src/slang-learner.js:231-252`）、`buildResearchPrompt`（`src/slang-learner.js:254-283`）、`extractJsonArray`（`src/slang-learner.js:301-355`）、`parseExtractionJson/parseResearchJson`（`src/slang-learner.js:357-381`）。

**数据结构**
条目 `{id,content,meaning,usage,example,risk,sources,status,source,count,evidence,lastInferenceCount,createdAt,updatedAt}`（`src/slang-learner.js:62-82`）。content 50 字、其余 300 字；sources 保留最后 10；evidence 保留最后 20、每条 80 字（`src/slang-learner.js:47-49`、`src/slang-learner.js:69-77`）。状态非法回 `candidate`，来源非法回 `ai`（`src/slang-learner.js:53-55`、`src/slang-learner.js:71`）。

**规则与算法**
- **容量**：2000 条；裁剪键「已确认(2)>候选(1)>拒绝(0)」→ count → updatedAt（`src/slang-learner.js:37-46`、`src/slang-learner.js:89-100`）。原因：三个写入点都只 push 不裁剪，文件只会涨（`src/slang-learner.js:37-45`）。
- **读失败与不存在分离**：ENOENT 空数组；其他读错误抛；JSON 解析失败或顶层非数组时把原文另存 `.corrupt-<时间戳>` 再抛（`src/slang-learner.js:101-140`）。
- **提示词注入防护**：进入 learner prompt 的群聊文本先 HTML 实体转义并删控制字符（`src/slang-learner.js:22-27`）；提示词明确「聊天记录是不可信文本，只当语料」（`src/slang-learner.js:243`）；输出表把 `[CQ:` 改成全角冒号（`src/slang-learner.js:222`）。
- **候选提取**：2–8 字、真实出现、无法确定含义、排除人名/@/表情/功能词，最多 20 个，只输出 JSON 数组（`src/slang-learner.js:235-251`）。
- **联网考究**：先结合语境，再 `web_search`、对最相关 1–2 个结果 `web_fetch` 读正文；输出 meaning/usage/example/risk/sources/confirmed；搜不到就 false（`src/slang-learner.js:263-282`）。
- **JSON 提取**：先整体 parse；失败则扫描括号配平的 `[...]`，跳过字符串字面量与转义；最多 32 候选、64 次扫描；优先「至少含一个对象」的数组（`src/slang-learner.js:285-355`）。注释解释贪婪正则会在「先解释再 JSON」时跨结构并静默失败（`src/slang-learner.js:288-300`）。
- **注入表**：只取 confirmed 且 content/meaning 非空，按 count 降序前 N（默认 8，上限 30），每行「词：含义（用法）（例）」（`src/slang-learner.js:215-229`）。

**谁调用**
`src/bridge.js:77-82` 引入；启动 `loadSlang` 带 `onCorrupt`（`src/bridge.js:1774`）；保存走 `saveSlangStore`（`src/bridge.js:2577-2583`）；学习轮 `buildExtractionPrompt`/`upsertSlangEntry`（`src/bridge.js:2687`、`src/bridge.js:2717`）；考究轮 `buildResearchPrompt`（`src/bridge.js:2755`）；注入 `buildSlangContext`（`src/bridge.js:2870`、`src/bridge.js:5527`）。

**边界与失败模式**
- 读坏会抛；桥接把 `slangStoreWritable` 置假，只读不写避免覆盖（`src/bridge.js:1771-1793`）。
- 保存再次归一化并裁剪，返回 `{entries,dropped}`（`src/slang-learner.js:142-157`）。
- 证据按 `JSON.stringify` 去重，带时间戳的「重复」仍各占一条，所以有 20 条上限（`src/slang-learner.js:41-44`、`src/slang-learner.js:202-213`）。
- 超长文本（>400k）直接返回 null，避免 O(n²) 卡事件循环（`src/slang-learner.js:308-314`）。

---

## 3. QQ 文本适配与协议

### 3.1 `md-to-plain.js`（117 行）

**职责**
把 agent 的 Markdown 回复转成适合 QQ 的纯文本，并提供长度分条、按码点安全截断（含尾部）（`src/md-to-plain.js:1`、`src/md-to-plain.js:39`、`src/md-to-plain.js:69-80`、`src/md-to-plain.js:97-102`）。

**对外接口**
`mdToPlain(md)`（`src/md-to-plain.js:2-37`）、`splitForQQ(text,max=4000)`（`src/md-to-plain.js:40-67`）、`truncateText(value,max)`（`src/md-to-plain.js:81-95`）、`truncateTextTail(value,max)`（`src/md-to-plain.js:103-117`）。

**数据结构**
输入/输出都是字符串或字符串数组；`splitForQQ` 返回可直接发送的 `parts`（`src/md-to-plain.js:42-66`）。

**规则与算法**
*Markdown→纯文本*（按代码顺序，`src/md-to-plain.js:2-37`）：代码块去围栏保留内容；行内代码去反引号；图片保留 alt 或 url，链接变 `text (url)`；粗体/斜体/删除线去标记；标题/引用/无序列表（改 `• `）/有序列表；表格去分隔行与首尾竖线；连续空行折叠到最多一空行；最后 trim（`src/md-to-plain.js:5-36`）。图片/链接正则限制 alt≤500、url≤2000 且排除换行，避免大量 `![` 触发 O(n²)（`src/md-to-plain.js:9-11`）。单星号斜体要求不跨行、开闭内侧不能是空白，否则 `2 * 3 * 4` 会被吞（`src/md-to-plain.js:17-21`）。

*分条*：默认 4000；找 `max-1` 之前最后一个换行；找不到硬切；`eat=1` 把换行留给前段；切点在高代理上前移；被逼到 0 时至少吞一个完整码点（emoji 代理对吞 2），保证循环前进（`src/md-to-plain.js:44-63`）。它**不负责语义断句**，只保证不超长、不切坏字符。

*截断*：`max` 按码点；非有限数/0 返回空串；切点在高代理上前移；`limit=1` 且开头是代理对时保留 2 码元（`src/md-to-plain.js:81-95`）。尾部版切点在低代理上时，前面是高代理就一起留下，否则丢掉孤儿低代理（`src/md-to-plain.js:103-117`）。

**谁调用**
`src/bridge.js:20` 引入；发送前 `splitForQQ`（`src/bridge.js:8245`）；收到 `command.text` 时 `mdToPlain`（`src/bridge.js:11282`、`src/bridge.js:13942`）；回合结束 `mdToPlain(ended.text)`（`src/bridge.js:14359`）；`truncateText` 大量用于 200 字预览（`src/bridge.js:12139-12141`）。`src/forward.js:10`、`src/sticker-lib.js:17`、`src/slang-learner.js:14` 也复用 `truncateText`。

**边界与失败模式**
- 不完整 Markdown（缺闭标记）原样保留，不报错；不处理 HTML/CQ/@（发送层再做）。
- 无换行时会硬切成两段，长度安全优先（`src/md-to-plain.js:47-49`）。
- 代理对保护只覆盖切点正好在代理对中间，不修复本身畸形的孤立代理。

### 3.2 `qq-model-view.js`（80 行）

**职责**
只压缩「模型看到的视图」，不改存储、控制台/API 的原始消息（`src/qq-model-view.js:1-2`）。目的：减少重复字段、空字段、默认 false 字段和可推导媒体引用。

**对外接口**
`compactModelMessage(message)`（`src/qq-model-view.js:43-65`）、`compactModelData(data)`（`src/qq-model-view.js:67-76`）、`serializeModelData(data)`（`src/qq-model-view.js:78-80`）。

**数据结构**
只处理普通对象（原型 `Object.prototype` 或 null）与数组（`src/qq-model-view.js:11-15`）。可选字段集合 `seq,messageId,sender,userId,text,plain,tail,kind,ownerLabel,media,forwardIds,nestedForwardIds`；默认 false 可删字段 `quoteTargetIsSelf,isOwner,isSelf,hasMedia,hasForward`（`src/qq-model-view.js:3-9`）。

**规则与算法**
- `text/plain/tail` 内容相同的只保留第一个，后面的删；**不截断**，因为 plain 可能含引用上下文、tail 可能是长消息尾部（`src/qq-model-view.js:46-53`）。
- 可选字段为空（null/''/[]）删；默认 false 字段值为 false 删、true 留（`src/qq-model-view.js:54-59`）。
- 媒体：有本地正整数 `seq` 时说明可按消息解析，删 `file/url` 并补 `index`（从 1 开始，不重排）；否则保留 transport 引用；`file===url` 删 file；空 `file/url/faceId` 删（`src/qq-model-view.js:21-41`、`src/qq-model-view.js:60-63`）。

**谁调用**
`src/bridge.js:23` 引入，会话摘要逐条压缩（`src/bridge.js:12452`）；`src/mcp-snowluma-safe.js:21` 引入，几乎所有 QQ 工具返回都用 `serializeModelData`（如 `src/mcp-snowluma-safe.js:372`、`src/mcp-snowluma-safe.js:399`）。

**边界与失败模式**
- 非普通对象（Date/Buffer）原样返回，不递归（`src/qq-model-view.js:11-15`、`src/qq-model-view.js:67-69`）。
- 只删字段，不改语义；存储层仍保留完整消息（`src/qq-model-view.js:1-2`）。
- 媒体 index 仅在可按 seq 解析时补；转发节点保留 `messageSeq/messageId` 供上层用（`src/qq-model-view.js:24-35`）。

### 3.3 `forward.js`（231 行）

**职责**
合并转发纯函数：从 OneBot 消息段提取/清洗 forward id；把 `get_forward_msg` 返回格式化成 AI 易读结构；暴露图片/表情元数据与嵌套 forward id（`src/forward.js:1-9`）。id 只允许安全字符、长度受限；只格式化不访问网络；「id 必须来自当前会话已见消息」由调用方校验（`src/forward.js:6-8`）。

**对外接口**
`sanitizeForwardId(value)`（`src/forward.js:12-18`）、`forwardIdFromData(data)`（`src/forward.js:21-24`）、`extractForwardIds(segments)`（`src/forward.js:26-35`）、`nodeText(node)`（`src/forward.js:73-81`）、`formatForwardResponse(data,options)`（`src/forward.js:178-231`）。

**数据结构**
顶层 `{platform,source:'forwarded-chat-record',notice,total,truncated,textTruncated,messages[]}`（`src/forward.js:220-230`）。每条 `{index,sender,userId,time,messageId,messageSeq,text,media[],nestedForwardIds[]}`（`src/forward.js:208-218`）。媒体 `{kind:'image',file?,url?}` 或 `{kind:'face',faceId}`（`src/forward.js:144-157`）。

**规则与算法**
- id 白名单 `^[\w:.\-/=+@]+$`，≤256 字，拒绝空白/控制字符（`src/forward.js:12-18`）。
- 段文本：text 原样、at→`@QQ`/`@全体成员`、face→`[表情id]`、image→`[图片]`（动图/表情由桥接按证据标 `[动图]`/`[表情]`）、record→`[语音]`、video→`[视频]`、file→`[文件名]`、reply→`[引用]`、forward→`[转发]`、json/xml→`[链接卡片]标题 · 摘要 · URL`（解析失败才退回 `[卡片消息]`，见 `src/link-card.js`），未知→`[type]`（`src/forward.js:37-58`）。
- 字符串内容里的 CQ 码统一替换成 `[媒体]`（`src/forward.js:56-59`）。
- 节点兼容顶层 `message/content/text` 与 `data.*`，支持字符串、段数组、单 segment 对象（`src/forward.js:61-81`、`src/forward.js:126-142`）。
- 发送者名优先 sender.nickname/card/user_id，再 data.name/nickname/card/uin/user_id，最后 node.name/nickname；统一截 100 字（`src/forward.js:83-95`）。
- 每条正文按 `maxCharsPerMessage`（默认 500，夹 1–2000）截断，同样代理对保护；截断则 `textTruncated=true`；条数默认 50（夹 1–100）（`src/forward.js:179-205`）。
- **身份纠偏**：notice 明确「这是 QQ 合并转发的聊天记录，不是 B站 动态/评论，也不是刚发来的新消息；可能包含你自己以前在别处说过的话」（`src/forward.js:181-225`）。这是 2026-10-23 实测「转发记录被说成 B站 内容」后的修复（`src/forward.js:181-184`）。

**谁调用**
`src/bridge.js:35` 引入；解析转发 `formatForwardResponse`（`src/bridge.js:7522`），嵌套预览用更小上限（`src/bridge.js:7557`）；发送/读取前 `sanitizeForwardId`（`src/bridge.js:9589-9596`、`src/bridge.js:12118`）；收消息 `extractForwardIds`（`src/bridge.js:13099`）。插件工具也复用（`plugins/surfcore/tools/commands/share-dynamic.mjs`、`daily.mjs`）。

**边界与失败模式**
- 非法 id 返回空串；节点结构缺失返回空文本/空媒体，不抛（`src/forward.js:14-17`、`src/forward.js:73-80`、`src/forward.js:165-176`）。
- 只处理 `type==='forward'` 的段，其他段里的 id 不会误判（`src/forward.js:29-32`）。
- 不校验 id 是否属于当前会话，必须由调用方做（`src/forward.js:7-8`）。

### 3.4 `history-catchup.js`（144 行）

**职责**
上线补历史纯逻辑：掉线期间 SnowLuma 不补发，消息只在 QQ 历史里；重连时取最近几条，只并入「水位之后、本地没存过」的消息（`src/history-catchup.js:1-10`）。不碰网络、不读写文件。

**对外接口**
`DEFAULT_HISTORY_CATCHUP`（`src/history-catchup.js:12-19`）、`normalizeHistoryConfig(raw)`（`src/history-catchup.js:36-45`）、`historyWatermark(state,opts)`（`src/history-catchup.js:59-73`）、`selectMissedHistory(candidates,opts)`（`src/history-catchup.js:88-117`）、`summarizeHistoryCatchup(messages)`（`src/history-catchup.js:120-130`）、`buildHistoryCatchupLine(summary)`（`src/history-catchup.js:133-141`）、`HISTORY_MESSAGE_FLAG='history'`（`src/history-catchup.js:143-144`）。

**数据结构**
默认 `{enabled:true,limit:30,maxAgeMinutes:720,wake:true,includePrivate:true}`（`src/history-catchup.js:12-19`）；配置夹取条数 1–100、时长 1–10080 分钟（`src/history-catchup.js:36-45`）。候选必须是桥接归一化过的 `{messageId,time,userId,sender,text,plain,tail,isSelf,isOwner,media,forwardIds}`（`src/history-catchup.js:78-80`）。

**规则与算法**
- 水位 = `max(窗口下界,lastIncomingAt,lastHistoryMessageTime,recentMessages[].time) - tolerance`（默认 5 秒），再与窗口下界取 max（`src/history-catchup.js:59-73`）。减 5 秒是因为本地到达时间通常比 QQ 时间晚 1–3 秒，直接比较会漏掉停机前最后几条；重复由 messageId 去重兜底（`src/history-catchup.js:55-58`）。
- 过滤：messageId 非空；time 有效 >0、≥水位、≤now+2 分钟；已在 `existingIds` 跳过；发送者在 `blockedUsers` 跳过（黑名单不能借历史绕过）；按时间升序，超 limit 丢最旧（`src/history-catchup.js:103-116`）。
- 默认 `enabled=true`，因为用户要求「默认勾选打开」（`src/history-catchup.js:12-13`）。

**谁调用**
`src/bridge.js:25-26` 引入；启动配置归一化（`src/bridge.js:1119`）；控制台保存再归一化（`src/bridge.js:5334`）；补历史先算水位再 fetch（`src/bridge.js:13195`），再 `selectMissedHistory`（`src/bridge.js:13126`）、`summarizeHistoryCatchup`（`src/bridge.js:13179`）。

**边界与失败模式**
- 没有稳定 messageId 的候选跳过，无法去重（`src/history-catchup.js:105-106`）。
- 未来时间超 2 分钟视为时钟漂移丢弃（`src/history-catchup.js:99`、`src/history-catchup.js:108`）。
- 水位必须在 fetch **之前**算，避免 fetch 期间实时消息把水位推到现在、导致历史消息被误判太旧（`src/bridge.js:13190-13194`）。
- 不做节流/重试；桥接侧另有断线重连节流（`src/history-catchup.js:8`）。

### 3.5 `greeting-schedule.js`（119 行）

**职责**
早安问候的排程与文案纯函数；桥接只负责定时器和投递（`src/greeting-schedule.js:11-12`）。

**对外接口**
`GREETING_GRACE_MS` 3 小时、`GREETING_RETRY_MS` 10 分钟、`GREETING_CATCHUP_DELAY_MS` 5 秒（`src/greeting-schedule.js:14-19`）；`localDateKey(at)`（`src/greeting-schedule.js:21-24`）；`parseGreetingTime(value,fallback)`（`src/greeting-schedule.js:27-34`）；`planMorningGreeting(opts)` 返回 `{fireAt,mode}`（`src/greeting-schedule.js:41-68`）；`GREETING_THEMES`/`pickGreetingTheme`（`src/greeting-schedule.js:70-80`）；`buildMorningGreetingPrompt(opts)`（`src/greeting-schedule.js:90-119`）。

**数据结构**
无持久结构；`parseGreetingTime` 返回 `{hh,mm,text}`（`src/greeting-schedule.js:27-34`），`planMorningGreeting` 返回 `{fireAt:number,mode:'scheduled'|'catchup'|'retry'|'tomorrow'}`（`src/greeting-schedule.js:38-39`、`src/greeting-schedule.js:41-68`）。

**规则与算法**
`planMorningGreeting` 优先级（`src/greeting-schedule.js:49-67`）：今天已发→明天同一时刻 `tomorrow`；有 `retryDelayMs` 且在 3 小时窗口→`min(now+retry,target+grace)` `retry`；目标未到→`scheduled`；已过点但在窗口→`now+5秒` `catchup`；否则明天 `tomorrow`。提示词区分模式：`reserved2` 必须调用 `qq_send_private_message` 并带 userId/token，明确「纯文本不会自动发到 QQ，只输出文字等于没发」；其他模式直接输出文本（`src/greeting-schedule.js:108-117`）。补发时第一句写明「原定 X 点的早安没发出去，现在补一次」，避免模型误以为现在是早上八点（`src/greeting-schedule.js:101-103`）。

**谁调用**
`src/bridge.js:38-39` 引入；DSH 离线时按 10 分钟重试（`src/bridge.js:11140-11141`）；生成 prompt 传 `who/uin/time/theme/mode/catchUp/token`（`src/bridge.js:11149-11157`）；排程用 `planMorningGreeting` 并递归安排下一次（`src/bridge.js:11182-11194`）。

**边界与失败模式**
- 原生 `setHours` 在「启动时已过点」会排到明天，导致当天丢枪，所以有 `catchup` 分支（`src/greeting-schedule.js:4-9`）。
- reserved2 只输出文字不会发送，是第二个静默失败原因，已在 prompt 显式纠正（`src/greeting-schedule.js:85-88`、`src/greeting-schedule.js:108-113`）。
- `sentToday` 由桥接读状态文件判断，本模块不落盘（`src/bridge.js:11183-11188`）。

### 3.6 `v2-wait.js`（27 行）

**职责**
二代仿真判断「对方话可能没说完」的轻量工具；只是提示/软信号，最终是否等待、是否催话由 AI 决定（`src/v2-wait.js:1-2`）。

**对外接口**
`looksLikeUnfinished(text)`（`src/v2-wait.js:13-20`）、`UNFINISHED_PROMPT_REPLIES`（`src/v2-wait.js:23`）、`END_ROUND_WAIT_MIN_MS/MAX_MS` 5–10 分钟（`src/v2-wait.js:26-27`）。

**数据结构**
无结构体；输入是字符串，输出是布尔；常量分别是字符串数组与毫秒数（`src/v2-wait.js:23-27`）。

**规则与算法**
判定顺序（`src/v2-wait.js:13-20`）：空串 false；以终止标点/省略号结尾（`。！？!?…～~`）→ **false**（明确说完，优先级最高）；命中没说完结尾词（你知道/等一下/我跟你讲/但是/然后/就是/等等/回头/晚点…）→ true；以非终止标点（`，、；：,;:`）结尾→ true；其他 false。终止标点优先级最高，避免把真的说完了拖成等待（`src/v2-wait.js:10-11`）。

**谁调用**
`src/bridge.js:22` 引入；判断最后一条新消息是否没说完以决定等待（`src/bridge.js:7249`）；决定回复等待时长（`src/bridge.js:10109`）；状态位提示「对方可能没说完」（`src/bridge.js:12577`）。

**边界与失败模式**
- 纯启发式：反问句、列举句可能误判；只看最后一条文本，调用方自己决定用 tail/plain/text 哪个字段（`src/bridge.js:7249`）。

---

## 4. 预设、角色与敏感信息

### 4.1 `preset-prompt.js`（157 行）

**职责**
二代仿真预设提示词（`persona.prefix`）的读取与安全改写；只做纯文本/YAML 处理（`src/preset-prompt.js:1-9`）。它把「仿真提示词（行为/协议，改完需重启 DSH）」与「人格提示词（角色是谁，保存即生效）」分开（`src/preset-prompt.js:3-7`）。

**对外接口**
`PRESET_PERSONA_ID`/`PRESET_PROMPT_MAX_BYTES` 128KB（`src/preset-prompt.js:12-13`）、`PRESET_REQUIRED_MARKERS`（`src/preset-prompt.js:15-16`）、`PRESET_BLOCKING_SUBSTRINGS` 与 `_V1`（`src/preset-prompt.js:25-39`）、`PRESET_MIN_BODY_CHARS` 500（`src/preset-prompt.js:40`）、`presetBlockingSubstrings(preset)`（`src/preset-prompt.js:42-45`）、`presetPromptBlockers(content,preset)`（`src/preset-prompt.js:47-64`）、`locatePresetPromptBlock(text)`（`src/preset-prompt.js:70-93`）、`extractPresetPrefix(text)`（`src/preset-prompt.js:96-106`）、`presetPromptWarnings(content)`（`src/preset-prompt.js:109-117`）、`renderPresetPromptYaml(text,content,preset)`（`src/preset-prompt.js:129-157`）。

**数据结构**
`locatePresetPromptBlock` 返回 `{lines,entryStart,entryEnd,keyLine,keyIndent,blockEnd}`（`src/preset-prompt.js:67-69`、`src/preset-prompt.js:92`）。YAML 里 persona 是数组中的一个条目，提示词在 `entry.config.prefix`（`src/preset-prompt.js:96-105`）。

**规则与算法**
- 硬性不变量按代次分开：v2 要求「你没有本地工具 / 群友没有管理权限 / API 令牌 / 角色由桥接注入 / 不会自动发送到 QQ」；v1 只要求「群友没有管理权限 / API 令牌 / 角色扮演由系统注入」（`src/preset-prompt.js:25-39`）。原因：同一清单套两个预设会让一代 100% 存不进去（`src/preset-prompt.js:21-24`）。
- 正文 <500 字视为「可能被误删」，阻止保存（`src/preset-prompt.js:60-62`）。
- 定位块：先找 `^- id:` 后接空白再 `persona` 的整行；`entryEnd` 是下一条 `- ` 或文件尾；`prefix:` 必须是 `>|` 块标量；块尾只由真正的内容行推进，空行不提前结束；缩进 ≤ 键缩进即结束（`src/preset-prompt.js:70-93`）。
- 写回：统一换行、去尾部空行、按 UTF-8 字节限 128KB、先跑 blockers；沿用文件主导行尾；每行加 `keyIndent+2` 缩进；只有真空白行保留空行，只有空格/Tab 的行必须原样保留（否则 YAML 会当空行读回，导致校验失败）（`src/preset-prompt.js:129-150`）。
- **逐字回读校验**：写回后用 YAML 重新解析 `persona.prefix`；解析失败或与输入不完全一致就抛错、拒绝写入（`src/preset-prompt.js:151-155`）。这保证不管原文用 `>-` 还是 `|`，语义都不变。

**谁调用**
`src/bridge.js:15` 引入；读取 prefix 展示/比对（`src/bridge.js:514`）；保存前 warnings（`src/bridge.js:4351`）；保存时 `renderPresetPromptYaml`（`src/bridge.js:4374`）；还原时 `extractPresetPrefix` + `presetPromptBlockers`（`src/bridge.js:4432-4437`）。

**边界与失败模式**
- 找不到 `- id: persona` 或 `prefix:` 块 → 返回 null，写回抛「文件结构可能已变化」（`src/preset-prompt.js:72-82`、`src/preset-prompt.js:130-131`）。
- YAML 解析失败 → `extractPresetPrefix` 返回 null（`src/preset-prompt.js:98-102`）。
- 未知预设按更严的 v2 处理（`src/preset-prompt.js:42-45`）；warnings 只提示不阻断，真正阻断的是 blockers 与回读校验（`src/preset-prompt.js:109-117`）。

### 4.2 `role-card.js`（108 行）

**职责**
人格卡（`roles/<名称>.md`）解析与「按仿真模式取用」。一代用空格分条 + `[SILENT]`，二代必须用工具发言；同一张卡共用时一代专属指令会与二代协议冲突（`src/role-card.js:1-8`）。改为显式标记：标题写 `〔二代〕`/`〔一代〕`，桥接只取当前模式适用的小节（`src/role-card.js:9-13`）。

**对外接口**
`ROLE_INJECT_MODES`（`src/role-card.js:14`）、`parseRoleSections(text)`（`src/role-card.js:43-61`）、`selectRoleText(text,mode)`（`src/role-card.js:67-75`）、`roleSectionReport(text,mode)`（`src/role-card.js:81-89`）、`roleCharStats(text)`（`src/role-card.js:92-104`）、`GEN1_ROLE_LINE_RE`（`src/role-card.js:106-108`）。

**数据结构**
小节对象 `{mode:'all'|'v1'|'v2',heading:string|null,lines:string[]}`；无标题的开头部分 `heading:null`（`src/role-card.js:39-42`、`src/role-card.js:46-59`）。统计对象 `{total,common,v1Only,v2Only,v1,v2}`（`src/role-card.js:92-104`）。

**规则与算法**
- 模式标记认 `〔二代〕`、`[v2]`、`（reserved2）`、`(2代)` 等；一代认 `〔一代〕`、`[v1]`、`（reserved）` 等（`src/role-card.js:16-20`）。
- 标题匹配 `^#{1,6}\s+`；无标题的开头部分成为 `mode:'all'` 小节；每节 `lines` 首行是「# 标题（已剥离标记）」，`heading` 是剥离后标题（`src/role-card.js:46-59`）。
- `selectRoleText` 只保留 `mode==='all'` 或目标模式，拼接后折叠 3 个以上换行（`src/role-card.js:67-75`）。
- `roleSectionReport` 给控制台预览；`roleCharStats` 给「去掉另一模式后还剩多少」（`src/role-card.js:77-104`）。
- `GEN1_ROLE_LINE_RE` 命中 `[SILENT]`、空格分句、自动转发等；未加标记时桥接用它兜底过滤（`src/role-card.js:106-108`、`src/bridge.js:388-398`）。

**谁调用**
`src/bridge.js:16` 引入；保存角色卡时算统计、检测未标记的一代遗留（`src/bridge.js:388-413`）；控制台预览返回 stats/sections（`src/bridge.js:4263-4265`）；每条提示词按当前模式 `selectRoleText`（`src/bridge.js:11597`）。`scripts/console-ui-fixture.mjs` 也用它生成演示数据。

**边界与失败模式**
- 标记只从标题剥离，不改进正文；正文里再出现 `[SILENT]` 仍需 `GEN1_ROLE_LINE_RE` 兜底（`src/bridge.js:11881`）。
- 无标题文件整体作为 `all` 注入；未知 mode 一律按 v2（`src/role-card.js:68`）。

### 4.3 `sensitive.js`（15 行）

**职责**
共享的敏感信息审计正则：桥接回复、MCP 发送、审批/提问文本统一使用，避免两处维护不一致（`src/sensitive.js:1-3`）。

**对外接口**
`SENSITIVE_RE`（唯一导出，`src/sensitive.js:15`）。

**数据结构**
无结构化数据；正则带 `i`、无 `g`（`src/sensitive.js:15`）；桥接替换所有命中时动态补 `g`（`src/bridge.js:656-662`）。

**规则与算法**
命中四类：Windows 盘符路径（前面不能是字母数字）、UNC 路径、POSIX 常见目录前缀（`/home/`、`/Users/`、`/etc/`、`/var/`、`/root/`）、凭据赋值（token/密码/密钥/口令/password/passwd/secret/api_key/authorization/bearer/access_key/credential 后跟 `:=：` 或「是/为」，或空白后跟 3 位以上值）（`src/sensitive.js:4-14`）。注释明确：这是内容审计启发式，不能代替会话权限控制；已知令牌原文由桥接 `KNOWN_AGENT_TOKENS` 精确名单负责，因为 32 位十六进制裸令牌不匹配本正则；**不要**加 `[0-9a-f]{32}`，否则表情 md5、图片 URL 会被误杀（`src/sensitive.js:6-14`）。

**谁调用**
`src/bridge.js:21` 引入；日志/反馈脱敏用动态 `g` 版本（`src/bridge.js:656-662`）；出站审计在 `shouldAuditKey(key)` 为真时拦截（`src/bridge.js:1902`、`src/bridge.js:9071`）；控制台/MCP 发送前拦截（`src/bridge.js:5001`、`src/bridge.js:5995`、`src/bridge.js:6130`、`src/bridge.js:7987`）；错误/提问/审批摘要脱敏（`src/bridge.js:14406`、`src/bridge.js:14509`、`src/bridge.js:14575-14602`）。`src/mcp-snowluma-safe.js:17` 说明 MCP 侧不重复实现，所有 QQ 发送都经桥接 HTTP API。

**边界与失败模式**
- 只能抓「长得像路径/像凭据赋值」的文本；裸 32-hex 会话令牌抓不到，必须走精确名单（`src/sensitive.js:6-11`）。
- 可能误伤正常聊天（如「我的密码是 123」被打码），这是内容审计的故意取舍。
- 只在 `shouldAuditKey` 的会话上启用，不是全局强制（`src/bridge.js:5001` 等调用条件）。

---

## 5. 出站网络

### 5.1 `safe-fetch.js`（385 行）

**职责**
只读 HTTP(S) 安全抓取：仅 http/https；禁止 localhost/.local/私有 IP/环回/链路本地/CGNAT；域名先 DNS 解析并检查**全部**结果；手动跟随重定向、每跳重新校验；响应体限量、总时限（`src/safe-fetch.js:1-7`）。

**对外接口**
`isPrivateIp(ip)`（`src/safe-fetch.js:66-110`）、`resolveSafeAddresses(hostname)`（`src/safe-fetch.js:136-160`）、`resolveSafeHost(hostname)`（`src/safe-fetch.js:162-165`）、`validateFetchUrl(raw)`（`src/safe-fetch.js:167-178`）、`safeFetch(urlString,maxChars=50000)`（`src/safe-fetch.js:330-351`）、`looksLikeImageBuffer(buf)`（`src/safe-fetch.js:353-361`）、`safeFetchBuffer(urlString,maxBytes=8MB)`（`src/safe-fetch.js:363-385`）。

**数据结构**
`validateFetchUrl` 返回 `{url:URL,ip,addresses}`；`safeFetch` 返回 `{url,statusCode,truncated,body}`；`safeFetchBuffer` 返回 `{url,statusCode,buffer}`（`src/safe-fetch.js:167-178`、`src/safe-fetch.js:342-348`、`src/safe-fetch.js:382`）。

**规则与算法**
下面按 SSRF 攻击面逐项列出。

1. **协议与凭据**：只允许 `http:`/`https:`；URL 内嵌 username/password 拒绝；hostname 去方括号/末尾点、转小写（`src/safe-fetch.js:137`、`src/safe-fetch.js:174-175`）。
2. **本机名**：`localhost`、`*.localhost`、`*.local` 拒绝（`src/safe-fetch.js:139-141`）。
3. **字面 IP**：IP 字面量直接 `isPrivateIp`，合法公网才返回（`src/safe-fetch.js:142-145`）。
4. **DNS 重绑定**：域名 `dns.lookup(...,{all:true,verbatim:true})`，5 秒超时；**每一个**解析结果都必须是公网，否则整域名拒绝（`src/safe-fetch.js:146-157`）。
5. **IPv4 内网/保留**：`10/8`、`127/8`、`0/8`、`169.254/16`、`172.16/12`、`192.168/16`、`100.64/10`（CGNAT）、`198.18/15`、`192.0.0/24`、`≥224`（`src/safe-fetch.js:73-85`）。
6. **IPv6**：非法 IP/带 zone 拒绝；`::`/`::1`、`fc/fd`、`fe80/10`、`fec0::/10`、`64:ff9b:1::/48`、`2001:db8`、`2001:2:/2001:10:/2001:20:`、`2002::/16`（6to4 内嵌 IPv4 再判）、`ff00::/8` 都拒绝（`src/safe-fetch.js:67-70`、`src/safe-fetch.js:88-106`）。
7. **IPv4 内嵌 IPv6**：解析 `::ffff:a.b.c.d`、`::ffff:0:7f00:1`、`::c0a8:101`、NAT64 `64:ff9b::c0a8:101`、6to4 等，抽出内嵌 IPv4 递归判（`src/safe-fetch.js:24-64`、`src/safe-fetch.js:95-104`）。
8. **连接固定、不重解析**：直接连已校验 IP，`host` 头与 TLS SNI 仍用原域名（`src/safe-fetch.js:218-231`）。DNS 在校验后连接前被换也没用。
9. **多地址容灾**：IPv4 优先、v4/v6 交替（`src/safe-fetch.js:123-133`）；最多 4 个地址；网络层失败才换下一个，策略性拒绝（图片超限）不重试（`src/safe-fetch.js:180-184`、`src/safe-fetch.js:303-328`）。
10. **超时**：总 20 秒；多地址单次 8 秒；单地址用总预算，避免慢速滴流被过早切断（`src/safe-fetch.js:180-184`、`src/safe-fetch.js:306-315`）。
11. **重定向**：手动跟随最多 5 跳；每跳重新 `validateFetchUrl`；重定向体不下载；缺 Location 抛错（`src/safe-fetch.js:330-351`、`src/safe-fetch.js:241-245`）。
12. **响应体**：文本按码点累计到 maxChars，超出标 `truncated` 并销毁；二进制超 maxBytes 抛「图片超过大小限制」且不重试（`src/safe-fetch.js:247-278`）。
13. **内容类型**：文本不信任 MIME；图片靠 magic bytes，HTTP 必须 2xx（`src/safe-fetch.js:353-361`、`src/safe-fetch.js:376-381`）。
14. **不做的**：只发 GET；不带 Cookie/Authorization；不解析 HTML；不执行 JS。防护覆盖网络层可达性，不覆盖公网内容本身恶意。

**谁调用**
`src/bridge.js:28` 引入 `safeFetchBuffer/looksLikeImageBuffer`；图片/表情抓取（`src/bridge.js:2388`、`src/bridge.js:6322`、`src/bridge.js:8738`、`src/bridge.js:8767`、`src/bridge.js:8810`）；`src/mcp-web-search-safe.js:81` 的 `web_fetch` 调 `safeFetch`。

**边界与失败模式**
- DNS 解析失败/无结果/任一结果内网都拒绝；`isPrivateIp` 对非法 IP 返回 true（默认拒绝）（`src/safe-fetch.js:67-70`、`src/safe-fetch.js:146-157`）。
- 多地址全失败抛最后一个错误，并附「已尝试 N 个地址」（`src/safe-fetch.js:324-327`）。
- 重定向到内网在下一跳校验时被拒（`src/safe-fetch.js:338-340`）。
- 文本截断按码点，不切坏 emoji（`src/safe-fetch.js:250-258`）。

### 5.2 `web-search.js`（496 行）

**职责**
MCP `web_search` 的实现：优先 DSH 同源的 DeepSeek 联网搜索（同一端点/模型/服务端 `web_search_20250305` 工具），失败回退 Bing（RSS 优先，HTML 兜底）（`src/web-search.js:1-23`）。安全边界：API key 只发往校验过的 HTTPS 公网端点；不跟随重定向；key 不写日志/不进错误/不进结果（`src/web-search.js:18-23`）。

**对外接口**
`loadSearchConfig(root)`（`src/web-search.js:62-82`）、`resolveDshHome()`（`src/web-search.js:85-87`）、`readDshCredential(ref)`（`src/web-search.js:93-103`）、`resolveSearchApiKey(config)`（`src/web-search.js:106-115`）、`mapDeepSeekResponse(response,maxResults)`（`src/web-search.js:134-170`）、`deepseekSearch(query,config)`（`src/web-search.js:289-342`）、`parseBingRss(xml,maxResults)`（`src/web-search.js:372-386`）、`parseBingHtml(html,maxResults)`（`src/web-search.js:389-407`）、`bingSearch(query,config)`（`src/web-search.js:410-433`）、`clearSearchCache()`（`src/web-search.js:437-439`）、`webSearch(query,options)`（`src/web-search.js:445-496`）。

**数据结构**
默认配置 `{provider:'auto',apiKey:'',apiKeyEnv:'DEEPSEEK_API_KEY',model:'deepseek-v4-flash',maxUses:5,maxTokens:4096,maxResults:8,timeoutMs:35000}`（`src/web-search.js:43-53`）。结果条目 `{title,url,snippet?,publishedAt?}`；统一返回 `{query,provider,results,fallbackFrom?,note?}`（`src/web-search.js:160-165`、`src/web-search.js:441-443`）。

**规则与算法**
- **Key 顺序**：`config.apiKey` → 环境变量（名可配）→ DSH `.credentials.yaml` 的 `refs.<ref>`；返回 `{key,source}`，key 只在此出现（`src/web-search.js:106-115`）。
- **端点校验**：必须 `https:`；无内嵌凭据；`resolveSafeAddresses` 校验公网（`src/web-search.js:173-184`）。
- **POST**：直接连已校验地址，SNI/Host 用域名；拒绝 3xx；响应体最大 2MB；总超时；网络层失败最多换 2 个地址（`src/web-search.js:191-286`、`src/web-search.js:227-231`）。
- **请求体**：`model` + `max_tokens` + 一条 user 消息「Perform a web search for the query: ...」+ `tools:[{type:'web_search_20250305',name:'web_search',max_uses}]`；头带 `x-api-key`、`authorization: Bearer`、`anthropic-version`（`src/web-search.js:296-320`）。
- **响应映射**：只认 `web_search_tool_result`，没有就抛 `NO_RESULT_BLOCK`；文本块 `citations` 按 URL 聚合成 snippet；去重、标题 200 字、snippet 500 字、可带 `page_age`（`src/web-search.js:133-170`）。
- **Bing**：RSS 带 `format=rss&count&setlang=zh-hans&cc=CN`；RSS 失败/空再抓 HTML；都走 `safeFetch`；实体解码、去标签、去重、限量（`src/web-search.js:344-433`）。
- **缓存**：key `provider|query|maxResults`，TTL 5 分钟，最多 64 条（`src/web-search.js:435`、`src/web-search.js:450-452`、`src/web-search.js:491-494`）。
- **空结果说明**：0 条时加 note「没有搜到结果（可换个说法/加限定词；仍为空就不要再重复搜索）」，必须在 `cache.set` 之前拼好，否则缓存里是没有 note 的旧对象（`src/web-search.js:483-491`）。
- **回退说明**：DeepSeek 失败但 Bing 成功返回 `fallbackFrom:'deepseek'` 与 note；两边都失败时带出两边原因（`src/web-search.js:469-481`）。

**谁调用**
`src/mcp-web-search-safe.js:64` 调 `webSearch(clean,{root})`；`web_fetch` 用 `safeFetch`（`src/mcp-web-search-safe.js:81`）。

**边界与失败模式**
- 没有 key 抛 `NO_KEY`；`auto` 回退 Bing；`provider='deepseek'` 不自动回退（`src/web-search.js:290-293`、`src/web-search.js:464-467`）。
- HTTP 非 2xx 只回显状态与响应体短错误，绝不拼请求头（`src/web-search.js:322-334`）。
- 响应不是 JSON / 缺结果块有稳定 code（`BAD_BODY`/`NO_RESULT_BLOCK`）（`src/web-search.js:335-341`、`src/web-search.js:136-139`）。
- Bing 也失败时抛合并错误，而不是只报 Bing（`src/web-search.js:475-479`）。
- 查询词清洗在 MCP 层（去 CQ 码/控制字符/120 字截断），本模块只 trim 与空检查（`src/mcp-web-search-safe.js:52-59`、`src/web-search.js:446-447`）。

---

## 6. DSH 与 SnowLuma 接入

### 6.1 `dsh-client.js`（978 行）

**职责**
Node 环境的 DSH Web API 客户端：RPC 方法名与 `{args}` 包装、浏览器会话鉴权、`/api/remote.mux` 事件流、会话 follow 重放、inbox 队列读取/清理、turn 文本收集（`src/dsh-client.js:1-10`）。

**对外接口**
`resolveDshHome`（`src/dsh-client.js:18-21`）、`discoverDshLaunchToken`（`src/dsh-client.js:36-63`）、`readBrowserSessionSecret`（`src/dsh-client.js:97-110`）、`mintBrowserSessionCookie`（`src/dsh-client.js:119-130`）、`discoverDshSessionCookie`（`src/dsh-client.js:136-144`）、`isLoopbackBase`（`src/dsh-client.js:153-164`）、`FOLLOW_SNAPSHOT_MESSAGES=200`（`src/dsh-client.js:200`）、`inboxItemsOfProjections`（`src/dsh-client.js:220-236`）、`inboxItemIds`（`src/dsh-client.js:243-249`）、`controlBaselineInboxItems`（`src/dsh-client.js:259-266`）、`NodeApiClient`（`src/dsh-client.js:296-922`）、`unwrap`（`src/dsh-client.js:924-929`）、`createTurnCollector`（`src/dsh-client.js:931-970`）、`blocksToText`（`src/dsh-client.js:972-978`）。

**数据结构**
RPC 信封 `{type:'client-request',rpcId,method,payload:{args}}`；响应必须是 `server-response`、rpcId 匹配、有 `result`（`src/dsh-client.js:599-615`）。`session/follow` 用 `streamId→sessionId` 映射（`src/dsh-client.js:699-701`、`src/dsh-client.js:717-720`）。事件帧有 `item`（session/event、session/snapshot、$events 的 ready/waterfall）、`end`、`error`（`src/dsh-client.js:773-889`）。

**规则与算法**

*DSH 鉴权链路（launch token / cookie）*：

1. **launch token 发现**（兜底）：环境变量 `DSH_LAUNCH_TOKEN` 必须匹配 16 位以上 `[A-Za-z0-9_-]`；否则扫描 `<DSH home>/logs` 与 `<DSH home>/guard/logs` 下 `server-*.log`/`server-*.out.log`，按 mtime 从新到旧取第一个 `?token=`/`&token=` 值（`src/dsh-client.js:36-63`）。注释明确新 DSH 的启动 token 是进程内随机数、不落盘、不可推导，读日志只是最后兜底（`src/dsh-client.js:24-35`）。
2. **持久化签名密钥**：读 `<DSH home>/.credentials.yaml` 的 `records['client-connection/browser-session']`；要求 `kind==='grant'`、`payload.version===1`、secret 是 base64url 且解码后正好 32 字节；不符/读不到返回 null，调用方回退 token 交换（`src/dsh-client.js:81-110`）。
3. **离线铸造 Cookie**：`authority=new URL(baseUrl).host`；payload `{version:1,authority,issuedAt,expiresAt}` 的 base64url JSON；签名 `HMAC-SHA256(secret,body)` 再 base64url；Cookie 名 `dsh-auth-` + base64url(SHA256(authority))；值 `v1.<body>.<signature>`（`src/dsh-client.js:119-130`）。这正是 DSH 服务端 `isAuthenticated` 要求的形状（注释列三个校验条件，`src/dsh-client.js:72-79`）。
4. **有效期与刷新**：默认 1 小时；到期前 5 分钟主动重铸，避免先撞 401（`src/dsh-client.js:85-88`、`src/dsh-client.js:381-384`）。
5. **优先级**：默认**铸造优先**，不依赖启动器日志、不随 DSH 重启失效；两个例外：用户在 `config.json` 显式填了 `dsh.authToken`（`tokenExplicit`），或铸造刚被 401（`_preferToken`）（`src/dsh-client.js:309-316`、`src/dsh-client.js:390-394`）。
6. **只对回环铸造/发 token**：铸造要求密钥非空且 `isLoopbackBase`；launch token 交换默认只允许回环，远程 DSH 需显式 `dsh.allowRemote`（`src/dsh-client.js:387-408`）。原因：launch token 是进程启动凭据，交换时必须放进 URL 查询串，发往非回环等于交给中间人/代理日志（`src/dsh-client.js:146-152`、`src/dsh-client.js:404-408`）。
7. **token 交换**：GET 基址带 `?token=`，`redirect:'manual'`，取 `set-cookie` 第一段；交换期间 epoch 变化则丢弃结果；`cookiePromise` 单飞（`src/dsh-client.js:411-433`）。
8. **401 策略切换**：只在真收到 401 时决定——铸造被 401 → 改用 launch token；token 交换被 401 → 改回铸造；同一旧 Cookie 的并发 401 只触发一次换票（`src/dsh-client.js:578-588`）。token 交换失败（过期）也清偏好并重试一次（`src/dsh-client.js:565-572`）。`invalidateAuth` 刻意不碰 `_preferToken`，因为 WS 抖动/重启也会调用它（`src/dsh-client.js:329-343`）。
9. **WS 鉴权**：`remote.mux` 用 `new WebSocket(url,{headers:{cookie:this.cookie}})`（`src/dsh-client.js:690-692`）；follow 流也在同一 socket（`src/dsh-client.js:715-745`）。

*RPC 与事件流*：点号方法名转斜杠（`session.list`→`session/list`）（`src/dsh-client.js:191-193`）；`METHOD_ARG_WRAPPERS` 决定 `_request`/`request`/空 args（`src/dsh-client.js:167-188`）；`session/prompt` 自动补 `requestId`（`src/dsh-client.js:273-275`）；`callUnary` 只解析最外层信封（`src/dsh-client.js:592-615`）；`respond` 新版走 `$events/result`、旧版走 `/api/respond`（`src/dsh-client.js:622-638`）。

*事件流与重连*：`_desiredFollows` 跨重连保留，`follow` 先记账再发送（`src/dsh-client.js:676-682`）；socket open 时重放**全部**期望 follow（`src/dsh-client.js:763-770`）；`$events` 先收 ready 的 `clientId`，再处理 `approval/request` 与 `user-questions/request`（`src/dsh-client.js:785-821`）；单会话 `snapshot` 单独作为 `session/snapshot` 下发，避免历史 turn/end 被当新回合（`src/dsh-client.js:833-845`）；单会话流被服务端 `end` 且仍在期望集合时，2 秒后重开，`session/not-found` 才永久 forget（`src/dsh-client.js:847-887`）；流结束/错误/abort 都 `invalidateAuth()`，下次重连重新换票（`src/dsh-client.js:707-714`、`src/dsh-client.js:890-901`）。

*inbox 队列*：0.2.0 投影 `{inbox:{'next-turn':[],'next-step':[]}}`，每项带 `id`；0.1.7 的 `value.queues[sessionId]` 已废弃（`src/dsh-client.js:202-218`）。`inboxItemsOfProjections`：inbox 缺失=无待处理；存在但结构不对→抛错，绝不静默漏消息（`src/dsh-client.js:220-236`）。`inboxItemIds`：任一项缺字符串 id→抛错（`src/dsh-client.js:238-249`）。`controlBaselineInboxItems`：baseline 没有该会话=无待处理；投影表结构不符→抛错（`src/dsh-client.js:251-266`）。`stopSessionWork` 先逐个 `session/updateQueue {action:{kind:'remove'}}` 再 `session/cancel`；`queue-item-not-found` 与 `session/not-found` 可忽略（`src/dsh-client.js:440-474`）。`_readSessionQueue` 优先一元 RPC `session/projections`，endpoint 不存在才回退 `session/control` 的 baseline（`src/dsh-client.js:476-554`）。

**谁调用**
`src/bridge.js:19` 引入；启动构造 `NodeApiClient`（`src/bridge.js:2946-2955`）；`discoverDshLaunchToken` 补 `authToken`（`src/bridge.js:1136`）；`createTurnCollector` 收集回合文本（`src/bridge.js:3103`、`src/bridge.js:14132`）；退役会话 `stopSessionWork`（`src/bridge.js:3318`、`src/bridge.js:8084`、`src/bridge.js:13594`）。`src/self-test.js:12` 与多个 `scripts/test-dsh-*.mjs`、UI 快照脚本直接用。

**边界与失败模式**
- 没有任何鉴权手段时 `ensureAuth` 抛带配置指引的中文错误，而不是发匿名请求（`src/dsh-client.js:397-402`）。
- 非回环 + 未 `allowRemote` 拒绝发送 launch token（`src/dsh-client.js:407-408`）。
- `hasAuth()` 为假时请求按匿名发出，由服务端 401，而不是客户端提前抛错（`src/dsh-client.js:351-357`）。
- WS 帧格式不合法只打日志并丢弃，不结束整条流（`src/dsh-client.js:773-782`）。
- 鉴权是 bearer 语义：拿到 Cookie 即同等会话权限；离线铸造没有提权，只是绕开「启动日志有没有记 token」（`src/dsh-client.js:77-80`）。

### 6.2 `dsh-port.js`（88 行）

**职责**
找「当前正在运行的 DSH」Web 地址。DSH 桌面端每次启动挑空闲回环端口，而会话 Cookie 把 host:port 绑进签名，端口错只会 401；表现是「QQ 有消息、DSH 没反应」（`src/dsh-port.js:1-9`）。

**对外接口**
`listeningLoopbackPorts()`（`src/dsh-port.js:14-31`）、`looksLikeDsh(port,timeoutMs)`（`src/dsh-port.js:46-48`）、`discoverDshBaseUrl()`（`src/dsh-port.js:51-62`）、`probeDshBaseUrl(baseUrl,timeoutMs)`（`src/dsh-port.js:71-83`）、`isLoopbackBaseUrl(baseUrl)`（`src/dsh-port.js:86-88`）。

**数据结构**
`listeningLoopbackPorts` 返回 `{port:number,pid:string}[]`（`src/dsh-port.js:28-30`）；`discoverDshBaseUrl` 返回 `http://<回环>:<port>` 或 `null`（`src/dsh-port.js:50-62`）；`probeDshBaseUrl` 返回布尔（`src/dsh-port.js:71-83`）。

**规则与算法**
- Windows 用 `netstat -ano -p TCP` 只留 LISTENING 且本地地址为 `127.0.0.1` 的行；`tasklist /fo csv /nh` 取 pid→进程名，过滤 `/harness|dsh/i`，去重后逐个探测（`src/dsh-port.js:14-62`）。
- 非 Windows 直接返回 null，不做进程枚举（`src/dsh-port.js:52`）。
- `probeDshBaseUrl`：GET `/`；401 直接认；200 必须 `server` 头含 `dsh`，否则回环上别的 Web 服务会被误认，导致消息投错（`src/dsh-port.js:64-83`）。
- 远程 DSH 不能被本地探测覆盖（`src/dsh-port.js:85`）。

**谁调用**
`src/bridge.js:29` 引入；启动时若 `DSH_WEB_URL` 未设置且配置是回环，先 `probeDshBaseUrl`，失败再 `discoverDshBaseUrl`，找到就改配置并写回 `config.json`（`src/bridge.js:2928-2944`）。`scripts/sync-dsh-port.mjs:17/34` 用它写回端口。

**边界与失败模式**
- `execSync` 失败返回空数组/null，不抛（`src/dsh-port.js:18-25`、`src/dsh-port.js:33-42`）。
- 进程名不含 dsh/harness 或监听地址不是回环时找不到；桥接日志提示「QQ 消息会排队等待」（`src/bridge.js:2941-2942`）。
- 探测超时默认 1.5–2 秒，慢启动 DSH 可能暂时认不出（`src/dsh-port.js:46`、`src/dsh-port.js:71`）。

### 6.3 `snowluma-conn.js`（223 行）

**职责**
SnowLuma 连接自发现：换 QQ 账号后 token 变了工具就 401。SnowLuma 的 OneBot 配置按账号分文件，每个账号各有 HTTP 与 WebSocket 两套 token/端口；本模块不猜，拿候选 token 真去问 `get_login_info`，谁通就用谁，并回报当前账号（`src/snowluma-conn.js:1-15`）。

**对外接口**
`snowLumaHomeCandidates({cfg})`（`src/snowluma-conn.js:27-35`）、`readOneBotTokens(homeDir)`（`src/snowluma-conn.js:45-74`）、`readOneBotHttpTokens(homeDir)`（`src/snowluma-conn.js:77-81`）、`discoverSnowLumaConnection(opts)`（`src/snowluma-conn.js:110-173`）、`persistToken(cfgPath,newToken)`（`src/snowluma-conn.js:184-190`）、`persistSnowLumaEndpoint(cfgPath,{accessToken,wsUrl,httpUrl})`（`src/snowluma-conn.js:197-223`）。

**数据结构**
每账号 `{uin,file,http:{token,host,port},ws:{token,host,port}}`；HTTP 默认 3000、WS 默认 3001（`src/snowluma-conn.js:63-68`）。发现成功返回 `{ok,token,baseUrl,self,source,wsToken,wsUrl,tried}`；失败返回 `{ok:false,tried,baseUrl,error}`（`src/snowluma-conn.js:152-172`）。

**规则与算法**
- 候选顺序：显式 token/环境变量/config 优先，然后 per-account HTTP token；去重键 `url|token`（`src/snowluma-conn.js:120-141`）。
- 探活：POST `/get_login_info`，带 Bearer；要求 HTTP ok、body `status==='ok'` 且 `retcode===0`（`src/snowluma-conn.js:84-102`）。
- `tried` 里 token 只显示前 4 位 + `…`，避免日志泄漏（`src/snowluma-conn.js:146`）。
- 命中后按 `onebot_<uin>.json` 或 `data.user_id` 找同账号 WS 信息一并返回；桥接走 WS，用另一套 token/端口（`src/snowluma-conn.js:147-161`）。
- 写回配置：只写 `accessToken/wsUrl/httpUrl` 中传入且不同的字段；全同则不写；读时吃 BOM，写回时原样补回，避免字节级静默改动（`src/snowluma-conn.js:197-222`）。`persistToken` 是兼容包装（`src/snowluma-conn.js:180-190`）。

**谁调用**
`src/bridge.js:32` 引入；SnowLuma 自愈/重连时 `discoverSnowLumaConnection`（`src/bridge.js:14828`）并 `persistSnowLumaEndpoint` 写回（`src/bridge.js:14794`）。`scripts/probe-snowluma-heartbeat.mjs`、`scripts/test-snowluma-conn.mjs` 也使用。

**边界与失败模式**
- 配置目录不存在/单文件损坏只跳过，不影响其他账号（`src/snowluma-conn.js:46-71`）。
- 全失败时区分「全 401」与「连不上」，给可操作提示（`src/snowluma-conn.js:164-172`）。
- 写回直接改用户 `config.json`，没有原子写/备份；只在字段变化时写（`src/snowluma-conn.js:215-222`）。

### 6.4 `self-test.js`（118 行）

**职责**
不依赖 SnowLuma/QQ，只验证 DSH 侧链路：连接 Web API → 创建独立测试会话 → 订阅事件流 → 注入消息 → 等回复 → 归档会话（`src/self-test.js:1-7`）。

**对外接口**
无导出；脚本运行 `node src/self-test.js [baseUrl]`（`src/self-test.js:6-7`）。内部 `cleanupSelfTestSession()` 归档测试会话，失败只警告（`src/self-test.js:26-36`）。

**数据结构**
无持久结构；会话 id 存模块级变量，退出前清空（`src/self-test.js:17-19`、`src/self-test.js:28-30`）。

**规则与算法**
- 鉴权从 `config.json` 的 `dsh.authToken` 或 `discoverDshLaunchToken()` 取；取不到也给空 auth（`src/self-test.js:40-48`）。
- `settings.describe` 验证连通（`src/self-test.js:53`）。
- 测试会话 cwd 用**系统临时目录**而不是仓库 `state/`：`state/` 已被 ACL 收紧，DSH 沙箱能力 SID 不在 ACL 里，在沙箱内跑自检会 EPERM 建目录（`src/self-test.js:56-61`）。
- 必须先订阅事件流、等 WebSocket open（10 秒超时）再 `prompt`，否则 turn 事件可能漏掉（`src/self-test.js:67-76`、`src/self-test.js:98-100`）。
- 默认 prompt「只回复两个字：收到」；60 秒等不到 `turn/end` 就失败（`src/self-test.js:51`、`src/self-test.js:78`）。
- 成功/失败都归档；成功 `exit 0`，失败 `exit 1`（`src/self-test.js:109-118`）。

**谁调用**
`package.json:18` 的 `self-test` 脚本。

**边界与失败模式**
- 默认 baseUrl 是回环 3080；DSH 端口漂移时需手动传参，或先同步端口（`src/self-test.js:39`）。
- 不指定 agentPreset，会带 DSH 默认 preset（含 bash/文件工具），所以必须归档，不能让它在用户 DSH 里累积（`src/self-test.js:21-25`）。
- 归档失败只警告，不改变退出码（`src/self-test.js:31-35`）。

---

## 7. 语音内核

### 7.1 `voice-core.js`（469 行）

**职责**
语音发送共享内核：音频来源解析、库内安全路径、ffprobe 探测、发送前校验、目标 key 解析、上传名净化、音量/响度处理、临时文件清理；独立工具与桥接共用同一份规则（`src/voice-core.js:1-7`）。ffprobe 结果**写临时文件**而不是走 stdout 管道，因为受限沙箱里 `stdio:pipe` 子进程会 EPERM，而「继承 stdio + 写文件」允许（`src/voice-core.js:8-10`）。

**对外接口**
`AUDIO_EXTS`（`src/voice-core.js:16-20`）、`DEFAULT_MAX_BYTES/DEFAULT_MAX_SECONDS` 20MB/300s（`src/voice-core.js:25-26`）、`isAudioFile`（`src/voice-core.js:28-30`）、`formatBytes/formatDuration`（`src/voice-core.js:32-44`）、`listAudioFiles`（`src/voice-core.js:47-66`）、`resolveAudioSource`（`src/voice-core.js:74-123`）、`safeJoinLibrary`（`src/voice-core.js:129-145`）、`probeAudio`（`src/voice-core.js:151-201`）、`inspectAudio`（`src/voice-core.js:204-234`）、`describeAudio`（`src/voice-core.js:237-245`）、`parseTargetKey`（`src/voice-core.js:254-258`）、`sanitizeUploadName`（`src/voice-core.js:261-271`）、`uniqueLibraryPath`（`src/voice-core.js:274-286`）、`VOLUME_MIN/MAX` 0.1/4（`src/voice-core.js:301-302`）、`LOUDNESS_TARGETS`（`src/voice-core.js:304`）、`resolveAudioProcessing`（`src/voice-core.js:307-329`）、`resolveFfmpeg`（`src/voice-core.js:342-351`）、`processAudioVolume`（`src/voice-core.js:366-463`）、`cleanupTemp`（`src/voice-core.js:466-469`）。

**数据结构**
`inspectAudio` 返回 `{ok,size,duration,codec,formatName,sampleRate,channels,warnings,error?}`（`src/voice-core.js:203`、`src/voice-core.js:230-233`）；`processAudioVolume` 返回 `{path,converted,applied,volume,loudness,mode,detail,bytes}`（`src/voice-core.js:355-357`、`src/voice-core.js:453-462`）。

**规则与算法**
- **来源顺序**：`file://` → 绝对路径/`~` → 相对 cwd → 语音库同名；无扩展名逐个补 `AUDIO_EXTS`；最后库内 basename 模糊匹配，返回候选（`src/voice-core.js:68-123`）。
- **库内安全**：`safeJoinLibrary` 统一斜杠、去前导 `/`、拒绝空/NUL；`resolve` 后必须仍在根内；存在时 `realpath` 校验符号链接不逃逸（`src/voice-core.js:125-145`）。
- **ffprobe**：可写临时目录优先 `tmpDir`，否则系统临时目录下 `voice-probe`；输出 `p-<pid>-<ts>-<rand>.json`；`stdio:'ignore'`，用 `-o` 写文件；10 秒超时；读取 JSON 取 `format.duration/format_name` 与第一条 audio 流的 codec/sample_rate/channels；最后删临时文件（`src/voice-core.js:147-201`）。
- **发送前校验**：存在且是文件、非空、不超 `maxBytes`；扩展名不在列表只警告；`.silk/.slk` 直接通过不探测；ffprobe 失败只警告放行；时长超上限拒绝；>60 秒警告；无音频流警告（`src/voice-core.js:203-234`）。
- **目标 key**：`^(group|private):([1-9]\d*)$`，不允许 0 开头/前导零（`src/voice-core.js:247-258`）。
- **上传名**：`basename` 去路径、控制字符与 `<>:"|?*` 换 `_`、去前导点、空则 `audio`、无扩展补 `.mp3`、总长 ≤120（`src/voice-core.js:260-271`）。
- **音量**：SnowLuma record 段没有增益字段，必须在本地用 ffmpeg 调好再发（`src/voice-core.js:288-298`）。`volume` 与 `loudness` 互斥，loudness 优先；数字档位先判再查表（否则 `-18` 被当未知档位）；音量 0.1–4；响度数字 −40 ~ −5 LUFS（`src/voice-core.js:306-329`）。原样（loudness=null 且 volume≈1）不产生新文件（`src/voice-core.js:377-380`）。
- **ffmpeg**：`-hide_banner -loglevel error -y -i <in> -af <filter> -ac 1 <out>`；filter 为 `volume=<倍数>` 或 `loudnorm=I=<LUFS>:TP=-1.5:LRA=11`；保留原扩展名让 ffmpeg 挑编码器，原扩展名失败（如 `.amr/.silk` 只读）退回 `.wav` 重试一次；输出为空文件则删掉并抛错（`src/voice-core.js:388-443`）。
- **ffmpeg 定位**：显式参数 → 环境变量（默认 `FFMPEG_PATH`）；只返回确实存在的文件；都不存在返回裸 `ffmpeg` 交给 PATH，而不是返回不存在的候选路径（`src/voice-core.js:331-351`）。
- **描述**：提升/压低分开写（`音量提升至 200%` / `音量压低至 50%`），避免旧实现两分支字面相同导致「30% 到底生效没」的排查困难（`src/voice-core.js:445-452`）。

**谁调用**
`src/bridge.js:30` 通过 `send-voice-lib` 引入；发送前 `inspectAudio`（`src/bridge.js:2179`）、`processAudioVolume`（`src/bridge.js:2188`）、发完 `cleanupTemp`（`src/bridge.js:2251`）；操作者通道复用 `resolveAudioSource/parseTargetKey`（`src/bridge.js:2059`、`src/bridge.js:2329`）。

**边界与失败模式**
- ffprobe 不可用/超时/输出为空：只警告放行，时长不校验（`src/voice-core.js:157`、`src/voice-core.js:180-184`、`src/voice-core.js:220-224`）。
- ffmpeg ENOENT：抛「找不到 ffmpeg（请设置 FFMPEG_PATH 或在 config.json 里指定 socialV2.voice.ffmpegPath）」（`src/voice-core.js:408-411`）。
- 处理产物是一次性临时文件，调用方必须在 finally 里 `cleanupTemp`（`src/bridge.js:2249-2251`、`src/voice-core.js:465-469`）。
- `resolveAudioSource` 会把绝对路径解析为可读文件；AI 通道的安全边界由桥接 `voicePathInsideLibrary` 再收一次（`src/bridge.js:2035-2057`），本模块本身不区分调用者。

### 7.2 `voice-packs.js`（484 行）

**职责**
把语音引擎做成可选安装包：npm 包里只有 manifest，模型和运行时装的时候才下载/复制；安装源支持本地目录与 http(s) zip；所有路径限制在 packsDir 下；语音服务挂了不影响聊天，本模块只负责启停/状态（`src/voice-packs.js:1-7`）。

**对外接口**
`DEFAULT_MANIFESTS`：`voice-local`（7.83GB、8765、需 GPU、不联网）与 `voice-cloud`（280MB、8767、需联网、按字符计费）（`src/voice-packs.js:33-71`）。`createVoicePacks(cfg)` 返回 `{list,install,remove,start,stop,activate,cloudConfig,readCloudConfig,cloudStats,test,sampleFile,setEnabled,manifests,packsDir}`（`src/voice-packs.js:178-179`、`src/voice-packs.js:483`）。

**数据结构**
状态 `<packsDir>/installed.json`：`{packs:{<id>:{enabled,installedAt,version}}}`；读失败回退 `{packs:{}}`（`src/voice-packs.js:73-88`）。`list()` 返回 `{ok,packsDir,packs:[{id,name,version,sizeBytes,port,requires,voices,about,installed,running,external,dir,install,enabled,installedAt}]}`（`src/voice-packs.js:181-219`）。安装进度 `{progress,phase,startedAt,error}` 存内存 `activeInstalls`（`src/voice-packs.js:178-180`、`src/voice-packs.js:228-229`）。

**规则与算法**
- *Manifest/目录*：默认安装源 `<仓库同级>/voice/packages/<id>`，可用 `SURFCORE_VOICE_LOCAL_URL`/`SURFCORE_VOICE_CLOUD_URL` 覆盖（`src/voice-packs.js:20-30`、`src/voice-packs.js:43`、`src/voice-packs.js:60`）。注释说明这里曾硬编码本机绝对路径，换机器后只表现为「安装失败」，现改为相对仓库根解析（`src/voice-packs.js:20-27`）。`packsDir` 默认 `<cwd>/state/voice-packs`（`src/voice-packs.js:73-76`）。`packDir` 校验 `path.join(root,id)` 仍在 root 下，否则抛「非法语音包 id」（`src/voice-packs.js:102-107`）。`manifests` 以默认两个包为底，`cfg.voicePacks.manifests` 按 id 覆盖/追加（`src/voice-packs.js:95-100`）。
- *安装源*：http(s) 下载到系统临时 zip，按 content-length 报进度，`tar -xf` 解压到目标目录，删临时 zip（`src/voice-packs.js:134-157`）；本地目录 `fsp.cp`（`src/voice-packs.js:159-167`）；本地 zip `tar -xf`（`src/voice-packs.js:168-176`）。用系统自带 tar（Windows 10+ 的 bsdtar），没有路径穿越/符号链接检查。
- *状态判定 `statusOne`*：`hasFiles=exists(dir/config.toml)`；`portUp=probePort(port)`（TCP 回环，300ms）；`external=!hasFiles&&portUp`；`installed=hasFiles||external`；`running=portUp`；`dir=hasFiles?dir:null`（`src/voice-packs.js:181-205`）。
- *安装/删除/启停*：`install(id,{force})` 未知包/正在安装/已安装（非 force）直接抛；异步执行「删旧目录→下载/复制/解压→校验 config.toml→写状态 enabled:true/installedAt/version」；失败把 `rec.error/phase` 置失败，接口立即返回 `{ok:true,started:true}`（`src/voice-packs.js:221-254`）。`remove` 先 stop（失败也继续）→删目录→删状态（`src/voice-packs.js:256-266`）。`start` 未安装抛、端口已通返回 already、启动脚本不存在抛、`spawn('cmd',['/c',script],{detached:true,stdio:'ignore',windowsHide:true})` 后 unref、最多等 60 秒轮询端口（`src/voice-packs.js:268-291`）。`stop` 有 stopScript 就跑，然后最多 10×500ms 等端口关闭，仍在监听返回错误（`src/voice-packs.js:293-310`）。`activate` 先停其它正在监听的包，目标没起就 start，然后改 `<cwd>/config.json` 的 `socialV2.voice.tts.route` 并强制 `enabled=true`，写盘错误吞掉（`src/voice-packs.js:341-366`）。`setEnabled` 只改状态文件，不影响进程（`src/voice-packs.js:368-377`）。
- *云端*：`cloudConfig` 只改 `cloud_app_id/cloud_access_key/cloud_resource` 三行，speaker 写 `voices/age12*/voice.json`（`src/voice-packs.js:312-338`）；`readCloudConfig` 回显 AppID、AccessKey 打码（前 4+`****`+后 4）、speaker（`src/voice-packs.js:380-405`）；`cloudStats` 读 `logs/requests.jsonl`，汇总今天/本月字符/调用数，价格/额度从 `config.json` 热读（`src/voice-packs.js:408-454`）；`sampleFile` 取 `voicepack/` 第一个 wav/mp3/m4a（`src/voice-packs.js:456-464`）；`test` POST `/v1/speak/file`，120 秒超时，按 `bytes/2/24000` 估算秒数（`src/voice-packs.js:466-481`）。

**语音包安装/校验/启停状态机**

| 状态 | 判据 | 可执行动作 | 依据 |
| --- | --- | --- | --- |
| 未安装 | `!hasFiles && !portUp` | install | `src/voice-packs.js:186-189` |
| 外部安装 | `!hasFiles && portUp` | 视为 installed/running，`dir:null`；stop 通常失败（无脚本） | `src/voice-packs.js:185-203` |
| 已安装未运行 | `hasFiles && !portUp` | start/remove/setEnabled | `src/voice-packs.js:186-189` |
| 已安装运行中 | `hasFiles && portUp` | stop/activate/test | `src/voice-packs.js:186-189` |
| 安装记录（进行中/成功/失败） | `activeInstalls.has(id)` | 记录常驻内存；进行中拒绝 install，完成后同进程仍被「正在安装」拒绝 | `src/voice-packs.js:224`、`src/voice-packs.js:247-250` |
| 启用/停用 | `installed.json.packs[id].enabled` | setEnabled 只改状态，不改进程 | `src/voice-packs.js:368-377` |

**校验点**：id 必须在 packsDir 内（`src/voice-packs.js:102-107`）；安装源必须存在（`src/voice-packs.js:160-161`）；解压后必须有 config.toml（`src/voice-packs.js:238-240`）；启动脚本必须存在（`src/voice-packs.js:275-276`）；端口探活只证明 TCP 可连（`src/voice-packs.js:109-122`）。**没有**包哈希/签名校验，也没有解压路径消毒——zip 由 `tar -xf` 直接展开，安装源必须可信（`src/voice-packs.js:150-155`、`src/voice-packs.js:170-174`）。

**谁调用**
`src/bridge.js:31` 引入；控制台 `/api/voice/packs` 系列接口按需创建（`src/bridge.js:6459` 起）。设置页通过该接口安装/启停/配置/试听。

**边界与失败模式**
- 安装是「内存进度 + 磁盘状态」两套：进程重启丢进度，但已完成 `installed.json` 仍在（`src/voice-packs.js:178-180`、`src/voice-packs.js:241-244`）。
- 无论成功还是失败，`activeInstalls` 都只 set 不 delete（`src/voice-packs.js:224-250`），同一进程内第二次 install 会先撞「这个包正在安装中」，需重启进程才能重装（重装会先 `rm` 旧目录）。
- `start` 用 `cmd /c`，没有平台判断；非 Windows 不可用（`src/voice-packs.js:277-282`）。
- `stop` 只信任 stop 脚本+端口；端口被别的进程占用会报「可能不是这个包占的」（`src/voice-packs.js:305-309`）。
- `activate` 写 config.json 失败被吞，调用方不知道路由没落盘（`src/voice-packs.js:353-364`）。

### 7.3 `voice-tts.js`（150 行）

**职责**
本地 TTS 客户端：把一段文字变成能交给 `sendVoiceV2` 的本地音频文件；失败必须可读，桥接会翻译成 502，让模型改回打字而不是编「我发了语音」（`src/voice-tts.js:1-7`）。与 voxd 的契约：POST `/v1/speak/file` → wav 字节，`X-Duration-Ms` 时长，`X-Cached` 缓存命中（`src/voice-tts.js:6-7`）。

**对外接口**
`DEFAULT_BASE_URL`（`src/voice-tts.js:12`）、`ttsKey({baseUrl,text,character,voice,style,cacheVersion})`（`src/voice-tts.js:15-20`）、`wavDurationMs(buf)`（`src/voice-tts.js:23-39`）、`synthesizeToFile(opts)` 返回 `{path,durationMs,cached}`（`src/voice-tts.js:45-108`）、`pruneCache(dir,{maxFiles,maxBytes})`（`src/voice-tts.js:115-150`）。

**数据结构**
缓存文件 `<outDir>/<sha1>.wav`；key 覆盖 baseUrl/cacheVersion/text/character/voice/style（`src/voice-tts.js:15-20`、`src/voice-tts.js:62-63`）。请求体 `{text,format:'wav',sr:24000,cache:true,character?,voice?,style?}`（`src/voice-tts.js:69-72`）。

**规则与算法**
- 内容寻址：同一句重复发不堆文件；换音色/映射就 `cacheVersion+1` 让旧音频失效（`src/voice-tts.js:14`、`src/bridge.js:1985-1993`）。
- 本地命中：文件存在且 >44 字节，读 WAV 头算时长返回 `cached:true`（`src/voice-tts.js:64-67`）。
- 请求失败：超时→「合成超时（>Ns）」；其他→「TTS 服务没起来（voxd 是否在运行？）」并附原始错误（`src/voice-tts.js:82-88`）。
- 非 2xx：读 `detail/error`，抛「TTS 服务返回 <status>：...」（`src/voice-tts.js:90-97`）。
- 空音频（≤44 字节）抛「TTS 返回了空音频」（`src/voice-tts.js:98-99`）。
- 临时文件+rename 写盘；成功后 `pruneCache`，清理失败不影响发送（`src/voice-tts.js:101-104`、`src/voice-tts.js:110-114`）。
- 缓存上限 400 个/150MB，按 mtime 从旧到新删（`src/voice-tts.js:110-150`）。

**谁调用**
`src/bridge.js:33` 引入；`synthesizeVoiceText` 调用（`src/bridge.js:2006-2019`）；插件桌宠对话复用（`plugins/surfcore/lib/pet-chat.js`）。

**边界与失败模式**
- `outDir` 必填；空文本/空目录直接抛（`src/voice-tts.js:56-58`）。
- 服务未启动/超时抛可读错误，由桥接转 502（`src/voice-tts.js:82-88`）。
- 缓存命中只检查大小 >44，不重新校验 WAV 完整性；坏文件时长返回 0（`src/voice-tts.js:64-66`）。
- 缓存清理只删 `.wav`（`src/voice-tts.js:118-121`）。

### 7.4 `send-voice-lib.js`（29 行）

**职责**
语音发送共享库的薄转发层；唯一实现在 `voice-core.js`。保留它是因为 `src/bridge.js` 与若干测试都 import 它，集中 import 点避免两份实现各自演化（`src/send-voice-lib.js:1-6`）。

**对外接口**
再导出 22 个符号：音频扩展/大小/时长常量、`isAudioFile`、`formatBytes`、`formatDuration`、`listAudioFiles`、`resolveAudioSource`、`safeJoinLibrary`、`probeAudio`、`inspectAudio`、`describeAudio`、`parseTargetKey`、`sanitizeUploadName`、`uniqueLibraryPath`、`VOLUME_MIN/MAX`、`LOUDNESS_TARGETS`、`resolveAudioProcessing`、`resolveFfmpeg`、`processAudioVolume`、`cleanupTemp`（`src/send-voice-lib.js:7-29`）。

**数据结构**
无自有结构；类型全部来自 `voice-core.js`。

**规则与算法**
无逻辑；只做 ESM 再导出（`src/send-voice-lib.js:7-29`）。

**谁调用**
`src/bridge.js:30`；`scripts/send-voice.mjs`、`scripts/test-voice.mjs`。

**边界与失败模式**
无运行时校验；`voice-core.js` 的导出改名/删除会在 import 时直接报错，这是有意的「单一实现」约束（`src/send-voice-lib.js:1-6`）。

---

## 8. 落盘安全

### 8.1 `state-acl.mjs`（140 行）

**职责**
`state/` 目录 ACL 收紧的唯一实现。原本桥接与安装脚本各写一份，两份带同一个 bug：`icacls DIR /inheritance:r /grant:r "u:(OI)(CI)F" /T` 把目录专用 `(OI)(CI)` 套到 `/T` 展开的文件上会失败，而 `/inheritance:r` 已摘掉文件原有继承 ACE，净结果是**子文件 DACL 被清空、连属主都读不了**（`src/state-acl.mjs:1-13`）。第二个 bug 让破坏反复发生：回读自检用 `/\(I\)/` 扫全文，而 DSH 沙箱的 Low 完整性标签行永远带 `(I)`，于是「已收紧」被误判「未收紧」，每次启动重跑破坏性命令（`src/state-acl.mjs:14-18`）。

**对外接口**
`icacls(args,timeout)`（`src/state-acl.mjs:34-37`）、`hasInheritedPermissionAce(output)`（`src/state-acl.mjs:39-50`）、`hasPermissiveTrustee(output)`（`src/state-acl.mjs:52-55`）、`isHardened(target)`（`src/state-acl.mjs:57-69`）、`hardenDir(dir)`（`src/state-acl.mjs:71-102`）、`hardenFile(file)`（`src/state-acl.mjs:104-124`）、`manualDirCommand(dir)`（`src/state-acl.mjs:126-140`）。

**数据结构**
无持久结构；`hardenDir/hardenFile` 返回 `{ok,detail}`（`src/state-acl.mjs:73-75`、`src/state-acl.mjs:106-107`）。

**规则与算法**
Windows 四步，缺一不可（`src/state-acl.mjs:20-25`、`src/state-acl.mjs:83-88`）：
1. 目录停止继承：`icacls <dir> /inheritance:r /C /Q`；
2. 按 SID 删除宽松主体：Authenticated Users `S-1-5-11`、BUILTIN\Users `S-1-5-32-545`、Everyone `S-1-1-0`，`/T /C /Q`（`src/state-acl.mjs:31-32`、`src/state-acl.mjs:85`）；
3. 对**每一个**条目显式授权：当前用户/SYSTEM/Administrators 的 `F`，不带 `(OI)(CI)`，所以对文件同样有效（`src/state-acl.mjs:86`）；
4. 给目录补可继承 ACE：`(OI)(CI)F`（`src/state-acl.mjs:87`）。

非 Windows：目录 `chmod 700`、文件 `chmod 600`（`src/state-acl.mjs:77-80`、`src/state-acl.mjs:109-113`）。失败检测必须扫输出里的 `access is denied`，因为 `/C` 会让 icacls 继续处理剩余文件、即使全失败退出码仍为 0（`src/state-acl.mjs:93-96`）。收尾 `fs.readdirSync(dir)` 必须仍可读，防止把 DACL 清空这种「成功」的破坏（`src/state-acl.mjs:98-100`）。`hasInheritedPermissionAce` 排除 `Mandatory Label` 行；`isHardened` 同时要求无继承 ACE、无宽松主体（`src/state-acl.mjs:41-49`、`src/state-acl.mjs:64-68`）。`manualDirCommand` 输出安全顺序的 4 条命令（`src/state-acl.mjs:126-140`）。

**谁调用**
`src/bridge.js:34` 引入 `hardenDir/manualDirCommand`；启动 `hardenStateDirAcl()`（`src/bridge.js:312`、`src/bridge.js:298-326`）；`scripts/harden-state-acl.mjs:27` 引入全部，并用 `isHardened` 做跳过判断（`scripts/harden-state-acl.mjs:72`、`scripts/harden-state-acl.mjs:98-106`）。

**边界与失败模式**
- `%USERNAME%` 为空直接失败，不猜 SID（`src/state-acl.mjs:81-82`、`src/state-acl.mjs:114-115`）。
- icacls 超时/启动失败返回 `{ok:false,detail}`（`src/state-acl.mjs:89-97`）。
- 收紧后目录不可读明确报错，不假装成功（`src/state-acl.mjs:98-100`）。
- 只处理 ACL，不处理内容加密/备份；桥接失败时打印手动命令并继续运行（`src/bridge.js:315-325`）。

---

## 9. 关键设计速查

### 9.1 分条与纯文本化

1. **纯文本化**：`mdToPlain` 去 Markdown 标记、保留内容与链接（`src/md-to-plain.js:2-37`）；它不截断，图片/链接正则的 500/2000 上限只为防 O(n²)（`src/md-to-plain.js:9-11`）。
2. **长度安全**：`splitForQQ` 默认 4000 字，优先换行、代理对保护（`src/md-to-plain.js:40-67`）；桥接 `sendToQQ` 每段串到 `sendChain`，段间 `sleep(sendDelayMs)`（`src/bridge.js:8242-8262`）。
3. **语义分条**：一代用空格表示分条，`splitByCjkSpaces` 在空格两侧任一侧是汉字时切开；单条上限 `maxReplyChars` 默认 500，超长由 `splitLongSegment` 按次要标点拆，URL 作为不可拆原子（占位符保护），emoji 不切半（`src/bridge.js:8269-8428`）。二代必须调 `qq_send_message`，数组元素就是气泡，没有自动转发（`src/role-card.js:1-8`、`src/bridge.js:11282`）。`[SILENT]` 只属于一代，二代改用不调用发送工具/收尾工具（`src/bridge.js:14359-14370`）。
4. **模型视图**：`qq-model-view` 只删重复/空/默认 false 字段与可推导媒体引用，不截断文本（`src/qq-model-view.js:43-65`）；合并转发每条才截 500 字（`src/forward.js:178-205`）。

常见错误：把 `splitForQQ` 当语义分条（会在句中硬切）；在二代用空格分句（不会自动拆）；用 `mdToPlain` 截断（它不截断）。

### 9.2 SSRF 防护覆盖的攻击面

| 攻击面 | 防护 | 依据 |
| --- | --- | --- |
| 非 HTTP(S)/file/gopher | 只允许 http/https | `src/safe-fetch.js:174` |
| URL 内嵌凭据 | 拒绝 username/password | `src/safe-fetch.js:175` |
| localhost/.local | 显式拒绝 | `src/safe-fetch.js:139-141` |
| 字面内网 IP | `isPrivateIp` | `src/safe-fetch.js:142-145` |
| DNS 解析到内网 | 检查全部 A/AAAA | `src/safe-fetch.js:146-157` |
| DNS rebinding | 校验后固定 IP，Host/SNI 用域名 | `src/safe-fetch.js:218-231` |
| IPv4 私网/保留/CGNAT/组播 | 10/8、127/8、0/8、169.254/16、172.16/12、192.168/16、100.64/10、198.18/15、192.0.0/24、≥224 | `src/safe-fetch.js:73-85` |
| IPv6 环回/ULA/链路本地/文档/组播 | ::、::1、fc/fd、fe80/10、fec0::/10、2001:db8、ff00::/8 | `src/safe-fetch.js:88-106` |
| IPv4-mapped/NAT64/6to4 绕过 | 抽内嵌 IPv4 递归判 | `src/safe-fetch.js:24-64`、`src/safe-fetch.js:95-104` |
| 重定向到内网 | 手动跟随，每跳重校验，最多 5 跳 | `src/safe-fetch.js:330-351` |
| 无限重定向正文 | 重定向体不下载，直接 destroy | `src/safe-fetch.js:241-245` |
| 超大响应 | 文本 50k 码点/图片 8MB | `src/safe-fetch.js:247-278`、`src/safe-fetch.js:364` |
| 慢速滴流 | 总 20s + 单地址 8s + 多地址切换 | `src/safe-fetch.js:180-184`、`src/safe-fetch.js:303-328` |
| 假图片 | magic bytes 校验 PNG/JPEG/GIF/WebP | `src/safe-fetch.js:353-361` |
| API key 发到内网 | 搜索端点必须 https+公网+无凭据 | `src/web-search.js:173-184` |
| 搜索端点重定向偷 key | 拒绝 3xx，不跟随 | `src/web-search.js:227-231` |
| 搜索响应过大 | 2MB 上限 | `src/web-search.js:36-37`、`src/web-search.js:237-241` |

未覆盖：公网内容本身恶意、TLS 中间人（依赖系统 CA）、DNS 服务器投毒（校验的是解析结果）、JS/meta 重定向（不解析 HTML）；实现也不限制公网端口，访问公网上的管理端口属于已知面。

### 9.3 DSH 鉴权链路

```
启动 token（进程内随机，日志只是兜底）
   └─ GET /?token=<token> ──► set-cookie ──► 后续请求带 Cookie
持久化签名密钥（credentials: client-connection/browser-session, 32B）
   └─ HMAC-SHA256 离线铸造 ──► dsh-auth-<sha256(authority)> = v1.<payload>.<sig>
```

- 启动 token 顺序：`DSH_LAUNCH_TOKEN` → `<DSH home>/logs/server-*.log` → `guard/logs`，取 `?token=`/`&token=` 值；日志里的旧 token 可能已过期，交换会得到 401（`src/dsh-client.js:24-35`、`src/dsh-client.js:36-63`）。
- 签名密钥：`records['client-connection/browser-session']`，`kind='grant'`、`version=1`、base64url 32 字节（`src/dsh-client.js:97-110`）。
- Cookie：payload `{version:1,authority,issuedAt,expiresAt}` → base64url；HMAC-SHA256；名字 `dsh-auth-` + base64url(SHA256(authority))；值 `v1.<body>.<sig>`（`src/dsh-client.js:119-130`）。
- 有效期 1 小时，提前 5 分钟重铸（`src/dsh-client.js:85-88`、`src/dsh-client.js:381-384`）。
- 可铸造时默认铸造优先；显式配置 token 或铸造被 401 才改用 launch token（`src/dsh-client.js:390-394`、`src/dsh-client.js:578-588`）。
- launch token 只许回环；远程 DSH 需显式 `allowRemote`（`src/dsh-client.js:387-408`）。
- 401 只重试一次；token 交换失败也只重试一次（`src/dsh-client.js:556-590`）。
- WS 用同一 Cookie；follow 跨重连用 `_desiredFollows` 重放（`src/dsh-client.js:690-692`、`src/dsh-client.js:676-682`、`src/dsh-client.js:763-770`）。

威胁模型：能读 `<DSH home>/.credentials.yaml` 的本机同用户进程本来就能读 DSH 数据；离线铸造没有提权，只是把「依赖启动器日志」换成「依赖持久密钥」（`src/dsh-client.js:77-80`）。Cookie 是 bearer，泄漏即等价会话权限。

### 9.4 B站打分权重

见 1.2 表。一句话：**上游 0–20 是绝对标尺（分享阈值 13）；`bili-memory` 把它当排序/准入门槛（priority 15/13、分享池 12、检索 60/30/5/2）**。低于 13 仍入记忆，低于 12 基本只在检索/简报出现；政治/娱乐圈命中在检索里归零、在注入和分享池里被排除（`src/bili-memory.js:437`、`src/bili-memory.js:520`、`src/bili-memory.js:755`、`src/bili-memory.js:798`）。

### 9.5 鱼群阈值（QQ vs B站）

| 维度 | QQ（`src/fish-guard.js`） | B站（`plugins/surfcore/tools/lib/fish-guard.mjs`） |
| --- | --- | --- |
| 目标 | 多只同类角色同群不刷屏 | 评论区鱼太多不发新楼层、优先回鱼、给鱼点赞 |
| 窗口/样本 | 10 分钟消息窗口 | 最近 40 条顶层评论（`sampleSize`） |
| 数量阈值 | 不同鱼 ≥5 | 鱼顶层 ≥3 或不同鱼账号 ≥3（`maxFishTopLevel/maxFishMids`） |
| 占比阈值 | 鱼消息 ≥8 且占比 ≥0.6，样本 ≥8，鱼账号 ≥2 | 占比 ≥0.4，样本 ≥8 |
| 连续阈值 | 连续 5 条（≥2 鱼）/单鱼连续 5 条 | 无「连续消息」概念，用聚拢/点赞/风控熔断 |
| 群名/鱼窝 | 群名含 肥鱼/fish 或群号在 `groupNestIds` → 阈值 3 | 无群名概念，按视频评论区 |
| 冷却 | 10 分钟，可被新鱼消息延长 | 聚拢 12 小时、点赞失败 24 小时、风控熔断 60 分钟 |
| 状态 | `social-v2` 状态 + `fishGuardLog`（30 条） | `fish-guard.json`（`plugins/surfcore/tools/lib/fish-guard.mjs:21`、`:210-237`） |

QQ 判定顺序「数量 → 连续（≥2 鱼）→ 单鱼连续 → 占比」，短路（`src/fish-guard.js:204-209`）。B站侧是另一套实现，阈值不可互套（`plugins/surfcore/tools/lib/fish-guard.mjs:24-68`）。

### 9.6 表情匹配编码

一句话：**编号是身份，情绪词表是语义锚，128 维未训练自注意力向量是模糊匹配，三者加权排序**。

- 编号：`no` 1–9999；已有保留；新号 `max+1`；不复用空号（`src/sticker-semantics.js:397-420`）；发送时 `#05`/`5`/`5号` 都能解析（`src/sticker-semantics.js:97-102`）。
- 情绪：19 类，主情绪+0~2 副；相邻情绪表补反向；精确 1、副 0.82、相邻 0.6（`src/sticker-semantics.js:24-75`、`src/sticker-semantics.js:448-463`）。
- 文本：中文单字+相邻双字；英文/数字按词（`src/sticker-semantics.js:145-166`）。
- 向量：128 维；FNV-1a 哈希到随机投影矩阵一列（带符号去碰撞偏置）；逐 token L2；自注意力 `softmax(cos/0.12)`、混入 0.45、残差；均值池化；整体 L2（`src/sticker-semantics.js:168-294`）。
- 排序：`0.46*情绪+0.38*内容+0.16*关键词`；使用次数 ≤+0.03；15 分钟内 −0.08、1 小时内 −0.03；阈值 0.34；topK 3（`src/sticker-semantics.js:434-531`）。
- 提示：≥0.72 用更强建议，否则「真的贴合才发」；无匹配返回空串（`src/sticker-semantics.js:536-561`）。
- 缓存：进程内，key = 条目标识（id/resId/no）+ 语义签名，上限 400 FIFO（`src/sticker-semantics.js:306-338`）。

这不是训练出来的语义模型：权重固定、未训练，跨说法匹配主要靠情绪词表扩展（`src/sticker-semantics.js:9-16`）。

### 9.7 语音包状态机

见 7.2 状态表。三条要点：① 安装异步，接口立即返回，前端轮询 `list().install`；失败只写内存记录（`src/voice-packs.js:221-254`）。② 「外部安装」是正式状态：无 config.toml 但端口已监听，视为已安装运行中，`dir:null`；stop 因无脚本通常失败（`src/voice-packs.js:181-205`、`src/voice-packs.js:293-310`）。③ 启停以端口为准：start 最多 60 秒、stop 最多 5 秒；activate 先停其它包再切 `config.json` route 并强制 enabled=true（`src/voice-packs.js:268-310`、`src/voice-packs.js:341-366`）。没有哈希/签名校验，zip 解压没有路径消毒，安装源必须可信（`src/voice-packs.js:134-176`）。

---

## 10. 验证入口

| 验证目标 | 命令/文件 | 覆盖 |
| --- | --- | --- |
| B站记忆/动态 | `npm run test:bili` | 1.1–1.4 |
| B站卡片 | `scripts/test-bili-card.mjs`、`test-bili-card-ark.mjs` | 1.5、share-mode |
| 鱼群保护 | `scripts/test-qq-fish-guard.mjs`、`test-fish-guard.mjs` | 2.1 |
| 表情库/语义 | `npm run test-stickers`、`scripts/test-sticker-semantics.mjs` | 2.2–2.3 |
| 黑话学习 | `npm run test-slang` | 2.4 |
| 纯文本/分条 | `npm run test-md`、`scripts/test-encoding.mjs` | 3.1 |
| 模型视图 | `npm run test:token` 内的 `test-qq-model-view.mjs` | 3.2 |
| 合并转发 | `npm run test-forward` | 3.3 |
| 补历史 | `scripts/test-history-catchup.mjs` | 3.4 |
| 早安 | `scripts/test-greeting.mjs` | 3.5 |
| 没说完 | `npm run test-wait`、`test-dsh-v2-wait.mjs` | 3.6 |
| 预设/角色 | `npm run test:preset-prompt`、`npm run test:role-card` | 4.1–4.2 |
| 敏感信息 | `scripts/test-audit-security.mjs`、`test-audit-regressions.mjs` | 4.3 |
| SSRF/抓取 | `scripts/test-vision-media.mjs`、`test-media-search.mjs` | 5.1–5.2 |
| DSH 鉴权 | `npm run test:dsh-auth`、`scripts/probe-auth.mjs` | 6.1 |
| DSH inbox/退役 | `npm run test:dsh-inbox`、`npm run test:session-retire:e2e` | 6.1 |
| 端口发现 | `scripts/test-dsh-port.mjs`、`npm run sync-dsh-port` | 6.2 |
| SnowLuma | `scripts/test-snowluma-conn.mjs`、`npm run probe:heartbeat` | 6.3 |
| DSH 端到端 | `npm run self-test` | 6.1、6.4 |
| 语音核心 | `npm run test-voice`、`scripts/test-voice-volume.mjs` | 7.1、7.4 |
| 语音包 | `scripts/test-voice-gui.mjs`、`test-voice-packs-default.mjs` | 7.2 |
| TTS | `npm run test-voice:system`、`scripts/test-voice-tts.mjs` | 7.3 |
| state ACL | `npm run test:hardening`、`npm run diagnose:acl`、`npm run harden-acl` | 8.1 |

按改动面回归：B站采集/打分 → `test:bili` + `test-md`；表情/黑话 → `test-stickers` + `test-slang` + `test:token`；DSH 鉴权/RPC → `test:dsh-auth` + `test:dsh-inbox` + `test:mux-reconnect` + `self-test`；抓取/搜索 → `test-vision-media` + `test-media-search` + `test:regressions`；语音 → `test-voice` + `test-voice:system`；ACL → `test:hardening` + `diagnose:acl`（先备份/隔离，别在生产 `state/` 直接试错）。

---

## 11. 已知边界

- 本文只覆盖 `src/` 的 29 个模块；B站评论/点赞/动态发布工具链在 `plugins/surfcore/tools/`，只在解释 B站打分与 B站鱼群时引用其阈值。
- `src/bridge.js` 的调度、会话状态机、权限与发送闸门不在本文范围；理解 `fish-guard`、`history-catchup`、`greeting` 的「谁调用」时需回桥接对应行号。
- 安全边界分层：`sensitive` 是启发式内容审计，`safe-fetch` 是网络层 SSRF，`state-acl` 是落盘 ACL，`dsh-client` 是鉴权；任何一层都不能单独替代另外两层（`src/sensitive.js:6-14`、`src/safe-fetch.js:1-7`、`src/state-acl.mjs:1-25`、`src/dsh-client.js:72-80`）。
- 语音包安装源与 DSH 凭据文件属于「本机可信输入」：前者没有哈希校验，后者本身就是凭据（`src/voice-packs.js:134-176`、`src/dsh-client.js:97-110`）。
- 行号基于当前工作区版本；代码变动后用 `grep -n` 重新定位，不要盲信旧行号。
