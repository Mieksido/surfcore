/**
 * 网关导入测试（假 list/extract/hash，不真解压）
 * 跑法：node packs/qq/gateway-import.test.mjs
 */
import { detectGateway, inspectEntries, planGatewayImport, provenanceOf, GATEWAY_PROFILES } from './gateway.js';
import { importGateway } from './gateway-import.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

const SNOW = ['snowluma/release.json', 'snowluma/launcher.bat', 'snowluma/node.exe', 'snowluma/index.mjs', 'snowluma/EULA.md'];

console.log('## 认网关');
{
  const d = detectGateway(SNOW);
  ok(d && d.profile === 'snowluma', '认出 SnowLuma');
  ok(d.entry.endsWith('launcher.bat'), '找到启动器');
  ok(d.runtime.endsWith('node.exe'), '找到自带运行时');
  ok(d.wsHint.startsWith('ws://'), '给出 ws 建议地址');
  ok(detectGateway(['random/file.txt']) === null, '认不出就返回 null（不瞎猜）');
  ok(detectGateway(['sub/snowluma/release.json']).profile === 'snowluma', '嵌一层目录也认');
  ok(GATEWAY_PROFILES.length >= 3, `已知网关 ${GATEWAY_PROFILES.length} 种`);
  ok(d.note.includes('不随包分发'), '画像里写明合规口径');
}

console.log('\n## 安全性：zip slip 与超量');
{
  ok(inspectEntries(SNOW).ok, '正常包：没问题');
  ok(!inspectEntries(['/etc/passwd']).ok, '绝对路径：拒绝');
  ok(!inspectEntries(['C:/windows/system32/x.dll']).ok, '盘符路径：拒绝');
  ok(!inspectEntries(['../../etc/shadow']).ok, '越级：拒绝');
  ok(!inspectEntries(Array(6000).fill('a.txt')).ok, '条目过多：拒绝');
}

console.log('\n## 计划：只算不做');
{
  const p = planGatewayImport({ zipPath: 'D:/x/snow.zip', entries: SNOW, destDir: 'D:/data/gw' });
  ok(p.ok === true, '能出计划');
  ok(p.plan.gateway === 'snowluma' && p.plan.stripPrefix === 'snowluma', '去掉顶层目录');
  ok(p.plan.steps.some((s) => s.includes('你自己启动')), '步骤里写明"导入≠启动"');
  ok(!planGatewayImport({ zipPath: 'x.zip', entries: ['a.txt'], destDir: '' }).ok, '认不出：不给计划');
  ok(planGatewayImport({ entries: SNOW }).error.code === 'gateway.no-file', '没选文件：明确报错');
  ok(planGatewayImport({ zipPath: 'x.zip', entries: ['../evil'], destDir: '' }).error.code === 'gateway.unsafe', '不安全：拒绝');
}

console.log('\n## 导入：解压 + 来源记录');
{
  const calls = [];
  const r = await importGateway({
    zipPath: 'D:/x/snow.zip',
    destDir: 'D:/data/gw/snowluma',
    list: async () => SNOW,
    extract: async (a) => calls.push({ kind: 'extract', ...a }),
    hash: async () => 'abc123',
    now: () => 1000,
    writeProvenance: async (dir, obj) => calls.push({ kind: 'prov', dir, obj }),
  });
  ok(r.ok === true, '导入成功');
  ok(calls[0].kind === 'extract' && calls[0].stripPrefix === 'snowluma', '先解压（去掉顶层目录）');
  ok(calls[1].kind === 'prov' && calls[1].obj.sha256 === 'abc123', '再写来源（含 sha256）');
  ok(calls[1].obj.note.includes('不随包分发'), '来源文件写明合规');
  ok(!calls.some((c) => c.kind === 'start'), '**全程没有启动动作**');
}

console.log('\n## 导入失败：不留半截、不吞错');
{
  const r = await importGateway({
    zipPath: 'D:/x/snow.zip', destDir: 'D:/d',
    list: async () => SNOW,
    extract: async () => { throw new Error('磁盘满了'); },
  });
  ok(r.ok === false && r.error.code === 'gateway.extract-failed', '解压失败：结构化报错');
  ok(String(r.error.message).includes('磁盘满了'), '带原话（便于排查）');

  const bad = await importGateway({ zipPath: 'x', destDir: 'd', list: async () => { throw new Error('不是 zip'); }, extract: async () => {} });
  ok(bad.error.code === 'gateway.unreadable', '读不了：结构化报错');

  const noList = await importGateway({ extract: async () => {} });
  ok(noList.error.code === 'gateway.no-lister', '缺能力：明确说缺什么');
}

console.log('\n## 来源记录的形状');
{
  const prov = provenanceOf({ plan: { gateway: 'snowluma', name: 'SnowLuma', zipPath: 'a.zip' }, sha256: 'x', importedAt: 5 });
  ok(prov.schema === 1, '有 schema 版本');
  ok(prov.importedAt === 5 && prov.sha256 === 'x', '时间与哈希');
  ok(!prov.path && !prov.entry, '不记录"怎么启动"（那是用户的事）');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
