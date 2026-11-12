/**
 * 白名单：谁能跟她说话
 * ============================================================================
 * 为什么在运行时：这是**部署策略**，不是"她怎么想"。她不需要知道"这个群没被允许"，
 * 因为消息根本不该进到内核。放在管道入口最省事，也最安全（拦在门外）。
 *
 * 支持两种写法：'123456' 或 'group:123456' / 'private:abc'。
 * fail-closed：没配白名单且没开 allowAll → 一律不放行。
 */

/** 设置页的声明（文本型：逗号分隔的名单）。**内容变更**：新增了 type:'text' 的字段 */
export const ALLOWLIST_SETTINGS = Object.freeze([
  {
    key: 'allow.groups', label: '允许的群', type: 'text', defaultValue: '', maxChars: 500,
    description: '逗号分隔的群号；留空表示一个群都不放行',
    cost: '留空 = 群里谁都不能跟她说话（私聊不受影响）',
    group: 'basic',
  },
  {
    key: 'allow.privates', label: '允许的私聊', type: 'text', defaultValue: '', maxChars: 500,
    description: '逗号分隔的平台账号；留空表示谁都不能私聊她',
    cost: '留空 = 所有私聊都被拒绝',
    group: 'basic',
  },
  {
    key: 'allow.all', label: '全部放行（不推荐）', defaultValue: false, options: [true, false],
    description: '打开后不再检查名单',
    cost: '打开后任何人都能跟她说话，包括陌生人',
    group: 'advanced',
  },
]);

/** 把设置里的字符串拆成名单（去空白、去重、去掉前缀） */
export function parseList(text) {
  return [...new Set(String(text ?? '')
    .split(/[,，\s]+/)
    .map((x) => x.trim().replace(/^(group|private):/, ''))
    .filter(Boolean))];
}

/** 从设置值造一个白名单（设置没配就用保守默认） */
export function allowlistFromSettings(values = {}, { ownerId = null } = {}) {
  return createAllowlist({
    groups: parseList(values['allow.groups']),
    privates: parseList(values['allow.privates']),
    allowAll: values['allow.all'] === true,
    ownerId,
  });
}

export function createAllowlist({ groups = [], privates = [], allowAll = false, ownerId = null } = {}) {
  const norm = (list) => new Set((Array.isArray(list) ? list : []).map((x) => String(x).replace(/^(group|private):/, '')));
  const groupSet = norm(groups);
  const privateSet = norm(privates);
  const owner = ownerId === null ? null : String(ownerId);

  return {
    /**
     * @param {object} input { channel, actor, isOwner }
     * @returns {{ok:boolean, reason:string}}
     */
    check({ channel = '', actor = null, isOwner = false } = {}) {
      if (owner !== null && String(actor ?? '') === owner) return { ok: true, reason: 'owner' };
      if (isOwner === true) return { ok: true, reason: 'owner' };

      const raw = String(channel ?? '');
      const m = /^(group|private):(.+)$/.exec(raw);
      // 只治理它认识的两种频道（群/私聊）。其它形态（本地终端等）不归它管，
      // 由那个渠道自己的策略负责——这不是放水，是**管的范围要说清**。
      if (!m) return { ok: true, reason: 'not-governed' };

      if (allowAll) return { ok: true, reason: 'allow-all' };
      const set = m[1] === 'group' ? groupSet : privateSet;
      if (!set.size) return { ok: false, reason: 'empty-allowlist' };
      if (set.has(m[2])) return { ok: true, reason: 'listed' };
      return { ok: false, reason: 'not-listed' };
    },

    snapshot() { return { groups: [...groupSet], privates: [...privateSet], allowAll, owner }; },
  };
}
