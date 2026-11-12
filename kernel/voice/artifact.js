/**
 * 语音模型工件 manifest（纯规则）
 * ============================================================================
 * 模型工件：声明 + 权重文件。它是通用工具，不区分新旧来源；
 * 启动方式/传输路径/请求体模板都由 manifest 声明，内核不猜。
 */
export const MODEL_ARTIFACT_KIND = 'surfcore-voice-model';
const MAX_PATH = 240;
const SHA256 = /^[a-f0-9]{64}$/i;
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);

export function safeModelPath(value) {
  const raw = String(value ?? '').replace(/\\/g, '/').trim();
  if (!raw || raw.length > MAX_PATH) return '';
  if (raw.startsWith('/') || /^[a-z]:/i.test(raw)) return '';
  const parts = raw.split('/');
  if (parts.some((p) => p === '..' || p === '.' || p === '')) return '';
  return parts.join('/');
}

function safeHttpPath(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 300 || !raw.startsWith('/') || raw.includes('..')) return '';
  return raw;
}

function normalizeTemplate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw).slice(0, 40)) {
    const key = clean(k, 40);
    if (!key) continue;
    if (typeof v === 'string') out[key] = clean(v, 200);
    else if (typeof v === 'number' || typeof v === 'boolean') out[key] = v;
  }
  return out;
}

function normalizeRuntime(raw) {
  if (!raw || typeof raw !== 'object') return { ok: true, value: null };
  const path = safeHttpPath(raw.path) || '/tts';
  const bodyTemplate = normalizeTemplate(raw.bodyTemplate);
  if (raw.kind === 'process' || raw.command) {
    const commandRaw = clean(raw.command, 300);
    if (!commandRaw) return { ok: false, error: { code: 'voice-model.bad-command', message: 'runtime.command 不能为空' } };
    const interpreter = /^(node|node\.exe|python|python\.exe|python3|py)$/i.test(commandRaw);
    const command = interpreter ? commandRaw : safeModelPath(commandRaw);
    const entry = safeModelPath(raw.entry) || (interpreter ? '' : command);
    if (!command) return { ok: false, error: { code: 'voice-model.bad-command', message: 'runtime.command 必须是工件内相对路径或受支持的解释器' } };
    if (interpreter && !entry) return { ok: false, error: { code: 'voice-model.bad-entry', message: '解释器 runtime 必须声明工件内 entry' } };
    const cwd = raw.cwd ? safeModelPath(raw.cwd) : '';
    if (raw.cwd && !cwd) return { ok: false, error: { code: 'voice-model.bad-cwd', message: 'runtime.cwd 必须是工件内的相对路径' } };
    return {
      ok: true,
      value: {
        kind: 'process', transport: 'http', command, entry, cwd,
        args: Array.isArray(raw.args) ? raw.args.map((a) => clean(a, 300)).filter(Boolean).slice(0, 32) : [],
        endpoint: clean(raw.endpoint, 300).replace(/\/+$/, ''),
        path, bodyTemplate,
      },
    };
  }
  return {
    ok: true,
    value: { kind: 'http', transport: 'http', endpoint: clean(raw.endpoint, 300).replace(/\/+$/, ''), path, bodyTemplate },
  };
}

function collectFiles(raw) {
  const out = [];
  const bad = [];
  for (const item of Array.isArray(raw?.files) ? raw.files : []) {
    if (!item || typeof item !== 'object') continue;
    if (!item.path) continue;
    const path = safeModelPath(item.path);
    const sha256 = clean(item.sha256, 64);
    if (!path) { bad.push(`路径不安全：${clean(item.path, 80)}`); continue; }
    if (!SHA256.test(sha256)) { bad.push(`哈希不合法：${path}`); continue; }
    out.push({ name: clean(item.name ?? path, 40), path, sha256: sha256.toLowerCase() });
  }
  return { files: out, bad };
}

export function normalizeModelManifest(raw = {}) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: { code: 'voice-model.not-object', message: 'manifest 不是对象' } };
  if (raw.kind && raw.kind !== MODEL_ARTIFACT_KIND) {
    return { ok: false, error: { code: 'voice-model.bad-kind', message: `模型工件类型不是 ${MODEL_ARTIFACT_KIND}` } };
  }
  const model = clean(raw.model, 64);
  const version = clean(raw.version, 32);
  const voiceId = clean(raw.voice?.id, 64);
  if (!model) return { ok: false, error: { code: 'voice-model.no-id', message: '缺少 model id' } };
  if (!version) return { ok: false, error: { code: 'voice-model.no-version', message: '缺少 version' } };
  if (!voiceId) return { ok: false, error: { code: 'voice-model.no-voice', message: '缺少 voice.id' } };
  const collected = collectFiles(raw);
  if (collected.bad.length) return { ok: false, error: { code: 'voice-model.bad-file', message: collected.bad[0] } };
  const runtime = normalizeRuntime(raw.runtime);
  if (!runtime.ok) return runtime;
  return { ok: true, value: { kind: MODEL_ARTIFACT_KIND, model, version, voiceId, files: collected.files, runtime: runtime.value } };
}

export function verifyModelFiles(manifest, observed = {}) {
  const missing = [];
  const mismatch = [];
  for (const file of manifest?.files ?? []) {
    const seen = observed[file.path];
    if (!seen) { missing.push(file.path); continue; }
    if (String(seen.sha256 ?? '').toLowerCase() !== file.sha256) mismatch.push(file.path);
  }
  const declared = new Set((manifest?.files ?? []).map((f) => f.path));
  const extra = Object.keys(observed ?? {}).filter((p) => !declared.has(p));
  return { ok: missing.length === 0 && mismatch.length === 0, missing, mismatch, extra };
}
