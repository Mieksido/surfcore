/**
 * 管理员保存链路的端到端回归（临时目录，不碰真实配置）。
 *
 * 为什么需要它：管理员卡片是「一处改，三处写」——
 *   unified.admin（唯一真相） → config.json ownerQQ → bili.config.json owner.mid/name。
 * 只测纯函数不够：handler 读文件、合并默认值、落盘的实际顺序出过错
 * （合并默认值后的空串把旧 owner 覆盖掉，见 PITFALLS #12）。
 *
 * 做法：SURFCORE_ROOT / DSH_HOME 指向临时目录，再 import index.js；
 * 通过真实路由发 GET/POST，最后读三份文件断言。
 *
 * 运行：node scripts/test-admin-config-api.mjs
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-admin-root-'));
const tempDsh = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-admin-dsh-'));
const tempState = path.join(tempDsh, 'surfcore');
fs.mkdirSync(path.join(tempRoot, 'src'), { recursive: true });
fs.mkdirSync(path.join(tempRoot, 'roles'), { recursive: true });
fs.mkdirSync(tempState, { recursive: true });
fs.writeFileSync(path.join(tempRoot, 'src', 'bridge.js'), '// fixture bridge placeholder\n');
fs.writeFileSync(path.join(tempRoot, 'roles', '角色.md'), '# 角色卡\n\n测试用。\n');
fs.writeFileSync(path.join(tempRoot, 'config.json'), JSON.stringify({
  ownerQQ: '10001',
  allow: { private: ['10001'], groups: [] },
  dsh: { authToken: 'fixture-token' },
  consoleToken: 'fixture-console-token',
}, null, 2));
fs.writeFileSync(path.join(tempState, 'bili.config.json'), JSON.stringify({
  owner: { mid: '20002', name: '测试B站昵称' },
  self: { mid: '20003', name: '测试B站账号' },
}, null, 2));
fs.writeFileSync(path.join(tempState, 'config.json'), JSON.stringify({ version: 1 }, null, 2));

process.env.SURFCORE_ROOT = tempRoot;
process.env.DSH_HOME = tempDsh;
process.env.USERPROFILE = tempDsh;
process.env.SURFCORE_SKIP_AUTOSTART = '1';
process.env.SURFCORE_DISABLE_CHARACTER_MIGRATION = '1';

const { apply } = await import('../lib/index.js');

const routes = [];
const effects = [];
const ctx = {
  webServer: { register(route) { routes.push(route); return () => {}; } },
  get(name) { return name === 'connection' ? { requestRejection: () => false } : null; },
  effect(fn) { effects.push(fn); return () => {}; },
  sessionController: {
    inspect: async () => ({ events: [] }),
    create: async () => ({}),
    prompt: async () => ({ accepted: true }),
  },
  settings: null,
};
apply(ctx);

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers ?? {}; },
    end(body = '') { this.body += body; },
  };
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
async function invoke(method, p, body) {
  const route = routes.find((r) => r.path === '/dsh-surfcore/api');
  const res = fakeRes();
  await route.handler(fakeReq(method, `/dsh-surfcore/api${p}`, body), res);
  return { status: res.statusCode, data: JSON.parse(res.body || '{}') };
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const qqConfigFile = path.join(tempRoot, 'config.json');
const biliConfigFile = path.join(tempState, 'bili.config.json');
const unifiedFile = path.join(tempState, 'config.json');

try {
  // 1) 升级兼容：合体层还没有 admin，GET 必须从旧字段推导出「同一个人」。
  const before = await invoke('GET', '/config');
  assert.equal(before.status, 200);
  assert.deepEqual(before.data.unified.admin.qq, '10001');
  assert.deepEqual(before.data.unified.admin.biliMid, '20002');
  assert.equal(before.data.unified.admin.gentle, false, '温柔模式默认关闭');
  assert.equal(readJson(unifiedFile).admin, undefined, 'GET 只读，不能偷偷写文件');

  // 2) 设置页正常保存（全量 qq/bili/unified，没动管理员）：两份 owner 不能被抹掉。
  const unchanged = await invoke('POST', '/config', {
    qq: readJson(qqConfigFile),
    bili: readJson(biliConfigFile),
    unified: { version: 1, persona: { file: 'roles/角色.md' } },
  });
  assert.equal(unchanged.status, 200);
  assert.equal(readJson(qqConfigFile).ownerQQ, '10001', '正常保存不能丢 ownerQQ');
  assert.equal(readJson(biliConfigFile).owner.mid, '20002', '正常保存不能丢 owner.mid');
  assert.equal(readJson(unifiedFile).admin.qq, '10001', '保存后合体层 admin 要落盘');

  // 2.1 白名单 / 黑名单卡片保存：四个数组直接落盘；重复 / 非法项由 normalizeIdList 收敛。
  //      deny.users 是「人的黑名单」（无论什么群都不响应），必须和 allow.* 一起收敛成纯数字串，
  //      否则桥接侧 senderBlocked() 会因为它带着空格/数字类型而静默失效。
  const whitelist = await invoke('POST', '/config', {
    qq: {
      ...readJson(qqConfigFile),
      allow: { private: ['10001', '10001', 'abc', '20002'], groups: ['123456789', '123456789', 'oops'] },
      deny: { users: ['30003', '30003', 'abc'], private: [40004], groups: ['55555'] },
      allowAllWhenEmpty: false,
    },
    bili: readJson(biliConfigFile),
    unified: { version: 1, persona: { file: 'roles/角色.md' } },
  });
  assert.equal(whitelist.status, 200);
  assert.deepEqual(readJson(qqConfigFile).allow, {
    private: ['10001', '20002'],
    groups: ['123456789'],
  }, '白名单数组应去重并丢弃非法项');
  assert.equal(readJson(qqConfigFile).allowAllWhenEmpty, false);
  assert.deepEqual(readJson(qqConfigFile).deny, {
    users: ['30003'],
    private: ['40004'],
    groups: ['55555'],
  }, '黑名单数组（含人的黑名单 deny.users）应去重、转字符串并丢弃非法项');

  // 2.2 作息窗口（B站 页「苏醒窗口」）：数组必须原样落盘。
  //     2026-10-24 用户反馈加/删/改全部弹回；前端 setPath 曾把 "night.windows" 按字符拆，
  //     服务端这条保存链路当时没被测试覆盖。这里补一条真实的 POST → 文件断言。
  const biliWithWindows = readJson(biliConfigFile);
  biliWithWindows.night = {
    windows: [
      { start: '6:00', end: '8:00', wakes: 3 },
      { start: '20:00', end: '22:00', wakes: 1 },
    ],
    skipChance: 0.2,
  };
  const savedWindows = await invoke('POST', '/config', {
    qq: readJson(qqConfigFile),
    bili: biliWithWindows,
    unified: { version: 1, persona: { file: 'roles/角色.md' } },
  });
  assert.equal(savedWindows.status, 200);
  assert.deepEqual(readJson(biliConfigFile).night.windows, biliWithWindows.night.windows, '作息窗口数组必须原样落盘');
  assert.equal(readJson(biliConfigFile).night.skipChance, 0.2, '同组其它参数不能被窗口保存截断');

  // 3) 管理员卡片两处一起改：三份文件必须同时变成同一个人。
  const edited = await invoke('POST', '/config', {
    qq: { ...readJson(qqConfigFile), sendDelayMs: 321 },
    bili: readJson(biliConfigFile),
    unified: {
      version: 1,
      admin: { qq: '100001', biliMid: '200002', biliName: '新主人', displayName: '新称呼', gentle: true },
    },
  });
  assert.equal(edited.status, 200);
  assert.equal(readJson(qqConfigFile).ownerQQ, '100001', '管理员卡片改 QQ 要落到 config.json');
  assert.equal(readJson(qqConfigFile).sendDelayMs, 321, '其它 QQ 参数不能被截断');
  assert.equal(readJson(biliConfigFile).owner.mid, '200002', '管理员卡片改 B站 UID 要落到 bili.config.json');
  assert.equal(readJson(biliConfigFile).owner.name, '新主人');
  assert.deepEqual(readJson(unifiedFile).admin, {
    qq: '100001', biliMid: '200002', biliName: '新主人', displayName: '新称呼', gentle: true,
  });

  // 4) 关掉温柔模式：只影响提示词，身份仍然保留。
  const mild = await invoke('POST', '/config', {
    qq: readJson(qqConfigFile),
    bili: readJson(biliConfigFile),
    unified: { ...readJson(unifiedFile), admin: { ...readJson(unifiedFile).admin, gentle: false } },
  });
  assert.equal(mild.status, 200);
  assert.equal(readJson(unifiedFile).admin.gentle, false);
  assert.equal(readJson(qqConfigFile).ownerQQ, '100001');

  // 5) overview 里要有管理员摘要，供概览/诊断看。
  const overview = await invoke('GET', '/overview');
  assert.equal(overview.data.admin.qq, '100001');
  assert.equal(overview.data.admin.aligned, true);
  assert.equal(overview.data.admin.gentle, false);

  // 6) 非法号码不能进配置：保存时会被丢弃，不会把 owner 写成乱码。
  await invoke('POST', '/config', {
    qq: readJson(qqConfigFile),
    bili: readJson(biliConfigFile),
    unified: { ...readJson(unifiedFile), admin: { ...readJson(unifiedFile).admin, qq: 'abc' } },
  });
  const afterBad = readJson(unifiedFile).admin;
  assert.equal(afterBad.qq, '', '非法 QQ 必须被收敛成空串');
  assert.equal(readJson(qqConfigFile).ownerQQ, null, '非法 QQ 不能写进 ownerQQ');

  console.log('admin config API tests OK');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const fn of effects) {
    try {
      const dispose = fn();
      if (typeof dispose === 'function') dispose();
    } catch {}
  }
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(tempDsh, { recursive: true, force: true }); } catch {}
}
// 定时器/调度器可能还挂着 60s tick，测完必须主动退出（退出码反映断言结果）。
process.exit(process.exitCode ?? 0);
