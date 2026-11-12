# 旧仓库能力基线（对照用）

> **本文件由 `tools/legacy-map.mjs` 生成**，不要手改；改 `legacy-capability-map.json` 后重跑。
> 基线来源：`D:\deepseekwork\surfcore（旧仓库，只读基线）`
> 旧仓库规模：**112 个文件 / 67,066 行**（src 77 文件 41,125 行；lib 35 文件 25,941 行）

## 复刻进度

**按域**：22 个域 —— ✅ 已复刻 5　🟡 部分 16　⬜ 未做 0　⛔ 红线 1（域完全复刻率 23%）

**按能力条目**：共 125 条，按所属域的状态归属如下（条目本身不做逐条判定）：

| 所属域状态 | 条目数 | 占全部条目 |
| --- | --- | --- |
| ✅ 已复刻 | 27 | 22% |
| 🟡 部分 | 95 | 76% |
| ⬜ 未做 | 0 | 0% |
| ⛔ 红线排除 | 3 | 2% |

> 读法："部分"表示**那个域**已经有新实现但还不完整，不代表这一条能力只做了一半。
> 逐条是否复刻，以新架构的 `CAPABILITY-MAP.md` 为准。

## 逐域对照

| 域 | 状态 | 新位置 | 旧代码 |
| --- | --- | --- | --- |
| 对话收尾 | ✅ 已复刻 | `kernel.closure` | src/conversation-closure.js <sub>523</sub> |
| 记忆 · 叙事 | ✅ 已复刻 | `kernel.memory` | src/memory-card.js <sub>2296</sub><br>plugins/surfcore/lib/memory-card.js <sub>552</sub><br>plugins/surfcore/lib/memory.js <sub>523</sub> |
| 目的机制 | ✅ 已复刻 | `kernel.purpose` | src/purpose-engine.js <sub>2302</sub> |
| 表情包 | ✅ 已复刻 | `kernel.sticker` | src/sticker-lib.js <sub>356</sub><br>src/sticker-semantics.js <sub>562</sub> |
| 联网工具 | ✅ 已复刻 | `pack.web` | src/web-search.js <sub>601</sub><br>src/safe-fetch.js <sub>385</sub><br>src/mcp-web-search-safe.js <sub>92</sub><br>src/mcp-host-server.js <sub>93</sub> |
| 时机 · 注意力 | 🟡 部分 | `kernel.attention` | src/wake-filter.js <sub>125</sub><br>src/wake-policy.js <sub>35</sub><br>src/wake-batch.js <sub>58</sub><br>src/fish-guard.js <sub>286</sub><br>src/group-policy.js <sub>74</sub><br>src/command-spam.js <sub>9</sub><br>src/turn-guard.js <sub>112</sub><br>plugins/surfcore/lib/qq-fish-guard.js <sub>85</sub> |
| B站渠道 | 🟡 部分 | `pack.bilibili` | src/bili-api.js <sub>150</sub><br>src/bili-dynamics.js <sub>187</sub><br>src/bili-card.js <sub>169</sub><br>src/bili-share-scheduler.js <sub>301</sub><br>plugins/surfcore/lib/bili-workspace.js <sub>19</sub> |
| 桥接主程序 | 🟡 部分 | 拆成 kernel/index.js（判断）+ runtime（管道）+ packs（收发） | src/bridge.js <sub>17801</sub> |
| 预算与计费 | 🟡 部分 | `kernel.support` | src/token-ledger.js <sub>1193</sub><br>src/token-budget.js <sub>464</sub><br>src/token-guard.js <sub>137</sub><br>src/billing-report.js <sub>541</sub><br>src/model-prices.js <sub>290</sub><br>src/model-options.js <sub>100</sub><br>plugins/surfcore/lib/token-budget.js <sub>786</sub><br>plugins/surfcore/lib/token-usage-pure.js <sub>134</sub><br>plugins/surfcore/lib/billing.js <sub>139</sub> |
| 兼容与迁移 | 🟡 部分 | `tools.gate` | plugins/surfcore/lib/compat.js <sub>431</sub><br>plugins/surfcore/lib/compat-rules.js <sub>44</sub><br>plugins/surfcore/lib/memory.js <sub>523</sub> |
| 表达 · 输出形态 | 🟡 部分 | `pack.qq` | src/forward.js <sub>231</sub><br>src/md-to-plain.js <sub>117</sub><br>src/safe-text.js <sub>74</sub><br>src/sensitive.js <sub>21</sub><br>src/qq-at.js <sub>44</sub><br>src/callname.js <sub>36</sub><br>src/qq-model-view.js <sub>80</sub> |
| 记忆 · B站专属 | 🟡 部分 | `kernel.memory` | src/bili-memory.js <sub>882</sub> |
| 记忆 · 向量 | 🟡 部分 | `kernel.memory` | src/vector-memory.js <sub>629</sub><br>plugins/surfcore/lib/vector-memory.js <sub>538</sub><br>src/embedding-packs.js <sub>254</sub><br>plugins/surfcore/lib/embedding-packs.js <sub>697</sub> |
| 模型接入 | 🟡 部分 | `kernel.expression` | src/dsh-client.js <sub>1137</sub><br>src/dsh-port.js <sub>101</sub><br>src/dsh-model-follow.js <sub>71</sub><br>src/dsh-health.js <sub>50</sub><br>src/v2-wait.js <sub>60</sub><br>src/gate-events.js <sub>208</sub><br>src/context-telemetry.js <sub>245</sub><br>src/context-snapshot.js <sub>145</sub><br>src/session-rollover.js <sub>136</sub><br>src/session-map.js <sub>46</sub><br>src/history-catchup.js <sub>144</sub> |
| 运维与外壳 | 🟡 部分 | `kernel.store` | plugins/surfcore/lib/index.js <sub>4514</sub><br>plugins/surfcore/lib/client.js <sub>8268</sub><br>plugins/surfcore/lib/updates.js <sub>2020</sub><br>plugins/surfcore/lib/scheduler.js <sub>1373</sub><br>plugins/surfcore/lib/store.js <sub>694</sub><br>plugins/surfcore/lib/extensions.js <sub>287</sub><br>plugins/surfcore/lib/privacy.js <sub>218</sub><br>plugins/surfcore/lib/doctor.js <sub>117</sub><br>plugins/surfcore/lib/paths.js <sub>111</sub><br>plugins/surfcore/lib/automation.js <sub>160</sub><br>plugins/surfcore/lib/http-guard.js <sub>87</sub><br>plugins/surfcore/lib/compat.js <sub>431</sub><br>plugins/surfcore/lib/compat-rules.js <sub>44</sub><br>src/self-test.js <sub>118</sub><br>src/owner-audit.js <sub>145</sub><br>src/greeting-schedule.js <sub>119</sub><br>src/outbox.js <sub>138</sub><br>src/action-planner.js <sub>46</sub><br>src/question-answers.js <sub>67</sub><br>src/share-mode.js <sub>40</sub><br>src/node-path.js <sub>41</sub><br>src/config-stamps.js <sub>26</sub><br>src/schema-values.js <sub>22</sub> |
| 人格与身份 | 🟡 部分 | `kernel.support` | src/character-persona.js <sub>727</sub><br>src/self-identity.js <sub>188</sub><br>src/persona-layers.js <sub>127</sub><br>src/role-card.js <sub>108</sub><br>src/preset-prompt.js <sub>157</sub><br>src/persona-identity.js <sub>22</sub><br>src/identity-guard.js <sub>66</sub><br>src/admin-identity.js <sub>247</sub><br>plugins/surfcore/lib/persona.js <sub>47</sub><br>plugins/surfcore/lib/persona-classify.js <sub>159</sub><br>plugins/surfcore/lib/characters.js <sub>188</sub><br>plugins/surfcore/lib/align.js <sub>507</sub> |
| 桌宠渠道 | 🟡 部分 | `pack.desktop-pet` | plugins/surfcore/lib/pet.js <sub>770</sub><br>plugins/surfcore/lib/pet-chat.js <sub>949</sub><br>plugins/surfcore/lib/pet-api.js <sub>230</sub> |
| 目的 · 桌宠载体 | 🟡 部分 | `pack.desktop-pet` | plugins/surfcore/lib/pet-purpose.js <sub>632</sub> |
| QQ 渠道 | 🟡 部分 | `pack.qq` | src/mcp-snowluma-safe.js <sub>1540</sub><br>src/snowluma-conn.js <sub>234</sub><br>src/allowlist.js <sub>85</sub><br>plugins/surfcore/lib/bridge.js <sub>274</sub><br>plugins/surfcore/lib/platforms.js <sub>165</sub><br>plugins/surfcore/lib/qq-mode.js <sub>3</sub> |
| 黑话学习 | 🟡 部分 | `kernel.lexicon` | src/slang-learner.js <sub>382</sub> |
| 语音 | 🟡 部分 | `kernel.voice` | src/voice-packs.js <sub>1295</sub><br>src/voice-pack-import.js <sub>496</sub><br>src/voice-core.js <sub>469</sub><br>src/voice-tts.js <sub>150</sub><br>src/voice-diagnostics.js <sub>68</sub><br>src/voice-pack-secrets.js <sub>19</sub><br>src/send-voice-lib.js <sub>30</sub><br>plugins/surfcore/lib/voice-health.js <sub>71</sub> |
| 不可复现（红线） | ⛔ 红线排除 | — | plugins/surfcore/lib/snowluma-install.js <sub>149</sub> |

### ✅ 对话收尾

**新架构对应**：`kernel.closure`
**说明**：收尾判定/结束点/下次接法/原因分类都在 kernel/closure，用现有 close 意图（不加新消息类型）。

**旧文件**：

| 文件 | 行数 | 它做什么 |
| --- | --- | --- |
| `src/conversation-closure.js` | 523 | 收尾判定、结束点、下次接法 |

**该域的能力**：收尾判定；结束点记录；下次接法；收尾原因分类

### ✅ 记忆 · 叙事

**新架构对应**：`kernel.memory`

**旧文件**：

| 文件 | 行数 | 它做什么 |
| --- | --- | --- |
| `src/memory-card.js` | 2296 | 叙事记忆卡：清晰度五档、衰减、全量卡、可见性策略（含渠道判断） |
| `plugins/surfcore/lib/memory-card.js` | 552 | 兼容层：对外暴露的旧接口 |
| `plugins/surfcore/lib/memory.js` | 523 | 兼容层：记忆读写门面 |

**该域的能力**：五档清晰度衰减；全量卡（只追加）；可见性策略（私聊/群/同圈/敏感/主人）；复习升档；主人重要记忆保底；记忆卡片写入/读取；兼容层接口

### ✅ 目的机制

**新架构对应**：`kernel.purpose`
**说明**：驱动向量/目标假设/观察账本/闭环/安静时段/每日额度/投递即占次数/话题多样性都已复现；权重是简化参数（可调），不是旧 2,302 行的逐行复刻。

**旧文件**：

| 文件 | 行数 | 它做什么 |
| --- | --- | --- |
| `src/purpose-engine.js` | 2302 | 主动搭话：驱动向量、目标假设、观察账本、闭环、安静时段、额度 |

**该域的能力**：驱动向量；目标假设（归属/置信/风险）；观察账本；闭环反馈；安静时段；每日额度；投递即占次数；话题多样性

### ✅ 表情包

**新架构对应**：`kernel.sticker`
**说明**：收藏/情绪/关键词/按情绪推荐/使用统计都在 kernel/sticker（新架构：库在内核，发送走 send_media）。

**旧文件**：

| 文件 | 行数 | 它做什么 |
| --- | --- | --- |
| `src/sticker-lib.js` | 356 | 表情库：收藏、标签、使用次数 |
| `src/sticker-semantics.js` | 562 | 表情语义：情绪分类、触发词 |

**该域的能力**：表情收藏；情绪分类；触发关键词；按情绪推荐；使用统计

### ✅ 联网工具

**新架构对应**：`pack.web`
**说明**：安全抓取（SSRF/DNS/重定向/限量）与通用搜索端点已复现；旧 MCP 暴露改为 web 小适配器的工具面（web_fetch/web_search），不新增层。

**旧文件**：

| 文件 | 行数 | 它做什么 |
| --- | --- | --- |
| `src/web-search.js` | 601 | 联网搜索 |
| `src/safe-fetch.js` | 385 | 安全抓取（防 SSRF） |
| `src/mcp-web-search-safe.js` | 92 | MCP 封装 |
| `src/mcp-host-server.js` | 93 | MCP 宿主 |

**该域的能力**：联网搜索；安全抓取；MCP 暴露

### 🟡 时机 · 注意力

**新架构对应**：`kernel.attention`
**说明**：判断逻辑已复现；'真正把多条消息合批成一轮'的执行还没做

**旧文件**：

| 文件 | 行数 | 它做什么 |
| --- | --- | --- |
| `src/wake-filter.js` | 125 | 唤醒过滤：值不值得醒 |
| `src/wake-policy.js` | 35 | 唤醒策略：优先级 |
| `src/wake-batch.js` | 58 | 唤醒合批：窗口内合并 |
| `src/fish-guard.js` | 286 | 鱼群保护：机器人密度过高闭嘴 |
| `src/group-policy.js` | 74 | 群分层：大群严格、小群积极 |
| `src/command-spam.js` | 9 | 刷屏短指令识别 |
| `src/turn-guard.js` | 112 | 轮次守卫：同人限次 |
| `src/qq-fish-guard.js` | 0 | （见 lib/qq-fish-guard.js） |
| `plugins/surfcore/lib/qq-fish-guard.js` | 85 | QQ 侧鱼群保护 |

**该域的能力**：唤醒过滤；优先级；合批窗口；鱼群密度；群分层；刷屏指令；轮次守卫

### 🟡 B站渠道

**新架构对应**：`pack.bilibili`
**说明**：额度/生物钟/选片/分享文本/分享卡/分享任务/动态增量/动态同步命令都已复现；触发由外部计划任务调用 `bili run` / `bili sync`（不在四段内）。评论·动态·名片的网络读接口已加；动态“发布”与 structmsg 卡片不做（旧结论：真机不可用）。

**旧文件**：

| 文件 | 行数 | 它做什么 |
| --- | --- | --- |
| `src/bili-api.js` | 150 | B站 API 调用 |
| `src/bili-dynamics.js` | 187 | 动态发布 |
| `src/bili-card.js` | 169 | 内容卡片 |
| `src/bili-share-scheduler.js` | 301 | 分享排程 |
| `plugins/surfcore/lib/bili-workspace.js` | 19 | 工作区 |

**该域的能力**：API 调用；动态发布；内容卡片；分享排程；工作区

### 🟡 桥接主程序

**新架构落位**：拆成 kernel/index.js（判断）+ runtime（管道）+ packs（收发）
**说明**：旧桥 17,801 行 0 export，不可能 1:1 复刻；新架构按职责拆开，故整体记 partial

**旧文件**：

| 文件 | 行数 | 它做什么 |
| --- | --- | --- |
| `src/bridge.js` | 17801 | 主循环：收消息→选模型→调模型→发消息→记账；所有渠道的入口都在这 |

**该域的能力**：渠道主循环；消息分流；提示词拼装（内联）；发送与重试（内联）；命令与工具分发；状态与配置加载

### 🟡 预算与计费

**新架构对应**：`kernel.support`
**说明**：记账/上限/价格折算/用量明细已复现；报表已到命令行（ledger：总量/按模型/峰谷/没算价），还差控制台可视化。

**旧文件**：

| 文件 | 行数 | 它做什么 |
| --- | --- | --- |
| `src/token-ledger.js` | 1193 | 账本：按类别记账、每日上限、明细 |
| `src/token-budget.js` | 464 | 预算：额度分配 |
| `src/token-guard.js` | 137 | 超支护栏 |
| `src/billing-report.js` | 541 | 账单报表 |
| `src/model-prices.js` | 290 | 模型价格表 |
| `src/model-options.js` | 100 | 模型选项 |
| `plugins/surfcore/lib/token-budget.js` | 786 | 兼容层：预算 |
| `plugins/surfcore/lib/token-usage-pure.js` | 134 | 纯函数：用量计算 |
| `plugins/surfcore/lib/billing.js` | 139 | 计费门面 |

**该域的能力**：按类别记账；每日上限；超支拒绝；模型价格折算；账单报表；用量明细

### 🟡 兼容与迁移

**新架构对应**：`tools.gate`
**说明**：旧 config.json → 新设置已做：白名单/QQ 连接/搜索端点，默认只预览、--apply 只写新状态、旧文件不动。旧接口门面（compat.js）不再需要；旧状态迁移未做。

**旧文件**：

| 文件 | 行数 | 它做什么 |
| --- | --- | --- |
| `plugins/surfcore/lib/compat.js` | 431 | 旧接口兼容 |
| `plugins/surfcore/lib/compat-rules.js` | 44 | 兼容规则 |
| `plugins/surfcore/lib/memory.js` | 523 | 记忆兼容门面 |

**该域的能力**：旧接口兼容；兼容规则；迁移工具

### 🟡 表达 · 输出形态

**新架构对应**：`pack.qq`
**说明**：CQ 转义/@ 已复现；合并转发、md 转纯文本、敏感词、模型视图未复现

**旧文件**：

| 文件 | 行数 | 它做什么 |
| --- | --- | --- |
| `src/forward.js` | 231 | 合并转发 |
| `src/md-to-plain.js` | 117 | Markdown 转纯文本 |
| `src/safe-text.js` | 74 | CQ 转义 |
| `src/sensitive.js` | 21 | 敏感词 |
| `src/qq-at.js` | 44 | @ 处理 |
| `src/callname.js` | 36 | 称呼解析 |
| `src/qq-model-view.js` | 80 | 模型看到的消息视图 |

**该域的能力**：合并转发；Markdown 转纯文本；CQ 转义；敏感词过滤；@ 处理；称呼解析；模型侧消息视图

### 🟡 记忆 · B站专属

**新架构对应**：`kernel.memory`
**说明**：新架构里**没有“渠道专属记忆”**：记忆只有一套，来源只是 from.adapter 的值。 旧 bili-memory.js 的三条可拆解为： ① B站内容记忆 → 包把内容变成事件（来源/标签/重要度），内核用同一套流水线记； ② 跨视频关联 → 属“检索/关联”，由记忆读取（关键词/向量）承担，不是渠道概念； ③ 渠道专属上下文 → 属包：包在事件里带说明/标签，内核不写死任何平台逻辑。 目前 ①③ 已具备（包 + 事件字段），② 的关键词命中已有、主题聚类没有 → partial。 【更新】② 跨视频关联 已由 kernel.memory 的“联想/主题簇”承担（associate.js）。

**旧文件**：

| 文件 | 行数 | 它做什么 |
| --- | --- | --- |
| `src/bili-memory.js` | 882 | B站专属记忆：视频、动态、评论的上下文 |

**该域的能力**：B站内容记忆；跨视频关联；渠道专属上下文

### 🟡 记忆 · 向量

**新架构对应**：`kernel.memory`
**说明**：双存储/检索已复现；真实 HTTP 嵌入已接（SURFCORE_EMBED_*，入库与检索共用一次向量）；嵌入包安装/选择（旧 embedding-packs 的目录管理）未做。

**旧文件**：

| 文件 | 行数 | 它做什么 |
| --- | --- | --- |
| `src/vector-memory.js` | 629 | 向量记忆：嵌入、检索、与叙事并行存储 |
| `plugins/surfcore/lib/vector-memory.js` | 538 | 兼容层：向量接口 |
| `src/embedding-packs.js` | 254 | 嵌入包：把文本转成向量（本地/云端） |
| `plugins/surfcore/lib/embedding-packs.js` | 697 | 嵌入包管理（选择/加载） |

**该域的能力**：向量存储（与叙事并行）；相似度检索；嵌入模型选择与加载；兼容层接口

### 🟡 模型接入

**新架构对应**：`kernel.expression`
**说明**：HTTP 端口已复现；DSH 专用客户端/遥测/结转/补历史未复现

**旧文件**：

| 文件 | 行数 | 它做什么 |
| --- | --- | --- |
| `src/dsh-client.js` | 1137 | 模型客户端：会话、重试、流式 |
| `src/dsh-port.js` | 101 | 端口发现 |
| `src/dsh-model-follow.js` | 71 | 跟随 DSH 选模型 |
| `src/dsh-health.js` | 50 | 健康检查 |
| `src/v2-wait.js` | 60 | 等待回复 |
| `src/gate-events.js` | 208 | 闸门事件 |
| `src/context-telemetry.js` | 245 | 上下文遥测 |
| `src/context-snapshot.js` | 145 | 上下文快照 |
| `src/session-rollover.js` | 136 | 回合结转 |
| `src/session-map.js` | 46 | 会话映射 |
| `src/history-catchup.js` | 144 | 历史补读 |

**该域的能力**：模型客户端；端口发现；模型跟随；健康检查；等待回复；上下文遥测；上下文快照；回合结转；历史补读

### 🟡 运维与外壳

**新架构对应**：`kernel.store`
**说明**：存储/审计/发件箱已复现（后者在 runtime）；控制台/更新器/定时器/隐私未复现

**旧文件**：

| 文件 | 行数 | 它做什么 |
| --- | --- | --- |
| `plugins/surfcore/lib/index.js` | 4514 | 控制台：180 个路由 |
| `plugins/surfcore/lib/client.js` | 8268 | 控制台前端脚本 |
| `plugins/surfcore/lib/updates.js` | 2020 | 更新器 |
| `plugins/surfcore/lib/scheduler.js` | 1373 | 定时器与日界任务 |
| `plugins/surfcore/lib/store.js` | 694 | 状态存储 |
| `plugins/surfcore/lib/extensions.js` | 287 | 扩展管理 |
| `plugins/surfcore/lib/privacy.js` | 218 | 隐私与脱敏 |
| `plugins/surfcore/lib/doctor.js` | 117 | 诊断 |
| `plugins/surfcore/lib/paths.js` | 111 | 路径解析 |
| `plugins/surfcore/lib/automation.js` | 160 | 自动化脚本 |
| `plugins/surfcore/lib/http-guard.js` | 87 | HTTP 护栏 |
| `plugins/surfcore/lib/compat.js` | 431 | 兼容层 |
| `plugins/surfcore/lib/compat-rules.js` | 44 | 兼容规则 |
| `src/self-test.js` | 118 | 自检 |
| `src/owner-audit.js` | 145 | 审计 |
| `src/greeting-schedule.js` | 119 | 问候排程 |
| `src/outbox.js` | 138 | 发件箱 |
| `src/action-planner.js` | 46 | 动作规划 |
| `src/question-answers.js` | 67 | 问答 |
| `src/share-mode.js` | 40 | 分享模式 |
| `src/node-path.js` | 41 | node 路径 |
| `src/config-stamps.js` | 26 | 配置戳 |
| `src/schema-values.js` | 22 | 配置校验 |
| `src/admin-identity.js` | 0 | （见上） |

**该域的能力**：控制台（180 路由）；前端脚本；更新器；定时器；状态存储；扩展管理；隐私脱敏；诊断；自检；审计；问候排程；发件箱

### 🟡 人格与身份

**新架构对应**：`kernel.support`
**说明**：分层与主人判定已复现；角色卡/对齐检查/人格分类未复现

**旧文件**：

| 文件 | 行数 | 它做什么 |
| --- | --- | --- |
| `src/character-persona.js` | 727 | 人格：核心设定、语气层、场景层 |
| `src/self-identity.js` | 188 | 自我认知：她怎么介绍自己 |
| `src/persona-layers.js` | 127 | 人格分层：核心/语气/场景 |
| `src/role-card.js` | 108 | 角色卡：结构化人设 |
| `src/preset-prompt.js` | 157 | 预设提示词 |
| `src/persona-identity.js` | 22 | 身份小工具 |
| `src/identity-guard.js` | 66 | 身份护栏：防越界 |
| `src/admin-identity.js` | 247 | 主人身份：判定、称呼 |
| `plugins/surfcore/lib/persona.js` | 47 | 人格门面 |
| `plugins/surfcore/lib/persona-classify.js` | 159 | 人格分类 |
| `plugins/surfcore/lib/characters.js` | 188 | 角色库 |
| `plugins/surfcore/lib/align.js` | 507 | 对齐：人格一致性检查 |

**该域的能力**：人格核心/语气/场景分层；自我认知；角色卡；预设提示词；主人判定与称呼；身份护栏；对齐检查

### 🟡 桌宠渠道

**新架构对应**：`pack.desktop-pet`
**说明**：气泡/专注/语音决策已复现；长轮询与 HTTP 接口未复现

**旧文件**：

| 文件 | 行数 | 它做什么 |
| --- | --- | --- |
| `plugins/surfcore/lib/pet.js` | 770 | 桌宠进程交互 |
| `plugins/surfcore/lib/pet-chat.js` | 949 | 桌宠聊天 |
| `plugins/surfcore/lib/pet-api.js` | 230 | 桌宠 HTTP 接口 |

**该域的能力**：长轮询；气泡；聊天；专注模式；语音

### 🟡 目的 · 桌宠载体

**新架构对应**：`pack.desktop-pet`
**说明**：包的逻辑已复现；内核侧的'载体选择'尚未实现

**旧文件**：

| 文件 | 行数 | 它做什么 |
| --- | --- | --- |
| `plugins/surfcore/lib/pet-purpose.js` | 632 | 桌宠主动搭话：载体互斥、气泡、语音 |

**该域的能力**：载体互斥；主动气泡；语音播报决策

### 🟡 QQ 渠道

**新架构对应**：`pack.qq`
**说明**：连接/解析/发送/媒体/白名单已复现；42 个旧工具对账：5 个 OneBot 动作 + 18 个桥接语义工具（含取消息图片/表情图）+ 12 个由 intent 取代 + 7 个明确缺口（详见 QQ-TOOL-MAP.md）。

**旧文件**：

| 文件 | 行数 | 它做什么 |
| --- | --- | --- |
| `src/mcp-snowluma-safe.js` | 1540 | 42 个渠道工具的 MCP 封装 |
| `src/snowluma-conn.js` | 234 | WS 连接与事件 |
| `src/allowlist.js` | 85 | 群/私聊白名单 |
| `plugins/surfcore/lib/bridge.js` | 274 | 桥接门面 |
| `plugins/surfcore/lib/platforms.js` | 165 | 平台注册表 |
| `plugins/surfcore/lib/qq-mode.js` | 3 | 模式开关 |

**该域的能力**：WS 连接；事件解析；42 个渠道工具；白名单；平台注册；发送

### 🟡 黑话学习

**新架构对应**：`kernel.lexicon`
**说明**：【新架构】候选收集/确认/容量/证据/渲染防注入 已进 kernel.lexicon（learn.js + index.js）；联网核实与控制器界面未做。

**旧文件**：

| 文件 | 行数 | 它做什么 |
| --- | --- | --- |
| `src/slang-learner.js` | 382 | 黑话/梗：候选提交、管理员确认、进入提示词 |

**该域的能力**：候选收集；管理员确认；黑话表查询；进提示词

### 🟡 语音

**新架构对应**：`kernel.voice`
**说明**：决策/分类/路由/闸门/语音库已复现；音频文件导入（扩展名/去重/上限）与 CLI 列表已加；语音包 manifest/时长探测/复制安装、真引擎驱动未做。

**旧文件**：

| 文件 | 行数 | 它做什么 |
| --- | --- | --- |
| `src/voice-packs.js` | 1295 | 语音包：角色、音色、库管理 |
| `src/voice-pack-import.js` | 496 | 语音包导入与校验 |
| `src/voice-core.js` | 469 | 语音核心：合成调用、路由 |
| `src/voice-tts.js` | 150 | TTS 合成 |
| `src/voice-diagnostics.js` | 68 | 失败分类与建议 |
| `src/voice-pack-secrets.js` | 19 | 云端凭据剥离 |
| `src/send-voice-lib.js` | 30 | 语音发送 |
| `plugins/surfcore/lib/voice-health.js` | 71 | 语音健康检查 |

**该域的能力**：语音包管理；导入与校验；本地/云端路由；TTS 合成；失败分类；凭据剥离；语音发送；健康检查

### ⛔ 不可复现（红线）

**说明**：EULA §5.4 / LICENSE §4：不得复制、不得程序化部署、不得随包分发。永久排除。

**旧文件**：

| 文件 | 行数 | 它做什么 |
| --- | --- | --- |
| `plugins/surfcore/lib/snowluma-install.js` | 149 | 第三方运行时安装/部署 |

**该域的能力**：第三方运行时安装；程序化部署/启停；catalog 快照

---

## 怎么用这份基线

```powershell
node tools/legacy-map.mjs            # 重新生成（映射错了会 exit 1）
node tools/capability-map.mjs        # 看新架构当前能力清单
```

对照方法：拿本文件"逐域对照"表，逐个域看新架构那份清单里的同一条能力是否 ✅；
发现对不上的，先改 `legacy-capability-map.json` 的 `mappedTo` 或 `capability-map.json` 的条目，再重跑。
