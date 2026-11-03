/**
 * 抖音页接线自检（mock ctx + 合成状态，不碰真实 ~/.dsh）。
 *
 * 钉住：
 *   · /dsh-surfcore/api/douyin/status 能读到插件状态（安装版本 / 浏览器 / 时段 / 外发开关）；
 *   · /douyin/history 从人格记忆的 observations 里取「最近看过」；
 *   · /douyin/report 读最近一份日报；
 *   · POST /douyin/memory/refresh 能生成 douyin-memory*.md。
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-douyin-'));
const stateDir = path.join(tmp, 'surfcore');
fs.mkdirSync(stateDir, { recursive: true });

// QQ 侧根目录也必须隔离：/douyin/memory/refresh 落盘走 activePlatformStateDir(QQ_STATE_DIR())，
// 只设 DSH_HOME 不够 —— QQBOT_ROOT 会探针命中真实仓库（有 config.json + src/bridge.js），
// 于是测试假数据被写进线上 state/douyin-memory.md，还能被 QQ 提示词注入。PITFALLS #88。
const qqbotRoot = path.join(tmp, 'qqbot');
fs.mkdirSync(path.join(qqbotRoot, 'src'), { recursive: true });
fs.writeFileSync(path.join(qqbotRoot, 'config.json'), JSON.stringify({ consoleToken: '' }));
fs.writeFileSync(path.join(qqbotRoot, 'src', 'bridge.js'), '// test stub：仅用于让 looksLikeQqbotRoot() 认这个目录\n');

// 合成一份插件安装目录 + 状态
const pluginDir = path.join(tmp, 'node_modules', 'dsh-douyin-agent');
fs.mkdirSync(path.join(pluginDir, 'state'), { recursive: true });
fs.writeFileSync(path.join(pluginDir, 'package.json'), JSON.stringify({ name: 'dsh-douyin-agent', version: '1.4.7' }));
fs.writeFileSync(path.join(pluginDir, 'state', 'native-model.json'), JSON.stringify({ provider: 'p', model: 'm' }));
fs.writeFileSync(path.join(pluginDir, 'state', 'video-policy.json'), JSON.stringify({ version: 1, windows: ['09:00-12:00'], sessionMinutes: 10 }));
fs.writeFileSync(path.join(pluginDir, 'state', 'video-sessions.json'), JSON.stringify({ version: 1, current: null }));
fs.writeFileSync(path.join(pluginDir, 'state', 'spark-policy.json'), JSON.stringify({ enabled: true, windows: ['09:00-22:00'], dailyLimit: 2 }));
fs.writeFileSync(path.join(pluginDir, 'state', 'chat-policy.json'), JSON.stringify({ enabled: false, allowlist: [] }));
fs.writeFileSync(path.join(pluginDir, 'state', 'comments-policy.json'), JSON.stringify({ enabled: false }));
fs.writeFileSync(path.join(pluginDir, 'state', 'replies-policy.json'), JSON.stringify({ enabled: false, perVideo: 4 }));

// 合成浏览器控制文件 + 人格记忆 + 日报
const dyHome = path.join(tmp, 'douyin-browser');
fs.mkdirSync(path.join(dyHome, 'control'), { recursive: true });
fs.mkdirSync(path.join(dyHome, 'memory', 'persona'), { recursive: true });
fs.mkdirSync(path.join(dyHome, 'memory', 'reports', 'videos'), { recursive: true });
fs.writeFileSync(path.join(dyHome, 'control', 'browser.json'), JSON.stringify({ pid: 1, port: 19999, ready: true, startedAt: Date.now() }));
fs.writeFileSync(path.join(dyHome, 'memory', 'persona', 'state.json'), JSON.stringify({
  version: 1,
  generation: 0,
  initializedAt: Date.now(),
  legacyImportAttempted: false,
  legacyImported: false,
  observations: [
    { videoId: '111', url: 'https://www.douyin.com/video/111', title: '猫咪日常', author: '猫猫头', observedAt: Date.now() - 60000, playback: { duration: 45 } },
    { videoId: '222', url: 'https://www.douyin.com/video/222', title: '深夜食堂', author: '夜宵君', observedAt: Date.now(), playback: { duration: 90 } },
  ],
  interests: [],
  userPreferences: [],
}));
fs.writeFileSync(path.join(dyHome, 'memory', 'reports', 'videos', '2026-11-03.md'), '# 2026-11-03\n\n- 看了猫咪日常\n- 看了深夜食堂\n');

process.env.DSH_HOME = tmp;
process.env.USERPROFILE = tmp;
process.env.SURFCORE_QQBOT_ROOT = qqbotRoot;
process.env.DOUYIN_PLUGIN_DIR = pluginDir;
process.env.SURFCORE_SKIP_AUTOSTART = '1';
process.env.SURFCORE_DISABLE_CHARACTER_MIGRATION = '1';
process.env.SURFCORE_DISABLE_MEMORY_TIMER = '1';

const { apply } = await import('../lib/index.js');

const routes = [];
const effects = [];
const ctx = {
  webServer: { register(route) { routes.push(route); return () => {}; } },
  get(name) { if (name === 'connection') return { requestRejection: () => false }; return null; },
  effect(fn) { effects.push(fn); return () => {}; },
  sessionController: { inspect: async () => ({ events: [] }), create: async () => ({}), prompt: async () => ({ accepted: true }) },
  settings: null,
};

function fakeRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers ?? {}; },
    end(body = '') { this.body = String(body); },
    setHeader() {},
  };
}

async function invoke(method, pathname, body) {
  const route = routes.find((r) => String(pathname).startsWith(r.path));
  assert.ok(route, `没有注册路由 ${pathname}`);
  const req = new EventEmitter();
  req.method = method;
  req.url = pathname;
  req.headers = { host: '127.0.0.1:58750', ...(body ? { 'content-type': 'application/json' } : {}) };
  if (body) {
    process.nextTick(() => {
      req.emit('data', Buffer.from(JSON.stringify(body)));
      req.emit('end');
    });
  }
  const res = fakeRes();
  await route.handler(req, res);
  return { status: res.statusCode, data: JSON.parse(res.body || '{}') };
}

try {
  apply(ctx);
  const api = routes.find((route) => route.path === '/dsh-surfcore/api');
  assert.ok(api, 'API 路由没有注册');

  const status = await invoke('GET', '/dsh-surfcore/api/douyin/status');
  assert.equal(status.status, 200, 'status 应 200');
  assert.equal(status.data.installed, true, '应识别到插件已安装');
  assert.equal(status.data.version, '1.4.7');
  assert.equal(status.data.model.provider, 'p');
  assert.deepEqual(status.data.watch.windows, ['09:00-12:00']);
  assert.equal(status.data.outbound.greeting.enabled, true);
  assert.equal(status.data.outbound.comment.enabled, false);
  assert.equal(status.data.browser.port, 19999);
  assert.equal(status.data.browser.alive, false, '合成端口没有进程，存活探测应为 false');
  assert.equal(status.data.persona.observations, 2);

  const history = await invoke('GET', '/dsh-surfcore/api/douyin/history?limit=10');
  assert.equal(history.status, 200);
  assert.equal(history.data.items.length, 2);
  assert.equal(history.data.items[0].videoId, '222', '最近的排最前');
  assert.equal(history.data.items[0].title, '深夜食堂');

  const report = await invoke('GET', '/dsh-surfcore/api/douyin/report');
  assert.equal(report.status, 200);
  assert.equal(report.data.report.date, '2026-11-03');

  const refresh = await invoke('POST', '/dsh-surfcore/api/douyin/memory/refresh', {});
  assert.equal(refresh.status, 200);
  assert.equal(refresh.data.stats.entries, 2, '两条观察都应进记忆');
  assert.equal(refresh.data.stats.hasReport, true, '应认到当天日报');

  // 隔离断言：QQ 侧根目录必须是临时目录，刷新结果也只能落在它下面。
  const pathsMod = await import('../lib/paths.js');
  assert.equal(pathsMod.QQBOT_ROOT, qqbotRoot, 'QQBOT_ROOT 指向了真实仓库：测试会污染线上抖音记忆');
  assert.ok(fs.existsSync(path.join(qqbotRoot, 'state', 'douyin-memory.md')), '抖音记忆应写在隔离的 QQ 根目录下');
  // 落盘位置是「当前角色」的平台目录（activePlatformStateDir），不是 surfcore 根目录，
  // 所以这里只断言内容里确实有作品，路径由 douyin-memory 单测覆盖。
  const { createDouyinMemory } = await import('../../../src/douyin-memory.js');
  const memory = createDouyinMemory({ stateDir });
  await memory.refresh({ force: true });
  const brief = memory.briefBlock();
  assert.match(brief, /猫咪日常|深夜食堂/, '简报里应有看过的作品');

  console.log('douyin host wiring OK');
} finally {
  for (const fn of effects) { try { const d = fn(); if (typeof d === 'function') d(); } catch {} }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}
