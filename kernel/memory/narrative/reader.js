/**
 * 叙事读取器（兼容层 · 将来会被淘汰）
 * ============================================================================
 * 定位（用户 2026-11-09 拍板）：**叙事记忆效果太差，迟早淘汰**，留着只为照顾部分用户。
 * 所以这里只做"能用、能被整块删掉"，**不改进算法**。
 *
 * 它现在做的两件事（后续再补衰减，见叙事记忆 16 条行为清单）：
 *   ① 按日期分组、按重要度排序
 *   ② 在预算字数内输出，超了就少放（丢最不重要的）
 *
 * 输出必须和向量读取器完全一致：{ text, refs }
 */

/** 日期只留 YYYY-MM-DD，提示词里不需要精确到秒 */
function dayOf(ms) {
  const d = new Date(Number(ms) || Date.now());
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 分节与配额（旧代码的做法）：先给"最近"，再给"最初/主人"，
 * 防止"永远在回忆第一天"。锚点（初遇/最初）永不裁。
 */
export const SECTIONS = Object.freeze([
  { id: 'firstMeet', title: '最初的相遇', pick: (r) => r.firstMeet === true, quota: 1, neverTrim: true },
  { id: 'initial', title: '最初的事', pick: (r) => r.initial === true && r.firstMeet !== true, quota: 6 },
  { id: 'owner', title: '关于主人', pick: (r) => r.to?.owner === true, quota: 8 },
  { id: 'recent', title: '最近', pick: (r) => r.clarity !== 'fuzzy' && r.clarity !== 'trace', quota: 12 },
  { id: 'fuzzy', title: '有点模糊的事', pick: (r) => r.clarity === 'fuzzy', quota: 4 },
  { id: 'trace', title: '想不太起来', pick: (r) => r.clarity === 'trace', quota: 2 },
]);

/** 模糊的记录只留一小段；想不起来只留标题（旧代码的做法） */
const CLARITY_LIMIT = { vivid: Infinity, clear: Infinity, fuzzy: 42, trace: 12, forgotten: 0 };

export function createNarrativeReader() {
  return {
    name: 'narrative',

    /**
     * @param {object} ctx { records（已按可见性过滤）, viewer, query }
     * @returns {{text:string, refs:object[]}}   ← **形状不变**
     */
    build({ records = [], query = {} } = {}) {
      const maxChars = Number(query.maxChars) > 0 ? Number(query.maxChars) : 1200;
      const limitOf = (r) => CLARITY_LIMIT[r.clarity] ?? Infinity;
      const bodyOf = (r) => {
        const raw = String(r.text ?? '');
        const cap = limitOf(r);
        let body = raw.length > cap ? `${raw.slice(0, cap)}…` : raw;
        if (Array.isArray(r.media) && r.media.length) body += `（另有 ${r.media.length} 份媒体）`;
        return body;
      };

      const usedIdx = new Set();
      const lines = [];
      const refs = [];
      let used = 0;

      for (const section of SECTIONS) {
        const picked = records
          .map((r, i) => ({ r, i }))
          .filter(({ r, i }) => !usedIdx.has(i) && section.pick(r))
          .sort((a, b) => (Number(b.r.importance) || 0) - (Number(a.r.importance) || 0) || (b.r.from?.at ?? 0) - (a.r.from?.at ?? 0))
          .slice(0, section.quota ?? 4);

        const sectionLines = [];
        for (const { r, i } of picked) {
          const line = `- ${dayOf(r.from?.at)} [${r.importance ?? 0}] ${bodyOf(r)}`;
          if (!section.neverTrim && used + line.length > maxChars) break;
          sectionLines.push(line);
          usedIdx.add(i);
          used += line.length;
          refs.push({ channel: r.from?.channel, at: r.from?.at, importance: r.importance, source: r.source, scene: r.from?.scene ?? 'public', section: section.id });
        }
        if (sectionLines.length) lines.push(`【${section.title}】`, ...sectionLines);
      }

      if (!lines.length) return { text: '', refs: [] };
      return { text: ['【记忆】', ...lines].join('\n'), refs };
    },
  };
}
