# 插件宿主（plugins/surfcore）

> 范围：DSH 插件 **宿主侧**（Node/主进程）全部 20 个模块 + bundle 装配文件。
> 不含设置窗口前端 `lib/client.js`（4300+ 行，另文），也不含桌宠四个模块（`pet*.js`）与
> 桥接进程本身（`src/bridge.js`）。
>
> **引用约定**：文中 `lib/xxx.js:12` 指 `plugins/surfcore/lib/xxx.js` 第 12 行；
> 其他路径（如 `src/memory-card.js`、`tools/lib/kinds.mjs`）一律写仓库相对全路径。
> 行号基准是 2026-10-26 工作树，改代码后需重核。
> **最后核对**：2026-10-26（全仓库逐行梳理）。配套阅读：总纲 [ARCHITECTURE.md](ARCHITECTURE.md) · 边界 [BOUNDARIES.md](BOUNDARIES.md) · 索引 [../README.md](../README.md)。

---

## 0. 插件在 DSH 里的位置

### 0.1 两条 loader 行，一个 bundle

`plugins/surfcore/cordis.patch.yml` 定义了一个 bundle 但插入 **两条** 行：

| 行 id | name | 角色 |
| --- | --- | --- |
| `surfcore` | `surfcore`（包名） | 主插件：host 全部能力 + client 设置窗口 |
| `qq-mode` | `./lib/qq-mode.js`（相对路径） | 只提供 `settings` 命名空间，不注册任何 UI |

- 主行 id 必须与包名一致，否则设置页/插件详情找不到（`cordis.patch.yml:9`）。
- `qq-mode` 用相对路径锚定在本 patch 旁边，随包移动，不写死 profiles（`cordis.patch.yml:10`）。
- 两个入口的 `config` 都是 `{}`（`cordis.patch.yml:14`、`:17`）。

为什么合体后还要留 `qq-mode`：QQ 桥接通过 DSH settings 读写该命名空间切换
chat / closed-agent / reserved / reserved2；DSH 0.2.x 的命名空间由「loader entry id + 该
entry 导出的 `Config`」推导，要求三条同时成立：id 精确等于 `qq-mode`、模块导出 `Config`、
`Config` 至少有一个带 `volatile` 的字段（`lib/qq-mode.js:1-14`）。实现细节：
`name = 'surfcore/qq-mode'` + `inject = ['settings']`（`:24-25`）；`mode` 五选一、默认
`reserved2`、`.extra('volatile', true)`，`ownerQQ` 同为 volatile、留空表示不覆盖 `config.json`
（`:27-35`）；`apply()` 是空函数（`:38-39`）；用 `createRequire` 取 schemastery 的 CJS——
仓库钉的 `3.18.1` 只发布 `lib/index.cjs`，纯 ESM import 会 `ERR_MODULE_NOT_FOUND`（`:15-22`）。

插件包元数据：`main` 指向 `./lib/index.js`，`exports` 暴露 `.`、`./client`、`./qq-mode`、
locale、icon 与 `qq-tool-restrict.mjs`（`plugins/surfcore/package.json:7-15`）；
`dsh.bundle.patch` 依次挂 `cordis.patch.yml` + 两个 preset patch（`:36-43`）；
`dsh.client` 声明 `platform: web`、`inject: []`（`:44-47`）。

### 0.2 宿主入口与注入的 ctx 服务

`lib/index.js` 导出三样：`name = 'surfcore'`（`:151`）、`inject = ['webServer',
'connection', 'sessionController']`（`:152`）、`apply(ctx)`（`:154`）、以及默认导出对象
（`:2205`）。实际用到的宿主服务远多于 inject 声明，都是运行时 `ctx.get()` 或可选访问：

| 服务 | 用途 | 位置 |
| --- | --- | --- |
| `webServer.register` / `port` / `protocol` | 注册路由（返回 disposer）；拼当前 DSH 地址喂桥接与桌宠 | `lib/index.js:510`、`:2152`、`:455-459` |
| `connection.requestRejection` | API 层再挡一次（DSH 自己的准入判据） | `lib/index.js:521-529` |
| `sessionController.prompt` / `create` / `inspect` / `cancel` | 塞「你醒了」回合；建/查/取消会话 | `lib/scheduler.js:483`、`:544`、`:552`、`:1157` |
| `sessionController.list` | token 用量启动回填 | `lib/token-budget.js:278`、`:285` |
| `sessions.get` | 由 sessionId 找到 session 对象再改权限 | `lib/scheduler.js:416-423` |
| `permissionPresets.current/set` | 给 B站 会话单独切权限 | `lib/scheduler.js:396-405` |
| `settings.describe/update` | 读/写 `qq-mode` 命名空间 | `lib/index.js:554-559`、`:1029-1039` |
| `ctx.on('session/event')` / `ctx.on('session/created')` | 实时 token 计量；会话一创建就切权限 | `lib/index.js:213-218`；`lib/scheduler.js:516-526` |
| `ctx.effect(fn)` / `ctx.get('subprocess')` | 注册卸载回调；交给桌宠服务拉起子进程 | `lib/index.js:2186`、`:197` |

### 0.3 生命周期与 dispose

所有路由 disposer 收进同一个数组（`lib/index.js:508`），`route()` 每注册一条就 push 一个
（`:510`、`:536`）。卸载时的清理顺序写在一个 `ctx.effect` 里（`:2186-2199`）：

1. `scheduler.stop()`（清 5 个 tick 定时器 + 杀直播间子进程 + 摘权限监听，`lib/scheduler.js:1153`）
2. `petPurpose.stop()`、清桌宠 host.json 心跳定时器（`:2188-2189`）
3. `sessionEventOff()` 解绑 `session/event`、`tokenBudget.dispose()` 落盘最后一份用量
   （`:2190-2191`；实现 `lib/token-budget.js:741-747`）
4. `memoryCardTimer.stop()`、`closeAllQrLogins()`、清角色自动存档/同步/桥接自愈三个定时器
   （`:2192-2196`；实现 `lib/memory-card.js:504-508`）
5. `extensionHost.deactivateAll()` 后逐个执行路由 disposer（`:2197-2198`）

插件日志按 2MB 滚动、只保留一代 `.1`（`lib/index.js:91-103`），双写 `state/plugin.log`
与控制台。激活最后一行日志会打印 surfcore 根、B站 工具链路径与隐私策略版本，全部经
`maskPath()` 脱敏（`:2202`）。

**一个刻意的设计**：插件不碰任何工作区目录。2026-10-22 起「按标记删/移旧工作区」的逻辑
整段删除，注释写明「清理旧目录一律由人工或脚本先备份再动」（`lib/index.js:157-161`）。

---

## 1. 装配顺序

`apply()` 是单线性流程，顺序本身承载语义（后面的东西依赖前面已就绪）。按执行次序：

### 1.1 基础设施（同步）

1. `ensureDirs()` 建好 `~/.dsh/surfcore`、`backups`、`memory`、桥接 `state`、`bili`
   五类目录，失败静默（`lib/index.js:155`；实现 `lib/paths.js:89-93`）。
2. 建平台注册表并给内置 `qq` / `bili` 挂运行态探针（`lib/index.js:163-165`；
   `lib/platforms.js:89-94`）。
3. 建 `ExtensionHost`，把 memory / align / bridge 三组能力 + `pluginLog` 注入进去
   （`lib/index.js:166-178`）。bridge 的 start/restart 包了闭包，每次调用重新取一次
   `currentDshUrl()`（`:172`、`:174`）——避免把启动瞬间的端口记死。
4. 声明可变状态：`scheduler`、`schedulerStatus`、`syncTimer`、`memoryCardTimer`、
   `characterTimer`（`:180-184`）。

### 1.2 服务创建（同步，但有内部懒启动）

| 服务 | 创建位置 | 备注 |
| --- | --- | --- |
| `tokenBudget` | `:189-195` | 注入 ctx / dshHome / qqStateDir / 读 QQ 配置闭包 |
| `petService` | `:197` | 默认未安装，安装才生效 |
| `petChat` | `:199` | 与 QQ/B站 共用当前角色人格卡与记忆卡 |
| `petPurpose` | `:200` | 目的机制的桌宠载体，60 秒 tick |
| `petApi` | `:201-209` | 桌宠独立 HTTP 前缀 |

紧接着注册 token 采集监听（`:211-221`）：包在 try/catch 里，注册失败只记日志，
不让插件整体起不来。

### 1.3 启动期的一次性动作

1. **重建对齐简报**（`:224`）：桥接与 B站 调度器都读这两份文件，必须早于它们启动。
2. **平台启动开关**（`:230-247`）：`platformStartState()` 每次现读 `unified.platforms.start`，
   缺省为开（`:230-233`）；`idleSchedulerStatus()` 生成「没跑但为什么」的状态对象（`:237-247`）。
3. **拉起 B站 生物钟**（`:251-277`）：`startSchedulerNow()` 幂等；B站 开关关着就直接返回
   disabled 状态并记日志（`:253-257`）；会话 id 带角色后缀 `bili-whale-<角色id>`（`:259-260`）。
4. **角色系统迁移**（`:281-313`、`:400`）：只在已有旧记忆/旧 B站 账本时建第一个角色，否则
   skipped（`lib/characters.js:179-186`）。迁移后写 `current-role.json` 指针，并在 1.5 秒后
   **重启一次桥接**让它读新角色目录（`lib/index.js:292-295`），同时用新会话 id 重启调度器
   （`:400-407`）——它已在第 3 步用旧 id/旧路径启动过。

### 1.4 定时器与后台任务

| 任务 | 首次延迟 | 周期 | 位置 |
| --- | --- | --- | --- |
| 记忆卡整理 | 8 秒 | 10 分钟 | `lib/index.js:412`；`lib/memory-card.js:498-501` |
| 角色自动存档 | 10 秒 | 6 小时 | `lib/index.js:415-428` |
| QQ→B站 同步 | 20 秒 | `intervalMs`（≥5 分钟，默认 30 分钟） | `lib/index.js:431-441` |
| 桥接自愈 | 立即一次 | 2 分钟 | `lib/index.js:2179`、`:2181` |
| 桌宠 host.json 心跳 | 立即一次 | 2 分钟 | `lib/index.js:2171-2173` |
| B站 生物钟 | 8/12/15/20/25 秒各一次 | 60s / 60s / 30s / 20s / 60s 五条 | `lib/scheduler.js:1117-1132` |

所有定时器都调了 `.unref?.()`，不吊住进程（`lib/index.js:426`、`:428`、`:2173`、`:2182`）。

### 1.5 路由注册（顺序即匹配顺序）

单个 `route(kind, path, handler)` 包了四层准入（`lib/index.js:509-537`）：

1. 非回环 Host → 403（`:514`，判据 `lib/http-guard.js:45-55`）
2. 非 GET 且不同源 → 403（`:515`，`lib/http-guard.js:63-72`）
3. 非 GET 且 `content-type` 不含 `application/json` → 415（`:516-519`）
4. `connection.requestRejection(req)` 返回非空 → 用它给的 code 结束（`:521-529`）

handler 抛错统一 500 + 日志（`:531-534`）。

注册顺序：`/dsh-surfcore/api` 前缀（`:2100-2136`，内部再按 pathname 分派）→
`/dsh-surfcore/ext` 前缀（`:2139-2148`）→ 桌宠前缀（`:2152-2164`）→
`/dsh-surfcore/health` 精确路由（`:2166-2168`）。桌宠前缀**故意绕开** API 前缀，因为
`connection.requestRejection` 会把它拦成 401（`:2150-2151`）。

### 1.6 恢复与首启动副作用

`void activateExtensions()`（`:2178`，`:444-452`，总开关关掉就直接返回）与
`void maybeAutoStartBridge()`（`:2179`）都在路由注册之后异步跑，不阻塞激活。
`startSyncTimer()`（`:2183`）最后按配置决定要不要挂同步定时器。

---

## 2. 配置模型

### 2.1 三份文件，没有第二份真相

`lib/store.js` 开头把设计原则写成四条：**不搬家**（QQ 仍读 `<surfcore>/config.json`，
B站 仍读 `~/.dsh/surfcore/bili.config.json`）、跨域设置单独放
`~/.dsh/surfcore/config.json`、每次写入前备份 + 原子写、给 UI 的读值脱敏而保存时
`********` 表示保持原值（`lib/store.js:1-12`）。三份文件的路径常量集中在
`lib/paths.js:20`、`:48`、`:60`。

### 2.2 DEFAULTS 的层级

| 层 | 常量 / 来源 | 覆盖范围 | 位置 |
| --- | --- | --- | --- |
| QQ 默认层 | `config.example.json`（**文件即默认值**） | QQ 全量 | `lib/store.js:272-281` |
| B站 默认层 | `BIDI_DEFAULTS`（代码内常量） | B站 全量 | `lib/store.js:29-62` |
| 合体默认层 | `DEFAULT_UNIFIED`（代码内常量） | 跨域设置 | `lib/store.js:64-141` |
| 用户层 | 三份实际文件 | 各自 | `lib/store.js:279`、`:284`、`:316` |

**`config.example.json` 作为默认层**是这里最反直觉的一处：`readQqConfig()` 先读模板当 base，
再用用户 `config.json` 深合并（`:277-281`）。好处是模板里每加一个字段，老用户下次读配置就
自动有默认值；代价是模板不只是文档，**它是运行期默认值来源**。`readUnified()` 则用代码常量
`DEFAULT_UNIFIED`（`:315-317`）。

`BIDI_DEFAULTS` 顶层键：`owner` / `self` / `persona` / `night` / `preferences` / `quota` /
`limits` / `dynamics` / `diary` / `notify` / `listen` / `share` / `fishGuard` / `toolsPath`
（`:29-62`）；`night.windows` 默认一个 `20:00-24:00 × 1 次` 窗口（`:34`），`limits` 与
`dynamics` 的默认值 **import 自工具链同源常量**（`:19-21`、`:50`、`:52`）——单点定义防漂移。

`DEFAULT_UNIFIED` 顶层键：`version` / `qqbotRoot` / `bridge` / `persona` / `admin` / `memory` /
`alignment` / `memoryCard` / `extensions` / `platforms` / `ui`（`:64-141`）；`memoryCard` 同样
import 自 `src/memory-card.js` 的 `DEFAULT_MEMORY_CARD_CONFIG` 并浅拷贝（`:126-129`）。

### 2.3 合并规则

`deepMerge(base, patch)`：对象递归、数组与标量直接替换、`clone()` 走 JSON 往返，
**拒绝原型污染键** `__proto__` / `prototype` / `constructor`（`lib/store.js:150`、`:161-170`）。
`setPath` 在写入时也会把中间节点补成对象（`:181-189`）。

`readUnified()` 有一处**每次读都重算**的字段（`:315-328`）：

```js
config = deepMerge(DEFAULT_UNIFIED, user);
config.platforms.start = platformStartsFrom(user);   // 注意传的是 raw user，不是合并结果
```

`platformStartsFrom()` 的优先级（`:300-313`）：
`platforms.start.<id>` 显式布尔 > 旧 `bridge.autoStart`（仅 QQ）> 旧 `platforms.enabled` 数组
> 默认 `true`。注释解释了为什么旧数组不能压过 `bridge.autoStart`：数组一直只是元数据
（默认两项都在），压过去会把老用户「QQ 自动启动开着」吞掉（`:292-298`）。

`readUnified()` 还回一个 `hasAdmin`：**用户文件里是否明确写过 `admin`**（`:323-327`）。
因为合并后 `admin` 永远存在（默认空串），只看合并值会把升级后的旧字段 `ownerQQ` /
`owner.mid` 永久当成「没配置」。所有用到 admin 的地方都先判 `hasAdmin` 再决定传不传
`admin`（`lib/index.js:631-634`、`lib/scheduler.js:139-141`、`lib/store.js:539-544`）。

### 2.4 脱敏规则与 `********` 语义

脱敏集合是 **4 条精确路径**（`lib/store.js:143-148`）：
`dsh.authToken`、`snowluma.accessToken`、`webSearch.apiKey`、`consoleToken`。

- 读：`redactForUi()` 递归，命中路径且值非空才替换成 `MASK`（`********`），空值保持空
  （`:505-516`）。**只对 path 精确匹配**，所以 `snowluma.httpUrl` 之类照常返回。
- 写：`restoreMaskedSecrets()` 递归，命中路径且值等于 `MASK` 时用旧值填回（`:519-531`）。
  值不是 `MASK` 时保留用户输入；空串表示用户明确要清空（注释 `:518`）。
- 保存链：`restoreMaskedSecrets` → `deepMerge(current, restored)` → `normalize*` →
  `backupFile` → `writeJsonAtomic`（`:553-560`、`:562-569`）。`saveUnified()` 不做 restore
  （合体层没有 SECRET_PATHS 里的键），只做深合并 + 版本号 + 平台开关 + 记忆卡归一
  （`:571-591`）。`redactForUi` 对数组按索引递归（`:506`），`restoreMaskedSecrets` 对数组
  直接 `clone`（`:528`）——数组里不会出现点路径，两者行为一致。

### 2.5 原子写

`writeTextAtomic(file, text, { mode = 0o600 })`：`ensureDirs` → `mkdir -p` →
写 `<file>.<pid>.<ts>.tmp` → `chmod` → `rename` → 失败删 tmp 再抛（`lib/store.js:201-213`）；
`writeJsonAtomic` 只是 `JSON.stringify(value, null, 2) + '\n'` 再走同一条路（`:215-217`），
默认 mode 600 对配置与凭据文件都成立。

### 2.6 备份与保留策略

- 备份文件名 = `<安全label>-<ISO时间戳去冒号点><原扩展名>`，label 只保留字母数字下划线点横线
  与中文，其余替换成 `_`（`lib/store.js:223-225`）。**先备份再写**：每个 `save*` 都在写之前
  调 `backupFile`（`:557`、`:566`、`:588`）。
- 保留策略是**按来源分别保留 40 份**，不是全局 40 份（`:234-255`）。注释记录了原因：旧版全局
  40 份，而「一键全部备份」一次写 8 份，点 5 次就把 persona / config 的唯一历史副本挤掉了
  （`:236-237`）。分组依据是文件名里 `-YYYY-MM-DDTHH:MM:SS...` 之前的部分（正则 `:238`），
  不匹配的文件名会被当成独立来源。
- `listBackups(limit)` 按 mtime 倒序（`:257-270`），`/api/config` GET 带 20 条（`lib/index.js:616`）。

### 2.7 归一化与禁止键

保存前的收敛分三套（都是纯函数、可单测）：

- `normalizeQqConfig`（`:357-408`）：白名单/黑名单 id 列表、`ownerQQ`、端口/延迟/超时数值
  夹取、`fishGuard`、`role.maxInjectChars`、`biliBridge.{memory,dynamics,share}`、
  `socialV2` 的媒体上限与工具开关。不认识的键**原样保留**（注释 `:356`）。
- `normalizeBiliConfig`（`:445-502`）：先 `deepMerge(BIDI_DEFAULTS, input)`，再逐段夹取
  `night` / `quota` / `limits` / `dynamics` / `share` / `listen` / `preferences` / `notify` /
  `diary` / `toolsPath`。偏好关键词统一去重限长（`:411-425`），权重只保留当前关键词里存在
  的词、0~5 两位小数（`:431-442`），同一个词同时在 like 与 keywords 里以 like 为准
  （`:485-487`）。`diary.enabled` 被强制成 `true`（`:498`）——「日记照写不可关」。
- `normalizeIdList`（`:330-333`）：接受数组或空白/逗号分隔字符串，只留 `^\d{4,15}$` 并去重；
  `finiteNumber`（`:335-340`）统一 clamp 与取整；`normalizeTimes`（`:342-354`）只认 `H:MM`，
  非法丢弃、空则回默认。

禁止键只有三个：`__proto__` / `prototype` / `constructor`，在 `deepMerge` 里静默跳过
（`lib/store.js:150`、`:165`）。这是唯一的「禁止键」机制，`normalize*` 不额外拦键名。

---

## 3. 设置页 API

前缀 `/dsh-surfcore/api`（`lib/index.js:87`）。所有端点共享 §1.5 的四层准入。
下表按域分组，只列动作名与作用，参数细节略。

### 3.1 概览与配置

| 端点 | 方法 | 作用 |
| --- | --- | --- |
| `/overview` | GET | 汇总面板：桥接/B站/记忆状态、记忆卡、管理员、对齐统计、平台、扩展、平台开关、调度器、SnowLuma 诊断、模式、人设卡、当前角色、路径、文件信息（`:540-611`、`:2103`） |
| `/config` | GET | 三份配置的脱敏快照 + 路径摘要 + 最近 20 份备份（`:615-617`） |
| `/config` | POST | 保存 `qq` / `bili` / `unified` 任意子集；管理员身份三向投影；平台开关副作用；可选 `restartBridge`（`:619-733`） |
| `/mode` | GET/POST | 读本地 `mode.json` + DSH `qq-mode` 设置；写时同时改 `mode.json`、DSH 设置、`config.json` 的 ownerQQ，并通知桥接 `/api/mode`（`:1004-1049`） |
| `/logs` | GET | 插件日志 + 桥接日志尾部（最多 500 行，`:2051-2056`） |
| `/diagnostics` | GET/POST | GET 12 项体检；POST `backup` 一次备份 8 类文件、`restore` 按前缀恢复 5 类（`:1072-1133`） |
| `/platforms` | GET | 平台注册表全量运行态（`:2059-2061`） |
| `/privacy/explain` | GET/POST | 解释一段文本「会不会被搬运」，只回标签与计数（`:2130-2134`） |

`/config` POST 是能力面最宽的一个端点，值得单独说明它的四类副作用：

1. **管理员投影**：`projectAdminSave()` 把管理员卡片对齐到 `qq.ownerQQ` 与
   `bili.owner.mid/name`，两边冲突时给 warning（`lib/index.js:634-641`）。
2. **保存即重算**：保存 `unified` 后重建对齐简报、`scheduler.invalidate()`、重启同步定时器、
   立刻重渲染记忆卡（`:661-671`）。
3. **平台启动开关副作用**：关 B站 → `scheduler.retire()`（不只是 stop，还要取消在途回合，
   见 PITFALLS #62 注释 `:695-697`）；开 B站 → `startSchedulerNow()`；关 QQ → `stopBridge()`；
   开 QQ → `startBridge()`（`:693-722`）。`SURFCORE_SKIP_AUTOSTART=1` 时整段跳过（`:693`）。
4. **`restartBridge`**：QQ 开关关着时**拒绝**执行，否则用户刚关的开关会被绕过（`:723-731`）。
   —— 这四条合起来的语义是：**保存配置 = 立刻改变运行态**，而不是等下一次重启。

### 3.2 角色与人设

| 端点 | 动作 | 作用 |
| --- | --- | --- |
| `/characters` GET | — | 无 `id` 回角色总览 + 迁移结果；有 `id` 回单个角色详情（`:737-746`） |
| `/characters` POST | `create` / `update` / `snapshot` / `auto-snapshot` / `migrate` / `delete` | 建角色（`load=true` 顺带全平台切换，`:752-761`）、改名改人格卡（`:767-771`）、手动存档留 20 份（`:772-776`；`lib/characters.js:62-69`）、自动存档（每天一份 + 11 个年龄档，`:777-781`；`lib/characters.js:34-59`）、手动迁移（`:809-812`）、归档角色不硬删（`:813-817`） |
| | `load` / `restore` | 全平台切换（停 B站 会话 → 停桥接会话 → 拍切换前存档 → 换指针 → 归档运行时 → 整理记忆卡 → 按原状态重启，`:762-766`、`:349-398`）；回档**当前角色**（拒非当前），同一套停/起编排（`:782-808`） |
| `/persona` GET / POST | 保存 / `restore` | 读全文 + 字数 + mtime + 备份列表（`:826-838`）；保存要求 ≥50 字、≤64KB、过隐私闸门、写前备份、写后 touch 角色（`:853-868`）；从备份恢复前再备份一份（`:841-852`） |

### 3.3 记忆（双向同步）

| 端点 | 动作 | 作用 |
| --- | --- | --- |
| `/memory` GET | — | 双向状态 + QQ→B站 预览（`chars` 200~20000）+ B站→QQ 简报表 + 审计尾 40 条 + 策略版本（`:873-883`） |
| `/memory` POST | `sync` | 强制 QQ→B站 同步（`:886-890`） |
| | `refresh-bili` | 经桥接刷新 B站→QQ 简报（`:891-895`） |
| | `scan-align` | 两侧扫描身份候选（QQ 1200 条 / B站 2 页，`:896-901`） |
| | `rebuild` | 重建对齐简报 + 重读 QQ 记忆（`:902-905`） |
| | `purge` | 清空 QQ→B站 记忆 + 原始公开 feed + 同步状态，**先备份**（`:906-914`） |

### 3.4 记忆卡

| 端点 | 动作 | 作用 |
| --- | --- | --- |
| `/memory-card` GET | — | 状态 + 全文 + 最近 80 条 + 初次相遇 + 备份列表（`:921-926`、`lib/memory-card.js:134-218`） |
| `/memory-card` POST | `maintain` | run 一次维护，可 `forceDecay`（`:929-934`） |
| | `compact` | 压缩到目标比例（默认 0.8，`:935-939`） |
| | `restore` | 从备份恢复并重渲染全部输出（`:940-945`） |
| | `notify-test` | 立刻走一次容量告警私聊（`:946-950`） |
| | `pin` / `forget` / `ack` / `add` / `set-first-meet` / `clear-first-meet` / `merge-memories` | 七种卡片操作（`:951-956`） |
| `/memory-card/full` GET | — | 全量卡只读快照，支持 `q` 关键词召回与 `limit`（1~200，`:961-966`） |

### 3.5 身份对齐

| 端点 | 动作 | 作用 |
| --- | --- | --- |
| `/align` GET | — | 全部链接 + 候选 + 统计 + 平台 + 两份简报字数（`:970-983`） |
| `/align` POST | `add` / `update` / `remove` | 增改删链接（`:987-989`） |
| | `approve` / `reject` | 审批候选（`:990-991`） |
| | `scan` | 两侧扫描候选（`:992-997`） |
| | `import` / `export` | 对齐表导入导出（`:998-999`） |

### 3.6 扩展、平台、桥接

| 端点 | 动作 | 作用 |
| --- | --- | --- |
| `/extensions` GET / POST | `toggle` / `config` / `reload` | 清单+平台+目录；启停（立即 activate/deactivate，`:1060`）、保存配置（`:1061`）、先停再启（`:1062-1067`）（`:1053-1056`） |
| `/bridge` GET / POST | `status` | 桥接状态（`:1635`、`:1638`） |
| | `start` / `stop` / `restart` | 启停重启；`start`/`restart` 在 QQ 开关关时 409（`:1639-1646`、`:1723-1731`） |
| | `start-qq` / `start-bili` / `start-all` | 桥接+按需开 SnowLuma / 拉起生物钟 / 一键启动（含陈旧则重启 + 弹窗跟踪）（`:1647-1676`、`:1677-1708`） |
| | `start-snowluma` / `detect-snowluma` | 打开本机已装 SnowLuma / 探测并回写路径（`:1709-1722`） |
| | `greeting-test` / `purpose-status` / `purpose-preview` / `purpose-run` / `refresh-bili` | 问候测试、目的机制三连、刷新 B站→QQ 简报（`:1732-1753`） |

### 3.7 B站

| 端点 | 方法 | 作用 |
| --- | --- | --- |
| `/bili/fish-guard` / `/pending` / `/automation` / `/notify-config` | GET | 鱼群保护、待审回复队列、额度与自动化只读快照、通知/倾听/分享/配额切片（`:1848-1862`、`:1902-1907`、`:1908-1916`；`lib/automation.js:66-159`） |
| `/bili/session-permission` | POST | 手动把 B站 会话切到配置的权限（先 inspect 再 set，`:1863-1893`） |
| `/bili/deps` | GET | 跑 `bili.mjs deps --json`（60 秒超时，`:1895-1901`） |
| `/bili/share-now` | POST | **真会发到群**：转发桥接 `/api/bili/share-now`（`:1919-1936`） |
| `/bili/accounts` / `/bili/qr/*` | GET/POST | 鱼账号+主人账号+期望身份；扫码登录三件套（poll 校验 id 形状）（`:1937-1955`、`:1956-1993`） |
| `/bili/*` | POST | `cookie` 写凭据 + nav 自检、`notify-test`、`pending-approve`、`pending-reject`（`:1994-2046`） |

`pending-approve` 是唯一会「代发评论」的路径：先从队列 `take` 出一条，再拼
`comment --oid ... --auto --go` 真发，最后用 stdout 里是否出现 `code=0` 判定成功
（`:2036-2044`）。

### 3.8 桌宠、目的、语音、token

| 端点 | 方法 | 作用 |
| --- | --- | --- |
| `/pet/status` | GET | 桌宠安装/运行 + 聊天/角色/主动/在场/语音/LLM/专注 状态（`:1463-1479`） |
| `/pet/config` `/focus` `/install` `/remove` `/start` `/stop` | POST | 桌宠生命周期与专注开关（`:1482-1491`） |
| `/pet/chat-test` | POST | 测一句话，成功则同时 emit 给桌宠弹气泡（`:1492-1507`） |
| `/purpose/status` | GET | 按载体（qq / pet）路由：pet 走本地服务，qq 转发桥接（`:1543-1591`） |
| `/purpose/preview` `/run` | POST | 预览 / 真跑一次目的回合（`:1592-1620`） |
| `/purpose/pet-chat` | POST | 设置页测一句话（不占主动额度，`:1621-1627`） |
| `/voice/*` | 任意 | 原样转发桥接 `/api/voice/*`，带控制台令牌（`:1434-1456`） |
| `/token-budget` | GET | 额度 + 当日三类用量 + 比例 + 当天唯一 80% 提醒（`:2066-2070`） |
| `/token-budget` | POST | `limits` 整体保存 / `add` 快捷加额度 / `reset` 清空（`:2080-2096`） |

### 3.9 其他前缀

- `/dsh-surfcore/ext/<id>/<path>`：按 `extensionHost.routeFor(id, method, path)` 精确匹配，
  找不到 404（`:2139-2148`）。
- `/dsh-surfcore/pet-api/*`：桌宠专用，独立回环 + 同源 + `x-pet-token` 校验，请求体上限
  256KB（`lib/pet-api.js:22`、`:222`；注册 `lib/index.js:2152-2164`）。
- `/dsh-surfcore/health`：返回 `name` / `version` / `privacyPolicyVersion`（`:2166-2168`）。

---

## 4. B站生物钟调度器

### 4.1 目的与总形状

调度器存在的理由写在文件头：以前「醒来」要靠有人在对话框里挂 clock，那不是过日子，
是戳一下动一下；主人明确要求「计划要她自己执行，改配置要立刻生效」（`lib/scheduler.js:1-16`）。
实现是宿主常驻 + 60 秒 tick + `ctx.sessionController.prompt()` 往她自己的固定会话里塞回合
（`:8-12`），会话 id 固定以跨天保留上下文（`:15-16`）。

`startScheduler(ctx, opts)` 接收 `dshHome` / `biliMjs` / `cwd` / `sessionId` /
`tokenBudget` / `log`（`:426-434`），返回五个成员（`:1135-1162`）：

| 成员 | 语义 |
| --- | --- |
| `invalidate()` | 设置页保存后清旧计划、立刻重跑四条 tick |
| `stop()` | 清 5 个定时器 + 杀直播间子进程 + 摘权限监听 |
| `retire()` | `stop()` + `sessionController.cancel({ sessionId })`，切角色用 |
| `tick()` / `listenTick()` / `liveTick()` | 暴露给测试 |

### 4.2 状态文件与路径

| 文件 | 内容 | 位置 |
| --- | --- | --- |
| `<角色平台目录>/whale-night.json` | 今日计划 `{date, at, atText, window, slots, slotId, action, fired, woke, done, wakes}` | `lib/scheduler.js:438`（读写 `:441-444`） |
| `<角色平台目录>/whale-listen.json` | 倾听基线 `{lastSeen}` | `:182`、`:693-695` |
| `<角色平台目录>/dm-tick-err.log` | 私信 tick 异常栈、skip 判定输入 | `:591-593`、`:783` |
| `<角色平台目录>/silence-seen.json` | 上次醒来时的沉默天数（用于「他回来了」转折） | `:213-217` |
| `~/.dsh/surfcore/bili.config.json` | 每 tick 重读，改配置下一轮生效 | `:439` |
| `<账号目录>/credentials.json` | 全局共用，不进角色包 | `:440` |
| `~/.dsh/daily-nudge.json` | 各类提醒的去重时间戳 | `:975`、`:993` |

`PLATFORM_DIR = activePlatformStateDir(ACCOUNT_DIR)`（`:437`）——角色系统启用时用当前角色
的 bili 目录，未启用时回退旧目录；每次 `startScheduler` 解析一次。

### 4.3 五条滴答

调度器不是一条循环，而是五条互不阻塞的循环，各自有周期与闸门：

| 滴答 | 周期 | 首次 | 职责 |
| --- | --- | --- | --- |
| `tick` | 60s | 8s | 生物钟叫醒 / 重算计划 / 记 missed |
| `dynTick` | 60s | 12s | 四类动态定点提醒 + 补发 + 23:00 待审 + 搭话催进度 |
| `listenTick` | 30s（实际间隔由配置 ≥60s 决定） | 15s | 评论区/at 倾听 |
| `dmTick` | 20s（内部再 5s 节流） | 25s | 私信监听 |
| `liveTick` | 60s | 20s | 直播间长驻子进程管理 |

定时器定义在 `:1117`（tick）、`:1128`（dyn）、`:1130`（listen）、`:1131`（dm）、`:1132`（live）；
首次延迟在 `:1120-1126`。注释记了两次历史：listen 曾临时调 2.5 秒后还原（`:1129`），
dm 从 60 秒改 20 秒「私信要像聊天」（`:1131`）。

### 4.4 `tick` 的判定链

```
waking 互斥（:568-569）
→ sessionController 未就绪则等下一轮（:570）
→ token 额度闸门（:571，budgetBlockedNow）
→ 每个 tick 校正一次会话权限（:573）
→ 读状态 + 当前 slot（:574-576）
→ ① 窗口已过且未触发 → 记 missed + night plan（:577-584）
→ ② action=skip 且已到点 → 也叫醒（写日记）（:586-645）
→ ③ 需要重算 → night plan（:647-654）
→ ④ action=wake 且未触发且到点 → prompt 叫醒（:656-687）
```

几处值得记住的取舍：

- **错过窗口不补醒**，记 `missed` 后立刻排下一趟（`:577-583`）——防止旧计划在窗口外迟到叫醒。
  **「掷到不看」也要叫醒**：以前该分支被重算掉，那一趟等于什么都没发生、日记也没有
  （`:586-588`）；现在轻醒也 prompt，只是流程缩成「写一小段 + `diary log night-skip` +
  扫一眼评论 + 推一句」（`:600-628`）。
- 写状态时 `done` 的语义分新旧：新排程只结束当前 slot（`done: false`），旧格式才结束全天
  （`:631-637`）；叫醒分支固定 `done: false` + `woke: true`（`:671-680`）。叫醒失败只记日志，
  下一 tick 重试（`:682-683`）。

### 4.5 闸门：token 额度

额度不是「少发几条」，而是「今天 B站 不再叫醒」（`:448-450`）。两级实现：

- `budgetBlockedNow(where)`：调 `tokenBudget.block('bili')`，被拦就按 10 分钟一次节流记日志并
  返回 true（`:457-467`）。`promptBili()` 再查一次，被拦就抛带 `code =
  'token-budget-blocked'` 的错误，让调用方区分「额度拦的」和「真失败」（`:468-484`）。额度
  服务本身抛错时**不阻断** B站 链路，只记一笔继续（`:462-466`、`:478-481`）——额度服务坏了
  不能把生物钟弄瘫。

### 4.6 权限降级与自动修复

B站 会话的 cwd 是用户主目录，`workspace-write` 下 DSH 需要 `WRITE_OWNER` 才能准备沙箱，
没有就一条命令都起不来，定时醒来的她只能干等审批（`:385-394`）。所以：

- `ensurePermission(where)` 每个 tick 都跑一次（`:503-510`、`:573`），从
  `bili.config.agent.sandbox` 现读目标档位（默认 `danger-full-access`，`:504`）——注释说明
  「会话可能在别处被切回 workspace-write」（`:572`）。
- `ctx.on('session/created')` 是最可靠时机：此时 session 对象已存在，可在第一句 prompt 之前
  切好（`:512-529`）。
- `ensureSession()` **先 inspect 再 create**：create 对非空白已有会话会新建一个空壳
  （`:541-542`）；inspect 成功后若 `ctx.sessions` 还没同步，等 80ms 补一次（`:544-550`）。
- `applySessionPermissionTo` 优先取 `ctx.permissionPresets`，回退 `ctx.get()`；服务缺失返回
  `permission-services-unavailable`，会话没挂上返回 `session-not-active`，都不抛（`:395-412`）。
  这两个 reason 在 `ensurePermission` 里被静默（`:506`），其他失败才记日志。

### 4.7 `listenTick`：评论区倾听

- 开关 `listen.comment === false` 直接返回（`:794`）；间隔下限压到 60 秒（`:796`）——注释解释
  曾临时放宽到 2 秒，B站 接口经不起（`:795`）；不在窗口内且 `allDay` 关着就不听（`:800`，
  窗口判定 `:696-706`，支持 `24:00` 作结束）。
- 拉 `reply` 一页，`listen.scope !== 'reply'` 时再拉 `at` 一页（`:807-810`）。**首次运行只建
  基线**：`since` 为空时写 `lastSeen = now` 就返回，不把历史回复全倒一遍（`:811-812`）。
- `onlyOwner` 时只留 owner mid（`:813`），按时间升序（`:815`），prompt 里带 tool 行与「合并
  摘要、攻击转待审、只回一两句」的规则（`:819-850`）；成功后把 `lastSeen` 推到这批最大时间
  （`:851`）。

### 4.8 `dmTick`：私信监听

- 只有 `listen.dm` 开着才跑（`:736`）；内部 5 秒节流，注释说明原来 60 秒与定时器叠成
  双层节流最坏 2 分钟（`:737`）。
- `dmScope === 'all'` 时加 `--any`（`:742-743`）。
- 主人私信 → 「直接回、不用审核、要比平时更温柔」；其他人 → 「只回不主动发、一人一天
  3 条、一天共 12 条」（`:753-759`）。目标 mid 来自配置而非写死（`:748`、`:838`，注释
  明确「别把 uid 写死，开源版会带出去」）。
- 异常写 `dm-tick-err.log`（`:783`）。

### 4.9 `liveTick`：直播间

直播间是**独立开关**，点开就跑、关掉就停，不受作息影响（`:863`）。

- 开关被关 → 立即 `kill()` 子进程并标记 `liveStopping = true`，退出回调不算异常
  （`:867-874`、`:907`）；换房间 → 也立即换线（`:876-885`），以 `liveRoomNow` 记当前房间号
  （`:958`）。
- 起一个 `commands/danmaku-await.mjs` 子进程，`liveScope === 'owner'` 且配了 owner mid 时
  加 `--operator-uid`（`:897-899`）。
- **绝不设 `timeout: 0`**：实测它会把子进程立刻 SIGTERM 掉，直播间监听本来就长驻，不设
  timeout 才对（`:901-904`）。命中判据是输出里的 `AWAIT_HIT`（`:909-911`，注释记录原来等
  `DANMAKU_HIT` 是 bug）。
- 命中 → 叫醒 → 2 秒后重挂（`:942`）；非命中退出 → 12 秒退避并记全 `code/signal/stderr/tail`
  （`:945-955`）。

### 4.10 `dynTick`：四类动态与三类提醒

按顺序三道门，每道都「一次只提醒一件事」：

1. **23:00 待审清单**（`:987-1020`）：`h >= 23 && h < 23.2` 且今天没提醒过 → 取
   `attackPending()` 数量，>0 就叫醒并把清单推给管理员；没批之前一条都不许回。
2. **16:00 后搭话催进度**（`:1022-1057`）：`L.taDaily - used > 0` 时每 90 分钟提醒一次。
3. **四类动态定点**（`:1059-1114`）：跳过已关类、今天已发类、还没到点的类；
   过了本类时段只有 `CATCHUP_DAY` 才补（`:1064-1066`）；提醒间隔 `dynamics.gapMin`
   （`:971`、`:1068-1069`）；补发必须带 `--catchup`（`:1098`）；`return` 保证一次只提醒一类
   （`:1113`）。

最前面还有一个**全局间隔**：最近一次真发出的动态距今不足 `gapMin` 就整体返回（`:980-985`）。

### 4.11 `invalidate()` 与配置即时生效

设置页保存 → `scheduler.invalidate()`（`lib/index.js:663`）。它的行为（`:1137-1152`）：

- **只清计划、保留计数**：同一天只写回 `{date, wakes}`，跨天才删文件（`:1138-1144`）。注释
  记录旧实现直接删文件会把「今天已醒几次」也抹掉。
- `lastListenAt = 0` 让间隔立刻重读（`:1145`），`writeL({})` 重置基线避免倒旧消息（`:1146`），
  然后立刻跑 `tick` / `listenTick` / `dmTick` / `liveTick`（`:1147-1151`）。

### 4.12 唤醒提示的组成

`wakePrompt()`（`:264-383`）是「她醒来第一眼看到的东西」，顺序有讲究：

1. 身份上下文六块：人设卡 → 自我锚点 → 管理员 → 身份对齐 → QQ 脱敏记忆 → 记忆卡
   （`:161-170`）。人设卡过 `sanitizePersonaForBili()` 去掉称呼/QQ 段并给 5~12 位数字打码
   （`:55-69`），超长截断（`:86-88`）。
2. 工具链绝对路径：她的 cwd 是用户主目录，`node bili.mjs` 在那里不存在
   （`:275-277`、`:724-728`）；未跑自检时再加一段提醒（`:280-290`）。
3. 沉默分档（`silenceLines()`，`:189-247`）：`normal/quiet/faint` 三档，只给事实与分档
   建议，怎么写留给她；带「他回来了」转折与「反馈漏记自愈」提示。
4. 编号流程 1~9，含硬规则：至少一条主动评论、鱼群泛滥强制聚拢、热评搭话要 `--ta`、
   每天四类动态、疑似攻击转 `attack add` 待审、分享按 `share.via` 三选一
   （`:292-381`）；第 8 步措辞由日记推送开关决定（`:250-262`）。

---

## 5. 记忆与对齐

### 5.1 两个方向，两种「真干活的人」

| 方向 | 默认 | 真正生成方 | 宿主角色 |
| --- | --- | --- | --- |
| B站 → QQ | 开（`qq.biliBridge.memory.enabled`） | 桥接 `src/bili-memory.js` | 只做状态、预览、隐私复检、手动刷新（`lib/memory.js:4-7`、`:344-378`） |
| QQ → B站 | 关（需显式开） | 本模块 | 读公开 feed → 过闸 → 写 `qq-for-bili.md`（`lib/memory.js:9-14`） |

两个方向都不搬运私信、密码、令牌、联系方式、住址、精确位置、真实姓名（`:16`）。

### 5.2 QQ → B站 的五道过滤

输入只有桥接写出的 `state/qq-public-feed.jsonl`（`:35`），里面已限定「通过白名单且不是
私信」的群消息。`collectQqMemory()`（`:103-160`）再逐条过：

1. `isPublicGroupMessage()`：key 必须是 `group:<id>`、群在白名单、`includeOwner` 为假时跳过
   管理员消息、非空、不是命令（`/` `#` `!` 开头）、不是纯媒体占位（`lib/privacy.js:180-194`）。
2. `sanitizeText()`：严重命中且 `dropUnsafeLines` 时整条丢弃，否则逐类替换成占位
   （`lib/privacy.js:135-151`）。`cleanMessage` 固定 `keepNumbers: false` + 220 字上限
   （`lib/memory.js:90-92`）。
3. 群名替换成别名 `群A`/`群B`（`:83-88`、`:154`）；昵称再过一次 `sanitizeText`，失败就统一
   叫「群友」（`:150-155`）；最后用 9 条正则给每条消息贴 `AI/DSH`、`B站`、`游戏`… 主题标签
   （`:42-52`、`:94-96`）。

统计口径很细：`scanned/kept/dropped/redactions/ownerSkipped/privateSkipped/groupSkipped/
byReason/groups/policyVersion`（`:112-123`）。

### 5.3 生成的记忆文件

`buildQqForBiliDoc()`（`:162-264`）固定五段：群友近况 → 最近聊什么（每群最多 8 条）→
最近的梗 → 和 B站 的交集（对齐表）→ **边界（不可越过）** 五条。

- 超长时保留头部 + 「## 五、边界」整段，中间插「已截断」提示，再硬截到 `maxChars`
  （`:253-262`）。`maxChars` 夹在 1200~20000，默认 6000（`:254`）。
- 落盘前还有**最后一道闸**：`assertSafeOutput(doc.replace(/\b\d{5,12}\b/g, ''))`，
  任何严重命中直接拒绝写（`:314-315`；实现 `lib/privacy.js:154-164`）。
- 即使一条都没留下也会写文件（写一份「这段时间没有可同步的公开群消息」），并记审计
  （`:304-312`）——避免文件残留上一次的内容。

### 5.4 隐私复检（读侧）

`readQqForBili()`（`:330-342`）读文件时**再扫一遍**：有 severe 命中就返回
`{ok: false, blocked: true, text: ''}` 并给标签集合。`biliToQqStatus()`（`:345-367`）同理：B站
简报 severe 命中时 `blocked: true` 且 `briefPreview` 置空。也就是说写入时拦一次、展示/注入时
再拦一次。

`memoryStatus()`（`:380-424`）汇总两侧开关、字数、路径、上次同步、隐私策略版本与审计行数。
审计写 `state/audit.jsonl`，超过 2MB 时只保留最后 2000 行（`:266-279`）。

### 5.5 身份对齐：候选与审批

对齐是「谁是谁」，比记忆同步更基础：即使两边记忆同步都关掉，只要对齐开着仍应认出同一个人
（`lib/align.js:4-7`）。

- 存储：单文件 `alignments.json`，含 `links` 与 `candidates` 两个数组，各上限 500
  （`lib/align.js:25-30`、`:110-122`）。写前备份（`:118`）。
- 链接结构：`{id, identities:{qq,bili,tieba}, label, source, confidence, verified, note,
  createdAt, updatedAt}`（`:68-78`）。`label` 是管理员给这个人定的唯一叫法，**优先于人格卡
  的称呼表**，因为昵称会变会撞、ID 不会（`:63-67`）。
- 身份校验只有一条：id 必须 `^\d{4,15}$`（`:43`），B站 侧自动补
  `https://space.bilibili.com/<id>`（`:51`）。**不存任何对话内容**（`:8-10`）。
- 候选：`addCandidate()` 按 `platform + identity.id + counterpart.id` 去重，候选表上限 200，
  且**不写简报**（`:185-199`）。审批：`approveCandidate()` 转成 link（`verified: true`）并从
  候选表移除、重写简报（`:201-221`）；`rejectCandidate()` 只改状态不删（`:223-230`）。
- 自动发现：`detectCandidatesFromText()` 用正则抽「我B站是…」「bilibili.com/space/<mid>」
  「QQ 号 / QQ 群」等（`:400-484`），只产生候选、不自动生效（`:12`）。纯数字昵称也当 mid
  处理（`:436-441`），只有昵称没 mid 时存成 mid 为空的线索等管理员补齐（`:447-449`），
  去重后最多 20 条（`:473-483`）。
- 两份简报的隐私边界不同：QQ 侧在**有称呼时**会带 QQ 号（只用于对消息发送者，明令「绝对
  不要念出来」，`:274-283`）；B站 侧**只给昵称，不给 QQ 号/群号**（`:330-336`）。写简报前
  剥掉 5~12 位裸数字再 `assertSafeOutput`，避免对齐表被当成泄露（`:369-373`）。

---

## 6. 记忆卡宿主职责

### 6.1 与桥接的分工

| 谁 | 做什么 | 位置 |
| --- | --- | --- |
| QQ 桥接（独立进程） | 只做两件事：把事件 append 到 `memory-inbox.jsonl`；把 `memory-card-prompt-qq.md` 注入提示词 | `lib/memory-card.js:4-7` |
| 插件宿主（本模块） | 定时摄取 inbox + `bili-memory.json`，跑遗忘/压缩，写 `memory-card.json/.md` 与两份 prompt，80/90/100% 告警 | `:7-9` |
| B站 调度器 | 每次醒来读 `memory-card-prompt-bili.md` | `:9` |

**只有本模块写卡**，单进程内用 promise 链串行化；桥接只 append（`:11`、`:48-52`）。
`memoryCardIdle()` 暴露给切角色流程，保证没有半截维护/压缩正在写旧角色的卡（`:54-57`，
调用点 `lib/index.js:354`、`:788`）。

### 6.2 tick 与路径解析

`startMemoryCardTimer()`：启动 8 秒后一次，之后每 10 分钟一次；每日衰减由引擎自己按
`dailyHour` 判断，不需要第二个定时器；`SURFCORE_DISABLE_MEMORY_TIMER=1` 时返回 no-op
（`lib/memory-card.js:474-510`、`:479-481`）。

每次调用都重新解析路径（`pathsNow()`，`:32-34`），所以切角色后立即生效，不需要重启。读 inbox
时**同时读 `.1` 与当前文件**，再取最后 4000 行（`:81-92`）——注释记录：桥接在 1MB 时轮转，只读
当前文件会在「轮转恰好在两次整理之间」时永久丢掉那一段，而 `inboxSeen` 会去重，读多不会重复
入库。

### 6.3 一次维护做什么

`runMemoryCardMaintenance()`（`:273-322`）全部串行执行：

1. `enabled === false`：把两份 prompt 文件清空再返回（`:275-281`）。原因很实在——桥接只认
   文件，留着旧文件等于「设置关了但提示词还在」。
2. 建目录，`loadMemoryCard()`；加载失败且文件存在 → 先备份成 `memory-card-corrupt`
   （`:283-287`），坏卡不能被静默覆盖。
3. 每天最多备份一次衰减卡（`forceDecay` 或跨天时备份，`:289-291`）；全量卡是 append-only
   JSONL，**不整份备份**，只在跨天时备份很小的 stats 文件（`:292-298`）。
4. 调引擎 `maintainMemoryCard({paths, config, biliEntries, inboxLines, now, forceDecay,
   fullPaths, fullConfig})`（`:299-308`），清空 prompt 缓存（`:309`），返回
   `changed / addedBili / addedQq / addedPet / addedFull / status / fullStatus / card`
   （`:310-320`）。

### 6.4 容量告警

- 告警档位 = `memoryCardStatus().level` 与卡内 `alerts.level` 取大（`lib/memory-card.js:116`、
  `:183-184`）；`acknowledgedLevel` 是用户确认过的档位。
- `notifyOwnerIfNeeded()`（`:447-472`）也进同一条串行链：通知成功会写
  `alerts.lastNotified`，不能拿「通知前读到的旧卡」覆盖期间维护新增的记忆（`:448-449`）。
- 冷却由 `shouldNotifyOwner()` 判断（同档 12 小时一次，`:456`），关掉 `notifyOwner` 直接
  skipped（`:451`）。只走私聊：调桥接 `/api/memory-card/notify`，不发群（`:458-461`，注释
  `:446`）。提醒取走即落盘的 80% 标志在 `/api/token-budget`（不同机制，见 §7）。

### 6.5 备份、回滚与手动操作

- `compactMemoryCardNow()`：备份 → 先把要衰减掉的归档进全量卡 → 压缩到目标比例 → 保存三份
  输出 + 全量卡（`:325-337`）。
- `applyMemoryCardAction()`（`:340-407`）支持 7 个动作。关键约束：**忘记前先归档**（刚加进来
  还没被维护器扫到的记录也不能丢全量副本，`:343-345`、`:399`）；**置顶记忆不会被忘记**
  （过滤保留 `pinned`，一条都没删掉就回错误，`:356-357`）；`ack` 的 level 夹在 0~3（`:361`）。
- `restoreMemoryCardBackup()`（`:410-427`）：只接受 `memory-card-` 前缀且 basename 与入参完全
  相等（防路径穿越，`:412-413`），拒收全量卡备份（`:414`），恢复前再备份当前卡（`:418`）。
- 读注入块 `memoryCardPromptBlock(platform)` 走 mtime + size 缓存，避免每次唤醒重复读盘
  （`:430-444`）。

---

## 7. token 用量采集

### 7.1 为什么插件自己采

桥接只 follow QQ 会话，看不到 `bili-whale*` 及其子会话；用户要的是「QQ / B站 / 其他」三类
当日总量；插件的 `ctx.on('session/event')` 能拿到**所有**已提交的 assistant usage，按事件
时间计价，天然区分高峰/空闲，比轮询投影更准更省（`lib/token-budget.js:1-9`）。

### 7.2 分类归属

`classify(header, summary)`（`:188-205`）按顺序判定：黑话学习会话 id → `other`（`:191-192`）；
id 匹配 `^bili-whale(?:-|$)` → `bili`（`:193`）；有父会话 → 继承父分类（`:194-198`）；
`agentPreset` 以 `qq-chat` 开头且标题含「黑话」→ `other`，否则 → `qq`（`:199-202`）；在
`state/sessions.json` 的映射里 → `qq`（`:203`）。
6. 其余返回 `null`，**不计入**（`:204`，注释 `:21`）。

父分类继承在回填时跑最多 4 轮，因为子会话可能比父会话晚出现（`:318-333`）。

### 7.3 事件计价

`ingestEvent(session, event)`（`:454-536`）：

- 回填期间事件进队列，回填结束再按 seq 去重入账（`:456-459`、`:436-438`）。**跨天归属按事件
  时间**：`eventDay < state.day` 的迟到事件直接丢弃（`:462-465`），`ensureDay(at)` 用事件时间
  滚天（`:465`）。
- 只认 `assistant/message` 与 `assistant/attempt` 且 `usageOfEvent` 有值（`:479-481`）；
  `seq <= lastSeq` 直接丢（`:490-493`），`turn/step` 缺失也丢（`:494-496`）。retry 轴：
  `llm/retry-started` 记 `{turn, step, retry}`，同 turn+step 的后续事件带该 retry 值，否则
  retry=0（`:467-478`、`:497-499`）。
- 键是 `turn|step|retry`；**同一键后到覆盖先到**：先扣掉上一笔再记这笔（`:507-523`），这样
  流式 `assistant/attempt` 之后到来的 `assistant/message` 不会双算；`entry.seen`（累计投影
  快照）同步调成 `seen + (新 - 旧)`（`:515-518`），保证热重载时 seen 不落后。模型来源优先
  事件里的 `data.message.source.model`，回退会话模型表、再回退默认模型（`:502-503`）；价格表
  30 秒缓存（`:162-166`）。

### 7.4 启动回填（bootstrap）

`bootstrap()`（`:271-442`）解决「插件启动前今天已经花掉的」：

1. `sessionController.list()` 拿全部会话；没有 list 就只靠后续事件（`:277-282`）。
2. 第一遍记元数据 + 能直接判断的分类（`:292-317`）；第二遍（最多 4 轮）把父分类传给子会话
   （`:318-333`）。
3. 逐个会话比对**累计投影** `tokenUsage` 与本地 `seen`：同一天热重载且 `hadState` → 只补
   `cumulative - seen` 增量（`:366-377`）；`seen > cumulative` → 投影还没反映新事件（或会话
   被重置），**不能** inspect 回填，直接以投影为新 seen（`:378-381`）；今天没活动或累计为 0
   → 只同步 seen（`:384-390`）；首次见到且今天有累计 → `inspect` 事件日志，用
   `sumUsageEvents()` 只算今天（`:392-419`）；inspect 失败 → 至少把累计当成 seen，今天从下
   一笔开始算，**不能把已花的钱算成 0**（`:420-426`）。
4. 完成标志 `bootstrapped = true`，清空队列并按 seq 补入，最后强制落盘（`:429-440`）；
   `ensureReady()` 失败后 30 秒内不重试，避免每个请求都打一次（`:444-451`）。

`hadState` 的判据（`:354`）尤其关键：空的 state（例如冒烟环境写过一份 `day=today` 的空文件）
不能把累计投影当成今天的花费，否则会把几天前就存在的 B站 会话整段算进今天（`:351-353`）。

### 7.5 滚天与淘汰

`ensureDay(atMs)`（`:238-255`）：

- 同一天返回 false；**不允许把今天的账倒退成昨天**（`day < state.day` 直接 false，`:242`）。
- 换天时清零三类累计与会话日累计（`:244-247`）。
- 30 天没再见的会话从采集状态里淘汰；不删任何 DSH 数据，下次见到会重新回填（`:248-249`）。
- 清空 samples / retryAxis 并立刻落盘（`:251-253`）。

### 7.6 落盘与对外形状

- 状态文件写到 `~/.dsh/surfcore/` 下的三个文件（`BUDGET_FILES`，`:131-136`），原子写
  （tmp + rename，mode 600，`:569-575`），同时写一份「当日用量」供桥接/看板读
  （`:579-585`）。落盘去抖 800ms（`:589-596`），`dispose()` 强制落盘（`:741-747`）。
- `status()`：先等 `ensureReady`（带 5 秒超时），再滚天，再拼 `ratios` / `blocked` /
  `alert` / `alertedToday` / `alertRatio = 0.8` / `priceTable` 摘要（`:619-666`）。
  `block(scope)` 返回 `evaluateBudget` 结果 + 人话 message（`:668-680`），这是调度器那道
  闸门的底层。
- `recordExternalUsage()`：桌宠直接调 llm 的回合没有 session/event，必须补记否则看板漏账
  （`:682-709`）；分类默认 `other`。
- 额度三操作：`saveLimits` 先校验再写（`:711-718`）；`addLimit` 只收正数（`:720-730`）；
  `resetLimits` 全置 null 即不限（`:732-739`）。`validateLimitsInput` 要求字符串额度必须可
  解析，不能静默变「不限」（`:94-111`）。没配额度时兜底默认 ¥8，但用户**明确填 0** 表示
  不限，不能偷偷改回 8（`:78-91`）。

### 7.7 纯函数层

`lib/token-usage-pure.js` 把「形状归一化」与「事件日志折算今天」抽出来单独单测（`:1-6`）：

- `CATEGORY_KEYS = ['qq','bili','other']`（`:15`）；`emptyCategories` / `normalizeCategories`
  （`:20-33`）；`emptySession` / `normalizeSession`（`:35-64`）。
- `sumUsageEvents(events, {dayStart, fallbackModel, priceTable, defaultModel})`（`:74-134`）：
  - `model/selection` 与 `request/header` 事件更新当前模型（`:84-95`）；
  - `llm/retry-started` 更新 retry 轴（`:96-105`）；
  - 只收 `assistant/*` 且带 usage（`:106-115`）；
  - 同一 `turn|step|retry` 取 **seq 最大**的那条（`:116-123`）；
  - 最后按 `at >= dayStart` 过滤并计价（`:125-133`）。
- 时间边界 `localDayKey` / `localDayStart` 来自 `src/token-budget.js`（import `:45-63`），
  本地时区语义由引擎统一。

---

## 8. 扩展与平台接口

### 8.1 扩展包约定

目录 `extensions/<id>/`，含 `manifest.json` + 入口；**默认 disabled**，必须在设置窗口显式
打开——「代码执行权不能默认给」（`lib/extensions.js:4-6`）。

`normalizeManifest()`（`:27-44`）的校验与截断：

| 字段 | 规则 |
| --- | --- |
| `id` | 缺省取目录名；必须 `^[a-z][a-z0-9_-]{1,31}$`，否则整个 manifest 作废 |
| `name` / `version` / `description` / `author` | 分别 ≤60 / ≤20（缺省 `0.0.0`）/ ≤300 / ≤60 |
| `entry` | 缺省 `index.js` |
| `enabled` | **必须严格 `=== true`** 才算清单级启用 |
| `capabilities` / `platforms` | 数组，各 ≤20 / ≤10 项 |
| `requiresRestart` | 布尔 |
| `dir` | 由宿主按目录拼，不接受清单自带路径 |

启用判据是两级：状态文件里显式写过就用状态文件，否则看清单的 `enabled`
（`:86-90`）。状态文件是 `state/extensions.json`，写前备份（`:66-69`）。

### 8.2 激活与钩子能力

`activate(id)`（`:130-158`）：

1. 已在 `active` 表 → `{ok: true, already: true}`；找不到 manifest / 未启用 / 入口不存在 →
   各自明确错误。
2. `import(pathToFileURL(entry)?v=<uuid>)`——**每次带随机 query 破缓存**，所以 reload 真的
   重新加载模块（`:139`）。
3. `activate(api)`（也接受 `default.activate` 或 `default`）；抛错则按注册顺序**逆序回滚**
   已建的 disposer（`:150-153`）。成功后记 `{manifest, disposers, routes, module, api}`，
   记日志并发 `extension.activated`（`:154-157`）。
4. `deactivate()` 逆序执行 disposer、从表里删、发事件（`:160-168`）。

扩展拿到的 `api`（`:170-229`）：

| 面 | 能力 |
| --- | --- |
| `api.config.get/set` / `api.dataDir` | 自己的持久化配置（写 `extensions.json`）；数据目录 `~/.dsh/surfcore/extensions/<id>/` |
| `api.paths` | 插件根 / surfcore 根 / DSH 状态 / 三份配置 / B站 工具链 / 两份对齐简报 |
| `api.platforms` / `registerPlatform` | 平台注册表；注册返回 disposer 并自动挂到停用链 |
| `api.registerRoute(method, path, handler)` | 挂到 `/dsh-surfcore/ext/<id>/<path>`，返回解除函数 |
| `api.on` / `api.emit` | 事件总线，自动挂到停用链 |
| `api.memory` / `api.align` / `api.bridge` | 主流程同款能力（含桥接任意控制台 API） |
| `api.bili.run(args)` / `api.qq.readConfig()` | 用真 node 跑 `tools/bili.mjs`；只读 QQ 配置（写走受控 API） |
| `api.crypto.randomUUID()` / `api.log(...)` | 生成 id；带扩展前缀的日志 |

`execBili()` 把超时夹在 1s~600s，`maxBuffer` 8MB，输出只留尾部 20KB/4KB 与
`{ok, code, out, err}`（`:231-247`）。

事件分发的两路：`emit` 既调内部监听器，也逐个调已激活模块的 `onEvent(event, payload)`；
两处都 try/catch 单点失败不影响其他（`:117-128`）。

### 8.3 路由注册

主插件只做一次前缀注册，把 `<id>/<rest>` 拆出来，用 `routeFor(id, method, path)` 精确匹配
（`lib/index.js:2139-2148`；实现 `lib/extensions.js:250-256`）。没匹配到就 404 并说明
「扩展 x 没有注册 GET /y」。这层不做参数解析，交给扩展自己。

### 8.4 示例扩展

仓库内两个示例都是 `enabled: false`：`extensions/sts2/manifest.json`（杀戮尖塔启动器预留，
能力 `actions` + `qq.command`，只暴露一个状态路由，不会真的启动游戏）与
`extensions/bili-live/manifest.json`（B站自主直播预留，能力 `actions` + `memory.read` +
`memory.write`）。`extensions/README.md` 给出最小清单模板与宿主 API 表，与上面实现一致。

### 8.5 平台适配器

适配器模型（`lib/platforms.js:1-15`）：

```js
{ id, name, version, status: 'active'|'planned'|'disabled',
  capabilities: ['identity','memory.read','memory.write','prompt.block','actions'],
  status(), readMemory(), writeMemory(), promptBlock(ctx), actions, dispose() }
```

- 能力白名单常量 `PLATFORM_CAPABILITIES`（`:21-27`）；不在白名单里的能力被静默过滤
  （`:40-42`）。
- 内置三个：`qq`（无 write）、`bili`（全五项）、`tieba`（`planned`，UI 可见不可用）
  （`:29-33`）。
- `normalizeAdapter` 要求 id 为 2~24 位小写字母数字下划线（`:35-42`）。
- `register()` 拒覆盖内置平台，返回的 disposer 会调 adapter 的 `dispose` 并**恢复被顶替的
  上一个适配器**（`:69-82`）。
- `setStatus()` 只给内置平台挂运行态探针，不改身份与能力（`:89-94`）——主插件用它把
  `bridgeStatus()` 与 `biliToQqStatus()` 挂到 qq/bili 上（`lib/index.js:164-165`）。
- `require()` 对非 active 平台直接抛（`:96-101`）。
- `statusAll()` 逐个等探针，探针抛错也收敛成 `{ok:false,error}`（`:115-131`）。
- `loadLocal()` 从 `platforms/<id>/manifest.json` 加载本地适配器，跳过 `enabled:false` 与
  `status:'planned'`（`:134-157`）。
- `dispose()` 遍历调每个 adapter 的 dispose 再清表（`:159-164`）。

---

## 9. 桥接进程管理

### 9.1 定位

合体插件**不重写桥接**：QQ 消息、SnowLuma 连接、会话映射仍由 `src/bridge.js` 负责
（被验证过的那一份），这里只做探活、读状态、启停重启、把错误翻译成人话
（`lib/bridge.js:1-7`）。

### 9.2 常量与探测

| 函数 | 行为 |
| --- | --- |
| `consolePort()` / `consoleBase()` | 读 `config.json` 的 `consolePort`（缺省 3100）并拼回环地址（`:18-25`） |
| `consoleToken()` | 先读配置的 `consoleToken`，否则读 `state/console-token`，都没有返回空（`:27-32`） |
| `portOpen(port, host, timeout=900)` | TCP connect 探活（`:34-43`） |
| `lockPid()` / `pidAlive(pid)` | 读 `state/bridge.lock` 的整数 pid；`process.kill(pid, 0)` 判活，`EPERM` 也算活着（`:45-58`） |

`callBridge(path, {method, body, timeoutMs})`（`:60-90`）有一处刻意的补偿：**写操作即使没有
参数也发 `{}`**，否则 content-type 缺失会被桥接 415「请求必须是 application/json」拒掉，
调用方只看到一句莫名其妙的失败（注释记录「立即分享一次」就这么哑过一次，`:62-67`）。
带 `x-console-token`，AbortController 控超时，返回 `{ok, status, data}`，JSON 解析失败退化成
`{raw: 前 500 字}`（`:81-84`）。

### 9.3 状态映射与陈旧判定

`status()`（`:92-118`）分三种结果：

1. 端口不通 → `{ok:false, running:false, port, pid:null, lockPid, hint}`（`:95-104`）。
2. 端口通但 `/api/status` 失败 → `{ok:false, running:true, httpStatus, error, hint}`，
   hint 直指 `consoleToken` 不一致（`:106-116`）。
3. 成功 → `mapStatusPayload()`。

`mapStatusPayload()`（`:131-158`）是单独抽出来的纯映射，理由只有一条：**可回归**。漏一个
字段不会报错，只会让调用方判据恒为 `undefined`——`dshReady` 就这么漏过一次，导致启动完成
弹窗永远等满 180 秒再误报「DSH 还没连上」（`:120-143`）。所以 `dshReady`,
`root`, `dshBaseUrl`, `mode`, `dsh`, `snowluma`, `sessions`, `closure` 都原样透出。

「陈旧」的判定在主插件里，`bridgeStaleReason(status)`（`lib/index.js:463-474`）三条：

1. `status.root` 与当前解析的 `QQBOT_ROOT` 不一致 → 「还在旧目录」。
2. 桥接没有 `dshBaseUrl` → 「旧版本，无法报告 DSH 地址」。
3. `dshBaseUrl` 与当前 DSH 地址（去尾斜杠）不同 → 「还连着旧 DSH」。

### 9.4 启动

`start({dshWebUrl})`（`:168-196`）：

- 端口已通 → `{ok:true, already:true}`。
- **直接 spawn 真正的 `node.exe`**，不经过 `cmd` / `start.bat`：Windows 11 默认终端会把
  `start.bat` 里的 node 控制台托管成 WindowsTerminal 窗口，即使 `windowsHide` 也照样弹一个
  标题为「node src/bridge.js」的黑框（`:172-176`）。手动双击 `start.bat` 仍保留（可见日志 +
  崩溃循环）。
- 解析到的可执行文件 basename 必须匹配 `node(.exe)`，否则直接报「找不到真正的 node.exe」
  （`:177-180`）。
- `detached + stdio:'ignore' + windowsHide`，`unref()`，写 supervisor 日志（`:181-189`）。
- 轮询 24 × 500ms（12 秒）等端口（`:191-195`）；超时返回错误并指向 supervisor 日志。

### 9.5 停止与重启

`stop()`（`:198-246`）：

- 端口不通且无锁 → `already`（`:199`）。Windows：跑 `scripts/stop-qq-bot.ps1`（`:200-214`），
  **失败兜底**是按 `bridge.lock` 里的 pid 直接结束进程再等最多 3 秒确认（`:216-234`）——注释
  记了真实事故：脚本 UTF-8 无 BOM 被 Windows PowerShell 5.1 当 ANSI 读，整脚本解析失败，每次
  都「停止脚本跑完了，但端口仍在监听」（`:218-220`）。非 Windows：按锁 pid 结束，最多等 4 秒
  （`:237-245`）。

`restart()`：`stop()` 成功 → 800ms → `start()`（`:248-254`）。这个 800ms 不是随手写的：
端口释放与锁文件清理需要时间窗。

### 9.6 2 分钟自愈

主插件里的 `maybeAutoStartBridge()`（`lib/index.js:479-506`）由两个入口触发：激活时一次
（`:2179`）与 2 分钟一次的定时器（`:2181`）。顺序是：`bridgeRepairBusy` 互斥（`:482-483`）→
`SURFCORE_SKIP_AUTOSTART=1` 直接返回（`:485`）→ QQ 启动开关关着直接返回（`:487`）→ 桥接在跑
则判陈旧、陈旧就 restart（`:489-496`）→ 桥接没跑则 start（`:498-500`）。`start-all` 复用同一
判据：陈旧则重启、否则启动（`:1680-1685`）。

### 9.7 启动完成弹窗

`watchStartupCompletion()`（`:1344-1428`）给「一键启动」一个可见结果：

- 开关 `bridge.startupNotify !== false` 且至少一边要启（`:1349-1350`）；最多等 180 秒，
  每 2 秒轮询（注释解释鉴权握手可能比 90 秒慢，`:1351-1353`、`:1375-1388`）。
- QQ 就绪判据严：`running && ok !== false && dshReady === true && snowluma.connected &&
  snowluma.accountOnline`（`:1354-1358`）；超时前再补查 1.5 秒，避免把「还在连」误报成
  「DSH 未连接」（`:1389-1401`）。
- 成功/失败各弹一个置顶窗口；弹窗用 wscript + VBScript，UTF-16LE + BOM 写临时文件，中文不
  乱码，120 秒后删临时文件（`:1317-1342`）。失败文案区分「桥接没跑 / 桥接还连着旧端口 /
  鉴权等待中」并附 SnowLuma 诊断 hint（`:1406-1420`）。

---

## 10. 边界与失败模式

### 10.1 HTTP 边界

| 层 | 判据 | 位置 |
| --- | --- | --- |
| 回环 | **Host 请求头**是 `127.0.0.1` / `localhost` / `[::1]` / `::1` | `lib/http-guard.js:45-55` |
| 同源 | 有 Origin 就必须与 Host 一致；没 Origin 视为通过（非浏览器） | `lib/http-guard.js:63-72` |
| 内容类型 | 写操作必须 `application/json` | `lib/index.js:516-519` |
| DSH 准入 | `connection.requestRejection(req)` | `lib/index.js:521-529` |
| 请求体 | 设置页 512KB；桌宠 256KB，超限直接断开连接 | `lib/http-guard.js:23-35`；`lib/pet-api.js:22` |
| 桌宠令牌 | `x-pet-token` 或 `?token=`，定长比较 | `lib/http-guard.js:74-87` |

为什么用 Host 而不是对端地址：DNS rebinding 场景下页面把外部域名解析到 127.0.0.1 时，对端
地址就是回环，只有 Host 还能认出真实来源；浏览器无法伪造 Host（`lib/http-guard.js:37-44`）。
`safeEqual()` 有一条「失败关闭」：空令牌永不通过，因为 `timingSafeEqual` 对两个空 buffer 返回
true，那样「还没生成令牌」就会被当成「令牌正确」（`:78-80`）。`isLoopbackReq()` 里还有一段
修好的坑：IPv6 字面量在 Host 里是 `[::1]:8080`，`split(':')[0]` 只能拿到 `[`，于是 `[::1]` /
`::1` 分支成了永远走不到的死代码（`:48-53`）——2026-10-26 审计时单测第一次跑出来的洞。

### 10.2 隐私边界

- 闸门是**确定性正则**，不交给模型判断：「模型可以撒谎，正则不会」（`lib/privacy.js:12`）。
- 三类规则：密钥/令牌（9 条）、PII（8 条，其中身份证/银行卡/住址/真名/精确位置是 severe）、
  联系方式（4 条），外加一条 `PRIVATE_TOPIC` 关键词（`lib/privacy.js:18-48`）。单条文本：
  severe 且 `dropUnsafeLines` → 整条丢弃，否则逐类替换 + 可选数字打码（`:135-151`）。
- 文件级：`assertSafeOutput()` 有任何 severe 命中就抛 `PRIVACY_BLOCKED`，拒绝落盘
  （`lib/privacy.js:154-164`）。调用点：QQ→B站 记忆（`lib/memory.js:315`）、两份对齐简报
  （`lib/align.js:370-371`）。
- 链接只放行 B站 域名与固定路径形状，其余替换成 `[链接已隐藏]`（`lib/privacy.js:100-113`）；
  跨平台准入只认公开群消息——私信/未知 key、非白名单群、管理员消息（默认）、命令、纯媒体
  一律拒绝（`:180-194`）。

### 10.3 配置与文件边界

- 原子写 + 写前备份 + 按来源保留 40 份（§2.5/§2.6）；凭据文件 `chmod 0o600`
  （`lib/store.js:206-207`；手写 cookie 时也显式 chmod，`lib/index.js:2001`）。
- 备份恢复只接受 basename 且必须命中前缀白名单（`lib/index.js:1116-1130`；
  `lib/memory-card.js:412-414`）；日志尾部读取有上限——插件日志 512KB、桥接日志按行数
  （`lib/index.js:116-127`、`:2051-2056`；`lib/bridge.js:260-272`）。

### 10.4 已知失败模式与处置

| 失败 | 处置 | 位置 |
| --- | --- | --- |
| 额度服务抛错 | 记日志后继续，不阻断 B站 链路 | `lib/scheduler.js:462-466` |
| 额度被拦 | 抛 `token-budget-blocked`，调用方区分处理 | `lib/scheduler.js:468-484` |
| 权限服务缺失 / 会话没挂上 | 返回 reason，不抛；tick 里静默 | `lib/scheduler.js:395-412`、`:506` |
| 会话未就绪 | `tick` 直接 return 等下一轮 | `lib/scheduler.js:570` |
| 计划文件损坏 | `readState()` 返回 null → 走重算分支 | `lib/scheduler.js:441`、`:647-654` |
| 叫醒 prompt 失败 | 只记日志，下一 tick 重试 | `lib/scheduler.js:682-683` |
| 直播间非命中退出 | 记全原因，12 秒退避重挂 | `lib/scheduler.js:945-955` |
| 桥接停止脚本失效 | 按 lock pid 兜底结束 | `lib/bridge.js:216-234` |
| 桥接陈旧（端口/目录变了） / 记忆卡 JSON 损坏 | 2 分钟自愈重启；损坏卡先备份成 `memory-card-corrupt` 再重建 | `lib/index.js:479-506`、`:2181`；`lib/memory-card.js:283-287` |
| 扩展激活抛错 | 逆序回滚已注册 disposer | `lib/extensions.js:150-153` |
| token 回填 inspect 失败 | seen 对齐累计，今天从下一笔算 | `lib/token-budget.js:420-426` |
| token 回填整体失败 / 角色迁移失败 | 30 秒内不重试；迁移失败继续用旧布局不下线 | `lib/token-budget.js:444-451`；`lib/index.js:297-300` |

### 10.5 结构性风险（阅读时注意）

- `/api/overview` 返回的 `paths` 来自 `pathSummary()`，**未脱敏**（`lib/index.js:602`、
  `lib/store.js:593-603`）。它只对本机回环开放，但任何本机进程都能读到实际目录结构。
- `schedulerStatus.lastTickAt` 在宿主侧从未被更新，永远是 `null`（`lib/index.js:181`、
  `:269`、`:361`）。UI 若依赖它判断「最近一次 tick」会得到空值。
- 调度器写状态用直接 `writeFileSync`，不是原子写（`lib/scheduler.js:442-444`）；写一半被
  kill 可能截断，下一次 `readState()` 返回 null 会走重算——可接受，但不是原子。
- `invalidate()` 里 `writeL({})` 把倾听基线清空（`lib/scheduler.js:1146`），下一次 `listenTick`
  会以「现在」为新基线（`:811-812`）：设置页保存越频繁，这期间的新回复越容易被当成基线吃掉。
- `bridge.autoStart` 仍在保存时被镜像写入（`lib/store.js:586-587`），只是不再被读取——属于为
  「降级回旧版」保留的兼容面，不是活配置。扩展的 `registerRoute` 只校验 handler 是函数，
  不校验路径形状（`lib/extensions.js:200-209`），路径规范化交给主前缀分发（`lib/index.js:2141-2145`）。

---

## 11. 未覆盖 / 不确定 ⚠️

1. **前端与桌宠未覆盖**：`lib/client.js`（4349 行，设置窗口 UI）不在本文范围，本文所有「设置
   页会怎样」都只从 API 契约反推；`lib/pet.js`、`pet-chat.js`、`pet-purpose.js`、`pet-api.js`
   只在 `lib/index.js` 里看到装配与路由（`:197-209`、`:1459-1512`、`:2152-2164`），其内部行为
   （LLM 调用、语音、专注、host.json 写法）未读，故 §3.8 只写路由能力面。
2. **被依赖的核心引擎未逐行**：`src/character-persona.js`、`src/memory-card.js`（引擎）、
   `src/token-budget.js`（额度评估）、`src/model-prices.js`、`src/admin-identity.js`、
   `src/self-identity.js`、`src/token-ledger.js`、`src/share-mode.js`。只读了 import 面与
   少量默认值（如 `DEFAULT_MEMORY_CARD_CONFIG` 的容量字段），**衰减/遗忘/压缩的具体算法、
   `evaluateBudget` 的命中语义、价目表版本**均未核。
3. **工具链语义部分靠调用点推断**：`tools/lib/kinds.mjs`（`kindsNow` / `slotOf` /
   `CATCHUP_DAY` / `DEFAULT_KINDS`）、`limits.mjs`（四本账九项额度）、`free-gate.mjs`
   （`usageToday`）、`pins.mjs`、`night-schedule.mjs`、`msgfeed.mjs`、`fish-guard.mjs`、
   `watch-history.mjs`、`pref-scan.mjs`。例如四类动态的默认 slot、`CATCHUP_DAY` 的取值、
   `freeLimits` 的字段名，本文只按调度器里的用法描述，**未核对定义处**。
4. **未运行任何东西**：本文是静态阅读结论，没有起 DSH、没有跑
   `plugins/surfcore/scripts/test-*.mjs`。第 10 节的失败模式来自代码里的 try/catch 与注释，
   不等于实际观测。
5. **DSH 版本相关的接口契约未验证**：`permissionPresets.current/set`、`sessions.get`、
   `sessionController.list/inspect/cancel`、`connection.requestRejection`、
   `settings.describe/update`、`webServer.register({kind:'prefix'|'exact'})` 的语义都按
   当前代码用法描述，未对照 DSH 0.2.1-rc.2 的实现确认边界（例如 `requestRejection` 返回
   `undefined` / `false` / code 三种情况的差异，代码只做了「非空即拒」）。
6. **`qq-mode` 命名空间推导规则**只在 `lib/qq-mode.js:1-14` 的注释里，未实测 DSH 是否真的
   按「entry id + Config + volatile」推导。**spawn 细节未实测**：`lib/bridge.js:172-176`
   关于 Windows 11 默认终端弹黑框的结论、`lib/index.js:1221` 的 `start` 调用、
   `lib/scheduler.js:901-904` 的「`timeout: 0` 会立刻 SIGTERM」都是注释里的实测记录，未复现。
7. **`pruneBackups` 的分组边界**：正则 `^(.*)-(\d{4}-\d{2}-\d{2}T[^-]+)$`
   （`lib/store.js:238`）依赖文件名的时间戳格式；手工放进 `backups/` 的异形文件名会被当成
   独立来源各自保留 40 份。此边界未测。**`schedulerStatus.lastTickAt` 恒为 null**
   （`lib/index.js:181`、`:269`）——判断为「未被写入」，但不排除前端另有计算路径，未核。
8. **SnowLuma 探测路径**：`findSnowLumaInstall()` 会枚举用户主目录下若干常见目录名
   （`lib/index.js:1172-1180`）。本文未列这些目录名以避免写死本机布局，行为描述为「按配置
   + 环境变量 + 常见安装位置探测」，具体清单以代码为准。
9. **行号漂移**：本工作树仍在修改中（`package.json` / `README.md` 时间戳晚于多数 lib 文件），
   重跑后建议用 `grep -n` 复核本文引用。
