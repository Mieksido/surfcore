/**
 * 发件箱：把"发失败"变成"有节制地再试"
 * ============================================================================
 * 旧代码 outbox.js 138 行做的事，搬到运行时（管道）——因为它只关心"运送"，
 * 不关心"该不该说"。
 *
 * 三条规矩（都是踩过的坑）：
 *   ① **`unconfirmed` 永不重试**：可能已经发出去了，重试就是重复发消息
 *   ② **只重试 retryable 的失败**：鉴权/参数错误重试只是再撞一次墙
 *   ③ **同一编号只投一次**：幂等在运行时已有，发件箱再兜一层
 */
export const DEFAULT_OUTBOX = Object.freeze({ maxAttempts: 3, baseMs: 500, factor: 2, maxMs: 8000 });

/**
 * @param {object} opts
 *   { deliver(intent)→ack, maxAttempts, baseMs, factor, maxMs, sleep, now }
 */
export function createOutbox({ deliver, ...options } = {}) {
  if (typeof deliver !== 'function') throw new Error('发件箱需要一个 deliver(intent)');
  const cfg = { ...DEFAULT_OUTBOX, ...options };
  const sleep = cfg.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = cfg.now ?? (() => Date.now());

  const done = new Map();     // intent.id → 最终回执（已成功的）
  const stats = { sent: 0, retried: 0, failed: 0, skipped: 0 };

  return {
    /**
     * 投递一条意图（带重试）。
     * @returns {Promise<object>} 最终回执（与运行时回执同形）
     */
    async send(intent = {}) {
      const id = intent.id === undefined ? null : String(intent.id);
      if (id && done.has(id)) { stats.skipped += 1; return done.get(id); }

      let attempt = 0;
      let last = null;
      while (attempt < cfg.maxAttempts) {
        attempt += 1;
        last = await deliver(intent);
        const status = last?.status;

        if (status === 'delivered') {
          stats.sent += 1;
          if (id) done.set(id, last);
          return { ...last, attempts: attempt };
        }
        if (status === 'unconfirmed') {
          // 可能已经发出去了：不重试，也不记为成功
          stats.failed += 1;
          if (id) done.set(id, last);
          return { ...last, attempts: attempt, note: '已发出但无法确认：不再重试' };
        }
        const retryable = last?.error?.retryable !== false;
        if (status === 'unsupported' || !retryable) break;

        if (attempt < cfg.maxAttempts) {
          stats.retried += 1;
          const wait = Math.min(cfg.maxMs, cfg.baseMs * (cfg.factor ** (attempt - 1)));
          await sleep(wait);
        }
      }

      stats.failed += 1;
      if (id) done.set(id, last);   // 记住失败，避免同一编号反复打
      return { ...(last ?? {}), attempts: attempt };
    },

    stats() { return { ...stats }; },
    /** 清掉"已送到"的记录（长时间跑用；不影响幂等，那是运行时的事） */
    clearDelivered() { done.clear(); },
    now,
  };
}
