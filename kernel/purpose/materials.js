/**
 * 目的机制的素材来源：从记忆里挑"值得说的那几件"
 * ============================================================================
 * 旧代码的 collectMaterials 直接读记忆的原始形状（耦合）。
 * 新做法：**从"已按可见性过滤的记录"里提炼素材**，输出统一形状：
 *
 *   { owner, topic, text, need, risky, at }
 *
 * 三条提炼规矩（都来自旧代码的经验）：
 *   ① 跟主人有关的优先（owner）
 *   ② 有媒体/有情绪的更容易成为话题（分享欲）
 *   ③ 太旧的、太短的、重复的不要
 */
const DAY = 86400000;

const EMOTION_RE = /([!！]{2,}|哈哈|呜|哭|气死|开心|难过|喜欢|讨厌|太好了|烦)/;
const PROMISE_RE = /(约|答应|说好|见面|周末|明天|下周|记得)/;

/**
 * @param {Array} records 已经过可见性过滤的记录
 * @param {object} opts { now, windowDays, max, seen（已说过的文本前缀） }
 * @returns {Array<{owner,topic,text,need,risky,at}>}
 */
export function collectMaterials(records = [], { now = () => Date.now(), windowDays = 7, max = 8, seen = [] } = {}) {
  const since = now() - windowDays * DAY;
  const out = [];
  const usedTopics = new Set();

  for (const r of records) {
    const text = String(r?.text ?? '').trim();
    if (text.length < 6) continue;                       // 太短：没什么可说
    const at = Number(r?.from?.at ?? 0);
    if (at && at < since) continue;                      // 太旧：不当新鲜话题
    const topic = topicOf(text);
    if (!topic || usedTopics.has(topic)) continue;        // 同一件事只说一次
    if (seen.some((s) => text.startsWith(String(s).slice(0, 12)))) continue;

    const owner = r?.to?.owner === true;
    const hasMedia = Array.isArray(r?.media) && r.media.length > 0;
    const emotional = EMOTION_RE.test(text);
    const promise = PROMISE_RE.test(text);

    let need = 'share';
    if (promise) need = 'followup';        // 约定 → 追问
    else if (emotional) need = 'confide';  // 情绪 → 倾诉
    else if (hasMedia) need = 'share';     // 有图有语音 → 分享
    else if (text.includes('?')) need = 'ask';

    usedTopics.add(topic);
    out.push({
      owner: owner ? 'owner' : 'self',
      topic,
      text,
      need,
      risky: false,
      at,
      weight: (owner ? 3 : 1) + (emotional ? 2 : 0) + (hasMedia ? 1 : 0) + (promise ? 2 : 0),
    });
    if (out.length >= max) break;
  }

  return out.sort((a, b) => b.weight - a.weight);
}

/** 从一句话里抽一个"可复述的主题"（旧代码 extractTopic 的简化版） */
export function topicOf(text) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  // 取前 12 个字符当主题（中文足够区分"这件事"和"那件事"）
  return s.slice(0, 12);
}
