/**
 * 对话收尾：什么时候"这段聊完了"
 * ============================================================================
 * 为什么单独一个模块：**"该收尾了"是关于她的判断**，不是运送、也不是渠道。
 * 旧代码 conversation-closure.js 523 行把它混在桥里，这里只保留判断本身。
 *
 * 它不负责发消息、不负责记结束点——只回答：现在该不该提出收尾。
 * 真正收尾走现有 `close` 意图（不新增消息类型）。
 *
 * 判据（都是"像人"的经验）：
 *   · 对方说了收尾语（晚安/拜拜/先这样）→ 立刻可以收
 *   · 安静超过 idleMs             → 可以收
 *   · 已经来回超过 maxTurns 且最近没有新话题 → 可以收
 */

/** 收尾语（中英混排，窄表；不认识渠道） */
const CLOSING_RE = /(晚安|拜拜|bye+|先这样|回头聊|明天见|睡了|下线|溜了|吃饭去了)/i;

export const DEFAULT_CLOSURE = Object.freeze({ idleMs: 20 * 60 * 1000, maxTurns: 30 });

export function createClosure({ idleMs, maxTurns, now = () => Date.now() } = {}) {
  const cfg = {
    idleMs: Number(idleMs) > 0 ? Number(idleMs) : DEFAULT_CLOSURE.idleMs,
    maxTurns: Number(maxTurns) > 0 ? Number(maxTurns) : DEFAULT_CLOSURE.maxTurns,
  };
  /** channel → { lastAt, turns, closedAt } */
  const state = new Map();

  const of = (channel) => {
    const key = String(channel ?? '');
    if (!state.has(key)) state.set(key, { lastAt: 0, turns: 0, closedAt: 0 });
    return state.get(key);
  };

  return {
    /** 每来一条消息就记一次 */
    touch(channel, at) {
      const s = of(channel);
      s.lastAt = Number(at) || now();
      s.turns += 1;
      return s;
    },

    /**
     * 该不该收尾。
     * @param {object} input { channel, text, at }
     * @returns {{close:boolean, reason:string, hint?:string}}
     */
    shouldClose({ channel, text = '', at } = {}) {
      const s = of(channel);
      const t = Number(at) || now();

      if (CLOSING_RE.test(String(text))) return { close: true, reason: 'explicit-farewell', hint: '对方在道别：收住，记下结束点' };
      if (s.lastAt && t - s.lastAt >= cfg.idleMs) return { close: true, reason: 'idle', hint: '安静太久了：可以收尾' };
      if (s.turns >= cfg.maxTurns) return { close: true, reason: 'too-long', hint: '聊太久了：该收个尾，别硬撑' };
      return { close: false, reason: s.turns ? 'ongoing' : 'not-started' };
    },

    /** 收尾之后调用：清掉这段的计数（下一段重新开始） */
    closed(channel, at) {
      const s = of(channel);
      s.closedAt = Number(at) || now();
      s.turns = 0;
      s.lastAt = 0;
      return s;
    },

    /** 诊断 */
    stats(channel) {
      const s = of(channel);
      return { turns: s.turns, lastAt: s.lastAt, closedAt: s.closedAt, ...cfg };
    },

    /** 落盘用 */
    snapshot() {
      const out = {};
      for (const [k, v] of state) out[k] = { ...v };
      return out;
    },

    /** 读盘用 */
    restore(saved = {}) {
      state.clear();
      for (const [k, v] of Object.entries(saved ?? {})) {
        if (!v || typeof v !== 'object') continue;
        state.set(String(k), { lastAt: Number(v.lastAt) || 0, turns: Number(v.turns) || 0, closedAt: Number(v.closedAt) || 0 });
      }
      return state.size;
    },

    config() { return { ...cfg }; },
  };
}
