#!/usr/bin/env node
/**
 * SurfCore 陌生人安装器（Windows）
 *
 * 目标：一个从来没听过这个项目的人，双击 2-安装.bat，20 分钟内装到"能用"。
 * 不依赖 git；不碰你的 QQ 账号；不装第三方运行时（SnowLuma 需自己装）。
 *
 * 用法：
 *   node installer.mjs              # 完整安装
 *   node installer.mjs --check      # 只检查环境，不下载不安装
 *   node installer.mjs --zip <path> # 用本地 zip（给离线/测试用）
 *   node installer.mjs --print-tag  # 只解析并打印"最新稳定 Release tag"（发布门禁用）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECK_ONLY = process.argv.includes('--check');
const PRINT_TAG = process.argv.includes('--print-tag');
const ZIP_ARG = process.argv.includes('--zip') ? process.argv[process.argv.indexOf('--zip') + 1] : '';
const TARGET = path.join(HERE, 'surfcore');
const REPO = 'https://github.com/Mieksido/surfcore';

// 版本号**不能写死**：这里曾长期是 `const TAG = 'v0.3.2'`（v0.5.0 → v0.8.9 都没人改），
// 于是双击安装的人装到的永远是 v0.3.2；而 v0.3.2 归档里没有 release/install-manifest.json，
// 装完连"检查更新"都没法自愈。写死任何"当前最新版"都只会重演（发版时忘改、或预发布分支先合并）。
// 现在改为运行期解析最新**正式** Release：GitHub API → releases/latest 跳转 → 本机缓存兜底；
// SURFCORE_KIT_TAG 可显式覆盖（镜像/离线/复现旧版）；全都失败就明确报错，绝不静默装旧版。
const TAG_ENV = String(process.env.SURFCORE_KIT_TAG ?? '').trim();
const TAG_RE = /^v\d+\.\d+\.\d+$/;
const TAG_CACHE = path.join(os.tmpdir(), 'surfcore-installer-tag.json');
const TAG_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const say = (msg = '') => process.stdout.write(`${msg}\n`);
const ok = (msg) => say(`  [OK]   ${msg}`);
const bad = (msg) => say(`  [!!]   ${msg}`);
const step = (n, msg) => say(`\n=== ${n}. ${msg} ===`);

function normalizeTag(raw) {
  const t = String(raw ?? '').trim().replace(/^refs\/tags\//, '');
  const withV = /^\d+\.\d+\.\d+$/.test(t) ? `v${t}` : t;
  return TAG_RE.test(withV) ? withV : '';
}

function readTagCache() {
  try {
    const c = JSON.parse(fs.readFileSync(TAG_CACHE, 'utf8'));
    const tag = normalizeTag(c.tag);
    if (tag && Number.isFinite(Number(c.at))) return { tag, at: Number(c.at) };
  } catch {}
  return null;
}

function writeTagCache(tag) {
  try { fs.writeFileSync(TAG_CACHE, JSON.stringify({ tag, at: Date.now() }) + '\n', 'utf8'); } catch {}
}

/** 只读 GET；不自动跟随重定向 —— releases/latest 的 Location 本身就是答案。 */
function httpGet(url, { timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'surfcore-installer' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(new Error('请求超时')));
  });
}

async function latestTagFromApi() {
  const r = await httpGet('https://api.github.com/repos/Mieksido/surfcore/releases/latest');
  if (r.status !== 200) throw new Error(`GitHub API HTTP ${r.status}`);
  const j = JSON.parse(r.body);
  if (j.draft || j.prerelease) throw new Error('releases/latest 不是正式版');
  const tag = normalizeTag(j.tag_name);
  if (!tag) throw new Error(`tag_name 不可用：${j.tag_name}`);
  return tag;
}

async function latestTagFromRedirect() {
  const r = await httpGet(`${REPO}/releases/latest`);
  const m = String(r.headers.location ?? '').match(/\/releases\/tag\/(v\d+\.\d+\.\d+)$/);
  if (!m) throw new Error(`HTTP ${r.status}，跳转里没有 tag`);
  return m[1];
}

async function latestTagFromPowerShell() {
  // Node 的 https 不读系统代理，而 Windows 用户经常靠系统代理/镜像访问 GitHub；
  // PowerShell 的 Invoke-WebRequest 走系统代理（PS 5.1 还需要显式开 TLS 1.2），兜底用它取同一页。
  const script = [
    "$ProgressPreference='SilentlyContinue'",
    "'[Console]::OutputEncoding = [System.Text.Encoding]::UTF8'",
    'try {',
    '  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12',
    "  $r = Invoke-WebRequest -Uri 'https://github.com/Mieksido/surfcore/releases/latest' -UseBasicParsing -TimeoutSec 20",
    "  if ($r.Content -match '/releases/tag/(v\\d+\\.\\d+\\.\\d+)') { 'TAG=' + $Matches[1] } else { 'NOMATCH' }",
    "} catch { 'ERR=' + $_.Exception.Message }",
  ].join('; ');
  const r = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (r.error) throw new Error(`PowerShell 启动失败：${r.error.message}`);
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  const m = out.match(/\bTAG=(v\d+\.\d+\.\d+)/);
  if (!m) throw new Error(`PowerShell 没解析出 tag：${out.slice(0, 120) || '无输出'}`);
  return m[1];
}

async function resolveTag({ quiet = false } = {}) {
  const note = (m) => { if (!quiet) say(`  ${m}`); };
  if (TAG_ENV) {
    const tag = normalizeTag(TAG_ENV);
    if (!tag) throw new Error(`SURFCORE_KIT_TAG 不是合法 tag：${TAG_ENV}（应形如 v0.8.9）`);
    note(`版本：${tag}（SURFCORE_KIT_TAG 指定）`);
    return tag;
  }
  const cached = readTagCache();
  if (cached && Date.now() - cached.at < TAG_CACHE_TTL_MS) {
    note(`版本：${cached.tag}（本机缓存，6 小时内有效）`);
    return cached.tag;
  }
  try {
    const tag = await latestTagFromApi();
    writeTagCache(tag);
    note(`版本：${tag}（GitHub API）`);
    return tag;
  } catch (apiErr) {
    try {
      const tag = await latestTagFromRedirect();
      writeTagCache(tag);
      note(`版本：${tag}（releases/latest 跳转）`);
      return tag;
    } catch (redirectErr) {
      try {
        const tag = await latestTagFromPowerShell();
        writeTagCache(tag);
        note(`版本：${tag}（PowerShell releases/latest，走系统代理）`);
        return tag;
      } catch (psErr) {
        if (cached) {
          if (!quiet) bad(`取最新版失败（${apiErr.message} / ${redirectErr.message} / ${psErr.message}），改用缓存 ${cached.tag}`);
          return cached.tag;
        }
        throw new Error(`无法确定 SurfCore 最新稳定版：${apiErr.message}；${redirectErr.message}；${psErr.message}\n` +
          "        检查网络后重试，或显式指定：PowerShell $env:SURFCORE_KIT_TAG='v0.8.9'；\n" +
          '        也可以手动下载仓库 zip 后用 --zip <path> 安装。');
      }
    }
  }
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32', ...opts });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim(), status: r.status };
}

function nodeOk() {
  const [maj, min] = process.versions.node.split('.').map(Number);
  return maj > 22 || (maj === 22 && min >= 13);
}

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

function listProfiles() {
  try {
    return fs.readdirSync(path.join(dshHome(), 'profiles'))
      .filter((n) => !n.includes('.') && fs.existsSync(path.join(dshHome(), 'profiles', n, 'package.json')));
  } catch { return []; }
}

function snowLumaPorts() {
  // 用 netstat 而不是 Get-NetTCPConnection：后者在部分机器/权限下拿不到，且慢。
  const r = spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  const out = `${r.stdout ?? ''}`;
  const ports = new Set();
  const NL = String.fromCharCode(10);
  for (const raw of out.split(NL)) {
    const line = raw.trim();
    if (!line.toUpperCase().includes('LISTENING')) continue;
    for (const port of [3000, 3001, 3010, 3011]) {
      if (line.includes(':' + port + ' ') || line.endsWith(':' + port)) ports.add(port);
    }
  }
  return [...ports];
}

async function ask(question, fallback = '') {
  if (!process.stdin.isTTY) return fallback;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question}${fallback ? `（回车 = ${fallback}）` : ''} `)).trim();
  rl.close();
  return answer || fallback;
}

async function main() {
  if (PRINT_TAG) {
    process.stdout.write(`${await resolveTag({ quiet: true })}\n`);
    return;
  }
  say('==============================================');
  say('  SurfCore 安装程序');
  say(`  版本 ${TAG_ENV ? (normalizeTag(TAG_ENV) || TAG_ENV) : '最新稳定版（下载时自动解析）'}`);
  say('==============================================');

  step(1, '检查环境');
  if (nodeOk()) ok(`Node v${process.versions.node}`);
  else { bad(`Node v${process.versions.node} 太老，需要 v22.13 或更高`); say('        去 https://nodejs.org/ 下 LTS，装完重开这个窗口'); process.exit(1); }

  const profiles = listProfiles();
  if (profiles.length) ok(`找到 DSH 配置目录：${dshHome()}（profile：${profiles.join('、')}）`);
  else bad(`没找到 DSH 配置目录 ${dshHome()} —— 请先安装并打开一次 DeepSeek Harness`);

  const ports = snowLumaPorts();
  if (ports.length) ok(`SnowLuma 端口在监听：${ports.join('、')}`);
  else bad('没检测到 SnowLuma（端口 3000/3001）。没装也能继续，只是 QQ 连不上；装好后再点一键安装即可。');

  if (CHECK_ONLY) { say('\n仅检查模式，结束。'); return; }

  step(2, '下载 SurfCore');
  if (fs.existsSync(path.join(TARGET, 'package.json'))) {
    ok(`已存在：${TARGET}（跳过下载）`);
  } else {
    const zip = ZIP_ARG || path.join(HERE, 'surfcore.zip');
    let resolvedTag = '';
    if (!ZIP_ARG) {
      resolvedTag = await resolveTag();
      const repoZip = `${REPO}/archive/refs/tags/${resolvedTag}.zip`;
      say(`  下载 ${repoZip}`);
      const dl = run('powershell', ['-NoProfile', '-Command',
        `$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '${repoZip}' -OutFile '${zip}'`], { timeout: 300000 });
      if (!dl.ok || !fs.existsSync(zip)) { bad(`下载失败：${dl.out.slice(0, 300)}`); say('        可以手动下载后放在本目录，命名 surfcore.zip，再重跑本程序'); process.exit(1); }
    } else {
      ok(`使用本地 zip：${zip}`);
    }
    const ex = run('powershell', ['-NoProfile', '-Command',
      `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${HERE}' -Force`], { timeout: 120000 });
    if (!ex.ok) { bad(`解压失败：${ex.out.slice(0, 300)}`); process.exit(1); }
    const extracted = fs.readdirSync(HERE).find((n) => /^surfcore-/.test(n));
    if (!extracted) { bad('解压后没找到 surfcore-* 目录'); process.exit(1); }
    fs.renameSync(path.join(HERE, extracted), TARGET);
    ok('下载并解压完成');
    if (resolvedTag) {
      try {
        const got = JSON.parse(fs.readFileSync(path.join(TARGET, 'package.json'), 'utf8')).version;
        if (`v${got}` === resolvedTag) ok(`归档版本与 tag 一致：${resolvedTag}`);
        else bad(`归档里的 package.json 是 v${got}，与解析到的 tag ${resolvedTag} 不一致——请先确认 Release 已发布完成`);
      } catch {}
    }
  }

  step(3, '安装依赖（npm install）');
  const npmProbe = run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['-v']);
  const bundledPnpm = path.join(process.env.USERPROFILE || os.homedir(), '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.cjs');
  let inst;
  if (npmProbe.ok) {
    inst = run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund'], { cwd: TARGET, timeout: 900000 });
  } else if (fs.existsSync(bundledPnpm)) {
    say('  没找到 npm，改用 DSH 自带的 pnpm');
    inst = run(process.execPath, [bundledPnpm, 'install'], { cwd: TARGET, timeout: 900000 });
  } else {
    inst = { ok: false, out: '没有 npm 也没有 DSH 自带的 pnpm' };
  }
  if (inst.ok) ok('依赖安装完成');
  else { bad(`依赖安装失败：\n${inst.out.slice(-800)}`); say('        常见原因：网络代理、npm 源。可以试：npm config set registry https://registry.npmmirror.com'); process.exit(1); }

  step(4, '装进 DSH（注册预设 / MCP / 插件）');
  let profile = process.env.DSH_PROFILE || '';
  if (!profile) {
    const dp = run(process.execPath, [path.join(TARGET, 'scripts', 'detect-profile.mjs')], { cwd: TARGET });
    if (dp.ok) profile = dp.out.trim();
  }
  if (!profile) {
    if (profiles.includes('web')) profile = 'web';
    else if (profiles.length === 1) profile = profiles[0];
    else if (profiles.length > 1) profile = await ask(`你有多个 DSH profile（${profiles.join('、')}），用哪个？`, profiles[0]);
    else profile = 'web';
  }
  ok(`使用 profile：${profile}`);
  const setup = run(process.execPath, [path.join(TARGET, 'scripts', 'setup-dsh.mjs'), profile], { cwd: TARGET, timeout: 180000 });
  if (setup.ok) ok('已注册到 DSH');
  else { bad(`注册失败（可手动重跑：node scripts\\setup-dsh.mjs ${profile}）\n${setup.out.slice(-600)}`); }

  step(5, '生成本地配置');
  const cfg = path.join(TARGET, 'config.json');
  if (fs.existsSync(cfg)) ok('config.json 已存在（不覆盖）');
  else {
    fs.copyFileSync(path.join(TARGET, 'config.example.json'), cfg);
    ok('已生成 config.json（里面的白名单先留空，稍后在一键安装里勾）');
  }

  step(6, '完成');
  say('');
  say('  下一步（必须做）：');
  say('    1) 完全退出 DSH，再打开它（让插件加载）');
  say('    2) 设置 → SurfCore → 诊断 → 点「一键安装（全部）」');
  say('    3) 弹窗里填你的 QQ、勾要拉她进去的群 → 开始安装');
  say('    4) 再退出重开一次 DSH（如果提示需要）');
  say('');
  say(`  安装目录：${TARGET}`);
  say('  出问题：双击 3-自检.bat，把生成的 诊断报告.txt 发回给我。');
  say('');
}

main().catch((error) => { bad(String(error?.stack ?? error)); process.exit(1); });
