/**
 * 能力包：语音
 * ============================================================================
 * **语音不是渠道，是能力。** 所以它不在平台包/模块里，而在内核能力里。
 * 任何能发声的入口都调用它，内核不关心入口是谁。
 *
 * 这里只放**纯逻辑**（旧代码的失败分类/路由/库校验）：
 *   · 失败分类与下一步建议
 *   · 本地/云端路由选择
 *   · 语音库条目的校验
 * 真正的合成/播放属于"接入时"（由外部 transport 注入）。
 */

/** 失败分类：给人看的下一步，不是只给个错误码 */
export function classifyVoiceError(input = {}) {
  const status = Number(input.status);
  const code = String(input.code ?? '');
  const message = String(input.message ?? '');

  if (status === 502 || /synthesis|合成/i.test(message)) {
    return { kind: 'engine-failed', retryable: true, hint: '语音引擎没起或挂了：到语音页点「启动」，或换另一个包试试' };
  }
  if (status === 404 || code === 'ENOENT') {
    return { kind: 'library-miss', retryable: false, hint: '语音库里没有这条：换一条，或用文字发' };
  }
  if (status === 413) {
    return { kind: 'too-large', retryable: false, hint: '音频太大：缩短内容，或调低音质' };
  }
  if (/timeout|超时/i.test(message) || status === 504) {
    return { kind: 'timeout', retryable: true, hint: '合成超时：稍等再试，或改用云端包' };
  }
  if (/credential|key|token|鉴权|401|403/i.test(`${message} ${code}`) || status === 401 || status === 403) {
    return { kind: 'credential', retryable: false, hint: '云端凭据没配好：到语音页填 AppID/AccessKey（不要贴到聊天里）' };
  }
  return { kind: 'unknown', retryable: true, hint: '语音没发出去：可以先打字，稍后再试' };
}

/**
 * 路由选择：本地优先还是云端优先（旧代码 voice-diagnostics.pickFallbackRoute）。
 * @param {object} input { preferred:'local'|'cloud', available:{local:boolean, cloud:boolean}, strict?:boolean }
 */
export function pickRoute({ preferred = 'local', available = {}, strict = false } = {}) {
  const local = available.local === true;
  const cloud = available.cloud === true;
  const first = preferred === 'cloud' ? 'cloud' : 'local';
  const second = first === 'local' ? 'cloud' : 'local';
  const has = { local, cloud };

  if (has[first]) return { route: first, fallback: false };
  if (!strict && has[second]) return { route: second, fallback: true, from: first };
  return { route: null, fallback: false, error: '两个语音包都没起：到语音页启动一个，或先打字' };
}

/** 语音库条目校验：坏条目不许进列表（旧代码 validateCharacter 的简化） */
export function validateVoiceEntry(entry = {}) {
  const errors = [];
  const name = String(entry.name ?? '').trim();
  if (!name) errors.push('缺少文件名');
  if (/[\\/]/.test(name)) errors.push('文件名不能带路径分隔符');
  if (!/\.(wav|mp3|m4a|ogg)$/i.test(name)) errors.push('不支持的音频格式');
  const ms = Number(entry.durationMs) || 0;
  if (ms <= 0) errors.push('拿不到时长（文件可能损坏）');
  if (ms > 5 * 60 * 1000) errors.push('超过 5 分钟，不适合当语音条');
  return { ok: errors.length === 0, errors };
}

/** 发送前的闸门（旧代码的语音三闸门：开关 / 长度 / 频率） */
export function gateVoice({ enabled = true, chars = 0, maxChars = 120, recentCount = 0, perHour = 10 } = {}) {
  if (!enabled) return { ok: false, code: 'voice.disabled', hint: '语音总闸没开：设置页 → 语音' };
  if (chars > maxChars) return { ok: false, code: 'voice.too-long', hint: `最多 ${maxChars} 字（收到 ${chars}）：缩短或改打字` };
  if (recentCount >= perHour) return { ok: false, code: 'voice.rate-limited', hint: `一小时内最多 ${perHour} 条：等一会儿` };
  return { ok: true };
}

/* 语音模型/服务商属于语音能力：公共面只暴露 model/provider 语义。 */
export { createVoiceModels } from './models.js';
export {
  normalizeVoiceProvider, pickVoiceProvider,
} from './providers.js';
