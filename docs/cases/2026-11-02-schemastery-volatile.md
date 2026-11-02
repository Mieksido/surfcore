# schemastery 3.18.3+ volatile 包装：测试红 / 配置值静默丢失

日期：2026-11-02

对应：GitHub issue #15

## 现象

- schemastery 3.18.3+ 下，`.extra('volatile', true)` 字段 resolve 后不再是普通字符串，而是带 `get()` 的包装对象。
- `scripts/test-qq-mode-plugin.mjs` 两条断言红：
  ```text
  Config 默认 mode 应为 reserved2
  chat 应被接受
  ```
- `JSON.stringify(resolvedConfig)` 把 volatile 字段写成 `{}`。

当前仓库 `package-lock.json` 锁的是 `@deepseek-ai/schemastery@3.18.1`，所以本地 audit 是绿的；issue 的 pnpm lock 是 3.18.5，按 issue 的安装方式必红。

## 根因

```js
const value = Config({ mode: 'chat' });
typeof value.mode        // 3.18.1: "string"
                         // 3.18.5: "object"
value.mode.get()         // "chat"
JSON.stringify(value)    // {"mode":{}}
```

三处受影响：

1. 测试直接 `resolved.mode === 'chat'`；
2. `src/bridge.js` 的 `settingFromDshNamespace()` 把 DSH settings 值原样返回；
3. 设置页 `plugins/surfcore/lib/index.js` 直接读 `row.value.mode` / 返回 `row.value`。

第 2、3 条会导致：

```js
String(wrapper) // "[object Object]"
```

于是：

- DSH 设置页的 `mode` 被当成非法值，回退本地 `mode.json`；
- DSH 设置页的 `ownerQQ` 被 `normalizeOwnerQQ` 拒绝，配置被忽略；
- 设置页展示的 `dshSetting` 经 JSON 序列化后 volatile 字段变 `{}`。

## 修法

### 1. 统一拆包模块

新增 `src/schema-values.js`：

```js
export function unwrapSchemaValue(value) {
  if (value && typeof value === 'object' && typeof value.get === 'function') {
    try { return value.get(); } catch { return value; }
  }
  return value;
}

export function settingFromDshNamespace(ns, key) {
  // user 层优先；读到的值统一 unwrap
}
```

`src/schema-values.js` 供插件/测试使用；`src/bridge.js` 的
`settingFromDshNamespace()` 内联同样的拆包逻辑（audit harness 会单独抽取该函数，
不能依赖外部 import，否则 harness 里会变成未定义）。

### 2. 生产读取点

- `settingFromDshNamespace()` 返回前 `unwrapSchemaValue`；
- 设置页 `dshMode` 用 `unwrapSchemaValue(row?.value?.mode)`；
- `handleMode` 返回的 `dshSetting` 对 `mode` / `ownerQQ` 拆包，避免 `JSON.stringify` 变 `{}`。

### 3. 测试

- `scripts/test-qq-mode-plugin.mjs` 不再直接比较 `.mode`，统一 `unwrapSchemaValue`；
- 新增 `scripts/test-schema-volatile.mjs`：
  - 普通值；
  - 包装对象 `.get()`；
  - `.get()` 抛错时保留原对象；
  - `settingFromDshNamespace` 的 user 层优先；
  - bridge / plugin 源码必须使用拆包入口。

### 4. 没采用的方案

issue 建议 `Config.simplify(Config({ mode }))`。  
实测 3.18.1 下，当值等于 schema 默认值时 `simplify()` 返回 `null`：

```js
Config.simplify(Config({})) // null
```

所以不能拿它当通用“取纯值”入口。这里用逐字段 `unwrapSchemaValue`，不依赖默认值/对象整体判断。

## 没有做

- 没有把 `package.json` 锁到 3.18.2；那会和 DSH 3.18.5 语义分叉。
- 没有全仓库 lint 禁止 volatile 裸读。
- 没有模拟 DSH settings 宿主完整返回结构的集成测试。
- 没有改所有 `JSON.stringify(config)` 业务路径；本次只修已知的 qq-mode/settings 边界。

## 风险

- `.get()` 拆包只适用于 schemastery volatile 包装；如果值本身是业务对象且恰好有 `get()`，会被误拆。当前只用于 schema 字段。
- `.get()` 抛错时保留包装对象，后续 `String()` 仍可能得到 `[object Object]`。
- 测试仍以 3.18.1 为主；3.18.5 用 `npm pack` 临时验证过 `JSON.stringify` 与 `unwrapSchemaValue`，但没有把 3.18.5 装进 lock。
- 设置页只修 mode/ownerQQ 两个已知字段；其他 volatile 字段若未来加入，需要同样接入。
- 如果 DSH 宿主未来改变 volatile 形状（不只是 `.get()`），需要扩展 helper。

## 验证

```text
node scripts/test-schema-volatile.mjs
node scripts/test-qq-mode-plugin.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

额外实测（临时解包 3.18.5，不写入 lock）：

```text
raw object
JSON.stringify(v) -> {"mode":{}}
unwrapSchemaValue(v.mode) -> chat
```
