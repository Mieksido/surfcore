# 桌宠对话 / 主动搭话一直 400：被劈开的 emoji（孤立代理项）进了提示词

## 现象

- 用户看到什么：桌宠 `/chat`、设置页「测试对话」、主动搭话（载体=桌宠）全部返回 `DeepSeek Messages request failed (400)`；QQ 群里的对话（走 DSH 会话）正常。
- 复现步骤：目的状态里有一条 `goal.intent` 以被截断的 emoji 结尾 → 触发一次桌宠对话。
- 影响面：桌宠对话 + 桌宠载体的主动搭话整条不可用，且**一直失败**（那条坏文本留在状态文件里，每次都带进提示词）。不丢数据。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 / DSH 版本 | Windows 10；DSH 0.2.1-rc.x，模型 deepseek-official / deepseek-flash |
| SurfCore 版本 | 0.7.7 / 0.7.8 |

## 根因

- 代码位置：`src/purpose-engine.js` `clip()`（`s.slice(0, max)` + `…`）→ 产出 `goal.intent` → `plugins/surfcore/lib/pet-chat.js` `purposeBackground()` 里又 `slice(0, 80)` → 拼进系统提示词的「最近在想的：…」行。
- 问题链条：JS 字符串是 UTF-16，`slice` 按单元截断；`😭` 占两个单元，截断点正好落在中间就留下一个孤立的高位代理（`\ud83d`）。这段文本能存进 JSON、能拼进提示词，但序列化进请求体后不是合法 UTF-8，DeepSeek 直接回 400，而且响应体里没有 `error.message`，DSH 退回通用文案 `request failed (400)`，客户端看不出原因。
- 为什么之前没发现：测试里的文本都是 BMP 字符；DSH 把响应体放进了 `cause` 里，SurfCore 的日志只记 `message`，所以只看得到一个 400。

## 完整逻辑

- **链路**：QQ 群聊记忆 → 记忆卡/素材 → `purpose-engine.clip()` 截断 → `goal.intent` 写进 `purpose-outreach.json` → `pet-chat.purposeBackground()` 读出再截断 → `buildChatSystemPrompt()` → `llm.stream()` → DSH → DeepSeek。同一条坏文本还会随素材行进入 QQ 侧的目的提示词，发给 DSH 会话。
- **机制**：数据在「截断」那一步就已经坏了，但要到「序列化给模型 API」才爆炸；中间每一层都当它是普通字符串，所以爆炸点和出错点相隔很远。
- **定位过程**（可复用）：①换温度 / 思考强度 / 输出长度：仍 400；②在插件里把参数逐项去掉重试：系统提示词极短或去掉都成功 → 问题在系统提示词；③按行累加真实系统提示词：前 45 行通过、第 46 行起 400；④第 46 行是「最近在想的」，目的状态里 3 条 goal，第 3 条含孤立 `\ud83d`。
- **爆炸半径**：进程 2（插件 + 桥接）× 读者（桌宠对话、桌宠主动搭话、QQ 目的回合）×（静默=3）。老数据已经有坏文本，所以光改截断不够，还要在发送边界兜底。
- **取舍**：A. 只修 `clip()`：新数据干净，但状态文件里已有的坏数据仍会 400 ✗；B. 只在发送边界 `toWellFormed()`：全覆盖，但坏数据继续产生、别处的截断（日志、持久化）仍是脏的 ✗；C.（选这条）两道防线：截断处不劈开代理对（治本）+ 发给模型前兜底替换为 U+FFFD（治标，覆盖老数据）。
- **生效与重启**：插件代码，重启 DSH 生效；桥接要重启才吃到 `purpose-engine` 的修复。

## 修法

- 新增 `src/safe-text.js`：`sliceHead`（不劈开代理对）、`clipText`、`wellFormed` / `isWellFormed`、`deepWellFormed`。
- 截断处：`purpose-engine.clip()`（保持零 import，内联同样逻辑）、`memory-card.short()`、`pet-purpose.clip()`、`pet-chat` 的 `clip()` 与 persona / 记忆 / 目的背景的 6 处 `slice`。
- 发送边界兜底：`pet-chat.complete()` 对 `system` / `user` 做 `wellFormed()`；`dsh-client.callUnary()` 对整个 payload 做 `deepWellFormed()`（覆盖桥接发往 DSH 会话的所有文本）。

## 验证

- 自动化：新增 `scripts/test-safe-text.mjs`（已并入 `npm run test:audit`）：任意截断点扫描、`wellFormed` / `deepWellFormed`、purpose-engine 素材行在 8 种偏移下截断、`pet-chat.complete()` 带坏文本时发给 `llm.stream` 的是合法文本。回退 `purpose-engine` 的修复后该测试会失败（已验证）。
- 失败路径：坏文本不再导致请求失败；兜底把它换成 U+FFFD，不丢整句。
- 手工/集成验证：真机 DSH 上，修复前 `/chat` 稳定 400，插件日志里的前缀扫描显示第 46 行（goal.intent）起失败；修复后见 PR 描述。
- 没验证到的部分：桥接侧其它没有走 `clip()` 的 `slice` 仍可能产生孤立代理项，这次靠 `deepWellFormed` 在发往 DSH 前兜底，没有逐个改截断点。

## 遗留 / 后续

- 把 `pet-chat` 失败日志加上响应体 / 请求 ID（现在只有 `message`），下一次类似问题能直接看到原因。
- 其余 `slice(0, N)` 截断点可以逐步换成 `sliceHead`。
