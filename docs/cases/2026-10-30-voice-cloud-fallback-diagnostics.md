# 2026-10-30 · 云端语音“不行”到底是哪一关：换路兜底 + 自检

## 现象

用户报「本地语音包能发，云端包不行」。实机检查：

- 云端服务 8767 在跑，连续 5 次合成全部 200（650–910ms），官方自检 `ok:true`；
- 本地服务 8765 **没在跑**；
- 桥接运行时 route=cloud，11:08 成功发过一条 405KB 语音；
- 11:12 模型自述「想说第二句时 TTS 又掉了」——同期配置为 **2 条/分钟** 限流。

## 根因（架构层，三条）

1. **失败无法归因**：`voxd` 的 503 可能是「火山网络」「鉴权失败」「音色映射错」，桥接统一包装成
   「TTS 服务返回 503」，模型再转述成“TTS 没起来”。用户无法判断第三方还是我们。
2. **引擎渲染失败不换路**：`fallbacks = ["piper"]` 只在“挑引擎”阶段生效；`cloud.render()` 抛错时直接 503，
   不会退回 Piper —— 火山一抖整条语音就失败。
3. **限流被误读成故障**：`voice.rate-limited` 只是一句人话，没有 code，模型把它当 TTS 挂掉。

## 修法

| 层 | 改动 |
| --- | --- |
| 分类 | 新增 `src/voice-diagnostics.js`：`classifyVoiceError()` → `voice.rate-limited / config-mapping / service-down / upstream-auth / upstream-network / engine-failed / unknown` + 可执行 hint |
| 换路 | 桥接合成失败时按 `pickFallbackRoute()` 换到另一条地址重试（cloud⇄local）；限流/映射错误不换路；成功标 `degraded/degradedFrom` |
| 留痕 | 失败写 `state/voice-errors.log`（JSONL：route/code/stage/message/fallback） |
| 返回 | 语音接口 `ok:false` 带 `code`/`hint`；限流错误带 `voice.rate-limited` |
| 自检 | 桥接 `/api/voice/tts-check`：服务可达 → 实际合成 → 发送前置（总闸/工具/额度）三步分别给结论；插件代理 + 语音页「语音自检」卡片 |

## 验证

- `test-voice-diagnostics`：7 类错误分类、换路策略、三处接线；
- `test-voice-route` 仍通过（harness 注入新模块）；audit **86/86**；插件测试全绿。

## 注意

- 桥接是独立进程，改完需要**重启 QQ 桥接**（设置页「重启桥接」）才生效；
- 自检不会真的发 QQ 消息，只检查发送前置条件。
