#!/usr/bin/env node
/**
 * 严格的版本号管理（单一真相：仓库根 package.json 的 version）。
 *
 *   node scripts/version.mjs show                 # 版本矩阵（本仓库 + 兄弟仓库）
 *   node scripts/version.mjs check                # 一致性校验（CI / 提交前跑）
 *   node scripts/version.mjs bump patch|minor|major|rc
 *   node scripts/version.mjs tag [--push]         # 打 v{version} 注释 tag
 *
 * 规则（详见 docs/guides/VERSIONS.md）：
 *   1. 版本号只写在根 package.json；plugins/surfcore/package.json 必须与之相同；
 *   2. 代码里不许硬编码版本（index.js 从 package.json 读）；
 *   3. 发布 = 打 tag；tag 必须等于 v{version}，且 tag 之后不能有未发布提交；
 *   4. 0.x 阶段：minor = 破坏性/大功能，patch = 修复/小功能。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const ROOT_PKG = path.join(ROOT, 'package.json');
const PLUGIN_PKG = path.join(ROOT, 'plugins', 'surfcore', 'package.json');
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-(rc|beta|alpha|dev)\.(\d+))?$/;

const argv = process.argv.slice(2);
const cmd = argv[0] || 'show';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    if (allowFail) return '';
    throw error;
  }
}

function isGitRepo() {
  return fs.existsSync(path.join(ROOT, '.git'));
}

function latestTag() {
  if (!isGitRepo()) return '';
  return git(['describe', '--tags', '--abbrev=0'], { allowFail: true });
}

function commitsSince(tag) {
  if (!isGitRepo() || !tag) return [];
  const out = git(['log', '--oneline', `${tag}..HEAD`], { allowFail: true });
  return out ? out.split('\n').filter(Boolean) : [];
}

function compareVersion(a, b) {
  const pa = a.split('-')[0].split('.').map(Number);
  const pb = b.split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0) ? 1 : -1;
  }
  return 0;
}

function show() {
  const root = readJson(ROOT_PKG);
  const plugin = readJson(PLUGIN_PKG);
  const tag = latestTag();
  const ahead = commitsSince(tag);
  console.log(`SurfCore            v${root.version}`);
  console.log(`  插件 package.json  v${plugin.version}${plugin.version === root.version ? '' : '  ← 不一致！'}`);
  console.log(`  最新 tag           ${tag || '(还没有 tag)'}${tag && tag !== `v${root.version}` ? `  ← 与 v${root.version} 不一致` : ''}`);
  console.log(`  tag 之后提交       ${ahead.length} 个${ahead.length ? '  ← 需要 bump 并打 tag' : ''}`);

  const siblings = [
    ['surfvoicelocal', path.resolve(ROOT, '..', 'voice', 'packages', 'voice-local')],
    ['surfvoicecloud', path.resolve(ROOT, '..', 'voice', 'packages', 'voice-cloud')],
    ['surfpet', path.resolve(ROOT, '..', 'pet')],
  ];
  for (const [name, dir] of siblings) {
    const pkg = path.join(dir, 'package.json');
    const vj = path.join(dir, 'version.json');
    let v = '';
    if (fs.existsSync(pkg)) v = readJson(pkg).version || '';
    else if (fs.existsSync(vj)) v = readJson(vj).version || '';
    if (!v) continue;
    let extra = '';
    if (fs.existsSync(vj) && fs.existsSync(pkg)) {
      try {
        const j = readJson(vj);
        extra = `  version.json v${j.version}${j.version === v ? '' : '  ← 不一致！'}`;
      } catch { extra = '  version.json 读不了'; }
    } else if (fs.existsSync(vj)) {
      extra = '  （无 package.json，版本取自 version.json）';
    }
    console.log(`${name.padEnd(20)}v${v}${extra}`);
  }
}

function check() {
  const errors = [];
  const warnings = [];
  const root = readJson(ROOT_PKG);
  const plugin = readJson(PLUGIN_PKG);

  if (!SEMVER.test(root.version)) errors.push(`根 package.json 版本不是合法 semver：${root.version}`);
  if (plugin.version !== root.version) {
    errors.push(`插件 package.json（${plugin.version}）与根（${root.version}）不一致`);
  }

  // 代码里不许硬编码版本
  const indexFile = path.join(ROOT, 'plugins', 'surfcore', 'lib', 'index.js');
  const indexSrc = fs.readFileSync(indexFile, 'utf8');
  const hard = indexSrc.match(/const VERSION = '\d+\.\d+\.\d+[^']*'/);
  if (hard) errors.push(`index.js 里还硬编码了版本：${hard[0]}`);

  // CHANGELOG 必须有当前版本的小节
  if (!fs.existsSync(CHANGELOG)) {
    warnings.push('没有 CHANGELOG.md');
  } else {
    const log = fs.readFileSync(CHANGELOG, 'utf8');
    if (!log.includes(`## [${root.version}]`) && !log.includes(`## ${root.version}`)) {
      warnings.push(`CHANGELOG.md 里没有 ${root.version} 的小节`);
    }
  }

  // tag 一致性
  if (isGitRepo()) {
    const tag = latestTag();
    if (!tag) {
      warnings.push('仓库还没有任何 tag（首次发布前正常）');
    } else if (tag !== `v${root.version}`) {
      const cmp = compareVersion(root.version, tag.replace(/^v/, ''));
      if (cmp > 0) {
        warnings.push(`已 bump 到 ${root.version}，但最新 tag 还是 ${tag}（记得 tag + push）`);
      } else {
        errors.push(`版本 ${root.version} 落后于最新 tag ${tag}`);
      }
    }
    const ahead = commitsSince(tag);
    if (ahead.length && !tag.startsWith(`v${root.version}`)) {
      warnings.push(`tag ${tag} 之后有 ${ahead.length} 个提交没有发布`);
    }
  }

  for (const w of warnings) console.log(`⚠️  ${w}`);
  for (const e of errors) console.log(`❌ ${e}`);
  if (!errors.length) console.log(`✅ 版本一致：v${root.version}${warnings.length ? '（有警告）' : ''}`);
  process.exit(errors.length ? 1 : 0);
}

function bump(kind) {
  const root = readJson(ROOT_PKG);
  const m = SEMVER.exec(root.version);
  if (!m) {
    console.error(`当前版本不是合法 semver：${root.version}`);
    process.exit(2);
  }
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const pre = m[4];
  const preNum = Number(m[5] || 0);
  let next;
  if (kind === 'major') next = `${major + 1}.0.0`;
  else if (kind === 'minor') next = `${major}.${minor + 1}.0`;
  else if (kind === 'patch') next = pre ? `${major}.${minor}.${patch}` : `${major}.${minor}.${patch + 1}`;
  else if (kind === 'rc') {
    if (pre === 'rc') next = `${major}.${minor}.${patch}-rc.${preNum + 1}`;
    else next = `${major}.${minor}.${patch + (pre ? 0 : 1)}-rc.1`;
  } else {
    console.error('用法：bump patch|minor|major|rc');
    process.exit(2);
  }

  root.version = next;
  writeJson(ROOT_PKG, root);
  const plugin = readJson(PLUGIN_PKG);
  plugin.version = next;
  writeJson(PLUGIN_PKG, plugin);

  // README 顶部版本也要跟着 bump，否则 test-version 会红（文档漂移）。
  const readmeFile = path.join(ROOT, 'README.md');
  if (fs.existsSync(readmeFile)) {
    const readme = fs.readFileSync(readmeFile, 'utf8');
    const updated = readme.replace(/(\|\s*版本\s*\|\s*`)[^`]+(`)/, `$1${next}$2`);
    if (updated !== readme) fs.writeFileSync(readmeFile, updated, 'utf8');
  }

  if (fs.existsSync(CHANGELOG)) {
    const log = fs.readFileSync(CHANGELOG, 'utf8');
    if (!log.includes(`## [${next}]`)) {
      const today = new Date().toISOString().slice(0, 10);
      const section = `## [${next}] - ${today}\n\n### 变更\n\n- \n\n`;
      const idx = log.indexOf('## [');
      const out = idx >= 0 ? `${log.slice(0, idx)}${section}${log.slice(idx)}` : `${log}\n${section}`;
      fs.writeFileSync(CHANGELOG, out, 'utf8');
    }
  }

  console.log(`已 bump：${root.version} ← ${m[0]}`);
  console.log(`下一步：\n  1) 补 CHANGELOG 的 ${next} 小节\n  2) git add -A && git commit -m "release: v${next}"\n  3) node scripts/version.mjs tag --push`);
}

function tag() {
  const root = readJson(ROOT_PKG);
  const name = `v${root.version}`;
  const existing = git(['tag', '-l', name], { allowFail: true });
  if (existing) {
    console.log(`tag ${name} 已存在`);
  } else {
    git(['tag', '-a', name, '-m', `SurfCore ${name}`]);
    console.log(`已创建 tag ${name}`);
  }
  if (argv.includes('--push')) {
    git(['push', 'origin', name]);
    console.log(`已推送 ${name}`);
  } else {
    console.log(`推送：git push origin ${name}`);
  }
}

if (cmd === 'show') show();
else if (cmd === 'check') check();
else if (cmd === 'bump') bump(argv[1]);
else if (cmd === 'tag') tag();
else {
  console.error('用法：version.mjs show|check|bump <kind>|tag [--push]');
  process.exit(2);
}
