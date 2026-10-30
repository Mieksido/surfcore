// safe-text.js — 截断 / 发送文本时不产生「孤立代理项」（lone surrogate）
//
// JS 字符串是 UTF-16。`text.slice(0, n)` 按 UTF-16 单元截断，如果第 n 个位置正好落在 emoji
// （或生僻汉字）这种由「高位代理 + 低位代理」两个单元组成的字符中间，就会留下一个孤立的高位代理
// （如 \ud83d）。它能存进 JSON、能拼进提示词，但发给模型 API 时序列化出的请求体不合法，
// 提供方直接回 400（DeepSeek 的响应里还没有 error.message，客户端只看得到 "request failed (400)"）。
//
// 两道防线：
//   1. 截断处用 sliceHead / clipText，不把代理对劈开（治本）；
//   2. 发给模型之前用 wellFormed / deepWellFormed 兜底，把漏网的孤立代理项换成 U+FFFD（治标，覆盖老数据）。

const HIGH = (c) => c >= 0xD800 && c <= 0xDBFF;
const LOW = (c) => c >= 0xDC00 && c <= 0xDFFF;

/** 取前 max 个 UTF-16 单元；如果第 max 个单元是高位代理（后半截被切掉了），再少取一个。 */
export function sliceHead(text, max) {
  const s = String(text ?? '');
  const n = Math.max(0, Math.floor(Number(max) || 0));
  if (s.length <= n) return s;
  let cut = n;
  if (cut > 0 && HIGH(s.charCodeAt(cut - 1))) cut -= 1;
  return s.slice(0, cut);
}

/** 压空白 + 截断 + 省略号，截断点不劈开代理对。 */
export function clipText(text, max = 120, { keepNewlines = false } = {}) {
  const raw = String(text ?? '');
  const s = (keepNewlines ? raw.replace(/\r\n/g, '\n') : raw.replace(/\s+/g, ' ')).trim();
  return s.length > max ? `${sliceHead(s, Math.max(1, max - 1))}…` : s;
}

/** 孤立代理项 → U+FFFD。Node 20+ 有原生 toWellFormed，旧环境走正则。 */
export function wellFormed(text) {
  const s = String(text ?? '');
  if (typeof s.toWellFormed === 'function') return s.toWellFormed();
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (HIGH(c) && LOW(s.charCodeAt(i + 1))) { out += s[i] + s[i + 1]; i += 1; }
    else if (HIGH(c) || LOW(c)) out += '�';
    else out += s[i];
  }
  return out;
}

export function isWellFormed(text) {
  const s = String(text ?? '');
  return typeof s.isWellFormed === 'function' ? s.isWellFormed() : wellFormed(s) === s;
}

/** 递归处理对象 / 数组里的所有字符串（发给 DSH 之前的整包兜底）。不改入参，没有变化时原样返回同一个引用。 */
export function deepWellFormed(value, depth = 0) {
  if (typeof value === 'string') return wellFormed(value);
  if (value === null || typeof value !== 'object' || depth > 32) return value;
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const fixed = deepWellFormed(item, depth + 1);
      if (fixed !== item) changed = true;
      return fixed;
    });
    return changed ? next : value;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;   // Buffer / Date / Map 等不碰
  let changed = false;
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    const fixed = deepWellFormed(item, depth + 1);
    if (fixed !== item) changed = true;
    next[key] = fixed;
  }
  return changed ? next : value;
}
