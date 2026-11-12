/**
 * 平台来源字典（UI 唯一事实）
 * ============================================================================
 * 内核/适配器只传不透明 sourceId；显示名、符号、颜色都只在这里维护。
 * 组件里不要写平台名判断，也不要把原始 ID 直接展示给用户。
 *
 * @typedef {'src_qq'|'src_bilibili'|'src_desktop_pet'|'src_web'|'src_unknown'} SourceId
 */

export const SOURCE_MAP = Object.freeze({
  src_qq: Object.freeze({ id: 'src_qq', label: 'QQ', glyph: 'Q', color: '#38bdf8' }),
  src_bilibili: Object.freeze({ id: 'src_bilibili', label: 'B站', glyph: 'B', color: '#fb7185' }),
  src_desktop_pet: Object.freeze({ id: 'src_desktop_pet', label: '桌宠', glyph: '宠', color: '#a78bfa' }),
  src_web: Object.freeze({ id: 'src_web', label: '网页', glyph: '网', color: '#22d3ee' }),
  src_unknown: Object.freeze({ id: 'src_unknown', label: '未知来源', glyph: '?', color: '#94a3b8' }),
});

export const SOURCE_IDS = Object.freeze(Object.keys(SOURCE_MAP));
export const SOURCE_LABELS = Object.freeze(Object.fromEntries(
  SOURCE_IDS.map((id) => [id, SOURCE_MAP[id].label]),
));

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/**
 * 旧值/过渡值 → SourceId。永远返回一个合法 SourceId，未知不抛异常。
 * 兼容：qq / surfcore@qq / qq / group / bili / bili / video / desktop-pet / web …
 * @param {unknown} raw
 * @returns {SourceId}
 */
export function sourceIdFromLegacy(raw) {
  let s = '';
  try { s = String(raw === undefined || raw === null ? '' : raw).trim().toLowerCase(); } catch (error) {
    return 'src_unknown';
  }
  if (!s) return 'src_unknown';
  if (hasOwn(SOURCE_MAP, s)) return s;

  if (s === 'qq' || s.endsWith('@qq') || s.startsWith('qq /')) return 'src_qq';
  if (s === 'bili' || s === 'bilibili' || s.endsWith('@bili') || s.startsWith('bili /')) return 'src_bilibili';
  if (s === 'pet' || s === 'desktop-pet' || s === 'desktop_pet' || s.startsWith('pet /')) return 'src_desktop_pet';
  if (s === 'web' || s.startsWith('web /')) return 'src_web';
  return 'src_unknown';
}

/**
 * 显示名。传 SourceId 或旧值都行；未知一律「未知来源」。
 * @param {unknown} id
 * @returns {string}
 */
export function sourceLabel(id) {
  return SOURCE_MAP[sourceIdFromLegacy(id)].label;
}

/**
 * 显示用的完整元信息（label/glyph/color），未知返回 src_unknown 的条目。
 * @param {unknown} id
 */
export function sourceMeta(id) {
  return SOURCE_MAP[sourceIdFromLegacy(id)];
}
