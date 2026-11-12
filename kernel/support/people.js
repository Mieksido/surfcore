/**
 * 谁是谁：把同一个人的多个来源账号连起来
 * ============================================================================
 * 位置：内核 support（身份）。**"谁是谁"是关于人的知识**，不是外部来源的事。
 *
 * 搬自旧 align.js（506 行）的四条原则，一条没改：
 *   ① 对齐**高于**记忆同步：两边同步都关了，她仍该认出同一个人
 *   ② 只存「账号 ↔ 账号」的映射与昵称，**不存任何对话内容**
 *   ③ **候选必须管理员批准**（requireApproval 默认 true），绝不把猜测变成事实
 *   ④ 跨来源展示时只带"公开侧信息"（昵称），不带对方私有账号
 *
 * 不认识任何具体来源名：source 只是一个不透明字符串（外部层自己填）。
 */

export const DEFAULT_ALIGN = Object.freeze({ requireApproval: true, maxCandidates: 200, maxLinks: 500 });

const clean = (s, max = 40) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);

export function createPeople({ requireApproval = DEFAULT_ALIGN.requireApproval, maxCandidates = DEFAULT_ALIGN.maxCandidates, maxLinks = DEFAULT_ALIGN.maxLinks, now = () => Date.now() } = {}) {
  /** link: { id, identities: { [source]: { id, name } }, createdAt } */
  const links = [];
  /** candidate: { id, a, b, reason, score, at } */
  const candidates = [];
  let seq = 0;

  const key = (source, id) => `${String(source ?? '')}:${String(id ?? '')}`;

  /** 这个账号属于谁（没有就 null） */
  function personOf(source, actorId) {
    const k = key(source, actorId);
    for (const link of links) {
      for (const [s, ident] of Object.entries(link.identities)) {
        if (key(s, ident.id) === k) return link;
      }
    }
    return null;
  }

  return {
    /** 查：这个账号是不是已经认出是谁了 */
    resolve(source, actorId) {
      const link = personOf(source, actorId);
      if (!link) return null;
      const others = {};
      for (const [s, ident] of Object.entries(link.identities)) {
        if (key(s, ident.id) !== key(source, actorId)) others[s] = { ...ident };
      }
      return { personId: link.id, others };
    },

    /**
     * 提一个候选（不做决定）。
     * @returns {object|null}
     */
    propose({ a, b, reason = '', score = 0 } = {}) {
      const norm = (x) => (x && x.source && x.id ? { source: clean(x.source, 20), id: clean(x.id, 32), name: clean(x.name, 40) } : null);
      const A = norm(a);
      const B = norm(b);
      if (!A || !B) return null;
      if (A.source === B.source) return null;                       // 同平台不用对齐
      if (personOf(A.source, A.id) || personOf(B.source, B.id)) return null;  // 已经连过了

      const dupKey = [key(A.source, A.id), key(B.source, B.id)].sort().join('|');
      const exist = candidates.find((c) => c._k === dupKey);
      if (exist) { exist.score = Math.max(exist.score, Number(score) || 0); exist.at = Number(now()); return exist; }

      seq += 1;
      const item = { id: `c${seq}`, a: A, b: B, reason: clean(reason, 120), score: Number(score) || 0, at: Number(now()), _k: dupKey };
      candidates.push(item);
      while (candidates.length > maxCandidates) candidates.shift();
      return item;
    },

    /** 管理员批准：候选 → 链接（requireApproval=false 时 propose 之后可自动调） */
    approve(candidateId) {
      const idx = candidates.findIndex((c) => c.id === String(candidateId));
      if (idx < 0) return null;
      const [c] = candidates.splice(idx, 1);
      const existing = personOf(c.a.source, c.a.id) ?? personOf(c.b.source, c.b.id);
      if (existing) {
        existing.identities[c.a.source] = { id: c.a.id, name: c.a.name };
        existing.identities[c.b.source] = { id: c.b.id, name: c.b.name };
        return existing;
      }
      seq += 1;
      const link = {
        id: `p${seq}`,
        identities: { [c.a.source]: { id: c.a.id, name: c.a.name }, [c.b.source]: { id: c.b.id, name: c.b.name } },
        createdAt: Number(now()),
      };
      links.push(link);
      while (links.length > maxLinks) links.shift();
      return link;
    },

    /** 管理员否掉 */
    reject(candidateId) {
      const idx = candidates.findIndex((c) => c.id === String(candidateId));
      if (idx < 0) return false;
      candidates.splice(idx, 1);
      return true;
    },

    /**
     * 展示用：这个账号在"别的平台"那边应该叫什么。
     * 隐私口径：只给昵称，不给对方的私有账号串。
     */
    displayName(source, actorId) {
      const link = personOf(source, actorId);
      if (!link) return '';
      const names = Object.entries(link.identities)
        .filter(([s]) => s !== String(source ?? ''))
        .map(([, ident]) => ident.name)
        .filter(Boolean);
      return names[0] ?? '';
    },

    pending() { return candidates.map(({ _k, ...rest }) => rest); },
    list() { return links.map((l) => ({ id: l.id, identities: JSON.parse(JSON.stringify(l.identities)), createdAt: l.createdAt })); },
    stats() { return { links: links.length, candidates: candidates.length, requireApproval }; },

    snapshot() {
      return {
        requireApproval,
        links: links.map((l) => ({ ...l, identities: JSON.parse(JSON.stringify(l.identities)) })),
        candidates: candidates.map((c) => ({ ...c })),
      };
    },

    restore(saved = {}) {
      links.length = 0; candidates.length = 0;
      for (const l of Array.isArray(saved.links) ? saved.links : []) if (l?.id && l.identities) links.push(l);
      for (const c of Array.isArray(saved.candidates) ? saved.candidates : []) if (c?.id && c.a && c.b) candidates.push(c);
      seq = Math.max(seq, links.length + candidates.length);
      return { links: links.length, candidates: candidates.length };
    },
  };
}
