# 模型设置选不了 / 选了无法证明真的加载

日期：2026-11-02

## 现象

- 设置页「模型与思考强度」显示：
  ```text
  未知接口：/dsh-surfcore/api/dsh/effort
  DSH 模型目录读取失败：现在只能调思考强度；刷新后再换模型。
  ```
- 模型下拉只有「（当前）」，选不了其他模型。
- 即使保存成功，也只是配置回显；没有证据证明 DSH 真的加载了模型/强度。

## 根因

### 1. 宿主缺代理路由

前端：

```js
api("/dsh/model")
api("/dsh/effort")
```

实际请求：

```text
/dsh-surfcore/api/dsh/model
/dsh-surfcore/api/dsh/effort
```

宿主 `plugins/surfcore/lib/index.js` 只注册了：

```js
API_PREFIX + '/dsh/repair'
```

没有 `/dsh/model`、`/dsh/effort`，所以 404 `未知接口`。

### 2. 桥接其实有实现

`src/bridge.js` 有：

```text
GET/POST /api/dsh/model
POST     /api/dsh/effort
```

但它们在桥接控制台端口，Web 设置页不直连，必须宿主代理。

### 3. 保存只写配置，不是应用

`POST /api/dsh/model` / `POST /api/dsh/effort` 只写：

```js
file.dsh = { provider, model, reasoningEffort };
cfg.dsh = ...
modelSelectionEpoch += 1;
```

没有立即调用 `session.selectModel`。

真正应用发生在下一条消息的 `ensureChatModel()`：

```js
const result = await api.sessions.selectModel({ sessionId, provider, model, reasoningEffort });
log(`已设置会话模型 ...`);
return 'applied';
```

`result.selected` 被丢掉，UI 看不到。

### 4. GET 返回配置，不是实际

`GET /api/dsh/model` 返回 `cfg.dsh`。  
UI 保存后重新 GET，只能把自己的配置读回来，形成“自证循环”。

## 修法

### 1. 宿主代理

`plugins/surfcore/lib/index.js` 新增：

```js
proxyDshModel()
proxyDshEffort()
```

注册：

```text
/dsh-surfcore/api/dsh/model
/dsh-surfcore/api/dsh/effort
```

转发到桥接：

```text
/api/dsh/model
/api/dsh/effort
```

错误统一带 `code / error / hint`；桥接不可用时 502，不再 404“未知接口”。

### 2. 证据链状态

新增 `state/model-status.json`：

```json
{
  "requested": { "provider": "...", "model": "...", "reasoningEffort": "max", "at": "..." },
  "lastApply": {
    "ok": true,
    "sessionId": "session-...",
    "selected": { "provider": "...", "model": "...", "reasoningEffort": "max" },
    "at": "...",
    "evidence": "session.selectModel"
  },
  "lastUsed": {
    "sessionId": "session-...",
    "provider": "...",
    "model": "...",
    "at": "...",
    "evidence": "model/selection"
  },
  "pending": false,
  "bootAt": "..."
}
```

- 保存 → `requested` + `pending:true`
- `ensureChatModel` 成功 → `lastApply.selected`
- `ensureChatModel` 失败 → `lastApply.ok:false + error/code`
- `model/selection` → `lastUsed`
- 桥接重启后旧 `lastApply` 标 `lastApplyStale`

### 3. UI 三态

- 保存后：
  ```text
  已保存配置；还没有 DSH 应用回执。下一条消息会调用 selectModel。
  ```
- 成功：
  ```text
  DSH 已接受：provider/model · effort（时间，会话）
  最近一次 model/selection：...
  ```
- 失败：
  ```text
  应用失败：DSH 拒绝/会话不存在
  ```
- 跨进程旧回执：
  ```text
  上次应用记录在当前桥接启动前，不能证明本次进程已加载
  ```

保存按钮不再写“已切换/已生效”。

## 没有做

- 没有证明“每条回复实际使用的模型”：仍需要 DSH usage/model 元数据。
- 没有在保存时主动 `selectModel`（会打断当前回合/改全局默认）。
- 没有改 DSH 全局默认的副作用；UI 仍警告。
- 没有做多会话逐条状态 UI（status 有 sessions，但 UI 只展示最近一次）。

## 风险

- `selectModel.selected` 只证明 DSH 接受，不证明 provider 最终路由。
- `reasoningEffort` 没有 usage 证据时只能证明“接受”，不能证明“实际推理档位”。
- 保存时正在跑的回合仍用旧模型，UI 必须保持 pending。
- 桥接重启后旧状态用 `bootAt` 标记 stale。
- 多群会话各自应用，UI 的 lastApply 只是最近一次。
- 全局默认模型会影响 Web GUI 新会话。

## 验证

```text
node scripts/test-model-settings.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
