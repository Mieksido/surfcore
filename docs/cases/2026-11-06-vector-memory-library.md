# 向量记忆库：最近记录 + 语义搜索

## 现象

用户问：「能不能让用户直观地看到向量记忆库中的记忆？」
当前只有状态数字（3267 条 / 已索引），看不到具体旧事，很难判断向量记忆到底存了什么。

## 目标

在设置页「记忆 → 向量记忆」里增加只读「记忆库」：

- 最近记录：按时间倒序看最近存了什么；
- 语义搜索：输入一句话，返回最相近的旧事和相似度；
- 默认不展示 `sensitive: true` 的记录。

## 实现

### 后端（只读）

`plugins/surfcore/lib/vector-memory.js`：

- `listVectorMemoryRecords({limit, offset})`
  - 读 `vector-memory.jsonl`；
  - 过滤 `sensitive: true`；
  - 按 `createdAt` 倒序；
  - 返回 `total / visible / items / modelSpace`。
- `searchVectorMemoryRecords({query, limit})`
  - 用当前模型把 query 编码；
  - 读当前 `modelSpace` 索引；
  - `rankVectorMemories({platform:'all'})`；
  - 返回 `hits`（score/cosine/date/platform/source/text）。

`plugins/surfcore/lib/index.js` 增加 action：

```text
library-list
library-search
```

失败路径：

- 空 query → `vector.query-empty`；
- 索引未建 → `vector.index-missing`；
- 服务不可达 → 原 embedding 错误 + hint。

### 前端

`plugins/surfcore/lib/client.js` 的 `MemoryTab` 向量记忆栏增加可折叠「记忆库」：

- 展开自动加载最近 30 条；
- 搜索框 + 「语义搜索」按钮；
- 结果卡显示日期、平台/来源、正文、相似度；
- 列表显示总条数/隐藏敏感条数；
- 只读，不提供删除/编辑。

## 验证

```text
node scripts/test-vector-memory-wiring.mjs   pass 7
node scripts/test-vector-memory-plugin.mjs   pass（含 list/search/敏感过滤）
node plugins/surfcore/scripts/test-client-contract.mjs  OK
node plugins/surfcore/scripts/test-ui-contrast.mjs      通过
```

真实数据手工验证（主 worktree，2026-11-06）：

```text
list: total 3570, visible 3558
search "主人最近是不是很累"
  top1 0.658  主人在吗
  top2 0.625  看来主人管过了
  top3 0.615  没咋 就是有点累
```

## 未验证 / 后续

- 前端 React 真实渲染需重启 DSH 后人工看（与 11-05 记忆页白屏验收同一类）；
- 语义搜索目前固定 `minScore=0.2`，后续可按用户反馈调；
- 只显示非敏感记录；未加“显示敏感记忆”开关；
- 无分页加载更多（先给最近 30 条）；
- 搜索结果显示相似度，不代表事实确认。
