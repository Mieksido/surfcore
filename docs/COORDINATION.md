# 协作登记表（COORDINATION）

> **本表由“协调/发布会话”维护。任何会话开工、收工、换分支、准备合并，都必须更新自己那一行。**
> 规则见 [`docs/guides/MULTI-SESSION-WORKFLOW.md`](guides/MULTI-SESSION-WORKFLOW.md) 与 `AGENTS.md §1.9`。
> 更新时间：2026-11-02 15:12（Asia/Shanghai）

## 0. 当前协调人

**本对话（协调/发布会话）**：负责
- 审阅各会话的提交范围（`git diff --cached --stat` / `git show --stat`）；
- 把功能分支合并进 `dev`（`--no-ff`），合并后重生成清单；
- 发 dev 构建 / 稳定版（**必须用户明确说“发”**）；
- 维护本表与多会话规则。

工作区：`D:\deepseekwork\surfcore`（主工作区，**只用于协调、文档、发布；不接功能开发**）。

## 1. 活跃会话

| 会话 | 工作目录 | 分支 | 负责范围 | 状态 |
| --- | --- | --- | --- | --- |
| **协调/发布**（本对话） | `D:\deepseekwork\surfcore` | `dev` | 规则、登记表、合并、发版 | 进行中 |
| **bug 修复** | `D:\deepseekwork\surfcore-bugfix` | `fix/release-0.8.7` @ `e20a464` | 3c99c54..e20a464 的修复 | ✅ 已在 dev 历史内；等新交接 |
| **Minecraft 拓展** | `D:\deepseekwork\surfcore-mc` | `feat/minecraft` @ `f3bd46f` | MC 平台适配器/工具集/卡片/记忆 scope | ⏸ 已从 dev 撤回，分支保留；等完成 |
| **向量记忆** | `D:\deepseekwork\surfcore-memory` | `feat/vector-memory` @ `9e7e737` | 向量记忆交接书 + docs 索引 | ⏸ 已从 dev 撤回，分支保留；等完成 |

### 本轮“合并后又撤回”记录（用户要求：未完成，不进下一版）

| 分支 | 原合并 | 撤回提交 | 现状 |
| --- | --- | --- | --- |
| `feat/minecraft` | `961c21a` | `9c31d7b` | 分支 `f3bd46f` 保留；dev 已移除 MC 代码 |
| `feat/vector-memory` | `a52c03a` | `02ca250` | 分支 `9e7e737` 保留；dev 已移除交接书 |
| `fix/release-0.8.7` | 无需合并（`e20a464` 已是 dev 祖先） | — | 保留在 dev |

另：MC 的 UI 原本混在 `4d2d7c3`，本轮用一个单独提交从 `dev` 移除（不 rewrite 历史）。
**MC 完成后再合并时，需要把 UI 作为新提交重新加回**（因为 dev 已删除，分支本身没有新增这段）。

## 2. 当前遗留

1. MC 的 handoff `2026-11-02-mc-agent-integration-batch1.md` 已从主工作区移到
   `_backups/2026-11-02-mc-agent-integration-batch1.md`；MC 会话需要的话从那里取，或重新提交。
2. MC 分支 `feat/minecraft` 里仍有 UI 的历史内容，但 dev 已删；合并前要确认 UI 重新加回。
3. 向量记忆只有交接书，等实现时另开 `feat/vector-memory-impl`。
4. bug 修复的新交接还没到；到之前不构建、不发版。

## 3. 各会话接下来要做的

### 3.1 bug 修复会话

- `e20a464` 已在 dev；当前 dev 已回到“只有 bug 修复 + 协调文档”的干净状态；
- 继续修 bug 请从最新 `dev` 切 `fix/<topic>`，在 `surfcore-bugfix` 工作树里跑测试；
- 完成一个可合并单元后，按 §4 发合并请求。

### 3.2 Minecraft 会话

- 你的 `f3bd46f` 还在 `feat/minecraft`，没有丢；但**已从 dev 撤回**；
- 继续在 `surfcore-mc` 工作树完成 preset / 事件泵 / 进程托管；
- 完成并自测后，**把 UI 作为新提交加回**（dev 已移除 `McTab`），再发合并请求；
- 合并前先 `git merge dev` 跟上最新，解决可能冲突。

### 3.3 向量记忆会话

- `9e7e737` 还在 `feat/vector-memory`，没有丢；但**已从 dev 撤回**；
- 等实现阶段另开 `feat/vector-memory-impl`；交接书本身可等实现完成后再一起合。

## 4. 合并请求格式（各会话发给协调会话）

```text
【合并请求】
分支：feat/<topic>
commit：<hash>
范围：<一句话>
改到的文件：<列表>
测试：test:audit <N/N>；插件测试 <0 失败 / 具体>
风险/未验证：<...>
是否已 rebase/merge 最新 dev：<是/否>
```

协调会话收到后：

1. `git show --stat <hash>` 核对范围；
2. 在独立工作树/临时目录跑测试（不污染主工作区）；
3. `git merge --no-ff` 到 `dev`；
4. 从合并后的 HEAD 重生成 `release/install-manifest.json`（单独提交）；
5. 更新本表状态。

## 5. 决策记录

| 时间 | 决策 |
| --- | --- |
| 2026-11-02 14:40 | 确立“一会话一工作树”；主工作区只做协调/发布；禁止 `git add -A`；合并/重启/发版串行 |
| 2026-11-02 14:40 | 已污染的 `4d2d7c3` 不 rewrite 历史，记录在案，后续 MC 补干净提交 |
| 2026-11-02 14:40 | 本对话成为唯一协调/发布会话；各会话通过本表 + 合并请求交接 |
| 2026-11-02 15:05 | 曾合并 vector（a52c03a）与 MC（961c21a）；后按用户“未完成，先不发”撤回 |
| 2026-11-02 15:10 | 撤回两个合并（9c31d7b / 02ca250），并从 dev 移除 4d2d7c3 带来的 MC UI；分支保留，等完成再合 |
