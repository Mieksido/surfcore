/**
 * 语音 model API 路由（宿主/控制面共用的纯 HTTP 适配）
 * ============================================================================
 * 不监听端口、不做鉴权、不做 CORS；只把 Request 映射到 kernel/voice model 公共面。
 * 出口统一 {ok:false,error:{code,message,hint}}。
 */

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(data),
  });
  res.end(data);
}

function fail(res, status, code, message, hint = '') {
  send(res, status, { ok: false, error: { code, message, hint, retryable: false } });
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
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}

/**
 * @param {object} opts { models }
 * @returns {{handle:(req,res,url)=>Promise<void>}}
 */
export function createVoiceApiRouter({ models } = {}) {
  if (!models || typeof models.status !== 'function') throw new Error('语音路由需要 models');
  return {
    async handle(req, res, url) {
      const path = url.pathname;
      try {
        if (req.method === 'GET' && path === '/voice/status') {
          const out = await models.status();
          send(res, out.ok ? 200 : 500, out);
          return;
        }
        if (req.method === 'GET' && path === '/voice/models') {
          const out = models.list();
          send(res, out.ok ? 200 : 500, out);
          return;
        }
        if (req.method === 'GET' && path === '/voice/providers') {
          const out = models.listProviders();
          send(res, out.ok ? 200 : 500, out);
          return;
        }
        if (req.method === 'POST' && path === '/voice/providers') {
          const body = await readJson(req);
          const out = models.setProvider(body);
          send(res, out.ok ? 200 : 400, out.ok ? { ok: true, provider: out.provider } : { ok: false, error: out.error });
          return;
        }
        if (req.method === 'DELETE' && path.startsWith('/voice/providers/')) {
          const id = decodeURIComponent(path.slice('/voice/providers/'.length));
          const out = models.removeProvider(id);
          send(res, out.ok ? 200 : 404, out.ok ? { ok: true } : { ok: false, error: out.error });
          return;
        }
        if (req.method === 'POST' && path === '/voice/models/import') {
          const body = await readJson(req);
          const out = await models.importModel({
            sourceDir: String(body.sourceDir ?? ''),
            targetDir: String(body.targetDir ?? ''),
            force: body.force === true,
            deleteSource: body.deleteSource === true,
            model: body.model ?? {},
          });
          send(res, out.ok ? 200 : 400, out);
          return;
        }
        if (req.method === 'POST' && /^\/voice\/models\/(load|unload|probe|select|relink)$/.test(path)) {
          const action = path.split('/').pop();
          const body = await readJson(req);
          const modelId = String(body.modelId ?? body.id ?? '');
          const out = action === 'load' ? await models.load(modelId)
            : action === 'unload' ? await models.unload(modelId)
              : action === 'select' ? models.select(modelId)
                : action === 'relink' ? models.relink(modelId, String(body.dir ?? ''))
                  : await models.probe(modelId, String(body.text ?? ''));
          if (out.ok) send(res, 200, out);
          else fail(res, 400, out.code ?? 'voice-model.operation-failed', out.error ?? '模型操作失败', out.hint ?? '');
          return;
        }
        if (req.method === 'POST' && path === '/voice/models/synthesize') {
          const body = await readJson(req);
          const out = await models.synthesize({ modelId: String(body.modelId ?? ''), text: String(body.text ?? ''), voiceId: String(body.voiceId ?? '') });
          if (out.ok) send(res, 200, { ok: true, bytes: out.bytes?.length ?? 0, durationMs: out.durationMs ?? null });
          else fail(res, 400, out.code ?? 'voice-model.synthesize-failed', out.error?.message ?? out.message ?? '合成失败');
          return;
        }
        fail(res, 404, 'voice.control.route-unknown', `未知接口：${req.method} ${path}`);
      } catch (error) {
        fail(res, 500, 'voice.control.internal', String(error?.message ?? error));
      }
    },
  };
}
