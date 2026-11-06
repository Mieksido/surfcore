# 交接：主人私聊可读白名单群记忆（+ 两项评估结论）

> 2026-11-04 由优化会话写给发布/协调对话。**视频分镜时间线功能本轮不做**（见 §6）。
> 工作树：`D:\deepseekwork\surfcore-optimize` · 分支：`feat/optimize`（单优化会话，规则见 `docs/OPTIMIZATION-BACKLOG.md`）。

## 0. 一句话

主人私聊能读所有 QQ 白名单群的记忆；私聊记忆仍然永不进群；非主人私聊仍然只看自己；
顺带修了“无 key 旧私聊串进所有私聊块”的隐私漏洞。**默认关闭**，开启只影响主人私聊。

## 1. 改了哪些文件

| 文件 | 改动 |
| --- | --- |
| `src/memory-card.js` | `sharing` 新增 `privateReadsGroups` / `privateGroupIds` / `privateGroupLimit` / `privateGroupChars`；`visibleFor()` 私聊分支支持“仅主人私聊读白名单群”，并修无 key 旧私聊只给主人；`sectionize()` 把群记忆单独成「群里的近况」，先于 firstMet/anchors 占位；`renderMemoryCard()` 群近况独立字数预算、插在 footer 前、不挤私聊主块；`saveMemoryCardOutputs()` / `maintainMemoryCard()` 透传运行时边界 |
| `plugins/surfcore/lib/memory-card.js` | 新增 `memoryCardRuntimeSharing()`：从 QQ `config.json` 读 `ownerQQ`/`allow.groups`/`deny.groups`/`allowAllWhenEmpty`（不写回 unified config）；维护/压缩/置顶/忘记/恢复备份全部传入该边界 |
| `plugins/surfcore/lib/client.js` | 记忆页「记忆互通圈」新增：开关「主人私聊可读群记忆」+ 可读群号（留空=全部白名单群）+ 最多条数 + 群记忆字数，共 4 项可调 |
| `scripts/test-memory-sharing.mjs` | 新增/更新：默认私聊不看群；开启后主人看、非主人不看；黑名单/群号过滤/空白名单 fail closed；无 key 旧私聊只给主人；群记忆不挤私聊预算；分会话 map 一致 |
| `scripts/test-memory-card-wiring.mjs` | 钉住核心/插件/设置页三处接线（开关、运行时注入、群近况小节） |
| `docs/cases/2026-11-03-private-reads-group-memory.md` | case：现象/现状/目标语义/修法/验证/风险/回滚/没做 |
| `docs/cases/2026-11-03-optimization-baseline.md` | 优化基线表（同一分支的上一提交，一并进 dev） |
| `docs/cases/README.md` | 登记 2 行 |
| `release/install-manifest.json` | 从合并后 HEAD 重生成（684 个文件，0 问题） |
| `docs/OPTIMIZATION-BACKLOG.md` | 队列表：OPT-001 待合并；OPT-002 视频分镜「不做」；OPT-003 情绪动态/qzone「待评估」 |

## 2. 测过什么、结果

```text
node scripts/test-audit.mjs                      → 143/143（69.5s）
cd plugins/surfcore && npm test                  → 全绿（58.5s）
node scripts/test-memory-sharing.mjs             → 通过
node scripts/test-memory-card-wiring.mjs         → 通过
node scripts/test-memory-card.mjs                → 27/27
node scripts/test-callname.mjs                   → 通过
node scripts/test-console-static.mjs             → 通过
node scripts/test-release-manifest.mjs           → 通过
node scripts/release-manifest.mjs --verify-ref HEAD → 清单 684 个，问题 0 个
```

真实卡只读对比（改前→改后）：

| 指标 | 改前 | 改后（开启开关） |
| --- | --- | --- |
| 主人私聊记忆块 | 2,190 字 | 2,892 字（+702 字「群里的近况」；私聊主块分段计数不变，未被挤掉） |
| 非主人私聊记忆块 | 399 字 | 399 字，无「群里的近况」 |
| 无 key 旧私聊（13 条，来源主人） | 出现在所有私聊块 | 只出现在主人私聊块 |
| 审计 | 143/143 | 143/143 |

## 3. 建议 patch 还是 minor

- **建议 patch（0.8.9 方向）**：功能默认关闭，是可选开关；同时包含一个隐私修复（无 key 旧私聊不再串到非主人私聊），适合跟着 patch 走。
- 版本号、CHANGELOG、tag、Release 由发布会话定，本会话未 bump、未发任何东西。

## 4. 改动层级（实现层还是接口层）

- 核心过滤逻辑在 `src/memory-card.js`（内部函数 `visibleFor`/`sectionize`，未导出的接口签名加了默认参数 → 向后兼容）；
- `saveMemoryCardOutputs(paths, card, config, now, runtimeSharing)` 多了一个**带默认值的尾参**，旧调用不受影响；
- `maintainMemoryCard({ runtimeSharing })` 同理，可选参数；
- 运行时边界文件仍是 `memory-card-prompt-qq-groups.json`（字段没变，只是 `private:<ownerQQ>` 块的内容多了一节）→ 桥接 `src/bridge.js` **零改动**；
- 设置页只加控件，未改任何现有配置字段；旧配置（没有 `sharing` 新字段）按默认关闭处理。

## 5. 完整逻辑与爆炸半径（要点，全文见 case）

- **链路**：QQ 桥接写 `memory-inbox.jsonl` → 插件定时维护生成按会话记忆块 map → 桥接按 key 注入提示词。本功能只在“插件生成块”这一环加了过滤与预算，不新增进程、不新增文件格式。
- **爆炸半径**：1 个插件进程（记忆维护）× 1 个读者（桥接）× 修改的是提示词内容（静默错误=3）≈ 3。**不碰用户数据文件本身**（只读白名单/黑名单/管理员 QQ），不写回 unified config；默认关闭时行为与 0.8.8 完全一致。
- **失败路径**：白名单为空且未开 `allowAllWhenEmpty` → fail closed（不显示任何群记忆，不是全放）；管理员 QQ 未配置 → 开关无效（不生效，UI 已注明）；群记忆写入失败 → 沿用现有 `saveMemoryCardOutputs` 的原子写失败即保留旧文件，桥接继续读旧块。测试钉住了 fail closed 分支。
- **取舍**：群记忆独立成节 + 独立字数预算，而不是并进私聊主块——因为 5 个群合计约 10,400 字，并进去会把私聊自己的记忆挤到只剩几条（实测 25 条私聊行被挤到 3 条），独立预算后主块不变、群近况 700 字封顶。

## 6. 两项已评估、本轮不做的

| 建议 | 结论 | 一句话原因 |
| --- | --- | --- |
| B站 看视频接 `dsh-video-storyboard` + “几分几秒发生了什么”时间线日志 | **不做（暂缓，用户 2026-11-04 决定）** | 方向合理、插件可用（Apache-2.0，npm 0.6.5），但需要新增工具通道 + 时间线数据模型 + 时间码校验 + 视觉 token 预算策略，属于中等结构改动；本轮先不做 |
| 情绪触发 B站 动态发布 / QQ 空间说说 | **待评估（等用户定）** | 两份分析已给用户：情绪门是小结构+内容但阈值需重标定；qzone 是全新公开发布通道、风险高。均未动代码 |

> 视频分镜的完整分析在会话记录里；如后续要做，先从“本地 mp4 → storyboard CLI(`strategy=brief`) → 时间线日志”的最小闭环开始，并先解决时间码校验与 QQ 工具守卫。

## 7. 还有什么没验证

- 真实 QQ 私聊场景的人工验收（我用真实卡做的只读渲染对比，没在线上跑过一轮真对话）；
- `client.js` 设置页控件在真机上的保存→生效回环（`test-console-static` 只做了静态断言）；
- 与 MC / 平台分支对 `client.js`、`src/memory-card.js` 的改动是否重叠——请协调会话合并前核对（这两个文件在本分支都有改动）；
- 37 条无 key 的旧 `qq-owner` 记录仍未迁移（历史上就没有归属，本轮只修了“串号”，没做回填）。

## 8. 环境备注（发布会话不必处理，只是知情）

- 本工作树 `node_modules` 原来是空 junction（主工作区同名目录也是空的），我本地跑过 `npm install --ignore-scripts` 并执行了 `node scripts/patch-snowluma-sdk.mjs` 才能跑绿测试；`package-lock.json` 已 `git restore`，未进提交。
- 工作树根出现了一个 gitignored 的 `config.json`（非本会话创建、未提交），`git status` 干净。

## 9. 交给发布对话的合并请求

```text
【合并请求】
分支：feat/optimize
commit：<见下，本分支 HEAD>
范围：主人私聊可读白名单群记忆（默认关）+ 无 key 旧私聊串号修复 + 设置页 4 项可调 + 基线表与 backlog 登记
改到的文件：
  src/memory-card.js
  plugins/surfcore/lib/memory-card.js
  plugins/surfcore/lib/client.js
  scripts/test-memory-sharing.mjs
  scripts/test-memory-card-wiring.mjs
  docs/cases/2026-11-03-private-reads-group-memory.md
  docs/cases/2026-11-03-optimization-baseline.md
  docs/cases/README.md
  docs/OPTIMIZATION-BACKLOG.md
  docs/handoffs/2026-11-04-optimize-memory-handoff.md
  release/install-manifest.json（合并后已重生成，684 个，0 问题）
测试：test:audit 143/143；插件测试 0 失败；memory-sharing / wiring / memory-card / callname / console-static / release-manifest 通过
指标：主人私聊块 2190→2892 字（+702 群近况，主块不挤）；非主人私聊 399 字无群块
风险/未验证：默认关闭零影响；开启后群友的话会出现在主人私聊；真机私聊验收未做；client.js 与平台分支重叠待核对
是否已 merge 最新 dev：是（已含 dev@8d76f49；合并后清单已从合并 HEAD 重生成并 verify 0 问题）
```

发布对话收到后按惯例：`git merge --no-ff feat/optimize` → 从合并后的 HEAD 重生成清单 → 跑三条门禁 → 定版本/发版；并更新 `docs/COORDINATION.md` 中优化会话那一行。
