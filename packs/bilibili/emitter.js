/**
 * B站 内容 → 事件
 * ============================================================================
 * 位置：平台包内部。它的唯一职责是**把平台的数据翻译成统一事件**。
 * 内核不认识 bvid、不认识收藏夹；它只看到一条普通事件。
 *
 * 三条规矩：
 *   · 来源只写 `from.adapter = 'bilibili'`（**这就是"渠道"的全部含义**）
 *   · 平台特有信息放 `tags`（bvid / up名 / 动态号），不新增字段
 *   · 重要度由包按平台语义给**提示值**，内核只把它当加分
 */

const KIND = {
  video: { channel: 'feed', label: '视频' },
  dynamic: { channel: 'dynamics', label: '动态' },
  comment: { channel: 'comments', label: '评论' },
  favorite: { channel: 'favorites', label: '收藏' },
};

/** B站 语义 → 重要度提示（0~100，内核当加分用） */
export const IMPORTANCE_HINT = Object.freeze({
  favorite: 70,   // 自己收藏的：重要
  dynamic: 55,    // 关注的人发的动态
  comment: 45,    // 评论
  video: 35,      // 普通视频
});

const textOf = (item = {}) => {
  const parts = [item.title, item.desc, item.content, item.snippet].filter(Boolean).map((s) => String(s).trim());
  return parts.join('。').slice(0, 500);
};

/**
 * @param {object} input { type, item, at }
 * @returns {object|null} 统一事件（形状与 QQ 包产出的一致）
 */
export function toEvent({ type = 'video', item = {}, at = Date.now() } = {}) {
  const meta = KIND[type] ?? KIND.video;
  const text = textOf(item);
  if (!text) return null;   // 没内容就不造事件（不占记忆）

  const tags = [];
  if (item.bvid) tags.push(`bvid:${item.bvid}`);
  if (item.dynamicId) tags.push(`dynamic:${item.dynamicId}`);
  if (item.author) tags.push(`up:${item.author}`);
  if (item.folder) tags.push(`folder:${item.folder}`);

  return {
    from: {
      adapter: 'bilibili',
      channel: `bilibili:${meta.channel}`,
      kind: 'channel',
      actor: String(item.authorId ?? item.author ?? 'bilibili'),
      at: Number(at) || Date.now(),
    },
    text: `${meta.label}：${text}`,
    tags,
    importance: IMPORTANCE_HINT[type] ?? IMPORTANCE_HINT.video,
    source: 'user',
  };
}

/** 一批内容 → 一批事件（跳过没内容的） */
export function toEvents(list = [], { type = 'video', at = Date.now(), max = 8 } = {}) {
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const ev = toEvent({ type, item, at });
    if (ev) out.push(ev);
    if (out.length >= max) break;
  }
  return out;
}
