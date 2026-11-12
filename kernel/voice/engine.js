/**
 * 语音引擎端口：把"要念的话"交给外部服务，拿回音频
 * ============================================================================
 * 位置：内核 voice 模块。它是**端口**，不是引擎：具体是本地服务还是云端 API，
 * 由调用方注入（transport），内核不知道、也不需要知道。
 *
 * 三条规矩：
 *   · 拿不到音频就**如实失败**（不假装发了语音）
 *   · 失败分类复用既有 classifyVoiceError（不另造错误码）
 *   · 不写死任何服务名/参数名（请求描述由 buildSynthRequest 产出）
 *
 * transport 契约（很小）：
 *   { async synthesize(request) → { ok:true, bytes } | { ok:true, path } | { ok:false, status?, message?, error? } }
 */
import { buildSynthRequest, DEFAULT_SYNTH } from './tts.js';
import { classifyVoiceError } from './index.js';

export function createVoiceEngine({ transport, cfg = {} } = {}) {
  if (!transport || typeof transport.synthesize !== 'function') {
    throw new Error('语音引擎需要 transport.synthesize()（具体服务由调用方注入）');
  }

  return {
    name: 'voice-engine',
    config() { return { ...DEFAULT_SYNTH, ...cfg }; },

    /**
     * 念一句。
     * @param {object} input { text, voiceId }
     * @returns {Promise<{ok:boolean, bytes?:Buffer, path?:string, format?:string, error?:object}>}
     */
    async speak({ text = '', voiceId = '' } = {}) {
      const built = buildSynthRequest({ text, voiceId }, cfg);
      if (!built.ok) return { ok: false, error: built.error };

      let res;
      try {
        res = await transport.synthesize(built.request);
      } catch (error) {
        const cls = classifyVoiceError({ message: String(error?.message ?? error) });
        return { ok: false, error: cls };
      }

      if (res?.ok === true) {
        if (res.bytes) return { ok: true, bytes: res.bytes, format: built.request.format, durationMs: Number(res.durationMs) > 0 ? Number(res.durationMs) : null };
        if (res.path) return { ok: true, path: String(res.path), format: built.request.format };
        return { ok: false, error: { kind: 'engine-failed', retryable: true, hint: '合成成功但没给音频（检查服务返回）' } };
      }

      const cls = classifyVoiceError({ status: res?.status, code: res?.error?.code, message: String(res?.error?.message ?? res?.message ?? '') });
      return { ok: false, error: res?.error ?? cls };
    },
  };
}
