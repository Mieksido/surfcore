# 2026-11-06 · SnowLuma 被 DSH 更新连带杀掉 + 黑框

## 现象

1. 每次 DSH 更新完，QQ 网关就掉线：`3000/3001/5099` 全部拒绝连接，桥接一直刷「尚未连接」。
2. 插件「一键启动」会留一个黑色控制台窗口；用户关掉它 = 关掉 QQ 网关。

## 取证

```text
21:30:52  SnowLuma 日志最后一条
21:30:59  apply-update：宿主已退出，开始应用 zip
21:31:00  完成并验证 v0.8.8-dev.11
21:35:08  桥接：连不上 3000/3001
```

SnowLuma 是插件 `spawn(..., { detached: true })` 起的子进程。**Windows 上 detached 不能脱离
Job 对象**：DSH 退出 → Job 关闭 → 树里的 SnowLuma 一起结束。

黑框来自 `hideConsoles = false` 分支的 `cmd /c start "" launcher.bat`。

## 修法（补丁 07）

新增 `spawnSnowLumaDetached()`：

```text
写 state/snowluma-launch.vbs    （sh.Run "<node>" "<index.mjs>", 0, False → 窗口样式 0 = 隐藏）
用 explorer.exe 打开这个 vbs    （explorer 不在 DSH 的 Job 里，是天然的脱离点）
wscript 退出后 node 成为孤儿进程 → taskkill /T DSH 带不走它
```

`launchSnowLuma()` 默认走这条；失败（非 Windows/路径异常）自动回退旧逻辑。
想恢复旧行为：`snowluma.launchMode = "legacy"`（设置页 SnowLuma 分组可选）。
返回值新增 `launchMode` 字段（`explorer+vbs` / `legacy`），方便排障。

写 VBS 前会拒绝含引号/换行的 launcher/cwd，避免路径注入；VBS 只写状态目录，不含密码/Token。

## 怎么关掉孤儿 SnowLuma

设置 → QQ → 高级设置 → SnowLuma → 「关闭 SnowLuma」：

- 先在 5099/3000/3001 找监听 PID；
- 只结束命令行像 `index.mjs` / `SnowLuma` 的进程；
- 找不到端口时按 `SnowLuma.*index.mjs` 命令行兜底；
- 返回结束的 PID 和失败原因，不会盲杀其它 node。

## 真机验证

```text
Start-Process explorer.exe <vbs>
→ 1 秒后 3000/3001/5099 全部 LISTENING
→ 可见窗口枚举（IsWindowVisible）里没有 node 控制台
→ node 的 PPID 是已退出的 wscript（等于脱离 DSH 树）
→ WebUI http://127.0.0.1:5099/ 返回 HTTP 200
→ 桥接自动重连并补历史
```

（另外两条路测过不可用：WMI Win32_Process.Create → wscript 进程秒退、端口不起；
schtasks 计划任务在这台机器上 Last Result=1，同样起不来。explorer 方案是唯一可用的。）

## 影响面

- 只改「怎么把 SnowLuma 拉起来」，不改 OneBot 连接、不改桥接、不碰配置与数据；
- 非 Windows 平台直接回退旧逻辑。

## 验证

```
test-launch-components   通过
test-session-rollover    179 项全过
test:audit               152/152
插件测试                  0 失败
```

## 回滚

`snowluma.launchMode = "legacy"`，或删除 `spawnSnowLumaDetached` 及其调用分支。
