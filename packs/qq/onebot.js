/**
 * QQ 包的传输层：OneBot v11 事件规范化 + HTTP 动作调用
 * ============================================================================
 * 两件事，都可离线测试（注入 fetch 即可）：
 *   ① normalizeEvent：把网关推来的原始事件 → 新架构的"事件"
 *   ② createClient：发消息（HTTP POST），带超时与结构化失败
 *
 * 注意：**上行（WS 推送）还需要一个 WS 客户端**，那要连真网关才能验，
 * 这里只做"可判定"的部分：规范化 + 发送。接收器留一个明确的接口（attach）。
 */
import { safeText } from './text.js';

export const ONEBOT_ACTION = Object.freeze({
  group: 'send_group_msg',
  private: 'send_private_msg',
});

/**
 * 把 OneBot 的消息段数组拆成"内容"。
 * 只认新架构认识的四类：文本 / 图像 / 音频 / 视频；其它段（表情、卡片、转发…）忽略。
 * 未知段一律丢弃但不报错 —— 前向兼容（网关升级不会把包弄崩）。
 *
 * 合并转发是个例外：它**不是媒体**，是一段聊天记录。这里只记下"有转发、编号是多少"，
 * 真正去取内容在 attach（异步），由 forward.js 拍平成文本。
 */
export function parseSegments(segments = []) {
  const media = [];
  let text = '';
  let replyTo = '';
  const mentions = [];
  const forwards = [];

  for (const seg of Array.isArray(segments) ? segments : []) {
    const d = seg?.data ?? {};
    switch (seg?.type) {
      case 'text': text += String(d.text ?? ''); break;
      case 'at': mentions.push(String(d.qq ?? '')); break;
      case 'reply': replyTo = d.id === undefined ? '' : String(d.id); break;
      case 'image': media.push({ kind: 'image', path: String(d.url ?? d.file ?? ''), caption: String(d.summary ?? '') }); break;
      case 'record': media.push({ kind: 'audio', path: String(d.url ?? d.file ?? ''), caption: '' }); break;
      case 'video': media.push({ kind: 'video', path: String(d.url ?? d.file ?? ''), caption: '' }); break;
      case 'face': text += '[表情]'; break;
      case 'forward': {
        // 合并转发：可能是 id（要去取），也可能是内联的 content 数组
        if (d.id !== undefined && d.id !== null) forwards.push({ id: String(d.id) });
        else if (Array.isArray(d.content)) forwards.push({ content: d.content });
        else forwards.push({ id: '' });
        break;
      }
      case 'json': {
        // 有些网关把合并转发塞在 json 卡片里：只取人能读的 prompt/summary，不解析整段 JSON
        const card = (() => { try { return JSON.parse(String(d.data ?? '{}')); } catch { return null; } })();
        const brief = String(card?.prompt ?? card?.meta?.detail?.title ?? card?.meta?.news?.title ?? '').trim();
        if (brief) forwards.push({ brief });
        break;
      }
      default: break;   // 其它未知段：忽略
    }
  }
  return { text: text.trim(), media, replyTo, mentions, forwards };
}

/**
 * OneBot v11 事件 → 新架构事件。不认识的直接返回 null（前向兼容）。
 * @param {object} raw 网关推送的原始事件
 * @param {object} [opts] { ownerId?:string } 用来判断"是不是主人"
 */
export function normalizeEvent(raw = {}, opts = {}) {
  // 通知类（拍一拍等）：**不另开通道**，统一成事件走同一条 pipe
  if (raw?.post_type === 'notice') return normalizeNotice(raw, opts);
  if (!raw || raw.post_type !== 'message') return null;

  const isGroup = raw.message_type === 'group';
  const kind = isGroup ? 'group' : 'private';
  const channel = isGroup ? `group:${raw.group_id}` : `private:${raw.user_id}`;
  const selfId = String(raw.self_id ?? '');
  const parsed = parseSegments(raw.message);
  const mentionsSelf = parsed.mentions.includes(selfId);
  // 没有段数组的网关（老实现）只能靠 raw_message
  const text = parsed.text ? safeText(parsed.text) : safeText(String(raw.raw_message ?? '').trim());

  return {
    from: {
      channel,
      kind,
      actor: String(raw.sender?.user_id ?? raw.user_id ?? ''),
      at: Number(raw.time) > 0 ? Number(raw.time) * 1000 : Date.now(),
    },
    text,
    media: parsed.media,
    // 合并转发：包内临时字段（attach 拍平后删掉，不进契约）
    forwards: parsed.forwards ?? [],
    replyTo: parsed.replyTo || undefined,
    source: 'user',
    externalId: raw.message_id === undefined ? '' : String(raw.message_id),
    mentioned: mentionsSelf,
    to: { owner: Boolean(opts.ownerId) && String(raw.sender?.user_id ?? raw.user_id) === String(opts.ownerId) },
  };
}

/**
 * 通知类事件（拍一拍 / 入群 等）→ 新架构事件。
 * **不新增消息通道**：仍然是一个普通事件，只是 text 为空、用现有字段表达"被拍"。
 * 拍一拍打到她自己身上时，用 mentioned:true 表达 —— 这是内核已有的注意力信号，
 * 不需要为"拍一拍"引入内核不认识的新字段。
 */
export function normalizeNotice(raw = {}, opts = {}) {
  if (raw?.post_type !== 'notice') return null;
  const isGroup = raw.group_id !== undefined && raw.group_id !== null;
  const channel = isGroup ? `group:${raw.group_id}` : `private:${raw.user_id}`;
  const actor = String(raw.user_id ?? raw.operator_id ?? '');
  const selfId = String(raw.self_id ?? '');
  const poked = raw.sub_type === 'poke';
  const pokedSelf = poked && String(raw.target_id ?? '') === selfId;

  return {
    from: {
      channel,
      kind: isGroup ? 'group' : 'private',
      actor,
      at: Number(raw.time) > 0 ? Number(raw.time) * 1000 : Date.now(),
    },
    text: '',                          // 通知没有正文
    media: [],
    replyTo: undefined,                // 保持信封一致（这个字段本来就允许为空）
    source: 'system',                  // 复用已有字段：通知不是"用户说的"
    externalId: raw.notice_id === undefined ? '' : String(raw.notice_id),
    mentioned: pokedSelf,              // 拍到我 = 注意力信号（复用现有字段，不加新字段）
    to: { owner: Boolean(opts.ownerId) && actor === String(opts.ownerId) },
  };
}

/**
 * 创建一个 OneBot HTTP 客户端。
 * @param {object} opts { httpUrl, accessToken, fetchImpl, timeoutMs }
 */
export function createClient({
  httpUrl = 'http://127.0.0.1:3000',
  accessToken = '',
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
} = {}) {
  const base = String(httpUrl).replace(/\/+$/, '');

  async function call(action, params = {}) {
    if (typeof fetchImpl !== 'function') {
      return { ok: false, status: 'failed', error: { code: 'qq.no-fetch', message: '没有可用的 fetch', retryable: false } };
    }
    try {
      const res = await fetchImpl(`${base}/${action}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.status === 'failed' || (body.retcode !== undefined && body.retcode !== 0)) {
        return {
          ok: false,
          status: 'failed',
          error: { code: 'qq.send-failed', message: String(body.wording ?? body.message ?? res.status), retryable: true },
        };
      }
      return { ok: true, status: 'delivered', data: body.data ?? null };
    } catch (error) {
      const msg = String(error?.message ?? error);
      const isTimeout = /timeout|abort/i.test(msg);
      return {
        ok: false,
        status: isTimeout ? 'unconfirmed' : 'failed',   // 超时：可能已经发出去了 → 不许当失败重发
        error: {
          code: isTimeout ? 'qq.timeout' : 'qq.network',
          message: msg,
          retryable: !isTimeout,
          hint: isTimeout ? '超时：可能已经发出去了，先别重发，等对方回应' : '连不上网关：检查控制台里 QQ 是否在线',
        },
      };
    }
  }

  /** 发一组消息段（文本/图片/语音可以混在一条里） */
  async function sendSegments({ kind = 'group', id, segments = [], replyTo }) {
    const action = kind === 'private' ? ONEBOT_ACTION.private : ONEBOT_ACTION.group;
    const message = [...(Array.isArray(segments) ? segments : [])];
    if (replyTo) message.unshift({ type: 'reply', data: { id: String(replyTo) } });
    const params = kind === 'private'
      ? { user_id: Number(id), message }
      : { group_id: Number(id), message };
    return call(action, params);
  }

  return {
    call,
    sendSegments,
    /** 发一条文本到群或私聊 */
    async send({ kind = 'group', id, text, replyTo }) {
      return sendSegments({ kind, id, segments: [{ type: 'text', data: { text } }], replyTo });
    },
    /** 发媒体：只认图像/音频/视频（其它交给调用方决定） */
    async sendMedia({ kind = 'group', id, media = [], replyTo }) {
      const segments = [];
      for (const m of media) {
        if (!m?.path) continue;
        if (m.kind === 'audio') segments.push({ type: 'record', data: { file: String(m.path) } });
        else if (m.kind === 'video') segments.push({ type: 'video', data: { file: String(m.path) } });
        else segments.push({ type: 'image', data: { file: String(m.path) } });
      }
      if (!segments.length) return { ok: false, status: 'failed', error: { code: 'qq.no-media', message: '没有可发的媒体' } };
      return sendSegments({ kind, id, segments, replyTo });
    },
    getLoginInfo() { return call('get_login_info'); },
  };
}
