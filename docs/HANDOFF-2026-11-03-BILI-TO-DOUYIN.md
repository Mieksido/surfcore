# 交接：B站 下线 → 抖音接位（2026-11-03 22:30）

> 给下一个接手的人（或明天早上的我）：**改完了什么、现在是什么状态、还差哪几步、怎么验、怎么退**。
> 上游总索引仍看 `docs/HANDOFF.md`；踩过的坑看 `docs/PITFALLS.md` #84–#87。

---

## 0. 一句话状态

SurfCore 里 B站 那一整套**已经物理删除**（不是隐藏、不是开关关掉），抖音用「只读 `dsh-douyin-agent` 落盘结果」的方式接位。
代码**已提交**（`9c7b634`），DSH **已重启、新代码确认在跑**（`/api/douyin/status` 有 `share` 字段、`prompt-preview` 空池不注入）。
**剩下两件纯人工的事**：在抖音插件面板跑一轮把素材池填上、到设置页开分享开关。
收尾轮另外修了两个真 bug：host 测试写进线上抖音记忆（§10 / PITFALLS #88）、
记忆卡容量告警因重复 `JSON.parse` 从未发出（PITFALLS #89）。

---

## 1. 现在到底什么状态

| 维度 | 状态 |
| --- | --- |
| 工作树 | `main`，`9c7b634`（主改动）+ `b78596e`（测试隔离）+ 本轮 notify 修复（见 §10），干净 |
| 插件测试链 | 30 个脚本逐个跑过，全绿；只有 `test-updates-voice.mjs` 红（联网拉 GitHub，环境问题） |
| 根审计 | `node scripts/test-audit.mjs` → **56/67**；红的 11 个见 §6，都是本轮之前就红的 |
| 运行时 | DSH 于 22:58 重启（新端口 6902，桥接被自动拉起），**跑的是新代码**：`share` 字段在、空池 `prompt-preview.text=""`、`share-now` 明确拒绝 |
| 抖音插件 | `dsh-douyin-agent@1.4.7` 已装、`readDouyinStatus()` → `installed:true, version:"1.4.7"`，SnowLuma 已连 |
| 抖音素材池 | **空的**（`entries=0`、`sharePool=[]`）。被测试污染的假数据已清掉，不会再自己长出来 |
| 分享开关 | **默认关**。`~/.dsh/surfcore/config.json` 里还没有 `douyinBridge` 键，走默认值 |



---

## 2. 架构决定（先读这段，否则会改错方向）

```
dsh-douyin-agent（插件自己的 Edge，CDP 9227）
   ├─ 自主观看 / 抽帧 / 弹幕 / 问候 / 私信回复 / 评论 / 日报
   ├─ 落盘：state/*.json、control/browser.json、memory/persona/state.json、
   │        memory/reports/videos/*.md、~/.dsh/douyin-browser/{cli-profile,control,memory}
   └─ 没有对外 HTTP —— 所以 SurfCore 既不能启停它，也不能催它跑
SurfCore（DSH 插件 + 本地桥接 :3100）
   ├─ 只读上面的落盘结果 → 生成 douyin-memory.md / -brief.md
   ├─ 记忆注入：QQ 提示词带【抖音记忆】（只读简报，不反向写）
   └─ 定时分享：把作品标题+链接发到群（douyin-share-scheduler）
```

三条硬约束（PITFALLS #85）：
1. **不要**从 SurfCore 去启停抖音插件（没接口，硬来会抢同一个 Edge profile）。
2. **不要**让两边同时写同一份记忆文件。
3. 抖音 → QQ 是**单向**的；QQ → 抖音 目前**没接线**（设置页已明说，别放无效开关）。

---

## 3. 本轮改了什么（按层）

### 桥接侧 `src/`
| 文件 | 改动 |
| --- | --- |
| `douyin-agent.js`（新增） | 只读访问插件状态：定位插件目录、读 `state/*.json`、探测 CDP 9227 |
| `douyin-memory.js`（新增） | 抖音记忆：`douyin-memory.md` / `-brief.md` 生成、分享池 `sharePool()/pickShareCard()/recordShare()/shareStatus()`、6 天冷却、广告词与无链接过滤 |
| `douyin-share-scheduler.js`（新增） | 定时分享调度器，结构照搬已删的 `bili-share-scheduler.js`；状态 `state/douyin-share-state.json`，启动补跑窗口 10 分钟，池空返回 `{ok:false,why:'没有新鲜素材'}` 而不是发旧内容 |
| `bridge.js` | 删 `biliBridge` 归一化块、`sendBiliCard`/`onebotSendSegments`/`fetchVideoInfo`；记忆注入判据 5 处从 `cfg.biliBridge` 换成 `cfg.douyinBridge`；新增 `/api/douyin/status`、`/api/douyin/share-now`（`/api/bili/*` 保留为别名） |
| 删除 | `bili-card.js`、`bili-memory.js`、`bili-dynamics.js`、`bili-share-scheduler.js` |

### 插件侧 `plugins/surfcore/lib/`
| 文件 | 改动 |
| --- | --- |
| `douyin-status.js`（新增） | `probeCdp` / `readDouyinStatus` / `readLatestReport` / `readRecentObservations` / `resolveDouyinPaths` |
| `index.js` | 删 `handleBili` 整段（`/bili/automation`、`/bili/accounts`、`/bili/qr/*`、`/bili/fish-guard`、`/watch-history`、`/preferences/scan`）及对应 import；`handleDouyin` 增 `/status`、`/share-now`、`refresh-douyin`；`start-all` 去掉 B站生物钟分支 |
| `client.js` | 新增抖音页（含「分享到群」卡：开关/时间点/目标群/立即分享一次/素材池计数）；记忆页、对齐页、管理员卡、概览状态点全部改抖音口径；删死组件 `BiliQrModal`、`TasteEditor`、`QqShareSection`、`FishGuardStatusCard`、`AutomationCard`、`WatchTab`、`BILI_FIELDS`、`QQ_BILI_SHARE_FIELDS` |
| `store.js` | `platformStartsFrom()` / `saveUnified()` 加 `douyin`，`bili` 恒 `false`；`douyinBridge.share` 归一化 |
| `memory.js` | 新增 `douyinToQqStatus()`（过隐私复检）、`previewDouyinBrief()`；`memoryStatus()` 加 `douyinToQq` |
| 删除 | `scheduler.js`（1173 行）、`automation.js`、`bili-qr-login.mjs` |

### 工具链与测试
- 删 `plugins/surfcore/tools/{bili.mjs,commands,verify,diagnostics,docs,templates,covers}` 与只被 CLI 用的 `tools/lib/*`（16 个）。
- 删测试 19 个：`test-bili-*`、`test-scheduler-permission`、`test-persona`、`test-watch-*`、`test-share-dynamic`、`test-feed-core`、`test-pref-scan`、`test-night-schedule`、`test-kind-signals` 等；`test-audit.mjs`、两个 `package.json`、`audit-bridge-harness.mjs` 的清单同步移除。
- 新增测试：`scripts/test-douyin-share.mjs`（10 组断言：池去重/过滤、slot 轮转、卡片文本、两种提示词口径、两群投递、slot 去重、6 天冷却、空池报因、停用跳过、手动分享不受 slot 限制）、`plugins/surfcore/scripts/test-douyin-host.mjs`。

---

## 4. 故意留下的东西（删了会坏，不要「顺手清理」）

| 留下的 | 为什么 |
| --- | --- |
| `plugins/surfcore/tools/lib/{fish-guard,limits,kinds,config,free-gate,state-paths}.mjs` | `lib/store.js` 的四本账、QQ 鱼群保护默认值还在用。**不能整目录 `rm -rf`**，删前按 import 闭包算一遍 |
| `state/bili-memory.json` 这个**文件名** | 记忆卡、`pet-purpose`、`purpose-inspect` 还在读存量数据。文件名是历史资产，不是 B站 功能 |
| `src/bili-api.js` + `scripts/songfetch.mjs` | 点歌的 B站 搜歌兜底（`config.socialV2.voice.sing.scriptBilibili`）。主链路已是 `douyin-fetch.mjs`，但这条兜底还在配置里 |
| `lib/memory.js` 的 `syncQqToBili` / `scanBiliFeedForCandidates` | 还挂在 `/memory` 的 `sync` / `scan-align` 动作上，属于「QQ → 跨平台」旧实现。**技术债，不是漏删** |
| `/api/bili/*` 路由别名 | 桥接里还留着指向 douyin 的别名，防止旧前端/脚本 404 |

⚠️ **我试过但已回退的**：把 `bili` 分项从 token 额度体系（`src/token-budget.js`、`lib/token-budget.js`、Token 页）里删掉。原因——它连带要改桥接的账本快照（`bridgeBudgetLimits`/`bridgeDailyUsage`）+ 4 个测试文件里的 38 处断言，属于独立一件事。**已 `git checkout` 回退，当前 Token 页与后端仍然是「QQ / B站 / 其他 / 总额」四项，自洽且测试全绿。** 下一轮要动的话，按 §5 第 4 条来。

---

## 5. 待办（按这个顺序）

1. ~~**先提交**~~ ✅ 已完成：`9c7b634`（157 项改动一次入库）。回滚手段见 §7。
2. ~~**重启 DSH**~~ ✅ 已完成（22:58 重启，插件日志确认 `autoStartBridge：桥接还连着旧 DSH（5020 ≠ 6902），自动重启`）。
   坑 #86 的两条仍然有效，下次重启照做：从开始菜单双击；确认没有 `ELECTRON_RUN_AS_NODE=1` 残留。
3. ~~**重启后按 §6 验**~~ ✅ 已完成，四条实测全部符合（见 §6 期望那一段的实测结论）。
4. **把抖音素材池填上**（只剩这件）：在抖音插件面板点「开始有限轮次」，跑一轮后 `douyin-memory.md` 才会从空变成有记录；
   然后到设置页 → 抖音 → 「分享到群」开开关、填时间点和群号。
5. **剩余命名债（下一轮）**：Token 分项、记忆卡 `scope`/`platform` 仍叫 `bili`。
   要动的话一起动这几处，否则会半截：
   - `src/token-budget.js`：`SCOPES` / `CATEGORY_SCOPES` / `SCOPE_LABELS` / `DEFAULT_LIMITS` / `totalsOf` / `writeDailyUsage`；
   - `plugins/surfcore/lib/token-budget.js`：`classify()` 里 `/^bili-whale/` 分支（已无来源）、`block()` 默认 scope、`resetLimits()`；
   - `src/bridge.js`：`bridgeBudgetLimits()`、`bridgeDailyUsage()`（历史 `bili` 用量可保留读入总额，但不再暴露分项）；
   - `plugins/surfcore/lib/client.js`：Token 页的 B站 卡与三处文案；
   - 测试：`scripts/test-token-budget*.mjs`（38 处）、`scripts/test-token-economy.mjs`。
   - 记忆卡侧更麻烦：`src/memory-card.js` 的 `SOURCE_PLATFORM`（`bili-video`→`bili` 等）、`scope:'bili'` 归一、`promptBili` 路径、`includeQqInBili`；`lib/memory-card.js` 的 `readBiliEntries()`、`memoryCardPromptBlock('bili')`。**这些是存量数据键名，改名要写迁移**，不能只改字符串。

---

## 6. 怎么验

```bash
cd D:/HX/Documents/deepseek-harness/default-workspace/surfcore

# 1) 语法
for f in src/bridge.js src/douyin-memory.js src/douyin-share-scheduler.js \
         plugins/surfcore/lib/index.js plugins/surfcore/lib/client.js; do node --check "$f" || echo "FAIL $f"; done

# 2) 插件测试链（33 个脚本；只有 test-updates-voice 会因联网失败）
cd plugins/surfcore && npm test; cd ../..

# 3) 根审计（期望 56/67，红的那 11 个见下）
node scripts/test-audit.mjs 2>&1 | grep -E "FAILED|Audit suite"

# 4) 桥接接口（注意必须 --noproxy，系统代理会拦本机）
# 令牌在「仓库 state/」下，不是 ~/.dsh/surfcore（老交接写错了，实测 401 就是踩这个）
TOKEN=$(cat state/console-token)
curl -s --noproxy '*' -H "x-console-token: $TOKEN" http://127.0.0.1:3100/api/douyin/status | head -c 400
curl -s --noproxy '*' -H "x-console-token: $TOKEN" http://127.0.0.1:3100/api/douyin/prompt-preview | head -c 200
curl -s --noproxy '*' -X POST -H "x-console-token: $TOKEN" -d '{}' http://127.0.0.1:3100/api/douyin/share-now
```

期望（2026-11-03 22:58 重启后**实测全部符合**）：
- `/api/douyin/status` → `enabled:true`、`memory.plugin` 有真实插件路径、**`share` 字段在**
  （未配置时是 `{enabled:false}`，配了才有 `times/groups/cardMode/poolSize/sharedCount`）。
  > 这条路由**没有**顶层 `version`；`1.4.7` 在插件路由 `/dsh-surfcore/api/douyin/status`
  > （`readDouyinStatus()` 实测 `installed:true, version:"1.4.7"`）。
- `/api/douyin/prompt-preview` → `text:""`、`briefChars:0` = **素材池空时一个字都不注入**（这正是我们要的；
  如果这里出现作品名，说明注入了假记忆）。
- `/api/douyin/share-now` → `{ok:false,error:"抖音分享未启用（检查 douyinBridge.share / 白名单群）"}`，
  **不是**「没有新鲜素材」——先拒绝开关，再看池子，顺序是对的。

> ⚠️ **老交接里的 `/api/overview` 是错的**：桥接**从来没有**这个路由（`grep -c "/api/overview" src/bridge.js` = 0），
> 打过去必然 404，跟「有没有重启」无关。桥接的总状态是 `/api/status`，插件侧概览是 DSH 端口上的
> `/dsh-surfcore/api/overview`（DSH 自己的鉴权，curl 需要启动令牌，通常直接从 UI 看）。

**红着的 11 个根审计脚本（本轮之前就红，与删 B站 无关）**：
`test-audit-setup-guards`、`test-self-identity`、`test-identity-guard`、`test-qq-preset-contract`、`test-preset-prompt`、`test-voice`、`test-voice-system`、`test-preset-local-tools`、`test-qq-mode-plugin`、`test-agent-preset-patches`、`test-version`。
前三个/`test-preset-*` 是早前「主人要求全放开工具、语音默认开」那批改动的连带失败；`test-version` 是版本号没跟上；这些都**在 HEAD 基线上也红**。

---

## 7. 想退回去怎么办

改动**没有 commit**，所以：

```bash
# 想先保住这轮成果再试别的
git stash push -u -m "douyin-migration"
# 想彻底回到 v0.6.22
git reset --hard HEAD && git clean -fd
```

`git reset --hard` 会连 95 个删除一起还原，**这是唯一能拿回 B站 工具链的方式**（已 `git rm` 的东西不在工作树里了）。

---

## 8. 关键路径速查

| 东西 | 路径 |
| --- | --- |
| 仓库 | `D:\HX\Documents\deepseek-harness\default-workspace\surfcore` |
| 插件代码 | `plugins/surfcore/lib/` |
| 桥接 | `src/bridge.js`（本地 `:3100`，令牌 `<repo>/state/console-token`） |
| 插件侧状态 | `C:\Users\HX\.dsh\surfcore\`（`config.json` 合体层、`audit.jsonl`、`plugin.log`、`token-budget.json`、`memory/`、`characters/`） |
| QQ 侧状态 | `<repo>\state\`（`douyin-memory.md/-brief.md/-json`、`douyin-share-state.json`、`alignments.json`、`sessions.json`、`social-v2.json`、`bridge.log`）。**提示词注入读的是这里**，不是 `~/.dsh/surfcore` |
| 抖音插件包 | `C:\Users\HX\.dsh\profiles\desktop\node_modules\dsh-douyin-agent`（`state/`、`memory/`） |
| 抖音浏览器 | `C:\Users\HX\.dsh\douyin-browser\{cli-profile,control,memory}`，CDP 端口 **9227** |
| 配置分层 | `readUnified()` → 合体层（`platforms.start`、`memory.qqToDouyin`）；`readQqConfig()` → QQ 侧（`douyinBridge`、`allow.groups`）。**`douyinBridge` 住 QQ 侧，写进合体层桥接读不到** |

---

## 9. 本轮新踩的坑（详见 PITFALLS #84–#89）

- **#84** WorkBuddy 的 safe-delete 会掐死 pnpm 安装（装抖音插件时踩到）。
- **#85** 两个插件抢同一件事时，只读约束那三条（上面 §2）。
- **#86** 重启 DSH 的两个陷阱：`ELECTRON_RUN_AS_NODE` 残留 + Job Object 回收进程树 → **GUI 常驻进程不要由工具起**。
- **#87** B站 下线删到哪、故意留下什么（本文 §4 的详版）。
- **#88** host 测试只隔离 `DSH_HOME` 没隔离 `SURFCORE_QQBOT_ROOT`，把合成作品写进线上抖音记忆（§10）。
- **#89** `/api/memory-card/notify` 把 `readBody()` 的返回值再 `JSON.parse` 一次 → 容量告警恒定 500，从来没发出去过（§10）。

另外两个当场修的 bug，别再改回去：
1. `douyinToQqStatus()` 里曾写 `activePlatformStateDir(QQ_STATE_DIR())` —— `QQ_STATE_DIR` 是字符串导出，调用即抛错，`/overview` 直接 500。
2. `platformStartsFrom()` 曾从 `platforms.enabled` 推出 `bili: true`，界面上会多一个永远起不来的开关；现在 `bili` 恒 `false`，`douyin` 接位（老配置只写 `bili` 的按 `douyin: true` 迁移）。

---

## 10. 收尾轮补记（2026-11-03 22:49–23:05，接手人）

### 做了什么

| 事 | 结果 |
| --- | --- |
| 提交 | `9c7b634`：94 删 / 47 改 / 12 增 / 1 重命名。本地 git 身份按历史作者补成 `Mieksido <113783930+Mieksido@users.noreply.github.com>`（原先没配，commit 直接失败） |
| 语法检查 | `src/{bridge,douyin-agent,douyin-memory,douyin-share-scheduler}.js` + 插件侧 5 个文件 `node --check` 全过 |
| 插件测试链 | 30 个脚本逐个跑（`test-updates-voice` 跳过联网那条），**全绿** |
| 根审计 | 55/66 → 加了 notify 契约测试后 **56/67**，红的 11 个与 §6 列的一致（HEAD 基线上也红） |
| 修 bug ①（#88） | host 测试写进线上抖音记忆 |
| 修 bug ②（#89） | 记忆卡容量告警因 `JSON.parse(await readBody())` 双重解析，**从来没发出去过** |
| 重启后实测 | 新代码在跑：`share` 字段在、空池 `prompt-preview.text=""`、`share-now` 明确拒绝 |

### 抓到的坑（PITFALLS #88）

`test-douyin-host.mjs` 只隔离了 `DSH_HOME`，没隔离 `SURFCORE_QQBOT_ROOT`，于是 `/douyin/memory/refresh`
把测试里写死的 `猫咪日常 / 深夜食堂`（videoId 111/222）写进了**真实** `state/douyin-memory.md`。
这份文件是 QQ 提示词的事实来源 —— 带着它重启，她会在群里说自己看过这两条从没看过的视频。

已修：测试里造了一个假 QQ 根（`config.json` + `src/bridge.js` 存根）+ 设 `SURFCORE_QQBOT_ROOT`，
并加两条断言把隔离钉死；被污染的三件套已删（会从真实空池重新生成）。
复跑后 `state/` 不再新增任何文件。

> 写 `apply(ctx)` 级 host 测试的通用规矩：**`DSH_HOME` + `USERPROFILE` + `SURFCORE_QQBOT_ROOT` 三个一起设**。

### 抓到的坑二（PITFALLS #89）：记忆卡告警一直是哑的

重启后翻 `plugin.log`，发现每 10 分钟固定一行 `记忆卡告警通知失败："[object Object]" is not valid JSON`。
`readBody()` 本来就返回已解析对象（空体 `{}`），处理器又 `JSON.parse` 了一次，于是**每次都 500**。
记忆卡当时 80.5%，主人一条通知都没收到 —— 这是「该压缩了」的唯一提醒。

已修（`const body = await readBody();`）+ 新增 `scripts/test-memory-card-notify.mjs` 进审计清单，
把「不许再双重解析 / 收件人锁 `cfg.ownerQQ` / 10 分钟冷却」钉住。反向验过：贴回旧代码立刻红。

> ⚠️ 这条修复**要等下一次桥接重启才生效**。现在跑的还是重启前进程里的旧代码，
> 所以 `plugin.log` 里那行失败还会继续出现，属预期，不是没修好。

### 现在卡在哪

只剩一件必须人动手的：**抖音插件面板点「开始有限轮次」**把素材池填上（不填，分享调度器一直返回「没有新鲜素材」）。
填完再去 设置页 → 抖音 → 「分享到群」开开关、填时间点和群号即可。

### 没动的东西（下一轮）

§5 第 5 条的命名债原样留着：Token 页仍是「QQ / B站 / 其他 / 总额」四项（自洽、测试绿），
记忆卡 `scope/platform` 仍是 `bili`（存量数据键名，改名要写迁移）。别半截动。
