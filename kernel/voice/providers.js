/**
 * 语音服务商/本地模型的公开档案（纯规则）
 * ============================================================================
 * 对外只给掩码和 hasX；原始 AppID/AccessKey/复刻 ID 不进入公开档案。
 * 不读盘、不启动进程；配置持久化和写 config.toml/voice.json 在 provider-config。
 */
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const HTTP = /^https?:\/\/[^\s]+$/i;
const mask = (v) => {
  const s = String(v ?? '');
  if (!s) return '';
  if (s.length <= 6) return '****';
  return `${s.slice(0, 3)}****${s.slice(-2)}`;
};

/**
 * @returns {{ok:true,value:{id,kind,vendor,endpoint,model,voiceId,resourceId,speaker,
 *   configured,hasAppId,appIdMasked,hasAccessKey,accessKeyMasked,keyMasked}}
 *          | {ok:false,error:{code,message,hint}}}
 */
export function normalizeVoiceProvider(raw = {}) {
  const id = clean(raw.id, 64);
  const kind = raw.kind === 'local' ? 'local' : (raw.kind === 'cloud' ? 'cloud' : '');
  const vendor = clean(raw.vendor, 40) || (kind === 'cloud' ? 'volcano' : '');
  const endpoint = clean(raw.endpoint, 300).replace(/\/+$/, '');
  const model = clean(raw.model, 80);
  const voiceId = clean(raw.voiceId ?? raw.voice, 80);
  const appId = clean(raw.appId, 120);
  const accessKey = String(raw.accessKey ?? raw.apiKey ?? raw.key ?? '').trim();
  const resourceId = clean(raw.resourceId ?? raw.resource, 80) || (kind === 'cloud' ? 'seed-icl-2.0' : '');
  const speaker = clean(raw.speaker ?? raw.cloneId, 120);
  const path = clean(raw.path, 300) || '/tts';
  const bodyTemplate = raw.bodyTemplate && typeof raw.bodyTemplate === 'object' && !Array.isArray(raw.bodyTemplate)
    ? Object.fromEntries(Object.entries(raw.bodyTemplate).slice(0, 40).map(([k, v]) => [clean(k, 40), typeof v === 'number' || typeof v === 'boolean' ? v : clean(v, 200)]))
    : {};
  if (!id) return { ok: false, error: { code: 'voice-provider.no-id', message: '缺少 provider id' } };
  if (!kind) return { ok: false, error: { code: 'voice-provider.bad-kind', message: 'kind 只能是 local 或 cloud' } };
  if (!endpoint || !HTTP.test(endpoint)) return { ok: false, error: { code: 'voice-provider.bad-endpoint', message: 'endpoint 必须是 http(s) 地址' } };
  const configured = kind === 'cloud' ? Boolean(appId && accessKey && speaker) : true;
  return {
    ok: true,
    value: {
      id, kind, vendor, endpoint, model, voiceId, resourceId, speaker, path, bodyTemplate,
      configured,
      hasAppId: Boolean(appId),
      appIdMasked: mask(appId),
      hasAccessKey: Boolean(accessKey),
      accessKeyMasked: mask(accessKey),
      // 兼容旧字段
      hasKey: Boolean(accessKey),
      keyMasked: mask(accessKey),
    },
  };
}

/** 选一个可用 provider：优先 active，其次 kind 偏好，最后第一个 configured。 */
export function pickVoiceProvider(providers = [], { activeId = '', preferKind = '' } = {}) {
  const list = (Array.isArray(providers) ? providers : []).filter((p) => p?.configured !== false && p?.endpoint);
  if (!list.length) return null;
  const active = list.find((p) => p.id === activeId);
  if (active) return active;
  if (preferKind) {
    const preferred = list.find((p) => p.kind === preferKind);
    if (preferred) return preferred;
  }
  return list[0];
}
