# B站 子系统（SurfCore）

> 这份文档回答：**B站 这半是"谁"在活动、她一天怎么过、每一次对外发言要过几道闸、钱（额度）和鱼（同类）是怎么被管的、坏了会怎么坏**。
> 只描述现状，所有结论都能在代码里对上（`文件:行号`）。**不含**任何真实 UID / 房间号 / cookie / 令牌；示例一律用占位符。
>
> 路径简写（全文统一）：
> - `tools/…` = `plugins/surfcore/tools/…`（B站 工具链，独立 CLI，不依赖插件宿主）
> - `lib/…` = `plugins/surfcore/lib/…`（插件侧：调度器、设置页、记忆搬运）
> - `src/…` = 仓库根 `src/…`（桥接侧 + 记忆生成器）
> - `~/.dsh/surfcore/…` = 运行时数据目录（账号级 `bili/`、角色级 `characters/<id>/bili/`）
>
> 配套阅读：[ARCHITECTURE.md](ARCHITECTURE.md)（进程拓扑与配置模型）、[PITFALLS.md](../PITFALLS.md)（踩过的坑）、[CROSS_PLATFORM_IDENTITY.md](CROSS_PLATFORM_IDENTITY.md)（QQ ⇄ B站 认人）。
> **最后核对**：2026-10-26（全仓库逐行梳理）。配套阅读：总纲 [ARCHITECTURE.md](ARCHITECTURE.md) · 边界 [BOUNDARIES.md](BOUNDARIES.md) · 索引 [../README.md](../README.md)。

---

## 0. 一句话定位

**B站 这半，是"同一个角色"用另一个账号、另一个作息、另一套额度，在公开互联网上过日子。**

- **谁在活动**：一个 **B站 账号**（cookie 落在 `bili/credentials.json`），人格来自与 QQ **同一张**人设卡；
  她在 B站 的身份由 `bili.config.json` 的 `self` 段（`mid` / `name`）声明（`tools/lib/config.mjs:22-60` 的默认值里 **没有** `self`，
  它由扫码登录写回，见 `lib/bili-qr-login.mjs:244-263`）。
- **谁在驱动**：插件宿主里常驻的**生物钟调度器**（`lib/scheduler.js`），每 60 秒一个 tick（`lib/scheduler.js:181`），
  到点用 `ctx.sessionController.prompt({ sessionId, mode:'queue' })` 往**她自己那条固定 DSH 会话**里塞一个回合
  （`lib/scheduler.js:483`、`:660-668`）；会话 id 形如 `bili-whale` / `bili-whale-<角色id>`（`lib/index.js:259-260`）。
  跨天保留上下文，不是每天开新会话（`lib/scheduler.js:14-16`）。
- **和 QQ 的关系**：**同一个人，两个世界**（`ARCHITECTURE.md:111-116`）。
  QQ 侧由桥接进程驱动，B站 侧由插件调度器驱动；两边共享**人格卡 / 衰减记忆卡 / 身份对齐表**，
  但 **B站 侧绝不出现 QQ 号与群号**（`lib/scheduler.js:54-69`、`:93-95`）。
  记忆是**双向但受控**的：B站→QQ 由 `src/bili-memory.js` 生成、`lib/memory.js` 复检；
  QQ→B站 默认**关闭**，开启后走白名单群消息 + 隐私闸门（`lib/memory.js:1-17`、`:295-327`）。
- **一句话边界**：B站 侧是"公开面"。所以它有**两套硬约束**：一套管**分寸**（四本账额度、鱼群保护），
  一套管**不泄密**（出站身份闸、脱敏）。这两套都写在代码里，不写在自觉里（`tools/lib/free-gate.mjs:1-19`、`tools/lib/outbound-guard.mjs:1-16`）。

---

## 1. 账号与凭据

### 1.1 两个账号：鱼（fish）与主人（owner）

| 角色 | 是谁 | 存在哪 | 能干什么 | 不能干什么 |
| --- | --- | --- | --- | --- |
| **鱼 / 小肥鱼** | 她自己的 B站 小号（"公开面"的那个） | `~/.dsh/surfcore/bili/credentials.json`（`lib/paths.js:61`） | 看视频、评论、回复、弹幕、发动态、转发卡片、私信主人、点赞 | —— |
| **主人 / owner** | 使用者本人 | `~/.dsh/surfcore/bili/owner-credentials.json`（`lib/paths.js:62-64`） | **只给"一键抓取偏好"做只读扫描**（`tools/lib/pref-scan.mjs:242`、`:450-452`） | **不拿主人号发评论/动态/私信**（`lib/bili-qr-login.mjs:9-13`） |

`owner` 的另一个用途是**身份**而不是**通道**：`bili.config.json` 的 `owner.mid` / `owner.name` 决定
"她要 @ 谁"（`tools/commands/comment.mjs:132-133`）、"私信只能发给谁"（`tools/commands/dm.mjs:73`）、
"出站文本里哪些数字被保护"（`tools/lib/outbound-guard.mjs:45-47`）。

> ⚠️ 单账号用户：`self.mid === owner.mid` 是允许的，但扫码绑鱼时必须**显式勾选**「与主人同一个号」，
> 否则会被归属校验拒掉（`lib/bili-qr-login.mjs:284-289`）。

### 1.2 凭据文件的字段

`credentials.json` / `owner-credentials.json` 是同一套字段（`lib/bili-qr-login.mjs:228-252`）：

```jsonc
{
  "sessdata": "<SESSDATA>",   // 登录态主票据：没有它一切写操作 401/未登录
  "bili_jct": "<bili_jct>",   // CSRF token：所有 POST 都要带 csrf= 这个值
  "buvid3":   "<buvid3>",     // 设备指纹；缺了部分接口会被拦（selftest 只给 warn）
  "mid":      "<账号 mid>",   // 扫码时由 nav 确认后写入
  "name":     "<昵称>",
  "savedAt":  "<ISO 时间>"
}
```

- **读法极不统一**：绝大多数命令只认 `{sessdata, bili_jct, buvid3}` 三件套并**硬校验非空**
  （`tools/commands/comment.mjs:208-213`、`tools/commands/dynamic.mjs:30-32`、`tools/commands/danmaku.mjs:33-35`），
  `mid` / `name` 只在扫码回读与设置页展示时用（`lib/bili-qr-login.mjs:298-320`）。
- **cookie 拼法**到处都是同一行字符串：`SESSDATA=…; bili_jct=…; buvid3=…`
  （`tools/lib/fish-guard.mjs:258-263` 是唯一抽出来的 `cookieHeader()`）。
- **绝不落日志**：`tools/verify/session.mjs` 只打印账号名/mid/手机绑定/硬币（`:30-36`）；
  写操作在 dry 阶段一律打 `SESSDATA=***; bili_jct=***`（`tools/commands/comment.mjs:333`、`tools/commands/dynamic.mjs:98`）。

### 1.3 扫码登录（QR）为什么用 Edge

仓库里没有二维码生成库，而 **B站 官方登录页会把二维码画成一张 `data:image/png`**。
所以做法是：起一个 **headless Edge** → CDP 打开 `https://passport.bilibili.com/login` → 把二维码图取出来给设置页 →
轮询 cookie，扫码确认后写盘（`lib/bili-qr-login.mjs:1-30`）。

- 端点：设置页 →「扫码登录小肥鱼」/「口味权重 · 一键抓取 · 抓取主人」→ 宿主接口 `/bili/qr/start` + `/bili/qr/poll`
  （`lib/client.js:2114-2212`、`plugins/surfcore/scripts/test-client-contract.mjs:302-306`）。
- **不填账号密码、不点登录按钮**；只打开官方页（`lib/bili-qr-login.mjs:9-13`）。
- **归属校验是硬闸**（`lib/bili-qr-login.mjs:271-295`）：
  - 绑主人：不能是鱼自己的 mid；配了 `owner.mid` 就必须完全一致（防串号）。
  - 绑鱼：不能是主人号（除非单账号 + 显式确认）；已有 `self.mid` 时**不允许不声不响换号**。
- 二维码 TTL ≈180 秒，代码留 10 秒余量（`lib/bili-qr-login.mjs:27`）；同时只保留一个扫码会话，避免多个 Edge 泄漏（`:327`）。
- **依赖 Windows + Edge**；Edge 缺失时返回可读错误（`lib/bili-qr-login.mjs:329-331`）。手动粘贴 cookie 作为备用路径保留。

### 1.4 权限边界（账号侧 vs 角色侧）

路径解析把"账号级"和"角色级"分开（`tools/lib/state-paths.mjs:1-9`、`:53-64`）：

| 类别 | 位置 | 内容 | 换角色会怎样 |
| --- | --- | --- | --- |
| **账号级** | `~/.dsh/surfcore/bili/` | `credentials.json`、`owner-credentials.json`、`memes/`、`bin/`、`tmp/` | 不变（换角色不换账号） |
| **角色级** | `~/.dsh/surfcore/characters/<id>/bili/` | `quota.json`、`scores.json`、`favorites.json`、`whale-diary*.md`、`daily-dynamic.json`、`fish-guard.json`、`watch-history.jsonl`、`bili-memory.json` … | 整包切换；`current.json` 每次进程启动读一次（`:28-50`） |

- 角色不存在 / id 非法（正则 `^[a-z0-9][a-z0-9_-]{0,39}$`）→ **回退旧目录** `bili/`（`tools/lib/state-paths.mjs:40-55`）。
- 长命令在**开始时**捕获目录：中途切角色不会把旧角色的行为记到新角色账上（`tools/lib/state-paths.mjs:6-9`）。
- `bili.config.json` 是**全局**的（`tools/lib/state-paths.mjs:66`、`tools/lib/config.mjs:19`），角色差异靠 `characters/<id>/character.json` 覆盖人格名（`src/bili-memory.js:174-183`）。

---

## 2. 生物钟调度

### 2.1 两套"生物钟"，别混

| 名称 | 文件 | 跑在哪 | 职责 |
| --- | --- | --- | --- |
| **调度器（真生物钟）** | `lib/scheduler.js` | 插件宿主进程内，常驻 | 每 60 秒 tick，决定"现在要不要叫醒她"，并塞 prompt |
| **排程器（掷骰子）** | `tools/commands/whale-night.mjs` + `tools/lib/night-schedule.mjs` | 每次由调度器 `execFile` 起一个短进程 | 算今天的 slots（几点醒/几次醒/醒不醒），写 `whale-night.json` |

链路：`tick()` → 需要重算时跑 `node <bili.mjs> night plan`（`lib/scheduler.js:651`）→ 读回 `whale-night.json` →
到点了自己 prompt，**不依赖 `night clock` 的长睡进程**（`night clock` 只留给"手动/兜底"：`tools/commands/whale-night.mjs:213-273`）。

### 2.2 tick 周期与五个循环

| 循环 | 周期 | 触发时机 | 代码 |
| --- | --- | --- | --- |
| `tick()` 生物钟 | **60 s** | 启动 +8 s 先跑一次 | `lib/scheduler.js:181`、`:1117`、`:1121` |
| `dynTick()` 四类动态/催办 | 60 s | 启动 +12 s | `:1128`、`:1122` |
| `listenTick()` 评论区倾听 | 30 s 轮询，**真正间隔**由 `listen.commentIntervalSec`（默认 300 s，下限 60 s）决定 | 启动 +15 s | `:1130`、`:796-797` |
| `dmTick()` 私信 | 20 s（内部再节流 5 s） | 启动 +25 s | `:1131`、`:737` |
| `liveTick()` 直播间 | 60 s（只在没挂上时才动手） | 启动 +20 s | `:1132`、`:887` |

`stop()` 会把 5 个 `setInterval` + 5 个启动 `setTimeout` 全部清掉，并 kill 直播子进程、摘掉 `session/created` 监听
（`lib/scheduler.js:1153`）；`retire()` 额外取消该会话的在途回合（切角色用，`:1155-1158`）。

### 2.3 作息窗口 `night.windows`

配置形状（`tools/lib/config.mjs:51-52`）：

```jsonc
"night": {
  "windows": [{ "start": "20:00", "end": "24:00", "wakes": 1 }],
  "skipChance": 0.3,     // 每次醒来独立掷骰子："今天不想看"也是活人
  "maxVideos": 5,        // 一次醒来最多初筛几条
  "minGapMin": 20        // 相邻两次苏醒最小间隔
}
```

规则与收敛（`tools/lib/night-schedule.mjs:28-46`、`lib/scheduler.js:64-87`）：

- **跨午夜**：`end <= start` 视为跨午夜，`end += 1440`，`wrap = true`，比较一律用分钟数
  （`tools/lib/night-schedule.mjs:33-45`、`tools/commands/whale-night.mjs:64-82`）。
- **每个窗口 = 一次机会**；`wakes` 是该窗口的次数，`0` = 这个窗口不醒。
- **全天硬上限 12 次**：`MAX_WAKES = min(12, maxWakesPerDay ?? 12)`（`tools/commands/whale-night.mjs:86`、
  `tools/lib/night-schedule.mjs:107`）。旧配置没有 `windows[]` 时退回 `windowStart/windowEnd` 单窗口（`tools/commands/whale-night.mjs:64-68`）。
- **不补醒**：窗口 `end` 已过 → 记 `missed`，不后补（`tools/lib/night-schedule.mjs:161-162`、`:216-230`；
  调度器 tick 也会主动把过期 slot 标 `missed` 并重排，`lib/scheduler.js:576-584`）。
- **晚到但在窗口内**：计划点已过、窗口未过 → 改成"现在就叫醒"（`tools/lib/night-schedule.mjs:163-164`、`:221-225`）。

### 2.4 排程算法（用户选 C，2026-10-23）

`buildNightSchedule()`（`tools/lib/night-schedule.mjs:96-209`）：

1. **每窗至少 1 次**：先给每个还没结束的窗口 1 个 slot（`base`）。窗口数 > 上限时只覆盖前 N 个并**明确 warning**
   （`:117-124`）。
2. **多余次数按"该时段最近内容质量"分配**：质量 = `scores.json` 里最近 30 天落在该窗口内评分的均值
   （`tools/lib/night-schedule.mjs:61-83`、`lib/whale-night` 调用点 `tools/commands/whale-night.mjs:152`）。
   质量相同 → **优先更晚的时段**（prime time）（`:126-131`）。
3. **相邻 slot ≥ `minGapMin`**（默认 20 分钟）；放不下时：base 保底压缩、extra 丢弃（`:157-177`）。
4. **每个 slot 在该段内随机取点**，再掷 `skipChance` 决定 `action: 'wake' | 'skip'`（`:179-192`）。
5. 产出 `{ slots, warnings, cap, baseCount, extraCount }`，slot 带 `id/window/start/end/at/atText/kind/index/action/status`
   （`:180-192`）。

状态机：`pending → fired | skipped | missed`（`tools/lib/night-schedule.mjs:236-242`）。

### 2.5 唤醒提示里到底有什么

`wakePrompt()`（`lib/scheduler.js:264-383`）拼装顺序（**每一段都有理由**）：

1. `【生物钟】你醒了 —— HH:MM（窗口 …·保底/加餐）`（`:272`）
2. **合体身份上下文**（`:161-170`）：人设卡 → 跨平台自我锚点 → 管理员身份 → 身份对齐表 → QQ 脱敏近况（默认关）→ 记忆卡。
   人设卡里**QQ 称呼表/QQ 号段落会被整段剔除**，并把 5–12 位数字替换成 `[号码已隐藏]`（`:54-69`）。
3. `［工具］所有命令都用这一条：node "<绝对路径>/bili.mjs"`（`:277`、`:727-728`）——她的会话 cwd 是用户主目录，那里没有 `bili.mjs`。
4. **没跑过启动测试**就提醒主人（`selftest-passed.json` 不存在时，`:280-290`）。
5. **沉默/情绪**（`:189-247`）：静默天数分档 `normal/quiet/faint`，带上"他回来了"转折与"反馈漏记则自愈"的提示。
6. **硬规则 + 流程**（`:292-381`），关键几条：
   - ⭐ **本轮至少发一条主动评论**；鱼群泛滥时**强制聚拢**，不许以"没有可聚拢鱼楼"跳过（`:293`、`:315-322`）。
   - 收藏 ≠ 低配分享，5 条判据（`:305-308`）；给鱼点赞要**独立发生**（`:310-312`）。
   - 搭话必须带 `--ta`，两本账分开（`:324-332`）。
   - 记分是"当天动态"的前置（`:334-335`）。
   - 攻击/阴阳怪气 → **一个字都别回**，`attack add` 记待审（`:352-356`）。
   - 分享三选一按 `share.via` 走（`dynamic` 默认 / `dm` / `comment`，`:357-366`）。
   - 收尾三件：两本日记、`comment-digest`、`quota react --auto`（`:367-381`）。

### 2.6 四类动态的定点提醒（`dynTick`）

`lib/scheduler.js:966-1115`，按优先级：

1. **23:00 待审清单**：`h ∈ [23, 23.2)` 且今天还没提醒过 → 有 pending 就叫醒她推给主人审（`:987-1020`）。
2. **搭话催进度**：16:00 后若 `taToday() < taDaily`，每 90 分钟催一次（`:1022-1057`）。
3. **四类动态**：`dynamics.enabled` 关掉就整体不跑；逐类检查 `enabled` / 今天是否已发（`daily-dynamic.json`）/
   是否到点（`h >= slot`）/ 是否还在本类时段（`slotOf`）；**一次只提醒一类**（`:1059-1114`）。
   - 错过时段：**只有上线日 `CATCHUP_DAY = '2026-10-21'`** 才补，且补发口吻必须带 `--catchup`（`:1064-1066`、`:1096-1098`；
     常量在 `tools/lib/kinds.mjs:18`）。
4. **任意两条动态之间 ≥ `dynamics.gapMin`**（默认 30 分钟）：`dynTick` 开头读 `daily-dynamic.json` 最新一条，
   未满间隔就整体 return（`:971`、`:980-985`）。

### 2.7 评论区倾听（`listenTick`）

`lib/scheduler.js:788-858`：

- 开关：`listen.comment !== false`；间隔 `max(60, commentIntervalSec ?? 300)`；`listen.allDay` 关掉时**只在作息窗口内听**（`:794-800`、`:696-706`）。
- 数据源：`/x/msgfeed/reply` +（`listen.scope !== 'reply'` 时）`/x/msgfeed/at`（`:807-810`）。
- **首次只建基线**：`whale-listen.json` 没有 `lastSeen` 时写入"现在"，不倒历史（`:812`）。
- 有新消息 → prompt，提示里给的是 `comment-digest` 合并看一眼、`--once-per-person` 只在开关=开时才加、
  动态回复要用 `--type 11/17` 和 `comment-digest` 打印的 19 位 oid（`:829-846`）。
- 投递完把 `lastSeen` 推到 `max(fresh.t)`（`:851`）。

### 2.8 私信监听（`dmTick`）

`lib/scheduler.js:730-786`：

- 开关 `listen.dm`；节流 5 秒（原来是 60 秒叠定时器造成最坏 2 分钟，`:737`）。
- `listen.dmScope = 'all'` → `dm-await --once --json --any`（谁找她都叫醒）；否则只认主人（`:742-743`）。
- prompt 里对主人/陌生人给**不同口径**：主人"直接回，不用审核，更温柔"；陌生人"`dm --to <mid>`，≤200 字，一人 3 条/天"（`:753-758`）。
  注：提示词里写"一天共 12 条"，代码实际是 `STRANGER_DAILY = 30`（`:144`）——见 §11。
- 出错写 `dm-tick-err.log`（`:783`）。

### 2.9 直播间监听（`liveTick`）

`lib/scheduler.js:862-960`：

- **独立开关**，不受作息影响；关掉立刻 kill 子进程；**换房间号**也立刻换线（`:863-885`）。
- 子进程是 `tools/commands/danmaku-await.mjs`（**不是** `bili.mjs danmaku`，`:896-897`），参数 `--room`，`liveScope=owner` 时加 `--operator-uid`（`:898-899`）。
- **不设 `timeout`**（`timeout: 0` 会把子进程立刻 SIGTERM，`:901-903`）；必须用**真 node.exe**（主程序会让 `gethistory` 返回空，`:486-499`、`:900`）。
- 命中判据是子进程打印 `AWAIT_HIT`（`:911`）；命中 → prompt → 回复完 **2 秒**后重挂（`:942`）；异常退出 → 退避 12 秒（`:955`）。

### 2.10 会话与权限

- 会话创建：`inspect` 已存在就**不 create**（create 会新建空壳会话），不存在才 create（`lib/scheduler.js:538-565`）。
- 权限：配置 `agent.sandbox`（默认 `danger-full-access`），每个 tick 都校正一次；
  因为会话 cwd 是 `%USERPROFILE%`，`workspace-write` 下会因 `WRITE_OWNER` **一条命令都起不来**（`:386-412`、`:502-510`）。
  切角色/新会话时靠 `session/created` 事件在第一句 prompt 前切好（`:512-529`）。
- **token 额度闸**：`tokenBudget.block('bili')` 命中时，**所有 prompt 都不投**（连监听 tick 也跳过，避免"消息被读掉却没回"），
  日志 10 分钟节流一次（`:448-484`）；额度服务异常**不阻塞**整条链路（`:462-466`）。

---

## 3. 内容生产（会写出去的东西）

### 3.0 命令总表：17 个"会写"的命令

> `tools/commands/` 共 **34** 个文件：**17 个会写**（下表）、**16 个只读**（§4.0）、**1 个是生物钟**（`whale-night`，见 §2）。
> 另有 `tools/verify/` 7 个、`tools/diagnostics/` 2 个映射，加上 3 个**悬空入口**（§11.2），`tools/bili.mjs:9-59` 共 46 个入口。
> "闸门"列只写**代码强制**的那几道；⚠️ = 已知缺口，见 §11。

| 命令 | 作用 | 关键参数 | 对外副作用 | 额度/闸门 | 代码 |
| --- | --- | --- | --- | --- | --- |
| `comment` | 发一条视频评论 / 二级回复 / 动态回复 | `--oid --bvid\|--referer --message [--type 1\|11\|17] [--root --parent] [--auto] [--share] [--ta] [--mine k] [--once-per-person] [--force-gather\|--no-fish-gather] --dry\|--go` | ✅ 公开评论、点赞（鱼）、私信报备 | **6 道**：分享前置判据 → 攻击待审 → 鱼群 → 自由发言（四本账+全局冷却）→ 限额闸 → 出站身份闸 | `tools/commands/comment.mjs:125-174`、`:337-423`、`:440-528` |
| `comment-del` | 删自己发的一条评论 | `--oid --rpid [--bvid] --dry\|--go` | ✅ 删除公开内容 | 无（只能删自己的；`type` 写死 1） | `tools/commands/comment-del.mjs:26-45` |
| `dm` | 私信（专属通道 + 陌生人回复通道） | `--msg [--share --target] --dry\|--go`；`--to <mid>`；`--status` | ✅ 私信 | 写死三条（一天一个收信人 / 只发主人 / 必须互关）+ 陌生人 3 条/人/天、30 条/天 + `--share` 才过限额闸 + 出站身份闸 | `tools/commands/dm.mjs:71-76`、`:141-199`、`:201-243` |
| `dynamic` | 发 / 删 / 查动态 | `post --text`；`rm --id`；`check --id`；`list` | ✅ 动态 | 限额闸（`gate`）+ 出站身份闸 | `tools/commands/dynamic.mjs:103`、`:107` |
| `dynamic-image` | 发图文动态（可带 @节点） | `--image [--text] [--at --at-name] --dry\|--go` | ✅ 动态 + 图片上传 | 限额闸（上传前只做 dry，不预上传） | `tools/commands/dynamic-image.mjs:114`、`:147` |
| `edit-dynamic` | 编辑已存在的动态（id/评论/点赞保留） | `<dyn_id> <文本文件> [--go]` | ✅ 改公开内容 | 限额闸（⚠️ 未 import，见 §11） | `tools/commands/edit-dynamic.mjs:47-50` |
| `daily` | 四类动态各一天一条（best/game/anime/gaming） | `--kind --text [--bvid] [--image] [--catchup] --dry\|--go` | ✅ 公开动态（转发视频卡片或文字+链接） | 类开关 → 一天一条 → **30 分钟间隔** → 时段 → 质量门槛 → 字数 → 不许 @ | `tools/commands/daily.mjs:54-73`、`:97-115`、`:140-147`、`:174-227`、`:229-258` |
| `share-dynamic` | 每日分享 → **自己的动态**（视频卡片） | `--bvid --text --score 0-20 --reason --dry\|--go [--allow-text]` | ✅ 公开动态（转发） | 评分 ≥ `share.minScore` → 间隔 → **必须有卡片** → 限额闸（分享账）→ 出站身份闸 | `tools/commands/share-dynamic.mjs:53-74`、`:76-99`、`:109`、`:123` |
| `danmaku` | 直播弹幕：`pre` / `send` / `history` / `live` | `--room`；`send --msg [--reply-mid --reply-name --reply-dmid] --dry\|--go` | ✅ 弹幕（公开） | 限额闸（`type=danmaku`，target `room:<房间号>`） | `tools/commands/danmaku.mjs:89-144` |
| `fav` | 收藏（"我想留着"） | `<BV> --reason --dry\|--go [--kind] [--better]`；`--list`；`--check` | ✅ B站 收藏夹（私有但有账号痕迹） | 5 条判据（理由≥6 字 / 3 条/天 / 30 天不重复 / 同类≥2 需 `--better` / 先 dry 后 go） | `tools/commands/fav.mjs:93-108`、`:137-165` |
| `fish-guard` | 鱼群保护 `status/plan/like` | `--bvid\|--oid [--type] [--json] [--dry] [--max]` | ⚠️ `like` 会**点赞**（公开） | 日 6 / 次 4 / 随机间隔 / 风控熔断（§7） | `tools/commands/fish-guard.mjs:119-143` |
| `notify` | 通知分发（把"自主发言必须报备"落到代码） | `"正文" [--title] [--dry]`；`--test` | ⚠️ 桌面通知 / Webhook / 自定义命令（非 B站） | 无（`config.notify`） | `tools/commands/notify.mjs:44-70` |
| `attack` | 疑似被攻击的待审队列 | `add/list/show/approve/reject/nudge` | ⚠️ 间接：`add` 会**私信报备**主人 | 记录不占额度；回复前 `comment` 会拦 pending/rejected | `tools/commands/attack.mjs:33-56`、`tools/lib/attacks.mjs:90-97` |
| `reply-draft` | 待审回复队列（B 档：发前审核） | `add/list/show/drop/take` | ⚠️ 间接：`add` 会推送报备 | 不入队就不能发；`comment` 侧仍有全套闸门 | `tools/commands/reply-draft.mjs:44-81` |
| `quota` | 限额闸 CLI（status/check/record/ask/react/silence） | `check --type --target [--auto\|--share]`；`record …` | ❌ 只写账本 | 它**自己就是闸** | `tools/commands/quota.mjs:129-174`、`:176-198` |
| `score` | 记分（当天动态的输入） | `<BV> --score 0-20 [--reason] [--title]`；`--today/--best` | ❌ 只写 `scores.json` | 无（分数越界拒） | `tools/commands/score.mjs:38-46` |
| `diary` | 她的日记：`show/log/tail` | `log <kind> [--target] [--note]`；`show [--days]` | ❌ 本地 | `diary.enabled=false` 时**整体不记** | `tools/commands/diary.mjs:22` |

### 3.1 评论：一条评论要过六道闸（顺序不能换）

`tools/commands/comment.mjs` 的执行顺序（每一步失败都是**非 0 退出码**，agent 不会误判成成功）：

```
0. 参数与互斥           :88-117   必须显式 --dry 或 --go；--type 只能 1/11/17
1. --share 前置判据     :125-174  share.enabled / 必须同传 --auto / owner.name / reason≥8 / score≥minScore / rank===1
                                  → 正文里的 URL 换成 BV（带链接会被平台吞）→ 确保以 "@主人" 开头
2. --once-per-person    :179-200  查不到被回复者 mid → **fail-closed，这次不回**
3. 凭据 + 登录态        :202-252  nav 复核是哪个号，打手机绑定/硬币；不在 dry 之前发任何东西
4. 鱼群保护（条件）      :254-308  仅 AUTO && !SHARE && 无 root/parent；鱼太多 → 改成回一条鱼（或强制聚拢）
5. 待审闸               :337-352  该 (oid,parent) 在队列里且 pending/rejected → exit 8
6. 自由发言闸           :354-398  四本账 + 全局冷却 + 同 UP/同视频/同楼冷却（§6）
   -- dry 出口           :400-403
7. 限额闸               :405-414  share 账 / auto 标记（§6.3）
8. 出站身份闸           :416-423  命中主人/别人的 QQ 号、B站 mid → exit 9
9. POST                 :425-439  WBI 签名（:219-238）
10. 成功记账            :440-528  markGathered → 给鱼点赞（先等 likeAfterCommentMs）→ attack 标 replied
                                  → once 记账 → quota record → notify 报备
11. 失败               :529-546  按 code 给中文提示（-101/-111/-509/12015/12035/12051/12002…）→ exit 6
```

三个容易被忽略的细节：

- **`--share` 不是"第三条车道"**：必须与 `--auto` 同传，正文必须以 `@<owner.name>` **开头**，
  带别的 `@` 直接拒（`:125-174`）。这条是 Kimi 评审后补的洞（注释 `:122-124`）。
- **鱼群聚拢占哪本账**：`FISH_GATHER` 判定命中后，`quota record` **故意不带 `--reply`**（`:499-507`），
  所以它记成"主动评论"（30/天）而不是"回找我的人"（50/天）；别人再回这层楼才走 reply（`:310-318`）。
- **动态回复的自动识别**：`type ∈ {11,17}` 且 oid 命中"我发过的动态" → 自动记 `mine:<kind>`
  （`:358-373`，数据来自 `tools/lib/my-dynamics.mjs:107-113`；oid 到 kind 的映射由 `daily` 发完后 `rememberKind` 写入）。

### 3.2 四类动态（`daily`）：先"够不够格"，再"该不该现在发"

四类的默认定义（`tools/lib/kinds.mjs:20-37`）：

| 类 | 时段 | 正文长度 | 固定开头（前缀） | 质量门槛（`daily.mjs:151-156`） |
| --- | --- | --- | --- | --- |
| `best` | 08:00 | 50–100 字 | `【哦花哇哇哟！早晨视频递上~】` | 必须是**今天评分最高**那条（不设天数/播放门槛） |
| `game` | 12:00 | 60–200 字 | `【午mer！hao看的二创】` | 近 21 天 · 播放 ≥2000 · 赞/播 ≥2% · 标题/简介含今天轮到的游戏名 + AI 二创信号 |
| `anime` | 16:00 | 60–200 字 | `【二次元……也算二次元嘛？】` | 近 14 天 · 播放 ≥5000 · 赞/播 ≥2.5% · 动漫信号 |
| `gaming` | 20:00 | 60–200 字 | `【打电动时间dao】` | 近 14 天 · 播放 ≥5000 · 赞/播 ≥2.5% · 游戏区信号 |

执行顺序（`tools/commands/daily.mjs`）：

1. `--kind` 必填且合法；`dynamics.enabled` 总开关；该类的 `enabled`（`:54-71`）。
2. **今天这类已发** → exit 4（`:97-101`）。
3. **任意两条动态 ≥ `dynamics.gapMin`**（默认 30）→ exit 3（`:103-115`）。
4. **时段**：`slotOf(kind)`；不在时段 → exit 3，并告诉你"现在该发哪类"（`:140-147`）。
   `--catchup` 只在 `CATCHUP_DAY` 生效，且必须"这个点已经过去"+ 两条间隔够（`:117-139`）。
5. **管理员钦定优先**：`pins.json` 里今天的 `kind → BV` 覆盖 `--bvid`（`best` 除外，必须最高分）（`:87`、`:184-189`）。
6. **质量核对**：`view` 取标题/简介/分区/播放/点赞/天数，逐条列 `bad` 原因后 exit 5（`:198-227`）。
7. **字数**（不含前缀）→ exit 6（`:229-234`）。
8. **公开发给所有人**：正文不许 `@`、不许 `@主人`；"读起来像只对主人说"只 warn（`:236-258`）。
9. 正文 = `前缀 + 正文 + \n + 视频链接`（`:260-263`）。
10. **优先发视频卡片**：找 UP 主空间里 `major.archive.bvid` 命中的那条 AV 动态 → **转发**它
    （`tools/lib/forward.mjs:35-54`、`:57-77`）；找不到 → 退回 `dynamic post` / `dynamic-image`（`daily.mjs:315-359`）。
11. 记账：`daily-dynamic.json`（同类一天一条的依据）→ `clearPin` → `game` 类推进轮换指针 → `rememberKind`
    → `whale-log.jsonl`（`:361-388`）。

> ⚠️ `daily` 自己**不过限额闸、也不过出站身份闸**（它只查 `@`）。
> 它的"文字退回"路径会调 `dynamic post` / `dynamic-image`（那两条各自过闸），但**转发卡片路径不过**。见 §11.3。

### 3.3 分享：三条载体，共用一本额度

`share.via` 决定载体（`tools/lib/config.mjs:48`，默认 `dynamic`）：

| `share.via` | 命令 | 载体 | 额外要求 |
| --- | --- | --- | --- |
| `dynamic`（默认，2026-10-23 起） | `share-dynamic` | 转发视频卡片到**自己的动态** | **必须有 AV 动态卡片**，否则拒绝（`share-dynamic.mjs:94-97`）；与四类动态共用 30 分钟间隔 |
| `dm` | `dm --share --target BV:…` | 私信主人 | 必须带 `--share`（否则只是推送、不占额度）+ 必须带视频链接（7 天判重靠它） |
| `comment`（旧） | `comment --share --auto --reason --score --rank 1` | 评论区 @ 主人 | 正文不许带链接（会 state=17 仅自己可见），自动换成 BV（`comment.mjs:157-167`） |

`share-dynamic` 的闸门顺序（`tools/commands/share-dynamic.mjs`）：

```
① share.enabled 与评分/理由    :53-74    score 0-20 且 ≥ minScore；reason ≥8 字；正文 ≤1000 字
② 与上一条动态的间隔           :76-84    daily-dynamic.json 里任意一条（含 share）
③ 必须有视频卡片               :86-99    没卡片直接 exit 4（--allow-text 才退"文字+链接"）
④ 分享额度 / 7 天判重           :107-112  gate({type:'comment', share:true})
⑤ dry 出口                    :114-117
⑥ 出站身份闸                   :119-127
⑦ 发布（转发 → 失败按 --allow-text 退文字）:128-163
⑧ 记账 + 报备                  :165-188  mergeShareRecord → recordQuota → notify
```

### 3.4 私信（`dm`）：写死三条 + 一条"陌生人只回不发"

主人通道的硬约束（`tools/commands/dm.mjs:71-76`）：

- `ONE_TARGET_PER_DAY`：**一天只锁定 1 个收信人**（对同一个人条数不限）；
- `ONLY_TO = config.owner.mid`：只发主人；`owner.mid` 为空 → 直接拒（`:202`）；
- `REQUIRE_MUTUAL`：`relation.attribute === 6`（互关），否则拒（`:208-214`）。

陌生人通道 `--to <mid>`（`:141-199`）四条更窄：

1. **只能回，不能主动发**：会话必须存在，且最后一条必须是**对方**说的（`:152-162`）；
2. 对方那条超过 **48 小时** → 不回（`tools/commands/dm.mjs:163`）；
3. 同一人 **3 条/天**、所有人合计 **30 条/天**（`:144-145`、`:170-176`）；
4. 正文 **≤200 字**（主人通道 ≤300 字，`:203`），且不许发给自己（`:150`）。

发送前一律过**出站身份闸**（`:90-98`），发送后报备（`:192-198`）。

### 3.5 动态、图文动态、编辑动态

| 命令 | 顺序 | 注意 |
| --- | --- | --- |
| `dynamic post` | 凭据 → `whoami` → 打印 WBI+报文 → dry 出口 → 限额闸 → 出站闸 → POST（`tools/commands/dynamic.mjs:82-127`） | 报文结构 `{dyn_req:{content:{contents:[{raw_text,type:1}]}}}`（`:87-93`） |
| `dynamic-image` | 嗅探图片类型/尺寸 → 凭据 → nav → dry（**一次请求都不发**）→ 上传 `upload_bfs` → 限额闸 → `create/dyn`（`tools/commands/dynamic-image.mjs:33-163`） | 只收 jpg/png/gif（`:65-69`）；`@` 节点是 `type:2` 的 content 段（`:134-142`） |
| `edit-dynamic` | 读现有图片 → 打印 payload 预演 → `--go` → 限额闸 → `edit/dyn`（`tools/commands/edit-dynamic.mjs:24-59`） | 不改 id、评论/点赞保留；不 `--go` 就是预演 |

### 3.6 弹幕（`danmaku`）

- `send`：`--room` → 限额闸（`room:<房间号>`）→ 解析真实 room_id → 组表单（csrf/fontsize/color/mode）→ dry 出口 → POST `msg/send`（`tools/commands/danmaku.mjs:89-144`）。
- 支持"回复某条弹幕"（`--reply-dmid`）和"在弹幕里 @ 某人"（`--reply-mid` + `--reply-name`）（`:115-120`）。
- `live`：WBI 签名拿 `getDanmuInfo`（无签名一律 -352）→ WebSocket 解包（brotli/inflate）→ 打印 `DANMU_MSG` / 进场 / 礼物（`:146-243`）。

### 3.7 待审与报备：把"约定"变成队列

| 机制 | 写入 | 谁读 | 作用 |
| --- | --- | --- | --- |
| `attacks.json` | `attack add`（自动编号 + 私信报备）（`tools/commands/attack.mjs:33-56`） | `comment`（回复前拦 pending/rejected，`tools/commands/comment.mjs:337-352`）、`dynTick` 23:00 提醒（`lib/scheduler.js:987-1020`） | 疑似被攻击 → 不回，等主人批 |
| `pending-replies.json` | `reply-draft add`（去重同 parent + 推送报备）（`tools/commands/reply-draft.mjs:44-81`） | 设置页（`take` 取出→插件跑 `comment --go`） | B 档"发前审核"的落点 |
| `whale-log.jsonl` | `diary log`、`daily`、`scheduler` 的 `logEvent` | `diary show/tail`、设置页 | 结构化事件流（不是叙事） |
| 报备 | `notify`（`none/desktop/dm/webhook/command`） | 主人 | **自主发言之后必须报备**（`tools/commands/comment.mjs:509-524`） |

---

## 4. 内容消费（只读）

### 4.0 命令总表：16 个只读命令

> 全部"不产生对外副作用"。标注 **写盘** 的只是本地状态（缓存/历史/备忘），不影响 B站。

| 命令 | 作用 | 关键参数 | 写盘 | 代码 |
| --- | --- | --- | --- | --- |
| `feed` | 选题器：按偏好权重分配名额、排除看过的/最近推过的 | `--n 6 --per 2 --pages 3 --source all\|search\|popular\|rank\|following --recent-days 3 --seed --generic --no-remember --json` | `feed-picks.json` | `tools/commands/feed.mjs:41-47`、`:232-241` |
| `gamefeed` | 候选池：今天轮到的游戏 / `--for anime\|gaming` | `--for --days --n [--game] [--next] [--no-remember]` | `gamefeed-picks.json` | `tools/commands/gamefeed.mjs:27-29`、`:169-182` |
| `prefs` | 一键抓取偏好候选（只发 GET） | `scan --target fish\|owner\|both --sources history,favorites,local --limit --json` | ❌ 不落盘（只在设置页显示） | `tools/commands/prefs.mjs:19-58`、`tools/lib/pref-scan.mjs:1-15` |
| `search` | 关键词搜视频（WBI + cookie） | `<关键词> [页码]` | ❌ | `tools/commands/search.mjs:31-46` |
| `subtitles` | 拉官方字幕全文（带时间戳） | `<BV> [--lan] [--out] [--print]` | 落 `~/.dsh/shots/subs/` | `tools/commands/subtitles.mjs:52-101` |
| `video`（`video-content`） | 不点开视频还原它讲什么（简介/标签/字幕/弹幕） | `<BV>` | ❌ | `tools/commands/video-content.mjs:30-83` |
| `debrief` | 看懂一条视频：封面+简介+字幕+弹幕热区+热评+抽帧 | `<BV> [--bucket 30] [--top 5] [--grid 3x3] [--no-frames] [--substrip] [--comments 8] [--score] [--no-history]` | `watch-history.jsonl` + 截图 | `tools/commands/debrief.mjs:89-303` |
| `watch-video`（`bili-watch`） | 真"看"视频：直链 → 下载 → 抽帧九宫格 / 字幕条 | `<BV> [3x3\|4x4] [outDir] [--uniform]` | 原片 + 图 + 历史 | `tools/commands/bili-watch.mjs:29-149` |
| `watch-history` | 她看过什么 + 之后做过什么 | `list [--limit --q --days --json]` | ❌ | `tools/commands/watch-history.mjs:26-66` |
| `likes` | 「收到的赞」通知流（谁赞了她，含 mid/昵称） | `[--hours 24] [--owner] [--json]` | ❌ | `tools/commands/likes.mjs:34-74` |
| `comment-digest` | 今天谁找过她（回复+@ 两个收件箱，正文回读核实） | `[--hours 24] [--pages 2] [--only-unread] [--max-resolve] [--raw]` | ❌ | `tools/commands/comment-digest.mjs:25-86` |
| `comment-await` | 评论版"叫我起床"：廉价进程守收件箱，命中即退出（0 token） | `[--minutes] [--interval ≥60] [--only-owner] [--since] [--quiet] [--scope]` | ❌ | `tools/commands/comment-await.mjs:69-124` |
| `dm-await` | 私信监听（`--owner` 老行为 / `--any` 谁找她都算） | `--baseline\|--once [--json] [--any]` | `dm-await-state.json` | `tools/commands/dm-await.mjs:62-155` |
| `await`（`danmaku-await`） | 直播间"叫我起床"：出现该回的弹幕就退出叫醒 | `--room [--operator-uid --anchor-uid --timeout --scope --watch poll\|ws --interval --seed --ignore-uid --selftest --debug]` | `wait-state.json` | `tools/commands/danmaku-await.mjs:84-377` |
| `selftest` | 启动测试（配置/凭据/登录态/目录/deps + 下一步两件事） | 无 | `selftest-passed.json` | `tools/commands/selftest.mjs:29-106` |
| `deps` | 依赖体检（cookie 真请求 nav / ffmpeg / Node / 目录可写） | `--json` | ❌ | `tools/commands/deps.mjs:19-84` |

### 4.1 选题（`feed`）：从"关键词搜索"升级成"按口味配额"

纯逻辑在 `tools/lib/feed-core.mjs`（无网络/无文件/可单测）：

- **偏好清洗**：大小写变体合并、`keywords` 默认权重 0.75、权重 0 保留但不搜不评分
  （`tools/lib/feed-core.mjs:67-104`）。
- **命中判定**：拉丁短词必须**词边界**匹配（否则 `AI` 会命中 `said/email`）；每条偏好只算一次，不叠分（`:106-128`）。
- **候选分**：`log10(1 + 弹幕/时长) × 3 + Σ(4 × 权重) + 反馈加权`（`:131-137`）；**播放量不参与**。
- **配额**：最大余数法 + 每条偏好下限 1/上限 `perPref`；名额比偏好少时用**加权不放回抽样**（Efraimidis–Spirakis），
  否则 12 个等权偏好永远只有前 6 个被搜到（`:145-219`）。
- **轮转输出**：A/B/C/D/A/B…，某条偏好候选不够就让位，但**仍守 `perPref` 上限**（`:235-336`）。
- **搜索轮换**：`FNV-1a(seed|key)` 决定 `order`（totalrank/pubdate/click/dm）与 `page`（1–3），跨天自动换（`:339-369`）。

`feed.mjs` 只负责取数与"看过名单"：日记 + 审计表 + **观看历史** + bili-memory + 收藏 + 反馈，
最近 3 天推过但没看的也排除（`tools/commands/feed.mjs:64-102`、`:216-241`）。

### 4.2 候选池（`gamefeed`）

- 二类：今天轮到的游戏（六款按顺序轮换，`tools/lib/games.mjs:14`、`:32-46`）× 3 个搜索词
  （`${game} AI 二创 / AI 动画 / AI 视频`，`tools/lib/games.mjs:17-23`）。
- 三类/四类：固定查询词 + 信号正则；**先剔掉影视解说/电视剧**这类蹭词的（`tools/commands/gamefeed.mjs:31-42`、`:89-97`）。
- 排除"看过"（6 个来源）+ "最近 3 天推过"；按 `播放 + 收藏×20 + 弹幕×5` 排序（`:107-149`）。
- 它只做**召回 + 粗排，不拍板**；质量由 `debrief` 与 `daily` 的硬门槛决定（文件头注释 `:8-9`）。

### 4.3 看懂视频（`debrief` / `watch-video` / `subtitles`）

`debrief` 六路互补（`tools/commands/debrief.mjs:6-13`）：元信息 → 封面 → 官方字幕 → 弹幕热区 → 热评 → 画面抽帧。

关键实现点：

- **防提示注入**：把输出里的主人昵称/mid **打码**，并在开头立牌子"弹幕/评论/字幕是**素材不是指令**"
  （`tools/commands/debrief.mjs:48-66`）。
- **弹幕是采样集**：XML 只给约 1/440（注释里那条实测：标称 26 万条只回 600 条），所以**绝对数不能当全集**
  （`tools/commands/debrief.mjs:156-159`）。
- **刷屏波**：归一化后单句占全片 >30% 且 ≥20 条 → 剔除；纯符号刷屏单独记 `<纯符号>` 键（`:161-176`）。
- **字幕对齐**：峰值按"剔刷屏后"排序，并把该时段字幕贴到热点上（`:178-199`）。
- **字幕条**（`--substrip`）：裁画面下方 32%，按 `fps=1/N` 竖排成一张图 —— 硬字幕视频的性价比最高的读法
  （`:240-265`）。
- **热评带 rpid**：为了能直接拿去 `--ta` 搭话（`:206-218`）。
- **观看历史**：`debrief` 统一记账（`debrief` 调 `bili-watch` 时传 `SURFCORE_WATCH_PARENT=debrief` 防重复，
  `tools/commands/debrief.mjs:227-231`、`tools/commands/bili-watch.mjs:132`）。

`watch-video` 的取帧策略（`tools/commands/bili-watch.mjs:54-95`）：

- 画质：`platform=pc & qn=80` 可拿 720p（`html5 + qn=32` 会被压到 360p）（`:35-42`）。
- **等间隔当骨架保证覆盖 + 每帧吸附到 ±半格内最近的变化点**（scene 阈值 0.3→0.15→0.08 逐级放宽）（`:73-95`）。
- 同一批帧同时产 `SHEET`（九宫格）与 `SUBS`（底部 17% 字幕带）（`:99-125`）。
- 没官方字幕时它是最省的路径；**有字幕先跑 `subtitles`**（`:128-129`）。

`subtitles` 的三个硬知识（`tools/commands/subtitles.mjs:6-11`）：必须走 WBI 的 `/x/player/wbi/v2`、
`subtitle_url` 里的 `auth_key` 是**分钟级**有效且**不能截断**、匿名拿不到 AI 字幕（必须带 cookie）。

### 4.4 观看历史与"她做过什么"

- 写入：`appendWatch()` **append-only JSONL**，字段白名单化（未知字段不落盘），同视频同读法 30 分钟去重，
  超 2MB 轮转成 `.1.jsonl`（`tools/lib/watch-history.mjs:50-116`）。
- 读取：`readWatchHistory()` 合并新记录 + **从 `bili-memory.json` 回填的旧历史**，30 分钟内"浅看→深看"合并成一条
  （保留更深的读法与截图），再补 `scores.json` 的分数/理由（`tools/lib/watch-history.mjs:187-268`）。
- 动作：`readWatchActions()` **不新增写入**，全部从已有账本反推（`tools/lib/watch-actions.mjs:1-15`）：
  `quota.json.log` 的 comment 记录（`share/mine/ta/reply/无 parent=聚拢/main`）、`favorites.json`、`bili-memory.json` 的 dynamic 条目。
- 挂载：动作挂到"这条视频**最近一次**观看"上；动作早于所有观看记录时挂最早那条并标 `beforeFirstWatch`
  （`tools/lib/watch-actions.mjs:149-181`）。

### 4.5 其他只读细节

| 命令 | 关键实现点 |
| --- | --- |
| `likes` | 结构是 `{latest:{items}, total:{items}}`，**不是** `data.items`；按 `id` 去重（`tools/commands/likes.mjs:42-45`） |
| `comment-digest` | `item.title` 语义不可靠 → 正文以 `source_content` 为准，为空才回读楼层（`tools/commands/comment-digest.mjs:58-69`） |
| `comment-await` | 默认守到**当前作息窗口结束**（最少 10 分钟）；`allDay` 才守 0=永久（`tools/commands/comment-await.mjs:34-51`） |
| `dm-await` | `--any` 首次运行只建基线，不倒历史；跳过 `talker_id < 1000`（系统/官方号）（`tools/commands/dm-await.mjs:73`、`:97-105`） |
| `danmaku-await` | 默认**轮询** `gethistory`（WebSocket 实测连接即断，降级为可选）；命中输出 `AWAIT_HIT`、超时 `AWAIT_TIMEOUT`、连续 8 次空数据 `AWAIT_DEAD`（`tools/commands/danmaku-await.mjs:286-377`） |
| `selftest` | 全绿才落 `selftest-passed.json`；然后告诉主人两件事：会话在「工作区 → 未分组」、要给「完全访问」（`tools/commands/selftest.mjs:85-102`） |
| `deps` | cookie **真请求一次 nav**（只查字段齐不齐不够，cookie 会过期）；退出码 3 = 有缺（`tools/commands/deps.mjs:19-41`、`:84`） |

---

## 5. 记忆与打分

### 5.1 三个账本：分数 / 观看 / 发言

| 文件 | 谁写 | 谁读 | 语义 |
| --- | --- | --- | --- |
| `scores.json` | `score` | `daily`（best 类）、`whale-night`（质量分配）、`bili-memory`、`watch-history` | 每日本日打分，**同 BV 同日取最高**，只留最近 14 天（`tools/lib/scores.mjs:29-46`） |
| `watch-history.jsonl` | `debrief` / `bili-watch` | `feed`、`gamefeed`、`prefs`、设置页 | append-only，一行一次"读法"（`meta/full/frames/memory`）（`tools/lib/watch-history.mjs:77-83`） |
| `quota.json` | `quota record`（各写通道） | `free-gate`、`watch-actions`、`bili-memory`、`diary` | 发言账 + 四本账判定依据（`tools/commands/quota.mjs:176-198`） |

**打分口径**（人在提示里填，代码只校验范围）：5 项 × 0–4 = 满 20；`> 12`（即 ≥13）才允许分享
（`tools/commands/debrief.mjs:270-279`、`tools/lib/config.mjs:48` 的 `share.minScore: 13`）。
动态不设阈值，只看**当天排名**（`tools/lib/scores.mjs:3-5`）。

### 5.2 `bili-memory` 产出什么

`src/bili-memory.js` 的产物（`src/bili-memory.js:9-12`、`:159-168`）：

| 产物 | 内容 | 谁读 |
| --- | --- | --- |
| `bili-memory.md` | 长记忆（我是谁 / 时间线 ≤140 条 / 我的公开反思 ≤30 条；≤28000 字截断） | 人、排查（`:485-542`） |
| `bili-memory-brief.md` | **每次提示词注入**的短记忆（≤2700 字）：身份锚点 + 口味 + 最近 10 条 | 桥接注入、记忆卡、设置页（`:544-590`、`lib/memory.js:38`） |
| `bili-memory.json` | 检索索引（≤260 条）+ **分享素材池** | `recallBlock` / `pickShareCard`（`:592-614`、`:727-808`） |
| `bili-video-titles.json` | BV → 标题/UP/封面/时长/统计（每轮最多补 40 条，失败记 `failedAt` 6 小时内不重试） | 分享池与记忆（`:193-255`） |
| `bili-share-history.json` | 分享过哪些 id + 每个 slot 上次时间（30 天清理） | 分享去重（`:780-829`） |

**输入只有公开面**：公开打分、公开评论、公开收藏、自己的公开动态、日记里的公开看片见闻；
**私信文件（`dm-*.json`）一律不读**，日记里转述私信的段落**整段丢弃**（`src/bili-memory.js:3-7`、`:24-34`）。

三道过滤：

1. `PRIVATE_RE`（私信/主人/mid/报备/额度/催…）→ 整段丢（`src/bili-memory.js:25`）；
2. `INTERACTION_RE`（他/她/有人/回复…）→ 反思段不收（`:28-29`）；
3. `BLOCKED_RE`（政治/时政/娱乐八卦…）→ **记忆可以"知道看过"，但不把具体内容写进注入文本**，
   分享池里直接标 `shareable:false`（`:21-22`、`:519-520`、`:661`）。

### 5.3 谁在消费这些记忆

| 消费方 | 读什么 | 用法 |
| --- | --- | --- |
| B站 唤醒提示 | `lib/scheduler.js:154-158`（记忆卡） | 每轮回合开头的自我锚点 |
| QQ 桥接 | `src/bili-memory.js` 的 brief/doc + `/api/bili/memory/refresh`（`lib/memory.js:369-378`） | 群聊里"记得她在 B站 干过什么" |
| 记忆卡（衰减卡） | `memory-inbox.jsonl` → `memory-card.json`（范围 `bili` / `shared`） | 只取 `bili/shared`；共享 scope 会脱敏 5–12 位数字（ARCHITECTURE.md:205-206） |
| 分享池 | `pickShareCard()` → `src/bili-share-scheduler.js` | 每天 8 个时间点往白名单群分享（§5.5） |
| 检索 | `recallBlock(query)` | 群聊里问到"你看过的那个…"时按 token 打分召回（阈值 8 分）（`src/bili-memory.js:727-778`） |

### 5.4 双向记忆同步（`lib/memory.js`）

| 方向 | 默认 | 数据源 | 闸门 | 产物 |
| --- | --- | --- | --- | --- |
| B站 → QQ | **开** | 上面三个产物 | 只复检 + 展示（`biliToQqStatus()` 命中 severe 就 `blocked`）（`lib/memory.js:345-367`） | `bili-memory-brief.md` / `.md` |
| QQ → B站 | **关** | `state/qq-public-feed.jsonl`（只含白名单群、非私信） | 白名单群 + 非主人（除非显式）+ `sanitizeText` + 最后一道 `assertSafeOutput`（`:103-160`、`:315`） | `memory/qq-for-bili.md` → 注入 B站 唤醒（`lib/scheduler.js:145-151`） |

两边**都不搬运**：私信、密码、令牌、联系方式、住址、精确位置、真实姓名（`lib/memory.js:16`）。

### 5.5 B站 → QQ 的两条自动化

| 自动化 | 文件 | 节奏 | 说明 |
| --- | --- | --- | --- |
| 动态同步 | `src/bili-dynamics.js` | 默认 180 s（下限 60 s）+ 启动 8 s 先探一次 | 首次只建基线（不倒历史）；只推新动态；状态只留 300 条（`:97-155`、`:157-166`） |
| 定时分享 | `src/bili-share-scheduler.js` | 每天 8 个点 `07/11/13/15/17/19/21/23` | 同一天同一 slot 只跑一次；启动 10 分钟内可补跑；投递失败**不记已跑**（`:11`、`:164-225`、`:240-265`） |

分享的**载体**是纯文本「【B站】标题 + 链接」：小程序卡在 QQ 侧已下架、`structmsg` 卡被对端版本门挡掉，
所以 `buildBiliCardArk()` 只留作诊断/未来（`src/bili-card.js:1-17`、`:44-86`、`:106-168`）。

### 5.6 日记

| 文件 | 谁写 | 内容 |
| --- | --- | --- |
| `whale-diary.md` | **她手写**（散文 + 表格） | 看过的 / 想说但没说的 / 谁回过她；`diary show` 解析它（`tools/commands/diary.mjs:56-88`） |
| `whale-diary-private.md` | **她手写** | 偏好校准、私人感受（不进 B站→QQ 记忆） |
| `whale-log.jsonl` | `diary log` / `daily` / `scheduler` | 结构化事件（给程序和设置页） |

> `diary.enabled === false` 时 `diary` 命令**整体不记**（`tools/commands/diary.mjs:21-22`）；
> 但"两本日记照写"是唤醒提示里的硬规则（`lib/scheduler.js:367`），因为那是**她的日子，不是发言**。

---

## 6. 额度与频率

### 6.1 四本账（+ 分享账）的硬上限

上限**唯一真相**是 `bili.config.json` 的 `limits` 段；代码只做**范围收敛**（`tools/lib/limits.mjs:10-20`、`:37-44`）：

| 键 | 默认 | 范围 | 语义 |
| --- | --- | --- | --- |
| `daily` | 30 | 0–200 | 普通评论 / 天 |
| `replyDaily` | 50 | 0–500 | 回找我的人 / 天 |
| `taDaily` | 15 | 0–200 | 主动搭话 / 天 |
| `mineDaily` | 10 | 0–100 | **动态回复 / 类 / 天** |
| `minePerPerson` | 1 | 0–20 | 动态回复 / 人 / 类 / 天 |
| `perUpMin` | 10 | 0–1440 | 同一 UP 冷却（分钟） |
| `perVideoMin` | 60 | 0–1440 | 同一视频冷却（分钟） |
| `perThreadMin` | 1440 | 0–10080 | 同一条评论冷却（分钟，默认 24 小时） |
| `globalMin` | 2 | 0–120 | **任意两条**自主发言间隔（分钟，所有账共用） |

- `0` = **关闭该上限**（不是"一条都不许"）（`tools/lib/free-gate.mjs:74-75`）。
- 越界值被 clamp 回范围，配置文件不可信（`tools/lib/limits.mjs:8-9`、`:22-26`）。

### 6.2 四本账怎么分类（全靠 `quota.json.log` 的标记位）

`tools/lib/free-gate.mjs:42-48`、`tools/commands/quota.mjs:176-198`：

| 账 | 判定 |
| --- | --- |
| `comment`（普通） | `type==='comment' && auto && !share && !reply` |
| `reply`（回找我的人） | `auto && !share && reply && !ta && !mine` |
| `ta`（主动搭话） | `auto && !share && reply && ta` |
| `mine:<kind>`（动态回复） | `auto && !share && reply && mine===<kind>`（老数据 `mine:true` 兼容为 `best`） |
| `share`（分享） | `share`（不看其它位） |

检查顺序（`checkFree`，`tools/lib/free-gate.mjs:60-137`）：

```
① 全局冷却 globalMin   :81-85   所有 auto 账里最近一条
② 当日额度            :88      按账分别算
③ 动态回复特例        :91-104  同一类 + 同一个人/天（minePerPerson）
④ reply/ta 同楼冷却   :106-118 perThreadMin（默认 24h 仅一次）
⑤ 普通评论 同视频     :120-124 perVideoMin
⑥ 普通评论 同 UP      :125-128 perUpMin
```

失败时打印**全部上限**并给"这些数字在设置页改"的指路（`tools/commands/comment.mjs:388-397`）。

### 6.3 分享账：日上限 + 7 天判重 + 沉默衰减

`tools/commands/quota.mjs:146-163`：

- 日上限：`min(shareDaily, silence.cap)`；超了 exit 2。
- **同一视频 7 天内只能一次**（按 `target` 字符串判，所以 target 里必须带 BV）。
- **沉默衰减**（`tools/commands/quota.mjs:40-84`）：从"最后一次表态"算起（从没表态就从第一次分享算）；
  `silentAfterDays`（默认 3）天开始降，`silentStopDays`（默认 7）天降到 **0**；
  分档 `normal < quiet < faint`；**日记照写**。
- 反馈的定义：**任何表态都算**（回评论 / 点赞 / 跨端说一句话）；能自动识别的只有"回复我的"和"收到的赞"
  （`quota react --auto`，`:216-320`），跨端表态要靠 `quota react --note` 手动记（`:322-330`）。
- 点赞去重按 `like_time`（只有更新的赞才算新表态），回复去重按"主人相关行的哈希"（`:256-301`）。

### 6.4 私信额度（独立账本 `dm-quota.json`）

| 通道 | 上限 | 依据 |
| --- | --- | --- |
| 主人 | **一天只锁定 1 个收信人**（条数不限） | `tools/commands/dm.mjs:219-221` |
| 陌生人 | 一人 **3 条/天**、合计 **30 条/天**、≤200 字 | `:144-145`、`:170-176` |
| 分享型私信 | 另占"分享 3 条/天"那本账（与评论区 @ 共用） | `:231-235` |

### 6.5 其他额度

| 额度 | 值 | 位置 |
| --- | --- | --- |
| 给鱼点赞 | 6/天 · 4/次 · 间隔 1.5–4 s · 发完评论后等 12 s 再点 | `tools/lib/fish-guard.mjs:45-52` |
| 收藏 | 3/天 · 同视频 30 天一次 · 同类 ≥2 需 `--better` | `tools/commands/fav.mjs:96-107` |
| 首次评论初筛 | 一次醒来最多 `night.maxVideos`（默认 5）条 | `tools/lib/config.mjs:52` |
| 动态间隔 | `dynamics.gapMin`（默认 30 分钟），四类 + 分享共用 | `tools/lib/kinds.mjs:88-91` |

### 6.6 超限与损坏时的行为（fail-closed）

| 情形 | 行为 | 退出码 |
| --- | --- | --- |
| `quota.json` **JSON 坏** | `check` 直接拒（"状态未知 ≠ 没发过"），提示删文件=当天从 0 重算 | 2（`tools/commands/quota.mjs:129-135`） |
| 四本账超限 | `comment` 拒绝发送 | 2（`tools/commands/comment.mjs:388-397`） |
| 分享额度/7 天判重不过 | 拒绝 | 2（`tools/commands/quota.mjs:150-160`） |
| 只给 `--dry` | 打印真实请求体后退出，**不发** | 0（`tools/commands/comment.mjs:400-403`） |
| 没给 `--dry/--go` | 拒绝运行 | 2（`:117`） |
| 评论接口返回非 0 | 打印中文提示（-101/-111/-509/12015/12035/12051/12002…） | **6**（`:529-546`） |
| 出站身份命中 | 打印命中详情并中止 | 9（`:416-423`） |
| 待审未批 | 拒绝回复 | 8（`:337-352`） |
| token 额度到顶 | 调度器**不投任何 prompt**（连监听也不读消息） | ——（`lib/scheduler.js:448-484`） |

### 6.7 只回找你的人（`interact.proactive`，2026-11-08）

`interact.enabled` 是「什么都不发」；`interact.proactive` 是更细的一档：**只停她主动开口**。

| 开关 | `proactive=true`（默认） | `proactive=false` |
| --- | --- | --- |
| 顶层主动评论（4.7） | 允许 | ❌ `BILI_PROACTIVE_DISABLED` |
| 热评搭话（`--ta`，4.8） | 允许 | ❌ 同上 |
| 鱼群强制聚拢（归 `comment` 账） | 允许 | ❌ 同上 |
| 回 @ 她 / 回她评论的人（`reply` 账） | 允许 | ✅ 允许 |
| 回她自己动态下的评论（`mine:*`） | 允许 | ✅ 允许 |
| 四类动态 / 私信分享 | 允许 | ✅ 允许 |
| 给鱼点赞 | 允许 | ✅ 允许（想停改 `fishGuard.likeEnabled`） |

- 硬拦位置：`tools/commands/comment.mjs:394-400`（在 `GATE` 里，所以**主人当场授权**和 `--share` 不受影响）；
- 闸门函数：`tools/lib/interact.mjs` 的 `proactiveAllowed()` / `assertProactiveAllowed()`；
- 提示词：`lib/scheduler.js` 的 `wakePrompt` 三态（沉默逛 / 只回找你的人 / 正常），4.7/4.8 整段按开关替换；`dynTick` 的「搭话催进度」也一起停（否则 16:00 后照样催她）；
- 设置页：B站 → 互动与静默 → 「主动评论 / 搭话」；
- 生效：改配置下一轮 tick；改代码要重载插件。

---

## 7. 鱼群保护（B站 侧）

### 7.1 它解决什么问题

评论区里"自己人"（同一批鱼/同好）太多时，再去发**新楼层**只会把真正的观众挤下去、也容易被判刷屏。
所以策略是三步（`tools/lib/fish-guard.mjs:1-15`）：

1. **鱼太多 → 不发新楼层**；
2. **聚拢**：把想说的话改成对某条鱼评论的**楼中楼回复**；
3. **点赞**：把鱼的楼层/鱼在楼里的回复顶上去。

只对"她自己决定说的"（`--auto`）生效；主人当场授权的手动评论不拦（`tools/commands/comment.mjs:254-266`）。

### 7.2 怎么认鱼

- 昵称归一化：去零宽字符、去尾部长标点/数字/emoji、小写（`tools/lib/fish-guard.mjs:124-130`）。
- 判定：`namePrefixes` 任一前缀 / `nameContains` 任一包含 / `nameSuffixes` 任一后缀（默认 `['肥鱼','fish','鱼']`）
  （`:132-151`）。
- **mid 优先**：`extraFishMids` 直接算鱼（改名不丢），`exemptMids` / `exemptNames` 排除（`:158-165`）——
  2026-10-23 才把 mid 识别补齐，之前 `exemptMids` 只用于点赞豁免（`:153-157`）。
- 默认阈值（`tools/lib/fish-guard.mjs:24-68`）：采样 40 条、鱼楼层 ≥3 / 鱼账号 ≥3 / 占比 ≥0.4（样本 ≥8 才算比例）。

### 7.3 抓评论必须带登录态

游客态 `/x/v2/reply` **只返回 0~3 条**"游客可见"评论，40 条样本永远凑不齐 → 鱼楼层恒为 0、点赞目标恒为空，
表现就是"点赞没反应"（`tools/lib/fish-guard.mjs:12-15`、`:265-281`）。
现在所有抓取都带 `credentials.json` 的 cookie，`plan.loggedIn` 会写进状态，设置页能直接看到"未带登录态"（`:471`、`:689`）。

默认同时取**时间序 + 热度序**（`includeHotSample`），只看一种排序会漏掉另一种里的鱼（`:295-312`、`:444`）。

### 7.4 判定与选择（纯函数 `assessFishFlood`）

`tools/lib/fish-guard.mjs:343-425`：

```
泛滥 flooded = fishTopLevel ≥ maxFishTopLevel
            || fishMids     ≥ maxFishMids
            || (样本 ≥ minSample && ratio ≥ maxFishRatio)
聚拢候选     = 鱼楼层里：rcount ≤ gatherMaxReplies(6) · 不过期(72h) · 楼里鱼回复 ≤2 · 不在 12h 冷却
              排序：回复少优先 → 新优先
强制聚拢     = flooded && forceGather && gatherEnabled 时，从鱼楼层里挑"回复最少/最新"的一条，
              忽略上面四个条件（默认开，可用 --no-force-gather 关）
点赞目标     = 鱼楼层主评论 + （可选）楼里的鱼回复；跳过已赞/豁免/冷却/重复
```

**为什么默认强制聚拢**：2026-10-23 用户定"每次醒来至少发一条主动评论"，
不许以"没有可聚拢鱼楼"当理由整轮不说话（`tools/lib/fish-guard.mjs:36-38`、`lib/scheduler.js:313-322`）。
聚拢回复仍占**主动评论**额度（§3.1）。

### 7.5 点赞的执行与熔断

`tools/commands/fish-guard.mjs:119-143` → `tools/lib/fish-guard.mjs:523-671`：

- 前置：开关、`oid`、`cred`、`likeBlockedUntil` 冷却、日额度剩余（`:562-585`）。
- 每个目标：已赞过 → skip；刚失败过（24h 冷却）→ skip；两次之间**随机 1.5–4 s**（连续快速 POST 很像脚本，会 -509）（`:588-608`）。
- 风控码 `{-509, 12015, 12051, 12035, 12011}` → **立刻停手**并写 `likeBlockedUntil = now + failCooldownMinutes(60)`（`:580`、`:656-661`）。
- 成功才落 `liked` + `likeLog`（最多 300 条）；失败写 `likeFailed`（带 code/message），设置页能看到"上次失败在哪个 code"
  （`:626-655`、`:703-740`）。
- 状态文件 `fish-guard.json` 只留 30 天，`fishGuardLog` 最多 50 条（`:217-246`）。

### 7.6 边界

- **不追着人刷**：同一条 rpid 只赞一次；同一楼层 12 小时内不重复聚拢（`:372-374`、`:385-397`）。
- **识别会误伤**：后缀"鱼"会把真人（如"咸鱼"）算成鱼；这是用户明确接受的成本（`tools/lib/fish-guard.mjs:60-62`）。
- **强制聚拢是"质量换覆盖"**：宁可回一条不太合适的鱼楼，也不整轮沉默 —— 这是产品决定，不是技术限制（`:376-381`）。

---

## 8. 输出脱敏与身份闸

### 8.1 出站身份闸（硬拦，不是提示）

`tools/lib/outbound-guard.mjs`：

- **受保护**（`collectProtectedIdentities()`，`:31-53`）：合体层 `admin.qq` / `admin.biliMid`、
  `bili.config.json` 的 `owner.mid`、`alignments.json` 里每个人的各平台 id。
  **明确不拦**：她自己的 B站 mid（公开资料）、昵称（会撞、误伤成本高）、普通数字（`:9-13`）。
- 只认 4–15 位纯数字（`:40-44`）；命中就 `throw`，调用方打印并**中止发送**（`:60-65`）。
- 实际接线：`comment`（评论，`tools/commands/comment.mjs:416-423`）、`dm`（私信，`tools/commands/dm.mjs:90-98`）、
  `dynamic`（动态，`tools/commands/dynamic.mjs:104-111`）、`share-dynamic`（动态，`tools/commands/share-dynamic.mjs:119-127`）。

### 8.2 提示词侧的脱敏（概率约束，不是保证）

| 位置 | 做什么 |
| --- | --- |
| `lib/scheduler.js:54-69` | 人设卡里"称呼/QQ 号/群友 QQ"整节剔除走 B站；`（QQ <数字>）` 形式的括号删掉；5–12 位数字 → `[号码已隐藏]` |
| `lib/scheduler.js:106-126` | 跨平台自我锚点：QQ 号**打码**（`328****288`），只够认人 |
| `lib/scheduler.js:128-142` | 管理员身份只读 B站 昵称/mid，不把 QQ 号带进 B站 提示词 |
| `tools/commands/debrief.mjs:53-64` | 输出流里把主人昵称/mid 换成 `「主人昵称·已打码」` |
| `src/bili-memory.js:116-123` | 公开评论/标题里出现 `owner.name` → 统一换成配置里的称呼（默认「主人」） |
| `src/bili-memory.js:21-34` | 政治/娱乐圈 → 不入记忆正文、不可分享；私信/互动残留 → 整段丢 |

### 8.3 已知缺口（详见 §11）

- `dynamic-image`（图文动态）、`edit-dynamic`（编辑动态）、`danmaku`（弹幕）、`daily`（四类动态）
  **都没有过出站身份闸**（grep 只有 4 个调用点）。它们能发的内容里同样可能出现主人 mid/QQ 号。
- `daily` 只查 `@`，不查数字 ID；`dynamic-image` 的 `--at <mid>` 甚至**主动**把 mid 写进正文节点
  （`tools/commands/dynamic-image.mjs:134-142`）。

---

## 9. 配置项全解（`bili.config.json`）

查找顺序：`$SURFCORE_BILI_CONFIG` → `~/.dsh/surfcore/bili.config.json` → **内置中性默认值**
（`tools/lib/config.mjs:12`、`:19`；`tools/lib/state-paths.mjs:66` 是同一份路径的另一种写法）。

读取是**按 mtime/size 缓存**的：文件不变就用缓存，变了就重读 → **设置页改完下一轮生效**
（`tools/lib/config.mjs:72-91`；这也是 2026-10-22 修掉"进程内永久缓存"的原因）。

### 9.1 `DEFAULTS` 里的键（`tools/lib/config.mjs:22-60`）

| 段 | 键 | 默认 | 谁读 | 说明 |
| --- | --- | --- | --- | --- |
| `persona` | `name` | `<角色名>` | `daily`、`bili-memory`、scheduler 兜底 | 角色名 |
| | `ownerTitle` | `你` | `diary`、`bili-memory` | 怎么称呼使用者 |
| | `selfClaim` | `我` | scheduler 兜底 | 怎么自称 |
| | `diaryTitle` | `今日摘要` | `diary show` | 日记标题 |
| `preferences` | `like[]` | 4 个中性词 | `feed`、`bili-memory`、`daily` 提示 | 爱看 |
| | `dislike[]` | 4 个中性词 | `bili-memory` | 不爱看（只进记忆文本，不做负权重） |
| | `weights{}` | `{}` | `feed`（`feed-core.mjs:67-104`） | 每个关键词 0–5；0=停用 |
| `notify` | `type` | `none` | `notify` | `none/desktop/dm/webhook/command`（`dm` 见 §11） |
| | `url` / `template` / `cmd` | 空 / `text` / 空 | `notify` | webhook 按域名自动适配飞书/钉钉/企微/QQ 机器人（`tools/commands/notify.mjs:48-69`） |
| `aliases[]` | —— | `[]` | `danmaku-await`（历史昵称，防漏判 @） | `tools/commands/danmaku-await.mjs:73` |
| `owner` | `mid` / `name` | 空 | 几乎全部写通道 + 出站闸 | 主人身份；为空时 `dm` 直接拒发 |
| `quota` | `shareDaily` | 3 | `quota` | 分享日上限 |
| `limits` | 9 个键 | 见 §6.1 | `free-gate`、`quota`、`comment` | 四本账硬闸门 |
| `dynamics` | `enabled` | `true` | `daily`、`dynTick` | 四类动态总开关 |
| | `gapMin` | 30 | `daily`、`share-dynamic`、`dynTick` | 任意两条动态最小间隔（5–240 clamp） |
| | `kinds{}` | `{}` | `kinds.mjs` | 只存"被改过的字段"，缺省取 `DEFAULT_KINDS` |
| `share` | `enabled` | `true` | `comment --share`、`share-dynamic` | 分享总开关（关掉=只看不说） |
| | `via` | `dynamic` | 唤醒提示、设置页 | `dynamic` / `dm` / `comment` |
| | `minScore` | 13 | `comment --share`、`share-dynamic` | 评分阈值（"超过 12 就发"） |
| | `silentAfterDays` | 3 | `quota`、scheduler | 几天开始衰减 |
| | `decayPerDay` | 1 | 文档/UI | 衰减步长（当前算法不用它，见 §11） |
| `listen` | `comment` | `true` | `listenTick` | 评论区倾听开关 |
| | `commentIntervalSec` | 300 | `listenTick`、`comment-await` | 轮询间隔（下限 60） |
| | `scope` | `both` | `listenTick`、`comment-await` | `reply` 只看回复 / `both` 也看 @ |
| | `oncePerPerson` | `false` | `comment`（自动加 `--once-per-person`） | 同一个人 30 天只回一条 |
| | `allDay` | `false` | `listenTick`、`comment-await` | 关闭时只在作息窗口内听 |
| | `dm` | `false` | `dmTick` | 私信监听开关 |
| | `live` / `liveRoom` / `liveScope` | `false` / `''` / `owner` | `liveTick`、`danmaku-await` | 直播间（独立开关，不受作息影响） |
| `night` | `windows[]` | `[{20:00–24:00, wakes:1}]` | `whale-night`、`listenTick`、scheduler | 作息窗口（跨午夜自动识别） |
| | `skipChance` | 0.3 | `night-schedule` | 每次醒来"不想看"的概率 |
| | `maxVideos` | 5 | 唤醒提示 | 一次醒来初筛几条 |
| | `minGapMin` | 20 | `night-schedule` | 相邻唤醒最小间隔 |
| `fishGuard` | 28 个键 | 见 `tools/lib/fish-guard.mjs:24-68` | `comment`、`fish-guard` | 识别/聚拢/点赞/熔断全套 |
| `agent` | `sandbox` | `danger-full-access` | scheduler | 她那**一个**会话的权限（收紧则下一次 tick 生效） |

### 9.2 代码会读、但 **不在 `DEFAULTS`** 里的键（⚠️ 容易踩）

| 键 | 读的地方 | 不配会怎样 |
| --- | --- | --- |
| `self.mid` / `self.name` | `tools/lib/msgfeed.mjs:12`、`tools/lib/my-dynamics.mjs:21-33`、`tools/lib/pref-scan.mjs:465`、`tools/lib/outbound-guard.mjs:37`、`lib/scheduler.js:122-124` | 空串：`my-dynamics` 拿不到 mid、鱼群保护把"她自己"当鱼的风险、出站闸不知道豁免自己的 mid |
| `preferences.keywords[]` | `tools/commands/feed.mjs:57`、`tools/lib/pref-scan.mjs:536` | 额外关键词不生效 |
| `quota.daily` / `quota.scope` | `tools/commands/quota.mjs:26` | 白名单已删除（§6.2），只剩 `shareDaily` 有意义 |
| `share.silentStopDays` | `tools/commands/quota.mjs:71`、`lib/scheduler.js:198` | 默认 7 天降到 0 |
| `listen.dmScope` | `lib/scheduler.js:742` | 默认 `owner`（只认主人） |
| `diary.enabled` / `diary.push` | `tools/commands/diary.mjs:22`、`lib/scheduler.js:250-262` | 默认记 / 默认推 |
| `dynamics.kinds.<k>.{enabled,slot,minLen,maxLen,prefix}` | `tools/lib/kinds.mjs:57-75` | 缺省取 `DEFAULT_KINDS`；`prefix` 会被压成单行、≤80 字 |

### 9.3 配置相关的两个"软约束"

- **禁止 agent 自己改配置**：唤醒提示里明确写"不要自己改配置文件，让主人去设置页调"（`lib/scheduler.js:300`）。
- **改了立刻生效**：`invalidate()` 只清"计划"、保留"今天已醒几次"，避免改设置把额度重置
  （`lib/scheduler.js:1135-1152`）。

---

## 10. 边界与失败模式

### 10.1 登录过期 / cookie 失效

| 现象 | 代码表现 | 处理 |
| --- | --- | --- |
| `nav` 返回非 0 | `comment` 在**发之前**就退出 4（`tools/commands/comment.mjs:244-249`）；`session` 退出 4（`tools/verify/session.mjs:26-29`） | 重新扫码/粘贴 cookie |
| `-101` 未登录 | 各写通道打印中文提示 | 同上 |
| `-111` csrf 失败 | `bili_jct` 与 `SESSDATA` 不是同一个号 | 换整套 cookie |
| 手机未绑定 | `session` 会提示"会被拒"（`tools/verify/session.mjs:33`） | 先绑手机 |
| 鱼群抓取只回 0~3 条 | `plan.loggedIn === false`，设置页显示"未带登录态（样本会很少）"（`tools/lib/fish-guard.mjs:689`） | 补 cookie |

### 10.2 风控 / 限流

| 码 | 含义 | 代码反应 |
| --- | --- | --- |
| `-509` | 请求过于频繁 | 评论：提示 + exit 6；点赞：**立刻停手**并冷却 60 分钟（`tools/lib/fish-guard.mjs:580`、`:656-661`） |
| `12015` | 需要评论验证码（已被盯上） | 同上（停手） |
| `12051` | 重复评论判刷屏 | 评论提示"重复评论被判刷屏"（`tools/commands/comment.mjs:530-541`） |
| `12035` | 被 UP 拉黑 | 提示 |
| `12002` | 评论区关闭 | 提示 |
| `-352` | WBI 签名缺失 | 直播 `getDanmuInfo` 无签名一律 -352（`tools/commands/danmaku.mjs:153`） |
| `-403` | 字幕 `auth_key` 过期/被截断 | `subtitles` 提示"分钟级过期，重跑一次"（`tools/commands/subtitles.mjs:81`） |

**降速设计**（不靠自觉）：默认全局 2 分钟冷却、同 UP 10 分钟、同视频 60 分钟、同楼 24 小时；
点赞间隔随机 1.5–4 s、发完评论 12 s 再点；评论正文最长 1000 字（`tools/commands/comment.mjs:335`）。

### 10.3 API 变更 / 字段语义不可靠

| 坑 | 表现 | 现在的写法 |
| --- | --- | --- |
| 19 位动态 id 被 JS 精度截断 | `JSON.parse` 后末几位变 0 → 拿去当 oid 会 -404 | 优先从 `item.uri` 取值；`subject_id` 只在安全整数内用（`tools/lib/msgfeed.mjs:24-39`） |
| 收件箱 `title` 不可靠 | 多条 item 的 title 是同一句 | 正文以 `source_content` 为准，为空才回读楼层（`tools/lib/msgfeed.mjs:1-8`、`:81-104`） |
| 翻页 cursor 给重叠数据 | 每条出现两遍 | 按 `id` 去重（`tools/lib/msgfeed.mjs:73-76`） |
| 动态 oid ≠ dyn_id | 评论 oid 是 `basic.comment_id_str` | `feed/space` 拉映射 + 10 分钟缓存（`tools/lib/my-dynamics.mjs:1-8`、`:40-65`） |
| `attach_card` 被忽略 | 发不出视频卡片 | 改成**转发已有 AV 动态**（`tools/lib/forward.mjs:1-8`） |
| 弹幕 XML 只给采样集 | 绝对数不能当全集 | 打印采样比（`tools/commands/debrief.mjs:156-159`） |
| 弹幕 XML 无 content-encoding 的 deflate | `fetch` 拿到二进制 | 手动试 inflate/gunzip/brotli（`tools/commands/debrief.mjs:141-146`） |
| 直播间 WebSocket 连接即断 | 收不到帧 | 默认降级为**轮询 gethistory**（`tools/commands/danmaku-await.mjs:286-294`） |

### 10.4 无头 / 无桌面环境

| 依赖 | 缺失时 | 位置 |
| --- | --- | --- |
| **ffmpeg** | 抽帧/字幕条失败；`deps` 报红；提示 4 种装法 | `tools/lib/ffmpeg.mjs:60-69`（查找顺序：`$FFMPEG` → PATH → `<仓库>/bin` → `~/.dsh/surfcore/bili/bin` → 本机剪映，`:49-58`） |
| **Edge** | 扫码登录不可用；手动粘贴 cookie 仍是备用 | `lib/bili-qr-login.mjs:34-45`、`:329-331` |
| **Windows** | 桌面通知（Toast）在非 win32 直接降级成打印 | `tools/commands/notify.mjs:80-83` |
| **真 node.exe** | 用主程序跑 `gethistory` 返回空数组 → 直播间永远"听不见" | `lib/scheduler.js:486-499`、`:900` |
| **真 node 24.21** | PATH 里的 24.19 有 libuv 崩溃 → `daily` 自举到 DSH 自带运行时 | `tools/commands/daily.mjs:26-38`、`:304-313` |

### 10.5 数据文件损坏

| 文件坏了 | 后果 | 兜底 |
| --- | --- | --- |
| `quota.json` | 拒发（fail-closed） | `tools/commands/quota.mjs:129-135` |
| `fish-guard.json` | 重新初始化空状态（点赞可能重复一次） | `tools/lib/fish-guard.mjs:202-215` |
| `watch-history.jsonl` | 单行解析失败就跳过；append 失败不抛 | `tools/lib/watch-history.mjs:86-116` |
| `bili-memory.json` | 分享池空 → 本次跳过（不记为已跑） | `src/bili-share-scheduler.js:186-220` |
| `whale-night.json` | 重算计划 | `lib/scheduler.js:648-654` |
| 角色 `current.json` 非法 | 回退旧目录 | `tools/lib/state-paths.mjs:40-47` |

### 10.6 一致性风险（已知）

- **两套"进程内节流"叠加**：`dmTick` 20 s + 内部 5 s；`listenTick` 30 s + 配置间隔 —— 实际触发间隔取**较大者**，
  改配置时容易误判"没生效"（`lib/scheduler.js:1130-1131`、`:737`、`:796-797`）。
- **`whale-night.mjs` 与 `scheduler.js` 各有一份窗口解析**（`tools/commands/whale-night.mjs:64-82` vs `tools/lib/night-schedule.mjs:28-46`），
  跨午夜/边界语义目前一致，但改一处必须改两处。
- **`_note_<kind>` 与 `pinOf` 同住 `dynamic-pins.json`**：清单里混着"钦定 BV"和"要点文本"，靠前缀区分
  （`tools/lib/pins.mjs:26-43`）。

---

## 11. 未覆盖 / 不确定（⚠️）

以下都是**读代码发现的确定事实或确定缺口**，但**没有实际运行验证**；按"先记录、后修"处理。

### 11.1 三个会让命令直接崩的缺口（**2026-10-26 已处理**）

> 下面三条当天都已处理，保留原文是为了说明"为什么这类 bug 会静默存在"。
> ①补 import；②**按"未实现"处理**（脚本启动即 `exit(3)` 并打印原因，调度器收到后停止重试）；
> ③设置页移除「B站私信」选项，老配置命中时抛可读错误。

1. **`edit-dynamic.mjs` 用了 `gate()` 但没 import**（`:50` 调用，`:5-7` 只 import 了 state-paths/fs/path）。
   `dynamic.mjs:11` 和 `danmaku.mjs:14` 都写了"补 import"的注释，这条漏了 → `--go` 时必 `ReferenceError`。
   ✅ 已补 `import { gate } from '../lib/quota-gate.mjs'`。
2. **`danmaku-await.mjs` 用了未定义的 `statePath`**（`:50`、`:56`）。该文件里没有任何 `const statePath`
   → 进程启动即 `ReferenceError`。而调度器 `liveTick` 正是靠这个子进程（`lib/scheduler.js:896-905`）
   → **直播间监听实际起不来**（会在 12 秒退避里循环记"退出"）。
   ✅ 已标注**未实现**：脚本启动即 `exit(3)`，调度器收到 3 后置 `liveUnimplemented` 停止重试。
   真正实现需要：补状态文件路径（文件头注写的是 `bili/await-state.json`）+ 真机开一次直播间验证。
3. **`notify` 的 `dm` 分支是坏的**（`:156-162`）：引用了未定义的 `p`，且从未调用 `dm.mjs`；
   异常被外层 catch 包成"通知失败（dm）"。而设置页**把 `dm` 当成合法选项**（`lib/client.js:1043`、
   `lib/store.js:494`）→ 用户选了"B站私信"推送，实际一条都不会发。
   ✅ 已从设置页移除该选项；老配置命中时抛"未实现"的可读错误。

### 11.2 `bili.mjs` 的 3 个悬空入口

`tools/bili.mjs:9-59` 共 46 个映射，其中 3 个指向**不存在的文件**：

| 入口 | 指向 | 现状 |
| --- | --- | --- |
| `auto` | `commands/danmaku-auto.mjs` | `tools/commands/` 里没有这个文件（`danmaku-await.mjs:2` 的注释仍把它当"另一个脚本"） |
| `dyn-keywords` | `diagnostics/dyn-detail-keywords.mjs` | `tools/diagnostics/` 只有 `fetch-covers.mjs` / `whois.mjs` |
| `dyn-page` | `diagnostics/dyn-page-keywords.mjs` | 同上 |

另：`tools/verify/verify-reply.mjs` 存在但**没有**任何 `bili.mjs` 入口。

### 11.3 出站身份闸的覆盖空洞

`assertOutboundIdentitySafe` 只有 4 个调用点（`comment` / `dm` / `dynamic` / `share-dynamic`，§8.1）。
下列通道**不过**这道闸：`daily`（四类动态，尤其是**转发卡片**那条路径）、`dynamic-image`（图文，且 `--at` 会主动写入 mid）、
`edit-dynamic`（改正文）、`danmaku`（直播弹幕，公开面且无法删除）。
按"公开面一旦贴出去就收不回来"的标准，这四条是**同等级的暴露面**。
（`daily` 退回 `dynamic post` 时会顺带过闸，所以缺口只在"转发卡片"路径上。）

### 11.4 文档与代码不一致（数字类）

| 说法 | 出处 | 代码实际 |
| --- | --- | --- |
| 陌生私信"一天共 12 条" | `lib/scheduler.js:758`（唤醒提示里写给 agent 看） | `STRANGER_DAILY = 30`（`tools/commands/dm.mjs:144`） |
| `share.decayPerDay` 参与衰减 | `tools/lib/config.mjs:48` 的默认值 | `quota.mjs:66-84` 用的是"线性降到 0"，**不读** `decayPerDay` |
| `admin.qq` / `admin.biliMid` 一定在 | `tools/lib/outbound-guard.mjs:45-47` | 合体层没写 admin 时为空（PITFALLS #12 记过同类问题） |
| "配额 27 次需求 vs 12 次上限" | `tools/commands/whale-night.mjs:84-86` 注释 | 已 clamp 到 12，并在 `warnings` 里明说覆盖不满 |

### 11.5 未验证的行为

- **`forward.verifyForward()` 里 `host_mid` 写死成作者账号的 mid**（`tools/lib/forward.mjs:83-85`），
  不是"当前账号"。在别的账号上跑，`verifyForward` 的复核结果**不可信**（它读的是别人空间的动态）。
  本文不写这个 mid，只标出位置。
- **强制聚拢的社交后果**：`forceGather` 默认开（`tools/lib/fish-guard.mjs:36-38`），意味着"每次醒来都强行回一条鱼楼"。
  代码层面正确，但"鱼楼选得合不合适""连续多天回同一批鱼会不会像机器人"没有实测数据。
- **鱼群识别的误伤率**：`nameSuffixes: ['肥鱼','fish','鱼']` 会把昵称以"鱼"结尾的真人算成鱼
  （`tools/lib/fish-guard.mjs:60-62` 注释承认"接受极小概率误伤真人"），但**没有统计口径**衡量误伤。
- **`watch-history` 与 `bili-memory` 的口径重叠**：同一视频可能同时以"观看记录"和"回填记忆"出现，
  靠 `seenBv` 去重（`tools/lib/watch-history.mjs:230-235`）；跨天重看（>30 分钟）会保留两条 —— 这是设计，
  但"今天看了几条"这类统计是否该按次还是按片，代码里没定论（`stats.today` 按行数，`:259-265`）。
- **scheduler 的 `dynTick` 与 `daily` 的补发窗口**：`dynTick` 的 `CATCHUP_DAY` 判断在
  `lib/scheduler.js:1066`，`daily` 的在 `tools/commands/daily.mjs:122-126`，两处都读同一个常量
  （`tools/lib/kinds.mjs:18`），但**只有 2026-10-21 那一天**是补发日；之后所有"错过"都只能等明天。
- **token 额度闸的边界**：`promptBili` 命中额度时会抛 `code='token-budget-blocked'`，
  被 `tick()` 的 catch 记成"叫醒失败（下一 tick 重试）"（`lib/scheduler.js:682-684`）——
  语义上不是失败，但日志会每 tick 记一条（受 10 分钟节流的是 `logBudgetBlocked`，不是这条）。
