# 发布待办队列（编辑会话 → 发布会话）

> 用途：编辑会话每完成一批改动，在这里追加**一个带时间戳的批次**：覆盖到哪个提交、
> 改了哪些文件/功能、case 路径、建议版本、可直接复制的交接块。
> **发布会话从最上面的「待发布」批次复制**，不用翻 `git log`；发布完成后把标题改成「已发布 vX.Y.Z」。
>
> 触发：用户说「好了，总结这次的改动」之类的话时追加（规则见 AGENTS 1.6）。
> 没有进这张表的改动，不允许发布（见 [RELEASE.md](RELEASE.md) 第一节）。
>
> **2026-11-01 起：编辑会话的提交都在 `dev` 分支**；发布会话合并 `dev → main` 后按本表发布。
> 批次里的「覆盖提交」指 dev 上的提交；发布时 main 上会多一个 merge commit，属正常。

---

## 待发布

> **2026-11-03 04:05：v0.8.7 已发布**，覆盖本表截至该时间的全部待发布批次（0.8.6 以来全部 dev，74 commits）。
> 以下批次保留作追溯；后续新批次继续加在最上面。

### 批次 2026-11-06 01:45 · 记忆强度分（第 3 件：FSRS 形状的 R/S/D）
<!-- release-batch: start=2026-11-06T01:00+08:00 end=2026-11-06T01:45+08:00 commits=7b7e767 -->

**覆盖提交**：`7b7e767`
**建议**：**0.9.0（minor）** —— 与下一批一起发；本批是 `/api/brain/*` 的**响应形状变更**
（`S` 换语义、`D` 从 `null` 变成 1~10），对外可见。

**改了什么**：
- 新增 `src/memory-strength.js`（271 行纯函数）：FSRS 形状的强度分 —— `S` 稳固度（天）、
  `D` 难度（1~10）、`R` 可提取性（`R=(1+19/81·t/S)^(-0.5)`，`R(t=S)=0.9`）。`S/D` 初值由
  重要度/`kind`/`tags`/`pinned` 映射，再按「先遗忘、后复习」重放 `decaySteps` 与 `recallCount`；
  卡面清晰度只当 R 的**上界**；保护类（钉住/最初/主人重要）不淡忘，也不给「到期/冻结天数」。
- `src/brain-decay.js`：从「清晰度阶梯」改成接线 —— `shape:'fsrs-strength'`，`S` 变稳固度、
  `D` 成真值，「第几天跌破冻结线」搬到 `frozenAtDay`，另给 `dueInDays`/`daysToFreeze`/
  `assumedSpread`；曲线起点与 `strengthOf().R` 严格相等。
- `src/brain-feed.js`：节点 `decay` 带 `S`/`D`/`label`（原来是 `S:null`）；`public/brain.html`
  时间推演换成三块瓦片（R / 稳固度 S（天）/ 难度 D）并改掉「这条阶梯」的说明。
- 测试：`scripts/test-memory-strength.mjs` 8 条；`test-brain-feed` / `test-brain-bridge` 同步改断言；
  `package.json` 加 `test:memory-strength`；`scripts/test-audit.mjs` 清单加一条。

**没做**：
- 没改 `memory-card.js` 的降档规则 —— `targetClarity()` 仍是「卡面上写什么」的唯一真相，FSRS 只读数；
- 没接「按 R 决定复习/整理」的调度；
- 事件时刻仍是均匀假设（`assumedSpread`），不是记录里的事实；
- 第 4 件建议候选未开工。

**验证**：
```text
node scripts/test-memory-strength.mjs  # 8/8
npm run test:brain                     # feed 13 / replay 11 / bridge / page 全绿
npm run test:audit                     # dev 上 151/152（唯一失败 test-release-manifest，
                                       # 安装清单是「已发布状态」的产物，dev 上必然对不上）
npm run test:regressions               # 17/17
npm run test:promise                   # 22 + 18
node scripts/version.mjs check         # v0.8.8 一致（未 bump）
```
反向验证：重放次序反过来 / 去掉 `min(预测, 卡面)` 的 `min` / 让保护类也吃上界 —— 对应用例
均变红，恢复后复绿。真实档案抽查（最近 30 条）：R/S/D 全有限、曲线单调非增、冻结日与 `exempt`
自洽，0 异常。

**重启**：需重启 QQ 桥接（响应形状变了，页面与服务端必须同版本）。`cmd.exe //c restart.bat`。

**风险**：
- **`S` 语义变更**：旧消费方把 `S` 当「冻结天数」，现在它是稳固度；页面与桥接必须同版本发
  （`docs/PITFALLS.md` 已记）；
- 静态页面可能被旧桥接服务，出现「没报错但数字错」的漂移 —— 重启后再点一遍页面确认；
- 唤醒提示词未受影响（本批不碰提示词）。

**case**：`docs/cases/2026-11-06-memory-strength.md`（并更新了 `docs/cases/2026-11-05-brain-live.md`）

---

### 批次 2026-11-05 23:40 · 记忆能力三件（检索 / 星图 / 约定提醒）+ 表情元数据
<!-- release-batch: start=2026-11-05T14:00+08:00 end=2026-11-05T23:40+08:00 commits=89f56f7,671a85b,9cb5013 -->

**覆盖提交**：`89f56f7`、`671a85b`、`9cb5013`
**建议**：**0.9.0（minor）** —— 新增三条对外接口面（`/api/memory/search`、`/api/brain/*`、`/api/promise/*`）与两段唤醒提示词，属于功能性新增。

**改了什么**：
- **记忆检索（第 1 件）**：`src/memory-index.js`（SQLite FTS5 + `vectors` 表、增量游标、按目录派生索引库）、
  `src/memory-embed.js`（本地 Qwen3-Embedding 0.6B 回环客户端）、`src/memory-recall.js`（唤醒用同步 BM25 /
  控制台用异步混合）、`scripts/memory-index.mjs`（CLI）。桥接唤醒注入 `memoryRecallLine`，
  新增 `POST /api/memory/search`。
- **星图（第 2 件）**：`src/brain-feed.js` / `brain-replay.js` / `brain-decay.js` + `public/brain.html`，
  七条 `/api/brain/*` 路由（SSE 实时流、7 天回放、衰减曲线、检索探针、开关）。数据源换成本地文件
  （记忆卡全量档 / trace / 工具日志），没有 long-memory / people.json 的那几个扇区。
- **约定提醒（第 5 件）**：`src/promise-watch.js` 纯函数 + 60 秒 tick，认「带到期日」的约定，
  到期当天经 `scheduleWakeV2` 排一次 `promiseDue` 唤醒。新增 `/api/promise/list|status|tick`。
  `config.example.json` 加 `promiseWake` 段（`at`/`until` 闭开区间）。
- **两个既有 bug**：`readBody()` 已 `JSON.parse` 又被解析一次 → `/api/memory-card/notify` 每次 500
  （容量告警私聊从未发出）；表情「只按文字理解」的短路分支丢了 `emojiId`/`summary`，
  下游推 CDN 与配收藏失锚。
- **派生库串档**：`memoryIndexPathFor()` 让非当前角色目录落 `state/memory-rag/archives/<sha1>.db`，
  测试夹具不再把生产索引重建成 2 条。
- **约定提醒的第二个 bug（`671a85b`，端到端才暴露）**：一次唤醒里 `buildWakePromptV2` 会被调两次，
  待提条目「读时即删」被第一次调用吃掉 → 真机 `layers.promise=0`：收到 `promiseDue` 却没有约定正文。
  改成「只读不删 + 投递接受后才删」，并加 10 分钟过期窗口。
- **约定提醒的复核收口（`9cb5013`）**：悬空待提条目加保鲜期并在 tick 里清理 + 留日志（丢件必须说出来）；
  `promiseDue` 的唤醒原因按「约定正文在不在」分叉，缺正文时不再让她去「看上面」找一段不存在的话。

**没做**：
- 第 3 件 FSRS 记忆强度分当时未开工（**已在下一批 `7b7e767` 完成**）、第 4 件建议候选未开工；
- 没搬人格成长 / 自主生活 / 每日报表（判定与 SurfCore 自有等价物重复）；
- RRF 只看排名不看分数；embedding 区分度偏小（同题两条 0.480 vs 0.432）；
- 真实 QQ 唤醒触发**记忆检索**注入尚未观测到（唤醒路径只在夹具里验过；约定那一路已在真机验过）；
- 首次真实约定投递已在 2026-11-06 00:13 观测到并通过（详见 case 文档）。

**验证**：
```text
npm run test:audit          # 151/151（main 上；dev 上 150/151 —— 唯一一条是 test-release-manifest，
                            # 安装清单按「已发布状态」生成，dev 上必然对不上，不是回归）
npm run test:regressions    # 17/17
npm run test:brain          # feed / replay / bridge / page 全绿
npm run test:promise        # 22 + 18
node scripts/test-media-search.mjs   # 16/16
node scripts/version.mjs check       # v0.8.8 一致（未 bump）
```
反向验证：去掉白名单预检查 / 把 `promiseDue` 移出 `autoWake` / `inReminderWindow` 退回只有下限 /
去掉待提条目的保鲜期判断 / 去掉 tick 里的过期清理 / 回退表情短路分支，对应用例均变红，改回后复绿。

**重启**：需重启 QQ 桥接（新增定时器与路由）。`cmd.exe //c restart.bat`。

**风险**：
- 唤醒提示词变长（记忆检索 ≤600 字 + 约定段），Token 成本随之上升；
- 约定提醒是**自己发起的**唤醒，闸门漏一处就会变成「没人说话也能叫醒她」——本次全部走
  `scheduleWakeV2`，未直连 `deliverPrompt`；
- 星图默认开（`brain.enabled` 缺省视为 true），多一个 20 秒定时器与本地文件比对；
- `src/bridge.js` 此前带 skip-worktree，本次提交同时解除了这一标记——之后它会被 git 正常跟踪。

**case**：`docs/cases/2026-11-05-memory-rag-index.md`、`docs/cases/2026-11-05-brain-live.md`、
`docs/cases/2026-11-05-promise-watch.md`、`docs/cases/2026-11-05-sticker-textonly-meta.md`

---

### 批次 2026-11-03 08:30 · 人格语气层去重
<!-- release-batch: start=2026-11-03T08:20+08:00 end=2026-11-03T08:30+08:00 commits=2a473a3 -->

**覆盖提交**：`2a473a3`
**建议**：**0.8.7（patch）**

**改了什么**：
- `readPersonaLayerText('tone')` 不再回退 core。
- `composePersonaLayers` 在 tone===core 时去重。
- `purposePersonaText()` 接入 tone。
- 测试补缺 tone、相同内容、purpose 接线。

**没做**：
- 不自动生成旧角色的 tone 文件；
- tone 读取失败仍静默空串；
- 没在真实运行桥接看 `/api/socialV2/prompt` 全文。

**验证**：
```text
node scripts/test-persona-layer-read.mjs
node scripts/test-persona-layers.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：重启 QQ 桥接 / DSH 插件。

**风险**：
- 旧角色 full 模式提示词变短；
- tone 与 core 相同会少一段重复；
- purpose 风格可能变化。

**case**：`docs/cases/2026-11-03-persona-tone-dedup.md`

---

### 批次 2026-11-03 08:00 · 群刷屏短指令过滤
<!-- release-batch: start=2026-11-03T07:50+08:00 end=2026-11-03T08:00+08:00 commits=23f0297 -->

**覆盖提交**：`23f0297`
**建议**：**0.8.7（patch）**

**改了什么**：
- 新增 `src/command-spam.js`：`#sl` 这类 `#` + ASCII 命令词识别。
- bridge 入站：群聊、非主人、非 @/引用、配置开启时不唤醒/不 append 未读。
- 配置 `socialV2.ignoreSpamCommands` 默认 true；设置页开关。
- 新增 `test-command-spam.mjs`。

**没做**：
- 管不了 SnowLuma / 别的鱼；
- 主人发 #sl 仍进模型；
- 不是“出现 N 次才拦”，单条就拦；
- 过滤点在 pending 之后，仍会先写记忆/鱼群窗口。

**验证**：
```text
node scripts/test-command-spam.mjs
node scripts/test-audit-bridge.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：重启 QQ 桥接。

**风险**：
- 如果 #sl 是正常叫鱼方式，会被忽略（可关开关或 @ 鱼）；
- 其他机器人仍会回，用户可能误以为没生效；
- 尾随中文长句可能仍匹配。

**case**：`docs/cases/2026-11-03-ignore-hash-commands.md`

---

### 批次 2026-11-03 07:30 · B站 @ 楼层回复
<!-- release-batch: start=2026-11-03T07:20+08:00 end=2026-11-03T07:30+08:00 commits=8f9a4a7 -->

**覆盖提交**：`8f9a4a7`
**建议**：**0.8.7（patch）**

**改了什么**：
- `msgfeed.replyCoordinates()`：@ 一级评论补 `root=source_id`。
- `pullFeed` 保留 `sourceId` / `targetId`，root/parent 规范化。
- `comment-digest` 对 `@` 也输出坐标。
- `resolveLatestReply` 按 source rpid 找，不再拿 parent 比。
- 新增 `test-bili-reply-coordinates.mjs`。

**没做**：
- 没有真实 B站 账号发评论验证；
- 模型拿到坐标仍可能不用；
- B站 前端折叠展示未处理。

**验证**：
```text
node scripts/test-bili-reply-coordinates.mjs
node plugins/surfcore/scripts/test-bili-automation.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：重启 DSH / B站 调度器。

**风险**：
- `@` 一级评论的年龄检查可能查不到作者，但不阻塞；
- 关鱼群保护后仍可能新开层，如果模型不按坐标；
- 前端折叠可能让用户仍不一眼看到。

**case**：`docs/cases/2026-11-03-bili-at-floor-reply.md`

---

### 批次 2026-11-03 07:00 · QQ 工具晚注册限制
<!-- release-batch: start=2026-11-03T06:50+08:00 end=2026-11-03T07:00+08:00 commits=cc7e1b7 -->

**覆盖提交**：`cc7e1b7`
**建议**：**0.8.7（patch）**

**改了什么**：
- `qq-tool-restrict` 监听 `tools/change`，晚注册的已知危险全局工具补装 Schema 限制。
- 成功限制幂等；先登记再 restrict，防同步重入。
- 新增 `test-qq-tool-restrict-events.mjs`。

**没做**：
- 工具移除后重新注册可能漏限制；
- 静态名单外未知工具 Schema 仍可见；
- 旧 DSH 无 `ctx.on` 时退回旧行为；
- 没有真实 DSH 全量验收。

**验证**：
```text
node scripts/test-qq-tool-restrict-events.mjs
node scripts/test-audit-security.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：重启 DSH。

**风险**：
- `tools/change` 频率高时多一次静态名单遍历；
- 重新注册同名工具可能漏；
- 执行白名单仍是最后防线。

**case**：`docs/cases/2026-11-03-qq-guard-late-tools.md`

---

### 批次 2026-11-03 06:30 · QQ 工作区跟随 DSH 默认模型
<!-- release-batch: start=2026-11-03T06:20+08:00 end=2026-11-03T06:30+08:00 commits=60c57a7 -->

**覆盖提交**：`60c57a7`
**建议**：**0.8.7（patch）**

**改了什么**：
- 新增 `src/dsh-model-follow.js`；`ensureChatModel` 跟随 `modelCatalog.default`。
- `dsh.followDefaultModel` 默认开；旧控制台和 DSH 设置页都有勾选/来源/失败提示。
- 模型不认 `reasoningEffort` 时去掉参数重试。
- 新增 `test-dsh-model-follow.mjs`。

**没做**：
- 没有真机 QQ 消息验证；
- 没有拦 DSH 的 `saveSelection`；
- 不认 effort 的模型会忽略管理员强度；
- 15s 缓存。

**验证**：
```text
node scripts/test-dsh-model-follow.mjs
node scripts/test-audit-bridge.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：桥接需重启；旧控制台刷新即可；DSH 设置页刷新。

**风险**：
- `selectModel` 全局副作用仍在；
- 跟随失败退回 config，需看 UI 提示；
- 两套 UI 要同步维护；
- 默认模型外部改变最多 15s 生效。

**case**：`docs/cases/2026-11-03-follow-default-model.md`

---

### 批次 2026-11-03 05:50 · 唤醒额度可见与回访免计次
<!-- release-batch: start=2026-11-03T05:40+08:00 end=2026-11-03T05:50+08:00 commits=771573a -->

**覆盖提交**：`771573a`
**建议**：**0.8.7（patch）**

**改了什么**：
- `replyCheck` 回访不占每日次数；`wakeBudgetTimes` 单独记计费唤醒。
- 旧状态回填 `wakeBudgetTimes`；purpose/成功唤醒/回滚同步两条线。
- `/api/status` / `states` / 插件 `mapStatusPayload` 暴露 `wakeGuard`。
- 概览黄条 + 体检「唤醒额度」+ 设置页 `replyCheckFree` 开关。
- 体检 `diagnoseSnowLuma` 用桥接状态，新增 bridge-down/bridge-error。

**没做**：
- 没有桥接级 VM 测试「重启后额度不丢」；
- `lastWakeBlock` 只存内存；
- `directBypassDay` 保持当前行为（@ 可越过日额度）；
- 没在真实 QQ 跑满一天。

**验证**：
```text
node scripts/test-token-guard.mjs
node plugins/surfcore/scripts/test-doctor.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：重启桥接 + DSH。

**风险**：
- 旧状态迁移必须回填，否则升级当天多额度；
- 回访免费增加模型回合数；
- 多入口 wakeGuard 漏一个就仍看不见；
- 真实额度曲线未验证。

**case**：`docs/cases/2026-11-03-wake-quota-visible.md`

---

### 批次 2026-11-03 05:20 · 孤立代理项 / 桌宠 400
<!-- release-batch: start=2026-11-03T05:10+08:00 end=2026-11-03T05:20+08:00 commits=8f865df -->

**覆盖提交**：`8f865df`
**建议**：**0.8.7（patch）**

**改了什么**：
- 新增 `src/safe-text.js`：sliceHead / clipText / wellFormed / deepWellFormed。
- 替换 purpose-engine、memory-card、pet-purpose、pet-chat 的截断点。
- pet-chat.complete 与 dsh-client.callUnary 发送前兜底。
- 新增 `test-safe-text.mjs`。

**没做**：
- 没有替换仓库所有 slice；
- deepWellFormed 不处理 Buffer/Date/Map/类实例；
- 400 日志没加响应体/请求 ID；
- 没有真实网络复现。

**验证**：
```text
node scripts/test-safe-text.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：重启 DSH；桥接也需重启才能吃到 purpose-engine 修复。

**风险**：
- 坏字符替换成 �；
- deepWellFormed 每次 RPC 有遍历开销；
- 未替换的截断点仍可能写坏数据；
- 非普通对象里的字符串不修。

**case**：`docs/cases/2026-11-03-lone-surrogate-400.md`

---

### 批次 2026-11-03 04:50 · web_search 凭据与 Search API
<!-- release-batch: start=2026-11-03T04:40+08:00 end=2026-11-03T04:50+08:00 commits=f294000 -->

**覆盖提交**：`f294000`
**建议**：**0.8.7（patch）**

**改了什么**：
- `readDshCredential()` 认 DSH 0.2.x `records`。
- 账号级凭据 fallback；账号 token 只发 `api.deepseek.com`（`x-dsh-auth-token`）。
- 新增 `deepseekApiSearch()` 直连 `/v1/tools/search`。
- auto：API → 模型轮次 → Bing，失败原因全带出。
- 配置/设置页新增 `webSearch.apiSearchURL`。
- 新增凭据/端点边界测试。

**没做**：
- 不自动刷新账号 token；
- 不校验 issuer；
- 直连 API 只认 `results`；
- 没做真实 token 直连验证。

**验证**：
```text
node scripts/test-web-search-credentials.mjs
node scripts/test-media-search.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：重启 MCP web-search 进程/DSH。

**风险**：
- 账号 token 端点边界若被绕过会外泄；
- token 过期会再次回退；
- Bing 缓存 5 分钟；
- API 响应形状变化可能变空结果。

**case**：`docs/cases/2026-11-03-web-search-credentials.md`

---

### 批次 2026-11-03 04:20 · DSH Desktop node 路径
<!-- release-batch: start=2026-11-03T04:10+08:00 end=2026-11-03T04:20+08:00 commits=555896c -->

**覆盖提交**：`555896c`
**建议**：**0.8.7（patch）**

**改了什么**：
- 新增 `src/node-path.js`，`findNodeExe()` 查 DSH Desktop 安装目录。
- `paths.js` re-export；scheduler 复用；setup 的 MCP command 用真 node。
- 新增 `test-node-path.mjs`。

**没做**：
- 安装目录布局仍硬编码；
- 旧 profile 的 MCP command 不自动迁移；
- 没做 Linux/macOS 完整布局测试。

**验证**：
```text
node scripts/test-node-path.mjs
node scripts/test-audit-setup.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：重启桥接；已有 profile 需重跑 setup 才会重写 MCP command。

**风险**：
- DSH 换目录会再次失效；
- setup 单独复制运行时可能退回 process.execPath；
- 路径含空格必须用参数数组 spawn。

**case**：`docs/cases/2026-11-03-dsh-desktop-node-path.md`

---

### 批次 2026-11-03 03:50 · 人格卡住址误报
<!-- release-batch: start=2026-11-03T03:40+08:00 end=2026-11-03T03:50+08:00 commits=d3ebbd5 -->

**覆盖提交**：`d3ebbd5`
**建议**：**0.8.7（patch）**

**改了什么**：
- `privacy.js` 住址规则加 `(?![、，,])`：枚举不再当地址赋值。
- 保留真实地址正例。
- `test-privacy.mjs` 增加 7 个正负例。

**没做**：
- 未改 `PRIVATE_TOPIC`；
- 未回显命中片段；
- 未审视其他 PII 规则。

**验证**：
```text
node plugins/surfcore/scripts/test-privacy.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：刷新设置页即可。

**风险**：
- 顿号后接真地址会放过；
- 其他 PII 规则仍可能过度匹配；
- 记忆侧 `PRIVATE_TOPIC` 仍可能整行丢弃含“住址”的内容。

**case**：`docs/cases/2026-11-03-persona-address-false-positive.md`

---

### 批次 2026-11-03 03:20 · 出站 outbox 与早安探活
<!-- release-batch: start=2026-11-03T03:10+08:00 end=2026-11-03T03:20+08:00 commits=a799f1b -->

**覆盖提交**：`a799f1b`
**建议**：**0.8.7（patch）**

**改了什么**：
- 新增 `src/outbox.js`：连接类失败持久化，账号上线/启动补发。
- `onebotSend` / `sendToQQ` 失败入队；成功 markSent 去重。
- 10 分钟去重、60 条/24h/12 次上限；策略失败不入队。
- 早安 deliverPrompt 前探活 OneBot，失败不写 lastMorningOk。

**没做**：
- 语音/表情/卡片未完整覆盖；
- 成功指纹仅进程内；
- 没有 outbox 管理 UI。

**验证**：
```text
node scripts/test-outbox.mjs
node scripts/test-greeting.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：重启桥接。

**风险**：
- HTTP 超时可能已送达，补发会重复；
- 旧消息补发可能语境过期；
- outbox 明文落盘，依赖 state ACL；
- 探活不能保证模型一定发送。

**case**：`docs/cases/2026-11-03-outbox-greeting-probe.md`

---

### 批次 2026-11-03 02:50 · B站记忆回退与管理员输入框
<!-- release-batch: start=2026-11-03T02:40+08:00 end=2026-11-03T02:50+08:00 commits=c708744 -->

**覆盖提交**：`c708744`
**建议**：**0.8.7（patch）**

**改了什么**：
- B站记忆：角色级优先，角色级缺文件时只读回退账号级旧数据。
- 覆盖日记/评分/收藏/评论账四类输入。
- 管理员卡片输入框/下拉：border-box + max-width 240。
- 新增 CSS/记忆路径回归测试。

**没做**：
- 不迁移账号级旧数据；
- 不保证多角色共用旧数据时不混读；
- 240px 未按所有屏幕自适应；
- 没做截图回归。

**验证**：
```text
node scripts/test-admin-input-css.mjs
node scripts/test-bili-workspace.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：刷新设置页；B站记忆下一轮刷新生效。

**风险**：
- 账号级回退可能读到上一角色旧数据；
- box-sizing 会改变其他输入控件尺寸；
- 240px 只是参考值。

**case**：`docs/cases/2026-11-03-bili-memory-fallback-admin-css.md`

---

### 批次 2026-11-03 02:20 · 客户端包唯一 Loader 来源
<!-- release-batch: start=2026-11-03T02:10+08:00 end=2026-11-03T02:20+08:00 commits=ce666ed -->

**覆盖提交**：`ce666ed`
**建议**：**0.8.7（patch）**

**改了什么**：
- `qq-mode` 拆成 `plugins/surfcore/qq-mode/` 独立 host-only 包（自带 package.json，不声明 dsh.client）。
- `cordis.patch.yml` 改 `./qq-mode/index.js`；`lib/qq-mode.js` re-export。
- `compat.js` 新增 `COMPAT_CLIENT_MULTI_SOURCE`。

**没做**：
- 不改 DSH client-modules 的 fatal 语义；
- 不删 qq-mode 设置命名空间；
- 不自动清理用户手写重复 Loader 行。

**验证**：
```text
node scripts/test-qq-mode-plugin.mjs
node scripts/test-plugin-compat.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：重启 DSH；建议同时启用 vision-router 做一次冷启动验证。

**风险**：
- 依赖 DSH nearest-package 解析；
- 旧 profile 手写重复行仍要删；
- 没有真实 vision-router live 测试。

**case**：`docs/cases/2026-11-03-client-multi-source.md`

---

### 批次 2026-11-03 01:50 · 语音开关入口
<!-- release-batch: start=2026-11-03T01:40+08:00 end=2026-11-03T01:50+08:00 commits=9d532c2 -->

**覆盖提交**：`9d532c2`
**建议**：**0.8.7（patch）**

**改了什么**：
- 语音页顶部新增「语音开关」卡片（总闸 + 发语音工具）。
- 保存复用父级 `/config` + stamps。
- 自检 / VOICE_DISABLED / VOICE_TOOL_DISABLED 提示改指语音页。
- 明确“两个都要开、保存后完全退出 DSH”。

**没做**：
- 默认值仍关闭；
- 自动重启 DSH；
- 自检不查真实 MCP 工具列表；
- 命令行窗口隐藏。

**验证**：
```text
node scripts/test-voice-gates.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：保存后完全退出 DSH 再打开。

**风险**：
- 语音页保存整份 QQ 配置，受 CONFIG_STALE 保护；
- 只开一个仍不能发；
- 隐藏控制台窗口可能隐藏错误。

**case**：`docs/cases/2026-11-03-voice-switch-location.md`

---

### 批次 2026-11-03 01:20 · DSH 0.2.1-rc.5 B站兼容
<!-- release-batch: start=2026-11-03T01:10+08:00 end=2026-11-03T01:20+08:00 commits=3ef2164 -->

**覆盖提交**：`3ef2164`
**建议**：**0.8.7（patch）**

**改了什么**：
- B站新会话补 agentPreset（standard/default）。
- selectModel 不可用时按模型目录 fallback 一次。
- 日记提示词改角色级 platformDir。
- bili-memory 支持 biliDir，bridge 传当前角色目录。

**没做**：
- 账号级旧日记/额度迁移；
- 旧未分组会话迁移；
- standard preset 实机验证。

**验证**：
```text
node scripts/test-bili-workspace.mjs
node scripts/test-model-options.mjs
node scripts/test-scheduler-permission.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：重启 DSH 插件/桥接。

**风险**：
- standard preset 不存在时退 default；
- fallback 可能选到更贵模型；
- 旧账号级数据不会自动出现在角色级。

**case**：`docs/cases/2026-11-03-bili-rc5-compat.md`

---

### 批次 2026-11-03 00:50 · 体检 SnowLuma 状态源
<!-- release-batch: start=2026-11-03T00:40+08:00 end=2026-11-03T00:50+08:00 commits=d4b2cf8 -->

**覆盖提交**：`d4b2cf8`
**建议**：**0.8.7（patch）**

**改了什么**：
- 体检复用 `bridgeStatus()` 的 `snowluma`，不再传 `config.snowluma`。
- `diagnoseSnowLuma` 增加 `hasRuntimeState`：没有 connected 字段 → `bridge-not-running`。
- 只有运行态 connected:false + 端口在听才判 onebot-rejected。
- 新增体检状态源回归测试。

**没做**：
- onebot-rejected 仍只 probe TCP，不实际 get_login_info；
- 概览/启动/体检状态词未完全统一。

**验证**：
```text
node scripts/test-doctor-snow-state.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：重启 DSH 插件。

**风险**：
- 桥接状态接口失败时显示 bridge-not-running；
- 端口被其它服务占用仍可能误判；
- 没有真实 SnowLuma live 测试。

**case**：`docs/cases/2026-11-03-doctor-snow-state.md`

---

### 批次 2026-11-03 00:20 · B站生物钟会话归组
<!-- release-batch: start=2026-11-03T00:10+08:00 end=2026-11-03T00:20+08:00 commits=26f3b5e -->

**覆盖提交**：`26f3b5e`
**建议**：**0.8.7（patch）**

**改了什么**：
- 新 B站生物钟会话走 `workspaceId`，归入「B站生物钟」工作区。
- 专用目录 `state/bili-agents`；不再 `cwd: os.homedir()`。
- 旧会话保留不强行迁移；旧版无 workspaceController 时退回专用 cwd。
- `ensureSession` 创建失败不再标 ready，下一 tick 重试。

**没做**：
- 旧未分组会话自动迁移/归档；
- 无损 attach（DSH 无公开 API）；
- danger-full-access 默认调整。

**验证**：
```text
node scripts/test-bili-workspace.mjs
node scripts/test-scheduler-permission.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：重启 DSH 插件。

**风险**：
- 旧会话仍在「未分组」；
- workspaceController 失败时退回 cwd，仍可能未分组；
- 新工作区目录权限问题。

**case**：`docs/cases/2026-11-03-bili-workspace-grouping.md`

---

### 批次 2026-11-02 23:10 · zip 首次更新迁移
<!-- release-batch: start=2026-11-02T23:00+08:00 end=2026-11-02T23:10+08:00 commits=fd7bccf -->

**覆盖提交**：`fd7bccf`
**建议**：**0.8.7（patch）**

**改了什么**：
- 首次 zip 更新增加显式 `firstInstall` 逃生口；默认仍 blocked。
- 仅 `package.json.name === surfcore` 且无 `.git` 的目录允许。
- UI 新增「首次更新（先备份）」确认；覆盖前 backupTarget 备份。
- API `action=apply` 接收 firstInstall。
- 回归测试覆盖默认 blocked、显式放行、备份、UI/API 接线。

**没做**：
- 0.7.4 本身仍需用户点一次；
- manifest 无签名；
- verifyStaging 缺文件仍只 log。

**验证**：
```text
node scripts/test-update-apply-result.mjs
node scripts/test-update-version-fallback.mjs
node scripts/test-release-manifest.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：重启 DSH 插件。

**风险**：
- firstInstall 是显式逃生口，误确认可能覆盖；
- 只备份 manifest 中将被覆盖的文件；
- 首次更新后仍需退出 DSH 由 helper 写证据。

**case**：`docs/cases/2026-11-02-zip-update-bootstrap.md`

---

### 批次 2026-11-02 22:40 · schemastery volatile 兼容
<!-- release-batch: start=2026-11-02T22:30+08:00 end=2026-11-02T22:40+08:00 commits=9d583f9 -->

**覆盖提交**：`9d583f9`
**建议**：**0.8.7（patch）**

**改了什么**：
- 新增 `src/schema-values.js`：`unwrapSchemaValue` / `settingFromDshNamespace`。
- bridge 读 DSH settings 的 mode/ownerQQ 统一拆包。
- 设置页 `dshMode` / `dshSetting` 拆包，JSON 不再变 `{}`。
- qq-mode 测试改用拆包值；新增 `test-schema-volatile`。

**没做**：
- 没锁 3.18.2；
- 没全仓库禁止 volatile 裸读；
- 没把 3.18.5 写进 lock（只用 npm pack 临时验证）。

**验证**：
```text
node scripts/test-schema-volatile.mjs
node scripts/test-qq-mode-plugin.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：重启 DSH 插件。

**风险**：
- 业务对象若碰巧有 get() 会被误拆；
- `.get()` 抛错时保留包装对象；
- 只修已知 mode/ownerQQ 边界。

**case**：`docs/cases/2026-11-02-schemastery-volatile.md`

---

### 批次 2026-11-02 22:00 · B站监听错误可见性
<!-- release-batch: start=2026-11-02T21:50+08:00 end=2026-11-02T22:00+08:00 commits=8621cb8 -->

**覆盖提交**：`8621cb8`
**建议**：**0.8.7（patch）**

**改了什么**：
- listenTick 配置/额度改名，消除 L 同名遮蔽；
- ReferenceError/TypeError 带类型+stack（800 字）；
- 普通错误仍只 message，避免刷日志；
- 新增监听错误回归测试。

**没做**：
- ESLint no-shadow/no-use-before-define；
- mock feed 的完整 listenTick 单测；
- 其他函数里的 L 命名统一。

**验证**：
```text
node scripts/test-bili-listen-error.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：重启 DSH 插件。

**风险**：
- stack 含本机路径，只进 plugin.log；
- 普通网络错误仍只一行；
- 源码约束测试不能替代 lint。

**case**：`docs/cases/2026-11-02-listen-error-visibility.md`

---

### 批次 2026-11-02 21:30 · 事件流快照回退
<!-- release-batch: start=2026-11-02T21:20+08:00 end=2026-11-02T21:30+08:00 commits=72e100d -->

**覆盖提交**：`72e100d`
**建议**：**0.8.7（patch）**

**改了什么**：
- remote.mux 404 才降级 `/api/events` 轮询；
- 正常宿主保持 remote.mux 推送，不轮询、不加延迟；
- 快照首次取 latest 基线，cursor 增量，1.5s 去重；
- 60s 重试 remote.mux；
- 端口探测先看 `/api/status` JSON，修复误报“连不上”。

**没做**：
- `/api/events_mux`；
- 快照不含审批/提问的兼容；
- 真实老宿主 live 测试。

**验证**：
```text
node scripts/test-events-fallback.mjs
node scripts/test-dsh-port.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：重启桥接。

**风险**：
- 轮询最多慢 1.5s；
- 切换瞬间可能丢正在进行的 turn/end；
- 审批/提问若不在快照里仍收不到；
- WS 只给裸 1006 时可能识别不到 404。

**case**：`docs/cases/2026-11-02-events-snapshot-fallback.md`

---

### 批次 2026-11-02 21:00 · 模型设置与证据链
<!-- release-batch: start=2026-11-02T20:50+08:00 end=2026-11-02T21:00+08:00 commits=cdaf453 -->

**覆盖提交**：`cdaf453`
**建议**：**0.8.7（patch）**

**改了什么**：
- 宿主补 `/dsh/model`、`/dsh/effort` 代理，修复 404/模型下拉空。
- 保存只写“待确认”，不再宣称已生效。
- 记录 requested / lastApply(selected) / lastUsed(model/selection) / pending / bootAt。
- 失败可见；跨进程旧回执标 stale。
- UI 显示三态，保存 toast 改成“等待下一条消息由 DSH 确认”。

**没做**：
- 没有每条回复的实际 usage/model 证据；
- 保存时不主动 selectModel（避免打断回合）；
- 多会话逐条状态 UI 未做。

**验证**：
```text
node scripts/test-model-settings.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：重启 DSH 插件 / 桥接。

**风险**：
- selectModel.selected 只证明 DSH 接受，不证明最终路由/实际推理档位；
- 保存时正在跑的回合仍用旧模型；
- 全局默认副作用仍在。

**case**：`docs/cases/2026-11-02-model-settings-trust.md`

---

### 批次 2026-11-02 20:30 · 多群记忆隔离与互通圈
<!-- release-batch: start=2026-11-02T20:20+08:00 end=2026-11-02T20:30+08:00 commits=18a41bc,8f1d872 -->

**覆盖提交**：`18a41bc` + `8f1d872`
**建议**：**0.8.7（patch）**

**改了什么**：
- 记忆默认按群隔离；封闭互通圈；私聊永不进群。
- 每条记忆带群名/群 ID；旧记录按 groupId/conversationKey 补标。
- 当前群身份进唤醒/提醒/快照/get_prompt/context。
- 按会话生成记忆块；bridge 按 key 读取。
- 去重加 conversationKey。
- 设置页新增「记忆互通圈」。

**没做**：
- B站/桌宠的按群隔离；
- circle 嵌套/传递；
- 旧记录 JSON 重写（只在渲染时补标）；
- 私聊老记录重分片；
- 手动记忆严格隔离（默认全局）。

**验证**：
```text
node scripts/test-memory-sharing.mjs
node scripts/test-memory-card-wiring.mjs
node scripts/test-callname.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：重启 DSH 插件 / 桥接。

**风险**：
- 默认隔离改变现有体验；
- 开启互通圈会跨群暴露人/事；
- 旧记录无来源只能标未知；
- map 缺失时短暂回退全局块。

**case**：`docs/cases/2026-11-02-memory-sharing-circles.md`

---

### 批次 2026-11-02 14:50 · 本地语音包下载/安装
<!-- release-batch: start=2026-11-02T14:40+08:00 end=2026-11-02T14:50+08:00 commits=4d2d7c3 -->

**覆盖提交**：`4d2d7c3`
**建议**：**0.8.7（patch）**

**改了什么**：
- 代码 zip 回退 `github.com` → `codeload.github.com`；
- fetch 30s 超时、镜像优先、2 次重试、cause.code；
- postInstall 45 分钟 → 默认 3 小时；
- 进度拆分为 `download %` 与 `total %`；
- 失败卡提供「继续下载 / 重试安装」，保留 `.part`。

**没做**：
- 语音包内 `fetch-models.mjs` 的 `curl --retry` 截断 `.part` 属于语音包侧，需要新包；
- Python 3.12 探测/自动安装未改。

**验证**：
```text
node scripts/test-voice-packs-default.mjs
node scripts/test-voice-gui.mjs
node scripts/test-voice-system.mjs
node scripts/test-voice-cloud-credentials.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：重启 DSH / 桥接。

**风险**：
- codeload 也可能被限制；
- 3 小时超时可能让真正卡死的安装占更久；
- 失败后的持久状态未落盘，只修了失败当下的重试入口。

**case**：`docs/cases/2026-11-02-voice-local-install-download.md`

---

### 批次 2026-11-02 14:30 · 云端语音包启动诊断
<!-- release-batch: start=2026-11-02T14:20+08:00 end=2026-11-02T14:30+08:00 commits=c415201 -->

**覆盖提交**：`c415201`
**建议**：**0.8.7（patch）**

**改了什么**：
- 云端包直接拉 Python，去掉 `run.bat` 的 `start`；
- 同时收 stdout/stderr，GBK 自动回退解码；
- 进程早退立即报 `VOICE_START_EXITED`；
- 写 `logs/startup.log`，错误带日志路径/hint；
- 云端包体积提示 60MB → 约 280MB。

**验证**：
```text
node scripts/test-voice-packs-default.mjs
node scripts/test-voice-cloud-credentials.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：重启 DSH / 桥接。

**风险**：
- 云端不再走用户改过的 run.bat；
- 依赖坏了仍会失败，但现在能看到真实报错；
- 日志可能含本机路径，回显前要脱敏。

**case**：`docs/cases/2026-11-02-voice-start-diagnosis.md`

---

### 批次 2026-11-02 14:10 · 模型与思考强度可调
<!-- release-batch: start=2026-11-02T14:00+08:00 end=2026-11-02T14:10+08:00 commits=7e70fe8 -->

**覆盖提交**：`7e70fe8`
**建议**：**0.8.7（patch）**

**改了什么**：
- 新设置页「模型与思考强度」卡：low/high/max 下拉，low 最省；
- 模型下拉来自 DSH 目录，带图片能力/价格档位/全局副作用提示；
- 新增 POST `/api/dsh/model`，校验 provider/model/effort；
- 目录不可用时只允许调强度；
- 移除高级设置三手填项。

**验证**：
```text
node scripts/test-model-options.mjs
node scripts/test-audit-bridge.mjs
node plugins/surfcore/scripts/test-client-contract.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：不需要；保存后下一条消息生效。

**风险**：
- 切模型会同时改 DSH 全局默认模型；
- 纯文本模型图片走文字兜底；
- 不同模型思考档位/价格不同；
- 目录不可用时不能换模型。

**case**：`docs/cases/2026-11-02-model-reasoning-options.md`

---

### 批次 2026-11-02 13:50 · 设置页保存按钮 UX
<!-- release-batch: start=2026-11-02T13:40+08:00 end=2026-11-02T13:50+08:00 commits=c5f1c71 -->

**覆盖提交**：`c5f1c71`
**建议**：**0.8.7（patch）**

**改了什么**：
- 主按钮「保存并生效」（保存 + 重启 QQ 桥接），次按钮「仅保存（不重启）」；
- 成功提示改固定 toast；
- 设置页/弹窗固定底栏，群管理保存上移到底栏；
- 管理员卡片局部保存；
- 按钮对比度和禁用态调整。

**验证**：
```text
node plugins/surfcore/scripts/test-client-contract.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：重启 DSH / 重新加载插件。

**风险**：
- 「保存并生效」会重启 QQ 桥接，可能打断进行中的回合；
- 群分层和全局保存仍是两个端点；
- 没有真实浏览器截图回归。

**case**：`docs/cases/2026-11-02-save-button-ux.md`

---

### 批次 2026-11-02 13:30 · QQ 群聊 @ 识别
<!-- release-batch: start=2026-11-02T13:20+08:00 end=2026-11-02T13:30+08:00 commits=aa8dd2e,871c2b7 -->

**覆盖提交**：`aa8dd2e`, `871c2b7`
**建议**：**0.8.7（patch）**

**改了什么**：
- 原始 at 段判断，不再依赖渲染后的群名片/昵称；
- @机器人 + @别人时仍然唤醒；
- `self_id` 缺失回退登录 `selfUserId`；
- 兼容 CQ 字符串形式的 at；
- 引用自己判断同步回退。

**验证**：
```text
node scripts/test-qq-at.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：重启 DSH / QQ 桥接。

**风险**：
- @机器人 + @别人现在会唤醒，可能增加群回合；
- @all 仍不唤醒；
- 如果 SnowLuma 不投递群消息，代码修了也没用，需要先看入站日志。

**case**：`docs/cases/2026-11-02-qq-group-at-detection.md`

---

### 批次 2026-11-02 12:40 · B站监听 TDZ / 时间窗 / 群错误
<!-- release-batch: start=2026-11-02T12:30+08:00 end=2026-11-02T12:40+08:00 commits=3c99c54 -->

**覆盖提交**：`3c99c54`
**建议**：**0.8.7（patch）**

**改了什么**：
- `listenTick` 内层 `L` 改名 `LIM`，修 TDZ；
- 新增共享 `time-window.mjs`：跨午夜、全角冒号/数字、非法时间不再静默变 0；
- 保存作息窗口时非法项丢弃并 warning；
- agent 错误只发私聊；
- 唤醒重置保留用户显式批量窗口；
- ZIP EOCD 预检 + 截断包换镜像；
- 更新检查区分 unknown 和 0 更新。

**验证**：
```text
node scripts/test-time-window.mjs
node scripts/test-night-schedule.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：重启 DSH 后生效。

**风险**：
- 监听修好后夜间 API 调用会增加；
- 全角/非法窗口旧配置会被归一或丢弃；
- `start===end` 视为非法；
- 群聊不再显示 agent 错误，需看日志；
- 跨大版本更新仍建议手动覆盖。

**case**：`docs/cases/2026-11-02-bili-listen-time-window.md`

---

### 批次 2026-11-02 12:20 · B站视频缓存轮转
<!-- release-batch: start=2026-11-02T12:10+08:00 end=2026-11-02T12:20+08:00 commits=0313d0d -->

**覆盖提交**：`0313d0d`
**建议**：**0.8.7（patch）**

**改了什么**：
- 新增 `shots-cache.mjs`：按天/总量清理 `video/covers/subs`；
- `watch-video` 默认删原片，`--keep-mp4` 保留；`debrief --substrip` 完成后删；
- 目录支持 `DSH_HOME` / `shots.dir`；新增设置页缓存项；
- `.frames-*` 改为 `finally` 清理；命令输出缓存统计。

**验证**：
```text
node scripts/test-shots-cache.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：重启 DSH / 重新加载插件。

**风险**：
- 7 天保留可能删用户想留的片段，可调大或另存；
- 总量上限会从最旧开始清，默认 0 不启用；
- 多角色仍共用 shots，未按角色隔离；
- 自定义 `outDir` / `--out` 不参与默认清理。

**case**：`docs/cases/2026-11-02-bili-shots-cache-retention.md`

---

### 批次 2026-11-02 12:00 · 更新幂等 + 阶段进度
<!-- release-batch: start=2026-11-02T11:50+08:00 end=2026-11-02T12:00+08:00 commits=12c02e8 -->

**覆盖提交**：`12c02e8`
**建议**：**0.8.7（patch）**

**改了什么**：
- staged 更新用下载前目标键 dismiss，不再写 `vnull`；
- 排队中的组件在重启前不算 pending；弹窗内完成下载后提示重启 DSH；
- 进度阶段：download/extract/verify/backup/install/pending/failed；
- 下载完成后保留已下载/总量/百分比/速度；release 下载也上报进度。

**验证**：
```text
node plugins/surfcore/scripts/test-updates.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：重启 DSH 后生效。

**风险**：
- 解压阶段没有真实字节进度，只显示阶段 + 下载统计；
- pending 文件异常时可能隐藏更新提示，但 `.failed` 仍显示失败；
- 没有真实慢速网络 live 测试。

**case**：`docs/cases/2026-11-02-update-idempotency-progress.md`

---

### 批次 2026-11-02 11:45 · QQ 设置连续保存 CONFIG_STALE
<!-- release-batch: start=2026-11-02T11:35+08:00 end=2026-11-02T11:45+08:00 commits=3f81fbc,0f285cd -->

**覆盖提交**：`3f81fbc`, `0f285cd`
**建议**：**0.8.7（patch）**

**改了什么**：
- `POST /config` 保存成功后返回新 `stamps`；
- 前端保存成功后同步 `configStamps`；409 仍要求重新读取，不自动套用新戳；
- 例行“需要重启桥接”改 `notes`，warning 不再写进错误区；
- 新增连续保存/stamps 回归。

**验证**：
```text
node scripts/test-config-save-stamps.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：重启 DSH / 重载插件。

**风险**：
- stamps 必须在所有写操作/桥接重启之后算；
- 409 保护保留；真实并发改动仍会拒绝覆盖；
- 没有真实 UI 双击自动化测试。

**case**：`docs/cases/2026-11-02-qq-settings-save-stamps.md`

---

### 批次 2026-11-02 11:25 · DSH profile 安装事务回滚
<!-- release-batch: start=2026-11-02T11:15+08:00 end=2026-11-02T11:25+08:00 commits=2711e17 -->

**覆盖提交**：`2711e17`
**建议**：**0.8.7（patch）**

**改了什么**：
- `setup-dsh` 写 profile `package.json` 前自动备份，改为原子写；
- 安装前记录 bundles/dependencies，安装后核对；
- DSH reconcile 裁剪 bundles / 改写 patch 时，自动恢复备份并非零退出；
- 安装失败/超时也回滚，不再只打日志。

**验证**：
```text
node scripts/test-audit-setup.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：不需要重启；下次运行 setup 生效。

**风险**：
- 回滚只恢复 profile 两个文件，不恢复 `node_modules` / `pnpm-lock.yaml`；
- 安装期间手工改 profile 可能被回滚覆盖（备份保留）；
- 不改变 `QQ_BRIDGE_SKIP_DSH_INSTALL=1` 离线语义。

**case**：`docs/cases/2026-11-02-dsh-profile-install-rollback.md`

---

### 批次 2026-11-02 11:10 · 人格 tone 层回落核心修复
<!-- release-batch: start=2026-11-02T11:00+08:00 end=2026-11-02T11:10+08:00 commits=a8ebcba -->

**覆盖提交**：`a8ebcba`
**建议**：**0.8.7（patch）**

**改了什么**：
- `readPersonaLayerText` 增加 `kind === 'tone'` 分支；
- 未知人格层打印 warning 后回落核心，不再静默；
- 新增临时 DSH_HOME/真实文件读取测试，断言 tone 读到 `persona.tone.md`。

**验证**：
```text
node scripts/test-persona-layer-read.mjs
node scripts/test-persona-layers.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：DSH 插件 / 桥接。

**风险**：
- 有 tone 文件的角色提示词会变短、语气真正生效，说话风格可能感觉变了；
- 无 tone 文件旧角色行为不变；
- tone 文件读取异常仍只返回空串，没有单独报错。

**case**：`docs/cases/2026-11-02-persona-tone-core-fallback.md`

---

### 批次 2026-11-02 10:55 · 人格卡智能拆分 layer 未定义
<!-- release-batch: start=2026-11-02T10:45+08:00 end=2026-11-02T10:55+08:00 commits=87b06f1 -->

**覆盖提交**：`87b06f1`
**建议**：**0.8.7（patch）**

**改了什么**：
- 删除 `handlePersonaClassify` 里误引用保存函数的 `layer`；
- 拆分发送完整草稿（core/tone/daily/scenes），空输入前端直接提示；
- 内部错误 `PERSONA_CLASSIFY_INTERNAL`，不再说“检查人格卡内容”；
- 补静态/接口回归。

**验证**：
```text
node scripts/test-persona-classify.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：DSH 插件。

**风险**：
- 完整草稿更长，受 classifier 64KB 上限；
- 拆分仍只出草稿，不自动写盘；
- 没有真实模型 live 测试。

**case**：`docs/cases/2026-11-02-persona-classify-layer.md`

---

### 批次 2026-11-02 10:35 · 商城表情/非多模态图片兜底
<!-- release-batch: start=2026-11-02T10:20+08:00 end=2026-11-02T10:35+08:00 commits=2be3ced,68fada5 -->

**覆盖提交**：`2be3ced`, `68fada5`
**建议**：**0.8.7（patch）**

**改了什么**：
- `emojiCdnCandidates` 增加 p.qpic 候选（需 uin/resId），gxh 保留最后一跳；
- 消息段保留 `uin/resId`；
- 取图失败/非多模态用 `summary` + 本地表情库标签转文字；
- 新增 `socialV2.vision.imageInput` auto/true/false；
- `/sticker-image`、`/self-image` 与 MCP 工具支持文字兜底。

**验证**：
```text
node scripts/test-media-fallback.mjs
node scripts/test-media-search.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：DSH（bridge/配置）。

**风险**：
- 第三方目录外模型 auto 默认按“不支持”走文字兜底；确认支持图片可强制 true；
- p.qpic 依赖 uin/resId，缺失时不盲拼；
- 无真实商城表情 live 测试；
- 文字标签可能含对方可控内容，已 sanitize/限长。

**case**：`docs/cases/2026-11-02-emoji-market-fallback.md`

---

### 批次 2026-11-02 10:10 · 备份轮转 keep=40 修复
<!-- release-batch: start=2026-11-02T09:55+08:00 end=2026-11-02T10:10+08:00 commits=0b82105 -->

**覆盖提交**：`0b82105`
**建议**：**0.8.7（patch）**

**改了什么**：
- `pruneBackups` 改为先剥扩展名、再用允许横线时间戳的正则解析来源；
- 无法识别的文件跳过，不误删；
- `backupGroupOf` 纯函数 + 真实文件名测试；
- `pruneBackups` 返回 removed/errors，失败告警；`backupFile` 失败不再静默。

**验证**：
```text
node scripts/test-backup-prune.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：DSH 插件；下一次写备份即触发清理。

**风险**：
- 旧目录会一次性回收，先确认每组保留 40 份符合预期；
- 仍无备份总大小上限/压缩；
- 同毫秒同名覆盖未单独处理；
- `keep=40` 仍是硬编码默认，没有 UI 配置。

**case**：`docs/cases/2026-11-02-backup-prune-regex.md`

---

### 批次 2026-11-02 00:15 · 记忆卡最近优先
<!-- release-batch: start=2026-11-02T00:05+08:00 end=2026-11-02T00:15+08:00 commits=90f3eba -->

**覆盖提交**：`90f3eba`
**建议**：**0.8.7（patch）**

**改了什么**：
- `sectionize` 先收最近 N 天的 owner 记录到 `recent`，不再被 `initial` 挤空；
- recent 上限 8→12；initial/owner priority 下调（26/28），recent 保持 30；
- firstMet/anchors 仍优先保护；
- 新增渲染测试：近期 owner 进 recent，旧 initial 留 initial，同一记录不重复。

**验证**：
```text
node scripts/test-memory-card.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

**重启**：DSH 插件。

**风险**：
- 近期 owner 从 owner/initial 移到 recent，是行为变化；
- initial 仍 6 个名额，早期记录多时仍会占一部分；
- 未改 initialProbability 0.9，只改分区/预算；
- 没有统一提示词总预算，recent 12 条可能挤其他段；
- 未做真实聊天 live。

**case**：`docs/cases/2026-11-02-memory-recent-first.md`

---

### 批次 2026-11-01 23:45 · 记忆卡初次相遇可取消置顶/忘记
<!-- release-batch: start=2026-11-01T23:30+08:00 end=2026-11-01T23:45+08:00 commits=3e7c053 -->

**覆盖提交**：`3e7c053`
**建议**：**0.8.7（patch）**

**改了什么**：
- `refreshInitialState` 不再每次把已有 firstMet 强制置顶；只有新成为初次相遇时自动置顶；
- 初次相遇取消置顶后仍保留在 `## 初次相遇` 分区；
- `forget` 允许删除 pinned/firstMet，删除后自动让下一条最早主人互动接管；
- 失败返回 `MEMORY_NOT_FOUND + hint`；
- UI“忘记”不再因 pinned 禁用；reload 失败提示“服务端已保存但界面刷新失败”。

**验证**：
```text
node scripts/test-memory-card.mjs        # 26 passed
node scripts/test-memory-card-act.mjs
npm run test:audit                       # 119/119
cd plugins/surfcore && npm test          # 0 失败
```

**重启**：DSH 插件。

**风险**：
- 删除初次相遇后会自动选下一条最早主人互动；确认框已说明。
- 取消置顶的初次相遇仍进提示词/初次相遇分区，只是不再是 pinned 锚点。
- 旧卡 `firstMet=true,pinned=false` 现在被尊重，视觉可能和旧预期不同。
- 衰减卡删除不可逆；全量卡有归档副本。
- 未做真实浏览器点击 live。

**case**：`docs/cases/2026-11-01-memory-anchor-unpin.md`

---

### 批次 2026-11-01 23:05 · wait 积压立即返回 + 有界批量
<!-- release-batch: start=2026-11-01T22:55+08:00 end=2026-11-01T23:05+08:00 commits=2e377ec -->

**覆盖提交**：`2e377ec`
**建议**：**0.8.7（patch）**

**改了什么**：
- wait 先检查本轮未读；有积压立即返回，不再从 wait 时刻重新等 quiet；
- `turnActive` 不可靠时仍能看到 backlog；
- 新增 `maxBatchMessages` / `maxBatchChars`（默认 20/4000）；
- 群聊超出折叠 `foldedCount`，私聊不静默删除；
- `selectWaitBatch` 纯函数 + R17 桥接回归。

**验证**：
```text
node scripts/test-v2-wait-batch.mjs
node scripts/test-audit-regressions.mjs
npm run test:audit        # 119/119
cd plugins/surfcore && npm test   # 0 失败
```

**重启**：QQ 桥接。

**风险**：
- 群聊折叠旧消息只给计数/预览，原文可从 recent 回看；
- 私聊被批量上限截断时不删除，下次还能再给；
- 静默下限仍可能覆盖只改 defaultQuietMs 的用户；
- 未做真实 QQ 长轮询 live。

**case**：`docs/cases/2026-11-01-wait-backlog-batch.md`

---

### 批次 2026-11-01 22:55 · 四类动态空前缀/配置路径修复
<!-- release-batch: start=2026-11-01T22:45+08:00 end=2026-11-01T22:55+08:00 commits=827580d -->

**覆盖提交**：`827580d`
**建议**：**0.8.7（patch）**

**改了什么**：
- `tools/lib/config.mjs` 与 `plugins/surfcore/lib/paths.js` 统一配置路径：
  `SURFCORE_BILI_CONFIG > DSH_HOME/surfcore/bili.config.json > HOME/.dsh/...`；
- 设置页显示实际 B站 配置文件路径；
- 空前缀时 `daily` 清掉该类历史默认前缀（只清已知默认值）；
- scheduler 空前缀不再要求“必须有固定前缀”；
- 新增 `test-bili-prefix-config.mjs`。

**验证**：
```text
node scripts/test-bili-prefix-config.mjs
npm run test:audit        # 118/118
cd plugins/surfcore && npm test   # 0 失败
```

**重启**：DSH 插件 / QQ 桥接；下一轮 B站 tick 生效。

**风险**：
- 自定义 `DSH_HOME` 用户以前可能有两份配置；切换后实际读取路径变化，先确认/备份旧文件；
- 只清已知默认前缀，避免误删用户自己写的 `【…】`；
- 旧配置缺 `prefix` 仍回退默认；只有明确 `""` 才代表不加；
- 直接 `dynamic.mjs post` 不共享这套清洗。

**case**：`docs/cases/2026-11-01-bili-dynamic-prefix-config.md`

---

### 批次 2026-11-01 22:40 · 黑话学习 turn 等待修复
<!-- release-batch: start=2026-11-01T22:20+08:00 end=2026-11-01T22:40+08:00 commits=507c758,297efdc,18f89b1 -->

**覆盖提交**：`507c758`, `297efdc`, `18f89b1`
**建议**：**0.8.7（patch）**

**改了什么**：
- `waitLearnerTurn` 改为先注册再 prompt，并支持 cancel；
- 超时 `LEARNER_TURN_TIMEOUT`，不再用泛化“会话”正则误删会话；
- collector 支持缺 `turn/start` 的 assistant/turn-end；
- prompt 失败/被拒会取消 waiter，不再空等 120 秒。

**验证**：
```text
node scripts/test-learner-turn-wait.mjs
npm run test:audit        # 117/117
cd plugins/surfcore && npm test   # 0 失败
```

**重启**：QQ 桥接。

**风险**：
- 超时仍会重建 scratch 学习会话（丢学习会话上下文，不丢用户聊天记忆）；
- 若 DSH 完全不发 assistant/message 和 turn/end，仍只能超时；
- 事件重连/重复投递需要真实 DSH 压测。

**case**：`docs/cases/2026-11-01-slang-learner-wait.md`

---

### 批次 2026-11-01 22:15 · 语音提示词不再写死默认关闭
<!-- release-batch: start=2026-11-01T21:55+08:00 end=2026-11-01T22:15+08:00 commits=f66749b -->

**覆盖提交**：`f66749b`
**建议**：**0.8.7（patch）**

**改了什么**：
- `qq-chat-v2` preset 第 16 条删除“语音默认是关闭的”写死文案，改为按工具是否存在和 `VOICE_DISABLED` / `VOICE_TOOL_DISABLED` 判断；
- 同步生成 `plugins/surfcore/presets/qq-chat-v2.patch.yml`；
- `bridge.js` 每次唤醒注入 `voiceStatusLine()`：总闸/工具/语音库状态，覆盖旧记忆里的“不能发语音”；
- `qq_list_voices` 补 `VOICE_DISABLED` / `VOICE_TOOL_DISABLED` code + hint；
- 设置页说明两个开关、必须重启 DSH、text 模式不依赖语音库。

**验证**：
```text
node scripts/test-voice-prompt-fix.mjs
node scripts/test-voice-system.mjs
node scripts/test-qq-preset-contract.mjs
node scripts/test-voice.mjs
npm run test:audit        # 116/116
cd plugins/surfcore && npm test   # 0 失败
```

**重启**：DSH（preset/MCP 工具列表）+ QQ 桥接；旧会话建议新建后再测。

**风险**：
- 模型会更愿意尝试语音；MCP 未重启/总闸没开时会多一次失败调用；
- 旧会话的系统提示不会自动更新，状态行只能覆盖，不保证完全压过；
- 旧记忆卡不会自动删除“不能发语音”，只做当前状态覆盖；
- 语音是强表达，可能更频繁，需依赖频率/场景规则；
- `text` 模式依赖 TTS，TTS 未启动仍会失败。

**case**：`docs/cases/2026-11-01-voice-prompt-default-off.md`

---

### 批次 2026-11-01 20:35 · 通知修复 + QQ推送 + 沉默逛 + 年龄闸
<!-- release-batch: start=2026-11-01T20:10+08:00 end=2026-11-01T20:50+08:00 commits=e676dd9,218a2a4,9be7fa6 -->

**覆盖提交**：`e676dd9`, `218a2a4`, `9be7fa6`
**建议**：**0.8.7（patch）**

**改了什么**：
- 桌面通知：PowerShell 单引号 XML + SecurityElement.Escape；捕获 stderr；非 Windows 明确失败；
- 新增 `notify.type=qq`：只私聊 ownerQQ，走桥接 `/api/notify/owner`（控制台专用，AI 不能调）；
- 新增 B站 `interact.enabled` 沉默逛：评论/回复/搭话/动态/分享/私信/弹幕/点赞全部硬拦，仍可看/评分/写日记；
- 新增 `interact.maxCommentAgeDays`（默认 14），避免 @ 2023 年旧评论；
- 闸门错误统一 code + hint：BILI_INTERACT_DISABLED / BILI_COMMENT_TOO_OLD / DESKTOP_* / QQ_NOTIFY_* / NOTIFY_*。
- 超时提醒可在概览「永久不再显示」；写入 `bili.config.json` 的 `notify.timeoutMutes`，同 code/source 1 小时去重。

**验证**：
```text
node scripts/test-notify-channels.mjs
node scripts/test-bili-interact.mjs
npm run test:audit   # 114/114
cd plugins/surfcore && npm test   # 0 失败
PowerShell Parser::ParseFile(桌面 toast) → PS syntax OK
```

**重启**：QQ 桥接（通知端点）+ DSH（UI）；B站 沉默/年龄下一轮生效。

**数据**：B站 config 新增 `interact`；旧配置默认 true/14；`0` 额度仍是不限量，不改变旧语义。

**风险**：
- QQ 推送依赖桥接在线；桥接没开只能报错；
- 沉默逛仍会读/评分/写日记，token 仍消耗；
- 年龄闸只对有明确 parent/fish target 生效；模型自写 @ 仍可能绕过；
- B站闸门错误目前主要回工具/agent，未进概览错误报告；
- 桌面通知仍只支持 Windows。

**case**：`docs/cases/2026-11-01-notify-qq-silent-browse.md`

---

### 批次 2026-11-01 19:55 · 管理员温柔模式默认关闭 + 风险/上下文确认
<!-- release-batch: start=2026-11-01T19:35+08:00 end=2026-11-01T19:55+08:00 commits=bf5fd31 -->

**覆盖提交**：`bf5fd31`
**建议**：**0.8.7（patch，稳定版）**；若只发 dev，则 `0.8.6-dev.7`

**改了什么**：
- `normalizeAdmin`/`adminFromSources`/`store.DEFAULT_UNIFIED` 默认 `gentle:false`，只有显式 true 才开；
- 开启前新增 `AdminGentleEnableModal`，列出全部行为风险；
- 关闭后不再注入 `adminPromptBlock`、不再用 `【管理员】` 标记；`ownerLabel` 不再带“管理员”；
- 关闭时新增 `AdminGentleDisableModal`：保留上下文（默认/可选否）或丢弃上下文；
- 丢弃上下文 → `resetSessions`：QQ 会话语义重置、B站 换新 sessionId、自动重启桥接；
- 管理员权限/审批/白名单不变。

**验证**：
```text
node scripts/test-admin-identity.mjs
node scripts/test-admin-prompt-wiring.mjs
node scripts/test-admin-gentle-ux.mjs
cd plugins/surfcore && node scripts/test-admin-bili-prompt.mjs
cd plugins/surfcore && node scripts/test-admin-config-api.mjs
npm run test:audit   # 112/112
cd plugins/surfcore && npm test   # 0 失败
```

**重启**：QQ 桥接 + DSH；B站 调度器由插件自动换会话。

**数据/迁移**：
- 已有显式 `gentle:true` 保持；缺省/旧配置按新默认关闭；
- 丢弃上下文会清 QQ 会话/社交状态，B站 换新 sessionId（旧 DSH 会话文件仍在磁盘，不再读取）；
- 保留上下文则旧历史可能继续影响语气。

**风险**：
- 关闭后模型不再知道“管理员”，权限仍硬校验；
- 人格卡本身可能仍温柔；
- 丢弃上下文不可恢复；
- 提示词只能引导，不能保证绝不回嘴；
- 默认关闭会让缺省旧用户从“温柔”变“普通”，需要发布说明。

**case**：`docs/cases/2026-11-01-admin-gentle-default-off.md`

---

### 批次 2026-11-01 14:00 · 更新通道 stable/dev（测试版链路）
<!-- release-batch: start=2026-11-01T13:00+08:00 end=2026-11-01T14:00+08:00 commits=dev -->

**覆盖提交**：`dev`
**建议**：**0.8.7（patch）**
**当前版本**：`0.8.6`（未 bump）

**内容**：
- 更新器 `updates.channel`：stable（默认，只跟正式 Release）/ dev（只跟 `-dev.N` Pre-release）；
- 设置页「检查更新」下面单选 main/dev；切回 main 清空旧检查结果，不被 dev pending 打扰；
- 版本规则 `X.Y.Z-dev.N`（同号低于正式版），稳定版切 dev 允许安装一次；
- `scripts/publish-dev.mjs`：dev 分支打 tag + Pre-release，不碰 main；
- 完整 semver 比较（含 dev.N 数字排序）。

**验证**：`test-dev-publish`、`test-update-apply-result`（版本排序/通道切换/main 不探测 dev）；audit 109/109。

**残余**：dev 分支会推到公开仓库（tag 需要 commit 可达）；它不发 Release，稳定用户看不到。

---

### 批次 2026-11-01 12:55 · DSH 注册修复按钮（dev 集货）
<!-- release-batch: start=2026-11-01T11:00+08:00 end=2026-11-01T12:55+08:00 commits=42ec20d..HEAD -->

**覆盖提交**：`dev` 分支（`42ec20d..HEAD`，含 `7b8b2d1` 等）
**建议**：**0.8.7（patch）**
**当前版本**：`0.8.6`，未 bump / 未 tag（dev 上）

**内容**：
- 设置 → QQ → 高级设置新增「DSH 注册（MCP / bundle）」按钮：显式点击才跑 `scripts/setup-dsh.mjs`，
  回显输出、不自动重启 DSH；
- L2 `dsh-profile-mcp-missing` 弹窗直接带「修复 DSH 注册」按钮；
- 失败路径结构化：`DSH_REPAIR_METHOD/BODY/PROFILE/SCRIPT_MISSING/FAILED`，均带 hint；
- 缺 MCP 的建议文案改为“宿主机终端执行（模型没有本地工具）”，evidence 加 `manualOnly`。

**验证**：audit 108/108；插件测试全绿；`--verify-ref HEAD` 问题 0。

**重启**：插件前端刷新即可；脚本执行后需完全退出并重开 DSH。

**残余**：`setup-dsh.mjs` 若需要 npm install，可能耗时；超时 180 秒，失败会给手动命令。

---

### 已发布 v0.8.0 · 2026-10-31 21:10 · 本轮全部优化
<!-- release-batch: start=2026-10-31T16:25+08:00 end=2026-10-31T21:10+08:00 commits=a27a1e4..68dc2b7 -->

**覆盖提交**：`68dc2b7`（范围 `a27a1e4..68dc2b7`）
**建议**：**0.7.27**（工具面/UI 改动较大，也可按 0.8.0 minor 处理；版本号由发布会话定）
**当前版本**：`0.7.23`，未 bump / 未 tag / 未 push

**本轮范围**：

1. **Token 测量与账单**
   - 上下文遥测、调用链、成本台账；
   - A+B 账单：角色包 + 每个 QQ 群/私聊 Markdown，自动 10 分钟刷新；
   - 账单归因：角色 characterId 优先，单角色历史回退，多角色缺失标 `_unattributed`。

2. **唤醒与群分层**
   - `src/group-policy.js`：成员数/近10分钟活跃/手动覆盖；
   - 小群保留积极唤醒，大群只认真实点名；
   - backlog 上限默认 3；
   - question/keyword 不再全局绕过每日配额；
   - 群管理移入 QQ 高级设置，强制覆盖选择即保存；
   - 修复 group key 正则和 group-policy POST 二次 JSON.parse。

3. **人格语气与智能拆分**
   - `persona.tone.md` 语气层；
   - 群聊 `qq_get_prompt` 默认 tone，私聊/必要 full；
   - 身份底座（我是谁/主人是谁）tone/full/日常都带；
   - 日常保存/拆分自动写身份副本；
   - 角色页一页四层、写法提示、拆分只出预览草稿；
   - 拆分失败自动 JSON-only 重试，错误带输出预览。

4. **工具面 / 上下文**
   - `qq_get_context_snapshot`：unread/recent/social/activeMembers，caps/refs/truncated；
   - `qq_get_prompt` 支持 mode + sections；
   - `socialV2.toolProfile`：full/balanced/compact，默认 balanced（snapshot 关闭回 full）；
   - prompt 里 partial/补历史改用 snapshot；
   - step guard 按 assistant step 计数；
   - `action-planner`：close 幂等；最近发送失败禁止 close。

5. **UI**
   - QQ/B站高级设置按功能分类；
   - 每个参数组改为按钮 + 弹窗，弹窗保存；
   - 顶部搜索，结果按 `分组 > 字段` 展示并打开对应弹窗；
   - 设置行悬浮说明；
   - 群管理/工具面/鱼群/收尾进高级设置。

6. **稳定性 / 用户可解释失败**
   - SnowLuma 未启动不再弹“断线”L2，只有连过再断才告警；
   - 会话映射审计：多个 QQ key 共用 sessionId 时全部删除并重建，写 `session-map-duplicate`；
   - 记忆卡 `act()` 修复 `item is not defined`，reload 提前，toast 不再阻断刷新；
   - 发送频率/鱼群/Token 发送上限给具体设置、当前值、上限、路径；
   - 概览「错误报告 / 限制提醒」L1，不弹窗；可去改设置/确认本限制/永久不再显示；
   - 同一限制 1 小时只提醒一次；永久静音写 `state/limit-mutes.json`。

**关键验证**：

```text
npm run test:audit -> 107/107
cd plugins/surfcore && npm test -> 0 失败
node scripts/release-manifest.mjs --verify-ref HEAD -> 问题 0 个
```

**重启矩阵**：

| 改动 | 重启 |
| --- | --- |
| bridge/group-policy/session/limit/close/step | QQ 桥接 |
| tool profile / snapshot 工具 / prompt sections / UI | DSH |
| 人格语气/身份/日常文件 | 下一条消息生效；DSH 重启刷新 UI |
| SnowLuma 告警 | 桥接 + DSH |

**数据/迁移**：

- 新增 `state/group-policy.json`（可删，回默认自动）；
- 新增 `state/limit-mutes.json`（可删，恢复限制提醒）；
- 新增 `persona.tone.md`（可空；旧角色回退场景/日常/核心）；
- 现有 `persona.daily.md` 保存/拆分时会补身份行；
- `state/sessions.json` 重复 sessionId 会被启动审计清理，相关上下文重建（警告用户）。

**风险/回滚**：

- 默认 `toolProfile=balanced` 会隐藏旧读工具；不支持时切回 full；
- 会话审计会删除重复映射，旧串台上下文无法保留；
- B站仍是一个角色一个会话（`bili-whale-<characterId>`），不是 bug；
- UI 区域按钮化只覆盖 QQ/B站高级设置；其他 tab 后续继续；
- 回滚代码：回退到 `a27a1e4` 之前；回滚单项见各 case。

**Case 文档**：

- `docs/cases/2026-10-31-group-tiers-tone.md`
- `docs/cases/2026-10-31-tool-snapshot-profile.md`
- `docs/cases/2026-10-31-ui-area-modal.md`
- `docs/cases/2026-10-31-session-merge.md`
- `docs/cases/2026-10-31-memory-card-act.md`
- `docs/cases/2026-10-31-limit-ux.md`
- `docs/cases/2026-10-31-snowluma-startup-warning.md`

**未验证/残余**：

- 新默认 balanced 未跑真实 30 分钟流量；需发布后观察读工具调用/交付率；
- Action Planner 仅 close 幂等 + 发送失败禁止 close，wait/mark_read 全状态机未完成；
- bootstrap 启动模型调用仍偏高；
- “永久不再显示”暂无恢复 UI，可删 `limit-mutes.json` 的 muted 项；
- 单条字数/条数上限尚未全部进 L1 错误报告。


### 已发布 v0.8.0 · 2026-10-31 16:25 · 群分层 + 人格语气 + 智能拆分
<!-- release-batch: start=2026-10-31T16:25+08:00 end=2026-10-31T16:45+08:00 commits=a27a1e4,0e3c613,146b0fd,7f25cc2,41b76d4,b0d22ea,65016e1,7037b6c,1560807,b8eb498,b81792f,aff6a18,ca45e8c -->

**覆盖提交**：`a27a1e4`, `0e3c613`, `146b0fd`, `7f25cc2`, `41b76d4`, `b0d22ea`, `65016e1`, `7037b6c`, `1560807`, `b8eb498`, `b81792f`, `aff6a18`, `ca45e8c`
**建议**：**0.7.27**

**实现**：
- 新增 `src/group-policy.js`：成员数/近10分钟活跃/手动覆盖 → 小群/大群；
- 小群保留积极唤醒；大群只保留 @/名字/拍一拍/私聊/管理员；
- 设置页 QQ → 群分层，显示人数/活跃/自动判定，可强制覆盖；
- 新增 `persona.tone.md` 语气层；群聊 `qq_get_prompt` 默认 tone，私聊/必要 full；
- 角色页写法提示 + 智能拆分草稿，用户编辑逐层保存；
- 下一批：快照工具/批量只读/brief-detail。

**验证**：`test-group-policy`、`test-persona-layers`、`test-persona-classify`、`plugins/surfcore npm test`、`npm run test:audit` 101/101。
**UI 修正**：群分层移到 QQ 页顶部并加 Token 警示；人格页一页四层、拆分预览草稿；身份底座常驻；场景含 B站等平台 + 隐私警告。
**交接**：同步 `src/{group-policy,wake-policy,persona-layers,character-persona,bridge}.js`、插件 client/index/persona-classify、测试、docs、manifest。重启 DSH + QQ 桥接。

---

### 批次 2026-10-31 15:55 · 收紧 strict direct
<!-- release-batch: start=2026-10-31T15:55+08:00 end=2026-10-31T16:15+08:00 commits=32ebe35 -->

**覆盖提交**：`32ebe35`
**建议**：**0.7.26**

**实现**：
- 只认真正的 `@昵称` 或引用自己；
- 裸昵称、owner、fish bypass 不再触发每日配额绕过；
- 第二轮样本 117 唤醒/13 发送/104 close-only 的漏口；
- 不改 close/模型/调度。

**验证**：`test-wake-policy`；`npm run test:audit` 99/99。
**交接**：重启 QQ 桥接后生效；用 `--since` 新窗口对比 question/close-only。

### 追加：工具快照（41b76d4）

- `qq_get_context_snapshot`、`toolProfile`、prompt sections、assistant step 计数、close 幂等；
- 默认 toolProfile=full，balanced 才隐藏旧读工具；
- 需要重启 DSH + 桥接。

---

### 批次 2026-10-31 13:55 · question 唤醒闸门
<!-- release-batch: start=2026-10-31T13:55+08:00 end=2026-10-31T14:15+08:00 commits=fca2e1a -->

**覆盖提交**：`fca2e1a`
**建议**：**0.7.26**（或与 A+B 一起发 0.7.25）

**实现**：
- 新增 `src/wake-policy.js`；
- hard direct 只认 @/名字/拍一拍/私聊/管理员；
- question 不再绕过 `maxWakesPerDay` / 2 分钟间隔；
- unread 严格 direct 只认 owner/引用自己/真实 @ 或昵称。

**数据**：一小时 138 唤醒、15 发送、116 close-only；两个群 129 唤醒。

**验证**：`test-wake-policy`；`npm run test:audit` 99/99。
**交接**：同步 `src/{wake-policy,bridge}.js`、报告 `--since/--until`、测试、docs、manifest。
重启 QQ 桥接后生效。

---

### 批次 2026-10-31 12:40 · A+B 账单 Markdown
<!-- release-batch: start=2026-10-31T12:40+08:00 end=2026-10-31T13:00+08:00 commits=534c5e3 -->

**覆盖提交**：`534c5e3`
**建议**：**0.7.25**（与 Phase 3/4 一起）

**实现**：
- 角色账单 `billing/characters/<id>/summary.md`；
- 群/私聊账单 `billing/conversations/*.md`；
- 索引 `billing/index.md`；
- 启动 30 秒后生成、每 10 分钟刷新；手动 `node scripts/billing-report.mjs`；
- 遥测补 `characterId`；群内个人不精确分摊；不含正文；不调用模型。

**验证**：`test-billing-report` / `test-billing-service`；`npm run test:audit` 98/98。

---

### 批次 2026-10-31 12:30 · Phase 4 交付延迟/成本验收（只读）
<!-- release-batch: start=2026-10-31T12:30+08:00 end=2026-10-31T12:50+08:00 commits=3b1892e -->

**覆盖提交**：`3b1892e`
**建议**：**0.7.25**（与 Phase 3 一起）

**实现**：
- 调用链报告新增 `deliveredLatency`（wake→首发送 P50/P90/avg）与 `avgCostDelivered`；
- 新增 `review.closeOnly` / `review.noSendByReason`；
- **不改 reasoningEffort、模型、统一调用上限**；
- 新增 [ARCHITECTURE-DELTA-TOKEN.md](ARCHITECTURE-DELTA-TOKEN.md)：新增模块/闸门/旋钮/排查/回滚。

**当前样本（约 106 wake）**：
- delivered=24, closed=102, close-only=77, errors=13；
- model calls/wake p50=2/p90=4/p99=5/max=15；
- cost/wake=¥0.0447, cost/delivered=¥0.1002；
- delivered latency p50=3386ms/p90=5272ms。

**未做**：模型/思考强度实验（缺成功率/漏回复指标）；close/keyword 改造。

**case**：[docs/cases/2026-10-31-phase4-acceptance.md](cases/2026-10-31-phase4-acceptance.md)
**验证**：`node scripts/test-context-call-chain.mjs`；`plugins/surfcore npm test`；`npm run test:audit` 96/96。

---


### 批次 2026-10-31 12:00 · Phase 3 backlog 补唤醒限量
<!-- release-batch: start=2026-10-31T12:00+08:00 end=2026-10-31T12:20+08:00 commits=80120a9 -->

**覆盖提交**：`80120a9`
**建议**：**0.7.25**（与 Phase 1A 一起）

**需求**：backlog 是 Phase 1A 最贵的唤醒类型（7 次 ¥0.933），启动时不要一次叫醒太多冷会话。

**实现**：
- 新增 `socialV2.wake.backlogMaxSessions`（1~20，默认 **3**），替换硬编码 5；
- 启动补唤醒只取未读最多的前 N 个，其余保留 unread 等自然唤醒；
- 设置页高级设置可调；不合并不同会话上下文、不删消息。

**未做**：keyword 退避、close-only 改造、前后 token 对照、Phase 4 推理强度。

**case**：[docs/cases/2026-10-31-backlog-cap.md](cases/2026-10-31-backlog-cap.md)
**进度**：[docs/TOKEN-OPTIMIZATION-PROGRESS.md](TOKEN-OPTIMIZATION-PROGRESS.md)
**验证**：`node scripts/test-backlog-cap.mjs`；`plugins/surfcore npm test`；
`npm run test:audit` 96/96。
**交接**：同步 `src/bridge.js`、`plugins/surfcore/lib/client.js`、测试、docs、manifest。
重启 QQ 桥接后生效。

---

### 批次 2026-10-31 11:30 · Phase 1A 调用链重建（只读）
<!-- release-batch: start=2026-10-31T11:30+08:00 end=2026-10-31T12:00+08:00 commits=787b48d,cc4805c -->

**覆盖提交**：`787b48d` + `cc4805c`（含前置遥测过滤 `a86aa9b`）
**建议**：**0.7.25**（若 Phase 0A 遥测已单独作为 0.7.24 发布；否则可合并为 0.7.24）

**需求**：先按 wakeId 重建真实调用链，不改 close/调用上限/调度。

**实现**：
- bridge 投递 wake 时生成 `wakeId`，QQ 会话事件带 `wakeId` 写入遥测；
- `scripts/context-call-chain-report.mjs`：bridge/plugin 去重，重建 wake→turn→tool 路径；
- 报告 delivered/closed/observedOnly/成本/每 wake 模型调用 P50/P90/P99；
- 不自动 close、不合并唤醒、不设统一调用上限。

**样本（48 wake）**：
- model calls/wake p50=2/p90=4/p99=11/max=15；
- delivered 17，closed 44；close-only 26 次/52 调用/¥0.699；
- backlog 7 次 ¥0.933；keyword 12 次 0 交付；question 15 次仅 4 交付、4 错误。

**未做**：close/wait/send 改造、backlog 合并、任务预算、调度、成功率指标。

**case**：[docs/cases/2026-10-31-call-chain.md](cases/2026-10-31-call-chain.md)
**验证**：`node scripts/test-context-call-chain.mjs`；`plugins/surfcore npm test`；
`npm run test:audit` 95/95。
**交接**：同步 `src/{bridge,context-telemetry}.js`、`scripts/context-call-chain-report.mjs`、
测试、docs、manifest。重启 QQ 桥接后新数据带 wakeId；旧数据按最近 wake 兜底。

---

### 批次 2026-10-31 10:20 · Phase 0A 上下文/成本遥测（只测量）
<!-- release-batch: start=2026-10-31T10:20+08:00 end=2026-10-31T10:40+08:00 commits=c7df162 -->

**覆盖提交**：`c7df162`
**建议**：**0.7.24**（若人格卡分层已作为 0.7.23 发布；否则可与它合并为 0.7.23）

**需求**：先建立真实 token/上下文账单，不改行为。

**实现**：
- `src/context-telemetry.js` 旁路 JSONL：wake / model usage / tool 结果字符数+耗时 / turn 起止；
- 插件 `session/event` 采所有会话；bridge 投递 wake 时记录 prompt 总字符与分段；
- `scripts/context-telemetry-report.mjs` 按唤醒原因/工具聚合基线，标 observed/estimated/覆盖缺口；
- 不记录消息正文/工具参数；写失败不影响主链路；不改 prompt、工具、guard、会话策略。

**未做**：Phase 1 工具契约/复合快照；系统提示/工具 schema/历史的精确拆分。

**case**：[docs/cases/2026-10-31-context-telemetry.md](cases/2026-10-31-context-telemetry.md)
**验证**：`node scripts/test-context-telemetry.mjs`；`plugins/surfcore npm test`；
`npm run test:audit` 94/94。
**交接**：同步 `src/{context-telemetry,bridge}.js`、`plugins/surfcore/lib/index.js`、
`scripts/context-telemetry-report.mjs`、测试、docs、manifest。
重启 DSH + QQ 桥接后开始采集；建议 3–7 天基线再进 Phase 1。

---

### 批次 2026-10-31 10:05 · 人格卡分层（0.7.22 后）
<!-- release-batch: start=2026-10-31T10:05+08:00 end=2026-10-31T10:35+08:00 commits=bf673a2 -->

**覆盖提交**：`bf673a2`
**建议**：patch → **0.7.23**

**需求**：人格卡拆成【人格核心】【人格日常】【场景人格】；QQ 分群聊/私聊；
B站/桌宠各用各的场景；全部手动编辑；角色页醒目说明本次改动。

**实现**：
- `persona.md` 继续是人格核心；新增可选 `persona.daily.md` 与
  `persona.scenes/{qq-group,qq-private,bili,pet}.md`；
- `src/persona-layers.js` 统一组合核心→场景→日常，超预算先裁日常/场景；
- QQ 按 `group:`/`private:` 选场景；B站/桌宠接同一套分层；
- `/persona` 三层读写、按层备份恢复；快照/回档带三层；
- 角色页三层手动编辑 + 顶部醒目说明；模型不自动改写；
- 记忆卡/向量记忆未动。

**未做**：日常/场景自动生成、任务型 ContextRecipe、记忆分层、缓存收益实测。

**case**：[docs/cases/2026-10-31-persona-layers.md](cases/2026-10-31-persona-layers.md)
**验证**：`node scripts/test-persona-layers.mjs`；
`plugins/surfcore/scripts/test-character-api.mjs`；`test-client-contract.mjs`；
`plugins/surfcore npm test`；`npm run test:audit` 93/93。
**交接**：同步 `src/{persona-layers,character-persona,bridge}.js`、
`plugins/surfcore/lib/{index,client,scheduler,pet-chat}.js`、测试、docs、manifest。
改动后 QQ 下一条消息 / B站下一次醒来 / 桌宠下一次对话生效；真实页面/注入还需手测。

---

### 已发布 v0.7.21 · 2026-10-31 08:10 · 一键启动 SurfCore / 一键停止（0.7.20 后）
<!-- release-batch: start=2026-10-31T08:10+08:00 end=2026-10-31T08:30+08:00 commits=282dc6c -->

**覆盖提交**：`282dc6c`
**建议**：patch → **0.7.21**

**需求**：一键启动整合成多选 QQ（含 SnowLuma）/ B站 / 桌宠 / 语音；语音本地/云端单选；
下面加一键停止；每项显示状态，切换页一致；失败可见且给建议。

**实现**：
- 概览「一键启动 SurfCore」多选 + 语音分支；「一键停止（全部）」；
- `start-selected` / `stop-selected`，每项 `ok/code/error/hint`；
- 停止顺序语音→QQ→B站→桌宠（语音由桥接托管，避免孤儿进程）；
- `overview.launch` 统一 `bridgeStatus / schedulerStatus / petService / /api/voice/packs`；
- QQ 停止不关闭 SnowLuma 本体；语音未装/桥接未起/平台开关关闭都有结构化错误。

**未做**：真实进程启停手测、语音页深链、SnowLuma 本体停止（设计边界）。

**case**：[docs/cases/2026-10-31-one-click-launch-stop.md](cases/2026-10-31-one-click-launch-stop.md)
**验证**：`node scripts/test-launch-components.mjs`；`plugins/surfcore npm test`
（test-client-contract / test-platform-start-host）；`npm run test:audit` 90/90。
**交接**：同步 `plugins/surfcore/lib/{index,client}.js`、`scripts/test-launch-components.mjs`、
`plugins/surfcore/scripts/{test-client-contract,test-platform-start-host}.mjs`、docs、manifest。
重启 DSH 后页面生效；真实启动/停止需手测。

---

### 已发布 v0.7.20 · 2026-10-30 23:40 · 语音包退出 zip 自动更新
<!-- release-batch: start=2026-10-30T23:40+08:00 end=2026-10-30T23:50+08:00 commits=44bae2d -->

**覆盖提交**：`44bae2d`
**建议**：与 SnowLuma 通道闸门一起发 **0.7.20**

**问题**：语音包没有 `package.json`，被登记为 `updates.components()` 的 `kind:auto`，
下载后按 SurfCore 的 `surfcore-* + package.json + install-manifest` 解析，必然
`verify.bad-archive`；补 `package.json` 也解决不了根目录/清单/config 保留。

**修法**：
- 语音包从自动更新列表移除；不再下载/尝试覆盖；
- 语音页明确“不参与检查更新，需要新版本时用重新导入离线包”，
  导入保留 config.toml / .venv / models / vendor；
- 不改公开语音仓库，不写语音包专用 updater。

**case**：[docs/cases/2026-10-30-voice-pack-no-auto-update.md](cases/2026-10-30-voice-pack-no-auto-update.md)
**验证**：`plugins/surfcore npm test`（test-updates-voice 新增断言）；`npm run test:audit` 89/89。
**交接**：同步 `plugins/surfcore/lib/index.js`、`plugins/surfcore/lib/client.js`、
`plugins/surfcore/scripts/test-updates-voice.mjs`、docs、manifest；重启 DSH 后更新列表不再出现语音包。

---

### 已发布 v0.7.20 · 2026-10-30 19:30 · SnowLuma 断线通道闸门
<!-- release-batch: start=2026-10-30T19:30+08:00 end=2026-10-30T19:50+08:00 commits=44481cc -->

**覆盖提交**：`44481cc`
**建议**：patch → **0.7.20**（0.7.19 已发布，不重复发）

**问题**：SnowLuma 未启动/掉线时，`proactiveCheck` 仍创建 DSH 会话、跑完整 LLM，
发送失败只写 bridge.log，每 40–90 分钟重复空烧。

**修法**：
- `sendWakePromptV2` 开头检查 `qqSendChannelStatus()`：WS 未连接/最近发送失败 →
  不创建 DSH 会话、不投 prompt、不跑模型；
- `sendToQQ` / `onebotSend` 记录成功/失败；连续 3 次失败 → 该会话自动唤醒暂停 30 分钟，
  `scheduleProactiveCheckV2` 不再排下一次；
- SnowLuma `close` 写 L2 `send-channel-down`，`open` 写 L1 恢复；首次发送失败 L1；
- UI SnowLuma 安装卡显示 `diagnosis.hint`；事件中心弹窗给“启动/重启 SnowLuma，
  确认 3000/3001”的建议；
- 新增 `test-snowluma-channel-gate`（断开/暂停不创建 DSH 会话，恢复后可创建）。

**未做**：首次 HTTP 失败预知、`wasted` 精确金额、端口/进程体检。

**case**：[docs/cases/2026-10-30-snowluma-channel-gate.md](cases/2026-10-30-snowluma-channel-gate.md)
**验证**：`node scripts/test-snowluma-channel-gate.mjs`；`npm run test:audit` 89/89；
`plugins/surfcore npm test`；`node scripts/test-audit-bridge.mjs`。
**交接**：同步 `src/bridge.js`、`src/gate-events.js`、`plugins/surfcore/lib/client.js`、
`scripts/test-snowluma-channel-gate.mjs`、`scripts/audit-bridge-harness.mjs`、manifest、docs。
重启 DSH/桥接后生效；真实停 SnowLuma 观察零 token 增长需手测。

---

### 批次 2026-10-30 17:20 · 闸门事件中心 + 单轮 L3 止血
<!-- release-batch: start=2026-10-30T17:20+08:00 end=2026-10-30T17:35+08:00 commits=3a82618 -->

**覆盖提交**：`3a82618`
**建议**：patch → **0.7.19** 或发布会话当前版本 +1

**新增**：
- `src/gate-events.js`：L0–L3 分级、脱敏、ack、2MB 轮转；
- `src/turn-guard.js` + bridge `guardTurnEvent`：单轮工具步数 40、同一 tool+error 3 次、
  回合内每日额度耗尽 → **cancel-only** 停止 + 直接 QQ 通知；
- `src/dsh-client.cancelTurn()`（不清 inbox）；
- 设置 → 概览「安全提醒」卡片，L2/L3 弹窗；插件 `/gate-events`；
- 兼容性体检 blocker/high 自动进事件中心。

**未做**：单轮费用上限（价格表覆盖不全）、pre-call 阻断、L0/L1 全量生产者接入、
端口/进程归属；报告/文档已标“未检查”。

**case**：[docs/cases/2026-10-30-gate-events-turn-guard.md](cases/2026-10-30-gate-events-turn-guard.md)
**验证**：`node scripts/test-gate-events.mjs`；`npm run test:audit` 88/88；
`plugins/surfcore npm test`；`node scripts/test-audit-bridge.mjs`。
**交接**：同步 `src/gate-events.js`、`src/turn-guard.js`、`src/bridge.js`、`src/dsh-client.js`、
`plugins/surfcore/lib/{index,client}.js`、`scripts/test-gate-events.mjs`、manifest、docs；
重启 DSH 后生效。真实 L2/L3 弹窗与 cancel 时延需手测。

---

### 批次 2026-10-30 16:10 · 插件冲突体检（只读）
<!-- release-batch: start=2026-10-30T16:10+08:00 end=2026-10-30T16:20+08:00 commits=6023a38,36da77c -->

**覆盖提交**：`6023a38`（功能）、`36da77c`（安装清单/接线断言，到本批 HEAD）
**建议**：patch → **0.7.19**（或发布会话当前版本号 +1）

**新增**：设置 → 概览「检查更新」旁「插件体检」。
只读扫描 profile bundles / `cordis.patch.yml` / 已安装包 / 已知第三方插件 / QQ 工具策略。

**能查**：
- 第三方工具是否会被 QQ guard 拒绝（如 `billion-context` 的 5 个上下文工具）；
- 第三方上下文插件是否接管压缩且 `compaction-basic auto=false`；
- 插件未声明工具清单 → `unknown`，报告显示覆盖范围/未检查项；
- 版本/已知规则/`surfcore.compat.json` 声明。

**不能查**：任意第三方工具枚举、最终 prompt、任意自定义状态路径、端口/进程归属、
运行时工具拒绝/重复回复/回合熔断（报告“未检查”）。

**case**：[docs/cases/2026-10-30-plugin-compat-check.md](cases/2026-10-30-plugin-compat-check.md)
**验证**：`node scripts/test-plugin-compat.mjs`；`npm run test:audit` 87/87；
`plugins/surfcore npm test` 全绿；真实 desktop profile 扫描只报 `dsh-whale-widget` 的 unknown info。
**交接**：同步 `plugins/surfcore/lib/compat*.js`、`qq-tool-restrict.mjs` 导出、`client.js`、`index.js`、
`scripts/test-plugin-compat.mjs`、`release/install-manifest.json`、docs。重启 DSH 后按钮生效。

---

### 批次 2026-10-29 23:30 · 管理员称呼投影修复（v0.7.3 后热修）
<!-- release-batch: start=2026-10-29T23:30+08:00 end=2026-10-29T23:40+08:00 commits=00cc8b2 -->

**覆盖提交**：`00cc8b2`
**背景**：`v0.7.3`（212c2b0）只修了浏览中文路径；v0.7.3 不含本修复。
**建议**：patch → **0.7.4**

**问题**：v0.7.2 用户把称呼设为「弥叭」，QQ 提示词仍生成 `称呼「管理员」`，
模型输出「弥叭管理员」。

**根因**：
1. `projectAdminSave` 的 outQq 只写 `ownerQQ`，没投影 `displayName/biliName/gentle`；
2. 桥接独立进程只读 QQ `config.json`，读不到 unified；
3. `adminDisplayName` 没名字时兜底返回 `'管理员'`，把身份词当称呼；
4. 桥接只在启动时读配置。

**修法**：完整 admin 投影写入 QQ config；`adminDisplayName` 空串兜底；提示词明确
「管理员是身份不是称呼」；`ensureAdminProjection()` 启动补投影，桥接在跑自动重启；
`adminFromSources` 回退 QQ 已有 admin，避免升级丢称呼。

**case**：[docs/cases/2026-10-29-admin-display-name-projection.md](cases/2026-10-29-admin-display-name-projection.md)

**验证**：`test-admin-identity`、`test-admin-prompt-wiring`；`npm run test:audit` 83/83；
本机 config 实测提示词含 `称呼「弥叭」`、不含 `称呼「管理员」`。

**发布交接**：同步 `src/admin-identity.js`、`plugins/surfcore/lib/index.js`、`scripts/test-admin-identity.mjs`、`docs/*`；
重启 DSH 后确认插件启动自动补投影/重启桥接，QQ 提示词变为 `称呼「弥叭」`。

---

### 批次 2026-10-29 22:40 · 原生「浏览…」中文路径乱码（v0.7.2 后热修）
<!-- release-batch: start=2026-10-29T22:40+08:00 end=2026-10-29T22:45+08:00 commits=e0fcaf7 -->

**覆盖提交**：`e0fcaf7`
**背景**：`v0.7.2`（5ca9122）之后发现；v0.7.2 不含此修复。
**建议**：patch → **0.7.3**（或按发布会话决定）

**问题**：用户在设置页「导入离线包」选中文目录（如 `D:\...\中文oice-local`），
弹窗报 `IMPORT_PATH_NOT_FOUND`，路径里出现 `�`/`◆`。实际目录存在。
**根因**：Windows PowerShell 5.1 重定向 stdout 用 GBK，Node 按 UTF-8 解码，中文路径损坏。
**修法**：PowerShell 把选中路径写进 UTF-8 临时文件，Node 读文件后删除；不再解析 stdout。
所有「浏览…」（导入/安装目录/SnowLuma）共用 `handleBrowse`，一处修复全部生效。

**case**：[docs/cases/2026-10-29-browse-chinese-path.md](cases/2026-10-29-browse-chinese-path.md)

**验证**：`node --check plugins/surfcore/lib/index.js`；PowerShell 中文路径写 UTF-8 临时文件、Node 读回一致；
真实选择框需重启 DSH 后手测。

**发布交接**：同步 `plugins/surfcore/lib/index.js`、`docs/*`；重启 DSH 后点一次「导入离线包」选中文目录验证。

---

### 批次 2026-10-29 17:00–18:15 · 语音包离线导入 + 参考音频下载修复 + local/cloud 候选包
<!-- release-batch: start=2026-10-29T17:00+08:00 end=2026-10-29T18:15+08:00 commits=a6dadac -->

**覆盖提交**：`a6dadac`（本批次全部代码/文档）
**覆盖到**：2026-10-29 18:15（+08:00）
**建议**：patch → **0.6.23**（与今天前两批同版）

**case**
- [docs/cases/2026-10-29-voice-pack-offline-import.md](cases/2026-10-29-voice-pack-offline-import.md)
- [docs/cases/2026-10-29-cloud-sample-download.md](cases/2026-10-29-cloud-sample-download.md)

**候选离线包（POC，未上传网盘）**
- `D:\surfcore-poc\release\voice-local-offline-v1.0.0-win-x64.zip`（4.7G，SHA256 `9e0a409dce55da45f3049b4a63e596dc4e0a59e517b61e1b44b2f7ef4e68347c`）
- `D:\surfcore-poc\release\voice-cloud-offline-v1.0.0-win-x64.zip`（249M，SHA256 `8ea837706aacf6867ed454f124f878550a696a1b4ba3da1af53e8e46a47ab7ae`）
- 含微调 age12、GPL 合规目录；无 `config.toml`/密钥；云端 speaker 已清空。

**交接块（复制这一整段给发布会话）**

```text
【发布交接 · 2026-10-29 第三批（17:00–18:15）· 建议并入 v0.6.23】
覆盖提交：a6dadac

一、改了什么
1) 语音包离线导入（local/cloud 共用）
   - 新增 src/voice-pack-import.js：类型/必需文件/manifest sha256/配置/pyvenv 校验；
     copyTree 支持进度/取消，默认只复制、不移动源目录。
   - src/voice-packs.js：inspectImport/startImport/cancelImport/deleteImportSource/
     deleteImportBackup；复制到 .import-*，旧包备份，rename 切换，失败恢复；
     在最终路径改写 pyvenv.cfg；Windows 扫描锁用 120×500ms 重试。
   - src/bridge.js：import-inspect/import/import-cancel/import-delete-source/
     import-delete-backup；ImportError 统一 {code,error,hint,missing,detail}。
   - plugins/surfcore/lib/client.js：导入按钮、确认框（类型/来源/目标/大小/版本/完整性）、
     进度/取消、错误弹窗、源/备份删除；删除旧“手动指定包目录”。
   - plugins/surfcore/lib/index.js：云端参考音频改为 fetch+Blob 下载；新增
     POST /voice/packs/sample-open（explorer /select），解决 target=_blank 没反应。
2) 文档
   - 两个 case、PITFALLS #83/#84/#85、CHANGELOG、HANDOFF、RELEASE 计数 81。

二、测了什么、结果
- npm run test:audit → 83/83
- npm run test:regressions → 全部通过
- plugins/surfcore npm test → 全绿
- node scripts/test-voice-pack-import.mjs → 9/9
- 真实 7.9G 导入：D:/surfcore-poc/stage/voice-local → import-real-packs/voice-local，
  目标 7.6G，源目录保留，pyvenv 指向最终 runtime；.venv/.venv-gsv import 通过。
- 桥接 /api/voice/packs/sample?id=voice-cloud 实测 200 + 922,604B WAV。

三、层级与兼容
- 实现层：导入事务/复制/环境改写；桥接新增只读检查+写操作；插件 UI。
- 接口：新增 import-* 路由；既有接口不变；结构化错误只在 import 链路启用。
- 表现层：设置页导入入口；旧手动指定入口移除。
- 包：候选 zip 仍是 POC 目录，未上传网盘；导入功能在 SurfCore 侧，不要求重打 zip。

四、失败路径
- 类型不符/结构缺失/manifest 哈希不符/目标运行/磁盘不足：导入前拒绝，目标/旧包不动。
- 复制/切换/pyvenv 改写失败：清临时目录、恢复旧包；恢复失败保留 backup 并报
  IMPORT_ROLLBACK_FAILED。
- 取消：只清临时目录；源目录/旧包不动；清理失败报残留路径。
- 无 manifest：先拒绝，用户确认后 allowUnverified 才继续，成功标记 verified:false。

五、没验证
- 设置页实际点击导入/确认框/错误弹窗/删除源/删除备份（需重启 DSH 后手测）。
- DSH 重启后桥接新路由是否生效。
- 真实 7.9G 的取消/旧包恢复现场；UI 的 sample-open（explorer）也未手点。
- 许可：piper GPL、huayan 数据集、age12 微调权重仍待确认；候选包不能直接公开上传。

六、发布时请
- 同步 public 镜像：src/voice-pack-import.js、src/voice-pack-secrets.js、src/voice-packs.js、
  src/bridge.js、scripts/test-voice-pack-import.mjs、scripts/test-audit.mjs、
  plugins/surfcore/lib/{index.js,client.js}、docs/*
- CHANGELOG [Unreleased] 折进 0.6.23
- 重启 DSH 后手测：设置页导入本地/云端包、错误弹窗、参考音频下载/打开目录
- 许可未确认前不要把候选 zip 传到公开网盘
```

**状态**：待发布

### 批次 2026-10-29 13:45–14:30 · 提问回答身份来源 + 主人特权审计 + 权限清单（与上一批同版）
<!-- release-batch: start=2026-10-29T13:45+08:00 end=2026-10-29T14:30+08:00 commits=d976dc0 -->

**覆盖提交**：`d976dc0`（本批次全部改动）
**覆盖到**：2026-10-29 14:30（+08:00）
**建议**：patch → **0.6.23**（与上一批一起发）

**case 文档**
- [docs/cases/2026-10-29-owner-question-audit.md](cases/2026-10-29-owner-question-audit.md)

**交接块（复制这一整段给发布会话）**

```text
【发布交接 · 2026-10-29 第二批（13:45–14:30）· 建议并入 v0.6.23】
覆盖提交：d976dc0

一、改了什么
1) 提问回答带程序身份来源
   - 新增 src/question-answers.js：[仅主人] 判定、谁能消费 pending、按题型编码来源
   - src/bridge.js：registerPending 记 ownerOnly；消费点非主人不消费 owner-only 提问（不吞消息）；
     handlePendingAnswer 按真实 sender 填来源
   - DSH 单选不允许 selected+custom 并存 → 单选 custom("选项文字"+来源) selected=[]；
     多选 selected + custom(来源)
2) 主人特权操作审计
   - 新增 src/owner-audit.js：state/owner-audit.jsonl，1MB×5、90 天清理、跨文件读尾、失败 health
   - src/bridge.js：7 类事件（审批/提问回答/角色切换/封闭模式拒绝/语音/鱼群 bypass/记忆告警）
   - GET /api/owner-audit（console token；agent token 显式 403）；/api/status 暴露 health
3) 插件与 preset
   - lib/index.js：/owner-audit 代理 + /owner-audit/open（固定 state/，无用户输入）
   - lib/client.js：管理员卡「管理操作记录（最近 50 条）」弹窗（操作者打码）
   - dsh/agent-presets/qq-chat-v2/agent.cordis.yml 第 17 条提问分类规则；已重建 preset patch
4) 文档
   - 新增 docs/guides/PERMISSIONS.md；case 2026-10-29-owner-question-audit.md；
     PITFALLS #82、HANDOFF、CHANGELOG、docs/README 索引、RELEASE 计数 80

二、测了什么、结果
- npm run test:audit → 80/80
- npm run test:regressions → 全部通过
- cd plugins/surfcore && npm test → exit 0
- node scripts/test-question-answers.mjs / test-owner-audit.mjs → 通过（含失败分支）

三、层级与兼容
- 实现层：提问编码/消费、审计写入、桥接接线
- 接口：新增只读 GET /api/owner-audit（console token；agent 403），既有接口无破坏；DSH answers 形状按官方约束
- 表现层：设置页弹窗；preset 文本新增一条分类规则

四、失败路径
- 单选 selected 必须为空（否则 DSH bad-response）；owner-only + 非主人不消费 pending；
  审计写入/轮转/清理失败 → health + 限频日志，不静默、不阻塞、不截断；
  审计读取 agent token 一律 403。

五、没验证
- 真实 DSH 问答往返（单选题 custom-only 的模型可见文本）
- 设置页弹窗手点 / 打开文件夹
- preset 安装到 DSH profile + 重启 DSH 后的实际生效提示词
- PERMISSIONS.md 里 5 项「待补程序断言」

六、发布时请
- 同步 public 镜像：src/question-answers.js、src/owner-audit.js、src/bridge.js、
  scripts/{test-audit.mjs,test-question-answers.mjs,test-owner-audit.mjs,audit-bridge-harness.mjs}、
  plugins/surfcore/lib/{index.js,client.js}、plugins/surfcore/presets/qq-chat-v2.patch.yml、
  dsh/agent-presets/qq-chat-v2/agent.cordis.yml、docs/*
- 重启 DSH 后验证 preset 生效与完整问答链路（owner/非主人 × 单选/多选各一次）
- CHANGELOG 的 [Unreleased] 折进 0.6.23
```

**状态**：待发布

### 批次 2026-10-29 11:55–12:35 · SnowLuma 检测 + 失败弹窗 + 云端凭据 + 报错/记录规则
<!-- release-batch: start=2026-10-29T11:55+08:00 end=2026-10-29T12:35+08:00 commits=e07c7e3,161ec97,aa3f7cc,8ef7510,3c4bc5a -->

**覆盖提交**：`e07c7e3`（云端凭据）、`161ec97`（SnowLuma 检测）、`aa3f7cc`（记录规则）、
`8ef7510`（失败弹窗）、`3c4bc5a`（报错规范）、以及本文档所在的提交（队列机制）。
**覆盖到**：2026-10-29 12:35（+08:00）—— 本批次最后一次提交。
**建议**：patch → **0.6.23**

**case 文档**
- [docs/cases/2026-10-29-voice-cloud-credentials.md](cases/2026-10-29-voice-cloud-credentials.md)
- [docs/cases/2026-10-29-snowluma-detect-manual-path.md](cases/2026-10-29-snowluma-detect-manual-path.md)

**交接块（复制这一整段给发布会话）**

```text
【发布交接 · 2026-10-29 批次 · 建议 v0.6.23（patch）】

一、改了什么
1) 云端语音包凭据边界（e07c7e3）
   - src/voice-packs.js：stripCloudCredentials / ensurePackConfig；新装清空 cloud_app_id/cloud_access_key，
     重装保留用户填的；start() 未配置拒绝启动；list() 暴露 needsCloudConfig
   - plugins/surfcore/lib/client.js、public/console.html：装后引导、通用 placeholder、待填提示
   - 回归 scripts/test-voice-cloud-credentials.mjs（26 断言 + 4 rejections，已进 test:audit）
2) SnowLuma 检测（161ec97）
   - 新增 plugins/surfcore/lib/snowluma-install.js（归一 / 候选 / tried）
   - plugins/surfcore/lib/index.js：detect-snowluma 可选 path；显式路径只校验它、不回退猜测
   - plugins/surfcore/lib/client.js：概览 SnowLuma 卡「浏览…」
   - 回归 plugins/surfcore/scripts/test-snowluma-install.mjs（已进 npm test）
3) 失败弹窗 + 结构化错误（8ef7510）
   - snowLumaMissingReport（code/title/error/hint/tried）；前端 ErrorModal；网络异常也弹窗
   - 同一测试文件扩到 30 项（其中 8 项专测失败报告）
4) 规则与流程（aa3f7cc / 3c4bc5a / 本文档）
   - AGENTS 1.6（讲透逻辑+记录+交接块）、1.7（失败必须可见可行动）
   - docs/guides/ERROR-REPORTING.md、docs/RELEASE.md 交接格式、docs/cases/_TEMPLATE.md、docs/RELEASE-QUEUE.md

二、测了什么、结果
- npm run test:audit → 78/78
- cd plugins/surfcore && npm test → exit 0
- node scripts/test-voice-cloud-credentials.mjs → 通过（26+4）；临时目录读取加 EBUSY/ENOENT 重试
  （Windows Defender/索引器会短暂占住刚写的 config.toml，之前的 77/78 假红是环境抖动，不是产品失败）
- node plugins/surfcore/scripts/test-snowluma-install.mjs → 30 项通过

三、改动层级与兼容
- 云端凭据：实现层（安装清洗 / 启动闸），无接口语义变化
- SnowLuma：实现层 + 接口只加可选 path、失败响应加 code/title/hint/tried（向后兼容）+ UI
- config.json 无新增必填字段；snowluma.launcherPath 语义不变

四、失败路径
- 云端包未配置：start 被拒并提示填三项；检测失败：ErrorModal（试过位置可展开 + 浏览/下载两个按钮）
- 失败分支均有断言

五、没验证
- 真机从 GitHub 公开包全新安装语音（会真下依赖）
- 真机点「浏览…」原生框 / 看失败弹窗（需要桌面会话）
- 公开镜像 surfvoicecloud / surfvoicelocal 的 config.example.toml 里的真实 AppID 未改（编辑器不碰公开仓库）

六、发布时请
- 同步 public 镜像：plugins/surfcore/lib/{client.js,index.js,snowluma-install.js}、
  plugins/surfcore/scripts/test-snowluma-install.mjs、plugins/surfcore/package.json（测试链）
- 把公开镜像两个 config.example.toml 的 cloud_app_id 换成占位符
- CHANGELOG 的 [Unreleased] 折进 0.6.23
```

**状态**：待发布

---

## 已发布

（空）
