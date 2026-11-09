// 身份底座：一张卡里“我是谁、对方是谁”，三个平台共用同一句（关系平等，不预设主人/情侣）。
//
// 为什么抽出来（2026-10-31 用户要求）：
//   身份这种常识不能只塞在日常层（daily）里——QQ 桥接以前自己拼一句，
//   B站/桌宠两处压根没传，于是“我是谁/主人是谁”只在部分场景存在。
//   现在三处都调用这里，身份作为独立的一层注入（tone/full 都带），不依赖用户是否拆分人格。

/**
 * @param {{name?:string, owner?:string}} input
 * @returns {string} 例如：你是小咪；对方叫雨雨。你们是熟人，朋友式相处。
 */
export function buildPersonaIdentity({ name = '', owner = '' } = {}) {
  const who = String(name ?? '').trim() || '这个角色';
  const person = String(owner ?? '').trim();
  const other = person ? `对方叫${person}` : '对方是你认识的人';
  // 只描述关系事实，不写「主仆/情侣/你是主人」这类设定；称呼由角色自己按人格卡决定。
  return `你是${who}；${other}。你们是熟人，朋友式相处。`;
}

/** 从人格卡正文里取角色名（首个 `# 标题`），取不到用兜底。 */
export function personaNameFromCard(core = '', fallback = '这个角色') {
  const firstHeading = String(core ?? '').split(/\r?\n/).find((line) => line.startsWith('# ')) || '';
  return String(firstHeading.replace(/^#\s*/, '').trim() || fallback);
}
