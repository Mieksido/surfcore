# 交接：向量记忆库（最近记录 + 语义搜索）

日期：2026-11-06 00:30（Asia/Shanghai）
分支：`feat/vector-memory-library`
基线：`dev f86e9f8`
HEAD：以分支 tip 为准（功能提交 `ccf82e0`；之后只有 docs/manifest follow-up）
工作树：`D:\deepseekwork\surfcore-vector-library`
工作区：干净
净 diff：以分支 tip 为准；功能提交 `ccf82e0` 时为 10 files change，+396 / -13

## 范围

只做「让用户直观看向量记忆」：

- 最近记录：按时间倒序，最近 30 条；
- 语义搜索：一句话找最相近旧事，显示相似度；
- 只读，不提供删除/编辑；
- 默认隐藏 `sensitive: true`；
- 不改存储格式，不影响 QQ/B站 读取。

## 改动

### 后端

`plugins/surfcore/lib/vector-memory.js`

- `listVectorMemoryRecords({limit, offset})`
- `searchVectorMemoryRecords({query, limit})`

`plugins/surfcore/lib/index.js`

- `library-list`
- `library-search`

失败码：

```text
vector.query-empty
vector.query-too-long
vector.index-missing
vector.service-down / vector.search-failed
```

### 前端

`plugins/surfcore/lib/client.js` 的 `MemoryTab`：

- 向量记忆栏新增可折叠「记忆库（N 条）」；
- 展开自动加载最近 30 条；
- 搜索框 + 语义搜索 + 最近记录；
- 结果卡显示日期、平台/来源、正文、相似度；
- 列表显示隐藏敏感条数。

### 文档

- `docs/cases/2026-11-06-vector-memory-library.md`
- `docs/cases/README.md`
- `docs/guides/VECTOR_MEMORY.md` 新增 6.1

## 验证

```text
test:audit 151/151（第一次 stickers 偶发 1 失败，单独跑 71/71，复跑 151/151）
test:regressions 全部通过
plugins/surfcore npm test 通过
test-vector-memory-wiring 7 pass / 0 fail
test-vector-memory-plugin 通过（list/search/敏感过滤）
client-contract / ui-contrast 通过
```

真实数据手工验证：

```text
list: total 3570, visible 3558
search "主人最近是不是很累"
  top1 0.658 主人在吗
  top2 0.625 看来主人管过了
  top3 0.615 没咋 就是有点累
```

## 未验证

- **React 真实渲染**：静态契约通过，但未在 DSH 里实际点开；
- 合并后必须人工打开「记忆 → 向量记忆 → 记忆库」，确认不白屏、搜索可用；
- 语义搜索阈值固定 0.2，先看实际效果再调；
- 无分页加载更多（先最近 30 条）；
- 未加“显示敏感记忆”开关。

## 合并后

1. 重新生成 manifest；
2. 跑门禁；
3. 人工打开记忆库验收；
4. 这是新功能分支，不改版本、不打 tag、不发布；是否进 dev 由用户/协调决定。

---

## 给协调会话的转发块

```text
【向量记忆库：合 dev 交接】

分支：feat/vector-memory-library
基线：dev f86e9f8
HEAD：以分支 tip 为准（功能提交 ccf82e0；交接文档更新后会有一个 docs/manifest follow-up）
工作树：D:\deepseekwork\surfcore-vector-library
工作区：干净
净 diff：以分支 tip 为准（功能提交 ccf82e0 时为 10 files +396/-13；docs follow-up 会额外增加行数）

范围：只读记忆库，不改存储格式，不影响 QQ/B站读取。
- 最近记录：最近 30 条，默认隐藏 sensitive；
- 语义搜索：一句话找旧事，返回相似度；
- 设置页「记忆 → 向量记忆 → 记忆库」内。

不要合：模型权重/zip；不改版本、不打 tag、不发布。

验证：
- test:audit 151/151
- test:regressions 通过
- plugins/surfcore npm test 通过
- test-vector-memory-wiring 7 pass
- test-vector-memory-plugin 通过（list/search/敏感过滤）
- 真实数据：list total 3570/visible 3558；search top1 0.658

必须人工验收：
合并后重启 DSH → 设置 → 记忆 → 向量记忆 → 记忆库
确认不白屏、最近记录能出、语义搜索能返回、敏感记录不显示。

已知边界：
- 未加“显示敏感记忆”开关；
- 先最近 30 条，无分页；
- 搜索阈值固定 0.2；
- 搜索需要 runtime + 当前模型索引。
```
