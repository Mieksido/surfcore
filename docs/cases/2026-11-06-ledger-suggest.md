# 建议候选（第 4 件）：把「关于他自己的事」在合适的时机提一句

- 日期：2026-11-06
- 范围：`src/ledger-suggest.js`（新增）、`src/bridge.js`（入池 / 提示词 / 计数 / 控制台三条路由）、
  `scripts/test-ledger-suggest.mjs`、`scripts/test-ledger-suggest-bridge.mjs`
- 上游：B 项目 `ledger-suggest.js`（`D:\DSH_Dragonfly\tmp\ref-b\src\ledger-suggest.js`，524 行）

## 为什么要改路线

B 的 `ledger-suggest.js` 自己不抽候选：它去问 memory-rag 的 `/notes`（一个独立的抽取服务），
拿到「关于某个人、值得长期记住的事」之后负责挑、拼提示词、记次数、判采用。

SurfCore 没有那个服务，而且**不应该为它再养一条 LLM 抽取管线**。更要紧的是：
SurfCore 的记忆卡是**自动摄取**的（`memory-card.js` 的 `ingestInboxLines` 按规则把
`memory-inbox.jsonl` 收成记录），根本不存在 B 里「她决定要不要记」那一步。
照抄过来会得到一个「建议采用」动作却没有「采用」的落点。

所以换的是**通路**，不是目的：

| | B | 这里 |
| --- | --- | --- |
| 候选从哪来 | memory-rag `/notes` 抽取服务 | 入站消息上的高精度规则（`extractFacts`） |
| 谁入池 | 抽取服务按 key 过滤 | 只收私聊/主人的话，群聊不抽 |
| 采用怎么写 | `ledger_remember` 工具写账本 | **不写**：她顺着聊一句，那句话自然进 inbox，插件照常摄取 |
| 防唠叨 | shown / maxShows / ttl | 同样是 shown / `maxShows` / `ttlDays` / `maxPerDay` |

## 规则（精度优先：宁可漏，不可错）

八类，每类都要求一个人称锚点：称呼（`叫我X`）、生日（`生日是 3 月 14 号`）、忌口（`我不吃X`）、
过敏（`我对X过敏`）、喜好（`我喜欢X`）、住处（`我住在X`）、工作（`我在X上班`）、宠物（`我养了只X`）。

挡掉的：问句（`我住的地方远吗`）、第二人称（`我喜欢你` / `我喜欢你这样说`）、
宾语里带疑问词（`你说我住在哪里比较好`）、宾语是「世界」这类空泛词。
`minChars` 默认 1 是刻意的：`我不吃辣`、`我养了狗` 一个字就是全部信息，卡在 2 会全丢；
精度靠锚点保证，不靠字数。

## 通路安全（和约定提醒同一套口径）

1. 入池在 `recordMemoryInboxEvent` 之后调用，**只入池**：不发消息、不改记忆卡、不写日志正文。
2. 提示词里的那一段由 `planSuggestFor(key, cardText)` 生成，**只读**。
   `buildWakePromptV2` 一次唤醒会被调两遍，谁在准备阶段改状态谁就把候选从真正投递的那份里抹掉
   （约定那条在 2026-11-06 00:01 踩过一次，见 `docs/PITFALLS.md`）。
3. 计数 `settleSuggest(key)` 放在 `api.sessions.prompt` **被接受之后**：被拒、过期、模式切换
   拦下的投递不计数，提满 `maxShows` 才标 `expired`。
4. 已在记忆卡里的不再提（`planSuggest` 拿 `memoryCardText` 做字面包含判断）。
5. 状态文件跟角色目录走：`memory/ledger-suggest.json`，原子写、`0600`、坏 JSON 当空。

## 提示词长什么样

```text
【可能值得记住的】
- 主人刚说过：香菜（忌口）
这些是对方随口说出的、关于他自己的事。如果这一轮聊得动，可以自然地接一句（记下来、或者顺着问一句细节）；
聊不到就放着，别像在做登记，也别一次问一串。
```

不带日期、不带 id、不带「请记录」——它是搭话的由头，不是表格。

## 验证

```text
node scripts/test-ledger-suggest.mjs         # 17/17（抽取精度、去重、上限、保鲜期、容错）
node scripts/test-ledger-suggest-bridge.mjs  # 5/5（入池、两遍都带、不串会话、接受后才计数、无候选不出现）
npm run test:regressions                     # 全部通过
npm run test:audit                           # 153/154（唯一失败 test-release-manifest：dev 上清单必然对不上，非回归）
```

反向验证：把 `planSuggest` 改成「挑中即删」→ 连建两遍那条变红；把 `settleSuggest` 从接受点
移到 `buildWakePromptV2` → 「只建提示词不能计数」那条变红。两次都改回并重跑全绿。

## 遗留

- 抽取是规则的，不理解上下文：`我昨天吃了香菜` 这类过去事件不会抽（也不该抽），
  但 `我对香菜无感` 这种否定表达目前会漏 —— 漏是设计选择，不是缺陷。
- 没有做「她真的接了一句」的采用判定：模型说的是自然语言，桥接无法可靠判断
  「这句话算不算采纳」。所以采用与否只靠 `maxShows` 自然过期，控制台可手工作废。
- 候选目前只在私聊/主人消息上生效；群里要不要开，等真机跑一段再看（开了容易像查户口）。