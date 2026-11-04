/**
 * SurfCore · 桌宠栏目的宿主服务
 *
 * 设计原则（和语音栏目一致）：
 *   · 桌宠不随插件分发，默认「未安装」；
 *   · 用户在「桌宠」页填安装包地址 → 点安装 → 解压到 <STATE_DIR>/pet/app；
 *   · 启动需要本机 electron.exe，路径由用户填；
 *   · 本服务只做「安装 / 卸载 / 启动 / 停止 / 状态」，不做业务。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import zlib from 'node:zlib';

const EMPTY_CONFIG = { source: '', electronPath: '', appDir: '', mirror: '', installedAt: null };

/** 安装成功后写进安装目录的标记文件：证明"这个目录是本程序装的"，删除前必须有它。 */
export const PET_MARKER = '.surfcore-pet.json';

/**
 * 老安装的认领规则（2026-10-26 补）：本改动之前装好的目录没有标记文件，
 * 但它们**长得就是桌宠**——用三个只有桌宠包才会同时具备的特征来认：
 *   ① `skins/` 目录（皮的清单在 `<app>/skins/<id>/manifest.json`）；
 *   ② `package.json` 的 name 含 `pet` / `feiyu`（当前包名 `feiyu-pet`）；
 *   ③ `dist/` 或 `run.pid` 之一存在。
 * 认领成功后调用方会补写标记文件，之后就走强证据。
 *
 * ⚠️ 为什么不"只要有 package.json 就算"：任何工程根目录都有 package.json，
 * 那正是这条安全闸要挡的场景（见 PITFALLS #75）。
 */
export function looksLikePetInstall(dir) {
  try {
    const abs = path.resolve(String(dir || ''));
    const pkgFile = path.join(abs, 'package.json');
    if (!fs.existsSync(path.join(abs, 'skins'))) return false;
    if (!fs.existsSync(pkgFile)) return false;
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    const name = String(pkg?.name ?? '').toLowerCase();
    if (!name.includes('pet') && !name.includes('feiyu')) return false;
    return fs.existsSync(path.join(abs, 'dist')) || fs.existsSync(path.join(abs, 'run.pid'));
  } catch {
    return false;
  }
}

/**
 * 「桌宠安装目录」能不能被本服务当作自己的目录来删/写。
 *
 * 为什么需要（2026-10-26 审计，RISK R34）：`appDir` 是用户在设置页自由填的，
 * 而 install / unzip / remove 三处对它做 `fs.rmSync(recursive, force)`。
 * 以前只做 `path.resolve`，于是把安装目录填成别的工程目录 → 点安装/卸载就**整目录清空**。
 * 这里用三层证据挡住：
 *   ① 不是盘根，也不是任何受保护目录（自身或上级）；
 *   ② 已存在时必须是**空的**，或者带着本程序写的标记文件（`allowNonEmpty` 由调用方判定）；
 *   ③ 已存在但不能是文件。
 * 纯函数（只读 fs），便于单测：`scripts/test-pet-dir-guard.mjs`。
 *
 * @returns {{ok: boolean, abs: string, reason?: string}}
 */
export function checkAppDir(target, { protectedPaths = [], allowNonEmpty = false } = {}) {
  const raw = String(target ?? '').trim();
  const abs = path.resolve(raw || '.');
  if (!raw) return { ok: false, abs, reason: '路径为空' };
  // Windows 下必须带盘符：`/dswork/pet` 会被解析到"当前盘"，用户以为装到 D 盘、其实进了 C 盘（2026-10-30 反馈）
  if (process.platform === 'win32' && !/^[A-Za-z]:[\\/]/.test(raw)) {
    return {
      ok: false, abs, code: 'pet.path-no-drive',
      reason: `「${raw}」缺少盘符（会装到当前盘 ${abs}）`,
      hint: 'Windows 请填 D:\dshwork\pet 这种带盘符的完整路径',
    };
  }
  if (path.parse(abs).root === abs) return { ok: false, abs, reason: '不能是磁盘根目录' };

  const norm = (p) => path.resolve(String(p)).replace(/[\\/]+$/, '').toLowerCase();
  const self = norm(abs);
  const sep = path.sep.toLowerCase();
  for (const item of protectedPaths) {
    if (!item) continue;
    const guard = norm(item);
    if (self === guard) return { ok: false, abs, reason: `不能与受保护目录相同：${item}` };
    if (guard.startsWith(self + sep) || guard === self) {
      return { ok: false, abs, reason: `不能是受保护目录的上级：${self} ⊃ ${item}` };
    }
  }

  if (fs.existsSync(abs)) {
    let stat = null;
    try { stat = fs.statSync(abs); } catch { return { ok: false, abs, reason: '路径不可访问' }; }
    if (!stat.isDirectory()) return { ok: false, abs, reason: '目标已存在且不是目录' };
    let entries = [];
    try { entries = fs.readdirSync(abs); } catch { return { ok: false, abs, reason: '目录不可读' }; }
    if (entries.length > 0 && !allowNonEmpty) {
      return {
        ok: false, abs,
        reason: '目标目录非空，且看不到本程序的安装标记（拒绝删除；请换一个空目录，或留空用默认目录）',
      };
    }
  }
  return { ok: true, abs };
}

function run(file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, ...options }, (error, stdout, stderr) => {
      resolve({ error, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

function dirSize(dir) {
  let total = 0;
  let stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else {
        try { total += fs.statSync(p).size; } catch {}
      }
    }
  }
  return total;
}


// ── Electron 运行时（桌宠宿主）────────────────────────────────────────────
// 桌宠安装包不带运行时：要么用户自己装过 Electron，要么我们帮他下一个。
// 镜像用 npmmirror（国内快），版本固定成与桌宠同源的 45.x。
export const ELECTRON_VERSION = '45.0.0';
export const ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron';

/**
 * macOS 移植（2026-11-03）：Electron 的可执行文件名/压缩包名都是按平台的。
 *  - win32：electron.exe / electron-v<ver>-win32-x64.zip
 *  - darwin：Electron.app/Contents/MacOS/Electron / electron-v<ver>-darwin-<arch>.zip
 *  - linux：electron / electron-v<ver>-linux-<arch>.zip
 * 之前的写死值导致 mac 上一键下载 Electron 永远 404、检测永远找不到运行时。
 */
export function electronPlatform() {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  if (process.platform === 'linux') return process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
  return 'win32-x64';
}

/** 解压到 <dir> 后，Electron 可执行文件在 <dir>/<返回值>。 */
export function electronBinaryRelativePath() {
  if (process.platform === 'darwin') return path.join('Electron.app', 'Contents', 'MacOS', 'Electron');
  if (process.platform === 'linux') return 'electron';
  return 'electron.exe';
}

export function electronDownloadUrl(version = ELECTRON_VERSION) {
  return `${ELECTRON_MIRROR}/${version}/electron-v${version}-${electronPlatform()}.zip`;
}

/** GitHub 官方源（镜像挂掉时的备选；国内可能慢）。 */
export function electronGitHubUrl(version = ELECTRON_VERSION) {
  return `https://github.com/electron/electron/releases/download/v${version}/electron-v${version}-${electronPlatform()}.zip`;
}

/** 常见 Electron 位置（按可信度排）。cfgPath / appDir 传进来就优先用。 */
export function electronCandidates({ cfgPath = '', appDir = '', stateDir = '' } = {}) {
  const out = [];
  const push = (p) => { const t = String(p || '').trim(); if (t && !out.includes(t)) out.push(t); };
  const binRel = electronBinaryRelativePath();
  push(cfgPath);
  if (stateDir) push(path.join(stateDir, 'runtime', `electron-v${ELECTRON_VERSION}`, binRel));
  if (appDir) push(path.join(path.dirname(appDir), 'node_modules', 'electron', 'dist', binRel));
  if (process.platform === 'darwin') {
    // 本仓库旁的便携 Electron（npm i electron 装下来的样子）
    push(path.join(os.homedir(), 'Desktop', '鲸鱼', 'pet', 'runtime', 'node_modules', 'electron', 'dist', binRel));
    // 全局 npm 安装
    push(path.join('/usr/local/lib/node_modules', 'electron', 'dist', binRel));
    push(path.join('/opt/homebrew/lib/node_modules', 'electron', 'dist', binRel));
    push(path.join(os.homedir(), '.npm-global', 'lib', 'node_modules', 'electron', 'dist', binRel));
    // /Applications 里的 Electron.app
    push(path.join('/Applications', 'Electron.app', 'Contents', 'MacOS', 'Electron'));
    return out;
  }
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  push(path.join(local, 'Programs', 'electron', 'electron.exe'));
  push(path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Electron', 'electron.exe'));
  return out;
}

export function detectElectronPath(options = {}) {
  for (const file of electronCandidates(options)) {
    try { if (fs.existsSync(file)) return file; } catch {}
  }
  return '';
}

/** 下载并解压 Electron 到 <stateDir>/runtime/electron-v<版本>/。 */
export async function installElectronRuntime({ stateDir, log = () => {}, version = ELECTRON_VERSION, source = 'auto', onProgress = () => {} } = {}) {
  if (!stateDir) throw new Error('缺少 stateDir');
  const dest = path.join(stateDir, 'runtime', `electron-v${version}`);
  const exe = path.join(dest, electronBinaryRelativePath());
  if (fs.existsSync(exe)) return { ok: true, already: true, electronPath: exe, dir: dest };

  // auto：先镜像再官方；也允许调用方强制指定（镜像挂了 / 官方更快）
  const urls = source === 'github'
    ? [electronGitHubUrl(version)]
    : source === 'mirror'
      ? [electronDownloadUrl(version)]
      : [electronDownloadUrl(version), electronGitHubUrl(version)];

  const { Readable } = await import('node:stream');
  const { pipeline } = await import('node:stream/promises');
  let lastError = null;
  for (const url of urls) {
    const tmp = path.join(stateDir, 'runtime', `tmp-${Date.now()}`);
    fs.mkdirSync(tmp, { recursive: true });
    const zip = path.join(tmp, 'electron.zip');
    try {
      log(`[pet] 下载 Electron ${version}：${url}`);
      const res = await fetch(url, { signal: AbortSignal.timeout(900_000), redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // 进度：读 content-length 算比例（下载阶段占 0~90%）
      const total = Number(res.headers.get('content-length') || 0);
      let got = 0;
      const src2 = Readable.fromWeb(res.body);
      src2.on('data', (c) => { got += c.length; onProgress(total ? Math.min(90, Math.round((got / total) * 90)) : 5, '下载 Electron'); });
      await pipeline(src2, fs.createWriteStream(zip));
      onProgress(95, '解压 Electron');
      fs.mkdirSync(dest, { recursive: true });
      await new Promise((resolve, reject) => {
        // macOS/Linux 没有 Expand-Archive，用系统自带 unzip（macOS 默认有）。
        if (process.platform === 'darwin' || process.platform === 'linux') {
          const child = spawn('unzip', ['-o', '-q', zip, '-d', dest], { stdio: 'ignore' });
          child.on('error', reject);
          child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`解压失败（exit ${code}）`))));
          return;
        }
        const child = spawn('powershell', ['-NoProfile', '-Command',
          `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dest}' -Force`],
        { windowsHide: true, stdio: 'ignore' });
        child.on('error', reject);
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`解压失败（exit ${code}）`))));
      });
      if (!fs.existsSync(exe)) throw new Error(`解压后没找到 Electron 可执行文件（${electronBinaryRelativePath()}）`);
      return { ok: true, electronPath: exe, dir: dest, version, source: url };
    } catch (error) {
      lastError = error;
      const msg = String(error?.message ?? error);
      log(`[pet] 源失败（${url}）：${msg}`);
      try { fs.rmSync(dest, { recursive: true, force: true }); } catch {}
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    }
  }
  throw new Error(`下载 Electron 失败（镜像和官方源都试过了）：${String(lastError?.message ?? lastError ?? '未知错误')}`);
}


/**
 * 纯 Node 的 zip 解压（macOS/Linux 用），替代 `unzip`/`ditto`。
 *
 * 为什么需要（2026-11-03 实测）：
 *   surfpet 的 pet-pack.zip 里文件名是 **Windows 风格反斜杠 + GBK 编码**（如 `skins\feiyu-01\...`、
 *   `启动说明.txt`）。macOS 的 `unzip` 会警告 "appears to use backslashes as path separators"，
 *   遇到中文名还会写出乱码文件名、甚至卡在 "write error (disk full?). Continue? (y/n)" 直到被杀；
 *   `ditto -x -k` 则把反斜杠当普通字符，解出 `assets\icon.png` 这种整名字文件。
 *   两者都会让"一键安装"在 mac 上失败。
 *
 * 这里直接读 zip 中央目录：按需 inflateRaw，UTF-8 标志位没置时用 GBK 解码文件名，
 * 再把 `\` 统一成 `/`。不依赖外部命令。
 */
export function unzipWithNode(zipPath, dest) {
  const buf = fs.readFileSync(zipPath);
  // 找 EOCD（End Of Central Directory）：0x06054b50，可能带注释，从尾部往前扫
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('不是有效的 zip（找不到 EOCD）');
  const entryCount = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const decodeName = (raw, utf8Flag) => {
    if (utf8Flag) return raw.toString('utf8');
    for (const enc of ['gbk', 'gb18030', 'utf8']) {
      try { return new TextDecoder(enc, { fatal: false }).decode(raw); } catch {}
    }
    return raw.toString('latin1');
  };
  let wrote = 0;
  for (let n = 0; n < entryCount; n += 1) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('zip 中央目录损坏');
    const flags = buf.readUInt16LE(off + 8);
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const uncompSize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const rawName = buf.subarray(off + 46, off + 46 + nameLen);
    let name = decodeName(rawName, (flags & 0x800) !== 0).replace(/\\/g, '/');
    off += 46 + nameLen + extraLen + commentLen;
    if (!name || name.includes('..') || path.isAbsolute(name)) continue;
    const target = path.join(dest, name);
    if (name.endsWith('/')) { fs.mkdirSync(target, { recursive: true }); continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // 读本地文件头，跳过它自己的 name/extra（长度可能和中央目录不同）
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error(`不支持的 zip 压缩方式：${method}（${name}）`);
    if (uncompSize && data.length !== uncompSize) throw new Error(`解压大小不符：${name}`);
    fs.writeFileSync(target, data);
    wrote += 1;
  }
  return { ok: true, files: wrote };
}

/** 单层目录拍平：GitHub 源码 zip 解压后是 `<repo>-main/…`，把里面的内容提上来。 */
export function flattenSingleTopDir(dest) {
  try {
    const entries = fs.readdirSync(dest, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());
    const files = entries.filter((e) => !e.isDirectory());
    if (dirs.length !== 1 || files.length > 0) return false;
    if (fs.existsSync(path.join(dest, 'package.json'))) return false;
    const inner = path.join(dest, dirs[0].name);
    if (!fs.existsSync(path.join(inner, 'package.json'))) return false;
    for (const name of fs.readdirSync(inner)) {
      fs.renameSync(path.join(inner, name), path.join(dest, name));
    }
    fs.rmSync(inner, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/** 识别"下错包"：SurfCore 源码 zip / 任意非桌宠仓库。 */
export function looksLikeWrongPackage(dest) {
  const has = (rel) => fs.existsSync(path.join(dest, rel));
  if (has('plugins/surfcore') || has('dsh/agent-presets')) return 'surfcore';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf8'));
    const name = String(pkg?.name ?? '').toLowerCase();
    if (name === 'surfcore' || name.includes('surfcore')) return 'surfcore';
    if (name && !name.includes('pet') && !name.includes('feiyu')) return 'other';
  } catch {}
  if (has('src') && has('docs') && !has('skins')) return 'other';
  return '';
}

export function createPetService({ stateDir, pluginLog = () => {}, subprocess = null, getSubprocess = null }) {
  const root = path.join(stateDir, 'pet');
  const defaultAppDir = path.join(root, 'app');
  // 安装目录可配置：有的环境（沙箱 / 只读用户目录）不允许在 ~/.dsh 下创建 Chromium profile
  const resolveAppDir = () => {
    const cfg = readConfig();
    const custom = String(cfg.appDir || '').trim();
    return custom ? path.resolve(custom) : defaultAppDir;
  };
  const markerFile = () => path.join(resolveAppDir(), PET_MARKER);
  /** 哪些目录绝不能被当成"桌宠安装目录"整棵删掉。 */
  const protectedPaths = () => [root, stateDir, path.dirname(stateDir), os.homedir()];
  /** 这个目录是不是"我们装的"：有标记文件；或（老版本）默认目录/看起来就是桌宠包的目录。 */
  const ownedByUs = () => {
    const abs = resolveAppDir();
    try { if (fs.existsSync(markerFile())) return true; } catch {}
    if (abs === defaultAppDir && appPackage()) return true;
    if (looksLikePetInstall(abs)) {
      // 认领：补写标记，下次就走强证据（只写一个几十字节的文件，不动其它内容）
      writeMarker({ adopted: true });
      return true;
    }
    return false;
  };
  /**
   * 所有会 **删除安装目录** 的操作前都必须过这里（install / unzip / remove）。
   * 不安全就抛错——宁可不装，也不能删别人的目录。
   */
  function assertAppDirDeletable(action) {
    const abs = resolveAppDir();
    const check = checkAppDir(abs, { protectedPaths: protectedPaths(), allowNonEmpty: ownedByUs() });
    if (!check.ok) {
      throw new Error(`安装目录不安全，已拒绝${action}：${check.reason}（当前：${abs}）`);
    }
    return abs;
  }
  /** 装好后写标记：下次才允许覆盖/卸载这个目录。 */
  function writeMarker(extra = {}) {
    try {
      fs.mkdirSync(resolveAppDir(), { recursive: true });
      fs.writeFileSync(markerFile(), JSON.stringify({
        app: 'surfcore-pet',
        installedAt: new Date().toISOString(),
        ...extra,
      }, null, 2));
    } catch (error) {
      pluginLog('[pet] 写安装标记失败：', String(error?.message ?? error));
    }
  }
  const tmpDir = path.join(root, 'tmp');
  const cfgFile = path.join(root, 'config.json');
  const pidFile = path.join(root, 'pet.pid');

  let petHandle = null;

  function ensureDirs() {
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  function readConfig() {
    try {
      const raw = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
      return { ...EMPTY_CONFIG, ...raw };
    } catch {
      return { ...EMPTY_CONFIG };
    }
  }

  function writeConfig(patch = {}) {
    ensureDirs();
    const next = { ...readConfig(), ...patch };
    fs.writeFileSync(cfgFile, JSON.stringify(next, null, 2));
    return next;
  }

  function appPackage() {
    try {
      return JSON.parse(fs.readFileSync(path.join(resolveAppDir(), 'package.json'), 'utf8'));
    } catch {
      return null;
    }
  }

  function installed() {
    return Boolean(appPackage());
  }

  function readPid() {
    // 桌宠自己会在安装目录写 run.pid（explorer 拉起时拿不到子进程 pid，只能读文件）
    for (const file of [path.join(resolveAppDir(), 'run.pid'), pidFile]) {
      try {
        const pid = Number(fs.readFileSync(file, 'utf8').trim());
        if (Number.isFinite(pid) && pid > 0) return pid;
      } catch {}
    }
    return 0;
  }

  function pidAlive(pid) {
    if (!pid) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error?.code === 'EPERM';
    }
  }

  function running() {
    return pidAlive(readPid());
  }

  function waitPid(timeoutMs = 9000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const pid = readPid();
      if (pid && pidAlive(pid)) return pid;
      const end = Date.now() + 150;
      while (Date.now() < end) { /* spin */ }
    }
    return 0;
  }

  function readSkins() {
    const dir = path.join(resolveAppDir(), 'skins');
    const out = [];
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return out; }
    for (const id of names) {
      if (id.startsWith('_')) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, id, 'manifest.json'), 'utf8'));
        out.push({ id, name: manifest.name || id });
      } catch {}
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return out;
  }

  function status() {
    // 安装进度（前端画条用）
    const cfg = readConfig();
    const pkg = appPackage();
    return {
      ok: true,
      installing: installJob ? { ...installJob } : null,
      installed: Boolean(pkg),
      running: running(),
      pid: readPid() || null,
      dir: resolveAppDir(),
      appDir: String(readConfig().appDir || ''),
      source: cfg.source || '',
      electronPath: cfg.electronPath || '',
      mirror: cfg.mirror || '',
      installedAt: cfg.installedAt || null,
      sizeBytes: pkg ? dirSize(resolveAppDir()) : 0,
      version: pkg?.version || null,
      skins: pkg ? readSkins() : [],
      electronOk: Boolean(cfg.electronPath) && fs.existsSync(cfg.electronPath),
      // 安装目录是否可安全删除/覆盖（用户手填的路径可能指到别的目录，见 RISK R34）。
      appDirSafe: checkAppDir(resolveAppDir(), { protectedPaths: protectedPaths(), allowNonEmpty: ownedByUs() }),
    };
  }

  function configure(patch = {}) {
    const next = {};
    if (typeof patch.source === 'string') next.source = patch.source.trim();
    if (typeof patch.electronPath === 'string') next.electronPath = patch.electronPath.trim();
    if (typeof patch.mirror === 'string') next.mirror = patch.mirror.trim();
    if (typeof patch.appDir === 'string') next.appDir = patch.appDir.trim();
    writeConfig(next);
    return status();
  }

  function mirrorUrl(url) {
    const cfgMirror = String(readConfig().mirror || '').trim().replace(/\/+$/, '');
    if (!cfgMirror || !/^https?:\/\//i.test(url)) return url;
    return `${cfgMirror}/${url}`;
  }

  /** 清理安装目录（失败残留 / 手动重来）：只在非运行、路径安全时允许。 */
  async function cleanAppDir() {
    if (running()) return { ok: false, error: '桌宠还在运行，先停止' };
    const abs = resolveAppDir();
    const check = checkAppDir(abs, { protectedPaths: protectedPaths(), allowNonEmpty: true });
    if (!check.ok) return { ok: false, error: check.reason };
    try { fs.rmSync(abs, { recursive: true, force: true }); } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
    pluginLog('pet: 已清理安装目录', abs);
    return { ok: true, ...status() };
  }

  async function download(url) {
    ensureDirs();
    const target = path.join(tmpDir, `pet-pack-${Date.now()}.zip`);
    const res = await fetch(mirrorUrl(url), { redirect: 'follow', signal: AbortSignal.timeout(20 * 60_000) });
    if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length') || 0);
    let got = 0;
    const out = fs.createWriteStream(target);
    for await (const chunk of res.body) {
      got += chunk.length;
      out.write(chunk);
      // 0~80% 留给下载，解压/校验占后段
      setJob({ phase: '下载安装包', progress: total ? Math.min(80, Math.round((got / total) * 80)) : 5, receivedBytes: got, totalBytes: total });
    }
    await new Promise((r) => out.end(r));
    if (got < 1024) throw new Error('下载内容过小，可能不是安装包');
    return target;
  }

  async function unzip(zipPath, dest) {
    // dest 只应是安装目录；删除前再校验一次（防止将来有人改了调用方）。
    checkAppDir(dest, { protectedPaths: protectedPaths(), allowNonEmpty: ownedByUs() });
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    if (process.platform === 'win32') {
      const { error, stderr } = await run('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`,
      ]);
      if (error) throw new Error(`解压失败：${stderr || error.message}`);
    } else {
      // macOS/Linux 用内置解压：surfpet 包是反斜杠 + GBK 文件名，系统 unzip 会卡住/写出乱码，
      // ditto 也会把反斜杠保留成文件名的一部分（见 unzipWithNode 注释）。
      try {
        unzipWithNode(zipPath, dest);
      } catch (error) {
        throw new Error(`解压失败：${error?.message ?? error}`);
      }
    }
  }

  // `sourceOverride`：更新流程（updates.js 下载好的 zip）直接传路径进来，
  // 不覆盖用户在设置页填的 source；安装时解压是"覆盖式"，data/ 等用户数据不会被删。
  // 安装任务状态：API 立刻返回，前端轮询 /pet/status 的 installing 字段画进度条。
  let installJob = null;
  const setJob = (patch) => { installJob = { ...(installJob || {}), ...patch, updatedAt: Date.now() }; };

  async function doInstall(sourceOverride) {
    const cfg = readConfig();
    const source = String(sourceOverride ?? cfg.source ?? '').trim();
    if (!source) {
      return {
        ok: false, code: 'pet.source-missing', field: 'source',
        error: '还没有安装包地址（zip 的本地路径或 http(s) 直链）',
        hint: '点「用官方最新版」自动填官方 pet-pack.zip，或把 zip 路径/直链粘进「安装包地址」再点安装',
      };
    }
    // 安装前先停：运行中覆盖文件会撞占用（卸载一直有 stop，安装以前没有）。
    try { if (running()) await stop(); } catch {}
    // 任何会删安装目录的安装方式都先过安全闸（RISK R34）。
    try { assertAppDirDeletable('安装（会覆盖旧安装）'); } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }

    let archive = source;
    let downloaded = null;
    try {
      if (/^https?:\/\//i.test(source)) {
        downloaded = await download(source);
        archive = downloaded;
      } else {
        archive = path.resolve(source);
        if (!fs.existsSync(archive)) return { ok: false, error: `找不到安装包：${archive}` };
        if (fs.statSync(archive).isDirectory()) {
          fs.rmSync(resolveAppDir(), { recursive: true, force: true });
          fs.cpSync(archive, resolveAppDir(), { recursive: true });
          if (!appPackage()) return { ok: false, error: '目录里没有 package.json，不是有效的桌宠包' };
          writeMarker({ source: archive });
          writeConfig({ installedAt: new Date().toISOString() });
          pluginLog('pet: installed from directory', archive);
          return { ok: true, ...status() };
        }
      }
      setJob({ phase: '解压中', progress: 85 });
      const appDir = resolveAppDir();
      await unzip(archive, appDir);
      // GitHub 源码 zip 会多一层 <repo>-main/：自动提上来（用户以为自己下的是安装包）
      if (flattenSingleTopDir(appDir)) pluginLog('pet: 已拍平单层目录（源码 zip 风格）');
      // 卸载时备份过的 data/ 放回来（新装才有意义；更新走 updateFromZip 自己的逻辑）。
      try {
        const keepData = path.join(stateDir, 'pet-data-keep', 'data');
        const appData = path.join(resolveAppDir(), 'data');
        if (fs.existsSync(keepData) && !fs.existsSync(appData)) {
          fs.cpSync(keepData, appData, { recursive: true, force: true });
          pluginLog('pet: 已恢复卸载前的 data/');
        }
      } catch {}
      try { fs.rmSync(path.join(resolveAppDir(), 'run.pid'), { force: true }); } catch {}
      const wrong = looksLikeWrongPackage(appDir);
      if (wrong) {
        // 装错了包：清掉本次解压出来的东西，别让下一次被"目录非空"拦住
        try { fs.rmSync(appDir, { recursive: true, force: true }); } catch {}
        return {
          ok: false,
          error: wrong === 'surfcore'
            ? '这是 SurfCore 的源码包，不是桌宠安装包。桌宠请用 pet-pack.zip（点「用官方最新版」）'
            : '这个 zip 里没有桌宠程序（不是 pet-pack.zip）。点「用官方最新版」重新下载',
        };
      }
      if (!appPackage()) {
        try { fs.rmSync(appDir, { recursive: true, force: true }); } catch {}
        return { ok: false, error: '解压后没有 package.json，安装包可能不完整；点「用官方最新版」重下' };
      }
      writeMarker({ source: String(archive) });
      writeConfig({ installedAt: new Date().toISOString() });
      pluginLog('pet: installed from', archive);
      return { ok: true, ...status() };
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    } finally {
      if (downloaded) { try { fs.rmSync(downloaded, { force: true }); } catch {} }
    }
  }

  async function stop() {
    try { petHandle?.kill?.(); } catch {}
    petHandle = null;
    const pid = readPid();
    if (!pid) return { ok: true, running: false };
    if (!pidAlive(pid)) {
      try { fs.rmSync(pidFile, { force: true }); } catch {}
      return { ok: true, running: false };
    }
    if (process.platform === 'win32') {
      await run('taskkill.exe', ['/PID', String(pid), '/T', '/F']);
    } else {
      try { process.kill(pid, 'SIGTERM'); } catch {}
    }
    try { fs.rmSync(pidFile, { force: true }); } catch {}
    try { fs.rmSync(path.join(resolveAppDir(), 'run.pid'), { force: true }); } catch {}
    await new Promise((r) => setTimeout(r, 400));
    return { ok: true, running: pidAlive(pid) ? true : false };
  }

  /** 异步安装：立刻返回，前端轮询 status().installing 画进度条。 */
  async function startInstall(sourceOverride, patch = {}) {
    if (installJob && !['完成', '失败'].includes(installJob.phase)) {
      return { ok: false, error: '安装正在进行中' };
    }
    // 设置页表单直接随安装请求一起提交：不能因为用户没点「保存设置」就丢掉填好的目录/地址
    // （2026-10-30：填了安装目录，点安装仍报"请先填写安装包地址"，config.json 里 source/appDir 都是空）。
    if (patch && typeof patch === 'object') {
      const next = {};
      if (typeof patch.source === 'string' && patch.source.trim()) next.source = patch.source.trim();
      else if (sourceOverride && String(sourceOverride).trim()) next.source = String(sourceOverride).trim();
      if (typeof patch.appDir === 'string') next.appDir = patch.appDir.trim();
      if (typeof patch.electronPath === 'string') next.electronPath = patch.electronPath.trim();
      if (Object.keys(next).length) configure(next);
    }
    const cfgNow = readConfig();
    const sourceNow = String(sourceOverride ?? cfgNow.source ?? '').trim();
    if (!sourceNow) {
      return {
        ok: false, code: 'pet.source-missing', field: 'source',
        error: '还没有安装包地址（zip 的本地路径或 http(s) 直链）',
        hint: '点「用官方最新版」自动填官方 pet-pack.zip，或把 zip 路径/直链粘进「安装包地址」再点安装',
      };
    }
    if (cfgNow.appDir && process.platform === 'win32' && !/^[A-Za-z]:[\\/]/.test(String(cfgNow.appDir))) {
      return {
        ok: false, code: 'pet.path-no-drive', field: 'appDir',
        error: `安装目录「${cfgNow.appDir}」缺少盘符（会被装到当前盘）`,
        hint: 'Windows 请填 D:\dshwork\pet 这种带盘符的完整路径',
      };
    }
    setJob({ phase: '准备中', progress: 0, error: null });
    (async () => {
      try {
        const r = await doInstall(sourceOverride);
        if (r && r.ok === false) setJob({ phase: '失败', error: r.error || '安装失败' });
        else setJob({ phase: '完成', progress: 100 });
      } catch (error) {
        setJob({ phase: '失败', error: String(error?.message ?? error) });
      } finally {
        setTimeout(() => { installJob = null; }, 10 * 60_000).unref?.();
      }
    })();
    return { ok: true, started: true };
  }

  async function remove() {
    try { assertAppDirDeletable('卸载'); } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
    if (running()) await stop();
    // 卸载前把用户数据搬出来：data/ 里是聊天记录和设置，删了就没法恢复（2026-10-27 用户实测踩到）。
    try {
      const appDir = resolveAppDir();
      const dataDir = path.join(appDir, 'data');
      if (fs.existsSync(dataDir)) {
        const keep = path.join(stateDir, 'pet-data-keep');
        fs.mkdirSync(keep, { recursive: true });
        fs.cpSync(dataDir, path.join(keep, 'data'), { recursive: true, force: true });
        pluginLog('pet: 卸载前已备份 data/ →', keep);
      }
    } catch (error) {
      pluginLog('pet: 备份 data/ 失败（继续卸载）：', String(error?.message ?? error));
    }
    fs.rmSync(resolveAppDir(), { recursive: true, force: true });
    writeConfig({ installedAt: null });
    pluginLog('pet: removed');
    return { ok: true, ...status() };
  }

  async function start() {
    if (!installed()) return { ok: false, error: '还没安装桌宠' };
    if (running()) return { ok: true, already: true, ...status() };
    const cfg = readConfig();
    let electron = String(cfg.electronPath || process.env.DSH_PET_ELECTRON || '').trim();
    if (!electron) {
      // 没填就试着从 PATH 里找一次（装了全局 electron 的用户可以少填一项）
      const probe = await run(process.platform === 'win32' ? 'where.exe' : 'which', ['electron']);
      const first = probe.stdout.split(String.fromCharCode(10)).map((x) => x.trim()).find(Boolean);
      if (first) electron = first;
    }
    if (!electron) return { ok: false, error: '请先填写 Electron 路径（electron.exe）' };
    if (!fs.existsSync(electron)) return { ok: false, error: `找不到 Electron：${electron}` };

    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    ensureDirs();
    try { fs.rmSync(pidFile, { force: true }); } catch {}
    const appDir = resolveAppDir();
    try { fs.rmSync(path.join(appDir, 'run.pid'), { force: true }); } catch {}
    env.FEIYU_PET_PIDFILE = path.join(appDir, 'run.pid');

    const logPath = path.join(root, 'start.log');
    let logFd = null;
    try { logFd = fs.openSync(logPath, 'a'); } catch {}

    const profileDir = path.join(appDir, 'data', 'profile');
    try { fs.mkdirSync(profileDir, { recursive: true }); } catch {}

    // --user-data-dir 必须在命令行给：Chromium 在 main 跑起来之前就初始化 profile，
    // 给晚了（app.setPath）等于没给；默认 profile 在受限环境下会 EPERM 直接崩。
    const args = ['.', '--no-sandbox', `--user-data-dir=${profileDir}`];
    let spawnedPid = 0;

    {
      const child = spawn(electron, args, {
        cwd: appDir,
        env,
        detached: true,
        stdio: ['ignore', logFd ?? 'ignore', logFd ?? 'ignore'],
        windowsHide: false,
      });
      child.unref();
      try { if (child.pid) fs.writeFileSync(pidFile, String(child.pid)); } catch {}
      await new Promise((r) => setTimeout(r, 1400));
      spawnedPid = (child.pid && pidAlive(child.pid)) ? child.pid : waitPid(6000);
    }
    if (logFd !== null) { try { fs.closeSync(logFd); } catch {} }

    if (!spawnedPid || !pidAlive(spawnedPid)) {
      return { ok: false, error: '桌宠进程启动后立刻退出了：检查 Electron 路径 / 安装包，或看 ~/.dsh/surfcore/pet/start.log' };
    }
    pluginLog('pet: started pid', spawnedPid);
    return { ok: true, pid: spawnedPid, ...status() };
  }

  // 更新用：保留 data/（Chromium profile + 本地数据）与用户自己加的 skins，其余整包替换。
  // `install()` 的 unzip 会先 rmSync 整个安装目录，所以**不能**拿它做更新（会丢数据）。
  async function updateFromZip(zipPath) {
    const appDir = resolveAppDir();
    try { if (running()) await stop(); } catch {}
    try { assertAppDirDeletable('更新（会替换安装目录）'); } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
    const stamp = String(Date.now());
    const staging = `${appDir}.new-${stamp}`;
    const backup = `${appDir}.old-${stamp}`;
    const copyMissing = (src, dst) => {
      if (!fs.existsSync(src)) return;
      fs.mkdirSync(dst, { recursive: true });
      for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const from = path.join(src, entry.name);
        const to = path.join(dst, entry.name);
        if (entry.isDirectory()) copyMissing(from, to);
        else if (!fs.existsSync(to)) fs.copyFileSync(from, to);
      }
    };
    try {
      fs.rmSync(staging, { recursive: true, force: true });
      await unzip(zipPath, staging);
      let pkg = null;
      try { pkg = JSON.parse(fs.readFileSync(path.join(staging, 'package.json'), 'utf8')); } catch {}
      if (!pkg) {
        fs.rmSync(staging, { recursive: true, force: true });
        return { ok: false, error: '安装包里没有 package.json，可能不完整' };
      }
      const hadOld = fs.existsSync(appDir);
      if (hadOld) fs.renameSync(appDir, backup);
      fs.renameSync(staging, appDir);
      if (hadOld) {
        // 用户数据：整份搬回来（新包自带的 data 模板不覆盖它）
        const oldData = path.join(backup, 'data');
        if (fs.existsSync(oldData)) fs.cpSync(oldData, path.join(appDir, 'data'), { recursive: true, force: true });
        // 用户自己加的皮肤：只补新包没有的，不覆盖新版资源
        copyMissing(path.join(backup, 'skins'), path.join(appDir, 'skins'));
      }
      try { fs.rmSync(path.join(appDir, 'run.pid'), { force: true }); } catch {}
      writeMarker({ source: String(zipPath) });
      writeConfig({ installedAt: new Date().toISOString() });
      if (hadOld) { try { fs.rmSync(backup, { recursive: true, force: true }); } catch {} }
      pluginLog('pet: updated from', zipPath, `v${pkg.version}`);
      return { ok: true, version: String(pkg.version ?? ''), ...status() };
    } catch (error) {
      // 回滚：新目录没就位就把备份换回来；已就位则保留备份供排查
      try {
        if (!fs.existsSync(appDir) && fs.existsSync(backup)) fs.renameSync(backup, appDir);
        else if (fs.existsSync(backup)) pluginLog('pet: 更新失败，旧目录保留在', backup);
      } catch {}
      try { fs.rmSync(staging, { recursive: true, force: true }); } catch {}
      return { ok: false, error: `更新失败：${String(error?.message ?? error)}` };
    }
  }

  return { status, configure, install: startInstall, startInstall, updateFromZip, remove, start, stop, running, cleanAppDir };
}
