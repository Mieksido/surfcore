# 记忆检索：从「逐行 substring 扫档」升级为 BM25 + 本地向量混合检索（并接进唤醒路径）

## 现象

- 需求原话：「开始进行安装吧」——把 B 项目（`dsh-memory-brain`）那套记忆检索搬进 SurfCore；确认方案后又说「接进去按最合理的方案」。
- 之前的实际行为：`recallFullMemory()`（`src/memory-card.js:1061`）把整份 `memory-card-full.jsonl` 读进内存，对每条做 `includes()` 字面匹配；而且**它在 `src/` 里没有任何运行期调用方**，等于这份能力从来没真正参与过唤醒。
- 用户体感：问「屋里那种发蓝光的东西」这种**记得内容但记不住词**的问题，纯字面匹配一条都找不到（真实记录里写的是「五十米灯带」）。
- 影响面：只影响回忆质量，不丢数据；检索只读 `memory-card-full.jsonl`，不动写入链路。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 / DSH 版本 | Windows 11 / DSH 0.2.1-rc.5 |
| SurfCore 版本 | v0.8.8（HEAD `0deb826`），分支 `main` |
| 安装方式 | git |
| 其它相关版本 | Node v26.13.0（`node:sqlite` 自带 FTS5）、llama.cpp b12121 (Vulkan x64)、Qwen3-Embedding-0.6B Q8_0 |

## 根因

- 代码位置：`src/memory-card.js:1061` `recallFullMemory()`。
- 问题链条：检索 = 全文读入 + `text.includes(query)`。中文没有词边界，用户嘴上说的词和记录里写的词经常对不上（「发蓝光的东西」vs「灯带」），字面匹配必然空手。
- 为什么之前没发现：语料只有 98 条时，`includes` 足够快，慢和准的问题都被「能找到就行」掩盖；量再大才会暴露。加上它没有调用方，等于一直没上线。

## 完整逻辑（给用户看的那一遍）

- **链路**：
  - 索引层 `src/memory-index.js`（新，768 行）：上游读 `~/.dsh/surfcore/characters/<角色>/memory/memory-card-full.jsonl`（唯一真相，只追加），下游产出 `~/.dsh/surfcore/state/memory-rag/index.db`（SQLite，可随时删了重建）。
  - 向量层 `src/memory-embed.js`（新，111 行）：只允许回环地址的 OpenAI 兼容客户端，指向本地 `127.0.0.1:8091`（llama.cpp + Qwen3-Embedding-0.6B，`D:\DSH_Dragonfly\memory-rag\`）。
  - 接入层 `src/memory-recall.js`（新，244 行）：`recallBlock()` 给**唤醒提示词**用（同步纯 BM25，不能 await 外部服务）；`searchMemoryAsync()` 给**控制台 API**用（异步混合检索）。
  - 桥接 `src/bridge.js` 三处：`:83` import、`:14679–14696` 唤醒提示词注入、`:9436` `POST /api/memory/search`。
- **机制**：三层。①关键词层：`memoryTokens()`（`src/memory-index.js:40`）把中文切成单字 + 二元组 + 3~6 字整串，灌进 FTS5；**跨词边界切出来的碎二元组（首尾是「的/那/我/是」这类字，如「的东」「里那」）在索引侧就丢掉**——它们在 FTS 里反而「稀有」，会被 BM25 当成强特征（实测「屋里那种发蓝光的东西」靠「的东」把一条讲飞机的动态顶到第一）。`ftsQueryFromTokens()` **只用二元及以上 token**，因为单字「的/是/我」几乎命中每一条（实测同一句话靠单字凑出 40 条命中）。②向量层：`syncVectors()`（`:503`）把没向量化的记忆批量送 `/v1/embeddings`，存 `vectors(id,dim,vec BLOB)`；`searchVectors()`（`:569`）归一化后点积=余弦。③融合层：`searchMemoryHybrid()`（`:616`）用 RRF（`RRF_K=60`）把两路排名相加，向量侧做 `best-0.15` 相对截断，向量独有条目回表补正文。
  - 唤醒时另做两道闸：`shouldRecall()`（触发词 `RECALL_TRIGGER_RE`：记得/上次/之前/说过/那个…）挡住日常闲聊；`matchHits()` 要求内容词真的出现在正文/标题里，`FN_CHARS` 边界过滤挡掉「你还/我上」这种二元组碎片，`RECALL_STOP_CHARS` 挡掉「记」命中「记忆」。
  - 二元组切不出实体时（「还记得那只猫吗」的「猫」），退回**单字兜底**，且只保留罕见字：`df <= max(3, ceil(total*0.08))`。实测该库 df：记2/得15/说26/过27/只9/猫6/叫6/聊5/番4。
  - 用 `alreadyInCard()` 去重：标题≥6 字或正文前 16 字已出现在记忆卡提示词里就跳过，避免同一件事说两遍。
- **爆炸半径**：进程数 1（桥接）× 读者数 1（只读记忆档）× 静默 3 = 3 分。不碰密钥、不花钱、不改记忆原文；索引库损坏的后果是检索返回空串（唤醒照常），删库重建即可。
- **取舍**：
  - A 方案 = 纯 BM25（FTS5 自带，零依赖，0 秒启动）；B 方案 = 本地向量（610MB 模型 + 102MB 运行时，慢 90ms/条）。选 B + A 混合，因为纯 BM25 对「记得意思记不住词」无能为力，而这正是回忆的主要用法；代价是引入一个本地服务，所以做了**失败即降级纯 BM25**（`reason='embed-failed: …'`）。
  - 唤醒路径**只用同步 BM25**：提示词组装是同步函数，不能为了向量把唤醒拖到 100ms+ 或卡在服务超时上。向量留给控制台手动搜索——那是人可以等的场景。
  - 没把检索做成模型工具：SurfCore 的工具来自 SnowLuma MCP（`src/mcp-snowluma-safe.js`），加工具要动 MCP 层，收益不如「唤醒自动联想 + 控制台可搜」。
- **生效与重启**：索引层本身不需要重启；**唤醒注入与控制台 API 需要重启桥接才生效**（改的是 `src/bridge.js`）。
- **回滚与残余**：
  - 软回滚：`config.json` 里设 `"memoryRecall": { "enabled": false }`，唤醒不再注入（API 仍可用）。
  - 硬回滚：删掉 `src/memory-index.js`、`src/memory-embed.js`、`src/memory-recall.js`、`scripts/memory-index.mjs`、`scripts/test-memory-index.mjs`、`scripts/test-memory-recall.mjs`，撤 `package.json` 5 个脚本，再手工撤桥接三处（`src/bridge.js` 被 git 设了 **skip-worktree** 位，`git diff`/`git restore` 看不到也不会还原它，必须按下面的块手工删）：

```
# 1) 删 import
import * as memoryRecall from './memory-recall.js';

# 2) 删唤醒注入（:14679 起）
const memoryRecallText = lastMsg && cfg.memoryRecall?.enabled !== false
  ? memoryRecall.recallBlock(MEMORY_CARD_PATHS.dir, String(lastMsg.text || lastMsg.plain || ''), {
      avoidText: memoryCardText,
    })
  : '';
const memoryRecallLine = memoryRecallText ? `${memoryRecallText}\n\n` : '';
# 并把 base 里的 `+ memoryRecallLine`、meta 里的 `memoryRecall: memoryRecallLine.length,` 去掉

# 3) 删 POST /api/memory/search 整段（:9436 起）
```

  - 残余：`state/memory-rag/index.db` 可留可删；`D:\DSH_Dragonfly\memory-rag\` 里的模型与运行时是独立目录，回滚 SurfCore 不受影响。

## 修法

- 新增 5 个文件：`src/memory-index.js`（768 行）、`src/memory-embed.js`（111 行）、`src/memory-recall.js`（244 行）、`scripts/memory-index.mjs`、`scripts/test-memory-index.mjs`、`scripts/test-memory-recall.mjs`。
- 改 5 处：`src/bridge.js`（3 处接线）、`scripts/audit-bridge-harness.mjs`（注入 `memoryRecall`）、`scripts/test-audit.mjs`（列表加两条）、`package.json`（`memory-index` / `test:memory-index` / `memory-rag:serve|stop|probe`）、`docs/PITFALLS.md` + `docs/cases/README.md`。
- 增量策略：`syncMemoryIndex()`（`:248`）按 `meta.offset` 只读新增行；文件头 64 字节指纹变了（换角色/被重写）就整库重建——不猜，宁可重来。分块 32MB，每块切到最后一条完整行，不会为了读 512MB 上限一次 alloc。
- 并发：`PRAGMA busy_timeout = 5000`，桥接与控制台同时写不会立刻 `SQLITE_BUSY`。
- 失败可见：`searchMemoryAsync()` 返回 `{ok:false, code, error, hint}`；`recallBlock()` 任何异常都返回 `''`（唤醒不能因为检索坏掉）。
- 一个真事故：`recallBlock()` 早期没校验目录存在，`ensureMemoryIndexFresh()` 静默跳过、`searchMemoryIndex()` 落到默认派生库，把**真实角色的记忆**注入进了假目录的测试——串档。现在 `archiveReady()` 先要求 `memory-card-full.jsonl` 存在，否则直接返回空 / `code:'archive.missing'`。
- 为什么不用 chroma / 别的向量库：`node:sqlite` 自带 FTS5，向量就存 BLOB + JS 里算余弦，98 条规模下比拉一个 Python sidecar 简单一个数量级；将来上万条再换 HNSW 也不影响接口。
- 为什么桥接用命名空间 import：`scripts/audit-bridge-harness.mjs` 把 `src/bridge.js` 丢进 `vm` 并按行剥掉所有顶层 import，绑定全靠注入的全局对象；写成 `import { recallBlock as memoryRecallBlock }` 时别名没有任何来源，四个审计脚本直接 `ReferenceError`。命名空间 import + 注入一个 `memoryRecall` 对象，才能同时满足所有调用点。
- **顺手修掉的一个既有 bug**：`readBody()` 在 `src/bridge.js:4519` 已经 `JSON.parse` 并返回**对象**，但 `:9465` 的 `/api/memory-card/notify` 还写着 `JSON.parse(await readBody() || '{}')` → 每次请求都 500（`"[object Object]" is not valid JSON`），也就是**记忆卡容量告警私聊从来没发出去过**。新路由照抄了同样的写法，联调时才暴露。两处都改成 `const body = await readBody();`。发现方式：先在活桥上打新接口，500；再打 notify，同样 500，才确认不是自己的问题。

## 验证

- 自动化：
  - `node scripts/test-memory-index.mjs` → **13 个用例全过**（分词、建库、增量、换档案重建、排序+scope、空查询、自动同步、向量幂等、余弦排序、混合回表、embedding 挂掉降级、分块推进、覆盖写不残留旧 token）。
  - `node scripts/test-memory-recall.mjs` → **10 个用例全过**（CQ 码清洗、触发词、不触发、命中格式与日期、已进卡不重复、maxChars、目录不存在/库坏、missing archive、纯 BM25、无向量降级）。
  - `npm run test:audit` → **144/145**（唯一失败见下）；`npm run test:regressions` → **17/17 全部通过**。
- 失败路径：embedding 服务停掉时 `searchMemoryHybrid` 返回 `mode:'bm25'` + `reason`，不抛异常；`recallBlock` 目录不存在/库坏/无命中一律返回 `''`，唤醒照常。两条都有断言。
- 手工验证（真实 98 条记忆）：
  - `memory-index stats` → `98 条 · qq=46 bili=39 pet=13 · 向量 98 条 1024 维`；建库 28ms，向量化 8755ms。
  - `search "屋里那种发蓝光的东西" -k 4 --hybrid` → 第 3 条 `猫咪小镇的地下宫殿…五十米灯带… via vec:0.443`；纯 BM25 top4 **没有**这一条。
  - 唤醒注入探针（`recallBlock` 直接调）：
    - 「你还记得猫咪小镇那个地下宫殿吗」→ 112 字，命中「五十米灯带、一百多颗灯珠…小老鼠婚礼」，2–10ms。
    - 「在吗」「晚上好呀」「今天天气不错」→ `''`（不注入）。
    - 「你记得我说过那只猫叫什么吗」→ 《大猫咪》《小猫咪绝育…》3 条。
    - 「你还记得我上次说过我讨厌什么吗」→ `''`（相关记忆本来就没有，不硬凑）。
- 重启后的活体验证（2026-11-05 14:5x，单实例 PID 2600，`state/bridge.lock` 一致）：
  - `POST /api/memory/search {"query":"屋里那种发蓝光的东西","limit":3}` → 200，`mode:hybrid`，第 3 条是灯带那条（`via vec:0.443`）。
  - `{"query":"你还记得猫咪小镇地下宫殿吗","hybrid":false}` → 200，第 1 条就是灯带那条。
  - `{"query":"我还记得你说过要一起去猫咪小镇"}` → 第 1 条灯带那条，`via bm25,vec:0.6495`。
  - 重启过程中发现并修掉上面的 `readBody()` 双重解析（否则新接口一直 500）。
- 没验证到的部分：
  - 真正被 QQ 消息触发的唤醒还没跑过（代码路径与探针一致，且 `lastWakePromptMeta.memoryRecall` 已记录长度，但没有在活体对话里看到注入结果）。
  - ~~`npm run test:audit` 唯一的失败 `fetchMediaData` 与本改动无关，但没验证过改前是否就红。~~ **已查清**：失败**不是**既有问题，而是工作区本地补丁 `stickerTextOnly`（表情默认不下载原图）与仓库用例冲突；HEAD 副本跑同一测试 **15/15 全过**。已单独修复并记录在 [`2026-11-05-sticker-textonly-meta.md`](2026-11-05-sticker-textonly-meta.md)。

## 遗留 / 后续

- 需要补的测试：真实唤醒路径的集成用例（断言 `lastWakePromptMeta.memoryRecall > 0`）；控制台 `POST /api/memory/search` 的路由级用例（这次只手工打了活桥，没进审计）。
- 需要改的文档：`docs/FOLDER_MAP.md` 补 `state/memory-rag/` 与 `D:\DSH_Dragonfly\memory-rag\`。
- 后续 5 件（星图 / FSRS / 建议候选 / 约定提醒 / 唤醒前联想注入）未开工。
- **已知质量边界**：混合检索里 RRF 只看排名不看分数，而当前 embedding（Qwen3-Embedding-0.6B + `--pooling last`）对「语义相近但用词不同」的区分度只有约 0.04（灯带 0.480 vs 飞机 0.432）。所以模糊问法（「屋里那种发蓝光的东西」）里，字面命中「东西」的条目会排在真正想找的那条前面；目标条目稳定进 top3，但不是 top1。换成「要一起去猫咪小镇」这种有具体词的问法，灯带那条就是 top1（0.6495）。
- **试过但没采用**：把 llama-server 换成 `--pooling mean`（临时起在 8092 对比后已关掉）——同一组文本余弦从 0.480 升到 0.740、区分度 0.048→0.084，但**排序没变**，而且现有阈值（`minScore 0.2`、`vectorMargin 0.15`）是按 last 调的，换池化要重调，收益不值。
- `src/bridge.js` 的 skip-worktree 位值得单独处理：它让 `git status` 对桥接的改动完全失明，发布/回滚都容易漏。另外这次写文件时把行尾统一成了 LF（原先工作区是 CRLF、HEAD 是 LF），Node 无感，但和仓库对齐反而更干净。

## 交接块

```
改了哪些文件：新增 src/memory-index.js（768 行）、src/memory-embed.js（111 行）、
  src/memory-recall.js（244 行）、scripts/memory-index.mjs、scripts/test-memory-index.mjs、
  scripts/test-memory-recall.mjs；src/bridge.js 三处接线（import / 唤醒注入 / POST /api/memory/search）
  + 修掉 readBody() 双重解析（/api/memory-card/notify 也一直 500）；
  scripts/audit-bridge-harness.mjs 注入 memoryRecall；scripts/test-audit.mjs 加两条；
  package.json 加 5 个 scripts（未改 version）；docs/PITFALLS.md、docs/cases/*。
测过什么：test-memory-index 13/13；test-memory-recall 10/10；npm run test:audit 144/145
  （唯一失败为既有的 media summary 用例，与本改动无关）；npm run test:regressions 17/17；
  重启后活体打 /api/memory/search 三种问法都 200 且目标条目在 top3（两条问法 top1）。
建议：minor（新增能力；唤醒提示词多一段、有开关），可延后到真实唤醒验证后再发。
case 文档：docs/cases/2026-11-05-memory-rag-index.md
改动层级：实现层新增 + 唤醒提示词组装一处、控制台两条路由；模型工具层未动。
失败路径：embedding 挂 → 降级 BM25 并带 reason；索引损坏/目录缺失 → 返回空或 ok:false 带 code/hint；
  config.memoryRecall.enabled=false → 唤醒不注入。
还没验证：真实 QQ 唤醒触发后的注入效果；media 用例是否改前就红。桥接改动在 git 里不可见
  （skip-worktree），回滚需手工撤三处，块见本文件「回滚与残余」。
```
## 补记（2026-11-05 18:0x）：派生库必须按档案目录分家

**症状**：生产索引库 `state/memory-rag/index.db` 里只剩 2 条（`mem_owner「主人喜欢雨天」` / `mem_event「去看了展」`），109 条真实记忆的检索当场失效；`vectors` 表还留着 108 行、维度元数据被清成 0，`stats` 显示「108 条 · 0 维」。

**根因**：所有入口的 `dbPath` 都缺省成**同一个生产库**，跟传进来的 `memoryDir` 无关；而库的增量游标（`meta.fingerprint` + `meta.offset`）是**按某一份档案**记的 —— 换个档案目录，指纹不符就 `force` 整库重建。于是任何别的 `memoryDir`（测试夹具、另一个角色、`characters/` 下另一个试验目录）都会读写同一份库，并且**把真实记忆顶掉**。触发者：`scripts/test-brain-bridge.mjs`（夹具把记忆档指到临时目录，种子记忆顺着这条路径建到了生产库上）。

**修法**：新增 `memoryIndexPathFor(memoryDir, env)` —— 当前角色目录（`characters/current.json` 的 `dir`，或它的 `memory` 子目录）→ 默认库；其它目录 → `state/memory-rag/archives/<sha1(dir) 前 16 位>.db`。并把解析后的 `dbPath` 贯穿 `ensureMemoryIndexFresh` / `searchMemory` / `syncVectors` / `searchMemoryHybrid` / `memory-recall.js` 的 `recallBlock` 与 `searchMemoryAsync`（顺带修掉 `searchMemoryHybrid` 里 `const { db } = openMemoryIndex(...)` 对上层 `db` 的变量遮蔽）。节流缓存 `lastSync` 也加了 `db` 维度，避免同一档案在不同库之间误命中节流。

**验证**：新增用例「两个不同档案目录不共用派生库」（两个目录各自建库、断言 A 的记录不在 B 的库里）→ `test-memory-index` **14/14**；生产库从真实档案重建后 **109 条**（qq=51 bili=45 pet=13）、向量 **109 条 1024 维**；活体 `POST /api/memory/search` 200 且排序正常；跑 `test-brain-bridge.mjs` 前后生产库条数不变（109 → 109），星图夹具的库落在 `state/memory-rag/archives/28487cbe399a219f.db`。

**回滚**：删掉 `memoryIndexPathFor` 与各处 `dbPath ||` 解析即可回到旧行为（但会重新引入串档），随后 `node scripts/memory-index.mjs build --force` 重建生产库。
