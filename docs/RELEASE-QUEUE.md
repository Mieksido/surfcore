# 发布待办队列（编辑会话 → 发布会话）

> 用途：编辑会话每完成一批改动，在这里追加**一个带时间戳的批次**：覆盖到哪个提交、
> 改了哪些文件/功能、case 路径、建议版本、可直接复制的交接块。
> **发布会话从最上面的「待发布」批次复制**，不用翻 `git log`；发布完成后把标题改成「已发布 vX.Y.Z」。
>
> 触发：用户说「好了，总结这次的改动」之类的话时追加（规则见 AGENTS 1.6）。
> 没有进这张表的改动，不允许发布（见 [RELEASE.md](RELEASE.md) 第一节）。

---

## 待发布

### 批次 2026-11-02 17:30 · issue #35：单 Loader 来源根治 + 体检预检（三分支，未合并）

> **状态更新 2026-11-03 00:35**：已向上游 `Mieksido/surfcore` 发起 **PR #54**（`SCVMofic:pr/issue-35-fix` → `main`，
> 10 个提交，含 #102 stop 脚本编码热修与清单补同步），PR 描述含 A1 vs 子包方案对比 + 三条共同必做项提醒，
> issue #35 下已留言指路（comment-6587404809）。上游合并动作由发布会话跟进；本地三分支保留作历史。
> PR 分支 `pr/issue-35-fix` 基于 `docs/issue-35-pr3-governance`（`777c88c`）+ 清单补同步提交。
> 附带现场修复：本地 `config.json` 的 `snowluma.launcherPath/homeDir` 手填单反斜杠导致 JSON 非法，已转正斜杠
> （备份 `qq-config-2026-11-02T20-10-22-099Z`）；该文件未跟踪、不进 PR。

<!-- release-batch: start=2026-11-02T14:00+08:00 end=2026-11-02T17:30+08:00 commits=52a2630,76b6877,e82edd0,e834473,3975ea2,(PR3 docs commit) -->

**覆盖分支/提交**（基于 main `59ec306`，逐分支提 PR，合并顺序 PR1 → PR2 → PR3）：

| PR | 分支 | 提交 | 性质 |
| --- | --- | --- | --- |
| 1 | `fix/issue-35-pr1-loader-merge` | `52a2630`（根治）、`76b6877`（清单）、`e82edd0`（case） | P0 必合 |
| 2 | `feat/issue-35-pr2-compat-check` | `e834473`（规则+扫描器修复）、`3975ea2`（清单） | P1 可独立回滚 |
| 3 | `docs/issue-35-pr3-governance` | 本批文档提交 | P2 |

**建议**：patch（版本号由发布会话定）；修的是宿主级崩溃，值得在 CHANGELOG 顶格写。

**现象**：surfcore 与任何改写/重放 `modules` Loader 行的客户端插件（如 `dsh-vision-router@3.1.0`）同时启用 → DSH 启动即崩
（`ClientPackageCompositionError` → `DesktopHostFatalError`）。0.6.x–0.8.1 全线可复现。

**根因**：cordis.patch.yml 两条行（`surfcore` + `./lib/qq-mode.js`）解析到同一个声明 `dsh.client` 的包；
冷启动只 warn、modules fiber 重建走构造期严格校验必然 fatal。详见 case 与 PITFALLS #101。

**PR1 修法**：qq-mode 行并入主行；命名空间 `qq-mode` → `surfcore`（由 Loader entry id 推导，DSH 源码已核实）；
四处消费点切换；删 `lib/qq-mode.js`；一次性迁移 `lib/qq-mode-migrate.js`（只读解析 profile patch 旧 volatile 行 →
`settings.update('surfcore')` 写回；**marker 在 update 成功后才写**，失败下次重试；不覆盖新值；空 ownerQQ 不迁）。
哨兵测试 `test-qq-mode-plugin.mjs`（解析到 surfcore 的行 === 1）+ `test-qq-mode-migrate.mjs`（10 例）。

**PR2 修法**：体检扫描器盲区修复（patch 发现只认 package.json `dsh.bundle.patch` 声明——DSH 唯一形式；
旧扫描连 surfcore 自己的 patch 都扫不到）+ 新规则 `COMPAT_CLIENT_MULTI_SOURCE`
（blocker/confirmed；同包 ≥2 个行名 → 报冲突行、来源文件与合并修法；只对 `dsh.client.platform=web` 的包判；
解析不了的行如实计入未检查）。测试 `test-compat-multi-source.mjs` 十例。

**case**：[docs/cases/2026-11-02-issue35-client-multi-source.md](cases/2026-11-02-issue35-client-multi-source.md)

**验证（提交时点）**：

```text
npm run test:audit -> 108/109（PR1）/ 108/110（PR2）；失败均为预存在 flaky
  （test-update-apply-result：干净 main 6 跑 3 挂随机 ENOENT；test-voice-cloud-credentials 偶发；单跑均过）
npm run test:regressions / npm run test:plugin -> 全绿
cd plugins/surfcore && npm test -> 全绿
node scripts/release-manifest.mjs --verify-ref HEAD -> 问题 0 个
```

**用户可见变化**：DSH 设置页里原独立「qq-mode」表单消失，mode/ownerQQ 并入 surfcore 的设置表单（功能不变，仅归位）。

**重启矩阵**：重启 DSH 即生效（插件经 link 直连仓库）；旧值迁移在插件启动时自动跑一次，marker 在 `~/.dsh/surfcore/qq-mode-migrated.json`。

**交接块（可复制给发布会话）**：

```markdown
## SurfCore issue #35 修复交接（2026-11-02）

### 内容
1. 根治：客户端包 surfcore 恢复「单 Loader 来源」（qq-mode 行并入主行，命名空间迁 surfcore），
   修复与 vision-router 等 modules 行重放插件同启时的宿主启动崩溃（Mieksido/surfcore#35）。
2. 一次性迁移：旧 qq-mode 设置（profile patch 里的 mode/ownerQQ）自动并入 surfcore 命名空间；
   失败自动重试，不覆盖用户新值。
3. 体检新规则 COMPAT_CLIENT_MULTI_SOURCE：安装前预检同类冲突（blocker）；扫描器同时修正为
   只认 package.json dsh.bundle.patch 声明（DSH 唯一支持形式）。

### 验证
npm run test:audit 108/109+108/110（两个失败为预存在 flaky，单跑通过）；
test:regressions / test:plugin / plugins/surfcore npm test 全绿；
release-manifest --verify-ref HEAD 通过。

### 发布注意
- 版本号/CHANGELOG/tag/推送按 RELEASE.md 流程；先提交、再生成清单（脚本已按 HEAD 生成并通过 verify）。
- 合并顺序：PR1 → PR2 → PR3；PR2/PR3 可独立回滚。
- 实机验收（发布前建议完成）：重启 DSH 正常；设置页 surfcore 下有 mode/ownerQQ；
  vision-router 同启不崩；无新增 startup crash 日志。

### 覆盖提交
52a2630 / 76b6877 / e82edd0（PR1）；e834473 / 3975ea2（PR2）；PR3 docs 提交（见分支 docs/issue-35-pr3-governance）
```

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
