#!/usr/bin/env node
/**
 * 把随包附带的 SurfCore UI（`surfcore-ui/`）注册进本机 DSH profile。
 *
 * 为什么需要这一步：
 *   DSH 的插件列表来自 profile 的 `package.json`（dependencies + dsh.profile.bundles），
 *   更新包只替换 SurfCore 安装目录里的文件，**不会改 DSH profile**。
 *   所以 UI 文件虽然随包落盘了，还要在 profile 里登记一次，DSH 才会加载它。
 *
 * 用法：
 *   node install-ui.mjs                 # 自动找带 surfcore 的 profile
 *   node install-ui.mjs --profile desktop
 *   node install-ui.mjs --dry-run
 *
 * 安全：
 *   · 只改 profile 的 package.json（先备份 .bak-surfcore-ui-<时间>）；
 *   · node_modules 里的旧链接如果是目录，会改名备份，不直接删除；
 *   · 不碰 SurfCore 内核、不碰 ~/.dsh/surfcore 数据。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const uiDir = path.join(root, 'surfcore-ui');
const BUNDLE = '@local/surfcore-ui';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const profileArg = (() => {
  const i = argv.indexOf('--profile');
  return i >= 0 ? argv[i + 1] : '';
})();

if (!fs.existsSync(path.join(uiDir, 'package.json'))) {
  console.error(`✗ 包里没有 surfcore-ui/package.json：${uiDir}`);
  process.exit(2);
}

const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const profilesDir = path.join(dshHome, 'profiles');
if (!fs.existsSync(profilesDir)) {
  console.error(`✗ 找不到 DSH profiles：${profilesDir}`);
  process.exit(2);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}
function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const candidates = [];
for (const name of fs.readdirSync(profilesDir)) {
  const pkgPath = path.join(profilesDir, name, 'package.json');
  if (!fs.existsSync(pkgPath)) continue;
  let pkg;
  try { pkg = readJson(pkgPath); } catch { continue; }
  const deps = pkg.dependencies || {};
  const bundles = pkg?.dsh?.profile?.bundles || [];
  if (deps.surfcore || bundles.includes('surfcore')) candidates.push({ name, dir: path.join(profilesDir, name), pkgPath, pkg });
}
if (profileArg) {
  const one = candidates.find((c) => c.name === profileArg);
  if (!one) { console.error(`✗ profile "${profileArg}" 里没有 surfcore，找不到；现有：${candidates.map((c) => c.name).join(', ') || '无'}`); process.exit(2); }
  candidates.length = 0; candidates.push(one);
}
if (!candidates.length) {
  console.error('✗ 没有找到已挂 surfcore 的 DSH profile。先确认 DSH 装的是哪个 profile，再传 --profile <名字>。');
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
let changed = 0;
for (const c of candidates) {
  const pkg = c.pkg;
  pkg.dependencies = pkg.dependencies || {};
  pkg.dependencies[BUNDLE] = `link:${uiDir.replace(/\\/g, '/')}`;
  pkg.dsh = pkg.dsh || {};
  pkg.dsh.profile = pkg.dsh.profile || {};
  pkg.dsh.profile.bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : [];
  if (!pkg.dsh.profile.bundles.includes(BUNDLE)) pkg.dsh.profile.bundles.push(BUNDLE);

  const linkPath = path.join(c.dir, 'node_modules', '@local', 'surfcore-ui');
  console.log(`\n[${c.name}]`);
  console.log(`  profile: ${c.pkgPath}`);
  console.log(`  link:    ${linkPath} -> ${uiDir}`);
  if (dryRun) { console.log('  (dry-run：不写)'); continue; }

  fs.copyFileSync(c.pkgPath, `${c.pkgPath}.bak-surfcore-ui-${stamp}`);
  writeJson(c.pkgPath, pkg);
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  let current = null;
  try { current = fs.readlinkSync(linkPath); } catch { current = null; }
  if (current && path.resolve(current) === path.resolve(uiDir)) {
    console.log('  link 已存在且指向同一目录，跳过');
  } else {
    if (current) {
      fs.unlinkSync(linkPath); // 只删链接，不动目标
    } else if (fs.existsSync(linkPath)) {
      fs.renameSync(linkPath, `${linkPath}.bak-${stamp}`);
      console.log(`  旧目录已改名备份：${linkPath}.bak-${stamp}`);
    }
    fs.symlinkSync(uiDir, linkPath, 'junction');
  }
  changed += 1;
  console.log('  ✓ 已登记');
}

console.log(`\n${dryRun ? 'dry-run 完成' : `完成：${changed} 个 profile 已登记`}`);
console.log('下一步：完全退出 DSH 再启动；插件页里关掉旧的「SurfCore 控制台」，只留新的「SurfCore」。');
console.log('注意：UI 的记忆/语音页需要宿主 API（/surfcore-api/*）；没有宿主时页面会显示“后端待接入”。');
