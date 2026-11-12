# 测试机 DSH 工作交接（正式）

> 交接方：SurfCore 协调/发布会话
> 接收方：第二台电脑（测试机）上的 DSH 会话
> 日期：2026-11-04
> 基线：稳定版 0.8.8；最新 dev 构建 0.8.8-dev.1；源码仓库 `Mieksido/surfcore`，集成分支 `dev`

---

## 1. 你的角色

你负责 **SurfCore 功能优化**：在测试机上改代码、跑测试、写案例，把成果通过 Git 分支交回协调会话。

你不是发布会话：
- 不直接改 `dev` / `main`；
- 不合并自己的 PR；
- 当前不发布任何版本（dev 发布权限见 §8，尚未开放）。

## 2. 当前事实

| 项 | 值 |
| --- | --- |
| 稳定版 | `0.8.8` |
| 最新 dev 构建 | `0.8.8-dev.1` |
| 集成分支 | `dev`（从 GitHub 拉） |
| 源码仓库 | `https://github.com/Mieksido/surfcore` |
| 测试机现有安装 | 可能是 `D:\dshwork\surfcore`（zip 安装，**不要直接改它**） |
| 建议源码目录 | `D:\dshwork\surfcore-dev` |
| 当前优化队列 | OPT-001 已完成；OPT-002 暂缓；OPT-003 待评估 |

## 3. 权限

### 允许

- 在 `surfcore-dev` 里创建 `feat/opt-<topic>` 分支；
- 修改功能代码、测试、case 文档；
- 运行测试、手工验收；
- `git push` 自己的功能分支；
- 在 GitHub 开 PR（base 必须是 `dev`）；
- 读取 `docs/OPTIMIZATION-BACKLOG.md`、`docs/COORDINATION.md` 等文档。

### 不允许

- 直接提交/推送到 `dev` 或 `main`；
- 合并自己的 PR；
- `git push --force`；
- 改版本号、打 tag、发 Release（dev Pre-release 也要等书面授权）；
- 把 `config.json`、`state/`、`~/.dsh`、token、cookie 提交或贴出；
- 修改正在运行的 `D:\dshwork\surfcore` 安装目录。

## 4. 第一次环境准备

### 4.1 检查

```powershell
node -v
git --version
Test-Path D:\dshwork\surfcore
Get-Content D:\dshwork\surfcore\package.json -Raw | ConvertFrom-Json | Select-Object version
```

- 没有 Git：安装 Git for Windows；
- Node 版本与运行 SurfCore 的版本保持一致（建议 20+）。

### 4.2 拉源码

```powershell
git clone --branch dev https://github.com/Mieksido/surfcore.git D:\dshwork\surfcore-dev
cd D:\dshwork\surfcore-dev
git log --oneline -3
node -e "console.log(require('./package.json').version)"
```

如果 `github.com` 拉不动，联系协调会话要 bundle/补丁，不要从运行目录直接拷。

### 4.3 依赖与测试

```powershell
npm install
npm run test:audit
cd plugins/surfcore
npm test
cd ../..
```

已知：干净 clone 可能缺 `state/stickers.json`、生成的 preset patch 等运行期产物，个别测试会失败。
处理原则：**记录失败项，判断是否环境缺失**；不要为了让测试变绿去改断言，也不要把它当代码 bug。

### 4.4 工作分支

```powershell
git switch -c feat/opt-<topic> origin/dev
```

## 5. 工作流程

1. 从协调会话拿到 `OPT-xxx` 任务，不要自己从用户列表里挑；
2. 先写基线：改前指标（耗时/请求数/字符数/磁盘/操作步骤）；
3. 一次只改一个变量；
4. 补测试；
5. 写 `docs/cases/2026-11-04-optimize-<topic>.md`（现象/做法/指标/风险/回滚）；
6. 合并最新 dev：

```powershell
git fetch origin
git merge origin/dev
```

7. 跑完整测试；
8. 提交并推送：

```powershell
git add <明确路径>
git commit -m "opt(<topic>): <一句话>"
git push -u origin feat/opt-<topic>
```

9. 在 GitHub 开 PR：base 选 `dev`，标题 `opt: <一句话>`，描述贴指标/测试/风险；
10. 把分支名、commit、PR 链接、测试结果、指标发给协调会话，**不要自己 Merge**。

## 6. 成果怎么传回协调会话

两台电脑不共享文件、也不共享会话记忆；只传 Git 提交/补丁。

### 主通道：GitHub 分支 + PR

```powershell
git push -u origin feat/opt-<topic>
```

PR base = `dev`。协调会话会 `git fetch` 你的分支，审 diff、跑测试、合并。

### 备用 1：git bundle（不能 push 时）

```powershell
git bundle create D:\dshwork\opt-<topic>.bundle origin/dev..feat/opt-<topic>
```

把 `.bundle` 文件通过网盘/聊天文件传给用户。

### 备用 2：format-patch（小改动）

```powershell
git format-patch origin/dev..HEAD -o D:\dshwork\patches
```

### 不要

- 不要在聊天里直接贴整包源码；
- 不要打包 `node_modules`、`state/`、`config.json`；
- 不要手工复制文件“口头说改好了”。

## 7. 安全红线

提交前必须检查：

```powershell
git status --porcelain
git diff --cached --stat
git diff --cached | Select-String -Pattern 'github_pat_|ghp_|sk-|Bearer|BDUSS|consoleToken'
```

- 有 token/cookie/密钥命中就停，删除或打码，不要提交；
- 日志、截图里的 token 也要打码；
- PAT 只给 `Mieksido/surfcore` 的 **Contents: Read/Write** + **Pull requests: Read/Write**；
- 不要把 PAT 拼进 remote URL，使用 Git Credential Manager。

## 8. Dev 发布接管（当前未开放）

### 现在

你不发版。dev 构建由协调会话发布。

### 什么时候开放

满足以下全部条件后，协调会话书面授权：

- [ ] 环境审计通过（Git/Node/仓库/测试结果已报）；
- [ ] 连续 2 批优化干净交付（无返工、无越权文件）；
- [ ] 有仅限本仓库的 fine-grained PAT，放环境变量，不落盘；
- [ ] 测试/清单门禁全绿；
- [ ] 用户明确说“发”；
- [ ] 只发 dev Pre-release，版本 `0.8.8-dev.N` 自动算。

### 授权后的发布命令

```powershell
$env:GH_TOKEN = '<fine-grained PAT，仅当前终端>'
node scripts/publish-dev.mjs Mieksido/surfcore --yes
```

发布后核对 Release URL、tag、manifest 数，报给协调会话。

### 永远不允许

- 稳定版、`main`、`vX.Y.Z` tag；
- `--force` 推分支；
- 失败后连续重试轰炸 GitHub。

## 9. 第一批任务

1. **先做环境自查**，把 `node -v`、`git --version`、`npm run test:audit` 结果发回来；
2. 环境审计通过前，**不要开始写功能代码**；
3. `OPT-002`（B站视频分镜）用户已决定暂缓，不要做；
4. `OPT-003`（情绪触发 B站动态/QQ空间）只做方案与风险评估，不要写代码；
5. 后续任务由协调会话分派。

## 10. 汇报格式

每次交付发：

```text
【测试机优化交付】
任务：OPT-xxx
分支：feat/opt-<topic>
commit：<hash>
PR：<链接，可选>
改动文件：<列表>
指标：改前 → 改后
测试：test:audit N/N；插件 0 失败
风险/未验证：
是否已 merge 最新 dev：是
```

## 11. 开工确认

收到这份交接后，先回复：

```text
【测试机 DSH 开工确认】
node：
git：
仓库路径：
当前分支/commit：
test:audit：N/N（失败项：...）
插件测试：0 失败 / 失败项：...
是否已读交接与 backlog：是
申请权限：仅优化开发 / 优化 + 受限 dev 发布（暂不申请）
```

在协调会话确认环境审计通过前，不要改功能代码。
