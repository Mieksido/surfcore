# 桌宠对话一直 400：截断劈开 emoji 留下孤立代理项

日期：2026-11-03

对应：GitHub PR #17

## 现象

- 桌宠 `/chat`、设置页「测试对话」、桌宠载体的主动搭话全部返回：

```text
DeepSeek Messages request failed (400)
```

- QQ 群里的对话正常。
- 不是偶发：坏文本写进了目的状态，每次桌宠对话都带进系统提示词，所以一直 400。
- DeepSeek 响应里没有 `error.message`，客户端只能看到通用 400。

## 根因

JS 字符串是 UTF-16，`slice(0, n)` 按 UTF-16 单元截断。

emoji（如 😭）占两个单元：

```text
高位代理 \ud83d + 低位代理 \ude2d
```

如果截断点正好在中间：

```text
slice 只留下 \ud83d
→ 孤立高位代理
→ 能存 JSON、能拼提示词
→ 序列化给模型 API 时不是合法文本
→ 400
```

触发链：

```text
purpose-engine.clip()
→ goal.intent 写进 purpose-outreach.json
→ pet-chat.purposeBackground() 再 slice
→ 系统提示词「最近在想的」
→ llm / DeepSeek
→ 400
```

## 修法

### 1. 新增 `src/safe-text.js`

- `sliceHead(text, max)`：截断点前是高位代理时少取一个单元；
- `clipText`：压空白 + 安全截断 + 省略号；
- `wellFormed` / `isWellFormed`：孤立代理 → U+FFFD；
- `deepWellFormed`：递归修复对象/数组里的字符串，不改入参。

### 2. 截断处替换

- `purpose-engine.clip()`（内联 `headSafe`，保持零 import）
- `memory-card.short()` / `redactText()` 的截断
- `pet-purpose.clip()`、persona、memory
- `pet-chat.clip()`、`clipForVoice()`、`cleanReply()`、purposeBackground、persona、memory、输入、主动搭话 purpose

### 3. 发送边界兜底

- `pet-chat.complete()`：`system` / `user` 先 `wellFormed()`；
- `dsh-client.callUnary()`：整个 payload 先 `deepWellFormed()`。

这样已有坏数据不会再 400。

### 4. 回归测试

`scripts/test-safe-text.mjs`：

- 任意截断点扫描；
- `wellFormed` / `deepWellFormed`；
- `purpose-engine` 8 个偏移；
- `pet-chat.complete()` 带坏文本时发给 `llm.stream` 的是合法文本。

## 没有做

- 没有替换仓库里所有 `slice(0, N)`；仍有截断点可能写入孤立代理。
- `deepWellFormed` 跳过 Buffer / Date / Map / 类实例；这些结构里的字符串不修。
- 没有改 400 错误日志，让它带响应体/请求 ID。
- 没有真实 DeepSeek 网络复现；用纯字符串合法性测试 + pet-chat 捕获参数。

## 风险

- `wellFormed` 把坏字符替换成 `�`，用户原文会静默变一个字符；只影响非法文本。
- `deepWellFormed` 每次 RPC 遍历 payload，大上下文有额外开销。
- 只修了一批截断点，别处仍可能产生坏数据；发送兜底是最后防线。
- 非普通对象不处理；如果坏字符串藏在 Buffer/Map 里，仍可能漏。
- `sliceHead` 只处理高位代理被切断；孤立低位代理要靠 `wellFormed`。
- 没有日志增强，下一次类似 400 仍难定位。

## 验证

```text
node scripts/test-safe-text.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
