/**
 * 合并转发：把一段聊天记录拍平成文本
 * ============================================================================
 * 位置：QQ 模块。**它只是"把平台的聊天记录读成人话"**，不产出新消息类型。
 *
 * 旧代码 forward.js（231 行）的取数经验保留：
 *   · 只取前 N 条（默认 20），每条限长（默认 120 字），整体限长（默认 1200 字）
 *   · 图片/表情/语音用 `[图片]` 之类占位——**不要把 URL 塞进正文**
 *   · 取不到就如实标注（"（这段转发取不到内容）"），不假装看懂
 *
 * 为什么不做"发"：发合并转发要给媒体加一种新 kind（接口内容变更），暂不做。
 */

export const FORWARD = Object.freeze({ maxMessages: 20, maxCharsPerMessage: 120, maxTotalChars: 1200 });

const NAME_MAX = 24;

const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** 一条消息 → 一行文本（媒体给占位，不给 URL） */
export function lineOfMessage(msg = {}, cfg = FORWARD) {
  const sender = msg.sender?.card || msg.sender?.nickname || msg.nickname || '某人';
  let body = '';
  if (Array.isArray(msg.message)) {
    for (const seg of msg.message) {
      const d = seg?.data ?? {};
      switch (seg?.type) {
        case 'text': body += String(d.text ?? ''); break;
        case 'at': body += `@${d.qq ?? ''}`; break;
        case 'image': body += '[图片]'; break;
        case 'face': body += '[表情]'; break;
        case 'record': body += '[语音]'; break;
        case 'video': body += '[视频]'; break;
        case 'forward': body += '[又一段转发]'; break;
        default: break;
      }
    }
  } else {
    body = String(msg.message ?? msg.content ?? msg.text ?? '');
  }
  const text = clean(body, cfg.maxCharsPerMessage);
  return `- ${clean(sender, NAME_MAX)}：${text || '[空消息]'}`;
}

/**
 * 拍平一段转发。
 * @param {object} input { fetchForward（async id → 原始返回）, ref（{id}|{content}|{brief}）, cfg }
 * @returns {Promise<{ok:boolean, text:string, count:number, error?:string}>}
 */
export async function flattenForward({ fetchForward, ref = {}, cfg = FORWARD } = {}) {
  const conf = { ...FORWARD, ...cfg };

  // 内联内容（老网关会在段里直接给 content）
  if (Array.isArray(ref.content)) {
    return finish(ref.content.map((m) => lineOfMessage(m, conf)), conf);
  }

  // 只有一句摘要（json 卡片）：如实给摘要，别装作读了全部
  if (!ref.id && ref.brief) return { ok: true, text: `（转发摘要）${clean(ref.brief, 200)}`, count: 0 };

  if (!ref.id) return { ok: false, text: '（这段转发取不到内容）', count: 0, error: 'no-id' };
  if (typeof fetchForward !== 'function') return { ok: false, text: '（这段转发取不到内容）', count: 0, error: 'no-fetcher' };

  let raw;
  try {
    raw = await fetchForward(ref.id);
  } catch (error) {
    return { ok: false, text: '（这段转发取不到内容）', count: 0, error: String(error?.message ?? error).slice(0, 80) };
  }

  // OneBot 的返回有两代：{messages:[...]} 或 {message:[...]}
  const list = Array.isArray(raw?.messages) ? raw.messages
    : Array.isArray(raw?.message) ? raw.message
      : Array.isArray(raw?.data?.messages) ? raw.data.messages
        : null;
  if (!list) return { ok: false, text: '（这段转发取不到内容）', count: 0, error: 'bad-shape' };

  return finish(list.map((m) => lineOfMessage(m, conf)), conf);
}

function finish(lines = [], cfg = FORWARD) {
  const picked = lines.slice(0, cfg.maxMessages);
  const omitted = lines.length - picked.length;
  let text = picked.join('\n');
  if (text.length > cfg.maxTotalChars) text = `${text.slice(0, cfg.maxTotalChars)}…`;
  if (omitted > 0) text += `\n…还有 ${omitted} 条`;
  return { ok: true, text, count: picked.length };
}

/**
 * 一段转发 → 事件正文里的一段（带小标题，方便她分清"这是转发"）。
 */
export function forwardBlockOf(result = {}) {
  const body = String(result.text ?? '').trim();
  if (!body) return '';
  return `【转发的聊天记录】\n${body}`;
}
