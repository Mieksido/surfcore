# SnowLuma 排错（注入失败 / 连不上 / 关不掉）

> SnowLuma 是第三方 QQ 运行时，本项目只负责**检测和打开**，不代装、不代注入、不代扫码
> （EULA §5.4）。这份文档只帮用户定位问题，不绕过它的授权流程。

## 零、先试这个（多数人有效）

**重启 DSH，然后等 1~2 分钟再操作。** 社区反馈里绝大多数「连接超时 / 等待连接」都是这么好的：

1. 完全退出 DSH（不是最小化）；
2. 等 1~2 分钟（让 QQ 那边残留的注入通道自己释放）；
3. 重新打开 DSH → 再点检测 / 再启动 SnowLuma。

如果重启后还是超时，再往下按表排查。

## 一、最常见的报错：`connect ETIMEDOUT \\.\pipe\mojo.<PID>.control`

**含义**：SnowLuma 想往 `QQ.exe`（PID 是它显示的那个）注入，但连不上 QQ 的命名管道
`mojo.<PID>.control` —— 注入通道没建立起来，所以状态停在「等待连接」。

按命中率排序排查：

| # | 原因 | 怎么确认 | 怎么解决 |
| --- | --- | --- | --- |
| 1 | **权限不一致**（QQ 提权运行，SnowLuma 没有） | 任务管理器 → QQ → 是否在"提权"列打勾；或 QQ 快捷方式勾了"以管理员身份运行" | **以管理员身份**运行 SnowLuma，再重新注入 |
| 2 | **注错进程** | 进程页里可能列出多个 `QQ.exe`（主进程 / 子进程 / 守护进程） | 完全退出 QQ，从 SnowLuma 里"启动 QQ"，再对**主进程**注入；或手动选 PID 最小的那个主窗口进程 |
| 3 | **版本不兼容**（QQ 更新后 SnowLuma 还没适配） | 报错前后 QQ 是否刚自动更新过 | 升级 SnowLuma 到最新；或把 QQ 回退到 SnowLuma 支持的版本 |
| 4 | **安全软件拦截**（火绒 / 360 / Defender 的"防注入"） | 拦截日志里能看到 `QQ.exe` 或 SnowLuma 路径 | 给 SnowLuma 目录 + QQ 目录加白名单，或临时关防护再注入 |
| 5 | **注入残留** | 之前注入失败过，QQ 里挂着半截模块 | SnowLuma 进程页点「卸载」→ 完全退出 QQ → 重新打开 → 再注入 |
| 6 | **路径含中文/空格** | 解压目录是 `D:\我的工具\SnowLuma 2` 之类 | 挪到 `D:\SnowLuma` 这种纯英文无空格路径 |

> 判断是否恢复：状态从「等待连接」变成「已连接」，并且控制台出现
> `[Hook] login detected` + `[OneBot.HTTP]/[OneBot.WS] listening`。

## 二、控制台端口

SnowLuma 的 WebUI/控制台端口**会漂移**（见过 5099、5100）。

- 以它启动时打印的地址为准；
- SurfCore 的诊断只看 OneBot 的 3000/3001（HTTP/WS），与控制台端口无关；
- 控制台连不上不影响桥接，只要 OneBot 那两个端口在监听。

## 三、OneBot 配置要点

| 项 | 值 |
| --- | --- |
| HTTP | `127.0.0.1:3000` |
| WebSocket | `127.0.0.1:3001` |
| accessToken | 两个 server 各有一份，**不要混用**；SurfCore 的 `snowluma.accessToken` 填 HTTP 那份 |
| 配置落盘 | `<SnowLuma>/app/config/onebot_<QQ号>.json` |

注意：`snowluma.launcherPath` 填**根目录**（里面有 `app`），`snowluma.homeDir` 填 `app` 目录
（里面有 `config`）——填反了会「装好了但检测不到」（见 [case](../cases/2026-10-28-snowluma-detect.md)）。

**2026-10-29 起**：概览页「检测已安装的 SnowLuma」右边有「浏览…」，直接选解压出来的根目录即可
（选 `app` 目录、`app\launcher.bat` 或 `SnowLuma.exe` 也会自动归一到根目录）。
检测顺序：手选路径 → 配置里的 `launcherPath`/`homeDir` → 环境变量 `SNOWLUMA_HOME`/`SNOWLUMA_DIR` →
最后才猜常见位置（用户目录 / 桌面 / 下载 / `LOCALAPPDATA\Programs` / 仓库上一级 / `Program Files`）；
认 `app\launcher.bat`、`launcher.bat`、`SnowLuma.exe`。放在中文/空格路径下仍可能影响注入（见上表第 6 条）。

## 四、为什么「有正在进行的任务，不让关」

如果 SnowLuma 是在**某个会话里被启动的**（比如让 AI 帮你起），它就是那个会话的后台任务：
会话/宿主一退出，SnowLuma 跟着断，所以界面提示"有任务在进行"。

真实案例（2026-10-28）：

```text
已完成，用时 11 秒
那个「挂起」的任务就是刚装好的 SnowLuma 本体在跑。它是个常驻进程，进程号 4580，
从 9:19 起就一直开着，现在监听 127.0.0.1:5899；我刚刚试着访问页面，它返回 200，状态正常。
它挂在后台是因为 WebUI 和后面的 OneBot 都靠这个进程活着。你要是把它关了，
网页就打不开，QQ 也连不上；所以这个别去动它。
……
之后要是想重启 SnowLuma（比如电脑重启过），双击 C:\Users\<你>\SnowLuma\start-snowluma.bat 就行。
```

**要点**：这个进程本身不能关（关了 QQ 就断），要解决的是"**它不该由会话托管**"。

### 让它脱离会话、独立运行（推荐顺序）

1. **先确认独立启动方式存在**：SnowLuma 目录里有 `start-snowluma.bat`（或 `SnowLuma.exe`），
   双击能起来、且能自动注入 + 自动登录（SnowLuma 会记住扫码状态）；
2. **关掉会话里那个挂起任务**（或等会话结束）；
3. **双击 `start-snowluma.bat`** 重新起一份——这时它是独立的顶层进程，不再属于 DSH；
4. **SurfCore 设置里关掉 `snowluma.allowLaunch`**（默认关），让它只检测、不代启动；
5. 重启 DSH 验证：QQ 仍在、桥接能连上（OneBot 3000/3001 在监听）。

### 想开机自启（不用管理员权限）

把 `start-snowluma.bat` 的快捷方式放进：

```text
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
```

不要用"计划任务 + 最高权限"那套：SnowLuma 需要和 QQ 同权限级别，提权反而会让注入失败
（见上面 ETIMEDOUT 第 1 条）。


## 五、还是不行时，抓这三样发给作者

1. SnowLuma 控制台**完整截图**（含状态文字与 PID）；
2. `<SnowLuma>/app/logs/` 下最新的日志文件（脱敏后，别带 QQ 号/token）；
3. `任务管理器 → 详细信息` 里所有 `QQ.exe` 的 PID 与"提权"列。

## 相关文档

- 安装步骤：[INSTALL.md](INSTALL.md) 第 1 步
- 检测不到的 bug 记录：[docs/cases/2026-10-28-snowluma-detect.md](../cases/2026-10-28-snowluma-detect.md)
