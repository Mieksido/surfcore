# 更新日志

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
发布规则见 [docs/guides/VERSIONS.md](docs/guides/VERSIONS.md)。

## [未发布]

### 新增（QQ 空间说说 / 互动 / 轮询，默认关闭）

- SnowLuma v2.2.1 的 `send_qzone_msg` 已接入：AI 可在管理员私聊里调用 `qq_post_qzone` 发一条说说，
  另有只读的 `qq_qzone_status` 查今日额度/上次时间。
- **默认关闭**（`qzone.enabled=false`），且只允许 `private:<管理员QQ>` 调用；群里的 AI 不能替主人发。
- 安全默认：只发文字（带图要单独开）、好友可见（`ugc_right=4`）、每日最多 2 条、两条至少隔 6 小时、
  正文 500 字上限、命中本机路径/凭据特征直接拒绝、`file://` 本机图片默认禁止；权限只从配置读，模型改不了。
- 另有 `dryRun` 演练模式（只返回将要发布的内容）；状态落盘 `state/qzone.json`，重启不重置额度。
- 设置页：QQ → 高级 →「QQ 空间（说说）」。开完保存 → 重启桥接；工具本身要重启 DSH 才出现。
- **第二批（同日）**：只读 `qq_qzone_posts` / `qq_qzone_post` / `qq_qzone_feeds` / `qq_qzone_profile`；
  互动 `qq_qzone_like` / `qq_qzone_comment`（独立开关 `qzone.interact.enabled`，默认关；
  默认只允许评论主人或自己的说说，点赞 ≤20/天、评论 ≤5/天、两条评论 ≥2 分钟）；
  以及空间轮询 `qzone.watch`（默认关）：新评论/@、主人发新说说会唤醒 AI，
  首轮只建水位、不回补历史，桥接只负责发现和叫醒，发不发仍由 AI 决定。
  空间没有推送接口，轮询默认 10 分钟；已见 comment_id / 主人 tid 落盘，重启不重复。

> 调查记录：[QQ 空间说说发布](docs/cases/2026-10-30-qzone-post.md)

## [0.7.20] - 2026-10-31

### 修复（SnowLuma 断线时主动唤醒空烧 token）

- `sendWakePromptV2` 最前面加 QQ 发送通道闸门：SnowLuma WS 未连接/最近发送失败 →
  **不创建 DSH 会话、不投 prompt、不跑模型**，日志只写一次/10 分钟；
- `sendToQQ` / `onebotSend` 记录成功/失败；连续 3 次失败 → 该会话自动唤醒暂停 30 分钟，
  `scheduleProactiveCheckV2` 不再排下一次；
- SnowLuma `close` 发 L2 `send-channel-down`，`open` 发 L1 恢复；首次发送失败 L1；
- UI SnowLuma 安装卡显示断线原因和下一步；事件中心弹窗给“启动/重启 SnowLuma，
  确认 3000/3001”的建议；
- 未做首次 HTTP 失败预知、`wasted` 精确金额、端口/进程体检。

### 修复（语音包被误放进 zip 自动更新）

- 语音包（本地/云端）从 `updates.components()` 移除：它是离线运行时/模型/vendor 包，
  不是代码 zip；通用 `updateFromZip` 的 `surfcore-*` + `package.json` + 安装清单规则必然失败；
- 语音页新增说明：语音包不参与「检查更新」，需要新版本时用「重新导入离线包」，
  导入保留 config.toml / .venv / models / vendor；
- 未做语音包自动版本检查/通知；以后另做独立手动更新通道。

## [0.7.19] - 2026-10-30

### 新增（插件冲突体检）

- 设置 → 概览「检查更新」旁新增「插件体检」：只读扫描 profile 的 bundles / `cordis.patch.yml` /
  已安装包 / 已知第三方插件 / SurfCore QQ 工具策略；
- 优先发现：第三方工具被 QQ guard 拒绝（例如本地执行类工具；`billion-context` 的 5 个上下文工具本版已放行）、
  第三方接管压缩但 `compaction-basic auto=false`、插件未声明工具清单（`unknown`）；
- 报告带等级、证据、影响、建议、覆盖范围与未检查项，可复制 JSON；
- 不启动/停止服务、不改白名单、不禁用插件；未知插件明确标 `unknown`，不冒充“兼容”。

### 新增（闸门事件中心 + 单轮 L3 止血）

- `src/gate-events.js`：L0–L3 统一分级、去重 ack、脱敏、2MB 轮转；
- `src/turn-guard.js` + bridge `guardTurnEvent`：单轮工具步数 40、同一 tool+error 3 次、
  回合内每日额度耗尽 → **cancel-only** 停止 + 直接 QQ 通知，不再等模型自己放弃；
- 设置 → 概览新增「安全提醒」卡片；L2/L3 弹窗，确认后不重复弹；
- 插件 `/gate-events` 读写；兼容性体检的 blocker/high 自动进事件中心；
- **未做**单轮费用上限（价格表未覆盖全部模型）、pre-call 阻断、L0/L1 全量生产者接入。

### 变更（QQ 工具白名单）

- 放行 `billion-context` 注入的 5 个上下文工具：`compress` / `decompress` / `search_context` /
  `acp_status` / `acp_cache`。不放行时模型会反复重试被拒工具（实测单回合 197 次），
  而 QQ 会话失去上下文压缩更容易爆上下文；这 5 个只操作上下文，不含本地执行/网络写操作。


## 计划

- 把 SurfCore 打成 npm 包 + DSH bundle，支持 `dsh plugin add` 一条命令安装
- 语音包的"离线音频转音频"（RVC）接口
- 更新面板显示远端版本号（目前只有提交数/版本清单）
- 插件冲突体检 P1：端口/进程归属、运行时工具拒绝/重复回复、回合熔断


## [0.7.18] - 2026-10-30

### 新增（B站 扫码登录可见/可核查；管理员 UID 支持长号）

- **扫码成功**：弹窗内显示「✅ 登录成功 + 昵称（mid） + 保存时间」，点「完成」才关闭；
- **登录核查**：B站 页新增「B站 登录账号」卡片（主人/小肥鱼各自昵称、mid、保存时间），
  「核查登录」读凭据文件后再问一次 B站 nav 并核对 mid，返回
  `bili.no-credentials / cookie-expired / mid-mismatch / verify-network` + 建议；
- **UID/昵称核查**：管理员卡片新增「核查 UID 与昵称」——查 B站 公开名片比对真实昵称，
  不一致给「用 B站 昵称填上」；
- **长 UID**：`ADMIN_MID_RE` 放宽到 **4~20 位**；非法值保存时返回 `admin.mid-invalid` + 建议
  （以前是静默清空，用户以为“填不进去”）；
- **失败提示**：扫码启动失败带 `bili.qr-start-failed` + 建议；过期/失败文案补“下一步”。

> 调查记录：[B站 登录核查与长 UID](docs/cases/2026-10-30-bili-login-uid-verify.md)


## [0.7.17] - 2026-10-30

### 修复（github.com 不通时：查不到新版本、下载必失败、反复弹窗）

- **版本发现补 api tags**：提交模式下取不到版本时，先查 `api.github.com/tags`（不依赖 `github.com`），
  再退 `releases/latest` 的 302 —— 不再把提交号当版本号显示；
- **下载改 codeload 直连**：`codeload.github.com/.../zip/refs/tags/vX.Y.Z`，失败依次回退 github 归档、
  gh-proxy、ghproxy；`diagnostics.tried` 记录试过的地址；
- **非版本目标阻止自动更新**：目标不是 `x.y.z` 时返回 `blocked(version-unknown)`，
  不再下载 main 快照（那种包装上去“版本号永远不变”）；
- **失败后退避 30 分钟**：下载/网络类失败不再让同一条更新提示每次检查都弹；手动检查仍能看到结果；
- 组件显式配置了 `archiveUrl` 时只试它，不额外加镜像。

> 调查记录：[提交号当版本号 + 下载单点](docs/cases/2026-10-30-update-commit-vs-version.md)


## [0.7.16] - 2026-10-30

### 新增（更新后必须重启 DSH 的提示）

- **检查到更新**：toast 与更新弹窗都写明「安装后需要重启 DSH」；
- **专门的提示弹窗**：发现更新时说明「这里只是发现新版本，下载后要完全退出 DSH 再打开」，
  并给出三步操作（完全退出 / 重开 / 回来确认版本），附「为什么必须重启」；
- **下载完成（已暂存）**：弹窗改为「更新已下载：重启 DSH 后生效」，明确“尚未更新”；
- **更新卡片常驻一行**：「下载完成 ≠ 已更新；只刷新页面不会生效」。

> 测试：契约测试钉住提示文案与触发点；audit 86/86；插件测试全绿。


## [0.7.15] - 2026-10-30

### 修复（云端语音“不行”到底卡在哪：换路兜底 + 失败分类 + 自检）

- **换路兜底**：合成失败时按类型决定是否换到另一条 endpoint 重试（cloud ⇄ local）；
  限流 / 音色映射错不换路；换路成功标 `degraded` 并在日志记录。
- **失败分类**：新增 `src/voice-diagnostics.js`——
  `voice.rate-limited` / `config-mapping` / `service-down` / `upstream-auth` /
  `upstream-network` / `engine-failed` / `unknown`，每类带可执行 hint。
- **失败留痕**：`state/voice-errors.log`（JSONL：route/code/stage/message/fallback）；
  语音接口 `ok:false` 带 `code` + `hint`；限流错误带 `voice.rate-limited`，不再被当成“TTS 掉线”。
- **三步自检**：桥接 `/api/voice/tts-check` + 语音页「语音自检」卡片——
  服务可达 → 实际合成 → 发送前置（总闸/工具/额度），分别给结论（不真的发消息）。

> 调查记录：[云端语音失败归因](docs/cases/2026-10-30-voice-cloud-fallback-diagnostics.md)


## [0.7.14] - 2026-10-30

### 新增（SnowLuma 手动指定安装位置）

- 「检测已安装的 SnowLuma」旁新增 **「手动选择已安装的 SnowLuma」**；
- 点击先弹说明：导入的是**已装好的 SnowLuma 的启动文件**（`SnowLuma.exe` / `app\launcher.bat`，也可选根目录），
  **不下载、不安装、不移动、不删除任何文件**；
- 文件对话框类型限定 `SnowLuma.exe;launcher.bat`（此前只有 `*.exe`，选不到 `launcher.bat`）；
- 宿主 `/browse` 只接受 `filter=snowluma` 枚举，不接受任意过滤串；
- 失败仍走结构化弹窗（原因 + 建议 + 试过的路径）。

> 测试：契约测试钉住按钮、说明文案、过滤器与宿主映射；audit 85/85；插件测试全绿。


## [0.7.13] - 2026-10-30

### 修复（桌宠：填了安装目录点安装仍报「请先填写安装包地址」）

- **根因**：前端 `POST /pet/install` 的 body 是 `{}`，后端读的是已保存配置（`source`/`appDir` 为空）；
  安装目录输入框也没有保存路径，用户填了等于没填。
- **修法**：
  - 安装请求带 `{source, appDir, electronPath}`，启动请求带 `{electronPath}`；
  - 后端 `/pet/install`、`/pet/start` 接收 body；`install(source, patch)` **先把表单落盘再执行**；
  - Windows 路径校验：非 `X:\` 开头 → `code=pet.path-no-drive` + 正确写法提示；
  - 空安装包地址 → `code=pet.source-missing`、`field=source`、hint 指向「用官方最新版」；
  - 安装目录下方补提示：Windows 必须带盘符。
- **测试**：新增 `test-pet-install-form`（盘符 / 结构化错误 / 表单落盘 / 前后端契约）。

> 调查记录：[桌宠安装表单未提交](docs/cases/2026-10-30-pet-install-form-not-submitted.md)


## [0.7.12] - 2026-10-30

### 修复（0.7.11 发布物被写成 CRLF，归档校验仍失败）

- **根因**：发布脚本把**工作区文件**的字节直接发给 GitHub（Windows 是 CRLF），
  而 git 提交与清单是 LF → 远端仓库/归档存 CRLF，客户端按 LF 哈希校验必然失败。
- **修法**：发布脚本改为从 **git 对象**（`git show HEAD:<path>`）取内容，不再读工作区；
  新增 `--all` 用于修历史污染（整棵树重传）。
- 清单排除 `roles/ assets/ examples/ obs-diag.json` 等内容/本机文件。

> 说明：0.7.11 的发布物换行符错误，**以本版为准**；升级到 0.7.12 后归档与清单逐字节一致。
> 调查记录：[更新包哈希不符](docs/cases/2026-10-30-update-manifest-hash-drift.md)


## [0.7.11] - 2026-10-30

### 修复（0.7.9 的更新包自身哈希不符，自动更新仍失败）

- **根因**：清单的 sha256 取自**工作目录文件**（Windows 是 CRLF），发布物是 git 提交（LF）→
  两边哈希必然不同；0.7.9 只修了“文件集合”，没修“内容来源”。
- **修法**：
  - 清单改用 `git cat-file` 读 **HEAD blob 字节**计算，与 GitHub 归档逐字节一致；
  - 新增 `--verify-ref <ref>` **发版硬门禁**：清单与 ref 内容不一致就 exit 1；
  - 镜像同步白名单补 `.gitignore` 等 dotfile（漏同步同样会让清单对不上）；
  - 客户端把 `verify.staging-mismatch` 标为**确定性失败**：原因带不符/缺失数量，hint 说明
    “发布侧问题、重试无效”，弹窗禁用「立即更新」并给「手动下载」；`lastApplyFailure`
    增加 `deterministic / mismatchCount / missingCount / sample`。

> 调查记录：[更新包哈希不符](docs/cases/2026-10-30-update-manifest-hash-drift.md)


## [0.7.10] - 2026-10-30

### 新增（语音页网盘离线包入口）

- 两张语音包卡片下方加总说明：**本地包 / 云端包都适用**——网络不稳定装不上时，用网盘下载离线包，
  解压后点卡片上的「导入离线包…」，选择解压出来的 `voice-local` / `voice-cloud` 文件夹。
- 新增按钮「打开网盘下载（提取码 sxUZ）」：走宿主 `POST /voice/packs/netdisk` 用系统浏览器打开
  （Electron 会拦 `target=_blank`）；链接写死在后端，不接受用户输入；打不开时自动复制链接兜底。
- 契约测试钉住链接、文案与按钮，防止以后被误删。


## [0.7.9] - 2026-10-30

### 修复（zip 安装的自动更新 100% 失败：verify.staging-mismatch）

- **根因**：`release-manifest.mjs` 扫的是开发工作目录，把 gitignore 的 `_backups/`、`audio/`、
  本地改过的 docs 都列进清单；用户下载的 GitHub 归档不可能包含这些文件。而
  `verifyStaging()` 要求清单里**每个文件都存在且哈希一致** → 恒假 → 永远到不了暂存。
- **修法**：
  - 清单只列 `git ls-files`（归档里有什么就列什么）；工作区脏时生成脚本报错；
  - 有版本号时下载 **tag 归档**（`refs/tags/vX.Y.Z.zip`），不再用会漂移的 `main.zip`；
  - 校验改为**交集**：只比包内真实存在的文件；缺失只计数记日志，不判失败；
  - 旧脏清单自愈：出现“新包没有的路径”就用包内清单覆盖安装记录（git 工作副本跳过）；
  - 按提交判定有更新时用 302 补取版本号（显示与 tag 下载都需要）。
- **失败可见**：`state.lastApplyFailure` 持久化，弹窗内常驻红块（code/原因/建议/复制诊断/去下载新版）；
  失败即删除本次 staging，不再累积。

> 注意：0.7.1–0.7.8 的 zip 用户**无法自动升到本版**（旧版仍执行旧校验），需手动覆盖一次。
> 调查记录：[zip 更新 verify.staging-mismatch](docs/cases/2026-10-30-update-verify-staging-mismatch.md)


## [0.7.8] - 2026-10-29

### 修复（语音页保存显示「toast is not a function」，其实已保存）

- **现象**：设置 → 语音 → 云端包，填完 AppID / Access Key / 音色 ID 点保存，红字
  「保存失败: toast is not a function」，但 `config.toml` 已经写入。
- **根因**：Settings 里 `toast` 是浮层文案**字符串**，真正的通知函数叫 `notify`；
  `h(VoiceTab, { toast })` 把字符串当函数传 → 保存成功后调用它抛 TypeError →
  被 `catch` 改写成「保存失败」。语音页 8 处提示全部因此失效。
- **修法**：
  - 接线改为 `toast: notify`；浮层状态改名 `toastText`，彻底消除同名遮蔽；
  - 云端保存顺序改为「保存 → 刷新表单 → 通知」，通知失败不再改写保存结论；
  - 契约测试新增：所有 Tab 的 `toast` 必须是函数、VoiceTab 必须收 `notify`、状态必须叫 `toastText`。

### 文档

- `docs/guides/ERROR-REPORTING.md` 新增「跨层契约」一节：同名不同物必须改名；
  成功路径上的界面失败不得改写业务结论；跨进程数据必须显式投影并读回断言。

> 测试：audit 84/84；插件测试全绿（含 test-client-contract 新断言）。


## [0.7.7] - 2026-10-29

### 修复（手动覆盖安装后仍提示旧版本更新）

- **现象**：用户手动覆盖到 v0.7.5，更新弹窗仍显示「v0.7.3 → 提交 db18896」，点更新后还是同一条。
- **根因**：
  1. 手动覆盖只换文件，**旧的 `.installed-manifest.json` / `.installed-meta.json` 还留着**
     （版本 0.7.3、旧提交号），检查更新拿"旧提交 vs 远端提交"比出假更新；
  2. `updates.json` 里缓存着上一次检查结果，手动升级后没有失效，弹窗继续显示旧结论。
- **修法**：
  - 检查时对安装证据做版本校准：包里 `release/install-manifest.json` 的版本与现存清单不一致
    → 刷新清单、重写只带版本号的安装记录（丢掉旧提交号），改走版本号比对；
  - 服务启动时丢弃"安装目录 package.json 版本已变化"的旧检查结果，不再弹旧提示。

> 测试：新增覆盖安装/过期结果两个用例；audit 84/84；插件测试全绿。


## [0.7.6] - 2026-10-29

### 修复（语音三闸门 + 设置被覆盖）

- **工具常注册**：`qq_send_voice` / `qq_list_voices` 不再在 MCP 进程启动时按配置过滤
  （以前改了开关不重启，模型手里根本没有这个工具，只能说“我没这个功能”）。
  现在工具始终存在，是否允许由桥接在调用时判定。
- **拒绝时说清卡在哪一关**：桥接返回 `VOICE_DISABLED`（总闸未开）/ `VOICE_TOOL_DISABLED`
  （工具开关未开），并带 `hint` 指到具体设置位置；MCP 保留 `code`/`hint`，模型能照做。
- **设置不再自己回弹**：保存配置时回传加载时的版本戳（mtime+size），服务端发现配置已被
  控制台/其它窗口改过 → 返回 `CONFIG_STALE` 并拒绝整份回写，提示“重新读取后再改”，
  不再把别人刚改的语音开关覆盖掉。

> 测试：新增 `test-voice-gates`（21 项断言），audit 84/84，插件测试全绿。


## [0.7.5] - 2026-10-29

### 修复（更新提示反复弹、同一提交无限重试）

- **现象**：设备上弹「SurfCore 本体 v0.7.2 → 提交 ddc0d81」，点「立即更新」后又弹回来，提交号不变。
- **根因**：该目录既无 `.installed-manifest.json` 也无 `.installed-meta.json`；0.7.2 在**应用阶段**
  才拦住（`evidence-insufficient`），失败后不记录 dismiss，于是下次检查又弹同一条；
  弹窗又不展示这次失败，看起来像"点了没反应"。
- **修法**：
  - **检查阶段就判定**：缺安装证据但有新版 → `status=blocked`，并带 `blocked` 字段，
    不再进入待办列表（不会再反复弹）；
  - 卡片常驻显示「更新被阻止：原因（建议手动下载）」；
  - **自愈**：目录里存在包自带的 `release/install-manifest.json` 时，自动补写
    `.installed-manifest.json` 与 `.installed-meta.json` —— 手动覆盖安装过一次后即可恢复自动更新；
  - 远端版本号取不到时，用 `releases/latest` 的 302 tag 兜底，界面显示 `v0.7.4` 而不是提交号。

> 调查记录：见 docs/cases 中更新系统相关案例。


## [0.7.4] - 2026-10-29

### 修复（管理员称呼：设置「弥叭」却仍叫「管理员」）

- **QQ 桥接读不到称呼**：保存管理员卡片时只把 `ownerQQ` 投影到 `config.json`，
  `displayName/biliName/gentle` 留在 unified；桥接是独立进程，只能拿到「管理员」兜底。
- **身份词被当成称呼**：没名字时 `adminDisplayName` 返回 `'管理员'`，提示词生成
  `称呼「管理员」`，模型会把它和群名片拼成「弥叭管理员」。
- 现在：完整 admin 投影写入 QQ config；没名字时不再把「管理员」当称呼，提示词明确
  「管理员是身份/权限标记」；插件启动时自动补投影，桥接在跑会自动重启。
- 存量 v0.7.2 用户升级后无需手动重存；保存/启动后重启桥接即可生效。

> 调查记录：[设置了称呼「弥叭」，QQ 里仍叫「管理员」](docs/cases/2026-10-29-admin-display-name-projection.md)

## [0.7.3] - 2026-10-29

### 修复（原生「浏览…」选中文目录后路径乱码）

- **现象**：设置页「导入离线包」选中文目录（如 `D:\...\中文oice-local`），弹窗报
  `IMPORT_PATH_NOT_FOUND`，路径里出现 `�`/`◆`；实际目录存在。
- **根因**：Windows PowerShell 5.1 重定向 stdout 用 GBK，Node 按 UTF-8 解码 → 中文路径损坏。
- **修法**：PowerShell 把选中的路径写进 UTF-8 临时文件，Node 读文件后删除，不再解析 stdout；
  导入 / 安装目录 / SnowLuma 三处「浏览…」共用 `handleBrowse`，一处修复全部生效。

> 调查记录：[中文目录选择乱码](docs/cases/2026-10-29-browse-chinese-path.md)


## [0.7.2] - 2026-10-29

### 新增（可选 GitHub 令牌，解决“查不到：限流”）

- 更新卡片下新增「GitHub 令牌（可选）」：粘贴只读 token 后，检查更新走**账号额度 5000 次/小时**，
  不再受匿名 60 次/小时（按 IP）限制；
- 请求层：`api.github.com` 的读取请求自动带 `Authorization: Bearer <token>`；留空仍按匿名请求；
- 安全：输入框不回显、日志不打印、诊断信息不含 token；令牌只存在本机 `config.json` 的
  `updates.githubToken`，可随时「清除」；
- 未配置时卡片明确提示“匿名 60 次/小时，共享 IP 时可能遇到限流（查不到）”。

> 测试：token 注入/不注入两态断言 + audit 83/83 + 插件测试全绿。


## [0.7.1] - 2026-10-29

### 修复（更新系统：不再静默失败）

**检查更新必须说清三种结果**

- 没有 git 命令 / 没有 `.installed-meta.json` 时，改为**按版本号比对**，不再直接判「最新」
  （事故现场：本地 0.6.22、远端 0.7.0，却显示「最新 v0.6.22→1ad2042」且没有更新按钮）；
- 取不到远端版本号、远端不可达、`rev-list` 失败 → 显示「查不到：原因（建议）」，不再冒充「最新」；
- 卡片按状态渲染：「有更新 / 已是最新 / 查不到 / 被阻止 / 检查失败」，查不到与失败常驻原因与建议。

**失败必须给出原因与下一步**

- 下载失败区分 `download.http-XXX` / `download.timeout` / `download.network` / `download.write-failed`；
- 解压失败 `verify.unzip-failed` / `verify.bad-archive`；
- 更新助手缺失或启动失败 `stage.helper-missing` / `stage.spawn-failed`（不再「下载成功即成功」）；
- 「已下载待重启」单列 `pending_restart`，文案明确「尚未更新」，`updated` 只统计真正落地的；
- 重启后卡片常驻「上次更新」：成功（已校验）/ 已应用未验证 / 待重启 / 失败原因 + 建议；
- 新增「复制诊断」，一键复制版本、状态、错误码与建议。

**不弄丢用户的东西**

- 覆盖前读包内 `release/install-manifest.json`（文件 + sha256），先校验包与清单一致；
- 归属判定：按上次安装清单比对，**本地改过的文件 → 阻止自动更新并列出**；
  既无清单也无安装记录 → 阻止并给手动下载指引（不冒险覆盖）；
- 覆盖前**真备份**（将被覆盖的文件 + 逐文件回读校验），备份失败不覆盖；
- `robocopy /MIR` 改为 `/E`：**只覆盖、不删除**，用户自建文件永不误删；
- 更新后校验目标 `package.json` 版本与目标一致，不符写 `.failed(verify.version-mismatch)`；
- 新增**回滚**：从最近备份逐文件恢复并校验哈希与版本，失败保留备份并给人工恢复指引。

### 工具

- 新增 `scripts/release-manifest.mjs`，发版前生成 `release/install-manifest.json`（当前 605 文件）。

> 测试：`test-update-apply-result` 40 项断言；audit 83/83；插件测试全绿。


## [0.7.0] - 2026-10-29

### 功能（语音包离线导入：本地/云端都能从网盘包导入）

- **不再只能在线安装**：本地/云端语音包卡片新增「导入离线包…」，选解压出来的
  `voice-local` / `voice-cloud` 文件夹即可；先展示类型/来源/目标/大小/版本/完整性确认。
- **默认复制，不消耗源目录**：源文件夹是用户的下载备份，默认保留；导入完成后可手动
  删除源文件夹（会提示不影响 SurfCore 使用），也可删除旧包备份。
- **先校验后操作**：包类型、必需文件、manifest 版本/权重 SHA256、目标正在运行、旧配置格式、
  磁盘空间都在写目标目录前检查；旧包先备份，失败自动恢复，恢复失败保留 backup 并明确报错。
- **错误不再静默**：`IMPORT_*` 错误码 + 原因 + 缺失文件 + `hint`；设置页弹窗给
  「重新选择目录」「先停止语音包」等动作，不再只 toast 一句“已指向”。
- **环境修复**：导入后改写 `.venv`/`.venv-gsv` 的 `pyvenv.cfg` 指向包内
  `runtime/python313|312`；没有 `config.toml` 时从 example 生成并清空云端凭据，
  已有用户配置逐字节保留。
- **成功文案**：显示“已导入，尚未验证运行”，不把文件复制成功当成语音服务可用；
  旧的「手动指定包目录」入口已移除，避免继续静默失败。
- **参考音频下载**：设置页原来的 `<a target="_blank">` 在 Electron/DSH 里会被拦，
  点击无反应；改成 fetch→Blob 下载，并加「打开所在目录」（explorer 选中文件）。


### 说明（本版不包含离线语音包分发）

离线语音包（本地 4.7G / 云端 249M）**不随本版发布**：

- 本地包的 age12 微调权重，其素材链为「微软 Edge 晓伊 → CosyVoice 克隆 → 参考音频 → 训练」，
  上游授权不可考，**不得公开分发**；
- 云端包内含 piper（GPL-3.0）且为同进程组合，组合定性未决，暂不发布；
- 两个 zip 仅留在 POC 目录，导入功能在 SurfCore 侧即可使用。

> 调查记录：[云端参考音频“下载”没反应](docs/cases/2026-10-29-cloud-sample-download.md)
> 调查记录：[语音包离线导入](docs/cases/2026-10-29-voice-pack-offline-import.md)

### 安全（云端语音包不再携带任何预置密钥）

- **安装包会把开发者的火山凭据发给用户**：`voice/packages/*/config.toml` 里放着真实
  AppID/AccessKey，而安装流程会把 `config.example.toml` 复制成用户的 `config.toml`，
  默认安装源又正指向那个开发目录 —— 只要打成 zip 分发，别人就用我们的额度计费。
  现在：**新装一律清空** `cloud_app_id` / `cloud_access_key`（`cloud_resource` 保留），
  用户必须自己在设置页填；重装保留用户已填的，不会每次都要重填。
- **云端包没配好不能启动**：缺 AppID / Access Key / 音色 ID 时直接给出可照做的提示，
  不再"启动成功、一说话就 401/403"。
- **设置页指路**：装完自动滚到「云端包：密钥与音色」，卡片显示"待填云端密钥"，
  并写明安装包不预置任何凭据；AppID 输入框不再用真实账号做示例。

> 调查记录：[云端语音包的凭据不能随包分发](docs/cases/2026-10-29-voice-cloud-credentials.md)

### 安全（提问回答带身份来源 + 主人特权操作审计）

- **回答者身份由程序标注**：AI 的提问被回答时，桥接按真实发送者填「主人 / 群友（非主人）」来源；
  普通群友可以讨论偏好，但回答只作为建议，不升级为主人确认。
- **`[仅主人]` 只收窄回答权**：preset 让模型对身份/权限/安全/配置/特权审批类提问打标记；
  只有主人能回答这类提问，非主人消息不消费 pending、不吞群消息、继续走正常群聊。
  标记是分类信号，不是身份凭证，不能授予任何权限。
- **单选/多选编码符合 DSH 约束**：多选题 `selected + custom(来源)`；单选题 DSH 不允许两者并存，
  改为 `custom("选项「X」"+来源)`（selected 留空）。
- **主人特权操作审计**：`state/owner-audit.jsonl` 记录审批、提问回答、角色切换、封闭模式拒绝、
  语音触发、鱼群 bypass、记忆告警 7 类事件（时间/操作者/授权判定/结果/关联 ID，不写正文和 token）；
  1MB×5 轮转 + 90 天清理；写入/轮转/清理失败进 health 与日志，不静默、不阻塞、不截断历史。
- **设置页可查**：管理员卡片新增「管理操作记录（最近 50 条）」，操作者打码；可打开所在文件夹。
  审计读取只给控制台，agent token 明确 403。

> 调查记录：[提问回答没有身份来源 + 特权操作不可审计](docs/cases/2026-10-29-owner-question-audit.md)

### 修复（SnowLuma 装在自定义目录时「检测已安装」找不到）

- **检测不再只猜固定目录**：候选顺序改为「用户手选 > `snowluma.launcherPath`/`homeDir` >
  环境变量 > 常见位置」，装在 `D:\软件\SnowLuma2` 这类地方的也能被手选路径救回来。
- **概览卡片新增「浏览…」**：选 SnowLuma2 解压出来的根目录（里面有 `app`）即可，选 `app` 目录、
  `app\launcher.bat` 或 `SnowLuma.exe` 也能自动归一到根目录；选完立刻验证并保存。
- **显式选的路径只验证它**：不会"检测成功"却悄悄保存了另一份安装。
- **失败必须弹窗，不再只闪一条 toast**：检测失败（自动猜 / 手选路径）会弹出错误报告，写明
  发生了什么、试过哪些位置（可展开），并给「浏览…选择目录」「打开官方下载页」两个下一步；
  接口同时返回 `code` / `title` / `error` / `hint` / `tried`（AGENTS 1.7）。
- **失败可说清**：检测失败会返回试过哪些路径（给后续 UI 用），文案直接指到「浏览…」。

> 调查记录：[SnowLuma 检测不到（自定义目录）](docs/cases/2026-10-29-snowluma-detect-manual-path.md)

## [0.6.22] - 2026-10-28

### 修复（本地语音"装完还是不能用"）

- **归档解压落点**：`fetch-models.mjs` 以前把所有归档都解到 `models/`，导致
  `models/vendor/...`、`models/voices/...`，而 `gsv.bat` 找包根 `vendor/`、voxd 找包根 `voices/`。
  现在 models.json 支持 `dest`（vendor/voicepack → `.`，models → `models`）。
- **`jieba_fast` 装不上**：Windows 没有轮子，vendor 代码又硬 import。安装时自动生成
  `jieba_fast` 替身（转发到 `jieba`，含 `posseg`）。
- **ffmpeg**：改用 `imageio-ffmpeg` 自带二进制，并自动写进 `config.toml [ffmpeg] path`。
- **依赖清单**补 `torchmetrics`、`imageio-ffmpeg`；pip 增加包内缓存 `--cache-dir`。
- **试听时长**改用真实 WAV 头计算（并补 `duration` 字段），不再出现"合成 0ms"。
- **UI 提示**：改完语音总开关 / TTS / 发语音工具后必须重启 DSH ——
  工具列表在 MCP 进程启动时固定，不重启她会说"没有语音入口"。

> 调查记录：[本地语音装完不可用](docs/cases/2026-10-28-voice-pack-layout-and-imports.md)

## [0.6.21] - 2026-10-28

### 修复

- **语音包装依赖卡在 99%、没法取消**：依赖阶段本来就没有百分比，界面只显示"安装 Python 依赖 99%"
  和一条滚动条，用户等 50 分钟也不知道是在装还是卡了。现在：
  - 进度条显示 **已 X 分钟 + 最近在装什么**（解析 `[bootstrap]` 输出与 pip 行）；
  - 新增 **「取消安装」**（`/api/voice/packs/cancel`，杀子进程树，保留已下载内容）；
  - pip **默认走清华源**（`SURFCORE_PIP_INDEX` 可覆盖，失败回退阿里/官方），并加 `--progress-bar off --timeout 30 --retries 5`；
  - 前端超时文案从"没完成（可重试）"改成"还在安装，卡住可取消"。

> 调查记录：[语音包卡在依赖安装](docs/cases/2026-10-28-voice-install-stuck-deps.md)

## [0.6.20] - 2026-10-28

### 修复

- **语音包安装没有进度条（只显示「开始安装…」）**：0.6.5 为让配置热生效，把
  `/api/voice/*` 改成每个请求都 `createVoicePacks()`；而安装进度存在实例内部的
  `activeInstalls` 里 → POST 的实例随请求结束销毁，后续 GET 拿到新实例，`install` 永远 null。
  现在实例按 `config.json` 的 mtime 缓存、声明在请求回调外（既热生效又保住进度）；
  前端在还没拿到后端进度时先显示不确定态进度条。

> 调查记录：[语音安装没有进度条](docs/cases/2026-10-28-voice-progress-lost.md)

## [0.6.19] - 2026-10-28

### 修复

- **点「立即更新」没反应、版本一直不变（0.6.15 用户实测）**：更新从 0.6.12 起改成
  「退出后由助手应用」，但 spawn 用的是 `process.execPath` —— 插件跑在 DSH（Electron）里，
  这个值是宿主可执行文件，Electron 直接跑 `.mjs` 会**静默退出（exit 0）**，助手从未执行。
  现在：非 node 的 execPath 自动加 `ELECTRON_RUN_AS_NODE=1`；助手启动写 `.started` 标记，
  插件 2.5 秒后校验；**启动时发现 pending 会自动重新排队**（自愈）；失败留 `.failed` 证据。

### 新增

- **所有安装入口统一进度条**（`ProgressBar` 组件）：
  语音包安装（百分比 / 依赖与模型用不确定态动画）、桌宠安装、Electron 下载、
  一键安装（第 N/M 步）、更新应用。

> 调查记录：[更新助手从未执行](docs/cases/2026-10-28-update-helper-never-runs.md)

## [0.6.18] - 2026-10-28

### 修复

- **语音包装完不可用（一组问题）**：
  - `flattenSingleDir` 判定看 `config.toml`，而仓库只有 `config.example.toml` → **永远不拍平**，
    装成 `voice-local/surfvoicelocal-main/…`。改用 `package.json/models.json/version.json/config.example.toml` 任一判定；
  - `start()`：stdin 给空句柄（脚本里 pause 也不会卡死）、收 stderr、60 秒超时后 `taskkill /T /F` 杀进程树；
  - `stop()`：`stop.bat` 之后仍占端口 → 按端口强杀兜底；
  - `remove()`：端口占用 / EBUSY 给人话提示。
- **更新弹窗反复弹、且认错仓库**：
  - `rev-parse --is-inside-work-tree` 在子目录也返回 true → 语音包被当成本体仓库、列出同样的提交。
    现在要求 `show-toplevel` 等于组件目录本身；
  - staged（已下载待重启）后记为已处理，重启前不再弹；
  - 「本地有未提交改动」被 blocked 的组件不再计入 pending，避免每次检查都弹；
  - 弹窗显示目标版本与通道：`SurfCore 本体 v0.6.17 → v0.6.18`、git 仓库 / 提交追踪 / 版本清单。

### 语音包仓库（已推送）

- `run.bat` / `stop.bat` / `gsv.bat`：去 `pause`、`pythonw`、`netstat + taskkill`；
- `requirements-gsv.txt` 补齐 6 个缺失包，`jieba_fast→jieba`、`pyopenjtalk→pyopenjtalk-prebuilt`；
- `bootstrap-env.mjs`：pip 失败自动换清华/阿里镜像；自动生成 `logs/gsv/tts_infer.yaml`（device 按 nvidia-smi）。

> 调查记录：[语音包装完不可用](docs/cases/2026-10-28-voice-pack-install-start.md)

## [0.6.17] - 2026-10-28

### 修复

- **桌宠点「安装」一直无效、也没报错**：三处叠加
  ① 安装器只认根目录 `package.json`，GitHub 源码 zip 多一层 `<repo>-main/`；
  ② 失败残留目录 + 没写安装标记 → 第二次被 `checkAppDir` 的"目录非空"拦住；
  ③ 报错渲染在「运行状态」卡片，用户在下面的「安装设置」点按钮看不到。
  现在：**单层目录自动拍平**；识别源码包并明确提示"这是 SurfCore 的源码包，不是桌宠安装包"；
  失败自动清理本次残留；报错挪到按钮旁并给「用官方最新版」「清理残留后重试」；
  桌宠 zip 下载也支持下载链路（官方 / gh-proxy / ghproxy）。
- `test-updates.mjs` 的旧断言同步到 0.6.12 的新行为（git 更新改为退出后应用）。

> 调查记录：[桌宠安装无效](docs/cases/2026-10-28-pet-install-silent-fail.md)

## [0.6.16] - 2026-10-28

### 新增

- **下载链路可选**：语音页新增「下载链路」卡片，可在
  官方（GitHub）/ `ghfast.top` / `gh-proxy.com` / `ghproxy.net` 之间切换；
  选中项以 `SURFCORE_GH_MIRROR` 传给包内脚本，内容仍以 sha256 为准。
  实测：`ghfast.top` 当前不可用（000），`gh-proxy.com` / `ghproxy.net` 可用（200）——所以给多个让用户自己试。
- **分卷并发下载**：默认 3 路并发（`SURFCORE_DOWNLOAD_JOBS=1..6` 可调）。
  国内单连接常被限速，并发通常快 2~4 倍，且断一条只补那一卷。
  （脚本在 `surfvoicelocal` / `surfvoicecloud`，已推送）

### 修复

- **语音包「不可查」**：更新面板里两个语音包一直显示"不可查（读不到本地 package.json）"。
  原因：语音包没有 `package.json`，也不是 git 工作区，检查逻辑直接放弃。
  现在：
  - 版本来源按 `package.json → version.json → .installed-meta.json` 依次回退；
  - 安装/更新完成时写 `.installed-meta.json`（含版本与远端 commit sha）；
  - 「检查更新」对这类组件按**远端 main 的 commit** 比对：有新提交就提示更新，
    `本地 sha → 远端 sha` 直接显示在原因里；
  - 旧安装没有 meta 时也能查，只说明"没有提交记录，重装后可按提交追踪"，不再报"不可查"。

### 验证

- 新增 `test-updates-voice.mjs`（已进插件 `npm test`）：有 meta → 可查且提示新提交；
  无 meta → 可查且不报"读不到 package.json"；空目录 → 明确"还没装"；
- 4 分卷 × 637KB 并发下载 → 合并 → sha256 通过 → 解压成功；
- `npm run test:audit` 77/77；版本一致性通过。

## [0.6.15] - 2026-10-28

### 新增

- **清理下载残留**：语音包卡片（未安装时）新增「清理下载残留」，删除
  `models/.download/` 与所有 `*.part` / `*.pNN`，显示释放了多少 MB。
- **vendor 拆成 4 卷**：1.84GB 的 `voice-local-vendor.tar.gz` 拆成 4 × 约 460MB，
  `models.json` 用 `parts` 声明；`fetch-models.mjs` 逐卷下载（每卷独立续传）→ 顺序合并 →
  整体 sha256 校验 → 解压 → 清理分卷。断网只补一卷，不用重下 1.84GB。
  （分卷与脚本已在 `surfvoicelocal` / `surfvoicecloud` 仓库推送）

### 验证

- 分卷合并实测：2.4MB 包拆两卷 → 「分卷合并完成」→ sha256 通过 → 解压成功；
- 远端分卷可访问（HTTP 200，482,344,960 字节/卷）；
- `npm run test:audit` 77/77。

## [0.6.14] - 2026-10-28

### 新增

- **语音包下载支持断点续传**（`scripts/fetch-models.mjs`）：先写 `<name>.part`，中断后保留，
  下次 `curl -C -` 续传；完成后校验 sha256，不匹配删掉重下一次（只重试一次）。
  1.84GB 的 vendor 在国内经常断，以前中断就得从头来。
- **重装保留资产**：重装同一个包时只替换代码，保留
  `models/ vendor/ voices/ voicepack/ logs/ cache/ .venv* config.toml` —— 否则 `.part` 会被一起删掉。

### 验证

- 实测续传：预置 1.0MB `.part` → 打印「续传」→ 最终 2,551,407 字节、sha256 校验通过并解压；
- `npm run test:audit` 77/77。

## [0.6.13] - 2026-10-28

### 修复

- **语音包「显示安装完成，实际只下了 490KB」**：三处叠加
  ① 前端 `poll()` 超时/失败后**无条件**写「安装完成」，覆盖了失败原因；
  ② 后端没有完整性校验，`fetch-models` 中断也标完成；
  ③ 解压带只读属性，后续写模型可能失败。
  现在：`poll` 返回真实状态并按状态写文案；装完校验 `verifyDirs`
  （本地包要 `models` + `vendor/GPT-SoVITS`，云端要 `models`），缺就报失败并说明怎么重试；
  解压后 `attrib -R` 去只读；后置脚本缺失直接报错；拉模型期间从脚本输出解析百分比。

> 调查记录：[安装谎报完成](docs/cases/2026-10-28-voice-install-false-complete.md)

## [0.6.12] - 2026-10-28

### 修复

- **更新会直接把 DSH 宿主搞崩（0xFFFF7003）**：更新器在宿主进程里 `cpSync` 覆盖插件自己的
  安装目录，而那正是宿主正在 require 的模块目录。现在改成**进程内只下载/解压，
  覆盖交给独立进程 `scripts/apply-update.mjs`**：它先等宿主 PID 退出（≤15 分钟），
  再用 `robocopy /MIR` 覆盖，并排除 `state/backups/node_modules/.git/config.json/...`。
  git 安装同样排队（退出后 `fetch + merge --ff-only`）。UI 提示改为
  「已下载，退出并重新打开 DSH 后自动应用」。
- **覆盖不删旧文件**：`/MIR` 会把「新版本里没有的旧文件」删掉，不再留多版本混杂。
- **`qq-tool-restrict` 启动刷屏**：以前每个不存在的工具名打一行（几百行），
  现在只打一条示例 + 一条汇总（执行期白名单不受影响）。

### 验证

- `scripts/apply-update.mjs` 集成测试：staging 覆盖成功、`config.json`/`state/` 保留、
  源里没有的旧文件被删除；
- `npm run test:audit` 77/77。

> 调查记录：[更新致 DSH 崩溃](docs/cases/2026-10-28-update-crash.md)


## [0.6.11] - 2026-10-28

### 修复

- **SnowLuma「装好了但检测不到」**：用户填 `D:\Tools\SnowLuma2` 时，代码只取 `dirname` → 算成 `D:\Tools`，
  而配置在 `SnowLuma2` 下的 `app/config` 里，于是永远检测不到。现在候选目录展开为
  `填写路径 / 填写路径pp / 上一级 / 上一级pp`；`SnowLuma home（app 目录）` 也加了「浏览…」和更清楚的说明。

### 新增

- **语音包可手动指定目录**：语音页新增「已有安装？手动指定包目录」，选到 `voice-local` 或它的上一级都行，
  保存后按多候选目录识别；这是"自动识别不到"时最稳的兜底。
- **所有路径类字段都配了「浏览…」**：会话工作目录、bili.mjs 路径、语音库目录、ffmpeg 路径、
  SnowLuma 安装目录 / home、语音安装目录 / 已有包目录、桌宠安装目录 / Electron / 安装包 zip。

> 调查记录：[SnowLuma 检测](docs/cases/2026-10-28-snowluma-detect.md)


## [0.6.10] - 2026-10-28

### 修复

- **语音包「装好了却显示未安装」**：用户把包装在 `文档\surfcore\stateoice-packsoice-local`，
  而配置里是另一个目录、端口又没起来 → 判定为未安装，只给他看「安装（1.9GB）」。
  现在识别会在多个已知目录里找（配置目录 / 仓库根 / cwd / `文档\surfcore` / `~\surfcore`），
  找到 `config.toml` 即视为已安装；卡片显示「已在别处安装：<路径>」，并提供
  「把安装目录设为这里」一键把 `voicePacks.dir` 指过去。启动/停止/卸载都会用找到的那份。

> 调查记录：[语音包未识别](docs/cases/2026-10-28-voice-pack-not-detected.md)


## [0.6.9] - 2026-10-28

### 新增

- **路径输入框旁边多了「浏览…」**（用户反馈"手填路径很麻烦"）：
  - 语音包安装目录、桌宠安装目录、Electron 路径、桌宠安装包 zip、SnowLuma 安装目录；
  - 点「浏览…」由宿主进程弹 **Windows 原生选择框**（浏览器拿不到绝对路径，这是唯一可行方式）；
  - 选完自动回填，取消不影响原值；失败给 toast 提示而不是静默。

## [0.6.8] - 2026-10-28

### 修复

- **本地语音包默认音色不存在**：仓库里没有 `voices/` 和 `voicepack/`，而 `config.toml` 默认
  `default = "loli12-gsv"` → 一调 TTS 就 503「没有音色」。现在 `voice-local-voicepack.tar.gz`
  （2.5MB：`voices/*` + `voicepack/age12/*.wav`）作为 Release 资产随 `models.json` 一起下载，
  零样本克隆所需的参考音频齐了，默认音色开箱可用。
- **安装后没有 config.toml**：仓库只有 `config.example.toml`（真实配置不入库），安装后 voxd 起不来。
  现在装完自动从 `config.example.toml` 复制一份 `config.toml`。

> 调查记录：[默认音色 503](docs/cases/2026-10-28-voice-default-voice-missing.md)


## [0.6.7] - 2026-10-27

### 新增

- **语音包自动装 Python 环境（真正解决"下载完起不来"）**：
  - 包内新增 `scripts/bootstrap-env.mjs`：找本机 Python 3.10~3.13 → 建 `.venv` → `pip install -r requirements.txt`；
    本地包再建 `.venv-gsv`（GPT-SoVITS）并按 `requirements-gsv.txt` 装依赖（要求 ≤3.12，torch 还没有 3.13 轮子）。
  - 安装流程：下载代码 → 拍平 → 拉模型（sha256）→ **装 Python 依赖** → 完成；进度条显示当前阶段。
  - 启动前检查 `.venv`：没装好直接提示"先卸载再安装一次"，不再让用户对着"启动超时"猜。

### 修复

- `numpy` 约束过窄：Python 3.13 上会退到源码编译并失败（numpy 2.0 无 cp313 轮子）→ 云端包改 `numpy>=2.1`。

### 验证

- 本机 Python 3.13 从零建 venv、装云端包依赖（fastapi / uvicorn / numpy 2.5.4 / piper-tts 1.8 / onnxruntime 1.31），
  `python -m voxd --config config.toml` 正常监听 8767。

## [0.6.6]
## [0.6.6] - 2026-10-28

### 新增

- **安装进度条**：
  - 桌宠：`/pet/install` 改成异步任务，前端轮询 `/pet/status` 的 `installing`（下载 0~80% → 解压 85% → 完成），
    不再"点了没反应"；Electron 下载复用同一进度通道。
  - 语音包：卡片里显示进度条（下载中 / 解压中 / 拉取模型 / 完成），失败直接显示原因。

### 修复

- **语音包体积显示错误**：本地包写 7.8GB，实际公开分发下载 ≈1.77GB（vendor 1.71 + models 0.05）；
  7.8GB 是开发机整目录（含 `.venv` 5.1GB + 日志）。云端包 280MB → ≈60MB。文案同步更新。

## [0.6.5] - 2026-10-27

### 变更

- 

## [0.6.4] - 2026-10-27

### 修复

- **卸载桌宠会丢聊天记录**：`remove()` 直接删安装目录，`data/`（聊天历史、设置）跟着没了。
  现在卸载前把 `data/` 备份到 `~/.dsh/surfcore/pet-data-keep/`，重装时自动恢复。
- **改了语音安装目录又变回去**：桥接的 `/api/voice/*` 用启动时的旧配置，插件侧保存到
  `config.json` 后桥接看不到。现在每次请求都重读 `config.json`，改完立即生效。
- **"桌宠不可查"**：版本清单（`version.json`）拉取失败没有重试。现在失败 800ms 后重试一次，
  仍失败就用 6 小时内成功过的清单兜底（标 stale），不再直接报"不可查"。

## [0.6.3] - 2026-10-27

### 优化

- **检查更新不再吃 GitHub API 配额**：优先请求 `github.com/<repo>/releases/latest` 的 302 跳转，
  从 Location 里读版本（不消耗未认证的 60 次/小时配额）；拿不到才退回 API。
  若 redirect 显示"没更新"，才花一次 API 查 tags 复核（防止"只打 tag 没发 Release"被漏掉）。
  多用户同时检查时不会再互相挤爆配额。

## [0.6.2] - 2026-10-27

### 修复

- **"已是最新"其实是查不到**：GitHub API 未认证只有 60 次/小时，被限流时结果不可用，
  而概览在 `pendingCount===0` 时一律显示"已是最新"——用户明明落后两个版本却看到"最新"。
  现在区分三态：有更新 / **部分查不到（带原因）** / 用缓存结果；
- 拉不到最新版本时，**6 小时内成功过的结果兜底**（标 `（缓存）`），不再让检查结果突然变成"不可查"。

## [0.6.1] - 2026-10-27

### 新增

- **Electron 下载支持双源**：默认先 npmmirror（国内快），失败自动退到 GitHub 官方源；
  设置页多一个「GitHub 官方源」按钮，镜像挂了也能手动走官方。
  下载失败时错误里会带两个源各自的失败原因。

## [0.6.0] - 2026-10-27

### 新增

- **语音安装目录可改**（设置 → 语音）：输入框 + 「保存路径」，写 `voicePacks.dir`；
  提示"改完重启桥接、已装的包要手动搬过去"。顺手统一了默认目录：`src/voice-packs.js`
  以前用 `process.cwd()`，桥接 cwd 不同会指到两个地方（表现为"装了却说没装"）。
- **桌宠安装不再靠手抄地址**：
  - 安装包地址默认填官方 latest（`surfpet/releases/latest/download/pet-pack.zip`），不会过期；
  - 「用官方最新版」一键填；
  - **Electron 自动探测**（配置 → 运行时目录 → 常见安装位置），检测到就写进配置；
  - **Electron 一键下载**：约 125MB，从 npmmirror 拉 Electron 45.0.0，解压到
    `~/.dsh/surfcore/pet/runtime/electron-v45.0.0/`，装完自动填路径。
- 「安装」按钮灰着时，旁边直接写"先在下方填安装包地址，按钮才可点"（以前纯灰，用户不知道缺什么）。

## [0.5.8] - 2026-10-27

### 修复

- **换 B站 号被卡死**：原来"已有 self.mid 就不许换号"，导致用户把管理员卡片改成自己的号后，
  扫码永远报「不是当前小肥鱼」——而错误提示又让他去改管理员卡片，形成死循环。
  现在：
  - 勾选「我只有一个 B站 号（主人=小肥鱼）」后，允许把鱼换**成本人这个号**（仍拒绝换成无关的第三个号，防被换人）；
  - QR 弹窗新增「**换号（清除旧凭据）**」：把旧 cookie、对齐表归档到
    `~/.dsh/surfcore/backups/bili-switch-<时间>/`，清掉 `bili.self/owner` 的 mid，然后可重新扫码绑新号；
  - 扫错号的提示改成两条可行动路径（勾同一个号 / 点换号），不再让人去改管理员卡片。

### 测试

- `test-bili-qr-login.mjs` 更新：勾选后换成本人号 → 放行；勾选后换成第三个号 → 仍拒绝。

## [0.5.7] - 2026-10-27

### 变更

- 

## [0.5.6] - 2026-10-27

### 变更

- 

## [0.5.5] - 2026-10-27

### 修复

- **浅色主题下弹窗深底深字**：0.5.1 把更新/安装弹窗固定成深色卡片，但内部文字仍跟主题走
  （浅色主题 = 深字）→ 深底深字几乎看不清。现在弹窗内 `h3/p/label/div/span/li` 一律浅色，
  输入框改深底浅字，`.qbw-hint` 用中灰。

## [0.5.4] - 2026-10-26

### 变更

- 

## [0.5.3] - 2026-10-26

### 变更

- 

## [0.5.2] - 2026-10-26

### 变更

- 

## [0.5.1] - 2026-10-26

### 变更

- 

## [0.5.0] - 2026-10-26

### 变更

- 

## [0.4.8] - 2026-10-26

### 变更

- 

## [0.4.7] - 2026-10-26

### 变更

- 

## [0.4.6] - 2026-10-26

### 变更

- 

## [0.4.5] - 2026-10-26

### 变更

- 

## [0.4.4] - 2026-10-26

### 变更

- 

## [0.4.3] - 2026-10-26

### 变更

- 

## [0.4.2] - 2026-10-26

### 变更

- 

## [0.4.1] - 2026-10-26

### 变更

- 

## [0.4.0] - 2026-10-26

### 变更

- 

## [0.3.2] - 2026-10-26

### 变更

- 

## [0.3.1] - 2026-10-26

### 修复

- **点「一键安装」没任何反应**：原来用浏览器原生 `confirm/prompt` 弹窗，且第一个动作就是请求后端；
  界面里原生弹窗不出、旧后端又直接 400，用户只看到"什么都没发生"。
  现在改成**页面内自绘弹窗**：点下去立刻出现"正在探测 SnowLuma…"，随后显示可勾选的群列表与
  主人 QQ 输入框；点「开始安装」后逐步显示 ✓/✗ 进度，结束显示结果与"需重启 DSH"提示。
- 后端仍是旧版时，弹窗会直接写明"后端还是旧版本：关掉 DSH 再开一次"。

## [0.3.0] - 2026-10-26

### 新增

- **一键安装（全部）**：为了"新用户装完点一下就能用"，把整机装成可用状态：
  1. 安装依赖（`npm install`，已装则跳过）；
  2. 装进 DSH（`setup-dsh.mjs` 注册预设/MCP/bundle，已注册则跳过）；
  3. 生成配置与控制台令牌；
  4. **自动发现 SnowLuma**（读它自己的 `onebot_<uin>.json` 拿端口与 token）并写回配置；
  5. 写入主人 QQ 与白名单（群列表来自 SnowLuma 的 `get_group_list`，**逐个确认后才写**）；
  6. 启动 QQ 桥接；
  7. 可选组件（语音包/桌宠）只报告状态，不自动下载 GB 级内容。
- 安装过程是**异步任务**：设置页「诊断」里显示每一步 ✓/✗ 与耗时细节，失败可单独重试。
- **诊断功能保留**：体检 9 项、路径、备份/恢复、插件与桥接日志都在；另加「只补缺失项」按钮用于轻量修复。

## [0.2.1] - 2026-10-26

### 修复

- **「一键配置」点了没反应**：界面已更新、但 DSH 里跑的还是旧后端，接口回 `400 未知 action`，
  提示被淹没。现在遇到这种情况会直接说人话：「后端还是旧版本：关掉 DSH 再开一次」。

## [0.2.0] - 2026-10-26

### 新增

- **环境体检（设置 → 诊断）**：9 项新手检查，红/黄/绿三档，每项都带"怎么补"：
  Node 版本、统一配置、管理员 QQ、**白名单（最常漏）**、SnowLuma 配置/在线、
  QQ 桥接源码、是否已装进 DSH、控制台令牌。
- **一键配置**：只补"缺的"、绝不覆盖已有值 —— 生成 `config.json`、生成控制台令牌、
  写入管理员 QQ；补齐后提示是否需要重启 DSH。
- 判定规则抽成 `lib/doctor.js`（纯函数），新增 `test-doctor.mjs` 并接入插件测试：
  白名单为空必须红、只有私聊也算配好、没装进 DSH 必须给出 `setup-dsh.mjs` 命令。

## [0.1.1] - 2026-10-26

### 修复

- **B站分享反复发同一条**：`pickShareCard()` 在"6 天内都发过"时回退到整个素材池，且永远取排序第一条，
  导致同一条高分视频每天重发；现在新鲜素材为空时**不发**，要复用必须显式 `allowReuse`。
- **关掉 B站 后分享定时器仍在跑**：分享调度只在桥接启动时读 `biliBridge.enabled`，设置页的
  「启动B站」关不掉它；现在每次触发前按 30 秒缓存读统一配置的 `platforms.start.bili`。
- **分享历史写失败被静默吞掉**：`saveHistory()` 的 `catch {}` 改为打日志——写不进去会让去重永久失效。

## [0.1.0] - 2026-10-26

首个公开版本。

### 新增

- QQ 桥接：39 个 `qq_*` 工具、四种运行模式、会话映射、上线补历史、收尾与潜水
- 记忆系统：可塑性记忆卡（衰减/遗忘/容量告警）+ 全量记忆卡（append-only）
- 角色系统：多角色整包切换、人设卡 + 记忆卡 + B站 行为账本、快照回档
- 目的机制：人格 × 记忆 × 信息 → 目的 → 主动行为；四道闸门（安静时段/每日上限/主人在忙/额度）
- 鱼群守则：QQ 三条"不会" + 急事绕过；B站 评论区名额池 + 强制聚拢
- B站：扫码登录、生物钟、偏好抓取、额度、看视频/打分/评论/动态/私信、34 个命令
- 语音：本地 GPT-SoVITS（8765）+ 云端声音复刻（8767），一套系统两个入口
- 桌宠：五套 Live2D 皮肤、文本/语音对话、气泡回复、专注模式
- Token 管理：全局总额 + 四本账（QQ/B站/其他/总额）、80% 提醒、100% 停手、四道防爆破闸门
- 组件更新：git 快进（本体/语音包）+ 版本清单（桌宠，保留 `data/`）
- 文档：12 篇逐行梳理（约 8,700 行）+ 手把手安装 INSTALL.md

### 安全

- 群友会话工具面 fail-closed；发送必须命中白名单
- 控制台仅回环 + 令牌 + Host/Origin 校验
- 仓库零真实数据：角色卡脱敏、记忆卡空壳
