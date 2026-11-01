#!/usr/bin/env node
/**
 * 发布 dev（测试）构建：从 **dev 分支当前 HEAD** 打一个 Pre-release。
 *
 * 规则（2026-11-01 用户定）：
 *   · 正式版 0.8.6 不变；dev 构建号是 0.8.6-dev.1 / dev.2 / …（同号下低于正式版）；
 *   · 只发 GitHub Pre-release；/releases/latest 天然忽略它，稳定用户不会被弹窗；
 *   · 不合并 main、不改 main；测试机把更新通道选成 dev 才会看到。
 *
 * 用法：
 *   GH_TOKEN=... node scripts/publish-dev.mjs [owner/repo] [--yes]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const repoArg = args.find((a) => a.includes('/')) || 'Mieksido/surfcore';
const yes = args.includes('--yes');
const token = process.env.GH_TOKEN;
if (!token) { console.error('缺少 GH_TOKEN'); process.exit(2); }

const dir = process.cwd();
const git = (...argv) => execFileSync('git', argv, { cwd: dir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();
const gitBuf = (...argv) => execFileSync('git', argv, { cwd: dir, maxBuffer: 256 * 1024 * 1024 });

async function api(method, urlPath, body) {
  const res = await fetch(`https://api.github.com${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'surfcore-dev-publish',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) throw new Error(`${method} ${urlPath} → HTTP ${res.status}: ${json?.message || text.slice(0, 200)}`);
  return json;
}

function fail(msg) { console.error(`✗ ${msg}`); process.exit(1); }

if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'dev') fail('必须在 dev 分支上发布 dev 构建');
if (git('status', '--porcelain')) fail('工作区不干净：先提交或 stash（dev 构建要求可复现）');

const rootPkgPath = path.join(dir, 'package.json');
const pluginPkgPath = path.join(dir, 'plugins', 'surfcore', 'package.json');
const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
const core = String(rootPkg.version || '').split('-')[0];
if (!/^\d+\.\d+\.\d+$/.test(core)) fail(`当前版本不是 x.y.z：${rootPkg.version}`);

const releases = await api('GET', `/repos/${repoArg}/releases?per_page=100`);
let maxN = 0;
for (const r of Array.isArray(releases) ? releases : []) {
  const m = new RegExp(`^v?${core.replace(/\./g, '\\.')}-dev\\.(\\d+)$`).exec(String(r.tag_name ?? ''));
  if (m) maxN = Math.max(maxN, Number(m[1]));
}
const nextN = maxN + 1;
const devVersion = `${core}-dev.${nextN}`;
const tag = `v${devVersion}`;
console.log(`将发布 ${tag}（base ${core}，上一个 dev #${maxN}）`);
if (!yes) console.log('（加 --yes 直接执行；本脚本会改 package.json 并提交到 dev）');

// 1) 改版本 → 提交 → 从 HEAD 生成清单 → amend
rootPkg.version = devVersion;
fs.writeFileSync(rootPkgPath, `${JSON.stringify(rootPkg, null, 2)}\n`, 'utf8');
const pluginPkg = JSON.parse(fs.readFileSync(pluginPkgPath, 'utf8'));
pluginPkg.version = devVersion;
fs.writeFileSync(pluginPkgPath, `${JSON.stringify(pluginPkg, null, 2)}\n`, 'utf8');
git('add', 'package.json', 'plugins/surfcore/package.json');
git('-c', 'core.safecrlf=false', 'commit', '-q', '-m', `build(dev): ${tag}`);
execFileSync(process.execPath, ['scripts/release-manifest.mjs'], { cwd: dir, stdio: 'inherit' });
git('add', 'release/install-manifest.json');
git('-c', 'core.safecrlf=false', 'commit', '-q', '--amend', '--no-edit');

// 2) 本地校验
const verify = execFileSync(process.execPath, ['scripts/release-manifest.mjs', '--verify-ref', 'HEAD'], { cwd: dir, encoding: 'utf8' });
if (!/问题 0 个/.test(verify)) fail(`清单校验失败：\n${verify}`);

// 3) 全量上传（dev 分支不走 --since：本地没有远端 dev 树对象）
const refMain = await api('GET', `/repos/${repoArg}/git/ref/heads/main`).catch(() => null);
let refDev = await api('GET', `/repos/${repoArg}/git/ref/heads/dev`).catch(() => null);
const parent = refDev?.object?.sha || refMain?.object?.sha;
if (!parent) fail('远端既没有 dev 也没有 main 分支');

const files = git('-c', 'core.quotePath=false', 'ls-files').split(/\r?\n/).filter(Boolean);
console.log(`上传 ${files.length} 个文件…`);
const entries = [];
let i = 0;
for (const rel of files) {
  const buf = gitBuf('show', `HEAD:${rel}`);
  const blob = await api('POST', `/repos/${repoArg}/git/blobs`, { content: buf.toString('base64'), encoding: 'base64' });
  entries.push({ path: rel, mode: '100644', type: 'blob', sha: blob.sha });
  i += 1;
  if (i % 100 === 0) console.log(`  …${i}/${files.length}`);
}
const tree = await api('POST', `/repos/${repoArg}/git/trees`, { tree: entries });
const commit = await api('POST', `/repos/${repoArg}/git/commits`, {
  message: `build(dev): ${tag}`,
  tree: tree.sha,
  parents: [parent],
});
if (refDev) await api('PATCH', `/repos/${repoArg}/git/refs/heads/dev`, { sha: commit.sha, force: true });
else await api('POST', `/repos/${repoArg}/git/refs`, { ref: 'refs/heads/dev', sha: commit.sha });
console.log(`✓ dev：${parent.slice(0, 7)} → ${commit.sha.slice(0, 7)}`);

// 4) tag + Pre-release
try {
  await api('POST', `/repos/${repoArg}/git/refs`, { ref: `refs/tags/${tag}`, sha: commit.sha });
  console.log(`✓ tag ${tag} → ${commit.sha.slice(0, 7)}`);
} catch (error) {
  if (!/already exists/i.test(String(error?.message))) throw error;
}
const body = [
  `### dev 测试构建 ${tag}`,
  '',
  '- 这是**测试版**，只给测试机；稳定用户不会收到（`/releases/latest` 不含 Pre-release）。',
  `- 基线：stable ${core}；构建号 dev.${nextN}。`,
  '- 安装后在「检查更新」下面把通道选 **dev**，之后会用同一个更新器继续收 dev 构建。',
  '',
  '### 验证',
  '- 发布清单：`--verify-ref HEAD` 问题 0',
].join('\n');
const rel = await api('POST', `/repos/${repoArg}/releases`, {
  tag_name: tag,
  name: `SurfCore ${tag}`,
  body,
  prerelease: true,
  draft: false,
});
console.log(`✓ Pre-release ${rel.html_url || tag}`);
console.log(`下一步：在测试机把通道切 dev，再点「检查更新」；稳定用户什么都不用做。`);
