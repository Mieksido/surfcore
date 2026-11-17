/**
 * 本机 HTTP 接口的通用护栏 —— 设置页 API（`/dsh-surfcore/api/*`）与
 * 桌宠 API（`/dsh-surfcore/pet-api/*`）共用**同一份**实现。
 *
 * 为什么单独一个模块：这两套接口的准入条件（只接受回环 Host、写操作必须同源、
 * 响应头固定）曾经在两个文件里各抄了一遍。安全判据复制多份的后果不是"重复代码不好看"，
 * 而是**将来只修一处**：放宽/收紧回环名单时漏掉另一份，缺口就会静默存在。
 * 所以这里只做一件事：把「这个请求能不能进」的判据收敛成唯一实现，改一处两处同时生效。
 *
 * 这些函数都**只读请求**、没有副作用，便于单测（`scripts/test-http-guard.mjs`）。
 */
import { timingSafeEqual } from 'node:crypto';

/** 统一的 JSON 响应（响应头固定 no-store；res 已关闭时不抛，交给上层日志）。 */
export function json(res, code, value) {
  try {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  } catch {}
}

/** 读取请求体（有上限，超限直接断开）。默认 512KB（设置页 API 的既有口径；桌宠 API 传更小的 256KB）。 */
export function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * 只接受本机回环访问。
 *
 * 判据是 **Host 请求头**而不是对端地址：DNS rebinding 场景下，页面把 evil.com
 * 解析到 127.0.0.1 时对端地址就是回环，只有 Host 还能认出真实来源。
 * 浏览器无法伪造 Host，所以这一层挡得住网页；挡不住本机进程——那一层由
 * DSH 的 `connection.requestRejection`（设置页 API）与 `x-pet-token`（桌宠 API）负责。
 */
export function isLoopbackReq(req) {
  const host = String(req.headers?.host ?? '').trim().toLowerCase();
  if (!host) return false;
  // IPv6 字面量在 Host 里是 `[::1]:8080`：`split(':')[0]` 只会拿到 `[`，
  // 于是原本写好的 `[::1]` / `::1` 分支成了永远走不到的死代码
  // （2026-10-26 审计：单测第一次跑出这个洞；DSH 若绑到 ::1，整套接口会 403）。
  const name = host.startsWith('[')
    ? (host.includes(']') ? host.slice(0, host.indexOf(']') + 1) : '')
    : host.split(':')[0];
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]' || host === '::1';
}

/**
 * 把 Host 头拆成「主机名 + 授权串」。IPv6 字面量必须带方括号才能和端口区分，
 * 裸 IPv6（`::1`）按主机名处理。
 * @returns {{ name: string, authority: string } | null} 解析失败返回 null（调用方 fail-closed）
 */
export function splitHostHeader(rawHost) {
  const host = String(rawHost ?? '').trim().toLowerCase();
  if (!host) return null;
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end === -1) return null;
    const name = host.slice(0, end + 1);
    return name.length > 2 ? { name, authority: host } : null;
  }
  const colon = host.indexOf(':');
  const name = colon === -1 ? host : host.slice(0, colon);
  return name ? { name, authority: host } : null;
}

/** 监听地址是裸 IPv6（`::` / `fe80::1`）时补方括号，再交给 splitHostHeader。 */
function authorityOf(raw) {
  const text = String(raw ?? '').trim().toLowerCase();
  if (!text) return null;
  const wrapped = text.startsWith('[') || text.split(':').length <= 2 ? text : `[${text}]`;
  return splitHostHeader(wrapped);
}

/**
 * 设置页 API（`/dsh-surfcore/api/*`）的 Host 判据。
 *
 * 为什么不再只认回环（2026-11-17）：DSH 搬到 Linux 服务器后用 `--host 192.168.3.110`
 * 绑定网卡地址，客户端浏览器打开的地址就是它，Host 也随之是 `192.168.3.110:43120`。
 * 旧判据只认 127.0.0.1/localhost/::1 → 设置页与「Token 额度」全量 403，
 * 前端只能显示「读取 token 额度失败：只接受本机回环访问」。
 *
 * 现在与 DSH 自己的 `isTrustedApiRequest` 采用同一套策略：
 *   回环 ∥ DSH 监听地址（绑到 LAN 地址本身就是运维明确决定）∥ `webAccess.trustedHosts` 白名单。
 *
 * 放宽到「监听地址」不等于放开任意来源：浏览器无法伪造 Host，DNS rebinding 仍被 Host +
 * `sec-fetch-site` 挡住，写操作还要过 `sameOrigin` 与 DSH 的 `connection.requestRejection`。
 * 想退回只认回环：`webAccess.trustBindAddress = false` 且清空白名单。
 *
 * @param {object} req Node HTTP 请求（只看 headers）
 * @param {{trustedHosts?: string[], bindHost?: string, trustBindAddress?: boolean}} policy
 * @returns {boolean} true = 放行
 */
export function isAllowedHost(req, policy = {}) {
  if (isLoopbackReq(req)) return true;
  // 跨站发起：即使 Host 是我们自己的也不放行（与 DSH 的 sec-fetch-site 判据同源）。
  if (String(req.headers?.['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') return false;
  const parsed = splitHostHeader(req.headers?.host);
  if (!parsed) return false;

  const { trustedHosts = [], bindHost = '', trustBindAddress = true } = policy ?? {};
  if (trustBindAddress && bindHost) {
    const bind = authorityOf(bindHost);
    if (bind && bind.name === parsed.name) return true;
  }
  for (const entry of Array.isArray(trustedHosts) ? trustedHosts : []) {
    const candidate = authorityOf(entry);
    if (!candidate) continue;
    // 白名单条目写了端口就按「主机:端口」精确匹配；没写端口则任意端口都算
    // （与 DSH 的 trustedHosts 语义一致）。
    const explicitPort = candidate.authority.length > candidate.name.length;
    if (explicitPort ? candidate.authority === parsed.authority : candidate.name === parsed.name) return true;
  }
  return false;
}

/**
 * 写操作的同源校验：带了 Origin 就必须与 Host 一致；**没带 Origin 视为通过**。
 *
 * 没带 Origin 的是非浏览器客户端（curl / 桌宠主进程）。浏览器对跨站 POST 一定会带
 * Origin，所以"浏览器发起的跨站写"必然落在这条判断里被拒。
 */
export function sameOrigin(req) {
  const origin = req.headers?.origin;
  if (!origin) return true;
  try {
    const originHost = new URL(String(origin)).host.toLowerCase();
    return originHost === String(req.headers?.host ?? '').toLowerCase();
  } catch {
    return false;
  }
}

/** 定长比较令牌：`!==` 会在第一个不同字符处短路，可被本机进程用响应时延逐字节试探。 */
export function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  // 空令牌永不通过：`timingSafeEqual` 对两个空 buffer 返回 true，
  // 那样"还没生成令牌"就会被当成"令牌正确"。失败关闭。
  if (left.length === 0 || right.length === 0) return false;
  if (left.length !== right.length) return false;
  try {
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}
