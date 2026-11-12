# QQ 工作区不跟随 DSH 默认模型 + 不认思考强度的模型一直失败

日期：2026-11-03

对应：GitHub PR #33

## 现象

- 用户在 DSH 的「默认模型」里改成 A，QQ 聊天 / QQ 黑话学习仍然用 `config.json → dsh.model` 的 B。
- 回 Web GUI 看默认模型，发现被改回 B：QQ 每说一句话就把全局默认写回 config 值。
- 有些模型直接报：

```text
session/model-unavailable
provider "dfy" model "deepseek-v4.1-flash-1017"
does not support reasoning effort "max"
```

## 根因

- `ensureChatModel()` 只读 `config.json`，不读 `session.modelCatalog.default`。
- DSH 的 `session.selectModel()` 会在后台 `agentDefaultModel.saveSelection()`，所以 QQ 每轮把全局默认改回 config 值，Web GUI 与 QQ 双向拉锯。
- `ensureChatModel()` 每次都带 `reasoningEffort`，模型不认时没有“去掉该参数重试”的路径。

## 修法

### 1. 新增 `src/dsh-model-follow.js`

纯逻辑：

- `defaultSelectionOf(catalog)`
- `effectiveChatModel({ followDefault, config, defaultSelection, defaultError })`
- `writesGlobalDefault({ followed, provider, model, reasoningEffort })`

规则：

```text
followDefault 默认开
→ 读到 DSH 默认：用默认；默认没给强度就沿用 config
→ 读不到：退回 config，并带 defaultError
→ 显式关闭：用 config，不产生失败原因
```

### 2. bridge

- `resolveDefaultModel()`：15s 缓存、3s 超时、失败只记一次；
- `ensureChatModel()` 跟随默认，日志标「（跟随 DSH 默认模型）」；
- `modelAppliedKeys` 按 `source/provider/model/effort` 记指纹：DSH 默认在外部改了，epoch 不变也能重新 selectModel；
- `GET /api/dsh/model` 返回：
  - `followDefault`
  - `modelSource`（dsh-default / config）
  - `effectiveReasoningEffort`
  - `configProvider` / `configModel` / `configReasoningEffort`
  - `defaultModel` / `defaultModelError`
  - `globalSideEffect` 由 `writesGlobalDefault()` 计算
- `POST /api/dsh/follow-default` 写 `dsh.followDefaultModel`，失败返回 `config-write-failed` + hint。
- 模型不认思考强度时，本进程记住 `provider/model`，第二次只传 provider/model。

### 3. 用户提示

- `public/console.html`：勾选 + 来源说明（关闭 / 正在跟随 / 想跟没读到 + 原因）+ 保存失败回弹。
- `plugins/surfcore/lib/client.js`：
  - 设置页模型卡片同样加勾选、来源说明、失败红字；
  - 真正跟随中时禁用模型/强度下拉和保存按钮，避免“改了也没用”；
  - 关闭/失败时允许改 config 兜底值；
  - 保存按钮旁明确写“会改 DSH 全局默认”。

## 没有做

- 没有真机 QQ 消息验证 `ensureChatModel` 日志。
- 没有真实模型不认 effort 的端到端测试；用静态接线 + 纯逻辑测试。
- 没有拦 DSH 的 `saveSelection`；那是 DSH 契约。
- 15s 缓存意味着改默认最多 15 秒后生效。

## 风险

- 跟随失败退回 config，用户可能没注意到；两处 UI 都显示原因。
- `selectModel` 的全局副作用仍在；跟随成功时写的是同一个值，等于没改。
- 不认 effort 的模型会去掉强度，管理员设置的强度被忽略；日志会写。
- 旧 DSH 没有 `modelCatalog.default` 时只能退回 config。
- 两个 UI（旧控制台 / 设置页）都要维护，漏一个就半个功能。

## 验证

```text
node scripts/test-dsh-model-follow.mjs
node scripts/test-audit-bridge.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
