/**
 * QQ 桥接通道的「语义工具」（旧 mcp-snowluma-safe.js 里除 21 个 OneBot 动作之外的部分）
 * ============================================================================
 * 位置：QQ 模块。它隐藏的秘密是**用户自备网关的 HTTP 形状**（/api/socialV2/*、
 * 请求头、把 ok:false 解成什么）。OneBot 的 21 个原生动作在 tools.js；
 * 这里只放"语义动作"（读未读/上下文/表情/语音/记忆…），两边不重复。
 *
 * 三条规矩（旧代码的坑，逐条修）：
 *   ① **失败必须有结构化 code/hint**：旧代码只回一行中文，调用方没法分支。
 *   ② **写操作默认关**（fail-closed）：mark_read / wait / refresh 都不许偷偷跑。
 *   ③ **令牌只由运行时注入**：不放进工具参数、不进日志、不出现在返回里。
 *
 * 传输（fetch/超时/头）与工具表分开：工具表可离线测，传输可单独换。
 */

/** 桥接控制台的默认地址（用户自备网关；不是随包分发的东西） */
export const BRIDGE_API_PREFIX = '/api/socialV2';

const KEY_DESC = '会话 key，格式 group:群号 或 private:QQ号';

/**
 * 工具表：名字 / 读写级别 / HTTP 形状 / 参数。
 * `params` 里 `required:true` 的进 JSON Schema 的 required。
 */
export const QQ_BRIDGE_TOOLS = Object.freeze([
  {
    name: 'qq_get_prompt',
    kind: 'read',
    method: 'GET',
    path: '/api/socialV2/prompt',
    description: '看当前会话的提示词/角色/唤醒配置（只读；网关可能顺带刷新表情缓存）',
    params: [
      { name: 'key', type: 'string', required: true, description: KEY_DESC },
      { name: 'mode', type: 'string', description: 'tone=只看语气与场景；full=完整核心' },
      { name: 'sections', type: 'array', description: '要哪些段：role/wake/memory/stickers/slang/closure/voices' },
    ],
  },
  {
    name: 'qq_get_context_snapshot',
    kind: 'read',
    method: 'GET',
    path: '/api/socialV2/snapshot',
    description: '一次读会话上下文：未读 + 最近 + 状态 + 活跃成员（只读）',
    params: [
      { name: 'key', type: 'string', required: true, description: KEY_DESC },
      { name: 'include', type: 'array', description: '只取哪几类：unread/recent/social/activeMembers' },
      { name: 'unreadLimit', type: 'number', default: 12, description: '未读最多几条' },
      { name: 'recentLimit', type: 'number', default: 10, description: '最近最多几条' },
      { name: 'afterSeq', type: 'number', description: '只取本地 seq 大于该水位的未读（补读用）' },
      { name: 'textChars', type: 'number', default: 200, description: '每条正文最多多少字' },
    ],
  },
  {
    name: 'qq_read',
    kind: 'read',
    method: 'GET',
    path: '/api/socialV2/snapshot',
    description: '一次读全当前会话（未读 + 最近 + 状态 + 活跃成员；只读）',
    params: [
      { name: 'key', type: 'string', required: true, description: KEY_DESC },
      { name: 'afterSeq', type: 'number', description: '只取大于该水位的未读' },
    ],
  },
  {
    name: 'qq_get_unread_messages',
    kind: 'read',
    method: 'GET',
    path: '/api/socialV2/unread',
    description: '取未读消息（不自动标记已读）',
    params: [
      { name: 'key', type: 'string', required: true, description: KEY_DESC },
      { name: 'limit', type: 'number', default: 30, description: '最多几条（网关上限 100）' },
      { name: 'afterSeq', type: 'number', description: '从哪条之后开始补读' },
    ],
  },
  {
    name: 'qq_get_recent_messages',
    kind: 'read',
    method: 'GET',
    path: '/api/socialV2/recent',
    description: '取最近消息（含自己说的）',
    params: [
      { name: 'key', type: 'string', required: true, description: KEY_DESC },
      { name: 'limit', type: 'number', default: 20, description: '最多几条' },
      { name: 'offset', type: 'number', default: 0, description: '往回翻的偏移' },
    ],
  },
  {
    name: 'qq_social_state',
    kind: 'read',
    method: 'GET',
    path: '/api/socialV2/state',
    description: '看这个会话的唤醒/未读/收尾状态（只读）',
    params: [{ name: 'key', type: 'string', required: true, description: KEY_DESC }],
  },
  {
    name: 'qq_get_active_members',
    kind: 'read',
    method: 'GET',
    path: '/api/socialV2/active-members',
    description: '看最近谁在这个会话里最活跃（只读）',
    params: [
      { name: 'key', type: 'string', required: true, description: KEY_DESC },
      { name: 'limit', type: 'number', default: 10, description: '最多几个人' },
    ],
  },
  {
    name: 'qq_get_message_detail',
    kind: 'read',
    method: 'GET',
    path: '/api/socialV2/message-detail',
    description: '看单条消息的发送者/引用/正文摘要（只读）',
    params: [
      { name: 'key', type: 'string', required: true, description: KEY_DESC },
      { name: 'messageId', type: 'string', required: true, description: '消息 id（可能为负数）' },
    ],
  },
  {
    name: 'qq_get_forward_msg',
    kind: 'read',
    method: 'GET',
    path: '/api/socialV2/forward-message',
    description: '看当前会话里的一条合并转发（只读；图片只给文字标签）',
    params: [
      { name: 'key', type: 'string', required: true, description: KEY_DESC },
      { name: 'id', type: 'string', required: true, description: '转发消息 id' },
    ],
  },
  {
    name: 'qq_get_my_recent_messages',
    kind: 'read',
    method: 'GET',
    path: '/api/socialV2/my-recent',
    description: '看自己最近说过的话（只读）',
    params: [
      { name: 'key', type: 'string', required: true, description: KEY_DESC },
      { name: 'limit', type: 'number', default: 10, description: '最多几条' },
    ],
  },
  {
    name: 'qq_slang_query',
    kind: 'read',
    method: 'GET',
    path: '/api/socialV2/slang/query',
    description: '查这个会话已经确认的黑话/梗（只读）',
    params: [
      { name: 'key', type: 'string', required: true, description: KEY_DESC },
      { name: 'q', type: 'string', description: '搜索词；不传就列全部' },
    ],
  },
  {
    name: 'qq_list_stickers',
    kind: 'read',
    method: 'POST',
    path: '/api/socialV2/sticker-list',
    description: '看已收藏的表情（刷新缓存属于写操作，默认关）',
    params: [
      { name: 'key', type: 'string', required: true, description: KEY_DESC },
      { name: 'query', type: 'string', description: '按编号/情绪/内容/备注搜' },
      { name: 'count', type: 'number', default: 48, description: '最多几条' },
      { name: 'refresh', type: 'boolean', default: false, description: '强制从网关重新同步（写操作，默认关）' },
    ],
  },
  {
    name: 'qq_list_voices',
    kind: 'read',
    method: 'GET',
    path: '/api/socialV2/voices',
    description: '看语音库里有哪些音频（只读；探测时长可能要几秒）',
    params: [
      { name: 'key', type: 'string', required: true, description: KEY_DESC },
      { name: 'probe', type: 'boolean', default: true, description: '是否逐个探测时长' },
    ],
  },
  {
    name: 'qq_memory_query',
    kind: 'read',
    method: 'GET',
    path: '/api/socialV2/memory',
    description: '看这个会话的轻量记忆（进行中的话题/想说的话/对群友的印象；只读）',
    params: [
      { name: 'key', type: 'string', required: true, description: KEY_DESC },
      { name: 'category', type: 'string', description: '只看一类：activeTopic/pendingThought/memberImpression' },
    ],
  },
  {
    name: 'qq_get_message_images',
    kind: 'read',
    method: 'GET',
    path: '/api/images/message',
    description: '取指定消息里的图片/表情字节（直接给模型看；只读）',
    params: [
      { name: 'key', type: 'string', required: true, description: KEY_DESC },
      { name: 'messageId', type: 'string', required: true, description: '消息 id（可能为负数；也可用本地 seq）' },
    ],
    shape(data) {
      const images = Array.isArray(data?.images) ? data.images : [];
      const { media, dropped } = decodeImages(images);
      return {
        data: { count: media.length, total: images.length, note: String(data?.note ?? ''), dropped },
        media,
        dropped,
      };
    },
  },
  {
    name: 'qq_get_sticker_image',
    kind: 'read',
    method: 'GET',
    path: '/api/socialV2/sticker-image',
    description: '取一张收藏表情的图片字节（直接给模型看；只读）',
    params: [
      { name: 'key', type: 'string', required: true, description: KEY_DESC },
      { name: 'stickerId', type: 'string', required: true, description: '表情标识：emoji_id / md5 / 图片 URL' },
    ],
    shape(data) {
      const image = data?.image ?? null;
      const { media, dropped } = decodeImages(image ? [image] : []);
      return {
        data: {
          sticker: data?.sticker ?? null,
          text: String(data?.text ?? ''),
          count: media.length,
          dropped,
        },
        media,
        dropped,
      };
    },
  },
  {
    name: 'qq_mark_read',
    kind: 'write',
    method: 'POST',
    path: '/api/socialV2/mark-read',
    description: '把已查看的未读标为已读（写操作；不传 throughSeq 会清空全部未读）',
    params: [
      { name: 'key', type: 'string', required: true, description: KEY_DESC },
      { name: 'throughSeq', type: 'number', description: '已读到哪个水位；建议总是带上' },
    ],
  },
  {
    name: 'qq_wait_for_messages',
    kind: 'write',
    method: 'POST',
    path: '/api/socialV2/wait',
    description: '等新消息/等对方说完（有状态：会推进水位；默认关）',
    params: [
      { name: 'key', type: 'string', required: true, description: KEY_DESC },
      { name: 'purpose', type: 'string', description: 'messages=等新消息/睡前观察；reply=回复前短静默' },
      { name: 'timeoutMs', type: 'number', default: 30000, description: '最长等多久（毫秒）' },
      { name: 'minNewMessages', type: 'number', description: '至少等到几条新消息' },
      { name: 'quietMs', type: 'number', description: '静默窗口（毫秒）' },
    ],
  },
]);

const BY_NAME = new Map(QQ_BRIDGE_TOOLS.map((t) => [t.name, t]));
const KEY_RE = /^(group|private):\d+$/;

/**
 * 桥接把图片放在 base64 里；这里只做"解码成字节"，不认识图片格式。
 * 解不出来就记 dropped（调用方会告诉模型"这张取不到"），不假装成功。
 */
function decodeImages(images = []) {
  const media = [];
  const dropped = [];
  for (const [i, img] of (Array.isArray(images) ? images : []).entries()) {
    const data = String(img?.data ?? '').trim();
    const mimeType = String(img?.mimeType ?? img?.mime ?? '').trim();
    if (!data || !mimeType) { dropped.push({ index: i, reason: 'no-data' }); continue; }
    try {
      const bytes = Buffer.from(data, 'base64');
      if (!bytes.length) { dropped.push({ index: i, reason: 'empty' }); continue; }
      media.push({ kind: 'image', bytes, mimeType, caption: String(img?.text ?? '') });
    } catch {
      dropped.push({ index: i, reason: 'bad-base64' });
    }
  }
  return { media, dropped };
}

function schemaOf(tool) {
  const properties = {};
  for (const p of tool.params) {
    properties[p.name] = {
      type: p.type === 'array' ? 'array' : p.type,
      ...(p.type === 'array' ? { items: { type: 'string' } } : {}),
      ...(p.description ? { description: p.description } : {}),
    };
  }
  return {
    type: 'object',
    properties,
    required: tool.params.filter((p) => p.required).map((p) => p.name),
    additionalProperties: false,
  };
}

/** 给模型看的工具声明（不带令牌、不带内部形状）
 * @param {object} opts { includeKey=true, includeWrite=false }
 *   includeKey=false：会话 key 由包从频道自动补，模型不必填
 *   includeWrite=false：写工具默认不交给模型（fail-closed）
 */
export function bridgeToolDeclarations({ includeKey = true, includeWrite = false } = {}) {
  const kinds = includeWrite ? ['read', 'write'] : ['read'];
  return QQ_BRIDGE_TOOLS
    .filter((t) => kinds.includes(t.kind))
    .map((t) => {
      const params = includeKey ? t.params : t.params.filter((p) => p.name !== 'key');
      return { name: t.name, description: t.description, parameters: schemaOf({ ...t, params }) };
    });
}

/**
 * HTTP 传输：只认"桥接控制台"的 HTTP 形状。
 * @param {object} opts { baseUrl, consoleToken, agentToken, fetchImpl, timeoutMs }
 */
export function createBridgeTransport({
  baseUrl = 'http://127.0.0.1:3100',
  consoleToken = '',
  agentToken = '',
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
} = {}) {
  const base = String(baseUrl).replace(/\/+$/, '');

  return {
    name: 'bridge',
    /**
     * @param {object} req { method, path, query, body, timeoutMs }
     * @returns {Promise<{ok:true,data:any}|{ok:false,error:object}>}
     */
    async request({ method = 'GET', path = '', query = {}, body = null, timeoutMs: perCall } = {}) {
      if (typeof fetchImpl !== 'function') {
        return { ok: false, error: { code: 'qq.bridge-no-fetch', message: '没有可用的 fetch', retryable: false } };
      }
      if (!agentToken) {
        return { ok: false, error: { code: 'qq.bridge-no-token', message: '桥接令牌还没配', retryable: false, hint: '设置页 → QQ：填入桥接控制台的 agent 令牌' } };
      }
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query ?? {})) {
        if (v === undefined || v === null || v === '') continue;
        qs.set(k, Array.isArray(v) ? v.join(',') : (typeof v === 'boolean' ? (v ? '1' : '0') : String(v)));
      }
      const url = `${base}${path}${qs.toString() ? `?${qs}` : ''}`;
      const ms = Number(perCall) > 0 ? Number(perCall) : timeoutMs;

      let res;
      try {
        res = await fetchImpl(url, {
          method,
          headers: {
            'x-agent-call': '1',
            'x-agent-token': agentToken,
            ...(consoleToken ? { 'x-console-token': consoleToken } : {}),
            ...(body ? { 'content-type': 'application/json' } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(ms),
        });
      } catch (error) {
        const msg = String(error?.message ?? error);
        const timeout = /timeout|abort/i.test(msg);
        return {
          ok: false,
          error: {
            code: timeout ? 'qq.bridge-timeout' : 'qq.bridge-network',
            message: msg,
            retryable: true,
            hint: timeout ? '桥接超时：看桥接控制台是否还活着；长轮询要单独放宽超时' : '连不上桥接：检查地址/端口与网关是否在跑',
          },
        };
      }

      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        const unauthorized = res.status === 401 || res.status === 403;
        return {
          ok: false,
          error: {
            code: unauthorized ? 'qq.bridge-unauthorized' : 'qq.bridge-http',
            status: res.status,
            message: String(payload?.error ?? payload?.message ?? `桥接 HTTP ${res.status}`),
            retryable: !unauthorized && res.status >= 500,
            hint: payload?.hint ?? (unauthorized ? '桥接令牌不对或没开 agent 通道：到设置页检查' : '桥接返回错误：看桥接控制台日志'),
          },
        };
      }
      if (!payload || typeof payload !== 'object') {
        return { ok: false, error: { code: 'qq.bridge-not-json', message: '桥接返回的不是 JSON', retryable: false } };
      }
      if (payload.ok === false) {
        return {
          ok: false,
          error: {
            code: String(payload.code ?? 'qq.bridge-failed'),
            message: String(payload.error ?? '桥接返回失败'),
            ...(payload.hint ? { hint: String(payload.hint) } : {}),
            retryable: false,
          },
        };
      }
      return { ok: true, data: payload };
    },
  };
}

/**
 * 工具执行器：查表 → 校验参数 → 组 query/body → 调传输。
 * @param {object} opts { transport, allowWrite=false, now }
 */
export function createBridgeToolRunner({ transport, allowWrite = false } = {}) {
  if (!transport || typeof transport.request !== 'function') throw new Error('桥接工具需要 transport.request()');

  return {
    list() {
      return QQ_BRIDGE_TOOLS.map((t) => ({ name: t.name, kind: t.kind }));
    },

    /**
     * @returns {Promise<{ok:true,data:any}|{ok:false,error:object}>}
     */
    async run(name, args = {}) {
      const tool = BY_NAME.get(String(name ?? ''));
      if (!tool) return { ok: false, error: { code: 'qq.bridge-tool-unknown', message: `没有这个桥接工具：${name}` } };

      const kindWrite = tool.kind === 'write';
      const refreshWrite = tool.name === 'qq_list_stickers' && args?.refresh === true;
      if ((kindWrite || refreshWrite) && !allowWrite) {
        return {
          ok: false,
          error: {
            code: 'qq.bridge-tool-denied',
            message: `写操作没打开：${name}`,
            hint: '设置页 → QQ：打开「允许写操作」再试；只读工具不需要',
          },
        };
      }

      const missing = tool.params
        .filter((p) => p.required)
        .filter((p) => args?.[p.name] === undefined || args?.[p.name] === null || args?.[p.name] === '');
      if (missing.length) {
        return { ok: false, error: { code: 'qq.bridge-tool-missing-arg', message: `${name} 缺少参数：${missing.map((p) => p.name).join(', ')}` } };
      }
      if (tool.params.some((p) => p.name === 'key') && !KEY_RE.test(String(args?.key ?? ''))) {
        return { ok: false, error: { code: 'qq.bridge-tool-bad-key', message: `key 格式应为 group:群号 或 private:QQ号（收到 ${String(args?.key ?? '')}）` } };
      }

      const values = {};
      for (const p of tool.params) {
        const v = args?.[p.name];
        values[p.name] = v === undefined || v === null || v === '' ? p.default : v;
        if (values[p.name] === undefined) delete values[p.name];
      }
      // 桥接用 camelCase，原样发（OneBot 的 snake_case 映射在 tools.js，别混）
      const normalized = values;

      const res = tool.method === 'GET'
        ? await transport.request({ method: 'GET', path: tool.path, query: normalized })
        : await transport.request({ method: 'POST', path: tool.path, body: normalized });
      if (!res.ok) return res;
      if (typeof tool.shape !== 'function') return res;
      try {
        const shaped = tool.shape(res.data) ?? {};
        return {
          ok: true,
          data: shaped.data ?? null,
          ...(Array.isArray(shaped.media) && shaped.media.length ? { media: shaped.media } : {}),
          ...(Array.isArray(shaped.dropped) && shaped.dropped.length ? { dropped: shaped.dropped } : {}),
        };
      } catch (error) {
        return { ok: false, error: { code: 'qq.tool-shape', message: `${name} 的返回形状不对：${error?.message ?? error}` } };
      }
    },
  };
}

/** 默认注册面：给设置页/状态命令看（哪些工具、读写） */
export function describeBridgeTools() {
  return {
    prefix: BRIDGE_API_PREFIX,
    total: QQ_BRIDGE_TOOLS.length,
    read: QQ_BRIDGE_TOOLS.filter((t) => t.kind === 'read').map((t) => t.name),
    write: QQ_BRIDGE_TOOLS.filter((t) => t.kind === 'write').map((t) => t.name),
  };
}
