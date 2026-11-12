# 2026-11-06 · 弹窗「加载 QQ 账号」永远报 (SNOWLUMA_WEBUI_DOWN) / 「没检测到 QQ 进程」

## 现象

设置页点「加载 QQ 账号」→ 弹窗内容：

```text
加载 QQ 账密
SnowLuma 已启动，但还没加载 QQ。下面是从 SnowLuma 检测到的进程……
（SNOWLUMA_WEBUI_DOWN）SnowLuma 控制台还没起来
建议：先启动 SnowLuma；如果刚点了一键启动，等几秒再点「刷新」（http://127.0.0.1:5100）
没检测到可加载的 QQ 进程。先启动 QQ 客户端（不是 SnowLuma 设置页），再点「刷新」……
```

但当时：QQ 客户端在跑（7 个 `D:\qqtencent\QQ.exe`），SnowLuma 也在跑（3000/3001 在听）。

## 根因：WebUI 端口读错，回退到写死的 5100

`plugins/surfcore/lib/index.js` 的 `snowLumaWebui()`：

```js
const runtime = JSON.parse(fs.readFileSync(path.join(root, 'app', 'config', 'runtime.json'), 'utf8'));
if (Number(runtime?.webuiPort) > 0) port = Number(runtime.webuiPort);
```

- 本机真实配置在 `D:\SnowLuma\config\runtime.json` → `{"webuiPort": 5099, ...}`
- 代码找的是 `D:\SnowLuma\app\config\runtime.json`（**不存在**）→ 异常被吞 → 回退 5100
- SnowLuma 实际监听：`3000`（OneBot HTTP）、`3001`（WS）、**`5099`（WebUI）**
- 插件去探 5100 → 永远失败 → `SNOWLUMA_WEBUI_DOWN`
- 因为控制台不可用，进程列表必然为空 → 又显示「没检测到可加载的 QQ 进程」

净结果：**「加载 QQ 账号」这条流程在这台机器上 100% 不可用**，且给出的建议（去启动 QQ）是错的。

## 附带的文案缺陷

1. 弹窗顶部写死「SnowLuma 已启动，但还没加载 QQ」——SnowLuma 完全没跑时也这么说
   （2026-11-06 19:50 现场：SnowLuma 进程不存在、5100/3000/3001 全关，弹窗仍说"已启动"）。
2. 「没检测到可加载的 QQ 进程」把「读不到控制台」误报成「QQ 没启动」。

## 修法

1. `snowLumaWebui()`：依次尝试 `root/config/runtime.json`、`root/app/config/runtime.json`；
   读 `webuiHost`（忽略 `0.0.0.0`/`::`）；支持显式覆盖 `snowluma.webuiPort` / `snowluma.webuiUrl`；
   都没有才回退 5100。
2. 弹窗文案：`snowAccountErr.code` 以 `SNOWLUMA_WEBUI` 开头时，改说「读不到 SnowLuma 控制台（含 hint）」，
   不再说「SnowLuma 已启动」；空进程列表也改成「上面那条错误解决前这里永远是空的（和 QQ 有没有启动无关）」。

## 影响面

- 只影响 SnowLuma WebUI 的端口发现与弹窗文案；不改 OneBot 连接、不改桥接；
- 不碰用户数据与密钥。

## 验证

真机手动（本机）：

```text
D:\SnowLuma\config\runtime.json → webuiPort 5099
netstat → 127.0.0.1:5099 LISTENING（SnowLuma pid 27864）
按插件方式启动（node index.mjs，PATH 注入）→ 3000/3001 起来，桥接 20:52:00 已连接并完成任务
```

修复后 `snowLumaWebui()` 应返回 `{ port: 5099, url: 'http://127.0.0.1:5099' }`。

## 回滚

恢复 `snowLumaWebui()` 原实现与两条文案即可；无持久化影响。

## 残余

- 本机装着 `D:\SnowLuma\node.exe`，但 `launcher.bat` 里是裸 `node`：**双击 launcher.bat 起不来**
  （PATH 里没有 node）。插件启动时会注入 node 目录，所以「一键启动」路径正常；
  建议反馈 SnowLuma 上游把 launcher 改成 `%~dp0node.exe`。
