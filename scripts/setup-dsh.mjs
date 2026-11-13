#!/usr/bin/env node
// setup-dsh.mjs — 在目标设备上安装 qq-bridge 的 DSH 端配置
//
// 功能：
//   1. 安装两套 agent preset：qq-chat、qq-chat-v2
//      （DSH 0.1.7 机制：作为 surfcore bundle 的 patch 层插入
//        @deepseek-ai/dsh-agent-preset 行；~/.dsh/.agent-presets/ 目录已不再被读取）
//   2. 在 DSH profile 的 cordis.patch.yml 中挂载三个 MCP server：
//      mcp-snowluma / mcp-snowluma-host / mcp-web-search-safe
//   3. 在 profile package.json 中只注册一个 bundle：surfcore
//      （surfcore = QQ 设置 + B站养鱼 + 两个 chat preset，全部在一个 bundle 里）
//
// 用法：
//   node scripts/setup-dsh.mjs [profile]
//
// 默认 profile 为 web；可用环境变量 DSH_HOME 指定 DSH 根目录。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { PRESETS, buildPatches, patchFileFor } from './build-agent-preset-patches.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
// MCP 的 command 必须是真 node，不能是 DSH Desktop 的 Harness.exe。
// 复制到别处单独运行时可能没有 ../src，退回当前进程（CLI 下就是 node）。
let NODE_EXE = process.execPath;
try {
  const { findNodeExe } = await import('../src/node-path.js');
  NODE_EXE = findNodeExe({ dshHome: DSH_HOME, home: process.env.USERPROFILE || os.homedir() });
} catch {}
// 没传 profile 就自动判断（环境变量 → 正在运行的 DSH 进程 → 最近使用 → 兜底 web）。
// 用动态 import + 兜底：这个脚本偶尔会被单独复制到别处跑（审计台就在这么测），
// 没有 detect-profile.mjs 时不能直接崩。
let PROFILE = process.argv[2] || '';
if (!PROFILE) {
  try {
    const { detectProfile } = await import('./detect-profile.mjs');
    PROFILE = await detectProfile();
  } catch {
    PROFILE = String(process.env.DSH_PROFILE ?? '').trim() || 'web';
  }
}

// A profile is a directory name, never a path (same boundary as DSH itself).
if (PROFILE === '.' || PROFILE === '..' || PROFILE === 'node_modules'
    || /[\\/\x00-\x1f<>:"|?*]/.test(PROFILE) || /[. ]$/.test(PROFILE)) {
  fatal(`invalid profile name: ${JSON.stringify(PROFILE)}`);
}

function log(msg) {
  console.log(`[setup-dsh] ${msg}`);
}

function fatal(msg) {
  console.error(`[setup-dsh] ERROR: ${msg}`);
  process.exit(1);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/**
 * 备份一个即将被覆盖的文件。
 *
 * 为什么不用 `flag: 'wx'`（写一次就永不更新）：那样第一次安装会留下一个备份，
 * 之后每次 setup 都静默跳过 —— 用户后来手工改过的内容再被覆盖时，桌上那份备份
 * 早已过期，等于「有备份但救不回来」。改为每次覆盖前打时间戳快照，只保留最近 N 份。
 */
function backupBeforeOverwrite(file, keep = 5) {
  if (!fs.existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = `${file}.bak-${stamp}`;
  try {
    fs.copyFileSync(file, dest);
  } catch (error) {
    log(`⚠️ 备份失败（${file}）：${error?.message ?? error}；继续但请自行确认原内容`);
    return null;
  }
  try {
    const dir = path.dirname(file);
    const prefix = `${path.basename(file)}.bak-`;
    const snaps = fs.readdirSync(dir).filter((f) => f.startsWith(prefix)).sort();
    // 时间戳升序 ⇒ 前面的是最旧的，只保留最后 keep 份
    for (const f of snaps.slice(0, Math.max(0, snaps.length - keep))) {
      fs.rmSync(path.join(dir, f), { force: true });
    }
  } catch {}
  return dest;
}

/**
 * 原子替换一个文本文件；避免 DSH 同时读到半截 package.json/patch。
 * 调用方负责决定失败后怎么回滚。
 */
function writeTextAtomic(file, text) {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, text, 'utf8');
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

/** 读 profile 的 bundles/dependencies 摘要，用于安装后核对有没有被 DSH 裁剪。 */
function readProfileState(file) {
  try {
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      bundles: Array.isArray(pkg?.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles.map(String) : [],
      dependencies: Object.keys(pkg?.dependencies ?? {}),
    };
  } catch {
    return null;
  }
}

/**
 * 最小风险回滚：只恢复 setup 自己动过的 profile 文件，不碰用户 node_modules。
 * `backup` 为 null 表示原来是「不存在」，回滚时删掉 setup 新建的文件。
 */
function restoreProfileFile(file, backup) {
  try {
    if (backup) fs.copyFileSync(backup, file);
    else fs.rmSync(file, { force: true });
  } catch (error) {
    log(`⚠️ 回滚失败（${file}）：${error?.message ?? error}`);
  }
}

// ── agent preset：DSH 0.1.7 机制 ─────────────────────────────────────────────
//
// 0.1.5：preset 是 ~/.dsh/.agent-presets/<preset>/ 下的目录，DSH 启动时扫目录装载。
// 0.1.7：注册表既不扫目录也不接受 preset 路径；preset 是一条普通 loader 行
//        （@deepseek-ai/dsh-agent-preset，config.plugins 内联子行列表），
//        由 bundle 的 patch 文件插入。因此这里做两件事：
//          ① 把 surfcore bundle 注册进 profile（link: 依赖 + bundles + junction）；
//          ② 从仓库权威源（dsh/agent-presets/<preset>/）重新生成 patch 文件。
//        旧目录不再写入、也不删除（见 reportLegacyPresetDir）。
const BUNDLE_NAMES = ['surfcore'];
const STALE_BUNDLES = ['qq-agent-presets'];

/** 从仓库源重新生成 bundle 里的 patch 文件（人格正文/工具面改了就必须重跑）。 */
function regeneratePresetPatches() {
  const results = buildPatches({ log: () => {} });
  for (const { file, changed } of results) {
    log(`preset patch ${changed ? '已生成' : '已是最新'}: ${path.relative(REPO_ROOT, file)}`);
  }
  for (const name of PRESETS) {
    const file = patchFileFor(name);
    if (!fs.existsSync(file)) fatal(`preset patch 未生成：${file}`);
  }
}

/**
 * 旧机制的安装目录：0.1.7 起 DSH 完全不再读它。
 *
 * 这里**只报告、不删除**——里面可能是用户手改过的人设（仓库源文件救不回来）。
 * 顺带对比仓库源：一致说明没丢东西，不一致说明用户改的那份已不再生效，需要人工合并。
 */
function reportLegacyPresetDir() {
  const legacy = path.join(DSH_HOME, '.agent-presets');
  if (!fs.existsSync(legacy)) return;
  log(`注意：${legacy} 是 DSH 0.1.5 的 preset 安装目录，0.1.7 起不再被读取（保留未删，可自行备份后清理）`);
  for (const name of PRESETS) {
    const installed = path.join(legacy, name, 'agent.cordis.yml');
    if (!fs.existsSync(installed)) continue;
    const source = path.join(REPO_ROOT, 'dsh', 'agent-presets', name, 'agent.cordis.yml');
    const same = fs.existsSync(source) && fs.readFileSync(installed, 'utf8') === fs.readFileSync(source, 'utf8');
    log(same
      ? `  · ${name}：旧目录副本与仓库源一致（无内容丢失）`
      : `  ⚠️ ${name}：旧目录副本与仓库源**不一致**——那份手改内容不会再生效，请人工合并到 dsh/agent-presets/${name}/agent.cordis.yml`);
  }
}

function yamlSingleQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

// 由桥接托管的 MCP 条目 id：脚本对这三个 id 拥有所有权，可安全地按 id 增删。
const MANAGED_MCP_IDS = ['mcp-snowluma', 'mcp-snowluma-host', 'mcp-web-search-safe'];

function mcpEntries() {
  const node = NODE_EXE;
  const servers = {
    'mcp-snowluma': { serverName: 'snowluma', script: path.join(REPO_ROOT, 'src', 'mcp-snowluma-safe.js'), toolCallTimeoutMs: 725000 },
    'mcp-snowluma-host': { serverName: 'snowluma-host', script: path.join(REPO_ROOT, 'src', 'mcp-host-server.js') },
    'mcp-web-search-safe': { serverName: 'web-search-safe', script: path.join(REPO_ROOT, 'src', 'mcp-web-search-safe.js') },
  };
  let out = '# === qq-bridge MCP BEGIN ===\n';
  out += '# 由 scripts/setup-dsh.mjs 维护；这段区块会被整体替换，请勿手工编辑内部条目。\n';
  for (const [id, s] of Object.entries(servers)) {
    out += `- insert:\n`;
    out += `    - id: ${id}\n`;
    out += `      name: '@deepseek-ai/dsh-mcp-client'\n`;
    out += `      config:\n`;
    out += `        serverName: ${s.serverName}\n`;
    out += `        transport: stdio\n`;
    out += `        command: ${yamlSingleQuote(node)}\n`;
    out += `        args:\n`;
    out += `          - ${yamlSingleQuote(s.script)}\n`;
    // qq_wait_for_messages 最长可等 10 分钟；DSH 默认 60s 会提前掐断工具调用。
    if (s.toolCallTimeoutMs) out += `        toolCallTimeoutMs: ${s.toolCallTimeoutMs}\n`;
  }
  out += '# === qq-bridge MCP END ===\n';
  return out;
}

function prepareCordisPatch() {
  const profileDir = path.join(DSH_HOME, 'profiles', PROFILE);
  const patchFile = path.join(profileDir, 'cordis.patch.yml');
  const original = fs.existsSync(patchFile) ? fs.readFileSync(patchFile, 'utf8') : '';
  const lines = original.replace(/^\uFEFF/, '').split(/\r?\n/);
  // Repair only the historical invalid *root* [] followed by block operations.
  // A nested [] or a line inside a literal scalar is user data and must survive.
  const first = lines.findIndex((line) => line.trim() && !line.trimStart().startsWith('#'));
  if (first >= 0 && lines[first].trim() === '[]'
      && lines.slice(first + 1).some((line) => /^-\s/.test(line))) {
    lines.splice(first, 1);
  }
  let doc;
  try { doc = yaml.load(lines.join('\n')) ?? []; }
  catch (error) { fatal(`failed to parse ${patchFile}; file unchanged: ${error.message}`); }
  if (!Array.isArray(doc)) fatal(`${patchFile} must contain a YAML array; file unchanged`);
  let removed = 0;
  const kept = [];
  for (const operation of doc) {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
      fatal(`invalid patch operation in ${patchFile}; file unchanged`);
    }
    if (!Object.hasOwn(operation, 'insert')) { kept.push(operation); continue; }
    if (!Array.isArray(operation.insert)) fatal(`insert must be an array in ${patchFile}; file unchanged`);
    const entries = operation.insert.filter((entry) => {
      if (!MANAGED_MCP_IDS.includes(entry?.id)) return true;
      removed++;
      return false;
    });
    // Retain shared insert parents and their selectors/other operation fields.
    if (entries.length || Object.keys(operation).length > 1) kept.push({ ...operation, insert: entries });
  }
  const text = (kept.length ? `${yaml.dump(kept, { lineWidth: -1, noRefs: true })}\n` : '') + mcpEntries();
  return { patchFile, original, text, removed };
}

function patchCordis({ patchFile, original, text, removed }) {
  ensureDir(path.dirname(patchFile));
  // Parsing/serialization normalizes formatting; keep the original text (including comments).
  let backup = null;
  if (original && original !== text) {
    backup = backupBeforeOverwrite(patchFile);
    if (!backup) fatal(`无法备份 ${patchFile}，为避免污染 profile 已停止；请先手动备份后重试`);
  }
  writeTextAtomic(patchFile, text);
  log(`cordis.patch.yml: MCP 条目已同步（清理旧条目 ${removed} 条，写入 ${MANAGED_MCP_IDS.length} 条）`);
  return { patchFile, backup };
}

/**
 * 建一个指向本仓库的目录链接（Windows 用 junction，免管理员权限）。
 *
 * 链接已存在时校验指向：指向本仓库 ⇒ 跳过（幂等）；指向别处/悬空 ⇒ 重建。
 * 指向别处说明用户手工挪过文件，这里按"重装"处理并明确打印。
 */
function ensureDirLink(linkPath, targetDir, label) {
  if (!fs.existsSync(targetDir)) fatal(`${label} 源目录不存在: ${targetDir}`);
  ensureDir(path.dirname(linkPath));

  let existing = null;
  try {
    existing = fs.lstatSync(linkPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') fatal(`failed to inspect ${label}: ${error?.message ?? error}`);
  }

  if (existing) {
    if (!existing.isSymbolicLink()) {
      fatal(`${label} 已存在且不是符号链接/junction: ${linkPath}。请先手工移走或删除，然后重跑。`);
    }
    let sameTarget = false;
    try {
      const target = fs.realpathSync(linkPath);
      const expected = fs.realpathSync(targetDir);
      sameTarget = process.platform === 'win32'
        ? String(target).toLowerCase() === String(expected).toLowerCase()
        : String(target) === String(expected);
    } catch {}
    if (sameTarget) {
      log(`${label} 已存在且指向本仓库: ${linkPath}`);
      return linkPath;
    }
    log(`${label} 存在但指向别处/失效，重建: ${linkPath}`);
    fs.rmSync(linkPath, { recursive: true, force: true });
  }

  try {
    if (process.platform === 'win32') {
      fs.symlinkSync(targetDir, linkPath, 'junction');
    } else {
      fs.symlinkSync(targetDir, linkPath, 'dir');
    }
    log(`${label} 已创建: ${linkPath}`);
  } catch (e) {
    fatal(`failed to create ${label}: ${e.message}`);
  }
  return linkPath;
}

/**
 * 把仓库里的 bundle 包接进 profile。
 *
 * 两层链接，与 `dsh plugin install`（pnpm）物化出的形态一致：
 *   ~/.dsh/plugins/<name>  → 仓库目录（人工可读的"安装位"）
 *   <profile>/node_modules/<name> → ~/.dsh/plugins/<name>（Node 解析路径）
 * 第二层必须自己建：preset 子行按 profile 目录解析裸说明符
 * （surfcore/qq-tool-restrict.mjs），缺了它 preset 会整条挂载失败。
 */
function ensureBundle(name) {
  const repoDir = path.join(REPO_ROOT, 'plugins', name);
  const linkDir = ensureDirLink(path.join(DSH_HOME, 'plugins', name), repoDir, `bundle ${name} link`);
  ensureDirLink(path.join(DSH_HOME, 'profiles', PROFILE, 'node_modules', name), linkDir, `bundle ${name} node_modules link`);
  return linkDir;
}

function patchProfilePackage(links) {
  const profileDir = path.join(DSH_HOME, 'profiles', PROFILE);
  const pkgFile = path.join(profileDir, 'package.json');
  ensureDir(profileDir);
  let pkg = { name: `dsh-profile-${PROFILE}`, private: true, dependencies: {}, dsh: { profile: { bundles: [] } } };
  let backup = null;
  if (fs.existsSync(pkgFile)) {
    try {
      pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    } catch (e) {
      fatal(`failed to parse ${pkgFile}: ${e.message}`);
    }
    backup = backupBeforeOverwrite(pkgFile);
    if (!backup) {
      fatal(`无法备份 ${pkgFile}，为避免污染 profile 已停止；请先手动备份后重试`);
    }
  }
  pkg.name = pkg.name || `dsh-profile-${PROFILE}`;
  pkg.private = pkg.private !== false;
  if (!pkg.dependencies || typeof pkg.dependencies !== 'object' || Array.isArray(pkg.dependencies)) pkg.dependencies = {};
  pkg.dsh = pkg.dsh || {};
  pkg.dsh.profile = pkg.dsh.profile || {};
  if (!Array.isArray(pkg.dsh.profile.bundles)) pkg.dsh.profile.bundles = [];
  for (const [name, linkDir] of Object.entries(links)) {
    const linkVal = `link:${linkDir.replace(/\\/g, '/')}`;
    if (pkg.dependencies[name] !== linkVal) {
      pkg.dependencies[name] = linkVal;
      log(`package.json dependency ${name} -> ${linkVal}`);
    }
    if (!pkg.dsh.profile.bundles.includes(name)) {
      pkg.dsh.profile.bundles.push(name);
      log(`package.json bundle added: ${name}`);
    }
  }
  for (const stale of STALE_BUNDLES) {
    if (pkg.dependencies[stale]) { delete pkg.dependencies[stale]; log(`package.json removed legacy dependency: ${stale}`); }
    if (pkg.dsh.profile.bundles.includes(stale)) {
      pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter((x) => x !== stale);
      log(`package.json removed legacy bundle: ${stale}`);
    }
  }
  writeTextAtomic(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
  log(`profile package.json ensured: ${pkgFile}`);
  // 只删除指向旧 bundle 的 junction，不碰真实目录；旧 bundle 已并入 surfcore。
  for (const stale of STALE_BUNDLES) {
    for (const linkPath of [path.join(DSH_HOME, 'plugins', stale), path.join(profileDir, 'node_modules', stale)]) {
      try {
        if (fs.lstatSync(linkPath).isSymbolicLink()) {
          fs.unlinkSync(linkPath);
          log(`removed legacy bundle link: ${linkPath}`);
        }
      } catch {}
    }
  }
  return { pkgFile, backup };
}

function ensureLocalModeFile() {
  const stateDir = path.join(REPO_ROOT, 'state');
  const modeFile = path.join(stateDir, 'mode.json');
  if (fs.existsSync(modeFile)) {
    log(`state/mode.json already exists; leave as-is (current mode may be user-configured)`);
    return;
  }
  ensureDir(stateDir);
  // DSH 0.1.5 起不再有 'router-standard' preset；留空表示「用 DSH 自己声明的默认 preset」，
  // 由 bridge.js 的 resolvePresetName() 兜底（硬编码已下线的名字只会换来每次启动的误导性告警）。
  fs.writeFileSync(modeFile, `${JSON.stringify({ mode: 'reserved2', closedAgentPreset: '' }, null, 2)}\n`, 'utf8');
  log(`state/mode.json created with mode=reserved2 (fallback if DSH settings are not available)`);
}

// surfcore 以 link: 依赖注册进 profile package.json 后，DSH 首次启动
// 需要先安装一次才能解析这些 bundle（否则 cold start 报 "cannot resolve profile bundle"）。
// dsh CLI 可用时自动执行。
//
// 注意（2026-11-14）：打包版 DSH 自带 `resources\runtime\cli\bin\dsh.cmd`，但**不在 PATH**。
// 不处理的话这里会失败，而 v0.8.7 起失败会触发 profile 回滚 → 设置页里看不到 SurfCore。
// 所以先自动找 CLI（PATH → 注册表安装位置 → 运行中的 DSH 进程），找不到就**跳过并正常结束**。
function locateDshCli() {
  const explicit = String(process.env.QQ_BRIDGE_DSH_CLI || '').trim();
  if (explicit && fs.existsSync(explicit)) return { file: explicit, dir: path.dirname(explicit) };
  const pathDirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const names = process.platform === 'win32' ? ['dsh.cmd', 'dsh.exe', 'dsh'] : ['dsh'];
  for (const dir of pathDirs) {
    for (const name of names) {
      const file = path.join(dir, name);
      try {
        if (fs.existsSync(file) && fs.statSync(file).isFile()) return { file, dir };
      } catch {}
    }
  }
  if (process.platform !== 'win32' || process.env.QQ_BRIDGE_SKIP_DSH_CLI_DETECT === '1') return null;
  const installDirs = new Set();
  // Windows 卸载项里 DisplayIcon / UninstallString 都指向安装目录里的 exe。
  for (const key of [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ]) {
    const r = spawnSync('reg', ['query', key, '/s', '/f', 'DeepSeek Harness'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    if (!r || r.status !== 0 || !r.stdout) continue;
    for (const line of String(r.stdout).split(/\r?\n/)) {
      const m = /^\s*(DisplayIcon|UninstallString)\s+REG_\w+\s+(.+?)\s*$/.exec(line);
      if (!m) continue;
      const raw = m[2].replace(/^"|"$/g, '').replace(/,\d+$/, '');
      const exe = /^(.+\.exe)/.exec(raw)?.[1];
      if (exe) installDirs.add(path.dirname(exe));
    }
  }
  // 安装时 DSH 通常开着，直接问进程路径。
  try {
    const ps = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/v:off', '/s', '/c',
      'powershell -NoProfile -NonInteractive -Command "(Get-Process \'DeepSeek Harness\' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path)"'],
    { encoding: 'utf8', windowsHide: true, timeout: 20000 });
    const exe = String(ps?.stdout || '').trim();
    if (exe && /\.exe$/i.test(exe)) installDirs.add(path.dirname(exe));
  } catch {}
  for (const dir of installDirs) {
    const candidate = path.join(dir, 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd');
    try {
      if (fs.existsSync(candidate)) return { file: candidate, dir: path.dirname(candidate) };
    } catch {}
  }
  return null;
}

function autoInstallProfileBundles() {
  if (process.env.QQ_BRIDGE_SKIP_DSH_INSTALL === '1') {
    log('auto-install skipped: QQ_BRIDGE_SKIP_DSH_INSTALL=1');
    return { attempted: false, ok: true };
  }
  const windows = process.platform === 'win32';
  const cli = locateDshCli();
  if (!cli) {
    // 缺 CLI 不是安装错误：profile 已写好，DSH 启动时会解析它；缺的只是这一次 pnpm reconcile。
    // 以前这里直接 fatal + 回滚，结果是「打包版 DSH 装完设置页里没有 SurfCore」。
    log('没找到 dsh CLI，跳过自动安装（profile 已写好，重启 DSH 即可）。');
    log('补跑方式：把 <DSH 安装目录>\\resources\\runtime\\cli\\bin 加进 PATH 后重跑本脚本，或设 QQ_BRIDGE_DSH_CLI 指向 dsh.cmd。');
    return { attempted: false, ok: true };
  }
  // Node cannot spawn npm's .cmd shim directly. Keep the shell command constant;
  // the validated (no quotes/control chars) profile travels through one quoted
  // environment expansion, with delayed expansion disabled to preserve '!'.
  const cmd = windows ? (process.env.ComSpec || 'cmd.exe') : cli.file;
  const args = windows
    ? ['/d', '/v:off', '/s', '/c', 'dsh.cmd plugin --profile "%QQ_BRIDGE_SETUP_PROFILE%" install']
    : ['plugin', '--profile', PROFILE, 'install'];
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout: 120000,
    windowsHide: true,
    windowsVerbatimArguments: windows,
    env: {
      ...process.env,
      ...(windows ? { PATH: `${cli.dir}${path.delimiter}${process.env.PATH || ''}`, QQ_BRIDGE_SETUP_PROFILE: PROFILE } : {}),
    },
  });
  if (r.error) {
    log(`auto-install failed to start/complete（${r.error.code || r.error.message}）。`);
    return { attempted: true, ok: false, reason: `无法启动/完成 dsh plugin install：${r.error.code || r.error.message}` };
  }
  if (r.status === 0) {
    log(`dsh plugin --profile ${PROFILE} install: OK`);
    return { attempted: true, ok: true };
  }
  log(`dsh plugin --profile ${PROFILE} install 返回退出码 ${r.status}。`);
  return { attempted: true, ok: false, reason: `dsh plugin install 返回退出码 ${r.status}` };
}

/** 安装后核对：原有 bundles/dependencies 不能被 DSH 的 reconcile 裁掉。 */
function verifyProfileAfterInstall(file, expected) {
  const actual = readProfileState(file);
  if (!actual) return `安装后读不到 ${file}（JSON 损坏）`;
  const lostBundles = expected.bundles.filter((name) => !actual.bundles.includes(name));
  const lostDependencies = expected.dependencies.filter((name) => !actual.dependencies.includes(name));
  const expectedSurfcore = BUNDLE_NAMES.every((name) => actual.bundles.includes(name));
  if (lostBundles.length || lostDependencies.length || !expectedSurfcore) {
    return [
      lostBundles.length ? `丢失 bundles：${lostBundles.join(', ')}` : '',
      lostDependencies.length ? `丢失 dependencies：${lostDependencies.join(', ')}` : '',
      expectedSurfcore ? '' : 'surfcore 没有留在 profile.bundles',
    ].filter(Boolean).join('；');
  }
  return '';
}

/** 安装前先拍下 setup 写入后的状态；安装后任何东西被裁掉就整体回滚到原 profile。 */
function rollbackProfile(pkg, patch) {
  restoreProfileFile(pkg.pkgFile, pkg.backup);
  restoreProfileFile(patch.patchFile, patch.backup);
}

// Validate the existing YAML before changing any presets or configuration.
const cordisPatch = prepareCordisPatch();
regeneratePresetPatches();
const patch = patchCordis(cordisPatch);
const links = {};
for (const name of BUNDLE_NAMES) links[name] = ensureBundle(name);
const profilePackage = patchProfilePackage(links);
reportLegacyPresetDir();
ensureLocalModeFile();

const expectedProfile = readProfileState(profilePackage.pkgFile);
const expectedPatch = fs.readFileSync(patch.patchFile, 'utf8');
const install = autoInstallProfileBundles();
if (install.attempted) {
  const reason = install.ok
    ? (verifyProfileAfterInstall(profilePackage.pkgFile, expectedProfile)
      || (fs.readFileSync(patch.patchFile, 'utf8') !== expectedPatch
        ? 'dsh plugin install 改动了 cordis.patch.yml'
        : ''))
    : install.reason || 'dsh plugin install 失败';
  if (reason) {
    rollbackProfile(profilePackage, patch);
    fatal(`安装失败，已回滚 profile 的 package.json / cordis.patch.yml：${reason}`);
  }
}
log('Done. Restart DSH (or reload the profile) so the new presets/MCP take effect.');
