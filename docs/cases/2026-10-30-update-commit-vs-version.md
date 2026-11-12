# 2026-10-30 · 更新弹窗显示「v0.7.13 → 提交 c2205d4」、下载失败、反复弹

## 现象

- 0.7.13（zip 安装）用户，远端已有 v0.7.16，但更新弹窗只显示「v0.7.13 → 提交 c2205d4」；
- 点「立即更新」→ `download.network`（fetch failed）；
- 关掉后过一会儿又弹；
- 网络诊断：`github.com` 超时（20s），`codeload.github.com` / `api.github.com` 正常。

## 根因（与清单哈希无关，是新的一类）

1. **版本发现跳过 tag 查询**：有提交记录时 `remoteVer` 被跳过；唯一兜底是 `releases/latest` 的 302（走 `github.com`），
   不通就退化成提交号 → 界面显示「提交 c2205d4」，且完全看不到 v0.7.16。
2. **下载只押 `github.com`**：`isSemver=false` → `github.com/.../main.zip`，没有 codeload 直连、没有镜像回退。
3. **失败后不进退避**：`download.network` 是应用阶段失败，不写 `blocked`、不写 `dismissed`，下次检查照弹。

## 修法

| 层 | 改动 |
| --- | --- |
| 版本发现 | 取不到版本时先查 `api.github.com/tags`（不依赖 github.com），再退 302 |
| 下载 | 走 `codeload.github.com/.../zip/refs/tags/vX.Y.Z` 直连；失败依次试 github 归档、gh-proxy、ghproxy；`diagnostics.tried` 记录试过的地址 |
| 目标校验 | `latestVersion` 不是 `x.y.z` → `blocked(version-unknown)`，不装 main 快照（那会"版本号永远不变"） |
| 重复弹窗 | `applyBackoff`：下载/网络类失败后 30 分钟内不再自动弹同一条；手动检查仍能看到结果 |
| 配置尊重 | 组件显式配了 `archiveUrl` 时只试它，不额外加镜像 |

## 验证

- `test-update-version-fallback`：github.com 不通、api tags 可用 → 显示 `0.7.16` 而不是提交号；
- `test-update-apply-result`：codeload 失败回退归档、非 semver 阻止、失败后退避与持久化；
- audit 86/86；插件测试全绿。

## 教训

**版本发现、下载、失败退避是三件独立的事**，任何一环押在单点（域名/一次查询/一条状态）都会放大成“用户点了没用”。
