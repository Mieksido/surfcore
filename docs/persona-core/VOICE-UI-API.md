# 语音 UI 同源接口（前端）

> 前端只访问 `16460` 的 `/surfcore-api/voice/*`。
> 不启动进程、不填地址、不填 token、不处理 CORS。
> 宿主直接调用内核 `kernel/voice`；4317 不参与产品路径。

---

## 1. Base

```text
http://127.0.0.1:16460/surfcore-api/voice
```

浏览器同源，无需 `x-voice-token`。

---

## 2. 端点

```text
GET    /status
GET    /models
GET    /providers
POST   /providers
DELETE /providers/:id
POST   /models/load
POST   /models/unload
POST   /models/select
POST   /models/relink
POST   /models/probe
POST   /models/synthesize
POST   /models/import
```

### GET /status

```json
{
  "ok": true,
  "active": "local",
  "models": [
    {
      "modelId": "local",
      "kind": "local",
      "voiceId": "loli12-gsv",
      "label": "本地音色",
      "state": "loaded",
      "available": true
    }
  ],
  "providers": [
    {
      "id": "cloud",
      "kind": "cloud",
      "vendor": "volcano",
      "configured": true,
      "appIdMasked": "377****41",
      "hasAccessKey": true,
      "accessKeyMasked": "0f7****IaC",
      "resourceId": "seed-icl-2.0",
      "speaker": "S_xxx",
      "endpoint": "http://127.0.0.1:8767"
    }
  ]
}
```

模型 state：

```text
missing / idle / loaded
```

不返回目录、端口、启动命令。

### 模型操作

```json
POST /models/load
POST /models/unload
POST /models/select
{ "modelId": "local" }
```

`select`：

```json
{ "ok": true, "active": "local" }
```

### `POST /models/relink`

目录被改名/移动后重新定位：

```json
{ "modelId": "local", "dir": "D:\\voice\\models\\local" }
```

- 校验目录里的 manifest / 哈希
- 更新 `artifactDir`
- 目录 manifest 里有 runtime 时，**同时刷新 runtime**（启动能力一起修）
- 不复制、不删除
- 模型名做别名归一：`voice-local` = `local`，`voice-cloud` = `cloud`；其它不匹配返回 `ok:false`

### 试合成 / 合成

```json
POST /models/probe
{ "modelId": "local", "text": "你好呀" }

POST /models/synthesize
{ "modelId": "local", "text": "你好呀", "voiceId": "loli12-gsv" }
```

返回：

```json
{ "ok": true, "bytes": 43244, "durationMs": 900 }
```

### Provider

当前云端服务商：火山引擎声音复刻 2.0。

```json
POST /providers
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

事实：

- `kind` 只能 `local` / `cloud`
- 云端 `configured` 需要 AppID + AccessKey + speaker
- `resourceId` 默认 `seed-icl-2.0`
- 更新不传 `accessKey` 保留旧 Key
- 响应只回：

```json
{
  "appIdMasked": "app****23",
  "hasAccessKey": true,
  "accessKeyMasked": "0f7****IaC",
  "resourceId": "seed-icl-2.0",
  "speaker": "S_xxx",
  "configured": true
}
```

- 保存时会真正写模型工件的 `config.toml`（cloud_app_id/cloud_access_key/cloud_resource）和 `voices/<voiceId>/voice.json`（speaker）
- 返回 `applied:true`；没有导入云端模型时返回 `applied:false + applyError`，不假装已写入
- 原始 AppID/AccessKey 不回显

### 模型导入

`sourceDir` 可以是本地目录或 `.zip`：

```json
POST /models/import
{
  "sourceDir": "D:\\voice\\voice-local-offline-v1.0.0-win-x64.zip",
  "targetDir": "D:\\voice\\models\\local",
  "force": false,
  "deleteSource": false,
  "model": {
    "id": "voice-local",
    "kind": "local",
    "voiceId": "loli12-gsv",
    "label": "本地音色"
  }
}
```

事实：

- 支持新 `model.json` / `voice-model.json`
- 支持旧 `offline-manifest.json`
- 旧 `provenance` 元数据跳过
- 旧云端无 weights 也合法
- 旧 zip 没有 runtime 时按模型推导：local → 8765，cloud → 8767；推导不出直接 import 失败
- 旧 zip 里有 `run.bat` / `voxd` + `.venv` / `api.py` 时，导入会生成可启动 runtime；`load` 会真正拉起服务，不再只 probe
- 启动本地/云端服务时不弹黑框：优先直接 hidden 起 Python；本地 GSV 也 hidden 起；`run.bat` 只在没有 Python 时兜底
- 解释器 runtime 的 `entry` 若不在 args 里，内核自动补到 args 首位
- 支持 `weights[]` / `files[]`
- API 不接受 `runtime.command`；只从 manifest 读取
- `runtime.command` 必须是工件内相对路径，或白名单解释器（`node/python/python3/py`）
- 解释器必须有工件内 `entry`，且 entry/command 带 SHA256
- 大 zip 默认解压到 **target 同盘** 的 `.surfcore-voice-tmp`，不再默认用 C 盘系统临时目录
- 解压前检查临时目录 + target 空间；不够直接返回 `voice-model.tmp-space`
- 空间不足示例：`需要 14.7GB，当前 4.2GB`，带 `needBytes/freeBytes`
- `SURFCORE_VOICE_TMP` 仍可显式覆盖，但不是用户必填项
- 浏览器文件上传还没做，当前 `sourceDir` 是本地路径
- `deleteSource: true` 时，**只有 import 成功后**才删除源 `.zip`
- 删除只针对 `.zip` 文件；目录不删
- 删除失败不会把 import 判失败，返回：

```json
{
  "ok": true,
  "model": { "...": "..." },
  "sourceDeleted": false,
  "sourceDeleteError": "删除源 zip 失败：..."
}
```

- `deleteSource` 默认 `false`；为 false 时不返回 `sourceDeleted`
- 前端勾选框文案由前端维护：默认关闭的“导入成功后删除原 zip（不可恢复）”

---

## 3. 错误

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

宿主代理错误：

```json
{
  "ok": false,
  "error": {
    "code": "voice.control.down",
    "message": "语音控制面没有响应",
    "hint": "确认本机语音控制面已启动"
  }
}
```

---

## 4. 边界

| 层 | 负责 |
| --- | --- |
| 内核 `kernel/voice` | 模型工件/装载/卸载/选择/合成/provider |
| 大适配器 `runtime/` | 不参与语音管理，0 改动 |
| 宿主插件 | 同源代理 `/surfcore-api/voice/*`；token 由宿主内部带 |
| UI | 只调同源路径；不启动进程、不读 state、不填 token |

4317 只是宿主内部/调试控制面，不是 UI 入口。
