// 「这个人在这个会话里希望被怎么叫」——只按当前对话的 QQ 号取称呼。
//
// 为什么单独抽出来（2026-10-31 用户反馈）：
//   主人被叫成「琳琳」（那是他对象的称呼）。根因是称呼/名字记忆没有按人归属：
//   · 对齐表（alias）只在**群聊**注入，私聊没有"当前对方希望被叫"；
//   · 记忆卡里的私聊记忆不带说话人，模型会把别人的"叫我X"套到眼前的人。
// 这里提供纯函数：按 QQ 号从对齐表里取称呼，并生成只对当前会话生效的提示。

/**
 * 从对齐表 links 里找某个 QQ 的称呼（label）。
 * @param {Array<{label?:string, identities?:{qq?:{id?:string}}}>} links
 * @param {string|number} qq
 * @returns {string} 没设置返回 ''
 */
export function pickPeerAlias(links, qq) {
  const id = String(qq ?? '').trim();
  if (!id) return '';
  for (const link of Array.isArray(links) ? links : []) {
    if (String(link?.identities?.qq?.id ?? '') !== id) continue;
    const label = String(link?.label ?? '').trim();
    if (label) return label;
  }
  return '';
}

/**
 * 生成「当前对话对象希望被叫」的提示块。只对当前会话生效，避免把别人的称呼带进来。
 * @param {{label?:string, qq?:string, isOwner?:boolean, adminName?:string}} input
 * @returns {string}
 */
export function buildPeerAliasTag({ label = '', qq = '', isOwner = false, adminName = '' } = {}) {
  const name = String(label || (isOwner ? adminName : '') || '').trim();
  if (!name) return '';
  const who = isOwner ? '管理员' : '当前对话的这个人';
  return `【当前称呼】${who}（QQ ${String(qq || '?')}）希望被叫「${name}」；只用在这个会话，不要把这个称呼套到别人身上。\n`;
}
