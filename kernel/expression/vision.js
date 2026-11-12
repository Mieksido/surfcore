/**
 * 识图：把"对方发来的图片"接进模型消息
 * ============================================================================
 * 位置：内核·表达层。它隐藏的秘密是**图片怎么变成模型认识的那一段内容**：
 *   · 只认图片；读不到的、太大的、格式认不出的 → 丢掉并说原因（不假装看见了）
 *   · 输出是模型端口的内容段（image_url + data URL），不是平台格式
 *   · 不碰渠道、不碰记忆策略；字节由调用方注入 readBytes
 *
 * 为什么不在平台包里：把图片交给模型是"她怎么看"的事，换渠道也该一样。
 * 为什么不在大适配器里：它不认识内核，也不该认识模型消息。
 */

/** 一次最多给模型看几张、单张最大多少字节（防把上下文/请求撑爆） */
export const VISION_LIMITS = Object.freeze({
  maxImages: 2,
  maxBytes: 5 * 1024 * 1024,
});

/** 从文件头认图片类型（不依赖文件名/扩展名） */
export function sniffImageMime(bytes) {
  if (!bytes || typeof bytes.length !== 'number' || !bytes.length) return null;
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  return null;
}

/**
 * 把一组媒体引用变成模型能看的内容段。
 * @param {object[]} media 记录里的媒体引用 [{ id, kind, caption }]
 * @param {object} opts { readBytes(id) → Buffer|null, maxImages, maxBytes }
 * @returns {{parts:object[], used:object[], dropped:object[]}}
 */
export function buildVisionParts(media = [], {
  readBytes,
  maxImages = VISION_LIMITS.maxImages,
  maxBytes = VISION_LIMITS.maxBytes,
} = {}) {
  const list = Array.isArray(media) ? media : [];
  const capN = Math.max(1, Number(maxImages) || VISION_LIMITS.maxImages);
  const capB = Math.max(1, Number(maxBytes) || VISION_LIMITS.maxBytes);
  const parts = [];
  const used = [];
  const dropped = [];

  for (const ref of list) {
    if (parts.length >= capN) { dropped.push({ id: ref?.id ?? null, reason: 'too-many' }); continue; }
    if (String(ref?.kind ?? '') !== 'image') continue;

    let bytes = ref?.bytes ?? null;
    if (!bytes) {
      if (typeof readBytes !== 'function') { dropped.push({ id: ref?.id ?? null, reason: 'no-reader' }); continue; }
      try { bytes = readBytes(ref.id); } catch { bytes = null; }
    }
    if (!bytes || !bytes.length) { dropped.push({ id: ref.id, reason: 'unreadable' }); continue; }
    if (bytes.length > capB) { dropped.push({ id: ref.id, reason: 'too-large' }); continue; }

    const mime = sniffImageMime(bytes);
    if (!mime) { dropped.push({ id: ref.id, reason: 'unsupported-format' }); continue; }

    parts.push({
      type: 'image_url',
      image_url: { url: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}` },
    });
    used.push({ id: ref.id, mime, bytes: bytes.length });
  }

  return { parts, used, dropped };
}
