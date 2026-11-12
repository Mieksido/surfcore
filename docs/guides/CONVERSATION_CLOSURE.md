# 对话收尾判断（conversation closure）

> 目标：让每段对话有自然终点。发完最后一句后先判断「这段还能不能继续」，不能就安静结束，
> 不再硬补一句；但结束不是断掉——收在哪、下次怎么接都会留下来。
>
> 代码：`src/conversation-closure.js`（纯逻辑）、`src/bridge.js`（状态/接口/冷却）、
> `src/mcp-snowluma-safe.js`（`qq_close_conversation` 工具）。
> 测试：`scripts/test-conversation-closure.mjs`、`scripts/test-closure-wiring.mjs`。
> 踩坑背景：`docs/PITFALLS.md` #63。

---

## 1. 判断看什么

不是按「回了几条」算，而是看六类信号：

| 信号 | 含义 | 从哪来 |
| --- | --- | --- |
| 我最后一句 | 嗯/好/哈哈/晚安 = 收尾式；提问 = 在等答案；实质内容 = 还在输出 | `recentMessages` 里最后一条 `isSelf` |
| 对方最后一句 | 提问 / 请求 / 实质内容 / 附和 / 道别 | 最后一条非 `isSelf` 消息的分类 |
| 我的继续意愿 | 还有想说没说的、有话题在等追问 | `pendingThoughts`、`activeTopics[].pendingQuestion` |
| 对方的继续意愿 | 问句、@/引用、连续多条、最后一条是否有内容 | 消息分类 + 近 5 分钟条数 |
| 话题闭环 | 事情办完、问题答完、约定说定、对方道别 | 分类 + 「说好了/扯平/一言为定」等收束语气 |
| 未完成 | 对方明确在提问/求助、还没答 | 最后一条是否 question/request 且自己没有后续 |
| 节奏疲劳 | 来回很多轮、双方越回越短、对方很久没接 | 近 10 分钟条数、近 3 条平均长度、静默时长 |

输出三态：

- `continue`：还在聊，正常接。
- `linger`：先别急着补话，等对方补充或过一会儿再看。
- `close`：可以自然收尾——不要再补一句。

**代码只给建议。** 最终收不收由模型调用 `qq_close_conversation` 决定。
这样不会因为一句「嗯」被误判而突然消失，也不会因为模型想偷懒而跳过该回的问题。

## 2. 三个动作别混

| 动作 | 语义 | 改 wakeConfig？ | 要沉睡前观察？ | 留结束点？ |
| --- | --- | --- | --- | --- |
| `qq_send_message` | 说话 | 否 | 否 | 否 |
| `qq_mark_read` | 看过了，划走 | 否 | **是**（若当前是潜水配置） | 否 |
| `qq_set_wake_config` | 进入潜水/改唤醒条件 | **是** | **是** | 否 |
| `qq_close_conversation` | 这段自然结束 | **否** | **否** | **是**（summary / nextOpening） |

`close` 不是潜水：唤醒配置原样保留，对方再找你、开新话题、私聊都会照常醒。
它只是「这一轮不再输出」，并把结束点留给下次。

## 3. 硬规则与冷却

### 3.1 不允许用收尾逃避

对方最后一句明确在提问/求助、且自己还没接时，`close` 返回 **409 `open-question`**：

> 对方最后一句是在提问/求助，还没回答；先用 qq_send_message 回完再收尾。

配置项 `socialV2.closure.requireNoOpenQuestion` 默认开。关掉它等于允许「用结束逃避」，
不建议。

### 3.2 冷却只压软唤醒

收尾后 `cooldownMs`（默认 20 分钟）内，只跳过：

- `probability`：普通消息按概率唤醒；
- `replyCheck`：发完消息 30 秒后的例行回复检查（close 时直接取消）；
- `proactiveCheck`：冷场主动机会。

**不压**：`atMention`、`nameMention`、`question`、`keyword`、`poke`、`speaker`、`private`。
结束不是把人关掉。

### 3.3 重开

- 私聊：对方一开口就是新的开始；
- 群聊：只有直接叫到 / 引用 / 提问 / 道别才重开；普通闲聊不打断冷却。

重开后 `closure.reopenedAt` 会被写上，下次唤醒提示会说「上次刚收过尾，现在是新的开始，
别复读上次的结尾」。

## 4. 结束点长什么样

`state/social-v2.json` 的会话状态里：

```json
"closure": {
  "at": 1761280000000,
  "key": "private:123",
  "kind": "private",
  "reason": "natural",
  "summary": "聊到扯平这件事",
  "nextOpening": "问问她周末去不去看展",
  "cooldownUntil": 1761281200000,
  "turns": 3,
  "lastOtherKind": "substantive",
  "lastSelfKind": "ack",
  "reopenedAt": 0,
  "reopenReason": ""
}
```

- `reason`：`natural / topic-done / explicit-end / busy / tired / other`；
- `summary` / `nextOpening` 会被截断到配置上限（默认 160 / 120 字）；
- 记录跨桥接重启保留；`/api/socialV2/state` 返回 `closure` 摘要。

## 5. 配置

`config.json` 的 `socialV2.closure`：

```json
{
  "enabled": true,
  "cooldownMs": 1200000,
  "requireNoOpenQuestion": true,
  "promptInWake": true,
  "maxSummaryChars": 160,
  "maxNextOpeningChars": 120
}
```

- `enabled=false`：不注入判断块、`close` 返回 403；工具也会在 MCP 注册期被过滤；
- `promptInWake=false`：仍可 close，但唤醒不再带判断参数（不推荐）；
- 设置页 QQ 页有「二代 · 对话收尾判断」卡片。

## 6. 验证与回滚

```bash
node scripts/test-conversation-closure.mjs
node scripts/test-closure-wiring.mjs
node scripts/test-qq-preset-contract.mjs
```

回滚：

1. 立刻停用：`socialV2.closure.enabled=false`（不用改代码）；
2. 彻底回滚：删 `src/conversation-closure.js`，回退 `src/bridge.js` / `src/mcp-snowluma-safe.js` /
   `dsh/agent-presets/qq-chat-v2/agent.cordis.yml`，再跑
   `node scripts/build-agent-preset-patches.mjs`。
