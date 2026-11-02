/**
 * QQ @ 目标解析（纯函数）。
 *
 * 为什么单独抽出来：桥接原来在 handleIncoming 和 wakeReasonForV2 里各写一套
 * 「at 段 qq 是否等于 self_id」，而且 handleIncoming 里还有 `atOther0` 一票否决：
 * 一条消息同时 @ 机器人和 @ 别人时，会被判成“不是在叫我”。
 *
 * 这里只做事实判断：
 *   - atSelf：有没有 at 自己；
 *   - atOther：有没有 at 别人（不含 @all）。
 * 调用方可以据此决定“即使也 @ 了别人，仍然要叫醒”。
 */

function normalizeIds(ids) {
  return new Set((Array.isArray(ids) ? ids : [ids])
    .map((v) => String(v ?? '').trim())
    .filter(Boolean));
}

function atQqs(message) {
  if (typeof message === 'string') {
    const out = [];
    const re = /\[CQ:at,qq=([^,\]]+)\]/g;
    let match;
    while ((match = re.exec(message))) out.push(String(match[1]).trim());
    return out;
  }
  if (!Array.isArray(message)) return [];
  return message
    .filter((seg) => seg?.type === 'at')
    .map((seg) => String(seg?.data?.qq ?? '').trim())
    .filter(Boolean);
}

/** 返回 { atSelf, atOther, targets }；@all 不算 atSelf，也不算 atOther。 */
export function atInfo(message, selfIds = []) {
  const self = normalizeIds(selfIds);
  const targets = atQqs(message);
  return {
    atSelf: targets.some((qq) => qq !== 'all' && self.has(qq)),
    atOther: targets.some((qq) => qq !== 'all' && !self.has(qq)),
    targets,
  };
}
