// 身份底座：一张卡里“我是谁、主人是谁”，三个平台共用同一句。
//
// 为什么抽出来（2026-10-31 用户要求）：
//   身份这种常识不能只塞在日常层（daily）里——QQ 桥接以前自己拼一句，
//   B站/桌宠两处压根没传，于是“我是谁/主人是谁”只在部分场景存在。
//   现在三处都调用这里，身份作为独立的一层注入（tone/full 都带），不依赖用户是否拆分人格。

/**
 * @param {{name?:string, owner?:string}} input
 * @returns {string} 例如：你是小咪；你的主人是雨雨。无论 QQ 群聊、私聊、B站还是桌宠，都必须记得这件事。
 */
export function buildPersonaIdentity({ name = '', owner = '' } = {}) {
  const who = String(name ?? '').trim() || '这个角色';
  const master = String(owner ?? '').trim() || '主人';
  // 占位称呼「主人」时别写成「你的主人是主人」，读起来像口吃。
  if (master === '主人') {
    return `你是${who}；你称那个最熟的人为「主人」。无论 QQ 群聊、私聊、B站还是桌宠，都是同一个人。`;
  }
  return `你是${who}；你的主人是${master}。无论 QQ 群聊、私聊、B站还是桌宠，都必须记得这件事。`;
}

/** 从人格卡正文里取角色名（首个 `# 标题`），取不到用兜底。 */
export function personaNameFromCard(core = '', fallback = '这个角色') {
  const firstHeading = String(core ?? '').split(/\r?\n/).find((line) => line.startsWith('# ')) || '';
  return String(firstHeading.replace(/^#\s*/, '').trim() || fallback);
}
