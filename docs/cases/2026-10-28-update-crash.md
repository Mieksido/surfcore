# 2026-10-28 · 更新导致 DSH 宿主硬崩（0xFFFF7003）

> 由用户提交的崩溃分析报告整理归档；卷宗原稿见用户提供的 `SurfCore更新导致DSH崩溃分析.md`。

## 现象

- 设置页点「更新」→ 下载 `main.zip`（约 7MB）→ 解压 → **1~2 秒后整个 DSH 宿主进程消失**；
- 退出码 `0xFFFF7003`，日志无任何 JS 异常/堆栈，只有 `[crashpad] ... not connected`；
- 重启后版本号没变，**更新也没落地**；
- 两次复现：0.6.3→0.6.5（下载后约 65s 崩）、0.6.7→最新（解压完成后约 6s 崩）。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 | Windows 11 |
| DSH | Desktop 0.2.1-rc.2（Electron 44） |
| SurfCore | 0.6.7（安装目录 `D:\surfcore`） |
| 挂载 | `~/.dsh/plugins/surfcore` → junction → `D:\surfcore\plugins\surfcore` |
| 插件进程 | **在 DSH 宿主进程内**（非独立子进程） |

## 根因

`plugins/surfcore/lib/updates.js` 的 `updateFromZip()`：

```js
// 覆盖文件（保留目录本身：junction 指着它，删目录会断链）
fs.cpSync(src, dir, { recursive: true, force: true });
```

1. 这段代码跑在 **DSH 宿主进程内**；
2. `dir` 是插件自己的安装目录，也正是宿主**正在 require 的模块目录**；
3. `cpSync` 原地覆盖这些文件 → 宿主进程被终止（不是 JS 异常，`catch`/`finally` 都拦不到）；
4. 证据链：残留 `~/.dsh/surfcore/tmp-update-<ts>/`（`finally` 没执行）、plugin.log 停在
   `[updates] 下载 ...` 没有「已覆盖」、退出码 `0xFFFF7003`。

附带问题：

- `cpSync` **只覆盖不删除** → 多次升级后目录里混着旧版本残留文件；
- `qq-tool-restrict` 对每个"当前版本不存在"的工具名打一行告警 → 启动日志刷几百行。

## 修法（v0.6.12）

把「覆盖」从宿主进程里拿出去：

1. 进程内只做**下载 + 解压到 `state/staging/<id>-<ts>`**，写 `updates-pending.json`；
2. 起**独立进程** `scripts/apply-update.mjs`（detached，`waitPid` = 宿主 PID）：
   - 轮询等宿主退出（≤15 分钟）；
   - `robocopy staging target /MIR`，排除
     `state backups node_modules .git logs staging pet characters voice-packs`
     与 `config.json bili.config.json`；
   - 成功写 `updates-applied/`，失败留 `updates-pending.json.failed` + 日志；
3. git 安装同样排队（退出后 `fetch + merge --ff-only`），运行中不 merge；
4. UI 文案：「已下载，退出并重新打开 DSH 后自动应用」；
5. `qq-tool-restrict` 告警改成一条示例 + 一条汇总。

为什么选"退出后应用"而不是"原子切换 junction"（报告方案 C）：junction 切换到新目录本身
也会动宿主正在解析的路径，仍然要在宿主退出后做；而我们还需要处理 `state/` 等用户数据，
延后应用的实现更小、更容易验证。

回滚方式：`state/backups/update-<ts>.json` 记录了 from/to；重新下载对应 tag 的 zip 覆盖回去即可。

## 验证

- `scripts/apply-update.mjs` 集成测试（临时目录）：
  - staging 的新文件覆盖成功；
  - `config.json`、`state/keep.txt` **保留**；
  - 源里没有的 `old-removed.js` 被 `/MIR` **删除**；
- `npm run test:audit` 77/77；`node scripts/test-version.mjs` 通过。

## 遗留

- **0.6.11 及更早的更新器仍有此 bug**：用户必须手动覆盖一次 zip 才能到 0.6.12；
- 尚未在真实 Windows 用户的 DSH 上验证"退出后应用"的完整链路（只验证了助手脚本本身）；
- 建议补一个测试：`updates.js` 的 zip 分支断言**没有**调用 `cpSync` 到目标目录。
