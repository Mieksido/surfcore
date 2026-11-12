# 宿主只有 /api/events 快照：桥接 0 帧

日期：2026-11-02

对应：GitHub issue #2

## 现象

- 桥接日志反复：
  ```text
  连接 DSH 事件流…
  DSH 事件流已结束（本次收到 0 帧）
  ```
- 宿主 `GET /api/status`、`GET /api/events` 都是 200；
- `/api/remote.mux` / `/api/events_mux` 都是 404；
- 启动还说“DSH 端口探测连不上”，但端口实际是通的。

## 根因

1. `src/dsh-client.js` 只打开 `/api/remote.mux` WebSocket，并在其上 `session/follow`。
2. 宿主只提供 `GET /api/events?cursor=` 快照，没有 remote.mux。
3. WS 404 → 0 帧 → 指数退避重连，但永远没有事件。
4. `probeDshBaseUrl()` 只看 `/` + `server: dsh` 头；桌面内嵌宿主没有这个头，被误报“连不上”。

## 修法

### 1. 传输层：remote.mux 优先，404 才降级

- 正常宿主：仍然走 `/api/remote.mux` 推送，不变、不加延迟。
- WebSocket 未 open 且错误明确含 `404 / unexpected server response`：
  - 标记 `_remoteMuxUnsupported`；
  - 60 秒后才重试 remote.mux；
  - 这期间走 `/api/events` 轮询。

### 2. `/api/events` 轮询

- `GET /api/events` 首次只取 `latest` 作为基线，**不重放历史 turn**；
- 之后 `GET /api/events?cursor=` 增量；
- 1.5 秒轮询；
- 按 session/follow 过滤；
- 按 `cursor/seq + payload` 去重；
- 支持 `session/event`、`{sessionId,event}`、`question/requested`、`approval/requested` 的常见形状；
- `/api/events` 也 404 时抛出明确错误，不再假装连上。

### 3. 端口探测

`probeDshBaseUrl()`：

1. 先 `GET /api/status`：
   - 401 → DSH 在；
   - 200 JSON 含 `modelConnection` / `latestEventCursor` / `sessions` → DSH 在；
2. 再回退旧逻辑 `/` + `server: dsh`。

这样“HTTP 通但没有 remote.mux”不会再被写成“端口连不上”。

### 4. 可见诊断

桥接日志：

```text
⚠️ 宿主没有 /api/remote.mux，已降级为 /api/events 快照轮询：
事件最多延迟约 1.5 秒；审批/提问若不在快照里仍可能收不到。
```

`NodeApiClient.eventTransport` 标记 `remote.mux` / `snapshot`。

## 最低 DSH 版本 / 支持范围

- 当前客户端主路径按 DSH `0.1.5-rc.1` 的 `/api/remote.mux` + `session/follow` 实现。
- 桌面内嵌宿主若只暴露 `/api/events` 快照，**不在原主协议支持范围**；现在进入兼容轮询模式。
- 没有硬版本门禁：用能力探测（remote.mux 404）决定，不猜版本号。
- 想要低延迟推送和完整审批/提问，仍建议升级到支持 remote.mux 的 DSH。

## 没有做

- 没有把 `/api/events` 当完整 remote.mux 替代：
  - 若快照不含审批/提问，仍收不到；
  - 若快照截断/无 cursor，可能漏事件；
  - 轮询天然有延迟。
- 没有支持 `/api/events_mux`。
- 没有在正常宿主上启用轮询（避免无谓延迟/负载）。
- 没有把轮询事件写 token 账本基线（只有 session/event）。

## 风险

- 轮询 1.5 秒，最多慢一个间隔。
- 初始基线取 `latest`，切换瞬间正在进行的 turn 可能丢 `turn/end`。
- `/api/events` 形状/游标语义不保证；用常见形状兼容，仍需真实宿主验证。
- 审批/提问可能不在 `/api/events`，这类宿主仍不完整。
- remote.mux 404 识别依赖 WebSocket 错误文本；若运行时只给裸 close 1006，可能仍不降级。
- 每 60 秒重试 remote.mux；失败会再回到轮询。
- 正常宿主不受影响：不降级、不轮询、不加延迟。

## 验证

```text
node scripts/test-events-fallback.mjs
node scripts/test-dsh-port.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
