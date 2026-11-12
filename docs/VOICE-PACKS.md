# 语音包：按需安装（默认不装）

surfcore 本体**不带语音引擎**。语音是"可选安装包"，在设置页的「语音功能（可选安装）」里按需装。
不装也能正常聊天，只是不能发语音。

## 两个包

| 包 | 体积 | 端口 | 音色 | 优点 | 代价 |
|---|---|---|---|---|---|
| **本地语音包** | 7.3 GB | 8765 | `loli12-gsv` | 免费、断网可用、1.0~1.5s | 需要 NVIDIA 显卡（6G+），首次装 10~20 分钟 |
| **云端语音包** | 280 MB | 8767 | `age12-cloud` | 质量最好、0.5~1.1s、不占显卡 | 按字符计费（火山引擎收），必须联网，要申请密钥 |

两个互相独立，可以只装一个、也可以都装。

> **关于音色**：`age12` 这个小女孩音色**已经包含在包里**，不需要额外下载：
> - 本地包：245 MB 微调权重 + 4 MB 参考样本，都在 7.3 GB 里
> - 云端包：只是一个复刻 ID 字符串（`S_fxkbW5bj2`），0 字节
> - surfcore 本体：只存音色名字和描述，几 KB

## 装完之后在哪、怎么用

安装目录：`<surfcore>/state/voice-packs/<包 id>/`（控制台上会显示完整路径）

```
state/voice-packs/
  voice-local/
    config.toml      ← 配置（端口、音色、引擎）
    run.bat          ← 启动脚本（控制台"启动"按钮就是执行它）
    stop.bat
    voices/          ← 音色定义（loli12-gsv）
    logs/            ← 请求日志 requests.jsonl
  voice-cloud/
    config.toml      ← 云端密钥就写在这里
    run.bat / stop.bat
    voices/          ← age12-cloud
```

**日常操作全部在设置页完成**：安装 → 启动 → 试听 → 停止 / 卸载。
命令行等价：

```bat
cd state\voice-packs\voice-local
run.bat
```

## 云端包：三步配置（不用自己录音）

### ① 准备一个音色 —— 用包里自带的参考音频

云端包内置了一段 **19 秒、24kHz 的女童声参考音频**（`voicepack/小语-参考音频19秒.wav`，0.9 MB），
设置页点「下载参考音频」就能拿到，**直接上传到火山控制台做声音复刻**，不用自己录。

> 这段音频是合成生成的（Qwen3-TTS VoiceDesign 产出），不对应任何真实人物，可以自由使用。
> 想用自己的声音也行：10~20 秒干净人声（无背景音乐、无杂音），走同样的流程。

流程：下载 wav → 控制台「语音技术 → 声音复刻」上传 → 训练 → 拿到 `S_xxxxxxxx`

### ② 填密钥

在控制台「语音技术」页面复制 **AppID** 和 **Access Key**，粘贴进设置页，再填上一步拿到的音色 ID。

> **安装包不预置任何密钥。** 新装时安装流程会把包里可能残留的 `cloud_app_id` / `cloud_access_key`
> 清空（模板里只有占位符），必须你自己填；重装会保留你已经填好的，不用重填。
> 没填全时点「启动」会被拒绝，并直接告诉你缺哪项。

### ③ 测试连接

点「测试连接」，成功就说明能用了。

保存后写进 `state/voice-packs/voice-cloud/config.toml`：

```toml
cloud_app_id = "..."
cloud_access_key = "..."
cloud_resource = "seed-icl-2.0"   # 不能改，换别的会 403
```

密钥只存在本机，不上传任何服务器。

### 费用说明

按字符计费，由**火山引擎**收取，与本插件无关。每天直播 3 小时约 135 万字符/月。
不想付费就用本地包，效果接近且不要钱——**两个包功能对等，这不是推销**。

## 触发规则（防止炸群）

| 设置 | 默认 | 说明 |
|---|---|---|
| 允许谁触发 | **仅主人** | 群聊里只有被允许的人说话才可能触发语音 |
| 允许 AI 主动发语音 | **关** | 关着时只有你在控制台手动「试发」才出声 |
| 每分钟 / 每小时上限 | 2 / 10 | 防止刷屏 |

改完点「保存触发规则」，写入 `config.json` 的 `socialV2.voice`：

```json
"voice": {
  "trigger": { "who": "owner", "groups": [], "members": [] },
  "maxPerMinute": 2,
  "maxPerHour": 10,
  "tts": { "enabled": false, "baseUrl": "http://127.0.0.1:8765", "character": "xiaoyu" }
}
```

## 接口（给自动化用）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/voice/packs` | 列表 + 安装/运行状态 + 安装进度 |
| POST | `/api/voice/packs/install` | `{id}` 开始安装（异步，轮询 list 看进度） |
| POST | `/api/voice/packs/remove` | `{id}` 卸载（只删 `state/voice-packs/<id>`） |
| POST | `/api/voice/packs/start` / `stop` | `{id}` 启停（start 最多等 60 秒） |
| POST | `/api/voice/packs/cloud-config` | `{id, appId, accessKey, resource}` 写密钥 |
| POST | `/api/voice/packs/test` | `{id, text?}` 试听，返回耗时和音频时长 |
| GET/POST | `/api/voice/rules` | 读/写触发规则 |

全部需要控制台令牌（`x-console-token`）。

## 换分发地址

`src/voice-packs.js` 顶部的 `DEFAULT_MANIFESTS` 里，`url` 支持三种：

- `https://…/voice-local-1.0.0.zip`（分发用，GitHub Releases）
- `<本地目录>\voice-local`（开发用，本地目录直接复制）
- `<本地目录>\pack.zip`（本地 zip）

也可以用环境变量覆盖：`SURFCORE_VOICE_LOCAL_URL` / `SURFCORE_VOICE_CLOUD_URL`，
或在 `config.json` 里写 `voicePacks.manifests`（按 id 覆盖字段）。

## 安全边界

- 不自动安装：安装前必须看大小并确认
- 安装源支持 sha256 校验（manifest 里可选）
- 卸载只删 `state/voice-packs/<id>`，路径先校验
- 启动前探测端口，被占用会直接报"已运行"而不是重复起
- 语音服务挂了不影响聊天：主流程不依赖它

## 本地 / 云端怎么切

配置在 `socialV2.voice.tts`：

```json
"tts": {
  "enabled": true,
  "route": "local",
  "endpoints": {
    "local": "http://127.0.0.1:8765",
    "cloud": "http://127.0.0.1:8767"
  }
}
```

- `route` 决定默认走哪个包
- 单条消息可以用 `route` 字段临时覆盖（`/api/voice/send` 或 `/api/socialV2/send-voice` 的 body 里加 `"route":"cloud"`）
- 两个服务都开着也没关系，不用就闲置

## 仅主人可触发（已在代码里强制）

`socialV2.voice.trigger.who = "owner"`（默认）时：

| 场景 | 结果 |
|---|---|
| 群聊里**主人**刚说过话（10 分钟内），AI 发语音 | ✅ 放行 |
| 群聊里别人发了表情/转发/闲聊 | ✅ **不影响**（只要主人 10 分钟内开过口） |
| 私聊对象不是主人 | ❌ 403 |
| 主人 10 分钟没说话 | ❌ 403「最近 10 分钟主人都没说话」 |
| 主人刚发过一句，AI 已经回过一条语音 | ❌ 403「这条消息已经发过语音了」 |

判定依据是**最后一条入站消息的真实发送者**（`voiceLastSpeaker`），不是 AI 自己声称的身份。
而且**任何入站消息都会覆盖这条记录**——包括纯图片、纯表情、只引用不附文的消息；
否则别人用"非文字消息"就能在主人离开后继续吃主人的窗口。

叠加的三层防爆破：

1. **一条主人消息最多换一条语音**（`voiceLastSentAt`）：发过之后必须等主人再说一句
2. **窗口 5 分钟**：主人 5 分钟没动静，任何人都触发不了
3. **频率上限**：`maxPerMinute` / `maxPerHour`（默认 2 / 10），是最后一道闸
控制台手动「试发」走的是操作者通道，不受这条限制。

## 断点续传与"保留资产"（2026-10-28）

- 模型/运行库由包内 `scripts/fetch-models.mjs` 下载，**支持断点续传**：
  先写 `<name>.part`，中断后保留；下次 `curl -C -` 续传；完成后校验 sha256，
  不匹配会删掉重下一次（只重试一次，避免死循环）。
- 重装同一个包时，SurfCore 保留 `models/ vendor/ voices/ voicepack/ logs/ cache/ .venv* config.toml`，
  只替换代码 —— 否则 `.part` 会被清掉，续传就没意义（`clearPackKeepingAssets()`）。
- 装完强制校验：本地包必须有 `models/` + `vendor/GPT-SoVITS`，云端包必须有 `models/`；
  缺任何一个判失败，不再显示"安装完成"。
- 手动验证续传：预置 1MB 的 `.part`，再跑 `node scripts/fetch-models.mjs`，
  应打印"续传"且最终 sha256 通过（2026-10-28 已实测：1.0MB + 续传 → 2,551,407 字节校验通过）。

## 分卷下载（vendor 1.84GB 拆成 4 卷）

- `models.json` 里一个归档可以带 `parts: [...]`（例如 vendor 拆成 4 × 约 460MB）；
- `fetch-models.mjs` 逐卷下载（每卷独立断点续传）→ 按顺序拼接 → 用**整体 sha256** 校验 → 解压 → 删除分卷；
- 好处：断了只补那一卷（不用重下 1.84GB），也更容易走多线程/镜像；
- 校验失败会删掉分卷和合并结果，重来一次。

实测（2026-10-28）：把 2.4MB 的 voicepack 拆两卷，manifest 用 `parts`，脚本输出
「分卷合并完成 2.4MB」→ sha256 通过 → 解压成功。

## 下载链路与并发（2026-10-28）

- **并发下载分卷**：默认 3 路（`SURFCORE_DOWNLOAD_JOBS=1..6` 可调）。单连接在国内常被限速，并发通常快 2~4 倍。
- **可选镜像**：设置页语音卡片的「下载链路」可以在官方 / `ghfast.top` / `gh-proxy.com` / `ghproxy.net` 之间切；
  选中的前缀会拼在原 URL 前（`SURFCORE_GH_MIRROR` 环境变量），内容仍以 sha256 校验为准。
- 镜像只影响 GitHub 直链，不影响本地目录/自建源。
- 实测（2026-10-28）：4 分卷 637KB×4 并发下载 → 合并 → sha256 通过 → 解压成功。
- 镜像可用性会变：`ghfast.top` 本机探测 000（不可用），`gh-proxy.com` / `ghproxy.net` 返回 200 ——
  所以界面上给了多个，让用户自己试。
