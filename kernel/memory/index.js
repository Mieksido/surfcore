/**
 * 记忆内核：两条记忆线，同时存、只读一条
 * ============================================================================
 * 结构（2026-11-10 按用户口径校正）：
 *
 *   记忆
 *   ├─ 叙事记忆 ───────────── 与向量**同级**
 *   │   ├─ 衰减记忆卡   会忘、会模糊（clarity 那一套）
 *   │   └─ 全量记忆卡   只追加、不忘（append-only）
 *   └─ 向量记忆 ───────────── 与叙事**同级**
 *
 * 三条铁律：
 *   ① **同时、分别存储**：一次入库，叙事（两张卡）与向量各写各的。
 *      —— 不是"一份数据两种看法"，那是投影，不是双存储。
 *   ② **同一时刻只有一个被读**：由 mode 决定读哪条线。
 *   ③ **输出统一**：两条线都返回 { text, refs, mode }，上层不需要知道读的是哪条。
 *
 * 【铁律】本文件不许出现任何渠道名。读取器只拿到"已按可见性过滤好的记录"。
 */
import { makeRecord, allowed } from './identity.js';
import { createDecayCard } from './narrative/decay-card.js';
import { createFullCard } from './narrative/full-card.js';
import { createNarrativeReader } from './narrative/reader.js';
import { createVectorStore } from './vector/store.js';
import { redactText } from './redact.js';
import { findDuplicate, DEFAULT_DEDUPE } from './dedupe.js';
import { scoreMemory } from './scoring.js';
import { planEviction, capacityLevel, DEFAULT_CAPACITY } from './capacity.js';
import { shouldMarkInitial, markFirstMeet, DEFAULT_INITIAL } from './initial.js';
import { relatedTo, cluster } from './associate.js';

/** 当前支持的读取方式。将来加方式只在这里加一个名字，不改别处。 */
export const READER_MODES = Object.freeze(['narrative', 'vector']);

/** 2-gram：中文按双字切，英文按词切（复习匹配用；不做学术，够用就好） */
function bigrams(text) {
  const s = String(text ?? '').toLowerCase();
  const out = new Set();
  for (const w of s.match(/[a-z0-9]{2,}/g) ?? []) out.add(w);
  const cn = s.replace(/[^\u4e00-\u9fa5]/g, '');
  for (let i = 0; i < cn.length - 1; i++) out.add(cn.slice(i, i + 2));
  return out;
}

/**
 * @param {object} options
 *   { mode, now, fullCardStore（可选：全量卡落盘到 jsonl）, readerOverride? }
 */
export function createMemoryKernel({ mode = 'narrative', now = () => Date.now(), fullCardStore = null, capacity = {}, limits = {}, vector = {} } = {}) {
  /** 叙事线：两张同级的卡 */
  const decayCard = createDecayCard({ now });
  const fullCard = createFullCard({ store: fullCardStore, now });

  /** 向量线：自己的存储；每个 modelSpace 一套索引 */
  const vectorStore = createVectorStore({
    now,
    enabled: vector.enabled !== false,
    modelSpace: vector.modelSpace ?? 'default',
  });
  const vectorCfg = {
    enabled: vector.enabled !== false,
    modelSpace: vector.modelSpace ?? 'default',
    batchSize: Number(vector.batchSize) > 0 ? Number(vector.batchSize) : 8,
    maxChars: Number(vector.maxChars) > 0 ? Number(vector.maxChars) : 1200,
  };

  const narrativeReader = createNarrativeReader();
  let activeMode = READER_MODES.includes(mode) ? mode : 'narrative';

  const capacityCfg = {
    ...DEFAULT_CAPACITY,
    ...capacity,
    // limits.maxRecords 是"设置页那一份"，优先级最高（旧写法只认 capacity，两套配置会打架）
    ...(Number(limits.maxRecords) > 0 ? { maxRecords: Number(limits.maxRecords) } : {}),
  };
  /** 可调阈值（设置页改的就是这几个；configure() 改，别处只读） */
  const limitsCfg = {
    dedupeWindowMs: DEFAULT_DEDUPE.windowMs,
    initialWindowDays: DEFAULT_INITIAL.windowDays,
    ...limits,
  };
  let duplicates = 0;          // 被判重挡下的条数（诊断用）
  let firstOwnerAt = null;     // 她与主人第一次的时间（「最初」判定用）
  /** 最近"试图入库"的观察（含被判重挡下的），鱼群统计要用：判重≠没看见 */
  const attempts = [];

  /** 她与主人最早的一条是什么时候 */
  function earliestOwnerAt() {
    if (firstOwnerAt !== null) return firstOwnerAt;
    const times = decayCard.records().filter((r) => r.to?.owner === true).map((r) => Number(r.from?.at) || 0).filter(Boolean);
    firstOwnerAt = times.length ? Math.min(...times) : null;
    return firstOwnerAt;
  }

  /** 两条线各自的"可读记录"（都已按可见性过滤） */
  function visibleNarrative(viewer) {
    return decayCard.records().filter((r) => allowed(r, viewer));
  }
  function visibleVector(viewer) {
    return vectorStore.entries().filter((r) => allowed(r, viewer));
  }

  return {
    /**
     * 入库流水线（**唯一写入口**）：
     *   判重 → 脱敏 → 评分 → 标记「最初」/初遇 → 三处存储 → 容量淘汰
     * 每一步都是独立模块的策略，这里只负责"按顺序调用"。
     * @param {object} event
     * @param {object} [ctx] { direct?:boolean（是不是直接对她说） }
     */
    ingest(event = {}, ctx = {}) {
      const record = makeRecord(event);
      if (!record.text && !record.media.length) return record;   // 空事件不占空间

      // 观察记录：**判重之前**就记（她确实"看见"了，只是不重复存）
      attempts.push({ actor: String(record.from?.actor ?? ''), text: String(record.text ?? ''), at: Number(record.from?.at) || now() });
      while (attempts.length > 500) attempts.shift();

      // ② 判重：同一条信息别记两遍（窗口内同人同文本 / 同平台编号）
      const dup = findDuplicate(record, decayCard.records(), { windowMs: limitsCfg.dedupeWindowMs, now });
      if (dup) {
        record.duplicate = true;
        duplicates += 1;
        return record;
      }

      // ⑤ 脱敏：先藏再落盘（落盘就收不回）
      const red = redactText(record.text);
      if (red.hits.length) {
        record.text = red.text;
        record.redacted = red.hits;
      }

      // ① 评分：内核信号 + 包给的渠道加分
      const ownerFirstEver = decayCard.records().every((r) => r.to?.owner !== true) && record.to?.owner === true;
      record.importance = scoreMemory(record, {
        direct: ctx.direct === true || event.mentioned === true,
        channelHint: Number(event.importance),
        isFirstOwnerEver: ownerFirstEver,
      });
      // 明确的"记住这个"：她说了算，不许被算低（只能往上取）
      if (Number.isFinite(Number(ctx.explicitImportance))) {
        record.importance = Math.max(record.importance, Math.min(100, Number(ctx.explicitImportance)));
      }

      // ④「最初」与初遇
      if (record.to?.owner === true) {
        const at = Number(record.from?.at) || now();
        if (firstOwnerAt === null || at < firstOwnerAt) firstOwnerAt = at;
      }
      if (shouldMarkInitial(record, { now: now(), firstOwnerAt, cfg: { windowDays: limitsCfg.initialWindowDays } })) record.initial = true;
      if (record.to?.owner === true) markFirstMeet(decayCard.records().concat(record));

      // 三处存储：全量卡（只追加）+ 衰减卡（会忘）+ 向量库
      fullCard.append(record);
      decayCard.add(record);
      vectorStore.put(record, {
        vector: ctx.vector,
        modelSpace: vectorCfg.modelSpace,
        enabled: vectorCfg.enabled,
      });

      // ③ 容量：超限就把最不重要的从衰减卡挪走（全量卡里仍在）
      const { evict } = planEviction(decayCard.records(), { maxRecords: capacityCfg.maxRecords });
      if (evict.length) decayCard.removeAll(evict);

      return record;
    },

    /** 切换读取方式（用户选择）。只影响读，不影响存。 */
    setMode(next) {
      if (READER_MODES.includes(next)) activeMode = next;
      return activeMode;
    },

    get mode() { return activeMode; },

    /**
     * 读取：只在她**做出行为前**调用（决策 A）。
     * @returns {{text:string, refs:object[], mode:string}}
     */
    read(viewer = {}, query = {}) {
      const out = activeMode === 'vector'
        ? vectorStore.read(viewer, query, visibleVector(viewer))
        : narrativeReader.build({ records: visibleNarrative(viewer), viewer, query });

      return {
        text: String(out?.text ?? ''),
        refs: Array.isArray(out?.refs) ? out.refs : [],
        mode: activeMode,
      };
    },

    /** 按可见性过滤后的记录（目的机制取素材用，与拼提示词同一套可见性） */
    visible(viewer = {}) {
      return (activeMode === 'vector' ? visibleVector(viewer) : visibleNarrative(viewer));
    },

    /** 衰减：只作用于**衰减卡**；全量卡不动 */
    decay(cfg) {
      return decayCard.decay(cfg);
    },

    /**
     * 谁在说话（鱼群保护用）：只统计"她能看到的、窗口内的"消息。
     * 鱼 = 窗口里说过 3 句以上、每句都很短（<12 字）又没有问句的人。
     * @returns {{totalSenders:number, fishAccounts:number, windowMs:number}}
     */
    actorStats({ windowMs = 10 * 60 * 1000, nowFn = null } = {}) {
      const since = Number((nowFn ?? now)()) - Number(windowMs);
      const byActor = new Map();
      // 用"试图入库"的观察（含被判重挡下的）——否则刷屏号发同一句只会剩 1 条，永远判不出鱼群
      for (const a of attempts) {
        if (a.at < since) continue;
        if (!a.actor) continue;
        const list = byActor.get(a.actor) ?? [];
        list.push(a.text);
        byActor.set(a.actor, list);
      }
      let fish = 0;
      for (const list of byActor.values()) {
        if (list.length < 3) continue;
        if (list.every((t) => t.length < 12 && !/[?？]/.test(t))) fish += 1;
      }
      return { totalSenders: byActor.size, fishAccounts: fish, windowMs: Number(windowMs) };
    },

    /**
     * 复习：按关键词命中**旧记录**，最多摸 max 条（旧代码是 2-gram 匹配、每次最多 5 条）。
     * 关键：**排除刚进来的这一条**——它不该因为"自己提到自己"而涨 recallCount。
     * @returns {number} 被复习的条数
     */
    review({ text = '', viewer = {}, exclude = null, max = 5 } = {}) {
      const probe = bigrams(text);
      if (!probe.size) return 0;
      const pool = visibleNarrative(viewer).filter((r) => r !== exclude);
      const scored = pool
        .map((r) => ({ r, hit: [...bigrams(r.text)].filter((g) => probe.has(g)).length }))
        .filter((x) => x.hit > 0)
        .sort((a, b) => b.hit - a.hit)
        .slice(0, Math.max(0, Number(max) || 0));
      for (const x of scored) decayCard.touch(x.r);
      return scored.length;
    },

    /** 需要做日衰减吗（只问衰减卡） */
    needsDecay(cfg) { return decayCard.needsDecay(cfg); },

    /** 被提到 = 复习（只作用于衰减卡） */
    touch(record) { return decayCard.touch(record); },

    /** 全量卡（只读视图 + 召回） */
    fullCard,

    /** 向量线快照（落盘用） */
    vector() { return vectorStore.snapshot(); },

    /** 向量线恢复（落盘用；与叙事各恢复各的） */
    restoreVector(list = []) { return vectorStore.restore(list); },

    /** 向量配置（设置页/组装层改；不碰叙事） */
    configureVector(next = {}) {
      if (next.enabled !== undefined) vectorCfg.enabled = next.enabled !== false;
      if (next.modelSpace !== undefined) vectorCfg.modelSpace = String(next.modelSpace || 'default');
      if (Number(next.batchSize) > 0) vectorCfg.batchSize = Number(next.batchSize);
      if (Number(next.maxChars) > 0) vectorCfg.maxChars = Number(next.maxChars);
      vectorStore.configure({ enabled: vectorCfg.enabled, modelSpace: vectorCfg.modelSpace });
      return { ...vectorCfg };
    },

    /** 当前配置（只读） */
    vectorConfig() { return { ...vectorCfg }; },

    /** 向量索引状态：总记录/已索引/待编码/失败 + 每个模型一套 */
    vectorStatus(space = vectorCfg.modelSpace) {
      return vectorStore.status({ space: space || vectorCfg.modelSpace });
    },

    /** 待编码（给 UI/CLI 看，不触发网络） */
    vectorPending(limit = vectorCfg.batchSize) {
      return vectorStore.pending({ space: vectorCfg.modelSpace, limit }).map((x) => ({ ...x, entry: undefined }));
    },

    /**
     * 编码一批 pending。
     * @param {Function} embed (texts)=>Promise<{ok,vectors,error}>（由内核/组装层注入）
     */
    async encodePending({ embed, limit = vectorCfg.batchSize, modelSpace = vectorCfg.modelSpace } = {}) {
      const space = modelSpace || vectorCfg.modelSpace;
      const items = vectorStore.pending({ space, limit });
      if (!items.length) return { ok: true, encoded: 0, failed: 0, status: vectorStore.status({ space }) };
      if (typeof embed !== 'function') {
        return { ok: false, encoded: 0, failed: items.length, error: { code: 'embed.no-port', message: '没有可用的 embedding 端口' }, status: vectorStore.status({ space }) };
      }
      let res;
      try { res = await embed(items.map((x) => x.text)); }
      catch (error) { res = { ok: false, error: { code: 'embed.exception', message: String(error?.message ?? error) } }; }

      if (!res?.ok || !Array.isArray(res.vectors) || res.vectors.length !== items.length) {
        const error = res?.error ?? { code: 'embed.shape', message: '嵌入返回数量与待编码数量不一致' };
        for (const item of items) vectorStore.markFailed(item.index, error, { space });
        return { ok: false, encoded: 0, failed: items.length, error, status: vectorStore.status({ space }) };
      }

      let encoded = 0;
      for (let i = 0; i < items.length; i += 1) {
        if (vectorStore.applyVector(items[i].index, res.vectors[i], { space })) encoded += 1;
        else vectorStore.markFailed(items[i].index, { code: 'embed.invalid', message: '向量为空/非数字/维度不合法' }, { space });
      }
      return { ok: encoded === items.length, encoded, failed: items.length - encoded, status: vectorStore.status({ space }) };
    },

    /** 重建当前模型的索引：全部退回 pending，再交给 encodePending 慢慢补 */
    rebuildVectors({ modelSpace = vectorCfg.modelSpace } = {}) {
      const space = modelSpace || vectorCfg.modelSpace;
      const count = vectorStore.rebuild({ space });
      return { ok: true, modelSpace: space, rebuilt: count, status: vectorStore.status({ space }) };
    },

    /** 记忆库：最近记录/语义搜索（只读） */
    searchVector({ text = '', vector = null, limit = 10, modelSpace = vectorCfg.modelSpace } = {}) {
      return vectorStore.search({ text, vector, limit, space: modelSpace || vectorCfg.modelSpace });
    },

    /** 只读快照（测试与调试用）：叙事线为主 */
    snapshot() { return decayCard.records().slice(); },

    /**
     * 联想：这件事让她想起别的什么事（同一套可见性；不看来源平台）。
     * @returns {Array<{record:object, score:number, via:string}>}
     */
    recall({ text = '', tags = [], viewer = {}, exclude = null, max = 3 } = {}) {
      return relatedTo({ text, tags }, visibleNarrative(viewer), { exclude, max });
    },

    /** 主题簇（按标签聚；给"她最近老想起这件事"用） */
    clusters(viewer = {}, opts = {}) {
      return cluster(visibleNarrative(viewer), opts);
    },

    /**
     * 改可调阈值（设置页改的就是这里）。**只改阈值，不改算法**。
     * @param {object} next { maxRecords?, dedupeWindowMs?, initialWindowDays? }
     */
    configure(next = {}) {
      if (Number(next.maxRecords) > 0) capacityCfg.maxRecords = Number(next.maxRecords);
      if (Number(next.dedupeWindowMs) > 0) limitsCfg.dedupeWindowMs = Number(next.dedupeWindowMs);
      if (Number(next.initialWindowDays) > 0) limitsCfg.initialWindowDays = Number(next.initialWindowDays);
      return { maxRecords: capacityCfg.maxRecords, ...limitsCfg };
    },

    /** 两条线的规模（诊断用） */
    stats() {
      return {
        narrative: decayCard.records().length,
        full: fullCard.size(),
        vector: vectorStore.size(),
        duplicates,
        capacity: capacityLevel(decayCard.records().length, capacityCfg.maxRecords),
      };
    },

    /**
     * 从落盘内容恢复（单写者的另一半）。
     * **只恢复衰减卡与向量**：全量卡有自己的 jsonl，**绝不在恢复时再写一遍**
     * （否则每次启动/看状态都会让它翻倍——顾问审阅抓到的真 bug）。
     */
    restore(list = []) {
      const arr = Array.isArray(list) ? list : [];
      decayCard.restore(arr);
      vectorStore.restore(arr);
      return decayCard.records().length;
    },
  };
}
