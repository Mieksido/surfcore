/**
 * 记忆的「身份」：从哪来 + 能给谁看
 * ============================================================================
 * 这是新架构替代旧代码里 8 个字段 / 3 种表示法的唯一概念：
 *   旧：scope / 来源前缀 / conversationKey / groupId / groupName / isOwner / isPrivate
 *   新：from（从哪来）+ to（能给谁看）
 *
 * 【铁律】本文件不许出现任何具体渠道名/平台名。
 *   一旦出现，就是架构失败（架构法则 11：业务不认识外部世界）。
 *   旧代码的判断之所以越来越长，就是因为它在代码里认具体来源。
 */

/** 记录是从哪来的（内部用：由 makeRecord 组装，不单独对外） */
function makeFrom({ adapter, channel, kind, actor = null, at = Date.now() } = {}) {
  return {
    adapter: String(adapter ?? ''),   // 来源的不透明 id（由外部层定义，内核只存不解释）
    channel: String(channel ?? ''),   // 频道的不透明 id（由外部层定义）
    kind: kind === 'group' || kind === 'private' ? kind : 'other', // 会话类型
    actor: actor ? String(actor) : null, // 谁说的（匿名渠道可以是 null）
    at: Number(at) || Date.now(),
    scene: 'public',                   // 场合：public / private；makeRecord 会按“是否主人私聊”收敛
  };
}

/** 记录能给谁看（内部用：由 makeRecord 组装，不单独对外） */
function makeTo({ owner = false, circle = [], sensitive = false } = {}) {
  return {
    owner: owner === true,                 // 这条是不是跟主人有关
    circle: Array.isArray(circle) ? [...new Set(circle.map(String))] : [], // 可见的频道集合（"同圈"）
    sensitive: sensitive === true,         // 敏感：永不进提示词
  };
}

/**
 * 造一条记忆。
 * @param {object} input { text, from, to, source, tags, importance, media }
 *   source: 'user'（用户说的）| 'manual'（管理员手写）| 'system'
 */
export function makeRecord(input = {}) {
  const from = makeFrom(input.from ?? {});
  const to = makeTo(input.to ?? {});
  // 场合标签：**只有“和主人的私聊”是 private**，其余一律 public。
  // 适配器可以传 from.scene，但内核在这里收敛成唯一事实，避免各包各叫一套。
  from.scene = from.kind === 'private' && to.owner === true ? 'private' : 'public';
  // 默认"同圈"至少包含自己：自己群里的记忆，在自己群里当然可见
  if (from.channel && !to.circle.includes(from.channel)) to.circle.push(from.channel);
  return {
    text: String(input.text ?? ''),
    media: Array.isArray(input.media) ? input.media : [],   // 只放"替身 + 路径"，不放假原件
    source: input.source === 'manual' ? 'manual' : (input.source === 'system' ? 'system' : 'user'),
    tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
    importance: Number.isFinite(Number(input.importance)) ? Number(input.importance) : 8,
    from,
    to,
  };
}

/**
 * 政策：这条记录，能不能给"这个查询者"看？
 * ============================================================================
 * 五条规则全部来自旧代码（memory-card.js 的 visibleFor），但**不含任何渠道名**：
 *   ① 敏感 → 只有管理员视图能看（进提示词一律不可见）
 *   ② 群会话 → 私聊记忆永不出现
 *   ③ 群会话 → 跨群只认同圈
 *   ④ 私聊会话 → 只看自己的私聊
 *   ⑤ 群记忆进私聊 → 只给主人 + 显式开启 + 黑白名单（白名单空时默认不放行）
 *
 * @param {object} record
 * @param {object} viewer
 *   { channelId, kind:'group'|'private'|'other', isOwner, isAdmin,
 *     ownerReadsCircles, allowOnly:[], deny:[], allowAllWhenEmpty }
 */
export function allowed(record, viewer = {}) {
  if (!record || !record.from || !record.to) return false;

  // ① 敏感：只给管理员视图，绝不进提示词
  if (record.to.sensitive) return viewer.isAdmin === true;

  const vChannel = String(viewer.channelId ?? '');
  const vKind = viewer.kind === 'group' ? 'group' : (viewer.kind === 'private' ? 'private' : 'other');
  const rKind = record.from.kind;

  // ②③ 群会话
  if (vKind === 'group') {
    if (rKind === 'private') return false;                        // 私聊记忆不进群
    if (record.source === 'manual') return true;                  // 手动记录：管理员写的，进所有群（旧行为）
    return record.to.circle.includes(vChannel);                   // 跨群只看同圈
  }

  // ④⑤ 私聊会话
  if (vKind === 'private') {
    if (rKind === 'private') return record.from.channel === vChannel;  // 只看自己的私聊
    if (!viewer.isOwner) return false;                            // 群记忆进私聊：只给主人
    if (viewer.ownerReadsCircles !== true) return false;          // 且必须显式开启
    if (record.source === 'manual') return false;                 // 手动记录不进私聊（旧行为）
    if ((viewer.deny ?? []).includes(record.from.channel)) return false;
    const only = viewer.allowOnly ?? [];
    if (only.length) return only.includes(record.from.channel);
    // 白名单为空时：只有明确 allowAllWhenEmpty 才放行，避免配置写错变成"全放"
    return viewer.allowAllWhenEmpty === true;
  }

  // other（未知会话类型）：只能看非用户产生的记录
  return record.source !== 'user';
}
