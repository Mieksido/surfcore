/**
 * 语音模型运行时（内核 voice）
 * ============================================================================
 * 模型记录只保存：id/kind/voiceId/label、artifactDir、runtime(端点/传输/中性命令)。
 * 不保存扩展包布局、不认扩展代码；本地运行时按中性 runtime 描述装载。
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { createHttpVoiceTransport } from './tts-http.js';
import { inspectModelArtifact } from './model-store.js';

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const normalizeModelId = (id) => String(id ?? '').trim().toLowerCase().replace(/^voice[-_]/, '');
const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function ensureRuntimeConfig(root) {
  const config = path.join(root, 'config.toml');
  const example = path.join(root, 'config.example.toml');
  if (!fs.existsSync(config) && fs.existsSync(example)) {
    try { fs.copyFileSync(example, config); } catch { /* 启动失败由端口判断 */ }
  }
}

export function normalizeModelRecord(raw = {}) {
  const id = clean(raw.id ?? raw.modelId, 64);
  if (!id) return { ok: false, code: 'voice-model.no-id', error: '模型缺少 id' };
  const kind = raw.kind === 'cloud' ? 'cloud' : 'local';
  const rt = raw.runtime && typeof raw.runtime === 'object' ? raw.runtime : {};
  return {
    ok: true,
    value: {
      id,
      kind,
      voiceId: clean(raw.voiceId, 80),
      label: clean(raw.label ?? id, 80),
      artifactDir: clean(raw.artifactDir, 500),
      runtime: {
        endpoint: clean(rt.endpoint ?? raw.endpoint, 300).replace(/\/+$/, ''),
        transport: 'http',
        path: clean(rt.path, 300) || '/tts',
        bodyTemplate: rt.bodyTemplate && typeof rt.bodyTemplate === 'object' && !Array.isArray(rt.bodyTemplate)
          ? Object.fromEntries(Object.entries(rt.bodyTemplate).slice(0, 40).map(([k, v]) => [clean(k, 40), typeof v === 'number' || typeof v === 'boolean' ? v : clean(v, 200)]))
          : {},
        command: clean(rt.command, 300),
        entry: clean(rt.entry, 300),
        args: Array.isArray(rt.args) ? rt.args.map((a) => clean(a, 300)).filter(Boolean).slice(0, 32) : [],
        cwd: clean(rt.cwd, 500),
        shell: rt.shell === true,
        inferred: rt.inferred === true,
        stopCommand: clean(rt.stopCommand, 300),
        commandSha256: clean(rt.commandSha256, 64),
        preStart: rt.preStart && typeof rt.preStart === 'object' ? {
          command: clean(rt.preStart.command, 300),
          args: Array.isArray(rt.preStart.args) ? rt.preStart.args.map((a) => clean(a, 300)).filter(Boolean).slice(0, 32) : [],
          cwd: clean(rt.preStart.cwd, 500),
          endpoint: clean(rt.preStart.endpoint, 300).replace(/\/+$/, ''),
          env: rt.preStart.env && typeof rt.preStart.env === 'object'
            ? Object.fromEntries(Object.entries(rt.preStart.env).map(([k, v]) => [clean(k, 80), String(v ?? '')]))
            : {},
          commandSha256: clean(rt.preStart.commandSha256, 64),
        } : null,
      },
    },
  };
}

export function readModelConfig(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
    const models = {};
    for (const [id, item] of Object.entries(raw?.models ?? {})) {
      const n = normalizeModelRecord({ ...item, id: item?.id ?? id });
      if (n.ok) models[n.value.id] = n.value;
    }
    return { ok: true, active: String(raw?.active ?? ''), models };
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: true, active: '', models: {}, missing: true };
    return { ok: false, code: 'voice-model.bad-config', error: `模型配置读不出来：${error?.message ?? error}` };
  }
}

export function writeModelConfig({ file, config } = {}) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ version: 1, active: config.active ?? '', models: config.models ?? {} }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, target);
  return { ok: true, file: target };
}

export function upsertModelRecord({ file, model } = {}) {
  const n = normalizeModelRecord(model ?? {});
  if (!n.ok) return n;
  const cfg = readModelConfig(file);
  if (!cfg.ok) return cfg;
  cfg.models[n.value.id] = n.value;
  writeModelConfig({ file, config: cfg });
  return { ok: true, model: n.value };
}

export function selectModel({ file, modelId } = {}) {
  const cfg = readModelConfig(file);
  if (!cfg.ok) return cfg;
  const id = String(modelId ?? '');
  if (!cfg.models[id]) return { ok: false, code: 'voice-model.unknown', error: `没有这个模型：${id}` };
  cfg.active = id;
  writeModelConfig({ file, config: cfg });
  return { ok: true, active: id };
}

export function relinkModel({ file, modelId, dir } = {}) {
  const cfg = readModelConfig(file);
  if (!cfg.ok) return cfg;
  const id = String(modelId ?? '');
  const model = cfg.models[id];
  if (!model) return { ok: false, code: 'voice-model.unknown', error: `没有这个模型：${id}` };
  const inspected = inspectModelArtifact(String(dir ?? ''), { requireRuntime: false });
  if (!inspected.ok) return inspected;
  if (inspected.manifest.model && normalizeModelId(inspected.manifest.model) !== normalizeModelId(id)) {
    return { ok: false, code: 'voice-model.relink-mismatch', error: `目录里的模型是 ${inspected.manifest.model}，不是 ${id}` };
  }
  model.artifactDir = path.resolve(String(dir));
  if (inspected.manifest.runtime) model.runtime = inspected.manifest.runtime;
  writeModelConfig({ file, config: cfg });
  return { ok: true, modelId: id, artifactDir: model.artifactDir };
}

export function endpointPort(endpoint) {
  try {
    const u = new URL(String(endpoint ?? ''));
    return Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
  } catch { return 0; }
}

export function probeEndpoint(endpoint, { host = '127.0.0.1', timeoutMs = 400 } = {}) {
  const port = endpointPort(endpoint);
  if (!port) return Promise.resolve(false);
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => { try { socket.destroy(); } catch {} resolve(ok); };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

export function modelState(model, { loaded = false } = {}) {
  if (loaded) return 'loaded';
  try {
    if (model.artifactDir && fs.statSync(model.artifactDir).isDirectory()) return 'idle';
  } catch { /* 不存在 */ }
  return 'missing';
}

export function createModelRuntime({
  file,
  spawnImpl = nodeSpawn,
  probeImpl = probeEndpoint,
  now = () => Date.now(),
} = {}) {
  if (!file) throw new Error('模型运行时需要 config file');
  const children = new Map();
  const auxChildren = new Map();

  async function status() {
    const cfg = readModelConfig(file);
    if (!cfg.ok) return cfg;
    const models = [];
    for (const model of Object.values(cfg.models)) {
      const loaded = model.runtime.endpoint ? await probeImpl(model.runtime.endpoint) : false;
      models.push({
        modelId: model.id,
        kind: model.kind,
        voiceId: model.voiceId,
        label: model.label,
        state: modelState(model, { loaded }),
        available: loaded,
      });
    }
    return { ok: true, active: cfg.active, models };
  }

  async function waitUp(endpoint, want, timeoutMs = 60000) {
    const deadline = now() + Math.max(1000, Number(timeoutMs) || 60000);
    while (now() < deadline) {
      if ((await probeImpl(endpoint)) === want) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }

  async function load(modelId) {
    const cfg = readModelConfig(file);
    if (!cfg.ok) return cfg;
    const model = cfg.models[String(modelId ?? '')];
    if (!model) return { ok: false, code: 'voice-model.unknown', error: `没有这个模型：${modelId}` };
    if (model.runtime.endpoint && await probeImpl(model.runtime.endpoint)) return { ok: true, modelId: model.id, state: 'loaded' };
    if (model.runtime.endpoint && !model.runtime.command) return { ok: false, code: 'voice-model.service-down', error: '模型服务没有在运行', hint: `先启动 ${model.runtime.endpoint}` };
    if (!model.runtime.command) return { ok: false, code: 'voice-model.no-runtime', error: '模型没有可启动的运行时', hint: '配置中性 runtime 或手动启动服务' };
    const base = path.resolve(model.artifactDir || process.cwd());
    const interpreter = /^(node|node\.exe|python|python\.exe|python3|py)$/i.test(model.runtime.command);
    const executable = interpreter ? model.runtime.command : path.resolve(base, model.runtime.command);
    if (!interpreter && !executable.startsWith(`${base}${path.sep}`)) return { ok: false, code: 'voice-model.bad-command', error: 'runtime.command 越出模型工件目录' };
    if (interpreter) {
      const entry = path.resolve(base, model.runtime.entry || '');
      if (!model.runtime.entry || !entry.startsWith(`${base}${path.sep}`)) return { ok: false, code: 'voice-model.bad-entry', error: 'runtime.entry 越出模型工件目录' };
    }
    const hashTarget = interpreter ? path.resolve(base, model.runtime.entry || '') : executable;
    if (model.runtime.commandSha256) {
      try {
        if (sha256File(hashTarget) !== model.runtime.commandSha256) return { ok: false, code: 'voice-model.command-changed', error: 'runtime 启动文件发生变化，拒绝启动' };
      } catch {
        return { ok: false, code: 'voice-model.command-missing', error: 'runtime 启动文件不存在' };
      }
    }
    const args = [...model.runtime.args];
    if (interpreter && model.runtime.entry && !args.includes(model.runtime.entry)) args.unshift(model.runtime.entry);
    ensureRuntimeConfig(base);
    const pre = model.runtime.preStart;
    if (pre?.command && pre.endpoint && !(await probeImpl(pre.endpoint))) {
      const preBase = path.resolve(base, pre.cwd || '.');
      const preExe = path.resolve(base, pre.command);
      if (!preExe.startsWith(`${base}${path.sep}`)) return { ok: false, code: 'voice-model.bad-command', error: 'runtime.preStart 越出模型工件目录' };
      if (pre.commandSha256) {
        try { if (sha256File(preExe) !== pre.commandSha256) return { ok: false, code: 'voice-model.command-changed', error: 'runtime.preStart 文件发生变化，拒绝启动' }; }
        catch { return { ok: false, code: 'voice-model.command-missing', error: 'runtime.preStart 文件不存在' }; }
      }
      try {
        const aux = spawnImpl(preExe, pre.args ?? [], {
          cwd: preBase, shell: false, detached: false, stdio: 'ignore', windowsHide: true,
          env: { ...process.env, ...(pre.env ?? {}) },
        });
        auxChildren.set(model.id, aux);
      } catch (error) {
        return { ok: false, code: 'voice-model.preload-failed', error: `辅助运行时启动失败：${error?.message ?? error}` };
      }
      const preUp = await waitUp(pre.endpoint, true, 60000);
      if (!preUp) return { ok: false, code: 'voice-model.preload-timeout', error: `辅助运行时未就绪：${pre.endpoint}` };
    }
    try {
      const child = spawnImpl(executable, args, {
        cwd: path.resolve(base, model.runtime.cwd || '.'),
        shell: model.runtime.shell === true, detached: false, stdio: 'ignore', windowsHide: true,
      });
      children.set(model.id, child);
    } catch (error) {
      return { ok: false, code: 'voice-model.spawn-failed', error: String(error?.message ?? error) };
    }
    const up = await waitUp(model.runtime.endpoint, true);
    return up
      ? { ok: true, modelId: model.id, state: 'loaded' }
      : { ok: false, code: 'voice-model.load-timeout', error: `模型装载超时：${model.runtime.endpoint}` };
  }

  async function unload(modelId) {
    const cfg = readModelConfig(file);
    if (!cfg.ok) return cfg;
    const model = cfg.models[String(modelId ?? '')];
    if (!model) return { ok: false, code: 'voice-model.unknown', error: `没有这个模型：${modelId}` };
    if (!(model.runtime.endpoint && await probeImpl(model.runtime.endpoint))) return { ok: true, modelId: model.id, state: 'idle' };
    const child = children.get(model.id);
    if (model.runtime.stopCommand) {
      const stop = path.resolve(path.resolve(model.artifactDir || process.cwd()), model.runtime.stopCommand);
      try { spawnImpl(stop, [], { cwd: path.dirname(stop), shell: true, stdio: 'ignore', windowsHide: true }); } catch { /* 端口判断兜底 */ }
    }
    if (child && typeof child.kill === 'function') {
      try { child.kill(); } catch { /* 失败由端口判断 */ }
    }
    const aux = auxChildren.get(model.id);
    if (aux && typeof aux.kill === 'function') {
      try { aux.kill(); } catch { /* 失败由端口判断 */ }
      auxChildren.delete(model.id);
    }
    const down = await waitUp(model.runtime.endpoint, false, 15000);
    return down ? { ok: true, modelId: model.id, state: 'idle' } : { ok: false, code: 'voice-model.unload-timeout', error: '模型仍在监听' };
  }

  async function synthesize({ modelId, text = '', voiceId = '', noCache = false } = {}) {
    const cfg = readModelConfig(file);
    if (!cfg.ok) return cfg;
    const model = cfg.models[String(modelId ?? '')];
    if (!model) return { ok: false, code: 'voice-model.unknown', error: `没有这个模型：${modelId}` };
    if (!model.runtime.endpoint) return { ok: false, code: 'voice-model.no-endpoint', error: '模型没有端点' };
    const bodyTemplate = noCache ? { ...(model.runtime.bodyTemplate ?? {}), cache: false } : model.runtime.bodyTemplate;
    return createHttpVoiceTransport({
      endpoint: model.runtime.endpoint,
      path: model.runtime.path,
      bodyTemplate,
    }).synthesize({ text, voiceId: voiceId || model.voiceId });
  }

  return { status, load, unload, synthesize, read: () => readModelConfig(file) };
}
