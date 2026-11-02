# 2026-11-02 · 多会话共用工作区：Minecraft UI 混进语音提交

## 现象

同一天有三个会话在 `D:\deepseekwork\surfcore` 的同一个 `dev` 工作区里工作：

- 语音修复会话提交 `4d2d7c3 fix(voice): make local pack install resumable and honest`；
- 该提交的 `plugins/surfcore/lib/client.js` 却包含 **Minecraft 的 UI**（`/mc/card`、`MINECRAFT` 卡片，+45 行）；
- Minecraft 会话的后端改动（`src/mc-*.js`、`platforms/mc/*`、`scripts/test-mc-*.mjs`）**一直未提交**，留在共享工作区；
- 另一个向量记忆会话的 `docs/handoffs/2026-11-02-vector-memory-embedding-service.md` 也躺在同一工作区未提交。

## 根因（不是“谁粗心”，是结构）

所有会话共用同一个 working tree 和同一个 index：

1. 一个会话 `git add -A` / `git add .` 会把别人未提交的文件卷进自己的提交；
2. 并发 `git commit` 会撞 `index.lock`；
3. 一个会话 `git switch/checkout/reset/stash` 会覆盖别人未提交的改动；
4. 测试跑的是“混合工作区”，红绿都不可信。

## 修法（规则，不是代码）

- **一会话一工作树**：`git worktree add ..\surfcore-<topic> -b feat/<topic> dev`；
- 主工作区只留给协调/发布会话；
- **禁止 `git add -A` / `git add .` / `git commit -a`**，只 add 自己负责的明确路径；
- 提交前核对 `git diff --cached --stat`，混入别人的文件就 `git restore --staged <file>`；
- 合并、重启桥接/DSH、发版，全部串行；
- 已污染的历史不 rewrite；记录在案，后续补干净提交。

## 已做的处置

- `AGENTS.md §1.9` 写入刚性规则（所有新会话自动注入）；
- `docs/guides/MULTI-SESSION-WORKFLOW.md` 完整操作手册；
- `docs/COORDINATION.md` 活跃会话登记表 + 合并请求格式；
- 本文件记录事故，防止下次“不知道为什么会混”。

## 未完成

- 三个会话尚未全部迁到各自工作树（需要它们先停手）；
- `4d2d7c3` 的混合提交保留（不 rewrite），MC 后续补一个干净的提交说明；
- 主工作区当前仍有 MC / 向量记忆未提交文件，协调会话**不会**替它们提交。

## 验证

- 规则文档提交本身用明确路径，`git diff --cached --stat` 只含本批文档；
- `node scripts/release-manifest.mjs --verify-ref HEAD` 通过。
