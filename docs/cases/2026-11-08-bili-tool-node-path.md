# B站 自主任务静默哑火：提示里的裸 `node` 写盘 EPERM

## 现象

- 2026-11-08 12:00 那轮「2 类 · 游戏 AI 二创」：`debrief` 一进来就 EPERM 退出
  （封面下载、字幕缓存写不进去），`daily --go` 也写不了 `daily-dynamic.json`。
- 她（agent）照提示敲的命令是 `node "…\bili.mjs" …`；插件自己的定时、监听一切正常，
  只有"她亲手执行"的那一步全挂。
- 用户视角：某个时段的动态没发出去、日志里只有 EPERM；数据不丢，但整轮静默失败。
- 影响面：四类动态、夜间逛、倾听、搭话 —— 所有自主回合里"她要敲命令"的环节。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 / DSH 版本 | Windows 11 / DSH 0.2.1-rc.5（端口漂移到 65273） |
| SurfCore 版本 | 0.8.9（zip 安装副本，`E:\deepseek\surfcore`，junction 到 `~/.dsh/plugins/surfcore`） |
| 安装方式 | zip |
| 其它 | 该机 `PATH` 里第一个 `node` = `E:\deepseek\qq\node.exe`（QQ 自带）；系统未安装 git |

## 根因

- 位置：`plugins/surfcore/lib/scheduler.js` 的 `TOOL_CMD = \`node "${biliMjs}"\``（原 902 行）。
- 链条：`scheduler.dynTick/tick` 拼提示文本 → `promptBili()` 塞进她的会话 → 她照着提示执行
  `node bili.mjs …` → 命中 PATH 上的 QQ node → 写任何文件都 `EPERM` → 命令 exit 1，
  debrief/daily/quota 全写不进。
- 为什么 QQ node 会这样：同一份 `node.exe` 复制到别的目录启动就一切正常，只有从
  `E:\deepseek\qq\` 原位置启动的进程被套了"写受限 token"（具体来源未深挖）。
- 为什么之前没发现：插件内部 `execFile(NODE_EXE, …)` 用的是 `findNodeExe()` 解析出的真 node，
  所以"插件自己跑"永远没事；**只有 agent 按提示敲** 才中。开发机 PATH 正常时也复现不了。

## 完整逻辑（给用户看的那一遍）

- **链路**：`scheduler`（插件宿主内）→ 提示文本里的 `TOOL_CMD` → agent 的 shell →
  `node bili.mjs <子命令>` → 写 `characters/<id>/bili/*.json` 与 `~/.dsh/shots/**` → 失败 exit 1。
  读这条链的还有：`runBili()`（内部 execFile，走 `findNodeExe()`，健康）、`toolLine()`（每条提示都引用它）。
- **机制**：`TOOL_CMD` 是唯一的"教她怎么敲命令"的来源。它写死裸 `node`，等于把宿主 PATH 的
  偶然性带进每一条自主任务；而写盘权限是**进程级**的，不随命令参数变化。
- **爆炸半径**：四类动态/天 + 夜间流程 + 倾听 + 搭话 ≈ 每天 5~10 次自主回合 × 静默失败（3）→ 高。
  不碰密钥、不花钱，但会让"她在过日子"这件事整体失真。
- **取舍**：
  - A 改系统 PATH / 删 QQ node：影响全局、要重启、别的程序可能依赖它 → 否。
  - B 提示里改用 `findNodeExe()` 的绝对路径（与插件内部一致）：局部、可回滚、不碰系统 → 选 B。
- **生效与重启**：`scheduler.js` 由插件宿主加载；重启插件 / DSH 后生效（2026-11-08 12:23 重启已生效）。

## 修法

```js
// plugins/surfcore/lib/scheduler.js
const TOOL_CMD = `& "${NODE_EXE}" "${biliMjs}"`   // NODE_EXE = findNodeExe()
```

- 同文件 7 处给她的 `node bili.mjs …` 文案改成 `bili.mjs …`（约定见 `toolLine()`）；
  启动测试提示改成 `${tools} selftest`。
- `&` 前缀是 PowerShell 调用"带引号的完整路径"的必需写法（否则 `Unexpected token`）。
- 为什么没选更简单的"只改 PATH"：见上文取舍 A。
- 回滚：把 `TOOL_CMD` 改回 `` `node "${biliMjs}"` `` 即可，无数据迁移。

## 验证

```text
node --check plugins/surfcore/lib/scheduler.js
node plugins/surfcore/scripts/test-bili-automation.mjs
node plugins/surfcore/scripts/test-automation-config-api.mjs
node plugins/surfcore/scripts/test-kind-signals.mjs
```

- 实测命令形态：`& "<findNodeExe 结果>" "…\bili.mjs" quota status` 正常输出。
- 重启后 `~/.dsh/surfcore/plugin.log` 出现「自主生物钟已启动」即新代码已加载。

## 影响面 / 残留

- 本机只在安装副本修了（该目录无 `.git`），插件升级会被覆盖 → 需同步到 `dev` 分支。
- `E:\deepseek\qq\node.exe` 为什么被写限制没查到底；换机器可能换成别的路径，但
  `findNodeExe()` 的解析逻辑与机器无关。
- 别的机器若提示里被写过裸 `node`，同样受益于这次改动。
