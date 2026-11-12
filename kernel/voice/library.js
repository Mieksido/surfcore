/**
 * 语音库：她有哪些声音、这句话该用哪个
 * ============================================================================
 * 位置：内核 voice 模块。**"她的声音"是关于她的东西**，不是平台的事。
 *
 * 语音库是可复用的声音目录：
 *   · 注册/删除/上限/统计
 *   · 按情绪/标签挑一个（挑不到就报没挑到，不硬凑）
 *   · 导入时的字段校验（名字/时长/标签，限长，脏值丢掉）
 * 音频解码、音色训练属于模型运行时，不在库这一层。
 */

export const DEFAULT_LIBRARY = Object.freeze({ max: 200, maxTags: 6, maxNameChars: 40 });

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);

/**
 * 校验一条语音包声明（导入时用；不合格的整条丢掉并说原因）
 * @returns {{ok:boolean, value?:object, error?:string}}
 */
export function normalizeVoice(raw = {}, cfg = DEFAULT_LIBRARY) {
  const id = clean(raw.id ?? raw.name, 64);
  if (!id) return { ok: false, error: '缺少 id' };
  const name = clean(raw.name ?? id, cfg.maxNameChars);
  const durationMs = Number(raw.durationMs);
  const hasDuration = raw.durationMs !== undefined && raw.durationMs !== null && raw.durationMs !== '';
  if (hasDuration && (!Number.isFinite(durationMs) || durationMs <= 0)) {
    return { ok: false, error: '时长必须是正数' };
  }
  const tags = Array.isArray(raw.tags) ? raw.tags.map((t) => clean(t, 16)).filter(Boolean).slice(0, cfg.maxTags) : [];
  return {
    ok: true,
    value: {
      id,
      name,
      emotion: clean(raw.emotion, 8),
      lang: clean(raw.lang ?? '', 8),
      tags,
      durationMs: Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : null,
      note: clean(raw.note, 80),
      uses: 0,
      addedAt: 0,
    },
  };
}

export function createVoiceLibrary({ max = DEFAULT_LIBRARY.max, now = () => Date.now() } = {}) {
  /** id → voice */
  const items = new Map();

  return {
    /** 注册一个声音（重复 id 不覆盖，返回已有的） */
    register(raw = {}) {
      const v = normalizeVoice(raw);
      if (!v.ok) return { ok: false, error: v.error };
      if (items.has(v.value.id)) return { ok: false, error: 'already-exists', value: items.get(v.value.id) };
      const item = { ...v.value, addedAt: now() };
      items.set(item.id, item);
      while (items.size > max) items.delete(items.keys().next().value);
      return { ok: true, value: item };
    },

    remove(id) { return items.delete(String(id ?? '').trim()); },

    /**
     * 挑一个声音：情绪对得上的优先，其次标签重合多的，最后用得少的。
     * 挑不到返回 null（不硬凑）。
     */
    pick({ emotion = '', tags = [], lang = '' } = {}) {
      const want = (Array.isArray(tags) ? tags : []).map(String);
      const e = clean(emotion, 8);
      const pool = [...items.values()].filter((v) => (lang ? v.lang === String(lang) : true));
      if (!pool.length) return null;

      const scored = pool.map((v) => {
        let score = 0;
        if (e && v.emotion === e) score += 3;
        score += want.filter((t) => v.tags.includes(t)).length * 2;
        score -= v.uses * 0.1;
        return { v, score };
      });

      // 只有给了条件时才要求"有分"，否则随便给一个（不限情绪）
      const needFilter = Boolean(e) || want.length > 0;
      const usable = needFilter ? scored.filter((x) => x.score > 0) : scored;
      if (!usable.length) return null;
      usable.sort((a, b) => b.score - a.score);
      return usable[0].v;
    },

    markUsed(id) {
      const v = items.get(String(id ?? '').trim());
      if (!v) return null;
      v.uses += 1;
      return v;
    },

    get(id) { return items.get(String(id ?? '').trim()) ?? null; },
    list() { return [...items.values()].map((v) => ({ ...v })); },
    size() { return items.size; },
    stats() {
      const byEmotion = {};
      for (const v of items.values()) if (v.emotion) byEmotion[v.emotion] = (byEmotion[v.emotion] ?? 0) + 1;
      return { total: items.size, byEmotion };
    },

    snapshot() { return [...items.values()].map((v) => ({ ...v })); },
    restore(saved = []) {
      items.clear();
      for (const raw of Array.isArray(saved) ? saved : []) {
        const v = normalizeVoice(raw);
        if (v.ok) items.set(v.value.id, { ...v.value, uses: Number(raw.uses) || 0, addedAt: Number(raw.addedAt) || 0 });
      }
      return items.size;
    },
  };
}
