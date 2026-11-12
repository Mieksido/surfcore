/**
 * web 包模块：只读 HTTP(S) 安全抓取
 * ============================================================================
 * 位置：平台包（web）内部。联网是**这个包对应世界**的能力：
 *   · 内核不联网，只看到 web_fetch 的工具结果；
 *   · 包负责 SSRF/DNS/重定向/限量这些"外面世界"的规矩。
 *
 * 五条规矩（旧 safe-fetch.js 的核心，不缩水）：
 *   ① 只允许 http/https；不许 file/data/gopher
 *   ② 禁 localhost / .local / 私有 IP / 环回 / 链路本地 / CGNAT
 *   ③ 域名先解析，**所有**解析结果都检查；请求固定用检查过的地址（防 DNS rebinding）
 *   ④ 手动跟随重定向，每一跳重新校验
 *   ⑤ 响应体限量、总时限，超了截断/报错，不把整个互联网拉进内存
 */
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { StringDecoder } from 'node:string_decoder';

export class WebError extends Error {
  constructor(code, message, hint = '') {
    super(message);
    this.name = 'WebError';
    this.code = code;
    this.hint = hint;
  }
}

const dnsLookup = dns.promises.lookup;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new WebError('web.timeout', `${label}超时（${ms}ms）`, '网络慢/目标不响应：稍后再试')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** 内网/环回/链路本地/CGNAT 等不可抓取的地址（IPv4 + 常见 IPv6） */
export function isPrivateIp(ip) {
  const raw = String(ip ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  const family = net.isIP(raw);
  if (!family || raw.includes('%')) return true;   // 非法地址：当不安全

  if (family === 4) {
    const p = raw.split('.').map(Number);
    if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
    if (p[0] === 198 && (p[1] === 18 || p[1] === 19)) return true;
    if (p[0] === 192 && p[1] === 0 && p[2] === 0) return true;
    if (p[0] >= 224) return true;
    return false;
  }

  if (raw === '::' || raw === '::1') return true;
  if (/^f[cd]/.test(raw)) return true;              // fc00::/7 唯一本地
  if (/^fe[89ab]/.test(raw)) return true;           // fe80::/10 链路本地
  if (/^ff/.test(raw)) return true;                 // 多播
  if (raw.startsWith('2001:db8')) return true;      // 文档地址
  const mapped = raw.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIp(mapped[1]);
  const hexMapped = raw.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const n = (parseInt(hexMapped[1], 16) << 16) + parseInt(hexMapped[2], 16);
    return isPrivateIp(`${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`);
  }
  return false;
}

/**
 * 校验 URL：协议/凭据/主机名。不做 DNS（DNS 在 resolveSafeAddresses）。
 * @returns {URL}
 */
export function validateFetchUrl(raw) {
  let u;
  try { u = new URL(String(raw ?? '')); }
  catch { throw new WebError('web.bad-url', `不是合法 URL：${raw}`, '要完整的 http(s) 地址'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new WebError('web.bad-protocol', `只允许 http/https（收到 ${u.protocol}）`, 'file/data/localhost 等都不行');
  }
  if (u.username || u.password) {
    throw new WebError('web.credentials', 'URL 里不许带用户名/密码', '凭据不要放 URL');
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) throw new WebError('web.bad-host', 'URL 没有主机名', '检查地址');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new WebError('web.private-host', `拒绝本机/本地域名：${host}`, '只能抓公网地址');
  }
  if (net.isIP(host) && isPrivateIp(host)) {
    throw new WebError('web.private-ip', `拒绝内网地址：${host}`, '只能抓公网地址');
  }
  return u;
}

/**
 * 解析域名并检查**全部**结果；返回可用于固定连接的地址列表。
 */
export async function resolveSafeAddresses(hostname, { lookup = dnsLookup, timeoutMs = 5000 } = {}) {
  const host = String(hostname ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new WebError('web.private-ip', `拒绝内网地址：${host}`, '只能抓公网地址');
    return [{ address: host, family: net.isIP(host) }];
  }
  let rows;
  try {
    rows = await withTimeout(lookup(host, { all: true, verbatim: true }), timeoutMs, `DNS 解析 ${host}`);
  } catch (error) {
    if (error instanceof WebError) throw error;
    throw new WebError('web.dns', `DNS 解析失败：${host}`, '检查域名/网络');
  }
  const list = Array.isArray(rows) ? rows : [rows];
  if (!list.length) throw new WebError('web.dns-empty', `DNS 没有返回地址：${host}`, '检查域名');
  for (const row of list) {
    if (!row?.address || isPrivateIp(row.address)) {
      throw new WebError('web.private-ip', `域名解析到内网地址：${host} → ${row?.address ?? '?'}`, '拒绝 DNS rebinding');
    }
  }
  return list.map((row) => ({ address: String(row.address), family: Number(row.family) || net.isIP(row.address) }));
}

/** 一次请求（地址已校验并固定；不重新解析 DNS） */
function requestOnce(u, address, { timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    const hostname = u.hostname.replace(/^\[|\]$/g, '');
    let settled = false;
    const done = (fn, value) => { if (settled) return; settled = true; fn(value); };

    const req = lib.request({
      protocol: u.protocol,
      hostname,
      port: u.port || undefined,
      path: `${u.pathname}${u.search}`,
      method: 'GET',
      servername: u.protocol === 'https:' ? hostname : undefined,
      headers: {
        'user-agent': 'surfcore-web/1 (+read-only)',
        accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.5',
      },
      // 固定连接地址：DNS 已经查过，这里不再查；防 rebinding
      lookup: (_host, _opts, cb) => cb(null, address.address, address.family),
      timeout: timeoutMs,
    }, (res) => {
      if (REDIRECT_STATUSES.has(res.statusCode)) {
        res.resume();
        done(resolve, { status: res.statusCode, redirect: String(res.headers.location ?? '') });
        return;
      }
      let total = 0;
      let truncated = false;
      const chunks = [];
      const decoder = new StringDecoder('utf8');
      let text = '';
      res.on('data', (chunk) => {
        if (truncated) return;
        total += chunk.length;
        if (total > maxBytes) {
          truncated = true;
          chunks.push(chunk.subarray(0, Math.max(0, chunk.length - (total - maxBytes))));
          text += decoder.write(Buffer.concat(chunks));
          chunks.length = 0;
          res.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        if (!truncated) text += decoder.write(Buffer.concat(chunks));
        text += decoder.end();
        done(resolve, {
          status: res.statusCode,
          contentType: String(res.headers['content-type'] ?? ''),
          text: text.slice(0, maxBytes),
          truncated,
        });
      });
      res.on('error', (error) => done(reject, new WebError('web.read', `读取响应失败：${error?.message ?? error}`, '稍后再试')));
    });

    req.on('timeout', () => {
      req.destroy(new WebError('web.timeout', `请求超时（${timeoutMs}ms）`, '目标不响应：稍后再试'));
    });
    req.on('error', (error) => {
      if (error instanceof WebError) return done(reject, error);
      const msg = String(error?.message ?? error);
      const code = /ENOTFOUND|EAI_AGAIN/.test(msg) ? 'web.dns' : /ECONNREFUSED|ECONNRESET|socket hang up/i.test(msg) ? 'web.network' : 'web.request';
      done(reject, new WebError(code, msg, '检查地址/网络；目标可能拒绝访问'));
    });
    req.end();
  });
}

/**
 * 安全抓取：返回 { ok:true, url, status, contentType, text, truncated }。
 * 失败抛 WebError（由工具层收敛成 {ok:false,error}）。
 */
export async function safeFetch(urlString, {
  lookup = dnsLookup,
  requestImpl = requestOnce,
  maxChars = 50000,
  maxBytes = 0,
  timeoutMs = 15000,
  maxRedirects = 3,
} = {}) {
  const capChars = Math.max(1, Number(maxChars) || 50000);
  const capBytes = Math.max(1024, Number(maxBytes) || capChars * 4);
  let current = String(urlString ?? '');
  for (let hop = 0; hop <= Math.max(0, maxRedirects); hop += 1) {
    const u = validateFetchUrl(current);
    const addresses = await resolveSafeAddresses(u.hostname, { lookup });
    const res = await requestImpl(u, addresses[0], { timeoutMs, maxBytes: capBytes });
    if (res.redirect) {
      if (!res.redirect) throw new WebError('web.redirect', '重定向缺少 Location', '目标返回了坏重定向');
      current = new URL(res.redirect, u).toString();
      continue;
    }
    return {
      ok: true,
      url: u.toString(),
      status: res.status,
      contentType: res.contentType,
      text: String(res.text ?? '').slice(0, capChars),
      truncated: res.truncated || String(res.text ?? '').length > capChars,
    };
  }
  throw new WebError('web.redirect-limit', `重定向超过 ${maxRedirects} 跳`, '目标在绕圈；换直接链接');
}
