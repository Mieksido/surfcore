# SnowLuma 掉线期间回复被丢 + 早安假成功

日期：2026-11-03

对应：GitHub issue #31

## 现象

- DSH 先启动、SnowLuma 后启动，桥接把离线期间排队的 QQ 消息投给 agent。
- agent 生成回复，调用 `qq_send_*` 时 OneBot HTTP 不可达。
- 工具报错，回复文本被丢弃；SnowLuma 恢复后不会补发。
- 早安：`fireMorningGreeting()` 只要 `deliverPrompt()` 成功就写 `lastMorningOk: true`，但真正的 QQ 发送发生在模型回合里；网关不可达时消息丢失，当天不再补。

## 根因

- 入站方向有 `queued` 队列和退避重投；
- 出站方向 `onebotSend()` / `sendToQQ()` 失败只记录日志/抛错，没有持久化队列；
- `setAccountOnline()` 上线边沿只补历史消息，不补出站；
- 早安只检查 DSH 是否收下提示词，不检查 OneBot 是否可发送。

## 修法

### 1. 新增 `src/outbox.js`

- `state/outbox.json` 持久化；
- 连接类失败 `push()`；
- `markSent()` 成功后记指纹并清掉同文本待补发项；
- `flush()` 按顺序补发；
- 去重 10 分钟、上限 60 条、24 小时过期、单条最多 12 次；
- 连接失败停在当前条目并保留剩余；非连接错误丢弃，避免反复撞策略墙。

### 2. bridge 接线

- `onebotSend()`：
  - `fetch` 失败 / HTTP 非 2xx 且连接类 → `outbox.push()`
  - 成功 → `outbox.markSent()`
  - `fromOutbox:true` 时失败不再二次入队
- `sendToQQ()`：
  - 每个 part 失败且连接类 → `outbox.push()`
  - 成功 → `outbox.markSent()`
- `setAccountOnline()`：
  - `online && !wasOnline` 边沿追加 `outbox.flush('account-online:...')`
- 启动时 `outbox.flush('startup')`，处理上次进程留下的队列。

### 3. 早安前置探活

`fireMorningGreeting()` 在 `deliverPrompt()` 前：

```js
if (!(await probeOneBotSendable())) {
  return { ok: false, retry: true, reason: 'QQ 暂不可发送' };
}
```

探活使用 `POST ${httpUrl}/get_status`，3 秒超时；失败时回退 `snowlumaHealth.connected`。  
不可发送就不写 `lastMorningOk`，交给已有 10 分钟重试。

## 没有做

- 语音 / 表情 / 卡片路径没有完整 outbox；本次只覆盖文本 `onebotSend` 和 `sendToQQ`。
- 没有把 outbox 入队下沉到 `onebotSendSegments()`。
- 成功指纹是进程内 Map，重启后 10 分钟去重窗口清空；窄窗口可能重复补发。
- 没有做 outbox 管理 UI；只落盘 + 日志。
- 没有处理“模型没调用发送工具”的早安假成功；探活只能保证网关可发，不能保证模型一定发。

## 风险

- **重复发送**：OneBot 已收但 HTTP 超时，补发会重复；目前靠 10 分钟指纹缩小窗口。
- **旧消息补发**：恢复后可能补发过期语境的消息；有 24 小时上限，但仍可能尴尬。
- **顺序**：outbox 按入队顺序串行补发，但不同会话/发送链之间仍可能交错。
- **策略失败**：只对连接类错误入队；白名单/静默/限流/敏感词不会反复重试。
- **隐私**：outbox 明文落盘，依赖 state 目录 ACL；包含用户消息文本。
- **Token 成本**：掉线期间模型已经生成回复，补发不返还 token；只是避免“白生成”。
- **探活误判**：HTTP 探活成功但模型回合时又掉线，仍可能丢；outbox 只能兜底文本。

## 验证

```text
node scripts/test-outbox.mjs
node scripts/test-greeting.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
