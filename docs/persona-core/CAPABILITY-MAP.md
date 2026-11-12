# 能力清单（模块 × 位置 × 做没做）

> **本文件由 `tools/capability-map.mjs` 生成**，不要手改；改 `capability-map.json` 后重跑。
> 最后更新：2026-11-10　·　检查命令：`node tools/capability-map.mjs --check`

**合计**：27 个模块　·　能力 236 项 —— ✅ 已做 230　🟡 部分 3　⬜ 未做 3

> **证据等级**（顾问审阅要求）：`函数`=有实现有单测；`接线`=运行时真被调用；`落盘`=重启后还在；`真机`=对着真实平台/服务跑通过。没有标等级的条目，默认只到"函数"级——**别把 ✅ 当"已经保住"**。

## kernel/

### kernel.memory　`kernel/memory/`

**它是什么**：记忆：两条线（叙事/向量）+ 两张卡（衰减/全量）+ 媒体库

**它的位置**：依赖 shared；被 kernel.index、kernel.purpose 依赖；**不许依赖** runtime、packs

| 能力 | 状态 | 证据 / 出处 |
| --- | --- | --- |
| 入库三处写（全量卡/衰减卡/向量库） | ✅ | memory.test.mjs「双存储，不是投影」　<sub>落盘</sub> |
| 可见性政策（五条规则，不含渠道名） | ✅ | memory.test.mjs 15 条 |
| 衰减卡：五档清晰度、每天最多降一档、复习升档 | ✅ | kernel.test.mjs 衰减段 |
| 全量卡：入库即写、只追加、坏行跳过、尾部召回 | ✅ | archive.test.mjs　<sub>落盘</sub> |
| 向量线：独立存储 + 自己的读 | ✅ | memory.test.mjs　<sub>落盘</sub> |
| 媒体库：落盘/指纹去重/引用计数/保留期 | ✅ | kernel.test.mjs |
| 真实嵌入（HTTP /embeddings + 校验/归一/维度锁 + 本地假实现；入库与检索共用一次向量） | ✅ | embed.test.mjs + memory.test.mjs「向量线」+ kernel.test.mjs「真实嵌入」　<sub>接线</sub> |
| 入库流水线（判重→脱敏→评分→最初→三处写→容量淘汰） | ✅ | write-pipeline.test.mjs　<sub>落盘</sub> |
| ① 评分：内核信号 + 包给的渠道加分（0~100） | ✅ | write-pipeline.test.mjs　<sub>接线</sub> |
| ② 去重：平台编号 / 窗口内同人同文本（归一化） | ✅ | write-pipeline.test.mjs　<sub>接线</sub> |
| ③ 容量：600 上限 + 保护置顶/最初/重要主人 + 四档告警 | ✅ | write-pipeline.test.mjs　<sub>接线</sub> |
| ④「最初」：30 天窗口 + 四档概率 + 稳定散列 + 初遇置顶 | ✅ | write-pipeline.test.mjs　<sub>接线</sub> |
| ⑤ 脱敏：写入一次 + 渲染一次（正则表可改） | ✅ | write-pipeline.test.mjs　<sub>接线</sub> |
| ⑥ 分节渲染：节序 + 每节配额 + 模糊/想不起限长 | ✅ | write-pipeline.test.mjs　<sub>接线</sub> |
| 媒体入库（包下好的字节 → 媒体库 → 记录里只留编号） | ✅ | media-wiring.test.mjs　<sub>接线</sub> |
| 多来源记忆（来源只是 from.adapter 的值，同一套流水线与读取） | ✅ | write-pipeline.test.mjs + media-wiring.test.mjs　<sub>落盘</sub> |
| 联想（共有标签/2-gram，想起别的记录，不看来源平台） | ✅ | associate.test.mjs　<sub>接线</sub> |
| 主题簇（按标签聚，够大才给） | ✅ | associate.test.mjs　<sub>接线</sub> |
| 阈值可调且立即生效（configure；不用重启） | ✅ | limits.test.mjs　<sub>接线</sub> |
| 容量告警出口（80/90/满，只在档位变化时记一次） | ✅ | 实跑（tick.capacity=full）　<sub>接线</sub> |
| 媒体库按编号读回字节（识图/转写用；有读取上限，常驻不放大图） | ✅ | kernel.test.mjs 媒体库「读回字节」　<sub>接线</sub> |
| 记忆方式可切换（叙事/向量；只改读取，不停止两边写入） | ✅ | memory.test.mjs + limits.test.mjs　<sub>接线</sub> |
| 向量存储开关（关掉不摄取/不编码；叙事记忆不受影响） | ✅ | vector-index.test.mjs　<sub>接线</sub> |
| 多模型索引（每个 modelSpace 一套；换模型不污染旧索引） | ✅ | vector-index.test.mjs　<sub>接线</sub> |
| 向量待编码队列/编码/失败重试/重建（pending→ready/failed） | ✅ | vector-index.test.mjs　<sub>接线</sub> |
| 向量状态与记忆库检索（records/indexed/pending/failed；语义搜索） | ✅ | vector-index.test.mjs　<sub>接线</sub> |
| 记忆场合标签（public/private；只有和主人的私聊是 private） | ✅ | scene.test.mjs　<sub>接线</sub> |

### kernel.purpose　`kernel/purpose/`

**它是什么**：目的：驱动向量、目标假设、观察账本、闭环反馈

**它的位置**：依赖 shared、kernel.memory；被 kernel.index 依赖；**不许依赖** runtime、packs

| 能力 | 状态 | 证据 / 出处 |
| --- | --- | --- |
| 闸门：安静时段/每日上限/冷却/预算 | ✅ | kernel.test.mjs |
| 投递即占次数 | ✅ | kernel.test.mjs |
| 素材提炼（主人优先/情绪/约定/媒体加权） | ✅ | archive.test.mjs |
| 闭环反馈（回复改置信度） | ✅ | kernel.test.mjs |
| 完整的驱动权重与话题多样性 | ✅ | purpose.test.mjs　<sub>接线</sub> |
| 目的闭环（她主动说的，主人回应后置信度上调） | ✅ | attention-wiring.test.mjs　<sub>接线</sub> |

### kernel.attention　`kernel/attention/`

**它是什么**：时机：唤醒分级、合批、群分层、鱼群、轮次守卫

**它的位置**：依赖 shared；被 kernel.index 依赖；**不许依赖** runtime、packs

| 能力 | 状态 | 证据 / 出处 |
| --- | --- | --- |
| 唤醒分级（私聊/@/提问/点名/关键词/任意） | ✅ | kernel.test.mjs |
| 合批理由、群分层、鱼群密度、刷屏指令 | ✅ | kernel.test.mjs |
| 轮次守卫（按频道+人限次） | ✅ | turn-guard.test.mjs　<sub>接线</sub> |
| 合批机制（按频道攒窗口、到量/到点出批） | ✅ | batch.test.mjs　<sub>接线</sub> |
| 合批接进运行回路 | ✅ | app/compose（batching 选项 + 计时器 + flush） |
| 刷屏短指令过滤（#xxx 不入库不唤醒，中文也认） | ✅ | attention-wiring.test.mjs　<sub>接线</sub> |
| 群分层（人数来自事件；大群闲话不插嘴） | ✅ | attention-wiring.test.mjs　<sub>接线</sub> |
| 鱼群保护（按试图入库统计，判重不算没看见） | ✅ | attention-wiring.test.mjs　<sub>接线</sub> |

### kernel.closure　`kernel/closure/`

**它是什么**：对话收尾：什么时候这段聊完了（道别/安静太久/聊太长）

**它的位置**：依赖 shared；被 （无） 依赖；**不许依赖** runtime、packs

| 能力 | 状态 | 证据 / 出处 |
| --- | --- | --- |
| 收尾判定（明确道别 / 安静超时 / 轮次过多） | ✅ | closure.test.mjs |
| 收尾后重置（下一段重新算） | ✅ | closure.test.mjs　<sub>落盘</sub> |
| 自动提出收尾（判到就补 close 意图，不重复补） | ✅ | phase2.test.mjs　<sub>接线</sub> |

### kernel.lexicon　`kernel/lexicon/`

**它是什么**：黑话库：候选收集 → 确认 → 进提示词（未确认的不进）

**它的位置**：依赖 shared；被 kernel.index 依赖；**不许依赖** runtime、packs

| 能力 | 状态 | 证据 / 出处 |
| --- | --- | --- |
| 候选提交与去重计数 | ✅ | lexicon.test.mjs |
| 确认/拒绝（未确认的不进提示词） | ✅ | lexicon.test.mjs　<sub>落盘</sub> |
| 渲染进提示词【群里的词】 | ✅ | lexicon.test.mjs + prompt 接线　<sub>接线</sub> |
| 管理界面（候选审核） | ⬜ | —　<sub>5期</sub> |
| 候选入口（learn_word → 只进候选，确认前不进提示词） | ✅ | media-wiring.test.mjs　<sub>落盘</sub> |
| 提取提示词（限长/排除功能词/警告语料不可信） | ✅ | learn.test.mjs　<sub>接线</sub> |
| 解析容错（``` 包裹/前后废话/单对象/去重） | ✅ | learn.test.mjs　<sub>接线</sub> |
| 证据合并（去重/限长/只留最后 20 条） | ✅ | learn.test.mjs　<sub>接线</sub> |
| 渲染防注入（HTML 转义 + CQ 码拆解 + 按次数排） | ✅ | learn.test.mjs　<sub>接线</sub> |
| 容量裁剪（超限按出现次数保留） | ✅ | learn.test.mjs　<sub>接线</sub> |

### kernel.sticker　`kernel/sticker/`

**它是什么**：表情库：她的收藏（只存 mediaId + 语义，不复制图片）

**它的位置**：依赖 shared；被 （无） 依赖；**不许依赖** runtime、packs

| 能力 | 状态 | 证据 / 出处 |
| --- | --- | --- |
| 收藏/删除/去重 | ✅ | sticker.test.mjs　<sub>落盘</sub> |
| 挑选（情绪/标签硬筛 + 用得少的优先） | ✅ | sticker.test.mjs |
| 渲染成提示词摘要 | ✅ | sticker.test.mjs |
| 挑中后走 send_media 发出去（模型只给情绪） | ✅ | phase2.test.mjs　<sub>接线</sub> |
| 收藏入口（save_sticker → 编号校验 → 入库） | ✅ | media-wiring.test.mjs　<sub>落盘</sub> |
| 情绪语义表（18 类 + 词表 + 邻近关系；说法不同也能认） | ✅ | semantics.test.mjs　<sub>接线</sub> |
| 从原话推断情绪再挑（没给情绪也不瞎挑） | ✅ | semantics.test.mjs　<sub>接线</sub> |

### kernel.conversation　`kernel/conversation/`

**它是什么**：对话窗口：她还记得刚才聊了几句（按频道分桶，环形保留）

**它的位置**：依赖 shared；被 kernel.index 依赖；**不许依赖** runtime、packs

| 能力 | 状态 | 证据 / 出处 |
| --- | --- | --- |
| 记用户轮 / 记她自己的轮 | ✅ | conversation.test.mjs　<sub>落盘</sub> |
| 按频道分桶（不串台） | ✅ | conversation.test.mjs |
| 上限挤旧 + 字数预算（从最新往回取） | ✅ | conversation.test.mjs |
| 渲染成提示词的一段【刚才】 | ✅ | expression.test.mjs + conversation.test.mjs |
| 长期对话摘要（窗口挤出的旧轮次先 pending 不丢；攒够一批调模型压缩；失败保留原文） | ✅ | summary.test.mjs + conversation.test.mjs + kernel.test.mjs「对话摘要」　<sub>接线</sub> |

### kernel.expression　`kernel/expression/`

**它是什么**：表达：提示词、模型端口、上下文预算、工具面

**它的位置**：依赖 shared；被 kernel.index 依赖；**不许依赖** runtime、packs

| 能力 | 状态 | 证据 / 出处 |
| --- | --- | --- |
| 提示词组装（人格+记忆+现场，不含渠道名） | ✅ | expression.test.mjs |
| 模型端口（剧本/规则/HTTP 三种实现） | ✅ | model-http.test.mjs |
| 上下文预算（人格不剪→剪记忆→剪正文） | ✅ | context-budget.test.mjs |
| 工具面（say/send_media/send_sticker/remember/close/stay_silent） | ✅ | tools.test.mjs + tool-loop.test.mjs |
| 媒体理解：把对方发来的图片/语音写成一句话 | ✅ | phase2.test.mjs　<sub>接线</sub> |
| 多轮对话历史（真正的上下文窗口） | ✅ | conversation.test.mjs |
| 模型失败后的降级话术（临时故障说一句 / 永久故障沉默） | ✅ | expression.test.mjs + kernel.test.mjs 模型失败段　<sub>接线</sub> |
| 工具往返（读类工具：调工具→回灌→继续） | ✅ | tool-loop.test.mjs　<sub>接线</sub> |
| 媒体摘要带编号（模型能指名道姓地引用） | ✅ | media-wiring.test.mjs　<sub>接线</sub> |
| 价目表（峰谷/节假日/未知模型兜底/覆盖合并） | ✅ | prices.test.mjs　<sub>接线</sub> |
| 模型用量回报（供应商 usage 归一后交账本；没报就不编） | ✅ | model-http.test.mjs + expression.test.mjs　<sub>接线</sub> |
| 识图（当前消息里的图片 → 模型内容段；最多 2 张/5MB；读不到/太大/格式不认会跳过并审计） | ✅ | vision.test.mjs + kernel.test.mjs「识图」　<sub>接线</sub> |
| 工具结果图片 → 模型内容段（tool 消息只留文字；图片另起 user 消息；坏图 dropped） | ✅ | expression.test.mjs「工具取回图片」+ vision.test.mjs　<sub>接线</sub> |

### kernel.voice　`kernel/voice/`

**它是什么**：语音决策：用不用、走哪条路由、闸门、库校验、失败分类

**它的位置**：依赖 shared；被 kernel.index 依赖；**不许依赖** runtime、packs

| 能力 | 状态 | 证据 / 出处 |
| --- | --- | --- |
| 失败分类 + 下一步建议 | ✅ | voice.test.mjs |
| 本地/云端路由（支持 strict 不降级） | ✅ | voice.test.mjs |
| 库条目校验（防路径穿越/坏文件/超长） | ✅ | voice.test.mjs |
| 三闸门（开关/长度/频率） | ✅ | voice.test.mjs |
| 合成请求/判读（与厂商无关，不含引擎） | ✅ | tts.test.mjs |
| 引擎端口（注入 transport；拿不到音频退回文字） | ✅ | engine.test.mjs |
| 语音消息落成媒体意图（say → send_media audio） | ✅ | engine.test.mjs |
| 接真引擎（本地模型 + 服务商模型真机） | ✅ | VOICE-REAL-PROBE.md　<sub>接线</sub> |
| HTTP 传输（真服务只差地址；不含厂商逻辑） | ✅ | tts-http.test.mjs　<sub>接线</sub> |
| 语音库（注册/删除/按情绪标签挑/统计/持久化） | ✅ | library.test.mjs　<sub>落盘</sub> |
| 导入校验（名字/时长/标签限长，脏值整条丢掉） | ✅ | library.test.mjs　<sub>接线</sub> |
| 模型工件 manifest 校验（model/version/voice/weights/path/sha256） | ✅ | artifact.test.mjs　<sub>接线</sub> |
| 模型工件导入（校验后复制；默认拒绝覆盖） | ✅ | model-store.test.mjs　<sub>接线</sub> |
| 语音 provider 公开档案（local/cloud、endpoint、Key 掩码、configured） | ✅ | providers.test.mjs　<sub>接线</sub> |
| 语音 provider 选择（active / kind 偏好 / 可用性） | ✅ | providers.test.mjs　<sub>接线</sub> |
| 模型运行时装载/卸载/状态（中性 runtime） | ✅ | model-runtime.test.mjs　<sub>接线</sub> |
| provider 配置持久化（0600；更新不清旧 Key） | ✅ | provider-config.test.mjs　<sub>接线</sub> |
| 语音模型公共面（modelId/kind/voiceId/state；不暴露 dir/port/start/stop） | ✅ | models.test.mjs　<sub>接线</sub> |
| 选择当前模型（active；selectModel） | ✅ | model-runtime.test.mjs　<sub>接线</sub> |
| 模型工件→load→子进程 runtime→合成→卸载（真实子进程） | ✅ | model-runtime.integration.test.mjs　<sub>接线</sub> |
| 导入后可选删除源 zip（失败不回滚 import） | ✅ | models.test.mjs　<sub>接线</sub> |
| 旧模型 runtime 推导（local 8765 / cloud 8767；推不出失败） | ✅ | model-store.test.mjs　<sub>接线</sub> |
| 解释器 runtime entry 自动补入 args | ✅ | model-runtime.integration.test.mjs　<sub>接线</sub> |
| 大 zip 用 target 同盘临时目录 + 解压前空间预检 | ✅ | VOICE-LEGACY-ZIP-PROBE.md　<sub>接线</sub> |
| 模型目录重定位（校验 manifest/哈希，更新 artifactDir + runtime，兼容 voice-local/local 别名） | ✅ | models.test.mjs　<sub>接线</sub> |
| 服务商 AppID/AccessKey/Resource/复刻 ID 配置与掩码 | ✅ | providers.test.mjs + provider-config.test.mjs　<sub>接线</sub> |
| 服务商配置写入 config.toml / voice.json | ✅ | provider-config.test.mjs + models.test.mjs　<sub>接线</sub> |
| 本地/云端语音启动不弹黑框（hidden Python + preStart） | ✅ | model-store.test.mjs + VOICE-LEGACY-ZIP-PROBE.md　<sub>接线</sub> |
| 通用 HTTP TTS 传输（endpoint/path/bodyTemplate；不认厂商） | ✅ | tts-http.test.mjs　<sub>接线</sub> |
| 通用模型 manifest（files/runtime/path/bodyTemplate；无旧包格式） | ✅ | artifact.test.mjs　<sub>接线</sub> |
| 导入必须声明 runtime，不再按目录猜 | ✅ | model-store.test.mjs　<sub>接线</sub> |

### kernel.settings　`kernel/settings/`

**它是什么**：设置：菜单→表单、值收敛、导出导入

**它的位置**：依赖 shared；被 kernel.index、app 依赖；**不许依赖** runtime、packs

| 能力 | 状态 | 证据 / 出处 |
| --- | --- | --- |
| 声明校验（缺代价说明不算合格） | ✅ | settings.test.mjs |
| 值收敛（越界拒绝，不偷偷改默认） | ✅ | settings.test.mjs |
| 导出/导入 + 版本校验 | ✅ | settings.test.mjs |
| 文本型设置项（type:text + maxChars） | ✅ | tts.test.mjs |
| 菜单界面 | ⬜ | 属 UI 层，由 DSH 宿主渲染 model() |
| 内核阈值声明（上限/去重窗口/最初窗口，选项型） | ✅ | limits.test.mjs　<sub>接线</sub> |
| 读盘后阈值立即恢复（不用重启） | ✅ | settings-cli.test.mjs　<sub>落盘</sub> |
| 记忆方式/向量参数设置（mode/开关/modelSpace/批量/注入上限） | ✅ | limits.test.mjs　<sub>接线</sub> |

### kernel.store　`kernel/store/`

**它是什么**：落盘：原子写、备份、健康检查、跨进程单写者锁

**它的位置**：依赖 （无）；被 kernel.index、kernel.memory 依赖；**不许依赖** runtime、packs

| 能力 | 状态 | 证据 / 出处 |
| --- | --- | --- |
| 原子写 + .bak | ✅ | expression.test.mjs |
| 读坏降级（recovered 文件，不动原文件） | ✅ | tools.test.mjs |
| 跨进程单写者锁（wx + pid + 陈旧锁回收） | ✅ | wiring.test.mjs |

### kernel.support　`kernel/support/`

**它是什么**：支撑：审计、预算、身份

**它的位置**：依赖 shared；被 kernel.index 依赖；**不许依赖** runtime、packs

| 能力 | 状态 | 证据 / 出处 |
| --- | --- | --- |
| 审计（只追加） | ✅ | kernel.test.mjs |
| 预算（按已发生成本记，超了拒绝） | ✅ | kernel.test.mjs　<sub>落盘</sub> |
| 身份（主人/称呼/公开版字数限制） | ✅ | kernel.test.mjs |
| 完整计费账本（按模型价格折算） | ✅ | ledger.test.mjs + kernel.test.mjs「用量进账本」　<sub>接线</sub> |
| 日界 / 分钟解析 / 跨午夜安静时段 / 时间窗 | ✅ | voice.test.mjs |
| 谁是谁：跨平台身份对齐（候选需批准，只存账号映射与昵称） | ✅ | people.test.mjs　<sub>落盘</sub> |
| 身份对齐的隐私口径（只给昵称，不暴露对方账号） | ✅ | people.test.mjs　<sub>接线</sub> |
| 我是谁：身份锚点（账号打码、全号不进提示词） | ✅ | self-card.test.mjs　<sub>接线</sub> |
| 来源判断（看载体：转发/聊天记录不是别处内容） | ✅ | self-card.test.mjs　<sub>接线</sub> |
| 身份块注入提示词（没配置就不注入空话） | ✅ | self-card.test.mjs　<sub>接线</sub> |
| 账本幂等（会话/回合/步骤/重试；后到覆盖先到，相等不覆盖） | ✅ | ledger.test.mjs　<sub>接线</sub> |
| 外部用量上报（桌宠/脚本自己报；没报就没有） | 🟡 | 接口与汇总已实现并有单测；还没有调用方接进来 |
| 账本随内核落盘/读盘（重启不归零） | ✅ | persistence.test.mjs（重启后 ledger 仍在）　<sub>落盘</sub> |
| 账单报表（总量/按模型/峰谷/没算价/估算；只读） | ✅ | ledger-report.test.mjs + tools/cli.mjs ledger　<sub>接线</sub> |

### kernel.index　`kernel/index.js`

**它是什么**：总装：入库→时机→记忆→表达→目的→意图；心跳；存读；语音/设置/AI标识闸门

**它的位置**：依赖 shared、kernel.*；被 app 依赖；**不许依赖** runtime、packs

| 能力 | 状态 | 证据 / 出处 |
| --- | --- | --- |
| handle/respond/tick/save/load | ✅ | kernel.test.mjs + wiring.test.mjs　<sub>接线</sub> |
| 语音闸门与降级（可见） | ✅ | wiring.test.mjs |
| 媒体编号→路径（包不认识媒体库） | ✅ | wiring.test.mjs |
| AI 标识（事实在内核） | ✅ | wiring.test.mjs |
| 轮次守卫接线 | ✅ | turn-guard.test.mjs |
| remember / close 由内核自己处理（不发给包） | ✅ | tool-loop.test.mjs + phase2.test.mjs　<sub>落盘</sub> |
| silent 事件只入记忆、不唤醒、不推进收尾/轮次 | ✅ | kernel/silent-wake.test.mjs　<sub>接线</sub> |

### kernel.runtime　`kernel/runtime.js`

**它是什么**：内核运行时：start / tick / 向量积压 / 保存 / stop；system 由组装点注入，不认识平台

**它的位置**：依赖 shared；被 app 依赖；**不许依赖** runtime、packs

| 能力 | 状态 | 证据 / 出处 |
| --- | --- | --- |
| 内核运行时生命周期（start/tick/flushVectors/save/stop；system 注入） | ✅ | runtime.test.mjs　<sub>接线</sub> |
| 定时保存与向量积压编码（定时器可注入；失败可观测） | ✅ | runtime.test.mjs　<sub>接线</sub> |
| 运行时状态（started/uptime/mode/records/vector） | ✅ | runtime.test.mjs　<sub>接线</sub> |

## runtime/

### runtime.pipeline　`runtime/index.js`

**它是什么**：管道：槽位校验、盖章、幂等、能力门、回执包装、媒体验收

**它的位置**：依赖 shared；被 app、runtime.host 依赖；**不许依赖** kernel、packs

| 能力 | 状态 | 证据 / 出处 |
| --- | --- | --- |
| validatePack（四块 + send 必填） | ✅ | runtime.test.mjs |
| 来源盖章（包不能冒充） | ✅ | runtime.test.mjs |
| 幂等 / 能力门 / 回执包装 / 异常兜底 | ✅ | runtime.test.mjs |
| 媒体验收（数量与体积） | ✅ | runtime.test.mjs |

### runtime.host　`runtime/host.js`

**它是什么**：包宿主：发现、清单校验、安装（内容闸门）、来源留痕、政策、启用闸门、卸载

**它的位置**：依赖 runtime.pack-rules；被 app 依赖；**不许依赖** kernel、packs

| 能力 | 状态 | 证据 / 出处 |
| --- | --- | --- |
| 清单校验 + 与代码自洽（防冒充） | ✅ | host.test.mjs |
| 安装内容闸门（二进制/依赖/第三方运行时） | ✅ | host.test.mjs |
| _origin.json 来源留痕（sha256） | ✅ | host.test.mjs |
| 政策 + 未背书要 ack（fail-closed） | ✅ | host.test.mjs |
| 卸载隔离（_removed，可恢复） | ✅ | host.test.mjs |

### runtime.pack-rules　`runtime/pack-rules.mjs`

**它是什么**：包内容规则：出站与入站共用的唯一真相

**它的位置**：依赖 （无）；被 runtime.host、tools.pack-check、tools.pack-build 依赖；**不许依赖** kernel、packs

| 能力 | 状态 | 证据 / 出处 |
| --- | --- | --- |
| 6 条规则（二进制/依赖/第三方/锁/凭据/git） | ✅ | host.test.mjs |
| 按路径判定 + 按目录扫描 | ✅ | host.test.mjs |

### runtime.allowlist　`runtime/allowlist.js`

**它是什么**：白名单：谁能跟她说话（部署策略，拦在门外）

**它的位置**：依赖 （无）；被 app.compose 依赖；**不许依赖** kernel、packs

| 能力 | 状态 | 证据 / 出处 |
| --- | --- | --- |
| 群/私聊名单匹配（两种写法都认） | ✅ | allowlist.test.mjs |
| fail-closed（没配就一律不放行） | ✅ | allowlist.test.mjs |
| 主人永远放行 | ✅ | allowlist.test.mjs |
| 接进组装层（拦在门外） | ✅ | app/compose（allowlist 选项） |
| 进设置页（文本型名单 + 全放行开关） | ✅ | tts.test.mjs + app 接线 |

### runtime.media-kit　`runtime/media-kit.js`

**它是什么**：媒体限额：管道与包共用的唯一数字

**它的位置**：依赖 （无）；被 runtime.pipeline 依赖；**不许依赖** kernel、packs

| 能力 | 状态 | 证据 / 出处 |
| --- | --- | --- |
| 数量/体积/帧数/文字稿上限 | ✅ | runtime.test.mjs |

### runtime.outbox　`runtime/outbox.js`

**它是什么**：发件箱：可重试退避、unconfirmed 不重试、同编号只投一次

**它的位置**：依赖 （无）；被 app 依赖；**不许依赖** kernel、packs

| 能力 | 状态 | 证据 / 出处 |
| --- | --- | --- |
| retryable 才重试 + 指数退避 | ✅ | outbox.test.mjs |
| unconfirmed 永不重试 | ✅ | outbox.test.mjs |
| 同编号幂等兜底 | ✅ | outbox.test.mjs |

### runtime.ui　`runtime/ui.js`

**它是什么**：模块界面声明：装包时把"这个包想长什么样"一起收进来（只收集/校验，不渲染）

**它的位置**：依赖 （无）；被 app 依赖；**不许依赖** kernel、packs

| 能力 | 状态 | 证据 / 出处 |
| --- | --- | --- |
| 校验 UI 声明（坏声明整段丢弃并说明原因） | ✅ | ui.test.mjs　<sub>接线</sub> |
| 收集各包 UI（按 order 排、按包分组） | ✅ | ui.test.mjs　<sub>接线</sub> |
| 真正渲染（需要 UI 宿主） | ⬜ | —　<sub>5期</sub> |

### runtime.compose　`runtime/compose.js`

**它是什么**：大适配器的组装：按接口把内核与小适配器接起来（不 import 内核，合批器由调用方注入）

**它的位置**：依赖 （无）；被 tools 依赖；**不许依赖** kernel、packs

| 能力 | 状态 | 证据 / 出处 |
| --- | --- | --- |
| 组装（内核 + 多个小适配器） | ✅ | compose.test.mjs　<sub>接线</sub> |
| 合批接线（合批器注入，不 import 内核） | ✅ | compose.test.mjs　<sub>接线</sub> |
| 停机前冲批次（flush） | ✅ | compose.test.mjs　<sub>接线</sub> |
| 白名单在门外拦（可选注入） | ✅ | compose.test.mjs　<sub>接线</sub> |

## packs/

### pack.qq　`packs/qq/`

**它是什么**：平台包：QQ（OneBot v11 协议；网关用户自备，不随包分发）

**它的位置**：依赖 shared；被 app 依赖；**不许依赖** kernel

| 能力 | 状态 | 证据 / 出处 |
| --- | --- | --- |
| 收：WS 连接/心跳看门狗/指数退避重连 | ✅ | receiver.test.mjs |
| 收：消息段解析（文本/图/语音/视频/@/引用/表情） | ✅ | qq.test.mjs |
| 收：notice 拍一拍→事件（不加新字段） | ✅ | qq.test.mjs |
| 收：畸形帧守卫 / 自发回声忽略 | ✅ | receiver.test.mjs |
| 发：拆条 + CQ 转义 + 引用 | ✅ | qq.test.mjs |
| 发：媒体（图片/语音） | ✅ | qq.test.mjs |
| 发：AI 标识可见化 | ✅ | qq.test.mjs |
| 渠道工具层（22 个 OneBot 动作：只读/写/管理分级，默认只开只读） | ✅ | tools.test.mjs　<sub>接线</sub> |
| act 意图接线（内核只说要做一件事，包翻译成调用） | ✅ | qq.test.mjs + tools.test.mjs |
| 写/管理开关进设置页（默认关） | ✅ | qq.test.mjs（act 段） |
| 42 工具对账（5 OneBot + 18 桥接 + 12 由 intent 取代 + 7 个明确缺口） | 🟡 | — |
| 媒体下载（渠道侧下字节，上限/超时/失败可见） | ✅ | media-download.test.mjs　<sub>接线</sub> |
| 网关画像（SnowLuma / NapCat / Lagrange；认不出不瞎猜） | ✅ | gateway-import.test.mjs　<sub>接线</sub> |
| 导入计划（zip slip 检查、去掉顶层目录、写明"导入≠启动"） | ✅ | gateway-import.test.mjs　<sub>接线</sub> |
| 导入执行（解压/哈希/来源由调用方注入，可单独测） | ✅ | gateway-import.test.mjs　<sub>真机</sub> |
| UI 声明（菜单 QQ + 页面"导入网关"） | ✅ | ui.test.mjs + 实跑 ui　<sub>接线</sub> |
| 连接参数进设置（ws/http/token/主人号，文本型） | ✅ | settings.test.mjs　<sub>接线</sub> |
| 主人识别（ownerId 来自设置；不填就分不清） | ✅ | settings.test.mjs + app 接线　<sub>接线</sub> |
| 群规模（缓存 10 分钟 / 并发合并 / 失败返回 0） | ✅ | group-info.test.mjs　<sub>接线</sub> |
| 把群人数塞进事件 to.memberCount（内核才判得了大群） | ✅ | qq.test.mjs + group-info.test.mjs　<sub>接线</sub> |
| 合并转发（收）：拍平成文本（媒体占位、取不到如实标注） | ✅ | forward.test.mjs　<sub>接线</sub> |
| 桥接语义工具（16 个；读写分级，写默认关；key 由频道自动补） | ✅ | bridge-tools.test.mjs + qq.test.mjs「桥接语义工具」段　<sub>接线</sub> |
| 群历史（OneBot get_group_msg_history，可选 messageSeq） | ✅ | tools.test.mjs　<sub>接线</sub> |
| 按消息/表情 id 取图（base64 → 字节；坏图进 dropped，不假装成功） | ✅ | bridge-tools.test.mjs「图片工具」+ expression.test.mjs　<sub>接线</sub> |
| 断线补历史（重连拉群历史；silent=true；只入记忆不唤醒） | ✅ | history.test.mjs + kernel/silent-wake.test.mjs　<sub>接线</sub> |
| 输出纯文本（Markdown 清理：标题/加粗/斜体/代码/链接/引用） | ✅ | text.test.mjs　<sub>接线</sub> |

### pack.bilibili　`packs/bilibili/`

**它是什么**：平台包：B站（异步渠道；cookie 用户自备）

**它的位置**：依赖 shared；被 app 依赖；**不许依赖** kernel

| 能力 | 状态 | 证据 / 出处 |
| --- | --- | --- |
| 四本额度账 | ✅ | bilibili.test.mjs |
| 生物钟（窗口内醒 + 随机跳过） | ✅ | bilibili.test.mjs |
| 选片（去重优先/偏好加权） | ✅ | bilibili.test.mjs |
| plan() 合成一次计划 | ✅ | bilibili.test.mjs |
| 网络层（视频信息/发评论/登录态检查；cookie 用户自备） | ✅ | api.test.mjs |
| 网络错误分类与下一步（登录失效/风控/评论关闭） | ✅ | api.test.mjs |
| 网络层（评论/动态/名片读接口） | ✅ | api.test.mjs + tools/cli.mjs bili sync　<sub>接线</sub> |
| 内容→统一事件（来源/标签/重要度，平台信息进 tags） | ✅ | emitter.test.mjs　<sub>接线</sub> |
| 轮询接事件流（去重/退避/单次上限） | ✅ | poller.test.mjs　<sub>接线</sub> |
| 分享文本（标题+链接纯文本，不依赖卡片渲染） | ✅ | share.test.mjs　<sub>接线</sub> |
| 分享范围 off/text/miniapp（旧值兼容：card:false、cardMode:link） | ✅ | share.test.mjs　<sub>接线</sub> |
| 分享槽位（一天固定点/同点只跑一次/错过 10 分钟补跑；接进 plan()） | ✅ | slots.test.mjs + bilibili.test.mjs「分享槽位接进 plan()」　<sub>接线</sub> |
| 动态解析/排版/增量计划（首次只建基线；只推新的；已见上限） | ✅ | dynamics.test.mjs + tools/cli.mjs bili sync　<sub>接线</sub> |
| 分享槽位命令（bili due/--mark；可被外部计划任务定时调用） | ✅ | slots.test.mjs + tools/cli.mjs bili due　<sub>接线</sub> |
| 分享卡选择（tags 还原标题/链接；6 天冷却；重要度优先；槽位轮换） | ✅ | share.test.mjs + job.test.mjs　<sub>接线</sub> |
| 分享任务（到点→选卡→提示词→模型→发群；逐群失败可见，成功才记状态） | ✅ | job.test.mjs + tools/cli.mjs bili run　<sub>接线</sub> |
| 动态同步命令（首次基线/只推新的/入库；一次一拉，定时交给外部） | ✅ | dynamics.test.mjs + tools/cli.mjs bili sync　<sub>接线</sub> |

### pack.desktop-pet　`packs/desktop-pet/`

**它是什么**：平台包：桌宠（本地进程；通道在仓库外）

**它的位置**：依赖 shared；被 app 依赖；**不许依赖** kernel

| 能力 | 状态 | 证据 / 出处 |
| --- | --- | --- |
| 气泡队列（TTL + 上限） | ✅ | pet.test.mjs |
| 专注门（硬停/载体互斥） | ✅ | pet.test.mjs |
| 语音三条件决策 | ✅ | pet.test.mjs |
| 长轮询（注入 transport + 退避 + 去重 + 不抛不崩） | ✅ | poll.test.mjs |
| 桌宠 API 形状（11 条路由 + 回环/同源/JSON/令牌闸门） | 🟡 | 形状与闸门已实现；HTTP 服务器在壳（仓库外），还没接 |
| 语音音频跨适配器（send_media 的 audio 路径 → 带音频气泡） | ✅ | pet.test.mjs「语音：跨大适配器送到桌宠」　<sub>接线</sub> |

### pack.web　`packs/web/`

**它是什么**：联网：安全抓取 + 可配搜索（小适配器 + 模块；不新增层）

**它的位置**：依赖 shared；被 app 依赖；**不许依赖** kernel

| 能力 | 状态 | 证据 / 出处 |
| --- | --- | --- |
| 安全抓取（http/https、禁内网/环回/私有 IP、DNS 全量检查、手动重定向、限量/超时） | ✅ | fetch.test.mjs　<sub>接线</sub> |
| 联网搜索（端点/密钥由设置或环境给；没配明确报错） | ✅ | web.test.mjs + pack.test.mjs　<sub>接线</sub> |
| 工具面 web_fetch/web_search（小适配器 toolDeclarations/runTool） | ✅ | web.test.mjs + pack.test.mjs　<sub>接线</sub> |

## dev（四层之外 · 开发设施，不是一层）

### tools.gate　`tools/`

**它是什么**：开发设施（四层之外）：门禁 + 测试 + 体检 + 本体检查 + 出包 + hook；可读四层，四层不许读它

**它的位置**：依赖 （无）；被 （无） 依赖；**不许依赖** （无限制）

| 能力 | 状态 | 证据 / 出处 |
| --- | --- | --- |
| run-all：一条命令跑全部门禁 | ✅ | 实跑 |
| fitness：渠道名/依赖方向/每层有测试 | ✅ | 实跑 |
| audit：编码/占位符/日志/重复导出/import/死导出/加载/静默测试 | ✅ | 实跑 |
| core-check + core-manifest：本体边界 | ✅ | 实跑 |
| pack-check / pack-build：出站闸门与出包 | ✅ | 实跑 |
| install-hook：进提交流程 | ✅ | 实跑（hook 拦过一次） |
| capability-map：能力清单对账 | ✅ | 本文件由它渲染 |
| self-check：一条命令看清能不能跑（环境/本体/包/内核/状态/门禁） | ✅ | 实跑（exit 0） |
| 全包契约体检（每个小适配器的六件、清单一致、设置/工具名不重复） | ✅ | packs/contract.test.mjs　<sub>接线</sub> |
| 旧配置迁移（只读预览；--apply 只写新设置，旧文件不动） | ✅ | migrate.test.mjs + tools/cli.mjs migrate　<sub>接线</sub> |
| 记忆事件源灌注（QQ 收件箱/B站 entries，幂等） | ✅ | memory-ingest.test.mjs　<sub>接线</sub> |
| 记忆状态提升（shadow→正式，拒绝覆盖） | ✅ | cutover-memory.test.mjs　<sub>接线</sub> |

---

## 判据（怎么算"放对位置"）

| 这件事是… | 就放在… |
| --- | --- |
| 关于"她"的判断（记不记、说不说、用不用语音） | 内核 |
| 关于"怎么运"的机械动作（重试、脱敏、限流、装包） | 运行时 |
| 关于"那个平台"的规矩（消息段、审批、限速） | 平台包 |
| 界面 / 更新 / 诊断 | 本体外（app、tools） |
