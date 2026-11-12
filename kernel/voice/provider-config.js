/**
 * 语音服务商配置（内核 voice）
 * ============================================================================
 * 保存 AppID/AccessKey/Resource ID/复刻 ID/endpoint，并把火山云配置真正写进
 * 模型工件的 config.toml / voices/<voiceId>/voice.json。
 * 公开响应只给掩码；写盘 0600。
 */
import fs from 'node:fs';
import path from 'node:path';
import { normalizeVoiceProvider } from './providers.js';

const DEFAULT_FILE = path.join('state', 'voice-providers.json');

function fileOf(file) { return path.resolve(file || DEFAULT_FILE); }

export function readVoiceProviders(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(fileOf(file), 'utf8'));
    return Array.isArray(raw) ? raw : (Array.isArray(raw?.providers) ? raw.providers : []);
  } catch { return []; }
}

function writeAll(file, list) {
  const target = fileOf(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ version: 1, providers: list }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, target);
}

export function publicProvider(p = {}) {
  const n = normalizeVoiceProvider(p);
  return n.ok ? n.value : { id: String(p.id ?? ''), kind: String(p.kind ?? ''), configured: false, error: n.error };
}

export function listVoiceProviders({ file } = {}) {
  return readVoiceProviders(file).map(publicProvider);
}

export function upsertVoiceProvider({ file, provider } = {}) {
  const list = readVoiceProviders(file);
  const existing = list.find((p) => String(p.id) === String(provider?.id ?? '')) ?? null;
  const merged = {
    ...existing,
    ...(provider ?? {}),
    appId: provider?.appId ?? existing?.appId ?? '',
    accessKey: provider?.accessKey ?? provider?.apiKey ?? provider?.key ?? existing?.accessKey ?? '',
    resourceId: provider?.resourceId ?? provider?.resource ?? existing?.resourceId ?? 'seed-icl-2.0',
    speaker: provider?.speaker ?? existing?.speaker ?? '',
    path: provider?.path ?? existing?.path ?? '/tts',
    bodyTemplate: provider?.bodyTemplate ?? existing?.bodyTemplate ?? {},
  };
  const n = normalizeVoiceProvider(merged);
  if (!n.ok) return { ok: false, error: n.error };
  const next = {
    id: n.value.id,
    kind: n.value.kind,
    vendor: n.value.vendor,
    endpoint: n.value.endpoint,
    model: n.value.model,
    voiceId: n.value.voiceId,
    appId: String(merged.appId ?? ''),
    accessKey: String(merged.accessKey ?? ''),
    resourceId: n.value.resourceId,
    speaker: n.value.speaker,
    path: n.value.path,
    bodyTemplate: n.value.bodyTemplate,
  };
  const idx = list.findIndex((p) => String(p.id) === next.id);
  if (idx >= 0) list[idx] = next; else list.push(next);
  writeAll(file, list);
  return { ok: true, provider: publicProvider(next), raw: next };
}

export function removeVoiceProvider({ file, id } = {}) {
  const list = readVoiceProviders(file);
  const next = list.filter((p) => String(p.id) !== String(id ?? ''));
  if (next.length === list.length) return { ok: false, error: { code: 'voice-provider.not-found', message: `没有这个 provider：${id}` } };
  writeAll(file, next);
  return { ok: true, removed: String(id ?? '') };
}

export function resolveVoiceProvider({ file, id } = {}) {
  return readVoiceProviders(file).find((p) => String(p.id) === String(id ?? '')) ?? null;
}

function tomlString(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function setTomlValue(text, key, value) {
  const line = `${key} = "${tomlString(value)}"`;
  const re = new RegExp(`^(\\s*${key}\\s*=\\s*)"[^"]*"`, 'm');
  if (re.test(text)) return text.replace(re, line);
  return `${text.replace(/\s*$/, '')}\n${line}\n`;
}

/** 把火山云配置真正写进模型工件；不返回任何 secret。 */
export function applyCloudProviderConfig({ artifactDir, provider, voiceId } = {}) {
  const root = path.resolve(String(artifactDir ?? ''));
  if (!root || !fs.existsSync(root)) {
    return { ok: false, code: 'voice-provider.model-missing', error: '模型目录不存在', hint: '先导入云端模型或重新定位' };
  }
  const configFile = path.join(root, 'config.toml');
  try {
    let text = fs.existsSync(configFile)
      ? fs.readFileSync(configFile, 'utf8')
      : (fs.existsSync(path.join(root, 'config.example.toml')) ? fs.readFileSync(path.join(root, 'config.example.toml'), 'utf8') : '');
    text = setTomlValue(text, 'cloud_app_id', provider.appId ?? '');
    text = setTomlValue(text, 'cloud_access_key', provider.accessKey ?? '');
    text = setTomlValue(text, 'cloud_resource', provider.resourceId || 'seed-icl-2.0');
    fs.writeFileSync(configFile, text, 'utf8');
  } catch (error) {
    return { ok: false, code: 'voice-provider.config-write-failed', error: `写 config.toml 失败：${error?.message ?? error}` };
  }

  const vid = String(voiceId || provider.voiceId || 'age12-cloud');
  const voiceDir = path.join(root, 'voices', vid);
  const voiceFile = path.join(voiceDir, 'voice.json');
  try {
    const current = fs.existsSync(voiceFile) ? JSON.parse(fs.readFileSync(voiceFile, 'utf8')) : {};
    current.engine = current.engine || 'cloud';
    current.speaker = String(provider.speaker ?? '');
    fs.mkdirSync(voiceDir, { recursive: true });
    fs.writeFileSync(voiceFile, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
  } catch (error) {
    return { ok: false, code: 'voice-provider.voice-write-failed', error: `写 voice.json 失败：${error?.message ?? error}` };
  }
  return { ok: true, configFile, voiceFile };
}
