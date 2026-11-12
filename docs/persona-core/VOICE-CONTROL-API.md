# 语音控制面（本机；后端内部/调试）

> 前端不要直接调这个服务；前端用同源 [`VOICE-UI-API.md`](VOICE-UI-API.md)。
> 位置：四层之外的本地控制服务 `tools/voice-control-server.mjs`，由宿主同源代理内部调用。
> 只调用内核 `kernel/voice` 的 **model/provider** 公共面；不认识 QQ、桥接、平台、小适配器。
> 不是新层，不是大适配器。

---

## 1. 启动

```powershell
node tools/voice-control-server.mjs --port 4317 --state state/voice-control
```

输出：

```json
{
  "ok": true,
  "url": "http://127.0.0.1:4317",
  "token": "……",
  "stateDir": "……"
}
```

- 只监听 `127.0.0.1`
- 所有 `/voice/*` 带 `x-voice-token`
- token 默认每次启动随机生成，写到 `state/voice-control/token`
- 想固定 token：启动前设 `SURFCORE_VOICE_TOKEN`
- CORS 只放行 `127.0.0.1` / `localhost`
- `/health` 不需要 token

---

## 2. 模型语义

```json
{
  "modelId": "local",
  "kind": "local",
  "voiceId": "v1",
  "label": "local",
  "state": "loaded",
  "available": true
}
```

`state`：

```text
missing / idle / loaded
```

公共响应不包含：

```text
dir / port / start / stop / spawn / 包目录布局
```

---

## 3. 端点

```text
GET    /health
GET    /voice/status
GET    /voice/models
GET    /voice/providers
POST   /voice/providers
DELETE /voice/providers/:id
POST   /voice/models/load
POST   /voice/models/unload
POST   /voice/models/select
POST   /voice/models/relink
POST   /voice/models/probe
POST   /voice/models/synthesize
POST   /voice/models/import
```

### `GET /voice/status`

```json
{
  "ok": true,
  "active": "local",
  "models": [
    {
      "modelId": "local",
      "kind": "local",
      "voiceId": "v1",
      "label": "local",
      "state": "loaded",
      "available": true
    }
  ],
  "providers": [
    {
      "id": "cloud",
      "kind": "cloud",
      "configured": true,
      "hasKey": true,
      "keyMasked": "sk-****12",
      "endpoint": "https://…",
      "model": "tts-1",
      "voiceId": "v1"
    }
  ]
}
```

### `GET /voice/models`

返回模型列表（同上，不含 provider）。

### `GET /voice/providers`

返回 provider 公开档案，不含原始 Key。

### `POST /voice/providers`

```json
{
  "id": "cloud",
  "kind": "cloud",
  "vendor": "volcano",
  "endpoint": "http://127.0.0.1:8767",
  "appId": "火山 AppID",
  "accessKey": "火山 AccessKey",
  "resourceId": "seed-icl-2.0",
  "speaker": "火山声音复刻 ID"
}
```

- `kind` 只能是 `local` / `cloud`
- 云端 configured 需要 AppID + AccessKey + speaker
- 更新不传 `accessKey` 保留旧 Key
- 响应只回 `appIdMasked / hasAccessKey / accessKeyMasked / resourceId / speaker / configured`
- 保存时写模型工件的 `config.toml` 与 `voices/<voiceId>/voice.json`；写不进去返回 `applied:false + applyError`

### `DELETE /voice/providers/:id`

删除 provider。

### `POST /voice/models/load` / `unload`

```json
{ "modelId": "local" }
```

### `POST /voice/models/select`

```json
{ "modelId": "local" }
```

返回：

```json
{ "ok": true, "active": "local" }
```

`GET /voice/status` 的 `active` 就是当前模型。

### `POST /voice/models/relink`

```json
{ "modelId": "local", "dir": "D:\\voice\\models\\local" }
```

- 校验目录里的 manifest / 哈希
- 更新 `artifactDir`
- 目录 manifest 里有 runtime 时，同时刷新 runtime
- 不复制、不删除
- 目录里的模型 id 与 `modelId` 做别名归一：`voice-local` = `local`，`voice-cloud` = `cloud`；其它不一致拒绝

### `POST /voice/models/probe`

```json
{ "modelId": "local", "text": "你好呀" }
```

只试合成，不发消息。

### `POST /voice/models/synthesize`

```json
{
  "modelId": "cloud",
  "text": "你好呀",
  "voiceId": "age12-cloud"
}
```

返回：

```json
{ "ok": true, "bytes": 12345, "durationMs": 800 }
```

### `POST /voice/models/import`

```json
{
  "sourceDir": "D:\\voice\\model-src",
  "targetDir": "D:\\voice\\models\\local",
  "force": false,
  "deleteSource": false,
  "model": {
    "id": "local",
    "kind": "local",
    "voiceId": "v1",
    "label": "本地音色",
    "endpoint": "http://127.0.0.1:8765"
  }
}
```

- 源目录必须是模型工件目录或 `.zip`；也兼容旧 `offline-manifest.json`（导入后作为 legacy 模型）
- 旧 zip 没有 runtime 时按模型推导：local → 8765，cloud → 8767；推导不出直接 import 失败
- 解释器 runtime 的 `entry` 若不在 args 里，内核自动补到 args 首位
- 旧本地/云端 zip 已真机导入通过，见 `VOICE-LEGACY-ZIP-PROBE.md`
- 大 zip 默认解压到 target 同盘 `.surfcore-voice-tmp`；解压前检查空间，不足返回 `voice-model.tmp-space`
- `SURFCORE_VOICE_TMP` 仍可显式覆盖，但不是必填项
- 会校验、算哈希、复制；默认拒绝覆盖
- **runtime.command / args / endpoint 只从工件 manifest 读取，API 的 `model.runtime` 会被忽略**
- `runtime.command` 必须是工件内的相对路径，不允许绝对路径/穿越
- `deleteSource: true`：导入成功后删除源 `.zip`；失败不删；删除失败不回滚 import
- 删除结果：`sourceDeleted: true` 或 `sourceDeleted:false + sourceDeleteError`
- `sourceDir` / `targetDir` 当前是本地路径，不是浏览器文件上传

---

## 4. 错误

```json
{
  "ok": false,
  "error": {
    "code": "voice-model.unknown",
    "message": "没有这个模型：nope",
    "hint": "检查 modelId",
    "retryable": false
  }
}
```

- 401：无 token / token 错
- 404：未知路由或 provider
- 400：参数/操作失败
- 500：内部错误

---

## 5. 未完成

- 浏览器文件上传 / zip 解压
- 安装进度 job
- 音频后处理

真机 TTS 联调已完成：本地 8765 与服务商 8767 均通过，记录见 `VOICE-REAL-PROBE.md`。

---

## 6. 分工

| 层 | 负责 |
| --- | --- |
| 内核 `kernel/voice` | 模型工件/装载/卸载/选择/合成/provider |
| 大适配器 `runtime/` | 不参与语音模型管理，0 改动 |
| 控制服务 `tools/voice-control-server.mjs` | 本机 HTTP 面 |
| UI | 只调 HTTP；不读 state、不启动进程 |

---

## 7. 给前端的可用信息

```text
语音控制面是本机 HTTP 服务，不是旧桥，也不依赖 QQ。

启动：
node tools/voice-control-server.mjs --port 4317 --state state/voice-control

认证：x-voice-token: <启动输出里的 token>
CORS：只允许 127.0.0.1 / localhost

端点：
GET    /health
GET    /voice/status
GET    /voice/models
GET    /voice/providers
POST   /voice/providers
DELETE /voice/providers/:id
POST   /voice/models/load
POST   /voice/models/unload
POST   /voice/models/select
POST   /voice/models/relink
POST   /voice/models/probe
POST   /voice/models/synthesize
POST   /voice/models/import

模型：modelId/kind/voiceId/label/state/missing|idle|loaded
provider：configured/hasKey/keyMasked
错误：{ok:false,error:{code,message,hint,retryable}}
限制：import 的 sourceDir/targetDir 是本地路径，不是浏览器文件上传。
```
