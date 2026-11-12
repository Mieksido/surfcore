# 桌宠子系统（SUBSYSTEM-PET）

> 范围：插件侧四个模块（`plugins/surfcore/lib/pet.js` / `pet-chat.js` / `pet-purpose.js` / `pet-api.js`
> + 共用准入判据 `http-guard.js`）、它们在 `lib/index.js` 的装配、桥接侧的两处读点
> （`src/bridge.js` 的载体与专注），以及仓库外 Electron 工程 `<桌宠工程>` 的客户端契约。
> 不含设置页前端 `lib/client.js` 的桌宠卡片细节（另见 UI 文档），也不含目的引擎
> `src/purpose-engine.js` 的算法内部（另见 `docs/guides/PURPOSE_OUTREACH.md`）。
>
> **引用约定**：`lib/xxx.js:12` 指 `plugins/surfcore/lib/xxx.js` 第 12 行；`src/xxx.js:12` 指仓库根
> 的 `src/xxx.js`；`<桌宠工程>/src/...:12` 指仓库外那个只读参考工程。行号基准是 2026-10-26 工作树。
>
> **占位符**：`<DSH_HOME>` = 环境变量 `DSH_HOME` 的真实值，默认 `~/.dsh`
> （`plugins/surfcore/lib/paths.js:15`）；`<工作区>` = 本仓库根目录；`<桌宠工程>` = 仓库外的
> 独立 Electron 桌宠工程；`<token>` / `<管理员QQ>` 表示不应写进文档的敏感值。
>
> **文档关系**：用户操作手册是 `plugins/surfcore/docs/PET.md`（下称 PET.md）。本文是工程事实版，
> 与 PET.md 冲突处以本文为准（已知冲突见 §13 第 8 条）。
> **最后核对**：2026-10-26（全仓库逐行梳理）。配套阅读：总纲 [ARCHITECTURE.md](ARCHITECTURE.md) · 边界 [BOUNDARIES.md](BOUNDARIES.md) · 索引 [../README.md](../README.md)。

---

## 0. 一句话定位

桌宠不是插件的 UI 部件，而是**一个独立的 Electron 进程**：插件只负责「安装 / 启停 / 皮」
（`lib/pet.js:6-8`）、在 DSH 的 webServer 上多开一个**只用本地令牌**的 HTTP 前缀
`/dsh-surfcore/pet-api`（`lib/pet-api.js:5-13`），并在该前缀后面装配三件业务能力——对话与语音
（`lib/pet-chat.js`）、目的机制的桌宠载体（`lib/pet-purpose.js`）、以及和 QQ / B站 共用的人格卡 /
记忆卡 / 目的状态读取。桌宠进程通过 `<DSH_HOME>/surfcore/pet/host.json` 发现 DSH 的端口与令牌，
之后单向拉取（长轮询事件）与按需请求（一问一答）。

三条最容易记错的边界：

1. **对话不走 DSH 的 agent 回合**，而是插件直接调 `llm` 服务、自己拼 system prompt
   （`lib/pet-chat.js:9-13`、`lib/pet-chat.js:600-648`）——省掉几万 token 的工具面。
2. **主动搭话是「载体二选一」**：`purpose.carrier=pet|qq`，同一时刻只有一个执行者
   （`lib/pet-purpose.js:9-12`、`src/bridge.js:1687-1691`）。
3. **专注模式只有一份真相** `pet/focus.json`，桌宠、设置页、插件 tick、QQ 桥接四处共读
   （`lib/pet-chat.js:397-408`、`src/bridge.js:1706-1723`）。

---

## 1. 拓扑与进程边界

### 1.1 四个参与者

| 参与者 | 形态 | 网络角色 | 鉴权 | 代码 |
| --- | --- | --- | --- | --- |
| DSH 宿主 + surfcore 插件 | 同一 Node 进程 | **监听** DSH webServer 端口，承载 `/dsh-surfcore/api/*` 与 `/dsh-surfcore/pet-api/*` | 前者靠 DSH 会话（`connection.requestRejection`），后者靠 `x-pet-token` | `lib/index.js:87`、`:2100`、`:2150-2164` |
| 桌宠 | 独立 Electron 进程（仓库外） | 纯客户端，**不监听任何端口** | 持有 host.json 里的 `<token>` | `<桌宠工程>/src/main/surfcore.ts:58-236` |
| QQ 桥接 | 独立 Node 进程 | 监听控制台 `127.0.0.1:<consolePort>`，默认 3100 | `x-console-token` | `plugins/surfcore/lib/bridge.js:18-32` |
| TTS 引擎（voxd 一类） | 外部本地服务 | `127.0.0.1:8765`(local) / `8767`(cloud) 默认 | 无（回环即用） | `lib/pet-chat.js:214-217`、`src/voice-tts.js:12` |

```
┌──────────────────────── DSH 宿主进程（Node） ───────────────────────────┐
│  surfcore 插件                                                           │
│    lib/pet.js          安装 / 启停 / 皮肤扫描（文件 + 子进程）             │
│    lib/pet-chat.js     对话 / 语音 / 事件队列 / 专注 / 历史               │
│    lib/pet-purpose.js  目的载体（60s tick，与 QQ 载体互斥）               │
│    lib/pet-api.js      /dsh-surfcore/pet-api/*（自带回环 + 令牌）         │
│    lib/index.js        /dsh-surfcore/api/{pet,purpose}/*（设置页，会话）  │
└───────┬──────────────────────────────────┬──────────────────────────────┘
        │ spawn(electron, detached)         │ HTTP：baseUrl + <token>
        ▼                                   ▼
 ┌───────────────────┐            ┌──────────────────────────────────────┐
 │ 桌宠 Electron      │  GET /events?since=&wait=（长轮询，拿事件）        │
 │ <桌宠工程>         │  POST /chat（一问一答）                           │
 │ 主进程 = HTTP 客户端│  GET /history /config /status；POST /focus        │
 └───────────────────┘            └──────────────────────────────────────┘
        │  回落时插件调用 callBridge('/api/purpose/run')
        └──────────────► QQ 桥接控制台 127.0.0.1:<consolePort>
```

### 1.2 装配顺序（插件激活时）

`lib/index.js:196-209` 一次性建好四个服务，依赖方向**单向**：`createPetService`（无依赖）→
`createPetChatService`（`ctx` 的 `llm`/`agentDefaultModel`、`stateDir`、`tokenBudget`）→
`createPetPurposeService`（`petChat`、`tokenBudget`、`callBridge`）→ `createPetApiService`（前三个 +
`currentDshUrl` + `version`）。

随后三件事：注册 `/dsh-surfcore/pet-api` 前缀路由（disposer 收进 `disposers`，`lib/index.js:2152-2164`）、
强制写一次 `host.json` 并挂 120s 定时重写（`:2171-2173`）、`petPurpose.start()`（60s tick + 3s 后先跑一次，
`:2175`、`lib/pet-purpose.js:602-613`）。

注意 `getSubprocess` 虽然传进去了，但 `createPetService` 的实现里**没有使用**它（`lib/pet.js:42`、
`:261-315` 全程走 `node:child_process` 直连）——见 §13 第 5 条。

### 1.3 生命周期边界

- **插件不托管桌宠**：`spawn` 用 `detached: true` + `child.unref()`（`lib/pet.js:296-303`），
  DSH 退出/重启不会带走它。
- **插件 dispose 不杀桌宠**：清理只做 `petPurpose.stop()` 与 `clearInterval(petHostTimer)`
  （`lib/index.js:2186-2199`），`pet.js` 没有提供 dispose，也没有在 disposer 里调 `stop()`。
- **桌宠自己也防重复**：单实例锁，第二个进程直接 `app.quit()`（`<桌宠工程>/src/main/main.ts:73-80`）。
- **状态判断分两层**：`running` 看 pid 文件（`lib/pet.js:111-113`），`online` 看是否在 60 秒内轮询过
  `/events`（`lib/pet-chat.js:443-451`）。主动搭话的回落判断用后者，不是 pid（PET.md §9 的口径与代码一致）。
- **端口会漂移**：`baseUrl` 来自 `ctx.get('webServer').port`，取不到才退回 `DSH_WEB_URL`
  （`lib/index.js:454-460`）；所以桌宠必须靠 host.json 重新发现，不能写死端口。

---

## 2. 发现与鉴权（host.json / host-token / 回环 / 同源 / 音频 `?token=`）

### 2.1 发现文件 host.json

写入方只有插件，读方是桌宠。字段（`lib/pet-api.js:42-51`）：`version` 固定 `1`（`HOST_FILE_VERSION`，
`:20`、`:44`）；`baseUrl` = `currentDshUrl()` 去掉结尾斜杠（`:45`）；`token` = `chat.token()`，即 host-token
文件内容（`:46`、`lib/pet-chat.js:177-191`）；`api` 固定 `/dsh-surfcore/pet-api`（`:19`、`:47`）；
`pluginVersion` 是插件 `VERSION`（`:48`）；`updatedAt` 是 ISO 时间（`:49`）。

写入策略：启动强制写一次（`lib/index.js:2171`）、之后每 120 秒一次（`:2172`）、非强制写有 5 秒节流
（`lib/pet-api.js:53-56`）；落盘是「临时文件 + rename」原子写，`mode: 0o600` 后再 `chmod` 一次
（`:57-62`）；写失败只记日志（`:63-65`）。

桌宠侧读取：路径可用 `SURFCORE_PET_HOST` 覆盖，默认 `<DSH_HOME>/surfcore/pet/host.json`（`:48-51`）；
`baseUrl` 必须匹配 `/^https?:\/\/127\.0\.0\.1(:\d+)?$/i`、`token` 必须 32–80 位 hex，否则返回 `null`、视为
「还没找到 SurfCore」（`<桌宠工程>/src/main/surfcore.ts:96-102`）——**baseUrl 只能是 127.0.0.1 字面量**，
见 §12 首个失败模式；`api` 只接受以 `/` 开头（`:97`）。完整校验见 §10.1。

### 2.2 令牌 host-token

- 文件：`<DSH_HOME>/surfcore/pet/host-token`（`lib/pet-chat.js:158`）。
- 复用规则：内容匹配 `/^[a-f0-9]{32,80}$/` 就直接用（`:179-181`）；否则 `randomBytes(24)` → 48 位
  hex（`:183`），以 `mode: 0o600` 写入并 `chmod`（`:185-186`）。
- **没有轮换机制**：代码里没有任何地方删除或重写 host-token（全仓库只有 `lib/pet-chat.js:158`、
  `:188` 两处引用）；令牌一旦生成就跟随这个文件。
- 写失败（只读目录 / ACL）时函数仍返回新生成的串（`:187-190`）——但下一次 `token()` 读不到文件，
  会**再生成一把**，于是 host.json 里的令牌与鉴权时比对的令牌永远不一致 → 全 401。见 §12。

### 2.3 准入判据（四道，顺序不能换）

`lib/pet-api.js:108-119`：

| 顺序 | 判据 | 不满足 | 为什么是这个顺序 |
| --- | --- | --- | --- |
| 1 | `isLoopbackReq(req)` | 403 `只接受本机回环访问` | 先挡非本机，避免向远端泄露「这里有个桌宠接口」 |
| 2 | `req.method !== 'GET' && !sameOrigin(req)` | 403 `跨站请求被拒绝` | 写操作防 CSRF；GET 只读不设同源 |
| 3 | 非 GET 且 `content-type` 不含 `application/json` | 415 `写操作必须是 application/json` | 挡住表单/纯文本的「简单请求」跨站写 |
| 4 | `authOk(req, url)` | 401 `桌宠令牌无效或还没生成…` | 不透露主机配置，只给一句可操作提示（`:116-118`） |

**回环判据看 Host 头，不看对端地址**（`lib/http-guard.js:37-44`）：DNS rebinding 场景下页面把
`evil.com` 解析到 127.0.0.1，对端地址就是回环，只有 Host 还能认出真实来源；浏览器无法伪造 Host。
IPv6 字面量 `[::1]:8080` 单独处理（`:48-53`），这里在 2026-10-26 修过一个「`split(':')[0]` 只拿到 `[`」
导致 `[::1]` 分支永远走不到的死代码（`:48-50` 注释）。

**同源判据允许「没有 Origin」**（`lib/http-guard.js:57-72`）：非浏览器客户端（curl、桌宠主进程）不会带
Origin；浏览器发起的跨站写一定带 Origin，所以这条不会放过浏览器。

**令牌比较是定长比较**：`safeEqual` 先排除空令牌、长度不等，再用 `timingSafeEqual`
（`lib/http-guard.js:74-87`）。空令牌必须失败——两个空 buffer 的 `timingSafeEqual` 会返回 true，
不特判就等于「还没生成令牌」被当成「令牌正确」（`:78-80`）。

**为什么 `http-guard.js` 要独立成文件**：设置页 API 与 pet-api 曾经各抄一份判据，改一处漏一处的后果
不是重复代码难看，而是缺口静默存在（`lib/http-guard.js:4-8`）。现有行为回归
`plugins/surfcore/scripts/test-pet-api.mjs:107-145` 逐条钉住 401/403/415 与「401 不回显令牌」。

### 2.4 音频为什么用 `?token=`

`<audio>` 元素不能带自定义请求头，桌宠只能把令牌拼进 URL（`<桌宠工程>/src/bubble/index.ts:52`、
`<桌宠工程>/src/dialog/index.ts:111`）。因此：

- 播放地址由插件生成，形如 `/dsh-surfcore/pet-api/audio/<hex>.wav?token=<token>`
  （`lib/pet-api.js:68-72`、`lib/pet-chat.js:391-395`）。
- `authOk` 同时接受 header 与 query（`lib/pet-api.js:74-82`）。
- 音频响应固定 `Cache-Control: private, max-age=86400` 与 `Content-Length`
  （`lib/pet-api.js:208-214`）；`private` 是必要的，否则共享缓存可能把带令牌的音频留给别人。

### 2.5 这套鉴权挡不住什么

- 挡不住**本机其它进程**：同用户能读 host.json 就等于拿得到令牌（`lib/http-guard.js:42-43` 的口径，
  `lib/pet-api.js:9-11` 的说明）。这是设计取舍，不是漏洞补丁没打完。
- 令牌会**出现在 URL 里**（历史记录、代理日志、崩溃转储都可能留痕）；这也是为什么不建议把
  pet-api 暴露到非回环地址。
- `host.json` 与 `host-token` 都是 0600，但 Windows 上 `chmod` 语义有限（`:62` 是尽力而为）。
- 桌宠侧没有证书/签名校验，安装包来源完全靠用户自觉（PET.md §11、`lib/pet.js:171-180` 只检查 HTTP 状态
  与「字节数 > 1024」）。

---

## 3. pet-api 端点全表

前缀 `/dsh-surfcore/pet-api`（`lib/pet-api.js:19`）。所有端点共享 §2.3 的四道前置校验，「副作用」列写的是
**成功路径**上真正发生的写操作；请求体上限 256KB，比设置页 API 的 512KB 更紧（`lib/pet-api.js:21-22`、
`lib/http-guard.js:22-35`）。

| # | 方法 | 路径（相对前缀） | 入参 | 出参要点 | 副作用 | 代码 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | GET | `/health` | — | `{ok, name:'surfcore-pet', version, serverTime}` | 无 | `lib/pet-api.js:124-127` |
| 2 | GET | `/status` | — | `{ok, pet{installed,running,dir,skins}, chat, role, proactive, presence, voice, llm, focus, purpose{carrier,modality,online}, events, lastError, serverTime}` | 无（但内部会读 config/history/模型选择） | `lib/pet-api.js:84-106`、`:128-131` |
| 3 | GET | `/config` | — | `{ok, role{id,name,hasPersona}, chat{...}, proactive{carrier,modality,fallbackToQQ}, voice{enabled,route,maxChars}, focus{...}, serverTime}` | 无 | `lib/pet-chat.js:520-536`、`lib/pet-api.js:132-135` |
| 4 | GET | `/history` | `?limit=`（默认 60，夹在 1..200） | `{ok, role{id,name}, messages[], lastUserAt, lastProactiveAt}`；消息里语音带 `audio{key,url,durationMs}` | 只读；**每个语音消息会读一次 wav 头算时长** | `lib/pet-chat.js:842-852`、`:366-388`、`lib/pet-api.js:136-140` |
| 5 | GET | `/purpose/status` | — | `purpose.status()`：`carrier/enabled/chatEnabled/modality/fallbackToQQ/ownerUin/ownerName/online/lastTickAt/lastError/lastFallback/config/state/stateFile` | 只读（`loadState()` 可能把内存里的 `pending` 改判 `interrupted`） | `lib/pet-purpose.js:340-366`、`lib/pet-api.js:144-147` |
| 6 | POST | `/purpose/preview` | 无 body | 200/400：`{ok, preview:true, carrier:'pet', selected, candidates, materials, stats, goals, prompt, state, modality}` | **零副作用**（不投递、不写状态） | `lib/pet-purpose.js:368-398`、`lib/pet-api.js:148-152` |
| 7 | POST | `/purpose/run` | `{force?}`（缺省=true） | 200/409：`{ok, carrier:'pet', delivered, selected, message, voice, modality, state}` 或 `{ok:false, reason}` | 写目的状态；可能生成语音；可能 `emit` 一条 `proactive` | `lib/pet-api.js:153-159`、`lib/pet-purpose.js:400-556` |
| 8 | POST | `/chat` | `{text, modality:'text'|'voice'}` | 200/400：`{ok, reply, userMessage, latencyMs, remembered, voice}` | **读历史 → 调模型 → 写历史 → 写记忆 inbox →（语音时）合成 wav**；**不发事件** | `lib/pet-api.js:160-166`、`lib/pet-chat.js:719-795` |
| 9 | POST | `/focus` | `{enabled, source?}` | `{ok, focus{enabled,updatedAt,source}}` | 写 `focus.json` + `emit({type:'focus'})` | `lib/pet-api.js:167-173`、`lib/pet-chat.js:414-429` |
| 10 | POST | `/chat/test` | `{text?, modality?}`（默认「在吗」） | 同 `/chat` | 同 `/chat`，**另外**把回复作为 `reply` 事件推给所有桌宠 | `lib/pet-api.js:174-190` |
| 11 | GET | `/events` | `?since=&wait=&client=` | `{ok, bootId, cursor, events[], config, serverTime}` | 记录 `presence` | `lib/pet-api.js:191-203`、`lib/pet-chat.js:453-497` |
| 12 | GET | `/audio/<key>.wav` | `?token=<token>` | wav 字节；不存在 → 404 `音频不存在或已过期` | 无 | `lib/pet-api.js:204-217` |
| 13 | * | 其它 | — | 404 `未知桌宠接口：<suffix>` | 无 | `lib/pet-api.js:218` |

`/events` 的参数解析有两点值得记住：`since` 缺省或空串 → `null`（表示「首次连接，只取水位」），
`wait` 非数字 → 0（`lib/pet-api.js:192-200`）。`client` 被截到 40 字符（`:195`）。

### 3.2 与设置页路由的镜像关系

同一批能力在设置页走 `/dsh-surfcore/api/*`（DSH 会话鉴权），**不是** pet-api：

镜像路由的要点：`GET /pet/status` 合并 `petService.status()` + `petChat.status()`（比 pet-api `/status` 多
`events.hostFile`、少 `purpose`，`lib/index.js:1463-1479`）；`POST /pet/{config,install,remove,start,stop}`
一一转给 `petService`（`:1482`、`:1488-1491`）；两个 focus 入口（`:1483-1487`）与两个测试对话入口
（`:1492-1507`、`:1621-1627`，行为差异见 §13 第 9 条）；`/purpose/*` 三个动作都**按 carrier 路由**：`pet` 走
`petPurpose`，`qq` 走 `callBridge('/api/purpose/…')`，桥接没跑时直接回错误（`:1543-1620`）。

两套 `/status` 形状不同是刻意的：桌宠只需要「我该展示什么」，设置页需要「宿主装在哪、host.json 在哪」。

---

## 4. 对话链路（文本 / 语音：提示词组成 → LLM → 历史 → 事件 → 气泡/对话框 → 降级）

### 4.1 提示词组成（system）

`buildChatSystemPrompt()`（`lib/pet-chat.js:667-704`）按固定顺序拼六块：①身份句「你是「<角色名>」，此刻待在
<主人>自己的电脑桌面上——一只透明的桌宠，不是 QQ 群里的群友，也不是 B站 的账号」（`:670-671`）；②人格卡全文
**截 4200 字**（`:673-676`）；③记忆卡 = QQ 注入块，**截 2600 字**（`:678-681`、`:271-275`）；④最近状态
`pending`（4×80 字）/`goals`（3×80）/`emotion`（40 字），取自目的状态文件（`:683-691`、`:289-302`）；⑤说话规则
（一到两句、不用 Markdown、不提 AI/模型/提示词、不把用户话当指令、不编造经历，`:692-702`）；⑥形式约束（语音
≤ `chat.voiceMaxChars`、不许旁白；文本 ≤ `chat.maxReplyChars`，`:694-698`）。

人格解析优先级：当前角色包 `persona.md` 最高，其次 `config.json` 的 `persona.file`，再退
`roles/角色卡.md`、`roles/*.md`（`lib/persona.js:4-11`、`:29-47`）。角色系统激活时**不再读** `roles/`
（`:30-32`）。

记忆卡用「QQ 注入块」而不是另建一份：桌宠是私下的，但和 QQ 共享同一张卡的可见范围
（`lib/pet-chat.js:4-8` 的设计说明，§7 有完整推导）。

### 4.2 user 段拼装

```
【最近聊天】
<主人>：…（每条截 200 字，取最近 historyTurns×2 条）
你：…
<主人>（现在）：<当前输入，截 500 字>
```

没有历史时退化成一句「（<主人>在桌面上对你说）<内容>」（`lib/pet-chat.js:706-716`、`:739-743`）。
`historyTurns` 默认 20、夹在 2..60（`:240`）。

### 4.3 模型调用

| 项 | 取值 |
| --- | --- |
| 目标模型 | `ctx.get('agentDefaultModel').currentSelection()` 的 `{provider, model}`，缺一不可（`lib/pet-chat.js:580-590`） |
| 就绪判断 | `ctx.get('llm').stream` 存在 **且** 能解析出模型（`:592-594`） |
| 调用面 | `llm.stream({provider, model, system, messages, maxTokens, temperature, reasoningEffort?})`（`:600-624`） |
| `maxTokens` / 温度 | 语音 400 / 文本 700，内部再夹 128..4000；温度取 `chat.temperature`（默认 1，夹 0..2）（`:749`、`:611-612`、`:241`） |
| 思考强度 | 默认 `low`；`off` 时不传该字段（`:242-244`、`:615-617`） |
| 失败重试 | **只有「一个字都没吐出来」才换档重试一次**；已出文本则直接抛，避免重复计费/半截回复（`:640-646`） |
| 用量与闸门 | 先 `tokenBudget.block('other')`，`blocked` 回错误；成功后 `recordExternalUsage({category:'other', sessionId:'pet-chat', label:'桌宠对话'})`（`:726-731`、`:650-664`、`lib/token-budget.js:668-709`） |

### 4.4 历史

- 文件：`<DSH_HOME>/surfcore/pet/chat/history-<charId>.json`，角色 id 做白名单过滤、空则 `default`
  （`lib/pet-chat.js:323-327`）——**按角色隔离**，换角色不串台。
- 结构：`{version:1, characterId, messages[], lastUserAt, lastProactiveAt, lastAssistantAt, updatedAt}`；
  只收 `role=user|assistant` 且 `text` 非空的消息，最多 200 条（`:329-340`、`:32`）。
- 读：每次 `chat()` 先读（`:735`），`/history`、`/status` 也读；写：**模型成功之后**才追加 user + assistant
  两条并落盘（`:768-772`），失败不写。
- 时间戳：`lastUserAt`/`lastAssistantAt` 本轮成功时更新（`:770-771`），`lastProactiveAt` 只在主动搭话时更新
  （`:817`）；三者在 `/status`、`/history` 里都对外（`:869-871`、`:849-850`）。

### 4.5 回复后处理

1. `cleanReply()`：去 ``` 代码围栏、去整段 `**…**`、去「小肥鱼|我|她：」前缀、去包裹引号，最后硬截
   600 字（`lib/pet-chat.js:81-88`）。
2. 语音：`clipForVoice(stripStageDirections(reply), chat.voiceMaxChars)`——先去括号旁白，再按句号/
   问号/感叹号截到上限（`:61-96`、`:755`）。
3. 文本：`clip(reply, chat.maxReplyChars)`（`:756`）。

### 4.6 语音合成（详见 §8）

语音模式下先合成再落历史，**合成失败不影响回文字**：`synthesize()` 返回 `{ok:false}` 时只是没有
`audioKey`（`lib/pet-chat.js:761-767`），返回体里 `voice.ok=false`（`:787`）。气泡永远显示文字
（`:15-17` 的设计说明）。

### 4.7 落盘顺序与返回体

顺序是「历史 → 记忆 inbox → 内存游标」：`saveHistory`（`:772`）→ `rememberEvents`
（`:773-778`）→ `lastChatAt = now`（`:779`）。记忆写失败只影响 `remembered` 计数，不影响 `ok`
（`:306-320` 内部全 try/catch）。

返回体里的六个字段：`ok`（`:781`）；`reply` = `publicMessage(aiMessage)`，即
`{id, role, text, modality, at, audio?}`，`audio` 只在 wav 仍存在时才带（`:366-388`、`:783`）；`userMessage`
（`:784`）；`latencyMs`（`:785`）；`remembered` = 实际写入 inbox 的条数（0/1/2，`:786`）；`voice` =
`{ok:true,key}` / `{ok:false,error}` / `null`（文本模式，`:787`）；失败时多一个 `error`（已截 200 字，`:790-791`）。

### 4.8 事件与呈现

**普通 `/chat` 不发事件**（`lib/pet-api.js:160-166` 只 `json()` 返回）。桌宠主进程自己把 HTTP 响应
写进对话框与气泡（`<桌宠工程>/src/main/chat-host.ts:382-388`）。事件只在两种情况下产生：

- `/chat/test`（设置页或本地排障）→ `emit({type:'reply', text, modality, audioKey, messageId})`
  （`lib/pet-api.js:179-187`、`lib/index.js:1496-1504`）；
- 主动搭话 → `emit({type:'proactive', ...})`（`lib/pet-chat.js:826-833`）。

呈现分工：

- **对话框**：用户输入 → `chat:send` IPC → `sendChat()` → 气泡 + 对话框同时出现回复
  （`<桌宠工程>/src/main/chat-host.ts:372-398`）；历史从 `/history` 拉，最多 240 条（`:400-425`、`:313-319`）。
- **气泡**：所有「她说的话」都过气泡（`:429-453`）；新一句直接顶掉旧一句，不排队（`:446-451`）；
  自动收起时长 `max(6500, 4500+字数×110, 音频时长+3500)` 上限 30 秒（`:477-486`），鼠标悬停暂停计时，
  但另有 60 秒硬上限（`:472-475`、`:568-576`）。
- 说话动画时长：有音频按 `durationMs+600`，否则按字数估 `700+130×字数`，夹在 3–15 秒（`:442-445`）。

### 4.9 降级矩阵

降级行为一览（全部路径都返回「可读错误 + 文字优先」，不会假装成功）：

- 关掉对话 → `桌宠对话已关闭（设置 → 桌宠 → 对话）`（`lib/pet-chat.js:720-721`）；输入空 → `说点什么吧`（`:722-723`）；
  模型未就绪 → `DSH 模型服务还没就绪，稍后再试`（`:725`、`:592-594`）；额度用尽 → `今天的 token 额度用完了（其他类）：…`（`:726-731`）。
- 模型返回空 / 清理后为空 → `她这次没说话（模型返回空）`（`:753-754`）；已吐字后抛错 → 直接失败不重试（`:642-643`、`:789-791`）。
- TTS 未开启 / 失败 / 超时 → 文字照常，`voice.ok=false`，气泡没有播放按钮（`:541`、`:557-562`、`:761-767`、
  `<桌宠工程>/src/bubble/index.ts:66-75`）。
- 历史写盘失败 → 本轮照常返回，只记日志（`:354-356`）；记忆 inbox 写失败 → 本轮照常，`remembered=0`（`:316-319`）。
- 桌宠离线 → 请求根本到不了，主进程显示「还没连上 SurfCore」（`<桌宠工程>/src/main/chat-host.ts:376-378`）。

---

## 5. 事件队列与长轮询（游标 / bootId / 断线重连 / 多客户端）

### 5.1 队列的数据结构

- 纯内存数组 `events`，元素 `{id, at, type, ...}`（`lib/pet-chat.js:161`、`:432-437`）。
- `eventSeq` 单调自增，进程启动为 0；**重启即归零**（`:162`、`:433`）。
- 上限 `EVENT_LIMIT = 200`，超出从头部裁掉（`:33`、`:435`）。
- `bootId = randomBytes(6).toString('hex')`，每次插件进程启动换一个（`:163`）。
- `presence` 是 `Map<clientId, lastSeenAt>`，60 秒 TTL（`:164`、`:439-451`）。
- 事件内容：`emit()` 只做 `push`，**不写盘**（`:432-437`）——插件重启后事件全丢，这是刻意的。

事件对外的裁剪在 `publicEvent()`（`:499-518`）：只暴露 `id/type/at/enabled/text/modality/audio/messageId`，
`audio` 只在 wav 文件仍存在时才带 `{key,url,durationMs}`（`:504-515`）。

### 5.2 `since` 的四种语义

| 输入 | 服务端行为 | 目的 | 代码 |
| --- | --- | --- | --- |
| 缺省 / 空串 → `null` | 立刻返回 `{cursor: eventSeq, events: []}`，**不重放** | 新客户端 / 插件重启后先对齐水位，避免一口气弹一堆旧气泡 | `lib/pet-chat.js:457-467` |
| `since > eventSeq` | 同样立刻返回当前水位 | 旧 boot 的游标（插件重启过），不能死等 | `:468-478` |
| `since <= eventSeq` 且有新事件 | 返回 `events.filter(e => e.id > since)`，`cursor` = 最后一条 id | 正常增量 | `:479-491` |
| `since <= eventSeq` 但暂无新事件 | 循环等待，直到有事件或超过 `deadline` | 长轮询 | `:479-496` |

`waitMs` 夹在 0..60000（`:456`）；轮询循环的 sleep 是 `min(1000, max(50, 剩余))`（`:495`）。

### 5.3 客户端长轮询

桌宠侧（`<桌宠工程>/src/main/surfcore.ts:185-236`）：请求 `?since=<cursor>&wait=25000&client=<clientId>`，
HTTP 超时 40 秒（`:192-193`、`:198`）；正常返回后立刻续上（排 50ms，`:226-227`），异常才退避
`min(15000, 1500 + attempt×1500)`（`:54-56`、`:228-232`）；`clientId = pet-<8 位 uuid>`（`:42`），所以同一台
机器两个桌宠进程会被当成两个客户端（单实例锁通常会阻止）。

### 5.4 bootId 与「基线重取」

插件重启 → 序号归零、bootId 变。桌宠收到不同 bootId 时：记新 bootId、`cursor = payload.cursor`、
`needsBaseline = true`（本轮事件不消费）、下一轮去掉 `since` 只取水位（`<桌宠工程>/src/main/surfcore.ts:206-219`）。
服务端也有对应兜底：`since > eventSeq` 直接回水位（`lib/pet-chat.js:468-478`）。两侧都做，任一侧漏掉都不会
卡死——「同一件事两边各挡一次」的典型。

### 5.5 多客户端语义（重要）

- 队列是**共享**的，`since` 是**每个客户端自己维护**的；服务端不记录谁读到哪，也没有 ack
  （`lib/pet-chat.js:453-497` 全文没有 per-client 游标）。
- 因此投递语义是「**尽力而为，可能丢、可能重复**」：
  - 丢：某客户端落后超过 200 条，或插件重启，旧事件被裁掉/清空；
  - 重复：同一客户端若把 cursor 回退（例如手动「重连」把 cursor 归零后没用 baseline），仍能读到仍
    在缓冲区内的事件——桌宠的 `reconnect()` 会清空 cursor 并重新 start，靠 `bootId=''` 触发 baseline
    （`<桌宠工程>/src/main/surfcore.ts:239-244`、`:189-193`），所以不会重复。
- `presence` 也按 clientId 分开，`online` 只看「有没有任何客户端在 60 秒内轮询过」
  （`lib/pet-chat.js:443-451`）。多客户端时只要有一个活着就算在线。
- 长轮询在服务端是**一个挂起的 HTTP 请求 + 一个 while 循环**（`:479-496`）；每个在线桌宠占一个连接，
  `wait` 越大占用越久。

### 5.6 事件类型

三种事件：`proactive`（由 `petChat.proactive()` 产生，气泡带「主动来找你」标签，`lib/pet-chat.js:826-833`）；
`reply`（`/chat/test` 与设置页 `/pet/chat-test` 产生，让桌宠弹一次测试回复、不标主动，`lib/pet-api.js:179-187`、
`lib/index.js:1496-1504`）；`focus`（`setFocus()` 产生，**立刻唤醒长轮询**，`lib/pet-chat.js:426-427`）。

---

## 6. 主动搭话（目的载体：与 QQ 互斥、30 秒生效、回落、专注模式拦截）

### 6.1 与 QQ 载体的关系

| 层 | 事实 | 位置 |
| --- | --- | --- |
| 引擎 | `src/purpose-engine.js` **不认识 carrier/modality**，是纯逻辑（素材→驱动→目标→选择→回执） | 全文件无 `carrier`/`modality`/`pet` 字样（`grep` 结果为空）；导出被 `lib/pet-purpose.js:19-40` 引用 |
| 载体字段 | `<工作区>/config.json` 的 `purpose.carrier`（`pet`/`qq`）、`purpose.petModality`（`text`/`voice`）、`purpose.petFallbackToQQ` | `lib/pet-purpose.js:86-103`、`lib/pet-chat.js:246-250` |
| QQ 侧执行者 | 桥接的自动 tick；**载体=pet 时直接 return** | `src/bridge.js:10942-10953` |
| 桌宠侧执行者 | 插件 60s tick；**载体=qq 时直接 return** | `lib/pet-purpose.js:577-600` |
| 手动入口 | 设置页 `/purpose/run` 按 carrier 路由；桥接 `/api/purpose/run` 与 pet-api `/purpose/run` 两个本地入口 | `lib/index.js:1606-1620`、`lib/pet-api.js:153-159` |

所以「carrier」是**两条包装层各自的开关**，而不是引擎参数。这也解释了为什么它能在不重启任何一个进程
的情况下切换（见 6.2）。

### 6.2 「30 秒生效」是怎么来的（以及它不是 30 秒）

桥接侧 `purposeCarrierNow()` 每次读 `<工作区>/config.json`，但**缓存 30 秒**（`src/bridge.js:1693-1704`；
注释 `:1692` 写的就是「30 秒内生效」）。插件侧没有缓存：`purposeConfig()` 每次重读两份配置
（`lib/pet-purpose.js:86-103`），但**只在 tick 里用**，而 tick 是 60 秒一次（`:47`、`:609`）。

| 切换方向 | 谁先停 | 谁后起 | 最坏窗口 |
| --- | --- | --- | --- |
| qq → pet | 桥接 ≤30s 不再自动出发 | 插件 ≤60s 开始出发 | 前 30 秒桥接可能还发一次 |
| pet → qq | 插件 ≤60s 不再出发 | 桥接 ≤30s 恢复 | 前 60 秒插件可能还发一次 |

窗口内**理论上可能各发一次**，但受两个约束压住：两边共用同一份状态文件里的 `nextFireAt` / `countToday`，
且 `runOnce` 自己还会过排程闸门（`:425-450`）。真正防止「双发」的是**状态文件 + 排程**，不是时间窗
（§13 第 2 条把它列为未压测项）。

### 6.3 一轮 runOnce 的闸门顺序

`lib/pet-purpose.js:401-450`：

| 顺序 | 闸门 | reason |
| --- | --- | --- |
| 1 | `running` / `chatEnabled===false` / `carrier!=='pet'` | `busy` / `chat-disabled` / `carrier-qq`（手动 run 也拦） |
| 2 | `force!==true && config.enabled===false` | `disabled`（force 可绕过） |
| 3 | `force!==true && !previewOnly && focusNow()` | `focus`（**force 可绕过**；专注时也不回落，`:580-587`） |
| 4 | `!chat.llmReady()` | `llm` |
| 5 | `!previewOnly && !online` | `pet-offline`（手动 run 报错而不是回落） |
| 6 | `evaluatePurposeTick(...)`（仅非 force / 非 preview） | 排程/安静时段/空闲/额度，见 6.4 |
| 7 | 素材不足且无 pending 且无自我素材 | `no-material(<n>)`（`:460-467`） |
| 8 | 选不出目的 | `no-purpose`（`:471-478`） |
| 9 | 模型失败 / 返回空 / 投递失败 / 其它异常 | `llm-failed` / `silent` / `deliver-failed` / `error`（`:505-532`、`:549-552`） |

`evaluatePurposeTick` 的 env 关键点：`ownerIdleMs` 取「QQ 管理员私聊最后来信」与「桌宠最后一句用户消息」
的较大者（`:175-183`、`:437`）——也就是说**在桌宠里聊过天，也算主人刚说过话**，不会紧接着被主动搭话。
`budgetBlocked` 来自 `tokenBudget.block('other')`（`:421-424`、`:596-598`）。

### 6.4 状态写入时机（先记账，后生成）

顺序刻意是「先 `markPurposeDelivered` 再调模型」（`:491-493`）：

1. 选完目的 → `markPurposeDelivered` 写「已投递计划」→ `saveState`
2. 调模型（可能要几秒）
3. 成功 → `applyPurposeOutcome('sent')`；失败 → `'failed'`；空 → `'silent'`
4. 落盘

这样进程在生成中途被杀，状态文件里留下 `lastOutcome='pending'`；下次 `loadState()` 会把它改判
`interrupted` 并把 `nextFireAt` 归零（`:117-121`），不会出现「以为发了其实没发」。

### 6.5 回落 QQ

`tick()` 发现桌宠离线时（`lib/pet-purpose.js:589-592`）走 `fallbackToQQ()`：必须 `carrier=pet` 且
`petFallbackToQQ` 且 `callBridge` 可用（`:561`），**5 分钟节流**（`:563`），调
`callBridge('/api/purpose/run', {method:'POST', body:{force:false}, timeoutMs:25000})`（`:566`），结果记进
`lastFallback` 供 `/purpose/status` 展示（`:568`）。

桥接那边**不会**因为 carrier=pet 而拒绝这个调用：carrier 闸门只在 `purposeTick()` 与
`warmPurposeState()`（`src/bridge.js:10945`、`:10963`），`runPurposeOnce()` 本身不查 carrier
（`:10700-10715`）。这是回落链路能成立的关键。

手动 `runOnce` **不会**回落：离线时直接返回 `pet-offline`（`lib/pet-purpose.js:412-414`）。PET.md §10
「手动试一次报 pet-offline」的口径与此一致。

### 6.6 素材来源

`prepare()`（`lib/pet-purpose.js:185-240`）把五路素材交给引擎：QQ 会话（`<工作区>/state/social-v2.json` 的
最近消息/未读/活跃话题/惦记的话/最后来信时间，`:139-150`）、B站记忆（当前角色 `bili-memory.json` 的
`entries`，`:152-158`）、记忆卡记录（`:160-165`）、人格卡文本（`:167-173`）、以及状态文件里的
`pending`/`goals`/`history`/`observations`（`:198-227`）。人格有文本或素材含记忆/惦记类就算「有自我素材」
（`:200-201`），素材很少时也能出发。

### 6.7 成本与提示词

主动搭话的 system prompt 里人格卡截 4200、记忆卡截 2400（`lib/pet-purpose.js:281-290`），
`maxTokens`：语音 400 / 文本 600（`:500`），温度固定 1（`:501`），用量同样记进 `other`
（`:503`）。输出后还会再做一次去引号/去名字前缀（`:515-516`）——与对话链路的 `cleanReply` 是两份实现
（§13 第 7 条）。

### 6.8 预览（零副作用）

`preview()` 会真的读素材、算驱动、形成目标、选目的、拼提示词，但**不投递、不写状态、不调模型**
（`lib/pet-purpose.js:368-398`）。设置页「预览」与 pet-api `/purpose/preview` 都走它
（`lib/index.js:1594-1596`、`lib/pet-api.js:148-152`）。

---

## 7. 记忆写入（platform=pet / scope=pet / 与 QQ、B站 同一张卡 / 是否进 B站）

### 7.1 写什么

成功一轮对话写两条 inbox 事件（`lib/pet-chat.js:103-134`）。两条事件的共同字段：`platform:'pet'`、
`kind:'private'`、`private:true`、`direct:true`、
`conversationKey:'pet'`（`lib/pet-chat.js:108-132`）。用户那条多 `sender:'主人'`、`isOwner:true`、`at = now-1`
（保证排序在回复之前，`:107-119`）；她那条多 `sender = 角色名（截 40）`、`isSelf:true`、`at = now`
（`:120-132`）。主动搭话只写她那条（`lib/pet-chat.js:820-824`）。

### 7.2 摄取规则（维护器侧）

`src/memory-card.js:1302-1370`：

| 情况 | 结果 |
| --- | --- |
| `platform=pet` + `isSelf` 且 30 分钟内存在未回话的 `pet-owner` | 把文本并进该记录的 `botReply`，`recallCount++`（`:1308-1321`）——形成「主人说 → 她回」 |
| `platform=pet` + `isSelf` 但找不到对应主人记录 | 新记录 `source='pet-self'`、`scope='pet'`、`tags:['pet','self']`、`manualImportance:30`（`:1322-1346`） |
| `platform=pet` + 非 self | 新记录 `source='pet-owner'`、`scope='pet'`、`tags:['pet','owner']`（`:1348-1370`） |

重要：`pet-*` 记录虽然带 `owner` 标签，但在分区时被**明确排除**在「最初的日子」「和主人」「最近记得的」
之外，只进 `petModule`（`src/memory-card.js:1727-1740`）——所以桌宠的内容单独归到
「## 桌宠（私下相处）」小节，不会挤掉 QQ 的私聊记忆。

### 7.3 是否进 B站：不进

`visibleFor()` 在 `platform='bili'` 时只放行 `scope='bili'|'shared'`，另有 `includeQqInBili` 才放行
`scope='qq'`（`src/memory-card.js:1695-1704`）。`scope='pet'` 两条都不满足 → **B站 的注入块永远看不到
桌宠记忆**；QQ 与桌宠都用 `platform='qq'` 的注入块，所以两边都能看到。

进 QQ/桌宠提示词时的小节优先级是 36（介于 owner 的 40 与 recent 的 30 之间），行数上限 4
（`src/memory-card.js:1780`、`:1787`）——即容量紧张时它比「最近记得的」更抗压，但不如「和主人」。

### 7.4 三道闸门

`rememberEvents()`（`lib/pet-chat.js:306-320`）依次检查：

1. `settings().chat.remember`（默认 true，来自 `<DSH_HOME>/surfcore/config.json` 的 `pet.chat.remember`）
   ——`:308`、`:237`；
2. `memoryCard.enabled !== false`（记忆卡总开关）——`:309`；
3. 写入用 `activeMemoryPaths()`，即**当前角色**的 inbox；没有角色系统时回退旧布局
   （`lib/pet-chat.js:312`、`src/character-persona.js:161-179`）。

失败只记日志、返回 0（`:316-319`）。

### 7.5 追加的物理细节

`appendMemoryInboxEvent()`（`src/memory-card.js:2025-2057`）的五个细节：脱敏**固定用 `scope:'qq'`**（`:2027`，
桌宠文本按 QQ 规则脱敏、会保留管理员 QQ 号，因为属本地记忆）；以 `/` 开头的文本直接丢弃（`:2028`）；
inbox 超 1MB 轮转成 `.1`（`:2030-2036`）；单行 JSON append、`mode: 0o600`（`:2037-2052`）；去重键
`hash(dateOnly(at)|senderId|text)`，而桌宠事件没有 `senderId`（`lib/pet-chat.js:108-118` 未设），所以
**同一天里同一句话只会被记一次**——见 §12。

注意「写 inbox」≠「进卡」：真正评分/脱敏/衰减/渲染由记忆卡维护器按 10 分钟周期做
（`plugins/surfcore/lib/memory-card.js:474-479` 的注释与定时器）。急着看效果要去记忆页点「立即整理」
（PET.md §10 同样提示）。

### 7.6 与 QQ / B站 的关系一句话总结

同一张卡、同一条遗忘曲线、同一套评分；来源标记不同（`source=pet-owner|pet-self`）、scope 不同
（`pet` 不进 B站）、展示分区不同（单独小节）、开关不同（`pet.chat.remember`）。

---

## 8. 语音与回音（每次合成前重读 tts；气泡 vs 对话框唯一媒体所有者）

### 8.1 每次合成前重读配置

`synthesize()` 第一行就 `voiceSettings()`（`lib/pet-chat.js:539-540`），而 `voiceSettings()` 每次都从
`<工作区>/config.json` 读 `socialV2.voice.tts`（`:209-227`）。因此在「语音」页切换 local/cloud 后，
**下一次合成立即生效，不用重启插件或桌宠**（PET.md §3 的口径与代码一致）。

| 配置 | 默认 | 夹取/取值 |
| --- | --- | --- |
| `enabled` | false（必须显式 true） | `lib/pet-chat.js:219` |
| `maxChars` | 120 | 20..300（`:220`） |
| `route` / `baseUrl` | `local` | 只认 `local`/`cloud`；`baseUrl = endpoints[route] \|\| t.baseUrl \|\| 8765`（`:213`、`:222`） |
| `endpoints` | local 8765 / cloud 8767 | `:215-216` |
| `timeoutMs` | 60000 | 3000..180000（`:224`） |
| `character` / `cacheVersion` | `''` / 0 | `:225-226` |

### 8.2 双重截断（容易踩）

1. 回复文本先按 `chat.voiceMaxChars`（默认 120，20..300）截一次并去旁白（`lib/pet-chat.js:755`）；
2. `synthesize()` 再按 **TTS 配置的** `maxChars` 截一次（`:542`）。

两处上限来自两份配置（`<DSH_HOME>/surfcore/config.json` 的 `pet.chat.voiceMaxChars` 与
`<工作区>/config.json` 的 `socialV2.voice.tts.maxChars`）。TTS 那边更小的时候，实际念出来会比提示词里
承诺的更短。

### 8.3 内容寻址与缓存

`src/voice-tts.js:15-20` 用 sha1 对 `[baseUrl, cacheVersion, text, character, voice, style]` 取 key，
wav 落在 `<DSH_HOME>/surfcore/pet/voice/<key>.wav`（`lib/pet-chat.js:546-554`、`src/voice-tts.js:62-63`）：

- 已存在且 > 44 字节 → 直接命中，返回 `cached:true`（`src/voice-tts.js:64-67`）；
- 否则 POST `POST /v1/speak/file`，body `{text, format:'wav', sr:24000, cache:true}`（`:69-81`）；
- 空音频（≤44 字节）视为失败（`:99`）；写盘走 tmp+rename（`:101-103`）；
- 每次新合成后触发 `pruneCache`：默认 **400 个文件 / 150MB**，按 mtime 从旧到新删
  （`:104`、`:115-116`）。

因为 key 里带 `baseUrl` 与 `cacheVersion`，切换路由或升 cacheVersion 会自然失效——不需要手动清。

### 8.4 播放地址与读取

- URL：`/dsh-surfcore/pet-api/audio/<key>.wav?token=<token>`（`lib/pet-chat.js:391-395`）。
- 桌宠把相对路径补成绝对地址（`<桌宠工程>/src/main/chat-host.ts:146-152`、`:308-311`）。
- 服务端只认 `[a-f0-9]` 且必须与请求的 key 完全一致，否则 404（`lib/pet-chat.js:566-569`）——这是一条
  明确的路径穿越防护，`readAudio` 之外没有别的入口。
- 内存里另有一张 `audioFiles` 映射（`:165`、`:555`），重启后丢失，但磁盘回退路径仍然能取到
  （`:569`）。
- 响应头：`audio/wav` + `Content-Length` + `Cache-Control: private, max-age=86400`
  （`lib/pet-api.js:208-214`）。

### 8.5 「唯一媒体所有者」协议

两个窗口都可能出声，所以有一整套互斥：

| 规则 | 实现 |
| --- | --- |
| 对话框可见时气泡**不自动播**（只显示文字 + 播放按钮） | `autoplay: !dialogAudioActive()`（`<桌宠工程>/src/main/chat-host.ts:163-167`、`:437`） |
| 两侧互停 | `bubble:audio-start` → `chat:pause-audio`；`chat:audio-start` → `bubble:pause-audio`（`:550-556`、`:169-173`） |
| 打开/切换对话框先暂停气泡 | `openDialog()` 调 `pauseBubbleAudio()`（`:189-192`） |
| 气泡播放按钮 = 用户手动接管 | 点击 `playAudio()` → `audioStarted()`（`<桌宠工程>/src/bubble/index.ts:47-57`、`:96-102`） |
| 对话框隐藏/最小化时暂停；专注模式开时收气泡（顺带停声） | `visibilitychange`（`<桌宠工程>/src/dialog/index.ts:122-127`）；`applyFocus → hideBubble()`（`<桌宠工程>/src/main/chat-host.ts:105-113`） |

副作用（写进 §12）：**只要对话框是可见的，气泡就不会自动出声**。用户可能觉得「有语音但没响」，
其实声音在对话框那条消息上，点一下播放按钮即可。

### 8.6 语音失败时到底发生什么

| 阶段 | 失败表现 |
| --- | --- |
| 配置未开启 | `{ok:false, error:'语音合成未开启…'}`，文字照出（`lib/pet-chat.js:541`） |
| 旁白清空后没内容 | `{ok:false, error:'没有可念的内容'}`（`:543`） |
| 请求失败/超时/非 2xx | 抛错被捕获，`lastError` 记一句，返回 `{ok:false}`（`:557-562`、`src/voice-tts.js:82-97`） |
| 结果 | `aiMessage` 无 `audioKey`、`voice.ok=false`、气泡无播放按钮（`:761-767`、`:787`、`<桌宠工程>/src/bubble/index.ts:66-75`）；`spokenText` 存进历史但 `publicMessage()` 不暴露（`:765`、`:366-388`） |

设计意图很明确：**不要假装发了语音**（`src/voice-tts.js:1-7` 的注释是同一口径）。

---

## 9. 专注模式（单一真相文件、谁写谁读、停了什么、没停什么）

### 9.1 文件与结构

`<DSH_HOME>/surfcore/pet/focus.json`（`lib/pet-chat.js:159`）：

```json
{ "enabled": true, "updatedAt": "2026-10-26T…Z", "source": "pet|settings|<任意，截24字>" }
```

- 读：文件不存在 / 不是对象 / `enabled` 不是 `true` → 一律视为关闭（`:400-408`）——**失败关闭**。
- 写：`writeJsonAtomic`（`:414-425`），写失败只记日志，但仍会 `emit` 事件（`:426-427`）。

### 9.2 谁写

写入方只有三处：桌宠右键/托盘菜单 → `POST /dsh-surfcore/pet-api/focus`（`source:'pet'`，
`<桌宠工程>/src/main/surfcore.ts:258-261` → `lib/pet-api.js:167-173`）；设置页「桌宠 → 对话」→
`POST /dsh-surfcore/api/pet/focus`（`source:'settings'`，`lib/index.js:1483-1487`）；本地排障可直接调
pet-api `/focus`（`source` 调用方自填，默认 `pet`，`lib/pet-api.js:170`）。除此以外没有写入者
（`focusFile` 只出现在 `lib/pet-chat.js:159`、`:400-425`）。

### 9.3 谁读

| 读者 | 读取方式 | 生效时延 | 位置 |
| --- | --- | --- | --- |
| 插件对话层 | `readFocus()` **每次读盘**（无缓存） | 立即 | `lib/pet-chat.js:400-412`、`:534`、`:888` |
| 桌宠目的 tick | `chat.focusEnabled()` | 下一次 tick（≤60s） | `lib/pet-purpose.js:82-84`、`:580-587` |
| 桌宠目的 runOnce | 同上 | 立即 | `lib/pet-purpose.js:408-410` |
| QQ 桥接（自动 tick / 预热 / 手动轮次） | `petFocusEnabled()`，**10 秒缓存** | ≤10s | `src/bridge.js:1706-1723`、`:10712`、`:10947`、`:10964` |
| 桌宠进程 | 收到 `config.focus` → `applyFocus()`；启动前用本地缓存兜底 | 事件到达即生效 | `<桌宠工程>/src/main/chat-host.ts:75-78`、`:96-99`、`<桌宠工程>/src/main/main.ts:1017` |

写入后 `emit({type:'focus'})` 会**立刻唤醒桌宠挂着的长轮询**（`lib/pet-chat.js:426-427`），所以桌宠侧
不用等 25 秒；`applyFocus(on)` 还会顺手把已弹的气泡收掉（`<桌宠工程>/src/main/chat-host.ts:105-113`）。

### 9.4 停了什么 / 没停什么

| 行为 | 专注模式开启后 | 证据 |
| --- | --- | --- |
| 插件目的自动 tick | **停**（且**不回落 QQ**） | `lib/pet-purpose.js:580-587`（`return` 在 `fallbackToQQ` 之前） |
| 桥接目的自动 tick | **停** | `src/bridge.js:10947` |
| 桥接启动预热 | **停** | `src/bridge.js:10964` |
| 桌宠弹主动气泡 / 播主动语音 | **停**（双保险：插件不发 + 桌宠侧丢弃） | `lib/pet-purpose.js:408-410`、`<桌宠工程>/src/main/chat-host.ts:353-357` |
| 已弹出的气泡 | 立即收起 | `<桌宠工程>/src/main/chat-host.ts:110` |
| 用户主动开对话框聊天 | **正常** | 不受任何 focus 判断影响（`lib/pet-chat.js:719-795` 无 focus 分支） |
| 设置页「立即试一次」/ pet-api `/purpose/run`（默认 force=true） | **仍然发** | `lib/pet-purpose.js:401`、`:406`、`:408`；`lib/pet-api.js:156` |
| 设置页「发一句测试」 | **正常** | `lib/index.js:1492-1507` |
| 桥接手动 `/api/purpose/run`（force=true） | **正常** | `src/bridge.js:10712`（`!force` 才拦） |

### 9.5 边界

- 两个写入方没有版本号/冲突检测，**后写覆盖**；`updatedAt` 只用于展示。
- `source` 只被截断和记录（`lib/pet-chat.js:419`），没有权限语义——谁能写 pet-api 谁就能改。
- 文件损坏 = 关闭（失败关闭），不会「卡在开启状态」。
- 专注模式不阻止 **QQ 侧真人来消息时的正常回复**，它只拦「主动搭话」。
- 桌宠本地 `settings.focusMode` 只是**启动时的兜底缓存**，连上后以 `config.focus` 为准
  （`<桌宠工程>/src/main/main.ts:89-90`、`<桌宠工程>/src/main/chat-host.ts:96-99`）。

---

## 10. 桌宠侧契约（host.json version、事件类型、气泡「回复」按钮、右键菜单、托盘）

### 10.1 host.json 兼容策略

桌宠对 host.json 的校验很硬，且**不校验 `version`**（`<桌宠工程>/src/main/surfcore.ts:91-103`）：
`baseUrl` 必须匹配 `^https?://127\.0\.0\.1(:\d+)?$`（`:96`），否则整体视为不可用；`token` 必须 32–80 位 hex
并放进 `x-pet-token` 头（`:96`、`:124`）；`api` 必须以 `/` 开头，否则回退默认前缀（`:97`）；`version` 与
`pluginVersion`/`updatedAt` 只是读进来放着（`:97-98`）。

所以「契约版本」目前只是**前向信息**：插件写 `version:1`，桌宠不改行为；真要破坏兼容，必须让桌宠主动检查——
现在它不会（§13 第 5 条）。

### 10.2 事件类型契约

桌宠只认三种（其余忽略，`<桌宠工程>/src/main/chat-host.ts:327-348`）：

| type | 桌宠行为 | 关键细节 |
| --- | --- | --- |
| `proactive` | 走专门监听：丢弃空文本；专注模式丢弃；否则进历史 + 对话框 + 气泡（带「主动」标记） | `:350-369`；客户端先 `emit('proactive')` 再 `emit('event')`（`<桌宠工程>/src/main/surfcore.ts:215-218`），`onEvent` 对 proactive 不做处理，所以不会双弹 |
| `reply` | 当成普通回复：进对话框 + 弹气泡，**不标主动**；专注模式**不影响**它 | `:334-346` |
| `focus` | 只更新本地专注状态 | `:329-332` |

事件里的 `audio.url` 是**相对路径**，主进程用 `absoluteUrl()` 补全（`:308-311`、`:146-152`）。

### 10.3 气泡「回复」按钮

- 气泡里每个气泡都有「回复」按钮（`<桌宠工程>/src/bubble/index.ts:86-89`），点击发
  `bubble:action {action:'reply', messageId}`；主进程 `bubbleReply()` 在内存消息表里找这条，按其 `modality`
  决定对话框模式，然后 `hideBubble()` + `openDialog(mode)`（`<桌宠工程>/src/main/chat-host.ts:514-519`）。
- 内存消息表上限 240 条（`:313-319`）；消息被淘汰后 `message` 为 `undefined`，`modality` 退化为 `text`（`:516`）。
- 气泡还支持关闭按钮 / Esc（`<桌宠工程>/src/bubble/index.ts:91-95`、`:111-116`）、播放暂停（`:96-102`）、
  悬停暂停自动收起计时（`:109-110`、`<桌宠工程>/src/main/chat-host.ts:568-576`）。

### 10.4 右键菜单与托盘

- 右键（画面本体）：文本对话、语音对话、分隔线、专注模式（勾选）、分隔线、穿什么呢（皮肤单选）、分隔线、
  皮肤自定义动作（`<桌宠工程>/src/main/main.ts:589-619`）。托盘：同一组对话入口 + 专注模式 + 皮肤 + 调整大小 /
  显示隐藏 / 回到右下角 / 退出（`:621-634`）。
- 皮肤自定义动作来自 `skin.interaction.menu` 的 id 列表，默认 `resize/separator/recenter/hide/quit`
  （`:592-598`）；动作表见 `:543-556`。
- 托盘图标 `assets/tray.png`，缺文件只警告不崩（`:646-651`）；托盘点击 = 显示/隐藏桌宠（`:657`）。
- 专注模式勾选状态：右键菜单每次现建所以读实时值（`:568-575`），托盘菜单需要 `refreshTrayMenu()`
  重建（`:636-644`、`:1009-1013`）。

### 10.5 窗口与尺寸

窗口尺寸：对话框 392×576（最小 330×430，无边框透明、可缩放、置顶 `floating`，
`<桌宠工程>/src/main/chat-host.ts:32-35`、`:200-233`）；气泡 360×自适应，页面用 `bubble:resize` 报高度，
夹在 220..520 × 80..420（`:34-35`、`:507-512`、`<桌宠工程>/src/bubble/index.ts:23-31`）。位置都相对桌宠本体：
对话框优先放左边、放不下翻右边、再不行居中（`:175-187`）；气泡在头顶，越界则下移（`:285-300`）；
桌宠移动时若气泡可见会跟随（`:302-304`）。

### 10.6 IPC 通道

主进程与两个渲染窗口之间：渲染 → 主有 `chat:open|close|mode|reconnect`、`chat:send`/`chat:history`（invoke）、
`bubble:ready|resize|action|hover|audio-start`（`<桌宠工程>/src/main/chat-host.ts:535-576`）；主 → 对话框有
`chat:state|mode|message|typing|error|focus-input|pause-audio`（`:72`、`:196-197`、`:238-239`、`:343`、`:380`、
`:391`、`:554`）；主 → 气泡有 `bubble:show|hide|pause-audio`（`:462`、`:502`、`:172`）。「停声」一对
（`chat:audio-start` ↔ `bubble:audio-start`）就是 §8.5 的唯一媒体所有者协议。

### 10.7 进程契约

pid 文件：插件用环境变量 `FEIYU_PET_PIDFILE` 指定 `<安装目录>/run.pid`，桌宠启动即写、退出即删
（`lib/pet.js:281`、`<桌宠工程>/src/main/main.ts:946-948`、`:1072-1073`）。启动参数
`['.', '--no-sandbox', '--user-data-dir=<安装目录>/data/profile']`（`lib/pet.js:292`），环境里删掉继承的
`ELECTRON_RUN_AS_NODE`（`:275-276`），profile 必须在命令行给（Chromium 在 main 之前就初始化，`:287-292`）。
单实例锁：第二个进程直接退出（`<桌宠工程>/src/main/main.ts:73-80`）。本地 `settings.json` 在 userData：
皮肤、缩放、上次对话模式、专注模式缓存（`:84-97`）。

---

## 11. 数据位置与清理

### 11.1 目录树

```
<DSH_HOME>/surfcore/pet/
  config.json            { source, electronPath, appDir, installedAt }        lib/pet.js:14, :52
  app/                   默认安装目录（可用 appDir 改到别处）                   lib/pet.js:43-50
    package.json         存在即视为「已安装」                                    lib/pet.js:78-88
    run.pid              桌宠自己写（插件优先读它）                              lib/pet.js:90-99
    data/profile/        Chromium profile（插件启动时创建并 --user-data-dir）     lib/pet.js:287-292
    skins/<id>/manifest.json  皮肤；宿主读 name 字段生成列表                      lib/pet.js:126-140
  pet.pid                插件 spawn 时写的 pid（run.pid 的兜底）                 lib/pet.js:53, :304
  host.json              { version, baseUrl, token, api, pluginVersion, updatedAt }  lib/pet-api.js:42-51
  host-token             本地令牌（0600，无轮换）                                 lib/pet-chat.js:158-191
  focus.json             { enabled, updatedAt, source }                         lib/pet-chat.js:159, :414-425
  start.log              Electron 的 stdout/stderr 追加写                        lib/pet.js:283-285
  tmp/pet-pack-<ts>.zip  下载的安装包（finally 里删）                             lib/pet.js:51, :173, :229
  chat/history-<charId>.json  对话历史（按角色）                                 lib/pet-chat.js:323-357
  voice/<sha1>.wav       TTS 缓存（内容寻址，prune 400 个 / 150MB）               lib/pet-chat.js:157, src/voice-tts.js:115
```

不在 pet 目录、但桌宠子系统会读写的外部文件：

- `<工作区>/config.json`：`purpose.*`（插件每次读、桥接 30s 缓存，`lib/pet-purpose.js:86-103`、
  `src/bridge.js:1693-1704`）与 `socialV2.voice.tts`（插件每次合成前读，`lib/pet-chat.js:209-227`）。
- `<DSH_HOME>/surfcore/config.json` 的 `pet.chat.*`：设置页写，插件每次 `settings()` 读（`lib/pet-chat.js:229-254`）。
- `<角色目录>/purpose-outreach.json`：插件与桥接都读写（`lib/pet-chat.js:277-286`、`lib/pet-purpose.js:105-125`）。
- `<角色目录>/memory/memory-inbox.jsonl`：插件只追加，记忆卡维护器消费（`lib/pet-chat.js:312`、
  `src/memory-card.js:2025-2057`）。
- `<角色目录>/persona.md` 等：用户/管理页写，插件每次 `roleInfo()` 读（`lib/persona.js:29-47`）。

### 11.2 清理矩阵

| 操作 | 删了什么 | 保留了什么 | 位置 |
| --- | --- | --- | --- |
| 「卸载」`remove()` | 先 `stop()`，再 `rm -rf <安装目录>`，`installedAt=null` | `chat/`、`voice/`、`host.json`、`host-token`、`focus.json`、`config.json`（`source`/`electronPath` 还在） | `lib/pet.js:253-259` |
| 「停止」`stop()` | 杀进程树（Windows `taskkill /PID <pid> /T /F`），删 `pet.pid` 与 `run.pid` | 其它都不动 | `lib/pet.js:233-251` |
| 重新安装 | `unzip()` 先 `rm -rf` 安装目录（目录来源时也是先删再 `cpSync`），装完删 `run.pid` | `data/` 也被删（profile 重建） | `lib/pet.js:183`、`:212-214`、`:221` |
| TTS 缓存 | `pruneCache` 按 mtime 删到 400 文件 / 150MB 以下 | 最近用过的 | `src/voice-tts.js:115-116` |

**没有任何自动清理**的：`chat/history-*.json`（能长到 200 条消息/角色，但不会自动删文件）、`host-token`、
`focus.json`、`start.log`（只追加）、`tmp/` 里下载失败残留（finally 只删成功下载的那份，`lib/pet.js:229`）。

### 11.3 `appDir` 曾是"可指向任意目录"的删除面（**2026-10-26 已修**）

> ✅ **已修**：`lib/pet.js` 新增 `checkAppDir()`，`install` / `unzip` / `remove` 三处删除前统一过闸；
> 装好后写 `.surfcore-pet.json` 标记；`install()` 前先 `stop()`。回归：`scripts/test-pet-dir-guard.mjs`（22 条）。
> 下面保留的是修复前的描述，供理解为什么要加这道闸。

修复前：`resolveAppDir()` 对用户填的 `appDir` 只做 `path.resolve`，随后：

- `install()` 目录来源时 `fs.rmSync(resolveAppDir(), {recursive:true, force:true})`；
- `unzip()` 第一步同样 `rmSync(dest)`；
- `remove()` 直接 `rmSync(resolveAppDir())`。

也就是说，**把「安装目录」填成一个已有资料的目录，点安装或卸载会把它清空**。
现在的闸门：盘根、受保护目录（`<state>/pet`、`~/.dsh/surfcore`、`~/.dsh`、用户主目录）本身或它们的上级 → 拒绝；
非空目录且没有本程序的标记文件 → 拒绝。见 RISK R34。

---

## 12. 边界与失败模式

### 12.1 失败模式表

| 现象 | 根因 | 证据 | 处置 |
| --- | --- | --- | --- |
| 桌宠一直「没连上 SurfCore」，但 host.json 存在 | 桌宠要求 `baseUrl` 是 `127.0.0.1` 字面量；DSH 若以 `localhost` / `[::1]` 形式给出地址会被拒 | `<桌宠工程>/src/main/surfcore.ts:96`、`lib/index.js:454-460` | 确认 DSH 绑定在 127.0.0.1；必要时用 `SURFCORE_PET_HOST` 指一份手写 host.json（仅排障） |
| 所有请求 401，host.json 里的令牌与 host-token 不一致 | 目录不可写时 `token()` 每次重新生成，host.json 与鉴权值永久错位 | `lib/pet-chat.js:177-190` | 修目录权限；删 host-token 让它重建一次并重启插件（host.json 会重写） |
| 端口改了之后桌宠连旧端口 | host.json 未刷新 / 桌宠还没重连 | `lib/index.js:2171-2173`（120s） | 等 ≤2 分钟，或在桌宠里点「重连」（`<桌宠工程>/src/dialog/index.ts:299-303`，客户端会先重读 host.json，`<桌宠工程>/src/main/surfcore.ts:198-205`、`:239-244`） |
| 点启动立刻退出 | Electron 路径错 / 安装包不完整 / profile 不可写 | `lib/pet.js:272-273`、`:310-312` | 看 `pet/start.log`；把「安装目录」改到可写位置（PET.md §8） |
| 「运行中」但实际进程已死 | pid 文件残留 + pid 被复用，或 `EPERM` 被当存活 | `lib/pet.js:101-109` | 点「停止」清 pid；必要时手删 `run.pid` / `pet.pid` |
| 「停止」误杀别的进程 | pid 复用后 `taskkill /T /F` 不校验进程名/命令行 | `lib/pet.js:242-246` | 高风险操作；pid 文件可疑时不要点停止，先手查进程 |
| 安装时文件占用 / 装出半成品 | `install()` 不先 `stop()`，直接在运行中的目录上 `rm` + 解压 | `lib/pet.js:197-231`（无 stop 调用） | 先停止再安装 |
| 设置页/桌宠状态卡顿 | `status()` 每次都 `dirSize()` 递归统计安装目录 | `lib/pet.js:24-40`、`:155` | 安装目录很大时避免频繁刷新状态 |
| 启动接口偶尔 5–9 秒才返回 | `waitPid()` 是**同步忙等**，会阻塞插件事件循环 | `lib/pet.js:115-124`、`:306` | 已知代价；不要在启动瞬间并发调用其它 API |
| 对话偶发丢一轮历史 | `chat()` 无互斥：并发两次都读旧历史再各自写回 | `lib/pet-chat.js:735`、`:772`（无锁，`inFlight` 只是计数 `:166`、`:733`） | 桌宠侧本来就有 `pending` 单飞（`<桌宠工程>/src/main/chat-host.ts:375`），但本地脚本并发调用会出现 |
| 同一天同一句话只进了一次记忆 | inbox 去重键 `date\|senderId\|text`，桌宠事件没有 `senderId` | `src/memory-card.js:1293`、`lib/pet-chat.js:107-118` | 属于已知取舍；要区分可在事件里加 `senderId`（未做） |
| 切回 QQ 载体后桌宠又主动说了一句 | 插件 tick 60s、桥接缓存 30s，切换窗口内两边都可能出发 | `lib/pet-purpose.js:47`、`src/bridge.js:1696` | 等一个 tick；或临时开专注模式 |
| 桌宠重启后第一条主动搭话没收到 | 事件队列纯内存，重启即清空；客户端先取 baseline | `lib/pet-chat.js:161-163`、`:457-467` | 正常现象（PET.md §10 同样记录） |
| 主动搭话没发，也没回落 QQ | 专注模式开的（`tick()` 在回落前 return）；或 `petFallbackToQQ=false`；或 5 分钟节流中 | `lib/pet-purpose.js:580-587`、`:561-564` | 看 `/purpose/status` 的 `focus` / `lastFallback` |
| 手动「试一次」报 `pet-offline` | 在线判断看长轮询，不看 pid | `lib/pet-purpose.js:412-414`、`lib/pet-chat.js:443-451` | 先让桌宠连上（等一个 `/events` 周期），或切回 QQ 载体 |
| 语音有回复但没声音 | 对话框可见时气泡不自动播（唯一媒体所有者）；或 TTS 未启动 | `<桌宠工程>/src/main/chat-host.ts:163-167`、`:437`；`lib/pet-chat.js:541` | 点气泡/对话框里的播放按钮；查语音页 TTS 状态 |
| 语音念出来比配置的字数短 | 双重截断（`chat.voiceMaxChars` 与 `tts.maxChars` 取更严的） | `lib/pet-chat.js:755`、`:542` | 两边都调大 |
| 桌宠和 QQ 同时收到一条 | 理论上只在载体切换窗口内；先查 `carrier` 与两份配置是否一致 | `src/bridge.js:1699-1700`、`lib/pet-purpose.js:97` | 看插件日志 `[pet-purpose]` 与桥接 `[目的]` |
| 记忆卡里看不到桌宠内容 | 开关关 / 记忆卡总开关关 / 维护器还没跑（10 分钟周期） | `lib/pet-chat.js:306-320`、`lib/memory-card.js:474-479` | 打开开关后点「立即整理」 |
| 卸载后重装，对话还在但资料没了 | `remove()` 只删安装目录；`data/profile` 在安装目录里所以被删 | `lib/pet.js:253-259`、`:287` | 想保留 profile 就把安装目录放到别处 |

### 12.2 三个高风险动作（不要随手做）

1. **改「安装目录」**：`install` / `remove` 对该路径做不可逆递归删除（`lib/pet.js:183`、`:212`、`:255`）。
   改之前确认目录是专用的。
2. **点「停止」**：`taskkill /T /F` 只认 pid，不校验进程身份（`:242-246`）。pid 文件可疑时先手查。
3. **在桌宠运行时点「安装」**：没有先 stop（`:197-231`），Windows 上会撞文件占用，可能留下半解压目录。

### 12.3 最小验证清单（只读/低风险，不起服务）

`node plugins/surfcore/scripts/test-pet-chat.mjs`（截断/清理/记忆事件形状/令牌/游标/专注）、
`test-pet-api.mjs`（401/403/415、事件透传、音频、host.json）、`test-http-guard.mjs`（回环/同源/定长比较，
与设置页 API 共用）、`test-client-contract.mjs`（设置页是否还在调这些路由）、`npm run test:audit`。

这五条覆盖的是「逻辑 + 鉴权 + 契约字符串」，**不覆盖**真 Electron、真模型、真 TTS、真 QQ 回落（§13 全部列出）。

---

## 13. 未验证 / 不确定（⚠️ 标注）

1. ⚠️ **没跑过桌宠，也没跑过真对话**：本文全部是静态阅读。`<桌宠工程>` 只读，我没有启动/构建/截图；
   `<桌宠工程>/dist` 是否为当前 `src` 的构建产物未核对（该目录存在，`package.json:6` 的 `main` 指向它）。
2. ⚠️ **双发窗口未压测**：§6.2 的「切换窗口内两边都可能出发一次」由缓存时长推出；真正防双发的是共享状态文件
   的 `nextFireAt`/`countToday`，但**没有并发写保护**，两个进程谁后写谁生效。
3. ⚠️ **插件侧目的状态缓存不随文件变化重载**：`loadState()` 只在「状态文件路径变了」时重读
   （`lib/pet-purpose.js:111-113`），桥接却按 mtime 重载（`src/bridge.js:1739-1749`、`:10710`）。推论：载体在
   QQ 侧跑过一段再切回桌宠，插件可能拿旧状态（今日次数/pending/history）覆盖桥接刚写的内容。**未复现**。
4. ⚠️ **`appDir` 清空风险未在真实环境验证**：结论来自三处 `fs.rmSync(..., {recursive:true, force:true})`
   （`lib/pet.js:183`、`:212`、`:255`）与「路径只做 resolve」（`:46-50`），没有实际触发。
5. ⚠️ **host.json 的 `version` 没有消费者**：桌宠读了但不比对（`<桌宠工程>/src/main/surfcore.ts:97-98`），
   插件也不读回；将来改字段语义没有版本闸门。另：`getSubprocess` 参数传了但实现里没用到
   （`lib/pet.js:42`、`lib/index.js:197`），判断为历史遗留。
6. ⚠️ **DSH 侧契约未核对**：`llm.stream` 的 chunk 类型（`text-delta`/`usage`/`finish` 与 `reason.kind`）、
   `agentDefaultModel.currentSelection()`、`webServer.register({kind:'prefix'})` 都按代码用法描述
   （`lib/pet-chat.js:624-638`、`:580-590`、`lib/index.js:2152-2164`），未对照 DSH 0.2.1-rc.2 实现。
7. ⚠️ **两份「回复清理」不一致**：对话用 `cleanReply()`（`lib/pet-chat.js:81-88`，去围栏/粗体/引号/名字、截 600），
   主动搭话先自己写两行正则（`lib/pet-purpose.js:515-516`，不去粗体/围栏、不截断），随后
   `chat.proactive()` 再做 `clip(cleanReply(raw))`（`lib/pet-chat.js:803-805`）。最终文本可能略有差异，未验。
8. ⚠️ **PET.md 与代码有两处不符**：① 说启动参数固定 `[".", "--no-sandbox"]`，实际还有
   `--user-data-dir=<安装目录>/data/profile`（`lib/pet.js:292`）；② 说「所有气泡都有『回复』按钮」——按钮在，
   但消息被 240 条上限淘汰后点它只以文本模式开对话框（`<桌宠工程>/src/main/chat-host.ts:516`）。只记差异。
9. ⚠️ **设置页两个测试入口行为不同**：`/purpose/pet-chat` 不 `emit`，`/pet/chat-test` 会 `emit` 弹气泡
   （`lib/index.js:1621-1627` vs `:1492-1507`）；设置页实际用哪个未核（前端 `lib/client.js` 未逐段读）。
10. ⚠️ **`test-pet-api.mjs` 的 `/events` 断言依赖 mock**：它断言 `since`/`clientId` 被透传
    （`scripts/test-pet-api.mjs:34`、`:157-158`），真实 `chat.poll()` 返回的是 `cursor`/`config`
    （`lib/pet-chat.js:483-493`）。该测试只证明「参数交给 poll」，不证明响应形状与桌宠期望一致；形状由
    `lib/pet-chat.js:499-518` 与 `<桌宠工程>/src/main/surfcore.ts:33-40` 对照得出。多客户端投递语义
    （无 per-client 游标 / 无 ack / 200 条裁剪）同样只是读代码结论（§5.5）。
11. ⚠️ **Electron 侧与环境未验证**：`--no-sandbox` 的必要性（`lib/pet.js:292` 注释）、
    `setAlwaysOnTop('screen-saver')` 在多显示器/全屏下的表现（`<桌宠工程>/src/main/chat-host.ts:275`）、
    皮肤 `interaction.menu` 语义，都没实测；跨平台分支（`SIGTERM` `lib/pet.js:245`、系统 `unzip` `:192`、
    `EPERM` 视作存活 `:101-109`）也没跑过。
12. ⚠️ **清理与成本**：插件包被移除后没人调 `remove()`，`<DSH_HOME>/surfcore/pet/` 会连 `<token>` 与历史一起留下
    （代码里没找到「卸载插件」的清理路径；「卸载桌宠」也不清这些，`lib/pet.js:253-259`）。`/status` 每次连读
    三份配置 + 历史 + 模型选择（`lib/pet-api.js:84-106`、`lib/pet-chat.js:854-896`），`/history` 还会为每条语音
    读 wav 头（`lib/pet-chat.js:376-386`）；音频 URL 带 `?token=`（`:394`），日志面是否落痕未查。实际调用频率未测。
13. ⚠️ **行号漂移**：工作树仍在改动，重跑前建议 `grep -n` 复核本文引用。
