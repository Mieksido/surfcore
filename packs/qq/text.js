/**
 * QQ 包的文本处理：CQ 码转义 + 长度裁剪
 * ============================================================================
 * 旧代码的教训（bridge.js）：**消息内容和协议共用同一个字符串空间**，
 * 不转义就能伪造图片 / @ / 撤回。所以发出去之前必须转义 `[` `]` `&`。
 */

/** 转义 CQ 码：防止用户内容被当成协议指令 */
export function escapeCq(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/\[/g, '&#91;')
    .replace(/\]/g, '&#93;');
}

/** 反义（收到网关文本时用） */
export function unescapeCq(text) {
  return String(text ?? '')
    .replace(/&#91;/g, '[')
    .replace(/&#93;/g, ']')
    .replace(/&amp;/g, '&');
}

/** 安全文本：剥控制字符 + 转义（发给网关前的最后一道） */
export function safeText(text) {
  return escapeCq(String(text ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''));
}

/**
 * Markdown → 适合聊天窗口的纯文本。
 * 只做“不改变意思”的清理：标题/加粗/斜体/行内代码/围栏/链接/引用/分隔线。
 * 保留列表符号和代码内容；不把表情/中文标点当 Markdown。
 */
export function markdownToPlain(text) {
  let s = String(text ?? '');
  // 围栏代码：去掉围栏，保留内容
  s = s.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, body) => body.trim());
  // 标题：去掉行首 #
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  // 图片：只留 alt（没有 alt 就 [图片]）
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt) => alt.trim() || '[图片]');
  // 链接：文字（地址）；只有文字时直接留文字
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label, url) => {
    const l = String(label ?? '').trim();
    const u = String(url ?? '').trim();
    return l && u && l !== u ? `${l}（${u}）` : (l || u);
  });
  // 加粗/斜体/删除线/行内代码
  s = s.replace(/(\*\*|__)([^\n]+?)\1/g, '$2');
  s = s.replace(/(?<!\*)\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/g, '$1');
  s = s.replace(/(?<!\w)_(?!\s)([^_\n]+?)(?<!\s)_(?!\w)/g, '$1');
  s = s.replace(/~~([^\n]+?)~~/g, '$1');
  s = s.replace(/`([^`\n]+)`/g, '$1');
  // 引用 / 分隔线
  s = s.replace(/^\s{0,3}>\s?/gm, '');
  s = s.replace(/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/gm, '');
  // 连续空行压成一个
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

/** 按字数上限拆条（不切断 URL、不劈开 emoji 代理对） */
export function splitForSend(text, maxChars = 500) {
  const s = String(text ?? '');
  const max = Number(maxChars) > 0 ? Number(maxChars) : 500;
  if (s.length <= max) return [s];

  const parts = [];
  let rest = s;
  while (rest.length > max) {
    let cut = max;
    // 不要劈开代理对（emoji 被切成半个会变成乱码，模型 API 直接 400）
    const code = rest.charCodeAt(cut - 1);
    if (code >= 0xD800 && code <= 0xDBFF) cut -= 1;
    // 优先在标点/空格处断
    const window = rest.slice(0, cut);
    const m = /[。！？!?；;，,\s]/g;
    let last = -1;
    let hit;
    while ((hit = m.exec(window))) last = hit.index;
    if (last > max * 0.5) cut = last + 1;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut);
  }
  if (rest.trim()) parts.push(rest.trim());
  return parts.filter(Boolean);
}
