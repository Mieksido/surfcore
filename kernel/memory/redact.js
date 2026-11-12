/**
 * 脱敏：写进去之前藏一次，给她看之前再藏一次
 * ============================================================================
 * 位置：内存模块内部的一条策略（纯函数 + 正则表）。不改任何接口。
 *
 * 为什么两次：
 *   · **写**：别让密码/密钥落进磁盘（落盘就收不回）
 *   · **渲染**：别让旧记录里的漏网之鱼进提示词（发出去收不回）
 *
 * 改法：只改正则表 `REDACT_RULES`；改完跑 redact 相关断言。
 */

/** 规则表：id + 正则 + 替换。顺序有意义（先长后短）。 */
export const REDACT_RULES = Object.freeze([
  { id: 'password', re: /(密码|口令|password|passwd|pwd)\s*(?:[:：=]|是|为|改成|设为)\s*\S+/gi, to: '$1：[已隐藏]' },
  { id: 'apikey', re: /\b(sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/g, to: '[密钥]' },
  { id: 'bearer', re: /\bBearer\s+[A-Za-z0-9._-]{12,}/gi, to: 'Bearer [已隐藏]' },
  { id: 'idcard', re: /(?<!\d)\d{17}[\dXx](?!\d)/g, to: '[证件号]' },
  { id: 'phone', re: /(?<!\d)1[3-9]\d{9}(?!\d)/g, to: '[手机号]' },
  { id: 'url', re: /https?:\/\/[^\s，。；]+/g, to: '[链接]' },
]);

/**
 * @param {string} text
 * @param {object} [opts] { keepUrls=false（想保留链接就把 url 规则跳过） }
 * @returns {{text:string, hits:Array<{id:string,count:number}>}}
 */
export function redactText(text, { keepUrls = false } = {}) {
  let out = String(text ?? '');
  const hits = [];
  for (const rule of REDACT_RULES) {
    if (rule.id === 'url' && keepUrls) continue;
    const matches = out.match(rule.re);
    if (!matches) continue;
    hits.push({ id: rule.id, count: matches.length });
    out = out.replace(rule.re, rule.to);
  }
  return { text: out, hits };
}

/** 只问"要不要藏"，不要结果（给渲染层做判断用） */
export function hasSensitive(text) {
  return REDACT_RULES.some((r) => (String(text ?? '').match(r.re) ?? []).length > 0);
}
