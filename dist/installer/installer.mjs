#!/usr/bin/env node
/**
 * SurfCore 陌生人安装器（Windows）
 *
 * 目标：一个从来没听过这个项目的人，双击 2-安装.bat，20 分钟内装到"能用"。
 * 不依赖 git；不碰你的 QQ 账号；不装第三方运行时（SnowLuma 需自己装）。
 *
 * 用法：
 *   node installer.mjs              # 完整安装（版本自动取 GitHub 最新 release）
 *   node installer.mjs --check      # 只检查环境，不下载不安装
 *   node installer.mjs --zip <path> # 用本地 zip（给离线/测试用）
 *   node installer.mjs --tag v0.8.9 # 指定要装的版本（等价于设 SURFCORE_TAG）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECK_ONLY = process.argv.includes('--check');
const ZIP_ARG = process.argv.includes('--zip') ? process.argv[process.argv.indexOf('--zip') + 1] : '';
const TAG_ARG = process.argv.includes('--tag') ? process.argv[process.argv.indexOf('--tag') + 1] : '';
const REPO_SLUG = 'Mieksido/surfcore';
// 兜底版本：只有「离线 + 没给 --tag/SURFCORE_TAG」时才会用到。
// 正常情况下版本由 /releases/latest 现查，发版后不用再手改这里（2026-11-12 改）。
const PINNED_TAG = 'v0.8.9';
const TARGET = path.join(HERE, 'surfcore');

let TAG = PINNED_TAG;
let REPO_ZIP = '';

async function resolveTag() {
  const explicit = (TAG_ARG || process.env.SURFCORE_TAG || '').trim();
  if (explicit) return { tag: explicit, source: 'explicit' };
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO_SLUG}/releases/latest`, {
      headers: { 'User-Agent': 'surfcore-installer', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { tag: PINNED_TAG, source: 'pinned', note: `GitHub 返回 ${res.status}` };
    const body = await res.json();
    const tag = typeof body?.tag_name === 'string' ? body.tag_name.trim() : '';
    if (/^v?\d/.test(tag)) return { tag, source: 'github' };
    return { tag: PINNED_TAG, source: 'pinned', note: `接口里的 tag 不可用（${tag || '空'}）` };
  } catch (error) {
    return { tag: PINNED_TAG, source: 'pinned', note: `连不上 GitHub（${error?.code || error?.message || 'timeout'}）` };
  }
}

const say = (msg = '') => process.stdout.write(`${msg}\n`);
const ok = (msg) => say(`  [OK]   ${msg}`);
const bad = (msg) => say(`  [!!]   ${msg}`);
const step = (n, msg) => say(`\n=== ${n}. ${msg} ===`);

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
  const resolved = await resolveTag();
  TAG = resolved.tag;
  REPO_ZIP = `https://github.com/${REPO_SLUG}/archive/refs/tags/${TAG}.zip`;

  say('==============================================');
  say('  SurfCore 安装程序');
  say(`  版本 ${TAG}`);
  if (resolved.source === 'pinned') say(`  （离线兜底：${resolved.note}；要指定版本用 --tag vX.Y.Z）`);
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
    let have = '';
    try { have = JSON.parse(fs.readFileSync(path.join(TARGET, 'package.json'), 'utf8')).version || ''; } catch {}
    ok(`已存在：${TARGET}${have ? `（v${have}）` : ''}（跳过下载）`);
    if (have && TAG.replace(/^v/, '') !== have) {
      bad(`注意：这次要装的是 ${TAG}，本地已经是 v${have} —— 没有覆盖。要换版本请删掉 ${TARGET} 后重跑`);
    }
  } else {
    const zip = ZIP_ARG || path.join(HERE, 'surfcore.zip');
    if (!ZIP_ARG) {
      say(`  下载 ${REPO_ZIP}`);
      const dl = run('powershell', ['-NoProfile', '-Command',
        `$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '${REPO_ZIP}' -OutFile '${zip}'`], { timeout: 300000 });
      if (!dl.ok || !fs.existsSync(zip)) { bad(`下载失败：${dl.out.slice(0, 300)}`); say('        可以手动下载后放在本目录，命名 surfcore.zip，再重跑本程序'); process.exit(1); }
    }
    const ex = run('powershell', ['-NoProfile', '-Command',
      `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${HERE}' -Force`], { timeout: 120000 });
    if (!ex.ok) { bad(`解压失败：${ex.out.slice(0, 300)}`); process.exit(1); }
    const extracted = fs.readdirSync(HERE).find((n) => /^surfcore-/.test(n));
    if (!extracted) { bad('解压后没找到 surfcore-* 目录'); process.exit(1); }
    fs.renameSync(path.join(HERE, extracted), TARGET);
    ok('下载并解压完成');
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
