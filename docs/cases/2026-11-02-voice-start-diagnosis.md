# 云端语音包启动超时 / 乱码：先修诊断，再修启动

日期：2026-11-02

## 1. 现象

- 语音页选「云端语音包」点启动；
- 60 秒后显示：
  ```text
  启动失败：启动超时（60 秒内端口没起来）
  脚本输出：�...�...
  ```
- 用户无法判断是端口被占、Python 依赖坏了，还是配置/模型问题。

## 2. 根因

不是单一的“云端包坏了”，而是启动链路把真正的错误弄丢了：

1. `voice-cloud/run.bat` 用 `start` 拉起 Python，Python 崩在独立窗口里，桥接的 stderr 管道只收到 cmd 的一小段输出；
2. 桥接用 `String(buffer)` 按 UTF-8 解码，Windows 控制台是 GBK，于是中文错误变成乱码；
3. `start()` 只看端口，不看进程是否已经退出，所以 Python 秒崩也要傻等 60 秒；
4. 错误只保留 300 字符，真正的 traceback 可能被截掉；
5. 没有独立启动日志。

## 3. 修法（最小风险）

- 云端 manifest 增加 `directStart`：
  ```js
  directStart: { python: '.venv/Scripts/python.exe', args: ['-m', 'voxd', '--config', 'config.toml'] }
  ```
  云端不再经过 `run.bat` 的 `start`，Python 的 stdout/stderr 直接进桥接管道。
- 启动时同时收 stdout + stderr；
- 新增 `decodeProcessLog()`：UTF-8 解码失败（出现替换字符）时按 GBK 重解；
- 进程退出立即停止等待，返回 `VOICE_START_EXITED`，不再固定等 60 秒；
- 超时/早退都写：
  ```text
  state/voice-packs/<id>/logs/startup.log
  ```
- 错误信息里带完整日志路径和 `hint`；
- 云端包体积提示从 60MB 改为约 280MB（实际安装约 279MB）。

本地包仍走 `run.bat`（它本身是前台启动，不能直接套云端逻辑）。

## 4. 生效/风险

- 改的是桥接代码，重启桥接/DSH 后生效；
- 云端启动从 `run.bat` 改为直接 Python，绕过用户对 `run.bat` 的自定义；
- 如果 `.venv`/依赖坏了，仍会失败，但现在能看到真实 traceback；
- 启动日志可能含本机路径，回显时要注意脱敏；
- 超时仍保留 60 秒（本地模型加载），云端失败会提前返回；
- 没有做 `/health` 深度检查，端口起来但引擎坏的情况仍可能显示“已启动”。

## 5. 验证

```text
node scripts/test-voice-packs-default.mjs
node scripts/test-voice-cloud-credentials.mjs
node scripts/test-voice-system.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
