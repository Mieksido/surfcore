// 链接 / 链接卡片解析（2026-10-30）。
//
// 背景：QQ 的「链接卡片」在 OneBot 里是 json/xml 段，桥接以前只把它渲染成四个字
// 「[卡片消息]」—— 主人发来一张卡片，模型看不到标题/摘要/URL，只能回「我点不开」。
// 普通链接（正文里的 http(s)://）则相反：URL 虽然在文字里，但既不算媒体，也不会按
// 「图片/表情」的概率唤醒，更没有「可以打开看看」的提示。
//
// 本模块只做**纯逻辑**：把 json/xml 段（以及正文里的 URL）解析成模型能直接读的结构：
//   { kind:'link', source:'card'|'text', cardType, title, desc, url }
// 真实抓取由模型自己用 mcp__web-search-safe__web_fetch / web_search 完成，桥接不代理网页（不替模型读外网）。
//
// 解析原则：
//   · 只接受 http(s) URL 作为可打开地址；mqqapi://、tencent:// 这类协议原样丢给模型也没用，
//     宁可不给，避免模型「看到了链接却打不开」的错觉。
//   · HTML 实体统一解码一次（卡片里常见 &amp;），标题/摘要压掉换行与控制字符，限长。
//   · 一条消息最多取固定数量，防止一张畸形卡片把上下文撑爆。

/** 一条消息里链接的数量与长度上限（与 bridge 的 MAX_MEDIA_COUNT 各自独立）。 */
export const LINK_LIMITS = Object.freeze({
  maxPerMessage: 5,
  textLinks: 3,
  title: 120,
  desc: 200,
  url: 800,
  cardType: 40,
});

const ENTITY_MAP = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
});

// 卡片里常见「按钮/跳转地址」字段的候选名（QQ 不同模板字段名不一致）。
const CARD_URL_FIELDS = [
  'jumpUrl', 'jump_url', 'url', 'qqdocurl', 'qqDocUrl', 'link', 'targetUrl', 'target_url',
  'musicUrl', 'music_url', 'playUrl', 'play_url', 'jumpurl',
];

/** 图片/音视频直链不算「可阅读链接」，出现在正文里时不单独触发链接唤醒。 */
const MEDIA_URL_RE = /\.(?:png|jpe?g|gif|webp|bmp|svg|mp4|mov|m4v|mp3|m4a|aac|flac|wav|amr)(?:[?#]|$)/i;

function codePointToText(cp) {
  if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff) return '';
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}

/** 解码 XML/HTML 实体（只解一层；卡片里通常是 &amp; 这种单层转义）。 */
export function decodeEntities(value) {
  return String(value ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => codePointToText(parseInt(hex, 16)) || match)
    .replace(/&#(\d+);/g, (match, dec) => codePointToText(parseInt(dec, 10)) || match)
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (match, name) => ENTITY_MAP[name.toLowerCase()] ?? match);
}

function stripCdata(value) {
  return String(value ?? '')
    .replace(/^\s*<!\[CDATA\[/, '')
    .replace(/\]\]>\s*$/, '');
}

function stripTags(value) {
  return stripCdata(String(value ?? '')).replace(/<[^>]*>/g, ' ');
}

function clampText(value, max) {
  const text = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (!Number.isFinite(max) || max <= 0 || text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1))}…`;
}

/** 规范化 URL：解实体、补协议、只留 http(s)、限长。 */
export function normalizeLinkUrl(raw) {
  let value = decodeEntities(raw).trim();
  if (!value) return '';
  value = value.replace(/^['"`]+|['"`]+$/g, '');
  if (value.startsWith('//')) value = `https:${value}`;
  if (!/^https?:\/\//i.test(value)) return '';
  return value.length > LINK_LIMITS.url ? value.slice(0, LINK_LIMITS.url) : value;
}

function firstHttpUrl(candidates) {
  for (const candidate of candidates) {
    const url = normalizeLinkUrl(candidate);
    if (url) return url;
  }
  return '';
}

/** 把字符串（可能被 JSON 编码多层）或对象统一成对象；失败返回 null。 */
function coerceCardObject(raw) {
  let value = raw;
  for (let i = 0; i < 4; i += 1) {
    if (typeof value !== 'string') break;
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  // 有些实现把卡片再套一层 { data: '<json>' } / { data: {...} }。
  if (!value.meta && !value.title && value.data != null && (typeof value.data === 'string' || typeof value.data === 'object')) {
    const nested = coerceCardObject(value.data);
    if (nested) return nested;
  }
  return value;
}

function cardTitleOf(obj, fallback = '') {
  const title = obj?.title ?? obj?.name ?? obj?.appName ?? fallback;
  return clampText(stripTags(title), LINK_LIMITS.title);
}

function cardDescOf(obj) {
  const desc = obj?.desc ?? obj?.summary ?? obj?.description ?? obj?.content ?? obj?.abstract ?? '';
  return clampText(stripTags(desc), LINK_LIMITS.desc);
}

function cardUrlOf(obj) {
  const candidates = CARD_URL_FIELDS.map((field) => obj?.[field]);
  return firstHttpUrl(candidates);
}

/** `[分享]标题` / `[QQ小程序]标题` 这类 prompt 兜底：去掉前缀当标题。 */
function titleFromPrompt(prompt) {
  const text = clampText(stripTags(prompt), LINK_LIMITS.title);
  if (!text) return '';
  return clampText(text.replace(/^\[[^\]]{1,12}\]\s*/, ''), LINK_LIMITS.title) || text;
}

function pushUnique(items, item) {
  if (!item) return;
  const key = item.url ? `u:${item.url}` : `t:${item.title}|${item.desc}`;
  if (!key || key === 't:|') return;
  if (items.some((existing) => (existing.url ? `u:${existing.url}` : `t:${existing.title}|${existing.desc}`) === key)) return;
  items.push(item);
}

/**
 * 解析 QQ 卡片 JSON（`meta.news` / `meta.detail_1` / `meta.music` / `meta.video_share` /
 * `meta.mini_app_ark` / `meta.ark` 等模板）。
 * @returns {Array<{kind:'link',source:'card',cardType:string,title:string,desc:string,url:string}>}
 */
export function parseCardJson(raw) {
  const parsed = coerceCardObject(raw);
  if (!parsed) return [];
  const items = [];
  const meta = parsed.meta && typeof parsed.meta === 'object' && !Array.isArray(parsed.meta) ? parsed.meta : null;
  if (meta) {
    for (const [cardType, value] of Object.entries(meta)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      // ark 卡片把内容放在 meta.ark 里；xml/其它模板偶尔把内容再嵌一层。
      const fields = { ...value };
      if (value.ark && typeof value.ark === 'object' && !Array.isArray(value.ark)) Object.assign(fields, value.ark);
      const title = cardTitleOf(fields);
      const desc = cardDescOf(fields);
      const url = cardUrlOf(fields);
      if (!title && !desc && !url) continue;
      pushUnique(items, {
        kind: 'link',
        source: 'card',
        cardType: clampText(cardType, LINK_LIMITS.cardType) || 'card',
        title,
        desc,
        url,
      });
    }
  }
  if (!items.length) {
    // 部分模板没有 meta（或 meta 被拍平），直接读顶层字段。
    const title = cardTitleOf(parsed);
    const desc = cardDescOf(parsed);
    const url = cardUrlOf(parsed);
    if (title || desc || url) {
      pushUnique(items, {
        kind: 'link',
        source: 'card',
        cardType: clampText(parsed.app ?? 'card', LINK_LIMITS.cardType) || 'card',
        title,
        desc,
        url,
      });
    }
  }
  if (!items.length) {
    const title = titleFromPrompt(parsed.prompt);
    if (title) {
      pushUnique(items, {
        kind: 'link',
        source: 'card',
        cardType: clampText(parsed.app ?? 'card', LINK_LIMITS.cardType) || 'card',
        title,
        desc: '',
        url: '',
      });
    }
  }
  return items.slice(0, LINK_LIMITS.maxPerMessage);
}

function xmlTagText(xml, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i');
  const match = re.exec(xml);
  return match ? decodeEntities(stripTags(match[1])) : '';
}

function xmlAttrText(xml, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const match = re.exec(xml);
  if (!match) return '';
  return decodeEntities(match[1] ?? match[2] ?? '');
}

/**
 * 解析 QQ 卡片 XML（`<msg brief="..."><item><title>..</title><summary>..</summary><url>..</url>`）。
 * @returns {Array<{kind:'link',source:'card',cardType:string,title:string,desc:string,url:string}>}
 */
export function parseCardXml(raw) {
  const xml = String(raw ?? '');
  if (!xml.trim() || !/<[a-z]/i.test(xml)) return [];
  const title = clampText(xmlTagText(xml, 'title') || titleFromPrompt(xmlAttrText(xml, 'brief')), LINK_LIMITS.title);
  const desc = clampText(
    xmlTagText(xml, 'summary') || xmlTagText(xml, 'desc') || xmlTagText(xml, 'content'),
    LINK_LIMITS.desc
  );
  const url = firstHttpUrl([xmlTagText(xml, 'url'), xmlAttrText(xml, 'url')]);
  const cardType = clampText(xmlTagText(xml, 'app') || xmlAttrText(xml, 'serviceID') || 'xml', LINK_LIMITS.cardType);
  if (!title && !desc && !url) return [];
  return [{ kind: 'link', source: 'card', cardType: cardType || 'xml', title, desc, url }];
}

function trimUrlTail(value) {
  let url = String(value ?? '');
  for (;;) {
    const next = url.replace(/[.,;:!?)\]}>'"”’，。；：！？、）】」』…]+$/, '');
    if (next === url) break;
    url = next;
  }
  return url;
}

/**
 * 正文里的 http(s) 链接（不含图片/音视频直链），去重、限长、限制数量。
 * @returns {string[]}
 */
export function urlsInText(value, limit = LINK_LIMITS.textLinks) {
  const text = String(value ?? '');
  const urls = [];
  const re = /https?:\/\/[^\s<>"'`，。；！？、（）()【\[\]】{}]+/gi;
  const max = Number.isFinite(limit) && limit > 0 ? limit : LINK_LIMITS.textLinks;
  let match;
  while ((match = re.exec(text)) && urls.length < max) {
    const url = normalizeLinkUrl(trimUrlTail(decodeEntities(match[0])));
    if (!url || MEDIA_URL_RE.test(url) || urls.includes(url)) continue;
    urls.push(url);
  }
  return urls;
}

/**
 * 从 OneBot 消息段里提取「链接/链接卡片」。
 *
 * 覆盖：
 *   · json / xml 卡片段（含 ark / light_app / share 这些实现差异）；
 *   · text / markdown 段里的 http(s) 链接（图片/音视频直链不算）。
 *
 * @param {Array} segments OneBot message 数组
 * @param {{max?:number, includeText?:boolean}} options
 * @returns {Array<{kind:'link',source:'card'|'text',cardType:string,title:string,desc:string,url:string}>}
 */
export function linkItemsFromSegments(segments, options = {}) {
  const items = [];
  const max = Number.isFinite(options.max) && options.max > 0 ? options.max : LINK_LIMITS.maxPerMessage;
  const includeText = options.includeText !== false;
  for (const seg of Array.isArray(segments) ? segments : []) {
    if (!seg || typeof seg !== 'object') continue;
    const type = String(seg.type ?? '');
    const data = seg.data ?? {};
    if (type === 'json' || type === 'xml' || type === 'ark' || type === 'light_app' || type === 'share') {
      const raw = data.data ?? data.content ?? data;
      let parsed = [];
      if (type === 'xml' || (typeof raw === 'string' && raw.trimStart().startsWith('<'))) {
        parsed = parseCardXml(raw);
      } else {
        parsed = parseCardJson(raw);
      }
      for (const item of parsed) pushUnique(items, item);
      continue;
    }
    if (includeText && (type === 'text' || type === 'markdown')) {
      const text = data.text ?? data.content ?? '';
      for (const url of urlsInText(text, LINK_LIMITS.textLinks)) {
        pushUnique(items, {
          kind: 'link',
          source: 'text',
          cardType: 'url',
          title: '',
          desc: '',
          url,
        });
      }
    }
  }
  return items.slice(0, max);
}

/** 单条链接的一行描述（标题 · 摘要 · URL，各自限长）。 */
export function describeLink(item, options = {}) {
  if (!item || typeof item !== 'object') return '';
  const title = clampText(item.title, options.title ?? LINK_LIMITS.title);
  const desc = clampText(item.desc, options.desc ?? LINK_LIMITS.desc);
  const url = clampText(item.url, options.url ?? LINK_LIMITS.url);
  const parts = [];
  if (title) parts.push(title);
  if (desc && desc !== title) parts.push(desc);
  if (url) parts.push(url);
  return parts.join(' · ');
}
