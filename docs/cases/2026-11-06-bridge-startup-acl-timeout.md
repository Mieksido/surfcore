# 2026-11-06 · 一键启动报「12 秒未监听」与启动黑框

## 现象

一键启动后：

```text
启动后 12 秒仍未监听控制台端口，请查看桥接日志
语音：QQ 桥接未运行
```

同时有多个命令行黑框；语音包/向量记忆有时显示「未安装」。

## 根因

1. `src/bridge.js` 的 `main()` 在 `server.listen()` **之前**同步执行
   `hardenStateDirAcl()`；ACL 走 `spawnSync icacls`，在这台机器上超时（日志：
   `spawnSync icacls ETIMEDOUT`），控制台端口迟迟不监听。
2. `plugins/surfcore/lib/bridge.js` 只等 12 秒就返回失败；桥接进程其实还在启动，
   于是 UI 先报失败，随后日志又出现「本地控制台已启动」。
3. 桥接没起来时 `launchStatus().voice` 拿不到语音包列表，UI 把空列表直接显示成
   「未安装」；向量状态同理容易被误读。
4. 黑框：SnowLuma 的 `launcher.bat` 用 `cmd /c start` 拉起，显式创建控制台；
   dev6 还没有「隐藏命令行」开关。

## 修法

- ACL 收紧移到 `server.listen` 回调之后，先让 127.0.0.1:3100 监听；
- ACL 的 `icacls` 启动路径超时从 30 秒/步收敛到 3 秒/步，失败仍走安全页手动重试；
- 桥接启动等待从 12 秒改为 30 秒，避免首次初始化误报；
- UI 对语音包状态增加 `ok === false` 判断，显示「状态未知：QQ 桥接未运行」
  而不是「未安装」；
- 隐藏命令行开关见 `2026-11-06-oneclick-vector-memory.md`：
  `platforms.hideConsoles`，默认关；勾选后 SnowLuma 不再走 `cmd /c start`。
- 黑框进一步处理：
  - SnowLuma 隐藏启动直接 `node app/index.mjs`，绕开 `launcher.bat` / cmd；
  - 云端语音用 `pythonw.exe` 代替 `python.exe`，不再弹 python 控制台；
  - Embedding runtime 优先直连 `embedding-service.mjs` / `service.mjs`，不再走 `.bat`；
  - 这些 spawn 去掉 `detached:true`，避免 Windows 为子进程创建新的可见控制台。

## 影响面

- 只改启动时序与 UI 文案，不改消息投递/会话逻辑；
- ACL 未及时收紧时安全页仍显示未完成，可手动重试；
- 不碰配置/密钥/用户数据。

## 验证

```
test-session-rollover   170 项全过（含启动顺序/30 秒/ACL 3 秒/语音状态/黑框 spawn 断言）
test:audit              152/152
插件测试                 0 失败
```

未验证：

- 真实 Windows 上勾选隐藏后 SnowLuma 内部再 `start` 的子控制台是否完全消失；
- 测试机 dev7 上桥接首次启动是否稳定 <30 秒。

## 回滚

- 把 `hardenStateDirAcl()` 移回 `main()`；
- 桥接等待恢复 24×500ms；
- 删除 `platforms.hideConsoles` 与 UI 开关；
- 不涉及版本号/tag/发布。
