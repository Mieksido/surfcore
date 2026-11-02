# zip 安装首次自动更新被 evidence-insufficient 卡死

日期：2026-11-02

对应：GitHub issue #16

## 现象

0.7.4 zip 解压安装升级 0.7.8：

- 检查更新正常发现新版本；
- 点「立即更新」失败，版本不动；
- 旧版 `verifyStaging` 报：
  ```text
  安装包与清单不一致（audio/cloud-test.wav、docs/...）
  ```
- 即使清单修好，preflight 仍会报：
  ```text
  evidence-insufficient
  ```

## 根因（历史）

1. `release-manifest.mjs` 读 Windows 工作区字节，清单是 CRLF；GitHub archive 是 LF → 90/92 哈希不符。
2. 清单枚举工作区，混入 `.gitignore` 的 `audio/`、`_backups/`、`obs-diag.json` → 121 项 zip 里不存在。
3. zip 安装没有 `.installed-manifest.json` / `.installed-meta.json` → preflight 永远拒绝。
4. 0.7.8 的“自愈”代码装在 0.7.8 里，0.7.4 升不上去就用不到 → bootstrap 死锁。

## 当前状态

### 已修（当前主线）

- `release-manifest.mjs` 已改为：
  - `git ls-tree` 枚举 HEAD 跟踪文件；
  - `git cat-file` 读 blob 字节；
  - 不再读工作区，不再混入 gitignore。
- 当前验证：
  ```text
  node scripts/release-manifest.mjs --verify-ref HEAD
  → 清单 641 个，跟踪文件 641 个，问题 0 个
  ```
- LF archive 验证：
  ```text
  node scripts/release-manifest.mjs --verify <LF 解压目录>
  → ok 641 | 不符 0 | 缺失 0
  ```
- `verifyStaging` 对“包内缺清单文件”只 log，不直接判失败（旧清单/分支差异不误杀）。

### 本批新增

1. `updates.js` 新增 `isTrustedZipInstall(dir)`：
   - 没有 `.git`；
   - 根 `package.json` 的 `name === 'surfcore'`。
2. `apply(ids, { firstInstall: true })`：
   - 默认仍然拒绝无证据更新；
   - 只有 UI 显式确认后，才允许首次 zip 更新；
   - 进入覆盖前仍走 `backupTarget()`，先备份所有将被覆盖的文件。
3. `inspectVersionComponent` / `check` 支持 `firstInstall`：
   - 仅在显式确认时把“可信 zip 目录”视为可迁移；
   - 检查阶段不会再把首次更新提前标成 blocked。
4. 设置页错误卡新增：
   ```text
   首次更新（先备份）
   ```
   点击后 `window.confirm`，再调用 `applySelected({ firstInstall: true })`。
5. API `action=apply` 接收 `firstInstall`。
6. 回归测试：
   - 默认无证据仍 blocked；
   - 显式 `firstInstall: true` 成功进入 pending_restart；
   - 覆盖前确实生成 backup；
   - UI/API 接线。

## 没有做

- 没有改 `verifyStaging` 的“缺文件只 log”策略：现有测试明确要求旧清单缺文件不误杀。
- 没有检查包内“多出来的文件”：manifest 只描述要覆盖的文件，额外文件不处理。
- 没有给 manifest 加签名；校验只能防损坏，不能防整包替换。
- 没有改 0.7.4 本身：0.7.4 用户仍需在设置页点一次「首次更新（先备份）」（或手动覆盖一次）。

## 风险

- `firstInstall` 是显式逃生口：只对 `package.json.name === surfcore` 且无 `.git` 的目录开放；伪造目录仍可能被用户确认，但不会自动发生。
- 备份的是“将被覆盖的 manifest 文件”，不是整个目录；目录里用户自建、且不在新 manifest 的文件不会被备份/删除。
- 首次更新后仍要等 DSH 退出，由 `scripts/apply-update.mjs` 写 `.installed-*`；中途失败会保留 backup 和 pending。
- `verifyStaging` 缺文件仍可能产生“新文件 + 旧文件”混合目录；已保留诊断日志，但未升级为失败。
- 没有真实 0.7.4 zip live 环境测试；测试用 fixture 覆盖。

## 验证

```text
node scripts/test-update-apply-result.mjs
node scripts/test-update-version-fallback.mjs
node scripts/test-release-manifest.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
