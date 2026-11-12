# 2026-10-28 · 点「立即更新」没反应（版本一直停在 0.6.15）

## 现象

- 用户 0.6.15，更新弹窗显示可用更新（4 个提交 → v0.6.18）；
- 点「立即更新」好几次，版本始终 0.6.15，弹窗下次还弹；
- 用户截图里能看到弹窗正常、按钮可点，没有任何报错。

## 根因

0.6.12 起，更新改成「**退出 DSH 后由独立助手应用**」：
插件把 `updates-pending.json` 写好，再 `spawn(process.execPath, ['scripts/apply-update.mjs', ...])`。

问题在 `process.execPath`：**插件跑在 DSH（Electron）宿主里，这个值是宿主可执行文件**，
而 Electron 直接跑 `.mjs` 不会当 Node 执行——**静默退出（exit 0）**，什么都不做。

实测（本机）：

```
electron.exe script.mjs                 → 无输出，exit 0
ELECTRON_RUN_AS_NODE=1 electron.exe …   → 正常按 Node 执行
```

所以助手从来没跑起来 → 覆盖从未执行 → 版本不变、弹窗反复。
（少数环境里用户 shell 自带 `ELECTRON_RUN_AS_NODE=1`，所以**部分人更新正常**，进一步掩盖了问题。）

## 修法（v0.6.19）

1. `helperSpawnEnv()`：如果 `process.execPath` 不是 `node`/`node.exe`，
   spawn 时加 `ELECTRON_RUN_AS_NODE=1`（Electron 就以 Node 模式跑）；
2. 助手启动时写 `updates-pending.json.started`；插件 2.5 秒后检查，没有就记日志提醒
   「更新助手没有启动」；
3. **启动自愈**：插件初始化时若发现 `updates-pending.json` 还在，把 `waitPid` 改成当前进程并重新排队，
   用户下次退出 DSH 就会应用；
4. 失败/成功都留证据（`.failed` / 删除 pending 与 `.started`）。

## 验证

新增 `test-update-helper-env.mjs`（已进 `npm test`）：

```
✅ Electron 宿主 → 带 ELECTRON_RUN_AS_NODE=1
✅ node.exe → 不额外加环境变量
✅ 助手真的执行了（目标目录有 package.json）
✅ 用户的 config.json 被保留
✅ 成功后 pending 被删除
✅ 成功后 .started 被清理
✅ staging 缺失时助手以非 0 退出
✅ 失败留下 .failed 证据
✅ 失败保留 pending（下次启动会重试）
```

## 遗留

- **0.6.18 及更早的用户无法自动升到 0.6.19**（他们身上的助手同样起不来）→ 必须手动覆盖一次 `main.zip`；
- 真机上「启动自愈」路径未验证（需要造一个 pending 再重启 DSH）。
