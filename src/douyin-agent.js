// 抖音能力层：专用 Edge + CDP。
//
// 为什么不是普通 HTTP 接口：抖音搜索/推荐/评论都要登录态 + a-bogus 签名，
// 自己拼参数必被风控；页面自己会发，我们只在旁边拦响应（和 douyin-fetch.mjs 同一套路）。
//
// 已验证的三个入口（2026-11-03）：
//   推荐流   /aweme/v2/web/module/feed/      首页 + 下滚，一页 10~20 条
//   搜索     /aweme/v1/web/search/item       只第一页，会偶发空 data（见 PITFALLS #82）
//   评论     /aweme/v1/web/comment/list      含 sticker（表情包）与 image_list
//   私信     /aweme/v1/web/im/*              页面能开，但接口要页面自己触发
//
// 表情包图片是签名 URL（约 1 天过期），所以收藏时必须把字节落盘，
// 发送时读本地文件 —— 见 sticker-lib 的 localFile 与 bridge 的 sendStickerV2。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FEED_RE = /aweme\/v2\/web\/module\/feed/;
const SEARCH_RE = /aweme\/v1\/web\/search\/item/;
const COMMENT_RE = /aweme\/v1\/web\/comment\/list/;

function isNum(n) { return Number.isInteger(n) && n > 0; }

/** 把一个抖音 aweme 压成「人看得懂、模型也好用」的一行。 */
function pickAweme(a) {
  if (!a || typeof a !== 'object') return null;
  if (Array.isArray(a.images) && a.images.length) return null; // 图文没有连续音轨，刷也没声
  const v = a.video ?? {};
  const sec = Math.round(Number(v.duration ?? 0) / 1000);
  const urls = v.play_addr?.url_list ?? [];
  const id = String(a.aweme_id ?? '');
  if (!id) return null;
  const stats = a.statistics ?? {};
  return {
    id,
    desc: String(a.desc ?? '').replace(/\s+/g, ' ').trim() || `抖音作品 ${id}`,
    author: String(a.author?.nickname ?? '').trim(),
    authorId: String(a.author?.sec_uid ?? ''),
    sec,
    url: `https://www.douyin.com/video/${id}`,
    playUrl: urls[0] ?? '',
    cover: (v.cover?.url_list ?? v.origin_cover?.url_list ?? [])[0] ?? '',
    music: String(a.music?.title ?? ''),
    digg: Number(stats.digg_count ?? 0),
    commentCount: Number(stats.comment_count ?? 0),
    shareCount: Number(stats.share_count ?? 0),
    publishAt: Number(a.create_time ?? 0) * 1000,
  };
}

/** 评论压一行；表情包保留原始 sticker 对象（收藏时要 uri/url_list）。 */
function pickComment(c) {
  if (!c || typeof c !== 'object') return null;
  const sticker = c.sticker ?? null;
  const images = (c.image_list ?? []).map((x) => (x?.url_list ?? [])[0]).filter(Boolean);
  return {
    id: String(c.cid ?? ''),
    text: String(c.text ?? '').replace(/\s+/g, ' ').trim(),
    user: String(c.user?.nickname ?? '').trim(),
    digg: Number(c.digg_count ?? 0),
    replyCount: Number(c.reply_comment_total ?? 0),
    hasSticker: !!sticker,
    sticker: sticker
      ? {
        id: String(sticker.id ?? sticker.uri ?? ''),
        uri: String(sticker.static_url?.uri ?? sticker.animated_url?.uri ?? ''),
        width: Number(sticker.width ?? 0),
        height: Number(sticker.height ?? 0),
        urls: (sticker.static_url?.url_list ?? []).slice(0, 2),
      }
      : null,
    images,
  };
}

export function createDouyinAgent({ cfg = {}, stateDir, log = () => {} } = {}) {
  const conf = {
    enabled: cfg.enabled !== false,
    edge: cfg.edge || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    profile: cfg.profile || path.join(os.homedir(), '.dsh', 'surfcore', 'douyin', 'profile'),
    port: Number(cfg.cdpPort || 9341),
    headless: cfg.headless !== false,
    idleCloseMs: Number(cfg.idleCloseMs ?? 5 * 60 * 1000),
    script: cfg.script || 'D:/大肥鱼功能/语音/说话/breeze/bridge/douyin-fetch.mjs',
    stickerDir: path.join(stateDir, 'stickers', 'douyin'),
  };

  let child = null;
  let launching = null;
  let idleTimer = null;
  let lastUse = 0;
  let lastError = null;

  function touch() {
    lastUse = Date.now();
    if (idleTimer) clearTimeout(idleTimer);
    if (!(conf.idleCloseMs > 0)) return;
    idleTimer = setTimeout(() => {
      // 浏览器是个占内存的东西（几百 MB），闲着就关掉；下次调用会重新拉起。
      // 关掉不影响登录态：profile 在磁盘上。
      void closeBrowser('idle');
    }, conf.idleCloseMs);
    idleTimer.unref?.();
  }

  async function probePort(port = conf.port) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1200) });
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  }

  async function ensureBrowser() {
    if (!conf.enabled) throw new Error('抖音能力已关闭（config.socialV2.douyin.enabled=false）');
    if (await probePort()) { touch(); return conf.port; }
    if (launching) return launching;
    launching = (async () => {
      if (!fs.existsSync(conf.edge)) throw new Error(`找不到 Edge：${conf.edge}`);
      const args = [
        '--no-first-run', '--no-default-browser-check',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=Translate',
        `--remote-debugging-port=${conf.port}`,
        `--user-data-dir=${conf.profile}`,
        'about:blank',
      ];
      if (conf.headless) args.unshift('--headless=new', '--disable-gpu', '--mute-audio');
      child = spawn(conf.edge, args, { stdio: 'ignore', windowsHide: conf.headless });
      child.on('exit', () => { child = null; });
      const until = Date.now() + 25000;
      while (Date.now() < until) {
        if (await probePort()) { touch(); return conf.port; }
        await sleep(350);
      }
      throw new Error(`Edge 调试端口 ${conf.port} 在 25 秒内没就绪（profile 可能被另一个窗口占用）`);
    })().finally(() => { launching = null; });
    return launching;
  }

  async function closeBrowser(reason = 'manual') {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    if (child) {
      try { child.kill(); } catch {}
      child = null;
      log(`[douyin] 浏览器已关闭（${reason}）`);
    }
    return true;
  }

  // ── CDP ────────────────────────────────────────────────────────────────
  function cdp(wsUrl, patterns) {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const hits = [];
    const images = [];
    const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP 连接失败')); });
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
      if (m.method === 'Network.responseReceived') {
        const u = String(m.params?.response?.url ?? '');
        const mime = String(m.params?.response?.mimeType ?? '');
        if (patterns.some((p) => p.test(u))) hits.push({ id: m.params.requestId, url: u });
        if (/^image\//.test(mime)) images.push({ id: m.params.requestId, url: u, mime });
      }
    };
    const send = (method, params = {}) => new Promise((res, rej) => {
      const i = ++id;
      const timer = setTimeout(() => { pending.delete(i); rej(new Error(`CDP ${method} 超时`)); }, 30000);
      pending.set(i, (msg) => { clearTimeout(timer); res(msg); });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
    return { ws, ready, send, hits, images, close: () => { try { ws.close(); } catch {} } };
  }

  async function waitFor(fn, timeoutMs, step = 300) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (await fn()) return true;
      await sleep(step);
    }
    return false;
  }

  async function bodyOf(c, hit) {
    for (let i = 0; i < 3; i += 1) {
      const r = await c.send('Network.getResponseBody', { requestId: hit.id });
      const b = r?.result?.body ?? '';
      if (b) return { body: b, base64: !!r?.result?.base64Encoded };
      await sleep(300);
    }
    return { body: '', base64: false };
  }

  /** 开一个标签页 → 导航 → 交给 fn → 关标签页。浏览器本身留着复用。 */
  async function withTab(url, patterns, fn) {
    const port = await ensureBrowser();
    const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    const c = cdp(tab.webSocketDebuggerUrl, patterns);
    try {
      await c.ready;
      // 先开监听再导航：抖音有些接口在 DOMContentLoaded 前就发了，晚一步就漏
      await c.send('Network.enable');
      await c.send('Page.enable');
      await c.send('Emulation.setUserAgentOverride', { userAgent: UA, acceptLanguage: 'zh-CN,zh;q=0.9' });
      await c.send('Page.navigate', { url });
      return await fn(c, port);
    } finally {
      c.close();
      try { await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`); } catch {}
      touch();
    }
  }

  async function pageText(c) {
    const r = await c.send('Runtime.evaluate', { expression: 'document.body.innerText.slice(0,400)', returnByValue: true });
    return String(r?.result?.result?.value ?? '');
  }

  function assertLoggedIn(text) {
    if (/登录后即可搜索|扫码登录|验证码登录/.test(text)) {
      throw new Error('抖音未登录：先在控制台点「抖音登录」扫码一次（node douyin-fetch.mjs --login）');
    }
    if (/验证码中间页|安全验证|请完成验证/.test(text)) {
      throw new Error('抖音弹了安全验证：打开专用窗口手动过一次再回来');
    }
  }

  // ── 推荐流 ─────────────────────────────────────────────────────────────
  async function feed({ count = 10, scrolls = 1 } = {}) {
    const out = [];
    await withTab('https://www.douyin.com/?recommend=1', [FEED_RE], async (c) => {
      const got = await waitFor(() => c.hits.length > 0, 25000);
      if (!got) assertLoggedIn(await pageText(c));
      await sleep(1200);
      for (let s = 0; s <= scrolls && out.length < count; s += 1) {
        // 推荐流是懒加载：不滚不给你下一条
        await c.send('Runtime.evaluate', { expression: 'window.scrollTo(0, document.body.scrollHeight); window.scrollBy(0, 600);' });
        await sleep(2000);
        for (const hit of c.hits) {
          if (hit.taken) continue;
          const { body } = await bodyOf(c, hit);
          if (!body) continue;
          hit.taken = true;
          try {
            const j = JSON.parse(body);
            const rows = j?.aweme_list ?? j?.data ?? [];
            for (const r of rows) {
              const a = pickAweme(r.aweme_info ?? r);
              if (a && !out.some((x) => x.id === a.id)) out.push(a);
            }
          } catch { /* 半截 JSON 跳过 */ }
        }
      }
    });
    return out.slice(0, count);
  }

  // ── 搜索（复用 douyin-fetch 的打分，只维护一份规则）────────────────────
  async function search(keyword, { limit = 3, voiceMode = '', allowMV = false } = {}) {
    const kw = String(keyword || '').trim();
    if (!kw) throw new Error('歌名/关键词不能为空');
    if (!fs.existsSync(conf.script)) throw new Error(`搜歌脚本不存在：${conf.script}`);
    const args = [conf.script, kw, '--list-only'];
    if (voiceMode) args.push('--voice-mode', voiceMode);
    if (allowMV) args.push('--allow-mv');
    const out = await new Promise((resolve, reject) => {
      const p = spawn(process.execPath, args, { windowsHide: true });
      let buf = '';
      let err = '';
      const timer = setTimeout(() => { try { p.kill(); } catch {} ; reject(new Error('抖音搜索超时（150 秒）')); }, 150000);
      p.stdout.on('data', (d) => { buf += String(d); });
      p.stderr.on('data', (d) => { err += String(d); });
      p.on('error', (e) => { clearTimeout(timer); reject(new Error(`拉起搜索脚本失败：${e?.message ?? e}`)); });
      p.on('close', (code) => {
        clearTimeout(timer);
        const line = buf.split(/\r?\n/).find((l) => l.startsWith('__JSON__'));
        if (!line) {
          const txt = (err || buf).split(/\r?\n/).filter(Boolean).slice(-2).join(' ').slice(0, 200);
          reject(new Error(`抖音搜索失败（退出码 ${code}）：${txt || '没有输出'}`));
          return;
        }
        try { resolve(JSON.parse(line.slice('__JSON__'.length))); } catch (e) { reject(e); }
      });
    });
    return { keyword: kw, total: out.total ?? 0, provider: 'douyin', candidates: (out.candidates ?? []).slice(0, limit) };
  }

  // ── 评论区 ─────────────────────────────────────────────────────────────
  async function comments(awemeId, { pages = 2 } = {}) {
    const id = String(awemeId || '').replace(/[^\d]/g, '');
    if (!id) throw new Error('作品 id 必须是数字');
    const list = [];
    await withTab(`https://www.douyin.com/video/${id}`, [COMMENT_RE], async (c) => {
      await sleep(5000);
      for (let i = 0; i < pages + 1; i += 1) {
        // 评论区在右侧栏，滚整个页面会顺带把评论拉出来
        await c.send('Runtime.evaluate', { expression: 'window.scrollTo(0, document.body.scrollHeight); window.scrollBy(0, 700);' });
        await sleep(2200);
        for (const hit of c.hits) {
          if (hit.taken) continue;
          const { body } = await bodyOf(c, hit);
          if (!body) continue;
          hit.taken = true;
          try {
            const j = JSON.parse(body);
            for (const raw of j?.comments ?? []) {
              const cm = pickComment(raw);
              if (cm && cm.id && !list.some((x) => x.id === cm.id)) list.push(cm);
            }
          } catch { /* 跳过 */ }
        }
      }
    });
    return list;
  }

  // ── 收藏评论区表情包 ────────────────────────────────────────────────────
  // 关键：抖音表情是签名 URL（约 1 天过期），存 URL 没用。
  // 页面自己会把图load出来，我们从 CDP 的图片响应里取原始字节落盘。
  async function collectStickers(awemeId, { limit = 6 } = {}) {
    const id = String(awemeId || '').replace(/[^\d]/g, '');
    if (!id) throw new Error('作品 id 必须是数字');
    const picked = [];
    await withTab(`https://www.douyin.com/video/${id}`, [COMMENT_RE], async (c) => {
      await sleep(5000);
      for (let i = 0; i < 4 && picked.length < limit; i += 1) {
        await c.send('Runtime.evaluate', { expression: 'window.scrollTo(0, document.body.scrollHeight); window.scrollBy(0, 700);' });
        await sleep(2400);
        for (const hit of c.hits) {
          if (hit.taken) continue;
          const { body } = await bodyOf(c, hit);
          if (!body) continue;
          hit.taken = true;
          try {
            const j = JSON.parse(body);
            for (const raw of j?.comments ?? []) {
              const cm = pickComment(raw);
              if (!cm?.sticker?.id || !cm.sticker.uri) continue;
              if (picked.some((x) => x.sticker.id === cm.sticker.id)) continue;
              picked.push({ ...cm, awemeId: id });
              if (picked.length >= limit) break;
            }
          } catch { /* 跳过 */ }
        }
      }

      // 图片字节：按 uri 去匹配页面加载的图片响应
      fs.mkdirSync(conf.stickerDir, { recursive: true });
      for (const item of picked) {
        const key = item.sticker.uri.split('/').pop() || '';
        const hit = c.images.find((x) => key && x.url.includes(key));
        if (!hit) { item.error = '页面没加载这张图（可能没滚到）'; continue; }
        const { body, base64 } = await bodyOf(c, hit);
        if (!body) { item.error = '取不到图片字节'; continue; }
        const buf = base64 ? Buffer.from(body, 'base64') : Buffer.from(body, 'binary');
        const head = buf.subarray(0, 12).toString('latin1');
        const ext = head.startsWith('RIFF') ? 'webp' : (head.startsWith('\x89PNG') ? 'png' : (head.startsWith('\xff\xd8') ? 'jpg' : 'webp'));
        const file = path.join(conf.stickerDir, `${item.sticker.id}.${ext}`);
        fs.writeFileSync(file, buf);
        item.localFile = file;
        item.bytes = buf.length;
      }
    });
    return { awemeId: id, found: picked.length, items: picked.filter((x) => x.localFile), failed: picked.filter((x) => x.error) };
  }

  async function status() {
    const up = await probePort();
    let version = '';
    if (up) version = String(up.Browser ?? '');
    return {
      enabled: conf.enabled,
      browserRunning: !!up,
      port: conf.port,
      profile: conf.profile,
      headless: conf.headless,
      idleMs: lastUse ? Date.now() - lastUse : null,
      lastError,
      version,
    };
  }

  return { status, feed, search, comments, collectStickers, closeBrowser, conf };
}
