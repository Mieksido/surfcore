# Token 架构优化进度（Phase 0–4）

> 目标：先解释成本，再减少成本；每一步都有可回滚的改动与验证。
> 最后更新：2026-10-31 13:55（Asia/Shanghai）

## 总览

| Phase | 内容 | 状态 | 行为变化 |
| --- | --- | --- | --- |
| 0 | 真实 token/上下文账单 + 遥测 | ✅ 完成 | 无 |
| 1 | wake → turn → tool 调用链 | ✅ 完成 | 无 |
| 2 | backlog / keyword / close-only 诊断 | ✅ 完成 | 无 |
| 3 | 低风险调度/预算（先 backlog 限量） | 🟡 部分完成 | backlog 默认上限 5→3 |
| 4 | 推理强度/模型策略 + 最终验收 | 🟡 验收框架完成 | 模型参数未改 |
| A+B | 角色/群/私聊账单 Markdown | ✅ 完成 | 只读生成 |

## Phase 0：测量

- `src/context-telemetry.js`：旁路 JSONL；
- bridge：wakeId、prompt 字符/分段、未读/历史/媒体计数；
- 插件：所有 SurfCore 会话的 model usage / tool call/result / turn；
- 报告：`context-telemetry-report.mjs`；
- 结论：
  - 11 天 6,200 次调用，17.1 亿 token，¥77.18；
  - 缓存命中 99.1%，但命中成本占 61%、未命中占 28%、输出占 11%；
  - 高峰占 55.2%，高峰每百万 token 成本是空闲的 1.92 倍；
  - 平均每次调用 27.6 万 token；回合 p90 213 万、max 1,339 万。

## Phase 1：调用链

- bridge 把 `wakeId` 带进 QQ 会话事件；
- `context-call-chain-report.mjs` 重建路径；
- 样本（48 wake）：
  - model calls/wake p50=2/p90=4/p99=11；
  - delivered 17；close-only 26；close 44；
  - delivered 成本 ¥1.80，非 delivered ¥0.89；
  - backlog 7 次 ¥0.933；keyword 12 次 0 交付。

## Phase 2：诊断结论

- `close` 不是纯收尾：它改已读水位、closure 状态、noAction、replyCheck、唤醒安全；
- `close-only` 稳定存在，不能按频率直接删除；
- `keyword:大肥鱼` 样本 19 次全部未发送，是稳定的噪音候选；
- `backlog` 是最贵的单类路径，冷启动明显；
- 下一批应先做 backlog 限量/合并，再做 keyword 退避实验。

## Phase 3：低风险调度

已完成：

- 新增 `socialV2.wake.backlogMaxSessions`，默认 **3**（原硬编码 5）；
- 启动补唤醒只取未读最多的前 N 个；
- 设置页高级设置可调 1~20；
- 目的：减少重启后一次性创建多个冷会话。

待做：

- keyword 无发送退避（需语义复核/开关）；
- 非紧急任务错峰；
- 单群/黑话学习预算；
- 前后对照（重启后重跑报告）。

## Phase 4：模型/推理强度与验收

已完成验收框架，**未改模型参数**。当前样本：

```text
wake=106 delivered=24 closed=102 close-only=77
model calls/wake p50=2 p90=4 p99=5 max=15
cost/wake=¥0.0447 cost/delivered=¥0.1002
delivered latency p50=3386ms p90=5272ms avg=6911ms
```

新增指标：`deliveredLatency` / `avgCostDelivered` / `review.closeOnly` / `review.noSendByReason`。

不启用模型策略的原因：没有成功率/漏回复指标，直接降 reasoningEffort 可能省 token 但变笨。计划：

- 日常聊天/工具选择/复杂推理分级；
- 先小流量验证 reasoningEffort 降低对回复质量和工具正确率的影响；
- 验收：
  - 每成功任务成本；
  - 每次 wake 模型调用 P50/P90/P99；
  - cache miss 成本；
  - 任务成功率/失败率/重复回复/漏回复；
  - 即时消息延迟；
  - 超预算次数。

## 一小时样本复盘（2026-10-31 13:55）

重启后约一小时：

```text
唤醒 138
有发送 15
close 136
close-only 116
总成本 ¥4.34
close-only 成本 ¥3.14
model calls/wake p50=2 p90=3 p99=6
```

两个群占 129/138 次唤醒：

- 群 A：75 次，65 次 question，仅 6 次发送；
- 群 B：54 次，27 次 keyword，6 次发送。

根因：

- `question` 的 `isDirectedAtAi` 太宽，普通“你…吗”命中；
- `question` 被当成 direct，绕过 `maxWakesPerDay=20`；
- 于是普通群聊也能一小时 75 次唤醒。

已修：

- 新增 `src/wake-policy.js`；
- 只有 @/名字/拍一拍/私聊/管理员可绕过每日配额；
- question 仍能唤醒，但受 20 次/日 + 2 分钟间隔；
- unread 严格 direct 只认 owner/引用自己/真实 @ 或昵称。

需要重启桥接后生效。

## 修复后 20 分钟验证（14:24–14:44）

- 唤醒 47、有发送 26、close-only 21；
- 成本 ¥2.08，成本/交付 ¥0.0551（修复前 ¥0.0711）；
- question 12 次（修复前约 30 次/20 分钟）；
- group:389834620 只有 5 次唤醒（修复前约 25 次/20 分钟）；
- group:496972996 40 次唤醒 / 22 次发送，atMention 19 次；
- 预算 QQ ¥12.14 / ¥20。

结论：question 绕过配额的问题基本修复；close-only 仍存在，但比例从 84% 降到 45%。仍需跑更长样本再决定 keyword/close。

## 第二轮回归（14:44–15:54）

- 20 分钟样本看似有效，但 70 分钟后又回到 117 唤醒 / 13 发送 / 104 close-only；
- 根因：裸昵称和 fish bypass 仍可绕过每日配额；
- 已再收紧：只认真正的 @/引用自己，去掉 fish bypass；
- 等待下一次重启验证。

## 群分层与人格语气（2026-10-31）

- 群分层：小群保留积极唤醒；大群/高活跃群只认真实点名；设置页显示人数/活跃/覆盖；
- 人格语气层：群聊默认 tone，不加载核心；私聊/full 按需加载；
- 一页四层编辑 + 拆分预览草稿；身份底座（我是谁/主人是谁）始终带；
- 场景说明含 B站等平台 + 跨平台隐私警告；
- 群分层面板提示：人数过多/活跃会大大加快 Token 消耗，谨慎设置；
- 拆分失败自动 JSON-only 重试一次，错误带输出预览；
- 拆分/日常保存自动把“角色是谁、主人是谁”写进日常层。
- 角色页新增写法提示 + 智能拆分（草稿，用户编辑保存）；
- 下一批：`qq_get_context_snapshot` + brief/detail + 只读批量。

## 工具快照 / 工具面（2026-10-31）

- `qq_get_context_snapshot`：合并 unread/recent/social/activeMembers，caps + refs；
- `qq_get_prompt` 默认 role/wake/memory，可选段显式取；
- `toolProfile`：full/balanced/compact；默认 balanced（snapshot 关闭回 full）；
- close 在 lastSendFailed 时拒绝；preset 引导 snapshot；
- step guard 按 assistant step；
- `action-planner` 第一版：close 幂等，不自动合并写操作；
- 残余：send 失败/等待状态、旧读工具 brief/detail、profile 默认未切 balanced。

## A+B 账单

- 角色：`~/.dsh/surfcore/billing/characters/<id>/summary.md`；
- 群/私聊：`~/.dsh/surfcore/billing/conversations/*.md`；
- 索引：`billing/index.md`；
- 自动刷新 10 分钟；手动 `node scripts/billing-report.mjs`；
- 群内个人不分摊；只到群/私聊。

## 当前验证

- `npm run test:audit`：**98/98**（Phase 3 backlog cap + Phase 4 延迟指标 + A+B 账单）
- `plugins/surfcore npm test`：通过
- `test-context-telemetry` / `test-context-call-chain` / `test-backlog-cap`：通过

## 回滚

- Phase 0/1/2：移除对应遥测/报告接线即可；数据文件保留；
- Phase 3：把 `backlogMaxSessions` 调回 5，或移除该 cap；
- Phase 4：没有模型行为改动；仅新增验收指标。

## UI 区域按钮化（2026-10-31）

- 高级设置参数组、群管理、鱼群保护、对话收尾改为按钮 + 弹窗；
- 群管理移入高级设置；顶部卡片不变；
- 弹窗保存走原 /config 或内部群分层保存；
- 残余：早安/定时分享、其他 tab 未全量改造。

## 会话映射审计（2026-10-31）

- 本机 QQ key 均为独立 session；同 workspace 创建两次 DSH session 返回不同 id。
- 新增重复 sessionId 检测：发现多个 key 共用时全部删除映射并重建。
- 新会话写可辨认标题。
- B站单角色单会话、角色/记忆跨平台共享仍是设计。

## 记忆卡手动操作修复（2026-10-31）

- 修复 act() 里 item.staged 未定义导致置顶/忘记/确认/手动记/恢复自动/恢复备份报错；
- reload 提前并独立 try/catch，toast 文案异常不再阻断刷新；
- 新增 test-memory-card-act。

## 限制失败可见性（2026-10-31）

- 发送频率/鱼群/Token 发送上限写 L1 gate event；
- 概览错误报告显示具体配置、当前/上限、设置路径；
- 可「去改设置」或「知道了（本限制提醒）」；
- 残余：条数/字数等参数错误尚未统一。

## 限制提醒去重（2026-10-31）

- 同一 code/key/setting 1 小时最多一条，lastAt 持久化；
- 概览「永久不再显示」写 muted[code]；
- 保留「知道了（本限制提醒）」只确认本次。
