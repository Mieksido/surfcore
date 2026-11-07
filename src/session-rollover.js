/**
 * 会话滚动（session rollover）：一条 DSH 会话聊太久，每次请求都要把整段历史重发一遍。
 *
 * 实测（2026-10-30 报告）：同一条会话 19.5 小时后，单步输入从 6.9 万涨到 43.5 万 token，
 * 常见 25~33 万；而每一轮还会因为工具调用重发 5 次左右。所以"换会话"是成本第一杠杆。
 *
 * 本文件只放**纯逻辑**（零 I/O、零副作用）：
 *   · 该不该换（shouldRollSession）
 *   · 换的时候给下一段会话留什么交接（buildHandoffBlock）
 *
 * 真正的副作用（retireSession / 落盘 / 提示词注入）留在 bridge。
 */

/** 默认关闭：新用户不主动换会话；开启前必须理解上下文会被重置。 */
export const DEFAULT_ROLLOVER = Object.freeze({
  enabled: false,
  tokens: 500000,
  turns: 0,
  summary: true,
  keepRecent: 24,
  summaryMaxChars: 700,
  // 刚建出来的会话（第 1 轮）不滚，否则交接摘要会变成"和空气交接"。
  minTurnsBeforeRoll: 2
});

const clampInt = (value, fallback, min, max) => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

/**
 * 把 `socialV2.context` 里那一小段配置收成可用形态。
 * 注意：读的是真配置对象，缺省一律回落到 DEFAULT_ROLLOVER。
 */
export function normalizeRolloverConfig(context = {}) {
  const src = context && typeof context === 'object' ? context : {};
  const rawEnabled = src.rolloverEnabled;
  const enabled = rawEnabled === undefined ? DEFAULT_ROLLOVER.enabled : rawEnabled !== false;
  return {
    enabled,
    // 2026-11-07：口径从「累计计费」改为「当前上下文」。
    // 旧字段 rolloverTokens 是累计账单含义，不能继续拿来当上下文阈值；
    // 新字段 rolloverContextTokens 缺省 50 万，老配置里的 8 万不会再误触发。
    tokens: clampInt(src.rolloverContextTokens, DEFAULT_ROLLOVER.tokens, 0, 2_000_000),
    turns: clampInt(src.rolloverTurns, DEFAULT_ROLLOVER.turns, 0, 100_000),
    summary: src.rolloverSummary === undefined ? DEFAULT_ROLLOVER.summary : src.rolloverSummary !== false,
    keepRecent: clampInt(src.rolloverKeepRecent, DEFAULT_ROLLOVER.keepRecent, 4, 200),
    summaryMaxChars: clampInt(src.rolloverSummaryMaxChars, DEFAULT_ROLLOVER.summaryMaxChars, 120, 4000),
    minTurnsBeforeRoll: clampInt(src.rolloverMinTurns, DEFAULT_ROLLOVER.minTurnsBeforeRoll, 0, 1000)
  };
}

/**
 * 该不该换会话。
 *
 * 两个阈值是"或"关系：谁先到都算。`tokens <= 0` / `turns <= 0` 表示该维度不启用，
 * 两个都关掉就等于完全不滚。
 *
 * `contextTokens` 是当前这一轮真正带入模型的上下文（不是会话累计账单）。
 * 保留 `usedTokens` 作为旧名兼容测试/调用方。
 */
export function shouldRollSession({ usedTokens = 0, contextTokens, turns = 0, config = DEFAULT_ROLLOVER } = {}) {
  const cfg = { ...DEFAULT_ROLLOVER, ...(config || {}) };
  if (cfg.enabled === false) return false;
  const used = Math.max(0, Math.round(Number(contextTokens ?? usedTokens) || 0));
  const count = Math.max(0, Math.round(Number(turns) || 0));
  if (count < cfg.minTurnsBeforeRoll) return false;
  const byTokens = cfg.tokens > 0 && used >= cfg.tokens;
  const byTurns = cfg.turns > 0 && count >= cfg.turns;
  return byTokens || byTurns;
}

/** 一条记忆消息压成一行：`谁：内容`，去掉换行、截断。 */
function oneLine(who, text, limit = 48) {
  const name = String(who ?? '').replace(/\s+/g, ' ').trim() || '某人';
  const body = String(text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/【[^】]*】/g, '')
    .trim();
  if (!body) return '';
  const clipped = body.length > limit ? `${body.slice(0, limit)}…` : body;
  return `· ${name}：${clipped}`;
}

/**
 * 生成"交接块"：下一段会话第一屏会看到它。
 *
 * 为什么需要它：换会话会丢掉**对话流**（不是记忆——记忆卡每轮都注入）。
 * 所以交接只需要说清"刚才在聊什么、聊到哪"，不需要复述全部历史。
 * 这里刻意用规则拼（不额外花一次模型调用），并且明确要求"别提前进换过会话"。
 */
export function buildHandoffBlock({
  key = '',
  recent = [],
  closure = '',
  now = Date.now(),
  config = DEFAULT_ROLLOVER
} = {}) {
  const cfg = { ...DEFAULT_ROLLOVER, ...(config || {}) };
  const list = Array.isArray(recent) ? recent.slice(-cfg.keepRecent) : [];
  const lines = [];
  for (const msg of list) {
    if (!msg || msg.isSelf === true) continue;
    const line = oneLine(msg.who ?? msg.name ?? msg.sender ?? '', msg.plain ?? msg.text ?? '');
    if (line) lines.push(line);
  }
  const said = String(closure ?? '').replace(/\s+/g, ' ').trim();

  const head = '【会话交接】上一段聊太长了，已经换了一段新的接上。';
  const tail = '接着聊就行；不要提"换过会话"这件事，也不用重新自我介绍。';
  const body = [];
  if (said) body.push(`刚才收在：${said.slice(0, Math.max(60, Math.floor(cfg.summaryMaxChars / 3)))}`);
  if (lines.length) body.push('最近几句：', ...lines);

  // 超字数时从最旧的对话行开始丢（"收在"那句永远保留）。
  let block = [head, ...body, tail].join('\n');
  while (block.length > cfg.summaryMaxChars && lines.length > 1) {
    lines.shift();
    const nextBody = [];
    if (said) nextBody.push(`刚才收在：${said.slice(0, Math.max(60, Math.floor(cfg.summaryMaxChars / 3)))}`);
    if (lines.length) nextBody.push('最近几句：', ...lines);
    block = [head, ...nextBody, tail].join('\n');
  }
  if (block.length > cfg.summaryMaxChars) {
    block = block.slice(0, Math.max(80, cfg.summaryMaxChars - 1)) + '…';
  }
  return block;
}

/** 交接块是不是"有内容"（没有对话也没有收尾时就不必注入）。 */
export function handoffIsUseful(block) {
  const text = String(block ?? '').trim();
  if (!text) return false;
  return /最近几句|刚才收在/.test(text);
}
