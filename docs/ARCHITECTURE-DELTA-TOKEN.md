# Token 优化后的架构差异（2026-10-31）

> 目的：以后出问题，先看“哪道闸门 / 哪个文件 / 谁决定”，再改。
> 本文只记录本次实际落地的差异；设计过但没实现的，单列在最后。

---

## 一、一张图看差异

### 改动前

```text
SnowLuma
  ↕
src/bridge.js
  ├─ 唤醒：触发词/限频/额度/鱼群
  ├─ 人格：整张 persona.md
  ├─ 启动补历史：硬编码最多 5 个会话
  └─ token 账本：只有按会话/回合汇总
        ↕
DSH agent loop
  ├─ 每步发送派生历史 + 工具 schema
  ├─ MCP qq_* 工具
  └─ 没有逐唤醒/逐工具账单
```

### 改动后

```text
SnowLuma
  ↕
src/bridge.js
  ├─ 唤醒：原有触发词/限频/额度/鱼群（未改）
  ├─ 人格：核心 persona.md + 场景 + 日常（新增）
  ├─ 启动补历史：backlogMaxSessions，默认 3（新增）
  ├─ 遥测：
  │    ├─ wakeId + reason + prompt 分段 + 未读元数据
  │    └─ QQ 会话事件带 wakeId
  └─ token 账本：原有（未改）
        ↕
DSH agent loop
  ├─ 每步仍是派生历史 + 工具 schema（DSH 行为，未改）
  ├─ MCP qq_* 工具（未改）
  └─ 新增旁路：插件 session/event → context-telemetry
        ↓
报告
  ├─ context-telemetry-report（唤醒/模型/工具/上下文）
  └─ context-call-chain-report（wake→turn→tool 路径）
```

## 一.5 验收指标（Phase 4）

调用链报告新增：

- `deliveredLatency`：wake 到第一次发送的 P50/P90/avg；
- `avgCostDelivered`：有发送的唤醒平均成本；
- `review.closeOnly` / `review.noSendByReason`：无发送路径诊断。

当前样本（约 106 wake）：

```text
delivered=24 closed=102 close-only=77 errors=13
model calls/wake p50=2 p90=4 p99=5 max=15
cost/wake=¥0.0447 cost/delivered=¥0.1002
delivered latency p50=3386ms p90=5272ms avg=6911ms
```

**没有改 reasoningEffort / 模型 / 统一调用上限。**

---

## 二、新增的模块与文件

| 文件 | 作用 | 是否影响模型行为 |
| --- | --- | --- |
| `src/persona-layers.js` | 核心/场景/日常人格组合、预算裁剪 | 只改变注入内容，不自动写 |
| `src/context-telemetry.js` | 旁路 JSONL 遥测 | 不 |
| `scripts/context-telemetry-report.mjs` | token/工具/上下文基线报告 | 不 |
| `scripts/context-call-chain-report.mjs` | wake→turn→tool 路径、交付/成本/延迟 | 不 |
| `plugins/surfcore/lib/token-budget.js` | 增加 `isTrackedSession()` 供遥测过滤 | 不 |
| `plugins/surfcore/lib/index.js` | 插件 session/event → 遥测 | 不 |
| `src/bridge.js` | wakeId、prompt 元数据、backlog 上限、桥接侧遥测 | **仅 backlog 上限改行为** |
| `src/character-persona.js` | 人格层路径、读写、快照/回档 | 只影响人格注入 |
| `plugins/surfcore/lib/index.js` `/persona` | 三层读写/按层备份 | 只影响人格编辑 |
| `plugins/surfcore/lib/client.js` | 角色页三层编辑 + 醒目说明 | UI |

---

## 三、新增的“闸门”

### 1. 人格层预算闸门（输入内容，不是唤醒）

位置：`src/persona-layers.js` + 三个注入点。

```text
人格核心（永远）
  → 场景人格（按平台/群聊私聊）
  → 人格日常（最后）
```

- 超总预算：先砍日常，再砍场景，核心优先；
- 只有核心时不加标题，旧角色字节不变；
- **谁决定内容：用户手动编辑**；
- **谁决定选哪层：代码**（QQ group/private、B站、桌宠）；
- **模型不能自动改写**。

### 2. backlog 补历史闸门

位置：`src/bridge.js` `wakeBacklogConversations`。

- 新增 `socialV2.wake.backlogMaxSessions`；
- 默认 **3**（原来硬编码 5），范围 1~20；
- 按未读条数降序取前 N 个；
- 其余保留 unread，等自然唤醒；
- **谁决定：代码；用户可改配置**。

### 3. 观测点（不是闸门）

- 唤醒：`wakeId / reason / promptChars / layers / unreadCount / historyCount`；
- 模型：usage 四桶；
- 工具：名称、结果字符数、耗时、错误；
- 回合：turn start/end、模型调用数、工具数；
- **只记录，不阻断**。

### 4. question direct 闸门

位置：`src/wake-policy.js` + `src/bridge.js`。

- 只有 `atMention/nameMention/poke/private/admin` 可以绕过每日唤醒配额；
- `question` 仍能唤醒，但受 `maxWakesPerDay` 与最小间隔；
- unread 的严格 direct 只认 owner/引用自己/真实 @ 或昵称。

### 5. 没有新增的闸门

- 没有自动 close；
- 没有 keyword 退避；
- 没有统一调用上限；
- 没有模型/思考强度切换；
- 没有 per-step 上下文裁剪。

---

## 四、控制台 / 配置旋钮

| 旋钮 | 默认 | 作用 | 改动后谁读 |
| --- | --- | --- | --- |
| `role.maxInjectChars` | 6000 | 人格总预算 | bridge/B站/桌宠 |
| `persona.md` | 角色核心 | 身份/底线/风格 | 三端注入 |
| `persona.daily.md` | 空 | 近期状态 | 三端注入 |
| `persona.scenes/*.md` | 空 | 平台场景 | 按平台/会话选 |
| `socialV2.wake.backlogMaxSessions` | 3 | 启动补历史最多几个会话 | bridge |
| `socialV2.wake.noActionLimit` | 3 | 连续无行动重置唤醒（原有） | bridge |
| `socialV2.wake.maxWakePerMinute/Hour` | 1/12 | 唤醒限频（原有） | bridge |
| `socialV2.tokenGuard.maxDailyCostCNY` | 8 | 每日花费闸门（原有） | bridge |
| `socialV2.tokenGuard.maxWakesPerDay` | 20 | 单会话每日唤醒（原有） | bridge |
| `dsh.reasoningEffort` | max | 思考强度（**未改**） | DSH 会话 |

> 人格内容不是“配置旋钮”，是用户手动编辑的文件。

---

## 五、数据文件在哪

| 文件 | 内容 | 谁写 |
| --- | --- | --- |
| `state/context-telemetry-bridge.jsonl` | wake/QQ 会话事件（带 wakeId） | bridge |
| `~/.dsh/surfcore/context-telemetry-plugin.jsonl` | 所有 SurfCore 会话的模型/工具事件 | 插件 |
| `state/token-usage.jsonl` | 原有逐轮 token 账本 | bridge |
| `state/tool-calls.jsonl` | 原有工具调用日志 | bridge |
| 角色包 `persona.md` / `persona.daily.md` / `persona.scenes/*` | 人格三层 | 用户/角色 API |

遥测文件超过 8MB 轮转为 `.1`；**不记录消息正文/工具参数原文**。

---

## 六、判定权

| 事情 | 谁决定 | 代码位置 |
| --- | --- | --- |
| 要不要唤醒 | bridge 规则 | `sendWakePromptV2` 前置闸门 |
| backlog 最多几个 | 代码 + 用户配置 | `wakeBacklogConversations` |
| 人格内容 | **用户** | 角色页/文件 |
| 人格选哪层、怎么裁 | 代码 | `persona-layers.js` |
| 回不回、收不收 | **模型** | 工具调用 |
| 能不能发/close | **代码否决** | bridge 权限/状态校验 |
| 用多少思考强度 | 配置（当前 max，未改） | `ensureChatModel` |
| 缓存/高峰价 | 服务商 | 不可控 |
| 观测 | 遥测 | 不参与决策 |

---

## 七、以后出问题怎么查

| 症状 | 先看什么 | 常见原因 |
| --- | --- | --- |
| token 突然变高 | `context-telemetry-report` + `context-call-chain-report` | backlog/冷启动、close-only、长回合、高峰 |
| 报告没有数据 | 两个 telemetry 文件是否存在 | bridge/DSH 未重启；写失败看日志 |
| 报告 `(no wake)` 很多 | wakeId 覆盖 | 旧数据/桥接未重启；按最近 wake 兜底 |
| backlog 仍很多 | `backlogMaxSessions` 是否生效 | 未重启桥接；多个会话/多次启动 |
| 人格没分层 | 当前角色目录、场景文件 | 没保存过 daily/scene；旧角色兼容 |
| 角色页看不到三层 | DSH 是否重启 | 客户端 bundle 旧 |
| close-only 很高 | 调用链报告 | 语义问题，不要直接删 close |
| 消息漏回 | `question`/`keyword` 的 delivered/error | 先复核，不要先降上限 |

---

## 八、回滚

- 人格层：停止读 daily/scenes，只读 `persona.md`；
- 遥测：移除 bridge/插件接线，或停止写文件；
- backlog：`backlogMaxSessions` 调回 5；
- 没有 close/keyword/模型改动需要回滚。

---

## 九、设计了但没实现

以下只是方法论，不要以为已经在跑：

- Context Compiler / ContextRecipe；
- 记忆核心/边缘/工作/归档；
- 向量记忆；
- 工具 brief/detail、`qq_get_context_snapshot`；
- close 动作包；
- keyword 退避；
- 错峰调度、黑话学习预算、单群预算；
- 任务级 reasoningEffort / 模型路由；
- per-step 上下文配方（需要 DSH 宿主支持）。

---

## 十、A+B 账单（自动写 Markdown）

角色一份、每个 QQ 群/私聊一份：

```text
~/.dsh/surfcore/billing/
  index.md
  characters/<id>/summary.md
  conversations/group_<群号>.md
  conversations/private_<QQ号>.md
```

- 数据：token 账本 + 遥测；
- 自动：插件启动 30 秒后生成一次，之后每 10 分钟刷新；
- 手动：`node scripts/billing-report.mjs`；
- 不记录正文、不调用模型；
- 群内个人不精确分摊；只有群/私聊和角色账单。

### 6. 群分层 + 人格语气

- 群分层：`src/group-policy.js`；阈值 `socialV2.groupPolicy.largeThreshold` / `activeMessageThreshold`；手动覆盖 `overrides`；设置页 QQ → 群分层。
- 小群：保留 question/keyword/probability/direct；大群：只保留 @/名字/拍一拍/私聊/管理员/引用自己。
- 人格语气：`persona.tone.md`；`qq_get_prompt` 群聊默认 `mode=tone`，私聊默认 `full`；`mode=full` 显式加载核心。
- 智能拆分：`/persona/classify` 一次低强度模型调用，只返回草稿；用户逐层保存。
- 回滚：删除 `state/group-policy.json`；清空 `persona.tone.md`。

### 7. 快照 / 工具面 / step guard

- `src/context-snapshot.js`：默认 caps unread 12 / recent 10 / text 200 / active 8；truncated + refs；
- `GET /api/socialV2/snapshot` + MCP `qq_get_context_snapshot`；
- `socialV2.toolProfile`：full / balanced / compact；关掉的工具注册期不注册，需重启 DSH；
- `qq_get_prompt` 默认 sections=role,wake,memory；stickers/slang/closure/voices 显式取；
- turn-guard 按 assistant step 计数；
- `src/action-planner.js` 只做 close 幂等；写操作仍独立。
