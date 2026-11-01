# 语音提示词写死“默认关闭”

日期：2026-11-01

## 1. 现象

用户开启语音（`voice.enabled` / `tools.sendVoice`）后，模型仍回复“我不能发语音 / 语音默认没开”，甚至把这条结论写进记忆卡。

## 2. 根因

- `dsh/agent-presets/qq-chat-v2/agent.cordis.yml` 第 16 条静态写死：
  ```text
  语音默认是关闭的
  qq_list_voices 报「语音功能已关闭」/ qq_send_voice 报「工具未启用」都是正常状态
  不要重试……继续打字即可
  ```
- `mcp-snowluma-safe.js` 在 **MCP 进程启动时**按 `sendVoice` 过滤工具；配置改了不重启 DSH，工具不会出现。
- 旧会话保留旧系统提示；旧记忆卡可能已经写入“不能发语音”。

## 3. 修法

### 提示词

把第 16 条改为“按工具是否存在和返回判断”：

- 工具可用就正常发；
- 只有 `VOICE_DISABLED`（总闸关）/ `VOICE_TOOL_DISABLED`（工具开关关）才按 hint 去设置；
- 不再说“默认关闭是正常状态”；
- 明确不要因旧提示/旧记忆拒绝；
- 同步生成 `plugins/surfcore/presets/qq-chat-v2.patch.yml`。

### 唤醒状态

`src/bridge.js` 新增 `voiceStatusLine()`，每次唤醒注入：

```text
【语音状态】总闸开/关；发语音工具开/关；语音库 N 个（text 不依赖语音库）。
工具可用就正常用；没有工具说明 MCP 还没重启；不可用时按 VOICE_* hint 设置。
```

放在记忆卡之后，覆盖旧记忆里的“不能发语音”。

### 错误结构

`/api/socialV2/voices` 的 AI 分支补：

```text
VOICE_DISABLED + hint（总闸）
VOICE_TOOL_DISABLED + hint（工具开关）
```

不再只有一句 `语音功能已关闭`。

### UI

语音设置组说明改为：

```text
两个开关：启用语音发送 + 工具面的“发语音”；
改完必须重启 DSH；text 模式不需要语音库；
旧会话可能保留旧提示/旧记忆，必要时新建会话。
```

## 4. 生效

- preset/patch：需要重新安装/重启 DSH；
- 工具列表：MCP 启动时固定，启用后必须重启 DSH；
- 旧会话：系统提示不会自动更新；`voiceStatusLine` 每次唤醒覆盖，但最稳妥是新建会话；
- 旧记忆：状态行会明确覆盖；不会自动删除用户记忆。

## 5. 验证

```text
node scripts/test-voice-prompt-fix.mjs
node scripts/test-voice-system.mjs
node scripts/test-qq-preset-contract.mjs
node scripts/test-voice.mjs
npm run test:audit        # 116/116
cd plugins/surfcore && npm test   # 0 失败
```

## 6. 风险

- 提示词改成“工具可用就发”后，模型可能尝试语音；若 MCP 未重启/总闸没开，会多一次失败调用。
- 语音是强表达，可能变得更频繁；保留频率限制/场景提示。
- 旧会话仍以旧系统提示为主，状态行不一定完全压过；需要新建会话。
- 记忆卡里的旧结论不会自动清理；只做覆盖，不做删除。
- `text` 模式依赖 TTS；TTS 未启动仍可能失败，提示词不应把它说成“语音库问题”。
- 生成 patch 与源必须同步，否则 preset 契约测试失败。
- 只改文案不能热更新 MCP 工具列表，重启仍是必须的。
