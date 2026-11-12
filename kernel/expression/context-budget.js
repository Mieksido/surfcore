/**
 * 上下文预算：把提示词装进模型能吃的体积里
 * ============================================================================
 * 为什么单独一个模块：**"花多少 token"是独立的一门账**，不该散在提示词组装里。
 *
 * 裁剪顺序（这是产品判断，写死在这里，不散落）：
 *   ① 记忆块最先剪（它最可弃，也最长）
 *   ② 再剪现场里"她刚说过的话"之外的冗余
 *   ③ 人格核心**永远不剪**
 *
 * 估算方式：中文按 ~1.6 字/token，ASCII 按 ~4 字/token（够用，不追求精确）。
 */

/** 粗略估 token（不引第三方分词器：那是"接入时"的依赖） */
export function estimateTokens(text) {
  const s = String(text ?? '');
  let cjk = 0;
  let other = 0;
  for (const ch of s) {
    if (/[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(ch)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk / 1.6 + other / 4);
}

/** 按 token 上限截断一段文字（保留开头，尾部截断并加省略号） */
export function trimToTokens(text, maxTokens) {
  const s = String(text ?? '');
  const limit = Math.max(0, Number(maxTokens) || 0);
  if (estimateTokens(s) <= limit) return { text: s, trimmed: false };

  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimateTokens(s.slice(0, mid)) <= limit) lo = mid; else hi = mid - 1;
  }
  const cut = Math.max(0, lo - 1);
  return { text: cut > 0 ? `${s.slice(0, cut)}…` : '', trimmed: true };
}

/**
 * 把"系统提示 + 用户提示"装进预算。
 * @param {object} input { system, user, maxTokens, reserveForOutput }
 * @returns {{system:string, user:string, tokens:number, trimmed:{memory:boolean,user:boolean}}}
 */
export function fitPrompt({ system = '', user = '', maxTokens = 3000, reserveForOutput = 0 } = {}) {
  const cap = Math.max(64, Number(maxTokens) - Number(reserveForOutput));
  const sysTokens = estimateTokens(system);
  let userText = String(user);
  let userTokens = estimateTokens(userText);
  const trimmed = { memory: false, user: false };

  if (sysTokens + userTokens <= cap) {
    return { system, user: userText, tokens: sysTokens + userTokens, trimmed };
  }

  // ① 先剪记忆块（以【记忆】开头的段落）
  const memoryIdx = userText.indexOf('【记忆】') >= 0 ? userText.indexOf('【记忆】') : userText.indexOf('【相关记忆】');
  let budgetForUser = cap - sysTokens;
  if (memoryIdx >= 0) {
    const head = userText.slice(0, memoryIdx);
    const tailStart = userText.indexOf('【现在】', memoryIdx);
    const tail = tailStart >= 0 ? userText.slice(tailStart) : '';
    const memoryPart = userText.slice(memoryIdx, tailStart >= 0 ? tailStart : undefined);
    const room = budgetForUser - estimateTokens(head) - estimateTokens(tail);
    const cut = trimToTokens(memoryPart, Math.max(0, room));
    if (cut.trimmed) trimmed.memory = true;
    userText = head + cut.text + tail;
    userTokens = estimateTokens(userText);
  }

  // ② 还超就剪用户正文（保留开头）
  if (sysTokens + userTokens > cap) {
    const cut = trimToTokens(userText, Math.max(0, budgetForUser));
    if (cut.trimmed) trimmed.user = true;
    userText = cut.text;
    userTokens = estimateTokens(userText);
  }

  return { system, user: userText, tokens: sysTokens + userTokens, trimmed };
}
