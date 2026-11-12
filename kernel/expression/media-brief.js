/**
 * 媒体摘要：把"对方发来的图片/语音/视频"写成一句话
 * ============================================================================
 * 为什么在表达层：它产出的是**提示词文本**，不是数据、也不是渠道能力。
 *
 * 三条规矩：
 *   · 只写"是什么 + 一句话说明 + 语音的文字稿"，**不写技术字段**（大小/格式/路径）
 *   · 没有说明就只有类型，不编内容（模型看不见图，别假装看见了）
 *   · 多条按行排，最多 6 条（防刷屏）
 */
const KIND_LABEL = { image: '图片', audio: '语音', video: '视频', file: '文件' };

/**
 * 媒体的"一句话说明"。
 * **编号要写进去**：模型想"收藏这张图"时必须能指名道姓。
 */
export function mediaBriefOf(event = {}, { maxItems = 6 } = {}) {
  const list = Array.isArray(event?.media) ? event.media : [];
  if (!list.length) return '';

  return list.slice(0, maxItems).map((m) => {
    const kind = KIND_LABEL[m?.kind] ?? '文件';
    const id = m?.id ? `[${String(m.id).slice(0, 10)}] ` : '';
    const caption = String(m?.caption ?? '').trim();
    const transcript = String(m?.transcript ?? '').trim();
    const parts = [`- ${id}对方发来${kind}`];
    if (caption) parts.push(`：${caption}`);
    if (transcript) parts.push(`（说的是：${transcript.slice(0, 120)}）`);
    return parts.join('');
  }).join('\n');
}
