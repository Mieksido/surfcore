/**
 * B站评论区监听（scheduler.listenTick）回归 —— 每 5 分钟报 `Cannot access 'L' before initialization`。
 *
 * 现象：插件日志里 `[bili-whale] 监听失败：Cannot access 'L' before initialization` 每 5 分钟一条，
 * B站「回找我的人 / @我」的监听从来没有真正工作过。
 *
 * 根因：listenTick 里外层 `const L = cfg.listen ?? {}`，而同一个 try 块后半段又写了
 * `const L = limitsNow()`。块级 const 的作用域是整个块，所以块里前面所有对 L 的读取
 * （`L.scope`、`L.onlyOwner`）读到的是后面那个还没初始化的 L → 暂时性死区。
 * 更糟的是它发生在 `pullFeed()` 之后：每次都白拉一次 B站收件箱再抛错。
 *
 * 钉住：
 *   1. 首次运行（没有基线）：不报错，只记下基线（lastSeen），不叫醒；
 *   2. 有新回复：不报错，叫醒了她，提示词里的额度是真实数字（不是 undefined）；
 *   3. 「只听主人」(listen.onlyOwner) 时别人的回复被过滤，不叫醒；
 *   4. 源码里 listenTick 不能再在同一个块里重复声明 L（防回退）。
 *
 * 不连真 B站 / DSH：fetch 与 sessionController 都是桩。运行：node scripts/test-scheduler-listen.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-listen-'));
const dshHome = path.join(tmp, '.dsh');
// 全部状态落在临时目录：不碰真实的 ~/.dsh。
process.env.DSH_HOME = dshHome;
process.env.USERPROFILE = tmp;
process.env.HOME = tmp;
process.env.SURFCORE_BILI_CONFIG = path.join(dshHome, 'surfcore', 'bili.config.json');

const { startScheduler } = await import('../plugins/surfcore/lib/scheduler.js');

let failures = 0;
async function test(name, run) {
  try { await run(); console.log('PASS', name); }
  catch (error) { failures++; console.error('FAIL', name, error.stack?.split('\n').slice(0, 3).join(' | ') ?? error.message); }
}

const cfgFile = path.join(dshHome, 'surfcore', 'bili.config.json');
const credFile = path.join(dshHome, 'surfcore', 'bili', 'credentials.json');
fs.mkdirSync(path.dirname(credFile), { recursive: true });
fs.writeFileSync(credFile, JSON.stringify({ sessdata: 'x', bili_jct: 'x', buvid3: 'x' }));

function writeConfig(listen, owner = { mid: '111111' }) {
  fs.writeFileSync(cfgFile, JSON.stringify({ listen: { comment: true, allDay: true, commentIntervalSec: 60, ...listen }, owner }));
}

/** 假的 B站 msgfeed：reply 收件箱里放 items，at 收件箱为空。 */
function stubFetch(items) {
  globalThis.fetch = async (url) => {
    const kind = String(url).includes('/msgfeed/at') ? 'at' : 'reply';
    const body = { code: 0, data: { last_view_at: 0, items: kind === 'reply' ? items : [], cursor: '' } };
    return { json: async () => body };
  };
}
const reply = (id, t, mid, who = '路人') => ({
  id, reply_time: t, user: { nickname: who, mid },
  item: { uri: 'https://www.bilibili.com/video/av123', subject_id: 123, root_id: 9, source_id: 10, source_content: '你好呀', business_id: 1 },
});

function makeScheduler() {
  const logs = [];
  const prompts = [];
  const ctx = {
    sessionController: {
      inspect: async () => ({}),
      create: async () => ({}),
      prompt: async (args) => { prompts.push(args); return {}; },
    },
  };
  const scheduler = startScheduler(ctx, { dshHome, biliMjs: path.join(here, '..', 'plugins', 'surfcore', 'tools', 'bili.mjs'), cwd: tmp, sessionId: 'listen-test', log: (m) => logs.push(String(m)) });
  return { scheduler, logs, prompts };
}

function listenState() {
  const found = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === 'whale-listen.json') found.push(p); } };
  walk(dshHome);
  return found.length ? JSON.parse(fs.readFileSync(found[0], 'utf8')) : null;
}
function setListenState(lastSeen) {
  const found = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === 'whale-listen.json') found.push(p); } };
  walk(dshHome);
  const target = found[0] ?? path.join(dshHome, 'surfcore', 'bili', 'whale-listen.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify({ lastSeen }));
}

await test('首次运行：不报 TDZ，只记下基线，不叫醒', async () => {
  writeConfig({});
  stubFetch([reply('1', 1_700_000_100, '222222')]);
  const { scheduler, logs, prompts } = makeScheduler();
  try {
    await scheduler.listenTick();
    assert.deepEqual(logs.filter((m) => m.includes('监听失败')), [], logs.join('\n'));
    assert.equal(prompts.length, 0);
    assert.ok(Number(listenState()?.lastSeen) > 0, '应该写下基线 lastSeen');
  } finally { scheduler.stop(); }
});

await test('有新回复：不报错，叫醒了她，提示词里的额度是真实数字', async () => {
  writeConfig({});
  setListenState(1_700_000_000);
  stubFetch([reply('2', 1_700_000_500, '222222', '路人甲')]);
  const { scheduler, logs, prompts } = makeScheduler();
  try {
    await scheduler.listenTick();
    assert.deepEqual(logs.filter((m) => m.includes('监听失败')), [], logs.join('\n'));
    assert.equal(prompts.length, 1, '应该叫醒一次');
    const text = prompts[0].content[0].text;
    assert.match(text, /路人甲/);
    assert.match(text, /「回找我的人」\d+ 条\/天/, '回复额度必须是数字');
    assert.match(text, /每类 \d+ 条\/天 · 每人 \d+ 条/, '动态回复额度必须是数字');
    assert.ok(!text.includes('undefined'), '提示词里不能有 undefined');
    assert.ok(logs.some((m) => m.includes('监听命中 1 条')), logs.join('\n'));
  } finally { scheduler.stop(); }
});

await test('listen.onlyOwner：别人的回复被过滤，不叫醒；主人的回复才叫醒', async () => {
  writeConfig({ onlyOwner: true });
  setListenState(1_700_000_000);
  stubFetch([reply('3', 1_700_000_600, '222222', '路人乙')]);
  let s = makeScheduler();
  try {
    await s.scheduler.listenTick();
    assert.deepEqual(s.logs.filter((m) => m.includes('监听失败')), [], s.logs.join('\n'));
    assert.equal(s.prompts.length, 0, '别人的回复不该叫醒');
  } finally { s.scheduler.stop(); }

  stubFetch([reply('4', 1_700_000_700, '111111', '主人')]);
  s = makeScheduler();
  try {
    await s.scheduler.listenTick();
    assert.equal(s.prompts.length, 1, '主人的回复应该叫醒');
    assert.deepEqual(s.logs.filter((m) => m.includes('监听失败')), [], s.logs.join('\n'));
  } finally { s.scheduler.stop(); }
});

await test('防回退：listenTick 的同一个块里不能重复声明 L', async () => {
  const src = fs.readFileSync(path.join(here, '..', 'plugins', 'surfcore', 'lib', 'scheduler.js'), 'utf8');
  const start = src.indexOf('async function listenTick()');
  const end = src.indexOf('async function liveTick()', start);
  assert.ok(start > 0 && end > start, '找不到 listenTick');
  const NL = String.fromCharCode(10);
  const body = src.slice(start, end).split(NL).filter((line) => !line.trim().startsWith('//')).join(NL);   // 注释里提到 const L 不算
  const lets = body.match(/\bconst L\b|\blet L\b/g) ?? [];
  assert.equal(lets.length, 1, `listenTick 里声明了 ${lets.length} 个 L（同一个 try 块里再声明会触发暂时性死区）`);
});

fs.rmSync(tmp, { recursive: true, force: true });
if (failures) {
  console.error(`\n${failures} 项失败`);
  process.exit(1);
}
console.log('\n全部通过');
process.exit(0);
