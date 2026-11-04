/**
 * 一次读取的上下文快照（纯函数，不碰网络/文件）。
 *
 * 目标：把 unread / recent / social / activeMembers 合成一次返回；
 * 默认只给最近 N 条、每条截断；需要细节时由 refs 指回 message_detail。
 *
 * 不负责权限、token、群分层；这些由 bridge 在调用前处理。
 */
export const SNAPSHOT_VERSION = 1;

export const DEFAULT_SNAPSHOT_CAPS = Object.freeze({
  unread: 12,
  recent: 10,
  activeMembers: 8,
  textChars: 200,
});

function clampInt(value, fallback, min, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function textOf(m) {
  return String(m?.plain ?? m?.text ?? m?.tail ?? '').replace(/\s+/g, ' ').trim();
}

function messageItem(m, caps) {
  const text = textOf(m);
  return {
    seq: Number.isSafeInteger(m?.seq) ? m.seq : null,
    messageId: m?.messageId ? String(m.messageId) : '',
    at: Number(m?.time) || Number(m?.at) || 0,
    sender: String(m?.sender ?? m?.user_id ?? ''),
    text: text.slice(0, caps.textChars),
    textTruncated: text.length > caps.textChars,
    isSelf: m?.isSelf === true,
    isOwner: m?.isOwner === true,
    flags: [
      m?.quoteTargetIsSelf ? 'quoteSelf' : '',
      Array.isArray(m?.media) && m.media.length ? 'media' : '',
      m?.hasMedia ? 'media' : '',
    ].filter(Boolean),
  };
}

/**
 * @param {object} opts
 * @param {string} opts.key
 * @param {object} opts.st socialV2 state
 * @param {string[]} [opts.include]
 * @param {object} [opts.caps]
 * @param {number} [opts.afterSeq]
 * @param {number} [opts.now]
 */
export function buildContextSnapshot({ key = '', st = {}, include = null, caps = {}, afterSeq = 0, now = Date.now(), groupName = '' } = {}) {
  const c = {
    unread: clampInt(caps.unread, DEFAULT_SNAPSHOT_CAPS.unread, 1, 100),
    recent: clampInt(caps.recent, DEFAULT_SNAPSHOT_CAPS.recent, 1, 100),
    activeMembers: clampInt(caps.activeMembers, DEFAULT_SNAPSHOT_CAPS.activeMembers, 1, 50),
    textChars: clampInt(caps.textChars, DEFAULT_SNAPSHOT_CAPS.textChars, 40, 2000),
  };
  const wanted = new Set(Array.isArray(include) && include.length
    ? include.filter((x) => ['unread', 'recent', 'social', 'activeMembers'].includes(x))
    : ['unread', 'recent', 'social', 'activeMembers']);
  const unreadAll = Array.isArray(st.unread) ? st.unread.filter((m) => m && !m.isSelf) : [];
  const unreadFiltered = Number(afterSeq) > 0 ? unreadAll.filter((m) => Number(m.seq) > Number(afterSeq)) : unreadAll;
  const unreadSlice = unreadFiltered.slice(-c.unread);
  const unread = {
    items: unreadSlice.map((m) => messageItem(m, c)),
    total: unreadFiltered.length,
    truncated: unreadFiltered.length > unreadSlice.length,
    nextAfterSeq: unreadSlice.length && Number.isSafeInteger(unreadSlice[unreadSlice.length - 1]?.seq)
      ? unreadSlice[unreadSlice.length - 1].seq
      : Number(afterSeq) || 0,
  };
  const recentAll = Array.isArray(st.recentMessages) ? st.recentMessages.filter(Boolean) : [];
  const recentSlice = recentAll.slice(-c.recent);
  const recent = {
    items: recentSlice.map((m) => messageItem(m, c)),
    total: recentAll.length,
    truncated: recentAll.length > recentSlice.length,
  };
  const counts = new Map();
  for (const m of recentAll.slice(-100)) {
    if (!m || m.isSelf) continue;
    const name = String(m.sender ?? m.user_id ?? '').trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const activeMembers = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, c.activeMembers)
    .map(([name, count]) => ({ name, count }));
  const snapshotId = `snap_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const social = {
    lastWakeReason: String(st.lastWakeReason || ''),
    lastAiReplyAt: Number(st.lastAiReplyAt) || 0,
    lastActionAt: Number(st.lastActionAt) || 0,
    unreadCount: unreadAll.length,
    recents: recentAll.length,
    closure: st.closure ? {
      at: Number(st.closure.at) || 0,
      reason: String(st.closure.reason || ''),
      summary: String(st.closure.summary || '').slice(0, 200),
      nextOpening: String(st.closure.nextOpening || '').slice(0, 120),
    } : null,
    wake: st.wakeConfig ? {
      mode: String(st.wakeConfig.mode || ''),
      infinite: st.wakeConfig.infinite !== false,
      sleepUntil: st.wakeConfig.sleepUntil || null,
      triggers: st.wakeConfig.triggers ?? {},
    } : null,
  };
  const refs = [];
  for (const item of unread.items) {
    if (item.textTruncated) refs.push({ type: 'message', seq: item.seq, detailTool: 'qq_get_message_detail', reason: 'textTruncated' });
  }
  for (const item of recent.items) {
    if (item.textTruncated && !refs.some((r) => r.seq === item.seq)) {
      refs.push({ type: 'message', seq: item.seq, detailTool: 'qq_get_message_detail', reason: 'textTruncated' });
    }
  }
  const out = {
    ok: true,
    version: SNAPSHOT_VERSION,
    snapshotId,
    key,
    groupName,
    fetchedAt: now,
    caps: c,
    counts: {
      unread: unreadAll.length,
      unreadAfterSeq: unreadFiltered.length,
      recent: recentAll.length,
      activeMembers: activeMembers.length,
    },
    refs,
  };
  if (wanted.has('unread')) out.unread = unread;
  if (wanted.has('recent')) out.recent = recent;
  if (wanted.has('social')) out.social = social;
  if (wanted.has('activeMembers')) out.activeMembers = activeMembers;
  return out;
}
