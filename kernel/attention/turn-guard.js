/**
 * 轮次守卫：压住"同一个人短时间刷屏"
 * ============================================================================
 * 旧代码里这份逻辑散在 bridge 里（turn-guard.js 112 行）。搬到内核后的定位：
 *
 *   它**不判断该不该回**（那是注意力的事），只判断"这个人的轮次是否过密"。
 *   所以它不改唤醒理由，只在唤醒判断之后加一道"闸"。
 *
 * 纯状态机：喂 (actor, now)，给 { allow, reason, count }。无 IO、可单测。
 */

/**
 * 默认：同一个人 60 秒内最多 6 轮；**最小间隔默认关闭**。
 *
 * 为什么最小间隔默认 0：连发两条是人的正常行为，合批会把它并成一轮；
 * 在守卫这里直接挡掉，会变成"她不理你"。只有明确要压刷屏时才开它。
 */
export const DEFAULT_TURN_GUARD = Object.freeze({
  windowMs: 60000,
  maxPerWindow: 6,
  minGapMs: 0,
});

export function createTurnGuard({ windowMs, maxPerWindow, minGapMs, now = () => Date.now() } = {}) {
  const cfg = { ...DEFAULT_TURN_GUARD, ...(windowMs !== undefined ? { windowMs } : {}), ...(maxPerWindow !== undefined ? { maxPerWindow } : {}), ...(minGapMs !== undefined ? { minGapMs } : {}) };
  /** actor → 最近轮次时刻（只留窗口内的） */
  const recent = new Map();

  function prune(actor, t) {
    const list = (recent.get(actor) ?? []).filter((x) => t - x <= cfg.windowMs);
    recent.set(actor, list);
    return list;
  }

  return {
    /**
     * @param {object} input { actor, now? }
     * @returns {{allow:boolean, reason:string, count:number}}
     */
    check({ actor, now: at } = {}) {
      const t = Number.isFinite(at) ? at : now();
      const key = String(actor ?? '');
      if (!key) return { allow: true, reason: 'no-actor', count: 0 };

      const list = prune(key, t);
      if (list.length >= cfg.maxPerWindow) {
        return { allow: false, reason: 'too-many-turns', count: list.length };
      }
      const last = list[list.length - 1];
      if (cfg.minGapMs > 0 && last !== undefined && t - last < cfg.minGapMs) {
        return { allow: false, reason: 'too-fast', count: list.length };
      }
      list.push(t);
      recent.set(key, list);
      return { allow: true, reason: 'ok', count: list.length };
    },

    /** 诊断：某个人现在窗口里有几轮 */
    countOf(actor) { return prune(String(actor ?? ''), now()).length; },
    config() { return { ...cfg }; },
    reset() { recent.clear(); },
  };
}
