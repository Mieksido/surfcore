# 长期记忆后端（p-memory，可选件）

> 一句话：记忆卡（`MEMORY_CARD.md`）继续当唯一真相；这里给「按关键词检索历史」补一个可选后端，
> 默认关闭，关着的时候行为和今天完全一样。

## 1. 为什么需要它

记忆卡是**规则打分 + 确定性截断**的文件卡：轻、可审计、没有数据库、不调模型。它刻意不做两件事——

1. 不做语义检索。它的「检索」只有 2-gram 打分给复习加分，以及全量档的流式扫描。
2. 不建索引。全量档 `memory-card-full.jsonl` 只追加，用来存档和离线找，不进提示词。

当记忆条数上到几百条之后，「她记得这件事，但想不起来」就会变成高频问题：卡里放不下的东西，
今天只能靠 `MEMORY_CARD.md` 里那条预留的 `/memory-card/full?q=` 手动找。

`p-memory` 补的正是这一半：它是一个 Rust 扩展（PyO3），把**写入 / 索引 / 检索 / 衰减**放进去，
中文检索开箱可用（分词在 Rust 内部，不需要 jieba、不需要自己调分词器）。代价是它是 Python 包，
Node 起不动，只能有一个本地 sidecar 进程。

## 2. 三个进程和一条文件契约

```
DSH 宿主（插件）
  └─ 每 10 分钟记忆维护之后：卡 → POST /consume（镜像）→ GET /overview → 写 pmemory-prompt-qq.md
QQ 桥接（独立进程）
  └─ 只读 pmemory-prompt-qq.md，注入提示词（和读 memory-card-prompt-qq.md 是同一种方式）
p-memory sidecar（Python，127.0.0.1:8791）
  └─ 唯一持有 store.sqlite3 + Tantivy 索引的进程
```

关键约束：**桥接不调插件 HTTP，也不解析 JSON**——沿用记忆卡那条「文件是唯一契约」的约定。
所以桥接里只有十几行（读文件 + 缓存），sidecar 挂了也不会拖慢或拖死 QQ 回复。

## 3. 装上

前置：Python 3.10+（本机 3.11.9 实测通过）。

```powershell
python -m venv .venv-pmemory
.venv-pmemory\Scripts\python.exe -m pip install "p-memory==0.3.4"
```

启动（在仓库根目录）：

```powershell
.venv-pmemory\Scripts\python.exe sidecars\pmemory\server.py --data-dir state\pmemory
```

Linux / macOS 同理，`bin/python` 换一下。`--port 0` 会打印实际端口，`--token`（或环境变量
`PMEMORY_TOKEN`）开启请求鉴权，`--allow-reset` 才允许 `POST /reset`（默认 403）。

然后把 `config.json` 的 `pmemory.enabled` 改成 `true`（字段见下一节）。改完**要重启桥接一次**
（`npm start` 或在控制台点重启）：`cfg` 在桥接启动时解析一次，注入开关跟着它走。注入文件在
下一次记忆维护时写出来（最多 10 分钟；面板上「立即整理」可以手动触发）。

## 4. 配置

`config.json` 的 `pmemory` 块（默认值见 `config.example.json`）：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `false` | 总开关。`false` 时不会发出任何请求，注入文件会被清空 |
| `url` | `http://127.0.0.1:8791` | **只允许回环地址**；写局域网/公网地址会被忽略并强制禁用 |
| `token` | `""` | sidecar 的 `x-pmemory-token`，留空表示 sidecar 没开鉴权 |
| `timeoutMs` | `8000` | 单请求超时；超时按「没有长记忆」处理，不重试不报错 |
| `namespace` | `""` | 传给 p-memory 的命名空间，留空用 sidecar 的 `default` |
| `overviewMaxChars` | `2200` | 注入块上限（字符，不是 token） |
| `mirrorOnMaintenance` | `true` | 维护后是否把卡里的记录镜像进索引 |
| `recallLimit` | `8` | `qq_memory_recall` 的默认条数 |

## 5. 失败了会怎样

| 情况 | 行为 |
| --- | --- |
| 没开（默认） | 零请求，`pmemory-prompt-qq.md` 清空，行为和没有这个功能一样 |
| sidecar 没启动 | 保留上一次的注入文件（一次重启不该清空已有的长记忆），状态写 `unreachable`，QQ 照常回复 |
| 请求超时 / 500 | 同上，错误写进 `pmemory-status.json`，不影响记忆卡维护 |
| `url` 不是回环 | 记配置错误并强制禁用，不发请求 |
| 记忆卡被关掉 | 注入文件一起清空（同记忆卡「设置关了不能留着旧提示词」的做法） |

状态落在 `<角色目录>/memory/pmemory-status.json`，字段 `state` 取 `disabled` / `unreachable` / `synced`。

## 6. 工具与召回

- 静态注入：`GET /overview` 的渲染结果进 QQ 提示词（`pmemory-prompt-qq.md`），走的是
  `roleHintForMode()` 里记忆卡后面那一段。
- 按需召回：新增只读工具 `qq_memory_recall(query, limit?)`，直接打 sidecar，**不经桥接**——
  桥接那套「agent token 默认拒绝」的白名单不该为了一个附加后端开口子。

## 7. 安全边界

- sidecar 只监听 `127.0.0.1`，且 `config.json` 侧还会再校验一次地址，双保险。
- 记忆是私人内容：`store.sqlite3` 与 `text-v2/` 索引都在 `state/pmemory/`（已被 `.gitignore` 忽略），
  sidecar 不对外暴露端口、不写日志正文（日志只记方法/路径/条数/耗时，不记 token）。
- 这个后端**不改变**记忆卡现有的隐私 scope 投影：`includeQqInBili=false` 时 B站 侧拿不到 QQ 分区，
  长记忆的注入文件也只有 `-qq.md` 一份，B站 链路完全没接。

## 8. 测试

```powershell
node scripts/test-memory-pmemory-backend.mjs     # 离线：桩冒充 sidecar，9 条
$env:PMEMORY_TEST_URL='http://127.0.0.1:8791'
node scripts/test-memory-pmemory-backend.mjs     # 追加联调：写入后中文关键词必须命中
```

离线用例覆盖配置归一、回环限制、卡记录映射、fail-soft、以及同步的三种结局（成功/连不上/禁用）。
联调用例在没设置 `PMEMORY_TEST_URL` 时自动 skip，所以 CI 与 `npm run test:audit` 不需要 Python。

## 9. 没做的部分（明确不在这版）

- 不搬数据：不从 AstrBot 侧 `angel_memory` 导入任何记录，只搬「有检索能力」这件事。
- 不做 LLM 反思提炼：这一版只是把检索搬过来；「让模型把对话提炼成一条记忆」是下一步的事。
- 不改记忆卡自己的衰减曲线：`memory-card.json` 仍是唯一真相，`targetClarity()` 一个字没动。
- 不接管遗忘：`/decay` 与 `/forget` 两个端点留好了，但没有接到自动维护里；忘记某条记忆仍然走
  面板上的记忆卡操作。

## 10. 相关文件

- `src/pmemory-client.js` —— 客户端（fail-soft、只连回环、无依赖）
- `plugins/surfcore/lib/pmemory-backend.js` —— 维护后同步（镜像 + 概览 + 状态）
- `sidecars/pmemory/` —— sidecar（`API.md` 是契约，`server.py` 实现，`test_server.py` 单测）
- `scripts/test-memory-pmemory-backend.mjs` —— 离线门禁
