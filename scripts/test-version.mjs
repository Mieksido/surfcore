// 版本一致性回归：防止"改了一处忘了另一处"。
//
// 规则见 docs/guides/VERSIONS.md：
//   1. 版本号只在根 package.json；插件那份必须一致；
//   2. 代码里不许硬编码版本（index.js 从 package.json 读）；
//   3. CHANGELOG 必须有当前版本的小节；
//   4. 兄弟仓库（桌宠/语音包）的 version.json 若存在，必须与其 package.json 一致。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const SEMVER = /^\d+\.\d+\.\d+(?:-(?:rc|beta|alpha|dev)\.\d+)?$/;

const pkg = read(path.join(root, 'package.json'));
assert.match(pkg.version, SEMVER, `根 package.json 版本不是 semver：${pkg.version}`);

const plugin = read(path.join(root, 'plugins/surfcore/package.json'));
assert.equal(plugin.version, pkg.version, '插件 package.json 与根版本不一致');

const indexSrc = fs.readFileSync(path.join(root, 'plugins/surfcore/lib/index.js'), 'utf8');
assert.ok(!/const VERSION = '\d+\.\d+\.\d+/.test(indexSrc), 'index.js 里仍在硬编码版本');

// 所有 plugins/**/package.json 的版本必须跟根版本一致（以最新版为标准，防止 dev 版本残留）。
const pluginPkgFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const sub = path.join(dir, entry.name);
    const pkgFile = path.join(sub, 'package.json');
    if (fs.existsSync(pkgFile)) pluginPkgFiles.push(pkgFile);
    walk(sub);
  }
})(path.join(root, 'plugins'));
for (const file of pluginPkgFiles) {
  const data = read(file);
  assert.equal(data.version, pkg.version, `${path.relative(root, file)} 版本（${data.version}）与根版本（${pkg.version}）不一致`);
}

const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const readmeVer = /\|\s*版本\s*\|\s*`([^`]+)`/.exec(readme)?.[1];
assert.equal(readmeVer, pkg.version, `README 顶部版本（${readmeVer}）与 package.json（${pkg.version}）不一致`);

const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
assert.ok(
  changelog.includes(`## [${pkg.version}]`) || changelog.includes(`## ${pkg.version}`),
  `CHANGELOG.md 缺少 ${pkg.version} 的小节`,
);

// 兄弟仓库：存在就校验 version.json 与 package.json 一致（不存在则跳过）
for (const dir of [
  path.resolve(root, '..', 'pet'),
  path.resolve(root, '..', 'voice/packages/voice-local'),
  path.resolve(root, '..', 'voice/packages/voice-cloud'),
]) {
  const p = path.join(dir, 'package.json');
  const v = path.join(dir, 'version.json');
  if (!fs.existsSync(p) || !fs.existsSync(v)) continue;
  const a = read(p).version;
  const b = read(v).version;
  assert.equal(b, a, `${dir} 的 version.json（${b}）与 package.json（${a}）不一致`);
}

console.log(`✅ 版本一致性通过（v${pkg.version}）`);
