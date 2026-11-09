/**
 * 身份泄露闸（纯函数，无 IO）。
 *
 * 2026-10-23 用户要求：「只准自己互认，不许泄露主人和别人的信息」。
 *
 * 为什么需要一层硬闸：
 *   · 跨平台互认必然把「谁的哪个号」放进提示词（主人 QQ ⇄ B站 mid、对齐表里别人的号）；
 *     模型一旦在**公开面**（B站 评论/动态）复述出来，就再也收不回去。
 *   · 提示词里的「不要泄露」只是概率约束，正则才是确定性的。
 *
 * 这一层的边界（别把它当万能）：
 *   · 只认**已知 ID 精确命中** + 明确的「QQ / 群号 + 数字」形态；
 *   · 不拦普通数字（年份、播放量、楼层、BV 号里的数字）—— 免得把正常内容全拦掉；
 *   · 不拦昵称：昵称会撞、会重复，误伤成本远高于收益（对齐表的 `label` 仍禁止公开，由提示词约束）。
 *   · 只负责「要不要发」；发出去之后怎么补救不归它管。
 */

/**
 * 在文本里找受保护 ID 的命中。
 * @param {string} text 准备发出去的正文
 * @param {{ids?: Iterable<string|number>}} options 受保护 ID（主人/别人的 QQ 号、B站 mid 等）
 * @returns {Array<{kind:string,label:string,value:string,index:number}>}
 */
export function findIdentityLeaks(text, { ids = [] } = {}) {
  const raw = String(text ?? '');
  if (!raw.trim()) return [];
  const hits = [];
  const seen = new Set();
  // 1) 已知 ID 精确命中：这些号码本来就只在配置/对齐表里，不该出现在公开文本里。
  for (const value of ids ?? []) {
    const id = String(value ?? '').trim();
    if (!/^\d{4,15}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    const index = raw.indexOf(id);
    if (index >= 0) hits.push({ kind: 'known-id', label: '账号标识', value: id, index });
  }
  // 2) 明确的「QQ / 群号 + 数字」：即使不在白名单里，也是在往外递联系方式。
  const explicit = /(?:QQ|qq|Q群|q群|群号|群\s*号|加群|企鹅号)\s*[：:=是为]?\s*(\d{5,12})/g;
  let match;
  while ((match = explicit.exec(raw)) !== null) {
    if (seen.has(`pattern:${match[1]}`)) continue;
    seen.add(`pattern:${match[1]}`);
    hits.push({ kind: 'qq-context', label: 'QQ/群号', value: match[1], index: match.index });
  }
  return hits.sort((a, b) => a.index - b.index);
}

/** 把命中的 ID 打码后再拼进错误信息：错误信息本身也可能被贴进日志/给模型看。 */
export function maskLeakValue(value) {
  const s = String(value ?? '');
  if (!/^\d{5,}$/.test(s)) return s;
  if (s.length <= 6) return `${s.slice(0, 1)}****${s.slice(-1)}`;
  return `${s.slice(0, 3)}****${s.slice(-3)}`;
}

/**
 * 出站前的人话拒绝语（供 CLI / 桥接直接打印）。
 * @param {Array} hits findIdentityLeaks 的结果
 * @param {string} surface 出站位置，如「B站 评论」「B站 动态」「B站 私信」
 */
export function formatIdentityLeakError(hits, surface = '公开内容') {
  const list = (hits ?? []).map((h) => maskLeakValue(h.value)).filter(Boolean);
  const uniq = [...new Set(list)].join('、');
  return `这条${surface}里出现了对方/别人的账号标识（${uniq}）。`
    + '跨平台互认只能用来认自己，账号信息不许外传：把号码删掉再发（用「对方」「那位」这类称呼代替），也不要暗示是哪个号。';
}
