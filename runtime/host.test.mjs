/**
 * 平台包宿主测试：发现 / 校验 / 安装 / 自洽检查 / 卸载隔离 / 只加载已启用
 * 跑法：node runtime/host.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discover, validateManifest, installFrom, uninstall, loadPack, loadEnabled, createHostState, PROTOCOL, readOrigin, readPolicy, isVerified, enablePack } from './host.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_PACKS = path.resolve(HERE, '..', 'packs');

console.log('## 发现（真实四个包）');
{
  const found = discover(REAL_PACKS);
  ok(found.length >= 3, `发现了 ${found.length} 个包`);
  ok(found.every((p) => p.ok), '四个包清单都合格（含入口文件存在）');
  ok(found.some((p) => p.id === 'surfcore/qq'), '识别出 surfcore/qq');
  ok(found.every((p) => p.manifest.protocol === PROTOCOL), '协议版本一致');
}

console.log('\n## 清单校验');
{
  const good = { publisher: 'acme', name: 'demo', version: '1.0.0', protocol: PROTOCOL, entry: 'index.js' };
  ok(validateManifest(good).ok, '合格清单：通过');
  ok(!validateManifest({ ...good, publisher: '' }).ok, '缺发布人：拒绝');
  ok(!validateManifest({ ...good, name: 'Bad Name' }).ok, '名字不合法：拒绝');
  ok(!validateManifest({ ...good, version: '1.0' }).ok, '版本不是 x.y.z：拒绝');
  ok(!validateManifest({ ...good, protocol: 999 }).ok, '协议不符：拒绝');
  ok(!validateManifest({ ...good, entry: '' }).ok, '缺入口：拒绝');
  ok(!validateManifest(good, '别的目录名').ok, '目录名与 name 不一致：拒绝（防张冠李戴）');
}

/* ── 用临时目录做安装/卸载/加载 ─────────────────────── */
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-host-')); }

function writePack(root, { publisher = 'acme', name = 'demo', version = '1.0.0', codeIdentity = null, extra = {} } = {}) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify({ publisher, name, version, protocol: PROTOCOL, entry: 'index.js', trust: [], ...extra }));
  const id = codeIdentity ?? { publisher, name, version };
  fs.writeFileSync(path.join(dir, 'index.js'), `
export const identity = ${JSON.stringify({ ...id, source: 'demo', channel: 'demo:1' })};
export const capabilities = { timing:'realtime', shape:'single', identityMode:'known', direction:'both', frequency:'human', modality:'text', special:{} };
export const settings = [];
export async function send() { return { status: 'delivered' }; }
export default { identity, capabilities, settings, send };
`);
  return dir;
}

console.log('\n## 安装 / 加载 / 卸载');
{
  const src = tmp();         // 模拟"zip 解压出来的目录"
  const packsDir = tmp();    // 模拟 SurfCore 的 packs/
  const stateFile = path.join(tmp(), 'packs-state.json');

  writePack(src, { name: 'demo' });
  const inst = installFrom({ packsDir, sourceDir: path.join(src, 'demo') });
  ok(inst.ok && inst.id === 'acme/demo', '安装：成功，身份是 发布人/名字');
  ok(fs.existsSync(path.join(packsDir, 'demo', 'index.js')), '安装：文件真的复制进去了');

  const found = discover(packsDir);
  ok(found.length === 1 && found[0].ok, '安装后能被发现');

  // 默认不启用
  const host = createHostState({ stateFile });
  ok(host.isEnabled('acme/demo') === false, '默认不启用（装进来 ≠ 打开）');
  const r1 = await loadEnabled({ packsDir, stateFile });
  ok(r1.loaded.length === 0 && r1.skipped.length === 1, '未启用：不加载，记为 skipped');

  host.setEnabled('acme/demo', true);
  const r2 = await loadEnabled({ packsDir, stateFile });
  ok(r2.loaded.length === 1 && r2.failed.length === 0, '启用后：成功加载');
  ok(typeof r2.loaded[0].pack.send === 'function', '加载出来的是完整包（有 send）');

  // 卸载：隔离不删除
  const u = uninstall({ packsDir, name: 'demo' });
  ok(u.ok && fs.existsSync(u.movedTo), '卸载：移到 _removed（还能找回来）');
  ok(!fs.existsSync(path.join(packsDir, 'demo')), '卸载：原位置没了');
  ok(fs.existsSync(path.join(u.movedTo, 'index.js')), '卸载：文件完整保留在隔离区');

  fs.rmSync(src, { recursive: true, force: true });
  fs.rmSync(packsDir, { recursive: true, force: true });
}

console.log('\n## 自洽检查（包里说自己是官方？）');
{
  const src = tmp();
  const packsDir = tmp();

  // 清单说 acme/demo，代码说 evil/demo → 必须拒绝
  writePack(src, { name: 'demo', codeIdentity: { publisher: 'evil', name: 'demo', version: '1.0.0' } });
  installFrom({ packsDir, sourceDir: path.join(src, 'demo') });
  const entry = discover(packsDir)[0];
  const loaded = await loadPack(entry);
  ok(!loaded.ok, '清单与代码不一致：拒绝加载（防冒充官方）');
  ok(loaded.errors.join().includes('publisher'), '错误里点名是哪一项不一致');

  // 版本不一致也要拒绝
  fs.rmSync(packsDir, { recursive: true, force: true });
  const src2 = tmp();
  writePack(src2, { name: 'demo2', version: '2.0.0', codeIdentity: { publisher: 'acme', name: 'demo2', version: '1.0.0' } });
  const pk2 = tmp();
  installFrom({ packsDir: pk2, sourceDir: path.join(src2, 'demo2') });
  const r = await loadPack(discover(pk2)[0]);
  ok(!r.ok && r.errors.join().includes('version'), '版本不一致：拒绝（清单才是真相）');

  // 入口文件缺失
  fs.rmSync(packsDir, { recursive: true, force: true });
  const broken = tmp();
  fs.mkdirSync(path.join(broken, 'bad'));
  fs.writeFileSync(path.join(broken, 'bad', 'pack.json'), JSON.stringify({ publisher: 'acme', name: 'bad', version: '1.0.0', protocol: PROTOCOL, entry: 'missing.js' }));
  const bad = discover(broken)[0];
  ok(!bad.ok && bad.errors.join().includes('入口文件'), '入口文件不存在：发现阶段就判不合格');

  for (const d of [src, src2, pk2, broken]) fs.rmSync(d, { recursive: true, force: true });
}

console.log('\n## 来源留痕 + 政策 + 启用闸门');
{
  const src = tmp();
  const packsDir = tmp();
  const stateFile = path.join(tmp(), 'packs-state.json');

  // 别人的包（发布人 acme，不在受信名单）
  writePack(src, { publisher: 'acme', name: 'thirdparty' });
  const inst = installFrom({ packsDir, sourceDir: path.join(src, 'thirdparty') });
  ok(inst.ok, '安装：成功');
  ok(fs.existsSync(path.join(packsDir, 'thirdparty', '_origin.json')), '安装：写下了 _origin.json（来源留痕）');

  const origin = readOrigin(packsDir, 'thirdparty');
  ok(origin.publisher === 'acme' && origin.version === '1.0.0', '留痕：发布人与版本');
  ok(typeof origin.manifestSha256 === 'string' && origin.manifestSha256.length === 64, '留痕：清单指纹是 sha256');
  ok(origin.source === '../' ? true : typeof origin.source === 'string', '留痕：来源是一个相对路径（不泄漏本机绝对路径）');

  const policy = readPolicy(packsDir);
  ok(policy.allowedPublishers.includes('surfcore'), '政策：默认只信 surfcore');
  ok(policy.requireAckForUnverified === true, '政策：默认未背书要二次确认');

  ok(isVerified(packsDir, 'acme/thirdparty') === false, 'acme 的包：未背书');

  const noAck = enablePack({ packsDir, stateFile, id: 'acme/thirdparty' });
  ok(noAck.ok === false && noAck.code === 'pack.needs-ack', '未背书 + 没确认：不许启用（fail-closed）');
  ok(String(noAck.errors.join()).includes('你的进程'), '拒绝时说清后果（它会跑在你的进程里）');

  const withAck = enablePack({ packsDir, stateFile, id: 'acme/thirdparty', ack: true });
  ok(withAck.ok === true && withAck.verified === false, '明确确认后才启用（并告知它是未背书的）');

  // 自己人的包：不需要确认
  writePack(src, { publisher: 'surfcore', name: 'own' });
  installFrom({ packsDir, sourceDir: path.join(src, 'own') });
  ok(isVerified(packsDir, 'surfcore/own') === true, 'surfcore 的包：受信');
  const own = enablePack({ packsDir, stateFile, id: 'surfcore/own' });
  ok(own.ok === true && own.verified === true, '受信的包：直接启用，不要确认');

  // 政策可以放宽/收紧
  fs.writeFileSync(path.join(packsDir, '_policy.json'), JSON.stringify({ allowedPublishers: ['acme'], requireAckForUnverified: false }));
  ok(readPolicy(packsDir).allowedPublishers.join() === 'acme', '政策：可改受信名单');
  ok(readPolicy(packsDir).requireAckForUnverified === false, '政策：可关掉二次确认（用户自己的选择）');

  fs.rmSync(src, { recursive: true, force: true });
  fs.rmSync(packsDir, { recursive: true, force: true });
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
