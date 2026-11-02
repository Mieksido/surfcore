// #35 体检规则 COMPAT_CLIENT_MULTI_SOURCE：单包单来源冲突预检。
// 计划 4.5 的场景矩阵：单一来源 / 同名同源重复 / 同包不同来源 / 不同包 /
// 非 web 包 / 相对路径与裸包名 / 子路径说明符 / bundle patch 引入的冲突 /
// 多 patch 来源 / 解析失败（坏 YAML）。
// 同时钉住扫描器盲区修复：patch 声明只认 package.json 的 dsh.bundle.patch
// （字符串或数组；DSH 唯一形式，app-boot profile.ts:58-64）。
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanPluginCompatibility } from '../plugins/surfcore/lib/compat.js';

function makeProfile({ patch = '', packages = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfc-multisrc-'));
  const profile = path.join(root, 'profiles', 'desktop');
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({
    name: 'fixture-profile',
    dsh: { profile: { bundles: Object.keys(packages) } },
  }));
  fs.writeFileSync(path.join(profile, 'cordis.patch.yml'), patch);
  for (const [name, spec] of Object.entries(packages)) {
    const dir = path.join(profile, 'node_modules', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(spec.pkg ?? { name, version: '1.0.0' }));
    for (const [rel, text] of Object.entries(spec.files ?? {})) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), text);
    }
  }
  return { root, profile };
}

const CLIENT_PKG = (name = 'client-a') => ({
  name,
  version: '1.0.0',
  dsh: { client: { platform: 'web', inject: [] } },
});

const scan = (fixture, safeExact = ['ask_user_question', 'x'], safePrefixes = ['mcp__snowluma__']) =>
  scanPluginCompatibility({
    dshHome: fixture.root,
    profileName: 'desktop',
    surfcoreVersion: '0.8.6',
    safeExact,
    safePrefixes,
  });

const multiSourceIssues = (r) => r.issues.filter((i) => i.code === 'COMPAT_CLIENT_MULTI_SOURCE');

test('单一来源：不报告', () => {
  const f = makeProfile({
    packages: { 'client-a': { pkg: CLIENT_PKG() } },
    patch: '- insert:\n    - id: client-a\n      name: client-a\n',
  });
  const r = scan(f);
  assert.equal(multiSourceIssues(r).length, 0);
});

test('同名同来源在 profile patch + bundle patch 重复声明：不误报（cordis 同 id 覆盖合并）', () => {
  const f = makeProfile({
    packages: {
      'client-a': {
        pkg: CLIENT_PKG(),
        files: { 'cordis.patch.yml': '- insert:\n    - id: client-a\n      name: client-a\n' },
      },
    },
    patch: '- id: client-a\n  name: client-a\n',
  });
  const r = scan(f);
  assert.equal(multiSourceIssues(r).length, 0, '同名行重复不算多来源');
});

test('同包不同来源（#35 原始形态）：报告 blocker，带冲突行与修法', () => {
  // 真实 #35 形态：两条行都在 surfcore 的 bundle patch 里（锚定包目录），
  // ./lib/qq-mode.js 的 nearestPackage 上溯落在 surfcore 包。
  const f = makeProfile({
    packages: {
      surfcore: {
        pkg: { ...CLIENT_PKG('surfcore'), main: './lib/index.js', dsh: { client: { platform: 'web', inject: [] }, bundle: { patch: ['./cordis.patch.yml'] } } },
        files: { 'lib/qq-mode.js': 'export const Config = null;\n' },
      },
    },
    patch: '',
  });
  fs.writeFileSync(path.join(f.profile, 'node_modules', 'surfcore', 'cordis.patch.yml'), [
    '- insert:',
    '    - id: surfcore',
    '      name: surfcore',
    '      config: {}',
    '    - id: qq-mode',
    '      name: ./lib/qq-mode.js',
    '      config: {}',
    '',
  ].join('\n'));
  const r = scan(f);
  const issues = multiSourceIssues(r);
  assert.equal(issues.length, 1);
  const issue = issues[0];
  assert.equal(issue.severity, 'blocker');
  assert.equal(issue.confidence, 'confirmed');
  assert.ok(issue.evidence.package === 'surfcore');
  assert.ok(issue.evidence.entries.some((e) => e.id === 'qq-mode' && e.name === './lib/qq-mode.js'));
  assert.ok(issue.evidence.entries.some((e) => e.id === 'surfcore'));
  assert.ok(issue.recommendation.includes('只保留一条'), 'hint 给可执行修法');
  assert.ok(issue.recommendation.includes('qq-mode'), 'hint 指名冲突行');
  assert.ok(issue.impact.includes('#35'), 'impact 说明后果与出处');
  assert.ok(r.ok === false, 'blocker 使体检不通过');
});

test('不同包各自单行：不报告', () => {
  const f = makeProfile({
    packages: { 'client-a': { pkg: CLIENT_PKG('client-a') }, 'client-b': { pkg: CLIENT_PKG('client-b') } },
    patch: '- insert:\n    - id: client-a\n      name: client-a\n    - id: client-b\n      name: client-b\n',
  });
  const r = scan(f);
  assert.equal(multiSourceIssues(r).length, 0);
});

test('非 web 客户端包（无 dsh.client）：不参与判定', () => {
  const f = makeProfile({
    packages: { 'host-only': { pkg: { name: 'host-only', version: '1.0.0' } } },
    patch: '- insert:\n    - id: host-only\n      name: host-only\n    - id: host-only-2\n      name: ./lib/alt.js\n',
  });
  const r = scan(f);
  assert.equal(multiSourceIssues(r).length, 0);
});

test('子路径说明符（守卫行形态）跳过：不报告', () => {
  const f = makeProfile({
    packages: {
      surfcore: {
        pkg: { ...CLIENT_PKG('surfcore'), main: './lib/index.js' },
        files: { 'qq-tool-restrict.mjs': 'export const SAFE = [];\n' },
      },
    },
    patch: '- insert:\n    - id: surfcore\n      name: surfcore\n    - id: qq-tool-restrict\n      name: surfcore/qq-tool-restrict.mjs\n',
  });
  const r = scan(f);
  assert.equal(multiSourceIssues(r).length, 0, 'surfcore/xxx.mjs 是子路径说明符，非包根');
});

test('bundle patch 引入的冲突（profile patch 单行 + bundle patch 多行）：报告', () => {
  const f = makeProfile({
    packages: {
      'client-a': {
        pkg: CLIENT_PKG('client-a'),
        files: {
          // package.json dsh.bundle.patch 数组声明（vision-router 形态）
          'extra.patch.yml': '- insert:\n    - id: client-a-alt\n      name: ./lib/alt.js\n',
        },
      },
    },
    patch: '- id: client-a\n  name: client-a\n',
  });
  f.pkg = JSON.parse(fs.readFileSync(path.join(f.profile, 'node_modules', 'client-a', 'package.json'), 'utf8'));
  f.pkg.dsh.bundle = { patch: ['./extra.patch.yml'] };
  fs.writeFileSync(path.join(f.profile, 'node_modules', 'client-a', 'package.json'), JSON.stringify(f.pkg));
  fs.mkdirSync(path.join(f.profile, 'node_modules', 'client-a', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(f.profile, 'node_modules', 'client-a', 'lib', 'alt.js'), 'x\n');
  const r = scan(f);
  const issues = multiSourceIssues(r);
  assert.equal(issues.length, 1, 'bundle patch 里的第二条行被扫到');
  assert.ok(issues[0].evidence.entries.some((e) => e.id === 'client-a-alt'));
  assert.ok(issues[0].evidence.entries.some((e) => String(e.sources[0]).includes('extra.patch.yml')), '来源标到具体文件');
});

test('dsh.bundle.patch 字符串声明形式：同样被扫到', () => {
  const f = makeProfile({
    packages: {
      'client-a': {
        pkg: CLIENT_PKG('client-a'),
        files: { 'extra.patch.yml': '- insert:\n    - id: client-a-alt\n      name: ./lib/alt.js\n' },
      },
    },
    patch: '- id: client-a\n  name: client-a\n',
  });
  const pkgFile = path.join(f.profile, 'node_modules', 'client-a', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  pkg.dsh.bundle = { patch: 'extra.patch.yml' };
  fs.writeFileSync(pkgFile, JSON.stringify(pkg));
  fs.mkdirSync(path.join(f.profile, 'node_modules', 'client-a', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(f.profile, 'node_modules', 'client-a', 'lib', 'alt.js'), 'x\n');
  const r = scan(f);
  assert.equal(multiSourceIssues(r).length, 1);
});

test('坏 YAML 的 bundle patch：不崩溃、不冒充已确认（coverage.unchecked 记录）', () => {
  const f = makeProfile({
    packages: {
      'client-a': {
        pkg: CLIENT_PKG('client-a'),
        files: { 'broken.patch.yml': '::: not-yaml {{{' },
      },
    },
    patch: '- id: client-a\n  name: client-a\n',
  });
  const pkgFile = path.join(f.profile, 'node_modules', 'client-a', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  pkg.dsh.bundle = { patch: 'broken.patch.yml' };
  fs.writeFileSync(pkgFile, JSON.stringify(pkg));
  const r = scan(f);
  assert.equal(multiSourceIssues(r).length, 0, '解析不了的内容不制造 confirmed 冲突');
  assert.ok(r.coverage.unchecked.some((x) => x.includes('Loader 来源')), '覆盖范围如实标注');
});

test('真实仓库自检：surfcore 自身 patch 只有一条 surfcore 行（PR1 后的现场）', () => {
  const repo = path.resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..');
  const r = scanPluginCompatibility({
    dshHome: process.env.DSH_HOME || path.join(process.env.USERPROFILE || os.homedir(), '.dsh'),
    profileName: '',
    surfcoreVersion: '0.8.6',
  });
  assert.ok(!r.issues.some((i) => i.code === 'COMPAT_CLIENT_MULTI_SOURCE'),
    `真实 profile 不应再报多来源：${JSON.stringify(multiSourceIssues(r))}`);
  void repo;
});
