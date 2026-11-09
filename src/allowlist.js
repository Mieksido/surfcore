// 白名单（allow）归一化：**唯一实现**，供桥接启动自愈、/api/whitelist、
// 插件 install-apply 共用。
//
// 为什么需要它（2026-10-31 用户反馈）：
//   1. allow.private 里出现机器人自己的号（selfUserId）→ 主人私信被当未授权忽略；
//   2. install-apply 用 `priv = [owner]` 整体替换 → 用户加的白名单被冲掉。
//   根因是「三个写入点各自拼数组」，没有共同约束。这里把规则收敛成纯函数：
//   · 去掉机器人自己（它永远不需要"允许"，允许了也不会收到自己的私信）；
//   · 主人必须在 allow.private 里（否则主人私信会被忽略）；
//   · 保留调用方已有条目，去重、去掉非法值；
//   · 返回 changed / warnings，调用方据此决定是否落盘、是否发提醒。

const QQ_RE = /^\d{5,15}$/;

function toIds(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const id = String(raw ?? '').trim();
    if (!QQ_RE.test(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(Number(id));
  }
  return out;
}

/**
 * @param {{allow?:{private?:any[],groups?:any[]}, ownerQQ?:string|number, selfUserId?:string|number}} input
 * @returns {{allow:{private:number[],groups:number[]}, changed:boolean, warnings:{code:string,message:string}[]}}
 */
export function normalizeAllowlist({ allow, ownerQQ = '', selfUserId = '' } = {}) {
  const src = allow && typeof allow === 'object' ? allow : {};
  const warnings = [];
  const owner = String(ownerQQ ?? '').trim();
  const self = String(selfUserId ?? '').trim();

  const beforeGroups = toIds(src.groups);
  const beforePrivate = toIds(src.private);

  let groups = beforeGroups.filter((id) => !(self && String(id) === self));
  if (groups.length !== beforeGroups.length) {
    warnings.push({ code: 'ALLOW_SELF_REMOVED', message: `已从群白名单移除机器人自己（${self}）` });
  }

  let privateIds = beforePrivate.filter((id) => !(self && String(id) === self));
  if (privateIds.length !== beforePrivate.length) {
    warnings.push({ code: 'ALLOW_SELF_REMOVED', message: `已从私聊白名单移除机器人自己（${self}），它不该出现在这里` });
  }
  if (QQ_RE.test(owner) && !privateIds.some((id) => String(id) === owner)) {
    privateIds = [...privateIds, Number(owner)];
    warnings.push({ code: 'ALLOW_OWNER_ADDED', message: `私聊白名单缺少管理员（${owner}），已补上（否则管理员私信会被忽略）` });
  }
  if (!QQ_RE.test(owner) && !self) {
    // 没有主人也没有 self：不推断，只把非法项去掉（changed 由下面比较决定）。
    if (beforePrivate.length !== privateIds.length) {
      warnings.push({ code: 'ALLOW_INVALID_REMOVED', message: '已移除私聊白名单里的非法条目（不是 5~15 位数字）' });
    }
  }

  groups = [...new Set(groups)];
  privateIds = [...new Set(privateIds)];
  const changed = JSON.stringify(groups) !== JSON.stringify(beforeGroups)
    || JSON.stringify(privateIds) !== JSON.stringify(beforePrivate);

  return { allow: { private: privateIds, groups }, changed, warnings };
}

/**
 * 从会话表里挑出「需要补唤醒」的会话：允许范围内、有未读、没有已排的唤醒定时器。
 * 纯函数，便于单测；真正的唤醒由桥接做。
 * @param {Iterable<[string, any]>} entries socialV2.conversations.entries()
 * @param {{isAllowed:(key:string)=>boolean}} opts
 */
export function pickBacklogSessions(entries, { isAllowed } = {}) {
  const out = [];
  for (const [key, st] of entries ?? []) {
    if (!st || typeof st !== 'object') continue;
    if (typeof isAllowed === 'function' && !isAllowed(key)) continue;
    if (!Array.isArray(st.unread) || st.unread.length === 0) continue;
    if (st.pendingWakeTimer) continue;
    out.push({ key, unread: st.unread.length });
  }
  return out;
}
