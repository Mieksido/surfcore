/**
 * 表情库：她自己的收藏
 * ============================================================================
 * 为什么在内核：**收藏是"她的东西"**（旧代码 sticker-lib 356 + sticker-semantics 562）。
 * 但图片本体不在这里——这里只存 `mediaId`，本体在媒体库（内核 memory/media）。
 *
 * 两条规矩：
 *   · 只存"引用 + 语义"（情绪/标签/备注），不复制图片
 *   · 选表情是"关于她的判断"，发送走现有 `send_media`
 */
import { normalizeEmotion, emotionOf, emotionScore, NEUTRAL } from './semantics.js';

export const STICKER_EMOTIONS = Object.freeze(['开心', '搞笑', '得意', '嘲讽', '卖萌', '委屈', '无语', '摆烂', '安慰', '赞同', '惊讶', '告别']);

export function createStickerBook({ max = 500, now = () => Date.now() } = {}) {
  /** id → { id, mediaId, emotion, tags, note, uses, addedAt, lastUsedAt } */
  const items = new Map();

  return {
    /**
     * 收一张表情。
     * @param {object} input { id, mediaId, emotion, tags, note }
     */
    add({ id, mediaId, emotion = '平淡', tags = [], note = '' } = {}) {
      const key = String(id ?? mediaId ?? '').trim();
      if (!key) return null;
      if (items.has(key)) return items.get(key);
      const item = {
        id: key,
        mediaId: String(mediaId ?? key),
        emotion: STICKER_EMOTIONS.includes(emotion) ? emotion : '平淡',
        tags: (Array.isArray(tags) ? tags : []).map(String).slice(0, 8),
        note: String(note ?? '').slice(0, 120),
        uses: 0,
        addedAt: now(),
        lastUsedAt: 0,
      };
      items.set(key, item);
      while (items.size > max) items.delete(items.keys().next().value);
      return item;
    },

    /** 丢掉一张 */
    remove(id) { return items.delete(String(id ?? '').trim()); },

    /**
     * 挑几张：标签是硬筛子；情绪可以给，也可以从原话里推断
     * （说法不同也能挑对——"绷不住"算搞笑）；相近情绪给部分分。
     * @returns {Array} 最多 n 条
     */
    pick({ emotion, tags = [], text = '', max = 3 } = {}) {
      const want = Array.isArray(tags) ? tags.map(String) : [];
      const asked = String(emotion ?? '').trim();
      const norm = normalizeEmotion(asked);
      // 给了情绪但词典里没有 → 就是"没有这种"，返回空（不硬凑）
      if (asked && !norm) return [];
      const target = norm || (text ? emotionOf(text) : '');
      const filtered = [...items.values()].filter((it) => {
        if (want.length && !want.some((t) => it.tags.includes(t))) return false;
        if (target && target !== NEUTRAL && emotionScore(target, it.emotion) <= 0) return false;
        return true;
      });
      const scored = filtered.map((it) => {
        const tagHit = want.filter((t) => it.tags.includes(t)).length;
        const emo = target ? emotionScore(target, it.emotion) : 0;
        return { it, score: emo * 3 + tagHit * 2 - it.uses * 0.1 };
      }).sort((a, b) => b.score - a.score);
      return scored.slice(0, Math.max(0, Number(max) || 0)).map((x) => x.it);
    },

    /** 用了一次：计数 + 时间（下次优先给别人） */
    use(id) {
      const it = items.get(String(id ?? '').trim());
      if (!it) return null;
      it.uses += 1;
      it.lastUsedAt = now();
      return it;
    },

    /** 渲染成提示词的一段（只给"我有哪些情绪的表情"，不给全部清单） */
    render({ maxChars = 200 } = {}) {
      if (!items.size) return '';
      const byEmotion = new Map();
      for (const it of items.values()) byEmotion.set(it.emotion, (byEmotion.get(it.emotion) ?? 0) + 1);
      const parts = [...byEmotion.entries()].map(([e, n]) => `${e}×${n}`);
      const text = `我收藏的表情：${parts.join('，')}`;
      return text.slice(0, maxChars);
    },

    list() { return [...items.values()]; },
    size() { return items.size; },

    /** 落盘用 */
    snapshot() { return [...items.values()].map((x) => ({ ...x })); },

    /** 读盘用 */
    restore(saved = []) {
      items.clear();
      for (const it of Array.isArray(saved) ? saved : []) {
        if (!it?.id) continue;
        items.set(String(it.id), { ...it });
      }
      return items.size;
    },
    stats() {
      const byEmotion = {};
      for (const it of items.values()) byEmotion[it.emotion] = (byEmotion[it.emotion] ?? 0) + 1;
      return { total: items.size, byEmotion };
    },
  };
}
