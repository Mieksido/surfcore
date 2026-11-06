# 交接：测试机 DSH 接管 SurfCore 功能优化（及受限 dev 发布）

> 2026-11-04 创建。给第二台电脑（测试机）上的 DSH 会话。
> 目标：让测试机承担**功能优化开发**；dev 发布权限**有条件授予**，稳定版/main 永不授予。

## 0. 权限决定（协调会话）

| 权限 | 现在 | 说明 |
| --- | --- | --- |
| 功能优化开发 | ✅ 允许 | 在测试机自己的仓库/工作树改代码、跑测试、写 case |
| 提交到功能分支 | ✅ 允许 | 只允许 `feat/opt-*`；不直接改 `dev` / `main` |
| 合并到 dev | ⛔ 暂不 | 由协调会话审范围后合并；测试机发合并请求 |
| **dev Pre-release 发布** | 🟡 **有条件允许** | 满足 §5 全部条件后，可发 `0.8.8-dev.N`；**必须先得到用户/协调会话明确“发”** |
| 稳定版 / main / tag vX.Y.Z | ⛔ 永不 | 稳定版只能协调/发布会话做 |
| 改版本号 / CHANGELOG / 发版脚本 | ⛔ 不做 | 版本号由用户定；发版脚本改动走优化队列并单独审 |

**结论**：先做“优化贡献者”；连续 2 批干净交付 + 环境审计通过后，才启用“受限 dev 发布”。稳定版权限不给。

## 1. 测试机现状（先核对，不要假设）

已知（来自 2026-11-02 验收报告）：

- Windows 11，SurfCore 是 **zip 安装**；
- 安装目录可能是 `D:\dshwork\surfcore`（以实际为准）；
- 状态目录 `~/.dsh/surfcore`，桥接控制台 `http://127.0.0.1:3100`；
- 之前这台机器**没有 git**，也没有源码仓库；只有安装后的运行目录。

开工前先回答：

```powershell
node -v
git --version
Test-Path D:\dshwork\surfcore
Get-Content D:\dshwork\surfcore\package.json -Raw | ConvertFrom-Json | Select-Object version
```

如果 `git` 不存在、或没有源码仓库，**先不要接优化任务**，先做 §2 环境准备。

## 2. 环境准备（测试机）

### 2.1 必装

- Git for Windows；
- Node.js（与运行 SurfCore 的版本一致，建议 20+）；
- 一个**独立的工作目录**，例如 `D:\dshwork\surfcore-dev`，不要直接改正在运行的安装目录。

### 2.2 获取源码

优先从公开仓库拉 `dev` 分支：

```powershell
git clone --branch dev https://github.com/Mieksido/surfcore.git D:\dshwork\surfcore-dev
cd D:\dshwork\surfcore-dev
git log --oneline -3
node -e "console.log(require('./package.json').version)"
```

如果 `github.com` 拉不动，用协调会话给的 zip/补丁同步；**不要**把运行目录里的 `config.json`、`state/`、`node_modules` 拷进仓库。

### 2.3 依赖与测试

```powershell
npm install
npm run test:audit
cd plugins/surfcore; npm test; cd ../..
```

已知：干净 clone 可能缺 `state/stickers.json`、生成的 preset patch 等运行期产物，导致个别测试失败。
处理原则：**先记录失败项，确认是不是环境缺失**；不要把“环境缺失”当代码 bug，也不要为了让测试变绿而改断言。

### 2.4 工作树

```powershell
git switch -c feat/opt-<topic> origin/dev
```

- 一个优化一个分支；
- 不直接在 `dev` 上改；
- 不 `git add -A`，只 add 自己的路径。

## 3. 允许 / 禁止

### 允许

- 改功能优化相关代码、测试、case 文档；
- 新增/修改 `scripts/test-*.mjs`（登记进 `test-audit` 时只加一行）；
- 在测试机运行 `npm run test:audit`、插件测试、手工验收；
- 提交到 `feat/opt-*` 分支；
- 发合并请求给协调会话。

### 禁止

- 直接改 `dev` / `main`；
- `git push --force`、`git reset --hard` 到别人的分支；
- 改 `package.json` 版本号、打 tag、发 Release；
- 把 `config.json`、`state/`、`~/.dsh` 的 token、cookie、日志原文提交/贴出；
- 把测试机运行目录的 `node_modules`、`state` 拷进仓库；
- 未得到“发”就运行 `publish-dev` / `publish-via-api`。

## 4. 优化工作流（测试机版）

1. 从 `docs/OPTIMIZATION-BACKLOG.md` 取协调会话分派的 `OPT-xxx`；
2. 在 `surfcore-dev` 里切 `feat/opt-<topic>`；
3. 先写基线：改前指标（耗时/请求数/字符数/磁盘/步骤）；
4. 改一个变量，跑测试；
5. 写 `docs/cases/2026-11-04-optimize-<topic>.md`（现象/做法/指标/风险/回滚）；
6. `git merge origin/dev` 跟上最新；
7. 发合并请求：

```text
【合并请求】
分支：feat/opt-<topic>
commit：
范围：
改动文件：
指标：改前 → 改后
测试：test:audit N/N；插件 0 失败
风险/未验证：
是否已 merge 最新 dev：是
```

## 5. Dev 发布接管（有条件）

### 5.1 先决条件（缺一不可）

- [ ] 测试机有干净的 `surfcore-dev`，`git status` 干净；
- [ ] 当前 `dev` HEAD 与协调会话指定的一致；
- [ ] `npm run test:audit` 全绿；
- [ ] 插件测试 0 失败；
- [ ] `node scripts/release-manifest.mjs --verify-ref HEAD` 问题 0；
- [ ] 有一个**仅限本仓库 Contents: Read/Write** 的 fine-grained PAT，放在环境变量 `GH_TOKEN`，不写文件、不进日志；
- [ ] 用户/协调会话明确说“发 dev”；
- [ ] 只发 **Pre-release**，版本 `0.8.8-dev.N`（由 `publish-dev` 自动算，不要手填）。

### 5.2 发布命令

```powershell
$env:GH_TOKEN = '<fine-grained PAT，只在当前终端>'
node scripts/publish-dev.mjs Mieksido/surfcore --yes
```

发布后核对：

```powershell
# 应看到新的 v0.8.8-dev.N
curl.exe -s https://api.github.com/repos/Mieksido/surfcore/releases?per_page=5
```

### 5.3 发布红线

- **绝不**发稳定版、**绝不**动 `main`、**绝不**打 `vX.Y.Z` tag；
- **绝不** `--force` 推分支；
- 发布失败就停，保留日志，不要连续重试轰炸 GitHub；
- 发布成功后把 Release URL、tag、manifest 数报给协调会话；
- 若 token 可能泄露：立即在 GitHub 作废，并告知用户。

## 6. 安全红线

- 测试机上有 QQ/SnowLuma/DSH 的登录态，**仓库里绝不能出现** `config.json`、`state/`、`~/.dsh` 内容；
- 提交前跑：

```powershell
git status --porcelain
git diff --cached --stat
git diff --cached | Select-String -Pattern 'github_pat_|ghp_|sk-|Bearer|BDUSS|consoleToken'
```

- 有命中就停，删除/打码，不要提交；
- 日志/截图里出现 token 也要打码后再发。

## 7. 第一批任务

按 `docs/OPTIMIZATION-BACKLOG.md`：

- **OPT-002**：B站看视频接分镜/时间线——用户已决定**暂缓**，不要做；
- **OPT-003**：情绪触发 B站动态 / QQ空间说说——**待评估**，先不要写代码，先给方案和风险；
- 新建议由协调会话分派；优先选**不碰 `client.js` / `bridge.js`** 的独立优化。

## 8. 开工检查清单

```text
[ ] git / node 已装，版本已记录
[ ] surfcore-dev 已 clone 到 dev，工作区干净
[ ] npm install 完成
[ ] test:audit 结果已记录（含已知环境失败项）
[ ] 当前分支 feat/opt-<topic>，不是 dev/main
[ ] 没有把 config/state/token 带进仓库
[ ] 已读 docs/OPTIMIZATION-BACKLOG.md 和 docs/COORDINATION.md
[ ] 需要 dev 发布权限时，先发消息给协调会话确认
```

## 9. 优化怎么从测试机传回协调会话

两台电脑不共享文件、也不共享会话记忆；**能传递的只有 Git 提交/补丁**，不是“聊天记录”。

### 9.1 主通道：GitHub 功能分支 + PR（推荐）

测试机：

```powershell
cd D:\dshwork\surfcore-dev
git switch -c feat/opt-<topic> origin/dev
# 改代码、测试、提交
git push -u origin feat/opt-<topic>
```

然后在 GitHub 开 PR：

- base 选 **`dev`**，不要选 `main`；
- 标题写 `opt: <一句话>`；
- 描述里贴：改了什么、指标、测试结果、风险；
- **不要自己点 Merge**，等协调会话。

测试机把这三样发给用户/协调会话：

```text
分支：feat/opt-<topic>
commit：<hash>
PR：<链接，如果有>
测试：test:audit N/N；插件 0 失败
指标：改前 → 改后
```

协调会话（本机）：

```powershell
git fetch origin feat/opt-<topic>
git worktree add ..\review-opt <hash>
# 审 diff、跑测试、合并 dev
```

> 两台机器不需要“实时连接”；push 完等协调会话异步处理即可。

### 9.2 认证：用 Git Credential Manager，不把 token 写进 URL

- 测试机安装 Git 时会带 Git Credential Manager；
- `git push` 时按提示登录 GitHub，或用 fine-grained PAT 作为密码输入；
- **不要把 token 拼进 `https://<token>@github.com/...` 的 remote URL**，会留在 `.git/config` 和命令历史里；
- PAT 权限：只给 `Mieksido/surfcore` 的 **Contents: Read/Write** + **Pull requests: Read/Write**（要开 PR 才需要后者）；
- 分支推上去后是公开的，**推之前检查 diff 里没有 config/state/token**。

### 9.3 备用通道 1：Git bundle（不需要 push 权限）

测试机：

```powershell
git bundle create D:\dshwork\opt-topic.bundle origin/dev..feat/opt-<topic>
```

把 `.bundle` 文件通过网盘/聊天文件/U盘传给用户，用户放到协调会话能读到的路径。

协调会话：

```powershell
git fetch D:\path\opt-topic.bundle feat/opt-<topic>:feat/opt-<topic>
```

### 9.4 备用通道 2：format-patch（最小传输）

测试机：

```powershell
git format-patch origin/dev..HEAD -o D:\dshwork\patches
```

把 `patches` 目录打包传过来；协调会话：

```powershell
git am D:\path\patches\*.patch
```

注意：patch 不含二进制/大文件，多提交时容易漏；只适合小改动。

### 9.5 备用通道 3：GitHub API 上传（github.com 被墙时）

如果测试机 `git push` 不通、但 `api.github.com` 通：

- 用 `scripts/publish-via-api.mjs` 的同类思路，把本地分支树上传成一个远端分支；
- 这需要 PAT，且脚本要按分支参数改；默认不推荐，优先 bundle。

### 9.6 不要这样做

- 不要在聊天里直接贴一整包源码（容易漏文件/二进制/换行）；
- 不要把 `node_modules`、`state/`、`config.json` 打包发过来；
- 不要让测试机直接改 `dev` 后“口头说改好了”——没有 commit/patch，我无法审、无法复现；
- 不要两台机器各自改同一个文件再手工合并——冲突会翻倍。

### 9.7 最小交接物

测试机每次只需要给：

```text
分支名 + commit hash + PR 链接（可选）+ 测试结果 + 指标 + 风险
```

代码本身在 GitHub 分支或 bundle/patch 里，不需要在聊天里传。

