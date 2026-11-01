# Linux-002-A：SnowLuma WebUI 跨平台打开

## 基线

- SurfCore：0.7.18
- 上游基线：ff78e1173bd2204e4becaf8cf4356be987943159
- 开发分支：feature/linux-support
- 验证环境：macOS、Debian 13.7 AMD64
- Windows 真机回归：未执行

## 问题

原 openLocalUrl() 无条件使用 Windows cmd.exe。
非 Windows 平台无法正确处理该启动方式。
原实现还可能遗漏 spawn 的异步 error 事件，
并过早将打开请求标记为成功。

## 修改

- 新增 lib/open-local-url.js。
- Windows 保留 cmd.exe 调用方式。
- macOS 使用 open。
- Linux 图形会话使用 xdg-open。
- Linux 无图形会话不尝试启动浏览器。
- 限制目标为 127.0.0.1 本地 HTTP 端口。
- 处理子进程同步异常和异步 error 事件。
- index.js 的两处调用改为 await。
- 调整提示文字，不再声称浏览器已实际显示页面。

## 实测证据

### macOS

- 独立模拟测试：8 通过、0 失败。
- JavaScript 语法检查：通过。
- 原有平台启动配置回归：通过。
- 原有插件宿主模拟回归：通过。

### Debian 13.7 AMD64

- Node.js：24.22.1。
- 通过 SurfCore-Test/isolate.sh 执行。
- 独立模拟测试：8 通过、0 失败。
- 实际无图形分支：通过，使用有效 URL。
- API 集成测试：2 通过、0 失败。
- 测试目标：start-snowluma。
- 未授权启动被拒绝。
- 模拟 WebUI 在线时 needsLogin=true、opened=false。
- API 测试使用最新版源码副本与旧测试离线依赖。
- 未连接真实 QQ，也未启动生产 SnowLuma。

## 未完成

- Windows 真机回归。
- macOS / Linux 真实图形桌面浏览器验证。
- xdg-open 启动后非零退出状态的专项验证。
- 完整 DSH 生产环境验证。
- SnowLuma 跨平台启动脚本属于 Linux-002-B。

## 语义限制

opened=true 只表示系统打开器已成功创建进程，
不能证明浏览器页面实际显示。
服务端的 127.0.0.1 不等于远程客户端的 127.0.0.1。

## 回滚

仅回滚本次新增模块、测试及 index.js 接入修改。
不得以回滚操作修改生产 DSH、QQ 或 SnowLuma。
