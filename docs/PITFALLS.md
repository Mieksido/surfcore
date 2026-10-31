# 踩坑档案（PITFALLS）

> 目的：**半天后的我认不出自己做过什么**，所以每个坑都留「现象 / 根因 / 处置 / 怎么验证 / 怎么预防」。
> 新坑先加到这里，再改代码；只改代码不记坑 = 下次重踩。

---

## #1（2026-10-22，P0）一个坏会话日志让整个 workspace 服务起不来

**现象**
- DSH 打开后工作区列表全空，点「新建工作区」弹：
  `workspace create failed: gateway/service-unavailable: typert gateway: workspace/create: active Service "workspaceController" is unavailable`
- 启动日志里 `workspace` 插件报错，随后 `workspace-controller / session-controller / schedule / surfcore` 全部「未激活」。
- 用户侧观感像「所有工作区被清空」，但 `~/.dsh/storages/workspace.json` 里 7 个工作区记录完好。

**根因**
- `~/.dsh/sessions/--<盘符>-…-surface_core--/session-beed7291-.../session.v4.jsonl.zstd` 是「身份错位副本」：
  文件落在 `surface_core` 目录，但压缩帧里的头部 `cwd` 是 `surfcore`（改名/迁移时复制错位）。
- `@deepseek-ai/dsh-session-persistence-jsonl` 启动时 `list()` → `listArtifacts()` 逐条读头部，
  `assertStoredIdentity()` 发现「物理路径 ≠ 头部 cwd/id 推导出的路径」，**抛的是普通 `Error`**；
  而 `listArtifacts` 的 catch 只吞 `SessionFormatUnsupportedError` 和 `SessionPersistenceCorruptionError`。
- 于是这一个文件让 `list()` 整个 reject → `workspaceRegistry` 起不来 → 下游服务全在「等待依赖」。
- 依赖链：`workspace`（workspaceRegistry）← `sessionPersistence` ← `storageDomain`。任何一环抛错都会表现为「服务不可用」。

**处置（已完成）**
1. 把整个孤儿目录 `--<盘符>-…-surface_core--`（4 个会话，均未被当前工作区引用）
   `Move-Item` 到 `~/.dsh\_quarantine-20261022-122709\`（**只移动、不删除**）。
2. 给 `app.asar` 打字节级护栏：把该处 `throw new Error(...)` 换成 `throw new SessionPersistenceCorruptionError(...)`，
   让坏文件落进既有的「跳过损坏条目」分支。**等长替换**，asar 偏移/头部/完整性字段都不动。
   - 补丁脚本：`scripts/patch-dsh-session-guard.mjs`（`--check` / `--apply` / `--out`）
   - 自动换入：`scripts/install-session-guard.mjs`（`--prepare` / `--schedule` / `--watch` / `--install-now` / `--status`）
   - 功能验证（离线，不改本机）：解包 asar → 用 cordis 起 `sessionPersistence` → 把坏文件放进错位目录 → `list()` 不再抛错（0 条），
     正常目录的会话仍能列出（1 条）。
3. **一刀斩断遗留逻辑**：插件里「发现 `.legacy-workspace` 标记就删/移旧目录」的迁移代码**已整段删除**，
   `plugins/surfcore/lib/index.js` 不再对任何工作区目录做写/删操作（这是永久决定，别再恢复）。
4. **通用兜底（与 surface_core 解耦）**：新增 `scripts/check-session-integrity.mjs`（`npm run check:sessions`），
   扫 `~/.dsh/sessions`：会话目录名 ≠ 头部 id、项目目录 ≠ 头部 cwd、重复 id、不可读 → 全部报出；
   默认只读，`--quarantine` 只做 rename 隔离。已用它反证：隔离区里的旧文件会被精确报成
   「cwd=`surfcore` 却放在 `surface_core` 目录」。

**怎么验证（本机）**
```powershell
npm run check:sessions  # 应输出「✅ 没有发现身份错位/损坏」
npm run guard:check     # 应输出 status: patched
npm run guard:status    # 看 asar/guarded/meta
```
重启 DSH 后：设置 → 插件，`workspace` / `workspace-controller` / `surfcore` 应为已激活；工作区列表恢复。

**残余风险 / 下次注意**
- **DSH 升级会覆盖 `app.asar`，补丁消失** → 升级后第一件事 `npm run guard:check`，变 `unpatched` 就重打。
- 同一类还有两个「普通 Error」没改成 corruption（重复 session id、文件名版本与头部不符）：
  极端情况下仍可能让 `list()` 整体失败。补丁脚本目前只处理身份错位这一处。
- `app.asar` 在 DSH 运行中**不能改名/删除**（无 `FILE_SHARE_DELETE`），但**可以同长度原地写**：
  `--apply-in-place` 只改 95 字节、`fs.open(...,'r+')` 成功。别再只依赖「退出后换入」。
- 计划任务守候（`install-session-guard.mjs --watch`）实测被以 `0xC000013A`（Ctrl+C/控制台事件）终止，
  DSH 退出时没换成 —— 后台守候不可靠，优先原地写。
- 若 Electron 的 asar integrity fuse 被开启，改字节会导致启动失败；症状是换入后 Electron 读 asar 立刻报错，
  自动换入流程会冒烟失败并回滚。别跳过冒烟。

**证据**
- 隔离区：`~/.dsh\_quarantine-20261022-122709\`
- 配置备份：`~/.dsh\_fix-backup-20261022-122117\`
- 守卫日志：`state\guard-patch.log`、`state\guard-patch.json`

---

## #2（2026-10-22）pnpm 安装被「静默超时」终止，`node_modules` 烂尾

**现象**：profile 的安装日志出现 `pnpm printed nothing for 600000ms and was terminated`；
`@dsh-ops/pwsh-win32-x64` 被挪进 `.ignored`，活动依赖树里没有它。
**影响**：插件依赖可能缺件（本次排查确认 dsh-ops 的依赖与锁文件一致，属虚惊，但机制是真的）。
**处置**：发现安装被终止 → 先看 `pnpm` 日志与 `.ignored`，确认缺件再重装；不要带病重启。
**预防**：DSH 报「安装超时」时不要连点重试；先在 `~/.dsh/profiles/<profile>` 核对 `pnpm-lock.yaml` 与 `node_modules/.modules.yaml`。

---

## #3（2026-10-22）插件清理旧工作区用了 `fs.rmSync` 硬删除

**现象**：surfcore 日志出现「已清理旧工作区：<工作区>\surface_core」；目录直接消失。
**根因**：`plugins/surfcore/lib/index.js` 的启动自愈里用 `fs.rmSync(oldRoot, {recursive:true})`，
只靠目录里的 `.legacy-workspace` 标记判断「这是我们自己的旧目录」。
**风险**：标记被复制/放错位置，或用户往旧目录里放过东西 → 不可逆丢失。
**处置**：**整段删除**，插件不再有任何「启动时动工作区目录」的逻辑（不是改成隔离就够了——留着就有下一次误判的机会）。
**验证**：`node --check plugins/surfcore/lib/index.js`；`grep -r surface_core plugins/` 不应再命中代码；
`npm run test:audit` 全绿。

---

## #4 DSH 会把「已删除的工作区路径」重新建成空目录

**现象**：删掉 `<工作区>\surface_core` 后，DSH 下次用到该工作区时又建出一个空目录；
桥接按「会话 cwd 是否存在」投递提醒，于是连续投递失败。
**处置**：`node scripts/clean-dead-workspaces.mjs`（默认 dry-run）→ 确认后 `--apply`（先备份会话到 `_backups/dead-workspaces-<ts>`，再 archive + delete）。
**注意**：删除工作区是 DSH 语义操作，**必须先备份会话目录**；脚本已内置，别绕过。

---

## #5 DSH 端口会漂移，别硬编码

**现象**：README/旧代码写死 `127.0.0.1:3080`，实测网关在 `48994`，本次又在 `57981`。
**处置**：统一走 `discoverDshBaseUrl()`（`src/dsh-port.js`）或 `state/dsh-port.json`。
**注意**：401 是「服务活着但要鉴权」，不是故障；401 与 connection refused 要分开判断。

---

## #6 会话日志是 zstd，不是文本

**现象**：用 `Get-Content` / `grep` 读 `session.v4.jsonl.zstd` 会得到乱码，容易误判「文件损坏/为空」。
**处置**：要判断头部，必须解压第一帧（DSH 内部 `readFirstZstdLine`）；离线分析可用 Node + 解包出来的 `zstd` 解码路径。
**证据**：本次坏文件的头部判定就是解压后才看到 `cwd` 为 `surfcore`。

---

## #7 桥接只能跑一个实例

**现象**：消息重复回复/异常。**处置**：任务管理器确认只有一个 `node ...bridge.js`；`npm run stop`/`停止QQ机器人.bat` 收尾。
**预防**：`lib/bridge.js` 有 `lockPid`，但手工起的实例不受控，排障先数进程。

---

## #8 改了 preset / 插件 bundle，要重新生成并重启

**现象**：改了 `dsh/agent-presets/**` 或插件 `lib/`，DSH 里行为不变。
**处置**：preset 改动跑 `node scripts/build-agent-preset-patches.mjs`；插件改动需重启 DSH（或按 bundle 机制重新加载）。
**注意**：正在进行的 QQ 会话不会自动换 preset，需要 `session/reset` 或重启。

---

## #9 Windows 沙箱/ACL 类报错不是代码 bug

**现象**：`pwsh` 起不来，报 `Windows ACL temp root must be outside the workspace` 之类。
**处置**：换 `danger-full-access` 会话，或按 `diagnose-windows-sandbox-acl` 技能排查；**不要**在 workspace-write 里硬试写系统目录。

---

## #10（2026-10-22）停止脚本编码坏了 → 每次 DSH 换端口，桥接都卡在旧端口

**现象**：DSH 重启后插件日志出现「桥接还连着旧 DSH（57981 ≠ 43809），自动重启」→「停止脚本跑完了，但端口仍在监听」；
启动检查 `dshReady=false`；控制台/界面提示桥接不可用。

**根因**
1. 重写 `scripts/stop-qq-bot.ps1` 时存成了 **UTF-8 无 BOM**，而 `powershell.exe`（Windows PowerShell 5.1）按 ANSI 解码
   → 中文字符串的引号被吃掉 → 整个脚本解析失败（exit=1）→ 停不掉旧桥接。
2. 旧桥接还活着且连着旧端口，`start()` 看到端口已被监听就返回「already running」，重启流程假成功。
3. 附带 bug：`Stop-WithParent` 里用 `Write-Output` 打日志，函数返回值被 `$bridgeStopped = ...` 捕获，日志全丢。

**处置**
- 脚本改成**纯 ASCII**（从根上免疫任何编辑器/编码），并把函数内提示改成 `Write-Host`；
- `plugins/surfcore/lib/bridge.js` 的 `stop()` 增加兜底：脚本失败时按 `state/bridge.lock` 的 pid 直接结束；
- 插件增加 **2 分钟自愈轮询**（仅 QQ 启动开关 `platforms.start.qq` 开启时；旧字段 `bridge.autoStart`
  已由 `readUnified()` 迁移）：端口漂移会自动重启桥接，不再等用户发现。

**验证**
```powershell
powershell -File scripts\stop-qq-bot.ps1   # 应打印 "bridge: stopped pid=..."
# 然后让插件/手动以当前端口启动桥接：
curl -H "x-console-token: <state\console-token>" http://127.0.0.1:3100/api/status
# dshBaseUrl 应等于当前 DSH 端口，dshReady = true
```

**预防**：`.ps1` 一律纯 ASCII（或 UTF-8 **带 BOM**）；改完必须**真跑一遍**，不能只看语法解析。

---

## #11（2026-10-22）QQ 会话一直显示「运行中」：模型在同回合里循环 wait_for_messages

**现象**：三个 QQ 群会话在侧边栏长期「运行中」；日志里每 ~30 秒一步，事件序列
step/start → assistant/message → tool/call(mcp__snowluma__qq_wait_for_messages) → tool/result → step/end 反复出现。

**根因**：qq_wait_for_messages 每次都会正常返回（有新消息立刻返回 / 静默满足返回），
模型拿到结果后又决定再等一次；人格里「睡前先做一次观察」进一步鼓励了这种重复。回合不结束 → 一直算运行中，还烧 token。

**处置**（bridge 层硬限制，2026-10-22）：
- 同一会话连续**空等**（arrived=false）最多 2 次；第 3 次直接返回 stopped: true, reason: consecutive-wait-limit 并在 message 里要求收尾；
- 等待到新消息（arrived=true）就清零计数，正常「等回复」不受影响；
- 短等待（timeoutMs < 5s，测试/探针常用）不参与计数，避免挡掉「等待中权限被撤销」的 403 语义；
- 静默满足时响应带 shouldSleep: true + 
extStep，明确告诉模型去 qq_set_wake_config 收尾。

**验证**：
pm run test:wait、
pm run test:audit 全绿；桥接重启后 /api/status 仍 
eady=true。

---

## #12（2026-10-22）合并默认值后 `admin` 永远存在 → 空串把旧 `ownerQQ` / `owner.mid` 覆盖掉

**现象**：管理员卡片（QQ / B站 顶部同一份身份）在升级后应该自动带出旧的
`config.json ownerQQ` 与 `bili.config.json owner.mid`，实际却显示「未设置」；
如果在这个状态下点保存，还会顺手把两边的 owner 抹成空。

**根因**：`readUnified()` 用 `deepMerge(DEFAULT_UNIFIED, user)`，而 `DEFAULT_UNIFIED.admin`
带着空串默认值。于是合并结果里 `admin` **永远存在**，`adminFromSources()` 的
`hasOwn(admin,'qq')` 判定为「用户显式写了空串」，不再回退旧字段。
「默认空值」和「用户主动清空」被混成同一个状态。

**修法**（2026-10-22）：
- `readUnified()` 额外返回 `hasAdmin`（用户文件里是否真的写过 `admin`）；
- `readAll()` / `handleConfig` / B站 `adminBlockForBili()` 只在 `hasAdmin === true` 时
  才把 `admin` 当作显式值，否则传 `admin: undefined` 让旧字段兜底；
- 保存路径抽成纯函数 `projectAdminSave()`（`src/admin-identity.js`），
  用 `scripts/test-admin-identity.mjs` 钉住「正常保存不能把 ownerQQ/owner.mid 抹掉」。

**教训**：只要「默认值合并」后的对象参与 `hasOwn` 三态判断，就必须先知道用户文件里
有没有这个键；否则空串 = 清空 的语义会把升级兼容性全部吃掉。

**同轮第二个坑**：`src/bridge.js` 的 `loadConfig()` 不是「读文件后原样用」，而是**白名单式重建** `cfg`。
新加的 `admin` 字段如果只写进 config.json、没在 `loadConfig()` 里挂上，运行时会静默变成 `undefined`
（现象：管理员规则只认出 ownerQQ，B站 mid / 称呼全丢，且没有任何报错）。
→ 新增任何桥接配置字段，**必须同时改 `loadConfig()`**，并在 `test-admin-prompt-wiring.mjs` 这类
「用真实 bridge.js 源码跑」的测试里断言字段确实进了提示词。

---

## #13（2026-10-22）认人不能靠昵称：称呼必须落在 QQ 号 / B站 mid 上

**现象**：角色会把同一个人叫成「QQ 群名片上的名字」或「B站昵称」，用户觉得很尴尬；
人格卡里的「怎么称呼群友」表是手工维护的，昵称一改就对不上，甚至两个群友撞名。

**根因**：QQ 消息里虽然带着 `昵称(QQ号)`，但旧的对齐简报**只写昵称、不写 QQ 号**
（为了不在提示词里出现号码），于是模型只能靠会变的昵称匹配；B站 侧同理只靠 uname。

**修法**（2026-10-22，设置页「对齐」）：
- 对齐记录新增 `label`（称呼）：管理员填 QQ 号 + B站 UID + 称呼，以后两边都只用这个称呼；
- **只有设置了称呼的链接**才在 QQ 侧简报里带 QQ 号，并写明「这个号码只用来对发送者，绝对不要念出来」；
  没设称呼的链接保持旧格式（不带号码）——隐私姿态不变，功能按需放开；
- **只有一边也可以**：只有 QQ / 只有 B站 的人设了称呼后，会以「只在 QQ 登记过 / 只在 B站 登记过」的独立小节
  出现在对应一侧的简报里；没设称呼的单边记录不占提示词（保持旧行为）。
  之后补齐另一边时，`addLink` 会把同一 QQ / 同一 B站 的单边旧记录合并掉并继承称呼，避免同一个人两条记录、
  两个称呼在提示词里互相打架；
- 简报注入「称呼优先于人格卡『怎么称呼群友』表」的硬规则；B站 侧仍然**绝不出现 QQ 号/群号**；
- 保存后 `writeAlignmentBriefs()` 立刻重建两份简报：QQ 桥接按 mtime 重新读取，下一条消息生效；
  B站 每次醒来重读文件，不用重启。

**验证**：`scripts/test-align.mjs`（简报内容）+ `plugins/surfcore/scripts/test-align-label-api.mjs`
（真实 `/align` add/update、落盘、改称呼、清称呼、B站 不带 QQ 号）。

**教训**：凡是「认人」功能，键只能是平台 ID（QQ 号 / mid）；昵称只配做展示，不能做匹配。
另外，为了隐私而省略号码时，要区分「展示字段」和「匹配字段」——省略匹配字段等于让功能失效。

---

## #14（2026-10-22）记忆卡：两个进程写同一份 JSON / 测试 VM 缺新模块 / 原始消息先落盘

**现象 / 三个坑**：

1. **桥接与插件同时写记忆卡**：桥接每条消息都要记记忆，插件每 10 分钟整理；如果两边都 `read→modify→write`
   `memory-card.json`，后写的会把先写的整段覆盖（现象：刚聊完的话过一会儿消失，或容量统计跳变）。
2. **加了一个 bridge import，几十个测试一起 `ReferenceError`**：`scripts/audit-bridge-harness.mjs` 用 `vm` 执行
   真实 `bridge.js` 源码，靠注入上下文提供 import 绑定。桥接新 `import { resolveMemoryCardPaths } from './memory-card.js'`
   后，harness 没注入这个函数 → 所有走 harness 的测试在**模块顶层**就抛
   `ReferenceError: resolveMemoryCardPaths is not defined`（不是业务断言失败，很容易误判为「改坏了逻辑」）。
3. **inbox 直接落原始消息**：桥接如果把主人私聊原文先写进 `memory-inbox.jsonl`，插件再脱敏就晚了——
   密钥/手机号已经以明文躺在磁盘里。记忆卡比日志更敏感，因为最终会进提示词。

**修法**：

- **单写者**：插件宿主是唯一写卡者；桥接只 `appendMemoryInboxEvent()` 追加 `memory-inbox.jsonl`，
  **绝不读改写 `memory-card.json`**。桥接/调度器只读插件写好的 `memory-card-prompt-{qq,bili}.md`（mtime 缓存），
  文件是跨进程唯一契约。插件内部用 promise 链串行化维护/压缩/动作，写盘原子 rename。
- **harness 同步**：`scripts/audit-bridge-harness.mjs` 增加 `import * as memoryCard from '../src/memory-card.js'` 并 spread 进
  VM context；同时把 VM 里的 `process.env.DSH_HOME` 指向 fixture 临时目录，否则测试会往真实
  `~/.dsh/surfcore/memory/` 写 inbox。新增任何 bridge 顶层 import，都要检查 harness。
- **入库即脱敏**：`appendMemoryInboxEvent()` 在写盘前就调用 `redactForMemory()`（密码/token/手机号/证件号/链接），
  插件摄取时再脱敏一次。B站 的 `bili-memory.json` 本身已过 bili-memory 的隐私过滤。
- **告警峰值**：100% 自动压缩到 90% 后，`memoryCardStatus.level` 会变成 2；但用户仍应看到「刚满过」。
  `maintainMemoryCard()` 用 `peakLevel = max(压缩前, 压缩后)` 写 `alerts.level`，UI 用
  `max(status.level, status.alertLevel) > acknowledgedLevel` 判断是否弹窗。
- **别和「双向脱敏同步」混在一起**：`memory.js` 是 QQ⇄B站 的搬运（`qq-for-bili.md`）；记忆卡是**她自己的记忆**。
  两者都有容量/隐私逻辑，但数据、开关、文件完全不同；控制台里也分成两块，避免用户以为关掉同步就关掉了记忆。

**验证**：
`npm run test:memory-card`（评分/遗忘/压缩/容量/隐私/幂等）、`npm run test:memory-card-wiring`（接线）、
`cd plugins/surfcore && npm test`（含临时目录集成测试）、`node scripts/test-reply-wait.mjs`（harness 不再报错）。

**教训**：
- 跨进程共享 JSON 时，先定「谁是唯一写者」，再谈并发；文件契约（只读渲染块）比同时写 JSON 稳。
- 用 VM 跑真实源码的测试，**新 import = harness 也要改**；这类失败会一次红一片，先看第一行 ReferenceError，别急着回滚业务代码。
- 会进提示词的数据，脱敏必须在**第一次落盘前**，不能指望下游补救。

---

## #15（2026-10-22）全量记忆卡：归档必须在衰减前 / 绝不能生成 prompt / 坏文件备份只做一次

**现象 / 三个坑**：

1. **归档时机错了会漏档**：如果先跑每日衰减（甚至补跑 30 天）再归档，刚进衰减卡、创建时间很旧的记录可能在同一轮里
   直接走完 `清楚→模糊→印象→遗忘` 被删掉；全量卡再去复制就永远少这一条。
2. **“全量卡”很容易被顺手做成第二份常驻提示词**：只要给它写一个 `memory-card-prompt-full.md`，或者让桥接/调度器
   多注一段“完整记忆”，上下文会立刻爆炸，且与「平时只加载衰减卡」的产品约定冲突。
3. **坏文件/半行在只读轮询里反复触发备份**：全量卡统计文件损坏时，如果 `memoryCardStatusNow()`/控制台快照每次读取都
   `backupFile()` 一次，页面每 60 秒轮询就会在 backups 里堆一份坏文件，直到把磁盘撑大。
4. **把“10GB 上限”建在单 JSON 上**：每次维护 `readFileSync` 整份 JSON、改完再 `JSON.stringify` 写回；
   档案到几十 MB 就会明显卡顿，到 GB 级直接 OOM。上限只是把炸点推迟，不是真的支持。

**修法**：

- `maintainMemoryCard()` 里顺序固定为：**摄取 → `archiveDecayedToFull()` → 每日衰减 → 容量压缩 → 写输出**；
  pin/add/forget/compact/restore 这些绕过维护器的动作也各自先归档再改衰减卡。
- 全量卡**只写 `memory-card-full.jsonl` + `memory-card-full-stats.json` + 可选 `memory-card-full.md`，
  绝不生成任何 `*-prompt-*` 文件**；桥接/调度器源码里不出现 `MEMORY_CARD_FULL`。
  `test-memory-card-wiring.mjs` 用源码断言钉住这两点。
- **10GB 上限必须配 append-only 存储**：v2 改成一行一条的 JSONL，只 append、不整份读改写；
  容量按 JSONL 实际字节数算；md 只在档案 ≤ `fullMarkdownMaxBytes`（默认 5MB）时生成，否则写占位。
  否则「设 10GB」只是把炸点推迟到几十 MB。
- 全量卡超容量只改状态（`fullMaxBytes` 默认 10GB / 0=不限、`fullMaxRecords` 默认 0 / 不限 + `level`），
  不做任何自动删除/压缩；清理必须人工导出/备份后处理。
- 只读接口（overview / 快照 / 全量页）不迁移、不写盘；迁移旧 `memory-card-full.json` 只在维护写路径做。

**验证**：
`npm run test:memory-card`（全量卡在衰减后仍保留、归档在衰减前、召回）；
`npm run test:memory-card-wiring`（桥接/调度器不得引用全量卡）；`cd plugins/surfcore && npm test`（全量文件生成、forget 后仍可召回）。

**教训**：
- 「全量/底账」类数据要**先写后删**；任何清理动作之前都要问一句「另一份存了吗」。
- 两个卡并存时，最容易犯的错是“为省事把两张都注入”；必须用文件契约（一张有 prompt、一张没有）把边界做成结构性的。
- 只读接口不要有写副作用；备份这类动作放在明确的写路径里，否则轮询会把副作用放大。

---

## #16（2026-10-22）设置页输入框「没反应」：受控组件绑到了服务端快照，不是可编辑状态

**现象**：记忆页「衰减卡字数上限」输入框怎么点、怎么打字都没反应；看起来像前端坏了，或保存没生效。

**根因**：`MemoryCardPanel` 把 `value` / `checked` 绑到了 `/memory-card` 返回的**服务端快照 `data.config`**，
而 `onChange` 改的是父组件的 `unified.memoryCard`。输入一个字符后组件重渲染，`value` 又读回旧快照，
React 把输入框恢复原值 → 视觉上「完全没反应」。真正保存到磁盘的其实是 `unified`，但用户根本看不到自己输入了什么。

**修法**：
- 表单值一律从**可编辑状态** `unified.memoryCard` 取（再与 `data.config` 的默认值合并）；
- `maxChars` 用 `value: config.maxChars ?? ""` + 空串可编辑，避免 `Number("") = 0` 把输入框锁成 0；
- 保存路径 `saveUnified()` 里再跑一遍 `normalizeMemoryCardConfig()`，把 999999 收敛到 100000，
  避免「界面显示 999999、实际按 100000 算」的第二种“改了没生效”。

**验证**：重启 DSH 后在「记忆」页输入 `100000` → 输入框保持显示 → 点底部「保存」→ 容量条上限变 `100000`。
`npm run test:memory-card` 覆盖边界收敛；`npm run test:memory-card-wiring` 断言设置页有该输入框。

**教训**：受控表单的 `value` 必须来自**同一份可编辑状态**；服务端快照只能用于初始值/只读展示。
绑定两份状态时，用户看到的是「输入无反应」，而不是报错——这类 bug 只能靠真机点一遍发现。

---

## #17（2026-10-22，P0）19 位动态 id 被 JS 精度截断 → 动态回复记错账 / 挂错位置

**现象**
- 设置页「动态回复」四类全是 `0/10`，但 B站 上明明回过自己动态下的评论；
- 2026-10-22 14:01 回动态：脚本打印「✅ 已发布 rpid=9002495902967612」，B站 动态评论区却看不到这条；
- `quota.json` 把它记成「回找我的人」，不是「动态回复」。

**根因（三层叠加）**
1. 收件箱 `subject_id` 是 **19 位整数**（如 `1261813571425140745`），超过 JS 安全整数 `2^53-1`；
   `JSON.parse` 后变成 `1261813571425140700`（末几位丢失）。拿它当 oid 会 -404 或挂到错对象。
   实测：`Number('1261813571425140745') === 1261813571425140700`。
2. 新版转发动态的 `comment_type` 是 **17**，不是 11；`resolveLatestReply` 把非 11 一律当视频（type=1），
   `comment.mjs` 的自动识账也只认 `type === '11'`。
3. 收件箱的 `uri`（`https://t.bilibili.com/1261813571425140745#reply…`）是**字符串**，不丢精度；
   以前没人用它。

**修法**
- `lib/msgfeed.mjs`：优先 `idFromUri(uri)` 取精确 id；`subject_id` 只在 `Number.isSafeInteger` 时使用，
  否则留空（fail-closed，宁可不识账也不挂错）。
- `resolveLatestReply`：`business 11/17` 都按动态查（type=11/17）。
- `comment.mjs`：`--type` 接受 `1|11|17`；自动识账接受 11/17；`my-dynamics.mjs` 的 `comment_id_str` 直接对上。
- 唤醒/监听提示同步改成「带 --type 17 或 11；oid 用 comment-digest 打印的坐标，别手抄」。

**验证**
- `node scripts/test-msgfeed-oid.mjs`：19 位 id 从 uri 还原、不安全 id 留空、business 17 用 type=17。
- 真机：`comment-digest --hours 24` 的坐标应是 `type=17 oid=1261813571425140745`；
  `comment --oid 1261813571425140745 --type 17 --root … --parent … --auto --dry` 能过闸并显示「动态回复」账。

**教训**：B站 的 id 是 64 位整数；任何 `JSON.parse` 后的数字 id 都不能直接 `String()` 当真值。
有 `uri` / `*_str` 字段就用字符串字段。

---

## #18（2026-10-22）额度、四类动态、QQ 视频分享都没进设置页：不是保存失败，是 UI/API 从来没接

**现象**
- B站 页只能看到「分享 · 每天上限 3」，普通评论/回评/搭话/动态回复的额度、四类动态的时段、QQ 视频分享的 8 个时间点都看不到；
- 用户问「额度是多少、怎么设置页没有」，容易被误判成「保存丢了」。

**根因**
- 四本账 `FREE_LIMITS` 写死在 `tools/lib/free-gate.mjs`，**不接受配置**；
- `/api/bili/notify-config` 只回 `notify/listen/share/quota`，没有额度/动态；
- 四类动态是 `tools/lib/kinds.mjs` 常量；QQ 视频分享在**根 `config.json` 的 `biliBridge.share`**（桥接侧），
  B站 页只写 `bili.config.json`，两套配置源都没接 UI。

**修法**
- 额度搬进 `bili.config.json.limits`（新 `tools/lib/limits.mjs`，默认值与旧硬编码一致，越界 clamp）；
  `config()` 改成按 mtime 缓存，长驻调度器也能改完下一轮生效。
- 四类动态搬进 `dynamics`（`kinds.mjs` 提供 `kindsNow/normalizeDynamics`，`daily.mjs`/`scheduler.js` 都读配置）。
- B站 页新增「额度（代码闸门）」「四类动态」两组可编辑字段 + 「今天（只读）」卡片；
  B站 页底部新增「B站 → QQ 自动分享」，写 `biliBridge.share/dynamics`，保存后重启桥接。
- 新增只读快照 `GET /api/bili/automation`（`lib/automation.js`），用量口径复用 `usageToday()`。

**验证**
- `node scripts/test-bili-automation.mjs`：额度收敛、实时改配置后 `checkFree` 立刻拒绝、快照计数。
- `node scripts/test-client-contract.mjs`：B站 页确实暴露 9 个额度字段 + 四类动态字段 + QQ 分享字段。
- 真机：设置页 B站 页能看到「今天（只读）」和两组可编辑项；改额度保存后，下一次 `comment --auto` 按新额度拦。

---

## #19（2026-10-22）「最初」不是「重要」：只算主人、要确定性、多选合并前必须先归档

**需求**：「最初」= 最初接触的 30 天，且只和主人的互动有关；前 10 天最容易被标为最初，中 10 天适中、后 10 天降低、30 天后很小。
它和「重要」是两套判断；用户可指定一条或多条（多条合并成一个事件）为和主人初次相遇。

**三个容易做错的地方**：

1. **把「最初」塞进重要度**：如果按重要度阈值判最初，会出现「B站 高分视频被标成最初」「主人在第 40 天说的一句话因为情绪高被标成最初」。
   最初只看 `owner` + 首次主人互动起 30 天。
2. **概率每次刷新随机**：如果每次加载用 `Math.random()`，同一条记忆会时而是最初、时而不是，提示词和 UI 都跳变。
   改为按记录 id 做稳定散列（确定性抽签），同一张卡重复读取结果一致。
3. **多选合并先删后归档**：合并会把原记录从衰减卡移除；如果先删再归档，全量卡就少了这几条原始互动。
   顺序必须：`archiveDecayedToFull()` → `designateFirstMeeting()`（合并/标记）→ 再归档新事件。

**修法**：
- 记录字段：`initialTier` / `initialProbability` / `isInitial` / `firstMet` / `mergedFrom`；卡 meta：`firstOwnerAt` / `firstMetSource` / `firstMetAt` / `firstMetRecordIds` / `firstMetEventId`。
- `refreshInitialState()`：只遍历 owner；30 天窗口按 90% / 55% / 30% / 3% 概率确定性标记；非 owner 一律清空 initial 标记。
- 默认初次相遇 = 最早一条 owner 互动（pinned / 100）；`designateFirstMeeting()` 支持单条标记和多条合并；
  合并事件的正文保留每条日期+原文摘要，原记录从衰减卡移除（全量卡已保留）。
- 渲染独立分区：`## 初次相遇（和主人）` / `## 最初的日子（和主人）`，不和「重要」区混。
- 最初记忆有保护：`targetClarity` 最低「清楚」，不参与压缩/条数淘汰。

**验证**：
`npm run test:memory-card`（4 档概率、只算 owner、单条指定/多条合并/恢复自动、独立分区、不会被遗忘）；
插件集成测试（`set-first-meet` / `clear-first-meet`、`firstMet` 摘要）；`npm run test:memory-card-wiring`（UI/API 接线）。

**教训**：
- 一个概念只要名字像「重要」，就很容易被塞进重要度；**用户明确说“不是一套判断”时，必须单独建模、单独渲染、单独测试**。
- 「概率」在持久化系统里要可复现；确定性 hash 比随机更接近“命运感”，也更可调试。
- 合并/删除类操作，归档顺序永远是第一优先级。

---

## #20（2026-10-23）迁移脚本把自己锁在门外：重命名自己的 cwd = EBUSY

**现象**：双击那个一次性迁移 bat（`scripts/` 下，已随迁移完成删除），前置检查"通过"、备份也建了，最后一步
`fs.renameSync(旧仓库目录, <仓库根>)` 报 `EBUSY: resource busy or locked`。
脚本宣称"Nothing was changed"，实际上它**已经改完会话头和 workspace.json**：DSH 重启后 SurfCore 工作区直接报
`working-directory: directory does not exist: <仓库根>`，没法对话。

**三处根因**（对照实验确认，不是猜）：
1. **重命名自己的 cwd**：bat 里 `cd /d "%~dp0.."` 把 cwd 设成仓库根，再在那里跑 node，于是 node 去重命名自己的当前目录。
   同一个实验目录：cwd 在目录内 → `EBUSY`；cwd 在外面 → `OK`。
2. **顺序反了**：会话头 / workspace.json 在改名之前改，改名一失败就留下"索引指着新名、磁盘还是旧名"的半迁移状态。
3. **会话头匹配太窄**：只匹配带收尾引号的整串 `<旧仓库根>`，漏掉子目录 cwd
   （`<旧仓库根>\state\slang-agent`），所以 slang-agent 的 3 个会话头永远补不上；
   而且执行到 `profileDirs` 时会 ReferenceError（第 187 行用了第 197 行才声明的 `const`）。

**修法**：
- 收尾工具放在仓库外（临时目录 `_surfcore-migration-tools\`，迁移完成后已删除，教训留在这里）。
  它先做唯一可能被占用锁住的动作（仓库改名），失败就回滚 junction、**什么都不改**；其余步骤幂等，可反复跑。
- 迁移期间用 junction `新名 → 旧目录` 顶着，保证工作区随时能对话。
- 老 bat 的 `cd` 改到仓库的上一级（`%~dp0..\..`），避免再自锁。
- 桥接（`src/bridge.js`）的 cwd 就是仓库根，而 **DSH 退出后它常常还活着**（插件只在启动时 stop→start）。
  收尾脚本先确认 `state/bridge.lock` 里的 pid 确实是 `node + bridge.js`，再调用仓库自带的 `scripts/stop-qq-bot.ps1`
  （只停桥接、不关 SnowLuma），等进程真的退出（最多 12 秒）才继续改名。

**验证**：dry-run 打印「3 个待补丁会话头 / 109 个待改文本文件 / profile·junction 改动」；
`--apply` 在 DSH 仍运行时直接中止且不改任何东西；收尾后 `npm run check:sessions` + `npm run test:audit`。

**教训**：
- **任何"改名自己所在目录"的脚本必须从目录外运行**：`process.cwd()` 就是一把锁。
- 迁移脚本要么整体可回滚，要么把唯一会失败的步骤放最前面；"先改引用、最后改实体"是最坏的顺序。
- "前置检查通过"≠ 环境就绪：桥接进程的 cwd、脚本自己的 cwd 都可能是锁持有者，不能只看主程序退没退。

**补记（同日第二次尝试，EPERM 不是 EBUSY）**：改好 cwd 后再跑，报的是 `EPERM`，而且连试 12 轮（约 20 秒）都失败。
用对照实验把失败码一个个分离出来了：

| 情况 | 代码 |
|---|---|
| cwd 在要改名的目录里 | `EBUSY` |
| 目录里有**文件**被别的程序打开 | `EPERM` |
| 子目录里开着一个**资源管理器窗口**（目录句柄） | `EPERM` |
| 目标名刚被删掉（junction 刚 unlink） | 不影响，能改 |
| 给目录加 `Everyone:(CI)(DENY)(DC)` | 不影响（别被这条 ACL 带偏） |

真凶是第三条：一个资源管理器窗口停在 `<仓库根>\scripts`。
它持有的是**目录句柄**，所以「遍历目录树、尝试独占打开每个文件」的扫描收不到任何命中——
诊断因此一度误判成"有程序的 cwd 在里面"。

结论：`EPERM` 既可能是打开的文件，也可能是**停在目录里的资源管理器窗口**，还可能是 cwd 在子目录。
**不是权限问题**——这条工作区的 ACL 是 DSH 沙箱正常写入的（`Everyone:(CI)(DENY)(DC)` 与 `S-1-4-*` 都是预期项，别手改）。

收尾脚本因此做了三层：
1. 改名重试 12 轮（吃掉杀软/SmartScreen 这类短命句柄）；
2. 改名**之前**用 `Shell.Application` 列窗口，发现停在仓库里的就自己关掉（只关这些，其他窗口不动），
   `--keep-explorer` 可改成报错退出；
3. 仍然失败时，同时打印「打不开的文件」「仓库里的窗口」「命令行带路径的进程」，不再只打印一个自我匹配的探针。

---

## #21（2026-10-23）定时分享在设置页「看不到」：不是没做，是埋在最底部 + 默认折叠

**现象**：用户问「定时分享视频到群的那个，我在设置页里怎么看不到」。功能其实已经在
`plugins/surfcore/lib/client.js` 里接好了（2026-10-22 那轮），但翻 B站 页找不到。

**根因**（三件叠加，单看每件都不致命）：
1. `QqShareSection` 是 `BiliTab` 的**最后一个**节点，前面还有管理员卡、今天用量卡、搜索、
   凭证/待审卡片、9 组参数（含「额度」「四类动态」）—— 要滚很久才到；
2. 它 `defaultOpen: false`，到位置了也只看到一行标题；
3. 标题是「B站 → QQ 自动分享」，不含用户会搜的「定时 / 视频 / 群」；QQ 页没有任何指路。

**修法**：
- 挪到 B站 页**顶部**（今天用量卡片之后）、`defaultOpen: true`，标题改成
  「定时分享视频到群（B站 → QQ）」；
- 标题下加状态行（开关 / 今天最后一班 / 下一班 / 群数 / 卡片样式）和「立即分享一次」
  （插件 `/bili/share-now` 代理桥接 `/api/bili/share-now`，点之前 confirm，会真发群）；
- QQ 页加一张指路卡 +「去 B站 页设置」按钮（`goTab('bili')`）。

**验证**：`node plugins/surfcore/scripts/test-client-contract.mjs` 钉住标题、`/bili/share-now`、
`goTab` 和 `cardMode` 字段；真机截图看 B站 页首屏能不能直接看到。

**教训**：功能"接好了"不等于"找得到"。设置项的位置、默认展开、标题用词都算需求的一部分；
新面板至少要跑一次截图验收（`plugins/surfcore/scripts/ui-tabs.mjs`）。

---

## #22（2026-10-23）群友点分享卡片提示「小程序已下架」：appid 写死在 SnowLuma，桥接改不了

**现象**：定时分享发到群里的 B站 视频卡片，点击后 QQ 显示「小程序已下架」。

**根因**：
- 卡片走的是 SnowLuma `get_mini_app_ark`（`type: 'bili'`）。翻它的源码（`SnowLuma2/app/index.mjs`
  的 `MiscApi.getMiniAppArk`）可以看到 appid **写死**成 `1109937557`（B站小程序），
  只支持 bili / weibo 两个硬编码值，没有任何参数能换 appid；
- B站小程序在 QQ 侧已下架，于是「ARK 生成成功 → 消息发出去 → 点开报已下架」。
- 之前的降级只在 **ARK 生成失败** 时触发；生成成功但点不开的情况永远降不到链接卡。

**修法**：
- 默认改成 `com.tencent.structmsg` 的 `view: 'news'` 链接卡（新模块 `src/bili-card.js`
  自己拼 ARK），点开进浏览器/APP，不依赖任何小程序；
- `biliBridge.share.cardMode` 三态：`link`（默认）/ `miniapp`（opt-in，确认恢复再用）/ `off`；
  旧字段 `card: false` 仍等价于 `off`，`card` 保留为派生值；
- 链接卡失败 → 退 SnowLuma `share` 段 → 再失败返回 false（AI 正文会带链接）；
- 设置页把「先发视频卡片」开关换成「卡片样式」下拉，并在 QQ 页/README 写清原因。

**验证**：`node scripts/test-bili-card-ark.mjs`（钉住：旧 `card:true` 必须落到 link、
link 模式**不得**调用 `get_mini_app_ark`、miniapp 失败要退链接卡、全失败返回 false）；
真机在群里点一次卡片确认能打开。

**教训**：
- 第三方"现成卡片"接口返回 `ok` **不等于用户能点开**；卡片类能力必须真机点一次。
- 写死第三方 appid 的能力，迟早会随对方下架失效；默认路径要选自己能控制的那条。

**补记（同日 06:05，结论被推翻一半）**：B站小程序**没有下架**——用户更新小程序资源后，
B站官方 App 分享的同一张卡能正常打开。真正的问题是 SnowLuma 生成的那张卡
`url` 无效、且**任何字段都不能改**（改了 QQ 静默丢消息）。详见 #24；
生产默认已改成纯文本链接，小程序卡只作 opt-in。

---

## #23（2026-10-23）「立即分享一次」点了没反应：POST 没带 application/json，桥接 415

**现象**：设置页点「立即分享一次」，群里没有新消息；只有一闪而过的 toast，桥接日志里
连一行 `[B站分享]` 都没有，看起来像「按钮根本没接上」。

**根因**（两层，缺一层都不会出这个现象）：
1. 插件代理写的是 `callBridge('/api/bili/share-now', { method: 'POST' })`，**没传 body**；
2. `callBridge` 只在有 body 时才加 `content-type: application/json`，而桥接控制台对**所有写操作**
   强制 JSON（CSRF 防护，`src/bridge.js` 的 415 分支）→ 桥接回 `415 请求必须是 application/json`
   → 代理翻成 502 → `fireNow()` 一次都没跑。

**修法**：
- `plugins/surfcore/lib/bridge.js` 的 `callBridge`：非 GET 一律带 `content-type: application/json`，
  没参数时发 `{}`（空参数 ≠ 没有请求体）；
- `share-now` 代理显式 `body: {}`，并把结果写 `plugin.log`（`bridge=… ok=… sent=…`）；
- UI 不只用 toast：按钮下面常驻一行 ✓/✗，失败原因不会被划过。

**验证**：
- `plugins/surfcore/scripts/test-bridge-status.mjs`：断言 POST 带 JSON 头且 body 为 `{}`、GET 不带 body；
- `scripts/test-bili-card-ark.mjs`：源码断言代理必须带 `body: {}`；
- 真机：直接以 JSON 调桥接 `/api/bili/share-now` → `05:51` 三个群各发一张卡 + 角色短评；
  SnowLuma 当天 `get_mini_app_ark` 调用数为 **0**，证明发的是新的链接卡而不是小程序卡。

**教训**：跨进程/跨 HTTP 边界时，「空参数」要显式发一个空对象；CSRF 防护型接口尤其如此。
失败路径必须留下**能定位到哪一跳**的日志，别让「没反应」成为唯一现象。

---

## #24（2026-10-23）这个发送端发不了任何链接卡片：structmsg 被换成「版本过低」，小程序卡点开「已下架」，改字段会被静默丢弃

**现象**：05:51 的定时分享把卡片换成 `com.tencent.structmsg` 后，群里显示
「**发送者版本过低，无法展示内容**」；此前的小程序卡片则点开「**小程序已下架**」。

**穷举过的路（都有真机/协议证据，别再重复试）**：

| 尝试 | 结果 |
| --- | --- |
| `com.tencent.structmsg` news（ver `0.0.0.1`） | QQ 显示「发送者版本过低，无法展示内容」 |
| 同上，ver 改 `1.0.0.19` + 带 token 的 config | **消息被 QQ 静默丢弃**（`send` 返回 ok，但历史里没有） |
| 同上，去掉 ver | 仍是「发送者版本过低」 |
| SnowLuma 原生 `share` 段（最简 structmsg） | 仍是「发送者版本过低」 |
| `get_mini_app_ark` 原样发（B站小程序卡） | 卡片能显示，点开「小程序已下架」 |
| 同上 + 注入 `qqdocurl` / `scene: 1036`（抄官方分享卡的字段） | **消息被 QQ 静默丢弃**，私聊历史里查不到 |
| 纯文本「标题 + 链接」 | ✅ 正常显示、链接可点 |

关键发现：
- **B站官方 App 分享到 QQ 的卡是能用的**（用户实测：点开提示更新小程序资源，更新后正常）。
  它带 `qqdocurl`、`scene: 1036`、官方 icon，并且 `url` 是 B站 App 通过 QQ SDK 签出来的；
- 但 **`get_mini_app_ark` 原样返回的 ARK 不能被改任何一个字段**：改 `ver` / `config` / `scene` /
  `qqdocurl` 后，QQ 服务端直接丢弃整条消息（`message_id` 都照常返回，历史里却不存在）；
- 不改字段的 ARK，`meta.detail_1.url` 指向的小程序页面又是无效的 → 点开提示「小程序已下架」。
  （B站小程序本身没下架，用户更新资源后官方卡能正常打开。）

**结论**：以 SnowLuma 这个发送端的身份，**没有一条能自动生成、可点击的 B站卡片**：
- 卡片要能显示 → 只能原样发 `get_mini_app_ark`，点开是坏页面；
- 想改页面/加 qqdocurl → QQ 静默丢消息；
- 想自己拼 structmsg → 版本门。

**修法**：默认改成**纯文本分享**「【B站】标题 + 链接」（`share.cardMode = 'text'`），
任何 QQ 都能显示、链接可点；小程序卡保留 opt-in（`miniapp`）并注明点开会提示已下架。
`normalizeCardMode` 把旧值 `card:true` / `cardMode:'link'` 都收敛到 `text`。

**验证**：
- `scripts/test-bili-card-ark.mjs`：默认发的是 `text` 段（含标题+链接），不发 json、不调小程序接口；
- 真机：私聊/群里的纯文本分享正常；卡片的各种变体见上表（05:57–06:05 实测）。

**教训**：
- 「卡片发不出去」不一定是 JSON 写错：对端会**换字**（版本过低）或**静默丢消息**，
  必须用 `get_friend_msg_history` 核对“服务端到底有没有存下来”，不能只看 `send` 返回 ok；
- 第三方发送端能生成的卡片是**签名过的整包**，改字段等于改签名 → 丢弃；
- 用户要的是“点得开”，不是“长得像卡片”。做不到卡片时，纯文本链接是正确答案，要早点认。

---

## #25（2026-10-23）DSH 热重载插件不会清 `src/` 的 ESM 缓存：桥接已改，设置页还报旧模式

**现象**：分享形式从 `link` 改成 `text` 后，桥接重启已生效（群里发的是文本），
但设置页 `/bili/automation` 一直返回 `cardMode:"link"`，下拉框和实际行为对不上。

**根因**：插件宿主和 DSH 在**同一个 Node 进程**；`plugin_manager` 的 off→on 只重新求值
插件目录内的文件。`plugins/surfcore/lib/*.js` 用相对路径 import 的 `src/bili-card.js`
仍命中 Node ESM 缓存（同一个 URL 不会重新求值），于是插件跑的还是旧 `normalizeCardMode`。

**修法**：纯逻辑拆到新文件 `src/share-mode.js`（`normalizeCardMode` / `buildBiliShareText`），
插件改为 import 新路径 —— 新 URL 才能绕过缓存；`src/bili-card.js` re-export 它，
桥接侧仍然只有一个入口。

**验证**：插件热重载后 `/bili/automation` 的 `cardMode` 从 `link` 变 `text`，`/config` 一致；
`test-bili-card-ark` / 插件测试 / audit 全绿。

**教训**：改了**被插件 import 的 `src/` 文件**，要么改文件名/路径，要么重启 DSH。
只验证桥接生效会漏掉设置页（桥接是独立进程，重启就新了；插件没有）。

---

## #26（2026-10-23）产品代码里写死作者的角色名/主人名：设置页、提示词、默认值一起泄漏

**现象**：设置页的分享说明、记忆卡标题和「初次相遇」按钮出现作者自己的角色名/主人名，
B站 分享/搭话提示词也写「用某角色的口吻」；别的用户装上去不知道这是谁，换了自己的角色卡也改不掉。

**根因**：把**个人身份**当成了产品常量：
- UI/提示词模板直接写角色名与主人名，没有走配置/角色卡；
- `persona.file` 默认写死某一张卡（如 `roles/<某个角色>.md`），B站 昵称/主人昵称的回退值也写死；
- 记忆卡规格（`# <账号名>的记忆卡`、`## 和<主人名>（主人）`）把名字混进了**结构性标题**。

名字只应该存在于**用户数据**里：角色卡（`roles/*.md`）、记忆卡/运行状态（`~/.dsh/surfcore/memory/*`、`state/*`）、
以及用户自己的 `config.json`（`admin.displayName` / `bili.owner.name` / `self.name`）。

**修法**：
- UI 与提示词一律用通用称呼：「角色 / 主人 / 管理员 / 你」，不再拼具体名字；
- B站 侧需要名字时只读配置：`bili.config.json` 的 `self.name` / `owner.name` / `persona.name`；
  主人昵称替换（`redactOwnerName`）也改成配置驱动，删掉写死的 B站昵称；
- `persona.file` 默认留空 → `resolvePersonaFile()` 依次找配置路径、`roles/角色卡.md`、`roles/*.md`；
- 记忆卡标题改成 `# 记忆卡` / `## 和主人（管理员）...`；`looksNoteworthyMessage` 的角色名由调用方传入；
- 测试 fixture 不再用真实角色名/账号名/QQ 号。

**验证**：
全仓 grep 具体角色名/主人名，只应命中角色卡/运行数据；
`npm run test:audit` 42/42、`npm run test:regressions` 16/16、插件 `npm test` 全绿。

**教训**：凡是会出现在 UI、提示词模板、默认配置里的「专有名词」，先问一句
**这是产品词还是某个用户的数据？** 是数据就只能从配置/角色卡/记忆卡读，代码里连回退值都不该写具体名字。

---

## #20（2026-10-23）多选「合并为一个事件」：不是「设为初次相遇」的复刻

**现象/需求**：多选其他记忆时只想合并成一个事件，方便之后置顶；不是每次都想改初次相遇。

**修法**：
- 新增 `mergeMemories(card, ids, { title, pinned })`，和 `designateFirstMeeting()` 完全分开：
  - 合并选 ≥2 条任意记录 → 1 个普通 `event`（不是 `firstMeet`）；
  - 默认置顶（UI 有「合并后置顶」复选框，默认开）；可取消；
  - 保留每条日期+正文摘要，标题可自定义，默认第一条标题；
  - 继承最高重要度；**混合 QQ/B站 时 scope 收紧为 `qq`**，且不继承 `owner` 标签（避免把 QQ 私事带进 B站）；
  - **不能合并 `firstMet` 记录**：否则初次相遇 meta 指向已删除记录，刷新会回退到最早一条，用户会以为“初次相遇丢了”；
  - 不改变 `firstOwnerAt` / `firstMet` / `initial`。
- 合并前必须先 `archiveDecayedToFull()`：原记录随后从衰减卡删除，但全量卡保留。
- UI 复选框从「只给 owner」改为**所有记录**；「设为初次相遇」按钮在选中含非 owner 时禁用，避免用户点了才报错。

**验证**：`test-memory-card`（合并普通/混合 scope/默认置顶/拒绝 firstMet/不改变初次相遇）、
`test-memory-card-api`（真实动作）、`test-memory-card-wiring`（UI/API 接线）。

**教训**：「合并」和「初次相遇」共享“多选”交互，但语义不同；**动作要拆开，不要在一个按钮里猜用户想干什么**。
多选合并类操作永远先归档、再删原记录；混合来源时 scope 只能收紧、不能放宽。

---

## #27（2026-10-23）置顶了却排在 100 分后面 / QQ 记忆只有主人一半

**现象**：
1. 合并事件已经显示「置顶」，但列表里仍排在一个重要度 100 的未置顶记忆后面；
2. QQ 记忆里只有主人的发言，没有角色自己的回复。

**根因**：
1. `memoryCardSnapshot()` 只按 `importance desc` 排序；`pinned` 只是标签，没有参与排序。
2. 桥接只把**入站**消息写进记忆 inbox；AI 的出站消息（v1 `auditAndSend`、v2 `sendMessagesV2`）没有落库，
   所以记忆卡只有对话的一半。

**修法**：
- 快照排序改为 **初次相遇 → `pinned` → 重要度 → 时间**；初次相遇永远第一，置顶事件即使 80 分也排在未置顶的 100 分前面。
- 桥接新增 `recordSelfMemoryEvent()`：v1/v2 成功发送后写 `isSelf` 行；v2 多段回复合并成一条文本再记。
- 记录新增 `botReply` / `isSelf` / `conversationKey`；`ingestInboxLines()` 优先把她的回复并进最近一条未回话的主人记录
  （30 分钟窗口，按 `conversationKey` 匹配）；找不到对应主人才生成 `qq-self` 记录。
- 渲染显示「→ 她回：…」；列表显示「她自己说的」chip。
- 系统提示（⚠️/⏳/⏹️/❓/🔐 开头）不记，避免把报错当发言。

**验证**：`test-memory-card`（一问一答合并、self 独立记录、置顶排序）、`test-memory-card-api`
（置顶优先于未置顶 100 分）、`test-memory-card-wiring`（v1/v2 都接了 `recordSelfMemoryEvent`）。

**教训**：`pinned` 是**排序第一优先级**，不是徽章；凡是“记忆只有一半”的问题，先查出站路径有没有落库。

---

## #28（2026-10-23）QQ 白名单早就存在，但只藏在折叠的「白名单与权限」组里

**现象**：用户问「群和人的白名单要可以在设置页显示并设置」。
`allow.groups` / `allow.private` 其实一直可编辑，但它在 QQ 页几十个高级参数里，
默认折叠、标题也不含「群号/QQ 号」，看起来像没有。

**根因**：安全边界里最常用的两个字段被当成普通参数，埋在 `Section` 折叠组里；
没有计数、没有空名单解释、管理员不在私聊白名单时也只提示「去某处」，没有直达操作。

**修法**：
- QQ 标签页顶部新增常驻卡片「QQ 白名单（群 / 人）」：
  - 群 / 人分两栏，逗号分隔输入 + 实时计数 + chip 单个删除；
  - 管理员 QQ 在私聊白名单里高亮「管理员」；缺失时直接警告并给「把管理员加进去」按钮；
  - `allowAllWhenEmpty` 也放在卡里，开启时红色警告；
  - 空名单给出后果说明（群不响应 / 私聊全拦），不用用户猜。
- 原来折叠组改成「黑名单（高级）」，只保留 `deny.*` 与安全拦截通知，避免两处输入框。
- 输入框用本地草稿 + 每次按键同步解析结果，解决旧 `list` 字段「逗号一输入就消失」的编辑问题。

**验证**：`test-client-contract`（卡片存在、绑定 allow.*、黑名单仍在、白名单不再出现在折叠组）；
`ui-tabs.mjs` 真机截图（QQ 页顶部可见卡片，群 3 / 人 12，管理员 chip 高亮）。

**教训**：安全边界字段不能只求「代码里有」，要按“用户能不能找到、能不能当场修”来排位置。
常用 + 高风险的设置放顶部常驻卡片，低频参数才进折叠组。

---

## #29（2026-10-23）换角色只换人格卡 = 新角色继承旧角色的记忆/额度/日记

**现象**：切换角色后，新角色的人格卡变了，但 B站 当天额度、看过的视频、日记、分享排期还是上一个人的；
甚至同一天已经发过的评论/动态会被新角色“再走一遍”。

**根因**：人格卡只是一个文件，而记忆卡和 B站 行为账本全是全局路径：
`~/.dsh/surfcore/memory/*`、`~/.dsh/surfcore/bili/*`、`repo/state/bili-*`。桥接/调度器的 DSH 会话也是固定的
（`bili-whale`），旧人格上下文会在切换后继续存在。

**修法**：
- 每个角色一个目录包：`characters/<id>/`（人格卡 + `memory/` + `bili/` + `snapshots/`）；
- `characters/current.json` 是唯一真相（含 `epoch`）；所有进程在任务开始时解析一次，只写自己捕获的那份；
- `tools/lib/state-paths.mjs`：行为账本走 `biliState()`，cookie/表情包/ffmpeg 走 `accountBili()`；
- 切换序列：等记忆卡链清空 → 停 B站 调度器并 cancel 旧会话 → reset/停 QQ 桥接 → 拍 `before-switch` →
  写 `current.json`（epoch+1）→ 归档 `sessions.json`/`social-v2.json` → 生成新 prompt → 重启桥接/调度器；
- B站 会话 id 带角色 id；工具进程按当前角色解析路径，所以即使旧命令晚到，也只会写旧角色账本；
- 迁移旧数据时额外把 `repo/state/bili-share-state.json` / `bili-share-history.json` 拷进角色包，
  避免同一天重发分享；动态基线不拷（空基线不会重放旧动态）。

**验证**：
`test-character-store`（A/B 记忆 + quota 隔离、epoch、快照回档、迁移）、`test-bili-state-paths`
（真跑 `quota status` 读角色账本、cookie 仍走账号目录）、`test-character-api`（新建/加载/存档/回档/删除）、
插件 `npm test` + `test:audit`。

**教训**：人格不是“一个提示词文件”，是一整套**人格 + 记忆 + 行为账本 + 会话**。
只要其中任何一项还是全局的，换角色就会串；先列隔离矩阵，再逐个改成按角色解析。

---

## #30（2026-10-23）「点赞没反应」不是点赞坏了：游客态评论只回 0~3 条，测试还把假失败写进了真状态

**现象**：用户问「小肥鱼到底能不能真的点赞」。设置页没有失败记录，`fish-guard.json` 的 `liked` 永远是 `{}`，
但 `likeBlockedUntil` 有时会冒出来；`fish-guard plan` 在 84 条评论的视频上只报 `totalSample: 3`、`fishTopLevel: 0`。

**根因（两层）**：
1. **采样没带登录态**：`tools/lib/fish-guard.mjs` 的 `getJson()` 只发 `user-agent/referer/accept`，没有 cookie。
   B站 游客态 `/x/v2/reply` 只返回 0~3 条「可见评论」；40 条样本、鱼识别、点赞目标全都拿不到。
   所以“点赞”不是 API 坏了，是**根本没识别到该赞哪条**。
2. **测试污染真实状态**：`likeFishComments()` 默认写 `biliState('fish-guard.json')`，离线测试用假
   `fetchImpl` 返回 `-509`，却没传临时 `stateFile` → 假失败被写进真实角色状态，看起来像“真被风控了”。

**修法**：
- `getJson / fetchCommentSection / fetchReplies / planFishGuard` 全部接受 `cred`，带
  `SESSDATA + bili_jct + buvid3`；`comment.mjs --auto` 和 `fish-guard status|plan|like` 都传登录态。
- `status/plan` 输出 `loggedIn`；`fishGuardStatusText` 未登录时明确写「⚠️ 未带登录态（样本会很少）」。
- `likeFishComments` 增加 `stateFile` 参数（默认真实文件，测试必须传临时文件）；写 `likeFailed`、
  `lastLikeRun`、`likeBlockedUntil`，失败带 code/message。
- 点赞之间随机 1.5~4s、发完评论默认等 12s 再点、同一 rpid 失败冷却 24h。
- 设置页 B站 顶部新增「鱼群保护 · 运行状态」：今天点赞 / 上次结果 / 失败 code / skipped 原因 / 风控冷却。
- 清理被测试污染的 `likeFailed: {"9": -509}` 与 `likeBlockedUntil`（先备份到
  `~/.dsh/surfcore/backups/fish-guard-testpollution-*.json`）。
- 顺手修 `debrief` 的参数解析：`--no-frames` 放在末尾时旧写法 `argv[++i]` 越界取到 `undefined`，
  于是 5 条初筛仍然下载视频 + ffmpeg 抽帧；现在裸旗标一律按 `true`。

**验证**：`test-fish-guard`（新增 cookie header 断言、`extraFishMids`、失败落临时文件）、
`test-watch-history`（新的观看历史）、真实 `fish-guard plan --bvid BV1jhn16GEcv` 从 `totalSample: 3` 变成
`40` 且识别出 14 条鱼、4 个点赞目标；再真点 1 条：
`fish-guard like --bvid BV1jhn16GEcv --max 1` → `liked:["321564184096"]`、`dailyLikes:1/6`、无风控；
回读该评论 `like` 0→1、`action:1`。

**教训**：
- “只读接口不需要登录”是危险的默认假设；先验证游客态返回条数，再谈阈值。
- 任何会落盘的状态函数都要能注入路径；测试不隔离 = 生产状态被污染，而且**看起来像真实故障**。

---

## #31（2026-10-23）定时醒来的 B站 会话「有工具却一条命令都跑不了」：cwd 不满足 WRITE_OWNER，审批又没人批

**现象**：08:00 生物钟叫醒后，`bili-whale-char-mvk6wth4` 的日志停在
`permission/preset=workspace-write`、`sandbox/mode=workspace-write`、`approval/policy=ask`，
第一条 `ops_bash` 就报：
`Workspace preparation failed: ... needs WRITE_OWNER ... use danger-full-access`。
随后 agent 申请完全访问，`approval/asked` 一直没人批；DSH 重启后变成 `approval/decided: cancelled`，
整轮什么都没做。

**根因**：
1. 调度器用 `ctx.sessionController.create({ sessionId, cwd: os.homedir() })` 建会话，默认走 workspace-write；
   `%USERPROFILE%` 不满足 DSH 沙箱的 `WRITE_OWNER` 前置条件，命令根本起不来。
2. 设置页/agent 申请 `danger-full-access` 需要人工审批，而定时唤醒时通常没人在电脑前 → 整轮挂起。
3. 自己写自动切换时还踩了一个 Cordis 坑：插件没 `inject` 的服务，直接读 `ctx.sessions` / `ctx.permissionPresets`
   会**抛异常**；`ctx.sessions ?? ctx.get('sessions')` 因为左边先抛，右边根本不会执行。

**修法**：
- `tools/lib/config.mjs` 的 `DEFAULTS` 增加 `agent.sandbox`，默认 `danger-full-access`；
  设置页 B站 页新增「B站 会话权限」下拉（可改回 workspace-write），只影响 `bili-whale-*` 这一个会话。
- `lib/scheduler.js` 导出 `applySessionPermission()` / `applySessionPermissionTo()`：
  - 先 `try { ctx.sessions } catch`，失败再 `ctx.get('sessions')`；presets 同理；
  - 用 `ctx.permissionPresets.current(session)` 判断，`set(session, target)` 写入；
  - 在 `ensureSession`、每次 tick、`session/created` 事件三处校正（事件监听在 stop 时释放）。
- `lib/index.js` 新增 `POST /bili/session-permission`：先 `sessionController.inspect` 挂上会话，再切权限；
  设置页状态卡加「修复会话权限」按钮（`ui-bili.png` 可见）。
- 会话语义：`danger-full-access` 同时把 approval 变成 `never`，定时任务不会再等人批。

**验证**：
- 真机调用 `POST /bili/session-permission` → `{ok:true, changed:true, current:"workspace-write", target:"danger-full-access"}`；
- B站 会话日志新增 `permission/preset: danger-full-access`、`sandbox/mode: danger-full-access`、`approval/policy: never`（seq 45~47）；
- 设置页截图 `ui-bili.png` 出现「修复会话权限」按钮；
- `test-scheduler-permission`（含「直接读 ctx.sessions 会抛，必须回退 ctx.get」用例）+ audit **47/47**。

**教训**：
- 「工具已经装上」≠「她能跑工具」；会话权限/沙箱是**前置条件**，定时任务尤其要自己保证，不能指望半夜有人点审批。
- `ctx.sessions ?? ctx.get(...)` 这种写法在 Cordis 里是错的：未 inject 的服务属性读取会抛，必须分开 try。
- 自动提权是安全敏感动作：只对 `bili-whale-*` 一个会话、写进配置、日志留痕、可一键改回。

---

## #32（2026-10-23）QQ 鱼群保护只写活动日志：设置页看不到「刚才为什么没说话」

**现象**：群里鱼刷屏时她确实闭嘴了，但设置页只有参数，没有“最近触发过几次、哪个群、什么原因、保护到什么时候”；
桥接重启后连 `fishGuard` 冷却都丢了。

**根因**：
- `evaluateConversationFishGuard` 只把当前冷却写进内存 state，`saveSocialV2State()` 的固定字段列表里**没有**
  `fishGuard` / `lastFishGuard` / `fishGuardBypass`，所以重启即失忆，也没有历史记录给 UI。
- 设置页只能读 `social-v2.json`，没有可展示的触发日志。

**修法**：
- `evaluateConversationFishGuard` 在新一轮触发时向 `state.fishGuardLog` 追加
  `{at, groupId, groupName, reason, fishCount, fishMessages, totalMessages, fishRatio, consecutiveFish, until}`，
  每群最多 30 条；当前冷却/直呼放行/最近一次也纳入 `saveSocialV2State` 的保存与加载。
- 新增 `lib/qq-fish-guard.js` 纯函数 `summarizeQqFishGuard(data, {now})`：
  合并 `fishGuardLog` + 当前 `fishGuard` + `lastFishGuard`，按 key+时间+原因去重（active 优先），补群名，按时间倒序。
- 新增 `GET /fish-guard/qq`；QQ 页顶部新增「QQ 鱼群保护 · 最近触发」卡（`ui-qq-fishguard.png`）。
- 修 `chat` / `reserved` 模式直呼放行：接收侧放行后把 `fishGuardBypass` 写进 state，发送侧才不会因 unread 已读又拦。

**验证**：`test-qq-fish-guard`（空数据/多群/active 优先/去重/已过期冷却/不混杂私聊）、`test-fish-guard`、
`test-host-smoke` 的 `/fish-guard/qq`、真机截图 `ui-qq-fishguard.png`（空状态与规则行可见）。

**教训**：保护类功能必须能回答「为什么」——没有触发记录，用户只能看到“她今天没说话”，无法判断是鱼群、冷却还是坏了。

---

## #33（2026-10-23）B站 鱼群保护只记了“赞了谁”，没记“为什么判定为鱼群”

**现象**：用户问「B站的鱼群保护记录呢」——设置页只有今天点赞数/上次点赞结果，
没有“哪条视频、多少条鱼、占比多少、为什么没发新楼层/聚拢到谁”。QQ 侧已经有触发记录了，B站 侧没有。

**根因**：`planFishGuard()` 只返回判定结果给调用方，从不落盘；`fish-guard.json` 只存
`liked/gathered/daily/likeFailed/lastLikeRun`。评论被拦下时只打印到终端，设置页看不到。

**修法**：
- `fishGuardLog` 纳入 `loadFishGuardState` / `saveFishGuardState`（30 天 / 最多 50 条）；
- 新增 `recordFishGuardCheck({state, plan, oid, bvid, source, stateFile})`：
  记 `flooded / fishTopLevel / fishMids / fishRatio / totalSample / fishNames / gather / likeTargets / loggedIn`；
- `comment.mjs --auto` 在判定后立刻记（**鱼太多没发也记**）；`fish-guard like` 也记（`source:"like"`）；
- `fishGuardStateSummary` 返回最近 10 条 `records`；B站 状态卡下半段新增「最近鱼群检查」，
  按状态显示“鱼太多 · 不发新楼层 / 鱼太多 · 聚拢到鱼楼 / 鱼太多 · 只点赞 / 可发新楼层”，并显示 BV、鱼楼层/账号/占比/样本、聚拢目标、可点赞数。

**验证**：真机跑 `fish-guard like --bvid BV1jhn16GEcv --dry` 后，`fish-guard.json` 出现一条真实记录：
`fishTopLevel:15 / fishMids:14 / fishRatio:0.375 / totalSample:40 / gather:小叮当的大肥鱼 / likeTargets:4`；
设置页截图 `ui-bili-fishguard.png` 可见完整一行；`test-fish-guard` 覆盖写入/上限 50/summary records。

**教训**：判定型功能要同时记录「判定结果」和「动作结果」。
只记点赞成功/失败，用户仍然无法回答“她今天为什么没说话/为什么改了回复对象”。

---

## #34（2026-10-23）鱼群识别放宽：名字里有「肥鱼」/ 最后一个字是「鱼」都算鱼

**用户决定**：网络取名多样，不能只认「肥鱼 / fish」结尾；
**名字里只要包含「肥鱼」就算（位置不限）**，并且**最后一个字是「鱼」也算**。
宁可极小概率把真人认成鱼（如「肥鱼观察员」「摸鱼」「咸鱼」），也别漏掉同类 bot。

**规则边界**：
- 只放宽**发送者昵称**的识别；**群名判断仍只用「肥鱼 / fish」**（`groupNameSuffixes` 未改），
  不会因为群名多一个「鱼」字就把群里的真人全算成鱼；
- `exemptNames` / `exemptIds` / `exemptMids` 优先级更高；主人/自己仍强制排除；
- 归一化后判断：去尾部数字/装饰符/emoji/空白，所以「咸鱼2」「咸鱼✨」也认；
  「鱼糕」「摸鱼糕手」这种鱼不在结尾、也不含肥鱼的不算；
  「肥鱼观察员」「大肥鱼研究员」因为**包含肥鱼**，算。

**实现**：
- `src/fish-guard.js` 与 `plugins/surfcore/tools/lib/fish-guard.mjs`：
  - 默认 `nameSuffixes` 改为 `['肥鱼','fish','鱼']`；
  - 新增 `nameContains: ['肥鱼']`，`isFishName` 先查包含、再查后缀；
- UI 两个字段（鱼名后缀 / 鱼名包含词）、`config.example.json`、B站模板同步；
- 已更新真实 `~/.dsh/surfcore/bili.config.json` 与 `config.json`（先备份到
  `~/.dsh/surfcore/backups/nameSuffixes-before-add-yu-*.json`、`nameContains-before-add-feiyu-*.json` / `_backups/`）。

**验证**：`test-fish-guard` 新增 QQ/B站断言：
咸鱼/摸鱼/鱿鱼/鱼 true；肥鱼观察员/大肥鱼研究员/观察员肥鱼 true；
鱼糕/摸鱼糕手 false；豁免优先。真机 `isFishName` 两种 normalize 返回一致；
配置读回 `nameSuffixes:["肥鱼","fish","鱼"]`、`nameContains:["肥鱼"]`。
同一视频 `fish-guard plan`：
- 旧规则（只认肥鱼/fish 结尾）`15 条鱼 / 14 个账号 / 38%`；
- 加「最后一个字是鱼」后 `16 / 15 / 40%`（新认出「莱弗里安家今天的鱼」）；
- 再加「名字包含肥鱼」后 `21 / 20 / 52.5%`（新认出「小肥鱼小汐」「超级大肥鱼开喽」「无敌大肥鱼女仆」等）。
`fish-guard.json` 记录与设置页截图同步。

**教训**：识别规则放宽时必须同时写清「放宽到哪一层」和「哪些层不放宽」；
这次只放宽发送者昵称，群名/鱼窝判断不动，避免连带把整个人群判成鱼。

## #35（2026-10-23）B站 每日分享改发自己的动态：视频卡片 + 与四类动态 30 分钟间隔

**用户决定**：大家想看的是小鲸鱼自己的互动，不是评论区 @ 主人；
每日分享默认改成**发到自己的 B站 动态**，而且视频要发成**卡片**，不是光秃秃一条链接。

**实现**：
- 新命令 `share-dynamic.mjs`：`--bvid --text --score --reason [--allow-text] --dry|--go`；
- 走 `lib/forward.mjs`：找视频在 UP 空间的 AV 动态并**转发** → 新动态 = 她的话 + 可点视频卡片
  （`daily.mjs` 2026-10-21 已验证这条转发路径；`create/dyn` 的 `attach_card` 不认普通视频）；
- 找不到 AV 动态默认**拒绝**（防止悄悄退化成文字）；`--allow-text` 才发“文字 + 链接”；
- 和四类动态共用 `daily-dynamic.json` 的 `at`，`share-dynamic` 发前查、`daily.mjs` 发前也查，
  任意两条至少 `dynamics.gapMin` 分钟（默认 30）；
- 占分享额度（`quota.shareDaily` / 同一视频 7 天判重），写 `daily-dynamic.json.share`，发完报备；
- `share.via` 默认从 `comment` 改为 `dynamic`；设置页下拉第一项「发自己的动态（视频卡片）」，
  旧的 `comment --share` / `dm --share` 保留。
- 真实配置 `~/.dsh/surfcore/bili.config.json` 的 `share.via` 改为 `dynamic`（备份 `share-via-before-dynamic-*`）。

**验证**：`share-dynamic --bvid BV1jhn16GEcv --dry` 找到视频动态 `1261913158862241812`，
打印“视频卡片（转发动态 …）”、距上一条 43 分钟、分享额度 0/3；**未真发**（对外动态不擅自发）。
`test-share-dynamic` 覆盖 `daily-dynamic.json` 间隔/合并；`test-client-contract` 断言下拉默认 dynamic。

**教训**：B站 网页 `create/dyn` 不认普通视频的 `attach_card`；要视频卡片只能“转发该视频已有的 AV 动态”。
“间隔 30 分钟”必须两边都查同一份 `daily-dynamic.json`，只查一边会出现“分享后立刻发四类动态”的漏洞。

## #36（2026-10-23）鱼群聚拢回复改占「主动评论额度」，不是回复额度

**现象/根因**：聚拢时设置了 `root/parent`，`GATE_KIND` 原来按 `parent` 走成 `reply`，
于是鱼群聚拢吃掉的是“回找我的人”50 条/天，而不是“主动评论”30 条/天；用户明确要求前者。

**修法**：
- `comment.mjs` 新增 `FISH_GATHER`（`fishPlan.gatherTarget` 且当前 `parent` 就是它）；
- `GATE_KIND` 优先级改为 `TA > FISH_GATHER(comment) > mine:* > reply`；
- 记账时 `FISH_GATHER` 不传 `--reply`，改由 `isFree` 计主动评论；`DYN_KIND` 也跳过，避免误记动态回复；
- 别人再回复这层楼时，`FISH_GATHER=false`，仍然走 `reply` 额度（原有行为不变）。
- 聚拢内容可以是回复这条鱼，也可以是她对视频的看法；代码只负责“回在这条鱼楼下 + @鱼名”。

**验证**：`test-fish-guard` 增加源码契约断言（`FISH_GATHER ? 'comment'`、`parent && !FISH_GATHER ? ['--reply']` 等）；
`comment.mjs --dry` 的日志会明确打印“占主动评论额度”。
真机同一视频 `comment --auto --dry`：判定 21 条鱼/20 个账号/53%，聚拢到 `多林的鲸鱼`（rpid 321569322752），
自由发言闸显示 **“今天第 2/30 条普通评论”**（不是回复账）；未发送。

**为什么“泛滥 + 没有可聚拢的鱼楼”不是 bug**：泛滥可由占比触发（8 条里 4 条鱼 = 50%），
但有鱼楼会被 `gatherMaxReplies>6`、`gatherMaxAgeHours>72h`、`gatherMaxFishReplies>2`、
同一楼 12 小时冷却、`--no-fish-gather` 等过滤掉。
**2026-10-23 起**这些条件只决定“优先回哪条”，不再决定“回不回”——默认强制聚拢（PITFALLS #37）。

## #37（2026-10-23）每次醒来强制聚拢：没有合适鱼楼也要回一条

**用户决定**：每次醒来都要**无视可聚拢楼层判定**，就算没有“回复少/新鲜/没回过”的鱼楼，
也强行聚拢并发表一次主动评论。

**实现**：
- `DEFAULT_BILI_FISH_GUARD.forceGather = true`；`normalizeBiliFishGuard()` 默认开，显式 `false` 才关；
- `assessFishFlood({forceGather:true})`：候选鱼楼为空时，从 `fishRoots` 里选
  **回复最少、其次最新**的一条作为 fallback（忽略 `gatherMaxReplies` / `gatherMaxAgeHours` /
  `gatherMaxFishReplies` / `gatherCooldownHours`；仍然只选鱼、排除主人/自己/豁免）；
  返回 `gatherFallback:true`，日志/记录显示“强制聚拢”；
- `planFishGuard()` 透传；`comment.mjs` 默认 `forceGather`，`--no-force-gather` 可临时关；
  `--no-fish-gather` 仍然优先（明确不发）；
- 设置页 B站 →「每次醒来强制聚拢」开关；真实 `bili.config.json` 已写 `forceGather:true`
  （备份 `forceGather-before-*`）；
- 唤醒提示 4.7 从“有话说就说”改成**每次醒来至少一条主动评论**，鱼群泛滥时明确
  “不许拿没有可聚拢鱼楼当理由不发”。

**边界**：强制聚拢**不绕过**主动评论额度（30/天）、全局/同 UP/同视频冷却、待审队列；
额度或冷却满了就停，不能靠“强制”硬刷。

**验证**：`test-fish-guard` 新增“全部鱼楼都不满足条件 → forceGather=true 仍选回复最少的鱼楼、
false 仍为 null”用例；`normalizeBiliFishGuard` 默认 true/false 覆盖；
设置页 client contract 断言 `fishGuard.forceGather`；`comment.mjs` 源码契约断言 `gatherFallback`。

## #38（2026-10-23）生物钟 C 模式：每窗至少 1、全天 ≤12、错开、skip 不结束全天

**用户问题**：现在生物钟都正常醒吗？能保证每个窗口的设定次数吗？相邻窗口能错开且保证质量吗？

**诊断（修前）**：
- 实际配置 9 个窗口 × 每窗 3 次 = **27 次需求**，但 `MAX_WAKES = Math.min(12, sum)` 硬上限 **12**；
  数学上就不可能每窗 3 次。实际 `whale-night.json` 还出现 `wakes:1`、`usedCount` 两个窗口的错位；
- `makePlan` 在 `st.done===true` 时直接 done；scheduler 的 skip 分支写 `done:true` →
  **任意一次“不看”结束全天**，后面的窗口不再排；
- skip 计划每个 tick 会被重新 `night plan` 重掷骰子（日志出现 08:31:00 skip → 08:31:11 wake）；
- `usedCount` 在 **计划生成** 时就 +1，`wakes` 在 **真正叫醒** 时 +1；计划没触发会白占名额；
- scheduler 只判断 `now >= at`，不判断窗口 end；实测 19:03 的计划在 **23:42** 才叫醒（晚 4h39）；
- 相邻窗口没有跨窗口最小间隔：18:59 和 19:00 可以只隔 1 分钟；
- 1 小时窗口 ×3 次平均 20 分钟一次；要求 30 分钟间隔需 8.5 小时，**当前窗口形状放不下**。

**C 方案（已实现）**：
- 新纯逻辑 `tools/lib/night-schedule.mjs`：一天只排一次 `slots`，之后只推进，不重掷；
- **每窗至少 1 次**（`kind:'base'`）；全天总数 ≤ `maxWakesPerDay`（硬上限仍 12）；
- 剩余名额按该窗口最近 30 天 `scores.json` 平均分分配（`kind:'extra'`）；没评分时优先晚时段；
- 相邻 slot 至少 `night.minGapMin` 分钟（默认 20），相邻窗口也算；
- skip 只是当前 slot 的 `action:'skip'`（轻醒），结束后 `done:false`，继续下一 slot；
- slot 超过窗口 `end` → `missed`，不补醒；窗口内已过点 → 改到 `now+1`（晚到但不跨窗）；
- `whale-night status` 显示完整排程（保底/加餐/轻醒/错过）+ warnings；
- scheduler 在每次 tick 检查当前 slot 是否过期；过期记 missed 后重新 plan；skip 只标当前 slot；
- UI 新增 `night.minGapMin`；`maxWakesPerDay` 提示改为 C 语义；真实 `bili.config.json` 写入
  `night.minGapMin:20`（备份 `night-minGap-before-*`）。

**边界**：
- C 只保证“每窗至少 1”，**不保证每窗 3**；9 窗 ×3 的 27 次仍受 12 上限约束，这是用户选的 C；
- 1 小时窗口放不下 3 次 × 30 分钟间隔；要严格 30 分钟需减少每窗次数或拉长窗口；
- skip 仍是 30% 概率，所以“真正看”的次数会少于 slot 数；`wakes` 统计醒事件，`watchWakes` 统计真正看；
- 行动质量靠最小间隔 + 每窗保底 + 内容评分加餐；没有在醒来前做“feed 无新内容”的硬检查，
  这一层需要后续再加（否则仍可能空跑）。

**验证**：
- `test-night-schedule.mjs`：12 次上限、9 窗覆盖、相邻 ≥20、质量窗口拿满、skip 不结束全天、
  过期/晚到、评分聚合；
- `test-store` / client contract 覆盖 `night.minGapMin` 与 C 提示；
- 真实 `night plan` 生成 11 个 pending slot + 已醒 1 次 = 12；6–8 窗口已过，warning 明确；
- 当前状态 `10:00–12:00 保底` 11:30，后续 14/18/19/20/21/22/23 各窗口至少 1 次。



## #39（2026-10-23）设置页只有白名单没有「人」的黑名单：deny.private 拦不住同群的人

**现象**
- 用户要求：「设置里 QQ 白名单那里底下加一个黑名单功能，不响应黑名单中的人的消息，无论什么群」。
- 当时设置页顶部只有「QQ 白名单（群 / 人）」卡片；`deny.private` / `deny.groups` 藏在几十个高级参数里折叠着的「黑名单（高级）」组，
  而且语义是**会话级**：拉黑某个人的私聊，他在群里照样能触发。

**根因**
- `allowed(kind, id, cfg)` 只看 `kind`（group/private）+ `id`（群号 / 私聊对象）。群消息进来时 `id` 是**群号**，
  同一群里所有成员共用一个会话 key ⇒ 白名单群里的某个成员的人**根本无法单独拉黑**。
  把人塞进 `deny.private` 只拦他的私聊；塞进 `deny.groups` 会把整个群连别人一起拦掉。
- 所以这不是「再加一个输入框」的问题，而是缺一层**按发送者**的准入判定。

**处置**
- 新增 `config.json → deny.users`（QQ 号数组）与纯函数 `senderBlocked(userId, denyUsers)`。
- 拦截点放在 `handleIncoming()` 的**最前面**（`modeAllowed` 之后、一切副作用之前）：
  不入库、不进上下文、不写记忆卡、不计鱼群、不触发唤醒。放在后面任何一处都等于「他还能叫醒你」。
- `handlePokeNotice()` 同步拦：否则「戳一下」就是绕过黑名单的唤醒通道。
- 设置页在白名单卡片**正下方**新增「QQ 黑名单（人 / 群 / 私聊）」卡片，把 `deny.users` / `deny.groups` / `deny.private`
  收到一处；高级参数里的重复输入框删掉（同一份数据不留两处可改，PITFALLS #27 的教训）。
- 旧控制台（`public/console.html`）的白名单表单只提交 `private/groups`：桥接 `POST /api/whitelist` 在请求
  没带 `users` 时**保留原值**。否则在设置页拉黑的人会被一次旧页面「保存白名单」静默抹掉。
- 启动日志打印黑名单成员；管理员 QQ 在黑名单里时额外告警（审批/私聊/管理命令会全部静默失效）。

**边界（写清楚，别以后当成 bug）**
- 只拦**入站**：她主动发送仍受 `allow.groups` / `allow.private` 约束；拉黑不回溯删除记忆卡里已有的内容。
- 拉黑发生在消息进入桥接之前的那一层之后：如果黑名单用户的消息已经被旧版本记进上下文，
  拉黑后不会自动清理（要清就 `/reset` 或删对应记忆）。

**验证**
- `scripts/test-blacklist.mjs`（登记进 `test:audit`）：配置收敛（数字/字符串/空格/去重）、reserved2 不入未读不建会话、
  chat 不投递、私聊压过 `allow.private`、`allowAllWhenEmpty` 全放行时仍拦、拍一拍不唤醒、
  旧控制台保存不清空 `deny.users`。
- `plugins/surfcore/scripts/test-client-contract.mjs`：卡片存在、`deny.*` 不再有第二处输入框。
- `plugins/surfcore/scripts/test-admin-config-api.mjs`：`deny.users` 保存后去重/转字符串/丢弃非法项。

**预防**
- 以后任何「按人」的准入规则都写在 `handleIncoming()` 最前面，**不要**往 `allowed()` 里塞 —— 它只有会话粒度。
- 新增一个会写 `config.json.deny` 的入口时，先问一句：别的 UI 保存时会不会把它整段覆盖掉？

**追记（2026-10-23 10:49–11:00）：真机第一次验证失败 —— 不是拦截失效，是填错了框**
- 现象：用户在群里发「@机器人 test」，机器人照常回复；`bridge.log` 里没有任何 `[黑名单]` 行。
- 查证（只看文件就能定案）：
  - 保存**之前**的备份 `~/.dsh/surfcore/backups/qq-config-2026-10-23T02-49-34-262Z.json` 里 `deny` 全空；
  - 保存**之后**的 `config.json`：`deny.private=["1011078831"]`、`deny.users=[]`；
  - `state/social-v2.json` 的 `unread` 里还躺着那两条测试消息（`userId=1011078831`）。
  ⇒ 这个 QQ 被填进了「仅拦私聊」，`deny.users` 从没被赋值 —— 不是拦截没生效，是根本没拦。
- 处置：
  1. 把该 QQ 移进 `deny.users`（真实配置先备份）；
  2. `loadSocialV2State()` 启动时清掉黑名单用户在 `unread` / `recentMessages` 里的积压
     —— 否则拉黑前堆的未读会在下一次唤醒（哪怕被别人触发）被当成新消息回一遍，看起来仍然像没生效。
     实测启动日志：`[黑名单] group:767098733 启动时清掉 4 条来自 deny.users 的未读/上下文`；
  3. 设置页把字段改名为「仅拦私聊（deny.private）」，并在有人只填在这一档时给红字提示 +
     「把这 N 人加到『拉黑的人』」一键迁移；
  4. 启动日志对「只在 deny.private 里的人」提示：他们在群里仍会被回应。
- 教训：一个「黑名单」拆成按人 / 按群 / 按会话三档时，用户一定会填错档；错的那一档必须
  **响亮地**说明「它不覆盖什么」，而不是只在 hint 里写一句「群聊不受影响」。
- 回归：`scripts/test-blacklist.mjs` 新增两条 —— 「deny.private 不该影响群聊」（把设计固化，
  防止以后有人顺手把 private 也接进群拦截）与「启动时清掉黑名单用户的未读/上下文积压」。

## #40（2026-10-23）转发聊天记录被说成「我在B站说过的话」；B站 侧认不出自己的 QQ 资料卡

**现象（用户实测，原话）**
- 「我在QQ群里发了小肥鱼在别的群的聊天记录，但是她认成那是她在B站发的」；
- 「在B站的小肥鱼看到自己的QQ主页图能否认出是自己？目前来看似乎是不能」。
- 证据（`state/social-v2.json` 的 `recentMessages`）：她对着转发记录说
  「诶？这是 wo 在B站说过的话呀」「弥叭连评论都翻出来了 mer」。

**根因（两个不同的问题，别混在一起）**
1. **来源没有标签**：`formatForwardResponse()` 只返回 `text/media/…`，没有「这是哪个平台」。
   而 B站 记忆简报里恰好有她自己的公开评论 —— 模型只能按"内容像不像"归档，
   于是把 QQ 聊天记录算成了 B站 评论。
2. **B站 侧没有 QQ 侧自我锚点**：那一侧的固定上下文只有人设卡（QQ 号被
   `sanitizePersonaForBili` 主动抹掉）、B站 管理员、对齐表、脱敏 QQ 近况、记忆卡，
   **完全没有"QQ 上的我长什么样"**。所以别人递来她的 QQ 资料卡截图，她只能当陌生人。
   （QQ 侧反过来是好的：B站 记忆简报里有昵称/mid/主页，用户实测认自己、不认错别的鱼。）

**处置**
- 新增 `src/self-identity.js`（唯一权威）：`normalizeSelfCard` / `buildSelfIdentityBlock(card,{platform})`
  / `buildProvenanceBlock()` / `maskQqUin()` / `readQqSelfIdentity()`。
- `formatForwardResponse()` 现在带 `platform` / `source` / `notice`；`qq_get_forward_msg` 的工具描述同写。
- QQ 唤醒提示每次带一段【来源判断】（合并转发 = QQ 聊天内容；图片/截图也算 QQ 内容；
  不要把聊天记录说成「我在B站说过的话」）；B站 记忆简报关掉时，桥接用自我卡兜底补锚点。
- B站 唤醒（`scheduler.js` 的 `identityContextLines()`）第一条上下文注入自我卡：
  B站 昵称/UID/主页/人格名 + QQ 昵称 + **打码** QQ 号（`328****288`）+ 认自己规则 + 隐私句。
- 桥接在网关登录时把 QQ 昵称/号写到 `state/self-identity.json`（B站 进程读不到网关登录信息）；
  只在内容变化时写，失败只记一行日志。
- 策略与验收写成 [`guides/CROSS_PLATFORM_IDENTITY.md`](guides/CROSS_PLATFORM_IDENTITY.md)：
  自我卡唯一 / 来源由载体决定 / 标签与规则双写 / 隐私分级。

**验证**
- `scripts/test-self-identity.mjs`（8 组）：打码、收敛、空卡不注入、B站 侧有 QQ 锚点且不含完整号码、
  两侧都带来源规则、`self-identity.json` 缺文件/坏文件不炸。
- `scripts/test-forward.mjs`：返回里有 `platform=QQ`、`source=forwarded-chat-record`、notice 写明「不是 B站」。
- `plugins/surfcore/scripts/test-client-contract.mjs`：scheduler 引用了自我卡并接进每轮上下文。

**边界（写清楚）**
- 视觉识别仍是模型判断，不是 OCR 白名单；锚点给全 + 规则写清能压低错误率，不能保证 100%。
- B站 侧没有取图通道时只能靠文字（昵称/UID/号码）对齐。
- 打码号码不能精确反查；认号时问一句比猜可靠。

**追记（2026-10-23 11:20）：用户追加「只准自己互认，不许泄露主人和别人的信息」**
- 之前只有提示词约束（自我卡里一句「不许写进公开内容」），模型一旦被绕就发出去了。
  B站 评论/动态是**公开面**，发出去收不回来，所以补了一层确定性闸：
  - `src/identity-guard.js`（纯函数）：已知 ID 精确命中 + 「QQ/群号 + 数字」形态；
    **不拦**普通数字（年份/播放量/楼层）与昵称（会撞、误伤成本高）；
  - `plugins/surfcore/tools/lib/outbound-guard.mjs`：从合体层 `admin`（主人 QQ + B站 mid）、
    `bili.config.json` 的 `owner.mid`、`alignments.json` 里每个人的 id 收集「受保护 ID」，
    减去她自己的 B站 mid（自己的主页是公开资料）；
  - 接线：`comment.mjs` / `dm.mjs` / `dynamic.mjs` / `share-dynamic.mjs` 发送前调用，命中就 exit 9，
    错误信息里的号码也打码（`328****288`）。
- **QQ 群侧没有加硬闸**：群成员本来就看得到彼此的 QQ 号，硬拦会误伤正常回话；那侧只保留提示词规则
  （【只用于自己】）。要加得先定更窄的规则（例如只拦主人的 B站 mid）。
- 回归：`scripts/test-identity-guard.mjs`（纯函数 + 「四个写操作都接了闸」的接线断言）。
## #41（2026-10-23）08:00 的早安没发出去：三个原因叠在一起

**现象**
- 用户：「今天早上八点问候怎么没有成功」。
- `state/bridge.log` 里 08:00:00 只有一行 `[早安] 已排定：…（下次 2026/10/24 08:00:00）`，
  既没有「已投递」也没有失败日志 —— 看起来像根本没跑。

**根因（三层，缺一层都发不出去）**
1. **错过就丢**：旧排程 `next.setHours(08:00); if (next <= now) next += 1 天`。
   桥接恰好在 **08:00:00** 重启（当天日志里那一行就是启动时的排定），启动瞬间 08:00 已过
   ⇒ 直接排到明天，今天这一枪彻底丢了，没有补发、没有重试。
2. **reserved2 下纯文本不会自动发**：`deliverPromptNow` 只在 `currentMode !== 'reserved2'` 时
   自动转发 `command.text`；而旧提示词写的是「直接输出要发的话」。就算定时器炸了，
   她也只是"想"了这句话，QQ 上什么都不会出现。
3. **目标与机器人不是「互为好友」**：实测目标 QQ `3362299430` 当时不在机器人好友列表，
   OneBot 直接 `result=16 发送失败，请先添加对方为好友`；错误只留在 bridge.log，
   管理员在设置页看不到（试发接口回 200/已投递）。

**处置**
- 新增纯逻辑 `src/greeting-schedule.js`：`planMorningGreeting()`（准点/补发/重试/明天）、
  `buildMorningGreetingPrompt()`（按模式告诉她怎么真的发出去）、`parseGreetingTime()`、主题池。
  - 错过时间点但在 **3 小时补发窗口**内且今天没发 → 5 秒后补发；
  - DSH 离线 / 投递失败 → **10 分钟后重试**，不越过补发窗口；
  - 今天已发 → 排明天；跨天用本地日期。
- `state/greetings.json` 记录 `lastMorningDate / lastMorningError / lastTargetWarnDate`，
  重启不重复发、失败可诊断。
- **好友预检**：发之前 `get_friend_list`（缓存 10 分钟）；不是好友就当天标记失败并**私聊管理员**说明
  「QQ 会拒绝私聊（result=16）」——不再让它只躺在日志里。试发接口此时回 **500 + 原因**。
- reserved2 提示词改为「必须调 `qq_send_private_message`，带 userId/token」，并写明
  「纯文本不会自动发到 QQ，只输出文字等于没发」；会话令牌从 `getSocialV2State(key).agentToken` 取。
- `/api/greeting/test` 支持临时 `uin` 覆盖（必须命中私聊白名单，不写回 config.json），方便真机验证。

**验证**
- `scripts/test-greeting.mjs`（10 条）：准点/08:00:00 补发/超窗排明天/已发不重发/重试不越窗/跨天/
  主题轮换/reserved2 提示词带工具与令牌/chat 模式不要求工具/补发文案带「补发」。
- 真机：11:29 目标非好友时 `AI 反馈 [warning]`＋发送失败被 QQ 拒绝；
  用户把该号加为好友后，11:36:19 `[send] /api/send/private private:3362299430: 成功 1/1 条`，
  随后 `工具已发送消息，跳过自动转发` ⇒ 一条、不重复。

**边界**
- 好友关系（且必须**互为好友**）、风控、对方拒收都是账号层的事，代码只能**发前检查 + 失败时明确告知**；
  `get_friend_list` 只能查到机器人这一侧，查不到「对方有没有加我」，所以设置页把前提写成「互为好友」。
- 排程只按本地时间；电脑睡眠时定时器会晚触发（补发窗口内仍会发，超过就记失败等明天）。

## #42（2026-10-23）设置页点赞历史：只存 rpid 看不出「给谁点的」

**用户要求**：设置里要能看到小肥鱼的点赞历史，都给谁点赞了。

**根因**：
- `fish-guard.json` 只有 `liked: { rpid: ISO时间 }`，没有昵称、BV、评论正文；
- 设置页只有「今天点赞 N / 上次点赞结果」，没有逐条历史；
- 旧的那条真实点赞只有 rpid，UI 只能显示一串数字。

**修法**：
- 成功点赞时写 `likeLog`（最多 300 条）：
  `{ at, rpid, root, uname, kind: root|reply, bvid, oid, message, like }`；
  只在 B站 返回 `code=0` 后写，失败/dry-run 不写；
- `assessFishFlood` 的 `likeTargets` 补 `message`，`likeFishComments` 落日志；
- `fishGuardStateSummary()` 返回 `likeHistory`（新的 `likeLog` + 旧 `liked` 的 legacy 条目，按时间倒序，最多 100）；
- B站 状态卡新增「点赞历史」：显示 `@昵称`、BV、楼层/楼中楼、评论摘要、rpid、时间；
  旧条目显示「旧记录，未存昵称」；
- 现有那条真实点赞已用 `/x/v2/reply/reply?root=…` 回填昵称/正文/BV（备份 `fish-likeLog-backfill-*`）。

**验证**：
- `test-fish-guard` 新增成功点赞写 `likeLog`、summary `likeHistory` 断言；
- `test-client-contract` 断言「点赞历史」与 `likeHistory`；
- 真机 `GET /bili/fish-guard` 返回
  `likedCount:1`、`likeHistory:[{ uname:"沉圻PhiLia的蓝色大肥鱼", bvid:"BV1jhn16GEcv", ... }]`；
- 截图 `ui-bili-fishguard.png` 已显示点赞历史。

## #43（2026-10-23）选题器「总是推同几条 + 只盯着一两个偏好」：去重漏了观看历史、偏好被 slice(0,6) 截断、大小写变体叠分

**用户反馈**：小肥鱼看视频的架构有问题，总是搜到相同的视频；感觉她只会看某一个偏好；
希望每个偏好能调权重，并能一键从用户自己的数据里抓偏好关键词。

**现象（真机数据，改前）**：
- `feed` 输出的 6 条里，有 3 条是 `watch-history.jsonl` 里刚看过的（`BV1HYp16oE8v`、
  `BV1fmJ66cEXJ`、`BV1sTnn6DEWv`）；
- 10 个偏好只搜到前 6 个（全是 AI/DeepSeek 变体），剩下的 `大肥鱼`/`AI` 等根本没被搜索；
- 同一标题命中 `DeepSeek` + `Deepseek` + `deepseek` 时各加 4 分，叠成 3 倍；
- 观看历史 42 个不同 BV，其中 **25 个不在** feed 的 “seen” 里（旧 seen 只读日记 18 个 BV +
  评论审计表 0 个 BV，且 `commented-videos.md` 当时不存在）。

**根因**：
1. 去重源写死在 `feed.mjs`：只读 `whale-diary.md` 与 `commented-videos.md`；2026-10-22 新增的
   `watch-history.jsonl` / `bili-memory.json` 没接进来。
2. `prefs.slice(0, 6)` 静默截断，且搜索固定 `page: 1` + `click/pubdate` 两种排序 →
   B站 对同一个词永远返回同一批。
3. 偏好命中用 `title.includes(tok)` 且每个数组元素各算一次 → 大小写变体叠分；
   `AI` 这种 2 字母词还会命中 `said/email/trailer`（没有词边界）。
4. 没有权重概念，排序只按分数取前 N；泛词永远霸榜。

**修法**：
- 新增纯逻辑层 `tools/lib/feed-core.mjs`（偏好清洗/权重/配额/多样性/搜索轮换/去重），
  `feed.mjs` 只负责取数；`test-feed-core` 覆盖配额（4 等权 → 2/2/1/1；3:1 → 3:1）、
  单偏好不封顶、12 偏好 6 条按种子轮换、拉丁词边界、最近推过滤。
- 去重合并：日记 + 审计表 + `readWatchHistory()`（含旧记忆回填）+ `bili-memory.json` +
  收藏 + 反馈；最近 3 天推过但没看的写 `feed-picks.json` 避开。
- 偏好：`preferences.weights`（0~5，0=停用）+ `preferences.keywords`（以前是死字段，现在参与搜索）；
  大小写变体合并；拉丁词按词边界匹配；`--n`/`--per`/`--pages`/`--seed`/`--json` 可调。
- 搜索：每个偏好 1 次，排序在 totalrank/pubdate/click/dm 之间、页码 1~3 之间按天轮换。
- 配额：理想额度 = `n × weight / sum(weights)`，保底 1 条、封顶 max(2, n/2)；
  只有 1 条偏好有候选时不封顶；候选不足的偏好让出名额并打印 shortfall。
- 新 `tools/lib/pref-scan.mjs` + `prefs scan` + `GET /api/preferences/scan`：
  从观看历史（含 `tag_name`）、收藏夹（文件夹名直取）、本地记录抽候选词（关注列表可选、默认不读）；
  中文 n-gram 加词边界/虚词/停用词过滤，标签与收藏夹名直取整词（不再产生“机游戏”这种假词）。
- 设置页：B站页新增「口味权重 / 一键抓取」；`store.js` 保存时收敛 like/keywords/weights
  （大小写去重、权重 0~5、清掉孤儿键）。

**验证**：
- `node scripts/test-feed-core.mjs` / `node scripts/test-pref-scan.mjs`；
- 插件 `npm test`（含 `test-store` 权重收敛、client contract 新按钮/接口、host smoke
  `/preferences/scan?sources=local`）全绿；根 `npm run test:audit` 55/55；
- 真机 `feed --seed 2026-10-23`：已排除 43 个 BV（其中观看历史补 25 个），旧输出里那 3 条看过的
  不再出现；10 个偏好全部参与搜索；
- 真机 `prefs scan`：history 56 条 / favorites 24 条 / local 82 条 → 24 个候选，
  含「单机游戏、手书、同人、异环、凡人修仙传、AMV、MAD」；
- 临时配置（猫咪 3 / AI 0.5）跑 `--json`：配额 3/1/1/1，符合权重；
- 设置页真实截图：新面板 10 条关键词 + 滑杆 + 删除/加词/一键抓取按钮都渲染正常。

**没验证 / 边界**：
- **新 host 接口要重载插件才生效**：客户端文件刷新即读，面板已能看到；但运行中的 DSH 还持有旧
  `index.js`，`GET /api/preferences/scan` 会回「未知接口」（UI 已提示“重启 DSH 或重载 surfcore”）。
  `feed` / `prefs scan` 是子进程所以即时生效；存权重走旧 `/config` 路由，也不用重启。
- **抓取的是哪个账号（2026-10-23 用户追问）**：只读 `~/.dsh/surfcore/bili/credentials.json` 里配置的
  **小肥鱼账号**（实测 nav mid=1483638708 卡哇伊的小肥鱼），以及当前角色的本地观看/收藏；
  **不读浏览器登录的账号，也不读主人 `owner.mid=37634003`（弥叭 / 玛露Marrow）**。
  返回值新增 `account { mid,name,role }`，设置页/CLI 都会显示抓取账号。
  想抓主人账号必须另配主人的 B站 cookie（观看历史/点赞/私密收藏只对本人开放）；公开数据实测为空
  （无公开收藏、关注未公开、仅 2 条动态），不能当偏好源。
- 偏好仍是全局（不随角色切换），与 `docs/guides/CHARACTER_PERSONA.md` 的已知边界一致；
- 抓取候选有标题 n-gram 噪音（如“意识到”“GMV”），所以只做勾选、不自动写配置；
- `feed-picks.json` 是每角色一份，切角色后“最近推过”从新角色开始算；
- 偏好数多于每轮条数时（例如 10 个偏好只挑 6 条），靠当天种子轮换，不保证「每轮每个都出现」。
## #44（2026-10-23）B站 绑定/主人偏好：从「F12 复制 cookie」改成扫码登录

**用户要求**：
1. 「确认抓取的是主人账号（弥叭）的偏好，不是浏览器登录或小肥鱼的账号」；
2. 「新用户绑定小肥鱼B站账号那一步，也改成扫码，不要 F12 抓 cookie」。

**结论（先回答第 1 条）**：
- 原实现只读 `~/.dsh/surfcore/bili/credentials.json`，实测 nav 返回 **mid=1483638708
  卡哇伊的小肥鱼**；主人 `owner.mid=37634003`（弥叭 / 玛露Marrow）完全没读；
  浏览器 cookie 也从未读取。
- 主人账号的观看历史/点赞/私密收藏只对本人开放；公开数据实测为空
  （收藏夹 0 个、关注列表 code 22115、公开动态 2 条），抓不出偏好。

**修法**：
- **通用扫码登录**（`lib/bili-qr-login.mjs`）：
  - 用本机 Edge headless 打开 `https://passport.bilibili.com/login`（官方登录页）；
  - 从页面里取**可见的**二维码 `img[src^=data:image/png]`（隐藏 canvas 是空白占位，
    实测取 canvas 得到 993 字节白图 → 必须按 `getBoundingClientRect().width>50` 筛）；
  - 通过 CDP `Network.getAllCookies` 轮询 `SESSDATA/bili_jct/DedeUserID`，nav 验证登录态；
  - `target=fish` 写回 `credentials.json` 并更新 `bili.self`；主人号会被拒绝，已有 `self.mid`
    不一致也会拒绝（新用户 self 为空则放行）。只有一个 B站 号的用户可在弹窗勾选
    「主人=小肥鱼」再扫；`target=owner` 写 `owner-credentials.json`，
    **鱼号会被拒绝，且校验扫码 mid == owner.mid**；
  - 只发 GET 到 B站；不填密码、不模拟点击登录按钮；cookie 不回显给客户端。
- **设置页**：
  - B站 凭据卡新增「扫码登录小肥鱼」，手动 SESSDATA/bili_jct 保留为 Edge 不可用时的备用；
  - 「口味权重 / 一键抓取」新增抓取目标（主人/小肥鱼/两者），默认主人；点抓取时若主人未登录
    直接弹二维码，扫码成功后自动继续抓取；
  - 显示「抓取账号：主人 xxx / 小肥鱼 xxx」和每个来源；扫错号会提示期望 mid。
- `pref-scan` 支持 `target=fish|owner|both`：鱼/主人各自读历史+收藏夹+关注，来源带前缀；
  主人额外用本地 `feedback.json`（主人对她评论的反应）作为弱信号；本地观看记录只算鱼的。
- 新接口：`GET /bili/accounts`、`POST /bili/qr/start`、`GET /bili/qr/poll`、`POST /bili/qr/cancel`；
  宿主关闭时 `closeAllQrLogins()` 清理 Edge 进程与临时 profile。

**验证**：
- `test-pref-scan`：主人没 cookie 时 `ownerLoginRequired=true`、`accounts=[]`，不会偷偷拿鱼的号；
- `test-client-contract`：扫码弹窗、`/bili/qr/start|poll`、抓取目标、扫码绑定小肥鱼；
- `test-host-smoke`：`/bili/accounts` 不泄露 cookie、非法 poll id 返回 400；
- 直接调用 `startQrLogin({target:'owner'})`：约 4 秒出码，`poll` 返回 waiting，`cancel` 后无残留 Edge；
- 插件 `npm test`、根 `npm run test:audit` **56/56** 全绿（含新增 `test-bili-qr-login`）。

**没验证 / 边界**：
- **没有用真手机扫过一次**（会真的登录账号，不能在自动化里做）；扫码→确认→写文件这条只能人工验收；
- 当前运行中的 DSH（15982）实测 `/bili/accounts`、`/bili/qr/poll` 仍 405、`/preferences/scan`
  不返回 target/account —— 是旧 host；新接口要**重启 DSH / 重载 surfcore** 才注册。
  客户端已加保护：选主人/两者时旧 host 会提示「不认抓取目标」，不会把鱼的结果冒充主人。
- 鱼号已有 `self.mid` 时扫码换号会被拒绝（防误扫换人）；要换号先手动处理旧凭据；
- 依赖本机 Edge；B站 登录页被风控/改版时可能取不到二维码，会返回可读错误，手动粘贴仍可用；
- 二维码约 170 秒过期；宿主崩溃时临时 Edge 进程可能残留（下一次 start 会先清理内存里的会话，
  但进程级残留需要手动结束 msedge）；
- 主人 cookie 存 `owner-credentials.json`，只给偏好抓取用；不要在别处复用，更不要拿它发评论/动态。
## #45（2026-10-23）gamefeed 没有去重：13:34 又推了看过多次的原神/鸣潮旧视频

**用户反馈**：「13:34 怎么又是那俩原神和鸣潮的视频？都看过多少次了」。

**取证（只读）**：
- `gamefeed --game 原神` 返回 **BV1Gdnv65ESC**《原神:雨之城》AI演示6；
  `gamefeed --game 鸣潮` 返回 **BV14enA6uEwu**（老外看鸣潮抽象 AI 二创）、**BV1Afpj67EQu**（ai指使我用鸣潮强兼MC）。
- 这三条都已在 `bili-memory.json` 里（10-21/10-22 看过），但 `gamefeed.mjs` **完全没有 seen 逻辑**：
  它只做搜索 + 播放/收藏粗排，所以每个游戏每次返回同一批。
- `feed`（睡眠选题）已经接了 watch-history，不会重复；漏的是**第二类动态的候选池**。

**修法**：
- `gamefeed` 合并看过名单：`readWatchHistory`（含旧记忆回填）+ 日记 + 评论审计表 +
  `bili-memory` + 收藏 + 反馈；
- 新增 `bili/gamefeed-picks.json`：本次输出的候选记 3 天，3 天内不再原样出现
  （只是候选，不等于看过；给 `--no-remember` 可跳过写备忘）；
- 输出「已排除：看过 N 条 · 最近 3 天推过 M 条」；全被排除时明确说「没有新的了，别硬重复」；
- 动漫/游戏区（`--for anime/gaming`）共用同一套过滤。

**验证**：
- 修后 `gamefeed --game 原神 --no-remember`：候选 6 → 5，排除 1（BV1Gdnv65ESC 消失）；
- `gamefeed --game 鸣潮 --no-remember`：候选 10 → 8，排除 2（BV14enA6uEwu / BV1Afpj67EQu 消失）；
- `test-feed-core` 增加接线契约：gamefeed 必须含 `readWatchHistory` / `gamefeed-picks.json` / 排除统计；
- 插件 `npm test`、根 `npm run test:audit` 56/56。

**边界**：
- 3 天窗口是「候选」层面；真正看过的视频永远排除（watch-history/memory 会一直留着）。
- 如果某游戏 3 天内候选全被排除，`gamefeed` 会说没有新的 —— 这时应换游戏/放宽 `--days`/当天不发，
  不要拿旧视频凑数。
- 这次修的是**候选池**；如果用户在 B站 App 首页看到的推荐重复，那是 B站 自己的推荐，不归本程序管。
## #46（2026-10-23）观看历史只有「看过」，看不出她评论了什么、是主评论还是鱼群聚拢

**用户要求**：「在观看历史里加上小肥鱼对看过的视频的操作有哪些（仅仅看了，评论了（怎么评论的，
主评论还是鱼群保护了））」。

**数据从哪来（不新增写入）**：
- `quota.json.log`：`comment.mjs` 成功发送后 `quota record` 的那条；
  - 无 `parent` → 主评论；`share` → 分享评论；
  - `parent + reply` → 回复别人；再加 `ta` → 主动搭话；
  - `parent + mine` → 动态回复；
  - `parent` 但没有 `reply/mine` → 鱼群保护聚拢（`comment.mjs` 对 `FISH_GATHER` 故意不加 `--reply`）。
- `favorites.json` 的 `items[].at` → 收藏；
- `bili-memory.json` 的 `dynamic` 条目正文里的 BV → 发过动态。

**修法**：
- 新 `tools/lib/watch-actions.mjs`：`classifyComment` / `readWatchActions` / `attachWatchActions` /
  `summarizeWatchActions` / `enrichWatchHistory`；
- `/watch-history` 返回每个 item 的 `actions[]`（`label/at/text/beforeFirstWatch`）+ 顶部 `actions` 汇总；
- 动作挂到「同 BV、时间上最近一次观看」；动作早于本地所有观看记录时挂最早一条并标
  `beforeFirstWatch`（页面写「早于本地观看」），不伪造观看时间；
- 设置页「观看历史」新增「操作」列：主评论 / 鱼群保护·聚拢回复 / 回复别人 / 主动搭话 /
  动态回复 / 分享评论 / 收藏 / 发过动态；没动作为「仅看了」；超过 3 条可展开；
- 顶部汇总「评论 N（主/聚拢/回复/搭话/分享）· 收藏 X · 发动态 Y · 仅看 Z」；
- 旧宿主 `/watch-history` 没 `actions` 字段时，客户端显示「需要新版宿主」而不是把所有人都标成“仅看了”。

**验证**：
- `node scripts/test-watch-actions.mjs`：6 种评论分类、收藏/动态、去重、时间挂载、
  `beforeFirstWatch`、汇总；
- 真机 `enrichWatchHistory`：47 条观看记录 → 110 个动作（评论 98：主评论 19 / 回复 43 / 搭话 32 /
  分享 4；收藏 3；发动态 9；仅看 9 条）。当前没有聚拢记录，聚拢分类用单测夹具覆盖；
- `test-client-contract` 断言「操作」「仅看了」、watch-actions 里的聚拢标签；
- `test-host-smoke` 断言 `/watch-history` 返回 `actions` 且每个 item 有 `actions[]`；
- 插件 `npm test`、根 `npm run test:audit` **57/57**。

**边界**：
- 旧评论在 `quota.json` 只存 `note` 前 40 字，页面只能显示预览；不是全文；
- 只统计**能挂到观看记录**的动作；评论了但本地没有观看记录的视频不会出现在这个表里；
- 聚拢分类依赖 `comment.mjs` 的记账字段（parent 且无 reply/mine）；如果以后改了记账方式要同步；
- 宿主是旧代码时，`/watch-history` 不会返回 actions，页面会提示重载；重载后立即生效。
## #47（2026-10-23）观看历史里无 `at` 的旧记忆每次刷新都变成「刚刚看过」（原神/鸣潮那两条）

**发现过程**：做 #46「观看历史的操作」时，真机 `enrichWatchHistory` 看到 `《原神:雨之城》AI演示6`
（BV1Gdnv65ESC）和 `老外看鸣潮…`（BV14enA6uEwu）的观看时间变成 **14:01:28（当前时间）**，
而它们在 `bili-memory.json` 里是 10-20 / 10-21 的旧视频。

**根因**：
- 两条 memory 条目是 `at: ""`（空字符串），同时有 `date: "2026-10-20"`；
- `watch-history.mjs` 的 `normalizeWatchEntry` / `memoryEntries` 用
  `e.at ?? (e.date ? ... : Date.now())` —— **空字符串不是 null/undefined，`??` 不回落**；
- `new Date('')` 无效 → 旧代码回落到 `new Date().toISOString()` = **每次读取都变成现在**；
- 于是这两条旧视频永远排在观看历史最上面、算进「今天」；用户看到的就是「怎么又是它们，
  都看过多少次了」。这不是 B站 推荐，是我们自己的回填时间造出来的假“刚刚看过”。

**修法**：
- `memoryEntries`：`at` 先 `trim()`；有 at 用 at；没有但有 `date` → `date T12:00+08:00`
  并标 `dateOnly: true`；连 date 都没有 → `1970-01-01` + `unknownDate: true`；
- `normalizeWatchEntry` 同步支持 `dateOnly/unknownDate`，不再把空 at 变 now；
- 页面时间列：`dateOnly` 显示「2026-10-20（旧记忆）」，`unknownDate` 显示「日期未知」；
- 「今天 / 最近 7 天」统计不再被无日期旧记忆污染（真机今天从 18 降到 17）。

**验证**：
- `test-watch-history` 新增两条夹具：`at:'' + date` 回填到 10-20 并标 dateOnly；
  `at:''` 无 date → 1970 + unknownDate；
- 真机 CLI：原神/鸣潮不再出现在「刚刚」；鸣潮显示「2026/10/23（旧记忆）」；
- 插件 `npm test`、根 `npm run test:audit` **57/57**。

**边界**：`date` 只有日期没有时刻，回填统一用当天 12:00（仅用于排序/展示，不声称精确时刻）。

## #48（2026-10-23）鱼群识别改成用户可配的「开头 / 中间 / 结尾」三组词

**用户要求**：设置页自己规定鱼群判定关键词，例如 `肥鱼`、`吃白饭`、`DSH`；
规则分三类：① 开头什么词 ② 中间有什么关键词 ③ 结尾什么词。

**实现**：
- QQ `src/fish-guard.js`、B站 `tools/lib/fish-guard.mjs` 都新增 `namePrefixes`（默认 `[]`）；
  `nameContains` / `nameSuffixes` 保留；
- 判定：先豁免，再 **开头 OR 中间 OR 结尾**，任一命中即算鱼；
- 归一化沿用原逻辑：去尾部数字/装饰符/emoji/空白、转小写，所以 `DSH2小助手` 也能被开头 `DSH` 命中；
- 设置页拆成**独立组**「鱼群判定关键词（QQ）」「鱼群判定关键词（B站）」，**默认展开**
  （以前塞在「鱼群保护」组底部且默认折叠，用户找不到）；
  三组输入「鱼名开头词 / 鱼名包含词 / 鱼名结尾词」；默认是 `[]` / `肥鱼` / `肥鱼,fish,鱼`；
- 用户示例不写死：默认不把 `DSH` / `吃白饭` 当鱼，避免误伤真人；要就自己填；
- 群名判断不变：QQ 仍用 `groupNameSuffixes`（实际语义是“群名包含词”，只收紧鱼窝阈值，不把人算鱼），
  UI 文案改成「鱼窝群名包含词」。

**验证**：
- `test-fish-guard`：
  - QQ：`DSH小助手` 在 `namePrefixes:['DSH']` 下 true；`我是DSH小助手` false；
    `爱吃白饭的鱼` 在 `nameContains:['吃白饭']` 下 true；`小助手DSH` 在 `nameSuffixes:['DSH']` 下 true；
    默认不配时 `DSH小助手` false；
  - B站同样三组；
  - `normalizeQqFishGuard({})` / `normalizeBiliFishGuard({})` 的 `namePrefixes` 默认空；
- `test-client-contract` 断言 B站/QQ 都有独立「鱼群判定关键词」组，字段含 `namePrefixes/nameContains/nameSuffixes`；
- 真实配置 `bili.config.json` / `config.json` 已加 `namePrefixes: []`（备份 `namePrefixes-before-*`）；
- 真机截图 `ui-bili-keywords.png`：B站页可见「鱼群判定关键词（B站）」独立组，开头/包含/结尾三个输入框
  默认展开，包含词默认 `肥鱼`、结尾词默认 `肥鱼, fish, 鱼`。

## #49（2026-10-23）逗号分隔的输入框打不出逗号：每次按键都被 split/join 吞掉

**用户反馈**：三个鱼名关键词框能输入文字，但**输入不了逗号**，看起来像只读。

**根因**：
- `Field` 的 `kind: "list"` / `"times"` 直接绑定 `value={raw.join("，")}`，
  `onChange` 立刻 `split(/[,，]/).filter(Boolean)` 再 `join("，")`；
- 用户刚敲下 `，`，onChange 就把空 item 过滤掉、重新 join 成没有逗号的字符串 →
  **逗号永远进不了输入框**。所有 list/times 字段都有这个问题，不只鱼群三个框。

**修法**：
- 新增 `ListInput`：本地保存原始文本 `text`，输入过程中**允许逗号/空 item**；
  - 每次输入把解析结果同步给父组件（保存时数据是新的）；
  - 失焦时再把文本规范化成 `a，b`；
  - 外部配置加载时，未聚焦才同步，不会边打字边重置。
- `kind:"list"` 和 `kind:"times"` 都改用 `ListInput`；
- 开头词 placeholder 改为「点击输入，例如 DSH（逗号分隔）」，避免被误认为只读。

**验证**：
- 真实浏览器 CDP：聚焦「鱼名开头词」→ `Input.insertText("DSH,吃白饭")` →
  输入框值保持 `DSH,吃白饭`，`readOnly=false` / `disabled=false`；
- 失焦后会规范成 `DSH，吃白饭`，保存时数组为 `["DSH","吃白饭"]`；
- `test-client-contract` 断言源码存在 `function ListInput`；
- `ui-bili-keywords.png` 更新为带 placeholder 的可输入状态。

## #50（2026-10-23）Token 防爆破：鱼群守则管密度，管不了“私聊/连发刷 token”

**用户问题**：
- 小肥鱼花 token 的逻辑是什么？
- 别人突然回复很多、私信爆破，会不会烧很多 token？
- 402 群有人要求连回 10 条，会不会很烧？
- 为什么有鱼群守则还能连回 10 条？要不要做限制？

**诊断**：
- 成本单位是**模型回合**，不是单条 QQ 消息。桥接收到消息后 8 秒合批，一次唤醒 = 一次（可能多步）DSH turn；
  当前每步约 13 万 token（99% 是 cache hit）、约 ¥0.006–0.01，一轮约 ¥0.02 量级。
- 已有旧的 `maxWakePerMinute=1`、`maxWakePerHour=12`、`send.maxSendPerMinute=8` / `maxSendPerHour=60`；
  **没有单会话每天上限、没有最小苏醒间隔、没有 token/花费预算**，私聊一个白名单好友持续发消息，
  每小时最多 12 次唤醒；10 条消息若在 8 秒内到达只是 1 次唤醒，分 10 分钟到就是约 10 次。
- 鱼群守则只按**鱼密度**判断，不管“人类让连发 10 条”；鱼密度不够时它根本不触发。
  `qq_send_burst` 原来单次最多 8 条，但可以 8+2 分两次调用/两个回合，所以仍能连回 10 条。
- Token 账本只**统计**（`/api/tokens/*`），没有预算闸；花费到多少都不会自动停。

**实现（Token 防爆破）**：
- 新纯逻辑 `src/token-guard.js`：
  - `maxWakesPerDay`（群，默认 20）/ `privateMaxWakesPerDay`（私聊，默认 10）；
  - `minWakeGapMs`（默认 120000）同一会话两次苏醒至少 2 分钟；
  - `directBypassGap`（默认开）被 @ / 引用 / 叫名字 / 提问 / 拍一拍时越过 2 分钟间隔和旧 1 分钟/12 小时限频，立即醒；
    每日次数和近 24h 花费上限仍生效（不能靠 @ 无限烧）；
  - `maxOutboundPerTurn`（默认 8）一次醒来最多发 8 条，burst/单发/表情/拍一拍/语音都算；
  - `maxDailyCostCNY`（默认 8）近 24h 全局花费上限，超过暂停唤醒。
- 唤醒路径 `sendWakePromptV2`：**先鱼群守则，再 Token 闸**；Token 闸拦下时消息留在未读，不投模型回合。
  最小间隔会延迟重试（最长 60 秒）；每日/花费上限直接停到窗口恢复。
- 发送路径 5 个入口（send-message / send-burst / poke / voice / sticker）：
  **先 fishGuardSendBlock，再 tokenGuardSendBlock**；任何一边拒绝都不发。
  语音 dry-run 不占额度。
- 每次真实唤醒重置 `tokenTurnSent=0`；设置页新增「Token 防爆破」组；配置默认写入 `config.json`。
- 唤醒提示新增：本次最多发 N 条，有人要求连发 10 条/刷屏要拒绝或合并。

**验证**：
- `test-token-guard.mjs`：群 20/私聊 10 上限、2 分钟间隔、近 24h ¥8 上限、单次 10 条硬拦、8 条放行、关闭全放行；
  被 @ 可越过 2 分钟间隔，关掉 `directBypassGap` 后不能越过；
  桥接源码断言「鱼群 → Token」顺序和发送接线数量。
- `test-client-contract` 断言 QQ 页有 Token 防爆破 7 个字段（含 @ 越过间隔）。
- 真实 `config.json` 已启用（备份 `tokenGuard-before-*`）；桥接重启后生效。

## #51（2026-10-23）设置卡补齐：Token 可调、衰减卡不限字数、chat 60% 在线率的真实作用域

**用户要求**：所有相关设置都要出现在设置页可调；衰减卡记忆额度不再卡 10w，改为无上限但给警告值；
确认“每小时 60% 时间不看群”的设置还在不在、是不是没必要。

**实现**：
- Token 防爆破设置组（QQ 页）7 项全部可调：启用、群/私聊每日唤醒、最小间隔、
  **被 @/叫到时越过间隔**、每次醒来最多发 8 条、近 24h 花费上限。
- 衰减卡：
  - `memoryCard.maxChars` 默认改为 **0 = 不限制**；正数也只是软上限，**不再有 100000 硬顶**；
  - 新增 `memoryCard.warnChars`（默认 **60000**）：无上限时按警告值算 80/90/100% 告警，
    **只提醒、不自动压缩/删除**；只有正数上限满 100% 才自动压到 90%；
  - 记忆页新增「容量警告字数」输入；上限输入 `0 = 不限制`；状态条显示“/ 警告值 60000 字”；
  - 全量卡（archive）仍是独立设置：10GB 默认、0=不限，只告警不删。
- “每小时 60% 不看群”：
  - 仍然存在，但只在 **chat 模式**：`chat.presence.onlineShare` 默认 **0.4**（40% 在线 = 60% 不看群）；
  - 另有 `chat.addressFilter.silenceWhenAddressedToOther` 默认 0.4（别人互相说话时 40% 沉默）；
  - **reserved2 完全不使用这两个判定**：它用唤醒触发、鱼群守则、Token 闸、proactive；
    所以 reserved2 日志里的“不插话”不是这条 60% 设置，可能是鱼群保护/Token 闸/AI 自己判断；
  - 设置页把这两个字段放进「群聊（chat 模式）」并写清作用域；想关掉 chat 生物钟就关 `enabled`。

**验证**：
- `test-memory-card.mjs`：`maxChars:-1` 回默认 0；`999999` 原样保留；`maxChars:0,warnChars:2000`
  状态 `unlimited=true`、`ratio=0`、渲染 `上限不限（警告 2000 字）`；
- `test-client-contract`：设置页存在 `warnChars`、`被 @/叫到时越过间隔`、`chat.presence.onlineShare`；
- 真实 `~/.dsh/surfcore/config.json` 已设 `maxChars:0,warnChars:60000`（备份 `memory-unlimited-before-*`）。
- **热重载坑**：`plugin_manager` 关开不会清掉 `src/memory-card.js` 的 ESM 模块缓存——
  配置 API 已经是 `maxChars:0`，但 `memoryCardStatus` 仍走旧函数（0 被 clamp 成 2000、告警 173.9%）。
  解决：插件侧 `memory-card.js` / `store.js` 改用 `import ... from '../../../src/memory-card.js?rev=20261023-unlimited'`
  强制新模块；旧 `card.alerts.level=3` 还会盖住新 `level=0`，所以 `alertLevel` 只在 `status.level>0` 时取旧告警。
  不这样处理就只能重启整个 DSH 进程。

## #52（2026-10-23）表情「按情绪/内容相近自动挑」：编码器会把所有文本压成同一方向

**用户要求**：收藏表情时编号、分情绪、写内容；聊天时情绪或内容相近就自动发对应的一张；已收藏的也补上。

**踩到的坑（按发现顺序）**：

1. **随机投影 + 逐词 LayerNorm 会让余弦饱和**。
   第一版编码器是「哈希词向量 → 随机 Wq/Wk/Wv 多头注意力 → 残差 + 逐词 LayerNorm → 均值池化」。
   实测任意两句话的余弦都在 `0.985` 左右（「抱着碗委屈」vs「办公室吃白饭」= 0.985），
   于是 `contentScore` 永远等于 1，排序只剩情绪分：
   「求求你们别再嘲笑我的回复了」被推成 `#03 杂鱼♡`（嘲讽），而真正贴合的 `#06 哭着求别嘲笑` 排不上来。
   **处置**：换成无训练自注意力（Q=K=V=词向量，`softmax(cos/τ)` 加权、残差保留原词、均值池化 + L2）。
   同一 fixture 下「委屈 vs 委屈」0.688、「委屈 vs 干饭」-0.135，区分度回来了。
   这不是「放弃 Transformer」：注意力仍在算，只是不做会让方向塌缩的逐词归一化。

2. **字符双字切出来的关键词全是噪声**。
   没有分词词典时 `无辜被抓包` 会切出「辜被」、`办公室顶锅` 切出「室顶」；
   这些词一旦进 `keywords` 就会参与关键词命中分，把无关表情顶上来。
   **处置**：关键词**不自动抽取**，只接受模型看图后写的（`qq_collect_sticker` / `qq_sticker_note`）或标签。

3. **编号不能复用已删除表情的空号**。
   一开始按「最小空号」补号：删掉 #03 后再收藏新表情，新的拿到 #03，
   同一个「#03」在两次对话里指到两张不同的图，模型会发错图。
   **处置**：新号 = 现有最大号 + 1；`ensureStickerIndex` 只补不挪。

4. **`isStickerEmotion` 只认英文 key，中文标签被静默丢弃**。
   MCP 参数用的是中文枚举（`z.enum(EMOTION_LABELS)`），`applyStickerNote` 却用
   `EMOTION_BY_KEY.has('委屈')` 判定 → 整条情绪更新被忽略，且不报错。
   单测「applyStickerNote 写入情绪/内容」直接抓出来了；修法是让它走 `normalizeEmotionKey`（含标签映射）。

5. **热更新会吃掉手写标注**：桥接进程把整库读进内存，任何一次同步都整库回写。
   直接改 `state/stickers.json` 会被旧进程内存副本盖回去。
   **处置**：`scripts/tag-stickers.mjs` 支持两种写法——停桥接后 `--apply` 写文件（写前备份），
   或桥接运行中 `--api --apply` 走 `/api/stickers/note` 由桥接自己改内存+落盘。不手改文件。

6. **词表只写「别嘲笑」会漏「别／再」插字**：`求求别再嘲笑我的回复` 在旧词表里只命中「嘲笑」，
   被判成**嘲讽**，于是给「被嘲笑的人」推了 #03 杂鱼♡那张——语义正好反了。
   **处置**：委屈类补 `再嘲笑 / 别去嘲笑 / 别笑我 / 笑话我 / 求求`，并加回归测试。
   注意：**词表在进程启动时加载**，改完要重启桥接才生效（这一条是重启后才发现，所以又欠一次重启）。

**验证**：
- `node scripts/test-sticker-semantics.mjs`：编号幂等/不复用空号、情绪识别（含「别嘲笑」「别再嘲笑」反向说法）、
  编码器确定性与区分度、五类语境的排序、无关话题不硬推、刚发过降权、注入文本长度、无 IO 边界，**26 条**全绿；
- `node scripts/test-stickers.mjs`：按编号 `#02` 查找、情绪搜索、注入块带编号、收藏/笔记通道带 emotion/content，66 条全绿；
- `node scripts/tag-stickers.mjs --api --apply`：桥接运行中写入 8 条，回读 `GET /api/stickers` 全部有情绪+内容。





## #53（2026-10-23）每日 token 额度：8 元闸只在 QQ 进程里，看不见 B站；80% 提醒不能只放内存

**用户要求**：设置页要一个 token 消耗总额管理终端，QQ / B站 分项额度（可填 ¥ 或 token 数）、
一键设 SurfCore 总额；其他花费 token 的行为也要算；当日到 80% 弹窗，每天只提醒第一次，
后续其他分项到 80% 不再提醒（弹窗里要写清）。

**为什么直接加在旧 `maxDailyCostCNY` 上会错**：
- 旧闸只在 `src/bridge.js` 里，用量来自桥接自己的 `tokenLedger`（只 follow QQ 会话）。
  B站 的 `bili-whale*` 会话根本不进这个账本 → 「总额度」永远看不到 B站 花的钱。
- 插件用 `sessionController.list()` 轮询所有会话的 `tokenUsage` 投影也不行：
  list 会返回全部 44 个会话的完整投影（含 `turnOutline`），每 15~30 秒拉一遍很浪费；
  而且累计投影没有逐时明细，拆不出「今天」。
- 80% 提醒如果只存在浏览器 state / 单次请求里：刷新、DSH 重启、插件热重载都会重弹。

**实现**：
- `src/token-budget.js`（纯逻辑 + JSON）：额度结构 `{qq,bili,other,total} × {cny,tokens}`，
  `¥8` / `8元` / `8M` / `2万` / `1.5亿` 解析，双单位各自算比例，80% 提醒、100% 拦截；
  `takeAlert()` 在**返回时**就把当天记录写进 `token-alert.json`，同一天再调用只回 `existing`。
- 插件 `lib/token-budget.js` + `lib/token-usage-pure.js`：监听 `ctx.on('session/event')`，只认 `assistant/message` /
  `assistant/attempt` 的 usage；同一 `(turn,step,retry)` 后到覆盖先到（流式 attempt →
  最终 message 不双算）。分类：`bili-whale*` + 子会话 = B站；黑话会话 = 其他；
  `qq-chat*` / `sessions.json` = QQ；`cordis`/`standard` 用户会话不计入。
  启动回填：`session/list` 累计 + 对当天活跃的 SurfCore 会话 `inspect` 事件，只取事件时间
  ≥ 当天 0 点；同一天热重载只补 `seen` 之后的增量；`seen > 投影`（投影还没反映刚发生的事件）
  时以投影为准，不再 inspect，否则会重复计费（本轮单测抓到过一次）。
- 落盘：`token-usage-daily.json` 给 QQ 桥接读；桥接的唤醒闸门同时看 QQ 分项和总额，
  黑话学习看「其他 / 总额」；快照超过 10 分钟没更新时回落桥接自己的 ledger，不把
  「插件没写文件」当今天 0 花费。B站 调度器在 tick / 私信 / 倾听 / 直播间 / 动态提醒前
  都走 `promptBili` 的额度检查，到 100% 直接不投 prompt（也不会把消息读掉）。
- 设置页新增「Token 额度」页：双单位输入、快捷 +1/3/5/10 元与 +20M/50M/100M/200M token、
  总额一键「只留总额度 / = 分项之和 / 设为 ¥8 / 8M」；80% 弹窗文案明确写「今天唯一一次」。
  QQ 页旧的「近 24h 花费上限」字段删除，避免两处各改一份。

**真机抓到的坑（已修）**：`token-usage-state.json` 里只有 `day=今天`、`sessions={}` 时
（插件在没有 `sessionController` 的冒烟环境写过一份空文件），启动回填会把它当成
「同一天、seen=0」→ 把会话的**整个累计**当成今天：`bili-whale` 创建于 10-20，
436M token 全算进 10-23，总额虚高到 ¥23。修法：只有 `lastSeq >= 0` / `seen > 0` /
`dayTokens > 0` 的会话才算「真的采过」，否则一律走 inspect 回填今天；单测新增
「空 state 不能把累计当今天」用例。清掉坏 state（备份在 `_backups/token-budget-dev/`）
后真机：B站 ¥3.88（54M token）、QQ ¥7.61（117M）、其他 ¥1.69（21M），与桥接
ledger 当天 QQ 117.9M / other 21.4M 对得上。

**验证**：
- `scripts/test-token-budget.mjs`：单位解析、双单位比例、80% 每天只一次、跨天重置、
  坏 JSON 回落默认、旧日用量不冒充今天，77 项全绿；
- `scripts/test-token-budget-service.mjs`：fake DSH 下 QQ/B站/子会话/黑话/用户会话分类、
  当天回填、空 state 不把累计当今天、热重载不重复、attempt→message 覆盖、80% 落盘、
  100% 拦截、快捷加额度，39 项全绿；
- `scripts/test-token-budget-bridge.mjs`：真实 bridge VM 下读插件快照，QQ ¥9/¥8 拦、
  80% 不拦、B站 ¥5 让总额 ¥6/¥5 拦 QQ、B站分项不拦 QQ、黑话「其他/总额」拦、快照过期回落；
- `node scripts/test-token-guard.mjs` / `test-token-usage.mjs` / `test-token-economy.mjs` 保持全绿；
- 设置页真机：热重载插件后打开「Token 额度」，保存 ¥8 / 8M 后 `/dsh-surfcore/api/token-budget`
  返回同一份 limits，QQ 桥接 `/api/tokens/daily` 能看到同一份 usage。

## #54（2026-10-24）群友让小肥鱼「5000 字拆成 10 条」：硬上限有，但模型会先撞墙

**用户问题**：白天 402 群有人让小肥鱼把 5000 字拆成 10 条回复，问这种情况优化了吗。

**诊断**：
- 硬上限其实已经有两层：`maxMessageChars=500`（单条超 500 字直接 400），
  `tokenGuard.maxOutboundPerTurn=8`（一次醒来最多 8 条；数组按长度算，第 9 条 429）。
  所以 10 条**发不出去**，不会真的刷屏。
- 但「优化」只做了一半：提示词只有一句「有人要求连发 10 条/刷屏，拒绝或合并」，
  MCP 工具描述也没写 8 条上限；模型可能先按群友要求拆 10 条撞一次 429，
  再浪费一轮去改，而不是一开始就总结成 1~3 句。
- 一代 `reserved` 的自动 `planSocialTimeline` 分条路径仍不看 `maxOutboundPerTurn`
  （`isSocialEnabled()` 只认 `reserved`）；当前实际模式是 `reserved2`，工具路径已覆盖。

**修法**：
- 唤醒提示词改成明确的场景规则：`5000 字长文拆成 10 条 → 先总结 1~3 句/挑重点；
  确实展开也最多 8 条，每条 ≤500 字`。
- `evaluateOutbound` 的 429 文案、单条超 500 字的 400 文案都补「先总结/挑重点，不要拆成 10 条刷屏」。
- MCP `qq_send_message` / `qq_send_burst` 描述补「一次最多 8 条（数组按条数算），长内容先总结」。
- `dsh/agent-presets/qq-chat-v2/agent.cordis.yml` 的【分条与节奏】补同一条；
  `build-agent-preset-patches.mjs` 重新生成 `plugins/surfcore/presets/qq-chat-v2.patch.yml`
  （顺带修掉之前 HANDOFF 记录的 preset 漂移）。

**验证**：
- `test-token-guard.mjs`：10 条拦截、错误文案含「总结/10 条」、桥接提示词含「5000 字/拆成 10 条」、
  MCP 描述含「一次最多 8 条」、preset 含长文规则；
- `test-agent-preset-patches.mjs` / `test-qq-preset-contract.mjs` / `test-mcp-safe.mjs` 全绿；
- 桥接已重启加载新提示词；当前 `reserved2` 下 10 条数组会在发送前被 token guard 拦下（不发出任何一条）。

## #55（2026-10-24）表情推荐只挂在唤醒提示上：长轮询期间到达的消息永远看不到

**现象**：用户 02:14 在 402 群发「求求别再嘲笑我的回复了」，小肥鱼回了一句「诶？没有嘲笑呀…」，
**没有发任何表情**。用户问「为什么没发现表情包」。

**取证**（`state/tool-calls.jsonl` + `state/qq-activity.log`）：
- 02:14:10 已在 `qq_wait_for_messages(timeoutMs=300000)` 长轮询里；
- 02:14:27 消息入未读；02:14:37 wait 返回；02:14:40 只调了 `qq_send_message`，没有任何 sticker 工具调用。

**根因**：表情推荐只在 `buildWakePromptV2` 里生成。可这条消息到达时**会话已经醒着**，
不会再构建一次唤醒提示——模型是从 wait 的 `newMessages` 里看到消息的，而那个返回里没有推荐。
等于「一半的入口有功能、另一半没有」：群里人接话越快，越容易落在没有推荐的那一半。

**修法**：
- 抽出 `stickerMatchFor(messages)`（bridge 内，读当前 `stickerEntries` + `match` 配置），
  唤醒提示 / `/api/socialV2/wait` / `/api/socialV2/unread` 三个入口共用同一份计算与阈值；
- wait / unread 的返回新增 `stickerMatch: { hint, moods, matches[] }`（有推荐才出现，没有就不占字段）；
- 表情策略提示补一句「新消息是在 wait/unread 返回里看到的话，返回值会带 `stickerMatch.hint`」。

**追加修法（同一天实测）**：4 条消息窗口会把最新一条冲淡——402 群那句
「求求别再嘲笑我的回复了」和前后三条闲聊拼在一起后，#05/#06 都只剩情绪分 0.46 打平；
只看最新一条则 #06 是 0.84、直接排第一。所以 `stickerMatchFor` 改成：
**最新一条 ≥4 字时以它为准，太短（「哈哈」「[图片]」）或算不出推荐时退回 4 条窗口**。
（这条排在 02:23 那次重启之后，要等下一次重启生效。）

**验证**：
- `test-stickers.mjs`：断言 `stickerMatchFor` 存在、wait/unread 都调用它、响应里序列化 `stickerMatch`、
  策略提示提到 `stickerMatch`（71 条全绿）；
- 零副作用验证：带控制台令牌 `GET /api/socialV2/unread?key=group:767098733` → 返回
  `stickerMatch.hint`（情绪 委屈/嘲讽，#05/#06）与 `matches[]`，没有真发任何 QQ 消息；
- 离线对比：最新一条 → `#06(0.84)`；4 条窗口 → `#05/#06 均 0.46`，这解释了聚焦最新一条的必要性。

**教训**：**「每轮注入」不等于「每个入口注入」**。凡是模型可能在不同时机看到新消息的路径
（唤醒 / wait / unread / recent），都要各自问一句「这条路径能看到推荐吗」。

## #56（2026-10-24）推荐送到了，模型自己否决了：软策略的措辞会抵消整条链路

**现象**：修完 #55、重启后用户又让群友 @ 她发「求求别再嘲笑我的回复了」，她仍然只回文字：
「诶，这句今晚第二次出现了呀，wo真的没嘲笑过谁 mer」。用户判断功能还是没生效。

**取证（这次直接读了 DSH 会话日志）**：
- 会话日志是**多帧 zstd**：`zlib.zstdDecompressSync` 只解第一帧（1MB 文件只出 208 字节）。
  得按魔数 `28 B5 2F FD` 切帧逐段解压再拼接（`--D-deepseekwork-surfcore--/session-<id>/session.v4.jsonl.zstd`，
  849 帧 → 2.3MB 文本）。
- `tool/result` 里确实有 wait 返回的 `stickerMatch`，含 `#06 委屈 … score 0.831` —— **链路是通的**。
- 她下一步的 reasoning 原话：
  「Or reply with the #06 sticker itself (matching emotion 委屈) — that would be cute … Hmm, sending #06
  might read as mocking/repeating. Better: text …」→ 于是只发了文字。

**结论**：不是检索问题，是**措辞问题**。原来的提示只写了「真的贴合才发一张…情绪不对就别硬发」，
模型把「发这张写着『别再嘲笑我』的表情」解释成「像在嘲讽/复读」，主动放弃。

**修法**：
- `buildStickerMatchHint` 按分数分档：**top ≥ 0.72** 时改成强措辞——点明贴合度（0.83）、给出
  `qq_send_sticker stickerId="#06"`、并说明「接梗/被吐槽/撒娇时发这张本身就自然，不是只有文字才叫回复；
  严肃/敏感、对方真生气时才别发」；低于阈值仍用保守措辞，避免硬凑。
- 表情策略提示 + preset 第 14 条补同一层判断：**分 ≥0.7 时发那张通常比重复同一句更自然；
  复读台词/玩梗时发表情是接梗，不算嘲讽**；文字和表情是两条独立消息，可以都发。
- `build-agent-preset-patches.mjs --check` 通过（patch 文件用同文替换，不再重写整个 25KB 产物）。

**验证**：
- `test-sticker-semantics.mjs`：高分 0.83 → 提示必须含「很贴合」「0.83」且**不含**「真的贴合才发一张」；
  0.4 分 → 保留保守措辞（28 条全绿）；`test-stickers.mjs` 71 条全绿；
- 待重启后真机复看：同样的句子再来一次时，她应该会考虑直接发 #06。

**教训**：
1. 「推荐送达」不等于「行为发生」。软策略默认是**不给模型添麻烦**，所以模型会用最保守的解释抵消它；
   要它行动，就得写清「什么场景下发是对的、这样做不算什么」。
2. 排查这类问题**不要只看桥接日志**：桥接只记工具调用，不记模型看到了什么。会话日志里才有 reasoning。

## #57（2026-10-24）上线补历史消息：不能直接把 QQ 历史记录灌进未读

**现象/需求**：用户要求「每次上线查看历史消息，防止错过群友历史消息，设置里可关、默认勾选打开」。
桥接/QQ 掉线期间 SnowLuma 不会补发消息；这些消息只存在 QQ 服务端，必须在重新上线时主动补。

**坑（实现时差点踩的）**：
- **不能把「现在」当水位**：如果 fetch 结束后用 `Date.now()` 做下一次检查的水位，
  fetch 期间到达的实时消息会被误判成旧消息；反过来，只用 `lastIncomingAt`（本地到达时间）
  又会比 QQ 消息的 `time` 晚 1~3 秒，把停机前最后几条漏掉。现在取
  `max(lastIncomingAt, lastHistoryMessageTime, recent[].time) - 5 秒`，重复靠 messageId 兜底。
- **水位必须在 fetch 之前算**：fetch 期间可能来实时消息，把 `lastIncomingAt` 推到现在；
  fetch 后再算会把真正错过的历史消息判成「太旧」。
- **未完成 bootstrap 的会话不能补**：缺少二代协议说明和初始提示词时直接唤醒，
  模型不知道怎么发 QQ 消息，会白花一轮 token。
- **自己的旧消息不能进 unread**：只进 recent 补上下文；否则 AI 会去「处理」自己以前说的话。
- **黑名单的人不能借历史消息绕过**：`deny.users` 必须在补历史时再过滤一次（不能只依赖入站路径）。
- **重连风暴**：SnowLuma 反复重连时 `open`/bot_status 会连续触发；用 10 秒节流 +
  历史接口失败每 action 5 分钟只报一次，避免刷日志和反复唤醒。

**验证**：`node scripts/test-history-catchup.mjs`（纯逻辑 + 真实 bridge.js VM 夹具网关）；
`node plugins/surfcore/scripts/test-client-contract.mjs`；`node scripts/test-console-static.mjs`。

**教训**：**「历史消息」是外部时间轴的数据，不是本地队列**。任何从 QQ 服务端补数据的功能，
都要同时处理「本地水位」「远端时间」「重复 id」「黑名单」四件事，缺一个就会重复/漏/绕过。

## #58（2026-10-24）「定期主动找主人」不能押一次性长定时器，也不能用 prompt 的返回值当回执

**现象/需求**：用户要求做一个「定期、稳定」的目的机制——从近期 QQ + B站 记忆里提炼目的，
主动私聊主人（分享🧀 / 索取）。第一版很容易写成：
`setTimeout(几小时)` + `await api.sessions.prompt()` 看返回的 `command.text` 判断她说了什么。

**根因（两个都真的会坏）**：
- **一次性长定时器会丢枪**：桥接重启、系统时钟跳变、DSH 掉线重连都会让 `setTimeout` 失效；
  早安问候已经因此丢过 08:00（#41）。定期主动不能用「排一次、睡到点」，要用
  **60 秒 tick + `nextFireAt` 落盘**：每次 tick 重新看现在该不该出发，重启后自然接上。
- **`sessions.prompt` 的 `command.text` 不是她的回复**：DSH apiproxy 的
  `sessionPromptValueSchema` 写得很清楚——`command` 槽只在 prompt 被当成 slash command 派发时才出现。
  普通 prompt 返回 `{accepted:true}` 就结束。她的最终文本来自事件流的 `turn/end`（`ended.text`），
  是否真的发到 QQ 来自 `recordSentMessagesV2` / `sendToolSucceeded`。
  拿 `command.text` 当回执，结果会是「永远没有回执」。

**处置**：
- `src/purpose-engine.js` 只做纯逻辑；`src/bridge.js` 每 60 秒 tick，`state/purpose-outreach.json`
  存 `nextFireAt / countToday / attempts / pending / history`，重启后 `interrupted` 而不是补发。
- 投递走普通 `deliverPrompt`（不冒充 `sendWakePromptV2`）：后者会塞 `pendingWakeKeys`，
  回合结束会追一条「你还没设置唤醒配置」的提醒，对主动回合是多余的一轮 token。
- 回执两个来源：`recordSentMessagesV2` 里记 `sentTexts`；`turn/end` 时 `notePurposeTurnEnded`
  用 `sendToolSucceeded || sentTexts.length` 判 sent，用 `ended.text` 解析内部备忘（目的/待续）。
- 20 分钟 watchdog：DSH 丢了 `turn/end` 也不会把状态永远卡在 pending。

**验证**：`scripts/test-purpose-engine.mjs`（排程/闸门/状态迁移）+
`scripts/test-purpose-wiring.mjs`（VM 夹具：预览不投递、强制投递、发送/回合回执、安静时段、关开关）。

**教训**：**「主动」的稳定性不来自定时器本身，来自「可重算的排程 + 可对账的回执」**。
任何说「她几点会说话」的功能，先问：重启后怎么恢复？她到底发没发，我从哪知道？

## #59（2026-10-24）只读预览顺手创建了会话状态，还把会话令牌拼进了预览文本

**现象**：目的机制加了一个「预览这一轮（不发）」按钮，方便调素材/提示词。
第一版预览直接调 `getSocialV2State('private:owner')`，并把 `buildPurposePrompt` 的完整结果返回给设置页。

**根因**：
- `getSocialV2State()` 不是纯读：没有状态时会 **新建** 会话状态，并顺手
  `scheduleProactiveCheckV2` / `setupSleepTimerV2`。预览一次就多出一套定时器和状态，违背「只读」。
- 提示词里必须带 `【会话令牌】<agentToken>` 她才能调发送工具；把完整 prompt 回给前端，
  等于把令牌放进设置页 DOM/截图/浏览器日志。令牌是会话级凭据，不能因为「本地页面」就裸奔。

**处置**：
- 预览时若 `socialV2.conversations` 里还没有 owner 会话，就用一个临时空对象（token 为空），
  只有真正投递才 `getSocialV2State()` 创建。
- 预览返回前 `prompt.split(token).join('********')`；真投递仍用完整 prompt。
- 预览不写 `purpose-outreach.json`、不建 DSH 会话、不发 QQ；`test-purpose-wiring` 用
  「调用前后 state 字符串完全相同」钉住。

**验证**：`node scripts/test-purpose-wiring.mjs`；
真机 `POST /api/purpose/preview` 返回里搜不到 32 位十六进制令牌。

**教训**：**「预览」必须是零副作用**。它只要碰了 `getState`/`ensureSession`/`save` 就不叫预览了；
任何回给设置页的文本，先过一遍密钥脱敏（沿用 `redactKnownTokensOnly` 的思路）。

## #60（2026-10-24）「群友想玩」不等于「我想玩」：一次视频也不能变成永久欲望

**现象/需求**：目的机制第一版按关键词从素材里抽「想玩/想装/关系」，很快被指出：
群友在聊游戏，凭什么推断小肥鱼自己想玩？B站 一个视频说插件好用，凭什么变成她想装？
人机爱情内容，凭什么直接产生「寂寞」？这三件事都缺了「归属 / 证据强度 / 时间」。

**根因**：
- **归属没分开**：`member`（群友）、`media`（视频里的人）、`owner`（主人）、`self`（她自己）
  是四个不同的行为主体。关键词层只看到「游戏/插件/爱情」，就把它们都算成她的欲望。
- **观察当成了结论**：看到一条视频 = 接触过；不等于认同、想要、决定。需要 `confidence`。
- **一次输入会永久化**：如果每轮都把同一批素材重新算一遍并 +0.02 置信度，
  看过一次的插件会慢慢变成「她一直想装」。
- **情绪没有前提**：内容里有「爱情/机器人」就写「寂寞」是演出来的；寂寞应该是
  「陪伴需求 ×（期望互动 − 实际互动）」的结果。

**处置（2026-10-24 v2 架构）**：
- 新增 `formGoalHypotheses`：事件先做主体识别（`owner/member/media/self`），再产出**目标假设**：
  `owner + domain + object + intent + confidence + value + urgency + risk + action + nextStep + status + evidence`。
- 归属规则：群友的目标先记 `owner:'member'`（“群里在聊…想跟主人说说”）；
  同一话题重复 ≥3 次 / 直接点她 / 过去有同类兴趣，才生成 `owner:'self'` 的“我也有点想试”。
  视频先记 `owner:'media'` 或低置信 `self`；`install` 的 `risk=0.55`，只能 `ask` 问主人。
- 置信度 = 自我相关 + 重复度 + 语气 + 来源可信度 + 驱动；单条视频约 0.45~0.5，
  重复 3 次约 0.6+，主人直接说约 0.78。
- 观察账本 `state.observations` 带 `seenIds`：同一批旧素材每轮都在窗口里，但只有**新 id**
  才抬置信度；`mergeGoal(..., {fresh})` 明确区分。
- 反馈：下一轮扫主人 `lastActionAt` 之后 24h 的回复，正面→confirmed、负面→rejected、
  两次没回音→衰减/expired；`lastFeedbackAt` 保证同一条回复只结算一次。
- 情绪：`appraiseMaterial` 增加 `subject`/`hoursSinceMaster`/关系前提，
  `lonely` 只在「自我相关/关系内容 + 主人确实很久没出现」时出现。

**验证**：`test-purpose-engine` 的「目标假设」组（群友目标不冒充我的、单次视频低置信、
重复才升级、人机关系 lonely、正面/负面反馈）与「注意力/驱动」组；
`test-purpose-wiring` 覆盖真实 bridge 的预览/投递/回执。

**教训**：**任何“她想要…”的推断，都必须回答三件事：这是谁的目标？证据有多强？多久没更新？**
没有归属/置信度/衰减的「目的」，最后一定会变成替用户编欲望。

## #61（2026-10-24）「载入人格卡/记忆卡」不能只是往提示词里塞一段字

**现象/需求**：用户要求「以后只要将人格卡和记忆卡载入这套机制，就能生成动机」。
第一版目的状态写死在 `<仓库>/state/purpose-outreach.json`，人格卡只在 prompt 里有一行角色名，
记忆卡只取 30 天内的重要记录。

**根因**：
- **状态没按角色隔离**：换角色后旧角色的 `goals/drives/pending` 还在，新角色会继承上一个角色的欲望；
  这比“没有动机”更糟——她会用新人格说旧角色想做的事。
- **人格卡只给了名字**：名字不构成动机先验。爱玩/黏人/技术宅/爱分享的人，在同一份素材下
  应该被不同需要打动；只注入名字等于所有人共用一套默认驱动。
- **记忆卡只取近期**：钉住/锚点/初次相遇往往超过 30 天，但它们才是“我是谁、我和主人经历过什么”的骨架；
  只按时间窗口会把人格最重要的记忆筛掉。
- **没有新素材就跳过**：`minMaterials=2` 会把“刚载入角色、还没聊天”这种最该生成起始动机的场景直接拦掉。

**处置**：
- `PURPOSE_FILE` 启动时按 `readCurrentCharacter()` 解析到
  `~/.dsh/surfcore/characters/<id>/purpose-outreach.json`；无角色回退 `state/`。
  换角色会停桥接重启，因此不会继承旧状态。
- `analyzePersona(personaText)` 从人格卡抽 9 维 `bias`，`deriveDrives` 加到驱动上；
  `formGoalHypotheses` 生成 `source:'persona'` 的起始目标（置信度 0.30~0.45）。
- 人格卡全文进提示词「人格卡（你是这样的人）」；换人格卡后语气/称呼/先验一起变。
- `collectMaterials` 对 `pinned/anchor/isInitial/firstMet` 的记忆**不按 30 天截断**（最多 8 条）；
  记忆目标用「突然想起…」而不是统一“想找主人说话”。
- 有 `persona.hasText` 或记忆素材时，`minMaterials` 不再拦；没有新 QQ/B站 消息也能生成起始动机。

**验证**：`test-purpose-engine` 的「人格卡 → 动机先验」组（人格 bias / 无素材也能生成 persona goal /
重复跑不抬置信度 / 400 天前的 pinned 记忆仍进素材）；`test-purpose-wiring` 覆盖真实 bridge。

**教训**：**“载入人格卡和记忆卡”不是 prompt 注入，而是三件事：状态边界（按角色）+ 动机先验（bias）+
记忆骨架（pinned/anchor 不随时间窗口消失）。** 少一件，换角色就会变成穿着新人设演旧欲望。

## #62（2026-10-24）「是否启动」只加了开关没接管生命周期 = 开关在骗人

**现象/需求**：用户要求「不是所有用户都想同时开 QQ 或者 B站，设置页 QQ 和 B站 分别加一个
是否启动选项」；随后补充「启动与人格卡里的一键启动保留，人格卡已经在角色栏了不要重复显示，
启动优化成一键启动 / 启动QQ / 启动B站」。

**根因（三个都不是 UI 问题）**：
- **B站 生物钟一直是无条件启动的**：插件 `apply()` 里直接 `startSchedulerNow()`，没有任何
  「B站 是否启用」的读取点。只在设置页画一个 switch，关掉后它照样 tick/唤醒，用户会以为
  「关了还在跑」。
- **QQ 的自动启动是另一套字段**：`bridge.autoStart`（默认 false）控制插件加载时是否拉桥接，
  但「启动 QQ」按钮、`start-all`、2 分钟自愈轮询各自读它/绕过它。再新增一个 `qq.enabled`
  就会出现三份真相，必然漂移。
- **「保存」和「启动/停止」脱节**：开关只写配置文件、不执行副作用，用户关掉 QQ 后桥接继续跑，
  或者打开 B站 后要等下次 DSH 重启才生效，体验上等于没生效。

**处置（单一真相 + 全入口收口）**：
- 合体层 `~/.dsh/surfcore/config.json` 新增 **`platforms.start.{qq,bili}`**（默认都 true），
  是唯一真相。旧 `bridge.autoStart` 只在 `readUnified()` 里做一次迁移
  （显式 `platforms.start` > `bridge.autoStart` > `platforms.enabled` > 默认），
  保存时再把 `bridge.autoStart` 镜像回去，保证降级/手工读配置也一致。
- 宿主所有启动入口统一读它：
  - 插件加载：`startSchedulerNow()` 先查 `bili`，关掉时返回 `{running:false, disabled:true}`；
    `maybeAutoStartBridge()` 与 2 分钟自愈先查 `qq`；
  - 「一键启动」只拉开关为开的平台，QQ 关时不打开 SnowLuma；
  - 概览「启动QQ」「启动B站」、QQ 卡片「启动/重启」在开关关闭时直接 409，不偷偷拉起；
  - 保存配置时比较前后值：关掉就 `stopBridge()` / `scheduler.retire()`（B站 会取消在途回合），打开就拉起，
    不是等下次重启（`SURFCORE_SKIP_AUTOSTART=1` 的测试环境跳过真实进程）。
- 设置页：QQ / B站 页顶部各一张「是否启动」卡片（写 `unified.platforms.start`）；
  概览启动卡只留 **一键启动 / 启动QQ / 启动B站** 三个按钮，并显示两边开关状态/跳转入口。
- **「启动 B站」只控制 B站 生物钟**（自主浏览/评论/动态）。B站→QQ 的定时分享、B站 记忆刷新
  在 QQ 桥接进程里，是独立任务（`biliBridge.*`），不会因为关生物钟就停；卡片文案必须写清楚，
  否则用户会以为「B站 关了」但 07:00 还在群里发视频（这是本轮刻意划的边界，不是遗漏）。
- 人格卡去重：概览删掉「人设卡」卡片与旧「启动与人格卡」里的路径输入；路径编辑挪到
  「人设」页（角色页仍负责角色包与快照），避免一处数据三处显示。

**验证**：
- `scripts/test-platform-start.mjs`：迁移优先级、显式值、保存镜像旧字段、非布尔收敛；
- `plugins/surfcore/scripts/test-platform-start-host.mjs`：mock 宿主里开关关掉 → 生物钟不启动、
  `/overview.platformStart` 正确、`start-qq/start-bili` 409、`start-all` 跳过；
- `plugins/surfcore/scripts/test-client-contract.mjs` 钉住两个开关与三个按钮的文案/接线；
- `test-host-smoke.mjs` 钉住 `/config` 与 `/overview` 必须返回 `platforms.start` / `platformStart`。

**教训**：**「是否启动」不是配置文件里的一个布尔值，而是所有启动入口（加载 / 一键启动 /
单平台按钮 / 自愈轮询 / 保存）都认同一份状态，并且开关变化时真的停/起。**
只加 UI 不加生命周期，比不加更糟——用户会相信它。

---

## #63（2026-10-24）「不回复」不能靠硬静音：收尾判断、close 与潜水是三个概念

**现象/需求**：用户希望弥发完「嗯」之后判断这段对话能不能结束，能结束就不用再回，
「不用每一句都回复」；并且明确「结束不是终止，而是一段信息输出的合理结束，和下次更好的开始」。

**根因（不是模型不听话，是机制缺了三个东西）**：
- **没有「结束」这个动作**：二代里只有 `qq_mark_read`（划走）和 `qq_set_wake_config`（潜水）。
  mark_read 的语义是「看过」，不留下任何结束点；模型收尾后下次醒来完全不知道上次收在哪。
- **收尾被绑在「潜水」上**：`preSleepWaitBlockedV2` 要求设置潜水/收尾前先等 5 分钟观察。
  用户想要的是「发完最后一句就自然停住」，不是「先等 5 分钟再进入长期静默」。
  两者混用，模型只有两个坏选择：每句都回，或者为了收尾硬等 5 分钟。
- **提示词在反向拉**：preset 原来写「回复后不要立刻结束，先等可能的回复」。
  这句话在「等对方补充」时是对的，在「双方已经收尾」时就是逼她硬续。

**处置（把三个概念拆开）**：
- **判断**：`src/conversation-closure.js` 只算信号、只给建议（continue / linger / close）。
  看六项：我最后一句是否收尾、对方最后一句的性质、我的表达欲（pendingThought / 待追问）、
  话题闭环、未答提问、节奏疲劳。代码不替模型做决定，避免硬静音误杀真正想说的下一句。
- **close**：`qq_close_conversation` = 不发消息 + 写 `closure`（summary / nextOpening / reason）
  + 按**已展示的安全水位**确认已读 + **保持 wakeConfig** + **豁免沉睡前观察**。
  它不是潜水：对方再找你、开新话题、私聊都会照常醒；下次唤醒提示带「上次这段怎么收的 / 下次可以怎么接」。
- **潜水**：仍然需要沉睡前观察。`preSleepWaitBlockedV2` 一个字没改，close 只是不经过它。
- **硬闸**：对方最后一句明确在提问/求助、且还没答时，close 返回 409，要求先回。
  这是把「不想回」和「逃避」分开：前者可以收尾，后者必须先答。
- **冷却**：只压 `probability` / `replyCheck` / `proactiveCheck` 三类软唤醒；
  `atMention / nameMention / question / keyword / poke / speaker / private` 一律不压。
  收尾不是把人关掉。`replyCheck` 在 close 时直接取消，否则 30 秒后自己把自己叫醒。
- **重开**：私聊对方一开口就算新的开始；群聊只有直接叫到/引用/提问/道别才重开，
  普通闲聊不重开——否则「收尾冷却」等于没设，还是会每句都醒。

**验证**：
- `scripts/test-conversation-closure.mjs`：用户原场景（「扯平啦」→「嗯嗯」→ close）、
  对方提问 → continue + closeGate 拦截、道别、pendingThought 阻止结束、群聊 30 分钟冷场、
  冷却只压软唤醒、记录归一化；
- `scripts/test-closure-wiring.mjs`：真实 bridge.js 里 close 不改 wakeConfig、不发消息、
  豁免 preSleep、409 拦截、提示词注入、私聊/群聊重开边界、关掉开关 403；
- `scripts/test-qq-preset-contract.mjs`：新增收尾契约断言。

**教训**：**「不回复」必须有合法出口，而且这个出口不能借用「潜水」的语义。**
一旦把「这一轮不说了」和「以后都别叫我了」混成一个动作，模型就会在
「每句都回」和「永久静默」之间二选一。分开之后，结束才真的成为「下次更好的开始」。

---

## #64（2026-10-24）设置页「看着能点、其实改不动」：字符串路径被按字符拆成 n.i.g.h.t...

**现象**：用户反馈 B站 页「作息窗口」**加不了、删不了、时间也改不了**，鼠标点下去没反应，
输入框像只读；勾「白名单为空时全部放行」和记忆页「同步 B站记忆到 QQ」也一样点了弹回。
用户补了一句「之前也出现过不少次输入框不能输入」，说明不是单个卡片的问题。

**根因（两层，都是“绑错状态”）**：
- `setPath(obj, path, value)` 只接受数组路径。`WindowsEditor` 和 QQ 白名单却传了字符串
  `"night.windows"` / `"allowAllWhenEmpty"`。旧实现用 `path.length` 和 `path[i]` 遍历，
  于是把字符串按字符拆开，生成了
  `{ n: { i: { g: { h: { t: { ".": { w: { i: ... } } } } } } } }` 这种垃圾嵌套键。
  `dirty` 会变 true（所以“看起来改了”，甚至可能把垃圾写进配置），但
  `cfg.night.windows` / `cfg.allowAllWhenEmpty` 根本没变；下一次渲染读回旧值 → 弹回。
- 记忆页 B站→QQ 开关是 PITFALLS #16 的翻版：`checked` 读服务端快照
  `qq.biliBridge.memory.enabled`，`onChange` 却只写 `unified.__biliToQqToggle`，
  两份状态不同源，点完立刻被旧快照覆盖。

**影响面**：所有走 `setPath` 的自定义编辑器。表面是 B站 作息窗口，实际同一类写法
（字符串路径 / checked 与 setter 不同源）都可能静默失效；只跑渲染断言或截图看不出来。

**修法**：
- `setPath` 增加 `pathKeys()` 归一化：数组直接用，字符串按 `.` 拆；空路径直接拒绝。
  即使以后有人再传字符串，也不会生成垃圾键。
- 调用点同时改成数组：`set(["night","windows"], v)`、`set(["allowAllWhenEmpty"], v)`。
- 记忆页开关改为绑定可编辑草稿 `biliToQqDraft`（优先 `unified.__biliToQqToggle`），
  保存时再由 `normalizedQq` 落到 `biliBridge.memory.enabled`。
- 「只同步这些群」从每次按键 `split/join` 改成 `IdListEditor`（PITFALLS #49 的同类问题：
  逗号会被吞，第二个群号永远输不进去）。
- 作息窗口最后一个的删除按钮保留禁用（服务端要求至少一个窗口），但 `title` 写清原因。

**验证**：
- `test-client-contract.mjs` 新增：`setPath("night.windows", ...)` 必须展开成
  `{night:{windows}}`；禁止再出现 `set("night.windows")` / `set("allowAllWhenEmpty")`；
  记忆开关必须绑 `biliToQqDraft`；`includeGroups` 必须用 `IdListEditor`。
- `test-admin-config-api.mjs` 新增：POST `/config` 写入两个作息窗口 → 读回文件断言
  数组原样落盘，同组 `skipChance` 不被截断。
- 新 `npm run ui:audit`（`plugins/surfcore/scripts/ui-settings-editable.mjs`）：
  真机逐个标签页、逐个非只读控件真实聚焦/输入/点击，然后「撤销改动」。
  本轮结果：**12 个标签页、782 个可编辑控件全部能改动**；仅 3 个故意只读
  （B站 自己的 mid / 昵称、写日记锁定开）。
- 手工复验：作息窗口 9→10→9、时间 `10:00`→`10:0021`；白名单全放行 true；
  记忆开关 false；群号输入 `，987654321` 出现 chip。

**教训**：**“能渲染”不等于“能编辑”。** 受控组件的 `value/checked` 和 `onChange`
必须来自同一份可编辑状态；路径工具必须对“字符串 vs 数组”有明确契约。
以后新增自定义编辑器，先跑一遍 `npm run ui:audit`，别等用户来点。

---

## #65（2026-10-24）设置页信息架构清理：一个概念只留一个入口，首屏只留关键设置

**需求**：用户要求「人设和角色这两个栏目重复了，把相同的功能去重、不同的合并；
其他布局也看看，每个栏位里留下最关键的几个设置，其余全部折叠成高级设置」，
同时把整个项目的残留/无用/多余/重复清一遍。

**判断（不是简单挪位置）**：
- **人设 / 角色是同一个概念的两面**：`PersonaTab` 编辑 `unified.persona.file` 和当前人格卡，
  `CharactersTab` 管理角色包/快照，并另给一个「编辑人格卡」按钮跳去人设页。
  同一份 `persona.md` 两个入口，迟早漂移；而角色切换本来就必须连人格卡一起换。
  ⇒ 合并成一个「角色」页：上面切角色，下面直接编辑当前角色的人格卡。
- **每个标签页平铺 100+ 参数**：QQ 页 200+ 个参数、B站页 90+、记忆页 50+，
  关键卡片（管理员/白名单/启动/作息）被淹在后面；用户每次都要滚很久。
  ⇒ 首屏只留「启动 / 管理员 / 白名单 / 作息 / 分享 / 同步开关」等关键卡，
  其余统一收进该页的「高级设置」抽屉；抽屉里的分组用 `collapsible:false`，避免折叠套折叠。
- **清理时发现的真 bug**：Token 页「只留总额度」按钮引用了不存在的 `onReplace`
  （TokenTab 只有 `onChange`），点击会抛 ReferenceError；角色页 `detail` 状态只写不读，
  还多打一次 `/characters?id=` 请求；多个组件有未使用 props/imports。
- **死代码**：`src/core/session-router.mjs` 只被自己的测试引用、没有接进 bridge
  （QSH P2 的 staged module）；仓库里还有空文件 `相关代码...`、`presets/.wtest`、
  已删除「人设」页对应的 `ui-persona.png`；真实 `bili.config.json` 里还有旧 setPath bug
  留下的顶层垃圾键 `n`（`n.i.g.h.t...`，9 个窗口在 `night.windows` 里未丢）。

**处置**：
- `PersonaEditor` 嵌进 `CharactersTab`；`TABS` 删除 `persona`；概览/QQ/B站/README 文案同步。
- 新增 `AdvancedSettings` + `Section.collapsible`；QQ/B站/记忆/对齐/扩展/诊断/概览/角色
  分别收敛首屏，其余进高级设置。记忆卡拆成 `view="summary"` / `view="details"` 两态。
- `TokenTab` 的 `onReplace` 改成 `onChange`；删除 `detail` 状态、未用 props、核心模块未用 imports；
  `session-router` 两文件移入 `_backups/repo-cleanup-20261024/` 后从源码移除；
  空文件/`.wtest`/`ui-persona.png` 同样备份后删除。
- 真实 `bili.config.json`：备份到 `~/.dsh/surfcore/backups/bili.config.json.bak-garbage-n-*`，
  只删除形状匹配的顶层 `n`，`night.windows` 9 个窗口原样保留。

**验证**：
- `npm --prefix plugins/surfcore run ui:audit`：**11 个标签页、785 个非只读控件全部能改动**，
  0 失败；仅 3 个故意只读（B站 自己的 mid/昵称、写日记锁定开）。
- `test-client-contract.mjs`：新增「人设/角色合并」「高级设置存在」「无 persona tab」
  「无 onReplace」「记忆 summary/details」等断言；
- `npm test --prefix plugins/surfcore`、`npm run test:audit` 全绿。

**教训**：**一个概念只留一个入口；首屏只放“用户每周会改”的设置，其余默认折叠。**
清理死代码时先隔离再删；发现“按钮引用了不存在的变量”这类问题时，先补契约测试，
否则下一次改布局还会静默坏掉。

## #66（2026-10-25）桌宠进程不能调用 `/dsh-surfcore/api/*`；也不能把设置页和桌宠混用一套鉴权

**现象**：桌面端（独立 Electron 进程）用 `curl` 打 `http://127.0.0.1:<DSH>/dsh-surfcore/api/overview`
一律 **401**，而同一个地址在设置页里正常。

**根因**：`lib/index.js` 的 `route()` 在 handler 之前调 `ctx.get('connection').requestRejection(req)`。
它认的是 DSH 浏览器会话；桌宠进程没有那个 Cookie，也没有合理的办法拿（桥接要离线铸签名密钥）。
给桌宠塞 DSH 令牌既脆弱又扩大攻击面。

**处置**：桌宠单独走 `/dsh-surfcore/pet-api/*`（`lib/pet-api.js`）：
- 只接受 `127.0.0.1 / localhost / ::1`；
- 写操作必须 `application/json` + 同源或没有 Origin；
- 必须带 `x-pet-token`（音频用 `?token=`），令牌落 `~/.dsh/surfcore/pet/host-token`（0600）；
- 插件把 `{baseUrl, token, api}` 写进 `~/.dsh/surfcore/pet/host.json`（启动一次 + 每 2 分钟），
  桌宠重连时重读，DSH 端口漂移也能自动接上。

**验证**：`curl /pet-api/health` 带令牌 200、不带令牌 401；设置页 `/api/pet/status` 仍走会话鉴权；
`test-client-contract` 钉住 `path: petApi.prefix` 与 `createPetApiService`。

**教训**：**同一进程里的“设置页 API”和“外部本地客户端 API”是两种信任模型**，别为了省事共用一个前缀；
共享令牌要落到只有当前用户能读的文件里，并写一个发现文件让客户端自己找。

## #67（2026-10-25）插件重启后事件游标会“卡死在旧水位”，气泡永远收不到主动搭话

**现象**：桌宠先连上，插件热重载（关/开 `include:surfcore`）之后，Ctrl 再触发 `/purpose/run`：
接口返回 `ok:true`、消息也进了历史，但桌宠不弹气泡。日志里没有任何报错。

**根因**：事件队列的 `bootId` 每次插件启动都会变、事件序号从 1 重新开始；而桌宠保存的是**上一次**
的水位（例如 12）。它继续带 `?since=12` 轮询，新插件当前的 `eventSeq` 只有 1~3，
`events.filter(id > 12)` 永远为空 —— 既不报错也不返回事件。客户端只在 `bootId` 变化时重置了
`cursor = payload.cursor`，但服务端在“没有事件”时把 `cursor` 原样回成了客户端传来的 12。

**处置**（两边都改，缺一不可）：
- 服务端 `pet-chat.poll()`：`since > eventSeq` 视为旧 boot 的游标，直接回 `{cursor: eventSeq, events: []}`；
- 客户端 `surfcore.ts`：`bootId` 一变就设 `needsBaseline=true`，下一轮用**不带 since** 的请求重新取水位；
  这一轮即使返回了事件也不重放旧壳。

**验证**：`test-pet-chat.mjs` 钉住 `poll({since: 99})` 返回当前水位而不是死等；
真机：热重载插件 → 等在线 → `/purpose/run` → 气泡出现（文本/语音都验过）。

**附带修掉的**：气泡「鼠标悬停暂停自动隐藏」会让新消息一直排在队列里（用户手停在气泡上就再也看不到下一句）。
改成**新消息立刻顶掉旧气泡**；悬停只影响自动隐藏，并加 60 秒硬上限。

**教训**：**任何“游标 + 序号”协议都要规定“客户端游标大于服务端水位”怎么办**；
热重载/进程重启是常态，不是异常路径。队列型 UI 的“暂停计时”要有硬上限，否则等于关闭通知。

## #68（2026-10-25）插件热重载不会让 `src/memory-card.js` 生效：改了引擎必须 bump `?rev=`

**现象**：给桌宠加记忆摄取（`platform=pet`）后，插件日志明确显示「记忆卡已整理」，但新增的桌宠对话
全部按 QQ 语义入库（`source=qq-owner`），`fromPet` 一直是 0。直接跑 `node scripts/test-memory-card.mjs`
却全绿——代码本身没问题，是**运行中的插件用的是旧模块**。

**根因**：DSH 的热重载只会重新加载插件的入口模块；插件对 `src/memory-card.js` 的 import 带了固定的
cache-busting 查询串 `?rev=20261023-unlimited`。同一个 URL 的 ESM 模块在进程里只求值一次，所以插件
拿到的仍是旧引擎；而新模块 `pet-chat.js` 里用**无查询串**的 import 会得到另一个新实例（所以写 inbox 的
`platform` 生效了，摄取却不会）。

**处置**：把所有插件侧 import 统一 bump 到 `?rev=20261025-pet-memory2`
（`lib/memory-card.js`、`lib/store.js`、`lib/pet-chat.js`），让它们指向同一个新实例；以后改
`src/memory-card.js` 必须同步 bump 这个版本号。验证：重载后日志出现「新增 … / 桌宠 N 条」，
`memory-card.json` 出现 `source=pet-owner` / `platform=pet`。

**教训**：**带 `?rev=` 的共享引擎 = 显式版本契约**。改动引擎却只改文件，热重载看起来“成功”，
实际所有调用方还在旧代码上；日志和单测都可能是绿的（单测直接 import 文件路径）。

## #69（2026-10-25）桌宠语音有回音：对话框和气泡各播了一份

**现象**：语音对话时能听到同一句话叠着两遍（差 ~100ms），像回音；关掉对话框就正常。

**根因**：一条语音回复同时走两条展示路径——`chat-host` 既把消息广播给对话框（对话框 `onMessage`
自动播放），又弹气泡（气泡 `show()` 也自动播放）。两个 `<audio>` 元素同时出声。

**处置**：主进程做「唯一出声者」：
- 气泡 payload 增加 `autoplay`；对话框可见时置 false（气泡只显示文字和播放按钮）；
- 打开对话框先暂停气泡；谁开始播放都通知对方暂停（`chat:audio-start` / `bubble:audio-start`）；
- 对话框在 `document.hidden` 时不自动播（隐藏窗口不该出声）。

**验证**：CDP 同时读两个窗口的 `<audio>`：对话框 `paused=false` 且 `currentTime` 在走时，气泡必须
`paused=true`、`time=0`；关掉对话框后气泡 `paused=false`。回归脚本见 `out/probe/echo-a/b.mjs`（开发用）。

**教训**：**“同一条消息多处展示”必须指定唯一媒体所有者**；自动播放策略分散在两个窗口时，
只靠“各自判断是否该播”一定会重叠。

## #70（2026-10-25）新增的提示词小节会被预算静默裁掉：桌宠记忆差点永远进不了提示词

**现象**：桌宠记忆已经入库、`memory-card-prompt-qq.md` 也重写了，但里面找不到「桌宠（私下相处）」；
`renderMemoryCard` 在记录少的小卡上正常，真实 600 条 + 2200 字预算下就消失。

**根因**：`renderMemoryCard` 超预算时按 `priority` 从低到高裁行；新加的桌宠小节用了 23（低于
`recent` 的 30、`qq` 的 20 只高一点），而且它不在「最近记得的」里（被 platform 过滤掉），
于是预算一紧就先被裁掉。单测只建了几条记录，覆盖不到真实压力。

**处置**：桌宠小节 priority 提到 36（高于 recent 30、低于 owner 40），限制 4 条；补一条**预算压力测试**：
30 条主人记忆 + 20 条群消息 + 1 条桌宠，`maxChars=900` 时仍必须出现桌宠小节与那句话。

**教训**：**新增提示词小节必须回答“预算不够时先砍谁”**，并用真实量级的卡做回归；
只测“记录少时能渲染出来”等于没测。**来源/平台过滤器和小节归属要一起设计**，否则记录在库里却永远不出现。


## #71（2026-10-26）生成物落后于源，而能抓它的测试根本不在门禁里

**现象**：`node scripts/build-agent-preset-patches.mjs --check` 报

```
✗ 需重新生成 plugins\surfcore\presets\qq-chat-v2.patch.yml
ERROR: 1 个 patch 文件与源不一致
```

逐行对比：源 `dsh/agent-presets/qq-chat-v2/agent.cordis.yml` 里已经有「对话收尾：结束不是终止」整段，
而 `plugins/surfcore/presets/qq-chat-v2.patch.yml`（DSH 真正读的那份）没有。也就是说
**仓库里"装进 DSH 的 preset"比源少了一整节提示词**。

**根因**：`scripts/test-agent-preset-patches.mjs` 早就写了 `--check` 语义，但它

- 不在 `scripts/test-audit.mjs` 的 `tests[]` 里；
- 也没有任何 `package.json` script 指向它。

于是它从不运行。`setup-dsh.mjs` 安装时会重新生成 patch，所以"重装一次就好"——
这恰恰是最坏的情况：**没重装的人跑的是旧提示词，重装的人突然换了行为**，两边都不报错。

**处置**：
1. 重新生成（源是权威，产物是纯生成物，`git diff` 只会出现缺的那一节）；
2. 把 `test-agent-preset-patches.mjs` 登记进 `scripts/test-audit.mjs` 的 `tests[]`；
3. 加 `npm run test:preset-patches`，让"只跑这一条"也有入口。

**怎么验证**：`npm run test:preset-patches` 全绿；`npm run test:audit` 从 71 变 **72/72**；
反向验证：故意改坏 patch 的一个字符，`--check` 必须 exit 1。

**教训**：**"写了测试"不等于"测试会跑"**。判据只有两条：进 `tests[]`，或者挂在 npm script 上。
另外：**任何"源 → 生成物"的流程，都必须有一条门禁比对新旧产物**，否则生成器存在与否没有区别。

---

## #72（2026-10-26）共享准入判据里的两个静默 bug：IPv6 全 403、空令牌等于空令牌

**现象**：把设置页 API 与桌宠 API 里各抄一份的准入函数收成 `plugins/surfcore/lib/http-guard.js`，
第一次给它写单测就红了两条：

```
❌ 放行回环 Host：[::1]:8080
❌ 放行回环 Host：::1
```

**根因**：

1. `const name = host.split(':')[0]` —— 对 `[::1]:8080` 得到的是 `[`，对裸 `::1` 得到空串。
   于是后面写好的 `name === '[::1]' || name === '::1'` **两个分支永远走不到**（死代码）。
   平时没暴露只因为 DSH 绑的是 `127.0.0.1`；一旦绑到 `::1`（Node 解析 `localhost` 就可能给 ::1），
   整套接口会 403，而现象只是"插件消失了"。
2. `safeEqual('', '')` 返回 **true**：`Buffer.from('')` 长度为 0，`timingSafeEqual` 对零长 buffer 成立。
   桌宠 API 自己另有一层 `if (!expected) return false` 才没出事——也就是说安全性依赖"调用方记得先判空"。

**处置**：`isLoopbackReq` 先识别 `[...]` 字面量再取主机名；`safeEqual` 空串一律 `false`（失败关闭）；
新增 `scripts/test-http-guard.mjs`（31 条断言）并接进 `plugins/surfcore npm test`。

**教训**：
- **同一安全判据抄两份，等于两份都会以不同的方式烂掉**。收敛成唯一实现是前提，
  但**收敛本身不会发现 bug**——必须同时补单测，否则只是把两份错的变成一份错的。
- **"看起来处理了边界"的代码要专门测那个边界**。`name === '[::1]'` 写在那里很像支持了 IPv6，
  只有真的传一次 `Host: [::1]:8080` 才知道它是死代码。
- 涉及"令牌是否相等"的函数要**默认失败关闭**，不要把非空校验留给调用方。

---

## #73（2026-10-26）`state/` 被当成草稿纸：运行时目录里躺着 21 个一次性脚本

**现象**：审计时列 `state/` 目录，除了运行状态，还发现 21 个 `.mjs`（`probe-ui-windows5.mjs`、
`audit-settings2.mjs`、`clean-tools-imports.mjs`…）、5 张 probe 截图、24 个审计日志、2 份 audit-result.json，
合计 2.3MB。`state/` 是 `.gitignore` 的运行时目录，所以它们**既不进版本库、也没人清理**。

**根因**：历史上排查 UI/配置时图省事，直接把一次性脚本写在"当前工作目录旁边"（`state/`，
因为 `${import.meta.dirname}` 就是脚本所在目录），跑完忘了删；产物（截图、日志）也跟着留在那儿。
副作用不止是脏：这些脚本里含本机端口、真实会话 id、真实 QQ 群号，而 `state/` 恰恰是要长期保留的目录。

**处置**：按铁律 #6 走"隔离"而不是删除——整批移到 `_backups/state-residue-2026-10-25T23-16-38-664Z/`，
目录里放 `README.md`（来源、为什么、怎么回滚）。**仍在写的**文件（`bridge.log` / `bridge.log.1` /
`bridge-restart*.log` / `qq-activity.log` / `guard-patch.log`）一律保留。
`FOLDER_MAP` 写明：`state/` 只放运行时数据。

**怎么验证**：`ls state/*.mjs`、`ls state/*.png` 都应为空；`state/` 从 290MB 降到 288MB（大头是语音包）；
插件与桥接跑起来后 `bridge.log` 继续增长。

**教训**：一次性脚本要么进 `scripts/`（`test-*` 要登记进 `tests[]`），要么跑完就删；
**产物写 `os.tmpdir()`，别写 `state/`**。"反正 gitignore 了"不是理由——它会在你真正需要辨认
"哪个文件是数据、哪个是垃圾"的时候变成障碍。

---

## #74（2026-10-26）隐私闸报「0 命中」，其实每条规则只看了一次 —— 一个 flag 造成的双重 fail-open

**现象**：审计时想给 `privacy-scan` 加一个"扫描不完整"的提示，顺手把上限调大，结果发现
无论上限调到 5000 还是 50000，**永远有 45 个「文件 × 规则」被截断**，而且耗时从 5 秒涨到 87 秒还没跑完。

**根因**（比"文件太大"难看得多）：`DEFAULT_RULES` 里有三条规则写了 `flags: ''`：

```js
{ name: 'QQ 号/群号（9-10 位连续数字）', pattern: '…', flags: '' }
```

扫描器当时是：

```js
re = new RegExp(rule.pattern, rule.flags ?? 'g');   // ← 空串不会 fallback 到 'g'
```

`''` 不是 `null/undefined`，`??` 不生效 ⇒ 编译出来的是**非全局**正则。而 `RegExp.prototype.exec`
对非全局正则**永远从 0 开始、永远返回同一个匹配、lastIndex 不前进**。于是：

1. 每条规则在每个文件上**只看到第一个命中**。第一个之后的真泄漏一律看不到 —— 这是**漏报**（fail-open 的第一层）。
2. `while (exec() !== null …)` 靠 `attempts` 上限才退出，退出后又被归类成"匹配过多/文件太大"，
   于是"闸门是红的"被解释成"文件太吵" —— 这是**误诊**（fail-open 的第二层，更危险，因为它让第一层看起来合理）。

**修好之后立刻出现的证据**：把编译改成"必带 g"（`compileDenyRegex()`）后，
`plugins/surfcore/tools/docs/rich-text-nodes.md` 里立刻冒出 **3 条真命中**（淘宝联盟跟踪链接的完整
`e=` 参数，含发布者信息）。也就是说：这条闸门此前一直在报"✅ 未发现敏感信息"，
而文件里躺着它本该发现的东西。

**处置**：
1. 判据抽成 `scripts/privacy-rules-lib.mjs`（`compileDenyRegex` / `isNoise`），扫描器与单测共用；
2. `compileDenyRegex` 强制补 `g`，缺 `pattern` 直接抛错（不静默放行）；
3. 新增 `scripts/test-privacy-scan.mjs`：**正面**断言"同一段文本里的第二个命中必须能看到"，
   再加一条**对照**断言"非全局正则连续 exec 拿到的是同一个匹配"（说明这条测试不是空转）；
4. 顺手做了三件相关的事：`--strict`（扫描不完整即失败）、`incomplete[]` 进 JSON、
   把 `isNoise` 的"备份文件名（ISO 时间戳尾巴）"规则补上（此前 docs 里的高熵命中全是这类误报）；
5. 结果：`--strict` 从 **45 个截断 / 5.0 秒 / exit 1** 变成 **0 截断 / 0.5 秒 / exit 0**。

**教训**：
- **`??` 不兜空串**。想给"缺失"设默认值时，`flags: ''` 和 `flags: undefined` 是两件事；
  要么用 `||`，要么显式判断。
- **一个"永远成功"的循环 + 一个"看起来合理"的超时提示，会互相掩护**。
  判断"扫描器可信吗"的标准不是"它报了几个问题"，而是**它有没有可能根本没扫**。
  所以这次把"不完整"做成了显式状态（JSON 里可机读、`--strict` 会失败）。
- **安全工具的 bug 也是 bug，而且更贵**：它不会让功能坏掉，只会让"没问题"变成一句空话。
- 反向验证必须做：修完要能说出"哪一条以前看不见的命中现在看见了"，
  否则无法区分"修好了"和"换了个方式继续沉默"。

---

## #75（2026-10-26）「安装目录」可填任意路径 + `rmSync` = 用户一点就把别的目录清空

**现象**：桌宠页有一个「安装目录」输入框（`client.js` 里那个 `appDir`，占位文字写着"留空 = 默认目录"）。
如果把它填成 `D:\某工程`、`C:\Users\你\Documents` 甚至盘根，再点**安装**或**卸载**，
那个目录会被**整棵递归删除**（`fs.rmSync(recursive, force)`），没有确认、没有备份、不进回收站。

**根因**：三件事凑在一起——

1. `appDir` 是**用户自由填**的，来自设置页（`plugins/surfcore/lib/client.js:4017`）；
2. 取用时只做 `path.resolve`（`plugins/surfcore/lib/pet.js:46-50`），**没有任何所有权校验**；
3. `install()` / `unzip()` / `remove()` 三处都直接对它的结果 `rmSync(recursive, force)`。

也就是说：**"这个目录归我管"这个前提从来没被验证过**，全靠用户别填错。
更糟的是"必须有 package.json 才算桌宠"这条看似合理的判据**挡不住**——很多工程根目录都有 `package.json`。

**处置**（`plugins/surfcore/lib/pet.js`）：

- 新增 `checkAppDir()`：盘根 / 受保护目录（`<state>/pet`、`~/.dsh/surfcore`、`~/.dsh`、用户主目录）**本身或其上级** → 拒绝；
  已存在的目录必须**为空**或**带本程序的标记文件**，否则拒绝；
- 安装成功写 `.surfcore-pet.json` 标记——用**标记文件**而不是"目录名像不像"来证明所有权；
- `install` / `unzip` / `remove` 三处删除前统一过闸；`install()` 前先 `stop()`（运行中安装会撞文件占用）；
- `status()` 多回一个 `appDirSafe`，让界面以后能直接提示；
- **兼容老安装**：本次改动之前装好的目录没有标记文件，直接拒绝会把"卸载/重装"卡死。
  所以加了认领规则 `looksLikePetInstall()`：同时具备 `skins/`、`package.json` 的 name 含 `pet`/`feiyu`、
  `dist/` 或 `run.pid` 三者才算桌宠包，认领后补写标记。
  ⚠️ 刻意**不使用**"有 package.json 就算"——任何工程根目录都有，正是要挡的场景。
- 回归：`scripts/test-pet-dir-guard.mjs`（**22 条**，含"仓库根那种有 package.json 的外来目录必须被拒"
  与"老安装可认领 / 只有 package.json 不可认领"）。

**怎么验证**：`node plugins/surfcore/scripts/test-pet-dir-guard.mjs` 全绿；
手动把一个**空目录**设为安装目录 → 能装；把**非空目录**设为安装目录 → 点安装会得到明确错误、目录毫发无损。

**教训**：

- **凡是"用户可填的路径 + 递归删除"，必须先回答"我凭什么认为这个目录是我的"**。
  正确答案通常是一个**只有自己会写的标记文件**，不是路径形状、不是"里面有某个常见文件"。
- **一次操作覆盖两种语义（安装 = 先删后写）时要特别小心**：用户以为"安装"是加法，代码做的却是"清零再写"。
  这种情况下，删之前的校验比删之后的报错重要一百倍。
- 这类 bug 的爆炸半径与"用户会不会填错"无关——**它一定会被填错一次**，只是时间问题。

---

## #76（2026-10-26）被 @ 叫醒却先去回十几条老消息：唤醒快照按"最早未读"顺序取

**现象**：群里积压了一段时间的未读，主人 @ 她一下，她一进来先回的是**最老的那几条**，
真正叫她的人（最新那条）反而要等到下一轮 —— 感觉像"她永远在追昨天的消息"。

**根因**：`buildWakeSnapshotV2()` 给模型塞的那一屏，取的是**最早**的未读：

```js
// 修之前
for (const msg of st.unread.slice(0, maxUnread)) if (!tryAdd('messages', msg)) break;
```

`maxUnread` 默认 12，而 `unreadLimit` 默认 30 —— 积压到十几条时，最新那条（也就是 @）
**根本不在快照里**。她看到的全是旧的，自然就"先回老远的消息"。
当初这么写是有理由的（注释原话：*a budget cutoff must not silently acknowledge unseen messages*）：
回执水位 `readThroughSeq` 是**连续**的，从最早开始塞才能一路推进；从最新开始塞会留一个"空洞"，
水位卡住、`mark_read` 反而用不了。

**处置**（`buildWakeSnapshotV2`）：

- 唤醒时把**窗口之外的更早未读折叠**：从 `st.unread` 摘掉，只保留最近 `wakeMessageLimit` 条，
  并把被摘掉的范围记进 `packet.folded = { count, fromSeq, toSeq, fromAt, toAt }`；
- 因为被折叠的消息低于 `lowestBuffered`，按**既有规则**可以被水位越过 —— 回执保持连续，
  不需要改 `readThroughSeqV2` 的语义；
- 新增提示词 `wakeFoldedNoticeV2()`：明确告诉模型"更早的 N 条只是背景，**不要**回头逐条回"；
  否则它看到 `partial=true` 会以为要先补读老消息（那正是症状的来源）；
- 配置开关：`socialV2.context.wakeFoldOld`（默认 `true`）。设 `false` 恢复旧行为，给"必须从最早读"的场景留退路；
  设置页 QQ 页「高级设置」里是可勾选项。

**怎么验证**：
`node scripts/test-token-economy.mjs`（三条用例：最新窗口+折叠、`wakeFoldOld=false` 恢复旧行为、
15 条积压默认只留最后 12 条且折叠前 3 条）。

**教训**：
- **"先看到什么"比"看到多少"更影响行为**。同一批未读，按最老排就演成"追旧消息"，按最近排就像真人；
- 这类问题不是"排序没做好"，而是**读取顺序与回执语义绑在一起**。改顺序必须同时回答"水位怎么算"，
  否则会从"回错消息"变成"永远标不掉已读"；
- 产品上的正解通常不是"让她把 30 条都读完"，而是**允许她主动放弃背景**——但必须**说出来**（折叠计数），
  不能静默丢。

---

## #77（2026-10-26）"更新桌宠"差点把用户数据删了：install() 的解压会清空整个安装目录

**背景**：加「检查更新」时要支持桌宠这种 **zip 安装的构建产物**（源码在 git、装的是打包产物），
自然想到复用现成的 `petService.install()`。

**坑**：`pet.js` 的 `unzip()` 第一件事是

```js
fs.rmSync(dest, { recursive: true, force: true });   // dest = 安装目录
```

`install()` 是给"首次安装"设计的（目录本来就该是空的），**更新**时这样跑会把
`app/data/`（Chromium profile、本地聊天数据）和用户自己往 `app/skins/` 里放的皮肤一起删掉——
一个"检查更新"按钮变成不可逆的数据删除。这正是 RULES 里"删改必隔离"要防的事。

**修法**：新增 `petService.updateFromZip(zipPath)`，绝不调用 `install()`：

1. 解压到**临时目录** `app.new-<ts>`，先校验里面有没有 `package.json`；
2. `app` → `app.old-<ts>`（rename，同盘瞬时），`app.new` → `app`；
3. 把旧 `data/` **整份搬回**新目录；旧 `skins/` 只补新包没有的文件（不覆盖新版资源）；
4. 写标记 + 清 `run.pid`，成功后删 `app.old-*`；
5. 任何一步失败 → 把 `app.old-*` 换回来，保留现场供排查。

**怎么验证**：`node plugins/surfcore/scripts/test-pet-update.mjs`（真 zip、真目录）：
版本变了 / `data/profile/keep.txt` 原样保留 / 用户皮肤还在 / `run.pid` 清掉 / 备份目录清理 / 标记仍在。

**教训**：
- **"安装"和"更新"不是同一个动作**：安装可以假设目录是空的，更新必须假设里面有用户数据；
- 复用安装器之前先看它有没有 `rmSync` —— 有就说明它是破坏性的，不能直接拿来做更新；
- 这类"点一下按钮就删东西"的功能，**必须有端到端测试**（真 zip + 真目录），单测 stub 掉安装器是测不出来的。

## #78（2026-10-26）同一支视频被一天发 8 次：分享去重的"兜底"就是重复的源头

**现象**：用户反馈"小肥鱼在群里分享的视频全是同一个"，而且**这两天根本没启用 B站**。
查 `state/bridge.log`，10-26 的 19:00 / 21:00 两档、3 个群、全是 `BV1mFJq6iEUX`（10-22 已经发过）。

**根因（两个，叠在一起）**：

1. `pickShareCard()` 里，当"6 天内没用过的池子（fresh）"为空时，代码**回退到整个 pool**：

```js
const fresh = pool.filter((e) => !(Date.parse(used[e.id] ?? 0) > cutoff));
const list = fresh.length ? fresh : pool;      // ← 这里
return list[0] ?? pool[0];
```

   pool 按 `priority → score → date` 排序，永远是同一条最高分的。于是"都用过了"不但没有让它停，
   反而让它**每天重新发同一条**（而且 `recordShare` 每次都会刷新时间戳，冷却永远不会到期）。

2. 分享定时器跑在**桥接进程**里，看的是 `biliBridge.enabled`——这个值只在桥接**启动时读一次**。
   用户在设置页关的是插件侧的「启动B站」，桥接的定时器照跑；`share.groups` 为空时还会回退到
   `allow.groups`（3 个群），于是"关了 B站 还在发"。

**修法**：

- `pickShareCard()`：fresh 为空直接 `return null`（宁可不发，也不发旧的）；要复用必须显式
  `allowReuse: true`。调度器日志改成"没有新鲜素材，本次跳过；不发旧的"。
- 调度器加 `isEnabled` 闸门，每次 fire 前判断；桥接侧 `biliStartEnabledByUnified()`
  每 30 秒（按 mtime 缓存）读一次 `~/.dsh/surfcore/config.json` 的 `platforms.start.bili`，
  关了就跳过。
- `saveHistory()` 的 `catch {}` 改成**把错误打进日志**：写不进去 = 去重永久失效，必须看得见。

**验证**：`scripts/test-bili-share-dedup.mjs`（已进 audit，77/77）：

- 连发 8 档必须是 8 条不同素材；
- 全部记录为"刚发过"后，`pickShareCard()` 必须返回 `null`；
- `allowReuse: true` 时才复用；
- 把 used 时间改成 30 天前后，应能重新选。

**教训**：去重逻辑里的"兜底分支"往往就是重复的源头——**没有新鲜内容时，正确行为是"不发"，
不是"随便发一条"**。另外，定时任务读开关时不要信启动时的快照。

## 语音包"安装"卡在开始安装（公开用户必踩）

- **现象**：设置 → 语音 → 点「安装」，按钮一直显示"开始安装…"，永不变；后端进度字段为空。
- **根因**：`src/voice-packs.js` 的默认安装源是 `devPackUrl('voice-local'|'voice-cloud')`
  = `<仓库>/../voice/packages/*`。这个目录只在开发机存在，用户机器上没有 → 安装直接失败，
  而前端只显示了"开始安装…"。
- **修法**（0.6.5）：开发目录不存在时改用 `https://github.com/<repo>/archive/refs/heads/main.zip`，
  解压后拍平 `<repo>-main/`，再跑包内 `scripts/fetch-models.mjs` 拉模型（sha256 校验）。
- **验证**：干净机器上装云端包应依次看到 下载中 → 解压中 → 拉取模型 → 完成，端口 8767 起来。

## 在宿主进程里覆盖自己的安装目录 = 宿主硬崩（0xFFFF7003）

- **现象**：设置页点「更新」→ 下载 main.zip → 覆盖文件那一秒 DSH 宿主直接消失，
  无 JS 堆栈，退出码 `0xFFFF7003`，`crashpad ... not connected`；
  更新也没生效（plugin.log 停在「下载 …」）。
- **根因**：插件跑在 DSH 宿主进程里，而安装目录（junction → 仓库根）正是宿主**正在 require**
  的模块目录。`fs.cpSync(src, dir, {force:true})` 原地覆盖正在使用的文件 → 进程被终止，
  `finally` 都执行不到；顺带 `/MIR` 缺失还会留下旧版本残留文件。
- **修法**（2026-10-28）：
  1. 下载/解压仍在进程内（安全），但**覆盖动作交给独立进程** `scripts/apply-update.mjs`；
  2. 该进程 `--pending` 读 `updates-pending.json`，先等宿主 PID 退出（最长 15 分钟），
     再 `robocopy /MIR`（排除 `state backups node_modules .git logs staging pet characters voice-packs`
     与 `config.json bili.config.json`）；
  3. git 安装同样排队（退出后 `fetch + merge --ff-only`），不在运行中 merge；
  4. UI 明确提示「已下载，退出 DSH 后自动应用」。
- **验证**：`scripts/apply-update.mjs` 集成测试——staging 新文件覆盖成功、`config.json`/`state/` 保留、
  源里没有的旧文件被 `/MIR` 删除。

## 语音包"安装完成但只有 490KB"

- **现象**：进度条旁写「安装完成」，卡片仍「未安装」，目录只有解压出来的代码（约 500KB）。
- **根因**：① 前端 `poll()` 超时后**无条件**写「安装完成」，覆盖了失败原因；
  ② 后端没有完整性校验，`fetch-models` 断了也标完成；
  ③ GitHub archive 解压带只读属性，后续写 `models/` 可能失败。
- **修法**（v0.6.13）：`poll` 返回状态；装完校验 `verifyDirs`（本地包要 `models` + `vendor/GPT-SoVITS`，
  云端要 `models`），缺就报失败并提示重试/删目录；解压后 `attrib -R`；后置脚本缺失直接报错；
  进度从子进程输出解析百分比。
- **验证**：缺目录 → 失败分支可复现；真实 1.84GB 断网场景未验证。

## 桌宠「安装」点了没反应（无报错）

- **现象**：填了 `E:\main.zip`，点安装一直"未安装"，也看不到错误。
- **根因**：① 安装器只认根目录 `package.json`，GitHub 源码 zip 多一层 `<repo>-main/`；
  ② 第一次失败残留目录、且没写安装标记 → 第二次被 `checkAppDir` 的"目录非空"拦住；
  ③ 错误显示在「运行状态」卡片，用户在下面点按钮看不到。
- **修法**（v0.6.17）：单层目录自动拍平；识别源码包并给出可读错误；失败自动清理残留；
  错误移到按钮旁 + 「用官方最新版」「清理残留后重试」；桌宠 zip 也支持下载链路。
- **验证**：`test-pet-install-guards.mjs`（源码 zip 拍平成功 / 源码包被识别 / 残留被清理）。

## 语音包装完不可用：嵌套目录 / 启不动 / 停不掉

- **现象**：装完是 `voice-local/surfvoicelocal-main/…`，无 config.toml/models；启动转圈 60 秒超时；
  停止无效；启动弹控制台窗口。
- **根因**：① `flattenSingleDir` 用 `config.toml` 判定，而仓库只有 `config.example.toml` → 永不拍平；
  ② `run.bat`/`stop.bat` 里有 `pause`，被隐藏窗口拉起时卡死；③ `stop.bat` 假设
  `Get-NetTCPConnection` 返回单对象，多对象时报错、不杀进程；④ voxd 用 `python.exe` 起会带控制台；
  ⑤ `requirements-gsv.txt` 缺 6 个包，`jieba_fast`/`pyopenjtalk` 在 Windows 装不上；
  ⑥ 缺 `logs/gsv/tts_infer.yaml`；⑦ pip 直连 pypi 超时。
- **修法**（v0.6.18 + 语音包仓库）：拍平改用 package.json/models.json/version.json/config.example.toml；
  bat 去 pause、改 netstat+taskkill、pythonw；start 收 stderr 且超时 taskkill 进程树；stop 加按端口强杀兜底；
  requirements 补全并替换 Windows 不友好包；bootstrap 加 pip 镜像回退并生成 tts_infer.yaml。
- **验证**：`test-voice-flatten.mjs`（4 个场景）+ 全量测试；真机完整链路未验证。

## 点「立即更新」没反应（版本一直不变）

- **现象**：弹窗正常、点按钮无报错，但版本不变、下次检查又弹。
- **根因**：更新改成"退出后由助手应用"，而 spawn 用的是 `process.execPath` —— 插件在 DSH（Electron）里，
  这个值是宿主可执行文件；Electron 直接跑 `.mjs` **静默退出**（exit 0），助手从未执行。
  部分环境自带 `ELECTRON_RUN_AS_NODE=1`，所以有人正常、有人永远失败。
- **修法**（v0.6.19）：`helperSpawnEnv()` 给非 node 的 execPath 加 `ELECTRON_RUN_AS_NODE=1`；
  助手写 `.started` 标记、插件 2.5 秒后校验；启动时发现 pending 就重新排队（自愈）。
- **验证**：`test-update-helper-env.mjs`（环境变量 / 真执行 / 保留 config / 失败留证据）。
- **注意**：≤0.6.18 的用户无法自动升级（他们身上的助手同样起不来），必须手动覆盖一次 zip。

## 语音包安装没有进度条（只有"开始安装…"）

- **现象**：点安装后只有一行小字，没有进度条；等很久不知道有没有在下载。
- **根因**：0.6.5 为让配置热生效，`/api/voice/*` 每个请求都 `createVoicePacks()`；
  安装进度存在实例的 `activeInstalls` 里 → POST 的实例随请求结束销毁，后续 GET 拿到新实例，
  `install` 永远 null。**不是下载没开始，是进度状态被请求生命周期吞了。**
- **修法**（v0.6.20）：实例按 `config.json` mtime 缓存并声明在请求回调外；前端在没拿到后端进度时
  先显示不确定态进度条。
- **验证**：`test-voice-progress-instance.mjs`（结构守卫：缓存必须在回调外、禁止每请求新建）。

## 语音包卡在「安装 Python 依赖 99%」

- **现象**：进度条一直滚在 99%，50 分钟没动静；前端变「安装还没完成（可重试）」，后端其实还在装；没有取消。
- **根因**：pip 阶段没有稳定百分比；不显示耗时/最近动作；默认走 pypi 官方源（国内几十 KB/s）；
  安装子进程句柄没暴露，前端想取消也做不到。
- **修法**（v0.6.21）：显示「已 X 分钟 + 最近在装什么」；解析 `[bootstrap]` 行细化阶段；
  新增 `cancelInstall` + `/api/voice/packs/cancel` + UI「取消安装」；pip 默认清华源、`--progress-bar off`；
  超时文案改成"还在安装"。
- **验证**：全量测试通过；真实机器耗时与取消清理未验证。

## 本地语音"装完还是不能用"

- **现象**：模型都下完了，但 `vendor/`、`voices/`、`voicepack/` 跑到 `models/` 下面；
  修好位置后 GSV 报 `No module named 'jieba_fast'`；合成正常但她说"没有语音入口"。
- **根因**：① `fetch-models.mjs` 把所有归档都解压到 `models/`（归档内部自带 `vendor/`、`voices/` 前缀）；
  ② vendor 代码硬 import `jieba_fast`，Windows 上编译不了；③ MCP 工具列表在进程启动时固定，
  后开的语音工具不会出现在已运行的进程里。
- **修法**（v0.6.22）：models.json 增加 `dest`（vendor/voicepack → `.`，models → `models`）；
  bootstrap 造 `jieba_fast` 替身（转发 jieba）；装 imageio-ffmpeg 并写 `config.toml [ffmpeg] path`；
  requirements 补 torchmetrics/imageio-ffmpeg；pip 加包内缓存；UI 提示"改开关要重启 DSH"。
- **验证**：布局用 file:// 归档实测通过；真机 import/ffmpeg 未验证。

## #79（2026-10-29）「装个语音包，用上别人的火山额度」—— 凭据被当成了包的一部分

**现象**
- 用户提出：cloud 包的 `config.toml` 里硬编码了火山 AppID / AccessKey，公开发布会让别人用我们的额度。
- 核实结果（先查再动手）：AccessKey **没有**进过任何 git 历史 / 公开镜像 / Release 资产；
  但公开 `config.example.toml` 里有真实 AppID，且安装时会把它复制成用户的 `config.toml`。
  真正带 key 的文件只在本地 `voice/packages/*/config.toml`，而默认安装源正指向那里。

**根因**
- 安装流程 `copyFile(config.example.toml → config.toml)` 逐字复制，不区分里面有没有凭据；
- `devPackUrl()` 把「开发机源目录」当默认安装源 —— 它和「可分发内容」是同一个目录；
- 没有任何测试/闸门检查「装完的包里是否带凭据」，只有人肉发现。

**处置（v0.6.23 候选，2026-10-29）**
- `src/voice-packs.js`：`stripCloudCredentials()` + `ensurePackConfig()`，**新装**清空
  `cloud_app_id` / `cloud_access_key`（保留 `cloud_resource`），重装保留用户自己填的；
- `list()` 暴露 `needsCloudConfig`；`start()` 拒绝未配置的云端包并指路；
- 设置页装完自动滚到密钥表单、卡片提示「待填云端密钥」、AppID placeholder 不再用真实账号；
- 回归：`scripts/test-voice-cloud-credentials.mjs`（26 断言 + 4 个 `assert.rejects`，含真调用 `install()`）。

**怎么验证**
```bash
npm run test:audit   # 78/78
node scripts/test-voice-cloud-credentials.mjs
```
真机看：全新装 cloud 包 → `state/voice-packs/voice-cloud/config.toml` 两个键为空 →
设置页显示「待填云端密钥」→ 不填直接点启动会被拒绝。

**预防 / 下次注意**
- **凡「开发目录 = 分发源」的包，默认就当成会泄漏**：本地自用的密钥文件不要放在可打包目录里，
  或至少在安装入口做一次清洗。
- 公开镜像的 `config.example.toml` 里的真实 AppID 需要发布会话改掉（编辑器不碰公开仓库）。
- 若曾把 `voice/packages` 打包发人，必须轮换 AccessKey；只清 example 不够。


## #80（2026-10-29）「装好了却检测不到 SnowLuma」—— 检测候选是封闭集合，手动入口藏在别的页

**现象**
- 用户把 SnowLuma2 解压到自定义目录（如 `D:\软件\SnowLuma2`），概览点「检测已安装的 SnowLuma」→ 一直「没找到」。
- 错误文案还让用户「在 QQ → SnowLuma 里填安装目录」，但用户正在看的概览卡片上并没有这个入口。

**根因**
- `findSnowLumaInstall()`（插件 `lib/index.js`）只在一组**写死的**目录里猜：
  配置路径 + 2 个环境变量 + 7 个常见位置；不在列表里就永远返回 null。
- 「猜」只是省一步的便利，却成了唯一途径：概览没有手动选择，手填入口埋在 QQ 页高级设置。
- 0.6.11 只修了「填对路径却认错」，没测「路径没填/在别处时怎么办」。

**处置（2026-10-29）**
- 新增 `plugins/surfcore/lib/snowluma-install.js`：
  `normalizeSnowLumaInstall()`（根目录 / app 目录 / `app\launcher.bat` / `SnowLuma.exe` / 多套一层 → 统一成 `{root, launcher}`）、
  `snowLumaCandidates()`（手选 > 配置 > 环境变量 > 常见位置）、`findSnowLumaInstall()`（失败也返回 `tried`）。
- 概览 SnowLuma 卡加「浏览…」（原生目录选择，复用 `/browse`）；选中后**只验证这个路径**并保存，
  不会"检测成功"却保存了另一份安装。
- `detect-snowluma` 新增**可选** `path` 参数（向后兼容：旧调用不传照常工作）。

**怎么验证**
```bash
cd plugins/surfcore && node scripts/test-snowluma-install.mjs   # 22 项
cd plugins/surfcore && npm test                                  # 全绿
npm run test:audit                                               # 78/78
```
真机：装在 `D:\软件\SnowLuma2` → 点「浏览…」选这个目录（里面有 `app`）→ 提示已找到并保存。

**预防 / 下次注意**
- 凡是「自动探测」，都要回答：**探测失败时用户的下一步是什么？** 如果答案是「去另一个页面手填」，
  就等于没做兜底——兜底必须出现在失败提示的同一个界面里。
- 路径类输入先做**归一**（根/子目录/启动文件），再判断；不要假设用户会按文档的层级选。

## #81（2026-10-29）失败只闪一条 toast、还让用户去别的页面找入口 —— 「报错」不等于「可行动」

**现象**
- SnowLuma 检测失败时，用户只看到一条会消失的 toast；错误文案让他「在 QQ → SnowLuma 里填安装目录」，
  而他正看着的概览卡片上根本没有这个入口。用户不知道下一步该点哪。
- 同类形态：`catch {}` 后继续、只 `console.log`、接口回 `{ok:false}` 前端当没看见。

**根因**
- 只做了「报错」，没做「可行动」：错误文本没有下一步，兜底入口不在失败发生的同一个界面里；
- 接口失败只回一句 `error`，没有 `code`/`hint`，前端只能原样弹字符串，做不了差异化处理；
- 没有测试钉失败分支，改坏了也没人发现。

**处置（AGENTS 1.7 + docs/guides/ERROR-REPORTING.md）**
- 失败统一带 `code / title / error / hint / tried`；前端 `ErrorModal` 弹窗给行动按钮（浏览…/下载页），
  普通提示才用 toast；新增失败断言（本机 30 项测试里 8 项专测失败报告）。
- 规则写成刚性要求：看得见、给下一步、接口结构化、前端不许吞、失败有测试。

**怎么验证**
```bash
cd plugins/surfcore && node scripts/test-snowluma-install.mjs   # 30 项，含失败报告
cd plugins/surfcore && npm test && npm run test:audit            # 全绿 / 78
```
真机：断开/移走 SnowLuma 目录 → 点检测 → 应弹「没找到 SnowLuma」+ 试过位置 + 两个按钮。

**预防 / 下次注意**
- 写失败分支前先回答三句话：**用户在哪看到？他下一步点什么？我拿什么测它？** 答不上就别提交。
- 自动探测/自动恢复的功能，兜底入口必须和失败提示在**同一个界面**。

## #82（2026-10-29）提问回答没有身份来源、特权操作没有审计 —— 以及 DSH 单选答案不能 selected+custom 并存

**现象**
- AI 在群里提问后，任何人的回答都会被原样回给模型；模型无法知道回答者是不是主人，
  可能把群友的话当成主人确认（身份/权威污染）。
- 主人特权操作（审批、角色切换、封闭模式、语音、鱼群 bypass、告警）没有独立审计，
  出问题只能翻 `bridge.log` 猜。
- 按「在 custom 里加回答者、selected 保持原样」实现时，单选题会被 DSH 判 `bad-response`。

**根因**
- `handlePendingAnswer` 的 question 分支不用 `isOwner`、不记录 sender；`header` 被桥接丢弃。
- 没有 `[仅主人]` 分类机制。
- DSH 的答案结构只有 `selected` / `custom` 两个字段；单选题**必须二选一**
  （`node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js:1316-1318`、README.zh.md:25）。

**处置（2026-10-29，方案 A）**
- `src/question-answers.js`：`[仅主人]` 只用于收窄回答权；`canConsumePending` 让非主人**不消费** pending、
  消息继续走群聊；来源由程序按真实 sender 填写。
- 编码按 DSH 约束：多选 `selected + custom(来源)`；单选 `custom("选项「X」"+来源)`、`selected=[]`。
- `src/owner-audit.js` + 桥接 7 类事件 + `GET /api/owner-audit`（console token；agent 403）；
  1MB×5 轮转、90 天清理；写/轮转/清理失败 → health + 限频日志，不静默、不阻塞、不截断。
- 插件：管理员卡「管理操作记录」弹窗 + 固定路径「打开所在文件夹」；preset 第 17 条提问分类规则。

**怎么验证**
```bash
node scripts/test-question-answers.mjs
node scripts/test-owner-audit.mjs
npm run test:audit        # 80/80
npm run test:regressions
cd plugins/surfcore && npm test
```

**预防 / 下次注意**
- 先读依赖的**校验代码**再设计 payload：DSH 的 `selected+custom` 规则是硬约束，不是样式偏好。
- 身份类信息只从程序判定里来；模型写的标记只能**收窄**，不能授予。
- 审计失败必须可见（health + 日志），不能“记不上就当没发生”；也不要照抄会丢历史的原地裁剪。

## #83（2026-10-29）语音包“导入”只改了目录，失败还提示成功；pyvenv 不能在临时目录改写

**现象**
- 设置页「手动指定包目录」只写 `voicePacks.dir`，路径错时仍 toast“✓ 已指向”，
  刷新后卡片显示“未安装”，没有任何错误。
- 离线包解压后直接启动会报找不到 `runtime/python*`；因为 `pyvenv.cfg` 还指向构建机路径。
- 第一版导入在 `.import-*` 临时目录里改 `pyvenv.cfg home`，rename 到标准目录后
  home 指向已删除的临时目录，解释器仍然起不来。

**根因**
- 只有“安装源”概念，没有“已解压离线包 → 标准目录”的导入事务；
- 状态判定只看 `config.toml`，不做结构/manifest 校验；
- 错误响应没有 `code/hint`，插件 `api()` 只留 `message`；
- 复制/切换/环境修复没有事务边界，失败会留下半包。

**修法（2026-10-29）**
- 新增 `src/voice-pack-import.js`：类型/必需文件/manifest 哈希/配置/复制/`pyvenv` 改写；
- `src/voice-packs.js`：先校验、复制到临时目录、备份旧包、rename 到最终目录，
  **最后在最终路径改写 `pyvenv.cfg`**；失败恢复备份，恢复失败保留 backup 并报 `IMPORT_ROLLBACK_FAILED`；
- 默认复制、不移动源目录；源目录/旧备份只能通过记录路径手动删除；
- 设置页导入按钮 + 确认框 + `ErrorModal`（code/error/hint/missing）+ 进度/取消；
- 删除旧「手动指定包目录」入口。

**怎么验证**
```bash
node scripts/test-voice-pack-import.mjs
npm run test:audit        # 81/81
npm run test:regressions
```

**预防**
- 任何“导入”先问：源目录是否只读？失败会不会动旧包？环境路径是在临时目录还是最终目录算的？
- 错误字段必须在桥接 → 插件 → UI 三层都保留；只 toast 不算报错。

## #84（2026-10-29）设置页“下载参考音频”点了没反应

**现象**：云端语音设置第 1 步链接点击无反应，用户拿不到 `小语-参考音频19秒.wav`。

**根因**：桥接 `/api/voice/packs/sample` 本身 200 + WAV 正常；设置页用
`<a target="_blank">` 直接指向下载接口，DSH/Electron 宿主会拦新窗口/顶层导航，
没有下载处理器时就表现为“没反应”，且没有失败兜底。

**修法**：改成 `fetch → Blob → a[download]`；旁边加「打开所在目录」
（插件 `sample-open` → `explorer.exe /select,<file>`）；失败在表单下显示原因。
**验证**：桥接接口直接请求 200/922604 字节；设置页点击需重启 DSH 后手测。

## #85（2026-10-29）7.9G 离线包导入在 rename 时 EPERM —— Windows 扫描锁超过几秒

**现象**：真实 7.9G 候选包导入，复制到 75% 后 `rename('.import-*','voice-local')`
报 `EPERM: operation not permitted`；失败后清理临时目录也只删掉一部分。

**根因**：Windows Defender/索引器刚扫描完大目录，目录句柄会短暂占用；
6 秒（60×100ms）重试不够；失败后的 `rm` 也会遇到同样的锁。

**修法**：`renameWithRetry` 改为 120×500ms（约 60 秒），`removeWithRetry` 改为
60×500ms；失败重试仍失败才报错并保留临时目录/备份路径。
**验证**：小夹具通过；真实 7.9G 导入在 120×500ms 重试下成功（目标 7.6G，pyvenv 指向最终目录，源目录保留）。

## #86（2026-10-29）原生「浏览…」选中文目录后路径变乱码，导入报不存在

**现象**：用户选 `D:\...\中文目录\voice-local`，导入弹 `IMPORT_PATH_NOT_FOUND`，
弹窗路径里是 `�` / `◆`；实际目录存在。

**根因**：`handleBrowse` 从 PowerShell stdout 读路径。Windows PowerShell 5.1 重定向
stdout 默认 OEM/GBK，Node 按 UTF-8 解码 → 中文路径损坏。

**修法**：PowerShell 把选中路径写进 UTF-8 临时文件（`UTF8Encoding($false)`），
Node 读文件后删除；不再解析 stdout。所有「浏览…」共用此函数。
**验证**：`node --check` + 临时文件中文路径读写一致；真实选择框需重启 DSH 后手测。

## #87（2026-10-29）设置称呼「弥叭」，QQ 仍叫「管理员」

**现象**：unified 的 `admin.displayName=弥叭`，但 QQ `config.json` 的 `admin` 是 null；
提示词生成 `称呼「管理员」`，模型拼成「弥叭管理员」。

**根因**：
1. `projectAdminSave` 的 outQq 只投影 ownerQQ，没带 displayName/biliName/gentle；
2. 桥接只读 config.json，读不到 unified；
3. `adminDisplayName` 兜底返回 `'管理员'`，把身份词伪装成称呼；
4. 桥接只在启动时读配置，改完不重启不生效。

**修法**：outQq 带完整 admin 投影；`adminDisplayName` 空串兜底；提示词明确
「管理员是身份不是称呼」；插件启动时 `ensureAdminProjection()` 补投影，
桥接在跑则自动重启；补单测钉住 qq.admin.displayName 与无称呼提示词。
**验证**：`test-admin-identity`、`test-admin-prompt-wiring`、`test:audit`。

## 安装清单从开发目录生成 → zip 更新 100% 失败

- **现象**：点更新反复失败、版本不变；只有 4 秒 toast；没有 pending、没有助手进程。
- **根因**：`release-manifest.mjs` 扫工作目录（含 `_backups/`、`audio/`、本地改过的 docs），
  与 GitHub 归档天然不一致；`verifyStaging` 又要求清单文件全部存在且哈希一致 → 恒假。
- **修法**（0.7.9）：清单只列 `git ls-files`（工作区脏则报错）；有版本号时下载 tag 归档；
  校验改交集（只比存在的文件）；旧脏清单自愈；失败常驻可见；失败清 staging。
- **教训**：**制品和校验清单必须由同一次发布流程产出**；校验规则不能假设“两边完全相等”。

## 清单哈希取自工作目录 → 更新包永远校验失败（CRLF）

- **现象**：zip 用户点更新，下载成功但校验 92 处哈希不符；版本不变。
- **根因**：清单 sha256 取自工作区文件（CRLF），发布物是 git 提交（LF）→ 必然不同。
- **修法**（0.7.11）：`release-manifest` 用 `git cat-file` 读 HEAD blob 算哈希；
  新增 `--verify-ref <ref>` 发版门禁；同步白名单补 dotfiles。
- **教训**：清单/制品/校验必须同源同字节；Windows 上任何“读工作区文件算哈希”都会踩 CRLF。

## 桌宠安装请求不带表单 → 填了也不生效

- **现象**：填了安装目录、Electron 已下载，点「安装」报「请先填写安装包地址」；config.json 里 source/appDir 为空。
- **根因**：前端 `POST /pet/install` body 是 `{}`，后端读持久化配置（空）；输入框也没有保存路径。
- **修法**（0.7.13）：安装/启动请求带 `{source, appDir, electronPath}`，后端先落盘再执行；
  Windows 路径要求盘符（`pet.path-no-drive`）；空地址返回 `pet.source-missing` + field + hint。
- **教训**：「表单即配置」的页面，动作请求必须显式带表单，并用契约测试钉住。

## 语音失败被统一当成“TTS 没起来”

- **现象**：用户/模型说“云端语音坏了”，实际可能是限流、音色映射错、本地服务没起、火山鉴权失败。
- **根因**：503 的 detail 被桥接包成一句人话；失败不落盘；渲染失败不换路。
- **修法**（0.7.15）：`voice-diagnostics` 分类 + 换路重试 + `voice-errors.log` + 语音页三步自检。
- **教训**：跨服务的错误必须保留 code/上游 detail，否则“谁的锅”永远靠猜。

## 更新检查/下载押在 github.com 单点

- **现象**：远端已有 v0.7.16，界面只显示「v0.7.13 → 提交 c2205d4」；点更新报 `download.network`；关掉又弹。
- **根因**：提交模式跳过 tag 查询；下载只走 `github.com/.../main.zip`；失败不进退避。
- **修法**（0.7.17）：先查 `api/tags` 取版本；下载走 `codeload` 直连 + 归档/镜像回退；非 semver 目标阻止；
  下载类失败 30 分钟退避。
- **教训**：版本发现、下载、退避是三件独立的事；查版本要多源（api/302/codeload），别押一个域名。

## 管理员 B站 UID 长号“填不进去”

- **现象**：填 15 位/十几位 UID，保存后变空，没有任何提示。
- **根因**：`ADMIN_MID_RE` 限 4~15 位，超出被 `normalizeAdmin` 静默清空；前端无提示、保存无报错。
- **修法**（0.7.18）：放宽到 4~20 位；非法值返回 `admin.mid-invalid` + hint；输入框提示位数；
  另加「核查 UID 与昵称」（查 B站 名片比对真实昵称）。

## #88（2026-10-30）第三方全局工具被 QQ 白名单拒 → 模型反复重试

**现象**：用户装了第三方 `billion-context`（0.1.209），它把
`compress/decompress/search_context/acp_status/acp_cache` 注入 DSH 全局工具层；
QQ 会话的 `qq-tool-restrict` 不认识这些工具，执行期拒绝。模型把拒绝当普通工具错误，
197 次 compress / 214 步 / 46 分钟，约 ¥20。

**根因**：
1. SurfCore 的工具有效边界是 `qq-tool-restrict` 的精确白名单，第三方插件没有统一的工具声明；
2. 工具被拒只返回字符串，没有“停止/熔断”语义；
3. 每日 token 额度只在唤醒前检查，回合内不生效；
4. `billion-context` 同时把 DSH `compaction-basic` 的 `auto` 关掉，QQ 会话失去两套压缩。

**修法（本批）**：新增只读「插件冲突体检」，优先覆盖：
`COMPAT_TOOL_DENIED` / `COMPAT_COMPACTION_CONFLICT` / `COMPAT_TOOL_INVENTORY_UNKNOWN`；
未知插件必须显示 `unknown`，不能冒充已检查。入口在设置→概览「检查更新」旁。

**未修（下一批）**：回合级熔断（重复错误/步数/单轮费用/回合内额度）与端口/进程检查；
本次体检只能提前发现，不能替代运行时止损。

**验证**：`node scripts/test-plugin-compat.mjs`；`npm run test:audit`。

## #89（2026-10-30）每日额度管不住正在跑的回合 → 工具拒绝循环烧钱

**现象**：`compress` 被 QQ 白名单拒，模型在同一个 turn 里试了 197 次；
每日 token 额度只在唤醒前检查，回合开始后没有任何步数/重复错误/额度硬闸。

**根因**：
1. `tokenGuardWakeBlock` 只在唤醒前检查 `evaluateBudget`；send guard 只查防爆破；
2. `qq-tool-restrict` 的拒绝只是普通工具错误，没有“停止”语义；
3. bridge 的 `trackTurnEvent` 只收最终文本，不计数；
4. 没有 cancel-only 接口用于“只止血、不清队列”。

**修法**：
- `src/turn-guard.js`：maxSteps 40 / 同 tool+error 3 次 / 回合内额度；
- `bridge.pumpMux` 接 `guardTurnEvent`，命中后 `api.cancelTurn()` + 直接 QQ 通知；
- `src/gate-events.js`：L0–L3 事件中心、去重 ack、2MB 轮转；
- 插件 `/gate-events` + 概览「安全提醒」卡/L2/L3 弹窗。

**未修**：单轮费用上限（价格表覆盖不全）、pre-call 阻断、L0/L1 全量生产者接入。

**验证**：`node scripts/test-gate-events.mjs`；`npm run test:audit` 88/88；
`plugins/surfcore npm test`。

## #90（2026-10-30）SnowLuma 断线，主动唤醒仍跑完整 LLM 空烧

**现象**：SnowLuma 未启动/掉线时，`proactiveCheck` 仍创建会话、跑完整模型、最后发送失败；
失败只写 bridge.log，每 40–90 分钟重复，用户无感知。

**根因**：
1. `sendWakePromptV2` 的 guard 只查 socialV2 开关/暂停/鱼群/token/繁忙/限频；
2. 没有检查 `snowlumaHealth.connected` / 最近发送失败；
3. 发送失败只记 `lastSendFailed`，没有跨回合失败计数/挂起；
4. 失败消耗没有 UI/事件，只有日志。

**修法**：
- `sendWakePromptV2` 最前面 `qqSendChannelStatus()`：WS 未连接或最近发送失败 → return，
  不 `ensureSession`、不投 prompt；
- `sendToQQ` / `onebotSend` 记录成功/失败；连续 3 次失败把会话 `wakeSuspendedUntil`
  写进 `social-v2.json`，`scheduleProactiveCheckV2` 暂停排期；
- SnowLuma `close` 写 L2 `send-channel-down`，`open` 写 L1 恢复；`send-failed` 首次 L1；
- UI SnowLuma 安装卡显示 `diagnosis.hint`；事件中心弹窗给“启动/重启 SnowLuma，
  确认 3000/3001”的建议。

**未做**：首次 HTTP 失败的预知、`wasted` 精确金额标记、端口/进程体检。

**验证**：`node scripts/test-snowluma-channel-gate.mjs`（断开/暂停不创建 DSH 会话，
恢复后创建）；`npm run test:audit` 89/89。

## #91（2026-10-30）语音包被塞进 zip 自动更新 → 永远无法自动更新

**现象**：语音包（surfvoicelocal / surfvoicecloud）在更新面板显示有更新，点更新下载后失败
`verify.bad-archive`；用户以为“补 package.json 就能修”。

**根因**：
- `updates.components()` 把语音包登记成 `kind:auto`，走通用 `updateFromZip()`；
- 该方法硬编码 `surfcore-*` 根目录 + `package.json` + `release/install-manifest.json`；
- 语音包只有 `version.json` / `models.json` / `config.example.toml`，是离线运行时/模型/vendor 包；
- 只补 `package.json` 仍过不了根目录、清单、配置保留三关。

**修法**：语音包从自动更新列表移除；语音页明确“不参与检查更新，需要新版本时用
重新导入离线包”，导入事务保留 config/venv/models/vendor。

**未做**：语音包自动版本检查/通知；需要时另做独立手动更新通道，不复用 `updateFromZip`。

**验证**：`plugins/surfcore npm test`（test-updates-voice 钉住不再登记 surfvoice 组件 +
语音页说明）；`npm run test:audit` 89/89。

## #92（2026-10-31）一键启动只覆盖 QQ/B站，桌宠/语音各自为政，且没有一键停止

**现象**：概览「一键启动」只拉 QQ/B站；桌宠/语音要去各自页启动；没有统一停止；
切换页面时状态来源分散，用户不确定“到底启没启”。

**根因**：
- `start-all` 只处理 `platforms.start.{qq,bili}`，桌宠/语音不在同一编排里；
- 语音启动依赖 QQ 桥接，但没有明确依赖报错；
- 没有 `stop-selected`；停止顺序也没有考虑“语音由桥接托管”。

**修法**：
- 概览改为多选 `QQ（含 SnowLuma）/ B站 / 桌宠 / 语音`，语音加本地/云端单选；
- `start-selected` / `stop-selected` 每项返回 `ok/code/error/hint`；
- `overview.launch` 统一 `bridgeStatus / schedulerStatus / petService / /api/voice/packs`；
- 停止顺序：语音→QQ→B站→桌宠；QQ 停止不关闭 SnowLuma 本体；
- 失败行 + toast + `lastError` 状态行，不静默。

**未做**：真实进程启停手测、语音页深链、SnowLuma 本体停止（设计边界）。

**验证**：`plugins/surfcore/scripts/test-platform-start-host.mjs`（结构化失败/空选择/停止幂等）、
`test-client-contract.mjs`（按钮/多选/语音分支）；`npm run test:audit` 90/90。

## 白名单多写入点 / 重启后积压不唤醒

- **现象**：`allow.private` 只剩机器人自己的号 → 主人私信被忽略；桥接重启后白名单群 `unread>0` 但没人唤醒；
  安装/诊断后用户加的白名单丢失。
- **根因**：白名单 3 个写入点各自拼数组（`[owner]` 整体替换）；唤醒只由新消息事件触发；
  token-guard day 拦截没有 `retryAfterMs`，重试定时器不启动。
- **修法**（0.7.22）：`src/allowlist.js` 统一归一化（去自己、补主人、去重）+ 启动/登录/就绪自愈；
  四个写入点共用；reserved2 就绪后补唤醒积压（最多 5 个）；day 带 `retryAfterMs`、direct 豁免；
  未授权/token 日志 10 分钟节流。
- **教训**：同一配置的写入点必须共用一个归一化函数；重启恢复是生命周期步骤，不能等事件触发。

## 称呼/名字记忆没有按人归属

- **现象**：主人被叫成别人（对象）的称呼；私聊里叫错人。
- **根因**：对齐表的称呼只在群聊注入；记忆卡里非主人的私聊记录不带说话人。
- **修法**（0.7.22）：`src/callname.js` 按当前 QQ 取称呼并只注入当前会话；
  记忆行渲染成 `说话人（私聊/群聊）：内容`，并补"称呼只属于原话的人"规则。
- **教训**：跨会话共享的记忆必须带归属（谁说的、哪个场景），否则 A 的偏好会套到 B 身上。

## #93（2026-10-31）人格卡只有一张，日常/场景混在一起，改一点就把缓存前缀打掉

**现象**：人格卡 `persona.md` 一整张注入 QQ/B站/桌宠；想改近期状态只能改整张，
B站/桌宠被迫读 QQ 规则；核心和日常没有边界。

**根因**：
- 角色系统只有单 `persona.md`，`role.maxInjectChars` 只做总长度截断；
- 没有平台/群聊/私聊场景文件；
- 日常变化会改整段系统提示，缓存从变化点失效。

**修法**：
- `persona.md` 保持人格核心；新增可选 `persona.daily.md` 与
  `persona.scenes/{qq-group,qq-private,bili,pet}.md`；
- `src/persona-layers.js` 统一组合：核心→场景→日常，超预算先裁日常/场景；
- QQ 按 `group:`/`private:` 选场景；B站/桌宠各读自己的场景；
- `/persona` 三层读写，客户端逐层手动编辑 + 醒目说明；不做自动改写；
- 快照/回档带三层；旧角色没有新文件时行为不变。

**未做**：日常自动生成、任务型 ContextRecipe、记忆分层、缓存收益实测。

**验证**：`test-persona-layers`（组合/预算/平台/v1v2/接线）、
`test-character-api`（三层读写/未知场景/快照回档）、`test-client-contract`（分层 UI）；
`npm run test:audit` 93/93。

## #94（2026-10-31）只有总 token，没有逐唤醒/逐工具账单，无法判断钱花在哪

**现象**：token 账本只有「QQ/B站/其他 + 当日总量」，能看到今天花了多少，
但回答不了：哪类唤醒最多、哪一步开始膨胀、哪个工具反复查、工具结果多大。

**根因**：
- token ledger 只折叠 provider usage；
- 工具调用/结果只在 `tool-calls.jsonl` 有日志，没有和模型调用/唤醒关联；
- prompt 组成没有分段统计。

**修法（Phase 0A）**：
- 新增 `src/context-telemetry.js`：旁路 JSONL，只记录长度/usage/工具名/错误码，不记正文；
- 插件 `session/event` 采所有会话的 turn/model/tool 事件；
- bridge 在真正投递 wake 时记录 prompt 总字符与分段字符；
- `scripts/context-telemetry-report.mjs` 输出按唤醒原因/工具聚合的基线；
- observed / estimated / coveragePct 明确标注，不把字符数冒充 token。

**不做**：不改 prompt、工具、guard、会话策略；不改 token 账本。

**验证**：`test-context-telemetry.mjs`（去重/工具大小/不记正文/写失败不抛/接线）、
`npm run test:audit` 94/94。

## SnowLuma 明明连着却弹「发送通道断开」，且每次打开设置页都弹

- **现象**：WS 正常、能收发，但概览弹 L2 send-channel-down（code=1006）；打开设置页反复弹。
- **根因**：`close` 立刻记 L2（1006 多为瞬时抖动）；恢复（open）只记 L1，不确认旧 L2；
  UI 每轮取未确认事件 → 一直弹；文案还误称“自动唤醒已暂停”。
- **修法**（0.7.23）：close 加 15 秒去抖窗口；open 时 `ackByDedupe` 自动确认旧断线事件；
  文案改为“恢复前跳过主动唤醒”；UI 在 connected=true 时过滤并自动确认旧事件。
- **教训**：断线是事件、不可用是状态；告警要看状态并带去抖，恢复要结掉旧事件。
---

## #95（2026-10-30）会话内换一次模型，就悄悄改掉了全局「默认模型」

**现象**：用户在 DSH 设置里把默认模型改成 A；进任意会话手动换成 B，回到设置里看，默认模型已变成 B。
更隐蔽的一半：SurfCore 的 QQ 聊天 / QQ 黑话学习两个工作区每一轮都用 `config.json` 里写死的模型调
`selectModel`，于是「Web GUI 改默认 → QQ 说一句话 → 默认变回 config 值」，看起来像默认模型设置根本不生效。

**根因**：
1. `@deepseek-ai/dsh-api-session-controller/lib/index.js:793-821` 的 `selectModel()` 在切完会话模型后
   **后台**执行 `this.ctx.agentDefaultModel.saveSelection(selected).catch(...)` —— 会话级操作带全局副作用；
2. `src/bridge.js` 的 `ensureChatModel()` 只读 `config.json`，不读 `session.modelCatalog.default`，
   所以用户的默认模型对 QQ 侧完全无效，反而每轮都被写回 config 值。

**处置**：
- 桥接侧改为跟随 `session.modelCatalog.default`（`src/dsh-model-follow.js` 的 `effectiveChatModel`），
  跟不到才退 `config.json`；开关是 `config.json → dsh.followDefaultModel`（默认 `true`），控制台可勾。
- **不要去拦别人的 `saveSelection`**：那是 DSH 的契约，拦下来会连「在控制台只想给 QQ 换个模型」一起废掉。

**契约备忘**：`agentDefaultModel.currentSelection()` 是「默认模型」的唯一读口；`session.modelCatalog.default`
就是它。任何需要「管理员当前想要的模型」的地方都应该读这里，而不是自己读配置文件。

**验证**：`node scripts/test-dsh-model-follow.mjs`（9 项，含接线断言）；案例
`docs/cases/2026-10-30-qq-workspace-follow-default-model.md`。
