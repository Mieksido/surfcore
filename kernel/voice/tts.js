/**
 * 语音合成：内核只发请求、只读结果，**不含引擎**
 * ============================================================================
 * 位置：内核（voice 模块）。它产出的是"要合成什么"与"合成回来怎么判"，
 * 真正的 TTS 在外部服务（本地或云端 TTS），引擎由用户配置。
 *
 * 三条规矩：
 *   · 请求描述**与厂商无关**（不写死任何服务名/参数名）
 *   · 失败分类复用 voice 的既有分类（不另造一套错误码）
 *   · 拿不到音频就**如实失败**，不假装发了语音
 */
import { classifyVoiceError } from './index.js';

/** 默认上限：一行语音最多多少字（说太长没人听） */
export const DEFAULT_SYNTH = Object.freeze({ maxChars: 120, format: 'wav' });

/**
 * 造一个合成请求描述（交给外部服务去执行）。
 * @param {object} input { text, voiceId, format, speed }
 * @returns {{ok:boolean, request?:object, error?:object}}
 */
export function buildSynthRequest({ text = '', voiceId = '', format, speed } = {}, cfg = {}) {
  const opts = { ...DEFAULT_SYNTH, ...cfg };
  const body = String(text ?? '').trim();

  if (!body) return { ok: false, error: { code: 'voice.empty', message: '没有要念的内容', hint: '改成打字发' } };
  if (body.length > opts.maxChars) {
    return { ok: false, error: { code: 'voice.too-long', message: `超过 ${opts.maxChars} 字`, hint: '缩短，或改成打字' } };
  }

  return {
    ok: true,
    request: {
      text: body,
      voiceId: String(voiceId ?? ''),
      format: String(format ?? opts.format),
      speed: Number.isFinite(Number(speed)) ? Number(speed) : undefined,
    },
  };
}

/**
 * 判读外部服务的返回。
 * @param {object} input { status, body, headers } 或 { error }
 * @returns {{ok:boolean, audioPath?:string, error?:object}}
 */
export function interpretSynthResponse({ status = 200, body = null, error = null } = {}) {
  if (error) {
    return { ok: false, error: classifyVoiceError({ message: String(error?.message ?? error) }) };
  }
  if (status !== 200 && status !== 201) {
    const cls = classifyVoiceError({ status, message: String(body?.message ?? '') });
    return { ok: false, error: { ...cls, status } };
  }
  const path = body?.path ?? body?.audioPath ?? null;
  if (!path) {
    return { ok: false, error: { kind: 'engine-failed', retryable: true, hint: '合成返回里没有音频路径：检查服务配置' } };
  }
  return { ok: true, audioPath: String(path) };
}
