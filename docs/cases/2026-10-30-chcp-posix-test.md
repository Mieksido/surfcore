# 2026-10-30 · 非 Windows 平台编码测试误报

## 现象
macOS 执行 test-console-encoding.mjs：
2 项通过，2 项失败，chcp 返回 ENOENT。

## 环境
- SurfCore：0.7.18
- 基线：ff78e1173bd2204e4becaf8cf4356be987943159
- 开发分支：feature/linux-support
- 实测系统：macOS
- 目标平台：Debian 13 AMD64

## 根因
scripts/test-console-encoding.mjs 无条件调用
Windows 专用 chcp 命令。
非 Windows 系统没有该命令，产生错误失败。

## 完整逻辑
- 链路：Node.js 直接执行编码测试脚本。
- 机制：字符编码模拟跨平台，chcp 检查仅适用于 Windows。
- 影响：测试退出失败；不涉及生产数据、密钥或网络。
- 方案比较：安装兼容命令不能验证真实 Windows 行为；
  使用平台守卫可以保留 Windows 原断言。
- 生效：仅影响测试进程，无需重启服务。

## 修法
当 process.platform !== 'win32' 时跳过 chcp 检查。
Windows 分支保留原有验证逻辑。

## 验证
- 修改前 macOS：2 通过、2 失败。
- 修改后 macOS：2 通过、0 失败。
- node --check：通过。
- git diff --check：通过。
- test-encoding.mjs：0 通过、0 失败，全部检查跳过。
- 独立 voice-tool：未覆盖。
- Debian 13.7 AMD64：隔离单项测试通过，2 通过、0 失败；语法检查通过。
- Windows：未验证。
- 完整 test:audit：未运行，避免潜在生产副作用。

## 回滚
在尚未提交且确认该文件只有本次修改时，
可通过 Git 恢复 scripts/test-console-encoding.mjs。

## 遗留
补充 Debian 隔离测试与 Windows 真机回归。
核对 voice-tool 相关检查。
不得把跳过项计为功能通过。
