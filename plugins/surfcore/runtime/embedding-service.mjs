// SurfCore Embedding Runtime（Node 版，无 Python/Ollama 之外依赖）
// 对 SurfCore 暴露 /health /v1/models /v1/embeddings /v1/status；
// 本地走 Ollama /api/embed，云端走 OpenAI 兼容 endpoint。
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PID_FILE = process.env.SURFCORE_EMBED_PID_FILE || path.join(HERE, 'service.pid');
const BUNDLED_OLLAMA = path.join(HERE, 'ollama.exe');
const BUNDLED_MODELS = process.env.SURFCORE_EMBED_OLLAMA_MODELS || path.join(HERE, 'ollama-models');
const OLLAMA_HOST = process.env.SURFCORE_EMBED_OLLAMA_HOST || '127.0.0.1:11435';

const HOST = process.env.SURFCORE_EMBED_HOST || '127.0.0.1';
const PORT = Number(process.env.SURFCORE_EMBED_PORT || 18765);
const TOKEN = String(process.env.SURFCORE_EMBED_TOKEN || crypto.randomBytes(24).toString('hex'));
let OLLAMA_URL = String(process.env.SURFCORE_EMBED_OLLAMA_URL || '').replace(/\/+$/, '');
let ollamaChild = null;
let ollamaBackend = 'external';
const DISCOVERY = process.env.SURFCORE_EMBED_DISCOVERY
  || path.join(process.env.USERPROFILE || os.homedir(), '.dsh', 'surfcore', 'embedding-service.json');
const DEFAULT_MODEL = String(process.env.SURFCORE_EMBED_DEFAULT_MODEL || 'bge-m3');

const LOCAL = Object.freeze({
  'bge-m3': { tag: 'bge-m3:latest', space: 'bge-m3@1024-f16-v1', dimension: 1024 },
  'bge-m3:latest': { tag: 'bge-m3:latest', space: 'bge-m3@1024-f16-v1', dimension: 1024 },
  'qwen3-embedding-0.6b': { tag: 'qwen3-embedding:0.6b', space: 'qwen3-embedding-0.6b@1024-q8-v1', dimension: 1024 },
  'qwen3-embedding:0.6b': { tag: 'qwen3-embedding:0.6b', space: 'qwen3-embedding-0.6b@1024-q8-v1', dimension: 1024 },
  'bge-small-zh-v1.5': { tag: 'bge-small-zh-v1.5:latest', space: 'bge-small-zh-v1.5@512-f16-v1', dimension: 512 },
  'bge-small-zh-v1.5:latest': { tag: 'bge-small-zh-v1.5:latest', space: 'bge-small-zh-v1.5@512-f16-v1', dimension: 512 },
});

const CLOUD = {
  endpoint: String(process.env.SURFCORE_EMBED_CLOUD_ENDPOINT || ''),
  model: String(process.env.SURFCORE_EMBED_CLOUD_MODEL || ''),
  space: String(process.env.SURFCORE_EMBED_CLOUD_SPACE || ''),
  dimension: Number(process.env.SURFCORE_EMBED_CLOUD_DIMENSION || 0),
  apiKey: String(process.env.SURFCORE_EMBED_API_KEY || ''),
  allowRemote: process.env.SURFCORE_EMBED_ALLOW_REMOTE === 'true',
};

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}

function fail(res, status, code, error, hint = '', requestId = crypto.randomUUID()) {
  json(res, status, { ok: false, code, error, hint, request_id: requestId, error_obj: { code, message: error } });
}

function estimatedTokens(text) {
  return Math.max(1, Math.ceil(String(text).length / 3));
}

/** 云端 embedding 用量回传桥接账本；失败不影响编码，只记一行日志。 */
async function reportCloudUsage(model, texts, usage = null) {
  const url = String(process.env.SURFCORE_LEDGER_URL || '').trim();
  const token = String(process.env.SURFCORE_LEDGER_TOKEN || '').trim();
  if (!url || !token) return;
  const tokens = Math.max(0, Math.round(Number(usage?.total_tokens ?? usage?.prompt_tokens) || texts.reduce((sum, text) => sum + estimatedTokens(text), 0)));
  if (!tokens) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-console-token': token },
      body: JSON.stringify({ channel: 'embedding-cloud', tokens, cost: 0, note: String(model || '') }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    console.error(`[embedding] 云端用量记账失败：${error?.message ?? error}`);
  }
}

function normalizeVector(value, expected) {
  if (!Array.isArray(value) || !value.length) return null;
  let norm = 0;
  const out = value.map((item) => {
    const n = Number(item);
    norm += n * n;
    return n;
  });
  if (!(norm > 0)) return null;
  const scale = 1 / Math.sqrt(norm);
  const normalized = out.map((n) => n * scale);
  if (expected && expected > 0 && normalized.length !== expected) return null;
  return normalized;
}

function localSpec(model) {
  return LOCAL[String(model || DEFAULT_MODEL)] ?? LOCAL[DEFAULT_MODEL] ?? LOCAL['bge-m3'];
}

async function readJson(req, limit = 32 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('请求体过大'), { status: 413, code: 'request.too-large' });
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('JSON 无效'), { status: 400, code: 'request.invalid-json' }); }
}

async function ollamaEmbed(model, texts) {
  const spec = localSpec(model);
  let response;
  try {
    response = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: spec.tag, input: texts }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    throw Object.assign(new Error(`Ollama 不可达：${error?.message ?? error}`), { status: 503, code: 'service.ollama-down', hint: '启动 Ollama 运行时（端口 11435）' });
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw Object.assign(new Error(`Ollama 返回 ${response.status}${detail ? `：${detail.slice(0, 160)}` : ''}`), { status: 502, code: 'service.ollama-failed', hint: `确认模型 ${spec.tag} 已安装` });
  }
  const body = await response.json().catch(() => null);
  const rows = Array.isArray(body?.embeddings) ? body.embeddings : null;
  if (!rows || rows.length !== texts.length) {
    throw Object.assign(new Error('Ollama 返回的 embeddings 数量不符'), { status: 502, code: 'service.invalid-response', hint: '检查 Ollama 版本/模型' });
  }
  const vectors = rows.map((row) => normalizeVector(row, spec.dimension));
  if (vectors.some((row) => !row)) {
    throw Object.assign(new Error('Ollama 返回的向量维度不符'), { status: 502, code: 'dimension.mismatch', hint: `期望 ${spec.dimension} 维` });
  }
  return { vectors, model: spec.tag, modelSpace: spec.space, dimension: spec.dimension };
}

async function cloudEmbed(model, texts) {
  if (!CLOUD.endpoint || !CLOUD.model || !CLOUD.space) {
    throw Object.assign(new Error('云端 provider 未配置'), { status: 503, code: 'cloud.not-configured', hint: '在云端包填写 endpoint/model/space/key' });
  }
  if (!CLOUD.apiKey) {
    throw Object.assign(new Error('云端 API key 未配置'), { status: 503, code: 'cloud.not-configured', hint: '在云端包填写 API Key' });
  }
  let response;
  try {
    response = await fetch(CLOUD.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CLOUD.apiKey}` },
      body: JSON.stringify({ model: CLOUD.model, input: texts, encoding_format: 'float' }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw Object.assign(new Error(`云端不可达：${error?.message ?? error}`), { status: 502, code: 'cloud.unavailable', hint: '检查 endpoint/网络/allowRemote' });
  }
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(new Error('云端认证失败'), { status: 502, code: 'cloud.auth-failed', hint: '检查 API key' });
  }
  if (response.status === 429) {
    throw Object.assign(new Error('云端限流'), { status: 429, code: 'cloud.rate-limited', hint: '稍后重试或降低频率' });
  }
  if (!response.ok) {
    throw Object.assign(new Error(`云端返回 ${response.status}`), { status: 502, code: 'cloud.unavailable', hint: '检查 provider 状态/模型名' });
  }
  const body = await response.json().catch(() => null);
  const rows = Array.isArray(body?.data) ? [...body.data].sort((a, b) => Number(a?.index || 0) - Number(b?.index || 0)) : null;
  if (!rows || rows.length !== texts.length) {
    throw Object.assign(new Error('云端返回的 data 数量不符'), { status: 502, code: 'cloud.invalid-response', hint: '确认 OpenAI 兼容格式' });
  }
  const vectors = rows.map((row) => normalizeVector(row?.embedding, CLOUD.dimension || 0));
  if (vectors.some((row) => !row)) {
    throw Object.assign(new Error('云端返回的向量为空或维度不符'), { status: 502, code: 'dimension.mismatch', hint: CLOUD.dimension ? `期望 ${CLOUD.dimension} 维` : '检查 provider 是否返回 embeddings' });
  }
  // 不同服务商默认维度不同（1024/1536/2048）；未显式指定时按实际返回维度走。
  const dimension = vectors[0].length;
  if (vectors.some((row) => row.length !== dimension)) {
    throw Object.assign(new Error('云端同一次返回的向量维度不一致'), { status: 502, code: 'dimension.mismatch', hint: '检查 provider 响应' });
  }
  return { vectors, model: CLOUD.model, modelSpace: CLOUD.space, dimension, usage: body?.usage ?? null };
}

function authorized(req) {
  const header = String(req.headers.authorization || '');
  return header === `Bearer ${TOKEN}`;
}

async function waitOllama(url, timeoutMs = 30000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const response = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

async function ensureOllama() {
  if (OLLAMA_URL) {
    ollamaBackend = 'external';
    return true;
  }
  if (fs.existsSync(BUNDLED_OLLAMA)) {
    fs.mkdirSync(BUNDLED_MODELS, { recursive: true });
    OLLAMA_URL = `http://${OLLAMA_HOST}`;
    ollamaBackend = 'bundled';
    ollamaChild = spawn(BUNDLED_OLLAMA, ['serve'], {
      cwd: HERE,
      env: { ...process.env, OLLAMA_HOST, OLLAMA_MODELS: BUNDLED_MODELS },
      stdio: 'ignore',
      windowsHide: true,
    });
    const ready = await waitOllama(OLLAMA_URL);
    if (!ready) throw new Error('bundled Ollama 启动超时');
    return true;
  }
  OLLAMA_URL = 'http://127.0.0.1:11434';
  ollamaBackend = 'system';
  return waitOllama(OLLAMA_URL, 5000);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const requestId = crypto.randomUUID();
  if (req.method === 'GET' && url.pathname === '/health') {
    json(res, 200, { ok: true, status: 'ok', service: 'surfcore-embedding', apiVersion: 'v1', backends: { local: ollamaBackend, cloud: Boolean(CLOUD.endpoint) } });
    return;
  }
  if (url.pathname.startsWith('/v1/') && !authorized(req)) {
    fail(res, 401, 'auth.invalid', '缺少或错误的 Bearer token', '从 discovery 文件读取 token', requestId);
    return;
  }
  try {
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      json(res, 200, { object: 'list', data: Object.entries(LOCAL).filter(([key]) => !key.includes(':')).map(([id, spec]) => ({ id, object: 'model', model_space: spec.space, dimension: spec.dimension, provider: 'ollama' })) });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/status') {
      json(res, 200, { ok: true, apiVersion: 'v1', defaultModel: DEFAULT_MODEL, local: { url: OLLAMA_URL }, cloud: { configured: Boolean(CLOUD.endpoint), model: CLOUD.model ? '[set]' : '', space: CLOUD.space || '' } });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/embeddings') {
      const body = await readJson(req);
      const input = Array.isArray(body.input) ? body.input.map((text) => String(text ?? '')) : [String(body.input ?? '')];
      if (!input.length || input.some((text) => !text.trim())) {
        fail(res, 400, 'request.invalid', 'input 不能为空', '传字符串或字符串数组', requestId);
        return;
      }
      const model = String(body.model || DEFAULT_MODEL);
      const useCloud = CLOUD.endpoint && CLOUD.model && model === CLOUD.model;
      const result = useCloud ? await cloudEmbed(model, input) : await ollamaEmbed(model, input);
      const usage = {
        prompt_tokens: input.reduce((sum, text) => sum + estimatedTokens(text), 0),
        total_tokens: input.reduce((sum, text) => sum + estimatedTokens(text), 0),
      };
      if (useCloud) void reportCloudUsage(result.model, input, result.usage ?? usage);
      json(res, 200, {
        object: 'list',
        model: result.model,
        model_space: result.modelSpace,
        dimension: result.dimension,
        data: result.vectors.map((embedding, index) => ({ object: 'embedding', index, embedding })),
        usage,
      });
      return;
    }
    fail(res, 404, 'request.not-found', `未知路径：${url.pathname}`, '可用 /health /v1/models /v1/embeddings /v1/status', requestId);
  } catch (error) {
    fail(res, Number(error?.status) || 500, error?.code || 'server.error', String(error?.message ?? error), String(error?.hint ?? ''), requestId);
  }
});

function writeDiscovery() {
  try {
    fs.mkdirSync(path.dirname(DISCOVERY), { recursive: true });
    fs.writeFileSync(DISCOVERY, `${JSON.stringify({
      schema: 1, apiVersion: 'v1', port: PORT, token: TOKEN, defaultModel: DEFAULT_MODEL,
      backend: CLOUD.endpoint ? 'hybrid' : 'ollama', updatedAt: new Date().toISOString(),
    }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    console.error(`[embedding-runtime] 写 discovery 失败：${error?.message ?? error}`);
  }
}

function cleanup() {
  try {
    const current = JSON.parse(fs.readFileSync(DISCOVERY, 'utf8'));
    if (Number(current.port) === PORT && current.token === TOKEN) fs.rmSync(DISCOVERY, { force: true });
  } catch {}
  try { fs.rmSync(PID_FILE, { force: true }); } catch {}
  try { ollamaChild?.kill(); } catch {}
}

try {
  await ensureOllama();
} catch (error) {
  console.error(`[embedding-runtime] 本地 Ollama 启动失败：${error?.message ?? error}`);
  process.exit(1);
}

server.listen(PORT, HOST, () => {
  writeDiscovery();
  try { fs.writeFileSync(PID_FILE, String(process.pid), { encoding: 'utf8', mode: 0o600 }); } catch {}
  console.log(`[embedding-runtime] listening http://${HOST}:${PORT} (${CLOUD.endpoint ? 'hybrid' : 'ollama'})`);
});
server.on('error', (error) => {
  console.error(`[embedding-runtime] 启动失败：${error?.message ?? error}`);
  process.exitCode = 1;
});
process.on('SIGINT', () => { cleanup(); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { cleanup(); server.close(() => process.exit(0)); });

