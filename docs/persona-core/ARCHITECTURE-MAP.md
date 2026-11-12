# 架构景观（刚性四段）· 2026-11-11

> 四段是刚性的，**从上到下只有四层**：
> **内核 → 大适配器 → 小适配器 → 模块**。
> 大适配器冻结：**不改**。契约只存在于**小适配器**与**模块**里。
> 开发设施（门禁/CLI/打包）不画进这张图；它们不是层。
>
> 本轮实测：内核 **61 文件 / 7,675 行**、大适配器 **8 文件 / 1,003 行（冻结）**、
> 小适配器 + 模块 **28 文件 / 4,085 行**（QQ/B站/桌宠/web）、测试 **93 个文件**、
> 能力 **27 模块 / 236 条**。

---

# 架构图（纵切四层）

## 第一层：内核 kernel/（灵魂）

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 内核 kernel/（61 文件 / 7,675 行）                                            │
│ 只认识 event / intent / receipt；不认识任何平台；不联网；不 import 其他三层   │
│                                                                              │
│ 目的 purpose/（3）        记忆 memory/（14）         时机 attention/（3）     │
│ ├ 驱动权重                ├ 叙事：衰减卡+全量卡      ├ 唤醒分级/群分层       │
│ ├ 目标假设/观察账本       ├ 评分/去重/容量/最初       ├ 合批/轮次守卫         │
│ ├ 闭环/每日次数           ├ 脱敏/联想/媒体库          └ 鱼群/刷屏短指令        │
│ └ 话题 6h 不重复          ├ 向量：多模型索引 + embed                             │
│                           └ 身份/可见性/场合标签                              │
│                                                                              │
│ 表达 expression/（10）    对话 conversation/（2）     收尾 closure/（1）      │
│ ├ 提示词/上下文预算       ├ 窗口 + pending           └ 道别/安静/聊太久      │
│ ├ 模型端口◇（剧本/HTTP）  └ 长对话摘要                                       │
│ ├ 工具面/工具往返                                                            │
│ ├ 识图 vision（图片段）                                                       │
│ ├ 媒体摘要/降级                                                              │
│ └ 价目表 prices（数据）                                                       │
│                                                                              │
│ 黑话 lexicon/（2）        表情 sticker/（2）          语音 voice/（6）         │
│ ├ 候选→确认→渲染         ├ 收藏/情绪/推荐          ├ 引擎端口◇              │
│ └ 提取/证据合并           └ 发送走 send_media        ├ 合成/HTTP 传输         │
│                                                       ├ 库/导入/闸门/路由     │
│                                                       └ 失败分类              │
│                                                                              │
│ 设置 settings/（2）       支撑 support/（6）          落盘 store/（1）         │
│ ├ 声明/校验/导入导出      ├ 审计/预算/身份          └ 原子写/备份/单写锁     │
│ └ 内核阈值               ├ 账本 ledger/报表                                 │
│                           ├ 谁是谁/我是谁                                    │
│                           └ 时间工具                                         │
└──────────────────────────────────▲───────────────────────────────────────────┘
                                   │
                   三种消息（结构固定，永远不动）：
                   event ↑ / intent ↓ / receipt ↑
                                   │
```

## 第二层：大适配器 runtime/（只搬，不判断）【冻结】

```
┌──────────────────────────────────┴───────────────────────────────────────────┐
│ 大适配器 runtime/（8 文件 / 1,003 行）【冻结 · 不许动】                      │
│                                                                              │
│ index.js      管道：槽位校验 / 盖来源戳 / 幂等 / 能力门 / 回执 / 媒体验收     │
│ host.js       宿主：发现 / 清单校验 / 内容闸门 / _origin / 政策 / 启用 / 卸载 │
│ compose.js    组装：内核 + 多个小适配器（合批器注入，不 import 内核）         │
│ outbox.js     发件箱：只重试可重试的，未确认的绝不重试                        │
│ allowlist.js  白名单：只管群/私聊两种频道                                     │
│ ui.js         模块界面声明：收集/校验（不渲染）                               │
│ media-kit.js  媒体限额（唯一真相）                                            │
│ pack-rules.mjs 内容闸门（唯一真相，6 条规则）                                 │
│                                                                              │
│ 不认识平台，也不知道内核里有什么；只做“搬运 + 校验 + 盖章”。                  │
└───────▲───────────────────▲───────────────────▲───────────────────▲──────────┘
        │                   │                   │                   │
```

## 第三层：小适配器（每包一个 index.js；契约在这里）

```
┌───────┴─────────┐ ┌───────┴─────────┐ ┌───────┴─────────┐ ┌───────┴─────────┐
│ 小适配器 · QQ   │ │ 小适配器 · B站  │ │ 小适配器 · 桌宠 │ │ 小适配器 · web  │
│ packs/qq/       │ │ packs/bilibili/ │ │ packs/desktop-  │ │ packs/web/      │
│ index.js        │ │ index.js        │ │ pet/index.js    │ │ index.js        │
│                 │ │                 │ │                 │ │                 │
│ identity        │ │ identity        │ │ identity        │ │ identity        │
│ capabilities    │ │ capabilities    │ │ capabilities    │ │ capabilities    │
│ settings(10)    │ │ settings(2)     │ │ settings(3)     │ │ settings(3)     │
│ ui              │ │                 │ │                 │ │ ui              │
│ open/attach     │ │ open/send       │ │ open/push       │ │ open            │
│ send/health     │ │ health/close    │ │ send/health     │ │ send/health     │
│ close           │ │ plan()          │ │ close/configure │ │ close           │
│ runTool/        │ │                 │ │ setFocus        │ │ runTool/        │
│ toolDeclarations│ │                 │ │                 │ │ toolDeclarations│
└───────┬─────────┘ └───────┬─────────┘ └───────┬─────────┘ └───────┬─────────┘
        │                   │                   │                   │
```

## 第四层：模块（每个小适配器对应一个模块；该平台/世界的全部规矩）

```
┌───────┴─────────┐ ┌───────┴─────────┐ ┌───────┴─────────┐ ┌───────┴─────────┐
│ 模块 · QQ       │ │ 模块 · B站      │ │ 模块 · 桌宠     │ │ 模块 · web      │
│ packs/qq/       │ │ packs/bilibili/ │ │ packs/desktop-  │ │ packs/web/      │
│                 │ │                 │ │ pet/            │ │                 │
│ onebot          │ │ api             │ │ poll            │ │ fetch           │
│ receiver        │ │ dynamics        │ │ api             │ │ tools           │
│ tools（22）     │ │ slots           │ │                 │ │                 │
│ bridge-tools(18)│ │ job             │ │                 │ │                 │
│ gateway         │ │ emitter         │ │                 │ │                 │
│ gateway-import  │ │ poller          │ │                 │ │                 │
│ media-download  │ │ logic           │ │                 │ │                 │
│ text            │ │ share           │ │                 │ │                 │
│ forward         │ │ time            │ │                 │ │                 │
│ group-info      │ │                 │ │                 │ │                 │
└─────────────────┘ └─────────────────┘ └─────────────────┘ └─────────────────┘
```

> **网关不是外挂**：QQ 的网关画像/导入/协议全在 QQ 模块里
> （`gateway.js` + `gateway-import.js` + `onebot.js`）。
> 图上不画外部世界，也不画网关。

---

# 每一层里到底有什么（按文件）

## 内核 kernel/（53 文件）

| 组 | 文件 | 它藏的秘密 |
| --- | --- | --- |
| 总装 | `kernel/index.js` | handle/respond/tick/save/load；账本、价目表、embedder、摘要编排 |
| 运行时 | `kernel/runtime.js` | 内核生命周期：start/tick/向量积压/保存/stop；system 由组装点注入；不认识平台 |
| 目的 | `purpose/{index,materials,clock}.js` | 驱动权重/目标假设/观察账本/闭环/每日额度/话题不重复 |
| 记忆·叙事 | `memory/{index,identity,scoring,dedupe,capacity,initial,redact}.js`、`memory/narrative/*` | 判重→脱敏→评分→最初→衰减卡+全量卡；可见性政策 |
| 记忆·向量 | `memory/vector/{store,embed}.js` | 独立存储 + 余弦读取 + 嵌入端口 |
| 记忆·媒体 | `memory/media.js` | 原件落盘/指纹去重/引用计数/保留期/readBytes |
| 时机 | `attention/{index,batch,turn-guard}.js` | 唤醒分级/群分层/鱼群/合批/轮次守卫 |
| 表达 | `expression/{index,model-port,model-http,prompt,context-budget,tools,media-brief,vision,fallback,prices}.js` | 提示词/预算/模型端口/工具往返/识图/降级/价目表 |
| 对话/收尾 | `conversation/{index,summary}.js`、`closure/index.js` | 刚才窗口 + 摘要；结束点/下次接法 |
| 黑话/表情 | `lexicon/{index,learn}.js`、`sticker/{index,semantics}.js` | 候选→确认→渲染；收藏/情绪/推荐 |
| 语音 | `voice/{index,models,engine,tts,tts-http,wav,library,import,artifact,model-store,model-runtime,providers,provider-config}.js` | 闸门/路由/合成/传输/时长/库/导入/模型公共面/provider |
| 设置 | `settings/{index,limits}.js` | 声明校验/导入导出/内核阈值 |
| 支撑 | `support/{index,ledger,ledger-report,people,self-card,time}.js` | 审计/预算/身份/账本/报表/谁是谁/我是谁/时间 |
| 落盘 | `store/persist.js` | 原子写/备份/跨进程单写者锁 |

## 大适配器 runtime/（8 文件，冻结）

| 文件 | 它藏的秘密 |
| --- | --- |
| `index.js` | 事件/意图/回执的管道与校验；盖来源戳、幂等、能力门、媒体验收 |
| `host.js` | 包发现/清单/内容闸门/来源/政策/启用/卸载 |
| `compose.js` | 把内核与多个包组装起来（不 import 内核） |
| `outbox.js` | 发件箱重试语义（未确认不重试） |
| `allowlist.js` | 白名单（群/私聊） |
| `ui.js` | 界面声明收集/校验（不渲染） |
| `media-kit.js` | 媒体限额唯一真相 |
| `pack-rules.mjs` | 包内容闸门唯一真相 |

## 小适配器 + 模块（每个包一对）

### QQ（小适配器 `index.js` + 模块 10 文件）

- 小适配器：`packs/qq/index.js` — identity/capabilities/settings(10)/ui/open/attach/send/health/close/runTool/toolDeclarations。
- 模块：
  - `onebot.js` OneBot v11：消息段解析/归一事件/发送
  - `receiver.js` WS 接收：心跳/重连/通知
  - `history.js` 断线补群历史（水位/去重；`silent=true` 不唤醒）
  - `tools.js` 22 个 OneBot 动作（read/write/manage）
  - `bridge-tools.js` 18 个桥接语义工具（读 16/写 2）
  - `gateway.js` 网关画像/导入计划
  - `gateway-import.js` 导入执行
  - `media-download.js` 媒体下载（渠道侧拿字节）
  - `text.js` 文本安全/拆条
  - `forward.js` 合并转发（只收）
  - `group-info.js` 群规模（塞 to.memberCount）

### B站（小适配器 `index.js` + 模块 9 文件）

- 小适配器：`packs/bilibili/index.js` — 四块 + open/send/health/close + plan()。
- 模块：`api.js` 网络读/写、`dynamics.js` 动态解析/增量、`slots.js` 分享槽位、`job.js` 分享任务、`emitter.js` 内容→事件、`poller.js` 轮询、`logic.js` 额度/生物钟、`share.js` 分享卡/文本、`time.js` 时间窗。

### 桌宠（小适配器 `index.js` + 模块 2 文件）

- 小适配器：`packs/desktop-pet/index.js` — 气泡/专注门/语音决策/长轮询接入口。
- 模块：`poll.js` 长轮询、`api.js` 本地 API 形状 + 访问闸门。

### web（小适配器 `index.js` + 模块 2 文件）

- 小适配器：`packs/web/index.js` — 四块 + open/send/health/close + toolDeclarations/runTool。
- 模块：`fetch.js` 安全抓取（SSRF/DNS/重定向/限量）、`tools.js` web_fetch/web_search。

---

# 契约在哪、参数在哪、数据在哪

| 东西 | 位置 | 动它算什么 |
| --- | --- | --- |
| 三种消息的形状（event/intent/receipt） | 小适配器 ↔ 内核的约定，大适配器校验 | **接口结构：不许动** |
| 包的六件（identity/capabilities/settings/ui/open/send/health/close） | 每个小适配器的 index.js | 接口内容（报备：哪个包的小适配器） |
| 平台数据格式（OneBot/CQ、B站 JSON、桌宠 HTTP、网页） | 各模块内部，不出模块 | 模块策略 |
| 错误码/hint/重试判据 | 小适配器与模块（谁失败谁给） | 接口内容（报备） |
| 数值/开关 | settings 声明（内核阈值在 kernel/settings/limits.js） | 可调参数 |
| 落盘形状 | state/persona-core/*.json | 数据（可迁移，不当契约） |
| 价目表 | kernel/expression/prices.js | 数据 |

“接口内容”人话：**信封还是那三种，没变；变的是信封里必须写什么。**
动内容 = 改约定；动结构 = 改信封本身（所有包都得跟着改）——所以**结构永远不动**。

---

# 依赖方向与注入端口

```
稳定性：内核（最稳） > 大适配器 > 小适配器 > 模块（最易变）
依赖只许从“易变”指向“稳定”：

  模块 ──▶ 小适配器 ──▶ 大适配器 ──▶ 内核
   （包内）    （包内）      （被调用）     （只认接口）

禁止（fitness 每次查）：
  kernel  ──✗──▶ runtime / packs / tools
  runtime ──✗──▶ kernel / packs / tools
  packs   ──✗──▶ kernel / tools
  tools   ──✓──▶ 四层（开发设施可读；四层不许读它）

注入端口（稳定的一侧只说“要什么”，实现由组装层给）：
  内核 expression ◇ model port   ←─ tools/model.mjs / model-http.js / 剧本/规则
  内核 voice      ◇ engine port  ←─ tools/cli.mjs 装配 / tts-http.js
  内核 memory     ◇ embedder     ←─ tools/cli.mjs 装配 / embed.js 的 HTTP 传输
  内核 memory     ◇ media bytes  ←─ media.readBytes()（盘上原件）
  包装配          ◇ pack 清单    ←─ runtime/host.js（发现/校验/启用）
```

---

# 怎么加一个新能力（照这个顺序）

1. **先判断它属于谁**：平台的规矩 → 对应包的模块；她自己的判断 → 内核；只是装配/运维 → 四层之外。
2. **平台的规矩**：加在 `packs/<name>/` 的模块文件里，导出纯函数；由该包 `index.js` 调用。
3. **小适配器契约**：只在必要时加设置/工具声明；六件形状不变；动了内容要报备是哪个包。
4. **内核能力**：加在 `kernel/<块>/`，纯函数优先；跨块编排放 `kernel/index.js` 的工具函数，不新起接口。
5. **能力清单**：在 `capability-map.json` 的对应模块加一条，写明 `status/evidence/level`。
6. **测试**：模块自己的 `*.test.mjs`；不启动世界就能验。
7. **门禁**：`npm run test:arch`；新增文件不能被 `audit` 判成未登记/重复导出。

# 以后想改，怎么改（判断口诀）

| 你想改的 | 放哪 | 好不好改 |
| --- | --- | --- |
| QQ 收发/工具 | `packs/qq/index.js` + 模块 | 好改；只影响 QQ |
| B站分享/动态/额度 | `packs/bilibili/` | 好改；只影响 B站 |
| 桌宠气泡/专注/本地 API | `packs/desktop-pet/` | 好改；只影响桌宠 |
| 联网抓取/搜索 | `packs/web/` | 好改；只影响 web |
| 她的记忆/目的/表达/时机 | `kernel/<块>/` | 好改；只影响内核该块 |
| 可调数值/开关 | settings 声明 | 很好改；不动逻辑 |
| 价目表/账本数据 | `prices.js` / `ledger.js` | 很好改；不动结构 |
| `event/intent/receipt` | —— | **不许动** |
| `runtime/` | —— | **冻结** |
| 门禁/CLI/打包 | `tools/`（四层之外） | 不影响运行时 |

---

# 验证（每次改完必跑）

```powershell
npm run test:arch   # 93 个测试文件 + 适应度 + 体检 + 本体 + 能力/旧功能对账
```

**大适配器不动**：每次用 `git rev-parse 43dbd97:runtime` 和 `HEAD:runtime` 对比树哈希；
本轮仍是 `d607d26d...`（0 改动）。

---

# 老功能落位（按层）

| 老代码 | 现在的位置 | 属于 |
| --- | --- | --- |
| `memory-card.js` 衰减/全量/评分/容量/最初 | `kernel/memory/*` | 内核·记忆 |
| `vector-memory.js` | `kernel/memory/{index,vector/store}.js` | 内核·记忆 |
| 公共/私下场合标签（只有主人私聊 private） | `kernel/memory/identity.js` + 两个读取器的 refs | 内核·记忆 |
| `embedding-packs.js` | `kernel/memory/vector/embed.js`（端口 + 假实现；真模型待接） | 内核·记忆 |
| 双记忆 / 向量多模型索引 / 待编码 | `kernel/memory/{index,vector/store}.js` + `kernel/settings/limits.js` | 内核·记忆 |
| `slang-learner.js` | `kernel/lexicon/*` | 内核·黑话 |
| `sticker-*` | `kernel/sticker/*` | 内核·表情 |
| `purpose-*` | `kernel/purpose/*` | 内核·目的 |
| `attention`/`fish-guard`/`command-spam` | `kernel/attention/*` | 内核·时机 |
| `voice-*` | `kernel/voice/*`（引擎端口/通用 HTTP/通用模型 manifest；包 manifest 已校验） | 内核·语音 |
| `conversation-closure.js` | `kernel/closure/index.js` | 内核·收尾 |
| `character-persona`/`self-identity`/`align` | `kernel/support/*` | 内核·支撑 |
| `token-budget.js` | `kernel/support/index.js` | 内核·支撑 |
| `token-ledger.js`/`model-prices.js` | `kernel/support/ledger.js` + `kernel/expression/prices.js` | 内核·支撑/表达 |
| `bridge.js` 管道/白名单/发件箱 | `runtime/{index,allowlist,outbox}.js` | 大适配器 |
| `bili-api.js` | `packs/bilibili/api.js` | B站 模块 |
| `bili-dynamics.js` | `packs/bilibili/dynamics.js` | B站 模块 |
| `bili-share-scheduler.js` 槽位/选卡/投递 | `packs/bilibili/{slots,job,share}.js` | B站 模块 |
| `bili-logic.js` | `packs/bilibili/logic.js` | B站 模块 |
| `bili-memory.js` 跨视频关联 | `packs/bilibili/emitter.js` + `kernel/memory/associate.js` | B站 模块 + 内核 |
| OneBot/桥接/网关/媒体/文本/转发 | `packs/qq/*` | QQ 模块 |
| 桌宠气泡/专注/长轮询/本地 API | `packs/desktop-pet/*` | 桌宠 模块 |
| 联网搜索/安全抓取 | `packs/web/{fetch,tools}.js` | web 模块 |
| 旧 `config.json` 兼容/迁移 | `tools/migrate.mjs`（只读预览；`--apply` 只写新设置） | 四层之外（开发设施） |
| 旧记忆 → 新内核迁移 | `tools/migrate-memory.mjs`（dry-run/--apply 独立状态） | 四层之外（一次性工具） |
| 记忆 shadow tap | `tools/shadow-tap.mjs`（只读旧 inbox，灌新内核影子状态，不发消息） | 四层之外（运维工具） |
| 影子覆盖对比 | `tools/shadow-diff.mjs`（旧记忆 vs 影子全量卡，只读） | 四层之外（验证工具） |

> 逐文件、逐导出、逐契约的完整清单：
> [`GLOBAL-INVENTORY.md`](GLOBAL-INVENTORY.md)。能力清单：
> [`capability-map.json`](capability-map.json)。

---

# 本轮（2026-11-11）口径修正

| 事 | 结论 |
| --- | --- |
| `tools/` | 是四层之外的开发设施，不是第五层；登记为 `dev`，四层不许 import 它 |
| web | 保留为第四个扩展（小适配器 + 模块），默认不启用 |
| 网关 | 不是外挂；`gateway.js` / `gateway-import.js` / `onebot.js` 全在 QQ 模块 |
| 记忆 | 叙事+向量双写；读只选一条；每个 modelSpace 一套索引；模型/runtime 是内核资产，不是包 |
| 大适配器 | 0 改动；树哈希与交接时一致 |

---

# 完整图之外：代码位置清单

- 内核：`kernel/`（53 文件）
- 大适配器：`runtime/`（8 文件，冻结）
- 小适配器：`packs/*/index.js`（4 个）
- 模块：`packs/*/` 下的其余文件（23 个）
- 开发设施：`tools/`（四层之外，不在架构图里）
- 壳：`D:\deepseekwork\surfcore-ui`（仓库外，不进四段）

**注意**：代码里小适配器与模块在同一个包目录（`packs/<name>/index.js` 是适配器，兄弟文件是模块）。
这是“一个包 = 一个小适配器 + 它的模块”，不是把两层混在一起。
