/**
 * B站 网络层：只做"协议这一侧"，cookie 用户自备
 * ============================================================================
 * 位置：平台包内部。它只跟 bilibili 的 HTTP 接口打交道，
 * 不认识内核、不认识别的平台；失败一律收敛成 { ok, error }。
 *
 * 三条规矩：
 *   · **不内置任何凭据**：cookie 由调用方传（用户自己的登录态）
 *   · 失败分类与"下一步"：401/412 → 登录态失效；风控码 → 别急着重试
 *   · 只实现**能离线测**的调用（注入 fetch）；真接口要用户自己的 cookie
 */

/** 常见返回码的"下一步"（B站 用 code 字段表达业务错误） */
export function explainBiliCode(code) {
  const n = Number(code);
  if (n === 0) return null;
  if (n === -101 || n === -400) return { kind: 'login', hint: '登录态失效：到 B站 页重新登录（cookie 用户自备）' };
  if (n === -352 || n === -412) return { kind: 'risk', hint: '触发风控：别急着重试，隔一段时间再来' };
  if (n === -404) return { kind: 'notfound', hint: '内容不存在或已删除' };
  if (n === 12002) return { kind: 'closed', hint: '评论区已关闭' };
  return { kind: 'unknown', hint: `B站 返回 ${n}：稍后再试或检查参数` };
}

/**
 * @param {object} opts { fetchImpl, cookie, baseUrl, timeoutMs }
 */
export function createBiliClient({
  fetchImpl = globalThis.fetch,
  cookie = '',
  baseUrl = 'https://api.bilibili.com',
  timeoutMs = 10000,
} = {}) {
  const base = String(baseUrl).replace(/\/+$/, '');

  async function call(pathname, { method = 'GET', query = {}, body = null } = {}) {
    if (typeof fetchImpl !== 'function') {
      return { ok: false, error: { code: 'bili.no-fetch', message: '没有可用的 fetch', retryable: false } };
    }
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null)).toString();
    const url = `${base}${pathname}${qs ? `?${qs}` : ''}`;

    let res;
    try {
      res = await fetchImpl(url, {
        method,
        headers: {
          ...(cookie ? { cookie: String(cookie) } : {}),
          'user-agent': 'surfcore/1 (bilibili pack)',
          ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        },
        ...(body ? { body: new URLSearchParams(body).toString() } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const msg = String(error?.message ?? error);
      const isTimeout = /timeout|abort/i.test(msg);
      return { ok: false, error: { code: isTimeout ? 'bili.timeout' : 'bili.network', message: msg, retryable: true, hint: isTimeout ? '超时：可以重试' : '网络不通：检查网络或稍后' } };
    }

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: { code: 'bili.http', status: res.status, message: `HTTP ${res.status}`, retryable: res.status >= 500, hint: res.status === 412 ? '触发风控：别急着重试' : '稍后重试' } };
    }
    const code = payload?.code ?? 0;
    if (Number(code) !== 0) {
      const ex = explainBiliCode(code) ?? { kind: 'unknown', hint: '稍后再试' };
      return { ok: false, error: { code: `bili.${ex.kind}`, biliCode: Number(code), message: String(payload?.message ?? payload?.msg ?? code), retryable: ex.kind !== 'risk' && ex.kind !== 'login', hint: ex.hint } };
    }
    return { ok: true, data: payload?.data ?? null };
  }

  return {
    call,
    /** 取视频信息（不需要登录态） */
    videoInfo({ bvid }) { return call('/x/web-interface/view', { query: { bvid } }); },
    /** 发评论（需要登录态 cookie） */
    postComment({ oid, message, type = 1 }) {
      return call('/x/v2/reply/add', { method: 'POST', body: { oid, message, type } });
    },
    /** 看自己是否登录（需要 cookie） */
    nav() { return call('/x/web-interface/nav'); },

    /* ── 读：内容（只读公开数据；cookie 有就带，没有也能取公开部分） ── */

    /** 某个用户的空间动态列表（旧 bili-api.js 的 feed/space） */
    spaceDynamics({ mid, offset = 0 } = {}) {
      return call('/x/polymer/web-dynamic/v1/feed/space', { query: { host_mid: mid, offset } });
    },
    /** 单条动态详情 */
    dynamicDetail({ id } = {}) {
      return call('/x/polymer/web-dynamic/v1/detail', { query: { id } });
    },
    /** 某条内容下的评论（type: 1=视频 12=专栏 17=动态） */
    replies({ oid, type = 1, pn = 1, ps = 20, sort = 1 } = {}) {
      return call('/x/v2/reply', { query: { oid, type, pn, ps, sort } });
    },
    /** 用户名片（昵称/头像/签名；公开信息） */
    userCard({ mid } = {}) {
      return call('/x/web-interface/card', { query: { mid } });
    },
  };
}
