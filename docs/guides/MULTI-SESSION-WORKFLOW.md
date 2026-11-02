# 多会话协作规则（一会话一工作树）

> 2026-11-02 事故后定稿。**所有今后在这个仓库干活的会话（人 or AI）都必须先读这一页。**
> `AGENTS.md §1.9` 是简版刚性规则，本文是完整操作手册。

## 0. 一句话

**同一个工作区，同一时间只允许一个会话写代码。**
第二个会话开始前，必须 `git worktree add` 到独立目录 + 独立分支；不允许“大家小心一点”地共用。

## 1. 事故（为什么定这条规矩）

2026-11-02 同时有三个会话在 `D:\deepseekwork\surfcore` 的同一个 `dev` 工作区里干活：

| 会话 | 它以为自己在做的事 | 实际发生 |
| --- | --- | --- |
| 语音修复 | 修本地语音包安装 | 提交 `4d2d7c3 fix(voice)...` 时把 **Minecraft 的 UI**（`client.js` +45 行、`/mc/card` 卡片）一起提交了 |
| Minecraft 拓展 | 做 MC 平台适配器 + UI | 后端改动一直**没提交**（`M`/`??` 躺在共享工作区）；UI 却被别人的提交带走 |
| 向量记忆 | 写交接文档 | `docs/handoffs/2026-11-02-vector-memory-embedding-service.md` 未提交，谁 `git add -A` 谁就把它带走 |

根因不是“谁粗心”，是**共用 working tree + index**：

- 一个会话 `git add -A` 会把别人未提交的文件卷进自己的提交；
- 同时 `git commit` 会撞 `index.lock`；
- 一个会话 `git switch/checkout/reset/stash` 会覆盖别人未提交的改动；
- 测试跑的是“混合工作区”，红绿都不可信。

## 2. 标准流程（每个会话开工前）

### 2.1 先看现场

```powershell
cd D:\deepseekwork\surfcore
git status --porcelain
git worktree list
git log --oneline -5
```

- `git status` **不干净** → 先判断这些改动是不是你的：
  - 是你的：继续；
  - 不是你的：**停手**，在会话里说明，等对方收走或迁走；
- `git worktree list` 出现别的目录 → 说明已经有人用独立工作树，正常。

### 2.2 认领一个工作树 + 分支

```powershell
# 在仓库根目录执行；<topic> 用英文短名，如 mc / voice / memory
git worktree add ..\surfcore-<topic> -b feat/<topic> dev
```

之后**只在这个目录里改**：

```powershell
cd ..\surfcore-<topic>
```

分支命名约定：

| 类型 | 分支 |
| --- | --- |
| 功能 | `feat/<topic>` |
| 修复 | `fix/<topic>` |
| 文档/流程 | `docs/<topic>` |
| 热修（仅 main） | `hotfix/<topic>` |

### 2.3 运行时也要串行

不只是 git：**桥接 / DSH / B站 tick / 发版**也会互相踩。

- 同一时间只允许一个会话重启 QQ 桥接或 DSH；
- 同一时间只允许一个会话跑 `publish-dev` / 发布；
- 测试尽量用临时端口/临时 state，不要动真实 `state/`；
- 需要重启/发版前，先在会话里说“我要重启/发版”，确认没人正在用。

## 3. 提交规则（刚性）

1. **禁止 `git add -A` / `git add .` / `git commit -a`**。
   只 add 自己负责的明确路径：

   ```powershell
   git add src/mc-bridge-client.js src/mc-card-view.js src/mc-toolset.js `
           plugins/surfcore/platforms/mc `
           scripts/test-mc-*.mjs
   ```

2. 提交前必须核对：

   ```powershell
   git status --porcelain
   git diff --stat
   git diff --cached --stat
   ```

   `--cached` 里出现不是你改的文件 → `git restore --staged <file>`，不要提交。

3. 提交信息写“范围 + 现象 + 修法”，例如：

   ```
   feat(mc): 平台适配器 + 只读卡片 + 工具集护栏
   ```

   不要写 `update` / `fix` / `changes`。

4. 一次提交只做一件事；跨文件的无关改动拆开。

## 4. 合并到 dev

功能分支完成后：

```powershell
# 在功能分支的工作树里
git fetch
git merge dev            # 先跟上 dev，解决冲突
npm run test:audit
cd plugins/surfcore; npm test; cd ../..

# 回到主工作区（或任一干净工作树）
git switch dev
git merge --no-ff feat/<topic>
```

规则：

- **只有确认 dev 当前没有别的未提交/未合并工作时才合并**；
- 合并后由合并方从**合并后的 HEAD** 重新生成 `release/install-manifest.json`，
  不要手工解 manifest 冲突：

  ```powershell
  node scripts/release-manifest.mjs
  git add release/install-manifest.json
  git commit --amend --no-edit
  node scripts/release-manifest.mjs --verify-ref HEAD
  ```

- 合并后删除工作树（可选）：

  ```powershell
  git worktree remove ..\surfcore-<topic>
  git branch -d feat/<topic>
  ```

## 5. 发布规则（不变，补充一条）

- 版本号、tag、Release、公开推送**只能由发布会话做**，且必须用户明确说“发”；
- 发布会话开始前，先确认：
  - `git worktree list` 没有正在写的工作树；
  - `git status` 干净（主工作区 + 各工作树）；
  - 没有会话正在重启桥接/DSH；
- 发布只从 `main`；dev 构建只发 Pre-release。

## 6. 发现污染后的处理

1. **不要 rewrite 公开历史**（已经 push 的提交不要 `rebase`/`filter-branch`）；
2. 在 `docs/cases/` 记一条：哪个提交混进了什么、谁受影响、后续怎么拆；
3. 后续改动用独立分支，补一个干净的提交说明；
4. 如果只是未提交文件混在一起：只 add 自己的路径，其余保持原样，让对方自己收；
5. 如果 index 被锁：不要删 `index.lock` 硬来，先确认没有 git 进程在跑。

## 7. 检查清单（复制到每个会话开头）

```text
[ ] git status --porcelain 干净，或脏文件全是我的
[ ] git worktree list 已确认；我在自己的 worktree 里
[ ] 分支是 feat/fix/docs/<topic>，不是直接在 dev 上改
[ ] 提交只用明确路径，没有 git add -A
[ ] git diff --cached --stat 里没有别人的文件
[ ] 改完跑了 test:audit + 插件测试
[ ] 需要重启/发版时，先确认没有别的会话在用
```

---

**违反其中任何一条，后果不是“冲突一下”，而是别人的工作被卷进你的提交、或者被你的 checkout 直接抹掉。**
2026-11-02 已经发生过一次；这份文档就是为了不再发生第二次。
