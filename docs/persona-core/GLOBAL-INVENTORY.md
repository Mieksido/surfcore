# 全局清单（逐文件 · 逐导出 · 契约 · 能力）

> **本文件由一次性审计脚本从代码生成**，不是手写回忆。
> 范围：`kernel/`、`runtime/`、`packs/` 的全部非测试代码 + `tools/` 开发设施。
> 用途：证明"每个实现、每条契约、每个能力"都有明确位置；新增代码后照此表补。

## 0. 总览

| 层 | 文件（非测试） | 行数 | 说明 |
| --- | --- | --- | --- |
| 内核 kernel/ | 62 | 7782 | 灵魂：判断/记忆/表达/目的/语音/识图 |
| 大适配器 runtime/ | 8 | 1005 | 冻结：只搬运/校验/盖章 |
| 小适配器 + 模块 packs/ | 30 | 4366 | QQ / B站 / 桌宠 / web |
| 开发设施 tools/ | 21 | 3204 | 四层之外：门禁/CLI/打包/hook |

**能力清单**：27 模块 / 236 条（✅230 / 🟡3 / ⬜3）。

## 1. 内核 kernel/

按秘密分块；每个导出都是一个可单测的实现。

| 文件 | 行数 | 导出的实现 |
| --- | --- | --- |
| `kernel/attention/batch.js` | 98 | `DEFAULT_BATCH`、`createBatcher` |
| `kernel/attention/index.js` | 93 | `REASON_PRIORITY`、`decideWake`、`batchReason`、`tierOf`、`isSpamCommand`、`fishDensity` |
| `kernel/attention/turn-guard.js` | 64 | `DEFAULT_TURN_GUARD`、`createTurnGuard` |
| `kernel/closure/index.js` | 94 | `DEFAULT_CLOSURE`、`createClosure` |
| `kernel/conversation/index.js` | 200 | `DEFAULT_WINDOW`、`createConversationWindow` |
| `kernel/conversation/summary.js` | 93 | `DEFAULT_SUMMARY`、`shouldSummarize`、`buildSummaryPrompt`、`normalizeSummary`、`mergeSummary`、`renderSummaryBlock` |
| `kernel/expression/context-budget.js` | 83 | `estimateTokens`、`trimToTokens`、`fitPrompt` |
| `kernel/expression/fallback.js` | 35 | `DEFAULT_FALLBACK`、`fallbackFor` |
| `kernel/expression/index.js` | 138 | `createExpression` |
| `kernel/expression/media-brief.js` | 32 | `mediaBriefOf` |
| `kernel/expression/model-http.js` | 126 | `createHttpModelPort` |
| `kernel/expression/model-port.js` | 70 | `validateModelPort`、`normalizeCompletion`、`createScriptedModel`、`textOfContent`、`createRuleModel` |
| `kernel/expression/prices.js` | 191 | `PRICE_TABLE_VERSION`、`CN_HOLIDAYS_2026`、`CN_HOLIDAYS_2027`、`CN_HOLIDAYS`、`DEFAULT_PRICE_TABLE`、`resolvePriceTable`、`beijingParts`、`isPeakAt`、`ratesAt`、`costOfBuckets`、`priceUsage`、`ledgerPrice`、`describePriceTable`、`billableTokens` |
| `kernel/expression/prompt.js` | 68 | `SILENT_MARKER`、`buildPrompt`、`toMessages` |
| `kernel/expression/tools.js` | 182 | `TOOLS`、`toolSchema`、`findTool`、`resolveToolCall`、`intentsFromCompletion` |
| `kernel/expression/vision.js` | 74 | `VISION_LIMITS`、`sniffImageMime`、`buildVisionParts` |
| `kernel/index.js` | 665 | `STATE_VERSION`、`createKernel` |
| `kernel/runtime.js` | 118 | `createKernelRuntime` |
| `kernel/lexicon/index.js` | 141 | `MAX_CANDIDATES`、`createLexicon` |
| `kernel/lexicon/learn.js` | 118 | `LEARN`、`escapeLearnerText`、`buildExtractionPrompt`、`parseExtraction`、`mergeEvidence` |
| `kernel/memory/associate.js` | 80 | `relatedTo`、`cluster` |
| `kernel/memory/capacity.js` | 69 | `DEFAULT_CAPACITY`、`isProtected`、`planEviction`、`capacityLevel` |
| `kernel/memory/dedupe.js` | 63 | `DEFAULT_DEDUPE`、`dedupeKey`、`findDuplicate` |
| `kernel/memory/identity.js` | 106 | `makeRecord`、`allowed` |
| `kernel/memory/index.js` | 376 | `READER_MODES`、`createMemoryKernel` |
| `kernel/memory/initial.js` | 80 | `DEFAULT_INITIAL`、`stableUnit`、`initialProbability`、`shouldMarkInitial`、`markFirstMeet` |
| `kernel/memory/media.js` | 134 | `fingerprint`、`createMediaStore` |
| `kernel/memory/narrative/decay-card.js` | 150 | `CLARITY_ORDER`、`DEFAULT_DECAY`、`targetClarity`、`applyDailyDecay`、`decayDaysBetween`、`needsDailyDecay`、`touch`、`createDecayCard` |
| `kernel/memory/narrative/full-card.js` | 111 | `createFullCard` |
| `kernel/memory/narrative/reader.js` | 85 | `SECTIONS`、`createNarrativeReader` |
| `kernel/memory/redact.js` | 45 | `REDACT_RULES`、`redactText`、`hasSensitive` |
| `kernel/memory/scoring.js` | 70 | `WEIGHTS`、`scoreMemory` |
| `kernel/memory/vector/embed.js` | 198 | `cosineSimilarity`、`normalizeVector`、`createHttpEmbeddingTransport`、`createEmbedder`、`createHashingEmbedder` |
| `kernel/memory/vector/store.js` | 251 | `tokenize`、`similarity`、`createVectorStore`、`createVectorReader` |
| `kernel/purpose/clock.js` | 14 | （无导出；入口/脚本） |
| `kernel/purpose/index.js` | 207 | `PURPOSE_NEEDS`、`DEFAULT_PURPOSE_CONFIG`、`TOPIC_REPEAT_MS`、`topicKey`、`createPurpose` |
| `kernel/purpose/materials.js` | 72 | `collectMaterials`、`topicOf` |
| `kernel/settings/index.js` | 164 | `SETTINGS_VERSION`、`validateField`、`coerceValue`、`buildSettingsModel`、`exportSettings`、`importSettings` |
| `kernel/settings/limits.js` | 99 | `KERNEL_IDENTITY`、`KERNEL_SETTINGS`、`limitsFromSettings` |
| `kernel/sticker/index.js` | 112 | `STICKER_EMOTIONS`、`createStickerBook` |
| `kernel/sticker/semantics.js` | 89 | `EMOTIONS`、`NEUTRAL`、`EMOTION_LABELS`、`normalizeEmotion`、`detectEmotions`、`emotionOf`、`neighborsOf`、`emotionScore` |
| `kernel/store/persist.js` | 124 | `createStore` |
| `kernel/support/index.js` | 117 | `createAudit`、`createBudget`、`createIdentity` |
| `kernel/support/ledger-report.js` | 97 | `buildLedgerReport`、`ledgerReportLines` |
| `kernel/support/ledger.js` | 258 | `TOKEN_BUCKET_KEYS`、`ZERO_BUCKETS`、`emptyBuckets`、`normalizeUsage`、`totalTokensOf`、`addBuckets`、`createTokenLedger` |
| `kernel/support/people.js` | 139 | `DEFAULT_ALIGN`、`createPeople` |
| `kernel/support/self-card.js` | 80 | `maskId`、`normalizeSelfCard`、`selfCardConfigured`、`PROVENANCE_RULES`、`buildSelfBrief` |
| `kernel/support/time.js` | 51 | `localDayKey`、`minutesOfDay`、`inQuietHours`、`quietEndAfter`、`inWindow` |
| `kernel/voice/engine.js` | 55 | `createVoiceEngine` |
| `kernel/voice/import.js` | 65 | `VOICE_AUDIO_EXTS`、`isVoiceAudioFile`、`voiceEntryFromFile`、`planVoiceImport` |
| `kernel/voice/artifact.js` | 66 | `MODEL_ARTIFACT_KIND`、`safeModelPath`、`normalizeModelManifest`、`verifyModelFiles` |
| `kernel/voice/providers.js` | 58 | `normalizeVoiceProvider`、`pickVoiceProvider` |
| `kernel/voice/provider-config.js` | 89 | `readVoiceProviders`、`upsertVoiceProvider`、`listVoiceProviders`、`resolveVoiceProvider` |
| `kernel/voice/model-runtime.js` | 188 | `createModelRuntime`、`normalizeModelRecord`、`readModelConfig` |
| `kernel/voice/models.js` | 106 | `createVoiceModels`（model 公共面） |
| `kernel/voice/model-store.js` | 57 | `inspectModelArtifact`、`importModelArtifact`、`sha256File` |
| `kernel/voice/index.js` | 74 | `classifyVoiceError`、`pickRoute`、`validateVoiceEntry`、`gateVoice` |
| `kernel/voice/library.js` | 118 | `DEFAULT_LIBRARY`、`normalizeVoice`、`createVoiceLibrary` |
| `kernel/voice/tts-http.js` | 52 | `DEFAULT_TTS_HTTP`、`createHttpVoiceTransport` |
| `kernel/voice/tts-voxd.js` | 73 | `DEFAULT_VOXD`、`createVoxdVoiceTransport` |
| `kernel/voice/wav.js` | 24 | `wavDurationMs` |
| `kernel/voice/tts.js` | 61 | `DEFAULT_SYNTH`、`buildSynthRequest`、`interpretSynthResponse` |

## 2. 大适配器 runtime/

【冻结】只做管道/宿主/组装/校验；不许认识平台或内核。

| 文件 | 行数 | 导出的实现 |
| --- | --- | --- |
| `runtime/allowlist.js` | 82 | `ALLOWLIST_SETTINGS`、`parseList`、`allowlistFromSettings`、`createAllowlist` |
| `runtime/compose.js` | 181 | `composeSystem` |
| `runtime/host.js` | 274 | `PACK_MANIFEST`、`PROTOCOL`、`validateManifest`、`discover`、`installFrom`、`uninstall`、`loadPack`、`createHostState`、`POLICY_FILE`、`ORIGIN_FILE`、`readPolicy`、`readOrigin`、`isVerified`、`enablePack`、`loadEnabled` |
| `runtime/index.js` | 187 | `CAPABILITY_AXES`、`validatePack`、`normalizeMedia`、`createAdapter` |
| `runtime/media-kit.js` | 19 | `MEDIA_LIMITS` |
| `runtime/outbox.js` | 75 | `DEFAULT_OUTBOX`、`createOutbox` |
| `runtime/pack-rules.mjs` | 108 | `PACK_RULES`、`scanPaths`、`scanDir`、`explain` |
| `runtime/ui.js` | 79 | `validateUi`、`collectUi` |

## 3. 开发设施 tools/

四层之外，不是层；可读四层，四层不许 import 它。

| 文件 | 行数 | 导出的实现 |
| --- | --- | --- |
| `tools/audit.mjs` | 183 | （无导出；入口/脚本） |
| `tools/capability-map.mjs` | 170 | （无导出；入口/脚本） |
| `tools/cli.mjs` | 1073 | （无导出；入口/脚本） |
| `tools/migrate-memory.mjs` | 162 | `eventOf`、`migrate`、`oldRecordsOf` |
| `tools/shadow-tap.mjs` | 155 | `tapOnce`、`tapWatch`、`shadowEventOf` |
| `tools/shadow-diff.mjs` | 92 | `diffShadow`、`readJsonl` |
| `tools/voice-control-server.mjs` | 190 | `createVoiceControlServer` |
| `tools/voice-api-router.mjs` | 124 | `createVoiceApiRouter` |
| `tools/core-check.mjs` | 68 | （无导出；入口/脚本） |
| `tools/core-manifest.mjs` | 54 | `ROOT`、`CORE_PATHS`、`EXTENSION_PATHS`、`DEV_PATHS`、`listCoreFiles`、`describeCore` |
| `tools/fitness.mjs` | 88 | （无导出；入口/脚本） |
| `tools/gateway.mjs` | 82 | `listZipEntries`、`hashFile`、`extractZip`、`writeProvenance`、`defaultGatewayDir` |
| `tools/install-hook.mjs` | 86 | （无导出；入口/脚本） |
| `tools/legacy-map.mjs` | 146 | （无导出；入口/脚本） |
| `tools/model.mjs` | 38 | `pickModel` |
| `tools/migrate.mjs` | 111 | `planMigration`、`formatMigrationPlan`、`applyMigration` |
| `tools/pack-build.mjs` | 84 | （无导出；入口/脚本） |
| `tools/pack-check.mjs` | 69 | （无导出；入口/脚本） |
| `tools/run-all.mjs` | 77 | （无导出；入口/脚本） |
| `tools/self-check.mjs` | 99 | （无导出；入口/脚本） |
| `tools/settings-cli.mjs` | 80 | `formatSettings`、`findField`、`setSetting`、`exportText`、`importText` |

## 4. 小适配器 + 模块 packs/

### packs/bilibili/

| 文件 | 行数 | 导出的实现 |
| --- | --- | --- |
| `packs/bilibili/api.js` | 103 | `explainBiliCode`、`createBiliClient` |
| `packs/bilibili/dynamics.js` | 114 | `parseDynamicItem`、`formatDynamicMessage`、`emptyDynamicState`、`planDynamicSync`、`pruneSeen` |
| `packs/bilibili/emitter.js` | 73 | `IMPORTANCE_HINT`、`toEvent`、`toEvents` |
| `packs/bilibili/index.js` | 115 | `identity`、`capabilities`、`settings`、`plan`、`open`、`send`、`health`、`close` |
| `packs/bilibili/job.js` | 159 | `SHARE_HISTORY_KEEP_MS`、`planShareJob`、`applyShareResult`、`cleanShareReply`、`runShareJob` |
| `packs/bilibili/logic.js` | 86 | `QUOTA_KINDS`、`createQuota`、`planNight`、`pickVideos` |
| `packs/bilibili/poller.js` | 141 | `DEFAULT_BILI_POLL`、`createBiliPoller` |
| `packs/bilibili/share.js` | 196 | `httpsifyImage`、`videoUrl`、`buildShareText`、`isShareable`、`SHARE_COOLDOWN_MS`、`cardFromRecord`、`pickShareCard`、`buildSharePrompt`、`CARD_MODES`、`normalizeCardMode`、`renderShare` |
| `packs/bilibili/slots.js` | 144 | `DEFAULT_SHARE_TIMES`、`SHARE_CATCH_UP_MS`、`SHARE_SLOT_KEEP_MS`、`normalizeShareTimes`、`shareSlotKey`、`nextShareSlot`、`lastShareSlot`、`pruneShareSlots`、`dueShareSlot`、`planShareSchedule` |
| `packs/bilibili/time.js` | 33 | `biliDayKey`、`biliInWindow` |

**契约**：`identity`、`capabilities`、`ui`、`settings`、`open`、`send`、`health`、`close`、`plan`

- settings：2 项
- ui：1 个菜单 / 1 个页面
- 工具声明：0 个
- pack.json：有

### packs/desktop-pet/

| 文件 | 行数 | 导出的实现 |
| --- | --- | --- |
| `packs/desktop-pet/api.js` | 155 | `PET_API_PREFIX`、`PET_HOST_FILE_VERSION`、`PET_API_ROUTES`、`isLoopbackAddress`、`isSameOrigin`、`safeTokenEqual`、`buildPetHostPayload`、`petAudioUrl`、`petApiGate`、`matchPetRoute`、`describePetApi` |
| `packs/desktop-pet/index.js` | 167 | `identity`、`capabilities`、`settings`、`createBubbles`、`gatePush`、`decideVoice`、`configure`、`setFocus`、`focusOn`、`open`、`push`、`send`、`health`、`close` |
| `packs/desktop-pet/poll.js` | 115 | `DEFAULT_POLL`、`createPoller` |

**契约**：`identity`、`capabilities`、`ui`、`settings`、`open`、`send`、`health`、`close`、`configure`、`push`

- settings：3 项
- ui：1 个菜单 / 1 个页面
- 工具声明：0 个
- pack.json：有

### packs/qq/

| 文件 | 行数 | 导出的实现 |
| --- | --- | --- |
| `packs/qq/bridge-tools.js` | 489 | `BRIDGE_API_PREFIX`、`QQ_BRIDGE_TOOLS`、`bridgeToolDeclarations`、`createBridgeTransport`、`createBridgeToolRunner`、`describeBridgeTools` |
| `packs/qq/forward.js` | 98 | `FORWARD`、`lineOfMessage`、`flattenForward`、`forwardBlockOf` |
| `packs/qq/gateway-import.js` | 61 | `importGateway` |
| `packs/qq/gateway.js` | 130 | `GATEWAY_PROFILES`、`detectGateway`、`inspectEntries`、`planGatewayImport`、`provenanceOf` |
| `packs/qq/group-info.js` | 81 | `DEFAULT_GROUP_INFO`、`createGroupInfo` |
| `packs/qq/index.js` | 342 | `identity`、`capabilities`、`ui`、`settings`、`configure`、`attach`、`open`、`send`、`runTool`、`toolDeclarations`、`health`、`close` |
| `packs/qq/media-download.js` | 69 | `DEFAULT_MEDIA`、`downloadMedia` |
| `packs/qq/onebot.js` | 217 | `ONEBOT_ACTION`、`parseSegments`、`normalizeEvent`、`normalizeNotice`、`createClient` |
| `packs/qq/receiver.js` | 152 | `DEFAULT_RECONNECT`、`createReceiver` |
| `packs/qq/history.js` | 103 | `rememberEvent`、`selectMissedHistory`、`historyMessageToEvent`、`createHistoryCatchup` |
| `packs/qq/text.js` | 88 | `escapeCq`、`unescapeCq`、`safeText`、`splitForSend`、`markdownToPlain` |
| `packs/qq/text.test.mjs` | — | 18 条断言（CQ/拆条/Markdown 清理） |
| `packs/qq/tools.js` | 115 | `QQ_TOOLS`、`createToolRunner` |

**契约**：`identity`、`capabilities`、`settings`、`ui`、`open`、`send`、`health`、`close`、`configure`、`attach`、`runTool`、`toolDeclarations`

- settings：10 项
- ui：1 个菜单 / 2 个页面
- 工具声明：11 个
- pack.json：有

### packs/web/

| 文件 | 行数 | 导出的实现 |
| --- | --- | --- |
| `packs/web/fetch.js` | 233 | `WebError`、`isPrivateIp`、`validateFetchUrl`、`resolveSafeAddresses`、`safeFetch` |
| `packs/web/index.js` | 141 | `identity`、`capabilities`、`settings`、`configure`、`open`、`send`、`health`、`close` |
| `packs/web/tools.js` | 142 | `mapSearchResults`、`createWebTools` |

**契约**：`identity`、`capabilities`、`settings`、`ui`、`open`、`send`、`health`、`close`、`configure`、`runTool`、`toolDeclarations`

- settings：3 项
- ui：1 个菜单 / 1 个页面
- 工具声明：2 个
- pack.json：有

## 5. 契约矩阵（小适配器）

| 包 | publisher | name | version | identity | capabilities | settings 数 | ui | open | send | health | close | 工具数 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| packs/bilibili | surfcore | bilibili | 0.1.0 | ✓ | ✓ | 2 | ✓ | ✓ | ✓ | ✓ | ✓ | 0 |
| packs/desktop-pet | surfcore | desktop-pet | 0.2.0 | ✓ | ✓ | 3 | ✓ | ✓ | ✓ | ✓ | ✓ | 0 |
| packs/qq | surfcore | qq | 0.3.0 | ✓ | ✓ | 10 | ✓ | ✓ | ✓ | ✓ | ✓ | 11 |
| packs/web | surfcore | web | 0.1.0 | ✓ | ✓ | 3 | ✓ | ✓ | ✓ | ✓ | ✓ | 2 |

## 6. 能力清单（按模块）

| 模块 | 路径 | 层 | 能力数 | ✅ | 🟡 | ⬜ | 它的位置 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `kernel.memory` | `kernel/memory/` | kernel | 27 | 27 | 0 | 0 | 记忆：两条线（叙事/向量）+ 两张卡（衰减/全量）+ 多模型索引 + 场合标签 + 媒体库 |
| `kernel.purpose` | `kernel/purpose/` | kernel | 6 | 6 | 0 | 0 | 目的：驱动向量、目标假设、观察账本、闭环反馈 |
| `kernel.attention` | `kernel/attention/` | kernel | 8 | 8 | 0 | 0 | 时机：唤醒分级、合批、群分层、鱼群、轮次守卫 |
| `kernel.closure` | `kernel/closure/` | kernel | 3 | 3 | 0 | 0 | 对话收尾：什么时候这段聊完了（道别/安静太久/聊太长） |
| `kernel.lexicon` | `kernel/lexicon/` | kernel | 10 | 9 | 0 | 1 | 黑话库：候选收集 → 确认 → 进提示词（未确认的不进） |
| `kernel.sticker` | `kernel/sticker/` | kernel | 7 | 7 | 0 | 0 | 表情库：她的收藏（只存 mediaId + 语义，不复制图片） |
| `kernel.conversation` | `kernel/conversation/` | kernel | 5 | 5 | 0 | 0 | 对话窗口：她还记得刚才聊了几句（按频道分桶，环形保留） |
| `kernel.expression` | `kernel/expression/` | kernel | 13 | 13 | 0 | 0 | 表达：提示词、模型端口、上下文预算、工具面 |
| `kernel.voice` | `kernel/voice/` | kernel | 24 | 23 | 1 | 0 | 语音决策/路由/闸门/库/失败分类/传输/provider/模型公共面/模型运行时 |
| `kernel.settings` | `kernel/settings/` | kernel | 8 | 7 | 0 | 1 | 设置：菜单→表单、值收敛、导出导入 |
| `kernel.store` | `kernel/store/` | kernel | 3 | 3 | 0 | 0 | 落盘：原子写、备份、健康检查、跨进程单写者锁 |
| `kernel.support` | `kernel/support/` | kernel | 14 | 13 | 1 | 0 | 支撑：审计、预算、身份 |
| `kernel.index` | `kernel/index.js` | kernel | 7 | 7 | 0 | 0 | 总装：入库→时机→记忆→表达→目的→意图；心跳；存读；语音/设置/AI标识闸门；补历史不唤醒 |
| `kernel.runtime` | `kernel/runtime.js` | kernel | 3 | 3 | 0 | 0 | 内核运行时：start/tick/向量积压/保存/stop（system 注入） |
| `runtime.pipeline` | `runtime/index.js` | runtime | 4 | 4 | 0 | 0 | 管道：槽位校验、盖章、幂等、能力门、回执包装、媒体验收 |
| `runtime.host` | `runtime/host.js` | runtime | 5 | 5 | 0 | 0 | 包宿主：发现、清单校验、安装（内容闸门）、来源留痕、政策、启用闸门、卸载 |
| `runtime.pack-rules` | `runtime/pack-rules.mjs` | runtime | 2 | 2 | 0 | 0 | 包内容规则：出站与入站共用的唯一真相 |
| `runtime.allowlist` | `runtime/allowlist.js` | runtime | 5 | 5 | 0 | 0 | 白名单：谁能跟她说话（部署策略，拦在门外） |
| `runtime.media-kit` | `runtime/media-kit.js` | runtime | 1 | 1 | 0 | 0 | 媒体限额：管道与包共用的唯一数字 |
| `runtime.outbox` | `runtime/outbox.js` | runtime | 3 | 3 | 0 | 0 | 发件箱：可重试退避、unconfirmed 不重试、同编号只投一次 |
| `pack.qq` | `packs/qq/` | packs | 26 | 25 | 1 | 0 | 平台包：QQ（OneBot v11 协议；网关用户自备，不随包分发；断线补群历史/输出纯文本） |
| `pack.bilibili` | `packs/bilibili/` | packs | 17 | 17 | 0 | 0 | 平台包：B站（异步渠道；cookie 用户自备） |
| `pack.desktop-pet` | `packs/desktop-pet/` | packs | 6 | 5 | 1 | 0 | 平台包：桌宠（本地进程；通道在仓库外） |
| `tools.gate` | `tools/` | dev | 10 | 10 | 0 | 0 | 开发设施（四层之外）：门禁 + 测试 + 体检 + 本体检查 + 出包 + hook + 旧配置迁移；可读四层，四层不许读它 |
| `runtime.ui` | `runtime/ui.js` | runtime | 3 | 2 | 0 | 1 | 模块界面声明：装包时把"这个包想长什么样"一起收进来（只收集/校验，不渲染） |
| `runtime.compose` | `runtime/compose.js` | runtime | 4 | 4 | 0 | 0 | 大适配器的组装：按接口把内核与小适配器接起来（不 import 内核，合批器由调用方注入） |
| `pack.web` | `packs/web/` | packs | 3 | 3 | 0 | 0 | 联网：安全抓取 + 可配搜索（小适配器 + 模块；不新增层） |

## 7. 审计结论

- 四层：内核 / 大适配器 / 小适配器 / 模块。`tools/` 是四层之外的开发设施，不是第五层。
- 每个 `packs/<name>/index.js` 都具备契约六件（identity/capabilities/settings/ui/open/send/health/close）；有的包额外有 configure/attach/push/plan/runTool/toolDeclarations。
- 全包契约由 `packs/contract.test.mjs` 每次门禁强制：清单与身份一致、六件齐全、settings/tool 名不重复。
- 每个模块的导出都在上表；未导出的内部函数是模块私有实现，不构成契约。能力清单为“模块 × 能力”的高层视图，逐函数细节以本表为准。
- 大适配器 `runtime/` 不在本文件里体现任何平台名；它的导入方向由 `tools/fitness.mjs` 每次门禁检查。

