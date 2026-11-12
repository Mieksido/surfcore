/**
 * 合批：连发三条，回一次
 * ============================================================================
 * 位置：内核（时机）。它只回答"现在该不该把这些消息并成一轮"，
 * 不负责计时、不负责调用模型——**计时是外部的事**（app/运行时驱动时钟）。
 *
 * 为什么不做成 setInterval：内核要保持"不启动世界也能测"，
 * 纯状态机 + 外部推进时间，才能单测（见 batch.test.mjs）。
 *
 * 铁律：不认识渠道名；channel 只是分桶键。
 */

export const DEFAULT_BATCH = Object.freeze({ windowMs: 8000, maxItems: 12, maxChars: 1200 });

export function createBatcher({ windowMs, maxItems, maxChars, now = () => Date.now() } = {}) {
  const cfg = {
    windowMs: Number(windowMs) > 0 ? Number(windowMs) : DEFAULT_BATCH.windowMs,
    maxItems: Number(maxItems) > 0 ? Number(maxItems) : DEFAULT_BATCH.maxItems,
    maxChars: Number(maxChars) > 0 ? Number(maxChars) : DEFAULT_BATCH.maxChars,
  };
  /** channel → { items:[], openedAt } */
  const buckets = new Map();

  const bucketOf = (channel) => {
    const key = String(channel ?? '');
    if (!buckets.has(key)) buckets.set(key, { items: [], openedAt: 0 });
    return buckets.get(key);
  };

  /** 把一桶消息并成一条（文本用换行接起来，其余字段取最新一条；**唤醒信号取并集**） */
  function merge(bucket, key) {
    const last = bucket.items[bucket.items.length - 1] ?? {};
    const text = bucket.items.map((x) => String(x.text ?? '')).filter(Boolean).join('\n').slice(0, cfg.maxChars);
    // 关键：任一条里"点了她"的信号都要保留，否则 @ 在前一条会被吞掉（顾问审阅抓到）
    const any = (flag) => bucket.items.some((x) => x?.[flag] === true);
    const merged = {
      ...last,
      text,
      // 只要桶里有任何一条 @/点名/关键词，合并后仍然算被叫
      mentioned: any('mentioned'),
      calledName: any('calledName'),
      keyword: any('keyword'),
      replyTo: last.replyTo,
      to: { ...(last.to ?? {}), owner: bucket.items.some((x) => x?.to?.owner === true) },
      batch: { count: bucket.items.length, from: bucket.items[0]?.from?.at ?? null, to: last?.from?.at ?? null },
    };
    return { mergedCount: bucket.items.length, channel: key, event: merged };
  }

  return {
    /**
     * 塞一条事件进来。
     * @returns {{ready:boolean, reason?:string, batch?:object}} ready=true 表示该并成一轮了
     */
    push(event = {}) {
      const key = String(event?.from?.channel ?? '');
      const at = Number(event?.from?.at) || now();
      const bucket = bucketOf(key);
      if (!bucket.items.length) bucket.openedAt = at;
      bucket.items.push(event);

      if (bucket.items.length >= cfg.maxItems) {
        const batch = merge(bucket, key);
        bucket.items = []; bucket.openedAt = 0;
        return { ready: true, reason: 'max-items', batch };
      }
      return { ready: false, reason: 'collecting' };
    },

    /**
     * 外部时钟推进：窗口到期的桶取出来。
     * @returns {Array<{channel:string, batch:object}>}
     */
    due(at) {
      const t = Number.isFinite(at) ? at : now();
      const out = [];
      for (const [key, bucket] of buckets) {
        if (!bucket.items.length) continue;
        if (t - bucket.openedAt >= cfg.windowMs) {
          const batch = merge(bucket, key);
          bucket.items = []; bucket.openedAt = 0;
          out.push({ channel: key, batch });
        }
      }
      return out;
    },

    /** 现在积着多少条（诊断） */
    pending() {
      let n = 0;
      for (const b of buckets.values()) n += b.items.length;
      return n;
    },

    config() { return { ...cfg }; },
  };
}
