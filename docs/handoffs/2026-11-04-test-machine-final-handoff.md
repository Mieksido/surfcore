# 测试机 DSH 最终交接（工作流版）

> 2026-11-04 · 协调/发布会话 → 测试机 DSH
> 本文件是**最终工作流交接**；与之前版本冲突时，以本文件为准。
> 只规定“怎么协作、怎么交、谁能做什么”，**不涉及优化内容本身**。

## 1. 角色边界

| 角色 | 负责 |
| --- | --- |
| **用户** | 决定优化做什么、优先级、验收标准 |
| **执行会话（测试机 / 本机优化会话）** | 实现、测试、写 case、做技术可行性评估 |
| **协调/发布会话（本对话）** | 分支/文件冲突协调、门禁、合并 `dev`、发布与制品核对 |

协调会话**不决定优化内容**，不评价功能好坏，不替用户排优先级。
如果任务内容有疑问，问用户，不要问协调会话。

## 2. 当前状态

| 项 | 值 |
| --- | --- |
| 稳定版 | `0.8.8` |
| 最新 dev 构建 | `0.8.8-dev.1` |
| 远端 `dev` | `404649d`（测试机当前基线） |
| 测试机开发目录 | `D:\dshwork\surfcore-dev` |
| 测试机运行目录 | `D:\dshwork\surfcore`（**只运行，不改**） |
| 测试机环境审计 | 已通过：audit 143/143、插件 0 失败 |
| bundle 通道 | 已验证可用 |
| 当前任务 | **无**；测试机待命，不要自行开工 |
| OPT-003 评估 | 仅存档，未批准；是否做由用户决定 |

## 3. 工作流

```
用户给执行会话任务
  → 执行会话在 surfcore-dev 切 feat/opt-<topic>
  → 改代码 + 测试 + case
  → 打 bundle 或 push 分支
  → 用户把 bundle/分支信息转给协调会话
  → 协调会话审范围、跑门禁、合并 dev
  → 发布仍由用户明确说“发”
```

### 执行会话做

- 从 `origin/dev` 切 `feat/opt-<topic>`；
- 只改自己任务相关的文件；
- 禁止 `git add -A`；
- 跑 `npm run test:audit`、`cd plugins/surfcore && npm test`；
- 写 `docs/cases/2026-11-04-optimize-<topic>.md`；
- 打 bundle：

```powershell
git bundle create D:\dshwork\_handoff\feat-opt-<topic>.bundle origin/dev..feat/opt-<topic>
```

- 把 bundle 路径、分支、commit、测试结果、改动文件发用户。

### 协调会话做

- fetch bundle / 分支；
- `git show --stat` 核对范围；
- 跑门禁、重生成 manifest；
- 合并 `dev`；
- 有冲突按文件所有权裁决；
- 发布另算。

## 4. 权限

| 权限 | 状态 |
| --- | --- |
| 优化开发 | ✅ 允许 |
| 创建/提交 `feat/opt-*` | ✅ 允许 |
| push 功能分支 / 开 PR | ⏸ 暂不（先 bundle） |
| 合并 `dev` | ❌ 不允许 |
| dev Pre-release 发布 | ❌ 当前未授权 |
| 稳定版 / `main` / `vX.Y.Z` tag | ❌ 永不 |

PAT 暂不发放。需要时由协调会话书面授权，且只给 feature 分支/PR 所需权限。

## 5. 硬规则

- 不改 `D:\dshwork\surfcore` 运行目录；
- 不把 `config.json`、`state/`、`~/.dsh`、token、cookie 提交/打包/贴出；
- 不原样上传 130 条聊天记录或 68 条含昵称的反馈；需要时由用户/协调会话摘要；
- 不为了让测试变绿改断言；
- 不改版本号、不打 tag、不发 Release；
- 一次只做一个任务/一批，不把多个不相关改动塞一个 bundle；
- 分支必须基于最新 `origin/dev`；如果落后，先 `git merge origin/dev`；
- 有冲突先自己解，再重跑测试。

## 6. 汇报格式

```text
【测试机交付】
任务：<用户给的任务名/编号>
分支：feat/opt-<topic>
commit：<hash>
bundle：<路径>
改动文件：<列表>
测试：test:audit N/N；插件 0 失败
风险/未验证：
是否已 merge origin/dev：是
```

## 7. 现在做什么

1. **待命**。不要自己找优化内容，不要开始写功能代码；
2. 等用户给任务；
3. 收到任务后按 §3 执行；
4. 完成后把 bundle 路径和 §6 汇报发用户，由用户转给协调会话。

## 8. 已知环境事项

- 本机 Git 是便携 MinGit，`test-release-manifest` 需要把 `mingit\cmd` 加进 PATH，否则 `spawnSync git ENOENT`；
- 干净 clone 没有 `config.json`，可用 `config.example.json` 生成本地 gitignored 配置；
- `start.bat` 的 LF/CRLF 差异会让 zip 安装和 git checkout 的测试结果不同；这是仓库已知问题，不要为此改断言；
- 任何环境问题先记录，不要用改代码的方式“绕过”。

---

**一句话**：你只管按用户给的任务写代码、跑测试、打 bundle；协调会话只管收、审、合、发。优化内容不归协调会话管。
