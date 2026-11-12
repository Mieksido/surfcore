/**
 * 语音模型控制面 HTTP 服务（四层之外的本地控制面）
 * ============================================================================
 * 只调内核 voice 的模型/provider 公共面；不认平台、桥接、包脚本、端口。
 * 只监听 loopback，要求 x-voice-token；CORS 只放行本机 Web 源。
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createVoiceModels } from '../kernel/voice/models.js';

const DEFAULT_PORT = 4317;
const DEFAULT_STATE = path.join('state', 'voice-control');

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(data),
  });
  res.end(data);
}

function error(res, code, message, hint = '') {
  json(res, code, { ok: false, error: { code, message, hint, retryable: false } });
}

function readJson(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function cors(req, res) {
  const origin = String(req.headers.origin ?? '');
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'origin');
  }
  res.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type,x-voice-token');
  res.setHeader('access-control-max-age', '600');
}

export function createVoiceControlServer({
  port = DEFAULT_PORT, host = '127.0.0.1', stateDir = DEFAULT_STATE, token = process.env.SURFCORE_VOICE_TOKEN ?? '', now = () => Date.now(),
} = {}) {
  const dir = path.resolve(stateDir);
  const modelsFile = path.join(dir, 'voice-models.json');
  const providersFile = path.join(dir, 'voice-providers.json');
  const models = createVoiceModels({ configFile: modelsFile, providersFile });
  fs.mkdirSync(dir, { recursive: true });
  let authToken = String(token ?? '');
  if (!authToken) {
    authToken = crypto.randomBytes(24).toString('hex');
    const tokenFile = path.join(dir, 'token');
    fs.writeFileSync(tokenFile, `${authToken}\n`, { encoding: 'utf8', mode: 0o600 });
  }

  const server = http.createServer(async (req, res) => {
    cors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/health') { json(res, 200, { ok: true }); return; }
    if (String(req.headers['x-voice-token'] ?? '') !== authToken) { error(res, 401, 'voice.control.unauthorized', '缺少或错误的 x-voice-token'); return; }
    try {
      if (req.method === 'GET' && url.pathname === '/voice/status') {
        const out = await models.status();
        json(res, out.ok ? 200 : 500, out);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/voice/models') {
        const out = models.list();
        json(res, out.ok ? 200 : 500, out);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/voice/providers') {
        const out = models.listProviders();
        json(res, out.ok ? 200 : 500, out);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/voice/providers') {
        const body = await readJson(req);
        const out = models.setProvider(body);
        json(res, out.ok ? 200 : 400, out.ok ? { ok: true, provider: out.provider } : { ok: false, error: out.error });
        return;
      }
      if (req.method === 'DELETE' && url.pathname.startsWith('/voice/providers/')) {
        const id = decodeURIComponent(url.pathname.slice('/voice/providers/'.length));
        const out = models.removeProvider(id);
        json(res, out.ok ? 200 : 404, out.ok ? { ok: true } : { ok: false, error: out.error });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/voice/models/import') {
        const body = await readJson(req);
        const out = await models.importModel({
          sourceDir: String(body.sourceDir ?? ''),
          targetDir: String(body.targetDir ?? ''),
          force: body.force === true,
          deleteSource: body.deleteSource === true,
          model: body.model ?? {},
        });
        json(res, out.ok ? 200 : 400, out);
        return;
      }
      if (req.method === 'POST' && /^\/voice\/models\/(load|unload|probe|select|relink)$/.test(url.pathname)) {
        const action = url.pathname.split('/').pop();
        const body = await readJson(req);
        const modelId = String(body.modelId ?? body.id ?? '');
        const out = action === 'load' ? await models.load(modelId)
          : action === 'unload' ? await models.unload(modelId)
            : action === 'select' ? models.select(modelId)
              : action === 'relink' ? models.relink(modelId, String(body.dir ?? ''))
                : await models.probe(modelId, String(body.text ?? ''));
        if (out.ok) json(res, 200, out);
        else json(res, 400, { ok: false, error: { code: out.code ?? 'voice-model.operation-failed', message: out.error ?? '模型操作失败', hint: out.hint ?? '', retryable: false } });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/voice/models/synthesize') {
        const body = await readJson(req);
        const out = await models.synthesize({ modelId: String(body.modelId ?? ''), text: String(body.text ?? ''), voiceId: String(body.voiceId ?? '') });
        json(res, out.ok ? 200 : 400, out.ok ? { ok: true, bytes: out.bytes?.length ?? 0, durationMs: out.durationMs ?? null } : { ok: false, error: { code: out.code ?? 'voice.model.synthesize-failed', message: out.error?.message ?? out.message ?? '合成失败', retryable: false } });
        return;
      }
      error(res, 404, 'voice.control.route-unknown', `未知接口：${req.method} ${url.pathname}`);
    } catch (e) {
      error(res, 500, 'voice.control.internal', String(e?.message ?? e));
    }
  });

  return {
    server, token: authToken, stateDir: dir,
    start() {
      return new Promise((resolve) => {
        server.listen(port, host, () => resolve({ ok: true, port: server.address().port, token: authToken, stateDir: dir }));
      });
    },
    stop() {
      return new Promise((resolve) => server.close(() => resolve({ ok: true })));
    },
  };
}

if (process.argv[1]?.endsWith('voice-control-server.mjs')) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
  };
  const svc = createVoiceControlServer({
    port: Number(arg('port', DEFAULT_PORT)) || DEFAULT_PORT,
    stateDir: arg('state', DEFAULT_STATE),
    token: arg('token', process.env.SURFCORE_VOICE_TOKEN ?? ''),
  });
  const info = await svc.start();
  console.log(JSON.stringify({ ok: true, url: `http://127.0.0.1:${info.port}`, token: info.token, stateDir: info.stateDir }, null, 2));
}
