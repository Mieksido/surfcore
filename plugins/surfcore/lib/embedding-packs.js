// Embedding 包管理（插件侧）：下载/解压/安装/卸载/启动/停止/选择/云端配置。
// 权重和运行时都不在 SurfCore 本体；安装到 state/embedding-packs/。
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  embeddingPacksRoot, installPackFromDirectory, listEmbeddingPacks, normalizePackId,
  packDir, readPackManifest, safePackRelativePath, uninstallPack,
} from '../../../src/embedding-packs.js';
import { effectiveVectorMemoryConfig, embedTexts, normalizeVectorMemoryConfig, readVectorIndexMeta, resolveEmbeddingService, resolveVectorMemoryPaths } from '../../../src/vector-memory.js';
import { activeMemoryPaths } from '../../../src/character-persona.js';
import { STATE_DIR } from './paths.js';
import { readUnified, saveUnified } from './store.js';
import { consoleBase, consoleToken } from './bridge.js';

const ROOT = embeddingPacksRoot(STATE_DIR);
const QUARANTINE = path.join(STATE_DIR, '_quarantine', 'embedding-packs');
const JOBS = new Map();

function nowIso() { return new Date().toISOString(); }
function makeError(code, error, hint = '') {
  return { ok: false, code, error, hint };
}
function safeUnlink(file) {
  try { fs.rmSync(file, { recursive: true, force: true }); } catch {}
}

export function embeddingPackRoot() { return ROOT; }

function currentVectorConfig() {
  return normalizeVectorMemoryConfig(readUnified().config?.vectorMemory ?? {});
}

function updateVectorConfig(patch) {
  const current = readUnified().config?.vectorMemory ?? {};
  const saved = saveUnified({ vectorMemory: { ...current, ...patch } });
  return normalizeVectorMemoryConfig(saved.config?.vectorMemory ?? {});
}

function readCloudPackFile() {
  const file = path.join(packDir(ROOT, 'cloud'), 'config.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

const CLOUD_PROVIDER_IDS = new Set(['siliconflow', 'zhipu', 'alibaba', 'openai']);

function detectCloudProvider(endpoint = '', model = '') {
  const ep = String(endpoint || '').toLowerCase();
  const md = String(model || '').toLowerCase();
  if (ep.includes('siliconflow') || md.includes('bge-m3')) return 'siliconflow';
  if (ep.includes('bigmodel') || md.includes('embedding-3')) return 'zhipu';
  if (ep.includes('openai.com') || md.includes('text-embedding-3')) return 'openai';
  if (ep.includes('dashscope') || ep.includes('aliyuncs') || md.includes('text-embedding')) return 'alibaba';
  return 'siliconflow';
}

function normalizeCloudProvider(id) {
  const value = String(id || '').toLowerCase();
  return CLOUD_PROVIDER_IDS.has(value) ? value : '';
}

function cloudState(raw = {}) {
  const providers = {};
  if (raw && raw.providers && typeof raw.providers === 'object' && !Array.isArray(raw.providers)) {
    for (const [id, value] of Object.entries(raw.providers)) {
      const safe = normalizeCloudProvider(id);
      if (!safe || !value || typeof value !== 'object') continue;
      providers[safe] = {
        endpoint: String(value.endpoint ?? ''),
        model: String(value.model ?? ''),
        modelSpace: String(value.modelSpace ?? ''),
        allowRemote: value.allowRemote === true,
        apiKey: String(value.apiKey ?? ''),
        updatedAt: String(value.updatedAt ?? ''),
      };
    }
  } else if (raw && (raw.endpoint || raw.model || raw.modelSpace)) {
    // 旧格式：单份配置，按 endpoint/model 推断归属，激活它。
    const id = detectCloudProvider(raw.endpoint, raw.model);
    providers[id] = {
      endpoint: String(raw.endpoint ?? ''),
      model: String(raw.model ?? ''),
      modelSpace: String(raw.modelSpace ?? ''),
      allowRemote: raw.allowRemote === true,
      apiKey: String(raw.apiKey ?? ''),
      updatedAt: String(raw.updatedAt ?? ''),
    };
  }
  const active = normalizeCloudProvider(raw?.active) || Object.keys(providers)[0] || '';
  return { schema: 2, active, providers, updatedAt: String(raw?.updatedAt ?? '') };
}

function publicCloudProfile(profile = {}) {
  const apiKey = String(profile.apiKey ?? '');
  return {
    endpoint: String(profile.endpoint ?? ''),
    model: String(profile.model ?? ''),
    modelSpace: String(profile.modelSpace ?? ''),
    allowRemote: profile.allowRemote === true,
    hasKey: Boolean(apiKey),
    keyMasked: apiKey ? `${apiKey.slice(0, 3)}****${apiKey.slice(-2)}` : '',
    updatedAt: String(profile.updatedAt ?? ''),
  };
}

export function readCloudPackConfig() {
  const state = cloudState(readCloudPackFile());
  const active = state.active && state.providers[state.active] ? state.active : '';
  const profile = active ? publicCloudProfile(state.providers[active]) : publicCloudProfile({});
  return {
    ...profile,
    active,
    providers: Object.fromEntries(Object.entries(state.providers).map(([id, value]) => [id, publicCloudProfile(value)])),
  };
}

function cloudConfigFile() {
  const dir = packDir(ROOT, 'cloud');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'config.json');
}

function writeCloudState(state) {
  const file = cloudConfigFile();
  const next = { schema: 2, active: state.active || '', providers: state.providers, updatedAt: nowIso() };
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export function saveCloudPackConfig(input = {}) {
  const state = cloudState(readCloudPackFile());
  const provider = normalizeCloudProvider(input.provider)
    || state.active
    || detectCloudProvider(input.endpoint, input.model);
  const prev = state.providers[provider] || {};
  const apiKey = String(input.apiKey ?? '').trim() || String(prev.apiKey ?? '');
  const profile = {
    endpoint: String(input.endpoint ?? prev.endpoint ?? '').trim(),
    model: String(input.model ?? prev.model ?? 'BAAI/bge-m3').trim(),
    modelSpace: String(input.modelSpace ?? prev.modelSpace ?? 'bge-m3@1024-cloud-v1').trim(),
    allowRemote: input.allowRemote === true,
    apiKey,
    updatedAt: nowIso(),
  };
  state.providers[provider] = profile;
  const activate = input.activate !== false;
  if (activate) state.active = provider;
  writeCloudState(state);
  if (activate) {
    updateVectorConfig({
      provider: 'cloud',
      cloudModel: profile.model,
      cloudModelSpace: profile.modelSpace,
      packId: 'cloud',
    });
  }
  return { ok: true, config: readCloudPackConfig() };
}

export function activateCloudProvider(id) {
  const provider = normalizeCloudProvider(id);
  if (!provider) return makeError('pack.provider-invalid', '未知的云端服务商', '可用：siliconflow / zhipu / alibaba / openai');
  const state = cloudState(readCloudPackFile());
  const profile = state.providers[provider];
  if (!profile || !profile.endpoint || !profile.model || !profile.modelSpace) {
    return makeError('pack.provider-not-saved', '这个服务商还没保存配置', '先在当前 Tab 填好并点「保存这个服务商」');
  }
  if (!profile.apiKey) {
    return makeError('pack.provider-key-missing', '这个服务商还没保存 API Key', '填好 API Key 后再保存');
  }
  state.active = provider;
  writeCloudState(state);
  updateVectorConfig({
    provider: 'cloud',
    cloudModel: profile.model,
    cloudModelSpace: profile.modelSpace,
    packId: 'cloud',
  });
  return { ok: true, config: readCloudPackConfig() };
}

/** 仅服务端内部使用：返回包含 key 的云端 profile，供直连建索引。 */
export function getCloudProviderProfile(id) {
  const provider = normalizeCloudProvider(id);
  if (!provider) return null;
  const state = cloudState(readCloudPackFile());
  const profile = state.providers[provider];
  if (!profile) return null;
  return {
    id: provider,
    endpoint: profile.endpoint,
    model: profile.model,
    modelSpace: profile.modelSpace,
    allowRemote: profile.allowRemote,
    apiKey: profile.apiKey,
  };
}

function jobView(job) {
  return {
    id: job.id,
    state: job.state,
    phase: job.phase,
    downloadedBytes: job.downloadedBytes,
    totalBytes: job.totalBytes,
    progress: job.progress,
    error: job.error,
    hint: job.hint,
    packId: job.packId,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

export function getEmbeddingPackJob(id) {
  const job = JOBS.get(String(id ?? ''));
  return job ? jobView(job) : null;
}

function pruneJobs() {
  const cutoff = Date.now() - 30 * 60_000;
  for (const [id, job] of JOBS) {
    if (job.finishedAt && Date.parse(job.finishedAt) < cutoff) JOBS.delete(id);
  }
}

async function extractZip(zipFile, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const win = process.platform === 'win32';
  const code = win
    ? `Expand-Archive -LiteralPath '${zipFile.replaceAll("'", "''")}' -DestinationPath '${dest.replaceAll("'", "''")}' -Force`
    : '';
  const child = win
    ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', code], { stdio: 'ignore', windowsHide: true })
    : spawn('unzip', ['-o', '-q', zipFile, '-d', dest], { stdio: 'ignore' });
  const result = await new Promise((resolve) => child.on('exit', (code) => resolve(code)).on('error', () => resolve(-1)));
  if (result !== 0) throw new Error(`解压失败（exit ${result}）；请确认是 zip，或手动解压后选择目录`);
}

function findPackRoot(dir) {
  if (fs.existsSync(path.join(dir, 'pack.json'))) return dir;
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    if (fs.existsSync(path.join(child, 'pack.json'))) return child;
  }
  return '';
}

async function downloadFile(url, file, job) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000), redirect: 'follow' });
  } catch (error) {
    throw new Error(`下载失败：${error?.message ?? error}`);
  }
  if (!response.ok || !response.body) throw new Error(`下载失败：HTTP ${response.status}`);
  job.totalBytes = Number(response.headers.get('content-length')) || 0;
  job.downloadedBytes = 0;
  const stream = Readable.fromWeb(response.body);
  stream.on('data', (chunk) => {
    job.downloadedBytes += chunk.length;
    job.phase = 'downloading';
  });
  await pipeline(stream, fs.createWriteStream(file));
}

async function installFromJob(job, { source = '', url = '', overwrite = false }) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'embedding-pack-install-'));
  let sourceDir = '';
  job.progress = 5;
  try {
    if (source) {
      const abs = path.resolve(source);
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        job.phase = 'extracting';
        job.progress = 20;
        sourceDir = findPackRoot(abs);
        if (!sourceDir) throw new Error('目录里没有 pack.json');
      } else {
        job.phase = 'extracting';
        job.totalBytes = stat.size;
        job.progress = 20;
        const extracted = path.join(temp, 'extracted');
        await extractZip(abs, extracted);
        job.progress = 55;
        sourceDir = findPackRoot(extracted);
        if (!sourceDir) throw new Error('zip 里没有 pack.json');
      }
    } else if (url) {
      if (!/^https?:\/\//i.test(url)) throw new Error('只支持 http(s) 下载地址');
      const zipFile = path.join(temp, 'pack.zip');
      job.phase = 'downloading';
      job.progress = 10;
      await downloadFile(url, zipFile, job);
      job.phase = 'extracting';
      job.progress = 65;
      const extracted = path.join(temp, 'extracted');
      await extractZip(zipFile, extracted);
      job.progress = 75;
      sourceDir = findPackRoot(extracted);
      if (!sourceDir) throw new Error('zip 里没有 pack.json');
    } else {
      throw new Error('需要 path 或 url');
    }
    job.phase = 'verifying';
    job.progress = 85;
    const installed = await installPackFromDirectory(sourceDir, {
      root: ROOT, overwrite, quarantineDir: QUARANTINE, verify: true,
    });
    if (!installed.ok) throw Object.assign(new Error(installed.error), { code: installed.code, hint: installed.hint });
    job.packId = installed.id;
    job.phase = 'done';
    job.progress = 100;
    job.state = 'done';
    job.finishedAt = nowIso();
  } catch (error) {
    job.state = 'error';
    job.phase = 'error';
    job.error = String(error?.message ?? error);
    job.hint = String(error?.hint ?? '检查包路径/网络/磁盘空间后重试');
    job.finishedAt = nowIso();
  } finally {
    safeUnlink(temp);
  }
}

export function startEmbeddingPackInstall({ source = '', url = '', overwrite = false } = {}) {
  pruneJobs();
  if (!source && !url) return makeError('pack.source-missing', '缺少安装来源', '填本地 zip/目录路径，或下载地址');
  const job = {
    id: crypto.randomUUID(), state: 'running', phase: 'starting', downloadedBytes: 0, totalBytes: 0,
    error: '', hint: '', packId: '', startedAt: nowIso(), finishedAt: '',
  };
  JOBS.set(job.id, job);
  void installFromJob(job, { source, url, overwrite });
  return { ok: true, jobId: job.id, job: jobView(job) };
}

export function removeEmbeddingPack(id) {
  return uninstallPack(ROOT, id, { quarantineDir: QUARANTINE });
}

function runtimePidAlive() {
  const file = path.join(ROOT, 'runtime', 'service.pid');
  try {
    const pid = Number(fs.readFileSync(file, 'utf8').trim());
    if (!pid) return true;
    process.kill(pid, 0);
    return true;
  } catch {
    // 没有 pid 文件（外部服务）时不能据此判死；有文件但进程不在才是 stale。
    return !fs.existsSync(file);
  }
}

function serviceStatus(config) {
  try {
    const resolved = resolveEmbeddingService(effectiveVectorMemoryConfig(config));
    if (!runtimePidAlive()) {
      return {
        ok: false,
        code: 'vector.service-stale',
        error: 'discovery 还在，但 runtime 进程已退出',
        hint: '点「启动」重新拉起 runtime，或查看 service.log',
        url: resolved.url,
      };
    }
    return { ok: true, source: resolved.source, url: resolved.url };
  } catch (error) {
    return { ok: false, code: error?.code ?? 'vector.service-missing', error: String(error?.message ?? error), hint: String(error?.hint ?? '启动 Embedding 运行时，或安装模型包') };
  }
}

export function embeddingPacksStatus() {
  const config = currentVectorConfig();
  const paths = resolveVectorMemoryPaths(activeMemoryPaths().dir);
  const packs = listEmbeddingPacks(ROOT).map((pack) => {
    if (pack.kind !== 'model' || !pack.valid) return pack;
    const index = readVectorIndexMeta(paths, pack.modelSpace);
    return { ...pack, indexReady: Boolean(index), indexed: index?.manifest.count ?? 0 };
  });
  const valid = packs.filter((pack) => pack.valid);
  const runtime = valid.find((pack) => pack.kind === 'runtime') ?? null;
  const models = valid.filter((pack) => pack.kind === 'model');
  const cloud = valid.find((pack) => pack.kind === 'cloud') ?? null;
  const selected = String(config.packId ?? '');
  const service = serviceStatus(config);
  const cloudConfig = readCloudPackConfig();
  const cloudProviders = Object.fromEntries(Object.entries(cloudConfig.providers || {}).map(([id, profile]) => {
    const index = readVectorIndexMeta(paths, profile.modelSpace);
    return [id, { ...profile, id, indexReady: Boolean(index), indexed: index?.manifest.count ?? 0 }];
  }));
  return {
    ok: true,
    installed: Boolean(runtime || models.length || cloud),
    root: ROOT,
    packs,
    runtime,
    models,
    cloud,
    selected,
    config: {
      provider: config.provider,
      model: config.model,
      modelSpace: config.modelSpace,
      packId: selected,
    },
    cloudConfig: { ...cloudConfig, providers: cloudProviders },
    service,
    hint: !runtime && !models.length && !cloud
      ? '还没有安装 Embedding 包。先装运行时 + 至少一个模型包（或用云端包）。'
      : (!runtime ? '还没有装运行时包；模型包下载完也不能启动。' : ''),
  };
}

export function openEmbeddingShare() {
  const config = currentVectorConfig();
  const url = String(config.packShareUrl ?? '').trim();
  if (!url) return makeError('pack.share-missing', '还没有配置网盘链接', '展开「高级」填入网盘链接，或设置 vectorMemory.packShareUrl');
  if (!/^https?:\/\//i.test(url)) return makeError('pack.share-invalid', '网盘链接必须是 http(s)', '检查链接格式');
  if (process.platform !== 'win32') {
    return { ok: false, code: 'pack.open-unsupported', error: '当前系统不支持自动打开浏览器', hint: `手动打开：${url}`, url };
  }
  try {
    spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return { ok: true, url };
  } catch (error) {
    return { ok: false, code: 'pack.open-failed', error: `打开浏览器失败：${String(error?.message ?? error).slice(0, 120)}`, hint: `手动打开：${url}`, url };
  }
}

export function selectEmbeddingPack(id) {
  const safe = normalizePackId(id);
  if (!safe) return makeError('pack.id-invalid', '包 id 非法', '刷新列表后重试');
  const dir = packDir(ROOT, safe);
  const result = readPackManifest(dir, { expectedId: safe });
  if (!result.ok) return makeError(result.errors[0]?.code ?? 'pack.manifest-invalid', result.errors[0]?.error ?? 'pack.json 无效', '重新安装这个包');
  const manifest = result.manifest;
  if (manifest.kind === 'runtime') return makeError('pack.select-kind-invalid', '运行时包不能作为记忆模型', '选择 model 或 cloud 包');
  const patch = manifest.kind === 'cloud'
    ? { provider: 'cloud', cloudModel: manifest.model || manifest.config?.model || 'BAAI/bge-m3', cloudModelSpace: manifest.modelSpace || manifest.config?.modelSpace || 'bge-m3@1024-cloud-v1', packId: safe }
    : { provider: 'local', model: manifest.model, modelSpace: manifest.modelSpace, packId: safe };
  const config = updateVectorConfig(patch);
  const effective = effectiveVectorMemoryConfig(config);
  const index = readVectorIndexMeta(resolveVectorMemoryPaths(activeMemoryPaths().dir), effective.modelSpace);
  return { ok: true, id: safe, config, needsIndex: !index, status: embeddingPacksStatus() };
}

const OLLAMA_TAGS = {
  'bge-small-zh-v1.5': 'bge-small-zh-v1.5:latest',
  'qwen3-embedding-0.6b': 'qwen3-embedding:0.6b',
  'bge-m3': 'bge-m3:latest',
};

function ollamaTagFor(manifest) {
  return String(manifest.ollamaTag || OLLAMA_TAGS[manifest.model] || OLLAMA_TAGS[manifest.id] || `${manifest.model || manifest.id}:latest`);
}

function runtimeOllamaExe() {
  const runtime = listEmbeddingPacks(ROOT).find((pack) => pack.valid && pack.kind === 'runtime');
  if (!runtime) return null;
  const exe = path.join(runtime.path, 'ollama.exe');
  return fs.existsSync(exe) ? { runtime, exe, models: path.join(runtime.path, 'ollama-models') } : null;
}

/** 把 model 包的 GGUF 注册进 runtime 自带的 Ollama（启动 runtime 之后调用）。 */
async function registerModelWithBundledOllama(manifest) {
  const runtime = runtimeOllamaExe();
  if (!runtime) return { id: manifest.id, ok: false, code: 'pack.runtime-ollama-missing', error: '运行时包没有 ollama.exe', hint: '安装自包含 runtime 包后再启动' };
  const modelFile = (manifest.files ?? []).find((file) => /\.gguf$/i.test(file.path));
  if (!modelFile) return { id: manifest.id, ok: false, code: 'pack.model-file-missing', error: '模型包没有 .gguf 文件', hint: '重新导出模型包' };
  const modelPath = path.join(packDir(ROOT, manifest.id), ...modelFile.path.split('/'));
  if (!fs.existsSync(modelPath)) return { id: manifest.id, ok: false, code: 'pack.model-file-missing', error: '模型文件不存在', hint: '重新安装模型包' };
  fs.mkdirSync(runtime.models, { recursive: true });
  const modelfile = path.join(runtime.runtime.path, `.create-${manifest.id}.Modelfile`);
  fs.writeFileSync(modelfile, `FROM "${modelPath.replaceAll('\\', '\\\\')}"\n`, { encoding: 'utf8', mode: 0o600 });
  const tag = ollamaTagFor(manifest);
  try {
    const child = spawn(runtime.exe, ['create', tag, '-f', modelfile], {
      cwd: runtime.runtime.path,
      env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11435', OLLAMA_MODELS: runtime.models },
      stdio: 'ignore', windowsHide: true,
    });
    const code = await new Promise((resolve) => child.on('exit', (value) => resolve(value)).on('error', () => resolve(-1)));
    if (code !== 0) return { id: manifest.id, ok: false, code: 'pack.model-register-failed', error: `ollama create 退出码 ${code}`, hint: '查看运行时日志；模型文件可能不是有效 GGUF' };
    return { id: manifest.id, ok: true, tag };
  } finally {
    try { fs.rmSync(modelfile, { force: true }); } catch {}
  }
}

async function registerInstalledModels({ only = '' } = {}) {
  let models = listEmbeddingPacks(ROOT).filter((pack) => pack.valid && pack.kind === 'model');
  if (only) models = models.filter((pack) => pack.id === only);
  const results = [];
  for (const model of models) {
    const read = readPackManifest(model.path, { expectedId: model.id });
    if (!read.ok) { results.push({ id: model.id, ok: false, code: 'pack.manifest-invalid' }); continue; }
    results.push(await registerModelWithBundledOllama(read.manifest));
  }
  return results;
}

/** 把已安装的所有本地模型注册进 runtime 自带 Ollama；多模型建索引前调用。 */
export async function registerAllInstalledModels() {
  return registerInstalledModels();
}

function readPid() {
  try { return Number(fs.readFileSync(path.join(ROOT, 'runtime', '.runtime-pid'), 'utf8').trim()) || 0; } catch { return 0; }
}

function writePid(pid) {
  try {
    fs.mkdirSync(path.join(ROOT, 'runtime'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'runtime', '.runtime-pid'), String(pid), { encoding: 'utf8', mode: 0o600 });
  } catch {}
}

function clearPid() {
  try { fs.rmSync(path.join(ROOT, 'runtime', '.runtime-pid'), { force: true }); } catch {}
}

function runtimeEnv() {
  const state = cloudState(readCloudPackFile());
  const config = state.active ? (state.providers[state.active] || {}) : {};
  const env = { ...process.env };
  const endpoint = String(config.endpoint ?? '');
  const model = String(config.model ?? '');
  const space = String(config.modelSpace ?? '');
  const apiKey = String(config.apiKey ?? '');
  if (endpoint) env.SURFCORE_EMBED_CLOUD_ENDPOINT = endpoint;
  if (model) env.SURFCORE_EMBED_CLOUD_MODEL = model;
  if (space) env.SURFCORE_EMBED_CLOUD_SPACE = space;
  if (apiKey) env.SURFCORE_EMBED_API_KEY = apiKey;
  if (config.allowRemote === true) env.SURFCORE_EMBED_ALLOW_REMOTE = 'true';
  // 直连 js 入口时没有 run.bat 替我们设置这些；显式给上，保证 discovery/端口一致。
  env.SURFCORE_EMBED_DISCOVERY ||= path.join(STATE_DIR, 'embedding-service.json');
  env.SURFCORE_EMBED_PORT ||= '18765';
  env.SURFCORE_EMBED_DEFAULT_MODEL ||= 'bge-m3';
  // 云端 embedding 用量回传桥接账本；token 只走环境变量，不落日志。
  try {
    const token = consoleToken();
    if (token) {
      env.SURFCORE_LEDGER_URL = `${consoleBase()}/api/tokens/external`;
      env.SURFCORE_LEDGER_TOKEN = token;
    }
  } catch {}
  // 2026-11-06 真机事故：runtime 包的 run.bat 里是裸 `node service.mjs`。
  // zip 用户机器上 node 通常**不在系统 PATH**（DSH 用自带 node 跑，不会帮子进程加 PATH），
  // 于是 bat 里第一行就报「'node' 不是内部或外部命令」→ 服务秒退 → 30 秒后前端只看到
  // 「运行时启动超时，没有写 discovery」，用户完全看不到真实原因。
  // 这里做两件事：① 把当前运行的 node 目录补进子进程 PATH；② 额外给一个显式入口
  // SURFCORE_NODE，让包脚本可以完全不依赖 PATH。
  try {
    env.SURFCORE_NODE = process.execPath;
    const nodeDir = path.dirname(process.execPath);
    const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'Path';
    const current = String(env[pathKey] ?? '');
    if (nodeDir && !current.split(path.delimiter).includes(nodeDir)) {
      env[pathKey] = current ? `${nodeDir}${path.delimiter}${current}` : nodeDir;
    }
  } catch {}
  return env;
}

export async function startEmbeddingRuntime() {
  const manifests = listEmbeddingPacks(ROOT).filter((pack) => pack.valid && pack.kind === 'runtime');
  const runtime = manifests[0];
  if (!runtime) return makeError('pack.runtime-missing', '还没有安装 Embedding 运行时包', '先安装 runtime 包');
  const result = readPackManifest(runtime.path, { expectedId: runtime.id });
  if (!result.ok) return makeError('pack.manifest-invalid', result.errors[0]?.error ?? '运行时 pack.json 无效', '重新安装运行时包');
  const entry = safePackRelativePath(result.manifest.entry || 'run.bat');
  if (!entry) return makeError('pack.runtime-entry-invalid', '运行时包 entry 非法', '检查 pack.json');
  const entryPath = path.join(runtime.path, ...entry.split('/'));
  if (!fs.existsSync(entryPath)) return makeError('pack.runtime-entry-missing', `运行时入口不存在：${entry}`, '重新安装运行时包');
  const config = currentVectorConfig();
  const registrationFor = async () => (config.provider === 'cloud' ? [] : await registerInstalledModels({ only: config.packId }));
  // 用户可能已经手工启动过服务；discovery 在就不重复拉进程，但仍补注册当前模型。
  if (serviceStatus(config).ok) {
    const registration = await registrationFor();
    const verification = await testEmbeddingPack();
    return { ok: true, already: true, registration, verified: verification.ok, verification, status: embeddingPacksStatus() };
  }
  const existing = readPid();
  if (existing) {
    try {
      process.kill(existing, 0);
      const registration = await registrationFor();
      const verification = await testEmbeddingPack();
      return { ok: true, already: true, pid: existing, registration, verified: verification.ok, verification, status: embeddingPacksStatus() };
    } catch { clearPid(); }
  }
  const isBatch = entry.toLowerCase().endsWith('.bat') || entry.toLowerCase().endsWith('.cmd');
  // 批处理会先起 cmd 控制台；Windows 上 detached 会把它变成可见的 Windows Terminal 标签。
  // runtime 包通常同时带 js 入口，优先直连 node，既少一层 cmd，也彻底不依赖 PATH。
  const directEntry = isBatch
    ? ['embedding-service.mjs', 'service.mjs', 'server.mjs'].map((name) => path.join(runtime.path, name)).find((file) => fs.existsSync(file))
    : '';
  const child = directEntry
    ? spawn(process.execPath, [directEntry], {
      cwd: runtime.path, env: runtimeEnv(), detached: true, stdio: 'ignore', windowsHide: true,
    })
    : spawn(entryPath, [], {
      cwd: runtime.path, env: runtimeEnv(), detached: false, stdio: 'ignore', windowsHide: true, shell: isBatch,
    });
  child.unref();
  writePid(child.pid);
  const discovery = path.join(STATE_DIR, 'embedding-service.json');
  const until = Date.now() + 30_000;
  while (!fs.existsSync(discovery) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!fs.existsSync(discovery)) {
    // 失败必须可行动：把 service.log 最后几行带进错误里（bat 写的是控制台编码，
    // 中文可能是乱码，但「'node' 不是内部或外部命令」这种关键词仍然一眼能认出来）。
    let tail = '';
    try {
      const logPath = path.join(runtime.path, 'service.log');
      tail = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-3).join(' | ');
    } catch {}
    return {
      ok: false,
      code: 'pack.runtime-start-timeout',
      error: tail ? `运行时启动超时，没有写 discovery（service.log：${tail.slice(0, 300)}）` : '运行时启动超时，没有写 discovery',
      hint: `查看 ${path.join(runtime.path, 'service.log')}；常见原因：脚本里的 node 不在 PATH（新版已自动注入）、端口被占、模型包损坏`,
    };
  }
  const registration = await registrationFor();
  const verification = await testEmbeddingPack();
  return { ok: true, pid: child.pid, id: runtime.id, registration, verified: verification.ok, verification, status: embeddingPacksStatus() };
}

async function runStopScript(runtime) {
  const result = readPackManifest(runtime.path, { expectedId: runtime.id });
  const stop = safePackRelativePath(result.ok ? (result.manifest.config?.stop || 'stop.bat') : 'stop.bat');
  if (!stop) return false;
  const file = path.join(runtime.path, ...stop.split('/'));
  if (!fs.existsSync(file)) return false;
  const child = spawn(file, [], { cwd: runtime.path, stdio: 'ignore', windowsHide: true, shell: true });
  await new Promise((resolve) => child.on('exit', resolve).on('error', resolve));
  return true;
}

export async function stopEmbeddingRuntime() {
  const runtime = listEmbeddingPacks(ROOT).find((pack) => pack.valid && pack.kind === 'runtime');
  if (runtime) await runStopScript(runtime);
  const pid = readPid();
  if (pid) {
    try {
      const child = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      await new Promise((resolve) => child.on('exit', resolve).on('error', resolve));
    } catch {}
    clearPid();
  }
  // taskkill /F 不会触发 Node 的清理钩子；停止后主动删 discovery，避免界面显示“还在”。
  try { fs.rmSync(path.join(STATE_DIR, 'embedding-service.json'), { force: true }); } catch {}
  return { ok: true, stopped: Boolean(pid), status: embeddingPacksStatus() };
}

export async function testEmbeddingPack() {
  const effective = effectiveVectorMemoryConfig(currentVectorConfig());
  const status = serviceStatus(effective);
  if (!status.ok) return { ok: false, ...status };
  const startedAt = Date.now();
  try {
    // 不能只查 /health：进程活着不代表模型能编码。这里真的跑一条短文本。
    const result = await embedTexts({
      config: { ...effective, timeoutMs: Math.max(Number(effective.timeoutMs) || 0, 60_000) },
      texts: ['SurfCore embedding self-test'],
    });
    const vector = result.vectors?.[0];
    if (!vector?.length) return makeError('vector.self-test-failed', 'Embedding 自检没有返回向量', '查看 runtime service.log');
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    return {
      ok: true,
      selfTest: true,
      model: effective.model,
      modelSpace: result.modelSpace || effective.modelSpace,
      dimension: result.dimension || vector.length,
      norm,
      latencyMs: Date.now() - startedAt,
      service: status,
    };
  } catch (error) {
    return makeError(
      error?.code ?? 'vector.self-test-failed',
      `Embedding 自检失败：${String(error?.message ?? error).slice(0, 180)}`,
      String(error?.hint ?? '查看 runtime service.log；确认模型/端口/云端 key 正常'),
    );
  }
}
