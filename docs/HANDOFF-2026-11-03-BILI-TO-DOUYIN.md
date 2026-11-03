# 交接：B站 下线 → 抖音接位（2026-11-03 22:30）

> 给下一个接手的人（或明天早上的我）：**改完了什么、现在是什么状态、还差哪几步、怎么验、怎么退**。
> 上游总索引仍看 `docs/HANDOFF.md`；踩过的坑看 `docs/PITFALLS.md` #84–#87。

---

## 0. 一句话状态

SurfCore 里 B站 那一整套**已经物理删除**（不是隐藏、不是开关关掉），抖音用「只读 `dsh-douyin-agent` 落盘结果」的方式接位。代码改完、单测基本绿，但**全部改动还没提交**，而且**运行中的 DSH 还是重启前的旧代码** —— 下一步就是提交 + 重启 + 实机验。

---

## 1. 现在到底什么状态

| 维度 | 状态 |
| --- | --- |
| 工作树 | `main` 分支上 **95 个删除 / 49 个修改 / 12 个未跟踪**，一个 commit 都没打 |
| 插件测试链 | `plugins/surfcore` 的 33 个脚本全过，**只有 `test-updates-voice.mjs` 红**（要联网拉 GitHub，环境问题，不是代码问题） |
| 根审计 | `node scripts/test-audit.mjs` → **55/66**；红的 11 个见 §6，都是本轮之前就红的 |
| 运行时 | DSH 6 个进程在跑、桥接 `:3100` 活着（`/api/status` 返 401 = 活着但要令牌），但**跑的是旧代码** |
| 抖音插件 | `dsh-douyin-agent@1.4.7` 已装在 `C:\Users\HX\.dsh\profiles\desktop`，SnowLuma 已连 |
| 抖音素材池 | **空的**。`C:\Users\HX\.dsh\surfcore\douyin-memory.md` 写着「还没有看过任何作品的记录」——插件那边还没点过「开始有限轮次」 |
| 分享开关 | **默认关**。运行时 `C:\Users\HX\.dsh\surfcore\config.json` 里连 `douyinBridge` 这个键都还没写，走的是默认值 |

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

1. **先提交**。95 删 + 49 改摊在工作树里风险很高，一次 commit 或先开 `feat/douyin` 分支都行。
   ```bash
   git add -A && git commit -m "feat: B站 下线，抖音接位（记忆注入 + 定时分享 + 控制台）"
   ```
2. **重启 DSH**（用户来点，不要我用工具拉 —— PITFALLS #86）：
   - 从开始菜单双击 DSH 启动，**不要**通过本工具起：WorkBuddy 的 Job Object 会在命令结束时回收整棵进程树，GUI 会秒退；
   - 启动前确认没有 `ELECTRON_RUN_AS_NODE=1` 残留（有的话 Electron 会退化成 node 直接退出）。
3. **重启后按 §7 验六条**，尤其 `/api/douyin/status` 要返回 `share` 字段。
4. **把抖音素材池填上**：在抖音插件面板点「开始有限轮次」，跑一轮后 `douyin-memory.md` 才会从「还没有看过任何作品」变成有记录；然后到设置页 → 抖音 → 「分享到群」开开关、填时间点和群号。
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

# 3) 根审计（期望 55/66，红的那 11 个见下）
node scripts/test-audit.mjs 2>&1 | grep -E "FAILED|Audit suite"

# 4) 桥接与插件接口（注意必须 --noproxy，系统代理会拦本机）
TOKEN=$(cat C:/Users/HX/.dsh/surfcore/console-token)
curl -s --noproxy '*' -H "x-console-token: $TOKEN" http://127.0.0.1:3100/api/douyin/status | head -c 400
curl -s --noproxy '*' -H "x-console-token: $TOKEN" http://127.0.0.1:3100/api/overview     | head -c 400
```

期望：
- `/api/douyin/status` → `ok:true`、`version:"1.4.7"`、`paths` 有四项、**`share` 字段在**（`{enabled,times,groups,cardMode,poolSize,sharedCount,...}`）。
- `/api/overview` → 200，不再 500（修过 `QQ_STATE_DIR()` 被当函数调的 bug）。

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
| 桥接 | `src/bridge.js`（本地 `:3100`，令牌 `C:\Users\HX\.dsh\surfcore\console-token`） |
| 运行时状态 | `C:\Users\HX\.dsh\surfcore\`（`config.json` 是 QQ 侧；`douyin-memory*.md`、`douyin-share-state.json`、`token-budget.json`） |
| 抖音插件包 | `C:\Users\HX\.dsh\profiles\desktop\node_modules\dsh-douyin-agent`（`state/`、`memory/`） |
| 抖音浏览器 | `C:\Users\HX\.dsh\douyin-browser\{cli-profile,control,memory}`，CDP 端口 **9227** |
| 配置分层 | `readUnified()` → 合体层（`platforms.start`、`memory.qqToDouyin`）；`readQqConfig()` → QQ 侧（`douyinBridge`、`allow.groups`）。**`douyinBridge` 住 QQ 侧，写进合体层桥接读不到** |

---

## 9. 本轮新踩的坑（详见 PITFALLS #84–#87）

- **#84** WorkBuddy 的 safe-delete 会掐死 pnpm 安装（装抖音插件时踩到）。
- **#85** 两个插件抢同一件事时，只读约束那三条（上面 §2）。
- **#86** 重启 DSH 的两个陷阱：`ELECTRON_RUN_AS_NODE` 残留 + Job Object 回收进程树 → **GUI 常驻进程不要由工具起**。
- **#87** B站 下线删到哪、故意留下什么（本文 §4 的详版）。

另外两个当场修的 bug，别再改回去：
1. `douyinToQqStatus()` 里曾写 `activePlatformStateDir(QQ_STATE_DIR())` —— `QQ_STATE_DIR` 是字符串导出，调用即抛错，`/overview` 直接 500。
2. `platformStartsFrom()` 曾从 `platforms.enabled` 推出 `bili: true`，界面上会多一个永远起不来的开关；现在 `bili` 恒 `false`，`douyin` 接位（老配置只写 `bili` 的按 `douyin: true` 迁移）。
