/**
 * QQ 工具层：她的手（渠道动作）
 * ============================================================================
 * 位置：**平台包**。这些动作只在 QQ 这个世界里存在（撤回/禁言/改名片/戳一戳），
 * 内核不该认识它们；内核只说"我要做一件事"（act 意图），由包翻译成具体动作。
 *
 * 三条规矩：
 *   · **分级**：read（只读）/ write（写，可逆）/ manage（管理，影响别人）
 *   · **默认只开 read**：写与管理必须显式打开（fail-closed）
 *   · 每个工具自己校验参数；缺参数就报错，不猜
 *
 * 协议只有 OneBot v11；网关由用户自备（不随包分发）。
 */

/** 工具清单：kind + 需要哪些参数 + 对应的 OneBot action */
export const QQ_TOOLS = Object.freeze([
  // ── 只读 ──
  { name: 'get_login_info', kind: 'read', action: 'get_login_info', params: [] },
  { name: 'get_status', kind: 'read', action: 'get_status', params: [] },
  { name: 'get_version_info', kind: 'read', action: 'get_version_info', params: [] },
  { name: 'get_group_list', kind: 'read', action: 'get_group_list', params: [] },
  { name: 'get_group_info', kind: 'read', action: 'get_group_info', params: [], needGroup: true },
  { name: 'get_group_member_list', kind: 'read', action: 'get_group_member_list', params: [], needGroup: true },
  { name: 'get_group_member_info', kind: 'read', action: 'get_group_member_info', params: ['userId'], needGroup: true },
  { name: 'get_friend_list', kind: 'read', action: 'get_friend_list', params: [] },
  { name: 'get_stranger_info', kind: 'read', action: 'get_stranger_info', params: ['userId'] },
  { name: 'get_msg', kind: 'read', action: 'get_msg', params: ['messageId'] },
  { name: 'get_group_msg_history', kind: 'read', action: 'get_group_msg_history', params: [], needGroup: true },

  // ── 写（可逆） ──
  { name: 'delete_msg', kind: 'write', action: 'delete_msg', params: ['messageId'] },
  { name: 'send_poke', kind: 'write', action: 'send_poke', params: ['userId'], needGroup: true },
  { name: 'send_like', kind: 'write', action: 'send_like', params: ['userId'], times: 10 },
  { name: 'set_group_card', kind: 'write', action: 'set_group_card', params: ['userId', 'card'], needGroup: true },

  // ── 管理（影响别人） ──
  { name: 'set_group_ban', kind: 'manage', action: 'set_group_ban', params: ['userId', 'duration'], needGroup: true },
  { name: 'set_group_kick', kind: 'manage', action: 'set_group_kick', params: ['userId'], needGroup: true },
  { name: 'set_group_admin', kind: 'manage', action: 'set_group_admin', params: ['userId', 'enable'], needGroup: true },
  { name: 'set_group_whole_ban', kind: 'manage', action: 'set_group_whole_ban', params: ['enable'], needGroup: true },
  { name: 'set_group_name', kind: 'manage', action: 'set_group_name', params: ['groupName'], needGroup: true },
  { name: 'set_group_leave', kind: 'manage', action: 'set_group_leave', params: [], needGroup: true },
  { name: 'set_group_add_request', kind: 'manage', action: 'set_group_add_request', params: ['flag', 'approve'] },
]);

const byName = new Map(QQ_TOOLS.map((t) => [t.name, t]));

/**
 * 造一个工具执行器。
 * @param {object} opts { client, allowWrite=false, allowManage=false }
 * @returns {{run(name, args, channel), list()}}
 */
export function createToolRunner({ client, allowWrite = false, allowManage = false } = {}) {
  if (!client || typeof client.call !== 'function') throw new Error('工具执行器需要一个 onebot 客户端');

  /** 从频道里取 group id（'group:123' → 123）；私聊且工具需要群 → 报错 */
  function groupIdOf(channel) {
    const m = /^group:(\d+)$/.exec(String(channel ?? ''));
    return m ? Number(m[1]) : null;
  }

  return {
    /** 可用工具（给内核工具面/设置页看） */
    list() {
      return QQ_TOOLS.map((t) => ({ name: t.name, kind: t.kind, params: t.params }));
    },

    /**
     * 执行一次渠道动作。
     * @returns {Promise<{ok:boolean, data?:any, error?:object}>}
     */
    async run(name, args = {}, channel = '') {
      const tool = byName.get(String(name ?? ''));
      if (!tool) return { ok: false, error: { code: 'qq.tool-unknown', message: `没有这个工具：${name}` } };

      if (tool.kind === 'write' && !allowWrite) {
        return { ok: false, error: { code: 'qq.tool-denied', message: `写操作没打开：${name}` } };
      }
      if (tool.kind === 'manage' && !allowManage) {
        return { ok: false, error: { code: 'qq.tool-denied', message: `管理操作没打开：${name}` } };
      }

      const missing = tool.params.filter((p) => args?.[p] === undefined || args?.[p] === null || args?.[p] === '');
      const needGroup = tool.needGroup === true || tool.params.includes('groupId');
      const groupId = groupIdOf(channel);

      if (missing.length && !(missing.length === 1 && missing[0] === 'groupId' && groupId !== null)) {
        return { ok: false, error: { code: 'qq.tool-missing-arg', message: `${name} 缺少参数：${missing.join(', ')}` } };
      }

      const params = { ...args };
      if (needGroup) {
        if (groupId === null) return { ok: false, error: { code: 'qq.tool-need-group', message: `${name} 只能在群里用` } };
        params.group_id = groupId; delete params.groupId;
      }
      // 有默认值的参数（比如点赞次数）
      if (tool.times !== undefined && params.times === undefined) params.times = tool.times;

      // 参数名从 camelCase 映射到 OneBot 的 snake_case
      // 注意：**只放真正需要改名的**；同名项（card/duration/enable/flag）不要进表，
      // 否则"先赋值给自己再删除"会把值删掉（踩过）。
      const snake = { userId: 'user_id', messageId: 'message_id', groupName: 'group_name', messageSeq: 'message_seq' };
      for (const [from, to] of Object.entries(snake)) {
        if (from === to) continue;
        if (params[from] !== undefined) { params[to] = params[from]; delete params[from]; }
      }

      const res = await client.call(tool.action, params);
      return res.ok
        ? { ok: true, data: res.data ?? null }
        : { ok: false, error: res.error ?? { code: 'qq.tool-failed', message: '动作失败' } };
    },
  };
}
