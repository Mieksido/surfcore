/**
 * 对话收尾判断（纯逻辑，无 I/O / 无网络 / 无状态）。
 *
 * 用户需求（2026-10-24）：
 *   「我发完“嗯”之后就可以进行一次对话是否可以结束的判断，是的话就不用回复了，
 *    这是为了以后不用每一句都回复……一次对话总是有结束的，结束不是终止，
 *    而是一段信息输出的合理结束，和下次更好的开始。」
 *
 * 为什么单独一层「判断」而不是让桥接直接静音：
 *   1. 真人不是按条数回复的，是按「这段还有没有信息要交换」回复的。
 *      硬性静音会误杀真正想问的下一句；纯靠提示词又会每轮都说「看情况」。
 *   2. 判断必须能被看见、被解释：模型看到的是「我最后一句像收尾 / 对方最后一句是提问 /
 *      我还有 1 条想说没说的」，而不是一句「要不要回」。
 *   3. 收尾要留痕：结束点（summary）和下次的接法（nextOpening）要落盘，
 *      否则「结束」就真的变成「断掉」，下次只能重新开场。
 *
 * 这里只负责「建议」。最终发不发、收不收，由模型调用 qq_close_conversation 决定；
 * 桥接只做两件硬的事：① 对方明确在提问/求助时拒绝收尾（防止逃避）；
 * ② 收尾后的短暂冷却只压「普通概率唤醒 / 回复检查 / 主动机会」，不压被直接叫到。
 */

export const DEFAULT_CLOSURE_CONFIG = Object.freeze({
  enabled: true,
  // 收尾后的软冷却：只影响群聊里的普通概率唤醒、回复检查、主动机会。
  // 被 @ / 叫名字 / 提问 / 拍一拍 / 指定成员 / 私聊都不受影响。
  cooldownMs: 20 * 60 * 1000,
  // 对方最后一句明确在提问/求助时不接受收尾：先回答，再谈结束。
  requireNoOpenQuestion: true,
  maxSummaryChars: 160,
  maxNextOpeningChars: 120,
  // 是否在每次唤醒里注入判断块（有近期对话时）。
  promptInWake: true,
});

const BOOL = (v, fallback) => (typeof v === 'boolean' ? v : fallback);
const NUM = (v, fallback, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};
const clamp01 = (n) => Math.min(1, Math.max(0, Number(n) || 0));
const text = (v) => String(v ?? '').trim();

export function normalizeClosureConfig(raw = {}) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    ...DEFAULT_CLOSURE_CONFIG,
    enabled: BOOL(src.enabled, DEFAULT_CLOSURE_CONFIG.enabled),
    cooldownMs: NUM(src.cooldownMs, DEFAULT_CLOSURE_CONFIG.cooldownMs, 60_000, 24 * 60 * 60 * 1000),
    requireNoOpenQuestion: BOOL(src.requireNoOpenQuestion, DEFAULT_CLOSURE_CONFIG.requireNoOpenQuestion),
    maxSummaryChars: NUM(src.maxSummaryChars, DEFAULT_CLOSURE_CONFIG.maxSummaryChars, 20, 500),
    maxNextOpeningChars: NUM(src.maxNextOpeningChars, DEFAULT_CLOSURE_CONFIG.maxNextOpeningChars, 10, 300),
    promptInWake: BOOL(src.promptInWake, DEFAULT_CLOSURE_CONFIG.promptInWake),
  };
}

// ── 消息分类 ────────────────────────────────────────────────────────────────
//
// 只分五类，够判断、也够解释：
//   ending     明确道别/结束（晚安、拜拜、先这样、去忙）
//   question   在问问题（问号结尾，或「什么/怎么/吗/呢」这类疑问收尾）
//   request    在请求帮忙（帮我、教我、推荐、查一下）
//   ack        纯附和/应答（嗯、好、哈哈、谢谢、收到）
//   substantive 有实际内容（不是上面任何一类）

const END_ANY_RE = /(晚安|拜拜|再见|886|先这样|先这么着|先撤|溜了|去忙|下了|睡了|不聊了|回头聊|改天聊|明天聊|下次聊|到此为止)/;
const END_STRONG_RE = /^(晚安|拜拜|再见|886|先这样|先这么着|先撤|溜了|去忙了?|下了|睡了|不聊了|回头聊|改天聊|明天聊|下次聊)[呀啦哦喔~～。！!？?…，,、\s]*$/;
const QUESTION_TAIL_RE = /[?？]\s*$/;
const QUESTION_WORD_RE = /(吗|嘛|么|咋|怎么|为什么|为啥|什么|哪个|哪里|哪儿|谁|多少|几点|是不是|有没有|能不能|可不可以|要不要|好不好|对不对|行不行|在不在|忙不忙|睡了吗|吃了吗)\s*[。！!…～~]*$/;
const REQUEST_RE = /(帮我|帮忙|麻烦你|请你|能不能帮我|可以帮我|教我|告诉我|说说|讲讲|发我|给我|推荐|查一下|搜一下|找一下|看一下|写一个|弄一个|来个|整一个)/;
const ACK_RE = /^(?:嗯+|哦+|噢+|喔+|好+|行+|可以|收到|了解|明白|懂了|知道了|ok|okay|没问题|谢谢|多谢|感谢|辛苦了|哈哈+|hhh+|嘻嘻|草|艹|笑死|绝了|666|？+|\?+|在|嗯哼|确实|对的|是啊|是的|成)[呀啦哦喔呢吧啊嘛的滴嘞~～。！!？?…，,、\s]*$/i;
// 「收束语气」：不是道别，但明显在给一个话题画句号。
const SETTLED_RE = /(说好了|就这么定|扯平|一言为定|成交|定了|好啦|行啦|算啦|先这样|以后再说|下次再说|不说了|不提了|到此为止|翻篇)/;

export function classifyMessage(msg) {
  const raw = typeof msg === 'string' ? msg : (msg?.plain ?? msg?.text ?? msg?.tail ?? '');
  const t = text(raw).replace(/\s+/g, ' ');
  const length = [...t].length;
  const hasMedia = Boolean(Array.isArray(msg?.media) && msg.media.length) || /\[(图片|动图|表情|视频|语音|文件|链接)/i.test(t);
  const atSelf = Boolean(msg?.atSelf);
  const quoteSelf = Boolean(msg?.quoteSelf);
  if (!t) {
    return { kind: hasMedia ? 'substantive' : 'silence', text: '', length: 0, hasMedia, atSelf, quoteSelf };
  }
  if (END_STRONG_RE.test(t) || (END_ANY_RE.test(t) && length <= 14)) {
    return { kind: 'ending', text: t, length, hasMedia, atSelf, quoteSelf };
  }
  if (QUESTION_TAIL_RE.test(t) || QUESTION_WORD_RE.test(t)) {
    return { kind: 'question', text: t, length, hasMedia, atSelf, quoteSelf };
  }
  if (REQUEST_RE.test(t)) {
    return { kind: 'request', text: t, length, hasMedia, atSelf, quoteSelf };
  }
  if (ACK_RE.test(t) || hasMedia) {
    return {
      kind: 'ack', text: t, length, hasMedia, atSelf, quoteSelf,
      settled: SETTLED_RE.test(t),
    };
  }
  return {
    kind: 'substantive',
    text: t,
    length,
    hasMedia,
    atSelf,
    quoteSelf,
    settled: SETTLED_RE.test(t),
  };
}

// ── 判断 ────────────────────────────────────────────────────────────────────

const KIND_LABEL = {
  ending: '道别/结束语',
  question: '在问你',
  request: '在请你帮忙',
  ack: '纯附和/应答',
  substantive: '有实际内容',
  silence: '没有文字',
};

function labelOf(kind) {
  return KIND_LABEL[kind] ?? '普通消息';
}

/** 只保留最近窗口内的消息，按时间升序；去掉拍一拍等非聊天事件。 */
function chatMessages(list, now, windowMs) {
  const cutoff = now - windowMs;
  return (Array.isArray(list) ? list : [])
    .filter((m) => m && m.kind !== 'poke' && Number(m.time || 0) >= cutoff)
    .slice(-80);
}

function sameMessage(a, b) {
  if (!a || !b) return false;
  if (a.messageId != null && b.messageId != null) return String(a.messageId) === String(b.messageId);
  return Number(a.seq) > 0 && Number(a.seq) === Number(b.seq);
}

/**
 * 评估「这段对话现在能不能自然收尾」。
 *
 * @param {object} input
 * @param {string} [input.key]
 * @param {'group'|'private'} [input.kind]
 * @param {Array} [input.messages]       recentMessages（升序）
 * @param {Array} [input.unread]         未读（升序）
 * @param {number} [input.now]
 * @param {number} [input.lastAiReplyAt]
 * @param {number} [input.lastIncomingAt]
 * @param {Array} [input.activeTopics]
 * @param {Array} [input.pendingThoughts]
 * @param {object} [input.config]
 */
export function assessConversationClosure(input = {}) {
  const now = Number(input.now) || Date.now();
  const cfg = normalizeClosureConfig(input.config);
  const kind = input.kind === 'private' ? 'private' : 'group';
  const recent = chatMessages(input.messages, now, 45 * 60 * 1000);
  const unread = chatMessages(input.unread, now, 45 * 60 * 1000);
  // recent 与 unread 常见是同一批消息的两份视图（消息同时进 recent 和 unread）。
  // 先按 messageId/seq 去重，避免把一句话数成两句、把节奏判断带偏。
  const merged = [];
  for (const msg of [...recent, ...unread]) {
    if (!merged.some((x) => sameMessage(x, msg))) merged.push(msg);
  }
  merged.sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));

  const others = merged.filter((m) => m && !m.isSelf);
  const selves = merged.filter((m) => m && m.isSelf);
  const lastOther = others[others.length - 1] ?? null;
  const lastSelf = selves[selves.length - 1] ?? null;

  if (!lastOther && !lastSelf) {
    return {
      verdict: 'continue',
      score: 0,
      configured: cfg.enabled,
      signals: {
        lastOtherKind: null, lastSelfKind: null,
        ownIntent: 0, theirIntent: 0, topicClosure: 0, fatigue: 0, openLoops: 0,
        explicitEnd: false, directAddress: kind === 'private', awaitingTheirAnswer: false,
        turns: 0, sinceLastOtherMs: null, sinceLastSelfMs: null,
      },
      reasons: ['没有可判断的近期对话'],
      advice: '没有正在进行的对话，不用做收尾判断。',
      lastOther: null,
      lastSelf: null,
    };
  }

  const otherClass = lastOther ? classifyMessage(lastOther) : null;
  const selfClass = lastSelf ? classifyMessage(lastSelf) : null;
  const sinceLastOtherMs = lastOther ? Math.max(0, now - (Number(lastOther.time) || now)) : null;
  const sinceLastSelfMs = lastSelf ? Math.max(0, now - (Number(lastSelf.time) || now)) : null;

  // 轮次：最近 30 分钟里对方说了几条。只用来判断「是不是已经来回很多轮」。
  const otherRecent = others.filter((m) => now - (Number(m.time) || 0) <= 30 * 60 * 1000);
  const turns = otherRecent.length;

  // 我自己的继续意愿：有没有想说没说的、有没有还没等到答案的问题、最后一句是不是在等对方。
  const freshThoughts = (Array.isArray(input.pendingThoughts) ? input.pendingThoughts : [])
    .filter((t) => t && text(t.text) && (!t.expiresAt || now < Number(t.expiresAt)));
  const topics = (Array.isArray(input.activeTopics) ? input.activeTopics : []).filter((t) => t && text(t.text));
  const topicsWithQuestion = topics.filter((t) => text(t.pendingQuestion));
  let ownIntent = 0;
  ownIntent += Math.min(0.7, freshThoughts.length * 0.35);
  if (topicsWithQuestion.length) ownIntent += 0.3;
  if (selfClass?.kind === 'question') ownIntent += 0.35;
  if (selfClass?.kind === 'ending') ownIntent -= 0.45;
  // 最后一句是「嗯/好」只说明这一句收尾了，不代表没有想说的；
  // 只有真的没有 pendingThought 时才把它算成「我这边也不想说了」。
  if (selfClass?.kind === 'ack' && freshThoughts.length === 0) ownIntent -= 0.15;
  ownIntent = clamp01(ownIntent);

  // 对方的继续意愿：最后一句是在问/在请，还是只是附和/道别。
  let theirIntent = 0.15;
  switch (otherClass?.kind) {
    case 'request': theirIntent = 1; break;
    case 'question': theirIntent = 0.95; break;
    case 'substantive': theirIntent = 0.62; break;
    case 'ack': theirIntent = 0.18; break;
    case 'ending': theirIntent = 0.02; break;
    default: theirIntent = 0.1;
  }
  if (otherClass?.atSelf || otherClass?.quoteSelf) theirIntent += 0.15;
  if (kind === 'private' && lastOther && !lastSelf) theirIntent += 0.05;
  if (otherRecent.filter((m) => now - (Number(m.time) || 0) <= 5 * 60 * 1000).length >= 3) theirIntent += 0.1;
  theirIntent = clamp01(theirIntent);

  // 话题闭环：对方已经画句号 / 双方都在收 / 还在问就是没闭环。
  let topicClosure = 0.35;
  if (otherClass?.kind === 'ending') topicClosure = 1;
  else if (otherClass?.settled) topicClosure = 0.85;
  else if (otherClass?.kind === 'ack' && selfClass && ['ack', 'ending'].includes(selfClass.kind)) topicClosure = 0.9;
  else if (otherClass?.kind === 'ack') topicClosure = 0.62;
  else if (otherClass?.kind === 'question' || otherClass?.kind === 'request') topicClosure = 0.08;
  else if (otherClass?.kind === 'substantive') topicClosure = 0.42;
  if (turns >= 6) {
    const tail = others.slice(-4);
    const avg = tail.reduce((sum, m) => sum + [...text(m.plain ?? m.text)].length, 0) / Math.max(1, tail.length);
    if (avg <= 6) topicClosure += 0.12;
  }
  topicClosure = clamp01(topicClosure);

  // 节奏疲劳：来回很多、句子越回越短、或者对方已经很久没接。
  let fatigue = 0;
  const recent10 = merged.filter((m) => now - (Number(m.time) || 0) <= 10 * 60 * 1000);
  if (recent10.length >= 12) fatigue += 0.3;
  const otherTail = others.slice(-3);
  if (otherTail.length >= 2) {
    const avg = otherTail.reduce((sum, m) => sum + [...text(m.plain ?? m.text)].length, 0) / otherTail.length;
    if (avg <= 5) fatigue += 0.25;
  }
  if (sinceLastOtherMs != null && sinceLastOtherMs >= 30 * 60 * 1000) fatigue += 0.25;
  const selfLast5 = selves.filter((m) => now - (Number(m.time) || 0) <= 5 * 60 * 1000);
  if (selfLast5.length >= 3) fatigue += 0.2;
  fatigue = clamp01(fatigue);

  // 未答的提问：对方问了我、我还没接。这是唯一会「硬阻止收尾」的信号。
  const awaitingTheirAnswer = Boolean(
    otherClass && ['question', 'request'].includes(otherClass.kind)
    && (!lastSelf || (Number(lastSelf.time) || 0) < (Number(lastOther.time) || 0))
  );
  const openLoops = awaitingTheirAnswer ? 1 : 0;

  const explicitEnd = otherClass?.kind === 'ending';
  const directAddress = kind === 'private' || Boolean(otherClass?.atSelf || otherClass?.quoteSelf)
    || otherClass?.kind === 'question' || otherClass?.kind === 'request';

  // 总分：闭环度 + 自己不想说 + 对方没在追 + 节奏疲劳 + 我最后一句已经是收尾。
  // 有未答提问时再扣一大截，确保不会拿收尾逃避回答。
  let score = 0;
  score += topicClosure * 0.32;
  score += (1 - ownIntent) * 0.24;
  score += (1 - theirIntent) * 0.22;
  score += fatigue * 0.12;
  if (selfClass && ['ack', 'ending'].includes(selfClass.kind)) score += 0.18;
  if (explicitEnd) score += 0.15;
  if (openLoops > 0) score -= 0.35;
  if (directAddress) score -= 0.06;
  score = clamp01(score);

  let verdict = 'continue';
  // 群里已经半小时没人接、也没有人在问：这段实际上已经散了。
  // 私聊不用这条硬信号（对方可能只是在忙，等他回来再判断）。
  const lastOtherStillOpen = Boolean(otherClass && ['question', 'request'].includes(otherClass.kind));
  if (openLoops > 0) verdict = 'continue';
  else if (explicitEnd) verdict = 'close';
  else if (kind === 'group' && sinceLastOtherMs != null && sinceLastOtherMs >= 30 * 60 * 1000
    && !lastOtherStillOpen && ownIntent < 0.5) verdict = 'close';
  // 对方明显还想继续、或我自己还有明显的表达欲：不判「结束」，最多先等一等。
  else if (theirIntent >= 0.9) verdict = 'continue';
  else if (ownIntent >= 0.6) verdict = 'linger';
  else if (score >= 0.62) verdict = 'close';
  else if (score >= 0.45) verdict = 'linger';

  const reasons = [];
  if (otherClass) reasons.push(`对方最后一句：${labelOf(otherClass.kind)}`);
  if (selfClass) reasons.push(`我最后一句：${labelOf(selfClass.kind)}`);
  if (freshThoughts.length) reasons.push(`还有 ${freshThoughts.length} 条想说没说的`);
  if (topicsWithQuestion.length) reasons.push(`有 ${topicsWithQuestion.length} 个话题在等追问`);
  if (openLoops > 0) reasons.push('对方明确在提问/求助，还没答');
  if (explicitEnd) reasons.push('对方已经明确道别/收束');
  if (fatigue >= 0.4) reasons.push('来回节奏已经偏疲');
  if (topicClosure >= 0.8) reasons.push('话题已基本闭环');
  if (theirIntent >= 0.9) reasons.push('对方明显还想继续');
  if (ownIntent >= 0.6) reasons.push('你自己还有想说的');

  const advice = openLoops > 0
    ? '先回答对方，不要收尾逃避。'
    : verdict === 'close'
      ? '可以自然收尾：不必再补一句。'
      : verdict === 'linger'
        ? '先别急着补话；等对方补充，或过一会儿再看。'
        : '还在聊，正常接。';

  return {
    verdict,
    score: Math.round(score * 100) / 100,
    configured: cfg.enabled,
    signals: {
      lastOtherKind: otherClass?.kind ?? null,
      lastSelfKind: selfClass?.kind ?? null,
      lastOtherText: otherClass?.text ?? '',
      lastSelfText: selfClass?.text ?? '',
      ownIntent: Math.round(ownIntent * 100) / 100,
      theirIntent: Math.round(theirIntent * 100) / 100,
      topicClosure: Math.round(topicClosure * 100) / 100,
      fatigue: Math.round(fatigue * 100) / 100,
      openLoops,
      explicitEnd,
      directAddress,
      awaitingTheirAnswer,
      turns,
      sinceLastOtherMs,
      sinceLastSelfMs,
      thoughtCount: freshThoughts.length,
      pendingQuestionCount: topicsWithQuestion.length,
    },
    reasons,
    advice,
    lastOther: lastOther ? { text: otherClass.text, kind: otherClass.kind, time: lastOther.time ?? null } : null,
    lastSelf: lastSelf ? { text: selfClass.text, kind: selfClass.kind, time: lastSelf.time ?? null } : null,
  };
}

// ── 提示词块 ────────────────────────────────────────────────────────────────

const VERDICT_ADVICE = {
  close: '可以自然收尾',
  linger: '先等一等，别急着补话',
  continue: '还在聊，正常接',
};

function level(n, low, high) {
  if (n >= high) return '高';
  if (n >= low) return '中';
  return '低';
}

function minutesAgo(ms) {
  if (ms == null) return '';
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  return `${Math.round(min / 60)} 小时前`;
}

/** 上一次收尾的记录，给下一次唤醒当「上次聊到哪」用。 */
export function formatClosureRecord(record, now = Date.now()) {
  if (!record || !record.at) return '';
  const when = minutesAgo(Math.max(0, now - Number(record.at)));
  const reasonText = {
    natural: '自然收尾',
    'topic-done': '话题聊完',
    'explicit-end': '对方道别',
    busy: '各自去忙',
    tired: '聊累了',
    other: '自然收尾',
  }[record.reason] ?? '自然收尾';
  const parts = [`上次这段在${when}${reasonText}`];
  if (record.summary) parts.push(`收在「${record.summary}」`);
  if (record.nextOpening) parts.push(`下次可以这样接「${record.nextOpening}」`);
  return parts.join('；') + '。';
}

/**
 * 每次唤醒注入的判断块。只给「参数 + 建议」，不替模型做决定。
 * 有近期对话才注入；没有对话时返回空串，避免每轮白烧 token。
 */
export function closurePromptBlock(assessment, { record = null, now = Date.now(), config = {} } = {}) {
  const cfg = normalizeClosureConfig(config);
  if (!cfg.enabled || !cfg.promptInWake) return '';
  if (!assessment || (!assessment.signals?.lastOtherKind && !assessment.signals?.lastSelfKind)) return '';
  const s = assessment.signals;
  const lastOther = s.lastOtherKind ? labelOf(s.lastOtherKind) : '暂无';
  const lastSelf = s.lastSelfKind ? labelOf(s.lastSelfKind) : '暂无';
  const lines = [];
  lines.push('【对话收尾判断】先判断这段是否已经自然走到终点，再决定要不要开口。');
  lines.push(`- 对方最后一句：${lastOther}；我最后一句：${lastSelf}。`);
  lines.push(`- 我的继续意愿：${level(s.ownIntent, 0.25, 0.6)}（想说没说的 ${s.thoughtCount} 条）；对方的继续意愿：${level(s.theirIntent, 0.25, 0.6)}；话题闭环：${level(s.topicClosure, 0.4, 0.75)}；节奏疲劳：${level(s.fatigue, 0.25, 0.55)}。`);
  const openText = s.openLoops > 0 ? '有未答的提问/请求' : '没有未答的提问';
  lines.push(`- 未完成：${openText}。判断：${VERDICT_ADVICE[assessment.verdict] ?? '继续观察'}。`);
  lines.push('如果判断可以收尾：不要再补一句，调用 qq_close_conversation（可留 summary / nextOpening）。这不是潜水，不用沉睡前观察；对方再找你、开新话题仍会照常醒。如果还要聊就正常回；只是等对方补充，用 qq_wait_for_messages(purpose="reply")。不要用收尾逃避提问/求助，也不要每轮都收尾。');
  if (record && record.at) {
    if (record.reopenedAt && now - Number(record.reopenedAt) < 10 * 60 * 1000) {
      lines.push(`上次这段刚收过尾，现在对方又开口了：这是新的开始，别复读上次的结尾。${formatClosureRecord(record, now)}`);
    } else {
      lines.push(formatClosureRecord(record, now));
    }
  }
  return lines.join('\n');
}

/** 控制台 / 状态接口用的摘要（时间、原因、摘要、下次接法、是否在冷却）。 */
export function closureStatus(record, now = Date.now()) {
  if (!record || !record.at) return null;
  return {
    at: Number(record.at) || 0,
    atText: new Date(Number(record.at) || 0).toLocaleString(),
    reason: record.reason ?? 'natural',
    summary: record.summary ?? '',
    nextOpening: record.nextOpening ?? '',
    cooldownUntil: Number(record.cooldownUntil) || 0,
    cooldownActive: Number(record.cooldownUntil) > now,
    reopenedAt: Number(record.reopenedAt) || 0,
  };
}

// ── 收尾记录 / 冷却 / 重开 ──────────────────────────────────────────────────

function truncateChars(value, max) {
  const s = text(value);
  const chars = [...s];
  if (chars.length <= max) return s;
  return chars.slice(0, max).join('') + '…';
}

export function makeClosureRecord({
  key, kind, assessment, body = {}, now = Date.now(), config = {},
} = {}) {
  const cfg = normalizeClosureConfig(config);
  const reason = ['natural', 'topic-done', 'explicit-end', 'busy', 'tired', 'other'].includes(body.reason)
    ? body.reason
    : (assessment?.signals?.explicitEnd ? 'explicit-end' : 'natural');
  return {
    at: now,
    key: String(key ?? ''),
    kind: kind === 'private' ? 'private' : 'group',
    reason,
    summary: truncateChars(body.summary ?? '', cfg.maxSummaryChars),
    nextOpening: truncateChars(body.nextOpening ?? '', cfg.maxNextOpeningChars),
    cooldownUntil: now + cfg.cooldownMs,
    turns: Number(assessment?.signals?.turns) || 0,
    lastOtherKind: assessment?.signals?.lastOtherKind ?? null,
    lastSelfKind: assessment?.signals?.lastSelfKind ?? null,
    reopenedAt: 0,
    reopenReason: '',
  };
}

export function normalizeClosureRecord(raw, config = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const at = Number(raw.at);
  if (!Number.isFinite(at) || at <= 0) return null;
  const cfg = normalizeClosureConfig(config);
  return {
    at: Math.round(at),
    key: String(raw.key ?? ''),
    kind: raw.kind === 'private' ? 'private' : 'group',
    reason: ['natural', 'topic-done', 'explicit-end', 'busy', 'tired', 'other'].includes(raw.reason) ? raw.reason : 'natural',
    summary: truncateChars(raw.summary, cfg.maxSummaryChars),
    nextOpening: truncateChars(raw.nextOpening, cfg.maxNextOpeningChars),
    cooldownUntil: Number(raw.cooldownUntil) > 0 ? Number(raw.cooldownUntil) : at + cfg.cooldownMs,
    turns: Number(raw.turns) || 0,
    lastOtherKind: typeof raw.lastOtherKind === 'string' ? raw.lastOtherKind : null,
    lastSelfKind: typeof raw.lastSelfKind === 'string' ? raw.lastSelfKind : null,
    reopenedAt: Number(raw.reopenedAt) > 0 ? Number(raw.reopenedAt) : 0,
    reopenReason: truncateChars(raw.reopenReason ?? '', 40),
  };
}

/**
 * 收尾后的软冷却。只压这三类「可以忍一忍」的唤醒：
 *   probability     普通消息按概率唤醒
 *   replyCheck      我发完消息后 30 秒的例行回复检查
 *   proactiveCheck  冷场主动机会
 * 被 @ / 叫名字 / 提问 / 拍一拍 / 指定成员 / 私聊一律不压 —— 结束不是把人关掉。
 */
const SOFT_WAKE_REASONS = new Set(['probability', 'replyCheck', 'proactiveCheck']);

export function closureSuppressesWake(record, reason, now = Date.now()) {
  if (!record || !Number(record.cooldownUntil)) return false;
  if (now >= Number(record.cooldownUntil)) return false;
  const base = String(reason ?? '').split(':')[0];
  return SOFT_WAKE_REASONS.has(base);
}

/** 对方又开口时，把「上次收尾」标成已重开（记录保留，供提示词用）。 */
export function reopenClosure(record, { reason = 'new-message', now = Date.now() } = {}) {
  if (!record) return null;
  if (record.reopenedAt && now - Number(record.reopenedAt) < 60 * 1000) return record;
  return { ...record, reopenedAt: now, reopenReason: truncateChars(reason, 40) };
}

/**
 * 收尾前的人性化硬闸：对方明确在提问/求助、且我还没接时，不接受「结束」。
 * 这不是不信任模型，而是把「不想回」和「逃避」分开：前者可以收尾，后者必须先答。
 */
export function closeGate(assessment, config = {}) {
  const cfg = normalizeClosureConfig(config);
  if (!cfg.enabled) return { blocked: true, reason: 'disabled', error: '对话收尾判断已关闭' };
  if (!assessment) return { blocked: false };
  if (cfg.requireNoOpenQuestion && assessment.signals?.awaitingTheirAnswer) {
    return {
      blocked: true,
      reason: 'open-question',
      error: '对方最后一句是在提问/求助，还没回答；先用 qq_send_message 回完再收尾。如果已经答完，先发出去，再调用 qq_close_conversation。',
    };
  }
  return { blocked: false };
}
