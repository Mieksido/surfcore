# 语音页找不到总闸 /「发语音」工具

日期：2026-11-03

对应：GitHub issue #45

## 现象

- 语音包装好后，自检「发送前置」报：
  ```text
  语音总闸已关 · 工具关
  建议：设置 → SurfCore → 语音：打开总闸与「发语音」工具
  ```
- 用户就在「语音」页，但页面上只有语音包安装/导入/自检，没有这两个开关。
- 命令行窗口另见 issue 评论（未在本批处理）。

## 根因

两个开关实际在「全部参数」：

```text
全部参数 → QQ → 搜索「语音」：
  socialV2.voice.enabled        ← 总闸
全部参数 → QQ → 二代 · 工具开关：
  socialV2.tools.sendVoice      ← qq_send_voice / qq_list_voices
```

而自检提示写的是：

```text
设置 → SurfCore → 语音：打开总闸与「发语音」工具
```

「语音」页没有这两个控件，所以用户找不到。  
这是入口/提示不一致，不是语音服务坏了。

## 修法

### 1. 语音页顶部加「语音开关」卡片

`VoiceTab` 新增：

- `启用语音发送（总闸）` → `socialV2.voice.enabled`
- `「发语音」工具` → `socialV2.tools.sendVoice`
- 「保存语音开关」按钮 → 复用父级 `save(false)`，走 `/config` + stamps
- 明确提示：
  ```text
  两个都要开；保存后必须完全退出 DSH 再打开，
  MCP 工具列表在进程启动时固定。
  ```

### 2. 提示改到真实位置

`src/bridge.js`：

- `VOICE_DISABLED` / `VOICE_TOOL_DISABLED` / 自检 hint 都改成：
  ```text
  设置 → SurfCore → 语音 → 页顶「语音开关」
  ```

### 3. 保留全部参数入口

「全部参数」里的 `socialV2.voice.enabled` / `socialV2.tools.sendVoice` 不删除，作为高级入口。

## 没有做

- 没有改语音默认值：总闸、工具仍默认关闭（安全默认）。
- 没有做命令行窗口隐藏；`run.bat` / `gsv.bat` 仍可能弹窗。
- 没有做“保存后自动重启 DSH”；仍需用户手动完全退出再打开。
- 没有改自检逻辑：自检仍只看配置布尔值，不查真实 MCP 工具列表。

## 风险

- 语音页保存会整份回写 QQ 配置；仍受 `CONFIG_STALE` 保护，冲突时提示重新读取。
- 只开总闸、不开工具，仍然不能发语音；UI 已明确写“两个都要开”。
- 工具列表要重启 DSH 才刷新；只刷新页面不够。
- 隐藏命令行窗口可能隐藏错误输出；本批未动。
- 旧配置缺少 `socialV2.tools.sendVoice` 时，读取默认模板会补上 `false`；开关仍显示。

## 验证

```text
node scripts/test-voice-gates.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
