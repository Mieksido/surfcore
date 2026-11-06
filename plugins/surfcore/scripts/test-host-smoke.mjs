/**
 * 宿主冒烟测试（不启动 DSH）：
 *   · 用 mock ctx 装配插件；
 *   · 验证路由注册、配置读取、隐私闸门、身份对齐、扩展清单；
 *   · 不写真实配置（只读），不启停桥接。
 *
 * 运行：node scripts/test-host-smoke.mjs
 */
import { EventEmitter } from 'node:events';
// 冒烟测试不启动真实桥接（即使本机 unified 配置开了 autoStart）。
process.env.SURFCORE_SKIP_AUTOSTART = '1';
process.env.SURFCORE_DISABLE_CHARACTER_MIGRATION = '1';
// 不写真实记忆卡 / 不跑后台整理。
process.env.SURFCORE_DISABLE_MEMORY_TIMER = '1';
import { apply } from '../lib/index.js';

const routes = [];
const effects = [];
const ctx = {
  webServer: {
    register(route) {
      routes.push(route);
      return () => {};
    },
  },
  get(name) {
    if (name === 'connection') return { requestRejection: () => false };
    return null;
  },
  effect(fn) {
    effects.push(fn);
    return () => {};
  },
  sessionController: {
    inspect: async () => ({ events: [] }),
    create: async () => ({}),
    prompt: async () => ({ accepted: true }),
  },
  settings: null,
};

function fakeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers ?? {}; },
    end(body = '') { this.body += body; },
  };
  return res;
}

function fakeReq(method, url, body) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { host: '127.0.0.1:58750', ...(body ? { 'content-type': 'application/json' } : {}) };
  if (body) {
    process.nextTick(() => {
      req.emit('data', Buffer.from(JSON.stringify(body)));
      req.emit('end');
    });
  }
  return req;
}

async function invoke(route, method, path, body) {
  const res = fakeRes();
  const req = fakeReq(method, path, body);
  await route.handler(req, res);
  return res;
}

apply(ctx);
console.log('routes:', routes.map((r) => `${r.kind} ${r.path}`));

const apiRoute = routes.find((r) => r.path === '/dsh-surfcore/api');
const extRoute = routes.find((r) => r.path === '/dsh-surfcore/ext');
const healthRoute = routes.find((r) => r.path === '/dsh-surfcore/health');
if (!apiRoute || !extRoute || !healthRoute) throw new Error('路由没有全部注册');

const health = await invoke(healthRoute, 'GET', '/dsh-surfcore/health');
console.log('health:', health.statusCode, health.body.slice(0, 200));

for (const path of ['/dsh-surfcore/api/overview', '/dsh-surfcore/api/config', '/dsh-surfcore/api/persona', '/dsh-surfcore/api/memory', '/dsh-surfcore/api/memory-card', '/dsh-surfcore/api/memory-card/full', '/dsh-surfcore/api/embedding-packs', '/dsh-surfcore/api/align', '/dsh-surfcore/api/extensions', '/dsh-surfcore/api/platforms', '/dsh-surfcore/api/diagnostics', '/dsh-surfcore/api/bili/automation', '/dsh-surfcore/api/watch-history', '/dsh-surfcore/api/preferences/scan?sources=local&limit=5', '/dsh-surfcore/api/bili/fish-guard', '/dsh-surfcore/api/fish-guard/qq']) {
  const res = await invoke(apiRoute, 'GET', path);
  const data = JSON.parse(res.body || '{}');
  console.log(path, res.statusCode, data.ok, Object.keys(data).slice(0, 8));
  if (path.endsWith('/config')) {
    const qq = data.qq ?? {};
    if (qq.snowluma?.accessToken && qq.snowluma.accessToken !== '********') throw new Error('accessToken 没有脱敏');
    if (qq.consoleToken && qq.consoleToken !== '********') throw new Error('consoleToken 没有脱敏');
    // 管理员：合体层 admin 必须和 QQ/B站 旧字段对齐（升级后不用重填）。
    const admin = data.unified?.admin;
    if (!admin || typeof admin !== 'object') throw new Error('/config 没有返回管理员身份');
    if (admin.qq && !/^\d{5,12}$/.test(admin.qq)) throw new Error('管理员 QQ 未规范化');
    if (admin.biliMid && !/^\d{4,15}$/.test(admin.biliMid)) throw new Error('管理员 B站 mid 未规范化');
    if (admin.qq && qq.ownerQQ && admin.qq !== qq.ownerQQ) throw new Error('管理员 QQ 与 config.json ownerQQ 没对齐');
    if (admin.biliMid && data.bili?.owner?.mid && admin.biliMid !== String(data.bili.owner.mid)) {
      throw new Error('管理员 B站 mid 与 bili.config.json owner.mid 没对齐');
    }
    // 平台启动开关：唯一真相必须出现在合体层配置里，且两个都必须是布尔。
    const start = data.unified?.platforms?.start;
    if (!start || typeof start.qq !== 'boolean' || typeof start.bili !== 'boolean') {
      throw new Error('/config 缺少 platforms.start.{qq,bili}');
    }
  }
  if (path.endsWith('/overview')) {
    if (!('admin' in data)) throw new Error('/overview 没有返回管理员摘要');
    if (typeof data.admin?.gentle !== 'boolean') throw new Error('管理员摘要缺少 gentle');
    // 设置页顶部状态点 / 概览三按钮都读它：缺了会静默变成「开关都开」。
    if (!data.platformStart || typeof data.platformStart.qq !== 'boolean' || typeof data.platformStart.bili !== 'boolean') {
      throw new Error('/overview 缺少 platformStart.{qq,bili}');
    }
    if (typeof data.scheduler?.running !== 'boolean') throw new Error('/overview 缺少 scheduler.running');
  }
  if (path.endsWith('/bili/automation')) {
    if (data.ok !== true) throw new Error('/bili/automation 没有返回 ok');
    if (!data.limits || typeof data.limits.daily !== 'number') throw new Error('自动化快照缺少 limits.daily');
    if (!data.usage || typeof data.usage.comment !== 'number') throw new Error('自动化快照缺少 usage.comment');
    if (!data.dynamics || !Array.isArray(data.dynamics.kinds) || data.dynamics.kinds.length !== 4) {
      throw new Error('自动化快照缺少四类动态');
    }
    if (!data.qqShare || !Array.isArray(data.qqShare.times)) throw new Error('自动化快照缺少 QQ 分享排期');
  }
  if (path.endsWith('/watch-history')) {
    if (data.ok !== true) throw new Error('/watch-history 没有返回 ok');
    if (!Array.isArray(data.items)) throw new Error('/watch-history 缺少 items');
    if (!data.stats || typeof data.stats.today !== 'number') throw new Error('/watch-history 缺少 stats.today');
    if (typeof data.file !== 'string' || !data.file.includes('watch-history.jsonl')) throw new Error('/watch-history 缺少数据文件路径');
    if (!data.actions || typeof data.actions.comments !== 'number' || typeof data.actions.watchedOnly !== 'number') {
      throw new Error('/watch-history 缺少操作汇总 actions');
    }
    if (data.items.some((item) => !Array.isArray(item.actions))) throw new Error('/watch-history 的 item 缺少 actions 数组');
  }
  if (path.includes('/preferences/scan')) {
    if (data.ok !== true) throw new Error('/preferences/scan 没有返回 ok');
    if (!Array.isArray(data.candidates)) throw new Error('/preferences/scan 缺少 candidates');
    if (!Array.isArray(data.sources)) throw new Error('/preferences/scan 缺少 sources');
    if (!Array.isArray(data.existing)) throw new Error('/preferences/scan 缺少 existing');
    if (!data.account || typeof data.account !== 'object') throw new Error('/preferences/scan 缺少 account');
    if (data.account.role !== 'none') throw new Error('只扫本地时 account.role 应为 none（不能假装读了账号）');
  }
  if (path.endsWith('/bili/fish-guard')) {
    if (data.ok !== true) throw new Error('/bili/fish-guard 没有返回 ok');
    if (!data.fishGuard || typeof data.fishGuard.dailyLikes !== 'number') throw new Error('鱼群状态缺少 dailyLikes');
    if (typeof data.credentials !== 'boolean') throw new Error('鱼群状态缺少 credentials');
  }
  if (path.endsWith('/fish-guard/qq')) {
    if (data.ok !== true) throw new Error('/fish-guard/qq 没有返回 ok');
    if (!Array.isArray(data.items)) throw new Error('/fish-guard/qq 缺少 items');
    if (typeof data.active !== 'number') throw new Error('/fish-guard/qq 缺少 active');
    if (!data.config || typeof data.config.enabled !== 'boolean') throw new Error('/fish-guard/qq 缺少配置');
  }
}

// 一键启动里的 SnowLuma 分支：测试环境跳过真实弹窗，只验证路由/鉴权/响应。
const sl = await invoke(apiRoute, 'POST', '/dsh-surfcore/api/bridge', { action: 'start-snowluma' });
const slData = JSON.parse(sl.body || '{}');
console.log('start-snowluma', sl.statusCode, slData.ok, slData.skipped, slData.message);
if (sl.statusCode !== 200 || slData.ok !== true) throw new Error('start-snowluma 路由未通过');

// 扫码登录：只读状态接口 + 非法 id（不启动 Edge / 不真扫码）。
const accRes = await invoke(apiRoute, 'GET', '/dsh-surfcore/api/bili/accounts');
const acc = JSON.parse(accRes.body || '{}');
console.log('bili/accounts', accRes.statusCode, acc.ok, acc.fish?.configured, acc.owner?.configured);
if (accRes.statusCode !== 200 || acc.ok !== true) throw new Error('/bili/accounts 没有返回 ok');
if (!acc.fish || typeof acc.fish.configured !== 'boolean') throw new Error('/bili/accounts 缺少 fish 状态');
if (!acc.owner || typeof acc.owner.configured !== 'boolean') throw new Error('/bili/accounts 缺少 owner 状态');
if (JSON.stringify(acc).match(/sessdata|bili_jct/i)) throw new Error('/bili/accounts 泄露了 cookie');
const badPoll = await invoke(apiRoute, 'GET', '/dsh-surfcore/api/bili/qr/poll?id=bad');
console.log('qr/poll bad id', badPoll.statusCode);
if (badPoll.statusCode !== 400) throw new Error('非法扫码 id 应返回 400');

// 隐私闸门：QQ号/手机号/私信话题必须被丢弃
const { sanitizeText } = await import('../lib/privacy.js');
const blocked = sanitizeText('我的QQ是123456789，手机13800138000');
if (blocked.ok) throw new Error('隐私闸门没有拦截 QQ号/手机号');
const normal = sanitizeText('今天看了个视频 BV1xx411c7mD 很好笑');
if (!normal.ok) throw new Error('正常内容被误杀');

// 身份对齐：写入一条临时记录再删掉（会写真实 alignments.json，但会删除）。
// 本机 workspace-write 沙箱不允许写 ~/.dsh（DSH 自己的 ACL 收紧），此时只跳过这一段，
// 不把环境限制误报成插件回归；无沙箱终端仍会真的跑一遍 add/remove。
const { addLink, removeLink } = await import('../lib/align.js');
try {
  const link = addLink({
    identities: {
      qq: { id: '10001', name: '测试群友', groups: ['767098733'] },
      bili: { id: '20002', name: '测试鱼' },
    },
    source: 'smoke-test',
    confidence: 1,
    verified: true,
    note: 'smoke test; will be removed',
  });
  console.log('align add:', link.id);
  removeLink(link.id);
} catch (error) {
  if (error?.code === 'EPERM' || error?.code === 'EACCES') {
    console.log('align add/remove: skipped（沙箱不允许写 ~/.dsh）');
  } else {
    throw error;
  }
}

for (const fn of effects) {
  try {
    const dispose = fn();
    if (typeof dispose === 'function') dispose();
  } catch {}
}
console.log('SMOKE OK');
// 给 scheduler.stop()/子进程关闭留一个 tick，避免 Windows 上 process.exit 与 libuv
// handle 关闭竞争（Node 24 会打 "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"）。
await new Promise((resolve) => setTimeout(resolve, 100));
process.exit(0);
