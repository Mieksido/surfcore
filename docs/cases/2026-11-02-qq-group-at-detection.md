# 群聊 @ 机器人不唤醒（同条也 @ 别人 / 群名片不一致 / self_id 缺失）

日期：2026-11-02

## 1. 现象

机器人能在群里主动发言，但有人 @ 它时不醒来；私聊正常。
SnowLuma 日志里私聊有 `[Event] 私聊`，群聊只看到 `[OneBot] 群聊 | 发送`。

## 2. 两层可能

### A. 群消息根本没进 bridge

如果 SnowLuma 没发 `[Event] 群聊`：

- 不是 surfcore 的 @ 判断；
- 检查 OneBot `group_message` 订阅、群过滤、账号状态。

### B. 群消息进来了，但 @ 判断丢了

代码里有两个确定的坑：

1. `atOther0` 一票否决：

```js
const atOther0 = segs.some(at qq !== self)
const called = !atOther0 && (...)
```

消息同时 @ 机器人和 @ 别人时，`atOther0=true`，即使 @ 了机器人也不叫醒。

2. 看渲染后的名字：

```js
if (lower.includes('@' + selfNickname)) return true
```

`segmentsToText` 会优先把 at 解析成群名片；群名片≠登录昵称时匹配不到。

3. `event.self_id` 缺失时没有回退 `selfUserId`。

## 3. 修法

新增纯函数 `src/qq-at.js`：

- 从原始 `message` 的 `at` 段判断；
- 同时支持 CQ 字符串；
- 返回 `{atSelf, atOther, targets}`；
- `@all` 不算 atSelf/atOther；
- `self_id` 缺失时调用方回退 `selfUserId`。

`handleIncoming`：

```js
const atState = atInfo(event.message, [event.self_id, selfUserId]);
const called = atState.atSelf || (!atState.atOther && (...));
```

`evaluateWakeTriggerV2` 也改为 `atInfo`，不再只看 `event.self_id`。

引用自己判断也回退 `selfUserId`。

## 4. 生效/风险

- 重启 DSH / QQ 桥接；
- @机器人 + @别人现在会唤醒（修复目的）；
- @all 仍不算叫醒；
- 如果 SnowLuma 不投递群事件，代码修了也没用，需先看入站日志；
- 群名片/昵称不一致不再影响原始 at 段；
- CQ 字符串形式的 at 也支持；
- 仍没有“群消息入站日志”，排查时需要 SnowLuma 日志。

## 5. 验证

```text
node scripts/test-qq-at.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
