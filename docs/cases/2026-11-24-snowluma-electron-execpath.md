# 2026-11-24 · 一键启动拉起 SnowLuma 后控制台亮一瞬就没（用 Electron 跑了 index.mjs）

## 现象

用户在 SurfCore 里点「一键启动」，界面回「已启动 SnowLuma 并打开控制台 http://127.0.0.1:5099」，
浏览器也确实打开了一下，但很快 `http://127.0.0.1:5099` 拒绝连接；「加载 QQ 账号」弹窗报
`(SNOWLUMA_WEBUI_DOWN) SnowLuma 控制台还没起来`。用户手动双击 `launcher.bat` 就一切正常。

## 环境

- Windows 11 build 26300，SnowLuma2 安装目录 `C:\Users\29765\SnowLuma2`（自带 `node.exe` 93.9MB）
- DSH `E:\deepseek\`，插件 `E:\DSH\surfcore`（Junction 到 `E:\DSH\home\plugins\surfcore`）
- 配置：`snowluma.launcherPath`/`homeDir` = `C:\Users\29765\SnowLuma2`、`allowLaunch: true`、
  `webuiPort: 5099`；未设 `launchMode`，一键启动默认隐藏控制台 → 走 `spawnSnowLumaDetached()`

## 证据链

1. 点完之后 `Get-NetTCPConnection` 只剩 3100（桥接）与 DSH 自身端口，3000/3001/5099 全无监听，
   但 `logs/snowluma-2026-11-24.log` 里明明有：
   ```
   09:36:29 INFO [App] Node integrity: pid=7388, process=High (RID=12288); EXE=unlabeled
   09:36:29 INFO [WebUI] listening http://127.0.0.1:5099
   ```
   之后没有任何 shutdown/exit 记录，进程直接消失。
2. 插件生成的启动脚本 `E:\DSH\surfcore\state\snowluma-launch.vbs` 写着：
   ```
   sh.Run """E:\deepseek\DeepSeek Harness.exe"" ""C:\Users\29765\SnowLuma2\index.mjs""", 0, False
   ```
3. `C:\Users\29765\SnowLuma2\index.mjs` 是「父进程 → 子进程」结构：`runApplication()` 里
   `child = spawn(process.execPath, [...process.execArgv, path.join(root, "index.mjs"), ...])`。
   父进程被换成 Electron 后，子进程同样被换成 Electron，SnowLuma 原生的 QQ 注入/OneBot
   适配层起不来，父进程随即退出——所以只有 WebUI 那几行日志，没有 login/Bridge 日志。
4. 同一份 `index.mjs` 用 `C:\Users\29765\SnowLuma2\node.exe` 启动（09:40:07，pid 9988）：
   3000/3001/5099 全部监听，日志出现 `[Bridge] groups loaded count=3`、
   `[OneBot] network startup applied`，桥接 `/api/status` 的 `snowluma` =
   `{"connected":true,"accountOnline":true,"good":true}`。

## 根因

插件跑在 DSH（Electron）进程里，`process.execPath` 是 `E:\deepseek\DeepSeek Harness.exe`，
不是 node。而 `spawnSnowLumaDetached()` 与「隐藏控制台 + legacy」分支都直接拿它去跑
`index.mjs`：

```js
target = `"${process.execPath}" "${entry}"`;      // 错：Electron 当运行时
spawn(process.execPath, [entry], {...});          // 错：同上
```

`nodePathEnv()` 也只把 `dirname(process.execPath)` 塞进 PATH，等于把 Electron 目录当 node 目录，
所以在 PATH 里找个 `node` 也找不到真 node。

## 修法

新增模块内的 `resolveNodeExe(appDir)`，按顺序找真正的 node：

1. `config.snowluma.nodePath`（可选覆盖，支持相对 `QQBOT_ROOT` 的路径）
2. 安装目录自带的 `<appDir>\node.exe`（SnowLuma 发行包自带，版本匹配）
3. 当前进程本身就是 node 时（`path.basename(process.execPath) === 'node.exe'`）用它
4. `PATH` 里第一个存在的 `node.exe`

`spawnSnowLumaDetached()` 与 legacy/hideConsoles 分支都改成用这个结果；找不到才回退
`cmd /d /c "launcher.bat"`（保持原有行为）。

断言（`scripts/test-launch-components.mjs`）：
`index.includes('resolveNodeExe')`，且禁止出现 `spawn(process.execPath, [entry]`。

## 验证

- 用 SnowLuma 自带 `node.exe` 按同样的 VBS 方式拉起：5099/3000/3001 同时监听（pid 9988），
  日志出现完整 Bridge 启动序列；`/get_login_info` 返回 `user_id=2259680942, nickname=三一`；
  桥接 `/api/status` 的 `snowluma.connected=true`。
- `node scripts/test-launch-components.mjs` → `✅ 一键启动/停止接线通过`
- `npm run test:audit` → 153/153
- `node scripts/release-manifest.mjs` 重新生成清单、`--verify-ref HEAD` 0 问题

## 遗留

- 改的是插件代码，**必须重启 DSH** 才会用新逻辑；重启后点「一键启动」应直接看到完整启动序列。
- 若用户以后把 SnowLuma 换成不带 `node.exe` 的发行包，会退到 `launcher.bat`（可见黑框那条路）。
- `EXE=unlabeled` 是 SnowLuma 对签名/完整性的提示，用自带 node.exe 仍为 unlabeled，
  属正常（它不是签名过的 node 发行版），不影响运行。
