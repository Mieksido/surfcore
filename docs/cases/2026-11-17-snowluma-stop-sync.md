# 一键停止只停桥接，SnowLuma 变孤儿进程

## 现象

- 用户原话（2026-11-17 18:21）：「我希望能在我于SurfCore界面内点击"一键启动"或者"停止"时能同步控制」。
- 复现步骤：
  1. 概览点「一键启动 SurfCore」（勾 QQ）→ 桥接起来，SnowLuma 被 `launchSnowLuma` 拉起，3000/3001/5099 在听；
  2. 点「一键停止（全部）」→ 只有桥接停了，`SnowLuma` 进程仍在，3000/3001/5099 继续占着；
  3. 再点「一键启动 SurfCore」→ `launchSnowLuma` 看到 3000/3001 在听，走「已登录」分支返回 `already:true`，界面看起来像「点了没反应」。
- 影响面：QQ 网关的生命周期和按钮对不上；下次一键启动不会真正重启 SnowLuma（配置改了也要手动杀进程才生效）；但不会丢数据、不花钱，恢复方式就是任务管理器结束 `node.exe`。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 / DSH 版本 | Windows 11 build 26300 / DSH 桌面版（2026-11-17 18:10 重启） |
| SurfCore 版本 | 0.8.9（`E:\DSH\surfcore`，junction 到 `E:\DSH\home\plugins\surfcore`） |
| 安装方式 | junction（改仓库即改运行副本） |
| 其它相关版本 | SnowLuma 2.4.2，安装在 `C:\Users\29765\SnowLuma2` |

## 根因

- 代码位置：
  - `plugins/surfcore/lib/index.js:3257`（`stopComponent('qq')`）：只 `await stopBridge()`，message 写死「QQ 桥接已停止（SnowLuma 本体不会被本程序关闭）」。
  - `plugins/surfcore/lib/index.js:3182`（`startComponent('qq')`）：`await launchSnowLuma({ openWebui: false, hideConsoles })` —— 启动会顺手拉起 SnowLuma。
  - `plugins/surfcore/lib/index.js:2394`（`spawnSnowLumaDetached`）：用 VBS + `explorer.exe` 把 node 变成 explorer 的孤儿进程，脱离 DSH 的 job object。
- 问题链条：
  1. 启动/停止不对称：start 会拉起 SnowLuma，stop 只停桥接；
  2. SnowLuma 是被故意做成「脱离 DSH 进程树」的（2026-11-06 事故：DSH 每次更新都会退出，spawn 的子进程会被 job object 连带杀掉，网关跟着断），所以插件手里也没有句柄，只有 `stopSnowLuma()` 能按端口 + 命令行把它找出来；
  3. 桥接停掉后，SnowLuma 继续占 3000/3001，下次 `launchSnowLuma` 的「已登录」前置判断直接返回 `already:true`，用户看到的是「启动按钮没反应」。
- 为什么之前没发现：`stopSnowLuma()` 早就写好了，但只挂在 `/bridge` 的 `stop-snowluma` 动作上（SnowLuma 自己的按钮），从来没人把「一键停止」和它接起来；测试只断言了「停止幂等成功」，没有断言 QQ 项对 SnowLuma 的处置。

## 完整逻辑（给用户看的那一遍）

- **链路**：`client.js` 的「一键停止（全部）」→ `POST /dsh-surfcore/api/bridge {action:'stop-selected', components:[voice,qq,bili,pet,vector]}` → `runLaunchAction('stop')` 按 `voice → qq → bili → pet → vector` 顺序 → `stopComponent('qq')` → `stopBridge()`（走 console `POST /bridge/stop`）→ `stopSnowLuma()`（PowerShell 扫 5099/3000/3001 的 OwningProcess，命令行匹配 `index.mjs|SnowLuma`，`taskkill /PID … /T /F`）。
- **机制**：SnowLuma 的 node 进程父级是 `explorer.exe`（VBS 拉起后 wscript 退出），不属于 DSH 的 job，DSH 重启/退出都不会带走它；所以「谁启动谁负责关闭」这条约定只能由插件自己执行。桥接只是 SnowLuma 的客户端（连 3000/3001），停桥接不影响 SnowLuma 存活。
- **爆炸半径**：1 个进程组（node + native 注入）/ 3 个端口 × 多个读者（桥接 `snowluma-conn`、MCP `@snowluma/mcp`、WebUI）→ 静默失效 3 分；不碰用户数据、不碰密钥、不花钱。
- **取舍**：
  - A：只停桥接（现状）→ 与启动不对称，孤儿进程占端口；
  - B：一键停止连 SnowLuma 一起关（本次选这条）——符合用户「同步控制」的诉求，也让「一键启动」每次都是干净的重启；
  - C：加一个 `snowluma.stopWithQq` 开关 → 多一层配置和 UI，用户明确要同步，先不加。
- **生效与重启**：`plugins/surfcore/lib/index.js` 和 `client.js` 都在 DSH 启动时载入内存，改完要重启 DSH 才会用新逻辑（client 包还要重新生成 client-modules）。

## 修法

- 改了什么：
  - `stopComponent('qq')`：先 `stopBridge()` 再 `stopSnowLuma()`，合并两边的 `ok/message/error/hint`，部分失败给 `QQ_STOP_PARTIAL`；
  - `stopSnowLuma()`：开头加 `SURFCORE_SKIP_AUTOSTART === '1'` 短路，返回 `{ok:true, skipped:true}`（测试绝不误杀开发机上真在跑的网关）；
  - `client.js` 一键启动卡片文案：删掉「不会关闭 SnowLuma 本体」，改成「一键停止会把记忆方式切回叙事，并连 SnowLuma 一起关掉（含脱离 DSH 的孤儿进程，3000/3001/5099 会一起释放）；只想停桥接就点 QQ 卡片里的「停止」」；
  - 测试：`test-platform-start-host.mjs` 断言 stop-selected 的 qq 项 `detail.snowluma.skipped === true` 且 message 提到 SnowLuma；`test-client-contract.mjs` 断言旧文案消失、新文案存在。
- 为什么选这个方案：不新增配置项；停止顺序沿用已有的 `voice → qq` 排序（先停托管的语音，再停桥接，最后收 SnowLuma），失败路径照样可见（每项独立 `ok/code/error/hint`）。
- 回滚方式：`git checkout -- plugins/surfcore/lib/index.js plugins/surfcore/lib/client.js`（或 revert 该提交）。

## 验证

- 自动化：
  ```text
  node plugins/surfcore/scripts/test-client-contract.mjs
  node plugins/surfcore/scripts/test-platform-start-host.mjs
  npm run test:audit
  ```
- 失败路径：`stopSnowLuma` 找不到进程 → `ok:true` + 「SnowLuma 本来就没在跑」；`taskkill` 失败 → `QQ_STOP_PARTIAL` + 「任务管理器结束 node.exe（SnowLuma/index.mjs）」。
- 手工/集成验证：待重启 DSH 后在概览实际点「一键停止（全部）」，确认 3000/3001/5099 消失、再点「一键启动」能重新拉起并连上（本 case 先按单元测试交付）。
- 没验证到的部分：真实按钮路径没在重启后的 DSH 里点过（需要重启 DSH 才载入新代码）。

## 遗留 / 后续

- 需要补的测试：真实进程级集成测试（起一个假 `index.mjs` 监听 5099，断言被 stop 掉）。
- 需要改的文档：无（PITFALLS #127 已记录同一根因）。
- 开机自启仍未做：SnowLuma 不随系统启动，重启电脑后需要再点一次一键启动（或后续加计划任务）。

## 验证补充（2026-11-17 18:28–18:33 实测）

用临时 harness（临时 DSH_HOME、`consolePort: 0`，所以不会碰真实桥接）直接调 `/bridge` 的
`stop-snowluma` / `start-snowluma`，`SURFCORE_SKIP_AUTOSTART=1` 载入后删掉该变量让实现走真路：

| 场景 | 结果 |
| --- | --- |
| `stop-snowluma` | `ok:true`，`stopped:[8036]` / 第二次 `[15544]`，3000/3001/5099 在 25 秒内全部关闭 |
| `start-snowluma`（legacy 分支） | `ok:true`，新实例起来，`GET :3000/get_login_info` 返回 `{"user_id":2259680942,"nickname":"三一"}` |
| `start-snowluma` + `hideConsoles:true`（detached，`platforms.hideConsoles` 默认 true） | 调用方脚本退出 30 秒后 3000 仍在监听 → 脱离 DSH 的进程不会再被宿主重启带走 |

**副作用记录**：跑 `npm run test:audit` 那几分钟里，本机桥接被重启了两次（`bridge-supervisor.log`
18:24:50、18:26:50），SnowLuma 掉线一次——有测试脚本按默认 3100/5099 端口探测真实进程。已恢复并确认
`/api/status` 的 `snowluma.connected:true`。以后跑全量测试前先确认这些脚本不会打到线上实例，
或者跑完主动检查一眼端口。

## 补充（2026-11-17 19:10）一键启动顺手打开控制台

**现象**：用户反馈「未解决，仍然需要我手动打开 http://127.0.0.1:5099」，并贴出「加载 QQ 账号」弹窗的
`(SNOWLUMA_WEBUI_DOWN) SnowLuma 控制台还没起来`。

**根因**（两个都不报错，纯静默）：
1. `startComponent('qq')` 调 `launchSnowLuma({ openWebui: false, ... })` —— 一键启动把 SnowLuma 拉起来了，
   但**明确吞掉了打开控制台**这一步；`launchSnowLuma` 内部的 3000/3001「已在运行」分支同样是 `opened: false`。
   于是浏览器里永远是「连接被拒绝」，用户只能自己去地址栏敲 5099。
2. 控制台没开 → 「加载 QQ 账号」弹窗读不到 `/snowluma/accounts` → 报 `SNOWLUMA_WEBUI_DOWN`，进程列表空白。

**修法**：
- `index.js:3200` 改成 `launchSnowLuma({ openWebui: true, ... })`，注释写明「一键启动的语义是把环境摆好」。
- `launchSnowLuma` 的「已在运行」分支改成：`const webuiUp = await portOpen(webui.port, 600, webui.host);`
  `const opened = openWebui && webuiUp ? openLocalUrl(webui.url) : false;`，返回 `{ok, already, opened, webui, webuiUp, message}`，
  message 分三种（已打开 / 已在运行 + URL / 控制台端口还没起来，稍等再点一次）。
- 测试：`scripts/test-launch-components.mjs` 钉住 `index.includes('openWebui: true')` 与 `!index.includes('openWebui: false')`。

**验证**（真实配置、不覆盖 DSH_HOME，直连 `/dsh-surfcore/api` 的 `/bridge`）：
```text
start-snowluma -> {"ok":true,"started":true,"needsAccount":true,"opened":true,
  "webui":"http://127.0.0.1:5099","launcher":"C:\\Users\\29765\\SnowLuma2\\launcher.bat","launchMode":"legacy"}
after 12s -> status.running:true port:3100 pid:23480 snowluma.connected:true accountOnline:true good:true
端口：3000/3001/5099 全部监听（OwningProcess 8168）
```
以及 `node --check index.js`、`test-launch-components`、`test-client-contract`、`test-platform-start-host` 全绿。

**爆炸半径 / 残余**：
- 一键启动现在会打开浏览器标签页；如果用户不想要，可以只关标签，不影响进程。
- 「已在运行」分支也会开控制台 → 重复点按钮会重复开标签（浏览器一般会复用同一标签或新开一个）。
- 生效仍需重启 DSH（插件代码在宿主启动时载入）。
