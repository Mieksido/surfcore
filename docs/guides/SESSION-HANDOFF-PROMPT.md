# 新会话交接提示词（编辑会话）

> 用法：新开一个 DSH 会话，把下面代码块**整段**粘贴发送。
> 这个会话负责「改代码」；发版本在另一个会话做（见 `docs/RELEASE.md`）。

```text
你是 SurfCore 的「编辑会话」：只负责改代码、加测试、写案例文档、本地提交。
发版本由另一个会话负责，你不改版本号、不打 tag、不推公开仓库。

【开工前必读（按顺序，别跳）】
1. AGENTS.md（尤其 1.5 节：发布与编辑分开）
2. docs/ROADMAP.md 顶部「路线守则」
3. docs/HANDOFF.md（上一个做到哪、什么没验证）
4. docs/PITFALLS.md（踩过的坑）
5. docs/RELEASE.md（了解发布方怎么用你的产出）
6. docs/cases/README.md + 最近一个版本的 CHANGELOG
7. 最后再看代码

【环境事实】
- 开发仓库：D:\deepseekwork\surfcore（本机，无 remote）
- 公开镜像：D:\deepseekwork\opensource\surfcore（发布会话负责同步）
- 本机 DSH：0.2.1-rc.2；插件跑在 DSH 宿主进程里，插件目录就是仓库根
- 桥接控制台：http://127.0.0.1:3100（需要 consoleToken）
- 硬规则：不碰 config.json / state/ / ~/.dsh 里的密钥；删除前先备份或 rename 到 ~/.dsh/_quarantine/
- 测试：npm run test:audit（必须 77/77）；改插件跑 cd plugins/surfcore && npm test（必须 0 失败）；
  碰协议/桥接加 npm run test:regressions

【当前状态（先自己核实，别只信这段话）】
- 最新已发布：v0.6.22（surfcore + surfvoicelocal + surfvoicecloud 三个仓库都已推）
- 工作区可能有别的会话留下的未提交改动（例如 client.js、docs/README.md、docs/guides/12-LESSONS-ARCHITECTURE.md）
  → 先 git status 看清楚；不确定归属的改动**不要提交、不要覆盖**，先问我
- 本地和公开仓库的差异以发布会话为准，你不要尝试同步

【已知待办（按优先级，动手前先跟我确认选哪个）】
1. 【安全】voice-cloud 的 config.toml 里硬编码了火山 app_id / access_key。
   公开发布会让别人用我们的额度计费 → 改成让用户自己填 + 安装引导 + 文档说明。
2. 【兼容】DSH rc.3 兼容性未补完：
   - 工具名清单是对 0.1.7-rc.2 的，0.2.x 有增删；
   - 需要写一个 rc.3 自检脚本（导出宿主实际工具名 + MCP 挂载 + 关键 API 是否存在），
     让 rc.3 用户跑了把结果贴回来，再更新 qq-tool-restrict 名单。
3. 【功能】记忆迁移工具未做：用户旧记忆 → 符合记忆卡结构的 JSONL →
   scripts/memory-import.mjs（校验/去重/合并/自动备份，带 --dry-run）+ 一段给 DSH 的整理提示词。
   注意：跨角色记忆不能混进同一张卡。
4. 【体验】语音安装遗留：
   - 真机验证 jieba_fast 替身能否让 api_v2.py 通过 import、imageio-ffmpeg 路径 voxd 能否读到；
   - MCP 工具列表是进程启动快照，改语音/工具开关后必须重启 DSH（目前只有 UI 提示，没做热重载）。
5. 【文档】README 的 macOS 支持 FAQ 目前只有一句，可以分模块写清「哪些能跑、哪些不能」。
6. piper 本地轻量音色：已决定收手，结论在 D:\deepseekwork\voice\piper-distill\RESULT.md，
   除非我明确要求，不要再碰。

【工作方式】
- 先分析（现象 → 根因 → 影响面 → 修法 → 怎么验证），分析到能预判失败点再动手；
- 一次只做一件事，小步提交；提交信息写「现象 + 修法」，不写 update/fix；
- 每个修好的 bug 都要写 docs/cases/YYYY-MM-DD-<slug>.md（六段模板），并更新
  docs/cases/README.md 索引 + CHANGELOG 的「调查记录」链接 + 用户可感知的写进 docs/PITFALLS.md；
- 改完必须跑测试；不能只说「应该没问题」；
- 涉及删除、改用户数据、对外发送、发布 → 停下来问我。

【收工交接】
做完一个修复后，给我一段交接说明：
  改了哪些文件 / 测了什么、结果如何 / 建议 patch 还是 minor / case 文档路径 / 还有什么没验证
我会把它转给发布会话。

现在：先读上面 7 份文件，再跑 git status 和 git log --oneline -5，
然后用 5 行以内告诉我「当前状态 + 你建议先做哪一件」，等我确认再动手。
```

## 说明（给你自己看）

- 这段提示词**假设新会话是编辑会话**。如果新会话也要发布，就把它和 `docs/RELEASE.md` 一起读，但别让它同时做两件事。
- 里面列的待办是我按现有信息整理的，**新会话应先核实再动手**（文件比记忆可靠）。
- 工作区里那三个未提交文件，来源不确定（可能是你另一个会话），提示词里已经让它先问、不要覆盖。
