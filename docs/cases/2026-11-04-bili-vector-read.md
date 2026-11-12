# 2026-11-04 B站 读取路径接向量记忆

## 现象

- QQ 唤醒已支持 `memory.mode=vector`，但 B站 调度器仍固定注入 `memory-card-prompt-bili.md`；
- 用户选“向量记忆”后，B站 一侧仍读叙事卡，和 QQ 不一致。

## 根因

- `plugins/surfcore/lib/scheduler.js` 的 `memoryCardBlockForBili()` 只读预渲染叙事文件；
- B站 `promptBili()` 是 async，但身份上下文是 sync 拼接，没有异步检索入口。

## 修法

- `memoryCardBlockForBili()` 在 `memory.mode=vector` 时返回空，不再注入叙事卡；
- 新增 `vectorRecallBlockForBili(args)`：
  - 查询取本次 prompt 最后一段文本（截 300 字）；
  - 按当前 `modelSpace` 读索引，`platform='bili'`（只允许 bili/shared，敏感排除）；
  - Embedding 失败/无索引返回空，不阻塞 B站；
- `promptBili()` 在发送前把 `【想起的旧事】` 插到 content 最前面；
- 超时上限 5s，避免 B站 被 Embedding 冷启动拖住。

## 验证

- `test-vector-memory-wiring` 增加 B站 接线断言；
- `test:audit` 151/151；
- 未做真实 B站 账号端到端（需要线上评论/私信触发）。

## 遗留

- B站 的 query 只是“本次 prompt 最后一段”，不是专门的评论/私信语义提取；效果需要线上验证；
- 索引未建时 B站 不注入（符合读取二选一）；
- 真实 B站 端到端与 Recall 评测未做。
