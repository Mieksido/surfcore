/**
 * B站 分享文本（旧 bili-card.js 的真东西）
 * ============================================================================
 * 位置：平台包。**"怎么把一条 B站 内容变成一段能发的文字"是平台的事**。
 *
 * 旧代码试了两代卡片（小程序卡 → structmsg），真机都失败，最后默认纯文本：
 *   【B站】标题 + 链接
 * 这里就只做纯文本：任何客户端都能点，不依赖卡片渲染。
 */

/** 把 http 图片地址升成 https（QQ 对混合内容不友好；旧代码踩过） */
export function httpsifyImage(url) {
  const text = String(url ?? '').trim();
  if (!text) return '';
  return text.replace(/^http:\/\//i, 'https://');
}

/** 视频链接：有 bvid 就拼标准地址 */
export function videoUrl({ bvid = '', url = '' } = {}) {
  const direct = String(url ?? '').trim();
  if (direct) return direct;
  const id = String(bvid ?? '').trim();
  return id ? `https://www.bilibili.com/video/${id}` : '';
}

function clamp(text, max) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * 造一段分享文本。
 * @param {object} input { title, bvid, url, up, maxChars }
 * @returns {string} 例：【B站】猫猫视频 https://www.bilibili.com/video/BV1xx
 */
export function buildShareText({ title = '', bvid = '', url = '', up = '', maxChars = 200 } = {}) {
  const t = clamp(title, Math.max(20, Number(maxChars) - 40)) || '（没标题）';
  const link = videoUrl({ bvid, url });
  const parts = [`【B站】${t}`];
  if (up) parts.push(`（UP：${clamp(up, 20)}）`);
  if (link) parts.push(link);
  return parts.join(' ').slice(0, Number(maxChars) > 0 ? Number(maxChars) : 200);
}

/** 一条内容要不要当成"值得分享"（旧逻辑：有标题且有链接） */
export function isShareable(item = {}) {
  return Boolean(clamp(item.title, 200) && videoUrl(item));
}

/* ── 从记忆里挑一张"分享卡"（旧 bili-memory.pickShareCard 的可复用部分） ──
 * 位置：B站 模块。**"哪些内容值得分享、分享过多久算旧"是 B站 自己的规矩**；
 * 内核只负责把 B站 内容记成普通记录（tags 里带 bvid/dynamic），不参与挑选。
 */

/** 分享过的素材 6 天内不再复用（旧调度器口径） */
export const SHARE_COOLDOWN_MS = 6 * 24 * 60 * 60 * 1000;

/** 稳定 id：没有 bvid/dynamic 时用文本散列，保证"同一条"每次算出来一样 */
function stableId(text) {
  let h = 0x811c9dc5;
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `rec-${h.toString(16)}`;
}

/**
 * 把一条记忆记录变成分享卡。
 * 只认 tags 里的平台编号（bvid:/dynamic:）——不靠渠道名，也不读平台原始结构。
 * @param {object} record 内核记忆记录 { text, tags, from, importance }
 * @returns {object|null}
 */
export function cardFromRecord(record = {}) {
  const text = String(record?.text ?? '').trim();
  if (!text) return null;
  const tags = Array.isArray(record?.tags) ? record.tags.map(String) : [];
  const bvid = tags.find((t) => t.startsWith('bvid:'))?.slice(5) ?? '';
  const dynamicId = tags.find((t) => t.startsWith('dynamic:'))?.slice(8) ?? '';
  const up = tags.find((t) => t.startsWith('up:'))?.slice(3) ?? '';
  const title = text.replace(/^(视频|动态|评论|收藏)[：:]\s*/, '').slice(0, 80).trim();
  const url = bvid ? `https://www.bilibili.com/video/${bvid}` : (dynamicId ? `https://t.bilibili.com/${dynamicId}` : '');
  const id = bvid || dynamicId || stableId(text);
  return {
    id,
    bvid,
    dynamicId,
    up,
    title,
    url,
    reason: text.slice(0, 300),
    quote: '',
    at: Number(record?.from?.at) || 0,
    importance: Number(record?.importance) || 0,
    tags,
  };
}

/**
 * 挑一张还能分享的卡：6 天内发过的不再发；没有新鲜的就不发（不拿旧料凑数）。
 * @param {object[]} records 已按可见性过滤过的记忆记录
 * @param {object} opts { slotIndex, history（id → ISO/ms）, now, cooldownMs }
 * @returns {object|null}
 */
export function pickShareCard(records = [], {
  slotIndex = 0,
  history = {},
  now = Date.now(),
  cooldownMs = SHARE_COOLDOWN_MS,
} = {}) {
  const hist = history && typeof history === 'object' ? history : {};
  const fresh = [];
  for (const record of Array.isArray(records) ? records : []) {
    const card = cardFromRecord(record);
    if (!card || !isShareable(card)) continue;
    const last = hist[card.id];
    const lastAt = typeof last === 'number' ? last : Date.parse(String(last ?? ''));
    if (Number.isFinite(lastAt) && now - lastAt < cooldownMs) continue;
    fresh.push(card);
  }
  if (!fresh.length) return null;

  fresh.sort((a, b) => (b.importance - a.importance) || (b.at - a.at) || a.id.localeCompare(b.id));
  const offset = Math.abs(Math.floor(Number(slotIndex) || 0)) % fresh.length;
  return fresh[offset];
}

/**
 * 组装"这一轮只做分享"的提示词。
 * 不写任何 MCP 工具名 / 运行模式：新架构里模型只负责产出一段要说的话，
 * 发送由工具层的任务用 QQ 包的 send 完成。
 * @param {object} card
 * @param {string} timeLabel 例：21:00
 * @param {object} opts { cardSent=false, maxChars=600 }
 */
export function buildSharePrompt(card = {}, timeLabel = '', { cardSent = false, maxChars = 600 } = {}) {
  const title = String(card?.title ?? '').trim() || '一条B站视频';
  const url = String(card?.url ?? '').trim();
  const reason = String(card?.reason ?? '').replace(/\s+/g, ' ').trim();
  const quote = String(card?.quote ?? '').replace(/\s+/g, ' ').trim();
  const lines = [];
  lines.push(`【B站分享·定时任务】现在是 ${timeLabel}，请主动在群里分享一件你最近在B站碰到的有趣的事。`);
  if (cardSent) {
    lines.push('分享内容（标题 + 链接）已经由系统发到群里了：这一轮你只需要补 2~3 句短评，不要再发链接、BV 号或复述完整标题。');
  }
  lines.push('这一轮只做分享：不要回应群里的其他消息，不要把它当成谁在问你，也不要提“定时/任务/素材/记忆库”。');
  lines.push('');
  lines.push('素材（你真实看过/发过；细节以素材为准，不要编）：');
  lines.push(`- 标题/内容：${title}`);
  if (url) lines.push(`- 链接：${url}`);
  if (reason && reason !== title) lines.push(`- 你当时的判断/记录：${reason.slice(0, 300)}`);
  if (quote) lines.push(`- 你当时的公开评论：「${quote.slice(0, 160)}」`);
  lines.push('');
  lines.push('要求：');
  lines.push('1. 用你自己的口吻，像群里随口分享，不要像新闻播报，也不要照抄素材原文。');
  if (cardSent) {
    lines.push('2. 只写 2~3 句短评，合计 50~100 字；不要重复卡片上的标题，也不要再发链接/BV 号。');
  } else {
    lines.push('2. 先用一句话说清是什么（带 BV 号或链接），再写 2~3 句短评；短评合计 50~100 字。');
  }
  lines.push('3. 不用 Markdown，不 @ 人；不要输出 [SILENT]，不要解释，不要加引号。');
  lines.push('4. 不聊政治、时政、娱乐圈/明星八卦，只分享好玩的内容。');
  lines.push('5. 只输出要发到群里的内容。');
  return lines.join('\n').slice(0, Math.max(200, Number(maxChars) || 600));
}

/* ── 分享范围（旧 share-mode.js） ──────────────────────────────────────
 * off      ：系统不发，链接交给角色写进短评
 * text     ：先发「【B站】标题 + 链接」，再发角色短评（默认）
 * miniapp  ：旧小程序卡（点开提示已下架）——保留名字但不实现，避免有人误开
 */
export const CARD_MODES = Object.freeze(['off', 'text', 'miniapp']);

/**
 * 把设置里的分享配置收敛成模式（兼容旧值：card:false → off；cardMode:'link' → text）
 * @returns {'off'|'text'|'miniapp'}
 */
export function normalizeCardMode(share) {
  const raw = String(share?.cardMode ?? '').trim().toLowerCase();
  if (raw === 'text' || raw === 'link') return 'text';
  if (raw === 'off' || raw === 'miniapp') return raw;
  return share?.card === false ? 'off' : 'text';
}

/**
 * 按模式决定"要不要系统发、发什么"。
 * @returns {{send:boolean, mode:string, text:string, reason?:string}}
 */
export function renderShare(item = {}, { share = null, maxChars = 200 } = {}) {
  const mode = normalizeCardMode(share);
  if (mode === 'off') return { send: false, mode, text: '', reason: 'off：链接交给角色写进短评' };
  if (mode === 'miniapp') return { send: false, mode, text: '', reason: 'miniapp 已下架：退回让角色发文本' };
  if (!isShareable(item)) return { send: false, mode, text: '', reason: '没有标题或链接' };
  return { send: true, mode, text: buildShareText({ ...item, maxChars }) };
}
