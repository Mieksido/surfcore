# Linux 桥接生命周期兼容（#003）

基线：SurfCore v0.7.18，分支 feature/linux-support。

## 修改
- 启动：新增 spawn-detached.js，处理同步及异步启动错误。
- 停止：新增 linux-bridge-identity.js，检查 PID、
  Node 可执行文件、脚本、工作目录、UID、启动时间。
- Windows 原有停止流程保留。

## 已验证
- macOS 启动封装模拟测试：4/4。
- macOS PID 身份模拟测试：6/6。
- Debian 13.7 隔离环境：上述模拟测试通过。
- Debian 实际 EACCES、ENOENT：通过。
- Debian 真实 /proc 身份验证：通过。
- Debian 错误 PID 拒绝停止：通过。
- Debian 模拟桥接 SIGTERM、锁文件清理、端口关闭：通过。

## 限制
- 尚未进行真实生产 DSH / QQ 验收。
- Linux PID 校验与 kill 之间仍存在竞态窗口。
- macOS 停止流程当前不支持，待单独适配。
- Windows 真机回归未执行。
- 本测试不证明所有 Linux 插件功能兼容。
