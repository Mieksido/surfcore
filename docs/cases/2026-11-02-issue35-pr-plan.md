# Issue #35 临时 PR 文档（本地分支，待用户审查后按分支提 PR）

> 本文件是编辑会话产物：三个本地分支已就绪，**未 push、未建远程 PR、未 bump/tag**。
> 用户本地验证通过后，按下面的 PR 描述逐分支创建（合并顺序 PR1 → PR2 → PR3）。
> 生成时间：2026-11-02 17:40（Asia/Shanghai）；基线：`main @ 59ec306`（v0.8.6）。

---

## PR1 — 根治：客户端包单 Loader 来源

**分支**：`fix/issue-35-pr1-loader-merge`（3 个提交：`52a2630` / `76b6877` / `e82edd0`）
**性质**：P0，必合；独立可回滚（`git revert 52a2630 76b6877` + 重启 DSH）

**标题**：
```
fix(#35): 客户端包单 Loader 来源——qq-mode 行并入主行，命名空间迁至 surfcore
```

**PR 描述**：

> ## 问题
> surfcore 与任何改写/重放 `modules` Loader 行的客户端插件（如 `dsh-vision-router@3.1.0`）同时启用时，
> DSH Desktop 启动即崩：`ClientPackageCompositionError: package surfcore resolves from multiple active
> Loader sources` → `modules` 是 required 插件 → `DesktopHostFatalError`。0.6.x–0.8.1 全线可复现；
> 单独启用 surfcore 从不崩（冷启动走宽松路径只 warn，modules fiber 重建走构造期严格校验必 fatal）。
>
> ## 根因
> `cordis.patch.yml` 的两条行（`- id: surfcore` 与 `- id: qq-mode / name: ./lib/qq-mode.js`）都解析到
> 声明了 `dsh.client.platform: "web"` 的同一个包，违反 DSH client-modules 的单包单来源约束
> （`reconcilePackage`，client/modules src/index.ts:1042-1054）。
>
> ## 修法（A1）
> - `cordis.patch.yml` 只留主行；`mode`/`ownerQQ` 的 `Config` 并进主模块（`inject` 增 `settings`）。
> - DSH settings 命名空间由 **entry id** 推导（已核对 settings src/index.ts:315,382），合并后命名空间
>   `qq-mode` → `surfcore`；四处消费点切换（`src/bridge.js` 读写、`lib/index.js` 概览/GET/POST mode），读侧保留旧名过渡兜底。
> - 删除 `lib/qq-mode.js` 与 `"./qq-mode"` export。
> - **一次性迁移** `lib/qq-mode-migrate.js`：只读解析 profile patch 里旧 `qq-mode` volatile 覆盖行 →
>   只补 `surfcore` 命名空间缺失的字段 → 经 `settings.update('surfcore')` 写回（插件不改写用户文件）→
>   **update 成功后才写 marker**（`~/.dsh/surfcore/qq-mode-migrated.json`）；失败下次重试；空 `ownerQQ` 不迁；noop 也幂等收尾。
> - **结构不变量哨兵** `scripts/test-qq-mode-plugin.mjs`：按 DSH 语义重演来源解析
>   （exactPackageSpecifier + nearestPackage 上溯 + 子路径跳过），断言「解析到 surfcore 的 Loader 行 === 1」——
>   将来再加第二条行必报警。
> - 迁移行为测试 `scripts/test-qq-mode-migrate.mjs`（10 例：marker 时序/幂等/不覆盖新值/失败不写 marker/ENOENT=noop）。
>
> ## 验证
> `npm run test:audit` 108/109（唯一失败 `test-update-apply-result.mjs` 为预存在 flaky：干净 main 6 跑 3 挂随机
> ENOENT，与本次无关；单跑稳定通过）；`test:regressions` / `test:plugin` / `plugins/surfcore npm test` 全绿；
> `release-manifest --verify-ref HEAD` 通过。
>
> ## 用户可见变化
> DSH 设置页原独立「qq-mode」表单消失，mode/ownerQQ 并入 surfcore 表单（功能不变，仅归位）。
>
> ## 回滚
> `git revert 52a2630 76b6877` + 重启 DSH；已迁移值在 surfcore 命名空间仍有效。

---

## PR2 — 预检：体检规则 COMPAT_CLIENT_MULTI_SOURCE

**分支**：`feat/issue-35-pr2-compat-check`（2 个提交：`e834473` / `3975ea2`；基于 PR1）
**性质**：P1，可独立回滚（`git revert e834473 3975ea2`）

**标题**：
```
feat(#35): 体检新增 COMPAT_CLIENT_MULTI_SOURCE——安装前预检客户端包多 Loader 来源
```

**PR 描述**：

> ## 内容
> 1. **先修扫描器盲区**：patch 文件发现从「固定文件名 `dsh.bundle.patch.yml`」（DSH 根本不认的约定）改为读
>    package.json 的 `dsh.bundle.patch` 声明（字符串或数组；app-boot profile.ts:58-64 是 DSH 唯一支持形式），
>    旧文件名降级为历史夹具兼容。此前扫描器连 surfcore 自己的 `cordis.patch.yml` 都扫不到。
> 2. **新规则** `COMPAT_CLIENT_MULTI_SOURCE`（blocker / confirmed）：按 DSH 来源解析语义重演
>    （同名行跨文件重复 = cordis 覆盖合并不误报；profile patch 裸 `{id,name}` 覆盖行也参与计数；
>    子路径/内建说明符跳过），同一「声明 `dsh.client.platform=web`」的包被 ≥2 个不同行名解析 →
>    报冲突行、来源文件与可执行修法（合并 Config 到一行）。解析不了的行如实计入 `coverage.unchecked`，不冒充已确认。
>
> ## 边界（重要）
> 体检运行于安装/配置变更时点，**拦不住启动期 fatal**——根治靠 PR1 的结构修复；本规则把
> 「装完才发现开不了机」提前成「装前体检红字」。
>
> ## 测试
> `scripts/test-compat-multi-source.mjs` 十例：单一来源 / 同名同源 / 同包不同源（#35 原始形态）/
> 不同包 / 非 web 包 / 子路径守卫行 / bundle patch 数组与字符串声明 / 坏 YAML fail-open / 真实 profile 自检。
> `npm run test:audit` 108/110（新增本测试后；两个失败均为预存在 flaky，单跑稳定通过）。

---

## PR3 — 文档治理

**分支**：`docs/issue-35-pr3-governance`（1 个提交：`7f21d2a`；基于 PR2）
**性质**：P2，纯文档

**标题**：
```
docs(#35): 治理记录——PITFALLS #101、HANDOFF 三分支快照、ROADMAP 条目、RELEASE-QUEUE 批次与交接块
```

**内容**：PITFALLS #101（单包单来源四条关键事实 + 两条错误路径）、HANDOFF 顶部快照（实机验收清单、
预存在 flaky 说明、autocrlf 假阳性坑）、ROADMAP §2 条目（分支未发布状态如实标注）、
RELEASE-QUEUE 批次（含可复制交接块）。

---

## 实机验收清单（用户在场授权后执行，铁律 #4）

- [ ] 重启 DSH 正常启动；无新增 `phase: startup` crash 日志
- [ ] DSH 设置页：surfcore 表单出现 mode/ownerQQ；原独立 qq-mode 表单消失（预期变化）
- [ ] 设置页/控制台切模式生效且 5 秒内不被回滚；桥接日志无 settings 写穿失败告警
- [ ] 把 `dsh-vision-router@3.1.0` 加回 `dsh.profile.bundles` 再重启 → **不再崩溃**（本 bug 验收标准）
- [ ] `~/.dsh/surfcore/qq-mode-migrated.json` 存在（本机无旧行 → `status: noop`）
- [ ] 设置页「插件体检」对正常 profile 不报 `COMPAT_CLIENT_MULTI_SOURCE`；对带第二条行的夹具报 blocker

## 遗留（不在本次范围）

- 预存在 flaky 两个：`test-update-apply-result.mjs`（8.3 短路径 TEMP vs `show-toplevel` 长路径比较）、
  `test-voice-cloud-credentials.mjs`（偶发）——建议另开任务修。
- 其它用户 profile 里的旧 `qq-mode` 持久化行：迁移逻辑已实现并被夹具覆盖，真实机器表现待发布后反馈。
