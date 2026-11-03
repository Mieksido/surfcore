/**
 * SurfCore 插件侧的「今日 token 用量」采集器（2026-10-23 用户要求）。
 *
 * 为什么要插件自己采，而不是只读 QQ 桥接的账本：
 *   · 桥接只 follow QQ 会话，看不到桌宠、黑话学习这些非 QQ 会话；
 *   · 用户要的是「QQ / 其他」两类的当日总量（2026-11-03 B站 下线后从三类降为两类）；
 *   · 插件的 `ctx.on('session/event')` 能拿到**所有**已提交的 assistant usage，
 *     按事件时间计价，天然区分高峰/空闲，比轮询投影更准、更省。
 *
 * 采集规则：
 *   · session/event 里 `assistant/message` / `assistant/attempt` 带 usage 的才计费；
 *     同一 (turn, step, retry) 后到覆盖先到（流式 attempt → 最终 message 不会双算）；
 *   · 启动时回填：读 session/list 的累计投影 + 对当天活跃会话 inspect 事件，
 *     把「插件启动前今天已经花掉的」补上；同一天热重载则只补 seen 之后的增量；
 *   · 每日 0 点（本地时区）重置当日累计；跨天事件按事件时间归属，不按处理时间。
 *
 * 分类：
 *   · 其他：黑话学习会话（state/slang-session.json）、标题含「黑话」的 qq-chat，
 *     以及历史 `bili-whale*` 会话（B站 已下线，只为把旧账算进「其他」而不是漏掉）；
 *   · 子会话继承父会话分类；
 *   · QQ：agentPreset 以 `qq-chat` 开头，或 sessions.json 里映射的会话；
 *   · 其余（cordis / standard 用户会话）**不计入** SurfCore 总额。
 */
import fs from 'node:fs';
import path from 'node:path';
import { usageOfEvent } from '../../../src/token-ledger.js';
import {
  addBuckets,
  normalizeUsage as normalizeBuckets,
  priceUsage,
  resolvePriceTable,
  subBuckets,
  totalTokensOf,
} from '../../../src/model-prices.js';
import {
  CATEGORY_KEYS,
  clamp0,
  emptyCategories,
  emptySession,
  isPlainObject,
  normalizeCategories,
  normalizeSession,
  num,
  sumUsageEvents,
} from './token-usage-pure.js';
import {
  BUDGET_FILES,
  DEFAULT_LIMITS,
  SCOPES,
  allRatios,
  blockMessage,
  evaluateBudget,
  localDayKey,
  localDayStart,
  normalizeLimits,
  normalizeUsage,
  parseCnyText,
  parseTokenText,
  readAlert,
  readBudget,
  takeAlert,
  writeBudget,
  writeDailyUsage,
} from '../../../src/token-budget.js';

const DEFAULT_MODEL = 'deepseek-flash';
const ONE_SECOND = 1000;

function readJson(file, fallback = null) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function budgetFallbackFromQqConfig(cfg) {
  const raw = cfg?.socialV2?.tokenGuard?.maxDailyCostCNY;
  const n = Number(raw);
  // 没填过 → 沿用已上线的默认 ¥8；明确填 0 → 尊重「不限」，不能偷偷改回 8。
  const cny = raw === undefined || raw === null || !Number.isFinite(n)
    ? DEFAULT_LIMITS.qq.cny
    : (n > 0 ? n : null);
  return {
    qq: { cny, tokens: null },
    other: { cny: null, tokens: null },
    total: { cny: null, tokens: null },
  };
}

/** 校验设置页提交的原始额度（字符串输入必须可解析，不能静默变「不限」）。 */
export function validateLimitsInput(input) {
  const source = isPlainObject(input?.limits) ? input.limits : input;
  if (!isPlainObject(source)) throw new Error('额度必须是对象');
  for (const scope of SCOPES) {
    const item = source[scope];
    if (item == null) continue;
    if (!isPlainObject(item)) throw new Error(`${scope} 的额度必须是对象`);
    for (const unit of ['cny', 'tokens']) {
      const raw = item[unit];
      if (typeof raw !== 'string' || !raw.trim()) continue;
      const parsed = unit === 'cny' ? parseCnyText(raw) : parseTokenText(raw);
      if (parsed === undefined) {
        throw new Error(`${scope} 的${unit === 'cny' ? '人民币' : ' token '}额度无法识别：${raw}`);
      }
    }
  }
  return true;
}

/**
 * 创建一个采集器。
 * @param {object} opts
 * @param {object} opts.ctx                 Cordis host context（要 sessionController，可选 on）
 * @param {string} opts.dshHome             ~/.dsh
 * @param {string} opts.qqStateDir          <surfcore>/state
 * @param {() => object} [opts.getQqConfig] 读 QQ config（价目表 / 默认模型）
 * @param {(msg:string, ...args:any[])=>void} [opts.log]
 * @param {() => number} [opts.now]
 */
export function createTokenBudgetService({
  ctx,
  dshHome,
  qqStateDir,
  getQqConfig = () => ({}),
  log = () => {},
  now = () => Date.now(),
} = {}) {
  const dir = path.join(dshHome, 'surfcore');
  const stateFile = path.join(dir, BUDGET_FILES.state);
  const dailyFile = path.join(dir, BUDGET_FILES.daily);
  const budgetFile = path.join(dir, BUDGET_FILES.budget);
  const slangFile = path.join(qqStateDir, 'slang-session.json');
  const qqSessionsFile = path.join(qqStateDir, 'sessions.json');

  let limits = readBudget(dir, budgetFallbackFromQqConfig(getQqConfigSafe()));
  let state = loadState();
  let bootstrapping = false;
  let bootstrapped = false;
  let bootstrapPromise = null;
  let lastBootstrapAt = 0;
  let persistTimer = null;
  let lastLimitsRead = 0;
  let priceCache = { at: 0, table: null };
  let learnerCache = { at: 0, id: null };
  let qqIdsCache = { at: 0, ids: new Set() };
  const queue = [];
  const sessionCategory = new Map();
  const sessionMeta = new Map();
  const sessionModel = new Map();
  const lastSeq = new Map();
  const retryAxis = new Map();
  const samples = new Map();

  // ── 配置 / 分类辅助 ────────────────────────────────────────────────────
  function getQqConfigSafe() {
    try { return getQqConfig() ?? {}; } catch { return {}; }
  }

  function priceTable() {
    if (priceCache.table && now() - priceCache.at < 30 * ONE_SECOND) return priceCache.table;
    priceCache = { at: now(), table: resolvePriceTable(getQqConfigSafe()?.pricing) };
    return priceCache.table;
  }

  function defaultModel() {
    return String(getQqConfigSafe()?.dsh?.model || DEFAULT_MODEL);
  }

  function readLearnerId() {
    if (now() - learnerCache.at < 10 * ONE_SECOND) return learnerCache.id;
    const parsed = readJson(slangFile, null);
    learnerCache = { at: now(), id: typeof parsed?.sessionId === 'string' ? parsed.sessionId : null };
    return learnerCache.id;
  }

  function readQqSessionIds() {
    if (now() - qqIdsCache.at < 10 * ONE_SECOND) return qqIdsCache.ids;
    const parsed = readJson(qqSessionsFile, null);
    const ids = new Set(Object.values(parsed?.sessions ?? {}).filter((v) => typeof v === 'string' && v));
    qqIdsCache = { at: now(), ids };
    return ids;
  }

  /** 会话分类；无法归属 SurfCore 的返回 null（用户自己的 DSH 会话不计入）。 */
  function classify(header = {}, summary = {}) {
    const id = String(header.id ?? summary.sessionId ?? '');
    if (!id) return null;
    const learnerId = readLearnerId();
    if (learnerId && id === learnerId) return 'other';
    // B站 已下线（2026-11-03）：这类会话不会再产生，但旧 state 里还有存量，
    // 归到「其他」而不是漏掉，否则当日用量会在升级瞬间凭空变少。
    if (/^bili-whale(?:-|$)/.test(id)) return 'other';
    const parent = header.parentSession ?? summary.parentSessionId;
    if (parent) {
      const parentCategory = sessionCategory.get(String(parent)) ?? state.sessions[String(parent)]?.category;
      if (parentCategory) return parentCategory;
    }
    const preset = String(header.agentPreset ?? summary.agentPreset ?? '');
    const title = String(summary.title ?? sessionMeta.get(id)?.title ?? '');
    if (preset.startsWith('qq-chat') && /黑话/.test(title)) return 'other';
    if (preset.startsWith('qq-chat')) return 'qq';
    if (readQqSessionIds().has(id)) return 'qq';
    return null;
  }

  function rememberSession(id, category, meta = {}) {
    if (category) sessionCategory.set(id, category);
    const prev = sessionMeta.get(id) ?? {};
    sessionMeta.set(id, {
      ...prev,
      title: meta.title ?? prev.title ?? null,
      agentPreset: meta.agentPreset ?? prev.agentPreset ?? null,
      parentSession: meta.parentSession ?? prev.parentSession ?? null,
    });
  }

  // ── 状态 ────────────────────────────────────────────────────────────────
  function loadState() {
    const parsed = readJson(stateFile, null);
    const out = {
      version: 1,
      day: null,
      updatedAt: 0,
      categories: emptyCategories(),
      sessions: {},
    };
    if (!isPlainObject(parsed)) return out;
    if (typeof parsed.day === 'string') out.day = parsed.day;
    out.updatedAt = num(parsed.updatedAt);
    out.categories = normalizeCategories(parsed.categories);
    if (isPlainObject(parsed.sessions)) {
      for (const [id, entry] of Object.entries(parsed.sessions)) out.sessions[id] = normalizeSession(entry);
    }
    return out;
  }

  function ensureDay(atMs = now()) {
    const day = localDayKey(atMs);
    if (state.day === day) return false;
    // 字符串日期可直接比较；不允许把今天的账倒退成昨天。
    if (state.day && day < state.day) return false;
    state.day = day;
    state.categories = emptyCategories();
    for (const [id, entry] of Object.entries(state.sessions)) {
      entry.dayTokens = 0;
      entry.dayCost = 0;
      // 30 天没再见过的会话从采集状态里淘汰；不删任何 DSH 数据，只是下次再见到时重新回填。
      if (entry.lastSeenAt > 0 && atMs - entry.lastSeenAt > 30 * 24 * 60 * 60 * 1000) delete state.sessions[id];
    }
    samples.clear();
    retryAxis.clear();
    schedulePersist(0);
    return true;
  }

  function ensureSessionState(id) {
    if (!state.sessions[id]) state.sessions[id] = emptySession(state.day);
    return state.sessions[id];
  }

  function addUsage(category, tokens = 0, cost = 0) {
    if (!CATEGORY_KEYS.includes(category)) return;
    const bucket = state.categories[category] ?? { cost: 0, tokens: 0 };
    bucket.tokens = Math.round(clamp0(bucket.tokens + num(tokens)));
    bucket.cost = clamp0(bucket.cost + num(cost));
    state.categories[category] = bucket;
  }

  // ── 启动回填 ────────────────────────────────────────────────────────────
  async function bootstrap() {
    if (bootstrapping) return bootstrapPromise;
    bootstrapping = true;
    bootstrapPromise = (async () => {
      const dayRolled = ensureDay(now());
      const dayStart = localDayStart(now());
      const controller = ctx?.sessionController;
      if (!controller?.list) {
        // 冒烟测试 / 旧宿主：没有 list 就只靠之后的 session/event。
        bootstrapped = true;
        return;
      }
      let items = [];
      try {
        const listed = await controller.list({});
        items = Array.isArray(listed?.items) ? listed.items : [];
      } catch (error) {
        log(`[token-budget] 启动回填失败（session/list）：${String(error?.message ?? error).slice(0, 160)}`);
        return; // 下次 status 再试
      }

      // 第一遍：记住元数据 + 能直接判断的分类（旧 B站会话 / 黑话 / qq-chat）。
      for (const item of items) {
        const id = String(item?.sessionId ?? '');
        if (!id) continue;
        const values = item?.projections?.values ?? {};
        const header = {
          id,
          agentPreset: values.agentPreset,
          parentSession: item?.parentSessionId,
        };
        rememberSession(id, null, {
          title: values.title,
          agentPreset: values.agentPreset,
          parentSession: item?.parentSessionId,
        });
        const category = classify(header, {
          sessionId: id,
          agentPreset: values.agentPreset,
          parentSessionId: item?.parentSessionId,
          title: values.title,
        });
        if (category) {
          sessionCategory.set(id, category);
          ensureSessionState(id).category = category;
        }
      }
      // 第二遍：父会话分类已知后，把子会话继承过去（旧 B站子任务 / QQ 子任务）。
      for (let round = 0; round < 4; round += 1) {
        let changed = false;
        for (const item of items) {
          const id = String(item?.sessionId ?? '');
          const parent = item?.parentSessionId;
          if (!id || !parent || sessionCategory.has(id)) continue;
          const parentCategory = sessionCategory.get(String(parent)) ?? state.sessions[String(parent)]?.category;
          if (parentCategory) {
            sessionCategory.set(id, parentCategory);
            ensureSessionState(id).category = parentCategory;
            changed = true;
          }
        }
        if (!changed) break;
      }

      for (const item of items) {
        const id = String(item?.sessionId ?? '');
        if (!id) continue;
        const category = sessionCategory.get(id) ?? classify(
          { id, agentPreset: item?.projections?.values?.agentPreset, parentSession: item?.parentSessionId },
          { sessionId: id, title: item?.projections?.values?.title, parentSessionId: item?.parentSessionId },
        );
        if (!category) continue;
        const values = item?.projections?.values ?? {};
        const cumulative = normalizeBuckets(values.tokenUsage);
        let model = values.modelSelection?.lastUsed?.model
          ?? values.modelSelection?.next?.model
          ?? defaultModel();
        const entry = ensureSessionState(id);
        entry.category = category;
        entry.lastSeenAt = Math.max(entry.lastSeenAt || 0, num(item?.updatedAt, now()));
        // 只有「之前真的采过这个会话」才能走同一天增量。空的 state（例如插件在
        // 没有 sessionController 的冒烟环境里写过一份 day=today 的空文件）不能把
        // 累计投影当成今天的花费 —— 那样会把很久以前就存在的旧会话整段算进今天。
        const hadState = entry.lastSeq >= 0 || totalTokensOf(entry.seen) > 0 || entry.dayTokens > 0 || entry.dayCost > 0;
        if (entry.model && !model) model = entry.model;
        if (!entry.model) entry.model = model;
        sessionModel.set(id, entry.model ?? model);

        if (entry.lastSeq >= 0 && Number.isFinite(Number(entry.lastSeq))) {
          // 上次运行留下的进度：热重载只补 seen 之后的增量。
          lastSeq.set(id, Number(entry.lastSeq));
        }

        // 同一天热重载：只补上次落盘 seen 之后的增量，避免把已经算过的今天重复算一遍。
        // 跨天（或首次运行）不能用累计差——那样会把昨天的历史算进今天，必须回填事件日志。
        if (!dayRolled && hadState && state.day === localDayKey(now())) {
          if (totalTokensOf(entry.seen) <= totalTokensOf(cumulative)) {
            const delta = subBuckets(cumulative, entry.seen);
            if (totalTokensOf(delta) > 0) {
              const p = priceUsage(delta, { model: entry.model ?? model, at: now(), table: priceTable() });
              addUsage(category, totalTokensOf(delta), p.cost.total);
              entry.dayTokens = Math.round(clamp0(entry.dayTokens + totalTokensOf(delta)));
              entry.dayCost = clamp0(entry.dayCost + p.cost.total);
            }
            entry.seen = { ...cumulative };
            continue;
          }
          // seen 比投影累计还大：说明上次落盘之后事件还没被投影反映（或会话被重置）。
          // 这时**不能**去 inspect 回填今天，否则会把同一段用量再算一遍；以投影为新的 seen 继续。
          entry.seen = { ...cumulative };
          continue;
        }

        // 今天没活动 / 没有累计 → 无需 inspect。
        if (num(item?.updatedAt) < dayStart || totalTokensOf(cumulative) === 0) {
          entry.seen = { ...cumulative };
          entry.dayTokens = 0;
          entry.dayCost = 0;
          continue;
        }

        // 第一次见到这个会话、且它今天有累计：从事件日志里拆出「今天的部分」。
        try {
          const inspected = await controller.inspect(id);
          const events = Array.isArray(inspected?.events) ? inspected.events : [];
          const meta = inspected?.meta ?? inspected?.header ?? {};
          const finalCategory = classify(
            { id, agentPreset: meta.agentPreset ?? values.agentPreset, parentSession: meta.parentSession ?? item?.parentSessionId },
            { sessionId: id, title: values.title, parentSessionId: item?.parentSessionId },
          ) ?? category;
          const summed = sumUsageEvents(events, {
            dayStart,
            fallbackModel: entry.model ?? model,
            priceTable,
            defaultModel,
          });
          addUsage(finalCategory, summed.tokens, summed.cost);
          entry.category = finalCategory;
          entry.createdAt = num(meta.createdAt, entry.createdAt);
          entry.preset = meta.agentPreset ?? entry.preset;
          entry.dayTokens = Math.round(clamp0(summed.tokens));
          entry.dayCost = clamp0(summed.cost);
          entry.seen = { ...cumulative };
          entry.lastSeq = Math.max(entry.lastSeq, summed.maxSeq);
          lastSeq.set(id, entry.lastSeq);
          if (summed.model) {
            entry.model = summed.model;
            sessionModel.set(id, summed.model);
          }
        } catch (error) {
          // 读不到日志不能把已经花掉的钱算成 0：至少把累计当成 seen，今天从下一笔开始算。
          entry.seen = { ...cumulative };
          entry.dayTokens = 0;
          entry.dayCost = 0;
          log(`[token-budget] 回填 ${id} 失败：${String(error?.message ?? error).slice(0, 160)}`);
        }
      }

      bootstrapped = true;
    })().catch((error) => {
      log(`[token-budget] 初始化异常：${String(error?.message ?? error).slice(0, 200)}`);
    }).finally(() => {
      bootstrapping = false;
      bootstrapPromise = null;
      lastBootstrapAt = now();
      // 启动期间到达的事件：等回填完成后再按 seq 去重入账。
      const pending = queue.splice(0);
      for (const item of pending) ingestEvent(item.session, item.event);
      persist(true);
    });
    return bootstrapPromise;
  }

  async function ensureReady() {
    if (bootstrapped) return;
    if (bootstrapPromise) return bootstrapPromise;
    if (lastBootstrapAt && now() - lastBootstrapAt < 30 * ONE_SECOND && !bootstrapped) {
      return; // 刚失败过，别每个请求都重试
    }
    return bootstrap();
  }

  // ── 实时摄入 ────────────────────────────────────────────────────────────
  function ingestEvent(session, event) {
    if (!session || !event) return false;
    if (bootstrapping) {
      queue.push({ session, event });
      return false;
    }
    const id = String(session.id ?? '');
    if (!id) return false;
    const at = Number(event.time) || now();
    const eventDay = localDayKey(at);
    if (state.day && eventDay < state.day) return false; // 昨天的迟到事件不计进今天
    ensureDay(at);

    if (event.type === 'llm/retry-started') {
      const turn = Number(event.data?.turn);
      const step = Number(event.data?.step);
      if (Number.isFinite(turn) && Number.isFinite(step)) {
        retryAxis.set(id, {
          turn,
          step,
          retry: Number.isFinite(Number(event.data?.retry)) ? Number(event.data.retry) : 1,
        });
      }
      return false;
    }
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return false;
    const usage = usageOfEvent(event);
    if (!usage) return false;
    const header = session.header ?? {};
    const category = sessionCategory.get(id) ?? classify(header, sessionMeta.get(id) ?? {});
    if (!category) return false;
    rememberSession(id, category, {
      agentPreset: header.agentPreset,
      parentSession: header.parentSession,
      title: sessionMeta.get(id)?.title,
    });
    const seq = Number(event.seq);
    const previousSeq = lastSeq.get(id) ?? -1;
    if (Number.isFinite(seq) && seq <= previousSeq) return false;
    if (Number.isFinite(seq)) lastSeq.set(id, seq);
    const turn = Number(event.data?.turn);
    const step = Number(event.data?.step);
    if (!Number.isFinite(turn) || !Number.isFinite(step)) return false;
    const axis = retryAxis.get(id);
    const retry = axis && axis.turn === turn && axis.step === step ? axis.retry : 0;
    const key = `${turn}|${step}|${retry}`;
    const buckets = normalizeBuckets(usage);
    if (totalTokensOf(buckets) === 0) return false;
    const model = event.data?.message?.source?.model ?? sessionModel.get(id) ?? defaultModel();
    sessionModel.set(id, model);
    const p = priceUsage(buckets, { model, at, table: priceTable() });
    const tokens = totalTokensOf(buckets);

    // 同一 (turn,step,retry) 后到覆盖先到：先扣掉上一笔，再记这笔。
    const sessionSamples = samples.get(id) ?? new Map();
    const previous = sessionSamples.get(key);
    if (previous) {
      addUsage(previous.category ?? category, -previous.tokens, -previous.cost);
      const entry = ensureSessionState(id);
      entry.dayTokens = Math.round(clamp0(entry.dayTokens - previous.tokens));
      entry.dayCost = clamp0(entry.dayCost - previous.cost);
      // 累计投影里这一笔的最终值 = 上一笔 + (新 - 旧)；这样热重载时 seen 不会落后，
      // 也不会把流式 attempt 和最终 message 各算一遍。
      entry.seen = normalizeBuckets(addBuckets(entry.seen, subBuckets(buckets, previous.buckets)));
    } else {
      const entry = ensureSessionState(id);
      entry.seen = normalizeBuckets(addBuckets(entry.seen, buckets));
    }
    sessionSamples.set(key, { tokens, cost: p.cost.total, buckets, category });
    samples.set(id, sessionSamples);
    addUsage(category, tokens, p.cost.total);
    const entry = ensureSessionState(id);
    entry.category = category;
    entry.lastSeenAt = at;
    if (!entry.createdAt) entry.createdAt = num(header.createdAt);
    if (!entry.preset && header.agentPreset) entry.preset = String(header.agentPreset);
    entry.dayTokens = Math.round(clamp0(entry.dayTokens + tokens));
    entry.dayCost = clamp0(entry.dayCost + p.cost.total);
    if (Number.isFinite(seq)) entry.lastSeq = Math.max(entry.lastSeq, seq);
    entry.model = model;
    schedulePersist();
    return true;
  }

  // ── 落盘 ────────────────────────────────────────────────────────────────
  function stateSnapshot() {
    const sessions = {};
    for (const [id, entry] of Object.entries(state.sessions)) {
      sessions[id] = {
        category: entry.category,
        createdAt: entry.createdAt,
        lastSeenAt: entry.lastSeenAt,
        seen: entry.seen,
        dayTokens: entry.dayTokens,
        dayCost: entry.dayCost,
        lastSeq: entry.lastSeq,
        model: entry.model,
        preset: entry.preset,
        title: entry.title,
      };
    }
    return {
      version: 1,
      day: state.day,
      updatedAt: now(),
      categories: state.categories,
      sessions,
    };
  }

  function persist(force = false) {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    try {
      const snapshot = stateSnapshot();
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${stateFile}.${process.pid}.${Math.random().toString(16).slice(2, 8)}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmp, stateFile);
      state.updatedAt = snapshot.updatedAt;
    } catch (error) {
      log(`[token-budget] 写采集状态失败：${String(error?.message ?? error).slice(0, 160)}`);
    }
    try {
      const sessions = {};
      for (const [id, entry] of Object.entries(state.sessions)) sessions[id] = entry.category;
      writeDailyUsage(dir, state.categories, { day: state.day, at: now(), source: 'surfcore-plugin', sessions });
    } catch (error) {
      log(`[token-budget] 写当日用量失败：${String(error?.message ?? error).slice(0, 160)}`);
    }
    if (force) return;
  }

  function schedulePersist(delay = 800) {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persist(false);
    }, Math.max(0, Number(delay) || 0));
    persistTimer.unref?.();
  }

  // ── 额度 ────────────────────────────────────────────────────────────────
  function refreshLimits(force = false) {
    if (!force && now() - lastLimitsRead < 2 * ONE_SECOND) return limits;
    lastLimitsRead = now();
    limits = readBudget(dir, budgetFallbackFromQqConfig(getQqConfigSafe()));
    return limits;
  }

  function usageSnapshot() {
    return normalizeUsage(state.categories);
  }

  function blockedByScope() {
    const usage = usageSnapshot();
    const out = {};
    for (const scope of SCOPES) {
      out[scope] = evaluateBudget(usage, limits, { scopes: [scope, 'total'] }).blocked;
    }
    return out;
  }

  function buildStatus({ takeAlertFlag = false } = {}) {
    refreshLimits();
    const usage = usageSnapshot();
    const ratios = allRatios(usage, limits);
    const alertResult = takeAlertFlag
      ? takeAlert(dir, usage, limits, now())
      : { alert: null, existing: readAlert(dir) };
    return {
      ok: true,
      day: state.day,
      generatedAt: now(),
      currency: 'CNY',
      symbol: '¥',
      limits,
      usage,
      ratios,
      blocked: blockedByScope(),
      alert: alertResult.alert,
      alertedToday: alertResult.existing,
      alertRatio: 0.8,
      source: 'session-events',
      updatedAt: state.updatedAt,
      sessions: Object.fromEntries(Object.entries(state.sessions).map(([id, entry]) => [id, entry.category])),
      priceTable: (() => {
        const table = priceTable();
        return { version: table.version, currency: table.currency, symbol: table.symbol, unit: table.unit };
      })(),
    };
  }

  async function withTimeout(promise, ms = 5000) {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), Math.max(200, ms)); }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function status({ takeAlertFlag = false, timeoutMs = 5000 } = {}) {
    await withTimeout(ensureReady(), timeoutMs);
    const rolled = ensureDay(now());
    if (rolled || persistTimer) persist(false);
    return buildStatus({ takeAlertFlag });
  }

  async function block(scope = 'other', { timeoutMs = 4000 } = {}) {
    await withTimeout(ensureReady(), timeoutMs);
    const rolled = ensureDay(now());
    if (rolled || persistTimer) persist(false);
    refreshLimits();
    const usage = usageSnapshot();
    const result = evaluateBudget(usage, limits, { scopes: [scope, 'total'] });
    return {
      ...result,
      message: result.blocked ? blockMessage(result.hits) : '',
      usage,
    };
  }

  /**
   * 记录一次「不在 DSH 会话里」的模型用量（例如桌宠直接调 llm 服务的对话）。
   * 这些回合没有 session/event 可采，如果不补记，额度看板会漏掉桌宠的消耗。
   * 分类默认 other；事件时间归属当天，价格按当前价目表折算。
   */
  function recordExternalUsage({ category = 'other', sessionId = 'pet-chat', model = '', usage = null, at = now(), label = '' } = {}) {
    const cat = CATEGORY_KEYS.includes(category) ? category : 'other';
    const when = Number(at) || now();
    ensureDay(when);
    const buckets = normalizeBuckets(usage);
    if (totalTokensOf(buckets) === 0) return false;
    const id = String(sessionId || 'pet-chat');
    const resolvedModel = String(model || defaultModel());
    const p = priceUsage(buckets, { model: resolvedModel, at: when, table: priceTable() });
    const tokens = totalTokensOf(buckets);
    addUsage(cat, tokens, p.cost.total);
    const entry = ensureSessionState(id);
    entry.category = cat;
    entry.lastSeenAt = when;
    if (!entry.createdAt) entry.createdAt = when;
    entry.dayTokens = Math.round(clamp0(entry.dayTokens + tokens));
    entry.dayCost = clamp0(entry.dayCost + p.cost.total);
    entry.seen = normalizeBuckets(addBuckets(entry.seen, buckets));
    entry.model = resolvedModel;
    if (label) entry.title = String(label);
    schedulePersist();
    return true;
  }

  function saveLimits(input) {
    validateLimitsInput(input);
    const next = writeBudget(dir, input);
    limits = next;
    lastLimitsRead = now();
    schedulePersist(0);
    return next;
  }

  function addLimit(scope, unit, amount) {
    if (!SCOPES.includes(scope)) throw new Error(`scope 必须是 ${SCOPES.join(' / ')}`);
    if (unit !== 'cny' && unit !== 'tokens') throw new Error('unit 必须是 cny / tokens');
    const delta = Number(amount);
    if (!Number.isFinite(delta) || delta <= 0) throw new Error('加额度必须是正数');
    const current = normalizeLimits(limits, DEFAULT_LIMITS);
    const pair = current[scope];
    const base = pair[unit] ?? 0;
    pair[unit] = unit === 'cny' ? base + delta : Math.round(base + delta);
    return saveLimits(current);
  }

  function resetLimits() {
    return saveLimits({
      qq: { cny: null, tokens: null },
      other: { cny: null, tokens: null },
      total: { cny: null, tokens: null },
    });
  }

  function dispose() {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    persist(true);
  }

  return {
    dir,
    stateFile,
    dailyFile,
    budgetFile,
    bootstrap,
    ensureReady,
    ingestEvent,
    status,
    block,
    saveLimits,
    addLimit,
    resetLimits,
    refreshLimits,
    recordExternalUsage,
    persist,
    dispose,
    // 给测试/诊断用（不修改状态）
    _peek: () => ({
      state: JSON.parse(JSON.stringify({ day: state.day, categories: state.categories, sessions: state.sessions })),
      limits,
      bootstrapped,
      lastBootstrapAt,
    }),
    validateLimitsInput,
  };
}
