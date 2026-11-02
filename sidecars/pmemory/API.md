# p-memory sidecar API（surfcore 可选长期记忆后端）

本文件是**契约**。`server.py` 必须严格实现下列请求/响应形状；surfcore 侧（`src/pmemory-client.js`）按此调用。

- 传输：HTTP/1.1，`Content-Type: application/json; charset=utf-8`
- 监听：默认 `127.0.0.1:8791`（只回环，禁止 `0.0.0.0`）
- 鉴权：可选。启动时给 `--token <str>`（或环境变量 `PMEMORY_TOKEN`）则所有请求必须带 `x-pmemory-token` 头，值不匹配返回 `401 {"ok":false,"error":"unauthorized"}`。未给 token 时不校验。
- 引擎：`p-memory==0.3.4`（PyPI，Apache-2.0，Rust/PyO3 abi3）。数据目录由 `--data-dir` 指定，内部由 p-memory 生成 `store.sqlite3` / `vectors.sqlite3` / `text-v2/` 等。
- 所有响应都是 JSON 对象，顶层必有 `ok`。成功 `200`，失败用 `400/401/404/500` 且 `{"ok":false,"error":"<人类可读>"}`。
- 命名空间：`namespace` 查询参数/字段，缺省 `"default"`。surfcore 每个角色一个 namespace（例：`char-mvtjeta0`）。

## 1. `GET /health`

```json
{"ok": true, "engine": "p-memory", "engineVersion": "0.3.4",
 "schemaVersion": 15, "total": 12, "namespaces": ["default"], "dataDir": "D:\\...\\data"}
```

`total` = 全库 memory 记录数；`namespaces` 来自 `kb.namespaces()`，出错则 `[]`。

## 2. `POST /consume`（写入/更新，幂等）

请求：

```json
{"namespace": "default",
 "records": [
   {"text": "主人深夜会讨抱紧，我收紧手臂把她圈进怀里",
    "reasoning": "深夜私聊，情绪疲惫",
    "type": "bond",
    "importance": 82,
    "tags": ["主人", "抱抱"],
    "scope": "qq",
    "key": "private:2533801935",
    "surfcoreId": "mem-abc123",
    "createdAt": 1793280860206}
 ]}
```

映射到 p-memory（**必须**用 `kb.memories.upsert_by_judgment(...)`，以便按 `judgment` 去重）：

| 请求字段 | p-memory 字段 |
|---|---|
| `text`（必填，空则跳过该条） | `judgment` |
| `reasoning` | `reasoning` |
| `type` | `memory_type` |
| `tags` | `tags`（去重、截断到 20 个、每个 ≤32 字） |
| `scope` | `scope`（缺省 `"public"`） |
| `namespace` | `namespace` |
| `importance`（0–100，缺省 50） | `state.strength` = `max(1, min(100, round(importance)))`；同时写 `metadata.importance` |
| `createdAt`（ms，缺省 now） | `created_at_us = createdAt * 1000` |
| `key` / `surfcoreId` | `metadata.key` / `metadata.surfcore_id` |

写完调用 `kb.update_index()` 再返回。

响应：`{"ok": true, "upserted": 3, "skipped": 0, "total": 12}`

## 3. `GET /recall?q=<str>&namespace=<ns>&limit=<1..30>&scope=<opt>`

用 `kb.search(q, limit=limit)`（`namespace` 通过 filter 传），把命中整理成：

```json
{"ok": true, "query": "抱紧", "tookMs": 7, "degraded": [], "hits": [
  {"id": 1, "text": "主人深夜会讨抱紧，我收紧手臂把她圈进怀里",
   "reasoning": "深夜私聊，情绪疲惫", "type": "bond",
   "tags": ["主人", "抱抱"], "importance": 82, "score": 2.31,
   "createdAt": 1793280860206}
]}
```

- 命中记录里 `judgment` → `text`，`state.strength` → `importance`，`metadata.importance` 优先。
- `q` 为空白时返回 `{"ok":true,"query":"","hits":[]}`（**不要**全表 dump）。
- `limit` 缺省 8，夹在 1..30。

## 4. `GET /overview?namespace=<ns>&maxChars=<int>`

给提示词用的**静态**块（不依赖查询）。取该 namespace 下 `state.pinned` 为真的记录优先，再按 `importance` 降序、`created_at_us` 降序，最多 40 条，渲染：

```
【长期记忆 · 全量库（p-memory）】
· <text>（<type>，重要度 <importance>）
· ...
（共 <N> 条，此处仅列 <M> 条）
```

- `maxChars` 缺省 2200，夹在 200..10000；超限时**按整行**截断，不要把一行切一半。
- 无记录时 `{"ok":true,"text":"","count":0}`。

## 5. `POST /forget`

请求 `{"namespace":"default","ids":[1,2]}` 或 `{"namespace":"default","q":"抱紧"}`（二选一，`ids` 优先）。

响应 `{"ok": true, "deleted": 2}`。`q` 形式先 `search` 再删命中的 id。删完 `kb.update_index()`。

## 6. `POST /decay`

请求 `{"namespace":"default"}`，内部 `kb.memories.decay()`（filter 带 namespace）→ `kb.update_index()`。
响应 `{"ok": true, "changed": 3}`（`changed` 取 receipt 里的数量，取不到就 0）。

## 7. `POST /reset`（默认关闭）

只有启动时带 `--allow-reset` 才可用：删除该 namespace 下所有 memory 记录。
未开启时返回 `403 {"ok":false,"error":"reset disabled"}`。
响应 `{"ok": true, "deleted": 12}`。

## 8. 并发与稳定性要求

- 用 `ThreadingHTTPServer`，但**所有**对 `KnowledgeBase` 的调用必须在一把模块级 `threading.Lock` 里串行（sqlite/tantivy 单写者）。
- 启动时 `os.makedirs(data_dir, exist_ok=True)`，`KnowledgeBase(data_dir, namespace="default")` 常驻一个实例复用；收到 `SIGINT/SIGTERM` 时 `kb.close()` 并退出。
- 任何 handler 内部异常都转成 `500 {"ok":false,"error":"<异常类名>: <message>"}`，**不能**让进程崩掉。
- 日志：每条请求打印一行到 stderr，形如 `[pmemory] 2026-11-02T18:52:03Z GET /recall q=抱紧 ns=default hits=2 7ms`。不要打印 token。
- 启动打印 `[pmemory] listening http://127.0.0.1:<port> data=<dataDir> engine=p-memory <ver>`。

## 9. CLI

```
python sidecars/pmemory/server.py --data-dir <dir> [--port 8791] [--host 127.0.0.1]
                                  [--token <str>] [--allow-reset] [--quiet]
```

- 依赖只有 `p-memory==0.3.4` 与标准库。
- `--port 0` 时打印实际端口（供测试用）。
