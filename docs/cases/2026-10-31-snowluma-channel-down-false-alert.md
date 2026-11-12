# 2026-10-31 · 明明连着 SnowLuma，却弹「发送通道断开」L2，而且每次打开设置页都弹

## 现象

- QQ 桥接与 SnowLuma 正常连接（能收发消息）；
- 设置 → 概览弹出 L2「需要处理的安全提醒：L2 · snowluma · send-channel-down」，
  原因「SnowLuma 连接断开（code=1006）」；
- 每次打开设置页都弹（旧事件未确认，UI 每轮取未确认的 L2/L3）。

## 根因（三层）

1. **WS close 即刻报 L2**：`bot.on('close')` 立刻 `notifySendChannelDown()`。
   但 code=1006 在启动/短暂抖动时很常见，往往几百毫秒后就重连成功；
   代码注释里甚至写了“1006 在每次启动都可能出现一次”。
2. **恢复不确认旧事件**：`open` 会发 L1 恢复，但 L2 事件仍在事件中心是未确认状态，
   UI 取 `includeAcked=0` 就会一直把它当“待处理”。
3. **文案误导**：L2 的 impact 写“自动唤醒已暂停”，但 close 本身并不暂停（暂停由连续发送失败触发）。

## 修法

| 层 | 改动 |
| --- | --- |
| 去抖 | `close` 后先进入 15 秒观察窗口；窗口内 `open` 成功就不记 L2、不弹窗 |
| 恢复确认 | `notifySendChannelUp()` 调 `gateEvents.ackByDedupe('snowluma:send-channel-down')`，把旧事件自动确认 |
| 文案 | 改为“通道恢复前会自动跳过主动唤醒”，不再声称“已暂停” |
| UI | 打开设置页加载提醒时，若当前 `overview.bridge.snowluma.connected === true`，自动确认并过滤旧的 `send-channel-down`；概览未就绪时先不弹，避免误弹一次 |

## 验证

- `test-gate-events`：`ackByDedupe` 能一次确认同 key 的多条未确认事件；桥接必须使用 downTimer 与 ackByDedupe；
- `test-client-contract`：连着时过滤并自动确认旧断线告警、概览未就绪不弹；
- `npm run test:audit` 94/94；插件测试全绿。

## 教训

**“连接断开”是瞬间事件，“通道不可用”才是状态**。告警要针对状态、并带观察窗口；
恢复时必须把对应的未确认事件结掉，否则 UI 会一直拿它当新问题。
