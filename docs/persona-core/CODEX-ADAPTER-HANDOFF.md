# 适配器扩展交接：DSH 会话 → Codex

> 这份文档分两段：
> **A 段给 DSH 统筹会话**，负责转交和验收。
> **B 段给 Codex**，是独立、自包含的施工说明。
>
> Codex 不需要看 DSH 的聊天记录；把 B 段原样给它即可。

---

# A. 给 DSH 统筹会话

## A0. 你现在的角色

你是 **架构/统筹会话**，不是这次写包的人。

- 你负责确认边界、转交、验收。
- Codex 负责六个新包的代码。
- 不要重写架构，不要重新解释四层，不要动 `runtime/`。
- 当前记忆切流还在进行中；这次任务**不要碰记忆/语音/前端**。

## A1. 先核对事实

仓库：

```text
D:\deepseekwork\surfcore-persona-core
```

当前分层：

```text
内核 kernel/ → 大适配器 runtime/ → 小适配器 packs/<name>/index.js → 模块 packs/<name>/*.js
```

当前包：

```text
packs/qq
packs/bilibili
packs/desktop-pet
packs/web
```

当前大适配器：

```text
runtime/：8 文件 / 1,003 行
冻结树哈希：d607d26dd5e27bd366dfeb36d56be1b66fac3a26
```

核对：

```bash
git status --porcelain
git rev-parse HEAD:runtime
```

如果工作区不干净，先让当前会话收走；不要在一个脏工作区上叠加 Codex 的改动。

## A2. 这次要加什么

新增六个平台包：

```text
packs/tieba         贴吧
packs/wechat        微信
packs/xiaohongshu   小红书
packs/douyin        抖音
packs/minecraft     我的世界
packs/sts2          杀戮尖塔 2（沿用旧扩展名 sts2）
```

每个包都是：

```text
小适配器：packs/<name>/index.js
模块：    packs/<name>/*.js
```

**不是**新层，**不是** `extensions/`，**不是** `src/platforms/`，**不是** 改 `runtime/`。

## A3. 转交动作

1. 确认 A1 的哈希没变。
2. 把 B 段原样交给 Codex。
3. 给 Codex 一个独立工作树/分支，不要和当前会话共用脏工作区：

```bash
git worktree add ..\surfcore-packs-codex -b feat/packs-external
```

4. 只让 Codex 改：

```text
packs/tieba/**
packs/wechat/**
packs/xiaohongshu/**
packs/douyin/**
packs/minecraft/**
packs/sts2/**
docs/persona-core/capability-map.json
docs/persona-core/CAPABILITY-MAP.md
```

5. Codex 返回后，按 A4 验收；不合格的打回，不让它“下次再说”。

## A4. 验收清单

```bash
node packs/contract.test.mjs
node tools/pack-check.mjs --src packs/tieba
node tools/pack-check.mjs --src packs/wechat
node tools/pack-check.mjs --src packs/xiaohongshu
node tools/pack-check.mjs --src packs/douyin
node tools/pack-check.mjs --src packs/minecraft
node tools/pack-check.mjs --src packs/sts2
npm run test:arch
git diff -- runtime
git status --porcelain
```

必须满足：

- `git diff -- runtime` 为空。
- `git rev-parse HEAD:runtime` 仍是 `d607d26d...`。
- `packs/contract.test.mjs` 全过（它会自动发现新包）。
- 每个包有自己的模块测试；没有真实网络调用。
- 新增文件都在 `packs/<name>/` 和能力清单/文档。
- 没有 `node_modules`、二进制、密钥、`state/`、`config.json`。
- 没有 import `runtime/`、`kernel/`、其他包。
- 内核文件没有新增任何平台字样。
- 前端目录没有改动。

## A5. 什么情况下必须打回

Codex 只要提出下面任何一项，就停：

- “需要改 `runtime/`”
- “需要给内核加一个平台分支”
- “需要新建一层/新目录放适配器”
- “需要改前端”
- “需要把旧插件代码整体搬过来”
- “需要把凭据提交进仓库”
- “真实平台没通，但先标 done”

正确的退路是：**包内 fake transport 通过；真实网关没接就标 partial，并写清缺什么**。

## A6. 交给 Codex 的话

可以直接复制：

> 你负责在 `D:\deepseekwork\surfcore-persona-core` 新增六个平台包：tieba、wechat、xiaohongshu、douyin、minecraft、sts2。  
> 严格只写 `packs/<name>/` 和对应能力清单；不要改 `runtime/`、`kernel/`、`plugins/`、UI。  
> 大适配器冻结哈希 `d607d26dd5e27bd366dfeb36d56be1b66fac3a26`。
> 完整契约、模板、验收命令见 `docs/persona-core/CODEX-ADAPTER-HANDOFF.md` 的 B 段。  
> 每个包先过 fake transport 测试；真实网关没接就标 partial，不许假装已连通。

---

# B. 给 Codex

## B0. 任务一句话

在当前四层架构下，新增六个**小适配器 + 模块**平台包：

```text
贴吧 / 微信 / 小红书 / 抖音 / 我的世界 / 杀戮尖塔 2
```

只写 `packs/<name>/`，不改大适配器，不改内核，不改前端。

## B1. 仓库与边界

仓库：

```text
D:\deepseekwork\surfcore-persona-core
```

允许改：

```text
packs/tieba/**
packs/wechat/**
packs/xiaohongshu/**
packs/douyin/**
packs/minecraft/**
packs/sts2/**
docs/persona-core/capability-map.json
docs/persona-core/CAPABILITY-MAP.md
```

禁止改：

```text
runtime/**          ← 大适配器，冻结
kernel/**           ← 内核
plugins/**          ← 旧宿主
surfcore-ui/**      ← 前端
任何 src/ 或 extensions/ 新目录
```

大适配器核对：

```bash
git rev-parse HEAD:runtime
# 必须是 d607d26dd5e27bd366dfeb36d56be1b66fac3a26
git diff -- runtime
# 必须为空
```

## B2. 当前大适配器契约（不要改它，照它写）

### B2.1 一个包是什么

```text
packs/<name>/
  pack.json      ← 清单：发布人/名字/版本/协议/入口/权限
  index.js       ← 小适配器：四块 + 生命 + 收发
  *.js           ← 模块：平台协议、解析、限频、状态
```

`pack.json` 形状：

```json
{
  "publisher": "surfcore",
  "name": "tieba",
  "version": "0.1.0",
  "protocol": 1,
  "entry": "index.js",
  "trust": ["event.publish", "network.out"],
  "requires": ["tieba-gateway（用户自备，不随包分发）"]
}
```

规则：

- `name` 必须和目录名、`identity.name` 完全一致。
- `version` 必须是 `x.y.z`。
- `protocol` 必须是 `1`。
- `trust` 只放实际需要的；不要写 `fs.local`、`spawn.process`。
- `requires` 写清楚外部网关；包内不打包网关、SDK、运行时。
- 包内不允许：二进制、`node_modules`、第三方专有运行时、锁文件、凭据、`state/`。

### B2.2 `index.js` 必须有的面

当前 `packs/contract.test.mjs` 要求：

```text
identity
capabilities
settings
ui
open
send
health
close
```

另外建议保持现有包的模式：

```text
configure()          设置注入（宿主/测试用）
toolDeclarations()   可选：给模型的只读/数据工具
runTool()            可选：工具执行
uninstall()          可选：卸载清理
```

最小骨架：

```js
export const identity = {
  publisher: 'surfcore',
  name: 'tieba',
  version: '0.1.0',
  source: 'tieba',
  channel: 'tieba:default',
};

export const capabilities = {
  timing: 'async',        // realtime | async
  shape: 'single',        // single | stream | snapshot
  identityMode: 'known',  // known | anonymous
  direction: 'both',      // both | out | in
  frequency: 'human',     // human | high
  modality: 'multi',      // text | multi
  special: { recall: false, edit: false, readReceipt: false },
};

export const settings = [];
const ui = { menu: [{ id: 'tieba', title: '贴吧', order: 60 }], pages: [] };

let started = false;
let transport = null;

export function configure(cfg = {}) { /* endpoint/token 等，不打印 secret */ }

export async function open(ctx) {
  started = true;
  // 没有网关：不要假装成功；health 返回 down/degraded
}

export async function send(intent = {}) {
  if (!started) return { status: 'failed', error: { code: 'tieba.not-started', message: '包未启动' } };
  if (intent.kind === 'stay_silent' || intent.kind === 'close') return { status: 'delivered' };
  if (intent.kind === 'say') { /* 真的发文本 */ }
  if (intent.kind === 'send_media') { /* 有能力才发；否则 unsupported */ }
  if (intent.kind === 'act') { /* 游戏/世界动作 */ }
  return { status: 'unsupported', error: { code: 'adapter.not-implemented', message: `不支持 ${intent.kind}` } };
}

export async function health() { return { status: started ? 'ok' : 'down' }; }
export async function close() { started = false; transport = null; }

export default {
  identity, capabilities, settings, ui, configure, open, send, health, close,
};
```

### B2.3 大适配器实际怎么调用你

上行：

```js
ctx.emit(event)
```

- 大适配器会盖 `event.from.adapter`（防冒充）和默认 `from.channel`。
- 你负责 `event.from.actor/kind/at`、`event.to`、`text`、`media`、平台解析。
- 不要自己伪造来源。

下行：

```js
pack.send(intent, { ctx })
```

- 大适配器负责幂等（同一 `intent.id` 只执行一次）、能力门、异常兜底。
- 你只执行这一次；不要在包内再做一套全局幂等表。
- 返回 `status` 必须是：

```text
delivered / failed / unsupported / throttled / unconfirmed
```

- 失败给结构化错误：

```json
{ "status": "failed", "error": { "code": "tieba.gateway-down", "message": "网关没连上", "hint": "检查 endpoint", "retryable": true } }
```

- 不要把异常直接抛给宿主；宿主虽然会兜底，但包自己应该给出人话错误。

### B2.4 事件形状（按现有契约）

最小可用：

```js
{
  type: 'message.received',
  text: '...',
  from: {
    channel: 'tieba:thread:123',
    kind: 'group',        // 或 private / other
    actor: '...',
    at: Date.now(),
  },
  to: { owner: false, circle: [] },
  media: [],
}
```

规则：

- `from.channel` 是**平台内不透明频道**；内核不认识平台名，只当字符串。
- 说话人可空（匿名渠道）；不要假设总有 `actor`。
- 时间可空；空时由大适配器补。
- 媒体只传引用/替身；不要塞原始大字节。
- 不认识的平台事件：包内丢弃并记日志，不要造一个内核不认识的结构。

## B3. 六个包的具体目标

> 先做 **可离线验证的包 + fake transport**；真实网关不在包内。
> 真实网关没接通的包，能力清单标 `partial`，不要标 `done`。

### B3.1 `packs/tieba` — 贴吧

- `identity.name = 'tieba'`，`source = 'tieba'`，`channel = 'tieba:default'`
- 建议能力：`async / single / known / both / human / multi`
- 功能：
  - 读：贴吧主题帖、楼层、搜索、帖子详情
  - 发：回帖、楼中楼、文本、图片（网关支持才发）
  - 事件：`message.received`（新回复/新楼）、可选 `presence.changed`
- 外部依赖：用户自备贴吧网关/登录态；包内不做账号登录自动化。
- 限频：声明在 settings；模块里实现，不靠内核。

### B3.2 `packs/wechat` — 微信

- `identity.name = 'wechat'`，`source = 'wechat'`，`channel = 'wechat:default'`
- 建议能力：`realtime / single / known / both / human / multi`
- 功能：
  - 收：私聊、群聊文本、图片、语音转写（网关给多少用多少）
  - 发：文本、图片；语音/文件按网关能力声明
  - 事件：`message.received`、`presence.changed`
- 外部依赖：用户自备本地微信桥；**不打包任何微信客户端、SDK、协议二进制**。
- 安全：token/endpoint 由设置或环境给；不写日志、不进包。

### B3.3 `packs/xiaohongshu` — 小红书

- `identity.name = 'xiaohongshu'`，`source = 'xhs'`，`channel = 'xhs:default'`
- 建议能力：`async / single / known / both / human / multi`
- 功能：
  - 读：笔记、评论、搜索、用户主页
  - 发：评论、发布笔记（网关支持才做）
  - 事件：`message.received`（新评论/新笔记）、可选 `presence.changed`
- 外部依赖：用户自备网关/登录态；包内不做登录自动化，不打包浏览器。

### B3.4 `packs/douyin` — 抖音

- `identity.name = 'douyin'`，`source = 'douyin'`，`channel = 'douyin:default'`
- 建议能力：`realtime / stream / known / both / high / multi`
- 功能：
  - 收：评论、直播弹幕、进场、礼物（自定义事件必须带命名空间，如 `douyin.gift.sent`）
  - 发：评论、直播弹幕、文本；合拍/视频只做能力声明，不假装能发
  - 高频：不要每帧 emit；按秒/窗口聚合为 `world.digest` 或摘要事件
- 外部依赖：用户自备直播/评论网关；不打包抖音 SDK、不内置签名算法。

### B3.5 `packs/minecraft` — 我的世界

- `identity.name = 'minecraft'`，`source = 'minecraft'`，`channel = 'minecraft:default'`
- 建议能力：`realtime / snapshot / known / both / high / text`
- 功能：
  - 收：聊天、进服/退服、玩家列表、世界状态（坐标/血量/背包/时间）
  - 发：聊天、服务器指令、`act` 动作（动作名由包定义，内核不枚举）
  - 高频：`world.tick` 只给必要状态；人话战报用 `world.digest`
- 外部依赖：用户自备 RCON/WS/HTTP 网关；包内可实现纯 JS RCON 客户端，但不要把 MC 服务端/模组打进包。
- 边界：不直接改世界存档；不读取本机游戏进程。

### B3.6 `packs/sts2` — 杀戮尖塔 2

- `identity.name = 'sts2'`，`source = 'sts2'`，`channel = 'sts2:default'`
- 建议能力：`realtime / snapshot / known / both / high / multi`
- 功能：
  - 收：局面快照（角色/血量/金币/层数/手牌/遗物/敌人意图）
  - 发：`act` 动作（出牌、结束回合、选择、购买、跳过；动作名由包定义）
  - `decision.requested`：只有真的需要她决策时，低频发；不要每帧问
- 外部依赖：用户自备 STS2 本地模组/WS 桥；不打包游戏文件、模组二进制。
- 安全：只读局面 + 走模组公开接口；不改存档。

## B4. 模块怎么分

推荐每个包这样分：

```text
packs/<name>/
  index.js       小适配器：identity/capabilities/settings/ui/lifecycle/send
  gateway.js     传输端口：HTTP/WS/RCON；可注入 fake
  protocol.js    原始平台数据 ↔ 统一事件/意图
  state.js       本地内存状态（不需要落盘）
  <name>.test.mjs
```

规则：

- `gateway.js` 不 import `runtime/`、`kernel/`、其他包。
- `index.js` 只 import 自己的模块 + Node 内置。
- 模块不自己画界面；`ui` 只是声明数据。
- 模块不直接读写记忆；记忆由内核单写。
- 高频状态不要全量落盘；包内只保留必要窗口。
- 测试注入 fake transport，不启动网络。

## B5. 测试要求

每个包至少覆盖：

1. `pack.json` 与 `identity` 一致（`packs/contract.test.mjs` 自动覆盖）。
2. `capabilities` 六条轴齐全。
3. `settings` key 不重复；`ui` id 不重复。
4. `send('say')` → `delivered`（fake gateway）。
5. `send('send_media')`：
   - `modality: 'text'` → `unsupported`
   - 声明 multi 且 fake 支持 → `delivered`
6. `send('act')` → 映射到 fake gateway 的 action（游戏类必测）。
7. 未知 intent → `unsupported`，不抛异常。
8. 网关断开 → `failed`，`error.code`、`message`、`hint` 非空。
9. `health()` 在未连/已连分别返回 `down`/`ok` 或 `degraded`。
10. 高频事件不会逐帧 emit；有 digest/聚合断言。

测试中禁止真实网络、真实账号、真实游戏。

## B6. 真实网关与“不能假装”

- 六个平台都需要外部网关/登录态，包内不打包。
- 没有真实网关时：
  - `health()` 返回 `down` 或 `degraded`
  - `send()` 返回 `failed` 或无能力 `unsupported`
  - 能力清单标 `partial`
  - 报告写“真实网关未接”
- 不允许：
  - fake gateway 通过就标 `done` + “真机”
  - 没有网关却返回 `delivered`
  - 把模拟音频/截图说成平台真实回复

## B7. 能力清单

给六个包各加一个模块：

```text
pack.tieba
pack.wechat
pack.xiaohongshu
pack.douyin
pack.minecraft
pack.sts2
```

每条能力写：

```json
{
  "name": "包内能力名（平台名只能在 pack 层，不进 kernel.*）",
  "status": "partial",
  "evidence": "xxx.test.mjs",
  "level": "函数"
}
```

规则：

- 不往 `kernel.*` 加任何平台能力名。
- 没有真机证据，`level` 最多 `函数`，`status` 最多 `partial`。
- 修改 `capability-map.json` 后运行：

```bash
node tools/capability-map.mjs
```

让 `CAPABILITY-MAP.md` 重新生成；不要手改生成物。

## B8. 验收命令

```bash
node packs/contract.test.mjs
node tools/pack-check.mjs --src packs/tieba
node tools/pack-check.mjs --src packs/wechat
node tools/pack-check.mjs --src packs/xiaohongshu
node tools/pack-check.mjs --src packs/douyin
node tools/pack-check.mjs --src packs/minecraft
node tools/pack-check.mjs --src packs/sts2
npm run test:arch
git diff -- runtime
git status --porcelain
```

打包：

```bash
node tools/pack-build.mjs --pack tieba
# 同样对其余五个包跑
```

## B9. 提交与报告

- 一个包一个提交；不要 `git add -A`。
- 提交信息写“新增 <name> 小适配器 + 模块；fake transport 测试”。
- 最终报告必须写：

```text
1. 新增/修改文件
2. 层级：小适配器 / 模块 / 文档；有没有动 runtime
3. 接口内容变化：settings key、tool 名、自定义事件名、错误码
4. 测试命令与结果
5. 真实网关未接的部分（诚实列出）
6. 大适配器哈希校验结果
```

## B10. 停止条件

出现下面任一条，停止并报告，不要自己越界：

- 需要改 `runtime/`
- 需要改 `kernel/`
- 需要新增一层或新目录放适配器
- 需要改前端
- 需要把凭据/状态/二进制提交进仓库
- 真实网关协议无法确认

---

# 附：DSH 验收时看什么

| 项 | 合格 |
| --- | --- |
| 新包位置 | 只在 `packs/<name>/` |
| 大适配器 | `git diff -- runtime` 空，哈希不变 |
| 内核 | 没有新增平台分支/平台能力名 |
| 前端 | 0 改动 |
| 依赖方向 | 模块 → 包 index → 大适配器；包不 import 内核/运行时/其他包 |
| 测试 | 每包 fake transport 测试 + contract + arch |
| 真实网关 | 没接就 partial，不吹 done |
| 能力清单 | 有 `pack.<name>` 条目，证据可跑 |
