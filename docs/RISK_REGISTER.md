# 风险台账（RISK REGISTER）

> 用途：把「可能出事的地方」列全，每条都有**现有缓解**与**状态**，避免修完就忘、或者以为修过其实没修。
> 状态：✅ 已缓解（验证过） · 🟡 部分缓解（有残余） · 🔴 未处理 · ⚪ 接受（明确不修，写原因）
> 更新规则：新发现一行；修完改状态并补「验证方式」。严重度：P0 数据/服务全挂 · P1 功能受损/隐私 · P2 体验/可维护 · P3 打磨。

## 一、宿主/基础设施

| ID | 风险 | 影响 | 现有缓解 | 状态 |
| --- | --- | --- | --- | --- |
| R1 | 单个「身份错位」的会话日志让 `workspace` 服务起不来 | 工作区全空、新建失败、插件全不激活（2026-10-22 实际发生） | 坏目录整目录隔离；`app.asar` 等长字节补丁（`scripts/patch-dsh-session-guard.mjs`）把该错误改成可跳过的 corruption 类；`scripts/install-session-guard.mjs` 在 DSH 退出后自动换入并冒烟回滚 | 🟡 补丁待换入；残余见 R1a/R1b |
| R1a | DSH 升级会覆盖 `app.asar`，补丁静默消失 | 同类文件再次出现时重演事故 | `npm run guard:check` 可检测；`AGENTS.md`/`PITFALLS.md` 已写明升级后先查 | 🟡 需人工记得跑 |
| R1b | 另有两处「普通 Error」也会让 `list()` 整体失败：重复 session id、文件名版本与头部不符 | 同类全挂 | 目前只修了身份错位一处；`check:sessions` 能在启动前发现重复 id | 🔴 待评估是否补第二/三处 |
| R1c | 补丁只在 asar 层，换机器/重装 DSH 就没有 | 新环境重演 | 与目录名无关的体检脚本 `npm run check:sessions`（默认只读，可 `--quarantine`），建议重启前跑 | ✅ 本机 16 条全绿；已用旧文件反向验证 |
| R2 | 插件清理旧工作区用 `fs.rmSync` 硬删除 | 目录不可逆丢失 | **整段删除**该逻辑：插件不再对工作区目录做任何写/删；清旧目录只能人工或脚本先备份再动 | ✅ 代码已删；待重启确认日志无相关字样 |
| R3 | DSH 端口漂移（3080→48994→57981），硬编码即失联 | 桥接/诊断连不上 | 统一 `discoverDshBaseUrl()`；`state/dsh-port.json` | 🟡 文档里仍有 3080 历史写法 |
| R4 | `app.asar` 被本地补丁修改，无签名校验 | 若 DSH 开启 asar integrity fuse，改字节会导致启动失败 | 换入后立刻用 Electron `RUN_AS_NODE` 读 asar 冒烟，失败自动回滚并保留 `app.asar.old-<ts>` | ✅ 有回滚路径 |
| R5 | 计划任务 `DshSessionGuard` 在后台换文件 | 用户不知情时文件被改 | 只在 DSH 退出后动作；日志 `state/guard-patch.log`；成功后自删任务 | 🟡 需在文档中告知（已写入 HANDOFF） |

## 二、安全 / 隐私

| ID | 风险 | 影响 | 现有缓解 | 状态 |
| --- | --- | --- | --- | --- |
| R6 | 群友通过提示注入诱导 agent 外发本机信息 | 隐私泄露 | 工具面白名单、发送白名单、回复审计（路径/凭据正则拦截）、人格注入由桥接控制 | ✅ 见 `docs/guides/SECURITY_BASELINE.md`；正则仍是启发式 |
| R7 | 控制台端点鉴权遗漏（某条写操作绕过令牌） | 本机任意进程可改配置 | 统一在 `connection.requestRejection` + 回环校验 + 同源校验；2026-10-26 复核：控制台入口集中关卡（Host 白名单 > consoleToken 定长比较 > `x-agent-call` 混淆代理防护 > 写操作强制 JSON + Origin）**在 153 条端点分支之前**执行，单端点漏写校验不会退化成管理端全权 | ✅ 入口级已复核；插件 API 实测无凭据 401 |
| R8 | 桥接/控制台把 token 写进日志或错误信息 | 凭据泄露 | 配置读取脱敏 `********`；2026-10-26 复核：控制台令牌只打印前 6 位（`state/console-token` 落盘、`state/` 已 icacls 收紧）；`privacy-scan` 无凭据命中 | ✅ 已复核 |
| R9 | 文档/注释里残留本机绝对路径（`<工作区>\...`、用户名） | 发布后泄露本机结构 | 2026-10-26 实测 36 处 → 已全部换成占位符（`%USERPROFILE%` / `<仓库根>` / `<工作区>` / `<本地目录>`），并把 `src/voice-packs.js` 里两个**硬编码的语音包安装源**改成相对仓库解析；另把示例里的淘宝联盟跟踪链接截断 | ✅ `node scripts/privacy-scan.mjs --strict` 现在 exit 0（0 命中、0 截断） |
| R9a | `privacy-scan` 会**提前结束**某文件某规则的扫描且只打印警告 | 发布闸 fail-open：被截断的规则后续命中会漏报 | **根因不是"文件太大"**：默认规则里有几条写了 `flags: ''`，而扫描器用 `new RegExp(pattern, flags ?? 'g')` —— 空串不 fallback ⇒ **没有 global** ⇒ `exec` 永远返回第一个匹配、`lastIndex` 不前进。后果：① 每条规则每个文件**只看第一个命中**（真泄漏被跳过）；② 循环空转到上限，被误报成"扫描不完整"。修法：`compileDenyRegex()` 强制补 `g`（抽到 `scripts/privacy-rules-lib.mjs`，`test-privacy-scan.mjs` 钉住） | ✅ 已修：`--strict` 由 45 个截断/5.0s → **0 个截断/0.5s**；同时**新发现并清掉 3 个此前看不见的命中**（`rich-text-nodes.md` 的联盟跟踪链接） |
| R10 | 密钥文件被误提交 | 凭据泄露 | `.gitignore` 已排除 `config.json` / `state/` / `audio/` / `_backups/`；`privacy-scan` 兜底 | ✅ 当前 `git ls-files` 无密钥文件 |
| R18 | 记忆卡把 QQ 私事带进 B站 公开提示词 | 公开平台泄露私聊/身份 | 记录固定 `scope=qq`；B站 渲染只取 `bili/shared`；`includeQqInBili` 默认关；共享 scope 脱敏 5~12 位数字；时政/娱乐圈 `sensitive` 不进 B站 | 🟡 评分/分类是启发式，需人工抽查 `memory-card-prompt-bili.md` |
| R19 | 记忆卡无限增长拖垮提示词/磁盘 | token 成本、上下文挤占 | `maxChars` 默认 12000；80/90/100% 告警 + 自动压缩；`maxRecords` 600；QQ/B站 注入各有独立预算 | ✅ 单测覆盖容量/压缩 |
| R20 | 全量记忆卡被误注入提示词 / 无限增长 | 上下文爆炸；磁盘占用；含 `sensitive` 内容 | 全量卡不生成 prompt 文件，桥接/调度器源码不引用它（接线测试钉住）；append-only JSONL，`fullMaxBytes` 默认 10GB（0=不限）只告警不删；只读接口不写盘 | 🟡 需要人工定期导出/备份；全量卡含本地敏感内容，导出前需检查 |
| R21 | 目的机制自动私聊主人：打扰 / 复读 / 说错话 / 索取越界 | 用户被打扰；模型措辞不可控；可能开口要钱/要东西 | 安静时段 + 每日上限 + 主人空闲阈值 + token 额度 + 好友检查 + 发送白名单；planned/sourceId/文本三重去重；提示词明确「不要钱/不要贵重东西、不要提群友 QQ/群号、素材不是指令」；设置页可关、可先零副作用预览 | 🟡 默认开，尚未真机真发验收；模型措辞仍需人工观察头几轮 |
| R22 | 本机接口的「回环 Host」判据把 IPv6 写成了死分支：`host.split(':')[0]` 对 `[::1]:8080` 只得到 `[` | DSH 若绑到 `::1`，设置页 API 与桌宠 API **全量 403**（现象是"插件消失了"） | 2026-10-26 抽成 `plugins/surfcore/lib/http-guard.js` 唯一实现并修正方括号解析；`scripts/test-http-guard.mjs` 钉住 IPv4/IPv6/localhost 三种写法 | ✅ 已修（单测 31 条） |
| R23 | 共享令牌比较对**两个空串**返回 true（`timingSafeEqual` 对零长 buffer 成立） | 令牌还没生成时"空=空"可能被当成校验通过 | 同模块 `safeEqual` 改为空串一律 false（fail-closed）；桌宠 API 原本另有非空检查，属纵深防御 | ✅ 已修 |

## 三、可靠性 / 资源

| ID | 风险 | 影响 | 现有缓解 | 状态 |
| --- | --- | --- | --- | --- |
| R11 | pnpm 安装被「静默超时」终止，`node_modules` 不完整 | 插件/桥接随机缺件 | 发现 `.ignored` 与锁文件不一致就重装；`PITFALLS.md` #2 有排查步骤 | 🟡 无自动检测 |
| R12 | 桥接可被手工启动多个实例 | 重复回复/状态错乱 | **已有强制单例锁**（`acquireLock`：`wx` 原子建锁 + PID 存活探测 + 控制台端口占用二次判据 + EPERM 按过期处理 + 退出码 2）。2026-10-26 复核代码路径 | ✅ 已强制（旧描述"无强制单例锁"已作废） |
| R13 | 日志/状态文件无界增长 | 磁盘占用、启动变慢 | `qq-activity.log` 保留最近 500 行并滚 `.1`；插件日志 2MB 滚 `.1`；`/logs` 只读尾部 512KB；`pruneBackups` 按来源各留 40。2026-10-26 实测 `state/` 288MB 中 277MB 是语音包（用户素材）、7.5MB 是 TTS 缓存，日志合计 <1MB | ✅ 已复核（2026-10-26 另清掉 2.3MB 一次性审计残留） |
| R14 | 会话/工作区数据误删后无法恢复 | 历史丢失 | `_backups/`、`~/.dsh/_quarantine/`、`clean-dead-workspaces` 先备份再删；2026-10-26 的 `state/` 清理也走 `_backups/state-residue-*/`（带 README + 回滚说明） | 🟡 依赖脚本被正确使用 |
| R14a | `state/` 里堆一次性 `.mjs`/截图/审计日志（运行时目录当草稿纸） | 运行时目录难以分辨"什么是数据"；一次性脚本可能被误当运维工具执行 | 2026-10-26 清出 50 个（21 个 `.mjs`、5 张 probe 截图、24 个日志 + 2 份 audit-result.json）隔离到 `_backups/state-residue-20261026/`；`FOLDER_MAP` 写明 `state/` 只放运行时数据 | ✅ 已清；规则写进文档 |
| R24 | 桌宠 ↔ 插件只有 `host.json`（`version: 1`）发现文件，没有协议版本协商 | 桌宠工程（仓库外）与插件升级不同步时，字段缺失只会表现为"某个功能不响应" | 发现文件带 `version` / `pluginVersion`；桌宠侧断线重连 + 游标重置；接口只增不改 | 🟡 单机可接受；跨版本升级前先看 `PET.md` |
| R25 | 双进程写同一个 `config.json`（插件设置页 vs 桥接控制台）**没有跨进程锁** | 同时保存时后者覆盖前者（丢失一次修改，不会写坏文件） | 两侧都是「临时文件 + rename」原子写；保存前各自读最新 | 🟡 低概率；真要修就得引入文件锁（超出本轮范围） |

## 四、文档 / 维护

| ID | 风险 | 影响 | 现有缓解 | 状态 |
| --- | --- | --- | --- | --- |
| R15 | 文档版本口径不一致（README 同时出现 0.2.0-rc.2 / 0.2.1-rc.2） | 按文档操作踩空 | 待统一；`HANDOFF.md` 已记为待办 | 🔴 |
| R16 | 改动后忘记跑回归 | 回归上线 | `AGENTS.md` 铁律 #5 + 收工检查单 | 🟡 靠纪律 |
| R17 | 下一次会话不认得这次的改动 | 重复劳动/互相打架 | `AGENTS.md` 自动注入 + `HANDOFF.md` + `PITFALLS.md` + `ROADMAP.md` | ✅ 本次建立 |
| R26 | **生成物与源漂移却没人管**：`plugins/surfcore/presets/qq-chat-v2.patch.yml` 落后于 `dsh/agent-presets/qq-chat-v2/agent.cordis.yml`（缺整段「对话收尾」），而能抓到它的 `test-agent-preset-patches.mjs` 既不在 `test:audit`、也没有 npm script | 本仓库里的"装进 DSH 的那份"与源不一致；下一次重装才突然生效（或永远不生效） | 2026-10-26：重新生成 patch；把该测试**登记进 `test:audit`** 并加 `npm run test:preset-patches`（门禁现在 72 个脚本） | ✅ 已修（PITFALLS #71） |
| R27 | 一次性脚本直接写在 `state/` 里、用完不清理 | 运行时目录被当草稿纸（见 R14a）；引用了 `state/` 某次 probe 产物的脚本也无法复现 | 本轮已隔离；约定：一次性脚本进 `scripts/`（`test-*` 要登记进 `tests[]`），产物进 `os.tmpdir()`，不进 `state/` | ✅ 已清（规则写入 FOLDER_MAP §2） |
| R28 | `src/voice-packs.js` 把**语音包默认安装源**写死成本机绝对路径 | 换机器/换目录后默认安装源指向不存在的位置，现象只是"安装失败"（语音功能看似坏了） | 2026-10-26 改成相对仓库根解析（`<仓库上级>/voice/packages/<id>`）：本机解析结果与旧值**逐字相同**（`test-voice-packs-default.mjs` 比对），换目录也能用 | ✅ 已修（行为等价已验证） |
| R29 | 桌宠 API 此前只有"字符串包含"级别的测试（`test-client-contract` 断言 index.js 里出现了 `createPetApiService`） | 路由注册了但鉴权/分支坏了没人发现（现象：桌宠连不上，或本机任意进程能连） | 2026-10-26 新增 `plugins/surfcore/scripts/test-pet-api.mjs`：假 chat/purpose + 假 req/res，覆盖令牌（无/错/空/header/query）、回环、同源、content-type、全部读写端点、音频与 `host.json` | ✅ 32 条断言，进 `npm test` |
| R30 | **B站 侧三个"一跑就 ReferenceError"的脚本**（2026-10-26 写文档时逐行读出来的）：① `tools/commands/edit-dynamic.mjs` 调 `gate()` 却没 import（`dynamic.mjs` 早就修过同一个 bug）；② `tools/commands/danmaku-await.mjs` 用未定义的 `statePath` → 进程启动即崩，而 `scheduler.js` 的 `liveTick` 正靠它，**直播间监听实际起不来**；③ `tools/commands/notify.mjs` 的 `dm` 分支引用未定义 `p`、且从不调 `dm.mjs`，但设置页把"B站私信"当合法推送方式 | 对应功能静默不可用；②还会让调度器每分钟白跑一次 | **2026-10-26 已处理**：① 补 `import { gate }`（1 行）；② **标注未实现**——脚本启动即 `exit(3)` 并打印原因，调度器收到 3 后 `liveUnimplemented=true` 停止重试（真正实现需补状态文件 + 真机验证）；③ 设置页移除「B站私信」选项，老配置命中时抛可读错误而不是 `ReferenceError` | ✅ 已修（②按"未实现"处理，不假装能用） |
| R31 | 出站身份闸只接了 4 个点（`comment` / `dm` / `dynamic` / `share-dynamic`） | `daily` 的转发卡片路径、`dynamic-image`（`--at` 主动写 mid）、`edit-dynamic`、`danmaku` 是同等公开暴露面但**不过闸** | 2026-10-26 记录（写文档时发现，未改代码） | 🟡 待评估：这些路径是否真的会带上主人/别人的身份标识 |
| R32 | 控制台「语音」页从导航点不进去：`console.html` 有 `data-view="voice"` 按钮与 `section-voice` 区块，但 `setConsolePage` 的白名单 `consolePages` **没有 `voice` 键**，未知页一律回退 `overview` | 语音包安装/启动/触发规则在控制台里实际不可达（真正可用的是 DSH 设置页的「语音」标签，两者不是同一个界面） | **2026-10-26 已修**：删掉控制台那个「♪ 语音」导航按钮（保留 `section-voice` 区块不删——页内还有 JS 绑定，删区块会连带坏掉控制台初始化） | ✅ 已修 |
| R33 | `schedulerStatus.lastTickAt` 从未被写入真实时间：`lib/index.js` 里 5 处赋值全是 `null`（`:181/:244/:269/:361/:405`） | 任何依赖它判断"最近一次 tick"的界面/诊断只会拿到 `null`（误判为"从没跑过"） | 2026-10-26 写文档时发现；要么在 scheduler 的 tick 回调里回写，要么把字段删掉避免误导 | 🟡 待修 |
| R34 | **桌宠安装目录"不可逆删除面"**：`lib/pet.js` 的 `resolveAppDir()` 只做 `path.resolve`，而 `install` / `unzip` / `remove` 三处对它 `rmSync(recursive, force)`。用户把「安装目录」填成别的目录 → 点安装/卸载会清空它；另外 `install()` 不先 `stop()` | 数据不可逆丢失 | **2026-10-26 已修**：新增 `checkAppDir()`（盘根/受保护目录本身或其上级/非空且无标记文件 一律拒绝）+ 安装成功写 `.surfcore-pet.json` 标记 + 三处删除前统一过闸 + 安装前先 `stop()`；`status()` 增 `appDirSafe`；18 条单测 `scripts/test-pet-dir-guard.mjs` | ✅ 已修（含回归） |
| R35 | 插件侧目的状态缓存**不随文件变化重载**：`pet-purpose.js:111-113` 只在"状态文件路径变了"时重读，而桥接按 mtime 重载（`src/bridge.js:1739-1749`） | 载体在 QQ 侧跑过再切回桌宠，插件可能用旧状态（今日次数/pending/history）覆盖桥接刚写的内容 | 2026-10-26 写文档时发现（未复现）。修法：与桥接对齐成 mtime 失效 | 🟡 待评估 |
| R36 | `/api/voice/packs` 每个请求都 `createVoicePacks(cfg)` 新建实例（`src/bridge.js:6459`），而安装进度 `activeInstalls` 是闭包内状态（`src/voice-packs.js:179`）且**只 set 不 delete**（`:224-250`） | ① 安装进度/失败在前端**看不到**；② 双击安装可能并发互删目录；③ **同一进程内第二次 install 会被"正在安装"永久拒绝**（成功/失败都一样），装坏了只能重启进程才能重装 | 2026-10-26 写文档时发现（语音子系统 + core-B 两路独立确认） | 🟡 待修（最小修法：`finally` 里 `activeInstalls.delete(id)`，失败态单独留一条带 TTL 的记录） |
| R37 | 语音触发 `trigger.who="list"` 在群聊分支引用未定义的变量 `last`（`src/bridge.js:1946-1949`） | 该配置一用就抛 ReferenceError（表现为语音发不出） | 2026-10-26 写文档时发现。另：`trigger.groups` 解析了但全仓无人使用（`:1971`），`voiceLastSpeaker` 只写不读 | 🟡 待修 |
| R38 | `scripts/send-voice.mjs --direct` 可绕过白名单/限流/审计直连网关（`scripts/send-voice.mjs:380-393`） | 手工运维工具，绕过所有闸门 | 🟡 有意为之还是遗漏待确认；至少在文档里标明"这是调试口" |
| R39 | 文档与代码不一致几处（写文档时逐条核对出来的）：`docs/VOICE-PACKS.md` 写 sha256 校验但代码没有（`voice-packs.js:134-176`）；语音触发窗口文档 5 分钟、代码 10 分钟（`bridge.js:1938`）；`plugins/surfcore/docs/PET.md` 启动参数少写 `--user-data-dir`；唤醒提示写"陌生私信一天共 12 条"、代码 `STRANGER_DAILY=30` | 按文档操作可能得到不一样的结果 | 2026-10-26 记录；以 `docs/guides/SUBSYSTEM-*.md` 为准 | 🟡 待统一 |

---

## 2026-10-22 代码审计结果（只读审计 + 当轮修复）

审计范围：`plugins/surfcore/lib/*.js`、`src/bridge.js`（HTTP/鉴权/文件/子进程重点段）、`tools/commands/*.mjs`、`scripts/*.ps1`。
结论：**鉴权与路径穿越没有发现缺口**；真实问题集中在「删除/停止/配置路径」这一类副作用上。

| 级别 | 发现 | 处置 | 状态 |
| --- | --- | --- | --- |
| P1 | `scripts/stop-qq-bot.ps1` 按硬编码 3100 端口强杀任意进程，且无条件删 `bridge.lock` → 误杀 + 双实例 | 重写：端口读 `config.json` 的 `consolePort`；只有「node 且命令行含 bridge.js」才杀；确认停掉才清锁；SnowLuma 同样校验进程名 | ✅ 已修 |
| P1 | `/api/roles/delete` 直接 `fs.rmSync` 人格卡，无备份 | 改为移动到 `state/role-trash/<名字>.<时间>.md`，响应返回 `trash` 路径 | ✅ 已修 |
| P2 | `scheduler.js` 的 `diaryPushLines()` 配置路径少一层 `surfcore` → 「关掉推送日记」被静默忽略；同文件多处硬编码 `~/.dsh` | 统一用 `DSH_HOME` + `surfcore/bili.config.json`；同步修 `quota.json` / `silence-seen.json` 路径 | ✅ 已修 |
| P2 | `plugin.log` 只追加不轮转；`/logs` 每次整文件读入内存 | 超过 2MB 滚动为 `.1`；日志接口只读尾部 512KB | ✅ 已修 |
| P2 | SnowLuma 启动用 `cmd /c start` + `path.basename()` 拼命令串，路径含 `&` 可注入 | 改为 verbatim 参数传完整路径并拒绝含引号/换行路径 | ✅ 已修 |
| P2 | 备份全局只留 40 条，「全部备份」一次占 8 条，5 次就挤掉 persona/config 历史 | `pruneBackups` 改为**按来源分别保留**（每类 40 条） | ✅ 已修 |
| 误报 | 控制台鉴权（consoleToken + timingSafeEqual + Host/Origin 白名单 + JSON 强制） | 核查无缺口 | ⚪ |
| 误报 | 人格/备份/语音库的路径穿越 | `sanitize` + 目录复检 + `safeJoinLibrary` 均安全 | ⚪ |
| 未覆盖 | `bridge.js` 约 1 万行只按重点段抽读；B站业务流、MCP 工具层未逐行 | 后续按需补审计 | 🟡 |

依赖侧：`npm audit --omit=dev` 当前 **0 个已知漏洞**（2026-10-22 实测）。

---

## 2026-10-26 全项目体检（架构 / 安全 / 残留）

审计方式：只读扫描 + 抽样精读（不复述"听说"），每一条都附复现命令或实测结果；
现有门禁 `npm run test:audit` **72/72**、`plugins/surfcore npm test` 全绿。

### 一、架构：分层是清楚的，问题集中在"最大单体"和"跨包耦合"

**合理的地方（有证据）**

1. **`src/` 是纯引擎层**：记忆卡、目的机制、对话收尾、token 额度、语音内核都是无宿主依赖的纯逻辑，
   被**桥接进程 / DSH 插件 / 独立工具**三方复用；插件侧只做宿主封装（`plugins/surfcore/lib/memory-card.js`
   是"唯一写卡者"，桥接只 append，避免并发覆盖）。这条边界写在文件头，也是这套代码最容易维护的部分。
2. **preset 是"源 → 生成物"单向流动**：`dsh/agent-presets/` 是权威源，`plugins/surfcore/presets/*.patch.yml`
   由 `scripts/build-agent-preset-patches.mjs` 生成，文件头写"请勿手工编辑"。设计是对的（只是门禁漏了，见 R26）。
3. **安全边界集中在前置关卡**，而不是散在每个端点：控制台在 153 条端点分支**之前**做 Host 白名单 →
   令牌定长比较 → `x-agent-call` 混淆代理防护 → 写操作强制 JSON/Origin。新增端点默认继承这套，不必逐条记得加。
4. **不可逆删除已被移除**：旧工作区清理改用 `_quarantine/`；本轮 `state/` 清理也用 `_backups/` + README。

**问题（按影响排序）**

| # | 问题 | 证据 | 判断 |
| --- | --- | --- | --- |
| A1 | `src/bridge.js` **14,964 行**单一文件，其中控制台是 126 条路径 / 153 个 `if (url.pathname === …)` 分支的同一条 if 链（约 2.5k 行） | `wc -l`；`grep -c "url.pathname ==="` = 153 | 🔴 全仓库最大单体，也是改动最容易出事的地方。**本轮没有动它**：这些分支共享上百个模块级状态，硬拆需要把状态收敛成 context 对象，属多日重构，不适合夹在体检里做。拆分第一步建议：先把"纯函数型"端点（读状态、算预览）抽成 `console/routes/*.js`，副作用端点留原地 |
| A2 | 插件 → 核心用**相对路径跨包引用**（12 个模块），且 `src/memory-card.js` 带 `?rev=20261025-pet-memory2` 缓存破坏后缀，**同一个 rev 字符串硬编码在 3 个文件里** | `grep -rn "?rev="` | 🟡 漏 bump = 热重载跑旧引擎（PITFALLS #68）；只 bump 一处 = 两个模块实例、模块级状态分裂。建议后续收敛成一个 re-export 壳 + 一条断言"3 处 rev 必须相同" |
| A3 | 双进程写同一份 `config.json`（插件设置页 / 桥接控制台），原子写但**无跨进程锁** | 两侧都是 tmp+rename | 🟡 R25，低概率丢一次修改 |
| A4 | 桌宠是**仓库外**独立工程，契约只有一个 `host.json`（`version: 1`），没有协议版本协商 | `plugins/surfcore/docs/PET.md` | 🟡 R24，单机可接受 |
| A5 | 配置默认值有**三层**：`store.js` 的 `DEFAULTS`、`config.example.json`（被 `readQqConfig()` 当默认层 deepMerge！不是纯文档）、各函数的 `??` 回退。`config.example.json` 缺 `chat` / `platforms.start` / `pet` / `tokenBudget` 四段 | `plugins/surfcore/lib/store.js:272 exampleDefaults()` | 🟡 功能没坏（各处都有 `?? {}` 兜底），但"模板即默认值"这层缺段会让新装用户看不见这些能力。修法要先定"哪一层是权威默认"，不宜顺手补 |

### 二、安全：入口级没有发现缺口，找到两个"藏在判据里"的真 bug

**已核实（不是听说）**

- 控制台：Host 白名单（用实际绑定端口，防 `evil.com:3100` 被当同源）→ `consoleToken` 定长比较 →
  `x-agent-call` 混淆代理防护（缺令牌的智能体调用不会升级成管理端全权）→ 写操作强制
  `application/json` + Origin。空令牌失败关闭。
- 插件 API：`connection.requestRejection` 前置；**实测**无凭据 `curl` 到 `127.0.0.1:<dsh>/dsh-surfcore/api/overview` → 401。
- 桌宠 API：回环 Host + 同源 + `x-pet-token`（24B 随机、`0600`）；**实测** `~/.dsh/surfcore/pet` 的 ACL 继承链只有
  `SYSTEM / Administrators / 当前用户`，没有 `Authenticated Users`。
- 路径：角色 id 走正则白名单；语音库走 `safeJoinLibrary`（含 `realpath` 二次校验挡 symlink 逃逸）；备份名走 `safeBackupName`。
- 命令执行：只有 `netstat` / `ss` 固定参数；全仓库无 `shell:true`、无 `eval` / `new Function`。
- 白名单空集：`allowAllWhenEmpty` 默认 `false`（空白名单 = 谁都不响应，而不是全放行）。

**本轮修掉（两条都在共享判据里，靠单测才现形）**

- R22 IPv6 回环判据是死代码（`split(':')[0]` 拿到 `[`）→ DSH 若绑 `::1` 会全量 403。
- R23 `timingSafeEqual` 对两个空串返回 true → 共享 `safeEqual` 改为空串 fail-closed。

**未修（报告）**：R25 配置双写；R24 桌宠协议版本；A1 bridge.js 拆分。
（R9 / R9a 已在第二轮修掉，见下。）

### 二·补、第二轮（用户要求"把问题都修了，且绝不影响核心/语音/桌宠"）

做法：**只做"行为等价或有新增断言证明"的改动**；会碰核心运行时的（A1 拆分、A5 默认层）明确不做。

| 修的问题 | 怎么保证不影响功能 |
| --- | --- |
| 隐私闸 fail-open（R9a，PITFALLS #74） | 只改扫描器的判据库；修完**新发现 3 条真命中**（证明修的是漏报，不是换说法）；`--strict` 0 命中 0 截断 0.5s |
| `?rev=` 三处硬编码（A2） | 只加 `test-core-rev-sync.mjs` 断言，**不动运行时** |
| 语音包默认源写死盘符（R28） | 改成相对仓库解析，`test-voice-packs-default.mjs` 断言解析结果 = 旧值；实测两条路径 `existsSync` 均 true |
| 桌宠 API 只有字符串级测试（R29） | 只加 `test-pet-api.mjs`（32 条），不改实现 |
| R9 的 36 处本机路径 | 只改文档/注释文字；示例里的联盟跟踪链接截断 |

---

### 三、残留：清掉 2.3MB，另有 3 处需要你拍板

| 项 | 处置 |
| --- | --- |
| `state/` 里 50 个一次性产物（21 个 `.mjs`、5 张 probe 截图、24 个审计日志、2 份 audit-result.json） | ✅ 已移到 `_backups/state-residue-20261026/`（含 README + 回滚说明）。**保留了**仍在写的 `bridge*.log`、`qq-activity.log`、`guard-patch.log` |
| `_backups/repo-cleanup-20261024/.wtest` | ⚪ 空文件，在备份里，无影响，未动 |
| `sts2-agent/`（杀戮尖塔 2 模组工程，4 个被跟踪文件，74K，`NOTES.md` 含 SteamID/用户名） | ✅ **2026-10-26 已移出仓库**到 `<工作区>\sts2-agent`（用户决定"暂时移除"）：文件不在仓库内，但 git 历史保留（`git show 22de2fa:sts2-agent/…`），随时可找回。迁移后 4 个文件逐个 sha1 与历史一致。⚠️ 插件里的 `plugins/surfcore/extensions/sts2/` 是**另一件事**（示例扩展空壳），未动 |
| 17 张被跟踪的 PNG（2.8MB），其中 6 张 `plugins/surfcore/docs/ui-*.png` 已无任何文档引用 | 🟡 是 `ui:shot` 的产物，可能还要重录；未动 |
| `logs/` 空目录、`state/bridge-restart*.err.log`（0 字节） | ⚪ 无害，未动 |
| 未跟踪 + 已修改文件（整个桌宠对话/目的/额度/收尾功能，含本轮新增 6 个文件） | 🔴 **建议尽快做一次检查点提交**；未代你提交 |
| `docs/FOLDER_MAP.md` 严重过期（还写 `qq-bridge/`、87 个脚本、缺 pet/token/http-guard） | ✅ 本轮已更新 |

### 四、本轮实际改动（可回滚）

1. `plugins/surfcore/lib/http-guard.js`（新）：设置页 API 与桌宠 API 共用的回环/同源/令牌/JSON 判据**唯一实现**；
   修 IPv6 死分支 + 空令牌 fail-closed。
2. `plugins/surfcore/scripts/test-http-guard.mjs`（新，31 条断言）+ `test-pet-api.mjs`（新，32 条行为断言），
   接进 `plugins/surfcore npm test`。
3. `scripts/test-agent-preset-patches.mjs` **登记进 `test:audit`**；新增 `npm run test:preset-patches`；
   重新生成落后的 `plugins/surfcore/presets/qq-chat-v2.patch.yml`。
4. `scripts/privacy-rules-lib.mjs`（新）+ `privacy-scan.mjs` 判据修复 + `--strict`/`incomplete`；
   `scripts/test-privacy-scan.mjs`（新）。
5. `scripts/test-core-rev-sync.mjs`（新）、`scripts/test-voice-packs-default.mjs`（新）；
   `src/voice-packs.js` 默认源改相对解析。
6. `state/` 残留隔离到 `_backups/state-residue-20261026/`。
7. 文档同步：本文件、`FOLDER_MAP.md`、`PITFALLS.md` #71–#74、`HANDOFF.md`、`ROADMAP.md`。

**怎么验证**：`npm run test:audit`（75/75）、`cd plugins/surfcore && npm test`、
`npm run test:preset-patches`、`npm run test:core-rev-sync`、`npm run test:privacy-scan`、
`npm run privacy-scan:strict`（应 exit 0）。


