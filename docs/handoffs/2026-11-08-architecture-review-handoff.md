# 架构梳理会话交接（2026-11-08）

> 交出：协调/发布会话 · 接手：架构梳理会话（本轮由用户直接驱动）
> 目标：**把 SurfCore 从入口到落盘学透 → 现场做改动 → 按 §9 的格式交回协调/发布会话发布**
> 这份文件是**开工说明**，不是资料堆。§2/§3/§8 是动作，§9 是验收格式。

---

## 0. 开场提示词（用户可整段粘贴给新会话）

```text
你是 SurfCore 的架构梳理会话。先读
D:\deepseekwork\surfcore\docs\handoffs\2026-11-08-architecture-review-handoff.md 全文，
按 §2 核对坐标、§3 的顺序读文档、§8 建独立工作树后再动代码。
改动按 §7 的边界做，按 §9 的格式交回协调/发布会话。
不要改 main、不要改 package.json 的 version、不要打 tag、不要发 Release、不要碰 GitHub。
```

---

## 1. 分工：你改代码，我管发布

| | 你（架构梳理会话） | 我（协调/发布会话） |
| --- | --- | --- |
| 工作区 | **独立 worktree** `D:\deepseekwork\surfcore-arch` | 主工作区 `D:\deepseekwork\surfcore`（只做协调/文档/发布） |
| 分支 | `feat/arch-<topic>`，从 `dev` 切 | `dev`、`main` |
| 能做的事 | 读代码、改代码、跑测试、写 case、写 release 批次 | 合并分支、重生成清单、bump、tag、GitHub Release |
| 不能做的事 | 改版本号、打 tag、发版、推远端、改 `main` | 不替你写业务代码 |

**GitHub token 你不需要，也不要问。** 只有发布会话在发布时从安全渠道取。

---

## 2. 开工先核坐标（30 秒，别跳过）

```powershell
cd D:\deepseekwork\surfcore
git status --porcelain      # 预期：空
git branch --show-current   # 预期：dev
git log --oneline -5
git worktree list
```

2026-11-08 22:5x 实测事实：

| 项 | 值 |
| --- | --- |
| 本地分支/HEAD | `dev`，本交接提交后的 HEAD（提交前是 `41f896d`） |
| 版本 | `0.8.9-dev.1` |
| 已发布稳定版 | `v0.8.9`（远端 main `0ce8580`，本地 main `dacbc1a`，**两者 SHA 不同属正常**） |
| 已发布 dev | `v0.8.9-dev.1`（Pre-release，远端 tag → `88a9237`） |
| 测试基线 | `npm run test:audit` → **153/153 scripts passed**（2026-11-08 实测） |
| live 插件 | `~/.dsh/plugins/surfcore` → junction 指向**主工作区**的 `plugins/surfcore` |
| 正在跑 | DSH 宿主多进程；QQ 桥接 node 监听 `127.0.0.1:3100` |
| C 系列 r5 | **不在本仓库**（bundle 在测试机，HEAD `9e1e5ff`），别去找、别去合 |

这四条决定了你怎么干活：**主工作区是 live 的、有人在跑、你的工作区必须是独立的。**

---

## 3. 阅读顺序（先文档后代码，别反过来）

| # | 读什么 | 为什么 / 读到什么程度 |
| --- | --- | --- |
| 1 | `AGENTS.md` | 干活纪律（自动注入，但读一遍） |
| 2 | `docs/ROADMAP.md` §0 路线守则 | 先分析、算两条路线、收益不佳就回退、不补屎山 |
| 3 | `docs/guides/ARCHITECTURE.md`（337 行） | **总纲**：进程/端口、分层、两个世界+三个引擎、6 条数据流、两套 state、三份配置、安全模型、重启矩阵 |
| 4 | `docs/guides/12-LESSONS-ARCHITECTURE.md`（295 行） | 关键链路、**状态所有权表**、不变量、脆弱点、修 bug 标准流程、重启矩阵 |
| 5 | `docs/RISK_REGISTER.md` | R1–R39：哪些已修、哪些明确接受、哪些还开着；**别重复发现** |
| 6 | `docs/PITFALLS.md` | 28 万字节，**按关键词查**，不要通读 |
| 7 | 分册按需 | `MODULE-BRIDGE`（762 行/672 处行号）、`MODULE-PLUGIN`、`MODULE-CORE-A/B`、`DATA-AND-CONFIG`、`SECURITY_BASELINE`（碰安全必读） |
| 8 | `docs/guides/MULTI-SESSION-WORKFLOW.md` | 一会话一工作树的完整规则 |

判定：读完 3+4 再碰代码；读不完就先只读排查。

---

## 4. 地图已经落后多少（这是你第一个任务）

文档自己声明：12 篇 / 8,737 行 / 3,150 处 `文件:行号`，最后核对 **2026-10-26**。

从那次核对的基线提交 `763edb3` 到现在：

```text
872 个提交（其中 625 个不是 manifest 同步提交）
319 个文件、+46,973 / −1,347 行（src + plugins + scripts）
src/ 新增 39 个文件
src/bridge.js       14,964 行（10-26）→ 17,259 行（现在，+15%）
plugins/surfcore/lib/client.js            →  8,070 行
plugins/surfcore/lib/updates.js           →  1,933 行
```

**所以：不要重写那 8,737 行。** 你的做法是：

- **A. 漂移核对**：随机抽 30 处 `文件:行号` 引用，对当前代码逐条验；统计失效率、记下偏差最大的模块。
- **B. 补 delta**：新增 `docs/guides/ARCHITECTURE-DELTA-2026-11.md`（格式可参考已有的 `docs/ARCHITECTURE-DELTA-TOKEN.md`），只写「哪里变了、现在在哪、怎么验证」。
- **C. 定点修正**：已经在读的模块，顺手把错行号/错结论改对（小提交）。
- **D. 再改代码**：只有把这块的链路、状态所有权、失败点都写清楚了，才动代码。

10-26 之后的大块新东西（地图大概率没写或写浅了）：向量记忆与 embedding 包、SnowLuma 启动器/端口后移、更新器 apply/verify、token 额度与成本标签、C 系列 provider 写入（未合，不在本仓库）。

---

## 5. 六个深水区：先读这里，性价比最高

| 文件 | 行数 | 里面是什么 |
| --- | --- | --- |
| `src/bridge.js` | 17,259 | 桥接内核：启动序列、入站/出站全链路、会话映射、控制台端点（R7 记 153 条分支）、安全闸门、定时器、单实例锁 |
| `plugins/surfcore/lib/client.js` | 8,070 | 设置页 UI：14 个标签、控件↔配置键↔API |
| `plugins/surfcore/lib/index.js` | 4,371 | 宿主插件：装配顺序、配置模型（脱敏/原子写/备份）、设置页 API、B站调度器接线、桥接自愈 |
| `plugins/surfcore/lib/updates.js` | 1,933 | 更新：版本比较、staging、校验、失败码 |
| `plugins/surfcore/lib/scheduler.js` | 1,321 | B站 tick：生物钟、私信、动态、场景模型 |
| `src/memory-card.js` 2,193 · `purpose-engine.js` 2,179 · `mcp-snowluma-safe.js` 1,479 · `voice-packs.js` 1,232 · `token-ledger.js` 1,143 | | 记忆卡 / 目的机制 / MCP 工具面 / 语音包 / token 账本 |

**读法**（每个深水区都这样）：
1. 找入口（谁调用它）→ 2. 找状态所有权（它写哪些文件/字段，谁读）→ 3. 找失败分支（`ok:false` 时发生什么）→ 4. 找测试（`scripts/test-*.mjs` 里谁钉住它）。

`src/` 77 个 js 文件，`scripts/` 175 个 `test-*.mjs`；`test:audit` 只是其中一部分，改哪个模块就跑哪个。

---

## 6. 「学清楚了」的可验收标准

不是"读完了"，而是能**不看代码**回答下面三问，并给出 `文件:行号`：

1. 一条 QQ 群消息从 SnowLuma 进来到回复发出去，经过哪些进程/文件/状态？每一步的失败点和用户可见表现是什么？
2. 在设置页点一个开关，从控件 → API → 配置落盘 → 谁读它 → 要重启什么？在哪一步可能静默失败？
3. B站 tick 一次「醒来」做了什么？额度在哪扣、怎么防重复、失败后下一次会不会重复扣？

配套产出五张图（可以直接放进 delta 文档）：

- 进程/端口拓扑（含动态端口与 SnowLuma）
- 消息入站链路
- 回复出站链路
- 状态所有权（两套 state / 三份配置 / 角色包，谁写谁读、能不能删）
- 重启矩阵（改什么 → 重启什么 → 不重启会怎样）

**每条结论必须带 `文件:行号` + 一句话 + 怎么验证。** 写"我记得"的一律删掉。

---

## 7. 改动边界

### 7.1 值得改（有证据就动手）

- 文档与代码不符（行号、结论、过时描述）；
- 死代码、重复实现、两套协议并存；
- 契约不一致（前端调用路径 ⊄ 宿主路由、错误码被上层覆盖）；
- 失败路径静默（只写日志、`ok:false` 被吞、没有 `code/hint`）；
- 小范围重构：单文件 ≤ 30 行改动，或新增一个小模块并给它测试。

### 7.2 先别动（除非用户点名）

- `main`、`package.json` 的 version、tag、Release；
- `release/install-manifest.json`（**我在合并后统一重生成；你分支上它变旧是正常的，别手工解冲突**）；
- 三份配置的默认值与用户数据：`config.json`、`~/.dsh/surfcore/*`、`bili.config.json`；
- C 系列的 5 个 P0（那是测试机会话的活，避免撞车）；
- `app.asar` 补丁脚本（`scripts/patch-dsh-session-guard.mjs` / `install-session-guard.mjs`）与 ACL 收紧脚本；
- **大规模拆 `bridge.js` / `client.js`**：容易变成"在错地基上叠 300 行"，先出方案和收益对比，别直接拆。

### 7.3 改行为必须一起交

1. `npm run test:audit` 通过；碰协议/桥接加 `npm run test:regressions`；碰插件加 `cd plugins/surfcore; npm test`（长链路，先跑一遍当基线）；
2. 失败路径可见：`ok:false` + `code` + `error` + `hint`，前端必须展示（见 `docs/guides/ERROR-REPORTING.md`）；新增失败分支至少一条断言钉住 `code` 与 `hint`；
3. `docs/cases/*.md`（模板 `docs/cases/_TEMPLATE.md`），写完整逻辑七步；
4. 在 `docs/RELEASE-QUEUE.md`「待发布」下追加带时间戳 + 覆盖提交的批次（内含可直接复制的交接块）。

**没有 case 和 release 批次的提交，我不会合。**

---

## 8. 工作树、分支、提交

```powershell
cd D:\deepseekwork\surfcore
git status --porcelain                 # 必须干净
git worktree add ..\surfcore-arch -b feat/arch-<topic> dev
cd ..\surfcore-arch
npm install                            # 需要时；已有 node_modules 可跳过
npm run test:audit                     # 先拿自己的绿色基线
```

规则：

- **禁止** `git add -A` / `git add .` / `git commit -a`；只 add 明确路径，提交前 `git diff --cached --stat` 核对没有别人的文件；
- 提交信息写「现象 + 修法」，不要 `update`/`fix`；
- 一个可合并单元一个提交（代码 + 测试 + case 可以放在同一批）；
- 收工前从**最新 dev** `git merge dev` 一次，解决冲突（别 rebase 已共享的分支）；
- 主工作区脏文件不全是你的 → 停手，别 `switch/checkout/reset/stash/clean`。

### 运行时串行（重要）

- **重启 DSH 会中断所有会话（包括本协调会话）**；重启 QQ 桥接会停掉正在进行的收发。
- 要重启 / 发 QQ 消息 / 写 `~/.dsh` / 起服务，先在会话里说明「做什么、预期、失败后果」，确认没人在发布或写盘再做。
- live 插件现在指向**主工作区**：你在 `surfcore-arch` 改的 `client.js` **不会**出现在正在运行的界面里。要看效果需要重新构建 + 重启 DSH —— 这一步找我协调，不要自己切 junction 或重启。

---

## 9. 交回格式（我按这个合并）

```text
【交接：架构梳理】
分支 / worktree：
commit（tip）：
范围（一句话）：
改到的文件（git diff --stat）：
为什么改（现象 → 根因 → 影响面 → 修法 → 验证）：
测试：test:audit N/N；test:regressions；插件测试；新增/修改的 test-*.mjs
未验证 / 风险 / 需要真机确认的点：
文档：docs/cases/xxx.md；docs/RELEASE-QUEUE.md 批次位置
回滚：git revert <hash>；是否碰过运行时文件（state/~/.dsh）
```

我收到后：

1. `git show --stat` / `git log dev..feat/arch-*` 核对范围，确认没混入别人的提交；
2. 在独立目录复跑测试（不污染主工作区）；
3. `git merge --no-ff feat/arch-<topic>` 进 `dev`；
4. 从合并后的 HEAD 重生成 `release/install-manifest.json` 并单独提交；
5. 更新 `docs/COORDINATION.md` 与 `docs/HANDOFF.md`；
6. 发布要等用户明确说「发」，版本号由用户定。

---

## 10. 已知雷区（先看，能省你半天）

1. **端口会漂移**（见过 3080 / 48994 / 57981 / 现在的 56828）：用 `discoverDshBaseUrl()` 或 `state/dsh-port.json`，别硬编码。
2. **两套 state、三份配置**：仓库 `state/` 是 QQ 桥接的，`~/.dsh/surfcore/` 是插件的；改之前先确认你改的是哪一套。
3. **令牌红线**：`config.json`、`state/` 里有真 token/BDUSS/consoleToken，**禁止打印、禁止贴进日志或回复**；输出前脱敏。
4. **DSH 一升级就覆盖 `app.asar`**：所有本地补丁消失，升级后先 `npm run guard:check`。
5. **`state/` 是运行时数据不是草稿纸**：别往里放一次性脚本/截图。
6. **C 系列不在本仓库**：`surfcore-c-opt-2026-11-08-r5.bundle` 在测试机；那几个 P0（两文件事务、YAML 冲突检测、YAML 预校验、API code 透传、checksum 完整性）不归你。
7. **175 个 test-*.mjs 不是全在门禁里**：改完模块要自己找对应测试，别只看 `test:audit` 绿。
8. **别用「探针」代替阅读**：`probe:*`、`setup-dsh.mjs`、`start*.bat` 会发消息/写 `~/.dsh`，默认不跑。

---

## 11. 第一小时 checklist

- [ ] 读 `AGENTS.md` + `ROADMAP §0` + `ARCHITECTURE.md` + `12-LESSONS`（约 40 分钟）
- [ ] `git status` / `worktree list` 确认干净、没人和你抢
- [ ] 画进程/端口图，标出 3 个你还没搞懂的点（这三个就是第一天的目标）
- [ ] 抽查 5 处 `文件:行号`，估一下失效率
- [ ] 建 worktree + 分支，跑 `npm run test:audit` 拿绿色基线
- [ ] 选第一个改动点：小、可验证、能写测试；先写分析再动手
- [ ] 把「我准备改 X、因为 Y、验证 Z」发给协调会话（除非用户直接让你改）

---

## 12. 一句话

**先把地图校准到今天的代码，再在有证据的地方做小改动；每次交回都带分支、测试、case、回滚——合并与发布我来。**
