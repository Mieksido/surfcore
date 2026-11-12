# SurfCore 0.8.9-dev.3 · 人格内核 + UI canary

这是**测试机构建**，不是稳定版，也不是完整的 SurfCore。

## 包含
- `kernel/`：人格内核（记忆 / 目的 / 时机 / 表达 / 工具面 / 预算 / 身份 / 语音决策）
- `runtime/`：大适配器（管道 / 宿主 / 白名单 / 发件箱）
- `surfcore-ui/`：**新的 SurfCore 内核面板 UI 插件**（`@local/surfcore-ui`）
- `install-ui.mjs`：把 UI 登记进本机 DSH profile 的一次性脚本
- 没有旧 `src/bridge.js`、旧 `plugins/`、旧 UI
- 没有 `packs/`（QQ / B站 / 桌宠 / web 都不在包里）
- 没有新宿主 `host/`（尚未编写）

## 更新后怎么让 UI 出现（关键）

DSH 的插件列表来自 profile 的 `package.json`，**更新包不会改 profile**。所以更新完还要跑一次：

```powershell
cd <SurfCore 安装目录>
node install-ui.mjs
# 如果自动找不到 profile：
node install-ui.mjs --profile desktop
```

脚本会：
- 在 profile 的 `dependencies` 里加 `@local/surfcore-ui`；
- 在 `dsh.profile.bundles` 里加 `@local/surfcore-ui`；
- 建 `node_modules/@local/surfcore-ui` 链接；
- 先备份 `package.json`（`.bak-surfcore-ui-<时间>`）。

然后：
1. **完全退出 DSH 再启动**（不是只刷新页面）；
2. 插件页里把旧的「SurfCore 控制台」关掉，只留新的「SurfCore」；
3. 再重启一次，左上角应出现新的 SurfCore 内核面板。

## 预期与边界
- 更新器是 `robocopy /E`（只覆盖、不删除），旧 `src/`、`plugins/` 仍会留在磁盘上；旧插件不会自己消失。
- UI 的**记忆/语音页需要宿主 API**（`/surfcore-api/*`）。测试机如果还留着旧插件，旧后端在，页面可能有数据；一旦硬切删掉旧插件，这些页会显示「后端待接入」，因为新宿主 `host/` 还没写。
- 这次仍然**不宣称架构接管成功**；只验证：包能更新、内核/UI 文件能落盘、UI 能注册并在 DSH 里出现。
- 稳定通道不受影响（Pre-release 不进 `/releases/latest`）。

## 回滚
- 外部备份：`surfcore-all.bundle` + `~/.dsh/surfcore`（本机 2026-11-12 备份）。
- 恢复旧 `src/`、`plugins/`、`public/` 后重启 DSH；profile 的 `package.json.bak-surfcore-ui-*` 可还原。
