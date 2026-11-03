/**
 * 隐私闸门 —— 合体插件里唯一允许“跨平台搬运内容”的出口。
 *
 * 硬规则（不是可选项）：
 *   1. **私信永不进入跨平台记忆**。QQ 侧只读 group:* 会话；B 站侧生成器本身不读 dm-*。
 *   2. 令牌、cookie、密码、私钥、验证码、银行卡、身份证、住址、手机号等
 *      一律不进入记忆文件；命中即整行丢弃或脱敏。
 *   3. 任何 QQ 号 / B 站 mid / 群号都不写进记忆正文（身份对齐是单独的白名单通道，
 *      只存映射、不存对话内容，且提示词明确禁止公开）。
 *   4. 生成后的文件还要再过一次 assertSafeOutput；有一条严重命中就拒绝落盘。
 *
 * 这里刻意用确定性规则，不交给模型判断：模型可以撒谎，正则不会。
 */
import path from 'node:path';

export const PRIVACY_POLICY_VERSION = 3;

const SEVERE_SECRET = [
  { kind: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/i, label: '私钥' },
  { kind: 'openai-key', re: /\bsk-[A-Za-z0-9_-]{16,}\b/g, label: 'API Key' },
  { kind: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, label: 'GitHub Token' },
  { kind: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/g, label: 'AWS Key' },
  { kind: 'bearer', re: /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}=*/gi, label: 'Bearer Token' },
  { kind: 'cookie', re: /\b(?:SESSDATA|bili_jct|buvid3|sessionid|csrf|access_token|refresh_token)\s*[=:]\s*[^\s;]{6,}/gi, label: 'Cookie/Token' },
  { kind: 'password', re: /(?:密码|口令|password|passwd|pwd)\s*[：:=]\s*[^\s，。；;]{4,}/gi, label: '密码' },
  { kind: 'otp', re: /(?:验证码|动态码|短信码|OTP)\s*[：:是为]?\s*\d{4,8}/gi, label: '验证码' },
  { kind: 'qq-token', re: /\b(?:access[_-]?token|client[_-]?secret|api[_-]?key)\b\s*[=:]\s*["']?[A-Za-z0-9._-]{12,}/gi, label: '密钥' },
];

const PII = [
  { kind: 'cn-id', re: /\b[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g, label: '身份证号', severe: true },
  { kind: 'bank-card', re: /\b(?:62|4|5)[0-9]{15,18}\b/g, label: '银行卡号', severe: true },
  { kind: 'phone', re: /(?<!\d)1[3-9]\d{9}(?!\d)/g, label: '手机号', severe: false },
  { kind: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, label: '邮箱', severe: false },
  { kind: 'ip', re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, label: 'IP 地址', severe: false },
  { kind: 'address', re: /(?:住址|家庭地址|收货地址|住在|地址是|地址：|地址:)[^\n。；;]{4,60}/g, label: '住址', severe: true },
  { kind: 'realname', re: /(?:真名|实名|本名|身份证名字)\s*[：:是为]?\s*[\u4e00-\u9fa5]{2,4}/g, label: '真实姓名', severe: true },
  { kind: 'location', re: /(?:我在|坐标|定位在)\s*[\u4e00-\u9fa5]{2,12}(?:省|市|区|县|镇|街道|小区|学校)/g, label: '精确位置', severe: true },
];

const PRIVATE_TOPIC = /私信|私聊|悄悄话|小窗|别告诉|不要告诉|保密|秘密|只告诉你|别外传|内部消息|私下说|DM\b|dm-|私密|暗号|口令|后台|管理员说|群主说|禁言|踢人|封号|举报他|人肉|开盒|身份证|银行卡|手机号|住址|家庭地址|真名|实名|定位|坐标|验证码|密码|token|cookie|api[_-]?key|ssn|护照号/i;

const CONTACT = [
  { kind: 'qq-number', re: /(?<!\d)(?:QQ|qq|Q群|群号)\s*[：:=是为]?\s*(\d{5,12})/g, label: 'QQ 号' },
  { kind: 'wechat', re: /(?:微信|wechat|VX|vx|v信)\s*[：:=是为]?\s*([A-Za-z][A-Za-z0-9_-]{5,19})/g, label: '微信号' },
  { kind: 'telegram', re: /(?:telegram|tg|电报)\s*[：:=@]?\s*@?([A-Za-z0-9_]{4,32})/gi, label: 'Telegram' },
  { kind: 'bare-long-number', re: /(?<!\d)(\d{6,12})(?!\d)/g, label: '疑似账号/号码' },
];

const SAFE_URL_HOSTS = new Set([
  // 2026-11-03：抖音上线。少了这几个域，抖音链接会在出站脱敏时被判「外部链接」剔掉。
  'www.douyin.com', 'douyin.com', 'm.douyin.com', 'v.douyin.com',
  'www.iesdouyin.com', 'iesdouyin.com',
  // B 站保留：历史日记/记忆里还有一堆旧链接，别让它们变成乱码。
  'www.bilibili.com', 'bilibili.com', 'm.bilibili.com', 't.bilibili.com',
  'space.bilibili.com', 'b23.tv', 'www.b23.tv',
]);

const ZERO_WIDTH = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function collect(text, patterns) {
  const hits = [];
  for (const pattern of patterns) {
    pattern.re.lastIndex = 0;
    let match;
    while ((match = pattern.re.exec(text)) !== null) {
      hits.push({ kind: pattern.kind, label: pattern.label, severe: pattern.severe !== false, index: match.index, raw: match[0] });
      if (match[0].length === 0) break;
    }
  }
  return hits;
}

export function scanText(input) {
  const text = String(input ?? '');
  const secrets = collect(text, SEVERE_SECRET);
  const pii = collect(text, PII);
  const contacts = collect(text, CONTACT);
  const privateTopic = PRIVATE_TOPIC.test(text);
  const hits = [...secrets, ...pii, ...contacts];
  return {
    text,
    hits,
    secrets,
    pii,
    contacts,
    privateTopic,
    severe: secrets.length > 0 || pii.some((h) => h.severe) || contacts.some((h) => h.severe) || privateTopic,
  };
}

export function normalizeText(input) {
  return String(input ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(ZERO_WIDTH, '')
    .replace(CONTROL, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sanitizeUrl(raw) {
  const text = String(raw ?? '');
  return text.replace(/https?:\/\/[^\s<>"')\]]+/gi, (url) => {
    try {
      const parsed = new URL(url);
      if (!SAFE_URL_HOSTS.has(parsed.hostname.toLowerCase())) return '[链接已隐藏]';
      const pathname = parsed.pathname.replace(/\/+$/, '');
      if (!/^\/(?:video\/BV[0-9A-Za-z]{10}|space\/\d+|\d+|dynamic\/\d+|opus\/\d+)$/.test(pathname)) return '[链接已隐藏]';
      return `${parsed.origin}${pathname}`;
    } catch {
      return '[链接已隐藏]';
    }
  });
}

function redactNumbers(text) {
  let out = String(text ?? '');
  for (const pattern of CONTACT) {
    pattern.re.lastIndex = 0;
    out = out.replace(pattern.re, (match, captured) => {
      if (pattern.kind === 'bare-long-number') return '[编号已隐藏]';
      return `${pattern.label}已隐藏`;
    });
  }
  // 5 位以上的裸数字仍可能是 QQ / mid / 手机号：统一打码，保留年份与 BV 号。
  out = out.replace(/(?<![\w.\/-])\d{5,12}(?![\w.\/-])/g, (num) => (/^(?:19|20)\d{2}$/.test(num) ? num : '[编号已隐藏]'));
  return out;
}

/**
 * 单条文本过闸。
 * @param {string} input
 * @param {{ dropUnsafeLines?: boolean, keepNumbers?: boolean, maxChars?: number }} options
 * @returns {{ ok:boolean, text:string, dropped:boolean, reason:string, hits:any[] }}
 */
export function sanitizeText(input, options = {}) {
  const { dropUnsafeLines = true, keepNumbers = false, maxChars = 1200 } = options;
  const raw = normalizeText(input);
  if (!raw) return { ok: false, text: '', dropped: true, reason: 'empty', hits: [] };
  const scan = scanText(raw);
  if (scan.severe && dropUnsafeLines) {
    return { ok: false, text: '', dropped: true, reason: scan.privateTopic ? 'private-topic' : 'secret-or-pii', hits: scan.hits };
  }
  let text = sanitizeUrl(raw);
  for (const pattern of SEVERE_SECRET) text = text.replace(pattern.re, '[已隐藏]');
  for (const pattern of PII) text = text.replace(pattern.re, '[已隐藏]');
  if (!keepNumbers) text = redactNumbers(text);
  text = text.replace(/\s+/g, ' ').trim();
  if (!text) return { ok: false, text: '', dropped: true, reason: 'redacted-empty', hits: scan.hits };
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}…`;
  return { ok: true, text, dropped: false, reason: '', hits: scan.hits };
}

/** 生成文件落盘前的最后一道闸：严重命中直接拒绝。 */
export function assertSafeOutput(text, label = 'memory') {
  const scan = scanText(text);
  const severe = scan.hits.filter((hit) => hit.severe);
  if (severe.length) {
    const error = new Error(`隐私闸门拒绝写入 ${label}：命中 ${severe.map((h) => h.label).join('、')}`);
    error.code = 'PRIVACY_BLOCKED';
    error.hits = severe.map((h) => ({ kind: h.kind, label: h.label }));
    throw error;
  }
  return true;
}

export function isGroupKey(key) {
  return /^group:\d{4,15}$/.test(String(key ?? ''));
}

export function isPrivateKey(key) {
  return /^private:\d{4,15}$/.test(String(key ?? ''));
}

export function groupIdOf(key) {
  const match = /^group:(\d{4,15})$/.exec(String(key ?? ''));
  return match ? match[1] : '';
}

/** 跨平台搬运的准入判断：不是公开群消息就一律拒绝。 */
export function isPublicGroupMessage({ key, groupIds, text, senderId, ownerId, includeOwner = false }) {
  if (!isGroupKey(key)) return { ok: false, reason: '不是 QQ 群会话（私信/未知一律不搬运）' };
  const groupId = groupIdOf(key);
  if (Array.isArray(groupIds) && groupIds.length && !groupIds.includes(groupId)) {
    return { ok: false, reason: '群不在白名单' };
  }
  if (ownerId && String(senderId) === String(ownerId) && !includeOwner) {
    return { ok: false, reason: '管理员消息默认不搬运' };
  }
  const plain = normalizeText(text);
  if (!plain) return { ok: false, reason: '空消息' };
  if (/^[/#!]/.test(plain)) return { ok: false, reason: '命令消息' };
  if (/^\[(?:图片|表情|语音|视频|文件|转发消息|拍一拍)[^\]]*\]$/.test(plain)) return { ok: false, reason: '纯媒体消息' };
  return { ok: true, reason: '', groupId };
}

/** 给 UI 的“这段会不会被搬运”解释，不返回原文命中位置。 */
export function explainText(text) {
  const scan = scanText(text);
  return {
    allowed: !scan.severe,
    privateTopic: scan.privateTopic,
    labels: [...new Set(scan.hits.map((hit) => hit.label))],
    counts: {
      secrets: scan.secrets.length,
      pii: scan.pii.length,
      contacts: scan.contacts.length,
    },
  };
}

export function relativeSafePath(file) {
  try {
    return path.basename(String(file ?? ''));
  } catch {
    return '';
  }
}
