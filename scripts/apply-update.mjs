#!/usr/bin/env node
/**
 * 独立更新执行器：等 DSH 宿主退出后，再把新文件覆盖到目标目录。
 *
 * 为什么必须独立进程：SurfCore 插件跑在 DSH 宿主进程里，而"目标目录"就是宿主正在
 * 加载的模块目录（~/.dsh/plugins/surfcore → junction → 仓库根）。在进程内 cpSync 覆盖
 * 正在使用的模块，会让宿主直接终止（0xFFFF7003，无异常栈），更新也不会落地。
 * 所以下载/解压都在进程内做（安全），**覆盖动作交给这个脚本，在宿主退出后执行**。
 *
 * 用法（由 updates.js 生成参数）：
 *   node scripts/apply-update.mjs --pending ~/.dsh/surfcore/updates-pending.json
 *
 * pending.json:
 *   {
 *     "kind": "zip" | "git",
 *     "target": "D:/surfcore",
 *     "staging": "~/.dsh/surfcore/staging/surfcore-1729...",   // zip 用
 *     "branch": "main",                                        // git 用
 *     "component": "surfcore",
 *     "to": "0.6.11",
 *     "waitPid": 12345,
 *     "createdAt": "2026-10-28T..."
 *   }
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const valueOf = (name, fallback = '') => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const pendingFile = path.resolve(valueOf('pending'));
if (!fs.existsSync(pendingFile)) {
  console.error(`[apply-update] 找不到 pending 文件：${pendingFile}`);
  process.exit(2);
}

const pending = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
// 启动标记：插件侧 2.5 秒后检查它，确认"助手真的跑起来了"（Electron 没带 RUN_AS_NODE 时会静默退出）。
try { fs.writeFileSync(`${pendingFile}.started`, JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); } catch {}
const logFile = pending.logFile || path.join(path.dirname(pendingFile), 'apply-update.log');
const log = (msg) => {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(logFile, line); } catch {}
  console.log(line.trim());
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// 15 分钟太短：用户可能暂存后过一阵才退出（2026-10-31 实测 15 分钟后才关，更新被静默放弃）。
// 改成 60 分钟；超时会写 .failed（stage.expired），卡片能看到“上次暂存已过期，请重新下载”。
async function waitExit(pid, timeoutMs = 60 * 60_000) {
  if (!pid) return true;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!alive(pid)) return true;
    await sleep(800);
  }
  return false;
}

function copyZip(staging, target) {
  // robocopy 比 cpSync 可靠：能处理大量文件、失败会返回码。
  // 2026-10-29：从 /MIR 改成 /E —— **只覆盖、不删除**。
  // /MIR 会删掉"源里没有"的文件，连用户自建文件一起删；现在宁可留旧文件也不误删。
  const exDirs = ['state', 'backups', 'node_modules', '.git', 'logs', 'staging', 'pet', 'characters', 'voice-packs', 'tmp-update*'];
  const exFiles = ['config.json', 'bili.config.json', 'updates-pending.json'];
  const argv = [
    staging, target,
    '/E',
    '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:2', '/W:1',
    '/XD', ...exDirs,
    '/XF', ...exFiles,
  ];
  try {
    execFileSync('robocopy', argv, { windowsHide: true, stdio: 'pipe', timeout: 10 * 60_000 });
    return { ok: true };
  } catch (error) {
    // robocopy: 0/1 成功，>=8 失败
    const code = Number(error?.status ?? -1);
    if (code >= 0 && code < 8) return { ok: true, code };
    const detail = `${error?.stdout || ''}${error?.stderr || ''}`.trim().slice(-500);
    return { ok: false, error: `robocopy 失败（exit ${code}）：${detail}` };
  }
}

function gitPull(target, branch) {
  try {
    execFileSync('git', ['-C', target, 'fetch', '--prune', 'origin'], { windowsHide: true, stdio: 'pipe', timeout: 120_000 });
    execFileSync('git', ['-C', target, 'merge', '--ff-only', `origin/${branch || 'main'}`], { windowsHide: true, stdio: 'pipe', timeout: 120_000 });
    return { ok: true };
  } catch (error) {
    const detail = `${error?.stdout || ''}${error?.stderr || ''}`.trim().slice(-500);
    return { ok: false, error: `git 更新失败：${detail || String(error?.message ?? error)}` };
  }
}

try {
  log(`[apply-update] 等待 DSH 退出（pid=${pending.waitPid ?? '?'}）…`);
  const exited = await waitExit(pending.waitPid);
  if (!exited) {
    const reason = '等 DSH 退出超时（60 分钟）：本次暂存已过期，需要重新下载';
    log(`[apply-update] ${reason}`);
    try {
      fs.writeFileSync(`${pendingFile}.failed`, JSON.stringify({
        ...pending, error: reason, code: 'stage.expired', at: new Date().toISOString(),
      }, null, 2));
      fs.rmSync(pendingFile, { force: true });
    } catch {}
    process.exit(3);
  }
  log(`[apply-update] 宿主已退出，开始应用 ${pending.kind} → ${pending.target}`);

  const result = pending.kind === 'git'
    ? gitPull(pending.target, pending.branch)
    : copyZip(pending.staging, pending.target);

  if (!result.ok) {
    log(`[apply-update] 失败：${result.error}`);
    fs.writeFileSync(`${pendingFile}.failed`, JSON.stringify({ ...pending, error: result.error, at: new Date().toISOString() }, null, 2));
    process.exit(4);
  }

  // 安装清单副本：下次更新用它判断"哪些文件是我们的 / 用户改过没有"
  try {
    const srcManifest = path.join(pending.staging, 'release', 'install-manifest.json');
    if (fs.existsSync(srcManifest)) {
      fs.writeFileSync(path.join(pending.target, '.installed-manifest.json'), fs.readFileSync(srcManifest));
      log('[apply-update] 已写 .installed-manifest.json');
    }
  } catch (e) { log(`[apply-update] 写安装清单失败：${e.message}`); }

  // 写安装记录（供「检查更新」做提交级比对）
  if (pending.meta) {
    try {
      fs.writeFileSync(path.join(pending.target, '.installed-meta.json'),
        `${JSON.stringify({ ...pending.meta, at: new Date().toISOString() }, null, 2)}
`, 'utf8');
      log('[apply-update] 已写 .installed-meta.json');
    } catch (e) { log(`[apply-update] 写 meta 失败：${e.message}`); }
  }

  // ── 更新后验证：目标目录版本必须等于 pending.to ──
  let actualVersion = '';
  try { actualVersion = String(JSON.parse(fs.readFileSync(path.join(pending.target, 'package.json'), 'utf8')).version ?? ''); } catch {}
  const want = String(pending.to ?? '').trim();
  const norm = (v) => String(v ?? '').trim().replace(/^v/i, '');
  if (want && norm(actualVersion) !== norm(want)) {
    const reason = `更新后版本不一致：期望 v${want}，实际 v${actualVersion || '（读不到）'}`;
    log(`[apply-update] 验证失败：${reason}`);
    try {
      fs.writeFileSync(`${pendingFile}.failed`, JSON.stringify({
        ...pending, error: reason, code: 'verify.version-mismatch', at: new Date().toISOString(),
      }, null, 2));
    } catch {}
    process.exit(4);
  }
  log(`[apply-update] 完成并验证：${pending.component} → v${actualVersion}`);
  try { fs.rmSync(pending.staging, { recursive: true, force: true }); } catch {}
  // 外层 staging/<id>-<stamp>/ 里还有 pkg.zip：只删解压目录会每次成功更新残留 7~12.5MB
  // （2026-11-01 用户反馈）。只删 stateDir/staging 直接子目录，防止误删别处。
  try {
    const stagingRoot = path.resolve(path.join(path.dirname(pendingFile), 'staging'));
    const parent = path.resolve(path.dirname(pending.staging));
    if (parent.startsWith(stagingRoot + path.sep)) fs.rmSync(parent, { recursive: true, force: true });
  } catch {}
  try { fs.rmSync(pendingFile, { force: true }); } catch {}
  try { fs.rmSync(`${pendingFile}.started`, { force: true }); } catch {}
  try {
    const doneDir = path.join(path.dirname(pendingFile), 'updates-applied');
    fs.mkdirSync(doneDir, { recursive: true });
    fs.writeFileSync(path.join(doneDir, `${Date.now()}-${pending.component}.json`),
      JSON.stringify({
        component: pending.component, from: pending.from ?? '', to: pending.to, version: actualVersion,
        verified: true, txn: pending.txn ?? '', backup: pending.backup ?? '',
        at: new Date().toISOString(),
      }, null, 2));
  } catch {}
  process.exit(0);
} catch (error) {
  log(`[apply-update] 异常：${String(error?.message ?? error)}`);
  process.exit(5);
}
