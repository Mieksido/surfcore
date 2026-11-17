# DSH 跑在服务器上，网页端「Token 额度」读不出来（只接受本机回环访问）

## 现象

- 用户原话：「我在客户端的电脑上面打开 dsh 的 web 页面，就提示 **读取 token 额度失败：只接受本机回环访问**」
- 环境形态：DSH 装在一台 Linux 服务器上（`dsh --profile web --host 192.168.3.110 --port 43120`），
  用 Windows 台式机浏览器访问 `http://192.168.3.110:43120`。
- 复现（任意一台非服务器机器上执行）：

  ```bash
  curl -s -i http://192.168.3.110:43120/dsh-surfcore/api/budget
  # HTTP/1.1 403 Forbidden
  # {"ok":false,"error":"只接受本机回环访问"}

  # 伪造一个回环 Host，就过了 surfcore 那层（停在 DSH 自己的鉴权 401）
  curl -s -i -H 'Host: 127.0.0.1:43120' http://192.168.3.110:43120/dsh-surfcore/api/budget
  # HTTP/1.1 401 Unauthorized
  ```

## 环境

| 项 | 值 |
| --- | --- |
| 系统 / DSH 版本 | Ubuntu 26.04.1 / `@deepseek-ai/dsh@0.2.2-rc.1`（当时 npm `latest`） |
| SurfCore 版本 | 服务器上 0.8.6；本仓库 0.8.9（两者判据逐字节相同，升级修不掉） |
| 安装方式 | 插件作为包装进 `<DSH_HOME>/profiles/web/node_modules/surfcore`，旁边 `src -> /srv/surfcore/src` 符号链接 |
| 其它 | 桥接控制台 `127.0.0.1:3100`，DSH 前置 `dsh-loopback.service`（socat 回环转发） |

## 根因

**两层闸门，问题在第二层。**

1. DSH 自己的 Host fence（`@deepseek-ai/dsh-client-connection` 的 `isTrustedApiRequest`）是**放行**的：
   它除了回环、`trustedHosts` 之外，还额外接受「监听地址字面量」（`isBindAddressAuthority`）。
   `--host 192.168.3.110` 绑的就是这个地址，所以客户端带 `Host: 192.168.3.110:43120` 能过。
2. **SurfCore 自己的闸门只认回环**：`plugins/surfcore/lib/index.js` 的 `route()` 里

   ```js
   if (!isLoopbackReq(req)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return; }
   ```

   `isLoopbackReq`（`lib/http-guard.js`）只放行 `127.0.0.1 / localhost / [::1] / ::1`。
   于是**所有 `/dsh-surfcore/api/*`**（超额度的 `/budget`、概览、配置、诊断…）在服务器部署下全量 403。
3. 前端 `client.js` 把 403 的 `error` 字段拼进红字：`读取 token 额度失败：${e.message}`
   ⇒ 用户看到的就是这句。

**为什么之前没发现**：这套判据是按「单机 Windows 桌面」写的（ROADMAP §1.3 明确写「控制台是单机回环 Web UI」）。
搬到服务器 + `--host` 绑 LAN 地址之后，第一个被打破的假设就是这个。

**顺手挖到的两个真问题（同一份部署）**：

- `paths.js` 的 `looksLikeQqbotRoot()` 要求目录里同时有 `config.json` 与 `src/bridge.js`。
  Linux 上插件装在 `profiles/web/node_modules/surfcore`，而 profile 目录只有 `src -> /srv/surfcore/src` 符号链接、
  没有 `config.json` ⇒ `QQBOT_ROOT` 落到 `profiles/web/node_modules`。后果：
  `consoleToken` 读成空（桥接状态接口 401）、`state/bridge.lock` 读不到（重启杀不掉进程）。
  实测：`plugin.log` 里 `autoStartBridge：桥接还在旧目录（root=未知），自动重启` +
  `重启结果：进程没有在预期时间内退出` 每 2 分钟一轮，累计 **15624 条**。
- `bridgeStaleReason()` 把「状态读不到（`ok:false`）」也判成「旧目录」，于是自愈轮询无限重启；
  `stop()` 只等 4 秒，而桥接收到 SIGTERM 要先 `saveState()` 落盘，常常等不到 ⇒ 每次都报「进程没有在预期时间内退出」。

## 完整逻辑（给用户看的那一遍）

- **链路**：浏览器 → DSH `webServer`（`dsh-host-webserver` 注册 `/dsh-surfcore/api/*`）→
  `plugins/surfcore/lib/index.js` 的 `route()` 闸门 → 具体 handler。
  同一份 `http-guard.js` 还被 `pet-api.js`（桌宠接口 `/dsh-surfcore/pet-api/*`）复用。
  上游：前端 `lib/client.js` 的 `api()`；下游：`store.js` 读配置、`bridge.js` 探活桥接。
- **机制**：网关按 **Host 请求头**判来源（不是对端 IP）——DNS rebinding 时对端就是 127.0.0.1，
  只有 Host 能认出真实来源。判据写成「只认回环」等价于「只服务本机浏览器」，
  这与「DSH 绑到 LAN 地址、给人远程用」直接冲突。
- **爆炸半径**：1 个插件进程 × 约 120 条路由 × 静默=3 → 分高；**不碰用户数据、不碰密钥、不花钱**，
  纯准入判断。放开后能读到的仍然是脱敏后的配置（`********`），写操作还要令牌/同源。
- **取舍**：
  - A（采用）：判据扩成「回环 ∥ DSH 绑定地址 ∥ 显式白名单」，默认只信绑定地址 ——
    与 DSH 自己的策略同构，换端口/换 IP 不用改配置；回滚只要关一个开关。
  - B：直接删掉 SurfCore 的闸门、只靠 DSH —— 改动更小，但失去纵深防御（DSH 换版本就静默全开）。
- **生效与重启**：`http-guard.js` / `index.js` / `pet-api.js` 由插件进程加载，**改完重启 DSH** 生效；
  `webAccess` 配置每次请求现读，改完保存立即生效。

## 修法

1. `lib/http-guard.js`：新增 `splitHostHeader()` 与 `isAllowedHost(req, policy)`。
   放行条件 = 回环 ∥ `bindHost` 匹配 ∥ `trustedHosts` 匹配；`sec-fetch-site: cross-site` 一律拒绝。
   白名单条目带端口则精确匹配端口，不带端口则任意端口。
2. `lib/index.js`：`route()` 改用 `isAllowedHost(req, webAccessPolicy())`；
   403 返回结构化 `{ ok:false, code:'HOST_NOT_ALLOWED', error, hint, host }`（AGENTS §1.7）；
   概览新增 `webAccess` 段（绑定地址 + 本次 Host），供设置页展示。
3. `lib/pet-api.js`：接受 `hostPolicy` 注入，与设置页共用同一份判据（不注入时仍只认回环）。
4. `lib/store.js`：`DEFAULT_UNIFIED.webAccess = { trustBindAddress: true, trustedHosts: [] }`。
5. `lib/client.js`：QQ 页新增「网页端访问」卡片（开关 + 主机名列表 + 当前绑定地址/请求 Host）；
   额度页失败提示追加 `hint`。
6. `lib/paths.js`：找不到标准根时，顺 `src/bridge.js` 的符号链接解引用出真实根再判一次。
7. `lib/index.js`：`bridgeStaleReason()` 在 `status.ok === false` 时不再判「旧目录」；
   自愈轮询连续失败 3 次停手并写日志（不再每 2 分钟无限刷）。
8. `lib/bridge.js`：`stop()` 等待从 4 秒放宽到 15 秒，超时返回 `code/hint`。

- **为什么选这个方案**：判据收敛在 `http-guard.js` 一处（该文件存在的理由就是「不复制判据」），
  两套 API 自动一起生效；默认值保守，等价于「只在运维显式绑 LAN 地址时才放开」。
- **回滚方式**：`webAccess.trustBindAddress = false` + 清空 `trustedHosts`（配置层），
  或 `git revert` 该提交（代码层）。

## 验证

- 自动化：
  - `plugins/surfcore/scripts/test-http-guard.mjs` 新增 15 条断言：
    放行绑定地址 / 拒绝同网段其它 IP / 拒绝 `evil.com` 与后缀伪装 / `trustBindAddress=false` 回退 /
    白名单无端口与带端口 / 大小写 / `sec-fetch-site` / 缺 Host / 方括号未闭合 / 空策略 fail-closed。
  - `node scripts/test-pet-api.mjs`：桌宠接口回归全绿（不注入策略时行为不变）。
  - `npm run test:audit`：144/153（与改动前同数；失败项为基线已有：`spawnSync EPERM` 与本机沙箱相关）。
- 失败路径：403 现在带 `code=HOST_NOT_ALLOWED` 与可执行 `hint`（前端额度页会把它拼进红字）；
  `bridge.stop()` 超时带 `code=BRIDGE_STOP_TIMEOUT` + `hint`。
- 手工/集成（部署后）：`curl -s -o /dev/null -w '%{http_code}' http://<服务器IP>:43120/dsh-surfcore/api/overview`
  期望 **200**（带登录态/令牌时），浏览器打开额度页应出数。
- 没验证到的部分：没有在真实的「服务器 + 远程浏览器」组合上跑端到端（本机沙箱无法直连该 DSH 的登录态）；
  桌宠客户端未做远程形态实测（桌宠与 DSH 同机时 Host 仍是回环，行为不变）。

## 顺带修掉的同源问题

- **桥接自愈死循环**：`QQBOT_ROOT` 解析错 → `consoleToken`/lock 读不到 → 状态 401 →
  `bridgeStaleReason` 判「旧目录」→ 重启 → 停不掉（4 秒超时）→ 再来一轮。三处同时修好才收敛。
- **为什么值得记**：三个 bug 的表象完全不同（403 / 日志刷屏 / 重启失败），
  但都是「Windows 单机假设被服务器部署打破」的同一类问题。
