/**
 * 内核总装：把记忆 / 目的 / 注意力 / 表达 / 预算 / 审计 / 身份接成一条线
 * ============================================================================
 * 一次反应（决策 A：**只在她做出行为前读记忆**）：
 *
 *   ① 入库（永远发生）
 *   ② 判断要不要行动（注意力层）
 *   ③ 读记忆（用当前激活的读取器）
 *   ④ 表达层：拼提示词 → 模型 → 变成意图（含"她选择不说"）
 *   ⑤ 顺手看看目的机制要不要说话
 *
 * 铁律：本文件不认识任何渠道（法则 11）；不联网、不做 IO（store 是注入的）。
 */
import { createMemoryKernel } from './memory/index.js';
import { createMediaStore } from './memory/media.js';
import { createPurpose } from './purpose/index.js';
import { decideWake, isSpamCommand, tierOf, fishDensity } from './attention/index.js';
import { createTurnGuard } from './attention/turn-guard.js';
import { createConversationWindow } from './conversation/index.js';
import { DEFAULT_SUMMARY, buildSummaryPrompt, normalizeSummary } from './conversation/summary.js';
import { createClosure } from './closure/index.js';
import { createLexicon } from './lexicon/index.js';
import { createStickerBook } from './sticker/index.js';
import { createPeople } from './support/people.js';
import { createVoiceLibrary } from './voice/library.js';
import { createAudit, createBudget, createIdentity } from './support/index.js';
import { createTokenLedger } from './support/ledger.js';
import { ledgerPrice, resolvePriceTable } from './expression/prices.js';
import { buildSelfBrief } from './support/self-card.js';
import { createExpression } from './expression/index.js';
import { mediaBriefOf } from './expression/media-brief.js';
import { buildVisionParts } from './expression/vision.js';
import { fallbackFor } from './expression/fallback.js';
import { createStore } from './store/persist.js';
import { collectMaterials } from './purpose/materials.js';
import { gateVoice } from './voice/index.js';
import { buildSettingsModel, exportSettings, importSettings } from './settings/index.js';
import { KERNEL_IDENTITY, KERNEL_SETTINGS, limitsFromSettings } from './settings/limits.js';
import path from 'node:path';

export { REASON_PRIORITY, isSpamCommand, tierOf, fishDensity } from './attention/index.js';
export { PURPOSE_NEEDS } from './purpose/index.js';
export { createExpression } from './expression/index.js';

export const STATE_VERSION = 1;

/**
 * @param {object} opts
 *   { mode, mediaDir, purposeConfig, budgetLimits, persona, admin, adminName,
 *     now, model（模型端口）, stateDir（给了就落盘）, store（也可直接注入） }
 */
export function createKernel(opts = {}) {
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  if (opts.embedder && typeof opts.embedder.embed !== 'function') {
    throw new Error('embedder 必须实现 embed(texts)（不许把半成品塞进内核）');
  }
  const store = opts.store ?? (opts.stateDir ? createStore({ dir: opts.stateDir, now }) : null);

  const memory = createMemoryKernel({
    mode: opts.mode === 'vector' ? 'vector' : 'narrative',
    now,
    fullCardStore: store,          // 全量卡（叙事记忆里的另一张卡）落盘到 state/
    vector: {
      enabled: opts.vector?.enabled !== false,
      modelSpace: opts.vector?.modelSpace ?? opts.vectorSpace ?? 'default',
      batchSize: opts.vector?.batchSize,
      maxChars: opts.vector?.maxChars,
    },
  });
  const media = createMediaStore({
    dir: opts.mediaDir ?? (opts.stateDir ? path.join(opts.stateDir, 'media') : null),
    now,
  });
  const purpose = createPurpose({ config: opts.purposeConfig ?? {}, now });
  const audit = createAudit({ now });
  const budget = createBudget({ limits: opts.budgetLimits ?? {}, now });
  /* 账本：token 是事实，钱是"事实 × 价目表"。价目表由组装层给，账本不认识任何模型 */
  const pricing = resolvePriceTable(opts.pricing);
  const ledger = createTokenLedger({ now, price: ledgerPrice(pricing) });
  let usageTurn = 0;                    // 表达层每 respond 一次算一"回合"，账本按它幂等
  let summaryTurn = 0;                  // 摘要调用也进账本（不能白花钱）
  const summaryCfg = { ...DEFAULT_SUMMARY, ...(opts.summary ?? {}) };   // 摘要策略（可关/可调）
  const identity = createIdentity({ persona: opts.persona ?? {}, admin: opts.admin ?? null, adminName: opts.adminName });
  const expression = opts.model ? createExpression({
    model: opts.model,
    identity,
    maxTokens: opts.maxTokens,
    reserveForOutput: opts.reserveForOutput,
    extraTools: opts.extraTools ?? [],
    onUsage: ({ usage, step, turn }) => ledger.ingest({
      sessionId: opts.sessionId ?? 'kernel',
      turn,
      step,
      model: opts.modelName ?? 'unknown',
      at: now(),
      usage,
    }),
    execute: opts.toolExecutor && typeof opts.toolExecutor.run === 'function'
      ? (name, args, ctx) => opts.toolExecutor.run(name, args, ctx)
      : null,
  }) : null;
  const turnGuard = createTurnGuard({ ...(opts.turnGuard ?? {}), now });
  const conversation = createConversationWindow({ ...(opts.conversation ?? {}), now });
  const closure = createClosure({ ...(opts.closure ?? {}), now });
  const lexicon = createLexicon({ ...(opts.lexicon ?? {}), now });
  const stickers = createStickerBook({ ...(opts.stickers ?? {}), now });
  const people = createPeople({ ...(opts.people ?? {}), now });
  const voices = createVoiceLibrary({ ...(opts.voices ?? {}), now });

  /* ── AI 标识：**事实由内核给，形式归平台包** ─────────────────────────
   * 内核只说"这是 AI 生成的"，具体怎么呈现（前缀/角标/提示音/元数据）由包决定。
   * 默认开：标识是合规义务，不是可选项；要关必须显式 enabled:false 并留审计。
   */
  const aiCfg = { enabled: true, label: 'AI 生成', ...(opts.aiLabeling ?? {}) };
  if (aiCfg.enabled === false) audit.record({ kind: 'compliance.ai-label-disabled', reason: opts.aiLabeling?.reason ?? '显式关闭' });

  /* ── 语音：决策归内核（这次用不用 / 闸门），传输归平台包 ─────────── */
  const voiceCfg = {
    enabled: false, available: false, maxChars: 120, perHour: 10,
    ...(opts.voice ?? {}),
  };
  const voiceUsage = [];   // 最近一小时用过的时刻（频率闸门）
  const voiceEngine = opts.voiceEngine ?? null;   // 引擎由组装层注入；没有就只走文字
  let lastPurposeGoalId = null;                   // 她最近主动说过的目的（等主人回应来闭环）
  let lastCapacity = 'ok';                        // 上次的容量档位（只在变化时告警）
  let lastEmbeddingError = null;                  // 嵌入失败去重（同一种错只记一次审计）
  function voiceGate(intent) {
    const recent = voiceUsage.filter((t) => now() - t < 3600000).length;
    const g = gateVoice({
      enabled: voiceCfg.enabled,
      chars: String(intent.text ?? '').length,
      maxChars: voiceCfg.maxChars,
      recentCount: recent,
      perHour: voiceCfg.perHour,
    });
    if (g.ok) { voiceUsage.push(now()); return { ok: true }; }
    return g;
  }

  /* ── 设置：只接收"声明"（不透明数据），内核不认平台名 ───────────── */
  const packDeclarations = Array.isArray(opts.packs) ? opts.packs : [];
  const settingsValues = { ...(opts.settingsValues ?? {}) };

  /* ── 内核自己的可调阈值（设置页改的就是这几个） ──────────────────── */
  const KERNEL_SETTINGS_ID = `${KERNEL_IDENTITY.publisher}/${KERNEL_IDENTITY.name}`;
  const KERNEL_DEFAULTS = Object.fromEntries(KERNEL_SETTINGS.map((f) => [f.key, f.defaultValue]));
  function applyKernelSettings() {
    const explicit = settingsValues[KERNEL_SETTINGS_ID] ?? {};
    const merged = { ...KERNEL_DEFAULTS, ...explicit };
    const limits = memory.configure(limitsFromSettings(merged));
    // 没显式设置 mode 时，尊重 createKernel({mode})；否则设置页/状态文件优先
    const mode = explicit['memory.mode'] ?? (opts.mode === 'vector' ? 'vector' : 'narrative');
    memory.setMode(mode);
    memory.configureVector({
      enabled: explicit['memory.vector.enabled'] !== undefined ? explicit['memory.vector.enabled'] !== false : memory.vectorConfig().enabled,
      modelSpace: explicit['memory.vector.modelSpace'] || memory.vectorConfig().modelSpace || 'default',
      batchSize: explicit['memory.vector.batchSize'] ?? memory.vectorConfig().batchSize,
      maxChars: explicit['memory.vector.maxChars'] ?? memory.vectorConfig().maxChars,
    });
    return { ...limits, mode: memory.mode, vector: memory.vectorConfig() };
  }
  applyKernelSettings();

  /* 「我是谁」锚点：只在她自己配了账号/名字时才注入 */
  const selfBrief = buildSelfBrief({ personaName: opts.persona?.name ?? identity.name ?? '', accounts: opts.selfAccounts ?? {} });

  /* ── ①～③ 事件处理 ─────────────────────────────────────────────── */
  function handle(event = {}, viewer = {}, ingestCtx = {}) {
    const text = String(event.text ?? '');
    const from = event.from ?? {};

    // 群刷屏短指令（#xxx）：不是找她的，**不入库也不叫醒**（旧 command-spam 的语义）
    if (isSpamCommand(text) && viewer.isOwner !== true && event.mentioned !== true) {
      audit.record({ kind: 'attention.spam-command', channel: from.channel, text: text.slice(0, 24) });
      return { wake: false, reason: 'spam-command', memoryBlock: null, intents: [], record: null };
    }

    // 媒体：包下好的字节先收进媒体库，事件里只留"编号 + 说明"（内核之外只认编号）
    const mediaRefs = (Array.isArray(event.media) ? event.media : []).map((m) => {
      if (!m?.bytes) return m;
      const item = media.put({ kind: m.kind ?? 'file', bytes: m.bytes, caption: m.caption ?? '', transcript: m.transcript ?? '' });
      return { id: item.id, kind: item.kind, caption: m.caption ?? '', transcript: m.transcript ?? '' };
    });

    const record = memory.ingest({
      text,
      media: mediaRefs,
      source: event.source ?? 'user',
      tags: event.tags ?? [],
      importance: event.importance ?? 8,
      from: { adapter: from.adapter, channel: from.channel, kind: from.kind, actor: from.actor, at: from.at },
      to: event.to ?? {},
    }, { vector: ingestCtx.vector });
    audit.record({ kind: 'event.ingested', channel: from.channel, actor: from.actor, text: text.slice(0, 60) });
    // 通用“静默”事件：只入记忆，不唤醒、不推进收尾/轮次。
    // 这是事件内容字段（silent），不是某个渠道/某种消息种类。
    if (event.silent === true) {
      return { wake: false, reason: 'silent', memoryBlock: null, intents: [], record };
    }
    // 收尾状态按"每条消息"推进（之前一次都没调过，turns 永远 0）
    closure.touch(from.channel, from.at);

    // 鱼群保护：一小群号在刷屏时她闭嘴（先于普通判定：它更强，理由要单独可见）
    const swarm = fishDensity(memory.actorStats({ windowMs: 10 * 60 * 1000, now: from.at }));
    if (swarm.blocked && viewer.isOwner !== true && event.mentioned !== true) {
      audit.record({ kind: 'attention.swarm', density: swarm.density, fish: swarm.fishAccounts, channel: from.channel });
      return { wake: false, reason: 'swarm', memoryBlock: null, intents: [], record, swarm };
    }

    const decision = decideWake({
      kind: from.kind === 'private' ? 'private' : 'group',
      text,
      isOwner: viewer.isOwner === true,
      mentioned: event.mentioned === true,
      calledName: event.calledName === true,
      question: /[?？]/.test(text),
      keyword: event.keyword === true,
      activeMode: viewer.activeMode === true,
      // 群有多大由包在事件里给（内核不数人）；没给就按小群算
      tier: tierOf({ memberCount: Number(event.to?.memberCount) || 0 }),
    });
    if (!decision.wake) return { wake: false, reason: decision.reason, memoryBlock: null, intents: [], record };

    // 目的闭环：主人说话了 → 上一条"她主动说的"算有回应（置信度上调）
    if (viewer.isOwner === true && lastPurposeGoalId) {
      const closed = purpose.applyOutcome({ goalId: lastPurposeGoalId, replied: true });
      if (closed) audit.record({ kind: 'purpose.confirmed', goalId: lastPurposeGoalId, confidence: closed.confidence });
      lastPurposeGoalId = null;
    }

    // 轮次守卫：同一个频道里的同一个人刷得太密，这轮不接（入库已经发生，不会丢）
    const guardKey = `${from.channel ?? ''}|${from.actor ?? ''}`;
    const turn = turnGuard.check({ actor: guardKey, now: from.at });
    if (!turn.allow) {
      audit.record({ kind: 'turn.suppressed', reason: turn.reason, channel: from.channel, actor: from.actor, count: turn.count });
      return { wake: false, reason: turn.reason, memoryBlock: null, intents: [], record };
    }

    const block = memory.read(viewer, {
      maxChars: viewer.maxMemoryChars ?? 1200,
      text,
      ...(Array.isArray(ingestCtx.vector) ? { vector: ingestCtx.vector } : {}),
    });
    // 复习：按关键词命中**旧记录**（最多 5 条），刚进来的这条不算
    const reviewed = memory.review({ text, viewer, exclude: record, max: 5 });
    if (reviewed) audit.record({ kind: 'memory.reviewed', count: reviewed });

    // 联想：想起别的什么事（同一套可见性；不看来源平台）
    const related = memory.recall({ text, tags: record.tags ?? [], viewer, exclude: record, max: 3 });
    let memoryBlock = block;
    if (related.length) {
      audit.record({ kind: 'memory.recalled', count: related.length, via: related[0].via });
      memoryBlock = {
        ...block,
        text: [block.text ?? '', '\n【联想到】', ...related.map((x) => `- ${String(x.record.text ?? '').slice(0, 60)}`)].join('\n').trim(),
      };
    }
    audit.record({ kind: 'memory.read', mode: block.mode, refs: block.refs.length });

    return { wake: true, reason: decision.reason, memoryBlock, intents: [], record, priority: decision.priority, related: related.length };
  }

  /* ── 对话摘要：窗口挤出去的旧轮次，攒够一批压成一段 ─────────────── */
  async function summarizeChannel(channel = '') {
    if (!summaryCfg.enabled || !opts.model || typeof opts.model.complete !== 'function') return null;
    const plan = conversation.compaction(channel, summaryCfg);
    if (!plan.should) return null;

    const prompt = buildSummaryPrompt({
      previous: conversation.summaryOf(channel),
      turns: plan.turns,
      maxChars: summaryCfg.maxChars,
    });
    let out;
    try {
      out = await opts.model.complete({
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
      });
    } catch (error) {
      audit.record({ kind: 'summary.failed', code: 'summary.exception', message: String(error?.message ?? error).slice(0, 120) });
      return null;
    }
    if (out?.error) {
      audit.record({ kind: 'summary.failed', code: out.error.code ?? 'summary.model', message: String(out.error.message ?? '').slice(0, 120) });
      return null;
    }
    const text = normalizeSummary(out?.text, { maxChars: summaryCfg.maxChars });
    if (!text) {
      audit.record({ kind: 'summary.failed', code: 'summary.empty', message: '模型没有产出可用摘要；原文保留' });
      return null;
    }

    conversation.applySummary(channel, { text, count: plan.count, maxChars: summaryCfg.maxChars });
    audit.record({ kind: 'summary.updated', turns: plan.count, chars: text.length });
    if (out?.usage) {
      ledger.ingest({
        sessionId: `${opts.sessionId ?? 'kernel'}:summary`,
        turn: ++summaryTurn,
        step: 1,
        model: opts.modelName ?? 'unknown',
        at: now(),
        usage: out.usage,
      });
    }
    return text;
  }

  /* ── ④ 表达 + ⑤ 目的 ───────────────────────────────────────────── */
  async function flushVectors({ limit, modelSpace } = {}) {
    if (!opts.embedder) {
      return { ok: false, encoded: 0, failed: 0, error: { code: 'embed.no-port', message: '没有注入 embedder' } };
    }
    return memory.encodePending({
      embed: (texts) => opts.embedder.embed(texts),
      limit: Number(limit) > 0 ? Number(limit) : memory.vectorConfig().batchSize,
      modelSpace,
    });
  }

  async function respond(event = {}, viewer = {}) {
    /* 真实嵌入：在入库/读记忆之前算一次，入库与检索用同一个向量。
     * 嵌入失败不挡对话：继续走关键词近似，但审计里必须看得见。 */
    let ingestCtx = {};
    const text = String(event?.text ?? '').trim();
    if (opts.embedder && text) {
      try {
        const emb = await opts.embedder.embed([text]);
        if (emb?.ok && Array.isArray(emb.vectors?.[0]) && emb.vectors[0].length) {
          ingestCtx = { vector: emb.vectors[0] };
          lastEmbeddingError = null;
        } else {
          const code = emb?.error?.code ?? 'embed.unknown';
          if (code !== lastEmbeddingError) audit.record({ kind: 'embedding.failed', code, hint: emb?.error?.hint ?? null });
          lastEmbeddingError = code;
        }
      } catch (error) {
        const code = 'embed.exception';
        if (code !== lastEmbeddingError) audit.record({ kind: 'embedding.failed', code, hint: String(error?.message ?? error) });
        lastEmbeddingError = code;
      }
    }

    // 向量模式：先把积压的旧记忆补编码一批，再读；失败不挡这一轮
    if (memory.mode === 'vector' && opts.embedder && (memory.vectorStatus().pending > 0 || memory.vectorStatus().failed > 0)) {
      try {
        const flushed = await flushVectors();
        if (!flushed.ok && flushed.error?.code !== lastEmbeddingError) {
          audit.record({ kind: 'embedding.failed', code: flushed.error?.code ?? 'embed.batch-failed', hint: flushed.error?.hint ?? null });
          lastEmbeddingError = flushed.error?.code ?? 'embed.batch-failed';
        }
      } catch (error) {
        audit.record({ kind: 'embedding.failed', code: 'embed.flush-exception', hint: String(error?.message ?? error) });
      }
    }

    const base = handle(event, viewer, ingestCtx);
    if (!base.wake) return base;

    const intents = [];

    // ④ 表达层（有模型才说话；没有模型时只回记忆块，便于单独测试内核）
    if (expression) {
      const channel = String(event?.from?.channel ?? '');
      // 把"这一条"记进对话窗口，再把"刚才的几轮"交给表达层
      conversation.append({ channel, role: 'user', actor: event?.from?.actor ?? null, text: event?.text ?? '', at: event?.from?.at });
      // 窗口挤出去的旧轮次攒够一批 → 摘要；失败保留原文，不挡这一轮说话
      await summarizeChannel(channel);
      const history = conversation.render(channel);
      // 黑话：只把她"学会并且被确认过"的词放进提示词
      const glossary = lexicon.render();
      // 识图：把这条消息里的图片变成模型能看的内容段；读不到/太大/格式不认 → 丢掉并留审计
      const vision = buildVisionParts(base.record?.media ?? [], {
        readBytes: (id) => media.readBytes(id),
      });
      if (vision.dropped.length) audit.record({ kind: 'vision.skipped', items: vision.dropped });

      const out = await expression.respond({
        event, viewer, memoryBlock: base.memoryBlock, history, glossary, selfBrief,
        mediaBrief: mediaBriefOf({ media: base.record?.media ?? [] }),
        images: vision.parts,
        turn: ++usageTurn,
      });

      // 记账：按已发生的用量记（之前一次都没调过，额度永远 0）
      if (out.usage?.tokens) {
        const spent = budget.commit('model', out.usage.tokens);
        const left = budget.canSpend('total', 0);
        if (!left.ok) audit.record({ kind: 'budget.exceeded', scope: left.scope, spent: left.spent, limit: left.limit });
        if (out.usage.trimmed && (out.usage.trimmed.memory || out.usage.trimmed.user)) {
          audit.record({ kind: 'context.trimmed', tokens: spent.spent, trimmed: out.usage.trimmed });
        }
      }

      // 模型失败：临时故障说一句人话，永久故障不说话（都不假装成功）
      if (out.modelError) {
        const fb = fallbackFor(out.modelError, opts.fallback ?? {});
        out.intents = fb.kind === 'say'
          ? [{ kind: 'say', text: fb.text, fallback: true }]
          : [{ kind: 'stay_silent', reason: fb.reason }];
        audit.record({ kind: 'model.fallback', code: out.modelError.code, reason: fb.reason });
      }

      // 她说出去的话也进窗口（下一轮她能看见"自己刚说过什么"）
      for (const intent of out.intents) {
        if (intent.kind === 'say' && intent.text) {
          conversation.append({ channel, role: 'her', text: intent.text, at: event?.from?.at });
        }
      }

      // 收尾：判到该收了，就补一条 close 意图（用现有意图，不新增类型）
      const turn = closure.shouldClose({ channel, text: event?.text ?? '', at: event?.from?.at });
      if (turn.close && !out.intents.some((i) => i.kind === 'close')) {
        out.intents.push({ kind: 'close', reason: turn.reason, summary: '', nextOpening: '' });
        closure.closed(channel, event?.from?.at);
        audit.record({ kind: 'closure.proposed', reason: turn.reason, hint: turn.hint });
      }

      for (const intent of out.intents) {
        // 「收藏这张表情」：只认媒体库里的编号，收下就进表情库（不复制图片）
        if (intent.kind === 'collect_sticker') {
          const ref = intent.mediaId ? media.refFor(intent.mediaId) : null;
          if (!ref) {
            audit.record({ kind: 'sticker.collect-failed', mediaId: intent.mediaId ?? null });
            continue;
          }
          const saved = stickers.add({ id: ref.id, mediaId: ref.id, emotion: intent.emotion, tags: intent.tags, note: intent.note || ref.caption || '' });
          audit.record({ kind: 'sticker.collected', id: saved?.id ?? null, emotion: saved?.emotion });
          continue;
        }
        // 「学个新词」：只进候选，管理员确认前不进提示词
        if (intent.kind === 'learn_word') {
          const proposed = lexicon.propose({ word: intent.word, context: intent.context, actor: event?.from?.actor });
          audit.record({ kind: 'lexicon.proposed', word: intent.word, accepted: Boolean(proposed), hits: proposed?.hits ?? 0 });
          continue;
        }
        // 「记住」：内核自己收下，不发给包（之前包会回 unsupported，等于丢掉）
        if (intent.kind === 'remember') {
          // 注意：这里**不要**再给 event.importance（否则会被当成渠道加分再算一遍）
          const saved = memory.ingest({
            text: intent.text ?? '',
            source: 'manual',
            from: { adapter: event?.from?.adapter, channel: event?.from?.channel, kind: event?.from?.kind, actor: event?.from?.actor, at: event?.from?.at },
            to: event?.to ?? {},
          }, { direct: true, explicitImportance: Number(intent.importance) || 40 });
          audit.record({ kind: 'memory.remembered', importance: saved.importance, chars: String(saved.text).length });
          continue;
        }
        // 「收尾」：记下结束点（下次接法），不发给包
        if (intent.kind === 'close') {
          closure.closed(String(event?.from?.channel ?? ''), event?.from?.at);
          audit.record({ kind: 'closure.closed', reason: intent.reason ?? null, summary: String(intent.summary ?? '').slice(0, 80), nextOpening: String(intent.nextOpening ?? '').slice(0, 80) });
          continue;
        }
        // 语音：模型想用语音 → 内核闸门决定放行还是降级（降级必须可见）
        if (intent.kind === 'say' && intent.voice === true) {
          const g = voiceGate(intent);
          if (!g.ok) {
            delete intent.voice;
            audit.record({ kind: 'voice.degraded', code: g.code, hint: g.hint });
          } else if (voiceEngine) {
            // 有引擎就真合成；拿不到音频就退回文字（不假装发了语音）
            // 没指定音色时，从语音库里挑一个（挑不到就用引擎默认）
            const voiceId = voiceCfg.voiceId || voices.pick({})?.id || '';
            const said = await voiceEngine.speak({ text: intent.text, voiceId });
            if (said.ok && voiceId) voices.markUsed(voiceId);
            if (!said.ok) {
              delete intent.voice;
              audit.record({ kind: 'voice.degraded', code: said.error?.code ?? 'voice.synth-failed', hint: said.error?.hint });
            } else if (said.bytes) {
              const audio = media.put({ kind: 'audio', bytes: said.bytes, caption: intent.text });
              // 语音消息 = 发媒体（内容变更：say → send_media；意图种类没变）
              intent.kind = 'send_media';
              intent.media = [{ id: audio.id, kind: 'audio', caption: intent.text }];
              intent.text = undefined;
            } else if (said.path) {
              intent.kind = 'send_media';
              intent.media = [{ path: said.path, kind: 'audio', caption: intent.text }];
              intent.text = undefined;
            }
          }
        }
        // 表情：模型只说"想发个表情"，挑哪张由内核决定（库在内核，工具不查库）
        if (intent.kind === 'send_media' && intent.sticker) {
          const query = intent.sticker;
          delete intent.sticker;
          const picked = stickers.pick({ emotion: query.emotion || undefined, tags: query.tags ?? [], text: String(event?.text ?? ''), max: 1 })[0];
          if (!picked) {
            audit.record({ kind: 'sticker.miss', emotion: query.emotion || null });
            continue;   // 没挑到就不发，也不假装发了
          }
          stickers.use(picked.id);
          intent.media = [{ id: picked.mediaId, kind: 'image', caption: picked.note || '' }];
        }
      // 媒体：把内存里的编号换成**路径 + 说明**（媒体库是内核的，包不该认识 id）
        if (intent.kind === 'send_media' && Array.isArray(intent.media)) {
          intent.media = intent.media.map((m) => {
            const ref = media.refFor(m?.id);
            return ref ? { ...m, kind: m.kind ?? ref.kind, path: ref.path, caption: m.caption || ref.caption } : m;
          });
          if (!intent.media.some((m) => m.path)) {
            audit.record({ kind: 'media.unresolved', ids: intent.media.map((m) => m?.id ?? null) });
          }
        }
        // AI 标识：只要是"她产出的内容"，就带事实字段（包负责怎么呈现）
        if (aiCfg.enabled && (intent.kind === 'say' || intent.kind === 'send_media')) {
          intent.aiGenerated = true;
          intent.label = aiCfg.label;
        }
        intents.push(intent);
      }
      audit.record({ kind: 'expression', count: out.intents.length, first: out.intents[0]?.kind ?? null });
    }

    // ⑤ 目的机制：她"被叫到"时不抢话，只在没被直接叫到时考虑
    const gate = purpose.canFire({ budgetOk: budget.canSpend('total', 0).ok });
    if (gate.ok && (base.priority ?? 0) < 60) {
      // 素材来自**同一套可见性过滤**后的记忆，不是另一条旁路
      const materials = collectMaterials(memory.visible(viewer), {
        now: now(),
        seen: purpose.state.history.map((h) => h.text),
      });
      const goal = purpose.select(materials);
      if (goal) {
        const fired = purpose.fire({ goal, text: goal.text });
        if (fired) {
          intents.push({ ...fired.intent, id: `purpose-${goal.id}-${now()}` });
          lastPurposeGoalId = goal.id;   // 记下来，等主人回应来闭环
          audit.record({ kind: 'purpose.fired', goalId: goal.id, need: goal.need });
        }
      }
    } else if (!gate.ok) {
      audit.record({ kind: 'purpose.skipped', reason: gate.reason });
    }

    return { ...base, intents };
  }

  /* ── 心跳 ──────────────────────────────────────────────────────── */
  function tick() {
    const out = { decayed: false, forgotten: 0, capacity: 'ok' };
    if (memory.needsDecay()) {
      const r = memory.decay();
      out.decayed = r.changed;
      out.forgotten = r.forgotten.length;
      // 从衰减卡里出去 ≠ 消失：全量卡里一直都在（入库时就写了）
      if (r.forgotten.length) audit.record({ kind: 'memory.faded', count: r.forgotten.length });
    }
    // 容量告警：只在档位变化时记一次（80 / 90 / 满），免得每 60 秒刷一条
    const level = memory.stats().capacity;
    out.capacity = level;
    if (level !== lastCapacity) {
      if (level !== 'ok') audit.record({ kind: 'memory.capacity', level });
      lastCapacity = level;
    }
    purpose.tickDrives();
    return out;
  }

  /* ── 落盘 / 读盘 ───────────────────────────────────────────────── */
  // 读坏或版本不符时进入"写保护"：新内容写到 recovered 文件，绝不动原文件。
  // 这是旧代码用事故换来的规矩（只读降级必须可见，不许假装正常）。
  let writeGuard = null;   // null | 'corrupt' | 'version'

  function save() {
    if (!store) return null;
    // 跨进程单写者：拿不到锁就不写（宁可这次不存，也不让两个进程互相覆盖）
    const lock = store.acquireLock();
    if (!lock.ok) {
      audit.record({ kind: 'kernel.save-blocked', code: 'store.locked', holder: lock.pid ?? null, hint: lock.error });
      return { ok: false, code: 'store.locked', error: lock.error, hint: '另一个进程正在写状态：这次不保存，等它退出再存' };
    }
    try {
      const payload = {
        version: STATE_VERSION,
        savedAt: now(),
        mode: memory.mode,
        records: memory.snapshot(),
        // 向量线自己的一份（含已从衰减卡消失的旧记录）；不存的话重启就退化成投影
        vector: memory.vector ? memory.vector() : [],
        purpose: purpose.state,
        budget: { limits: budget.limits(), spent: budget.snapshot() },
        ledger: ledger.snapshot(),
        settings: settingsValues,
        // 这些以前没存：重启就空（顾问审阅抓到的"看起来做了"）
        conversation: conversation.snapshot(),
        conversationArchive: conversation.archive(),
        closure: closure.snapshot(),
        lexicon: lexicon.snapshot(),
        stickers: stickers.snapshot(),
        people: people.snapshot(),
        voices: voices.snapshot(),
      };
      const name = writeGuard ? 'kernel-state.recovered' : 'kernel-state';
      if (writeGuard) audit.record({ kind: 'kernel.save-detoured', reason: writeGuard, name });
      return store.writeJson(name, payload);
    } finally {
      store.releaseLock();
    }
  }

  function load() {
    if (!store) return null;
    const r = store.readJsonChecked('kernel-state');

    if (r.reason === 'corrupt') {
      writeGuard = 'corrupt';
      audit.record({
        kind: 'kernel.load-failed',
        code: 'store.corrupt',
        hint: '状态文件损坏：已进入只读降级，新数据会写到 kernel-state.recovered.json，原文件保留',
      });
      return null;
    }
    if (!r.ok) return null;   // 文件不存在：正常首次启动

    if (r.value?.version !== STATE_VERSION) {
      writeGuard = 'version';
      audit.record({
        kind: 'kernel.load-failed',
        code: 'store.version-mismatch',
        found: r.value?.version ?? null,
        expected: STATE_VERSION,
        hint: '版本不符：不覆盖旧文件，新数据写到 kernel-state.recovered.json',
      });
      return null;
    }

    if (Array.isArray(r.value.records)) memory.restore(r.value.records);
    // 向量线单独恢复（含已从衰减卡消失的旧记录）；没存过就保持空
    if (Array.isArray(r.value.vector) && r.value.vector.length) memory.restoreVector(r.value.vector);
    if (r.value.purpose) purpose.restore(r.value.purpose);
    if (r.value.budget?.spent) budget.restore(r.value.budget.spent);
    if (r.value.ledger) ledger.restore(r.value.ledger);
    if (r.value.mode) memory.setMode(r.value.mode);
    if (r.value.conversation) conversation.restore(r.value.conversation);
    if (r.value.conversationArchive) conversation.restoreArchive(r.value.conversationArchive);
    if (r.value.closure) closure.restore(r.value.closure);
    if (r.value.lexicon) lexicon.restore(r.value.lexicon);
    if (Array.isArray(r.value.stickers)) stickers.restore(r.value.stickers);
    if (r.value.people) people.restore(r.value.people);
    if (Array.isArray(r.value.voices)) voices.restore(r.value.voices);
    if (r.value.settings && typeof r.value.settings === 'object') {
      for (const [k, v] of Object.entries(r.value.settings)) settingsValues[k] = v;
      // 设置恢复了 → 内核阈值也要跟着恢复（否则重启后阈值退回默认）
      applyKernelSettings();
    }
    audit.record({ kind: 'kernel.loaded', records: Array.isArray(r.value.records) ? r.value.records.length : 0 });
    return r.value;
  }

  return {
    memory, purpose, audit, budget, ledger, identity, media, expression,
    get card() { return memory.snapshot(); },
    conversation, turnGuard, closure, lexicon, stickers, people, voices,
    get degraded() { return writeGuard; },

    /* 语音：内核决定"这次用不用"，平台包负责真的送出去 */
    voice: {
      get config() { return { ...voiceCfg }; },
      configure(patch = {}) { Object.assign(voiceCfg, patch); return { ...voiceCfg }; },
      /** 单独问一句：这次能不能用语音（不产生副作用） */
      decide({ wantVoice = false, chars = 0 } = {}) {
        if (!wantVoice) return { useVoice: false, reason: 'not-requested' };
        return voiceGate({ text: 'x'.repeat(Math.max(0, chars)) });
      },
      usage() { return voiceUsage.filter((t) => now() - t < 3600000).length; },
    },

    /* 设置：只吃声明，不认平台名；可导出带走 */
    settings: {
      model() { return buildSettingsModel(packDeclarations, settingsValues); },
      export() { return exportSettings(this.model()); },
      import(json) {
        const r = importSettings(json, packDeclarations);
        if (r.ok) {
          // 深合并：只覆盖导入成功的键，**不许把用户已有设定抹掉**
          for (const [id, kv] of Object.entries(r.applied)) {
            settingsValues[id] = { ...(settingsValues[id] ?? {}), ...kv };
          }
        }
        return r;
      },
      values() { return { ...settingsValues }; },
      set(adapterId, key, value) {
        settingsValues[adapterId] = { ...(settingsValues[adapterId] ?? {}), [key]: value };
        // 改的是内核自己的阈值 → 立刻生效（不用重启）
        if (adapterId === KERNEL_SETTINGS_ID) applyKernelSettings();
        return settingsValues[adapterId];
      },
    },

    handle, respond, tick, save, load, flushVectors,
    setMemoryMode(mode) { return memory.setMode(mode); },

    snapshot() {
      return {
        mode: memory.mode,
        records: memory.snapshot().length,
        media: media.size(),
        purpose: purpose.summary(),
        budget: budget.snapshot(),
        ledger: ledger.summary(),
        audit: audit.size(),
      };
    },
  };
}
