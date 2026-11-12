/**
 * 黑话库：群里冒出的新词，她得能认、能用
 * ============================================================================
 * 为什么单独一个模块：**"她学会的词"是她的知识**，不是记忆流水、也不是渠道设置。
 *
 * 旧代码 slang-learner.js 382 行：收集候选 → 管理员确认 → 进提示词。
 * 这里保留同一条线，但不认识任何渠道：候选里只存"词 + 上下文 + 谁说的"。
 *
 * 两条规矩：
 *   · **未确认的不进提示词**（防止把骂人的词学进人格）
 *   · 每个词有来源与时间（以后能清理）
 */
export const MAX_CANDIDATES = 200;

import { mergeEvidence, escapeLearnerText, buildExtractionPrompt, parseExtraction, LEARN } from './learn.js';

export function createLexicon({ maxConfirmed = 200, maxCandidates = MAX_CANDIDATES, now = () => Date.now() } = {}) {
  /** word → { word, meaning, tags, source, at, confirmedAt, count, evidence } */
  const confirmed = new Map();
  /** word → { word, context, actor, at, hits, evidence } */
  const candidates = new Map();

  /** 超出上限时按"用得多的留下"（旧代码：已确认 > 出现次数 > 最近更新） */
  function capConfirmed() {
    if (confirmed.size <= maxConfirmed) return 0;
    const sorted = [...confirmed.values()].sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || (b.at ?? 0) - (a.at ?? 0));
    const drop = sorted.slice(maxConfirmed);
    for (const item of drop) confirmed.delete(item.word);
    return drop.length;
  }

  return {
    /**
     * 提交一个候选（她自己遇到不认识的词时调用）。
     * 同一个词重复出现只加计数，不重复存；证据去重限长。
     */
    propose({ word, context = '', actor = null, at, evidence = [] } = {}) {
      const w = String(word ?? '').trim();
      if (!w || w.length > 24) return null;
      const t = Number(at) || now();
      if (candidates.has(w)) {
        const c = candidates.get(w);
        c.hits += 1;
        c.at = t;
        c.evidence = mergeEvidence(c.evidence, evidence);
        return c;
      }
      const item = {
        word: w,
        context: String(context ?? '').slice(0, 120),
        actor: actor === null ? null : String(actor),
        at: t,
        hits: 1,
        evidence: mergeEvidence([], evidence),
      };
      candidates.set(w, item);
      while (candidates.size > maxCandidates) candidates.delete(candidates.keys().next().value);
      return item;
    },

    /** 管理员确认：候选 → 正式词条（带含义） */
    confirm({ word, meaning = '', tags = [], at, count, evidence } = {}) {
      const w = String(word ?? '').trim();
      if (!w) return null;
      const t = Number(at) || now();
      const prev = candidates.get(w);
      const item = {
        word: w,
        meaning: String(meaning ?? '').slice(0, 120),
        tags: (Array.isArray(tags) ? tags : []).map(String).slice(0, 6),
        source: 'admin',
        at: t,
        confirmedAt: t,
        count: Number(count) || prev?.hits || 1,
        evidence: mergeEvidence(prev?.evidence ?? [], evidence),
      };
      confirmed.set(w, item);
      candidates.delete(w);
      capConfirmed();
      return item;
    },

    /** 管理员否掉：从候选里删掉 */
    reject(word) {
      return candidates.delete(String(word ?? '').trim());
    },

    /** 她能不能认这个词 */
    lookup(word) { return confirmed.get(String(word ?? '').trim()) ?? null; },

    /** 渲染成提示词的一段（**只给已确认的**；按出现次数排；转义防注入） */
    render({ maxChars = 400, maxItems = LEARN.maxWords } = {}) {
      const sorted = [...confirmed.values()]
        .filter((x) => x.word && x.meaning)
        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
      const lines = [];
      let used = 0;
      for (const item of sorted.slice(0, maxItems)) {
        const word = escapeLearnerText(item.word);
        const meaning = escapeLearnerText(item.meaning);
        const line = `- ${word}：${meaning}`;
        if (used + line.length > maxChars) break;
        lines.push(line);
        used += line.length + 1;
      }
      return lines.join('\n');
    },

    /** 造"提取候选"的提示词（交给模型跑一次；内核不发请求） */
    extractionPrompt(messages) { return buildExtractionPrompt(messages); },

    /** 把模型的提取结果收进候选（自动过滤长度与重复） */
    ingestExtraction(text, { actor = null } = {}) {
      const list = parseExtraction(text);
      for (const it of list) this.propose({ word: it.word, context: '', actor, evidence: [{ text: '' }] });
      return list;
    },

    /** 未确认的候选（给管理界面用） */
    pending() { return [...candidates.values()].sort((a, b) => b.hits - a.hits); },

    stats() { return { confirmed: confirmed.size, candidates: candidates.size }; },

    /** 落盘用 */
    snapshot() {
      return {
        confirmed: [...confirmed.values()].map((x) => ({ ...x })),
        candidates: [...candidates.values()].map((x) => ({ ...x })),
      };
    },

    /** 读盘用 */
    restore(saved = {}) {
      confirmed.clear(); candidates.clear();
      for (const it of Array.isArray(saved?.confirmed) ? saved.confirmed : []) if (it?.word) confirmed.set(String(it.word), { ...it });
      for (const it of Array.isArray(saved?.candidates) ? saved.candidates : []) if (it?.word) candidates.set(String(it.word), { ...it });
      return { confirmed: confirmed.size, candidates: candidates.size };
    },
  };
}
