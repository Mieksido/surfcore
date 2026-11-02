# 2026-11-02 · Issue #35：qq-mode 第二 Loader 行与任何改写 modules 行的插件互斥，DSH 启动崩溃

> 上游 issue：[Mieksido/surfcore#35](https://github.com/Mieksido/surfcore/issues/35)（附件含崩溃日志全文）
> 修复提交：`52a2630`（根治）+ 清单同步提交；分支 `fix/issue-35-pr1-loader-merge`。

## 现象

- 用户看到：启用 `dsh-vision-router@3.1.0` 后重启 DSH，Electron 显示崩溃页后退出；卸载 vision-router 恢复。
- 复现：surfcore 正常启用 → 装 vision-router 并进入 `dsh.profile.bundles` → 重启 → 崩溃。0.6.x–0.8.1 全线可复现。
- 影响面：宿主完全起不来（最坏档）；不丢数据；卸载触发插件即可恢复。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 / DSH 版本 | Windows / `@deepseek-ai/dsh-desktop 0.2.1-rc.5`（Electron 44.7.0 / Node 24） |
| SurfCore 版本 | 0.6.x–0.8.1（结构未变，均受影响） |
| 安装方式 | `link:` 到 `~/.dsh/plugins/surfcore` |
| 触发插件 | `dsh-vision-router@3.1.0`（任何重放 `modules` 行的插件同理） |

## 根因

- 代码位置：
  - 本仓库 `plugins/surfcore/cordis.patch.yml`（旧版）：`- insert` 里有两条行——`- id: surfcore / name: surfcore` 与 `- id: qq-mode / name: ./lib/qq-mode.js`；
  - DSH `@deepseek-ai/dsh-client-modules` `packages/client/modules/src/index.ts:1042-1054`（`reconcilePackage`：同一包 ≥2 个不同行名来源 → throw）。
- 问题链条：两条 Loader 行都解析到声明了 `dsh.client.platform: "web"` 的同一个包 `surfcore`（相对路径行锚定在 patch 文件旁＝包目录内）。`modules` 是 required 插件；任何第三方 bundle 改写/重放 `modules` 行 → cordis 重建 modules fiber → `ClientModuleRegistry` 在**构造路径**上重新调和 → 抛 `ClientPackageCompositionError` → `DesktopHostFatalError` → 宿主 fail-fast。
- 为什么之前没发现：冷启动时 registry 先建、surfcore 两行后挂载，走微任务 `flush` 的宽松路径（只 `ctx.logger.warn`，`index.ts:648`）——冲突不暴露。这是 DSH 错误处理的两条路径差异（构造期 aggregate-throw vs 稳态 warn），不是 vision-router 的错。

## 完整逻辑（给用户看的那一遍）

- **链路**：bundle patch 由 DSH 装载层读取 → Loader 行 → client-modules 按「行名」调和每个客户端包 → 设置窗口 bundle 注入 Web UI。`qq-mode` 命名空间此前有 4 个消费点：`src/bridge.js` 的 `refreshMode()`（5 秒轮询读）/ 控制台写穿、`plugins/surfcore/lib/index.js` 的概览与 GET/POST mode。
- **机制**：DSH settings 命名空间由 **Loader entry 的 id** 推导（`packages/settings/settings/src/index.ts:315`、`:382`），与模块路径/导出名无关——所以「两行合并」必然改命名空间，`qq-mode` → `surfcore`。volatile 覆盖值持久化在 profile 的 `cordis.patch.yml`（`packages/boot/config-editor/src/index.ts:127`），旧行删除后 settings API 读不到它（describe 只返回 ACTIVE entry）——旧值只能从那份文件一次性搬走。
- **爆炸半径**：修复前 = 宿主 1 进程 fatal（连 Electron 崩溃页）；修复后残余风险 = 若遗漏消费点，模式读写静默回退本地 `state/mode.json`（等级 3，可自愈）。不碰用户数据删除、不碰密钥、不花钱。
- **取舍**：A1 合并两行（根治、无新发布链路）✅；A2 拆独立 host-only 包（保留 `qq-mode` id 但要动发布物/安装物/profile link 全链路——正是 0.7.1–0.7.12 连环事故的链路，否决）；C 改 DSH 上游放宽校验（动宿主装配语义，否决）。
- **生效与重启**：全部改动经 `link:` 直连仓库，**重启 DSH 即生效**，无需重装；旧值迁移在插件 `apply()` 里自动跑一次。

## 修法

- `cordis.patch.yml` 只留主行 `- id: surfcore`；头注释钉住「单包单来源」不变量与 issue 编号。
- 主模块 `lib/index.js`：新增 `Config` 导出（mode/ownerQQ，schema 与默认值原样搬自旧 `qq-mode.js`，含 schemastery CJS 的 createRequire 规避）；`inject` 增 `'settings'`。
- 4 个消费点切到 `surfcore` 命名空间（读侧保留旧 `qq-mode` 兜底：只在尚未重启的旧 DSH 进程里能读到）；写侧一律 `surfcore`。
- 删除 `lib/qq-mode.js` 与 package.json 的 `"./qq-mode"` export。
- 新增 `lib/qq-mode-migrate.js` 一次性迁移：只读解析 profile patch 里的旧 `qq-mode` volatile 覆盖行 → 只补 `surfcore` 命名空间缺失的字段 → 经 `settings.update('surfcore', …)` 写回（插件不直接改写用户配置文件）→ **update 成功后才写 marker**（`~/.dsh/surfcore/qq-mode-migrated.json`），失败下次重试；旧文件不存在/无可迁移字段也记 noop 并幂等收尾；空 `ownerQQ` 视为未设置。
- 为什么选 A1：恢复的是 DSH 的结构不变量，删除的东西多于新增（-1 模块文件、-1 条行），下一次改动更容易；A2 会为保留一个命名空间名把风险平移到发布/安装链。
- 回滚方式：`git revert` 两个提交 + 重启 DSH；已迁移的值在 `surfcore` 命名空间里仍然有效，回滚后旧 `qq-mode` 行需人工恢复（备份即 git 历史）。

## 验证

- 自动化：
  - 新增 `scripts/test-qq-mode-plugin.mjs`（重写）：按 DSH 语义重演来源解析（`exactPackageSpecifier` + nearest-package 上溯 + 子路径跳过），断言「解析到 surfcore 包的 Loader 行 === 1」、主模块导出 Config/inject、volatile 字段存在——这是「将来再加第二条行必报警」的哨兵；
  - 新增 `scripts/test-qq-mode-migrate.mjs`：10 例钉 marker 时序（update 成功后才写）/ 幂等 / 不覆盖新值 / 失败不写 marker / ENOENT 视为 noop。
  - `npm run test:audit` **108/109**（唯一失败 `test-update-apply-result.mjs` 为**预存在 flaky**：干净 main 上 6 次跑 3 次随机 ENOENT，与本次改动无关；单跑稳定通过）；`npm run test:regressions`、`npm run test:plugin`、`plugins/surfcore npm test` 全绿（preset 产物曾报漂移，为 `core.autocrlf=true` 的 smudge 假阳性，重新生成后逐字节一致）。
- 失败路径（1.7）：
  - 迁移 update 抛错 → 不写 marker、日志可见（`settings.update('surfcore') 失败（下次启动重试）`），桥接侧控制台写穿失败同样有结构化日志；
  - 测试断言了 failed 状态、无 marker、reason 前缀（`read-profile-patch:` / `settings-update:`）。
- 手工/集成验证（待实机，见下）。
- 没验证到的部分：真实 DSH 重启 + vision-router 同启复测（需用户授权重启，见 HANDOFF 待办）；其它用户 profile 里旧持久化行的真实迁移路径只被夹具覆盖。

## 遗留 / 后续

- PR2（分支 `feat/issue-35-pr2-compat-check`）：compat 体检补 `COMPAT_CLIENT_MULTI_SOURCE`，先把 `collectPackages` 的 patch 发现从「固定文件名 `dsh.bundle.patch.yml`」改成读 `package.json` 的 `dsh.bundle.patch`（字符串或数组；DSH 唯一支持的形式，`packages/boot/app-boot/src/profile.ts:58-64`）——现行扫描器连 surfcore 自己的 patch 都扫不到。
- 实机验收清单见 `docs/HANDOFF.md` 顶部。
