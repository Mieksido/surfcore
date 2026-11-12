# SurfCore 0.8.9-dev.4 · 内核 + UI 壳（覆盖旧入口）

这是**测试机构建**，不是稳定版，也不是完整的 SurfCore。

## 这次的关键变化
- UI 不再需要单独安装/登记。更新包直接覆写旧的 `plugins/surfcore` 入口：
  - `plugins/surfcore/package.json`、`lib/index.js`、`lib/client.js`、`cordis.patch.yml` 都换成新的；
  - DSH profile 里已经登记过 `surfcore`，所以**更新 + 重启 DSH 就会加载新 UI**。
- 包内同时带 `kernel/`、`runtime/`。
- 不含旧 `src/bridge.js`、旧 QQ/B站/桌宠代码、旧 UI。
- 不含 `packs/`（QQ / B站 / 桌宠 / web 都不在包里）。

## 更新后
1. DSH 更新通道切 **dev** → 检查更新 → 装 `0.8.9-dev.4`。
2. **完全退出 DSH 再启动**（不是只刷新页面）。
3. 左上角应直接出现新的 `SurfCore` 内核面板；旧的 `SurfCore 控制台` 会被这次覆写替换掉。

不需要再跑 `install-ui.mjs`，不需要改 DSH profile。

## 预期与边界
- `plugins/surfcore/lib/index.js` 是**临时宿主壳**（空 `apply`）：它只负责让 DSH 加载 UI，**不启动内核**。
- UI 的记忆/语音页需要宿主 API（`/surfcore-api/*`）：这个壳没有提供，所以会显示「后端待接入」。这是预期，等正式宿主写好后才会接上。
- 旧 `src/`、`plugins/surfcore` 里的其它旧文件可能仍留在磁盘（更新器 `robocopy /E` 只覆盖、不删除），但旧的 `lib/index.js` / `lib/client.js` 已被覆写，旧入口不会再被加载。
- 稳定通道不受影响（Pre-release 不进 `/releases/latest`）。

## 回滚
- 外部备份：`surfcore-all.bundle` + `~/.dsh/surfcore`（2026-11-12）。
- 恢复旧 `plugins/surfcore/`（package.json / lib/index.js / lib/client.js / cordis.patch.yml）后重启 DSH。
