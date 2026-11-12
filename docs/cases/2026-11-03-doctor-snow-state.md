# 体检把 SnowLuma 配置当运行状态，固定误报 onebot-rejected

日期：2026-11-03

对应：GitHub issue #46

## 现象

- SnowLuma 实际已连接，QQ 能收发；
- 设置页「诊断 / 体检」显示：
  ```text
  SnowLuma 在线
  探测结果：onebot-rejected · OneBot 端口在监听但桥接连不上
  多半是 accessToken 不匹配…
  ```
- OneBot 3000/3001 端口在监听；概览/启动检查却正常。

## 根因

`plugins/surfcore/lib/index.js` 的 `installChecks()`：

```js
const snow = qqCfg.snowluma ?? {};       // config.json 的配置
snowState = await diagnoseSnowLuma(snow);
```

`diagnoseSnowLuma()`：

```js
if (bridgeSnow.connected === true) return ok;
const onebot = await portOpen(3000) || await portOpen(3001);
if (onebot) return { state: 'onebot-rejected', ... };
```

`config.snowluma` 只有：

```text
wsUrl / httpUrl / accessToken
```

没有 `connected` 字段。  
所以：

```text
connected === true 永远不成立
→ 只要 3000/3001 在听
→ 固定 onebot-rejected
```

概览和启动检查传的是 `bridge.snowluma`，里面有 `connected`，所以正常。

## 修法

1. `installChecks(bridge)` 复用 `handleDoctor` 已经拿到的 `bridge`；没有就 `bridgeStatus()`。
2. 诊断输入改成：
   ```js
   await diagnoseSnowLuma(runtimeBridge?.snowluma ?? {})
   ```
3. `diagnoseSnowLuma` 先判断输入是不是运行态：
   ```js
   const hasRuntimeState = Object.prototype.hasOwnProperty.call(bridgeSnow, 'connected');
   if (!hasRuntimeState) {
     return { state: 'bridge-not-running', hint: '先启动 QQ 桥接' };
   }
   ```
4. 只有运行态 `connected:false` + 端口在听，才判 `onebot-rejected`。

## 没有做

- 没有改 `onebot-rejected` 的端口探测方式：仍然只 probe TCP，不实际 `get_login_info` 验 token。
- 没有统一概览/启动/体检三处的状态词，只修了体检的参数源。
- 没有改 doctor 的 `snowOk` 词表。

## 风险

- 桥接未启动时，体检显示 `bridge-not-running`，不再误报 token。
- 若桥接状态接口失败，`runtimeBridge` 为空 → 也会显示 `bridge-not-running`，不会假装在线。
- 3000/3001 被别的服务占用时，桥接真未连接仍可能被判 `onebot-rejected`；需要后续用真实 OneBot API 验证。

## 验证

```text
node scripts/test-doctor-snow-state.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
