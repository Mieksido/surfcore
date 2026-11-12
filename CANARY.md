# SurfCore 0.8.9-dev.5 · 内核 + UI 壳（覆盖旧入口，客户端立即加载）

这是**测试机构建**，不是稳定版，也不是完整的 SurfCore。

## 这次的关键变化
- UI 直接随包覆写旧的 `plugins/surfcore` 入口；DSH profile 里已经登记过 `surfcore`，所以**更新 + 重启 DSH 就会加载新 UI**。
- 修复 dev.4 的问题：给壳的 `dsh.client` 加了 `immediately: true`，让 UI 在启动时就注册侧边栏，而不是等设置页打开。
- 包内同时带 `kernel/`、`runtime/`。
- 不含旧 `src/bridge.js`、旧 QQ/B站/桌宠代码、旧 UI、`packs/`。

## 更新后
1. DSH 更新通道切 **dev** → 检查更新 → 装 `0.8.9-dev.5`。
2. **完全退出 DSH 再启动**。
3. 左上角应直接出现 `SurfCore` 内核面板。

不需要 `install-ui.mjs`，不需要改 DSH profile。

## 预期与边界
- `plugins/surfcore/lib/index.js` 是**临时宿主壳**（空 `apply`）：只负责让 DSH 加载 UI，**不启动内核**。
- UI 的记忆/语音页需要 `/surfcore-api/*`；这个壳没有后端，会显示「后端待接入」。
- 更新器 `robocopy /E` 只覆盖、不删除；旧 `src/` 里的文件可能仍在磁盘，但旧 `plugins/surfcore/lib/index.js` / `lib/client.js` 已被覆写。
- 稳定通道不受影响（Pre-release 不进 `/releases/latest`）。

## 回滚
- 外部备份：`surfcore-all.bundle` + `~/.dsh/surfcore`（2026-11-12）。
- 恢复旧 `plugins/surfcore/` 后重启 DSH。
