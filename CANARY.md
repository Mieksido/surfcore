# SurfCore 0.8.9-dev.2 · 人格内核 canary

这是**测试机构建**，不是稳定版，也不是完整的 SurfCore。

## 包含
- `kernel/`：人格内核（记忆/目的/时机/表达/工具面/预算/身份/语音决策）
- `runtime/`：大适配器（管道/宿主/白名单/发件箱）
- 没有 `src/bridge.js`，没有旧 `plugins/`，没有旧 UI
- 没有 `packs/`（QQ / B站 / 桌宠 / web 都不在包里）
- 没有新宿主 `host/`（尚未编写）

## 更新后会发生什么
- 更新器只会**覆盖**文件，不会删除旧文件（`apply-update.mjs` 用 robocopy /E）。
- 因此更新后旧 `src/`、`plugins/` 仍会留在磁盘上；DSH 可能仍加载旧插件。
- 这次只验证：包能下载、清单能校验、内核文件能落盘、版本号能变化。
- 不宣称"架构接管成功"。

## 测试机手动硬切（可选，先备份）
1. 确认外部备份可用（git bundle + ~/.dsh/surfcore）。
2. 停 DSH / 旧桥接。
3. 删除旧入口目录：`src/`、`plugins/surfcore/`、`public/`（只删这些旧代码目录，不要删 `state/`、`config.json`、`roles/`、`audio/`、`video/`）。
4. 启动 DSH：此时没有旧插件，也没有新宿主，预期"插件不加载"。
5. 回滚：恢复备份中的 `src/`、`plugins/`、`public/`，重启 DSH。

## 边界
- 这是"允许未完成版本发 dev"的一次 canary；测试机不可用是预期风险。
- 稳定通道不受影响（Pre-release 不进 `/releases/latest`）。
