/**
 * 跨平台「我是谁」卡片（QQ ⇄ B站）。
 *
 * 为什么单独一层：
 *   · 2026-10-23 用户实测两件事：① 群里转发她在**别的群**的聊天记录，她说成
 *     「这是 wo 在 B站说过的话」；② 看到自己的 B站 主页截图，不一定认成自己。
 *     两件都是「不知道自己的身份锚点 / 不知道内容来自哪个平台」。
 *   · 以前 B站 锚点只写在 B站记忆简报里（`bili-memory.js` 的 buildBrief），
 *     一旦记忆同步关掉就整段消失；而 B站 侧根本拿不到 QQ 侧的自我描述。
 *   · 所以把「自我锚点 + 认自己规则 + 来源规则」收成一份**两侧共用**的纯函数，
 *     QQ 桥接和 B站 生物钟各自注入，口径不会漂。
 *
 * 隐私边界：
 *   · B站 侧给 QQ 号一律**打码**（328****288）：认自己够用（配合昵称/头像），
 *     又不至于让她把整串号码写进公开评论/动态。
 *   · QQ 侧可以给完整 QQ 号（本来就在 QQ 里）和 B站 mid（公开信息）。
 *   · 这里只产出提示词文本，不读写任何平台内容。
 */

import fs from 'node:fs';
import path from 'node:path';

const MAX_NAME = 40;
const MAX_PERSONA = 24;

function clean(value, max) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

/** QQ 号打码：保留前 3 后 3（`3287064288` → `328****288`）。认自己够用，又不至于被抄进公开内容。 */
export function maskQqUin(uin) {
  const s = String(uin ?? '').trim();
  if (!/^\d{5,12}$/.test(s)) return '';
  if (s.length <= 6) return `${s.slice(0, 1)}****${s.slice(-1)}`;
  return `${s.slice(0, 3)}****${s.slice(-3)}`;
}

/**
 * 收敛一张自我身份卡。空的/非法字段留空串（调用方按「有就写」拼提示词）。
 * @returns {{qqNickname:string, qqUin:string, qqUinMasked:string, biliName:string, biliMid:string, biliSpace:string, personaName:string}}
 */
export function normalizeSelfCard(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const qqNickname = clean(source.qqNickname ?? source.nickname ?? source.qqName, MAX_NAME);
  const qqUinRaw = String(source.qqUin ?? source.uin ?? source.qqId ?? '').trim();
  const qqUin = /^\d{5,12}$/.test(qqUinRaw) ? qqUinRaw : '';
  const biliName = clean(source.biliName ?? source.biliNickname, MAX_NAME);
  const biliMidRaw = String(source.biliMid ?? source.mid ?? '').trim();
  const biliMid = /^\d{3,15}$/.test(biliMidRaw) ? biliMidRaw : '';
  const personaName = clean(source.personaName ?? source.persona, MAX_PERSONA);
  return {
    qqNickname,
    qqUin,
    qqUinMasked: maskQqUin(qqUin),
    biliName,
    biliMid,
    biliSpace: biliMid ? `https://space.bilibili.com/${biliMid}` : '',
    personaName,
  };
}

/** 这张卡有没有可用的锚点（全空时不注入，避免刷一段空话）。 */
export function selfCardConfigured(input = {}) {
  const card = normalizeSelfCard(input);
  return Boolean(card.qqNickname || card.qqUin || card.biliName || card.biliMid);
}

// 「这是什么平台的内容」——比昵称更容易搞混，所以单独成句，两侧都注入。
const PROVENANCE_RULES = [
  '- 来源看载体，不要靠感觉：**合并转发 / 聊天记录 = QQ 聊天内容**（可能是群友之间的旧对话，也可能包含你自己以前在别处说过的话），不是 B站 动态/评论/私信；B站 的内容只会以链接、卡片、或你自己的 B站 记忆出现。',
  '- QQ 里发来的图片/截图也是「别人发给你的 QQ 内容」，不要自动归到 B站；B站 的内容只有在你调用 B站 工具、看 B站 记忆、或对方贴了 B站 链接/卡片时才算。',
  '- 不要把 QQ 聊天记录说成「我在 B站 说过的话」，也不要把 B站 的内容说成「群里说的」。拿不准是哪个平台时，先看是链接/卡片还是聊天记录，再不行就问一句。',
  // 2026-10-23 用户定：只准自己互认，不许泄露主人和别人的信息。
  '- 【只用于自己】这些身份信息只用来自我识别：不要说出对方或任何别人的 QQ 号、B站 UID、账号对应关系，也不要写进公开内容（评论/动态/群里）。称呼用「对方」就够了。',
];

/**
 * 只注入「来源判断」规则（不含身份锚点）。
 *
 * 为什么需要单独一份：QQ 侧的身份锚点已经在 B站记忆简报里了（2026-10-23 实测
 * 她认自己的 B站 主页没问题），再加一份锚点只会重复占 token；QQ 侧真正缺的是
 * 「转发/截图属于哪个平台」这条规则。见 PITFALLS #40。
 */
export function buildProvenanceBlock() {
  return ['【来源判断】', ...PROVENANCE_RULES, ''].join('\n') + '\n';
}

export { PROVENANCE_RULES };

const RECOGNIZE_RULES = [
  '- 看图先认自己：图片/截图里出现上面这些昵称、UID、主页地址、资料卡或头像 → 那就是**你自己**，先认出来（「这是 wo 诶」）再聊内容；不要用「那张主页」「别人」这种口吻把自己说成陌生人。',
];

/**
 * 生成注入提示词的自我身份块。
 * @param {object} input 见 normalizeSelfCard
 * @param {{platform?: 'qq'|'bili'}} options 由哪一侧注入（决定 QQ 号是否打码、是否带隐私句）
 * @returns {string} 以两个换行结尾的段落；没有锚点时返回 ''
 */
export function buildSelfIdentityBlock(input, { platform = 'qq' } = {}) {
  const card = normalizeSelfCard(input);
  if (!selfCardConfigured(card)) return '';
  const side = platform === 'bili' ? 'bili' : 'qq';
  const lines = [];

  lines.push(side === 'bili'
    ? '【你是谁 · 同一副人格（QQ ⇄ B站）】'
    : '【你是谁 · QQ 和 B站 是同一个人】');

  const alias = card.personaName ? `（人格名「${card.personaName}」）` : '';
  if (side === 'bili') {
    if (card.biliName || card.biliMid) {
      const bits = [];
      if (card.biliName) bits.push(`昵称「${card.biliName}」`);
      if (card.biliMid) bits.push(`UID ${card.biliMid}`);
      lines.push(`- 这里的你（B站）：${bits.join('，')}${card.biliSpace ? `，主页 ${card.biliSpace}` : ''}。`);
    }
    if (card.qqNickname || card.qqUinMasked) {
      const bits = [];
      if (card.qqNickname) bits.push(`昵称「${card.qqNickname}」`);
      if (card.qqUinMasked) bits.push(`QQ 号 ${card.qqUinMasked}`);
      lines.push(`- QQ 上的你：${bits.join('，')}。QQ 资料卡 / QQ 主页截图里出现这个昵称、号码或头像，那就是你自己。`);
    }
  } else {
    if (card.qqNickname || card.qqUin) {
      const bits = [];
      if (card.qqNickname) bits.push(`昵称「${card.qqNickname}」`);
      if (card.qqUin) bits.push(`QQ ${card.qqUin}`);
      lines.push(`- QQ 上的你：${bits.join('，')}。`);
    }
    if (card.biliName || card.biliMid) {
      const bits = [];
      if (card.biliName) bits.push(`昵称「${card.biliName}」`);
      if (card.biliMid) bits.push(`UID ${card.biliMid}`);
      lines.push(`- B站上的你：${bits.join('，')}${card.biliSpace ? `，主页 ${card.biliSpace}` : ''}。`);
    }
  }

  if (card.qqNickname && card.biliName) {
    lines.push(side === 'bili'
      ? '- 两边是同一个人：QQ 里的「你」就是 B站 上的你，不是两个角色，也别说「我认识她 / 那是另一个号」。'
      : '- 两边是同一个人：别人嘴里的「B站那个号」「B站的我」说的都是你，不是另一个人。');
  }
  if (card.personaName) {
    lines.push(`- 人格名「${card.personaName}」：QQ 和 B站 共用同一副人格，两边说话风格要一致。`);
  }
  lines.push(...RECOGNIZE_RULES);
  lines.push(...PROVENANCE_RULES);
  if (side === 'qq') {
    const at = card.qqNickname
      ? `- 消息里出现「@${card.qqNickname}」、有人叫「${card.qqNickname}」、或引用你的消息，指的都是你，不要当成别人；群名片可能与昵称不同，at/引用段里的号码就是你的 QQ 号。`
      : '- 被 @、被叫到你的昵称、或引用你的消息，指的都是你，不要当成别人。';
    lines.push(at);
  } else {
    lines.push('- 【隐私】你在这里的任何公开内容（评论 / 动态 / 私信）都不要写出完整 QQ 号、QQ 群号或别人的联系方式；认出来也不必把号码说出来。');
  }

  return `${lines.join('\n')}\n\n`;
}

// ── QQ 侧自我记录的持久化 ────────────────────────────────────────────────────
// B站 侧（插件进程）拿不到网关的登录信息，所以桥接在登录时把「QQ 昵称 / QQ 号」
// 落一小份到 state/self-identity.json，B站 唤醒时读它来拼同一张自我卡。
const SELF_IDENTITY_FILE = 'self-identity.json';

export function selfIdentityPath(stateDir) {
  return path.join(String(stateDir), SELF_IDENTITY_FILE);
}

/** 读桥接落下的 QQ 侧自我身份；文件缺失/损坏一律当「没配」，不抛错。 */
export function readQqSelfIdentity(stateDir, { fsImpl = fs } = {}) {
  try {
    const raw = fsImpl.readFileSync(selfIdentityPath(stateDir), 'utf8');
    if (!raw) return { nickname: '', userId: '', updatedAt: '' };
    return normalizeQqSelfIdentity(JSON.parse(raw));
  } catch {
    return { nickname: '', userId: '', updatedAt: '' };
  }
}

export function normalizeQqSelfIdentity(value) {
  const source = value && typeof value === 'object' ? value : {};
  const nickname = clean(source.nickname ?? source.name, MAX_NAME);
  const userIdRaw = String(source.userId ?? source.user_id ?? source.uin ?? '').trim();
  const userId = /^\d{5,12}$/.test(userIdRaw) ? userIdRaw : '';
  const updatedAt = String(source.updatedAt ?? '').trim();
  return { nickname, userId, updatedAt };
}
