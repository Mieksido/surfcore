# 用户优化建议 · 单会话队列

> 2026-11-03 调整：**取消五队列并行，只保留一个优化会话**（`feat/optimize`）。
> 目的：避免多分支合并冲突，让建议一条条稳定落地。
> 规则：`AGENTS.md §1.9`、[`docs/handoffs/2026-11-03-optimization-session.md`](handoffs/2026-11-03-optimization-session.md)。

## 0. 一句话

**一个会话、一条分支、一批 3–5 条建议；做完一批合一次，不攒到最后。**

## 0.1 角色边界（2026-11-04 用户明确）

- **用户**：决定做什么、优先级、验收标准；
- **优化会话（含测试机 DSH）**：实现、跑测试、做技术可行性评估；
- **协调会话**：队列编号、文件/冲突协调、门禁、合并、发版；
- 协调会话**不替用户选功能**，也不因为评估里“建议做”就开工；内容取舍由用户拍板。

## 1. 唯一的队列

| 项 | 值 |
| --- | --- |
| 工作树 | `D:\deepseekwork\surfcore-optimize` |
| 分支 | `feat/optimize` |
| 基线 | `dev @ 9db668a`（已产出 `docs/cases/2026-11-03-optimization-baseline.md`） |
| 合并方式 | 每批完成后发协调会话，`git merge --no-ff` 进 `dev` |
| 发布 | 不归优化会话管；发布会话统一发版 |

## 2. 建议队列（收到后填）

| ID | 用户建议（一句话） | 涉及文件 | 优先级 | 状态 | 指标（改前→改后） | commit |
| --- | --- | --- | --- | --- | --- | --- |
| OPT-001 | 主人私聊可读白名单群记忆；私聊仍不进群；指定群互通（已有） | `src/memory-card.js`、`plugins/surfcore/lib/memory-card.js`、`plugins/surfcore/lib/client.js`、`scripts/test-memory-*.mjs` | P0（用户点名） | 已合并（`50410c9`，随 `0.8.8-dev.1` 发布） | 主人私聊块 2190→2892 字（+702 群近况，私聊主块不挤）；非主人私聊 399 字无群块；13 条无 key 旧私聊不再串号；audit 143/143 | `cbaa613` |
| OPT-002 | B站 看视频接 dsh-video-storyboard + 时间线日志 | `plugins/surfcore/tools/commands/bili-watch.mjs` 等 | P2 | 不做（暂缓，用户 2026-11-04 决定） | 只有评估，无改动；评估见 handoff 2026-11-04 | — |
| OPT-003 | 情绪触发 B站 动态发布 / QQ 空间说说 | `plugins/surfcore/lib/scheduler.js` / 桥接 qzone 通道 | P1 | 评估完成（待用户裁决） | 评估见 `docs/handoffs/2026-11-04-opt-003-emotion-trigger-eval.md`；结论：B站草稿+人工发布，qzone 仅自己可见，全自动不做 | — |

状态约定：

- `待评估`：还没确认收益/可行性；
- `进行中`：当前这批在做；
- `待合并`：分支完成、测试通过、等协调会话；
- `已合并`：进了 dev；
- `不做`：写明原因（重复/收益低/风险高/做不到）。

## 3. 每批怎么做

1. 从队列顶部取 **3–5 条**，按“先低风险、后高风险”排序；
2. 同一批尽量**同一类文件**，减少来回改；
3. 每条都记改前/改后（耗时/请求数/字符数/磁盘/操作步骤；纯体验类写前后对比）；
4. 跑 `test:audit` + 插件测试；
5. `git merge dev` 跟上最新，再发合并请求；
6. 合并后更新本表，开始下一批。

## 4. 冲突控制（虽然只剩一个会话，仍要防）

当前其他分支（MC / 四个平台 / 向量记忆）还在改共享文件：

- `client.js`、`lib/index.js`、`src/memory-card.js`：先和协调会话确认，不要和平台分支同时大改；
- `src/bridge.js`：大文件，改动尽量局部；
- `scripts/test-audit.mjs`：新增测试只加一行，合并前先 merge dev；
- `release/install-manifest.json`：每次合并后由协调会话重生成，不手工解；
- `docs/cases/README.md`：只追加自己的行。

## 5. 交给协调会话前必须满足

1. 已 `git merge dev`；
2. `npm run test:audit` 全绿；
3. `cd plugins/surfcore && npm test` 0 失败；
4. `node scripts/release-manifest.mjs --verify-ref HEAD` 问题 0；
5. 有 case + 改前/改后指标；
6. 合并请求写清：分支、commit、文件、指标、风险。

不满足就退回，不进入合并。

## 6. 给用户的反馈

- 每条 `已合并` 的建议，最终随版本发布；
- `不做` 要能说清原因，不要静默丢；
- 一次提很多条时，回一句“已进队列，按批处理，完成后统一回复”。

## 7. 和“五队列”方案的关系

原五队列/四工作树已取消（2026-11-03），原因：并行分支在 `client.js`/`index.js`/`test-audit.mjs`/manifest 上冲突成本高于收益。
历史方案存档在仓库外 `D:\deepseekwork\voice\2026-11-03-optimization-queues-cancelled.md`，不要再按那个开工。
