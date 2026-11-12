/**
 * 重要度评分：什么值得被记住
 * ============================================================================
 * 位置：内存模块内部策略（常量表 + 纯函数）。**不改接口。**
 *
 * 设计原则（关键）：
 *   · 内核只用自己的信号（是不是主人、是不是叫她、情绪、约定、矛盾、长度…）
 *   · **渠道专属加分由包给**（包在事件里填 `importance`，内核把它当加分，不问来源）
 *   · 结果夹在 0~100；pinned 永远 100
 *
 * 改法：只改 `WEIGHTS` 常量表或 `scoreMemory` 里的判定；跑 scoring 断言。
 */

export const WEIGHTS = Object.freeze({
  base: 8,
  ownerPrivate: 42,      // 主人私聊
  ownerGroup: 32,        // 主人在群里
  direct: 8,             // 直接对她说（@/点名/引用）
  emotionMax: 24,        // 情绪强度（按命中的情绪词数量，封顶）
  firstTime: 30,         // 第一次提到某件事（由调用方给）
  promise: 16,           // 约定/承诺
  contradiction: 14,     // 矛盾/改口
  self: 5,               // 提到她自己
  media: 6,              // 带媒体
  shortPenalty: -12,     // 太短（<8 字）
  firstOwnerEver: 100,   // 主的第一次（初遇）
});

const EMOTION_RE = /([!！]{2,}|哈哈|嘿嘿|呜|哭|气死|开心|难过|喜欢|讨厌|太好了|烦|怕|惊)/g;
const PROMISE_RE = /(约|答应|说好|见面|周末|明天|下周|记得|一定|别忘)/;
const CONTRADICTION_RE = /(但是|可是|不过|其实|改口|不是这样|说错了)/;
const SELF_RE = /(她|你|你自己)/;

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

/**
 * @param {object} record 记录（已含 from/to/text/media/externalId）
 * @param {object} ctx { isFirstOwnerEver?:boolean, isFirstTime?:boolean, channelHint?:number }
 *   channelHint = 包填进事件里的 importance（默认 8）；内核只把它当"加分"
 * @returns {number} 0~100
 */
export function scoreMemory(record = {}, ctx = {}) {
  if (record.pinned) return 100;
  if (ctx.isFirstOwnerEver) return WEIGHTS.firstOwnerEver;

  const text = String(record.text ?? '');
  const f = record.from ?? {};
  const owner = record.to?.owner === true;
  let score = WEIGHTS.base;

  if (owner) score += f.kind === 'private' ? WEIGHTS.ownerPrivate : WEIGHTS.ownerGroup;
  if (ctx.direct === true) score += WEIGHTS.direct;

  const emotions = (text.match(EMOTION_RE) ?? []).length;
  if (emotions) score += Math.min(WEIGHTS.emotionMax, emotions * 8);

  if (PROMISE_RE.test(text)) score += WEIGHTS.promise;
  if (CONTRADICTION_RE.test(text)) score += WEIGHTS.contradiction;
  if (SELF_RE.test(text)) score += WEIGHTS.self;
  if (Array.isArray(record.media) && record.media.length) score += WEIGHTS.media;
  if (ctx.isFirstTime === true) score += WEIGHTS.firstTime;
  if (text.length > 0 && text.length < 8) score += WEIGHTS.shortPenalty;

  // 渠道专属加分：包在事件里填的 importance，超过基准的部分算加分（不覆盖内核判断）
  const hint = Number(ctx.channelHint);
  if (Number.isFinite(hint)) score += Math.max(0, hint - WEIGHTS.base);

  return clamp(score);
}
