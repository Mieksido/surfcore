/**
 * SurfCore · 桌宠 ↔ 插件 的本地接口（pet-api）
 *
 * 桌宠是独立 Electron 进程，不能带 DSH 的会话 Cookie，所以不能走设置页那套
 * `/dsh-surfcore/api/*`（会被 connection.requestRejection 拦成 401）。
 * 这里单独注册一个前缀 `/dsh-surfcore/pet-api`：
 *   · 只接受 127.0.0.1 / localhost / ::1；
 *   · 写操作必须 application/json + 同源或没有 Origin；
 *   · 必须带 `x-pet-token`（或音频用 ?token=），令牌落在
 *     ~/.dsh/surfcore/pet/host-token，只有本机当前用户读得到。
 *
 * 桌宠从 ~/.dsh/surfcore/pet/host.json 发现 baseUrl + token；DSH 端口漂移时
 * 插件会重写这个文件（每 2 分钟一次），桌宠重连时会重新读。
 */
import fs from 'node:fs';
import path from 'node:path';
import { isAllowedHost, isLoopbackReq, json, readBody, sameOrigin, safeEqual } from './http-guard.js';

const API_PREFIX = '/dsh-surfcore/pet-api';
const HOST_FILE_VERSION = 1;
/** 桌宠的请求体都是短消息；比设置页 API（512KB）收得更紧。 */
const PET_BODY_LIMIT = 256 * 1024;

/**
 * @param {object} opts
 * @param {object} opts.chat                  pet-chat 服务
 * @param {object} opts.purpose               pet-purpose 服务
 * @param {object} opts.petService            原有安装/启动服务（拿 running/installed）
 * @param {string} opts.stateDir              ~/.dsh/surfcore
 * @param {() => string} opts.currentDshUrl   DSH 当前 Web 地址
 * @param {(msg:string, ...args:any[])=>void} [opts.pluginLog]
 */
export function createPetApiService({ chat, purpose, petService, stateDir, currentDshUrl, hostPolicy = null, pluginLog = () => {}, version = '' }) {
  const root = path.join(stateDir, 'pet');
  const hostFile = path.join(root, 'host.json');
  let lastHostWrite = 0;

  function token() {
    return chat.token();
  }

  function hostPayload() {
    return {
      version: HOST_FILE_VERSION,
      baseUrl: String(currentDshUrl() || '').replace(/\/+$/, ''),
      token: token(),
      api: API_PREFIX,
      pluginVersion: String(version || ''),
      updatedAt: new Date().toISOString(),
    };
  }

  function writeHostFile(force = false) {
    const now = Date.now();
    if (!force && now - lastHostWrite < 5000) return;
    lastHostWrite = now;
    try {
      fs.mkdirSync(root, { recursive: true });
      const tmp = `${hostFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(hostPayload(), null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmp, hostFile);
      try { fs.chmodSync(hostFile, 0o600); } catch {}
    } catch (error) {
      pluginLog('[pet-api] 写 host.json 失败：', String(error?.message ?? error));
    }
  }

  function audioUrlFor(key) {
    const safe = String(key ?? '').replace(/[^a-f0-9]/gi, '');
    if (!safe) return '';
    return `${API_PREFIX}/audio/${safe}.wav?token=${encodeURIComponent(token())}`;
  }

  function authOk(req, url) {
    const header = String(req.headers['x-pet-token'] ?? '');
    const query = String(url?.searchParams?.get('token') ?? '');
    const expected = token();
    if (!expected) return false;
    if (header && safeEqual(header, expected)) return true;
    if (query && safeEqual(query, expected)) return true;
    return false;
  }

  function statusForPet() {
    const base = petService?.status ? petService.status() : {};
    const chatStatus = chat.status();
    return {
      ok: true,
      pet: { installed: Boolean(base.installed), running: Boolean(base.running), dir: base.dir || '', skins: base.skins || [] },
      chat: chatStatus.chat,
      role: chatStatus.role,
      proactive: chatStatus.proactive,
      presence: chatStatus.presence,
      voice: chatStatus.voice,
      llm: chatStatus.llm,
      focus: chatStatus.focus,
      purpose: {
        carrier: purpose?.config?.().carrier ?? 'qq',
        modality: purpose?.config?.().modality ?? 'text',
        online: purpose?.status?.().online ?? false,
      },
      events: chatStatus.events,
      lastError: chatStatus.lastError,
      serverTime: Date.now(),
    };
  }

  async function handle(req, res, url) {
    // 未注入策略时保持旧语义（只认回环）；注入了就与设置页共用同一份判据。
    const allowed = typeof hostPolicy === 'function' ? isAllowedHost(req, hostPolicy() || {}) : isLoopbackReq(req);
    if (!allowed) {
      json(res, 403, {
        ok: false,
        code: 'HOST_NOT_ALLOWED',
        error: '这个地址不在允许列表里，桌宠接口拒绝访问',
        hint: '服务器上桌宠与 DSH 同机运行时，把 DSH 的绑定地址加进「访问与安全 → 允许的主机名」',
      });
      return;
    }
    if (req.method !== 'GET' && !sameOrigin(req)) { json(res, 403, { ok: false, error: '跨站请求被拒绝' }); return; }
    if (req.method !== 'GET' && !String(req.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
      json(res, 415, { ok: false, error: '写操作必须是 application/json' });
      return;
    }
    if (!authOk(req, url)) {
      // 令牌不对时只给一个最小提示，别透露主机配置。
      json(res, 401, { ok: false, error: '桌宠令牌无效或还没生成（重启 DSH 后会自动重写 host.json）' });
      return;
    }

    const pathname = url.pathname;
    const suffix = pathname.slice(API_PREFIX.length) || '/';

    if (req.method === 'GET' && suffix === '/health') {
      json(res, 200, { ok: true, name: 'surfcore-pet', version: String(version || ''), serverTime: Date.now() });
      return;
    }
    if (req.method === 'GET' && suffix === '/status') {
      json(res, 200, statusForPet());
      return;
    }
    if (req.method === 'GET' && suffix === '/config') {
      json(res, 200, { ok: true, ...chat.publicConfig(), serverTime: Date.now() });
      return;
    }
    if (req.method === 'GET' && suffix === '/history') {
      const limit = Number(url.searchParams.get('limit')) || 60;
      json(res, 200, chat.history(limit));
      return;
    }
    // 目的机制（桌宠载体）的只读状态 / 预览 / 手动出发。
    // 设置页走的是带 DSH 会话的 /dsh-surfcore/api/purpose；这几个是给桌宠侧
    // （以及本地排障）用的同一份能力，令牌与其它 pet-api 一样。
    if (req.method === 'GET' && suffix === '/purpose/status') {
      json(res, 200, purpose?.status ? purpose.status() : { ok: false, error: 'purpose 服务不可用' });
      return;
    }
    if (req.method === 'POST' && suffix === '/purpose/preview') {
      const result = await purpose.preview();
      json(res, result.ok ? 200 : 400, result);
      return;
    }
    if (req.method === 'POST' && suffix === '/purpose/run') {
      let body = {};
      try { body = JSON.parse((await readBody(req, PET_BODY_LIMIT)) || '{}'); } catch {}
      const result = await purpose.run({ force: body.force !== false });
      json(res, result.ok ? 200 : 409, result);
      return;
    }
    if (req.method === 'POST' && suffix === '/chat') {
      let body = {};
      try { body = JSON.parse((await readBody(req, PET_BODY_LIMIT)) || '{}'); } catch { json(res, 400, { ok: false, error: '请求体不是合法 JSON' }); return; }
      const result = await chat.chat({ text: body.text, modality: body.modality });
      json(res, result.ok ? 200 : 400, result);
      return;
    }
    if (req.method === 'POST' && suffix === '/focus') {
      let body = {};
      try { body = JSON.parse((await readBody(req, PET_BODY_LIMIT)) || '{}'); } catch {}
      const state = chat.setFocus(body.enabled === true, body.source || 'pet');
      json(res, 200, { ok: true, focus: state });
      return;
    }
    if (req.method === 'POST' && suffix === '/chat/test') {
      // 设置页/排障用：让桌宠那边也弹一次气泡（结果通过事件推给所有连着的主进程）。
      let body = {};
      try { body = JSON.parse((await readBody(req, PET_BODY_LIMIT)) || '{}'); } catch {}
      const result = await chat.chat({ text: body.text || '在吗', modality: body.modality === 'voice' ? 'voice' : 'text' });
      if (result.ok && result.reply) {
        chat.emit({
          type: 'reply',
          text: result.reply.text,
          modality: result.reply.modality,
          audioKey: result.reply.audio?.key || '',
          messageId: result.reply.id,
        });
      }
      json(res, result.ok ? 200 : 400, result);
      return;
    }
    if (req.method === 'GET' && suffix === '/events') {
      const rawSince = url.searchParams.get('since');
      const since = rawSince === null || rawSince === '' ? null : Number(rawSince);
      const wait = Number(url.searchParams.get('wait'));
      const client = String(url.searchParams.get('client') || 'pet').slice(0, 40);
      const result = await chat.poll({
        since: Number.isFinite(since) ? since : null,
        waitMs: Number.isFinite(wait) ? wait : 0,
        clientId: client,
      });
      json(res, 200, result);
      return;
    }
    if (req.method === 'GET' && suffix.startsWith('/audio/')) {
      const key = suffix.slice('/audio/'.length).replace(/\.wav$/i, '');
      const audio = chat.readAudio(key);
      if (!audio) { json(res, 404, { ok: false, error: '音频不存在或已过期' }); return; }
      try {
        res.writeHead(200, {
          'Content-Type': 'audio/wav',
          'Content-Length': String(audio.bytes.length),
          'Cache-Control': 'private, max-age=86400',
        });
        res.end(audio.bytes);
      } catch {}
      return;
    }
    json(res, 404, { ok: false, error: `未知桌宠接口：${suffix}` });
  }

  return {
    prefix: API_PREFIX,
    handle,
    writeHostFile,
    audioUrlFor,
    hostFile,
    status: statusForPet,
    token,
  };
}
