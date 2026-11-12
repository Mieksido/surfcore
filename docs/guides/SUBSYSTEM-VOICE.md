# 语音子系统（SUBSYSTEM-VOICE）

> 范围：QQ 桥接侧的语音库发送、本地 TTS 现场合成、语音包安装/启停，以及桌宠侧的语音回复。
> 语音引擎本体（voxd）在**仓库外**的 `<语音工程>`，本文只写它与本仓库的契约，以及本仓库如何用它。
>
> 约定：
> - 本文所有 `文件:行号` 都相对**仓库根**。
> - 用 `<仓库根>` / `<工作区>` / `<语音工程>` / `<DSH 用户目录>` 代替具体绝对路径；不写 QQ 号、群号、令牌、云厂商密钥。
> - 仓库外源码统一简写为 `voxd/…`：指 `<语音工程>/packages/voice-local/voxd/…`（两个包共用同一份 voxd 代码）。
> - 「语音条」= OneBot `record` 段；「语音库」= `socialV2.voice.dir` 指向的本地目录；「路由」= `socialV2.voice.tts.route`（`local` / `cloud`）。
> **最后核对**：2026-10-26（全仓库逐行梳理）。配套阅读：总纲 [ARCHITECTURE.md](ARCHITECTURE.md) · 边界 [BOUNDARIES.md](BOUNDARIES.md) · 索引 [../README.md](../README.md)。

---

## 0. 一句话定位

**模型决定说什么，voxd 负责把文字变成 wav，桥接负责把 wav 变成 QQ 语音条。**

| 角色 | 谁来做 | 证据 |
|---|---|---|
| 决定「要不要发、发什么」 | QQ 侧的**模型自己**调 `qq_send_voice`；桌宠侧由 `pet-chat` / `pet-purpose` 生成 | `src/mcp-snowluma-safe.js:1192-1225`、`plugins/surfcore/lib/pet-chat.js:719-795` |
| 文字 → 音频 | **仓库外 voxd**（本地 8765 / 云端 8767），桥接只发 HTTP | `src/voice-tts.js:45-108`、`src/voice-packs.js:33-71` |
| 现成音频 → 语音条 | 桥接把本地文件塞进 OneBot `record` 段，SnowLuma 转 SILK 后发 QQ | `src/bridge.js:1882-1886`、`src/bridge.js:2201-2228` |
| 桌宠播放 | 插件把 wav 落在 `<DSH 用户目录>/surfcore/pet/voice/`，pet-api 用 `/audio/<key>.wav` 回给 Electron | `plugins/surfcore/lib/pet-chat.js:157`、`plugins/surfcore/lib/pet-api.js:204-214` |

三条必须记住的边界：

1. **语音引擎不是仓库依赖**。不装也能聊天、能发表情、能发语音库里已有的音频（只需本机有 `ffprobe`/`ffmpeg`）；只是不能「现场合成」（`src/voice-packs.js:1-7`、`docs/VOICE-PACKS.md:3-4`）。
2. **QQ 侧没有「自动发语音」**。除了操作者手动试发，语音只能由模型主动调用工具产生；桌宠侧才存在「主动搭话用语音」（`dsh/agent-presets/qq-chat-v2/agent.cordis.yml:41`、`plugins/surfcore/lib/pet-purpose.js:525-538`）。
3. **「发出去了」只能由回执证明**。桥接会在发完后用 `get_msg` 回读 `record` 段，返回 `verified=true` 才算落地；模型被明确告知不许假装发过（`src/bridge.js:2286-2315`、`src/mcp-snowluma-safe.js:1195`）。

---

## 1. 三条链路

```
                         ┌──────────────────────────── 操作者（CLI / 控制台 / 图形界面）
                         │  /api/voice/send 或 voice-tool
                         ▼
模型 qq_send_voice ──► MCP(stdio) ──► 桥接 /api/socialV2/send-voice ──┐
   （text 或 voice）                                                   │
                                                                      ▼
   文字 ──► synthesizeVoiceText ──► POST /v1/speak/file ──► wav 落 state/voice-tts/
                                                                      │
   语音库文件名 ──► resolveVoicePathForV2 ──► safeJoinLibrary ─────────┤
                                                                      ▼
                                              sendVoiceV2：审计 → 探测 → 音量 → record 段
                                                                      │
                                                                      ▼
                                                  SnowLuma OneBot HTTP（:3000 附近）
                                                                      │
                                                          QQ 语音条（SILK）
                                                                      │
                                                          get_msg 回读 → verified
```

### 1.1 链路 A：语音库发送（现成音频）

| 项 | 内容 |
|---|---|
| 入口（AI） | `qq_send_voice(voice="…")` → MCP 组 `/api/socialV2/send-voice`，body 带 `key/token/voice`（`src/mcp-snowluma-safe.js:1205-1219`） |
| 入口（操作者） | `POST /api/voice/send`，body `{target, file\|path\|text, volume?, normalize?, loudness?, dryRun?, verify?, readback?}`（`src/bridge.js:6533-6551`）；CLI `scripts/send-voice.mjs` 与图形界面也走它 |
| 解析 | 相对名只经 `safeJoinLibrary`（含 realpath 复核），支持省略扩展名；绝对路径也必须落在语音库内（`src/bridge.js:2048-2117`） |
| 发送 | `sendVoiceV2` → `inspectAudio` → `processAudioVolume` → `{type:'record',data:{file}}`（`src/bridge.js:2171-2253`） |
| 终点 | OneBot `send_group_msg` / `send_private_msg`（`src/bridge.js:2211-2214`），随后 `get_msg` 校验（`src/bridge.js:2286-2315`） |
| 失败可见性 | HTTP 4xx/5xx + 可读中文错误；不会静默重试 |

关键事实：**网关自己会转码**。`record.data.file` 接受本地路径 / `file://` / `http(s)://` / `base64://`，非 SILK 音频由 SnowLuma 的 native ffmpeg addon 转 NT SILK，所以桥接**不做预转码**（`src/bridge.js:1884-1886`）。桥接只做「体积/时长/可读性」检查和本地音量处理。

### 1.2 链路 B：本地 TTS 现场合成

| 项 | 内容 |
|---|---|
| 入口（AI） | `qq_send_voice(text="…")`（`src/mcp-snowluma-safe.js:1196-1204`） |
| 入口（操作者） | `/api/voice/send` 的 `text` 字段（`src/bridge.js:6561-6570`） |
| 入口（桌宠） | `petChat.chat({modality:'voice'})` / `proactive({modality:'voice'})` → `synthesize()`（`plugins/surfcore/lib/pet-chat.js:539-563`、`:761-767`、`:809-815`） |
| 合成 | `synthesizeToFile()` POST `${baseUrl}/v1/speak/file`，`{text, format:'wav', sr:24000, cache:true, character?, voice?, style?}`（`src/voice-tts.js:69-81`） |
| 落盘 | 桥接：`state/voice-tts/<sha1>.wav`（`src/bridge.js:1990`）；桌宠：`<DSH 用户目录>/surfcore/pet/voice/<sha1>.wav`（`plugins/surfcore/lib/pet-chat.js:157`） |
| 之后 | 桥接回到 1.1 的同一条发送链；桌宠通过 pet-api `/audio/<key>.wav` 播放（`plugins/surfcore/lib/pet-api.js:204-214`） |
| 失败可见性 | 合成错误语句直接给模型；桥接把「语音合成/TTS」类错误映射成 **502**（`src/bridge.js:6702`） |

桥接侧的 `character` 与 `voice` 是两种寻址：`character` 是 voxd 的角色名（映射到音色，例如 `xiaoyu`），`voice` 是 voxd 的音色 id（`src/bridge.js:2006-2015`）。二者互斥：传了 `voice` 就不传 `character`（`src/bridge.js:2008`）。

### 1.3 链路 C：语音包启停（把引擎装起来）

| 项 | 内容 |
|---|---|
| 入口（设置页 / 控制台） | 插件 `handleVoice()` 原样转发到桥接 `/api/voice/*`，并加 `x-console-token`（`plugins/surfcore/lib/index.js:1432-1456`），路由分发在 `plugins/surfcore/lib/index.js:2124` |
| 入口（HTTP） | `GET /api/voice/packs`、`POST …/install`、`…/remove`、`…/start`、`…/stop`、`…/activate`、`…/enable`、`…/cloud-config`、`…/test`、`GET …/cloud-config`、`…/cloud-stats`、`…/sample`（`src/bridge.js:6456-6525`） |
| 实现 | `createVoicePacks(cfg)`（`src/voice-packs.js:178-483`） |
| 终点 | ① 包目录里出现 `config.toml`（判定「已安装」，`src/voice-packs.js:183`）；② 端口 8765/8767 开始监听（判定「运行中」，`:184`）；③ 切包时改写 `config.json` 的 `socialV2.voice.tts.route`（`:353-364`） |
| 失败可见性 | 安装失败写在内存记录里（见 §2.4），启动/停止失败直接回 HTTP 错误；不会自动重试 |

---

## 2. 语音包状态机

### 2.1 状态是「算出来的」，不是「存下来的」

`statusOne()` 每次请求都重新探测，只有两个输入：

- `hasFiles` = 包目录里有没有 `config.toml`（`src/voice-packs.js:183`）
- `portUp` = 127.0.0.1:端口能否在 300ms 内连上（`src/voice-packs.js:109-122`、`:184`）

派生规则（`src/voice-packs.js:185-204`）：

| `config.toml` | 端口 | 结果 | `external` |
|---|---|---|---|
| 有 | 开 | `installed=true, running=true` | false |
| 有 | 关 | `installed=true, running=false` | false |
| 无 | 开 | `installed=true, running=true` | **true**（「外部安装」：手工部署/别的目录已经在跑） |
| 无 | 关 | `installed=false, running=false` | false |

`installed.json` 只存三样东西：`enabled` / `installedAt` / `version`（`src/voice-packs.js:241-244`、`src/voice-packs.js:78-92`）。也就是说**持久层没有「运行中」这个概念**——重启电脑后状态自动变回「已安装、未运行」，这是有意设计（`:7`：「语音服务挂了绝不影响聊天」）。

### 2.2 完整状态图

```
                  ┌──────────────┐
                  │   未安装      │◄────────────────────┐
                  └──────┬───────┘                     │
        install()        │                             │ remove()
                         ▼                             │
                  ┌──────────────┐  失败(rec.error)     │
                  │   安装中      │──────────────► 失败态 │
                  │ 下载/复制/解压 │                     │
                  └──────┬───────┘                     │
        校验 config.toml  │  写 installed.json           │
                         ▼                             │
                  ┌──────────────┐                     │
        ┌────────►│   已安装      │─────────────────────┘
        │         └──────┬───────┘
        │                │ start()（探测端口 → run.bat → 每秒探活，最多 60s）
        │                ▼
        │         ┌──────────────┐
        │         │   启动中      │──超时──► 已安装 · 未运行（报「启动超时」）
        │         └──────┬───────┘
        │                ▼
        │         ┌──────────────┐
        └─────────│   运行中      │──── stop()（stop.bat + 每 500ms 探活，最多 5s）
                  └──────────────┘
```

### 2.3 每个动作做什么

| 动作 | 关键行为 | 代码 |
|---|---|---|
| `list()` | 探测两个包，附 `installedAt`/`enabled`；`packsDir` 回给前端显示 | `src/voice-packs.js:207-219` |
| `install(id)` | ① 已在安装中 → 拒绝；② 已有 `config.toml` 且非 `force` → 拒绝；③ **先递归删目录**再下载；④ 下载完必须看到 `config.toml`，否则报「可能下载的是错的文件」；⑤ 写 `installed.json`；⑥ 立即返回 `{started:true}`，后台异步跑 | `src/voice-packs.js:221-254` |
| 安装源 | `http(s)` → 下到系统临时目录 → 系统 `tar -xf` 解压 → 删 zip；本地目录 → `fsp.cp` 整个复制；本地 zip → 解压 | `src/voice-packs.js:134-176` |
| `start(id)` | 必须已安装（有 `config.toml`）；端口已开则直接返回 `already`；执行 `cmd /c run.bat`（detached、`windowsHide`、stdio 忽略）；1 秒一次探活，最多 60 次 | `src/voice-packs.js:268-291` |
| `stop(id)` | 有 `stop.bat` 就执行并等退出；然后每 500ms 探活，最多 10 次；仍监听则报「可能不是这个包占的」 | `src/voice-packs.js:293-310` |
| `remove(id)` | 先尽力 `stop()`（失败吞掉）→ 删包目录 → 删 `installed.json` 条目 | `src/voice-packs.js:256-266` |
| `activate(id)` | 先停掉**另一个**在跑的包；自己没跑就 `start()`；成功后写 `config.json`：`tts.route` 设为 `local` 或 `cloud`，且**强制 `tts.enabled=true`** | `src/voice-packs.js:342-366` |
| `setEnabled(id)` | 只改 `installed.json.enabled`，不动进程 | `src/voice-packs.js:369-377` |
| `test(id)` | 端口必须开着；`POST /v1/speak/file`，**不传 format**（走默认裸 PCM），按 `bytes/2/24000` 估时长 | `src/voice-packs.js:467-481` |
| `cloudConfig(id)` | 只改 `config.toml` 三行（AppID / AccessKey / resource），并按需改 `voices/age12*/voice.json` 的 `speaker` | `src/voice-packs.js:313-338` |
| `readCloudConfig(id)` | AccessKey 只回 `前4 + **** + 后4`，`configured` 需要三项齐全 | `src/voice-packs.js:381-405` |
| `cloudStats(id)` | 读包内 `logs/requests.jsonl` 的 `t`/`chars`，汇总今日/本月，用用户填的单价与额度估算 | `src/voice-packs.js:409-454` |
| `sampleFile(id)` | 取 `voicepack/` 下第一个 wav/mp3/m4a，用于火山声音复刻的参考音频 | `src/voice-packs.js:457-464` |

### 2.4 失败态与它的可见性（重要）

`install()` 的进度和错误只存在**闭包里的 `activeInstalls`**（`src/voice-packs.js:179`、`:228-250`）。而桥接的路由是**每个请求 new 一个实例**：

```js
const vp = createVoicePacks(cfg);   // src/bridge.js:6459
```

后果：

- 安装进度（`phase` / `progress`）和失败原因**不会出现在后续 `GET /api/voice/packs` 的结果里**——每个请求都是新实例，`activeInstalls` 是空的。
- 前端仍能工作：它轮询到 `installed && !install` 就认为完成（`plugins/surfcore/lib/client.js:2989-3001`）；但「失败」分支（`:2997`）实际几乎不会命中，用户看到的是「一直没装好」。
- 「这个包正在安装中」的保护也只对**同一实例**有效，双击安装可能真的并发跑两次（第二次会先 `rm` 目录，把第一次正在复制的文件删掉）。
- 异步任务本身会继续跑完并写 `installed.json`（闭包仍引用 `rec`），所以「装完」这个结果通常是可靠的，只是**过程不可观测**。

### 2.5 端口、脚本与文件布局

```
<仓库根>/state/voice-packs/
├── installed.json              # { packs: { <id>: { enabled, installedAt, version } } }
├── voice-local/
│   ├── config.toml             # 判定「已安装」的唯一标志
│   ├── run.bat / stop.bat      # 启停脚本（start/stop 按钮就是执行它们）
│   ├── voices/<音色>/voice.json
│   ├── logs/requests.jsonl     # 云端用量统计的数据源
│   └── voicepack/              # 参考音频（云端复刻用）
└── voice-cloud/ …
```

- 安装根目录 = `voicePacks.dir`，缺省是 **`process.cwd()/state/voice-packs`**（`src/voice-packs.js:73-76`）。注意它跟 `voice.dir` 不同：后者是相对**仓库根**解析（`src/bridge.js:1957`），前者是相对**进程工作目录**。
- 端口：本地 **8765**、云端 **8767**（`src/voice-packs.js:39`、`:57`）；两个包可同时手工运行，但 `activate()` 会主动停掉另一个（`:345-348`），所以 UI 的语义是「只能跑一个」。
- `packDir()` 用前缀校验阻止 `id` 逃逸出安装根（`src/voice-packs.js:102-107`）；`remove()` 只删这个目录（`:259`）。
- 本机开发时 `state/voice-packs/voice-local` 可能是**目录链接**指向 `<语音工程>/packages/voice-local`；此时「安装」= 建链接，「卸载」作用在链接上（链接语义未在 Windows 上验证，见 §11）。

### 2.6 安装的边界（与文档不一致的地方）

- **没有 sha256 校验**：`fetchToLocal()` 从头到尾没有任何哈希比对（`src/voice-packs.js:134-176`），`docs/VOICE-PACKS.md:128` 写的「安装源支持 sha256 校验（manifest 里可选）」在当前代码里**不存在**。
- **没有断点续传**：HTTP 下载用 `fs.createWriteStream` 一次性写到临时文件（`:142-148`），中断就重来。
- **依赖系统 `tar`**：zip 解压直接 `spawn('tar', ['-xf', …])`（`:151`、`:171`），Windows 10+ 自带 bsdtar 才行。
- **「确认后再装」两边不一致**：控制台有 `confirm()`（显示名称/体积/端口，`public/console.html:5306-5310`）；插件设置页没有二次确认，点按钮即装（`plugins/surfcore/lib/client.js:3020-3031`、`:3057`）。
- **本地目录安装是整目录复制**：`fsp.cp(..., {recursive:true, force:true})`（`:164`），7.3 GB 的包会实打实拷一份（除非用链接，见 §2.5）。

---

## 3. 本地 vs 云端路由

### 3.1 谁写、谁读

| 动作 | 写到哪 | 代码 |
|---|---|---|
| 设置页/控制台切换语音包 | `config.json` → `socialV2.voice.tts.route`（并强制 `tts.enabled=true`） | `src/voice-packs.js:353-364` |
| 保存「触发规则」/「允许 AI 主动发语音」 | 同上，`tts.route` + `tts.enabled` + `trigger.who` + 频率 | `src/bridge.js:6429-6447` |
| 手工改配置 | 直接编辑 `config.json` | `config.example.json:320-331` |

| 读者 | 何时读 | 代码 |
|---|---|---|
| 桥接 | 启动时 `loadConfig()` 一次；之后只有控制台整体保存 `socialV2` 时才浅合并进内存 | `src/bridge.js:1648`、`:5341`；`voiceCfg()` 读内存 `cfg`（`:1953-1993`） |
| 桌宠/插件 | **每次合成前重新读盘**：`voiceSettings()` → `qqConfig()` → `readQqConfig()`（无缓存） | `plugins/surfcore/lib/store.js:277-281`、`plugins/surfcore/lib/pet-chat.js:209-227`、`:539-553` |
| MCP 工具面 | **进程启动时决定是否注册**（`qq_send_voice` / `qq_list_voices`） | `src/mcp-snowluma-safe.js:27-37`、`:1192`、`:1246` |

### 3.2 切换时机（最容易踩的坑）

| 你改了什么 | QQ 桥接 | 桌宠 | MCP 工具 |
|---|---|---|---|
| `tts.route`（切本地/云端） | **要重启桥接**（`/api/voice/rules` 与 `activate()` 都只写盘，不更新内存 `cfg`，见 `src/bridge.js:6445`、`src/voice-packs.js:363`） | 下一条立即生效 | 工具本身不路由，调用时桥接仍用旧内存配置 |
| `tts.enabled` / `trigger.who` / 频率 | **要重启桥接** | 立即 | 工具是否可见要看重启 |
| `tts.character` / `endpoints` / `cacheVersion` | 要重启桥接 | 立即 | — |
| `tools.sendVoice` | 重启桥接后 `/api/socialV2/send-voice` 才按新值拒/放 | — | **还要重启 DSH/MCP**，否则工具还在列表里 |
| `voice.enabled` | 同上 | 不影响桌宠（桌宠只看 `tts.enabled`） | 同上 |

例外：控制台「二代仿真」整页保存会走 `/api/socialV2/config`，那条路径会把合并后的 `socialV2` 写回内存（`src/bridge.js:5339-5341`），所以从那里改的 `voice` 字段**立即生效**。语音页自己的 `/api/voice/rules` 没这个动作。

### 3.3 端点的解析顺序

`voiceCfg().tts` 与 `synthesizeVoiceText()` 的优先级（`src/bridge.js:1983-1987`、`:2010`）：

```
body.route（仅操作者通道）
  → endpoints[body.route]
  → endpoints[cfg.tts.route]
  → tts.baseUrl
```

因此**只配 `tts.baseUrl` 往往不生效**：只要 `endpoints.local/cloud` 存在（默认就存在），`baseUrl` 永远轮不到。`scripts/test-voice-route.mjs:57-60` 专门用注释钉了这一点。想在单包环境里改地址，应该改 `tts.endpoints.local/cloud`。

默认值：

- `route` 只接受 `local` / `cloud`，其它值回落 `local`（`src/bridge.js:1983`）
- `endpoints.local` 默认 `http://127.0.0.1:8765`，`endpoints.cloud` 默认 `http://127.0.0.1:8767`（`:1984-1987`）
- `tts.baseUrl` 默认 `http://127.0.0.1:8765`（`:1978`）；桌宠同样逻辑（`plugins/surfcore/lib/pet-chat.js:213-222`）

### 3.4 两个包同时开着会怎样

- 不会自动选：桥接只按 `route` 打一个端口。
- 端口不冲突（8765/8767），可以同时跑；手工两个都 `run.bat` 完全可行（`<语音工程>/README.md:56`）。
- 但 `activate()` 会停掉另一个（`src/voice-packs.js:345-348`），所以从 UI 切包时只有一个在跑。
- 两个包同名 `character`（`xiaoyu`）映射到不同音色，**换 baseUrl 就等于换音色**（`<语音工程>/README.md:36-37`）。桥接侧不需要改别的，但缓存键里含 `baseUrl`（`src/voice-tts.js:15-20`），所以两个包的缓存天然分开。

---

## 4. 合成契约

### 4.1 请求

`src/voice-tts.js:69-72` 固定发送：

```json
{ "text": "…", "format": "wav", "sr": 24000, "cache": true,
  "character": "（可选）", "voice": "（可选）", "style": { "（可选）" } }
```

voxd 的请求模型（仓库外，只读参考 `<语音工程>/packages/voice-local/voxd/schema.py:46-59`）：

| 字段 | 类型/默认 | 说明 |
|---|---|---|
| `text` | 1–4000 字 | 超长 voxd 回 413（`voxd/api.py:504`） |
| `format` | `pcm` \| `wav` \| `ogg` \| `mp3`，默认 **pcm** | 本仓库显式传 `wav` |
| `sr` | 8000–48000，默认 24000 | 本仓库固定 24000 |
| `character` / `voice` | 字符串或 VoiceRef | `voice` 是音色 id；`character` 走角色映射 |
| `style` | `{tags,intensity,rate,pitch}` | 桥接的 QQ 链路不传；语气标记写在 `text` 里由 voxd 的 `markup` 解析（`voxd/markup.py:1-8`） |
| `cache` | 默认 true | 服务端磁盘缓存 |

`extra="forbid"`（`voxd/schema.py:47`）：**多传字段会 422**。所以桥接侧不要往 body 里加自定义字段。

### 4.2 响应

| 项 | 内容 |
|---|---|
| 正文 | 音频字节；`format=wav` 时是标准 WAV（`voxd/codec.py:86-95`、`:107-109`） |
| `X-Duration-Ms` | 由**裸 PCM 长度**算出的毫秒数（`voxd/api.py:609`、`voxd/codec.py:42-43`）——与封装格式无关，可信 |
| `X-Cached` | `"1"` / `"0"`（`voxd/api.py:612`） |
| `X-Segments` | base64 的 JSON 元数据数组（每句的音色/引擎等，`voxd/api.py:608-612`） |
| `X-Job-Id` | 任务 id（可被 `/v1/stop` 取消） |

### 4.3 状态码与语义

| 状态 | 含义 | 来源 |
|---|---|---|
| 401 | `config.toml` 配了 token 但请求没带对 | `voxd/api.py:485-490` |
| 413 | 文本超过 `limits.max_chars`（默认 2000） | `voxd/api.py:504` |
| 422 | 请求体字段不合法（`extra=forbid`、类型错） | pydantic（`voxd/schema.py:47`） |
| 429 | 合成队列满（`queue_max`，默认 64） | `voxd/api.py:576` |
| 501 | 要 ogg/mp3 但没 ffmpeg | `voxd/api.py:601-603`、`voxd/codec.py:110-111` |
| 503 | 引擎合成失败（含 strict 音色失败、云端错误） | `voxd/api.py:595-597` |

桥接侧只做了两层映射（`src/bridge.js:6573`、`:6702`）：

```
错误文本匹配 /语音合成|TTS/  → 502（服务不可用，模型应改回打字）
匹配 /频率超限/              → 429
其余                         → 400
```

⚠️ 已知不一致：合成**超时**的消息是「合成超时（>60s）：…」（`src/voice-tts.js:83-87`），既不含「语音合成」也不含「TTS」，因此会被映射成 **400** 而不是 502。模型看到的提示语会说「参数不对」，而真实原因是服务慢/卡住（见 §10.6 #5）。

### 4.4 超时与失败

- 客户端超时：`AbortSignal.timeout(tts.timeoutMs)`，默认 60s（`src/voice-tts.js:80`、`src/bridge.js:1979`）；桌宠把它夹到 3s–180s（`plugins/surfcore/lib/pet-chat.js:223`）。
- **不重试**：一次 fetch，失败即抛（`src/voice-tts.js:74-88`）。重试会由模型决定（工具说明明确要求「不要重试」`src/mcp-snowluma-safe.js:1195`）。
- 失败信息必须可读：连不上 → 「TTS 服务没起来（voxd 是否在运行？）」；超时 → 「合成超时」；HTTP 非 2xx → 「TTS 服务返回 503：detail」；空音频（≤44 字节）→ 「TTS 返回了空音频」（`src/voice-tts.js:82-99`）。
- 落盘是**原子**的：先写 `<key>.wav.<pid>.tmp` 再 `renameSync`（`:101-103`），避免并发读到半截文件。

### 4.5 缓存（两层）

| 层 | 键 | 位置 | 淘汰 | 证据 |
|---|---|---|---|---|
| 桥接/桌宠客户端 | `sha1([baseUrl, cacheVersion, text, character, voice, style])` | 桥接 `state/voice-tts/`；桌宠 `pet/voice/` | 每次新写后 `pruneCache`：按 mtime 从旧删，直到 ≤400 个且 ≤150 MB | `src/voice-tts.js:15-20`、`:62-67`、`:104`、`:115-149` |
| voxd 服务端 | 音色指纹 + 文本（内部实现；README 只说明「键含音色指纹」） | 包内 `cache/` | `cache.max_mb`（本地 1024 / 云端 512） | `<语音工程>/packages/voice-local/README.md:179`、`voxd/api.py:612` |

命中客户端缓存时：

- 要求文件大小 > 44 字节，否则当作未命中重新合成（`src/voice-tts.js:64-67`）。
- 时长从 WAV 头算（`wavDurationMs`，`:23-39`），坏文件返回 0，不抛。
- 服务端 `X-Cached` 只影响返回字段，不影响正确性。

**换音色/参数后必须 bump `tts.cacheVersion`**，否则旧的 `<sha1>.wav` 会继续命中（`src/bridge.js:1988-1989`、`:2012-2013`）。`<语音工程>` 的交接文档也强调两层缓存都要清（`<语音工程>/packages/voice-local/HANDOVER.md:113`）。

### 4.6 wav 头算时长 vs X-Duration-Ms

- 正常路径：优先用响应头 `X-Duration-Ms`（`src/voice-tts.js:106`）。
- 缓存命中：没有响应头，只能读文件头（`:66`）。
- 兜底：如果 `X-Duration-Ms` 缺失则为 0；如果文件头不是 `RIFF....WAVE` 也为 0（`:23-25`）。两种情况都不会阻断发送，只影响返回的 `durationMs`。

---

## 5. 发送链路

### 5.1 逐步拆解（AI 通道）

| # | 步骤 | 做什么 | 失败会怎样 | 代码 |
|---|---|---|---|---|
| 1 | 总开关 | `voice.enabled=false` → 403 | 模型看到「语音功能已关闭」 | `src/bridge.js:6659` |
| 2 | 会话/模式 | 只允许 `reserved2`；必须带 agent token 且匹配该会话；必须命中白名单 | 403 | `:6661-6665`、`src/bridge.js:3755-3759` |
| 3 | 工具开关 | `tools.sendVoice=false` → 403「工具未启用」 | 403 | `:6664`、`src/bridge.js:3725-3727` |
| 4 | 静默模式 | 静默下除主人私聊外一律拒绝 | 403 | `:6666`、`:9063-9066` |
| 5 | 触发规则 | 见 §6 | 403 + 具体原因 | `:6667-6671`、`:1919-1951` |
| 6 | 目标校验 | `group:` / `private:` + 正整数 + 白名单 | 400/403 | `:6672-6678`、`:3248-3255` |
| 7 | 鱼群闸 / 令牌闸 | 防刷屏、防 token 越界 | 403 / 429 | `:6681-6684` |
| 8 | 来源二选一 | `text` 与 `voice/file` 不能都传、也不能都不传 | 400 | `:6686-6689` |
| 9 | **先查额度再合成** | 避免超限还白烧一次 GPU | 429 | `:6695`、`:2143-2154` |
| 10 | 合成 | `text` → `synthesizeVoiceText` | 502/400/429 | `:6696-6699` |
| 11 | 解析库文件 | `voice` → `resolveVoicePathForV2` | 400 | `:6708-6712` |
| 12 | 再查一次额度 | 合成可能耗时，防止期间被别的请求占满 | 429 | `:6715` |
| 13 | `dryRun` | 只探测并返回摘要，不发 | — | `:6716-6721` |
| 14 | 发送（`sendVoiceForV2`） | 见 5.2 | 500 | `:6722-6731` |
| 15 | 记录「一条主人消息已换过语音」 | `voiceLastSentAt` | — | `:6732` |
| 16 | 响应 | `verified` / `readback` / `tts` / 音量信息 | — | `:6733-6746` |

### 5.2 `sendVoiceForV2` → `sendVoiceV2` 内部顺序

```
voice.enabled 检查（仅这里，底层不查）          src/bridge.js:2323
  → resolveVoicePathForV2 / 已给的 resolved      :2325
  → 音量参数前置校验（给了 audio 才做）           :2327
  → voiceBudgetCheck（只查不占）                  :2328 / :2143-2154
  → sendVoiceV2:
      ① 文件名审计（敏感信息/令牌）               :2176 / :1899-1907
      ② inspectAudio（大小/时长/编码）            :2178-2183 / voice-core:204-234
      ③ processAudioVolume（ffmpeg，可选）        :2186-2197 / voice-core:366-463
      ④ 取发送闸门（真正的断言在队列内、发送前执行）  :2199 / :2205-2207 / :9051-9060
      ⑤ record 段 = { type:'record', data:{ file } } :2201
      ⑥ 入 sendChain 串行队列                     :2205-2209
      ⑦ POST OneBot send_*_msg，60s 超时          :2211-2223
      ⑧ finally 删临时音量文件                    :2249-2252
  → voiceBudgetCommit（真正发出后才记账）          :2330 / :2157-2161
  → recordVoiceSentV2（写 recentMessages）        :2331 / :2256-2276
  → log + activity                               :2332-2333
  → 可选转写回读 fetch_ptt_text                   :2336-2352
  → 默认 get_msg 回读校验                          :2354-2356 / :2286-2315
```

注意两处与「直觉顺序」不同：

- **审计在发送前**，而且只审**文件名**（`[语音:<basename>]`），不审音频内容（`:2176`、`:1896-1898`）。这是硬限制：音频里说什么无法在本地审核。
- **额度只在成功后记账**，所以失败不会白吃配额（`:2140-2141`、`:2330`、`:6748`）。

### 5.3 回执校验（verified）

`verifyVoiceMessageSent()`（`src/bridge.js:2286-2315`）：

1. `POST /get_msg {message_id}`（30s 超时）。
2. 从 `data.message` 里找 `type='record'` 的段。
3. 找到 → `{confirmed:true, duration}`；找不到或请求失败 → `null`（不抛，不影响「已发送」）。
4. **故意不回传 `file` / `url`**：私聊 `get_msg` 会把源文件路径塞进 `url`，回给模型等于把本机路径写进上下文（`:2304-2306`）。

为什么不用 `fetch_ptt_text`：那是 QQ 侧对**收到的**语音做的转写，自己发的语音通常没有转写，实测 `retcode=100`（`:2281-2283`）。所以「我真的发了一条语音」的硬证据只有 `record` 段回读。

### 5.4 操作者通道的差异

`POST /api/voice/send`（`src/bridge.js:6533-6651`）：

| 差异 | AI 通道 | 操作者通道 |
|---|---|---|
| 鉴权 | agent token + 会话绑定 | 控制台令牌（回环 + Host 白名单） |
| `voice.enabled` | 必须为真 | **不检查**（否则默认关闭时你连试发都做不了，`:6537-6540`） |
| 目标语音库边界 | 只能库内 | 允许库外绝对路径（`resolveVoicePathForOperator`，`:2124-2135`） |
| 触发规则（主人窗口） | 强制 | **不检查** |
| 频率额度 | 按会话 key | 统一记在 `operator:cli` 桶（`:6603`、`:6613`） |
| `dryRun` | 支持 | 支持（`:6600`） |
| 默认回执 | `autoReadback` 控制 | 默认做，`verify:false` 可关（`:6617`） |
| 返回 | 多一个 `source`（`tts` / `library`）字段 | 额外的 `preview`（大小/时长/编码/上限）；没有 `source` |

`/api/send/voice` 是历史别名，但**带 agent token 时会被拒绝**并提示改用 `/api/socialV2/send-voice`（`:6543-6548`），防止 AI 借操作者通道绕过「只能发自己会话」。

### 5.5 `qq_send_voice` / `qq_list_voices` 的工具面

| 项 | 内容 |
|---|---|
| 注册条件 | `cfg.socialV2.voice.enabled !== false` **且** `cfg.socialV2.tools.sendVoice !== false`（`src/mcp-snowluma-safe.js:1192`） |
| 参数 | `key`、`token`、`voice?`、`text?`、`label?`、`verify?`、`readback?`（`:1196-1204`） |
| 默认 `verify` | 工具层强制 `true`（`verify !== false`，`:1213`），**覆盖**配置里的 `autoReadback=false` |
| 超时 | MCP → 桥接 300s（`:1218`）；桥接 → OneBot 60s |
| 返回 | 桥接 JSON 原样序列化；模型只能靠 `verified` 判断真假 |
| 列表 | `qq_list_voices` 只有 `key` / `token` / `probe`，无分页无搜索；最多 100 条（`src/bridge.js:6930`）；默认逐个 `ffprobe`，`probe=false` 跳过（`:6926`） |
| 路径脱敏 | agent 调用时 `dir` 字段被省略、提示语只给相对名（`:6945`、`:6949-6953`） |

⚠️ 注册条件用的是**原始 `config.json`**（`src/mcp-snowluma-safe.js:27-37`），而桥接用的是**合并了默认值的 `cfg`**（`src/bridge.js:1067-1082`）。如果 `config.json` 里整段没有 `voice`，MCP 会认为「`undefined !== false` → 注册」，桥接却按默认「关闭」执行——表现为「工具在列表里，但一调就 403」。把 `voice.enabled` / `tools.sendVoice` 显式写进配置可以避免这种错位。

---

## 6. 触发规则

### 6.1 模型自主，不是自动

- QQ 侧**只有**模型调用 `qq_send_voice` 才会出声；没有任何「到点自动发语音」的定时器。预设提示词把这一点写成第 16 条规则（`dsh/agent-presets/qq-chat-v2/agent.cordis.yml:41`）。
- 三道默认关闭的闸门，缺一不可：

| 闸门 | 默认 | 位置 |
|---|---|---|
| `socialV2.voice.enabled` | `false` | `src/bridge.js:1068`、`config.example.json:309` |
| `socialV2.tools.sendVoice` | `false` | `src/bridge.js:1049`、`config.example.json:210` |
| `socialV2.voice.tts.enabled` | `false`（只影响 `text` 合成，不影响发库文件） | `src/bridge.js:1977`、`config.example.json:321` |

- 桌宠侧是例外：`purpose` 主动搭话可选 `voice`，由 `pet-purpose` 直接调 `chat.proactive({modality:'voice'})`（`plugins/surfcore/lib/pet-purpose.js:525-538`）。它不受 `voice.enabled` 约束，只看 `tts.enabled`（`plugins/surfcore/lib/pet-chat.js:541`）。

### 6.2 `trigger.who` 全解

| 值 | 私聊 | 群聊 | 代码 |
|---|---|---|---|
| `anyone` | 直接放行 | **直接放行**（不看主人窗口，也不看「一条换一条」） | `src/bridge.js:1922` |
| `owner`（默认） | 对方必须等于 `ownerQQ` | 主人最近 **10 分钟**开过口，且自那之后没发过语音 | `:1925-1927`、`:1934-1945` |
| `list` | 在 `trigger.members` 里，或就是主人 | ⚠️ 走 `last.isOwner` —— 该变量在此作用域未定义，会抛 `ReferenceError`（见 §11） | `:1928-1930`、`:1946-1949` |

群聊窗口的判定依据（`src/bridge.js:13499-13506`）：

- **每条入站消息**（含纯图片、纯表情、只引用不附文）都会先记 `voiceLastSpeaker`，再记「是不是主人」并更新 `voiceOwnerAt`。
- 所以别人发表情/转发**不会**冲掉主人的授权；主人只要开过口，窗口就续上。
- 相反，「最后一条消息必须是主人」这种旧判定已被放弃（注释 `:1915-1917`）。
- ⚠️ `docs/VOICE-PACKS.md:164-166` 说判定依据是 `voiceLastSpeaker`，但代码实际用的是 `voiceOwnerAt`；`voiceLastSpeaker` 只写不读（见 §10.6 #4）。

### 6.3 「一条主人消息最多换一条语音」

`voiceLastSentAt`（每会话一个时间戳）：

- 发送成功后写入（`src/bridge.js:6732`）。
- 触发判定要求 `voiceLastSentAt < voiceOwnerAt`，否则拒绝「这条消息已经发过语音了，等主人再说一句」（`:1942-1945`）。
- 只有主人**新说一句**才会推进 `voiceOwnerAt`，从而重新放行。
- 操作者通道不写这个时间戳，所以手动试发不会消耗 AI 的「一条」额度。

### 6.4 频率上限

- 检查：`voiceBudgetCheck()`，每分钟 / 每小时两个桶（`src/bridge.js:2143-2154`）。
- 记账：`voiceBudgetCommit()`，**只在发送成功后**（`:2157-2161`、`:2330`）。
- 作用域：AI 通道按**会话 key** 分开计数；操作者统一记 `operator:cli`（`:6603`、`:6613`）。
- `0` 表示不限制（`>0` 才判，`:2148`、`:2151`）；UI 把范围夹在 1–60 / 1–600（`src/bridge.js:6437-6438`、`plugins/surfcore/lib/client.js:3101-3102`）。

### 6.5 实际放行矩阵

| 场景（`who=owner`） | 结果 |
|---|---|
| 群里主人 10 分钟内说过话，AI 还没发过语音 | ✅ 放行（仍受频率/审计/白名单约束） |
| 群里主人说过话，AI 已回过一条语音 | ❌「这条消息已经发过语音了」 |
| 群里主人 10 分钟没说话（别人一直在聊） | ❌「最近 10 分钟主人都没说话」 |
| 私聊对象是主人 | ✅ |
| 私聊对象不是主人 | ❌「仅主人可触发语音」 |
| 操作者手动试发 | ✅ 不受 §6 任何规则限制（但仍受白名单/审计/频率） |
| 桌宠主动搭话选语音 | ✅ 不受 §6 限制（受 `tts.enabled` 与桌宠令牌约束） |

> 以上矩阵由同一批代码推导，关键行：`src/bridge.js:1919-1951`（触发）、`:2143-2161`（频率）、`:6732`（一条换一条）、`plugins/surfcore/lib/pet-chat.js:539-541`（桌宠开关）。

### 6.6 文档与代码的窗口长度不一致

- 代码：`const WINDOW = 10 * 60 * 1000`（`src/bridge.js:1938`）。
- 文档/UI：`docs/VOICE-PACKS.md:158` 写 10 分钟，但同文件 `:171` 与 `plugins/surfcore/lib/client.js:3108` 写「5 分钟内」。

以代码为准：**10 分钟**。这两处文案应改（本文只记录，不改代码）。

---

## 7. 音色与音量

### 7.1 音色清单

| 音色 id | 引擎 | 用途 | 延迟量级 | 证据 |
|---|---|---|---|---|
| `loli12-gsv` | 本地 GPT-SoVITS 微调 | 本地包默认 | 1.0–1.5s | `<语音工程>/packages/voice-local/README.md:23-27` |
| `age12-cloud` | 火山声音复刻 2.0 | 云端包默认 | 0.5–1.1s | 同上；`<语音工程>/packages/voice-cloud/README.md:6-10` |
| `huayan` | piper ONNX | 兜底（CPU） | ~0.2s | `<语音工程>/packages/voice-local/README.md:27`、`voices/huayan/voice.json` |

约束：

- 本地定稿音色是**冻结**的：`strict:true`、`split:"none"`、`frozen:true`（`<语音工程>/packages/voice-local/voices/loli12-gsv/voice.json`）。`strict` 的含义是「失败宁可不发，也不换人」，所以 gsv 挂了会直接 503，而不是退回 piper（`<语音工程>/packages/voice-local/README.md:140-146`、`<语音工程>/packages/voice-local/HANDOVER.md:111`）。
- 包清单里的 `voices` 只是给 UI 展示的标签（`src/voice-packs.js:45`、`:62`），真正决定声音的是包内 `voices/` + `config.toml [voice.characters]`。
- `character` 映射：两个包都配了 `xiaoyu`（`<语音工程>/packages/voice-local/config.toml` 的 `[voice.characters]`、`<语音工程>/packages/voice-cloud/config.toml`），桥接默认 `character` 为空（`src/bridge.js:1981`），需要显式配 `tts.character="xiaoyu"` 才会走角色音色；否则 voxd 用 `[voice].default`。

### 7.2 音量与响度

「为什么要在本地做」：SnowLuma 的 `record` 段**没有增益字段**，只有 `file/magic/url` 之类；所以音量必须在交给网关前用 ffmpeg 处理好，再把处理后的文件当普通音频发出去（`src/voice-core.js:288-298`、`src/bridge.js:2168-2169`）。

两种模式（互斥，`loudness` 优先）：

| 模式 | 参数 | 范围 | 实现 |
|---|---|---|---|
| 倍数 | `volume` | 0.1–4.0（1=原样） | `-af volume=<x>`（`src/voice-core.js:301-302`、`:394-397`） |
| 智能响度 | `normalize=true` + `loudness` | 档位 `quiet=-20` / `normal=-16` / `loud=-13` LUFS，或直接给 −40–−5 的数字 | `-af loudnorm=I=<x>:TP=-1.5:LRA=11`（`:304`、`:309-321`、`:394-396`） |

实现细节：

- `volume` 解析**先判数字再查档位**，避免 `-18` 被当成未知档位（`src/voice-core.js:310-316`）。
- 输出**强制单声道** `-ac 1`（`:397`）；保留原扩展名让 ffmpeg 选编码器，失败再退回 wav（`:388-392`、`:417-433`）。
- `volume=1` 且不归一 → **不产生临时文件**，`mode='original'`（`:378-380`）；其余情况产物发完即删（`src/bridge.js:2249-2252`、`cleanupTemp` `voice-core.js:466-469`）。
- 返回里的 `detail` 会区分「提升至 x% / 压低至 x%」，防止排查时看不出是否生效（`:445-452`）。

默认值来源：

- `socialV2.voice.defaultVolume`（缺省 1）→ `sendVoiceV2` 的 `audio.volume ?? vc.defaultVolume`（`src/bridge.js:1963`、`:2189`）。
- `socialV2.voice.loudness`（缺省 `normal`）→ `audio.loudness ?? vc.loudness`（`:1964`、`:2191`）。
- `normalize` **没有配置默认值**：只有调用方显式传 `normalize:true` 才启用（`:2190`；AI 工具 schema 里也没有这个字段）。

### 7.3 ffmpeg 依赖

- 只在「音量 ≠ 1」或「启用 loudnorm」时才需要 ffmpeg；原样发送不需要（`src/voice-core.js:378-382`）。
- 找不到 ffmpeg 的错误是可读的：「找不到 ffmpeg（请设置 FFMPEG_PATH 或在 config.json 里指定 `socialV2.voice.ffmpegPath`）」（`:408-411`），桥接会把它包成「音量处理失败：…」（`src/bridge.js:2194-2196`）。
- ⚠️ 优先级与注释相反：`voice-core.resolveFfmpeg()` 的设计是「显式参数 → 环境变量 → PATH」（`src/voice-core.js:332-351`），但桥接在构造 `ffmpegPath` 时写成 `process.env.FFMPEG_PATH || v.ffmpegPath || null`（`src/bridge.js:1965`），等于**环境变量优先于配置**。想让 `config.json` 的显式路径生效，就不要同时设环境变量。
- `ffprobe` 与 `ffmpeg` 是两个依赖：前者用于探测，后者用于音量。`FFPROBE_PATH` 只影响探测（`src/voice-core.js:207`），`FFMPEG_PATH` 只影响音量（`:343`）。

### 7.4 探测（inspectAudio）

| 检查 | 结果 |
|---|---|
| 文件存在/是文件/非空 | 不满足 → `ok:false`，明确错误（`src/voice-core.js:211-213`） |
| `size > maxBytes`（默认 20 MB） | `ok:false`「文件过大」（`:214`） |
| 扩展名不在白名单 | **只警告**，仍交给网关识别（`:215`、`:17-20`） |
| `.silk` / `.slk` | 跳过探测，直接 `ok:true`（`:217-219`） |
| `ffprobe` 不可用/超时 | **只警告**，不做时长校验，仍放行（`:220-224`） |
| `duration > maxSeconds`（默认 300s） | `ok:false`（`:225-227`） |
| `duration > 60s` | 警告「会被显示成长语音」（`:228`） |
| 没有音频流 | 警告「网关转码可能失败」（`:229`） |

这条「探测失败也放行」的策略是有意的：语音条最终由网关转码，桥接不该因为本机缺 ffprobe 就完全封死发送。代价是**没有时长护栏**（见 §10）。

---

## 8. 权限与安全

### 8.1 路径边界：AI 只能从语音库取文件

`resolveVoicePathForV2()`（`src/bridge.js:2048-2117`）的完整规则：

1. 空 → 400「缺少音频」。
2. `base64://` / `data:` / `http(s)://` → **一律拒绝**（`:2052-2054`）。语音只接受本地文件，避免 AI 把 URL 当外发通道。
3. 绝对路径 / `file://` / `~` → 先解析，再要求它**落在语音库之内**（`voicePathInsideLibrary`，`:2041-2046`）；否则报错并只回目录名（`:2064-2066`）。
4. 相对路径 → **只**走 `safeJoinLibrary`，绝不先按 `process.cwd()` 解析（`:2069-2078`）。历史坑：旧实现直接交给 `resolveAudioSource`，AI 传 `..\..\某文件.mp3` 就能读库外（`:2071-2073`）。
5. 省略扩展名 → 在库内逐个补 `AUDIO_EXTS` 再试（`:2080-2088`）。
6. 含 `..` 或绝对路径但库内找不到 → 明确报「已拒绝」（`:2091-2094`）。
7. 找不到时只提示库内文件名（最多 12 个），**绝不回显库外路径**（`:2101-2116`）。

`safeJoinLibrary()`（`src/voice-core.js:129-145`）：

- 拒绝空串和 `\0`；
- `path.resolve(root, rel)` 后必须仍在 root 前缀内（`abs === root || abs.startsWith(root + sep)`）；
- 再用 `realpath` 复核一次，挡符号链接逃逸；文件不存在时按 `abs` 返回（`:136-143`）。

### 8.2 `allowAbsolutePath` 已经不放宽 AI 通道

- 配置项还在、默认 `false`（`src/bridge.js:1074`），但 AI 通道无论开关如何都只接受库内文件（`:2034-2039`、`:2066`）。
- 启动时若为 `true`，只打一行提示说明「已不再放宽」（`:2916-2920`）。
- 真正能发库外文件的是**操作者通道**：`resolveVoicePathForOperator()` 允许绝对路径，相对路径先按语音库、再按 cwd（`:2124-2135`）。信任模型不同：操作者本来就有本机读权限，AI 面对的是不可信群聊内容。

### 8.3 出站审计只审文件名

`assertOutboundAuditOk()`（`src/bridge.js:1899-1907`）：

- 构造审计对象 `[语音:<basename>]`，只包含**文件名**（`:2176`）。
- 命中 `SENSITIVE_RE`（本机路径/UNC/凭据赋值形态）或含已知 agent token → 拒绝发送，并写日志/活动（`:1902-1905`）。
- 审计范围：除 `closed-agent` 模式下的主人私聊外，全部审计（`:9043-9048`）。
- 明确的能力边界：**音频内容无法审计**，只能审计文件名（`:1896-1898`）。这是语音与文本在安全上的根本差异，不要误以为「语音也过了内容审核」。

### 8.4 平台与网络限制

- 语音包启停只支持 **Windows**：`spawn('cmd', ['/c', script])`、`.bat` 脚本（`src/voice-packs.js:277-282`、`:300`）；zip 解压依赖系统 `tar`（`:151`、`:171`）。
- 端口探测固定 `127.0.0.1`（`src/voice-packs.js:110-112`），不探外网。
- 语音引擎默认只 bind 回环，`token=""` 时不鉴权（`<语音工程>/packages/voice-local/config.toml` 的 `[server]`、`voxd/api.py:485-490`）。所以「本机其他进程能调用 voxd」是默认事实，安全边界在本机账户级，而不是 HTTP 鉴权级。
- 桥接控制台只监听 `127.0.0.1`（`src/bridge.js:8201`），校验 Host（`:3867-3870`）与 `x-console-token`/`?token=`（`:3872-3883`）。
- ⚠️ 控制台的「下载参考音频」链接把控制台令牌放在 query 里（`public/console.html:5407`）；桥接支持 `?token=`（`:3875`），所以这是设计内行为，但令牌会出现在浏览器历史/日志里。样例音频本身不是密钥，风险有限。

### 8.5 频率与工具级闸门

| 闸门 | 值 | 位置 |
|---|---|---|
| 语音频率 | `maxPerMinute` / `maxPerHour`（默认 2 / 10） | `src/bridge.js:2143-2154` |
| 工具总开关 | `tools.sendVoice` | `src/bridge.js:3725-3727`、`:6664` |
| 会话绑定 | agent token 必须属于该 key | `src/bridge.js:3755-3759`、`:6663` |
| 模式白名单 | `reserved2` 才可用；目标必须在 `allow` 里 | `:6661`、`:3248-3255` |
| 静默模式 | 除主人私聊外不发送 | `:9063-9066` |
| 鱼群闸 / 令牌闸 | 防刷屏、防 token 超限 | `:6681-6684` |
| 发送前二次校验 | 排队期间白名单/模式变了就取消 | `:2199`、`:9051-9060` |

**逃生门**：`scripts/send-voice.mjs --direct` 会绕过桥接直连 SnowLuma，**不做白名单/限流/审计**（`scripts/send-voice.mjs:380-393`、`:457`）。它只用于「桥接没起来时应急排查」；正常路径应始终走 `POST /api/voice/send`，否则所有语音闸门形同虚设。

### 8.6 为什么不能「假装发了语音」

1. 工具返回值有 `verified` 字段，只有 `get_msg` 真读到 `record` 段才是 `true`（`src/bridge.js:6742-6743`、`:2286-2315`）。
2. 工具描述明确写「只有 `verified=true` 才能对用户说你发了语音」「返回 502 说明服务没起来，改回打字，不要重试也不要假装发了」（`src/mcp-snowluma-safe.js:1195`）。
3. 预设提示词把这条写成硬规则（`dsh/agent-presets/qq-chat-v2/agent.cordis.yml:41`）。
4. 架构文档也把它列为失败模式：「合成失败 → 502 → 模型改回打字（不会伪造"我发了语音"）」（`docs/guides/ARCHITECTURE.md:59`）。

---

## 9. 配置项全解

### 9.1 `socialV2.voice.*`（`config.json`）

默认值来源：`src/bridge.js:1067-1082` 与 `config.example.json:308-337`；运行时归一化在 `voiceCfg()`（`src/bridge.js:1953-1993`）。

| 键 | 类型 | 默认 | 作用 | 改了何时生效 |
|---|---|---|---|---|
| `enabled` | bool | `false` | AI 能否发语音的总闸；操作者通道不受它影响 | 重启桥接 |
| `dir` | string | `"audio"` | 语音库目录；相对**仓库根**解析，也可写绝对路径 | 重启桥接（`voiceCfg()` 读内存） |
| `maxSeconds` | number | `300` | 单条音频时长上限；`<=0` 回落 300 | 重启桥接 |
| `maxBytes` | number | `20971520`（20 MB） | 单条音频体积上限；`<=0` 回落 20 MB | 重启桥接 |
| `maxPerMinute` | number | `2` | 每分钟语音条数上限；`0` = 不限 | 重启桥接 |
| `maxPerHour` | number | `10` | 每小时上限；`0` = 不限 | 重启桥接 |
| `allowAbsolutePath` | bool | `false` | **历史开关**：现在不影响 AI 通道，只在启动日志提示 | 重启桥接（仅提示） |
| `defaultVolume` | number | `1` | 默认音量倍数；`<=0` 回落 1 | 重启桥接 |
| `loudness` | string | `"normal"` | 智能音量档位 `quiet/normal/loud` | 重启桥接 |
| `ffmpegPath` | string | `""` | ffmpeg 路径；仅音量处理需要 | 重启桥接 |
| `autoReadback` | bool | `true` | 默认是否做 `get_msg` 回读（AI 工具层会强制 true） | 重启桥接 |
| `tts.enabled` | bool | `false` | 允许 `text` 现场合成；不影响发库文件 | 重启桥接（桌宠立即） |
| `tts.baseUrl` | string | `http://127.0.0.1:8765` | 兜底地址；**通常被 `endpoints` 覆盖** | 重启桥接 |
| `tts.timeoutMs` | number | `60000` | 合成超时；`<=0` 回落 60s | 重启桥接 |
| `tts.maxChars` | number | `120` | 单条合成字数上限；`<=0` 回落 120 | 重启桥接 |
| `tts.character` | string | `""` | voxd 角色名（如 `xiaoyu`） | 重启桥接 |
| `tts.route` | `"local"`/`"cloud"` | `"local"` | 选哪个包；非法值回落 local | 重启桥接（桌宠立即） |
| `tts.endpoints.local` | string | `http://127.0.0.1:8765` | 本地包地址 | 重启桥接 |
| `tts.endpoints.cloud` | string | `http://127.0.0.1:8767` | 云端包地址 | 重启桥接 |
| `tts.cacheVersion` | number | `0` | 缓存盐；换音色/映射时 +1 | 重启桥接 |
| `trigger.who` | `"owner"`/`"anyone"`/`"list"` | `"owner"` | 谁能让 AI 出声 | 重启桥接 |
| `trigger.members` | string[] | `[]` | `who=list` 时的私聊白名单 | 重启桥接 |
| `trigger.groups` | string[] | `[]` | **当前没有被任何代码使用**（只解析不消费，`src/bridge.js:1971`） | — |
| `cloud.pricePerKChar` | number | `0` | 云端单价（元/千字），只用于面板估算 | 立即（`/api/voice/rules` 直接读盘：`src/bridge.js:6424`） |
| `cloud.monthlyQuota` | number | `0` | 云端月度字符额度，只用于面板剩余量 | 立即（同上） |

补充：

- `socialV2.tools.sendVoice`：默认 `false`（`src/bridge.js:1049`）；控制台工具列表里可见（`public/console.html:2132`）。
- `socialV2.voice.dir` 是唯一给 AI 的「取文件根」；改它等于换语音库（`voiceCfg()` 读内存配置，所以要重启桥接；重启后所有解析都按新目录，`src/bridge.js:1957`）。
- `maxPerMinute/maxPerHour` 的接口层还会再夹一次：1–60 / 1–600（`src/bridge.js:6437-6438`）。

### 9.2 语音包相关（不在 `voice` 下面）

| 键 | 类型 | 默认 | 作用 | 证据 |
|---|---|---|---|---|
| `voicePacks.dir` | string | `<cwd>/state/voice-packs` | 安装根目录；注意是 **cwd** 相对 | `src/voice-packs.js:73-76` |
| `voicePacks.manifests` | array | `[]` | 按 `id` 覆盖/新增清单字段（合并语义：`{...default, ...override}`） | `src/voice-packs.js:95-100` |
| `SURFCORE_VOICE_LOCAL_URL` | env | 无 | 覆盖本地包安装源 | `src/voice-packs.js:43` |
| `SURFCORE_VOICE_CLOUD_URL` | env | 无 | 覆盖云端包安装源 | `src/voice-packs.js:60` |

### 9.3 包内 `config.toml`（voxd 的配置，不归桥接管）

| 键 | 作用 | 备注 |
|---|---|---|
| `[server] host/port/token` | 监听地址/端口/鉴权 | `token=""` = 不鉴权（只 bind 回环） |
| `[engine] primary/fallbacks` | 主引擎与兜底 | 本地 `gsv`→`piper`；云端 `cloud`→`piper` |
| `[engine] cloud_app_id/cloud_access_key/cloud_resource` | 火山凭据与资源 | `resource` 必须是 `seed-icl-2.0`，否则 403/55000000（`<语音工程>/packages/voice-cloud/README.md:40`、`:50`）；**新装时安装流程会清空前两项**（`stripCloudCredentials()`/`ensurePackConfig()`），用户必须自己填，重装保留已填的（PITFALLS #79） |
| `[voice] default` / `[voice.characters]` | 默认音色与角色映射 | `xiaoyu` 在两个包里指向不同音色 |
| `[limits] max_chars` | 单次文本上限 | 默认 2000；QQ 侧另有 120 字限制 |
| `[cache] max_mb` | 服务端缓存上限 | 本地 1024 / 云端 512 |
| `[ffmpeg] path` | ogg/mp3 输出需要 | 空 = PATH；没有则 501 |

`cloudConfig()` 只改三行并保留其余内容（`src/voice-packs.js:313-338`）；`speaker` 写进 `voices/age12*/voice.json`。**`config.toml` 只在进程启动时读**（`voxd/api.py:45-48`），所以改完密钥要重启语音包；`voices/` 目录是按 mtime 签名热加载的（`voxd/voices.py:79-101`、`:151`），`speaker` 可能无需重启——这一点未实机验证。

### 9.4 桌宠相关

| 键 | 类型 | 默认 | 作用 | 证据 |
|---|---|---|---|---|
| `purpose.petModality` | `"text"`/`"voice"` | `"text"` | 主动搭话的形式 | `plugins/surfcore/lib/pet-purpose.js:97-98` |
| `pet.chat.voiceMaxChars` | number | `120`（夹 20–300） | 语音回复的字数上限（按句号截断） | `plugins/surfcore/lib/pet-chat.js:239`、`:60-78` |
| `pet.chat.maxReplyChars` | number | `300`（夹 40–800） | 文字回复上限 | `plugins/surfcore/lib/pet-chat.js:238` |

桌宠没有独立的 `tts.*` 配置：它复用 `socialV2.voice.tts`（`plugins/surfcore/lib/pet-chat.js:209-227`）。

### 9.5 设置页「语音」页有哪些控件

对应 `VoiceTab`（`plugins/surfcore/lib/client.js:2966-3109`），控件与配置键的映射：

| 控件 | 写入哪里 | 代码 |
|---|---|---|
| 本地/云端单选 + 「启动/停止」 | `POST /api/voice/packs/activate` 或 `/stop`；`activate` 会写 `tts.route` 并强制 `tts.enabled=true` | `plugins/surfcore/lib/client.js:3005-3018`；`src/voice-packs.js:353-364` |
| 每张包卡片的「安装（大小）」/「卸载」 | `POST /api/voice/packs/install` 或 `/remove`；安装后每 1.5s 轮询一次，最多 240 次 | `plugins/surfcore/lib/client.js:3020-3031`、`:2989-3001`、`:3057-3059` |
| 云端表单：AppID / Access Key / 音色 ID / 保存 / 测试连接 | `POST /api/voice/packs/cloud-config`、`POST /api/voice/packs/test` → 包内 `config.toml` 与 `voices/age12*/voice.json` | `plugins/surfcore/lib/client.js:2913-2964`；`src/voice-packs.js:313-338` |
| 云端用量：今日/本月/估算费用/剩余额度；单价、额度输入框 | `POST /api/voice/rules` 的 `pricePerKChar` / `monthlyQuota`（存 `socialV2.voice.cloud.*`） | `plugins/surfcore/lib/client.js:2870-2909`；`src/bridge.js:6442-6444` |
| 触发规则：允许谁触发 / 每分钟 / 每小时 / 允许 AI 主动发语音 / 保存 | `POST /api/voice/rules` → `trigger.who`、`maxPerMinute`、`maxPerHour`、`tts.enabled` | `plugins/surfcore/lib/client.js:3091-3108`；`src/bridge.js:6429-6447` |

注意：语音页**没有** `baseUrl`、`character`、`cacheVersion`、`volume`、`loudness` 的输入框；这些只能改 `config.json`（或在「全部参数」页改 `socialV2.voice.*` 的那几项，见 `plugins/surfcore/lib/client.js:1707-1718`）。

---

## 10. 边界与失败模式

### 10.1 引擎相关

| 场景 | 现象 | 处理 | 代码 |
|---|---|---|---|
| 没装引擎 | `text` 合成报「TTS 服务没起来」→ 桥接 502；`voice` 发库文件仍然可用 | 模型改回打字；装包或改用库文件 | `src/voice-tts.js:82-88`、`src/bridge.js:6702` |
| `tts.enabled=false` | 合成被拒「语音合成未开启」 | 先开开关（还要重启桥接） | `src/bridge.js:2002` |
| 端口被别的程序占用 | `statusOne` 认为「运行中」；`install` 仍可装但 `start` 直接 `already` | 先确认端口归属；本地包的 `stop.bat` 只杀 python 进程，非 python 占用需手工处理 | `src/voice-packs.js:184`、`:273`、`:306-309` |
| 启动超时（60s） | `{ok:false,error:'启动超时…'}` | 本地包 `run.bat` 还要先起 GPT-SoVITS（约 40s），60s 可能不够 | `src/voice-packs.js:285-290`、`<语音工程>/packages/voice-local/run.bat` |
| 停止失败 | 「端口还在监听（可能不是这个包占的）」 | 手工排查占用者 | `src/voice-packs.js:305-309` |
| 安装源不存在 | 「安装源不存在：…」 | 检查 `url`/环境变量/链接 | `src/voice-packs.js:160-161` |
| 下载/解压失败 | 「下载失败：HTTP …」/「解压失败（exit N）」 | 检查网络、系统 `tar` | `src/voice-packs.js:139`、`:150-154` |
| 包里没有 `config.toml` | 「可能下载的是错的文件」 | 换正确安装源 | `src/voice-packs.js:238-240` |
| 安装进度看不见 | 一直显示「安装中」直到完成/永远不完成 | 看包目录是否出现 `config.toml`；看桥接日志 | §2.4、`src/bridge.js:6459` |
| 两个包同时跑 | 只有 `route` 指向的端口会被用；另一个空转 | 用 `activate()` 或手动停 | `<语音工程>/README.md:56`、`src/voice-packs.js:345-348` |

### 10.2 合成相关

| 场景 | 现象 | 处理 | 代码 |
|---|---|---|---|
| 文本超 `tts.maxChars` | 「要说的话最多 120 字（收到 N）」→ 400 | 分次说或改打字 | `src/bridge.js:2003-2005` |
| 文本超 voxd `max_chars` | voxd 413 → 「TTS 服务返回 413」→ 502 | 同上 | `src/voice-tts.js:90-96` |
| 合成超时（60s） | 「合成超时（>60s）」→ **400**（映射缺陷） | 检查 GPU/模型是否卡死 | `src/voice-tts.js:83-87`、`src/bridge.js:6702` |
| voxd 未启动 | 「TTS 服务没起来（voxd 是否在运行？）」→ 502 | 启动语音包 | `src/voice-tts.js:83-88` |
| 返回空音频 | 「TTS 返回了空音频」→ 502 | 查 voxd 日志 | `src/voice-tts.js:99` |
| 队列满 | voxd 429 → 502（注意：不是 429） | 稍后重试/降并发 | `voxd/api.py:576`、`src/voice-tts.js:90-96` |
| 缓存命中旧声音 | 明明换了音色，还是老声音 | bump `tts.cacheVersion`，并清 `state/voice-tts/` 与包内 `cache/` | `src/bridge.js:1988-1989`、`src/voice-tts.js:62-67` |
| 缓存无限增长 | 磁盘慢慢变多 | 自动按 mtime 淘汰（400 个 / 150 MB） | `src/voice-tts.js:115-149` |

### 10.3 音频本身

| 场景 | 现象 | 处理 | 代码 |
|---|---|---|---|
| 文件不存在/是目录/空文件 | `ok:false` + 明确原因 | 换文件 | `src/voice-core.js:211-213` |
| 超过 20 MB | 「文件过大」→ 不发 | 压缩/换文件 | `:214` |
| 超过 300s | 「时长 … 超过上限」→ 不发 | 截短 | `:225-227` |
| 超过 60s | 只警告「长语音」 | 可发 | `:228` |
| 扩展名不认识 | 只警告，交网关识别 | 可发 | `:215` |
| `ffprobe` 缺失/超时 | 只警告，**不校验时长** | 可能发出超长音频（护栏失效） | `:220-224` |
| 没有音频流 | 只警告「转码可能失败」 | 可能发不出去 | `:229` |
| 网关不支持该编码/转码失败 | OneBot 返回失败 → 500，消息不会发出 | 换 mp3/wav 等常见格式 | `src/bridge.js:2224-2228` |
| SILK 文件 | 跳过探测直接发 | 正常 | `:217-219` |
| 音量倍数越界（>4 或 <0.1） | 「音量倍数需在 0.1~4 之间」：AI 通道 500，操作者通道在预校验阶段就 400 | 修参数 | `src/voice-core.js:323-328`、`src/bridge.js:6577-6585` |
| 响度档位写错 | 「未知的响度档位」→「音量处理失败」：AI 通道 500，操作者通道预校验 400 | 改成 quiet/normal/loud 或数字 | `src/voice-core.js:317-321`、`src/bridge.js:2194-2196`、`:6577-6585` |
| 没有 ffmpeg | 「找不到 ffmpeg…」→ 500 | 装 ffmpeg 或设路径 | `src/voice-core.js:408-411` |

### 10.4 发送与回执

| 场景 | 现象 | 处理 | 代码 |
|---|---|---|---|
| 白名单外 | 403 + 列出 allow 配置 | 加白名单（两处：config + 模式） | `src/bridge.js:6553-6559`、`:6676-6678` |
| 静默模式 | 403「静默模式已开启」 | 退出静默或私聊主人 | `:6666` |
| 触发窗口过期 | 403「最近 10 分钟主人都没说话」 | 主人先说一句 | `:1939-1941` |
| 一条消息已换过语音 | 403「这条消息已经发过语音了」 | 主人再说一句 | `:1942-1945` |
| 频率超限 | 429「语音发送频率超限」 | 等窗口 | `:2143-2154` |
| OneBot 失败 | 500「OneBot send_group_msg 失败: …」 | 查 SnowLuma/端口 | `:2224-2228` |
| HTTP 426 | 额外提示「httpUrl 可能指向了 WebSocket 端口」 | 改 `snowluma.httpUrl` | `:2226` |
| 回读失败 | `verified=false`，但消息可能已经发出 | 不要断言「没发出去」；看 QQ 实际消息 | `:2311-2314` |
| 文件名含敏感信息 | 拒绝发送，日志/活动留痕 | 重命名 | `:1899-1907` |

### 10.5 桌宠与 UI

| 场景 | 现象 | 处理 | 代码 |
|---|---|---|---|
| 桌宠离线 | 不影响 QQ 语音；只是点不到气泡/听不到声音 | 启动桌宠 | `docs/guides/ARCHITECTURE.md:60` |
| 桌宠 TTS 失败 | 气泡文字照常显示，`voice.error` 记录原因 | 看 `lastError`；可改文字模式 | `plugins/surfcore/lib/pet-chat.js:761-767`、`:787` |
| 桌宠音频过期 | `/audio/<key>.wav` 404（文件被缓存清理删掉） | 重新生成一条 | `plugins/surfcore/lib/pet-api.js:204-214`、`src/voice-tts.js:115-149` |
| 设置页没有完整的 TTS 字段 | 「全部参数」页只有 `enabled/dir/max*/allowAbsolutePath/defaultVolume/loudness/ffmpegPath/autoReadback`（`plugins/surfcore/lib/client.js:1707-1718`）；`tts.enabled` 在语音页的「允许 AI 主动发语音」（`:3103-3105`）；`baseUrl/character/route` 没有输入框 | 直接改 `config.json`，或在语音页切包（会写 `route`） | `plugins/surfcore/lib/client.js:1707-1718`、`:3091-3108` |
| 语音页切包不生效 | 桥接内存配置没更新 | 重启桥接（见 §3.2） | `src/bridge.js:6445`、`src/voice-packs.js:363` |

### 10.6 已知的代码/文档缺陷清单（只记录，不改）

| # | 问题 | 影响 | 证据 |
|---|---|---|---|
| 1 | 安装进度/失败不可见（实例每请求重建） | 失败只能靠「一直没装好」判断；并发安装可能互删 | `src/bridge.js:6459`、`src/voice-packs.js:179` |
| 2 | 群聊 `who=list` 引用未定义变量 `last` | 抛 `ReferenceError`（路由报错，通常 500），名单模式在群里不可用 | `src/bridge.js:1946-1949` |
| 3 | `trigger.groups` 解析但从不使用 | 配了没效果 | `src/bridge.js:1971` |
| 4 | `voiceLastSpeaker` 只写不读 | 死状态（判定实际用 `voiceOwnerAt`） | `src/bridge.js:1911`、`:13504` |
| 5 | 合成超时被映射成 400 而非 502 | 模型误判为参数错误 | `src/bridge.js:6702`、`src/voice-tts.js:83-87` |
| 6 | 文档写「sha256 校验」但代码没有 | 安装完整性无保证 | `docs/VOICE-PACKS.md:128` vs `src/voice-packs.js:134-176` |
| 7 | 文档/UI 写「5 分钟」，代码是 10 分钟 | 用户预期错位 | `docs/VOICE-PACKS.md:171`、`plugins/surfcore/lib/client.js:3108` vs `src/bridge.js:1938` |
| 8 | 文档暗示「两个包可同时跑」（指 UI 操作） | `activate()` 会停另一个 | `docs/VOICE-PACKS.md:13` vs `src/voice-packs.js:345-348` |
| 9 | MCP 注册用原始配置、桥接用合并默认 | 可能出现「工具在但 403」 | `src/mcp-snowluma-safe.js:1192` vs `src/bridge.js:1067-1082` |
| 10 | ffmpeg 优先级与注释相反 | 显式配置可能被环境变量压过 | `src/voice-core.js:332-351` vs `src/bridge.js:1965` |
| 11 | `voicePacks.dir` 相对 cwd，`voice.dir` 相对仓库根 | 从别的目录启动桥接时安装目录会变 | `src/voice-packs.js:74` vs `src/bridge.js:1957` |

### 10.7 怎么验证（只读/离线）

```bat
:: 纯离线，不联网、不发 QQ
node scripts/test-voice-tts.mjs
node scripts/test-voice-packs-default.mjs

:: 走假 voxd + 假网关，验证 text→record 链路（不发真消息）
node scripts/test-voice-route.mjs

:: 真机试发前先 dry-run（不发消息，只探测）
node scripts/send-voice.mjs send "某文件.mp3" group:<群号> --dry-run
```

`scripts/test-voice-tts.mjs` 与 `scripts/test-voice-packs-default.mjs` 已在本机跑过（通过）；`test-voice-route.mjs` 用桥接 harness 注入临时配置，不碰真实 `config.json`（`scripts/test-voice-route.mjs:1-4`、`:49-64`）。

---

## 11. 未验证/不确定

> 以下每一条都标了「为什么不确定」，不要当成结论引用。

1. ⚠️ **voxd 本体没有实机运行**。本文关于 `/v1/speak/file` 的字段、状态码、响应头，来自只读源码 `<语音工程>/packages/*/voxd/{schema,api,codec}.py` 与 README，没有起服务打请求。
2. ⚠️ **`format:'wav'` 的端到端效果未验证**。代码里有 `codec.encode(..., 'wav')`（`voxd/codec.py:86-95`、`:107-109`），但 README 的示例默认返回裸 PCM（`<语音工程>/packages/voice-local/README.md:55-63`），`voice-packs.test()` 也按裸 PCM 估时长（`src/voice-packs.js:480`）。如果某个包/版本忽略了 `format`，桥接会把裸 PCM 存成 `.wav`：`wavDurationMs()` 返回 0，`inspectAudio()` 的 ffprobe 会失败（但只警告仍放行），最终能否被网关转码不确定。
3. ⚠️ **`speaker` 热加载未验证**。`voices/` 有 mtime 签名刷新（`voxd/voices.py:79-101`），但是否每个请求都触发、`speaker` 是否即时生效，没有实机确认；`config.toml` 的密钥肯定要重启（`voxd/api.py:45-48` 只在构造时读）。
4. ⚠️ **Windows 目录链接（junction）作为安装目录的卸载语义未验证**。本机 `state/voice-packs/voice-local` 是链接；`fsp.rm(dir,{recursive:true})` 在 junction 上是删链接还是删目标，取决于 Node 版本与平台行为，没有实测。
5. ⚠️ **安装进度不可见**的结论来自「路由每请求 new 实例」的静态阅读（`src/bridge.js:6459`），没有在前端实测确认「永远不显示失败」；如果有别的缓存/单例机制，结论需要修正。
6. ⚠️ **`who=list` 的 `ReferenceError` 是静态判断**（`src/bridge.js:1946-1949` 引用了作用域内不存在的 `last`）。没有构造请求实测，但按 JS 语义会抛。
7. ⚠️ **成本数字未核实**。「3 小时直播 ≈135 万字符/月」来自 `<语音工程>/packages/voice-cloud/README.md:9` 与 `docs/VOICE-PACKS.md:78`，没有对账单验证；面板里的费用只是 `按月字数/1000*单价` 的估算（`src/voice-packs.js:450`）。
8. ⚠️ **任务描述里的「`src/purpose-engine.js` 用 `modality`」不成立**。该文件没有 `modality` / `voice` / `carrier` 字样（全文件搜索无匹配）；语音/文本的差异实际在插件侧：
   - `purpose.petModality` → `pet-purpose.js:97-98`
   - 提示词与字数上限 `90`（语音）/`120`（文字）→ `pet-purpose.js:272-274`、`:293-296`
   - `maxTokens` 400（语音）/600（文字）→ `pet-purpose.js:500`
   - `pet-chat` 的语音规则与裁剪 → `pet-chat.js:694-698`、`:60-78`、`:90-96`
   桥接侧的 `purpose-engine.js` 只负责 QQ 的主动搭话，不参与语音。
9. ⚠️ **试音台的入口**：`<语音工程>` 里没有仓库根的 `static/index.html`（该路径不存在）；「试音台」是 `voxd/static/index.html`（由 `/` 提供，`voxd/api.py:515-518`），另有 `/audition/` 挂载试听样本（`voxd/api.py:507-510`）。本文没有打开浏览器验证页面功能。
10. ⚠️ **两个 MCP 工具的注册默认值**没有在真机 DSH 会话里确认「配置缺省时到底出现几个语音工具」；只能从代码推断（`src/mcp-snowluma-safe.js:1192`）。
11. ⚠️ **语音引擎的严格音色失败行为**（`strict:true` 会 503 而非退 piper）来自包内 README 与 voice.json，没有实际拔掉 gsv 验证。
12. ⚠️ **桥接重启后 `/api/voice/rules` 的写入是否会被下一次控制台保存覆盖**：`/api/socialV2/config` 保存会用文件内容重建 `merged` 并写回（`src/bridge.js:5178-5341`），而 `/api/voice/rules` 也写同一个文件；两者并发保存时谁覆盖谁，没有做并发测试。
