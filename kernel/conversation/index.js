/**
 * 对话窗口：她还记得"刚才聊了几句"
 * ============================================================================
 * 为什么单开这个模块：**这是"这次对话"的状态，不是"她一生的记忆"**。
 * 混进记忆库会把随口一句当成永久记忆；混进提示词组装会让表达层管状态。
 *
 * 位置：内核（关于"她记不记得刚才"的判断）。
 * 形状：按频道分桶的环形窗口，满了把最旧的挪进 pending；pending 攒够一批
 * 再由内核调模型压成 summary（本模块只存/渲染，不调模型）。
 *
 * 铁律：本文件不认识任何渠道名；channel 只是不透明字符串。
 */
import { DEFAULT_SUMMARY, mergeSummary, renderSummaryBlock } from './summary.js';

export const DEFAULT_WINDOW = Object.freeze({
  maxTurns: 8,
  maxChars: 600,
  maxPending: DEFAULT_SUMMARY.maxPending,
});

export function createConversationWindow({ maxTurns, maxChars, maxPending, now = () => Date.now() } = {}) {
  const cfg = {
    maxTurns: Number(maxTurns) > 0 ? Number(maxTurns) : DEFAULT_WINDOW.maxTurns,
    maxChars: Number(maxChars) > 0 ? Number(maxChars) : DEFAULT_WINDOW.maxChars,
    maxPending: Number(maxPending) > 0 ? Number(maxPending) : DEFAULT_WINDOW.maxPending,
  };
  /** channel → [{ role:'user'|'her', actor, text, at }] */
  const buckets = new Map();
  /** channel → 被挤出去、等摘要的旧轮次 */
  const pending = new Map();
  /** channel → 旧轮次摘要（纯文本） */
  const summaries = new Map();

  const bucketOf = (channel) => {
    const key = String(channel ?? '');
    if (!buckets.has(key)) buckets.set(key, []);
    return buckets.get(key);
  };
  const pendingOf = (channel) => {
    const key = String(channel ?? '');
    if (!pending.has(key)) pending.set(key, []);
    return pending.get(key);
  };

  return {
    /**
     * 记一轮。窗口满了：最旧的挪进 pending（不丢），等内核摘要。
     * @param {object} turn { channel, role, actor, text, at }
     */
    append({ channel, role = 'user', actor = null, text = '', at } = {}) {
      const body = String(text ?? '').trim();
      if (!body) return null;
      const list = bucketOf(channel);
      const turn = { role: role === 'her' ? 'her' : 'user', actor: actor === null ? null : String(actor), text: body, at: Number(at) || now() };
      list.push(turn);
      while (list.length > cfg.maxTurns) {
        const dropped = list.shift();
        const p = pendingOf(channel);
        p.push(dropped);
        while (p.length > cfg.maxPending) p.shift();
      }
      return turn;
    },

    /**
     * 渲染成提示词里的一段（只给文本，不给结构）。
     * 顺序：已有摘要 → pending 旧轮次 → 最近窗口；总字数受 maxChars 约束。
     * @returns {string}
     */
    render(channel, { maxChars } = {}) {
      const key = String(channel ?? '');
      const cap = Number(maxChars) > 0 ? Number(maxChars) : cfg.maxChars;
      let summary = String(summaries.get(key) ?? '').trim();
      if (summary) {
        summary = renderSummaryBlock(summary);
        if (summary.length > cap) summary = summary.slice(0, cap);
      }
      const list = [...(pending.get(key) ?? []), ...(buckets.get(key) ?? [])];
      const budget = Math.max(0, cap - (summary ? summary.length + 1 : 0));
      const lines = [];
      let used = 0;
      // 从最新往回取，凑够字数再翻回来（保证"最近的"一定在）
      for (let i = list.length - 1; i >= 0; i--) {
        const t = list[i];
        const who = t.role === 'her' ? '她' : (t.actor ? String(t.actor) : '对方');
        const line = `- ${who}：${t.text}`;
        if (used + line.length > budget) break;
        lines.unshift(line);
        used += line.length + 1;
      }
      return [summary, lines.join('\n')].filter(Boolean).join('\n');
    },

    /** 某个频道现在有几轮（不含 pending） */
    countOf(channel) { return (buckets.get(String(channel ?? '')) ?? []).length; },

    /** 等摘要的旧轮次（副本） */
    pendingOf(channel) { return (pending.get(String(channel ?? '')) ?? []).slice(); },

    /** 已有摘要（纯文本） */
    summaryOf(channel) { return String(summaries.get(String(channel ?? '')) ?? ''); },

    /**
     * 现在值不值得调一次模型做摘要。
     * @returns {{should:boolean, count:number, chars:number, turns:object[]}}
     */
    compaction(channel, { minTurns = DEFAULT_SUMMARY.minTurns, minChars = DEFAULT_SUMMARY.minChars } = {}) {
      const list = pending.get(String(channel ?? '')) ?? [];
      const chars = list.reduce((n, t) => n + String(t.text ?? '').length, 0);
      const should = list.length >= Math.max(1, Number(minTurns) || DEFAULT_SUMMARY.minTurns)
        || chars >= Math.max(1, Number(minChars) || DEFAULT_SUMMARY.minChars);
      return { should, count: list.length, chars, turns: list.slice() };
    },

    /**
     * 摘要成功：把被摘要覆盖的旧轮次从 pending 移走，并合并摘要。
     * @param {object} input { text, count, maxChars }
     */
    applySummary(channel, { text = '', count = 0, maxChars = DEFAULT_SUMMARY.maxChars } = {}) {
      const key = String(channel ?? '');
      const body = String(text ?? '').trim();
      if (!body) return null;
      const p = pending.get(key) ?? [];
      const n = Math.max(0, Math.min(p.length, Number(count) || 0));
      if (n) p.splice(0, n);
      const merged = mergeSummary(summaries.get(key) ?? '', body, { maxChars });
      summaries.set(key, merged);
      return merged;
    },

    /** 忘掉某个频道的对话（比如收尾之后） */
    clear(channel) {
      const key = String(channel ?? '');
      buckets.delete(key);
      pending.delete(key);
      summaries.delete(key);
    },

    /** 诊断 */
    stats() {
      let turns = 0;
      let pendingTurns = 0;
      for (const list of buckets.values()) turns += list.length;
      for (const list of pending.values()) pendingTurns += list.length;
      return {
        channels: buckets.size,
        turns,
        pending: pendingTurns,
        summaries: summaries.size,
        maxTurns: cfg.maxTurns,
        maxChars: cfg.maxChars,
      };
    },

    /** 落盘用：按频道交出全部轮次 */
    snapshot() {
      const out = {};
      for (const [k, list] of buckets) out[k] = list.slice();
      return out;
    },

    /** 摘要/待摘要的落盘（与轮次分开，旧状态文件仍然能读） */
    archive() {
      return {
        summaries: Object.fromEntries([...summaries.entries()].map(([k, v]) => [k, String(v)])),
        pending: Object.fromEntries([...pending.entries()].map(([k, v]) => [k, v.slice()])),
      };
    },

    restoreArchive(saved = {}) {
      summaries.clear();
      pending.clear();
      for (const [k, v] of Object.entries(saved?.summaries ?? {})) {
        if (String(v ?? '').trim()) summaries.set(String(k), String(v).slice(0, DEFAULT_SUMMARY.maxChars));
      }
      for (const [k, list] of Object.entries(saved?.pending ?? {})) {
        if (Array.isArray(list)) pending.set(String(k), list.slice(-cfg.maxPending));
      }
      return {
        summaries: summaries.size,
        pending: [...pending.values()].reduce((n, l) => n + l.length, 0),
      };
    },

    /** 读盘用：整份替换（轮次；摘要由 restoreArchive 另恢复） */
    restore(saved = {}) {
      buckets.clear();
      summaries.clear();
      pending.clear();
      for (const [k, list] of Object.entries(saved ?? {})) {
        if (!Array.isArray(list)) continue;
        buckets.set(String(k), list.slice(-cfg.maxTurns));
      }
      return buckets.size;
    },

    config() { return { ...cfg }; },
  };
}
