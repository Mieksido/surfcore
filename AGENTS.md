# AGENTS.md — 在这个仓库干活前先读这 60 行

> DSH 会把本文件自动注入本工作区的每个会话。**别在这里写人设或业务规则**（那些在 `roles/`、`RULES.md`）；
> 这里只写「怎么在这个仓库干活，才不会把东西干坏」。
> 人设/日子：`~/AGENTS.md`；业务规则：`RULES.md`；文档索引：`docs/README.md`。

## 0. 每次开工的固定动作（顺序别改）

1. 读 [`docs/ROADMAP.md`](docs/ROADMAP.md) 顶部「路线守则」——它决定你**该不该**动手。
2. 读 [`docs/HANDOFF.md`](docs/HANDOFF.md)——上一个我做到哪、什么还没验证。
3. 带着具体问题查 [`docs/PITFALLS.md`](docs/PITFALLS.md)（踩过的坑，含复现命令）。
4. 最后再读代码。**别相信会话记忆，相信文件**：半天前的「我记得改过」通常是错的。

## 1. 十条铁律（违反任何一条都算事故）

1. **先分析，再动手**：写清「现象 → 根因 → 影响面 → 修法 → 怎么验证」。分析没到能预判失败点，就只做只读排查。
2. **先算收益再选路线**：至少比较 2 条（收益/成本/风险/回滚难度）。**收益不佳就回退换路线**，别因为「已经写了这么多」硬撑。
3. **不补屎山**：宁可回退重写 30 行，也不在错地基上叠 300 行补丁。判断标准：新代码让「下一次改动」更容易了吗？没有就别合。
4. **不盲目跑探针**：`probe:*`、`setup-dsh.mjs`、`start*.bat`、任何会启动服务/发 QQ 消息/写 `~/.dsh` 的脚本，先说明目的、预期输出、失败后果，再跑；跑完先看日志再下结论。
5. **改完必测**：至少 `npm run test:audit`；碰协议/桥接加 `npm run test:regressions`；碰插件跑对应 `plugins/surfcore/scripts/test-*.mjs`。
6. **删改必隔离**：任何删除/覆盖前先备份或 rename 到 `~/.dsh/_quarantine/`、`_backups/`。**禁止**对配置/会话/工作区做不可逆删除。
7. **密钥红线**：`config.json`、`state/`、`~/.dsh` 里的 token 不进代码、不进日志、不进回复；输出前脱敏（`********`）。
8. **文档同步**：改了行为就改文档，并把「为什么」写进 `docs/PITFALLS.md` 或 `docs/ROADMAP.md`。不写的后果是下次的我完全不知道。
9. **小步提交**：一次一件事；提交信息写「现象 + 修法」，别写 update/fix。
10. **不确定就问**：涉及删除、发布、对外发送、改用户数据时停下来问用户，不要「先做了再说」。

## 1.5 发布与编辑分开 + dev/main 双分支（2026-11-01 用户拍板 A 方案）

**版本号与发布只能在一个"发布会话"里做**；其它会话只管改代码。代码与发布之间隔一层 `dev`：

- **`dev`（集货区）**：所有日常修复/功能/文档提交到这里；可以随时 commit；**不改 `package.json` 的 version、不打 tag、不发 Release、不推公开仓库**。
  - 编辑会话只保证：`npm run test:audit` 通过 + 插件测试通过 + case 文档。
- **`main`（稳定线）**：只放"已发布"的状态。只允许两种提交：
  1. 发布会话从 `dev` 合并（`git merge --no-ff dev`）后做 release commit；
  2. 热修（安全/数据丢失/完全不可用）从 `main` 切 `hotfix/*`，修完立即 patch，再回并 `dev`。
- **发布会话流程**：`git checkout main` → 合并 dev → **现读** `git status/log/package.json` → 跑三条门禁（见 §1.8）→ bump/commit/tag/Release → **把 main 合回 dev**。
- **公开仓库/镜像只同步 `main`**：zip 用户不会拿到半成品；`dev` 留在本地（需要给志愿者测试时发 **GitHub Pre-release**，`/releases/latest` 天然忽略它）。
- 两边不要同时跑 `git` 写操作（会撞 `index.lock`）。

**判断标准**：用户可见的行为变化才需要进稳定版；纯重构/文档/实验性改动留在 dev 攒着。

## 1.6 讲透逻辑（2026-10-29 用户要求）

用户明确要求：以后每次修 bug / 加功能，都要让他看到**彻底的逻辑**，不能只报"改好了"。
交付说明按这七步写（术语与判据见 [`docs/guides/12-LESSONS-ARCHITECTURE.md`](docs/guides/12-LESSONS-ARCHITECTURE.md)）：

1. **链路**：这段代码在哪个进程/文件，上游从哪来、下游到哪去；还有谁读这个文件/接口（`grep`，不凭记忆）。
2. **机制**：为什么会这样——契约、时序、所有权、编码层面的原因，不是"哪行写错了"。
3. **爆炸半径**：进程数 × 读者数 ×（静默=3/报错=1）；是否碰用户数据、密钥、花钱。
4. **取舍**：至少两条备选路线，为什么选这条（收益/成本/风险/回滚）。
5. **生效与重启**：谁读这个文件、要重启哪个进程（重启矩阵见 12 课 §8）。
6. **验证**：命令 + 预期输出，不能只写"应该没问题"。
7. **回滚与残余**：怎么退回去、还有什么没验证。

案例文档同步写「完整逻辑」段（模板 [`docs/cases/_TEMPLATE.md`](docs/cases/_TEMPLATE.md)）。
**刚性：每次改动都必须落 `docs/cases/*.md` 记录，并给出可直接转发的发布交接块**（格式见 [`docs/RELEASE.md`](docs/RELEASE.md) 第一节）——
用户会把交接块转给发布会话；没有 case 记录或交接块的提交，不算完成。

**触发词**：用户说「好了，总结这次的改动」之类 → 在 [`docs/RELEASE-QUEUE.md`](docs/RELEASE-QUEUE.md) 的「待发布」下
追加一个**带时间戳 + 覆盖到哪个提交**的批次（内含可直接复制的交接块）；发布后由发布会话改成「已发布 vX.Y.Z」。

## 1.7 失败必须可见且可行动（2026-10-29 用户要求，刚性）

**不容忍静默错误**：每次修 bug / 加功能，失败路径和成功路径一样是交付物。

1. **看得见**：失败要出现在用户当前界面（弹窗 / 红字 / 状态点 / toast 至少其一）；只写日志 = 没做。
2. **给下一步**：错误文案说清「在哪失败 + 现在该点什么」；能自动恢复的给重试按钮。
3. **接口结构化**：`ok:false` 同时带 `code`（机器读）、`error`（人读）、`hint`（下一步）。
4. **前端不许吞**：收到 `ok:false` 必须展示，不得只 `console.log`。
5. **失败有测试**：新增失败路径至少一条断言钉住 `code` 与 `hint` 非空。

判据、弹窗/toast 选择、禁止清单见 [`docs/guides/ERROR-REPORTING.md`](docs/guides/ERROR-REPORTING.md)。

## 1.8 发布纪律：三条门禁，缺一条就不许发（2026-10-30 血泪）

三次连续事故（0.7.1–0.7.12）都出在**发布物与校验清单不同源**。以下是刚性步骤，
按顺序跑完才算发布完成；任何一条没过就停手，不要"先发了再说"。

1. **清单从 git 对象生成，不是工作区**
   ```bash
   git status --porcelain          # 必须干净
   node scripts/release-manifest.mjs            # 内容取自 HEAD 的 blob，不受 Windows CRLF 影响
   node scripts/release-manifest.mjs --verify-ref HEAD   # 必须“问题 0 个”
   ```
2. **发布走 git 对象，不是工作区文件**
   发布脚本必须是 `git show HEAD:<path>` 取内容（`scripts/publish-via-api.mjs` 已如此）；
   **禁止**把工作区字节直接 POST 给 GitHub —— 否则远端存 CRLF，客户端按 LF 校验必然失败。
3. **发完必须核对真实制品，不许只看本地**
   ```bash
   curl -sL -o a.zip https://codeload.github.com/<owner>/<repo>/zip/refs/tags/vX.Y.Z
   # 解压后
   node scripts/release-manifest.mjs --verify <解压目录>   # 必须“不符 0 / 缺失 0”
   ```
   **codeload 不可达时用备用通道**（等价证据：归档内容就是这些 blob）：
   ```bash
   GH_TOKEN=... node scripts/verify-remote-manifest.mjs <owner>/<repo> vX.Y.Z
   # 必须“一致 N / 不符 0 / 缺失 0”
   ```

**给未来的我**：如果用户反馈"点了更新版本不变"，先看 `lastApplyFailure.code`：
- `verify.staging-mismatch` → **发布侧问题**，别让用户重试，直接手动下载 + 修发布链路；
- `evidence-insufficient` → 缺安装证据，检查 `.installed-manifest.json`；
- `download.*` → 网络/镜像问题，换链路重试。

**不要**在没有 `--verify-ref` 通过、没有真实归档核对的情况下宣布"已发布"。
版本号只由用户在发布会话里定；编辑会话不得 bump/tag/推公开仓库（见 §1.5）。

## 2. 环境事实（省得重新摸一遍）

- 本机 DSH：`<DSH 安装目录>`，版本 `0.2.1-rc.5`（2026-11-01 升级；rc.5 有 welcome 握手 401/431 缺陷，已用豆包的
  `app.asar` 两处补丁绕过，见 PITFALLS #100）；用户数据 `~/.dsh`。
- Web GUI / 网关：**端口会漂移**（见过 3080 / 48994 / 57981）。用 `discoverDshBaseUrl()` 或 `state/dsh-port.json`，**别硬编码**。
- 桥接控制台：`http://127.0.0.1:3100`（需要令牌；`consoleToken`）。
- SnowLuma：第三方专有运行时，**不随仓库分发、不打包**；本程序只探测、不部署（EULA §5.4）。
- 会话日志：`~/.dsh/sessions/<项目目录>/session-<id>/session.v4.jsonl.zstd`，zstd 压缩，别当文本读。
- 本机有 ACL 类沙箱报错时：需要 `danger-full-access` 会话，别硬试（见 `~/AGENTS.md`）。

## 3. 交付定义（Done 的标准）

代码 + 测试通过 + 文档更新 + 回滚路径 + 一句话「怎么验证」+ **给用户的完整逻辑说明（按 1.6 七步）**
+ **失败路径的可见报告与建议（1.7，含失败分支测试）** + **case 记录与发布交接块（1.6 最后一段）**。缺一项都不算完成。

## 4. 现在最该知道的三件事

- **2026-10-22 事故**：一个「身份错位」的会话日志让 `workspace` 服务起不来，工作区全空、新建报 `workspaceController unavailable`。
  处置：坏文件整目录隔离 + 给 `app.asar` 打了字节级护栏补丁（`scripts/patch-dsh-session-guard.mjs`，坏文件只跳过不炸服务）。
  ⚠️ **DSH 一升级就会覆盖 `app.asar`，补丁消失** → 升级后第一件事 `npm run guard:check`。
- 旧工作区清理逻辑已从「`fs.rmSync` 硬删除」改成「rename 到 `~/.dsh/_quarantine/`」，可回滚。
- **DSH 升级后必查（升级会覆盖 `app.asar`，所有本地补丁一起消失）**：
  1) 启动是否弹 `desktop welcome: Web authentication failed`（rc.5 缺陷，见 PITFALLS #100）；
  2) `npm run guard:check` 是否变 `unpatched`（会话护栏补丁没了）；
  3) profile 里 surfcore bundle / 3 条 MCP 是否被摘（`node scripts/setup-dsh.mjs desktop` 可恢复）。
- 详细踩坑见 [`docs/PITFALLS.md`](docs/PITFALLS.md)；风险台账见 [`docs/RISK_REGISTER.md`](docs/RISK_REGISTER.md)。
