# 会话滚动：聊太久自动换新会话（+ 合并窗口分场景）

日期：2026-11-04
分支：`feat/opt-context-cost`（基线 `origin/dev @ 404649d`）
任务来源：用户 B 组决策（第 2、3、11 条）

## 1. 现象

一条 QQ 会话只开一条 DSH 会话，永不更换。模型接口无状态，**每一轮都要把整段历史重发一遍**，
再乘上"一次唤醒平均 5.2 步工具往返"。

第三方实测（2026-10-30 报告）：

- 同一条会话 19.5 小时后，单步输入从 **6.9 万 → 43.5 万 token**，常见 25~33 万；
- 每步还要重付工具定义（63 工具 ≈ 2.2 万 token）；
- 用户侧观感：越聊越贵，且"记得住"没有明显变好（记忆卡本来就每轮都注入）。

另外，唤醒合并窗口原来一律 **8 秒**：被 @ 也要干等 8 秒，体感是"明明在线却装死"。

## 2. 根因

| 问题 | 机制 |
| --- | --- |
| 越聊越贵 | 会话 = 聊天记录；每轮重发全部历史。历史只增不减，成本随轮数线性涨 |
| 没有换会话的出口 | `retireSession()` 只在"权限/模式变化"时调用，**没有任何按体量的阈值触发** |
| 换了会失忆 | 记忆卡每轮注入，事实不会丢；但对话流会断，所以必须留一段交接 |
| 被点名也慢 | `batchWindowMs` 是单值，@/私聊/群聊共用 8 秒 |

## 3. 修法

### 3.1 会话滚动（新模块 `src/session-rollover.js`）

纯逻辑：`normalizeRolloverConfig` / `shouldRollSession` / `buildHandoffBlock` / `handoffIsUseful`。

- 阈值两个维度取"或"：`rolloverContextTokens`（2026-11-07 起默认 500000，指**当前上下文**，不是累计账单）、`rolloverTurns`（默认 0 = 不按轮数）；
- `rolloverMinTurns`（默认 2）：刚建的会话不滚，避免"和空气交接"；
- 交接块用**规则拼**（最近几句 + 上次收尾摘要），不额外花一次模型调用；
- 交接块明确写"不要提换过会话、不用重新自我介绍"，并跳过她自己说过的话（`isSelf`）。

### 3.2 接线（`src/bridge.js`）

- `ensureSession()` 建新会话时记 `sessionStartedAt / sessionTurns / sessionBaseTokens`；
- `maybeRollSessionV2(key)` 在 **`buildWakePromptV2` 之前**调用 —— 这是唯一省钱的时机：
  一旦开始发，这一轮的全量上下文就已经计费了；
- 触发后：`handoffPending` 落盘 → `retireSession(key)` → 本次唤醒走新会话；
- `consumeHandoffV2(key)` 把交接块贴在唤醒包最前面，**只注入一次**；
- 账本新增 O(1) 查询 `tokenLedger.sessionTotal(sessionId)`（加 `samplesBySession` 索引；
  live 摄入与磁盘载入两条路都维护它）。

### 3.3 合并窗口分场景（新模块 `src/wake-batch.js`）

| 场景 | 窗口 |
| --- | --- |
| @ / 叫名字 / 拍一拍 | 3 秒 |
| 私聊 | 4 秒 |
| 群聊普通触发 | 6 秒 |

顺序：先判"是不是被点名"，再判私聊，最后群聊。私聊的 reason 恒为 `private`，
所以不会被误判成 direct（否则私聊也会变 3 秒）。三个值都能在设置页改。

### 3.4 配置与 UI

- 默认值：`src/bridge.js` 的 `DEFAULT` 与 `config.example.json` 同步；
- 保存校验：`context.rollover*` 收敛到安全区间，`wake.batchWindowPrivateMs/DirectMs` 进白名单；
- 设置页新增 9 项：3 个窗口 + 会话滚动开关/阈值/次数/交接/条数/字数。

## 4. 风险

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 交接质量 | 规则拼的摘要不如模型写的 | 只补"刚才聊到哪"，事实靠记忆卡；交接块有字数上限 |
| 频繁换会话 | 阈值调太小会导致每次唤醒都换 | `rolloverMinTurns` 兜底；不配 `rolloverTurns` 时只看 token |
| 换会话时并发唤醒 | 同一 tick 两个唤醒都触发退役 | `st.rolling` 防重入 |
| 缓存重建 | 换会话后前缀缓存全冷 | 换会话本来就是"付一次冷启动换长期便宜"，50 万当前上下文足够摊薄 |
| 私聊窗口变短 | 4 秒可能让连发消息被拆成两轮 | 3 个值都可配；被拆时多花一轮，比干等 8 秒体感好 |

## 5. 验证

```powershell
node scripts/test-session-rollover.mjs   # 54 项：阈值/交接/窗口/账本/接线钉子
node scripts/test-audit.mjs              # 144/144
cd plugins/surfcore; npm test            # 0 失败
```

实测断言（节选）：

- 79,000 token 不换、80,000 换；第 1 轮不换；关掉后永不换；
- 交接块包含最近对话与收尾摘要、跳过 `isSelf`、超字数截断且保留"刚才收在"；
- 群聊 6s / 私聊 4s / @ 3s；老配置只写 `batchWindowMs` 时其余用新默认；
- 账本：一次采样后 `sessionTotal('s1') > 0`，且 `s2` 仍为 0（按会话隔离）；
- 接线钉子：`maybeRollSessionV2` 必须在 `buildWakePromptV2` 之前、旧的写死 8000 已清除。

## 6. 回滚

- 软回滚：设置页关「会话太长自动换新会话」（`socialV2.context.rolloverEnabled=false`），
  或把 `rolloverContextTokens` 调到 0 且 `rolloverTurns` 调到 0；
- 合并窗口回退：把三个值都改回 8000（等价旧行为）；
- 硬回滚：删 `src/session-rollover.js` / `src/wake-batch.js`，还原 bridge 的调用点与
  `token-ledger` 的 `sessionTotal`；状态字段（`handoffPending` 等）可直接清。

## 7. 没做 / 待验证

- **没做**：手动"换个新会话"按钮（QQ → 会话页）—— 需要新页面，排在下一批；
- **没做**：按会话/按群的花费表 —— 账本已经有 `conversation()`，缺的是 UI；
- **待真机验证**：换会话瞬间正在进行的回合（本轮不换，下一枪换）；
- **待真机验证**：DSH 对"新建会话 + 首条带交接"的处理是否稳（夹具已覆盖，真机未跑）。

## 8. 第二批：花费与会话页（同分支追加）

用户 2026-11-04 追加要求："会话页 + 花费表同一个页面出两件事"。

### 8.1 账本补全（`src/token-ledger.js`）

- 每个会话视图加 `channel`：`qq-group` / `qq-private` / **`qzone`（预留）** / `bili` / `other`；
  qzone 现在没有写入方，先把口径定死，以后接说说不用改结构；
- 加 `todayBuckets` / `todayTokens` / `todayCost`：按逐轮明细的 `endedAt >= since` 累加；
- `summary({ since })`：总量里加 `todayTokens` / `todayCost` / `byChannel`；
  有 `since` 时**按今日花费排序**（会话页要回答"今天谁在烧钱"）；
- 老会话只有累计基线、没有逐轮明细的部分**不计入今日**（它本来就不是今天的量）。

### 8.2 接口

- 桥接 `/api/tokens/summary?since=<ms>`：不传 `since` 默认取本地零点；传 0 看累计；
- 插件 `/bridge` 新增三个 action：
  - `token-summary` → 转发 `/api/tokens/summary`（可带 since）；
  - `session-list` → `/api/sessions`（现成的）；
  - `session-reset` → `/api/session/reset`（**现成的**，插件本来就在删会话时用它）。

### 8.3 界面（QQ 页 · 花费与会话）

一张卡片，放在「模型设置」下面：

- 头行：`今日 ¥X · Y token · N 条会话在册`，右侧「刷新」「怎么省 token」；
- 表：会话 | 今日 token | 今日 ¥ | 占比 | 「换个新会话」；
- 换会话前二次确认，成功后自动刷新；失败展示 `error + hint`（不是只写日志）；
- 「怎么省 token」展开一张表：设置项 / 怎么影响花费 / 在哪一页，共 8 条。

### 8.4 验证（第二批）

```text
node scripts/test-session-rollover.mjs   # 63 项（新增 9 项：渠道 + 今日 + 跨会话合计）
node scripts/test-audit.mjs              # 143/144
cd plugins/surfcore; npm test            # 0 失败
```

唯一失败是 `test-release-manifest`：功能分支新增了文件，官方清单对不上 HEAD ——
这是**预期**（11-02 工作流文档 §7.1 已记录同一现象），清单由协调会话在合并后重生成。

## 9. 第三批：回合形态 / 峰时 / 等待 / 复合工具（同分支追加）

### 9.1 回合形态 `socialV2.engine.mode`

| 模式 | 行为 |
| --- | --- |
| `human`（默认） | 常驻 agent、有工具、有主动性 —— 现状 |
| `machine` | 换 preset 到 `qq-chat`（文本由桥接自动转发、模型被禁止调发送工具）+ **每条唤醒一条干净会话** + 后台任务全停（目的/B站动态/主动检查/社区循环） |

不是两套代码：`modePreset()` 里多一个分支，`maybeRollSessionV2()` 里把阈值压成"1 轮"，闸门函数统一管后台任务。
机器模式下 `retireSession` 每轮都跑，等于 AstrBot 的"答完就散"。

### 9.2 峰时顺延 `socialV2.cost.peakOffload`（默认开）

`peakOffloadActive()` 用价格表里已有的峰时窗口（9–12、14–18，×2）判断；
`backgroundTasksAllowed()` 统一给 purposeTick / socialLoopTick / checkProactiveAt /
scheduleProactiveCheckV2 / B站动态同步 加闸。机器模式下后台任务同样停。

### 9.3 等待方式 `socialV2.wait.mode`

- `model`（默认）：现状，模型自己在回合里调 `qq_wait_for_messages`；
- `bridge`：唤醒提示最前面加一条硬说明"不要调 wait，说完直接结束回合，新消息由桥接再叫醒"。

### 9.4 复合工具（省钱第二杠杆）

`src/mcp-snowluma-safe.js` 新增两个工具：

- **`qq_read`**：等价 `qq_get_context_snapshot` 的常用形态，一次拿全未读+最近+社交+活跃成员；
- **`qq_reply_and_finish`**：发消息 + 收尾一次做完（少一步 = 少付一遍上下文）。

工具描述里写明"优先用它，不要连调 unread+recent+social+activeMembers"。
在 `mcp__snowluma__` 前缀白名单内，`qq-tool-restrict` 放行。

### 9.5 工具面变更 → 退役会话

工具定义是缓存前缀的一部分。改 `socialV2.tools.*` 后桥接会**退役全部会话**：
下次唤醒按新工具面新建（DSH 的 MCP 工具表在启动时就固化，旧会话拿不到新表）。

### 9.6 验证（第三批）

```text
node scripts/test-session-rollover.mjs   # 78 项（新增 15 项：形态/峰时/等待/接线/示例配置/UI）
node scripts/test-audit.mjs              # 143/144（仍只有 test-release-manifest，预期）
cd plugins/surfcore; npm test            # 0 失败
```

### 9.7 风险与未验证

- **机器模式未真机跑过**：`qq-chat` preset 必须已安装（`setup-dsh.mjs` 负责）；装不上时会 fail-fast 报错，不会静默退化。
- 机器模式每轮新建会话 → DSH 里会话数量增长快（归档仍在），长期需要清理策略。
- 峰时顺延只是"不跑后台"，用户主动说话不受影响；但若整天在峰时，主动搭话会被压到谷时集中。
- 复合工具与原有工具**并存**：模型仍可能选老路径（少一步的收益取决于它用不用），提示词还没强制切换。

## 10. 第四批：本地判断（免费漏斗）+ 账本外部渠道

### 10.1 本地判断 `src/wake-filter.js`

在 `scheduleWakeV2` **之前**再筛一遍，被拦下的消息留在未读、不花一分钱。

| 规则 | 拦什么 |
| --- | --- |
| `junk` | 纯表情/纯「6」「草」「233」/纯标点/叠字（≤12 字） |
| `recentReplyMs` | N 毫秒内刚在这个会话说过话 → 普通触发先不插话 |
| `rateWindowMs` + `rateMax` | 窗口内已醒够次数 → 普通触发不再醒 |

三条纪律：

1. **默认关闭**（`localFilterEnabled=false`）；
2. **默认 dry-run**（`localFilterDryRun=true`）：只统计不拦，用户在花费页看到"会拦掉多少"再决定；
3. **硬触发永不拦**：@ / 叫名字 / 拍一拍 / 私聊 / 管理员（`direct` 或 `private` 直接放行）。

统计落在 `st.localFilterStats`，`GET /api/socialV2/local-filter` 汇总给设置页，
花费页头行显示「本地判断（dry-run）累计会拦 N 条」。

### 10.2 账本外部渠道

桌宠、代办、独立脚本这些**不走桥接会话**的花费，之前完全在账外。现在：

- `tokenLedger.ingestExternal({channel,tokens,cost,note})`，写进同一个 `token-usage.jsonl`（`k:"ext"`）；
- `summary().totals.external` 单独一栏 + `byChannel` 拆分；
- `POST /api/tokens/external` 给调用方上报；花费页头行显示「外部渠道 ¥X」。

注意：这是**记账通道**，不是采集器——上游（桌宠/代办）不调它就没有数。

### 10.3 并行工具调用：查证结果

- DSH 的 OpenAI **Responses** 通道显式发 `parallel_tool_calls: true`（asar 里可见）；
- DeepSeek 走 chat/completions，是否并行由模型决定，请求侧没有该字段；
- 桥接的事件模型按 `(turn, step)` 归并、按 callId 记账（`pendingSendToolCalls`、账本 `sampleKeyOf`），
  所以**一次 step 里多个 tool call 不会漏记**。

结论：**我们这边不需要改代码**接并行调用；能不能并行取决于模型。想确认实际行为，需要在真机抓一次请求。

### 10.4 验证（第四批）

```text
node scripts/test-session-rollover.mjs   # 113 项（新增 35 项：漏斗规则/接线/配置/外部账本/持久化）
node scripts/test-audit.mjs              # 143/144（仍只有 test-release-manifest，预期）
cd plugins/surfcore; npm test            # 0 失败
```

### 10.5 风险

- 默认关 + dry-run，误伤概率低；一旦开真拦，"垃圾消息"是规则不是语义，可能拦掉"就一个字但有梗"的消息。
- 外部渠道靠调用方自觉上报，**不报就没有**；别把它当"已经补全了"。
- `recentReplyMs` / `rate` 两档只在用户配了正数时生效，默认 0 = 不看。


