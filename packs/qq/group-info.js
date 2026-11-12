/**
 * 群规模：这个群有多少人（给内核做"大群不插嘴"用）
 * ============================================================================
 * 位置：QQ 模块。**内核数不了人**（它只看得到消息，看不到花名册），
 * 所以由包去问网关，再把数字塞进事件的 `to.memberCount`。
 *
 * 三条规矩：
 *   · 缓存（默认 10 分钟）：群人数不会秒变，别每条消息问一次
 *   · 失败就返回 0（内核按小群处理，不会因为一次查询失败而静默乱判）
 *   · 并发只发一次请求（同一个群同时来多条消息时）
 */
export const DEFAULT_GROUP_INFO = Object.freeze({ ttlMs: 10 * 60 * 1000, maxGroups: 500 });

/**
 * @param {object} opts { client（必须实现 call）, ttlMs, maxGroups, now }
 */
export function createGroupInfo({ client, ttlMs, maxGroups, now = () => Date.now() } = {}) {
  if (!client || typeof client.call !== 'function') throw new Error('群规模查询需要 onebot 客户端');

  const cfg = {
    ttlMs: Number(ttlMs) > 0 ? Number(ttlMs) : DEFAULT_GROUP_INFO.ttlMs,
    maxGroups: Number(maxGroups) > 0 ? Number(maxGroups) : DEFAULT_GROUP_INFO.maxGroups,
  };
  /** groupId → { count, at } */
  const cache = new Map();
  /** groupId → Promise（并发合并） */
  const inflight = new Map();
  const stats = { hits: 0, misses: 0, failures: 0 };

  function remember(id, count) {
    cache.set(id, { count, at: now() });
    while (cache.size > cfg.maxGroups) cache.delete(cache.keys().next().value);
  }

  return {
    /**
     * 取群人数（带缓存）。
     * @returns {Promise<number>} 失败返回 0
     */
    async memberCount(groupId, { max = 0 } = {}) {
      const id = String(groupId ?? '').trim();
      if (!id) return 0;

      const hit = cache.get(id);
      if (hit && now() - hit.at < cfg.ttlMs) { stats.hits += 1; return hit.count; }

      if (inflight.has(id)) return inflight.get(id);

      const task = (async () => {
        stats.misses += 1;
        try {
          const res = await client.call('get_group_info', { group_id: Number(id) || id });
          const data = res?.data ?? res ?? {};
          const count = Number(data.member_count ?? data.memberCount ?? 0);
          const safe = Number.isFinite(count) && count >= 0 ? count : 0;
          if (safe > 0) remember(id, safe);
          return safe;
        } catch {
          stats.failures += 1;
          return 0;
        } finally {
          inflight.delete(id);
        }
      })();

      inflight.set(id, task);
      return task;
    },

    /** 直接塞一个已知值（测试/网关主动推送时用） */
    prime(groupId, count) {
      const id = String(groupId ?? '').trim();
      const n = Number(count);
      if (id && Number.isFinite(n) && n >= 0) remember(id, n);
    },

    stats() { return { ...stats, size: cache.size }; },
    config() { return { ...cfg }; },
  };
}
