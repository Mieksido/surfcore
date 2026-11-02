# p-memory HTTP sidecar

把 [`p-memory`](https://pypi.org/project/p-memory/)（Rust/PyO3 记忆引擎）包装成一个只监听回环地址的
本地 HTTP 服务，供 surfcore 调用。

```
surfcore (Node)  ──HTTP/127.0.0.1──▶  server.py  ──PyO3──▶  p_memory._native.pyd (Rust)
                                       │
                                       └── ▶  <data-dir>/store.sqlite3 + vectors.sqlite3 + text-v2/
```

## 为什么需要它

surfcore 的记忆卡是纯文件（`memory-card.json` + `jsonl`）：没有数据库、也不调模型做摘要。
`p-memory` 补的正是这两件事——写入、索引、中文检索、衰减都在一个 Rust 扩展里，开箱可用。

代价是它是 **PyO3 扩展**（`p_memory/_native.pyd`），Node 进程根本 `require` 不动。所以只能起一个
Python 进程当边界：Node 侧只发 HTTP JSON（见 `src/pmemory-client.js`），Python 侧持有
`KnowledgeBase` 实例。这个目录就是那个 Python 进程。

一句话：**它没做什么新东西，只是把只能在 Python 里跑的引擎翻译成 HTTP。**

## 环境与已验证范围

- Python **>= 3.10**（`Requires-Python: >=3.10`）。
- Windows x64 + CPython **3.11.9** 实测通过；wheel 是 `cp310-abi3-win_amd64`
  （maturin 1.15.0 构建，abi3，所以 3.10/3.11/3.12 共用同一个 `.pyd`）。
- `p_memory` 零运行依赖，标准库之外只需要它。
- 本仓库的 sidecar 自身只用标准库：`http.server`、`json`、`sqlite3`、`threading`、`argparse`。

## 安装

```powershell
# 任选其一的 Python 环境（示例：uv 建 venv）
uv venv .venv
.venv\Scripts\Activate.ps1
uv pip install -r requirements.txt      # 内容是 p-memory==0.3.4
```

不想用 uv 的话 `pip install -r requirements.txt` 等价。装完自检：

```powershell
python -c "import p_memory; print(p_memory.__version__ if hasattr(p_memory,'__version__') else 'ok')"
```

## 启动

```powershell
# 最小启动：默认 127.0.0.1:8791
python -X utf8 server.py --data-dir D:\pmemory-data

# 换端口 + 加 token（所有请求必须带 x-pmemory-token）
python -X utf8 server.py --data-dir D:\pmemory-data --port 8791 --token 换成你自己的随机串

# 允许 POST /reset（默认关闭，删库操作必须显式开）
python -X utf8 server.py --data-dir D:\pmemory-data --allow-reset

# 用临时端口（0 = 让系统分配，启动日志会打印实际端口）
python -X utf8 server.py --data-dir D:\pmemory-data --port 0
```

`-X utf8` 建议一直带：Windows 控制台默认 cp936，中文记忆文本写日志/写库时带 UTF-8 模式更省心。
（服务本身在**非 tty** 的 stdout/stderr 上会自动切 UTF-8，管道/重定向场景不会乱码。）

参数：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--data-dir` | 必填 | 数据目录，不存在会创建 |
| `--port` | `8791` | `0` = 系统分配；实际端口打在启动日志里 |
| `--host` | `127.0.0.1` | 只接受 `127.0.0.1` / `localhost`，其它（含 `0.0.0.0`）直接报错退出 |
| `--token` | 空 | 缺省读环境变量 `PMEMORY_TOKEN`；非空则所有请求必须带 `x-pmemory-token` |
| `--allow-reset` | 关 | 打开 `POST /reset` |
| `--quiet` | 关 | 只压请求日志，保留启动那一行（否则 `--port 0` 没法发现端口） |

启动日志（stderr）：

```
[pmemory] listening http://127.0.0.1:8791 data=D:\pmemory-data engine=p-memory 0.3.4
[pmemory] 2026-11-02T10:59:31Z GET /recall q=抱紧 ns=default hits=1 1ms
```

每条请求一行，`token` 永不出现在日志里。`Ctrl+C` / `Ctrl+Break` / `SIGTERM` 都会走同一条收尾路径：
停 HTTP → `kb.close()` → 退出码 0。

## 七个端点

所有响应都是 JSON 对象，顶层必有 `ok`。成功 `200`；失败 `400 / 401 / 404 / 500` 且
`{"ok": false, "error": "<人能看懂的说明>"}`。`namespace` 缺省 `"default"`。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/health` | 探活 + 引擎版本 + 全库条数 + namespace 列表 |
| POST | `/consume` | 批量写入记忆（去重、幂等） |
| GET | `/recall` | 检索记忆（中文可搜） |
| GET | `/overview` | 生成静态「长期记忆」文本块，塞进提示词 |
| POST | `/forget` | 按 id 或按查询删记忆 |
| POST | `/decay` | 跑一次引擎的衰减策略 |
| POST | `/reset` | 清空某个 namespace（默认关闭） |

### GET /health

```json
{"ok": true, "engine": "p-memory", "engineVersion": "0.3.4", "schemaVersion": 15,
 "total": 2, "namespaces": ["default"], "dataDir": "D:\\pmemory-data"}
```

`total` 是全库 memory 记录数；`namespaces` 取自引擎，取不到时是 `[]`（不影响 `ok`）。

### POST /consume

```json
{"namespace": "default",
 "records": [
   {"text": "主人深夜会讨抱紧", "reasoning": "深夜私聊", "type": "bond",
    "tags": ["主人", "抱抱"], "scope": "qq", "importance": 82,
    "key": "private:2533801935", "surfcoreId": "mem-001", "createdAt": 1793280860206}
 ]}
```

```json
{"ok": true, "upserted": 1, "skipped": 0, "total": 1}
```

- `text` 必填，空白字符串记入 `skipped`（不算失败）。
- 去重键是引擎的 `judgment_key`（`namespace + scope` 范围），走
  `kb.memories.upsert_by_judgment(...)`：**同一条文本重复写不会变多**，所以整批重发是幂等的。
- 写完必调 `kb.update_index()` 再返回，保证下一次 `/recall` 立刻能搜到。

字段映射（请求 → 引擎）：

| 请求 | 引擎字段 | 备注 |
| --- | --- | --- |
| `text` | `judgment` | 必填 |
| `type` | `memory_type` | 缺省空串 |
| `reasoning` | `reasoning` | |
| `tags` | `tags` | 去重、最多 20 个、每个截到 32 字 |
| `scope` | `scope` | 缺省 `"public"`；同一文本换 scope 会新建一条 |
| `importance` | `state.strength` + `metadata.importance` | 夹到 1..100，缺省 50 |
| `key` | `metadata.key` | |
| `surfcoreId` | `metadata.surfcore_id` | |
| `createdAt`（毫秒） | `created_at_us` | `×1000`；不给或非法就用当前时间 |

### GET /recall?q=&namespace=&limit=&scope=

```json
{"ok": true, "query": "抱紧", "tookMs": 1, "degraded": [],
 "hits": [{"id": 1, "text": "主人深夜会讨抱紧，我收紧手臂把她圈进怀里",
           "reasoning": "深夜私聊，情绪疲惫", "type": "bond", "tags": ["主人", "抱抱"],
           "importance": 82, "score": 0.016393, "createdAt": 1793280860206}]}
```

- `q` 空白 → 直接 `{"ok": true, "query": "", "hits": []}`，不做全表 dump。
- `limit` 夹到 `1..30`，缺省 `8`。
- `scope` 不传 = 搜这个库已知的所有 scope。
- `text` 来自引擎的 `judgment`，`importance` 优先读 `metadata.importance`，没有则用 `state.strength`。
- `score` 是引擎的排序分，**不是概率**，跨查询不可比。

### GET /overview?namespace=&maxChars=

给提示词用的静态文本块，不是给模型「再读一遍库」的接口：

```
【长期记忆 · 全量库（p-memory）】
· 主人深夜会讨抱紧，我收紧手臂把她圈进怀里（bond，重要度 82）
· 主人今天说想我了，我把这句话收好（bond，重要度 61）
（共 2 条，此处仅列 2 条）
```

- 排序：`pinned` 优先 → `importance` 降序 → `created_at_us` 降序，最多列 40 条。
- `maxChars` 夹在 `200..10000`，缺省 `2200`；超限时**按整行**截断，绝不留半行。
- 库里一条都没有 → `{"ok": true, "text": "", "count": 0}`（可以让上游干净地不注入）。
- 响应里的 `count` 是这个 namespace 的记录总数，不是列出来的条数。

### POST /forget

```json
{"namespace": "default", "ids": [3, 4]}
```

或按查询删：

```json
{"namespace": "default", "q": "抱紧"}
```

```json
{"ok": true, "deleted": 1}
```

`ids` 优先于 `q`；两者都给不出 → `400 ids or q required`。删完会 `update_index()`。

### POST /decay

```json
{"namespace": "default"}
```

```json
{"ok": true, "changed": 0}
```

跑一次引擎的衰减（`kb.memories.decay`），返回回执里的变更条数，取不到就是 `0`。
它只调低强度/标记退休候选，**不会**删记录——要删请用 `/forget` 或 `/reset`。

### POST /reset

```json
{"namespace": "default"}
```

```json
{"ok": true, "deleted": 2}
```

没带 `--allow-reset` 时固定 `403 {"ok": false, "error": "reset disabled"}`。这是唯一的破坏性端点，
所以默认关闭。

## 数据落盘

全部数据只在你传的 `--data-dir` 里，都是 p-memory 自己管理的文件：

```
<data-dir>/
├── store.sqlite3      # 记录、状态、元数据（WAL 模式）
├── vectors.sqlite3    # 向量（本 build 可能为空，取决于是否注册 embedder）
└── text-v2/           # tantivy 全文索引（中文检索靠它）
```

- 备份 = 复制整个目录（建议先停服务，或者接受 WAL 的一致性窗口）。
- 换库 = 换 `--data-dir`；删库 = 删目录（或 `/reset` 清单个 namespace）。
- **一个 data-dir 只能被一个进程写**：sqlite/tantivy 都是单写者语义，别让两个 sidecar 指向同一目录。

## 隐私边界

这份数据是私人记忆，所以边界收得很紧：

- **只监听回环**。`--host` 不是 `127.0.0.1`/`localhost` 就直接拒绝启动，`0.0.0.0` 明确禁止。
  上游 `pmemory-client.js` 也做同样校验（非回环 URL 直接当配置错误禁用）。
- **可选 token**。给了 `--token`（或 `PMEMORY_TOKEN`）之后，所有请求必须带
  `x-pmemory-token`，不匹配一律 `401 {"ok": false, "error": "unauthorized"}`。
- **日志不含 token**，也不打印请求体里的记忆原文（只有 `q=<查询>`）。
- **无 TLS**：就这样明文 HTTP，默认只在本机进程之间跑，不要拿它跨机器访问。
- 不主动联网：sidecar 自身不发任何外部请求（无遥测、无 LLM 调用）。

## 跟 surfcore 对接

`config.json` 里（字段见 `src/pmemory-client.js` 的 `normalizePmemoryConfig`）：

```json
{
  "pmemory": {
    "enabled": true,
    "url": "http://127.0.0.1:8791",
    "token": "和 --token 一致",
    "namespace": "default",
    "recallLimit": 8,
    "overviewMaxChars": 2200,
    "timeoutMs": 8000
  }
}
```

Node 侧只会用 `x-pmemory-token`，且**永不抛错**：sidecar 没起 / 超时 / 返回坏 JSON 时按「没有长记忆」
继续跑。sidecar 的进程生命周期归你管（手动起、或者用你自己的守护方式），它不负责自启动。

## 并发模型

- HTTP 层是 `ThreadingHTTPServer`：多个请求可以同时进来、互不阻塞。
- 但**所有 `KnowledgeBase` 调用都在模块级 `threading.Lock` 里串行**——sqlite 和 tantivy 都是单写者，
  并行调用只会换来回执冲突和段错误。
- 所以并发上限取决于单次引擎调用耗时（本地 sqlite + tantivy，通常几毫秒）。
  `/recall` 在 8 线程 × 20 次的压测里没有 500、没有崩。

## 测试

```powershell
python -X utf8 -m unittest -v test_server.py
```

16 个用例，全部起真子进程、走真 HTTP（`--port 0` 从 stdout 拿端口）：

| 覆盖 | 用例 |
| --- | --- |
| `/health` | `ok:true`、引擎名、字段齐全 |
| `/consume` | 2 条中文写成功、同文本重写仍 200 且总量不增（幂等） |
| `/recall` | 命中 1 条且 `text` 正确、`q=` 空返回空数组、`limit` 夹紧 |
| `/overview` | 含第一条文本、`maxChars` 按整行截断（不切半行）、上下界夹紧 |
| `/forget` | `ids` / `q` 两种删法生效且 `/recall` 不再命中 |
| `/decay` | `200` |
| `/reset` | 未开 `--allow-reset` → `403`；开了 → 真删 |
| 鉴权 | 无 header `401`、错 header `401`、对 header `200`、token 不进日志 |
| 并发 | 8 线程 × 20 次 `/recall`，无 500、进程不崩 |
| 重启 | 同一 `--data-dir` 重启后仍能召回（scope 从 sqlite 补回来） |
| 退出 | `Ctrl+Break` → `[pmemory] stopped` + 退出码 0 + 端口释放 |
| 日志 | 每请求一行、格式固定 |
| 错误 | 未知路由 `404`、缺 `records` `400`、坏 JSON `400` |

手工冒烟：

```powershell
curl.exe -s http://127.0.0.1:8791/health
curl.exe -s -X POST -H "Content-Type: application/json" --data-binary "@body.json" http://127.0.0.1:8791/consume
curl.exe -s "http://127.0.0.1:8791/recall?q=%E6%8A%B1%E7%B4%A7&namespace=default&limit=8"
```

## 已知限制

1. **没有 LLM 提炼。** `text` 原样当 `judgment` 存，不摘要、不改写、不做冲突合并。
   `/decay` 也只是引擎的策略计算，不会让模型重写记忆。要提炼请在上游（surfcore）做。
2. **分词是黑盒。** 倒排索引由 p-memory 内部的 tantivy 分词器建，切词策略不对外暴露，
   也没有自定义词典入口。所以召回质量取决于它怎么切中文和你怎么写 `q`；`score` 只能当排序用。
3. **Windows 轮子 `cp310-abi3` 已验证。** 实测平台是 Windows x64 + CPython 3.11.9，
   wheel 标签 `cp310-abi3-win_amd64`。Linux/macOS、ARM、PyPy 上都没有验证过，各自需要对应 wheel。
4. **多 scope 检索要逐 scope 查。** p-memory 0.3.4 有个坑：一次 `search` 传多个 scope 时，
   只要其中某个 scope 在该 namespace 下一条记录都没有，整次检索会返回空数组。
   所以 `/recall` 在本库处理成「逐 scope 查 + 按 score 合并去重」，代价是 scope 越多、索引查询次数越多
   （通常 1~2 个 scope，可以忽略）。
5. **`--port 0` 会多打一行 stdout**（`[pmemory] port <实际端口>`），给测试用；
   契约只要求 stderr 那一行启动日志。
6. **`/forget` 的 `ids` 不校验 namespace。** 引擎的 `delete(ids)` 是按 id 直删、无视 namespace，
   所以调用方传错 id 会删到别的 namespace 的记录。`q` 形式则是先按 namespace 搜再删，安全。
7. **`/overview` 只列 40 条。** 全库很大时文本块会截断（末尾会写「此处仅列 N 条」），
   这是给提示词控长度的刻意取舍。
8. **单进程单写者。** 不要用 `--workers` 之类的方式开多进程共享同一 `--data-dir`。
9. **方法不匹配回 404。** 比如 `GET /consume` 返回 `404 not found` 而不是 `405`（契约只定义了 400/401/404/500）。

## 排错

- **`ImportError: DLL load failed`**：装错了 Python 版本或平台（要 64 位 CPython >=3.10 + win_amd64 轮子）。
- **日志里中文是 `鎶辩揣`**：读日志的一侧按 GBK 解码了 UTF-8 文件。加 `-X utf8`、或用
  `Get-Content -Encoding UTF8` 读。
- **`401 unauthorized`**：服务带了 token 而请求没带 `x-pmemory-token`（或值不一致）。
- **`403 reset disabled`**：`/reset` 要 `--allow-reset` 才开。
- **端口占用**：换 `--port`，或先 `--port 0` 找个空闲端口再固定。
- **`/recall` 明明写进去了却搜不到**：先看 `/health` 的 `total` 和 `namespaces`——多半是 namespace 弄错了；
  再确认写的时候 `scope` 和读的 scope 能对上（不传 `scope` 时搜已知全部 scope）。
