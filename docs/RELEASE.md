# 发布流程（RELEASE）

> 用途：把「改代码」和「发版本」拆成两件事，避免发布会话依赖记忆、或把半成品发出去。
> 本文件是唯一权威；任何会话发布前都必须重读这里 + 现读仓库状态。

## 一、会话分工（硬约束）

> **2026-11-01 起：dev/main 双分支（用户拍板 A 方案）**
>
> - `dev`：集货区。所有日常修复/功能/文档都提交到这里；**不 bump、不打 tag、不发 Release、不推公开仓库**。
> - `main`：稳定线，只放已发布状态。只接受「发布会话从 dev 合并」和「hotfix」两类提交。
> - 发布会话：`git checkout main` → `git merge --no-ff dev` → 跑三条门禁 → bump/commit/tag/Release
>   → **把 main 合回 dev**（`git checkout dev && git merge --no-ff main`）。
> - 公开仓库/镜像**只同步 main**；zip 用户不会拿到半成品。需要志愿者测试时发 **GitHub Pre-release**
>   （`/releases/latest` 天然忽略 prerelease，不打扰稳定用户）。

| 会话 | 负责 | 禁止 |
| --- | --- | --- |
| **发布会话**（本会话） | 合并 dev→main、定版本号、写 CHANGELOG、同步公开仓库、打 tag、发 Release、验证线上、发完把 main 合回 dev | 不在没测绿、没提交时发布 |
| **编辑会话** | 改代码、加测试、写 `docs/cases/*.md`、提交到 **`dev`** | **不改 `package.json` 的 `version`**、不打 tag、不推公开仓库、不跑发布脚本、不直接提交到 `main` |

编辑会话完成一个修复后，向发布会话交接（**每次改动都要有，不能只在对话里说**）：

```
改了哪些文件 / 测过什么、结果如何 / 建议 patch 还是 minor / case 文档路径 /
改动层级（实现层还是接口层；接口是否向后兼容）/ 完整逻辑与爆炸半径（case 里「完整逻辑」段）/
失败路径（用户看到什么、下一步点什么、有没有失败分支测试）/ 还有什么没验证
```


### dev 构建（测试通道，2026-11-01）

- 在 `dev` 分支上运行：`GH_TOKEN=... node scripts/publish-dev.mjs --yes`；
- 版本规则：stable `0.8.6` 不变；dev 构建是 `0.8.6-dev.1 / dev.2 …`（同号下**低于**正式版）；
- 只创建 **Pre-release** + `dev` 分支 + tag；`/releases/latest` 忽略 Pre-release，稳定用户零打扰；
- 测试机在「检查更新」下面单选 **dev**；切回 **main** 会清掉旧检查结果，不会再被 dev 弹窗打扰；
- dev 构建同样要过清单门禁（脚本内部 `--verify-ref HEAD`）。

## 一·五、防复发门禁（2026-10-30，每次发版必跑）

发布链路出过三次同类事故：清单与发布物不同源 → 用户下载的包永远校验失败 →
自动更新 100% 不可用、弹窗反复出现。以下三条是**硬门禁**：

| # | 门禁 | 命令 | 通过标准 |
| --- | --- | --- | --- |
| 1 | 清单由 git blob 生成 | `node scripts/release-manifest.mjs` | 工作区干净；输出 `source=git HEAD` |
| 2 | 清单与提交逐字节一致 | `node scripts/release-manifest.mjs --verify-ref HEAD` | `问题 0 个` |
| 3 | 发布物与清单一致 | 下载 tag 归档 → `node scripts/release-manifest.mjs --verify <dir>` | `不符 0 / 缺失 0` |
| 3b | 归档下载不可达时的备用核对 | `GH_TOKEN=... node scripts/verify-remote-manifest.mjs <repo> vX.Y.Z` | `一致 504 / 不符 0 / 缺失 0` |

**发布脚本纪律**：`scripts/publish-via-api.mjs` 必须用 `git show HEAD:<path>` 取内容上传；
禁止读工作区文件（Windows CRLF → 远端仓库 CRLF → 校验必失败）。

**镜像同步纪律**：`sync_mirror.py` 从 git 对象写字节，不复制工作区文件；dotfiles（`.gitignore`）
必须在白名单里。

**失败排查口径**：用户报"点了更新版本不变"时，先看 `lastApplyFailure.code`：
`verify.staging-mismatch` = 发布侧问题（别让用户重试，手动下载 + 修链路）；
`evidence-insufficient` = 缺安装证据；`download.*` = 网络/镜像。

## 二、发布前检查（发布会话逐条做，不许凭记忆）

```bash
cd D:\deepseekwork\surfcore
git status --porcelain          # 必须干净，或有明确列出的待发文件
git log --oneline -5            # 确认最近提交都是要发的
node -e "console.log(require('./package.json').version)"   # 当前版本
npm run test:audit              # 必须全绿（当前 95/95；新增/删除测试后同步这个数）
cd plugins/surfcore && npm test # 必须 0 失败
```

然后向用户确认：**版本号 + 发布范围（哪些仓库）**。

## 二·五、命名规则（2026-10-31 用户反馈）

**GitHub Release 的 title 只写版本号，不带括号描述**：

```
✅ SurfCore v0.8.0
❌ SurfCore v0.8.0（群分层 + 人格语气 + 智能拆分 + …）
```

- 具体改了什么写在 Release 的 **body** 与 CHANGELOG，不要塞进标题；
- tag 名固定 `vX.Y.Z`；
- 本地提交信息可以是 `release: vX.Y.Z`，不要堆功能清单。

## 三、发布步骤

0. **先提交、再生成清单**（2026-10-30 事故）：
   ```bash
   git status --porcelain        # 必须干净
   node scripts/release-manifest.mjs   # 只列 git 跟踪文件；工作区脏时脚本会报错退出
   ```
   清单必须与 GitHub 归档内容一致，否则客户端校验会失败、自动更新全部不可用。

1. **bump**（用户给定版本号时，检查是否与 `version.mjs` 建议一致）：
   ```bash
   node scripts/version.mjs bump patch   # 或 minor
   ```
2. **写 CHANGELOG**：`## [x.y.z] - YYYY-MM-DD`，`### 修复 / 新增 / 变更`，
   末尾加 `> 调查记录：[标题](docs/cases/xxx.md)`。
3. **提交本地**：`git add -A && git commit -m "release: vX.Y.Z（一句话）"`。
4. **同步公开仓库** `D:\deepseekwork\opensource\surfcore`：
   逐个 `cp` 本次改动的文件（不要整目录覆盖），提交、`git tag -a vX.Y.Z`。
5. **推送**（`github.com:443` 常不通，用 GitHub Data API）：
   ```bash
   GH_TOKEN=... node /tmp/pub.mjs Mieksido/surfcore D:/deepseekwork/opensource/surfcore \
     --since <上次公开仓库 commit> --message "release: vX.Y.Z（...）"
   ```
   注意：`/tmp/pub.mjs` 是 `scripts/publish-via-api.mjs` 的副本；中文路径必须 `core.quotePath=false`（脚本已处理）。
6. **打 tag + 发 Release**（`api.github.com` 可用）：tag ref → release JSON（写在文件里，**不要用 bash 反引号**）。
7. **验证**：`releases/latest` 返回新版本；`main` 的 commit 与本地一致；`git status` 干净。
8. **记录**：在下面「发布记录」表里加一行。

## 四、发布记录

| 版本 | 日期 | 仓库 | main | Release |
| --- | --- | --- | --- | --- |
| v0.9.0 | 2026-11-06 | surfcore（本地已发，**未推远端**） | 221872c → f5a7e83（清单） | 待推（缺 GH_TOKEN） |
| v0.6.22 | 2026-10-28 | surfcore / surfvoicelocal / surfvoicecloud | d7f6b33 / d739c30 / f0d94d7 | https://github.com/Mieksido/surfcore/releases/tag/v0.6.22 |
| v0.6.21 | 2026-10-28 | surfcore / surfvoicelocal / surfvoicecloud | e2bae36 / a1e24be / e914462 | https://github.com/Mieksido/surfcore/releases/tag/v0.6.21 |
| v0.6.20 | 2026-10-28 | surfcore | 12975a3 | https://github.com/Mieksido/surfcore/releases/tag/v0.6.20 |
| v0.6.19 | 2026-10-28 | surfcore | 28346fd | https://github.com/Mieksido/surfcore/releases/tag/v0.6.19 |

> 更早版本见 GitHub Releases 页；本表只记最近几次，避免无限增长。

## 五、已知坑（发布相关）

1. **`github.com:443` 常被墙**：`git push` 会超时；用 `api.github.com`（Data API）推送，见上。
2. **中文文件名**：`git diff --name-status` 默认转义路径 → 发布脚本必须 `-c core.quotePath=false`。
3. **zip 通道更新是覆盖式**：`robocopy /MIR` 会删掉本地多出来的代码文件；用户本地修复必须先导出补丁。
4. **git 通道是 `merge --ff-only`**：用户本地有提交/改动会被拦，必须先 `stash` 或 `reset --hard`。
5. **token 不落文件**：`GH_TOKEN` 只在命令行环境变量里用，不写进任何提交或文档。
6. **不要用 bash 反引号写 Release body**：反引号会被 shell 执行；把 JSON 写文件再传。
7. **发布后必须验证线上**：只看到“推送成功”不算，要查 `releases/latest` 和 raw 文件。

## 六、出错怎么回滚

| 情况 | 处理 |
| --- | --- |
| 发错版本号、还没推送 | 本地 `git reset --hard HEAD~1`，重新 bump |
| 已推送错误 tag | 删远端 tag + 重新打；Release 删除后重建 |
| 公开仓库与本地不一致 | 以本地为准重新同步；不要反向覆盖本地 |
| 用户升级出问题 | 先让用户回退到上一版 zip；定位后 hotfix 出下一版，不改旧 tag |
