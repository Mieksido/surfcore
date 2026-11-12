/**
 * 「我是谁」：她自己的身份锚点
 * ============================================================================
 * 位置：内核 support（身份）。**"我是谁"是灵魂的一部分**，不属于任何平台。
 *
 * 搬自旧 self-identity.js（188 行）的三件事：
 *   ① 账号打码（认自己够用，又不至于被抄进公开内容）
 *   ② 身份卡归一（有就写，空的留空；全空就不注入，别刷一段空话）
 *   ③ **来源看载体**：合并转发/聊天记录就是聊天内容，不能因为里面出现一个链接
 *      就当成"我在那儿说过的话"（旧代码真机踩过：她说"这是我在别的平台说的"）
 *
 * 旧代码里的平台名一律去掉：这里只认 "来源 = 一个字符串"。
 */

const MAX_NAME = 40;
const MAX_ID = 32;

const clean = (s, max) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);

/** 账号打码：足够认出自己，又不至于被抄走 */
export function maskId(id) {
  const s = String(id ?? '').trim();
  if (!/^[A-Za-z0-9_-]{4,}$/.test(s)) return '';
  if (s.length <= 6) return `${s.slice(0, 1)}****${s.slice(-1)}`;
  return `${s.slice(0, 3)}****${s.slice(-3)}`;
}

/**
 * 归一身份卡。
 * @param {object} input { personaName, accounts: { [source]: { id, name } } }
 */
export function normalizeSelfCard(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const accounts = {};
  for (const [source, acc] of Object.entries(src.accounts ?? {})) {
    const id = clean(acc?.id, MAX_ID);
    const name = clean(acc?.name, MAX_NAME);
    if (!id && !name) continue;
    accounts[String(source)] = { id, name, masked: maskId(id) };
  }
  return { personaName: clean(src.personaName, MAX_NAME), accounts };
}

/** 有没有可用的锚点（全空就不注入） */
export function selfCardConfigured(input = {}) {
  const card = normalizeSelfCard(input);
  return Boolean(card.personaName || Object.keys(card.accounts).length);
}

/**
 * 来源判断规则（**不含任何具体来源名**）。
 * 旧代码这里是"某个载体 = 某种内容"，这里抽象成"看载体，不看感觉"。
 */
export const PROVENANCE_RULES = Object.freeze([
  '- 来源看载体，不要靠感觉：合并转发 / 聊天记录就是**聊天内容**（可能是别人之间的旧对话，也可能包含你自己以前说的话），不是别处的内容。',
  '- 别处的内容只会以链接、卡片、或明确标注的来源出现；没看到这些，就不要说"这是我在别处说的"。',
  '- 看到自己的主页截图/链接时，先按下面这张卡确认是不是自己，再下结论。',
]);

/**
 * 造一段"我是谁"的提示词（没配置就返回空串，不刷空话）。
 * 打码口径：**只在需要展示的地方用 masked**，完整 id 不进提示词。
 */
export function buildSelfBrief(input = {}) {
  const card = normalizeSelfCard(input);
  if (!selfCardConfigured(card)) return '';
  const lines = [];

  if (card.personaName) lines.push(`- 我叫：${card.personaName}`);
  for (const [source, acc] of Object.entries(card.accounts)) {
    const bits = [];
    if (acc.name) bits.push(acc.name);
    if (acc.masked) bits.push(`账号 ${acc.masked}`);
    if (bits.length) lines.push(`- 在「${source}」那边我是：${bits.join('（')}${bits.length > 1 ? '）' : ''}`);
  }
  if (!lines.length) return '';

  return ['【我是谁】', ...lines, '来源判断：', ...PROVENANCE_RULES].join('\n');
}
