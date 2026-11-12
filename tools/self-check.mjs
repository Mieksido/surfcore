/**
 * 自检：一条命令看清"这套东西现在能不能跑"
 * ============================================================================
 * 位置：开发期工具（不进本体）。它只**读**，不改任何东西。
 * 目的：把"出问题时该看哪"变成一份可复制的清单，而不是靠记忆。
 *
 * 跑法：node tools/self-check.mjs
 * 退出码：0 = 全部正常；1 = 有阻塞项；2 = 只有提醒
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { discover, loadPack } from '../runtime/host.js';
import { createKernel } from '../kernel/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const blocking = [];
const warnings = [];

const line = (t) => console.log(`\n=== ${t} ===`);
const pass = (m) => console.log(`  ✅ ${m}`);
const warn = (m) => { warnings.push(m); console.log(`  ⚠ ${m}`); };
const fail = (m) => { blocking.push(m); console.log(`  ❌ ${m}`); };

/* ── 1. 运行环境 ── */
line('运行环境');
const major = Number(process.versions.node.split('.')[0]);
if (major >= 20) pass(`Node ${process.versions.node}`);
else fail(`Node 太老（${process.versions.node}）：需要 20+`);

try { fs.accessSync(ROOT, fs.constants.W_OK); pass('工作树可写'); }
catch { fail('工作树不可写：状态存不下来'); }

/* ── 2. 本体边界 ── */
line('本体边界');
const core = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'core-check.mjs')], { cwd: ROOT, encoding: 'utf8' });
if (core.status === 0) pass('本体干净（无二进制 / 不依赖扩展 / 无渠道名 / 不含平台包）');
else fail(`本体检查未过：${`${core.stdout ?? ''}${core.stderr ?? ''}`.trim().split(/\r?\n/).pop()}`);

/* ── 3. 平台包 ── */
line('平台包');
const packsDir = path.join(ROOT, 'packs');
const found = discover(packsDir);
if (!found.length) warn('packs/ 里没有包：只能跑终端演示');
for (const p of found) {
  if (!p.ok) { fail(`${p.dirName} 清单不合格：${(p.errors ?? []).join('；')}`); continue; }
  const loaded = await loadPack(p);
  if (!loaded.ok) { fail(`${p.id} 加载失败：${(loaded.errors ?? []).join('；')}`); continue; }
  pass(`${p.id}@${p.manifest.version}（${(() => { try { return fs.readdirSync(p.dir).length; } catch { return '?'; } })()} 个文件）`);
}

/* ── 4. 内核自检（不启动世界） ── */
line('内核自检');
try {
  const k = createKernel({ now: () => 1000, persona: { name: '自检', core: 'c' }, admin: 'o' });
  const r = k.handle(
    { from: { channel: 'selfcheck:1', kind: 'private', actor: 'o', at: 1000 }, text: '自检一下', to: { owner: true } },
    { channelId: 'selfcheck:1', kind: 'private', isOwner: true },
  );
  if (r && typeof r.wake === 'boolean') pass('内核能处理一条事件（无需模型/网络）');
  else fail('内核返回形状不对：handle 没有返回 wake');
  const st = k.snapshot();
  if (st && typeof st.records === 'number') pass(`内核快照可读（记忆 ${st.records} / 模式 ${st.mode}）`);
  else fail('内核快照不可读');
} catch (error) {
  fail(`内核自检抛错：${error?.message ?? error}`);
}

/* ── 5. 状态目录 ── */
line('状态目录');
const dir = path.join(ROOT, 'state', 'persona-core');
if (fs.existsSync(dir)) {
  pass(`已存在：${path.relative(ROOT, dir).replace(/\\/g, '/')}`);
  const bad = fs.readdirSync(dir).filter((n) => n.endsWith('.json') && (() => {
    try { JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8').replace(/^\uFEFF/, '')); return false; } catch { return true; }
  })());
  if (bad.length) fail(`状态文件损坏：${bad.join(', ')}（启动会进入只读降级）`);
  else pass('状态文件都是合法 JSON');
} else {
  warn('还没有状态目录（首次保存时创建）');
}

/* ── 6. 门禁 ── */
line('门禁');
const gate = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'run-all.mjs')], { cwd: ROOT, encoding: 'utf8' });
const gateTail = `${gate.stdout ?? ''}${gate.stderr ?? ''}`.trim().split(/\r?\n/).pop() ?? '';
if (gate.status === 0) pass(`六道门禁全过（${gateTail}）`);
else fail(`门禁未过：${gateTail}`);

/* ── 汇总 ── */
console.log('\n=== 结论 ===');
if (!blocking.length && !warnings.length) console.log('  ✅ 一切正常，可以直接跑 `npm run surfcore:chat`');
else {
  if (blocking.length) { console.log(`  ❌ 阻塞 ${blocking.length} 项：`); for (const b of blocking) console.log(`     - ${b}`); }
  if (warnings.length) { console.log(`  ⚠ 提醒 ${warnings.length} 项：`); for (const w of warnings) console.log(`     - ${w}`); }
}
process.exit(blocking.length ? 1 : (warnings.length ? 2 : 0));
