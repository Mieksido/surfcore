/**
 * 目的机制：她自己想说点什么
 * ============================================================================
 * 移植自旧的 purpose-engine.js（2,303 行），保留它的**四个核心思想**，
 * 去掉所有渠道相关内容（旧文件里有按渠道分支的判断）。
 *
 * 四个核心思想（旧代码的资产，必须保住）：
 *   ① 驱动向量：为什么今天特别想说话 / 特别想玩
 *   ② 目标假设：带归属 / 置信度 / 风险的猜测（不是"看到就想要"）
 *   ③ 观察账本：同一件事出现几次 —— 压住"一次视频=永久欲望"
 *   ④ 闭环反馈：主人的回复会改置信度，不是让猜测永久变成欲望
 *
 * 另外两条不变量（旧代码注释里写明的）：
 *   · 安静时段不打扰
 *   · **投递出去就先占今日次数**（模型回合已经花钱了，不管最后有没有发消息）
 */
import { localDayKey, minutesOfDay, inQuietHours, quietEndAfter } from './clock.js';

export const PURPOSE_NEEDS = Object.freeze(['share', 'ask', 'invite', 'confide', 'curious', 'followup']);
export const DEFAULT_PURPOSE_CONFIG = Object.freeze({
  quietStart: '23:30',
  quietEnd: '08:30',
  maxPerDay: 4,
  minGapMs: 3600000,        // 两次之间至少 1 小时
  firstDelayMs: 1800000,    // 启动后 30 分钟再说第一句
  pendingTtlMs: 7200000,    // 待发目的 2 小时过期
});

/** 驱动上升速率（每小时）：越"好奇"涨得越快；不是所有需求一个速度 */
const DRIVE_RISE = Object.freeze({
  share: 0.012, ask: 0.01, invite: 0.008, confide: 0.006, curious: 0.018, followup: 0.009,
});
const DRIVE_MIN = 0.05;
const DRIVE_MAX = 1;
/** 同一个话题在这么久内不重复主动说（话题多样性） */
export const TOPIC_REPEAT_MS = 6 * 60 * 60 * 1000;

/** 话题键：去标点/空白，取前 16 字；只用于"别重复"，不是语义理解 */
export function topicKey(text) {
  return String(text ?? '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '').slice(0, 16);
}

export function createPurpose({ config = DEFAULT_PURPOSE_CONFIG, now = () => Date.now() } = {}) {
  const cfg = { ...DEFAULT_PURPOSE_CONFIG, ...config };
  const state = {
    day: localDayKey(now()),
    countToday: 0,
    nextFireAt: 0,
    drives: { share: 0.4, ask: 0.3, invite: 0.3, confide: 0.2, curious: 0.5, followup: 0.2 },
    goals: [],          // 目标假设
    observations: [],   // 观察账本
    pending: [],        // 待发
    history: [],        // 已发
    lastSkip: null,
  };

  function ensureDay() {
    const d = localDayKey(now());
    if (state.day !== d) { state.day = d; state.countToday = 0; }
  }
  function planNextFire(from = now()) {
    state.nextFireAt = from + cfg.minGapMs;
    // 落在安静时段就推到安静结束
    if (inQuietHours(new Date(state.nextFireAt), cfg.quietStart, cfg.quietEnd)) {
      state.nextFireAt = quietEndAfter(new Date(state.nextFireAt), cfg.quietStart, cfg.quietEnd).getTime();
    }
    return state.nextFireAt;
  }
  if (!state.nextFireAt) planNextFire();

  return {
    get state() { return state; },

    /** 从落盘内容恢复（只恢复数据和排程，不恢复"正在进行的"副作用） */
    restore(snapshot) {
      if (!snapshot || typeof snapshot !== 'object') return state;
      for (const key of Object.keys(state)) {
        if (snapshot[key] !== undefined) state[key] = snapshot[key];
      }
      return state;
    },

    /**
     * 闸门：现在能不能说。
     * @param {object} ctx { budgetOk?:boolean, ownerBusy?:boolean }
     */
    canFire(ctx = {}) {
      ensureDay();
      if (inQuietHours(new Date(now()), cfg.quietStart, cfg.quietEnd)) return { ok: false, reason: 'quiet-hours' };
      if (state.countToday >= cfg.maxPerDay) return { ok: false, reason: 'daily-cap' };
      if (state.nextFireAt > now()) return { ok: false, reason: 'cooldown' };
      if (ctx.budgetOk === false) return { ok: false, reason: 'budget' };
      if (ctx.ownerBusy === true) return { ok: false, reason: 'owner-busy' };
      return { ok: true, reason: 'ok' };
    },

    /** 更新驱动：没被满足的需求慢慢升高（不同需求速度不同），封顶 1 */
    tickDrives({ hours = 1 } = {}) {
      const h = Math.max(0, Math.min(24, Number(hours) || 0));
      for (const k of PURPOSE_NEEDS) {
        const v = Number(state.drives[k]) || 0;
        state.drives[k] = Math.max(DRIVE_MIN, Math.min(DRIVE_MAX, v + (DRIVE_RISE[k] ?? 0.01) * h));
      }
      return { ...state.drives };
    },

    /** 从素材里提炼目标假设（带归属与置信度） */
    formGoals(materials = []) {
      const fresh = [];
      for (const m of materials.slice(0, 20)) {
        const key = `${m.owner ?? 'self'}:${topicKey(m.topic ?? m.text ?? '')}`;
        const seen = state.observations.find((o) => o.key === key);
        if (seen) { seen.hits += 1; seen.at = now(); continue; }
        state.observations.push({ key, hits: 1, at: now() });
        fresh.push({
          id: `g_${state.goals.length + fresh.length + 1}`,
          owner: m.owner === 'owner' ? 'owner' : 'self',
          confidence: 0.4,
          risk: m.risky ? 'high' : 'low',
          need: m.need ?? 'share',
          text: String(m.text ?? m.topic ?? '').slice(0, 120),
          status: 'hypothesis',
        });
      }
      // 观察次数越多，置信度越高（但封顶，避免"一次视频=永久欲望"）
      for (const g of state.goals) {
        const o = state.observations.find((x) => x.key.startsWith(`${g.owner}:`));
        if (o) g.confidence = Math.min(0.9, 0.4 + o.hits * 0.1);
      }
      state.goals = [...state.goals, ...fresh].slice(-40);
      return state.goals;
    },

    /**
     * 选一个目的：置信度 × 当前驱动，且避开最近说过的话题。
     * 话题多样性在这里做——不是靠"随机"，是靠"最近说过的先扣掉"。
     */
    select(materials = []) {
      this.formGoals(materials);
      const recent = state.history
        .filter((h) => now() - (Number(h.at) || 0) <= TOPIC_REPEAT_MS)
        .map((h) => h.topic ?? topicKey(h.text));
      const candidates = state.goals
        .filter((g) => g.status === 'hypothesis')
        .filter((g) => !recent.includes(topicKey(g.text)))
        .map((g) => {
          const drive = Number(state.drives[g.need]) || 0.3;
          const score = g.confidence * (0.6 + drive) * (g.need === 'share' ? 1.1 : 1);
          return { g, score };
        })
        .sort((a, b) => b.score - a.score);
      return candidates[0]?.g ?? null;
    },

    /**
     * 投递：**先占次数**（模型回合已经花钱了），再产出意图。
     * 说出去了 = 这个需求被满足了一部分 → 驱动降下来。
     * @returns {{intent:object, goal:object}|null}
     */
    fire({ goal, text }) {
      if (!goal) return null;
      ensureDay();
      state.countToday += 1;
      const topic = topicKey(text);
      state.history.push({ at: now(), text: String(text ?? '').slice(0, 200), need: goal.need, topic, goalId: goal.id });
      state.history = state.history.slice(-200);
      state.drives[goal.need] = Math.max(DRIVE_MIN, (Number(state.drives[goal.need]) || 0.3) * 0.45);
      goal.status = 'sent';
      planNextFire();
      return {
        goal,
        intent: { kind: 'say', text: String(text ?? ''), purpose: goal.need },
      };
    },

    /** 闭环：主人的回复改置信度；没回应反而让这个需求更"欠" */
    applyOutcome({ goalId, replied }) {
      const g = state.goals.find((x) => x.id === goalId);
      if (!g) return null;
      if (replied) {
        g.confidence = Math.min(0.95, g.confidence + 0.15);
        g.status = 'confirmed';
      } else {
        g.confidence = Math.max(0.05, g.confidence - 0.2);
        g.status = 'stale';
        state.drives[g.need] = Math.min(DRIVE_MAX, (Number(state.drives[g.need]) || 0.3) + 0.12);
      }
      return g;
    },

    /** 状态摘要（给设置页/诊断用，不返回提示词全文） */
    summary() {
      ensureDay();
      return {
        day: state.day,
        countToday: state.countToday,
        nextFireAt: state.nextFireAt,
        topDrive: Object.entries(state.drives).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
        goals: state.goals.length,
        observations: state.observations.length,
        history: state.history.length,
        lastSkip: state.lastSkip,
      };
    },
  };
}
