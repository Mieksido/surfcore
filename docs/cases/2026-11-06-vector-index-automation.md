# 2026-11-06 · 向量索引：自动补索引 + 三模型建索引

## 背景

用户反馈「新记忆还要手动编码索引」是失败设计；并且希望一次给三个模型各建一套索引。

## 索引是什么

- 记忆正文在 `vector-memory.jsonl`；
- 索引是每条记忆的“语义坐标”（向量）+ 元数据，按 `modelSpace` 分文件；
- 语义搜索先查索引，不逐条扫描原文；
- 没有索引时只能看条数，不能检索相似旧事。

## 自动补索引（本次修改）

`plugins/surfcore/lib/vector-memory.js` 的 `startVectorMemoryTimer`：

- 启动 15 秒后第一次整理；
- 如果 `pending > 0` 且服务正常，**30 秒后续跑**，直到 pending=0；
- 没积压或服务失败时回到 10 分钟检查一次；
- 不再依赖用户点「立即整理」。

「立即整理」仍保留为手动催一次；「重建索引」仍然是全部重算，只在换模型/索引损坏时用。

## 三模型建索引

- `embedding-packs.js` 导出 `registerAllInstalledModels()`，把已安装模型全部注册进 runtime 自带 Ollama；
- `vector-memory.js` 新增 `rebuildAllVectorIndexes(config, models)`：只补 `indexReady !== true` 的模型，已有索引的跳过；按模型逐个用对应 `modelSpace` 重建，不改全局选中模型；
- `index.js` 新增 `rebuild-all` action：先过滤掉已有索引的模型；全部已有索引时直接返回 skipped，不启动 runtime/不重建；有缺失时才启动 runtime、注册所有模型、逐个补；
- `client.js` 向量页新增「为三个模型建索引」按钮；确认文案写明“已有索引会跳过”，完成/跳过/中断给 toast。

## 使用说明

「使用说明」弹窗新增：

- 索引是什么；
- 新记忆全自动，不需要手点；
- 立即整理只补新记忆，重建全部重算；
- 三模型索引各自独立，按钮会为已安装模型各建一套，耗时很长。

## 验证

```
test-vector-memory-wiring  通过（含 rebuild-all / 30s 续跑断言）
test-client-contract      通过
test:audit                 151/151
plugins/surfcore npm test  0 失败
```

## 未验证

- 真实三模型依次建索引的耗时/中断恢复（需要 runtime + 三个模型包）；
- 建索引期间关闭设置页/DSH 的行为（当前是同步请求，关页面可能中断）；
- 云端模型不参与「三模型」按钮（只做本地模型）。
