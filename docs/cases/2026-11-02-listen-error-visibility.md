# B站监听 TDZ 已修，但程序错误仍被一行日志吞掉

日期：2026-11-02

对应：GitHub issue #8

## 现象

0.6.12 / 0.6.22：

```text
[bili-whale] 监听失败：Cannot access 'L' before initialization
```

每 300 秒一条，评论/@ 监听从未真正唤醒；直播 `liveTick` 正常。

## 根因

`plugins/surfcore/lib/scheduler.js` 的 `listenTick()` 旧代码：

```js
const L = cfg.listen ?? {}      // 外层：监听配置
try {
  ... L.scope ...
  const L = limitsNow()         // try 块：额度
}
```

`const` 的块级作用域 + TDZ：整个 `try` 块里的 `L` 都指向后面的额度 `L`，在初始化前读 `L.scope` 直接 `ReferenceError`。

当前 dev 已由提交 `3c99c54` 修复：

```js
const listenerCfg = cfg.listen ?? {}
...
const limits = limitsNow()
... ${limits.replyDaily}
```

本次补充的是**错误可见性**，不是再改同一个 TDZ。

## 修法

1. 新增 `formatListenError(error)`：
   - `ReferenceError` / `TypeError` → 带类型 + stack，截断 800 字；
   - 普通网络错误 → 只保留 message，避免刷长日志。
2. `listenTick` 的 catch 改为：
   ```js
   log(`[bili-whale] 监听失败：${formatListenError(e)}`)
   ```
3. `listenTick` 内部改名：
   - `L`（监听配置）→ `listenerCfg`
   - `L`（额度）→ `limits`
   - 消除同名遮蔽的语义混淆。
4. 新增 `scripts/test-bili-listen-error.mjs`：
   - ReferenceError/TypeError 带类型；
   - 普通 Error 只留 message；
   - `listenTick` 不再用 `L = limitsNow()`；
   - catch 必须调用 `formatListenError`。

## 没有做

- 没有引入 ESLint `no-shadow` / `no-use-before-define`（仓库当前无 lint 配置，全量开启会炸出大量历史告警）。
- 没有 mock B站 feed 做完整 `listenTick` 单测；本次是“错误格式 + 源码约束”回归。
- 没有改 `lastListenAt` 失败后的重试节奏。
- 没有改 `at` feed 的 `catch {}` 静默吞错。

## 风险

- stack 含本机源码路径，只进 `plugin.log`，不发给用户/群。
- 只截断 800 字，极长 stack 可能丢尾部；足够定位第一现场。
- 普通网络错误仍只一行，避免日志刷屏。
- 源码约束测试不能替代完整 lint；同类遮蔽仍可能出现在其他函数。
- `L` 在其他函数（`wakePrompt` / `liveTick`）仍作为额度变量，但作用域独立，无当前 bug。

## 验证

```text
node scripts/test-bili-listen-error.mjs
node --check plugins/surfcore/lib/scheduler.js
npm run test:audit
cd plugins/surfcore && npm test
```
