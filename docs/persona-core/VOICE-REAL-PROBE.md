# 语音真机探测记录

日期：2026-11-12  
范围：本机 voxd 兼容语音服务 + 内核 model 公共面；不涉及 QQ/桥接/平台。

## 1. 本地服务

启动：

```text
voice-local/run.bat       → 127.0.0.1:8765
voice-local/gsv.bat       → 127.0.0.1:9880
```

健康：

```text
GET http://127.0.0.1:8765/v1/health → 200
engines: gsv loaded=true, error=null
```

真合成：

```text
POST http://127.0.0.1:8765/v1/speak/file
body {"text":"你好","format":"wav","sr":24000,"cache":true}
→ 200 / 43244 bytes / X-Duration-Ms: 900 / cached:0
```

## 2. 服务商服务

```text
GET http://127.0.0.1:8767/v1/health → 200
engines: cloud loaded=true
```

真合成：

```text
POST http://127.0.0.1:8767/v1/speak/file
body {"text":"你好","format":"wav","sr":24000,"cache":true}
→ 200 / 48254 bytes / X-Duration-Ms: 1004
```

## 3. 内核 model 公共面

用 `createVoiceModels` 直接合成：

```text
local  → ok:true / 43244 bytes / 900ms
cloud  → ok:true / 48382 bytes / 1007ms
```

## 4. 控制面

`POST /voice/models/synthesize`（临时 state，本地 8765）：

```text
200
{"ok":true,"bytes":43244,"durationMs":900}
```

装载：

```text
models.load('local') → {ok:true, modelId:'local', state:'loaded'}
models.status()      → active:'local', state:'loaded', available:true
```

模型：

```text
local  voiceId=loli12-gsv  endpoint=http://127.0.0.1:8765
cloud  voiceId=age12-cloud endpoint=http://127.0.0.1:8767
```

## 5. 工件装载链路

`model-runtime.integration.test.mjs`（真实子进程，不是 mock）：

```text
模型工件 → import → model.load
→ 内核按 manifest runtime.command/entry 拉起 node 子进程
→ 子进程监听 18766
→ 内核合成拿到 WAV
→ model.unload
```

结果：

```text
5 通过，0 失败
```

说明：这条链路用测试 runtime 验证“内核自己拉起进程”的机制；真实本地/云端 TTS 仍由上面的 8765/8767 真机验证。

## 6. 结论

- 本地真模型：通过
- 服务商真模型：通过
- 内核 model 公共面：通过
- 控制面合成：通过
- model.load 连接已启动本地服务：通过
- 工件 → load → 子进程 → 合成 → 卸载：通过
- 未记录任何 Key/凭据/平台账号
