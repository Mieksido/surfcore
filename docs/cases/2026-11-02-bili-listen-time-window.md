# B站监听变量重名 / 跨午夜窗口 / 全角冒号 / 群错误通知

日期：2026-11-02

## 1. P0-1：`listenTick` 的 `L` 重名（TDZ）

`listenTick()` 外层：

```js
const L = cfg.listen ?? {}
```

同一 `try` 块后面：

```js
const L = limitsNow()
```

于是 `L.scope` 在声明前访问，抛：

```text
ReferenceError: Cannot access 'L' before initialization
```

修法：内层改名 `LIM`，同步 `LIM.replyDaily` / `LIM.mineDaily`。

## 2. P0-2 / P1-1：跨午夜 + 全角冒号

新增 `tools/lib/time-window.mjs`：

- `normalizeClockText()`：全角冒号/数字归一；
- `parseClock()`：非法返回 null，不再静默变 0；
- `normalizeWindow()`：`end <= start` 视为跨午夜；`start === end` 明确非法；
- `windowContains()`：支持 `m >= start || m < end - 1440`。

`inWindow()` 和 `night-schedule.js` 共用它，避免两套时间逻辑漂移。

保存时 `normalizeBiliWindowList()`：

- 全角 `22：00` 自动变 `22:00`；
- 非法窗口丢弃，`saveBiliConfig` 返回 warning；
- 不再静默保存一个永不命中的窗口。

## 3. P1-2：agent 错误只发私聊

`src/bridge.js`：

```js
if (String(key).startsWith('private:')) {
  await sendToQQ(key, `⚠️ agent 处理出错：${safeMsg}`);
}
```

群聊只写日志/活动记录，不再把模型/工具内部错误发进群。

## 4. P2 附带处理

- 无行动/未设置唤醒条件重置时，保留用户显式改过的 `batchWindowMs`（`resetWakeConfigV2`）；
- ZIP 下载后先检查 EOCD，HTTP 200 截断包换镜像重试，不再等解压才报；
- 更新检查增加 `unknown` 计数：无 git/无法判定时不再说“0 个更新”，UI 显示“无法判定 N 个组件”。

## 5. 生效/风险

- 重启 DSH / 重载插件；
- 修好监听后，夜间窗口会真的开始拉 reply/at，B站 API 调用会上升；
- 全角时间旧配置会自动归一；非法窗口会被丢弃并提示，用户需要重填；
- 群聊不再显示 agent 错误，管理员要看日志/活动；
- `start === end` 视为非法，不再默认 24 小时；
- 更新跨大版本仍建议手动覆盖，自动更新不保证每个旧版本链路都通。

## 6. 验证

```text
node scripts/test-time-window.mjs
node scripts/test-night-schedule.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
