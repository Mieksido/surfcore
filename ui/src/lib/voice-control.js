/**
 * 语音 UI 同源 API 层
 * ============================================================================
 * 前端只调 16460 的 /surfcore-api/voice/*；宿主代理内部转发到语音控制面。
 * 不填地址、不填 token、不处理 CORS；不读 state、不启动进程。
 */

export const VOICE_CONTROL_BASE = '/surfcore-api/voice';

export function voiceControlErr(code, message, hint, extra) {
  return Object.assign({
    code: String(code || 'voice-control.failed'),
    message: String(message || '语音控制面请求失败'),
    hint: String(hint || '确认语音控制面已启动后重试'),
    retryable: false,
    notWired: false,
    unknown: false,
  }, extra || {});
}

function fromHttp(status, payload) {
  const rawError = payload && typeof payload === 'object' ? payload.error : null;
  const e = rawError && typeof rawError === 'object'
    ? rawError
    : {
      code: payload && typeof payload === 'object' ? payload.code : '',
      message: typeof rawError === 'string' ? rawError : (payload && typeof payload === 'object' ? payload.message : ''),
      hint: payload && typeof payload === 'object' ? payload.hint : '',
      retryable: payload && typeof payload === 'object' ? payload.retryable : false,
      missing: payload && typeof payload === 'object' ? payload.missing : undefined,
      detail: payload && typeof payload === 'object' ? payload.detail : undefined,
    };
  const code = String(e.code || '');
  if (status === 503 || code === 'voice.control.no-token' || status === 502 || code === 'voice.control.down') {
    return voiceControlErr('VOICE_CONTROL_UNAVAILABLE', '语音服务暂时不可用', '稍后重试；如果持续这样，请联系管理员', { retryable: true, unknown: true });
  }
  if (status === 401 || status === 403) {
    return voiceControlErr('VOICE_CONTROL_UNAVAILABLE', '语音服务暂时不可用', '稍后重试；如果持续这样，请联系管理员', { retryable: true, unknown: true });
  }
  if (status === 404) {
    return voiceControlErr('VOICE_CONTROL_UNAVAILABLE', '语音服务暂时不可用', '稍后重试；如果持续这样，请联系管理员', { retryable: true, unknown: true });
  }
  if (code === 'voice-model.unzip-failed') {
    return voiceControlErr(code, 'zip 解压失败', '临时磁盘空间不足或压缩包损坏；本地模型解压后约 7GB+，把语音临时目录放到空间足够的磁盘后重试', { retryable: true });
  }
  if (code === 'voice-model.operation-failed') {
    return voiceControlErr(code, '试合成失败', '检查本机语音引擎是否在跑：本地 8765 + 9880，云端 8767；看服务日志后重试', { retryable: true });
  }
  return voiceControlErr(
    code || ('voice-control.http-' + status),
    e.message || ('语音服务失败（HTTP ' + status + '）'),
    e.hint || (status >= 500 ? '稍后重试；如果持续这样，请联系管理员' : '按提示修正后重试'),
    { retryable: e.retryable === true || status >= 500, missing: e.missing, detail: e.detail },
  );
}

/**
 * 同源请求；health 不存在，直接用 /status 判断。
 * @param {{path:string,method?:string,body?:any,signal?:AbortSignal,timeoutMs?:number}} options
 */
export async function voiceControlRequest(options) {
  const opt = options || {};
  const path = String(opt.path || '/status');
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const signal = opt.signal || null;
  const timeoutMs = Math.max(1000, Number(opt.timeoutMs) || 15000);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try { if (ctrl) ctrl.abort(); } catch (error) { /* 已中止 */ }
  }, timeoutMs);
  const onAbort = () => { try { if (ctrl) ctrl.abort(); } catch (error) { /* 已中止 */ } };
  if (signal) {
    if (signal.aborted) { clearTimeout(timer); return { ok: false, aborted: true }; }
    signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const headers = {};
    const init = { method: String(opt.method || 'GET').toUpperCase(), headers, credentials: 'same-origin', signal: ctrl ? ctrl.signal : undefined, cache: 'no-store' };
    if (opt.body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(opt.body);
    }
    const res = await fetch(VOICE_CONTROL_BASE + path, init);
    const text = await res.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch (error) { payload = null; }
    if (!res.ok) return { ok: false, status: res.status, error: fromHttp(res.status, payload) };
    if (!payload || typeof payload !== 'object') {
      return { ok: false, status: res.status, error: voiceControlErr('VOICE_CONTROL_BAD_JSON', '语音代理返回非 JSON', '确认同源代理版本', { retryable: true }) };
    }
    if (payload.ok === false) return { ok: false, status: res.status, error: fromHttp(res.status, payload) };
    return { ok: true, status: res.status, data: payload };
  } catch (error) {
    if (signal && signal.aborted) return { ok: false, aborted: true };
    if (timedOut) {
      return { ok: false, error: voiceControlErr('VOICE_CONTROL_TIMEOUT', '语音请求超时', '确认控制面/导入还在跑；如果是长导入，先刷新状态', { retryable: true, unknown: true }) };
    }
    return { ok: false, error: voiceControlErr('VOICE_CONTROL_UNREACHABLE', '语音代理不可达', '确认 DSH 宿主与语音控制面都在运行', { retryable: true, unknown: true }) };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

export const voiceControlApi = {
  status: (opts) => voiceControlRequest(Object.assign({}, opts || {}, { path: '/status', timeoutMs: 15000 })),
  models: (opts) => voiceControlRequest(Object.assign({}, opts || {}, { path: '/models', timeoutMs: 15000 })),
  providers: (opts) => voiceControlRequest(Object.assign({}, opts || {}, { path: '/providers', timeoutMs: 15000 })),
  load: (opts) => { const o = opts || {}; return voiceControlRequest(Object.assign({}, o, { path: '/models/load', method: 'POST', body: { modelId: o.modelId }, timeoutMs: 75000 })); },
  unload: (opts) => { const o = opts || {}; return voiceControlRequest(Object.assign({}, o, { path: '/models/unload', method: 'POST', body: { modelId: o.modelId }, timeoutMs: 30000 })); },
  select: (opts) => { const o = opts || {}; return voiceControlRequest(Object.assign({}, o, { path: '/models/select', method: 'POST', body: { modelId: o.modelId }, timeoutMs: 15000 })); },
  relink: (opts) => { const o = opts || {}; return voiceControlRequest(Object.assign({}, o, { path: '/models/relink', method: 'POST', body: { modelId: o.modelId, dir: o.dir }, timeoutMs: 130000 })); },
  probe: (opts) => { const o = opts || {}; return voiceControlRequest(Object.assign({}, o, { path: '/models/probe', method: 'POST', body: { modelId: o.modelId, text: o.text }, timeoutMs: 130000 })); },
  synthesize: (opts) => { const o = opts || {}; return voiceControlRequest(Object.assign({}, o, { path: '/models/synthesize', method: 'POST', body: { modelId: o.modelId, text: o.text, voiceId: o.voiceId || undefined }, timeoutMs: 130000 })); },
  importModel: (opts) => { const o = opts || {}; return voiceControlRequest(Object.assign({}, o, { path: '/models/import', method: 'POST', body: o.payload, timeoutMs: 20 * 60 * 1000 })); },
  saveProvider: (opts) => { const o = opts || {}; return voiceControlRequest(Object.assign({}, o, { path: '/providers', method: 'POST', body: o.provider, timeoutMs: 20000 })); },
  deleteProvider: (opts) => { const o = opts || {}; return voiceControlRequest(Object.assign({}, o, { path: '/providers/' + encodeURIComponent(o.id), method: 'DELETE', timeoutMs: 20000 })); },
};

export function voiceModelStateLabel(state) {
  return {
    missing: '工件缺失',
    idle: '未启动',
    loaded: '已启动',
  }[String(state || '')] || '状态未知';
}

export function voiceKindLabel(kind) {
  return kind === 'cloud' ? '服务商' : '本地';
}

/**
 * 宿主原生选择器（不是语音控制面接口）。
 * 后端 import 只接受本机路径；没有上传接口，所以这里只能让宿主弹系统选择框。
 * 目前宿主 browse 路由只支持固定 filter 枚举；zip 暂借用 embedding-pack 的 *.zip 过滤。
 */
export async function browseLocalPath(opts) {
  const o = opts || {};
  const mode = o.mode === 'dir' ? 'dir' : 'file';
  const params = new URLSearchParams();
  params.set('mode', mode);
  params.set('title', String(o.title || (mode === 'file' ? '选择语音模型文件' : '选择模型安装目录')));
  if (mode === 'file' && o.zipOnly !== false) params.set('filter', 'embedding-pack');
  try {
    const res = await fetch('/dsh-surfcore/api/browse?' + params.toString(), {
      method: 'GET', credentials: 'same-origin', cache: 'no-store',
    });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (error) { body = null; }
    if (!res.ok) {
      return { ok: false, error: voiceControlErr('VOICE_BROWSE_FAILED', '系统文件选择器不可用', '确认 DSH 在本机桌面运行后重试', { retryable: true }) };
    }
    if (!body || body.ok !== true) {
      if (body && body.cancelled === true) return { ok: false, cancelled: true };
      return { ok: false, error: voiceControlErr('VOICE_BROWSE_FAILED', (body && body.error) || '没有选到路径', '重新打开选择器，或换一个位置', { retryable: true }) };
    }
    const path = String(body.path || '').trim();
    if (!path) return { ok: false, error: voiceControlErr('VOICE_BROWSE_EMPTY', '选择器没有返回路径', '重新选择', { retryable: true }) };
    return { ok: true, path };
  } catch (error) {
    return { ok: false, error: voiceControlErr('VOICE_BROWSE_UNREACHABLE', '系统文件选择器不可达', '确认 DSH 与本机桌面会话正常后重试', { retryable: true, unknown: true }) };
  }
}
