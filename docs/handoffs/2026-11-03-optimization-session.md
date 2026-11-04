# 交接：SurfCore 功能优化会话

> 2026-11-03 创建。目标不是“再修一个 bug”，而是**用可测量的方式让 SurfCore 更快、更省、更好用**。
> 规则先读：`AGENTS.md §1.9`、[`docs/guides/MULTI-SESSION-WORKFLOW.md`](../guides/MULTI-SESSION-WORKFLOW.md)。

## 0. 一句话

**先量，再改；一次只改一个变量；没有指标就不算优化。**

## 1. 当前状态（开工时先核对）

```
dev HEAD：198a51a
版本：0.8.8
稳定版：0.8.8（main 已合回 dev）
audit：143/143
清单：680 / 0
工作区：干净
```

已有工作树（不要动别人的）：

| 工作树 | 分支 | 谁在用 |
| --- | --- | --- |
| `surfcore` | `dev` | 协调/发布 |
| `surfcore-mc` | `feat/minecraft` | MC 平台 |
| `surfcore-xhs` / `-tieba` / `-douyin` / `-wechat` | `feat/platform-*` | 四个平台 |
| `surfcore-memory` / `-memory-impl` | `feat/vector-memory*` | 向量记忆 |
| `surfcore-bugfix` | `fix/persona-tone-dedup` | bug 修复 |
| `surfcore-follow-route` / `-updatefix` | 已合并的修复分支 | 只读参考 |

## 2. 工作方式（刚性）

- 工作树：`D:\deepseekwork\surfcore-optimize`（**已建好**，当前分支 `feat/optimize`，从 `dev @ 198a51a` 切出）；
- 每个优化可再切 `feat/optimize-<topic>`，做完一个就发合并请求；
- **禁止 `git add -A`**，只 add 自己的路径；
- 不直接改 `dev` / `main`、不 bump 版本、不打 tag、不发 Release；
- **避开别人正在改的文件**：
  - `plugins/surfcore/lib/client.js`、`lib/index.js`、`src/memory-card.js` 正被 MC/平台分支占用；
  - 优化优先从**独立模块 / 脚本 / 测试 / 状态文件**下手；
  - 确实要改这些文件，先和协调会话说，合并顺序由协调会话排。
- 完成后按 [`docs/COORDINATION.md`](../COORDINATION.md) 的合并请求格式交给协调会话。

## 3. 先做基线（第一件事，不写功能）

在 `docs/cases/2026-11-03-optimization-baseline.md` 记一张表，至少测这些：

| 指标 | 怎么测 | 当前值 |
| --- | --- | --- |
| 全量 audit 耗时 | `Measure-Command { npm run test:audit }` | 待测 |
| 插件测试耗时 | `Measure-Command { cd plugins/surfcore; npm test }` | 待测 |
| dev 发布上传量/耗时 | `publish-dev` 日志：blob 数、总时长 | 约 680 文件、数分钟 |
| 唤醒提示词体积 | 用现有测试/脚本统计 full/tone 字符数 | 待测 |
| `state/` 体积 | `Get-ChildItem state -Recurse | Measure-Object Length -Sum` | 待测 |
| 设置页首屏请求数/耗时 | 浏览器 DevTools（人工） | 待测 |

基线不追求绝对精确，但要能对比“改前/改后”。

## 4. 候选优化清单（按收益/风险排序）

### A. dev 发布增量上传（低风险，建议先做）

现在 `publish-dev` 每次都全量上传几百个 blob，GitHub 会限流，发一次要几分钟。
可改成“只上传与远端 dev 树不同的 blob”，或复用远端已有 blob SHA；保留全量兜底。

- 收益：发布从几分钟降到几十秒；
- 风险：发布脚本改坏会导致 dev 构建缺文件——必须有契约测试 + 小步验证；
- 不碰客户端/平台代码。

### B. audit 套件并行化（中风险）

143 个测试串行跑，耗时较长。可把互不共享状态的测试分组并行，共享端口/state 的保持串行。

- 收益：本地反馈更快；
- 风险：测试互相污染会变成 flaky；必须先证明每组隔离；
- 先测出最慢的 10 个测试，优先拆它们。

### C. 唤醒提示词瘦身（高风险，先量再动）

统计 full/tone 两种模式的提示词字符数，找重复段落（来源规则、语音状态、身份锚点）。
只删**真正重复**的内容，不能删到行为规则；改完跑人格唤醒/语气相关测试。

- 收益：每轮 token 直接下降；
- 风险：模型行为变化，必须人工对比唤醒结果。

### D. 状态文件/日志轮转（低风险）

检查 `state/bridge.log`、`qq-activity.log`、`backups/`、`staging/` 的实际体积和保留策略。
把没有上限的改成有上限，保留最近 N 天/N MB；失败要可回滚。

- 收益：长期运行不撑爆磁盘；
- 风险：误删排查证据——保留最近一段，删除前写日志。

### E. 设置页请求合并/缓存（中风险）

设置页首屏可能重复请求 `/api/status`、`/updates`、`/overview`。
合并成一次或加短 TTL 缓存，减少桥接/宿主压力；先测请求数和首屏时间。

### F. 轮询/定时器空转（中风险）

检查 B站 tick、桥接健康检查、更新检查在空闲时的频率；能事件驱动就别轮询。
不要降低响应性（例如 wait 消息、更新提示）。

> 不要做的：为微优化改模型提示词、引入新依赖、重构大模块、碰未完成的 MC/平台分支。

## 5. 交付标准

每个优化单独一个提交/分支，包含：

1. **基线数字**（改前）和**改后数字**（至少 3 次取中位数）；
2. 功能测试 + 回归测试通过；
3. `docs/cases/2026-11-03-optimize-<topic>.md`：现象/做法/指标/风险/回滚；
4. 合并请求：分支、commit、改了哪些文件、指标、风险、是否已 merge 最新 dev。

**没有数字的“优化”不算完成；有数字但回归测试挂了，也不算。**

## 6. 建议的第一个任务

先做 **A（dev 发布增量上传）** 或 **D（状态/日志轮转）**：

- 两者都不碰客户端/平台代码，和现有会话冲突最小；
- A 的收益最直接（发布会话每次都在等）；
- D 的风险最低，适合先练手。

做完一个，把指标和合并请求发协调会话，再决定下一个。

## 7. 验证命令

```powershell
cd D:\deepseekwork\surfcore-optimize
git status --porcelain
npm run test:audit
cd plugins/surfcore; npm test; cd ../..
node scripts/release-manifest.mjs --verify-ref HEAD
```
