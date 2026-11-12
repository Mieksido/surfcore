/**
 * 去重：同一条信息别记两遍
 * ============================================================================
 * 位置：内存模块内部策略（纯函数）。不改接口。
 *
 * 三层（对应旧代码的三道闸，但**只看内核能看到的字段**）：
 *   ① 平台编号相同（externalId）           → 一定同一条
 *   ② 同人 + 同文本 + 窗口内                 → 转述重复
 *   ③ 已经判重过的摘要（调用方维护 seen 集合）
 *
 * 判据只用：from.adapter / from.channel / from.actor / externalId / text。
 * 不需要知道"这是哪个平台"。
 */

export const DEFAULT_DEDUPE = Object.freeze({
  windowMs: 2 * 24 * 60 * 60 * 1000,   // 旧代码：2 天内同源同人同文本算重复
});

/** 归一化文本：去掉空白与标点，避免"差一个句号"就重复记一次 */
function normText(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。！？、；：""''（）()!?,.;:]/g, '');
}

/** 一条记录的"几何键"（人 + 频道 + 平台编号） */
export function dedupeKey(record = {}) {
  const f = record.from ?? {};
  return [f.adapter ?? '', f.channel ?? '', f.actor ?? '', record.externalId ?? ''].join('|');
}

/**
 * 在已有记录里找重复。
 * @param {object} record 新记录
 * @param {Array} existing 已有记录（调用方传可见范围或全部，这里不判可见性）
 * @param {object} opts { windowMs, now }
 * @returns {object|null} 命中的旧记录
 */
export function findDuplicate(record = {}, existing = [], { windowMs, now = () => Date.now() } = {}) {
  const win = Number(windowMs) > 0 ? Number(windowMs) : DEFAULT_DEDUPE.windowMs;
  const f = record.from ?? {};
  const at = Number(f.at) || now();
  const text = normText(record.text);

  for (const old of existing) {
    if (!old) continue;
    // ① 平台编号相同：最硬的判据
    if (record.externalId && old.externalId && String(old.externalId) === String(record.externalId)) return old;

    const of = old.from ?? {};
    if (String(of.adapter ?? '') !== String(f.adapter ?? '')) continue;
    if (String(of.channel ?? '') !== String(f.channel ?? '')) continue;
    if (String(of.actor ?? '') !== String(f.actor ?? '')) continue;

    // ② 窗口内 + 同文本
    const oldAt = Number(of.at) || 0;
    if (at && oldAt && Math.abs(at - oldAt) > win) continue;
    if (text && text === normText(old.text)) return old;
  }
  return null;
}
