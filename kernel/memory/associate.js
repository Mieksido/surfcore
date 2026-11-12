/**
 * 关联/联想：这件事让她想起别的什么事
 * ============================================================================
 * 位置：内存模块内部策略（纯函数）。**不改接口。**
 *
 * 为什么不是"渠道专属"：关联只看两条记录**共有的东西**（标签、词），
 * 不看它们来自哪个外部来源。不同来源的两条记忆，可能因为同一个词关联起来。
 *
 * 两条判据：
 *   · 共有标签（主题/实体 tag）→ 强关联
 *   · 2-gram 重合数 ≥ 2 → 弱关联（"上次说的那个"能找回来）
 */

function bigramsOf(text) {
  const s = String(text ?? '').toLowerCase();
  const out = new Set();
  for (const w of s.match(/[a-z0-9]{2,}/g) ?? []) out.add(w);
  const cn = s.replace(/[^\u4e00-\u9fa5]/g, '');
  for (let i = 0; i < cn.length - 1; i++) out.add(cn.slice(i, i + 2));
  return out;
}

const tagsOf = (r) => (Array.isArray(r?.tags) ? r.tags.map(String) : []);

/**
 * 和某条记录相关的其他记录。
 * @param {object} probe 可以是记录，也可以是 `{ text, tags }`
 * @param {Array} pool 候选（调用方已按可见性过滤）
 * @param {object} opts { max, minSharedGrams, exclude }
 * @returns {Array<{record:object, score:number, via:string}>}
 */
export function relatedTo(probe = {}, pool = [], { max = 3, minSharedGrams = 2, exclude = null } = {}) {
  const probeTags = new Set(tagsOf(probe));
  const probeGrams = bigramsOf(probe.text);

  const scored = [];
  for (const r of Array.isArray(pool) ? pool : []) {
    if (!r || r === exclude || r === probe) continue;
    const sharedTags = tagsOf(r).filter((t) => probeTags.has(t));
    const sharedGrams = [...bigramsOf(r.text)].filter((g) => probeGrams.has(g)).length;

    let score = 0;
    let via = '';
    if (sharedTags.length) { score += sharedTags.length * 3; via = `标签:${sharedTags[0]}`; }
    if (sharedGrams >= minSharedGrams) { score += Math.min(sharedGrams, 6); via = via || `同词:${sharedGrams}`; }
    if (score > 0) scored.push({ record: r, score, via });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, Math.max(0, Number(max) || 0));
}

/**
 * 把记录按关联聚成簇（主题），给"她想起一件事"用。
 * @returns {Array<{key:string, size:number, records:Array}>}
 */
export function cluster(records = [], { minSize = 2, max = 5 } = {}) {
  const list = Array.isArray(records) ? records : [];
  const used = new Set();
  const out = [];

  // 先按标签聚（最强的关联）
  const byTag = new Map();
  for (const [i, r] of list.entries()) {
    for (const t of tagsOf(r)) {
      const bucket = byTag.get(t) ?? [];
      bucket.push({ r, i });
      byTag.set(t, bucket);
    }
  }
  for (const [tag, bucket] of [...byTag.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (out.length >= max) break;
    const fresh = bucket.filter(({ i }) => !used.has(i));
    if (fresh.length < minSize) continue;
    for (const { i } of fresh) used.add(i);
    out.push({ key: tag, size: fresh.length, records: fresh.map((x) => x.r) });
  }

  return out;
}
