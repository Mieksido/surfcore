/**
 * 桌宠本地接口的「形状」：路由 + 访问闸门（纯函数，不起 HTTP 服务）
 * ============================================================================
 * 位置：桌宠模块。**桌宠进程怎么找到我们、用什么路径、什么算合法请求**，
 * 是桌宠这个世界自己的秘密（旧 pet-api.js 230 行里可复用的部分）。
 *
 * 这里只回答三个问题：
 *   ① 这个请求该由哪个动作处理（路由表）
 *   ② 这个请求配不配进来（只回环 / 写操作同源 + JSON / 令牌）
 *   ③ 令牌/音频地址长什么样（host.json 里写给桌宠看）
 *
 * 真正的 HTTP 服务器、fs、token 生成都在壳/运行入口，不在这里。
 */

/** 桌宠发现接口的前缀（写进 host.json，桌宠照着连） */
export const PET_API_PREFIX = '/dsh-surfcore/pet-api';

/** host.json 的版本（形状变了才加） */
export const PET_HOST_FILE_VERSION = 1;

/** 路由表：method + 路径 → 动作名（动作由壳实现，包只给形状） */
export const PET_API_ROUTES = Object.freeze([
  { method: 'GET', path: '/health', action: 'health' },
  { method: 'GET', path: '/status', action: 'status' },
  { method: 'GET', path: '/config', action: 'config' },
  { method: 'GET', path: '/history', action: 'history' },
  { method: 'GET', path: '/purpose/status', action: 'purpose.status' },
  { method: 'POST', path: '/purpose/preview', action: 'purpose.preview', body: 'json' },
  { method: 'POST', path: '/purpose/run', action: 'purpose.run', body: 'json' },
  { method: 'POST', path: '/chat', action: 'chat', body: 'json' },
  { method: 'POST', path: '/focus', action: 'focus', body: 'json' },
  { method: 'GET', path: '/events', action: 'events' },
  { method: 'GET', path: '/audio/:key', action: 'audio' },
]);

/** 回环地址判定（只认本机；别把内网地址当本机） */
export function isLoopbackAddress(address = '') {
  const a = String(address ?? '').trim().toLowerCase();
  if (!a) return false;
  if (a === 'localhost' || a === '::1') return true;
  const v4 = a.startsWith('::ffff:') ? a.slice('::ffff:'.length) : a;
  return /^127(?:\.\d{1,3}){3}$/.test(v4);
}

/** 写操作的同源判定：没有 Origin 视为本机客户端；有就必须和 Host 对得上 */
export function isSameOrigin({ origin = '', host = '' } = {}) {
  const raw = String(origin ?? '').trim();
  if (!raw) return true;
  try {
    const u = new URL(raw);
    const h = String(host ?? '').trim().toLowerCase();
    if (!h) return false;
    return h === u.host.toLowerCase();
  } catch {
    return false;
  }
}

/** 常量时间比较（长度不同也走完，不因为第一个字符不同就早退） */
export function safeTokenEqual(a = '', b = '') {
  const x = String(a ?? '');
  const y = String(b ?? '');
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i += 1) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

/** 桌宠发现文件的内容（壳负责落盘；这里只给形状） */
export function buildPetHostPayload({ baseUrl = '', token = '', pluginVersion = '', now = Date.now() } = {}) {
  return {
    version: PET_HOST_FILE_VERSION,
    baseUrl: String(baseUrl).replace(/\/+$/, ''),
    token: String(token),
    api: PET_API_PREFIX,
    pluginVersion: String(pluginVersion),
    updatedAt: new Date(now).toISOString(),
  };
}

/** 音频地址（只允许十六进制 key，避免路径穿越） */
export function petAudioUrl(key, { token = '' } = {}) {
  const safe = String(key ?? '').replace(/[^a-f0-9]/gi, '');
  if (!safe) return '';
  const q = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${PET_API_PREFIX}/audio/${safe}.wav${q}`;
}

/**
 * 访问闸门：按顺序查"回环 → 同源/JSON → 令牌"。
 * @returns {{ok:true}|{ok:false,status:number,code:string,error:string,hint?:string}}
 */
export function petApiGate({
  method = 'GET',
  remoteAddress = '',
  origin = '',
  host = '',
  contentType = '',
  token = '',
  queryToken = '',
  expectedToken = '',
} = {}) {
  if (!isLoopbackAddress(remoteAddress)) {
    return { ok: false, status: 403, code: 'pet.not-loopback', error: '只接受本机回环访问', hint: '桌宠应与 DSH 在同一台机器上' };
  }

  const write = String(method).toUpperCase() !== 'GET';
  if (write && !isSameOrigin({ origin, host })) {
    return { ok: false, status: 403, code: 'pet.cross-origin', error: '跨站请求被拒绝', hint: '从桌宠/本机页面发起，或去掉 Origin 头' };
  }
  if (write && !String(contentType).toLowerCase().includes('application/json')) {
    return { ok: false, status: 415, code: 'pet.not-json', error: '写操作必须是 application/json', hint: '请求头加 content-type: application/json' };
  }

  const expected = String(expectedToken ?? '');
  if (!expected) {
    return { ok: false, status: 401, code: 'pet.no-token', error: '桌宠令牌还没生成', hint: '重启 DSH 后会重写 host.json，桌宠重连后再试' };
  }
  const given = String(token || queryToken || '');
  if (!given || !safeTokenEqual(given, expected)) {
    return { ok: false, status: 401, code: 'pet.bad-token', error: '桌宠令牌无效', hint: 'host.json 里的 token 过期了：重启 DSH 后重新读取' };
  }
  return { ok: true };
}

/**
 * 路由匹配：返回动作名与路径参数；不匹配返回 null。
 * @returns {{action:string, params:object, body?:string}|null}
 */
export function matchPetRoute(method = 'GET', pathname = '') {
  const m = String(method).toUpperCase();
  let suffix = String(pathname ?? '');
  if (suffix.startsWith(PET_API_PREFIX)) suffix = suffix.slice(PET_API_PREFIX.length);
  if (!suffix.startsWith('/')) suffix = `/${suffix}`;
  if (suffix.length > 1 && suffix.endsWith('/')) suffix = suffix.slice(0, -1);

  for (const route of PET_API_ROUTES) {
    if (route.method !== m) continue;
    if (route.path === suffix) return { action: route.action, params: {}, ...(route.body ? { body: route.body } : {}) };
  }

  const audio = /^\/audio\/([a-f0-9]+)\.wav$/i.exec(suffix);
  if (m === 'GET' && audio) return { action: 'audio', params: { key: audio[1].toLowerCase() } };
  return null;
}

/** 给设置页/诊断看的一份摘要 */
export function describePetApi() {
  return {
    prefix: PET_API_PREFIX,
    hostFileVersion: PET_HOST_FILE_VERSION,
    routes: PET_API_ROUTES.map((r) => `${r.method} ${r.path}`),
  };
}
