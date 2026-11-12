# 2026-10-28 · 本地语音「装完位置不对 / import 挂 / 工具没注册」

> 来源：用户让 GPT 做的部署排障总结（含手工修好的全过程）。作者据此复核代码，
> 发现我们之前的修复只解决了"安装过程出错"，没解决"装完能不能用"。

## 现象（手工部署前的干净安装）

1. 依赖和模型都下完了，但 `config.toml`/`models/`/`vendor/` 位置乱七八糟；
2. 手工修好位置后，GSV 起不来：`ModuleNotFoundError: No module named 'jieba_fast'`；
3. 语音都正常合成了，但她在 QQ 里说"没有语音入口"。

## 根因（三条，都是我们的）

### ① 归档解压落点固定成 `models/`

`fetch-models.mjs` 把**所有**归档都解压到 `models/`，而归档内部结构是：

```
voice-local-vendor.tar.gz   → vendor/GPT-SoVITS/...
voicepack.tar.gz            → voices/... + voicepack/...
voice-local-models.tar.gz   → zh_CN-huayan-medium.onnx
```

结果：`models/vendor/...`、`models/voices/...`，而 `gsv.bat` 用 `%~dp0vendor`、
voxd 用包根的 `voices/`、`voicepack/` → 全找不到。**这就是"装完还是不能用"的主因。**

### ② `jieba_fast` 只换依赖没用

我们把 requirements 里的 `jieba_fast` 换成 `jieba`，但 vendor 代码是硬 import：

```python
# GPT_SoVITS/text/chinese.py:19
import jieba_fast
```

Windows 上 `jieba_fast` 是 C 扩展，没编译器装不上 → GSV 启动即挂。

### ③ MCP 工具列表在进程启动时固定

`mcp-snowluma-safe.js` 启动时按配置决定是否注册 `qq_send_voice` / `qq_list_voices`。
用户先开 DSH、后开语音 → 工具进程里根本没这两个工具 → 她说"没有语音入口"。
（用户最后只是重载了 MCP 工具进程就恢复了。）

## 修法（v0.6.22）

| 改动 | 位置 |
| --- | --- |
| 归档支持 `dest` 字段：vendor/voicepack → `'.'`，models → `'models'` | `models.json` + `fetch-models.mjs` |
| 安装后自动造 `jieba_fast` 替身（转发到 `jieba`，含 `posseg`） | `bootstrap-env.mjs` |
| `imageio-ffmpeg` 提供 ffmpeg，并把路径写进 `config.toml [ffmpeg] path` | `bootstrap-env.mjs` + requirements |
| requirements 补 `torchmetrics`、`imageio-ffmpeg` | `requirements-gsv.txt` |
| pip 加 `--cache-dir <包>/.pip-cache`（重装不再从零下载） | `bootstrap-env.mjs` |
| 试听/自测时长改用真实 WAV 头（并补 `duration` 字段） | `src/voice-packs.js` |
| UI 提示：改完语音/工具开关**必须重启 DSH**，否则她说"没有语音入口" | `lib/client.js` |

## 验证

- **实测布局**（本地 file:// 归档模拟）：解压后 `vendor/GPT-SoVITS/...`、`voices/`、`voicepack/`
  都在包根，`models/zh_CN-huayan-medium.onnx` 在 `models/` —— 与 `gsv.bat` / voxd 的期望一致；
- `npm run test:audit` 77/77；插件测试 0 失败；
- **未验证**：干净 Windows 实机上 `jieba_fast` 替身能否让 `api_v2.py` 通过 import、
  `imageio-ffmpeg` 的二进制路径是否被 voxd 正确读取（需要真机装一遍）。

## 遗留

- 依赖安装仍是大头（用户数据：下载 13 分钟 + 环境 40 分钟）。下一步优化方向：
  跳过只用不到的依赖（pyopenjtalk 日文、matplotlib 训练用）、检测并复用机器上已有的 torch；
- MCP 工具快照问题只加了提示，没有做"开关变化自动重载工具列表"；
- `test:audit` 在 zip 安装（无 .git、无 npm）上会有 6 项环境相关失败，未处理。
