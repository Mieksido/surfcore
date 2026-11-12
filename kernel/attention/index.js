/**
 * 注意力漏斗：这件事值不值得叫她
 * ============================================================================
 * 移植自旧的 wake-policy / wake-filter / group-policy / fish-guard / command-spam。
 * 全部是"要不要"的判断，**纯函数、无 IO、无渠道名**。
 *
 * 一条核心原则（旧代码里最重要的省钱结构）：
 *   **先用免费的规则筛，再花 token。**
 */

/** 唤醒理由的优先级（数字越大越该醒） */
export const REASON_PRIORITY = Object.freeze({
  private: 100,      // 私聊直接找她
  atMention: 90,     // 被 @
  question: 80,      // 被提问
  directName: 70,    // 叫了她的名字
  keyword: 60,       // 命中关键词
  anyMessage: 50,    // 任意消息（活跃模式）
  replyCheck: 40,    // 回访检查
  timeout: 30,       // 超时
  proactive: 20,     // 主动搭话（目的机制）
});

/**
 * 该不该醒。
 * @param {object} input
 *   { kind:'group'|'private', text, isOwner, mentioned, calledName, question, keyword, activeMode }
 * @returns {{wake:boolean, reason:string, priority:number}}
 */
export function decideWake(input = {}) {
  const kind = input.kind === 'private' ? 'private' : 'group';
  const text = String(input.text ?? '').trim();

  // 先看"有没有人直接点她"：拍一拍/引用的正文是空的，
  // 若先按"空消息"返回，这类信号会被永远吞掉（顾问审阅抓到的真 bug）。
  if (kind === 'private') return { wake: true, reason: 'private', priority: REASON_PRIORITY.private };
  if (input.mentioned === true) return { wake: true, reason: 'atMention', priority: REASON_PRIORITY.atMention };
  if (input.isOwner === true) return { wake: true, reason: 'owner', priority: REASON_PRIORITY.atMention };
  if (text && input.question === true) return { wake: true, reason: 'question', priority: REASON_PRIORITY.question };
  if (text && input.calledName === true) return { wake: true, reason: 'directName', priority: REASON_PRIORITY.directName };
  if (text && input.keyword === true) return { wake: true, reason: 'keyword', priority: REASON_PRIORITY.keyword };

  // 群里的空消息 / 纯符号：不叫醒
  if (!text) return { wake: false, reason: 'empty', priority: 0 };

  // 大群：满屏闲话时不插嘴（只在被点名/被问到/主人说话时才醒）
  if (input.tier === 'large') return { wake: false, reason: 'large-quiet', priority: 0 };

  if (input.activeMode === true) return { wake: true, reason: 'anyMessage', priority: REASON_PRIORITY.anyMessage };

  return { wake: false, reason: 'no-trigger', priority: 0 };
}

/**
 * 合批：短时间内多条消息只醒一次，取最高优先级的理由。
 * @param {Array<{reason:string, priority:number, at:number}>} pending
 * @param {object} cfg { windowMs, now }
 */
export function batchReason(pending = [], { windowMs = 8000, now = Date.now() } = {}) {
  const fresh = pending.filter((p) => now - (Number(p.at) || 0) <= windowMs);
  if (!fresh.length) return null;
  return fresh.reduce((best, cur) => (cur.priority > best.priority ? cur : best), fresh[0]);
}

/**
 * 群分层：小群积极，大群严格（只在被直接叫到时才醒）。
 * 旧代码的 group-policy。
 * @param {object} input { memberCount, largeThreshold, activeMessageThreshold }
 */
export function tierOf({ memberCount = 0, largeThreshold = 200 } = {}) {
  return memberCount >= largeThreshold ? 'large' : 'small';
}

/** 群刷屏短指令：非主人、未指名、以 # 开头的短指令不唤醒（旧的 command-spam） */
export function isSpamCommand(text) {
  const s = String(text ?? '').trim();
  if (!s.startsWith('#')) return false;
  if (s.length > 24) return false;
  // 中文指令也算（#抽奖 / #签到），旧实现只认英文，实战里漏一半
  return /^#[^\s#]{1,20}$/u.test(s);
}

/** 鱼群保护：同一批机器人密度过高时闭嘴（旧的 fish-guard，简化版） */
export function fishDensity({ fishAccounts = 0, totalSenders = 0, threshold = 3 } = {}) {
  const density = totalSenders > 0 ? fishAccounts / totalSenders : 0;
  return {
    blocked: fishAccounts >= threshold || density >= 0.6,
    density: Number(density.toFixed(2)),
    fishAccounts,
  };
}
