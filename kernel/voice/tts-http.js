/**
 * 语音 HTTP 传输：把合成请求真的发出去
 * ============================================================================
 * 位置：内核 voice 的通用 HTTP 传输。只认 endpoint / path / bodyTemplate，
 * 不认识任何厂商或旧语音包；请求体由模型 manifest 声明。
 */
import { wavDurationMs } from './wav.js';

export const DEFAULT_TTS_HTTP = Object.freeze({ timeoutMs: 20000, path: '/tts' });

function resolvedBody(template, request) {
  if (!template || typeof template !== 'object') {
    return { text: String(request.text ?? ''), voiceId: String(request.voiceId ?? '') };
  }
  const out = {};
  for (const [key, value] of Object.entries(template)) {
    if (typeof value === 'string' && /^\{(text|voiceId|character|format|speed)\}$/.test(value)) {
      out[key] = request[value.slice(1, -1)] ?? '';
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * @param {object} opts { endpoint, apiKey?, path?, bodyTemplate?, timeoutMs?, fetchImpl? }
 * @returns {{synthesize:(request)=>Promise<object>}}
 */
export function createHttpVoiceTransport({
  endpoint,
  apiKey = '',
  path = DEFAULT_TTS_HTTP.path,
  bodyTemplate = null,
  timeoutMs,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!endpoint) throw new Error('语音传输需要 endpoint（你的 TTS 服务地址）');
  const url = `${String(endpoint).replace(/\/+$/, '')}${String(path || DEFAULT_TTS_HTTP.path)}`;
  const capT = Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_TTS_HTTP.timeoutMs;

  return {
    url,
    async synthesize(request = {}) {
      if (typeof fetchImpl !== 'function') return { ok: false, error: { message: '没有可用的 fetch' } };
      const text = String(request.text ?? '').trim();
      if (!text) return { ok: false, error: { message: '要合成的内容是空的' } };
      let res;
      try {
        res = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify(resolvedBody(bodyTemplate, { ...request, text })),
          signal: AbortSignal.timeout(capT),
        });
      } catch (error) {
        const message = error?.name === 'TimeoutError'
          ? `合成超时（>${Math.round(capT / 1000)}s）`
          : `TTS 服务没起来或网络失败：${error?.message ?? error}`;
        return { ok: false, error: { message } };
      }
      if (!res.ok) {
        let detail = '';
        try { const j = await res.json(); detail = j?.detail ?? j?.error ?? ''; } catch {}
        return { ok: false, status: res.status, message: detail || `TTS 服务返回 ${res.status}` };
      }
      let bytes;
      try { bytes = Buffer.from(await res.arrayBuffer()); }
      catch (error) { return { ok: false, error: { message: `读取音频失败：${error?.message ?? error}` } }; }
      if (!bytes.length) return { ok: false, status: res.status, message: 'TTS 返回了空音频' };
      const durationMs = Number(res.headers?.get?.('x-duration-ms')) || wavDurationMs(bytes);
      return { ok: true, bytes, durationMs: durationMs > 0 ? durationMs : null };
    },
  };
}
