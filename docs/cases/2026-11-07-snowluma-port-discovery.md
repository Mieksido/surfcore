# 2026-11-07 · SnowLuma 端口为什么 5099/5100，以及一键启动的实际端口识别

## 用户看到的现象

- 有时控制台是 `http://127.0.0.1:5099`，有时是 `5100`；
- 一键启动/加载 QQ 账号偶尔说“控制台还没起来”，但 SnowLuma 实际在跑。

## 根因

### 1. SnowLuma 内置默认是 5099

SnowLuma 2.0.3 的 bundle 里：

```js
DEFAULT_WEBUI_PORT = 5099
```

如果 `config/runtime.json` 没有 `webuiPort`，就用 5099。

### 2. 用户配置可以把它固定成 5100

端口存在 SnowLuma 自己的：

```
<SnowLuma>/app/config/runtime.json   （或 <SnowLuma>/config/runtime.json）
```

```json
{ "webuiPort": 5100 }
```

这不是随机数；是 SnowLuma 设置/历史安装留下的值。

### 3. 端口被占用时，SnowLuma 会自动往后挪

SnowLuma 启动时：

```js
const finalPort = await findAvailablePort(desiredPort);
if (finalPort !== desiredPort) log.warn("port %d is in use, using %d instead", ...)
```

`findAvailablePort` 最多往后找 50 个端口，但**不会把实际端口写回 runtime.json**。
所以可能出现：

```
runtime.json = 5100
5100 被别的程序占了
SnowLuma 实际监听 5101
```

插件旧逻辑只探 `runtime.json` 的 5100，当然找不到。

### 4. 插件旧回退值也是 5100

旧代码读不到 runtime.json 就回退 5100，而 SnowLuma 内置默认是 5099；这会制造第二层错位。

## 修法

- 无配置时回退改为 **5099**。
- 新增 `snowLumaWebuiCandidates()`：配置端口 + 5099/5100 + 配置端口后 **50 个**（与 SnowLuma 的 `maxTries=50` 对齐）。
- 新增 `probeSnowLumaWebui()`：TCP 探活后请求 `/`，用页面里的 `SnowLuma` 品牌确认不是别的服务。
- 新增 `discoverSnowLumaWebui()`：并行扫描候选端口，优先配置端口，其次 5099/5100。
- 一键启动等待 WebUI 时改用发现结果（最多 30 秒），打开的也是实际端口。
- 加载 QQ 账号 / 诊断 / 关闭 SnowLuma 都使用实际端口；关闭端口范围扩到配置端口后 50 个。

## 另一层真问题：VBS 把 Harness.exe 当 node

现场截图不是端口问题：SnowLuma 根本没起来。检查 `state/snowluma-launch.vbs` 发现：

```vbs
sh.Run """D:\deepseek\DeepSeek Harness.exe"" ""...\SnowLuma2\app\index.mjs""", 0, False
```

插件跑在 DSH 宿主里，`process.execPath` 是 **Harness.exe**，不是 `node.exe`。
VBS 把 `index.mjs` 交给 Harness 打开，SnowLuma 当然不会启动；旧逻辑还返回
`ok:true, pending:true`，属于静默失败。

修法：

- VBS 和隐藏直连启动都改用 `findNodeExe()` 找真正的 node.exe；
- `nodePathEnv()` 也用真实 node 目录；
- 找不到 node 时返回 `SNOWLUMA_NODE_MISSING`，不再写一个错误 VBS；
- 30 秒没发现 WebUI 返回 `SNOWLUMA_LAUNCH_TIMEOUT` + 建议 + 诊断（配置端口、扫描端口、node 路径、VBS target）；
- 一键启动结果里显示 `［错误码］原因；建议`，不再只 toast“1 项失败”。

## 验证

```
node scripts/test-session-rollover.mjs   202 项全过
node scripts/test-launch-components.mjs  通过
node scripts/test-platform-start.mjs     通过
node scripts/test:audit                  153/153
插件测试                                  39 项全过
```

新增静态断言：

- 代码必须存在 `discoverSnowLumaWebui` / `probeSnowLumaWebui`；
- 无配置时回退 5099；
- 关闭 SnowLuma 覆盖实际端口范围。

## 发布状态

- 本修复在 `0.8.9` stable 之后进入 dev，**v0.8.9 正式版不含**；
- 稳定用户仍会看到旧版“5100 探不到”的弹窗，需要 `v0.8.10` hotfix 才能生效。

## 残余

- SnowLuma 开启 WebUI TLS 时仍是 HTTPS 自签证书，当前自动发现按 HTTP 处理；需要单独适配。
- 若 5099~5110 全被占用，SnowLuma 可能挪到更远；当前扫描范围覆盖常见情况，失败会明确提示配置端口。
