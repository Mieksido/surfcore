# 旧语音 zip 真实导入记录

日期：2026-11-12  
源：

```text
D:\deepseekwork\surfcore_resource\voice\voice-local-offline-v1.0.0-win-x64.zip
D:\deepseekwork\surfcore_resource\voice\voice-cloud-offline-v1.0.0-win-x64.zip
```

## 结果

```text
voice-cloud-offline：
  ok: true
  model: voice-cloud
  version: 1.0.0
  voiceId: age12-cloud
  耗时: 36.8s
  installed: true

voice-local-offline：
  ok: true
  model: voice-local
  version: 1.0.0
  voiceId: loli12-gsv
  耗时: 231.8s
  installed: true
```

## 兼容形状

真实旧 manifest：

- 旧本地：`voice.weights.t2s/vits` + `provenance` 元数据（无 path/hash）
- 旧云端：`voice` 没有 `weights`
- 两者都不要求 `kind` 之外的新字段
- 两者都没有 `runtime`：导入时按模型名推导 local → 8765 / cloud → 8767；推导不出直接失败

解析结果：

- 旧本地：保留 2 个权重，跳过 `provenance`
- 旧云端：0 个权重也合法

## 临时目录验收

```text
C 盘剩余 4.2GB / D 盘 176GB
target = D:\deepseekwork\_voice-import-accept
SURFCORE_VOICE_TMP 未设置
本地 zip import：ok
runtime：http://127.0.0.1:8765
耗时：220.7s
target 安装：true
target 同盘 .surfcore-voice-tmp：空（已清理）

云端 zip 同条件：ok / 26.5s / runtime 8767 / 临时目录已清理
```

## 旧包装载（不弹黑框）

云端旧包导入后 runtime 优先直接起 `.venv/Scripts/python.exe`，不再走 `run.bat`：

```json
{
  "kind": "process",
  "command": ".venv/Scripts/python.exe",
  "args": ["-m", "voxd", "--config", "config.toml"],
  "endpoint": "http://127.0.0.1:8767",
  "transport": "voxd",
  "shell": false,
  "inferred": true,
  "stopCommand": "stop.bat"
}
```

本地包还会生成 `preStart`：直接 hidden 启动 GSV 9880，不走 `gsv.bat`。

子进程统一 `windowsHide:true` + `stdio:'ignore'`；`run.bat` 只在没有 python 时兜底。

导入后有 `config.example.toml` 但无 `config.toml` 时，load 会自动生成 `config.toml` 再启动。

空间不足预检（target 放 C 盘）：

```json
{
  "ok": false,
  "code": "voice-model.tmp-space",
  "error": "临时空间不足：需要 14.7GB，当前 4.2GB",
  "hint": "把安装目录换到空间足够的磁盘",
  "needBytes": 15783796574,
  "freeBytes": 4494962688,
  "estimated": false
}
```

## 注意

本地 zip 约 5GB，解压后约 7.35GB；target 还要再放一份。
现在默认临时目录在 target 同盘（`.surfcore-voice-tmp`），不再默认写 C 盘；解压前检查空间，不足直接返回 `voice-model.tmp-space`。
