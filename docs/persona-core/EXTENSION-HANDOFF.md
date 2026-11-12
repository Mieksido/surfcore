# 内核 × 大适配器 × 扩展包 交接说明

> 面向：外部扩展包开发者  
> 对象：`surfcore-persona-core` 的 **内核 kernel/** 与 **大适配器 runtime/**  
> 冻结对象：**大适配器 runtime/**  
> 可演进对象：内核 kernel/  
> 扩展形态：**小适配器 + 模块功能**

---

## 0. 一句话先记住

```text
内核会变，扩展不能依赖内核。
大适配器冻结，扩展不能修改大适配器。
扩展只通过大适配器的接口说话。
```

扩展包不是“内核插件”，也不是“大适配器插件”。  
它是一个独立发布物：

```text
小适配器：把外部世界翻译成大适配器认识的事件/意图
模块功能：这个扩展自己的业务能力
```

---

# 1. 四层架构

```text
┌──────────────────────────────────────────────────────────────┐
│ 内核 kernel/                                                 │
│ 人格 / 目的 / 记忆 / 语音 / 识图 / 表达 / 设置               │
│ 会持续演进；不让扩展 import                                  │
└───────────────────────────┬──────────────────────────────────┘
                            │ 只由大适配器调用
┌───────────────────────────┴──────────────────────────────────┐
│ 大适配器 runtime/                                            │
│ 事件管 / 意图管 / 回执管；六轴能力；生命周期；幂等           │
│ 完全冻结；不允许外部修改                                     │
└───────────────────────────┬──────────────────────────────────┘
                            │ 固定接口
┌───────────────────────────┴──────────────────────────────────┐
│ 小适配器 packs/<name>/index.js                               │
│ 平台协议 / 收事件 / 发意图 / 声明能力 / 生命周期             │
│ 不 import 内核；不 import 大适配器内部实现                   │
└───────────────────────────┬──────────────────────────────────┘
                            │ 普通函数调用
┌───────────────────────────┴──────────────────────────────────┐
│ 模块功能 packs/<name>/module/                                │
│ 业务逻辑 / 解析 / 状态 / 策略；可独立单测                    │
└──────────────────────────────────────────────────────────────┘
```

### 依赖方向

```text
kernel  ←  runtime  ←  small adapter  →  module
```

- `kernel` 不知道 `runtime`、`packs`。
- `runtime` 不 import `kernel`；内核实例由组合根传入。
- `small adapter` 不 import `kernel`，也不 import `runtime` 内部文件。
- `module` 不 import `small adapter`、`runtime`、`kernel`。
- 禁止反向依赖、循环依赖、跨包 import。

---

# 2. 冻结承诺

## 2.1 冻结的是什么

```text
runtime/ 整个目录
runtime 版本：0.3.0
runtime 树哈希：d607d26dd5e27bd366dfeb36d56be1b66fac3a26
```

以下内容承诺不破坏：

- 事件管：`ctx.emit(event)`
- 意图管：`adapter.pipes.deliver(intent)`
- 回执管：`deliver()` 返回的结构化结果
- 六轴能力：`timing / shape / identityMode / direction / frequency / modality`
- 生命周期：`start / heartbeat / stop / uninstall`
- 幂等：同一 intent id 不重复执行
- 媒体上限：超限裁剪并报告，不静默
- 错误回执：失败必须结构化，不抛出到宿主

## 2.2 不冻结的是什么

```text
kernel/ 会变
```

内核可以：

- 增加记忆能力
- 调整目的/表达/语音/识图
- 增加设置项
- 优化内部模块

扩展**不能**因为内核变化而坏，因为扩展不 import 内核。

## 2.3 修改规则

- 外部开发者**不得修改** `runtime/`。
- 不得复制一份 `runtime/` 到扩展里。
- 不得 monkey-patch 大适配器。
- 需要新能力时，走协议版本升级，不直接改冻结代码。

---

# 3. 扩展包目录

```text
packs/<name>/
  pack.json                 清单：身份 / 版本 / 协议 / 入口 / 信任 / 依赖
  index.js                  小适配器：唯一入口，导出四块 + 生命周期
  module/                   模块功能（可多文件）
    index.js
    ...
  adapter/                  可选：平台传输实现
    ...
  test/                     可选：离线测试
    fake-transport.mjs
```

### 目录职责

| 路径 | 职责 | 不许做什么 |
| --- | --- | --- |
| `pack.json` | 发布身份、版本、协议、入口、信任声明 | 不写运行逻辑 |
| `index.js` | 小适配器：能力声明、收事件、发意图、生命周期 | 不写业务细节、不 import 内核 |
| `module/` | 模块功能：解析、状态、策略、纯逻辑 | 不 import 内核/大适配器/小适配器 |
| `adapter/` | 平台传输：HTTP/WS/文件/本地进程 | 不把平台协议泄漏进模块 |

---

# 4. pack.json

最小示例：

```json
{
  "publisher": "your-name",
  "name": "example",
  "version": "0.1.0",
  "protocol": 1,
  "entry": "index.js",
  "trust": ["event.publish", "network.out"],
  "requires": ["example-gateway（用户自备）"]
}
```

字段：

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `publisher` | 是 | 发布者标识 |
| `name` | 是 | 小写字母开头，2~32 位；必须等于目录名 |
| `version` | 是 | `x.y.z` |
| `protocol` | 是 | 当前固定 `1` |
| `entry` | 是 | 入口文件，通常是 `index.js` |
| `trust` | 否 | 字符串数组；声明需要的信任 |
| `requires` | 否 | 字符串数组；外部依赖说明 |

禁止内容：

```text
原生二进制 / exe / dll / so / bat / cmd
node_modules
锁文件
凭据 / token / 私钥
第三方专有运行时
```

---

# 5. 小适配器契约

入口 `index.js` 可以导出命名成员，也可以 `export default` 一个对象。  
大适配器只认这些字段：

```js
export const identity = {
  publisher: 'your-name',
  name: 'example',
  version: '0.1.0',
  source: 'example',        // 来源的不透明 id
  channel: 'example:default' // 默认频道
};

export const capabilities = {
  timing: 'realtime',       // realtime | async | batch
  shape: 'single',          // single | stream | snapshot
  identityMode: 'known',    // known | anonymous | mixed
  direction: 'both',        // in | out | both
  frequency: 'human',       // human | high | world-tick
  modality: 'text'          // text | multi
};

export async function open(ctx) {}
export async function send(intent, { ctx }) {}
export async function health() { return { status: 'ok' }; }
export async function close() {}
export async function uninstall() {}
export const settings = [];
```

## 5.1 identity

代码里的 `identity.publisher/name/version` 必须和 `pack.json` 完全一致。  
不一致会被拒绝，防止“包里说自己是官方”。

- `source`：来源的不透明 id，由扩展定义。
- `channel`：默认频道 id，由扩展定义。
- 大适配器会给事件盖 `from.adapter = publisher@name`，扩展不能自吹来源。

## 5.2 capabilities 六轴

六轴必须全部给，缺一条就拒绝加载。

| 轴 | 可选值 | 含义 |
| --- | --- | --- |
| `timing` | `realtime` / `async` / `batch` | 回执时间尺度 |
| `shape` | `single` / `stream` / `snapshot` | 内容形态 |
| `identityMode` | `known` / `anonymous` / `mixed` | 是否能识别说话人 |
| `direction` | `in` / `out` / `both` | 收 / 发 |
| `frequency` | `human` / `high` / `world-tick` | 事件频率 |
| `modality` | `text` / `multi` | 纯文本还是多媒体 |

可选的 `special` 只用于声明边界，不改变大适配器结构：

```js
special: {
  recall: true,
  edit: false,
  readReceipt: false,
  stream: false
}
```

## 5.3 open(ctx)

启动时调用一次。

```js
export async function open(ctx) {
  // ctx.emit(event) 上报事件
  // ctx.log(level, message, meta) 写日志
  // ctx.describePersona(opts) 窄口，只读人格描述
}
```

`ctx` 由大适配器注入，不是内核对象。  
扩展不能从 `ctx` 拿到记忆、数据库、设置文件或其它扩展。

## 5.4 send(intent, { ctx })

大适配器把内核意图交给扩展执行。

```js
export async function send(intent, { ctx }) {
  // intent.kind: say | send_media | act | ask | stay_silent | close | remember | cancel | mark_read | recall
  // intent.channel: 目标频道
  // intent.text / intent.media / intent.action / ...
  return { status: 'delivered' };
}
```

允许返回：

```text
delivered
failed
unsupported
throttled
unconfirmed
```

不返回或返回未知状态，按 `delivered` 处理；抛异常会被包成 `failed`。

## 5.5 生命周期

```text
open()      启动
health()    心跳；返回 {status:'ok'|'down'|'degraded'}
close()     停止
uninstall() 卸载清理
```

启动失败只影响当前扩展，不影响其它扩展。

---

# 6. 事件契约

扩展通过 `ctx.emit(event)` 上报。

```js
ctx.emit({
  type: 'message.received',
  from: {
    channel: 'example:default',
    kind: 'group',        // group | private | other
    actor: 'user-id',     // 可为空（匿名渠道）
    at: Date.now()
  },
  text: '你好',
  media: [],              // 可选
  source: 'user',         // user | manual | system
  tags: [],
  importance: 8
});
```

固定事件：

```text
message.received
message.recalled
presence.changed
stream.chunk
world.tick
world.digest
action.result
decision.requested
adapter.health
```

自定义事件必须带命名空间：

```text
example.gift.sent
example.card.drawn
```

大适配器/内核规则：

- 不认识的事件类型：安静忽略 + 审计，不报错、不崩溃。
- 来源由大适配器盖 `adapter` 戳，扩展不能伪造。
- 媒体超限会裁剪并记录 `mediaDropped`。

---

# 7. 意图契约

内核输出意图，大适配器通过 `send()` 交给小适配器。

```js
{
  id: 'intent-unique-id',
  kind: 'say',
  channel: 'example:default',
  text: '说一句话',
  media: [],
  action: null,
  deadlineMs: 30000
}
```

要求：

- 同一 `id` 收到两次，只执行一次。
- 不支持媒体而收到媒体意图，返回 `unsupported`。
- 超时/限流返回 `throttled`，不要假装成功。
- 真实结果不确定时返回 `unconfirmed`，不要报成功或失败。

---

# 8. 模块功能

模块是扩展自己的业务层，不是内核模块。

```text
module/
  parse.js       解析平台消息
  policy.js      频率/权限/去重策略
  state.js       扩展自己的状态
  handlers.js    业务行为
```

规则：

- 模块不 import `kernel/`、`runtime/`、`packs/<other>/`。
- 模块可以 import 本包内文件。
- 模块不直接发网络请求；网络放 `adapter/`，由小适配器调用。
- 模块尽量纯函数，方便离线单测。
- 模块不得读取 `~/.dsh`、`state/`、其它扩展目录。

依赖方向：

```text
index.js  →  adapter/  →  module/
             ↘ 只调用 module 的纯函数
```

模块不知道“大适配器”和“内核”存在。

---

# 9. 设置与能力声明

`settings` 是给用户看的菜单声明，不是配置文件写入器。

```js
export const settings = [
  {
    key: 'endpoint',
    label: '服务地址',
    type: 'text',
    defaultValue: '',
    maxChars: 300,
    description: '扩展自己使用的地址',
    cost: '填错就发不出去',
    group: 'basic'
  }
];
```

规则：

- 只放用户偏好；安全开关/权限不要做成用户开关。
- 设置值由宿主保存；扩展不要自己写内核配置文件。
- 每个开关都要有测试账。

可选 `ui` 只是声明，不直接渲染：

```js
export const ui = {
  menu: [{ id: 'example', title: 'Example', order: 10 }],
  pages: [{ id: 'example.settings', title: 'Example 设置', kind: 'form', menu: 'example' }]
};
```

---

# 10. 独立性与禁止清单

扩展代码**绝对不许**：

```text
import '../kernel/...'
import '../../kernel/...'
import '../runtime/...'
import '../../runtime/...'
import 'surfcore/kernel'
require('.../kernel')
读取内核 state 文件
读取其它扩展目录
修改 runtime/
修改 kernel/
复制 runtime 源码进扩展
```

允许：

```text
node: 内置模块
本包相对路径
本包自己的依赖（如果宿主允许）
```

### 为什么

- 内核会变，扩展不应跟着坏。
- 大适配器冻结，扩展不应依赖它的内部文件布局。
- 扩展可单独测试、单独停用、单独卸载。

### 开发者可以知道什么

可以知道：

```text
四层架构
大适配器契约
事件/意图/回执形状
六轴能力
内核大致有什么能力
```

不可以依赖：

```text
内核具体文件
内核内部函数
内核数据结构
大适配器内部文件
其它扩展
```

---

# 11. 最小示例

## pack.json

```json
{
  "publisher": "example-dev",
  "name": "example",
  "version": "0.1.0",
  "protocol": 1,
  "entry": "index.js",
  "trust": ["event.publish", "network.out"]
}
```

## index.js

```js
import { parseMessage } from './module/parse.js';
import { createTransport } from './adapter/transport.js';

export const identity = {
  publisher: 'example-dev',
  name: 'example',
  version: '0.1.0',
  source: 'example',
  channel: 'example:default'
};

export const capabilities = {
  timing: 'realtime',
  shape: 'single',
  identityMode: 'known',
  direction: 'both',
  frequency: 'human',
  modality: 'text'
};

let transport = null;
let ctxRef = null;

export async function open(ctx) {
  ctxRef = ctx;
  transport = createTransport({ endpoint: '' });
  transport.onMessage((raw) => {
    const event = parseMessage(raw);
    if (event) ctx.emit(event);
  });
  await transport.start();
}

export async function send(intent) {
  if (intent.kind !== 'say') return { status: 'unsupported' };
  const ok = await transport.sendText(intent.channel, intent.text);
  return { status: ok ? 'delivered' : 'failed' };
}

export async function health() {
  return { status: transport?.alive ? 'ok' : 'down' };
}

export async function close() {
  await transport?.stop();
}

export const settings = [
  {
    key: 'endpoint',
    label: '网关地址',
    type: 'text',
    defaultValue: '',
    maxChars: 300,
    description: '扩展自己的网关地址',
    cost: '填错就收不到消息',
    group: 'basic'
  }
];
```

## module/parse.js

```js
export function parseMessage(raw) {
  if (!raw || raw.type !== 'message') return null;
  return {
    type: 'message.received',
    from: {
      channel: raw.channel,
      kind: raw.isGroup ? 'group' : 'private',
      actor: raw.userId ?? null,
      at: Date.now()
    },
    text: String(raw.text ?? ''),
    source: 'user'
  };
}
```

## adapter/transport.js

```js
export function createTransport({ endpoint }) {
  let alive = false;
  let handler = () => {};
  return {
    get alive() { return alive; },
    onMessage(fn) { handler = fn; },
    async start() { alive = true; },
    async stop() { alive = false; },
    async sendText(channel, text) {
      if (!alive) return false;
      // 在这里调用你自己的平台协议；不要 import 内核
      return true;
    }
  };
}
```

---

# 12. 测试与验收

扩展必须能在**不启动整个世界**的情况下测试：

```text
fake transport
fake clock
fake ctx
纯函数模块测试
```

最低验收：

```bash
node tools/pack-check.mjs --src packs/<name>
npm run test:arch
```

扩展自己的测试：

```text
pack.json 与代码 identity 一致
capabilities 六轴齐全
send() 的 delivered/failed/unsupported/throttled/unconfirmed 都有断言
同一 intent id 不重复执行
事件来源不能被扩展伪造
媒体超限会被报告
```

禁止：

```text
用真实平台账号跑“应该没问题”
把密钥写进测试
把网络请求塞进模块单测
```

---

# 13. 版本与兼容

当前：

```text
大适配器：0.3.0
协议：1
树哈希：d607d26dd5e27bd366dfeb36d56be1b66fac3a26
```

兼容规则：

```text
只加不改：新增可选字段可以
不认就忽略：新事件/新字段安静跳过
协议版本必须带：breaking change 升 protocol
旧版本至少保留一个大版本
```

扩展声明：

```json
{
  "protocol": 1,
  "requires": ["大适配器 >= 0.3.0"]
}
```

---

# 14. 交付清单

一个扩展包合入前必须有：

- [ ] `pack.json` 完整，目录名 = name
- [ ] `index.js` 导出 identity / capabilities / send
- [ ] 六轴能力齐全
- [ ] 不 import 内核、不 import 大适配器内部
- [ ] 模块可独立单测
- [ ] fake transport 测试
- [ ] 失败回执有 `status` / `error`
- [ ] 无二进制、无依赖目录、无密钥
- [ ] 通过 `pack-check` 与 `test:arch`
- [ ] README 写明平台协议、外部依赖、信任声明

---

# 15. 边界总结

```text
内核：灵魂，会变，扩展不能碰。
大适配器：冻结的管道，扩展不能改。
小适配器：把外部世界翻译成契约。
模块：扩展自己的业务，不认外部世界。
```

一句话：

> **扩展可以知道内核存在，但不能依赖内核；可以接入大适配器，但不能修改大适配器。**
