# 2026-11-04 向量记忆：每个模型空间独立索引

## 现象

- 三个本地模型（bge-small / qwen3 / bge-m3）共享同一份 `vector-memory.jsonl`，但旧实现只有一个 `vector-memory-index.json/.bin`；
- 切换模型时，新模型空间与旧索引不一致，必须整份重建；切回旧模型也要再重建；
- 用户预期：记录共享，切换模型只换“怎么编码/怎么检索”，不应复制记忆。

## 根因

- 一个索引文件只能存一个 `model_space` 的向量；不同模型的维度/空间不能混查；
- 旧代码 `readVectorIndex(paths)` 固定读单文件，`writeVectorIndex` 固定写单文件，切模型只能覆盖。

## 修法

- 索引路径改为 `vector-memory-index/<modelSpace>.json/.bin`（`vectorIndexPaths`）；
- `readVectorIndex(paths, modelSpace)` 只读对应空间；旧版单索引只在空间完全匹配时兼容回退；
- 维护器/状态/快照/桥接都按当前 `modelSpace` 读写；
- 记录层完全不动：三个模型仍共享一份 `vector-memory.jsonl`；
- 切到已经建过索引的模型：直接读旧索引；第一次切的模型：维护器/「重建索引」建一份新索引。

## 验证

- `test-vector-memory`：同一记录集写两个模型空间索引，互不覆盖，分别读回正确；
- `test-vector-memory-plugin`：维护器写 per-model 路径；
- `test-vector-memory-bridge` / wiring / audit：151/151；
- 旧版单索引兼容读取未删除。

## 遗留

- 第一次使用某个模型仍需建一次索引；可以在后台预建，但会额外耗时/占磁盘；
- 切模型后 UI 仍建议提示“该模型索引未建，点重建索引”；
- 旧索引文件不会自动迁移，按需回退读取。
