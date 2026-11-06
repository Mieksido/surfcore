/**
 * 组件更新检查 / 应用（2026-10-26 用户需求）。
 *
 * 管的是"一坨可独立更新的东西"：
 *   · SurfCore 本体（本仓库）        ← DSH 插件与桥接都在里面
 *   · 语音包（surfvoice-local / -cloud）  ← 装在 voice-packs 目录下
 *   · 桌宠（surfpet）                ← 装在 pet/app
 *   · 未来加入的扩展                  ← 配置里 `updates.components[]` 登记
 *
 * 设计原则（和项目其它地方的删除/覆盖纪律一致）：
 *   1. **只读检查、显式确认更新**：检查只做 `git fetch`，不动工作区；
 *   2. **只允许快进**：更新用 `merge --ff-only`，本地有改动 / 有未推送提交一律拒绝，
 *      绝不 `reset --hard`、绝不 stash 用户东西；
 *   3. **"不再提示"只对这一次的远端 commit 生效**：`dismissed[id] = 远端 sha`，
 *      远端有新提交就会重新提示；
 *   4. **不阻塞启动**：检查是异步的，网络/仓库不存在都只是"这一项不可用"。
 *
 * 状态文件：`<stateDir>/updates.json`
 *   { dismissed: { [componentId]: remoteSha }, lastCheckAt, results: [...] }
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const GIT_TIMEOUT_MS = 30_000;
// 仓库根（plugins/surfcore/lib → ../../..）
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MAX_CHANGELOG = 20;
const DEFAULT_BRANCH = 'main';

// 下载超时策略（2026-10-31 用户反馈，27.6 KB/s 下 7.8MB 要 281 秒）：
//   · 空闲超时：连续 N 秒没有新数据才中断（有进度就续命）；
//   · 总上限：只用来兜底极端卡死。
// 之前是 AbortSignal.timeout(180s) 覆盖整个 body → 慢网必然失败。
const DOWNLOAD_IDLE_TIMEOUT_MS = 30_000;
const DOWNLOAD_MAX_TOTAL_MS = 20 * 60_000;
const DOWNLOAD_HINTS = {
  'download.timeout': '网络太慢/断流：稍后重试，或到 Release 页手动下载 zip 覆盖',
  'download.network': '连不上 GitHub/codeload：检查网络或代理后重试',
  'download.write-failed': '磁盘空间不足或目录没有写权限：清理空间/换安装目录后重试',
};

/** 下载失败归类（纯函数，单测覆盖）：abort→timeout；HTTP→http-N；fs→write-failed；其余→network。 */
export function classifyDownloadFailure({ aborted = false, httpStatus = 0, fsError = false, error = null } = {}) {
  if (fsError) return { code: 'download.write-failed', hint: DOWNLOAD_HINTS['download.write-failed'] };
  if (aborted) return { code: 'download.timeout', hint: DOWNLOAD_HINTS['download.timeout'] };
  if (httpStatus) return { code: `download.http-${httpStatus}`, hint: httpStatus === 404 ? '这个版本可能已被撤下：稍后重试或手动下载' : '稍后重试；持续失败可手动下载' };
  return {
    code: 'download.network',
    hint: `${DOWNLOAD_HINTS['download.network']}${error ? `（${String(error).slice(0, 120)}）` : ''}`,
  };
}

// 可选的 GitHub token：填了就把匿名 60 次/小时 换成账号的 5000 次/小时。
// 只用于 api.github.com 的读取请求；不写日志、不进诊断信息。
let githubToken = '';
export function setGitHubToken(token) {
  githubToken = String(token ?? '').trim();
}
export function githubTokenConfigured() {
  return Boolean(githubToken);
}
function ghHeaders(extra = {}) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'surfcore-updates', ...extra };
  if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
  return headers;
}

function runGit(args, { timeout = GIT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    execFile('git', args, {
      windowsHide: true,
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      // 绝不能卡在交互式凭据提示上（拉私有仓库时宁可失败）
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo', GCM_INTERACTIVE: 'never' },
    }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
        message: String(error?.message ?? ''),
      });
    });
  });
}

/** `git` 本身在不在（不在就整块功能降级，不报错）。 */
export async function gitAvailable() {
  const probe = await runGit(['--version'], { timeout: 5000 });
  return probe.ok ? probe.stdout.trim() : '';
}

/** 路径必须是"存在的目录"才往下问；不做任何拼接，避免把参数拼成 shell。 */
function normalizeDir(dir) {
  const raw = String(dir ?? '').trim();
  if (!raw) return '';
  try {
    const abs = path.resolve(raw);
    return fs.existsSync(abs) && fs.statSync(abs).isDirectory() ? abs : '';
  } catch {
    return '';
  }
}

/**
 * 检查单个组件（只读；`fetch` 时才会碰网络）。
 *
 * 两种通道，按组件声明自动选：
 *   · `kind: 'git'`     → 只走 git（fetch + 比较 HEAD/origin）
 *   · `kind: 'release'` → 只走版本清单（version.json），不要求是 git 仓库
 *   · 不写 kind（默认） → 是 git 工作区就 git，否则有 versionUrl 就走 release
 *
 * release 通道用于**构建产物型**组件（桌宠）：源码在 git 里开源，但用户装的是 zip 产物，
 * 没法（也不该）用 git 判断版本。
 */
/**
 * 纯版本号检查（不需要 .git）：读本地 package.json，跟 GitHub 最新 release/tag 比。
 * 目的：zip 安装、开发副本也能知道"最新是 0.4.8，我是 0.4.6"。
 */
function parseVersionParts(value) {
  const text = String(value ?? '').replace(/^v/i, '').trim();
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text);
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)], pre: m[4] ? m[4].split('.') : [] };
}

/**
 * 完整 semver 比较（含预发布）：
 *   0.8.6 > 0.8.6-dev.2 > 0.8.6-dev.1；0.8.7-dev.1 > 0.8.6。
 * 以前只比 core，导致 0.8.6-dev.N 与 0.8.6 相等，dev 通道永远判“没更新”。
 */
function semverCompare(a, b) {
  const x = parseVersionParts(a);
  const y = parseVersionParts(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (x.core[i] !== y.core[i]) return x.core[i] > y.core[i] ? 1 : -1;
  }
  if (!x.pre.length && !y.pre.length) return 0;
  if (!x.pre.length) return 1;   // 正式版高于同号预发布
  if (!y.pre.length) return -1;
  const len = Math.max(x.pre.length, y.pre.length);
  for (let i = 0; i < len; i += 1) {
    const a1 = x.pre[i];
    const b1 = y.pre[i];
    if (a1 === undefined) return -1;
    if (b1 === undefined) return 1;
    const an = /^\d+$/.test(a1);
    const bn = /^\d+$/.test(b1);
    if (an && bn) {
      const d = Number(a1) - Number(b1);
      if (d !== 0) return d > 0 ? 1 : -1;
    } else if (an !== bn) {
      return an ? -1 : 1; // 数字标识符低于字母标识符
    } else if (a1 !== b1) {
      return a1 > b1 ? 1 : -1;
    }
  }
  return 0;
}

const latestCache = new Map(); // repo -> { tag, url, at }
const commitShaCache = new Map(); // repo -> { sha, at }
const remoteVersionCache = new Map(); // repo -> { version, at }

/** 从 git remote URL 里取 owner/repo（https / ssh 都支持）。 */
function ownerRepoOf(url) {
  const m = /github\.com[:/]([^/]+)\/([^/\s]+?)(?:\.git)?$/i.exec(String(url || '').trim());
  return m ? `${m[1]}/${m[2]}` : '';
}

/** 读远端 main 的 package.json.version（用于弹窗里显示"更新到 vX"）。失败返回 ''。 */
async function fetchRemoteVersion(repo) {
  const cached = remoteVersionCache.get(repo);
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.version;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/package.json?ref=main`, {
      headers: ghHeaders(),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return cached?.version ?? '';
    const json = await res.json();
    const text = Buffer.from(String(json?.content ?? ''), 'base64').toString('utf8');
    const version = String(JSON.parse(text)?.version ?? '');
    if (version) remoteVersionCache.set(repo, { version, at: Date.now() });
    return version;
  } catch {
    return cached?.version ?? '';
  }
}

async function fetchCommitSha(repo) {
  const cached = commitShaCache.get(repo);
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.sha;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/commits/main`, {
      headers: ghHeaders(),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return cached?.sha ?? '';
    const json = await res.json();
    const sha = String(json?.sha ?? '');
    if (sha) commitShaCache.set(repo, { sha, at: Date.now() });
    return sha;
  } catch {
    return cached?.sha ?? '';
  }
}

/** 本地安装记录（voice 包在 install 时写入）：{ version, sha, at } */
/**
 * 生成"用 Node 跑 helper"的环境。
 * 插件跑在 DSH（Electron）里时 process.execPath 是宿主可执行文件：
 * 直接 spawn 一个 .mjs 会静默退出（实测 exit 0、什么都不做）→ 更新永远不落地。
 * 加 ELECTRON_RUN_AS_NODE=1 才能当 Node 用（2026-10-28 用户反馈：点几次都还是旧版本）。
 */
export function helperSpawnEnv(execPath = process.execPath, baseEnv = process.env) {
  const env = { ...baseEnv };
  const base = path.basename(String(execPath || '')).toLowerCase();
  if (base !== 'node' && base !== 'node.exe') env.ELECTRON_RUN_AS_NODE = '1';
  return env;
}

export function readInstalledMeta(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, '.installed-meta.json'), 'utf8'));
  } catch { return null; }
}

export function writeInstalledMeta(dir, meta) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.installed-meta.json'), `${JSON.stringify({ ...meta, at: new Date().toISOString() }, null, 2)}
`, 'utf8');
  } catch {}
}

/**
 * 首次 zip 解压安装没有安装证据。只允许对“看起来确实是 SurfCore 的解压目录”做一次性迁移，
 * 且必须由 UI 明确确认、先备份；git 工作副本永远不走这条路。
 */
function isTrustedZipInstall(dir) {
  try {
    if (!dir || fs.existsSync(path.join(dir, '.git'))) return false;
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return pkg?.name === 'surfcore';
  } catch { return false; }
}
const releaseManifestCache = new Map(); // versionUrl -> { json, at }

/**
 * 不消耗 API 配额的最新版本：请求 github.com/<repo>/releases/latest，
 * 从 302 的 Location 里读 tag（每次检查省一次 API 配额，未认证 60/h 根本不够用）。
 */
async function fetchLatestByRedirect(repo) {
  try {
    const res = await fetch(`https://github.com/${repo}/releases/latest`, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'surfcore-updates' },
    });
    const loc = res?.headers?.get?.('location') || '';
    const m = /\/releases\/tag\/([^/?#]+)/.exec(loc);
    if (m && m[1]) {
      return { tag: decodeURIComponent(m[1]), url: `https://github.com/${repo}/releases/tag/${m[1]}`, source: 'redirect' };
    }
  } catch {}
  return null;
}

/** 只查 tags（一次 API 调用），用于"redirect 说没更新，但可能只打了 tag 没发 Release"的复核。 */
async function fetchLatestTagOnly(repo) {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/tags?per_page=1`, {
      headers: ghHeaders(),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list) && list[0]?.name) {
        return { tag: list[0].name, url: `https://github.com/${repo}/releases`, source: 'tag' };
      }
    }
  } catch {}
  return null;
}

async function fetchLatestRelease(repo) {
  const headers = ghHeaders();
  const found = [];
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers, signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = await res.json();
      if (data?.tag_name) found.push({ tag: data.tag_name, url: data.html_url ?? `https://github.com/${repo}/releases`, source: 'release' });
    }
  } catch {}
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/tags?per_page=10`, { headers, signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list)) {
        for (const tag of list) {
          if (!tag?.name) continue;
          found.push({ tag: tag.name, url: `https://github.com/${repo}/releases`, source: 'tag' });
          break; // 只要最新的一个 tag，具体大小下面统一比较
        }
      }
    }
  } catch {}
  if (!found.length) {
    // 拉不到（限流 403 / 断网）时：6 小时内成功过的结果还能用，标 stale 让界面说清
    const cached = latestCache.get(repo);
    if (cached && Date.now() - cached.at < 6 * 3600_000) return { ...cached, stale: true };
    return null;
  }
  // ⚠️ Release 可能落后于 tag（常见：只打了 tag 忘了发 Release），取版本号较高的那个。
  found.sort((a, b) => semverCompare(b.tag, a.tag));
  const best = found[0];
  latestCache.set(repo, { tag: best.tag, url: best.url, at: Date.now() });
  return best;
}

/** 测试通道：从 GitHub pre-releases 里挑 semver 最高的 v*-dev.N。 */
async function fetchLatestDevRelease(repo) {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=50`, {
      headers: ghHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const list = await res.json();
    const devs = (Array.isArray(list) ? list : []).filter((x) => x
      && x.prerelease === true
      && /^v?\d+\.\d+\.\d+-dev\.\d+$/.test(String(x.tag_name ?? '')));
    if (!devs.length) return null;
    devs.sort((a, b) => semverCompare(b.tag_name, a.tag_name));
    const best = devs[0];
    return {
      tag: String(best.tag_name),
      url: String(best.zipball_url ?? ''),
      source: 'dev-prerelease',
      publishedAt: String(best.published_at ?? ''),
    };
  } catch {
    return null;
  }
}

export async function inspectVersionComponent(component, { fetch: doFetch = true, channel = 'stable', firstInstall = false } = {}) {
  const id = String(component?.id ?? '').trim();
  const name = String(component?.name ?? id);
  const dir = normalizeDir(component?.dir);
  const repo = String(component?.versionRepo ?? '').trim();
  const base = { id, name, dir: dir || String(component?.dir ?? ''), kind: 'version', channel: 'version' };
  if (!repo) return { ...base, available: false, reason: '没有配置版本仓库' };
  // 版本来源：package.json → version.json → .installed-meta.json（语音包没有 package.json）
  let installedVersion = '';
  try { installedVersion = String(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version ?? ''); } catch {}
  if (!installedVersion) {
    try { installedVersion = String(JSON.parse(fs.readFileSync(path.join(dir, 'version.json'), 'utf8')).version ?? ''); } catch {}
  }
  let meta = readInstalledMeta(dir);
  if (!installedVersion && meta?.version) installedVersion = String(meta.version);

  // 自愈：目录里有新版包带来的 release/install-manifest.json（说明是解压安装的），
  // 但还没有 .installed-manifest.json / .installed-meta.json → 就地补登记。
  // 否则手动覆盖安装的用户会永远卡在 evidence-insufficient（2026-10-29 反馈）。
  try {
    // 只在"解压安装的目录"里补登记；git 工作副本（开发仓库）不要写这两个文件，
    // 否则会把运行时证据混进仓库（2026-10-30 误提交过）。
    if (fs.existsSync(path.join(dir, '.git'))) throw new Error('skip-git-worktree');
    const pkgManifest = path.join(dir, 'release', 'install-manifest.json');
    const installedManifest = path.join(dir, '.installed-manifest.json');
    if (installedVersion && fs.existsSync(pkgManifest)) {
      let installedManifestVersion = '';
      try { installedManifestVersion = String(JSON.parse(fs.readFileSync(installedManifest, 'utf8')).version ?? ''); } catch {}
      // 手动覆盖安装后，旧清单/旧提交号还留在目录里 → 会拿"旧提交 vs 远端"比出假更新
      // （用户升到 0.7.5 仍被提示 v0.7.3→db18896）。版本对不上就地刷新证据。
      let stale = !installedManifestVersion || installedManifestVersion !== installedVersion;
      if (!stale) {
        // 旧清单可能是"开发工作目录"生成的（含 _backups/、audio/ 等归档里没有的路径）：
        // 只要出现"新包没有的路径"，就说明旧清单不可信，必须用包内清单覆盖。
        try {
          const pkgFiles = Object.keys(JSON.parse(fs.readFileSync(pkgManifest, 'utf8')).files ?? {});
          const instFiles = Object.keys(JSON.parse(fs.readFileSync(installedManifest, 'utf8')).files ?? {});
          const pkgSet = new Set(pkgFiles);
          if (instFiles.some((rel) => !pkgSet.has(rel))) stale = true;
        } catch {}
      }
      if (stale) {
        fs.copyFileSync(pkgManifest, installedManifest);
        // 版本变了，旧 sha 已不代表当前文件；写回只有版本号的记录（走版本号比对）
        writeInstalledMeta(dir, { version: installedVersion });
        meta = readInstalledMeta(dir);
      } else if (!fs.existsSync(path.join(dir, '.installed-meta.json'))) {
        writeInstalledMeta(dir, { version: installedVersion });
        meta = readInstalledMeta(dir);
      }
    }
  } catch { /* 补登记失败不致命，下面会按缺证据处理 */ }
  if (!dir) return { ...base, available: false, installedVersion: '', reason: '安装目录不存在（还没装）' };
  if (!installedVersion && !meta) return { ...base, available: false, installedVersion: '', reason: '目录里没有 version.json / .installed-meta.json（还没装好，或装到了别的目录）' };
  if (!doFetch) return { ...base, available: true, installedVersion, latestVersion: null, updateAvailable: false, reason: '本次未拉取' };

  // ── 测试通道（dev）：只认 GitHub pre-release 的 -dev.N，完全不碰稳定版的 latest ──
  if (channel === 'dev') {
    const dev = await fetchLatestDevRelease(repo).catch(() => null);
    const hasEvidence = fs.existsSync(path.join(dir, '.installed-manifest.json')) || Boolean(meta)
      || (firstInstall === true && isTrustedZipInstall(dir));
    if (!dev) {
      return {
        ...base, available: true, installedVersion, latestVersion: null,
        updateAvailable: false, status: 'latest', code: 'DEV_NO_BUILD', channel: 'dev',
        reason: '测试通道暂时没有 dev 构建',
        hint: '让开发机先发一个 vX.Y.Z-dev.N 的 Pre-release，再点「检查更新」',
      };
    }
    const latestVersion = String(dev.tag).replace(/^v/i, '');
    const installedIsDev = /-/.test(installedVersion);
    const cmp = semverCompare(latestVersion, installedVersion);
    let updateAvailable = cmp > 0;
    let code = cmp > 0 ? 'new-dev-build' : 'up-to-date';
    let reason = cmp > 0
      ? `测试通道有新构建：v${installedVersion} → v${latestVersion}`
      : `已是最新测试构建（v${installedVersion}）`;
    // 从正式版显式切到测试通道：dev 版本号低于同号正式版，按“通道切换”允许安装一次。
    if (!installedIsDev && installedVersion) {
      updateAvailable = true;
      code = 'channel-switch';
      reason = `切换到测试通道：v${installedVersion} → v${latestVersion}（dev 低于同号正式版，只按通道切换安装一次）`;
    }
    if (updateAvailable && !hasEvidence) {
      return {
        ...base, available: true, installedVersion, latestVersion,
        updateAvailable: true, status: 'blocked', code: 'evidence-insufficient', channel: 'dev',
        blocked: '目录里没有安装清单/安装记录，无法确认归属',
        reason: `有测试构建 v${latestVersion}，但这个目录没有安装证据`,
        hint: '官方 zip 解压安装可点「首次更新（先备份）」；其他情况请手动下载该版本 zip 覆盖一次，装好后会自动补登记',
      };
    }
    return {
      ...base, available: true, installedVersion, latestVersion,
      updateAvailable, status: updateAvailable ? 'update' : 'latest', code, channel: 'dev',
      downloadUrl: dev.url, reason,
    };
  }

  // 提交级比对：语音包这类"没有发版号"的组件，按远端 main 的 commit 判断有没有新提交。
  // 同时尽量取远端版本号：只显示 7 位 sha 时用户会以为是乱码（2026-10-29 反馈）。
  const remoteSha = await fetchCommitSha(repo).catch(() => '');
  // 只在"没有本地提交记录"时取版本号（要拿它做版本比较）；
  // 有提交记录时用提交号就够了，省一次 API 配额（60/h 很容易被打满）。
  const localShaHint = String(meta?.sha ?? '');
  let remoteVer = (!localShaHint || !remoteSha) ? await fetchRemoteVersion(repo).catch(() => '') : '';
  if (!remoteVer) {
    // 版本号取不到（限流/网络）时，用 releases/latest 的 302 tag 兜底：不消耗 API 配额，
    // 也避免界面只能显示提交号（用户会以为编号就是版本）。
    const latestTag = await fetchLatestByRedirect(repo).catch(() => null);
    if (latestTag?.tag) remoteVer = String(latestTag.tag).replace(/^v/i, '');
  }
  if (remoteSha) {
    const localSha = String(meta?.sha ?? '');
    if (localSha && localSha !== remoteSha) {
      // 按提交判定"有更新"时，再尽量取一个**版本号**：前端显示版本、下载 tag 归档都要用它。
      // 用 releases/latest 的 302（不消耗 API 配额）；取不到才退回提交号。
      let ver = remoteVer;
      if (!ver) {
        // github.com 在部分网络下不可达（2026-10-30 实测：github.com 超时、api/codeload 正常）。
        // 先查 API tags（不依赖 github.com），最后才退到 302。
        const tagOnly = await fetchLatestTagOnly(repo).catch(() => null);
        if (tagOnly?.tag) ver = String(tagOnly.tag).replace(/^v/i, '');
      }
      if (!ver) {
        const tag = await fetchLatestByRedirect(repo).catch(() => null);
        if (tag?.tag) ver = String(tag.tag).replace(/^v/i, '');
      }
      return {
        ...base, available: true, installedVersion: installedVersion || localSha.slice(0, 7),
        latestVersion: ver || remoteSha.slice(0, 7), updateAvailable: true,
        remoteSha, localSha, channel: 'version',
        status: 'update', code: 'new-commit',
        reason: `远端有新提交（${localSha.slice(0, 7)} → ${remoteSha.slice(0, 7)}）`,
      };
    }
    if (!localSha) {
      // 老安装没有提交记录（旧 zip 装的）：不能只按提交比，否则永远判"最新"，
      // 用户看到 "0.6.22 → 1ad2042（最新）" 且没有更新按钮（2026-10-29 实测）。
      // 退回按版本号比：远端 package.json 版本更高就是有更新。
      if (installedVersion && remoteVer && semverCompare(remoteVer, installedVersion) > 0) {
        // 有更新，但先看有没有"安装证据"：既无安装清单也无安装记录时不能自动覆盖，
        // 必须在这里标成 blocked —— 否则用户点了更新会失败、下次检查又弹同一条（2026-10-29 反馈）。
        const hasManifest = fs.existsSync(path.join(dir, '.installed-manifest.json'));
        const evidence = hasManifest || Boolean(meta) || (firstInstall === true && isTrustedZipInstall(dir));
        if (!evidence) {
          return {
            ...base, available: true, installedVersion, latestVersion: remoteVer,
            updateAvailable: true, remoteSha, channel: 'version',
            status: 'blocked', code: 'evidence-insufficient',
            blocked: '目录里没有安装清单/安装记录，无法确认归属',
            reason: `有新版 v${remoteVer}，但这个目录没有安装证据（无 .installed-manifest.json / .installed-meta.json）`,
            hint: '官方 zip 解压安装可点「首次更新（先备份）」；其他情况请手动下载新版 zip 覆盖一次，装好后新版会自动补登记，之后可自动更新',
          };
        }
        return {
          ...base, available: true, installedVersion, latestVersion: remoteVer,
          updateAvailable: true, remoteSha, channel: 'version',
          status: 'update', code: 'new-version',
          reason: `版本号比对：本地 v${installedVersion} → 远端 v${remoteVer}`,
        };
      }
      // 没有提交记录、远端版本号也取不到 → 无法判断（不能说"最新"）
      if (!remoteVer) {
        return {
          ...base, available: true, installedVersion, latestVersion: null,
          updateAvailable: false, remoteSha, channel: 'version',
          status: 'unknown', code: 'UPDATE_NO_REMOTE_VERSION',
          hint: '稍后重试；或手动下载新版 zip 覆盖安装',
          reason: '取不到远端版本号（网络或 API 限流），无法判断是否有更新',
        };
      }
      return {
        ...base, available: true, installedVersion, latestVersion: remoteVer,
        updateAvailable: false, remoteSha, channel: 'version',
        status: 'latest', code: 'UPDATE_NO_COMMIT_RECORD',
        hint: installedVersion
          ? '这个安装没有提交记录，已按版本号判断为最新'
          : '这个安装既没有版本号也没有提交记录；请用 zip 覆盖安装一次',
        reason: '这个安装没有提交记录，已按版本号比对（相同）',
      };
    }
    return {
      ...base, available: true, installedVersion, latestVersion: installedVersion || remoteSha.slice(0, 7),
      updateAvailable: false, remoteSha, localSha, channel: 'version',
      status: 'latest', code: 'up-to-date',
      reason: '已是最新（提交一致）',
    };
  }
  let latest = await fetchLatestByRedirect(repo);
  if (!latest) latest = await fetchLatestRelease(repo);
  if (!latest && !remoteSha) {
    return {
      ...base, available: true, installedVersion, latestVersion: null, updateAvailable: false,
      channel: 'version', status: 'unknown', code: 'UPDATE_NO_REMOTE',
      hint: '取不到远端版本信息（网络或 API 限流）；过几分钟再点「检查更新」，或手动覆盖 zip',
      reason: '取不到远端版本信息',
    };
  }
  // redirect 只看得到"最新 Release"；如果它不比本地新，再花一次 API 查 tag 复核
  // （常见情形：只打了 tag 忘了发 Release）。
  if (latest && semverCompare(latest.tag, installedVersion) <= 0) {
    const tagOnly = await fetchLatestTagOnly(repo);
    if (tagOnly && semverCompare(tagOnly.tag, latest.tag) > 0) latest = tagOnly;
  }
  if (!latest) {
    return { ...base, available: false, installedVersion, reason: '拉不到 GitHub 版本（网络或限流）' };
  }
  const latestVersion = latest.tag.replace(/^v/i, '');
  const cmp = semverCompare(latestVersion, installedVersion);
  const hasEvidence = fs.existsSync(path.join(dir, '.installed-manifest.json')) || Boolean(meta)
    || (firstInstall === true && isTrustedZipInstall(dir));
  if (cmp > 0 && !hasEvidence) {
    return {
      ...base, available: true, installedVersion, latestVersion,
      updateAvailable: true, status: 'blocked', code: 'evidence-insufficient',
      blocked: '目录里没有安装清单/安装记录，无法确认归属',
      reason: `有新版 v${latestVersion}，但这个目录没有安装证据`,
      hint: '官方 zip 解压安装可点「首次更新（先备份）」；其他情况请手动下载新版 zip 覆盖一次，装好后新版会自动补登记',
    };
  }
  return {
    ...base,
    available: true,
    installedVersion,
    latestVersion,
    updateAvailable: cmp > 0,
    status: cmp > 0 ? 'update' : 'latest',
    code: cmp > 0 ? 'new-version' : 'up-to-date',
    ahead: cmp < 0,
    versionSource: latest.source ?? '',
    versionStale: latest.stale === true,
    downloadUrl: latest.url,
    reason: cmp < 0
      ? `本地 v${installedVersion} 领先发布版 v${latestVersion}（开发副本或已抢先升级）`
      : '按版本号比对（不依赖 git）',
  };
}

export async function inspectComponent(component, opts = {}) {
  const kind = String(component?.kind ?? '').trim();
  if (kind === 'release') return inspectReleaseComponent(component, opts);
  if (kind === 'git') {
    const git = await inspectGitComponent(component, opts);
    if (git.available || !component?.versionRepo) return git;
    // 不是 git 仓库 / 没有 remote（zip 安装、开发副本）：退化成版本号比对
    const byVersion = await inspectVersionComponent(component, opts).catch(() => null);
    return byVersion ? { ...git, ...byVersion, gitReason: git.reason } : git;
  }
  // 自动：先看是不是 git 工作区，不再看有没有 versionUrl
  const dir = normalizeDir(component?.dir);
  if (dir) {
    const inside = await runGit(['-C', dir, 'rev-parse', '--is-inside-work-tree']);
    const top = inside.ok ? await runGit(['-C', dir, 'rev-parse', '--show-toplevel']) : { ok: false };
    const isOwnRepo = inside.ok && inside.stdout.trim() === 'true'
      && top.ok && path.resolve(top.stdout.trim()).toLowerCase() === path.resolve(dir).toLowerCase();
    if (isOwnRepo) return inspectGitComponent(component, opts);
  }
  if (component?.versionUrl) return inspectReleaseComponent(component, opts);
  // 没有版本清单、但有版本仓库 → 按「提交级比对」查（语音包就是这种：
  // 没有 package.json、也不发 release，只有 main 上的提交）。
  if (component?.versionRepo) {
    const dir2 = normalizeDir(component?.dir);
    const hasAny = dir2 && (fs.existsSync(path.join(dir2, 'package.json'))
      || fs.existsSync(path.join(dir2, 'version.json'))
      || fs.existsSync(path.join(dir2, '.installed-meta.json')));
    if (hasAny) return inspectVersionComponent(component, opts);
  }
  const git = await inspectGitComponent(component, opts);
  if (git.available || !component?.versionRepo) return git;
  const byVersion = await inspectVersionComponent(component, opts).catch(() => null);
  return byVersion ? { ...git, ...byVersion, gitReason: git.reason } : git;
}

/** 检查单个 git 组件（只读；`fetch` 时才会碰网络）。 */
export async function inspectGitComponent(component, { fetch = true } = {}) {
  const id = String(component?.id ?? '').trim();
  const name = String(component?.name ?? id);
  const dir = normalizeDir(component?.dir);
  const base = { id, name, dir: dir || String(component?.dir ?? ''), kind: component?.kind ?? 'component' };
  if (!id) return { ...base, available: false, reason: '组件缺少 id' };
  if (!dir) return { ...base, available: false, reason: '目录不存在（还没安装？）' };

  // 先确认 git 本身在不在：不在时不能报"不是 git 仓库"（会把人引去 git clone，而他根本没有 git）
  const gitVersion = await gitAvailable();
  if (!gitVersion) {
    return {
      ...base, available: false, status: 'unknown', code: 'no-git',
      reason: '本机没有找到 git 命令（PATH 与常见安装位置都没有）',
      hint: '可以手动下载新版覆盖安装；或安装 git 后启用自动更新检查',
    };
  }
  const inside = await runGit(['-C', dir, 'rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    return {
      ...base, available: false, status: 'unknown', code: 'not-a-git-repo',
      reason: '这个目录不是 git 仓库（zip 安装的目录都是这样）',
      hint: '会改用版本号比对；若仍查不到，可手动下载新版覆盖',
    };
  }
  // ⚠️ 子目录在某个仓库里时 rev-parse 也会返回 true（语音包在 <repo>/state/voice-packs 下就会命中），
  // 必须要求“仓库根就是这个目录”，否则会把语音包当成本体仓库、显示同样的提交列表（2026-10-28 反馈）。
  const top = await runGit(['-C', dir, 'rev-parse', '--show-toplevel']);
  const topDir = top.ok ? path.resolve(top.stdout.trim()) : '';
  if (!topDir || topDir.toLowerCase() !== path.resolve(dir).toLowerCase()) {
    return { ...base, available: false, reason: '目录在别的 git 仓库里（不是它自己的仓库），改用版本/提交比对' };
  }
  const remoteUrl = await runGit(['-C', dir, 'remote', 'get-url', 'origin']);
  if (!remoteUrl.ok) return { ...base, available: false, status: 'unknown', code: 'no-origin', reason: '没有配置 origin remote', hint: '改用版本号比对；或手动下载新版覆盖' };

  let branch = String(component?.branch ?? '').trim();
  if (!branch) {
    const current = await runGit(['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD']);
    branch = current.ok ? current.stdout.trim() : DEFAULT_BRANCH;
  }
  if (!branch || branch === 'HEAD') {
    return { ...base, available: false, status: 'unknown', code: 'detached-head', reason: '处于 detached HEAD，无法判断该更新到哪个分支', hint: '切回 main 分支后重试，或手动下载新版覆盖' };
  }

  let fetchError = '';
  if (fetch) {
    const fetched = await runGit(['-C', dir, 'fetch', '--quiet', '--no-tags', 'origin', branch]);
    if (!fetched.ok) fetchError = (fetched.stderr || fetched.message || 'git fetch 失败').trim().slice(0, 300);
  }

  const local = await runGit(['-C', dir, 'rev-parse', 'HEAD']);
  const remote = await runGit(['-C', dir, 'rev-parse', `origin/${branch}`]);
  if (!remote.ok) {
    return {
      ...base, available: false, branch, status: 'unknown', code: 'remote-unreachable',
      reason: fetchError || `取不到 origin/${branch}（远端分支名不对？）`,
      hint: '检查网络后重试；或手动下载新版覆盖',
    };
  }
  const dirtyOut = await runGit(['-C', dir, 'status', '--porcelain']);
  const dirty = dirtyOut.ok ? dirtyOut.stdout.split('\n').filter((line) => line.trim()).length : null;
  const behindOut = await runGit(['-C', dir, 'rev-list', '--count', `HEAD..origin/${branch}`]);
  const aheadOut = await runGit(['-C', dir, 'rev-list', '--count', `origin/${branch}..HEAD`]);
  if (!behindOut.ok) {
    return {
      ...base, available: false, branch, status: 'unknown', code: 'rev-list-failed',
      reason: `取不到落后提交数：${(behindOut.stderr || behindOut.message || '').trim().slice(0, 160) || '未知原因'}`,
      hint: '稍后重试；若持续失败，可手动下载新版覆盖',
    };
  }
  const behind = Number(behindOut.stdout.trim()) || 0;
  const ahead = aheadOut.ok ? Number(aheadOut.stdout.trim()) || 0 : 0;
  let changelog = [];
  if (behind > 0) {
    const log = await runGit(['-C', dir, 'log', '--oneline', '--no-merges', `HEAD..origin/${branch}`]);
    if (log.ok) changelog = log.stdout.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, MAX_CHANGELOG);
  }
  const remoteVersion = await fetchRemoteVersion(String(component?.versionRepo || '').trim() || ownerRepoOf(remoteUrl.stdout.trim()));
  return {
    ...base, available: true, branch, channel: 'git',
    latestVersion: remoteVersion || '',
    remoteUrl: remoteUrl.stdout.trim(),
    local: local.ok ? local.stdout.trim() : '',
    remote: remote.stdout.trim(),
    behind, ahead, dirty, changelog,
    fetchError: fetchError || undefined,
    updateAvailable: behind > 0,
    blocked: dirty > 0 ? '本地有未提交改动' : (ahead > 0 ? '本地有未推送提交（会分叉，拒绝自动合并）' : ''),
    status: (dirty > 0 || ahead > 0) ? 'blocked' : (behind > 0 ? 'update' : 'latest'),
    code: dirty > 0 ? 'local-changes' : (ahead > 0 ? 'local-ahead' : (behind > 0 ? 'new-commit' : 'up-to-date')),
    hint: dirty > 0 ? '先提交或 stash 本地改动，再检查更新' : (ahead > 0 ? '先把本地提交推送或回退，再做自动更新' : ''),
  };
}

/** 快进合并一个组件。调用方已经确认过 `updateAvailable` 与 `blocked`。 */
export async function fastForwardComponent(component) {
  const dir = normalizeDir(component?.dir);
  if (!dir) return { ok: false, error: '目录不存在' };
  const branch = String(component?.branch ?? '').trim() || DEFAULT_BRANCH;
  const merged = await runGit(['-C', dir, 'merge', '--ff-only', `origin/${branch}`], { timeout: 60_000 });
  if (!merged.ok) {
    return { ok: false, error: (merged.stderr || merged.message || '合并失败').trim().slice(0, 400) };
  }
  const head = await runGit(['-C', dir, 'rev-parse', 'HEAD']);
  return { ok: true, head: head.ok ? head.stdout.trim() : '' };
}

/**
 * @param {object} opts
 * @param {string} opts.stateDir          插件状态目录（~/.dsh/surfcore）
 * @param {() => Array} opts.components   每次调用重新解析组件清单（配置可热更新）
 * @param {(component) => string|null} [opts.blockedReason] 运行中不能更新的组件给原因（例如桌宠在跑）
 * @param {(msg:string, ...args:any)=>void} [opts.pluginLog]
 */

// ───────────────────────────── release 通道 ─────────────────────────────
// 构建产物型组件（桌宠）：源码在 git，但用户装的是 zip。检查 = 读 version.json 比版本号；
// 更新 = 下 zip → 校验 sha256 → 交给组件自己的安装器（保留用户数据由安装器负责）。

/** semver 比较：0.10.0 > 0.9.0；正式版 > 同号预发布；dev.2 > dev.1。返回 1/0/-1。 */
export function compareVersions(a, b) {
  return semverCompare(a, b);
}

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** `file://D:/x` / `D:/x` / `https://…` → 本地路径或 null。 */
function localPathOf(urlOrPath) {
  const raw = String(urlOrPath ?? '').trim();
  if (!raw) return null;
  if (/^file:\/\//i.test(raw)) {
    try {
      let p = decodeURIComponent(new URL(raw).pathname);
      if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);      // Windows: /D:/x → D:/x
      return p;
    } catch { return null; }
  }
  if (/^[a-z]+:\/\//i.test(raw)) return null;
  return raw;
}

async function fetchJson(url, { timeout = 15_000, maxBytes = 512 * 1024 } = {}) {
  const local = localPathOf(url);
  if (local) {
    const data = readJsonSafe(local);
    return data ? { ok: true, json: data } : { ok: false, error: `读不到本地清单：${local}` };
  }
  let mod;
  try { mod = await import(/^https:/i.test(url) ? 'node:https' : 'node:http'); } catch (error) {
    return { ok: false, error: `加载网络模块失败：${String(error?.message ?? error)}` };
  }
  return new Promise((resolve) => {
    const req = mod.get(url, { timeout, headers: { 'user-agent': 'surfcore-update-check' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(fetchJson(new URL(res.headers.location, url).toString(), { timeout, maxBytes }));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); resolve({ ok: false, error: `HTTP ${res.statusCode}` }); return; }
      let size = 0;
      const chunks = [];
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) { res.destroy(); resolve({ ok: false, error: '清单太大' }); return; }
        chunks.push(chunk);
      });
      res.on('end', () => {
        try { resolve({ ok: true, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch { resolve({ ok: false, error: '清单不是合法 JSON' }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: '请求超时' }); });
    req.on('error', (error) => resolve({ ok: false, error: String(error?.message ?? error) }));
  });
}

async function downloadTo(url, dest, { timeout = 180_000, maxBytes = 400 * 1024 * 1024, onProgress = null } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const local = localPathOf(url);
  if (local) {
    try { fs.copyFileSync(local, dest); return { ok: true, bytes: fs.statSync(dest).size }; } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  }
  let mod;
  try { mod = await import(/^https:/i.test(url) ? 'node:https' : 'node:http'); } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const req = mod.get(url, { timeout, headers: { 'user-agent': 'surfcore-update-download' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(downloadTo(new URL(res.headers.location, url).toString(), dest, { timeout, maxBytes, onProgress }));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); resolve({ ok: false, error: `HTTP ${res.statusCode}` }); return; }
      const out = fs.createWriteStream(dest);
      let size = 0;
      const total = Number(res.headers['content-length']) || 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) { req.destroy(); res.destroy(); out.destroy(); resolve({ ok: false, error: '安装包太大' }); return; }
        out.write(chunk);
        if (typeof onProgress === 'function') {
          const elapsed = Math.max(1, Date.now() - startedAt);
          try {
            onProgress({
              active: true, phase: 'download', url, bytes: size, total,
              percent: total ? Math.min(100, Math.round((size / total) * 100)) : null,
              speedBps: Math.round(size / (elapsed / 1000)), startedAt,
            });
          } catch {}
        }
      });
      res.on('end', () => out.end(() => resolve({ ok: true, bytes: size })));
      res.on('error', (error) => { out.destroy(); resolve({ ok: false, error: String(error?.message ?? error) }); });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: '下载超时' }); });
    req.on('error', (error) => resolve({ ok: false, error: String(error?.message ?? error) }));
  });
}

function sha256File(file) {
  try {
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return '';
  }
}

/** 基础 ZIP 完整性预检：HTTP 200 但被截断的包通常没有 EOCD。 */
function hasZipEocd(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      if (size < 22) return false;
      const readSize = Math.min(65_557, size);
      const buf = Buffer.alloc(readSize);
      fs.readSync(fd, buf, 0, readSize, size - readSize);
      return buf.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

/** 清单里的 file/files → 当前平台那一个。 */
function pickReleaseAsset(manifest) {
  const list = Array.isArray(manifest?.files) ? manifest.files : (manifest?.file ? [manifest.file] : []);
  if (!list.length) return null;
  const platformKey = process.platform === 'win32' ? 'win' : process.platform;
  return list.find((item) => item && typeof item === 'object'
    && (!item.platform || String(item.platform).toLowerCase().startsWith(platformKey))) ?? list[0];
}

/** 已装版本：默认读安装目录里的 package.json。 */
function installedVersionOf(component) {
  const dir = normalizeDir(component?.dir);
  if (!dir) return null;
  const file = component?.versionFile ? path.resolve(dir, String(component.versionFile)) : path.join(dir, 'package.json');
  const pkg = readJsonSafe(file);
  return pkg && typeof pkg === 'object' ? { name: pkg.name ?? '', version: String(pkg.version ?? '') } : null;
}

/** 检查一个 release 组件：读已装版本 + 拉 version.json 比版本号。 */
export async function inspectReleaseComponent(component, { fetch = true } = {}) {
  const id = String(component?.id ?? '').trim();
  const name = String(component?.name ?? id);
  const dir = normalizeDir(component?.dir);
  const base = { id, name, dir: dir || String(component?.dir ?? ''), kind: component?.kind ?? 'release', channel: 'release' };
  if (!id) return { ...base, available: false, reason: '组件缺少 id' };

  const installed = installedVersionOf(component);
  const versionUrl = String(component?.versionUrl ?? '').trim();
  if (!versionUrl) {
    return {
      ...base, available: false,
      installedVersion: installed?.version ?? null,
      reason: installed ? '没有配置 versionUrl（无法查新版）' : '未安装，且没有配置 versionUrl',
    };
  }
  if (!fetch) {
    return { ...base, available: false, installedVersion: installed?.version ?? null, reason: '本次未拉取版本清单' };
  }
  let remote = await fetchJson(versionUrl);
  if (!remote.ok) {
    // 第一次失败很常见（GitHub 302 到 objects.githubusercontent 偶发超时）：800ms 后重试一次
    await new Promise((r) => setTimeout(r, 800));
    remote = await fetchJson(versionUrl);
  }
  if (!remote.ok) {
    // 还失败就用 6 小时内成功过的清单兜底，并在结果里标 stale
    const cached = releaseManifestCache.get(versionUrl);
    if (cached && Date.now() - cached.at < 6 * 3600_000) {
      remote = { ok: true, json: cached.json, stale: true };
    }
  }
  if (!remote.ok) {
    return {
      ...base, available: false, status: 'unknown', code: 'manifest-unreachable',
      installedVersion: installed?.version ?? null,
      reason: `取不到版本清单：${remote.error}`,
      hint: '稍后重试；或手动下载安装包',
    };
  }
  const manifest = remote.json ?? {};
  try { releaseManifestCache.set(versionUrl, { json: manifest, at: Date.now() }); } catch {}
  const latestVersion = String(manifest.version ?? '').trim();
  const asset = pickReleaseAsset(manifest);
  if (!latestVersion || !asset?.url) {
    return {
      ...base, available: false, status: 'unknown', code: 'manifest-invalid',
      installedVersion: installed?.version ?? null,
      reason: '版本清单缺少 version 或下载地址',
      hint: '这是发布方清单的问题，先手动下载安装包',
    };
  }
  const notes = String(manifest.notes ?? manifest.changelog ?? '').trim();
  const changelog = notes ? notes.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, MAX_CHANGELOG) : [];
  // 未安装不算"有更新"：那是一个可选安装，不该弹更新窗（2026-10-27 修）
  const comparison = installed?.version ? compareVersions(latestVersion, installed.version) : 0;
  return {
    ...base, available: true,
    installedVersion: installed?.version ?? null,
    latestVersion,
    remote: `v${latestVersion}`,
    updateAvailable: comparison > 0,
    behind: comparison > 0 ? 1 : 0,
    ahead: 0,
    dirty: null,
    blocked: '',
    changelog,
    asset: { url: String(asset.url), sha256: asset.sha256 ? String(asset.sha256) : '', size: Number(asset.size) || 0 },
    reason: installed ? '' : '未安装（可以直接安装这一版）',
    status: comparison > 0 ? 'update' : 'latest',
    code: comparison > 0 ? 'new-version' : 'up-to-date',
  };
}

/** 下一份 release 安装包到本机并校验；返回本地路径。 */
export async function downloadReleaseAsset(component, report, { stateDir, pluginLog = () => {}, onProgress = null } = {}) {
  const asset = report?.asset;
  if (!asset?.url) return { ok: false, error: '清单里没有下载地址' };
  const ext = /\.zip(\?|$)/i.test(asset.url) ? '.zip' : '';
  const dir = path.join(stateDir, 'downloads');
  const dest = path.join(dir, `${String(component.id)}-${String(report.latestVersion ?? 'latest')}${ext}`);
  const downloaded = await downloadTo(asset.url, dest, { maxBytes: Math.max(asset.size || 0, 400 * 1024 * 1024), onProgress });
  if (!downloaded.ok) return { ok: false, error: `下载失败：${downloaded.error}` };
  if (asset.sha256) {
    const actual = sha256File(dest);
    if (actual.toLowerCase() !== asset.sha256.toLowerCase()) {
      try { fs.rmSync(dest, { force: true }); } catch {}
      return { ok: false, error: `校验失败（sha256 不匹配：${actual.slice(0, 12)}…）` };
    }
  } else if (Number(asset.size) > 0 && downloaded.bytes !== Number(asset.size)) {
    try { fs.rmSync(dest, { force: true }); } catch {}
    return { ok: false, error: '校验失败（大小不符）' };
  } else {
    pluginLog(`[updates] ${component.id} 的清单没有 sha256，只校验了大小`);
  }
  return { ok: true, path: dest, bytes: downloaded.bytes };
}

export function createUpdatesService({ stateDir, components, blockedReason = () => '', pluginLog = () => {}, githubToken = () => '', channel = () => 'stable' }) {
  const file = path.join(stateDir, 'updates.json');
  const now = () => Date.now();
  let state = { dismissed: {}, lastCheckAt: 0, results: [], lastError: '', lastApplyFailure: null, applyBackoff: {} };
  // 下载进度（只在内存里，供 UI 轮询；不持久化）
  let downloadProgress = null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && typeof raw === 'object') {
      state = {
        dismissed: raw.dismissed && typeof raw.dismissed === 'object' ? raw.dismissed : {},
        lastCheckAt: Number(raw.lastCheckAt) || 0,
        results: Array.isArray(raw.results) ? raw.results : [],
        lastError: String(raw.lastError ?? ''),
        lastApplyFailure: raw.lastApplyFailure && typeof raw.lastApplyFailure === 'object' ? raw.lastApplyFailure : null,
        applyBackoff: raw.applyBackoff && typeof raw.applyBackoff === 'object' ? raw.applyBackoff : {},
      };
    }
  } catch { /* 第一次跑 / 文件坏了：用默认值，不炸 */ }

  // 手动覆盖安装后，磁盘上的版本已经变了，但 updates.json 里还是上次检查的旧结果
  // （用户升到 0.7.5 仍弹 "v0.7.3 → db18896"）。启动时把"版本对不上"的结果丢掉，
  // 下一次检查会重新按当前版本算。
  try {
    const before = (state.results ?? []).length;
    state.results = (state.results ?? []).filter((row) => {
      const dir = normalizeDir(row?.dir);
      if (!dir) return true;
      try {
        const v = String(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version ?? '');
        if (v && row.installedVersion && String(row.installedVersion) !== v) return false;
      } catch { /* 读不到就保留，交给下一次检查 */ }
      return true;
    });
    if ((state.results ?? []).length !== before) persist();
  } catch { /* 校准失败不阻塞启动 */ }

  let checking = false;
  let applying = false;
  // 2026-11-06 事故：上一次 apply 卡在下载（网络死掉）时 applying 永远不会复位，
  // 用户再点更新会拿到 results:[] 的 busy 响应，前端只读 results[0] → 显示"原因不明"。
  let applyingSince = 0;
  const APPLY_STUCK_MS = 10 * 60 * 1000;
  let timer = null;

  function persist() {
    try {
      fs.mkdirSync(stateDir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch (error) {
      pluginLog('[updates] 写状态失败：', String(error?.message ?? error));
    }
  }

  function list() {
    try {
      return (components() ?? []).filter((item) => item && item.id && item.dir);
    } catch (error) {
      pluginLog('[updates] 解析组件清单失败：', String(error?.message ?? error));
      return [];
    }
  }

  /** 这批结果里"值得提示"的项：有更新，且这次的远端 commit 没被 dismiss 过。 */
  /** 这次更新目标的标识（提交 sha 或用版本号），用于 dismiss / 退避比对。 */
  function targetKeyOf(item) {
    return String(item?.remote ?? `v${item?.latestVersion ?? ''}`);
  }

  function pendingOf(results) {
    const now = Date.now();
    // 有排队中的更新（等 DSH 退出后应用）时，重启前不要把它再当成“有可用更新”。
    // 这也兼容旧版误写成 vnull 的 dismissed 记录。
    const pendingFile = path.join(stateDir, 'updates-pending.json');
    let queuedComponent = '';
    try {
      if (fs.existsSync(pendingFile) && !fs.existsSync(`${pendingFile}.failed`)) {
        queuedComponent = String(JSON.parse(fs.readFileSync(pendingFile, 'utf8'))?.component ?? '');
      }
    } catch {}
    return (results ?? []).filter((item) => {
      if (!(item?.available && item.updateAvailable)) return false;
      if (queuedComponent && String(item.id) === queuedComponent) return false;
      if (item.blocked) return false; // 本地有改动/分叉/缺证据，更新不了，别反复弹
      if (!(item.installedVersion || item.local)) return false;
      const target = targetKeyOf(item);
      if (state.dismissed[item.id] === target) return false;
      // 下载/网络类失败后 30 分钟内不再自动弹（用户关一次不该下次检查又弹）；
      // 手动检查仍能在卡片里看到结果与「重试」。
      const backoff = state.applyBackoff?.[item.id];
      if (backoff && backoff.target === target && Number(backoff.until) > now) return false;
      return true;
    });
  }

  function hashFile(file) {
    try {
      return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    } catch { return ''; }
  }

  /** 读包里的安装清单（release/install-manifest.json） */
  function readPackageManifest(srcDir) {
    const file = path.join(srcDir, 'release', 'install-manifest.json');
    if (!fs.existsSync(file)) return { ok: false, code: 'manifest-missing', file };
    try {
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!json || typeof json.files !== 'object' || !Object.keys(json.files).length) {
        return { ok: false, code: 'manifest-invalid', file };
      }
      return { ok: true, file, manifest: json };
    } catch (error) {
      return { ok: false, code: 'manifest-invalid', file, error };
    }
  }

  /** 校验解压出来的包和清单一致（防止"清单是好的、包被换过"） */
  function verifyStaging(srcDir, manifest) {
    const bad = [];
    const missing = [];
    let checked = 0;
    for (const [rel, want] of Object.entries(manifest.files)) {
      const file = path.join(srcDir, rel);
      if (!fs.existsSync(file)) { missing.push(rel); continue; }
      checked += 1;
      if (hashFile(file) !== want) {
        bad.push(rel);
        if (bad.length >= 5) break;
      }
    }
    return { bad, missing, checked };
  }

  /**
   * 覆盖前算清单：
   * - overwrite：将被覆盖的文件（要备份）
   * - modified：本地改过的文件（阻止自动更新）
   * 只覆盖、不删除：目标里多出来的文件（用户自建）一律保留。
   */
  function planOverwrite(targetDir, manifest, priorFiles) {
    const overwrite = [];
    const modified = [];
    for (const rel of Object.keys(manifest.files)) {
      const file = path.join(targetDir, rel);
      if (!fs.existsSync(file)) continue; // 新文件，无需备份
      overwrite.push(rel);
      // 只有"上一次安装清单里记过、但现在对不上"才算用户改过；
      // 新包里的哈希本来就该不同（版本升级），不能拿来当修改依据。
      const prior = priorFiles?.[rel];
      if (prior && hashFile(file) !== prior) modified.push(rel);
    }
    return { overwrite, modified };
  }

  /** 真备份（只备份会被覆盖的文件），并回读校验 */
  function backupTarget(targetDir, relList, txn, meta) {
    const dir = path.join(stateDir, 'backups', txn);
    const filesDir = path.join(dir, 'files');
    try {
      fs.mkdirSync(filesDir, { recursive: true });
      const files = {};
      let bytes = 0;
      for (const rel of relList) {
        const src = path.join(targetDir, rel);
        const dst = path.join(filesDir, rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
        const hash = hashFile(dst);
        if (!hash) return { ok: false, code: 'backup.write-failed', reason: `备份写入失败：${rel}` };
        files[rel] = hash;
        bytes += fs.statSync(dst).size;
      }
      fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify({ ...meta, txn, files, bytes, at: new Date().toISOString() }, null, 2)}
`, 'utf8');
      return { ok: true, dir, files, bytes };
    } catch (error) {
      return { ok: false, code: 'backup.failed', reason: `备份失败：${String(error?.message ?? error).slice(0, 160)}` };
    }
  }

  /** 上次更新结果（重启后仍要能说清：成功/失败/待重启/未完成）。 */
  function readLastApply() {
    const pendingFile = path.join(stateDir, 'updates-pending.json');
    try {
      if (fs.existsSync(`${pendingFile}.failed`)) {
        const j = JSON.parse(fs.readFileSync(`${pendingFile}.failed`, 'utf8'));
        const code = String(j.code || 'apply.failed');
        return {
          status: 'failed', code, component: j.component ?? '',
          reason: String(j.error ?? '应用更新失败').slice(0, 300),
          hint: code === 'stage.expired'
            ? '上次暂存已过期（等 DSH 退出的时间太久）：点「立即更新」重新下载即可'
            : code === 'verify.version-mismatch'
              ? '发布包与清单不一致：手动下载该版本覆盖，重试无效'
              : code === 'apply.unknown-kind'
                ? '更新助手不认识这种任务类型（插件缺陷）：请反馈，并手动下载 zip 覆盖'
                : '备份与 staging 仍保留；可重试或手动覆盖 zip',
          at: j.at ?? null,
        };
      }
      if (fs.existsSync(pendingFile)) {
        return {
          status: 'pending_restart', code: 'apply.queued',
          reason: '有更新已排队，等待 DSH 退出后应用',
          hint: '完全退出并重新打开 DSH；若反复不生效，可手动覆盖 zip',
          at: null,
        };
      }
      const doneDir = path.join(stateDir, 'updates-applied');
      if (fs.existsSync(doneDir)) {
        const files = fs.readdirSync(doneDir).filter((f) => f.endsWith('.json')).sort();
        if (files.length) {
          const j = JSON.parse(fs.readFileSync(path.join(doneDir, files[files.length - 1]), 'utf8'));
          if (j.verified === true) {
            return {
              status: 'success', code: 'apply.verified', component: j.component ?? '',
              to: j.to ?? '', version: j.version ?? '', at: j.at ?? null, backup: j.backup ?? '',
              reason: `已更新并验证：v${j.version ?? j.to ?? '?'}`,
            };
          }
          return {
            status: 'applied_unverified', code: 'apply.applied',
            component: j.component ?? '', to: j.to ?? '', at: j.at ?? null,
            reason: `已应用${j.to ? ` v${j.to}` : ''}，尚未验证版本`,
            hint: '重新打开后在设置页确认版本号；不一致请手动覆盖',
          };
        }
      }
    } catch (error) {
      return { status: 'unknown', code: 'apply.result-unreadable', reason: String(error?.message ?? error).slice(0, 200), hint: '查看 state/updates-applied 目录' };
    }
    return null;
  }

  function status() {
    const results = state.results ?? [];
    const pending = pendingOf(results);
    const unknown = results.filter((row) => row && !row.available && row.status === 'unknown' && !row.blocked);
    return {
      ok: true,
      checking,
      applying,
      lastCheckAt: state.lastCheckAt || null,
      lastError: state.lastError || '',
      results,
      pending,
      pendingCount: pending.length,
      unknown,
      unknownCount: unknown.length,
      lastApply: state.lastApplyFailure ?? readLastApply(),
      channel: channel() === 'dev' ? 'dev' : 'stable',
      download: downloadProgress,
      githubTokenConfigured: githubTokenConfigured(),
      showPrompt: pending.length > 0,
    };
  }

  /** 清理 N 天前的 staging 残留（成功更新后 helper 只删解压目录，外层 pkg.zip 会留下）。 */
  function cleanupStaleStaging(maxAgeMs = 3 * 24 * 3600_000) {
    const root = path.join(stateDir, 'staging');
    let activeStaging = '';
    try {
      const pending = JSON.parse(fs.readFileSync(path.join(stateDir, 'updates-pending.json'), 'utf8'));
      activeStaging = path.resolve(String(pending.staging ?? ''));
    } catch {}
    let removed = 0;
    try {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const full = path.join(root, entry.name);
        // 正在排队等 DSH 退出的 staging 不能被清理，否则 helper 找不到包
        if (activeStaging && activeStaging.startsWith(path.resolve(full) + path.sep)) continue;
        try {
          const st = fs.statSync(full);
          if (Date.now() - st.mtimeMs > maxAgeMs) { fs.rmSync(full, { recursive: true, force: true }); removed += 1; }
        } catch {}
      }
    } catch {}
    if (removed) pluginLog(`[updates] 清理 ${removed} 个过期 staging 目录`);
    return removed;
  }

  async function check({ fetch = true, firstInstall = false } = {}) {
    if (checking) return status();
    cleanupStaleStaging();
    try { setGitHubToken(githubToken()); } catch {}
    checking = true;
    try {
      const items = list();
      const results = [];
      for (const item of items) {
        try {
          results.push(await inspectComponent(item, { fetch, channel: channel(), firstInstall }));
        } catch (error) {
          // 单个组件炸了不能拖垮整次检查，但必须留下可读结论（不能变成"最新"）
          results.push({
            id: item.id, name: item.name ?? item.id, dir: item.dir, available: false,
            status: 'failed', code: 'check-exception',
            reason: `检查时出现异常：${String(error?.message ?? error).slice(0, 200)}`,
            hint: '稍后重试；若持续失败，点「复制诊断」把信息发给开发者',
            diagnostics: { stack: String(error?.stack ?? '').split(String.fromCharCode(10)).slice(0, 6).join(String.fromCharCode(10)) },
          });
        }
      }
      state = { ...state, results, lastCheckAt: now(), lastError: '' };
      persist();
      const pendingCount = pendingOf(results).length;
      const unknownCount = results.filter((row) => row && !row.available && row.status === 'unknown' && !row.blocked).length;
      pluginLog(`[updates] 检查完成：${pendingCount} 个组件有更新${unknownCount ? `；${unknownCount} 个无法判定` : ''}`);
      return status();
    } catch (error) {
      // 整次检查失败：写清原因，界面必须显示"检查失败"，不能显示"最新"
      state = {
        ...state,
        lastError: String(error?.message ?? error),
        lastCheckAt: now(),
        results: (state.results ?? []).map((row) => ({
          ...row, status: 'failed', code: 'check-failed',
          reason: `检查更新失败：${String(error?.message ?? error).slice(0, 200)}`,
          hint: '检查网络后重试；持续失败请复制诊断信息',
        })),
      };
      persist();
      return status();
    } finally {
      checking = false;
    }
  }

  /** 回滚：从最近一次备份恢复被覆盖的文件，并校验版本回到备份时的版本。 */
  async function rollback(id) {
    const want = String(id ?? '').trim();
    if (!want) return { ok: false, code: 'rollback.no-id', reason: '没有指定组件', hint: '在更新卡片上点回滚' };
    const item = list().find((x) => String(x.id) === want);
    const target = normalizeDir(item?.dir);
    if (!target) return { ok: false, code: 'rollback.no-target', reason: '找不到安装目录', hint: '在设置页确认安装目录' };
    const base = path.join(stateDir, 'backups');
    let entries = [];
    try {
      entries = fs.readdirSync(base, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => {
          const dir = path.join(base, d.name);
          try { return { dir, manifest: JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) }; } catch { return null; }
        })
        .filter(Boolean)
        .filter((e) => String(e.manifest.component) === want)
        .sort((a, b) => String(b.manifest.at || '').localeCompare(String(a.manifest.at || '')));
    } catch {}
    if (!entries.length) {
      return { ok: false, code: 'rollback.no-backup', reason: '没有找到这个组件的更新备份', hint: '只能手动下载旧版覆盖；或联系开发者' };
    }
    const backup = entries[0];
    const files = backup.manifest.files ?? {};
    let restored = 0;
    const failed = [];
    for (const [rel, hash] of Object.entries(files)) {
      const srcFile = path.join(backup.dir, 'files', rel);
      const dstFile = path.join(target, rel);
      try {
        fs.mkdirSync(path.dirname(dstFile), { recursive: true });
        fs.copyFileSync(srcFile, dstFile);
        if (hashFile(dstFile) !== hash) failed.push(rel);
        else restored += 1;
      } catch (error) { failed.push(`${rel}（${String(error?.message ?? error).slice(0, 60)}）`); }
    }
    let version = '';
    try { version = String(JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8')).version ?? ''); } catch {}
    const from = String(backup.manifest.from ?? '').trim();
    const ok = failed.length === 0 && (!from || version.replace(/^v/i, '') === from.replace(/^v/i, ''));
    const record = {
      ok, status: ok ? 'rolled_back' : 'rollback.failed', component: want, txn: backup.manifest.txn ?? '',
      restored, failed: failed.slice(0, 5), version, want: from, at: new Date().toISOString(),
    };
    try {
      const dir = path.join(stateDir, 'updates-applied');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${Date.now()}-rollback-${want}.json`), `${JSON.stringify(record, null, 2)}
`, 'utf8');
    } catch {}
    if (ok) {
      return { ok: true, status: 'rolled_back', restored, version, message: `已回滚到 v${version}（${restored} 个文件）` };
    }
    return {
      ok: false, status: 'rollback.failed', code: 'rollback.failed', restored, failed,
      reason: failed.length ? `有 ${failed.length} 个文件恢复失败：${failed.slice(0, 3).join('、')}` : `文件已恢复但版本不符（当前 v${version || '?'}，期望 v${from || '?'}）`,
      hint: `备份仍在 ${backup.dir}；可手动复制回去，或联系开发者`,
    };
  }

  /** 应用更新：只更新点名的那几个组件。返回每一项的结果。 */
  /**
   * 非 git 安装（zip）的更新：下载 → 解压到 staging → 交给独立进程在宿主退出后覆盖。
   *
   * ⚠️ 绝不能在宿主进程里 cpSync 覆盖目标目录：那是宿主正在加载的模块目录，
   * 覆盖正在使用的文件会让进程直接终止（0xFFFF7003），更新也不会落地
   * （2026-10-28 用户崩溃报告）。
   */
  async function updateFromZip(item, report, opts = {}) {
    const dir = normalizeDir(item.dir);
    const repo = String(item.versionRepo ?? '').trim();
    if (!dir || !repo) {
      return fail({
        ok: false, status: 'failed', stage: 'stage', code: 'apply.no-target',
        reason: '缺少安装目录或版本仓库，无法更新',
        hint: '在设置页确认安装目录后重试',
      });
    }
    // 有版本号就用 **tag 归档**：分支（main.zip）会随提交漂移，和"某版本的清单"天然对不上。
    // 没有版本号（语音包等按提交追踪的组件）才退回 main.zip。
    const wantVer = String(report?.latestVersion ?? '').trim();
    const isSemver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(wantVer);
    // 下载走 codeload 直连（少一次 302、少一个域名依赖），再依次试镜像；
    // github.com 在部分网络下不可达，但 codeload 正常（2026-10-30 实测）。
    const archivePaths = isSemver
      ? [`${repo}/zip/refs/tags/v${wantVer}`, `${repo}/archive/refs/tags/v${wantVer}.zip`]
      : [`${repo}/zip/refs/heads/main`, `${repo}/archive/refs/heads/main.zip`];
    const urls = [];
    for (const pathPart of archivePaths) {
      if (pathPart.startsWith('http')) urls.push(pathPart);
      else if (pathPart.startsWith(`${repo}/zip/`)) urls.push(`https://codeload.github.com/${pathPart}`);
      else urls.push(`https://github.com/${pathPart}`);
    }
    if (!String(item.archiveUrl || '').startsWith('http')) {
      urls.push(`https://gh-proxy.com/${urls[0]}`);
      urls.push(`https://ghproxy.net/${urls[0]}`);
    }
    const url = String(item.archiveUrl || urls[0]);
    const stamp = String(Date.now());
    const stagingRoot = path.join(stateDir, 'staging', `${item.id}-${stamp}`);
    fs.mkdirSync(stagingRoot, { recursive: true });
    // 失败即清理：以前失败会留一个 11.8MB 的 staging 目录，点几次就上百 MB（2026-10-30 反馈）
    const fail = (obj) => {
      try { fs.rmSync(stagingRoot, { recursive: true, force: true }); } catch {}
      return obj;
    };
    if (!isSemver && !String(item.archiveUrl || '').startsWith('http')) {
      // 目标只是一串提交号 = 远端有提交但没有可用版本（未发版/取不到 tag）。
      // 这时装 main.zip 会得到"文件是新的、package.json 还是旧版本"的快照，用户会觉得更新无效。
      return fail({
        ok: false, status: 'blocked', stage: 'preflight', code: 'version-unknown',
        reason: `检测到远端有新提交（${String(report?.remoteSha || '').slice(0, 7) || '?'}），但没有对应的发布版本号`,
        hint: '未发版提交不能自动更新：到 Release 页下载最新版手动覆盖；或确认网络能访问 api.github.com（版本号查询依赖它）',
      });
    }
    const zipFile = path.join(stagingRoot, 'pkg.zip');
    try {
      // 依次试 codeload / 镜像；**流式写盘 + 空闲超时**：慢网只要还在出数据就不算超时。
      const tried = [];
      let downloaded = null; // { bytes, elapsedMs, url }
      const idleMs = Math.max(5_000, Number(process.env.SURFCORE_UPDATE_IDLE_TIMEOUT_MS) || DOWNLOAD_IDLE_TIMEOUT_MS);
      const candidates = [url, ...(String(item.archiveUrl || '').startsWith('http') ? [] : urls.filter((u) => u !== url))];

      for (const candidate of candidates) {
        pluginLog(`[updates] 下载 ${candidate}`);
        const startedAt = Date.now();
        const controller = new AbortController();
        let idleTimer = setTimeout(() => controller.abort(), idleMs);
        const totalTimer = setTimeout(() => controller.abort(), DOWNLOAD_MAX_TOTAL_MS);
        let fh = null;
        try {
          const r = await fetch(candidate, { signal: controller.signal });
          if (!r.ok) {
            tried.push({ url: candidate, outcome: `http-${r.status}` });
            continue;
          }
          const reader = r.body?.getReader?.();
          if (!reader) {
            tried.push({ url: candidate, outcome: 'no-body' });
            continue;
          }
          const totalBytes = Number(r.headers.get('content-length')) || 0;
          downloadProgress = { active: true, phase: 'download', url: candidate, bytes: 0, total: totalBytes, percent: totalBytes ? 0 : null, speedBps: 0, startedAt };
          fh = fs.openSync(zipFile, 'w');
          let bytes = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            fs.writeSync(fh, value);
            bytes += value.length;
            const elapsed = Math.max(1, Date.now() - startedAt);
            downloadProgress = {
              ...downloadProgress,
              bytes,
              speedBps: Math.round(bytes / (elapsed / 1000)),
              percent: totalBytes ? Math.min(100, Math.round((bytes / totalBytes) * 100)) : null,
            };
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => controller.abort(), idleMs); // 有数据就续命
          }
          fs.closeSync(fh); fh = null;
          downloadProgress = { ...downloadProgress, active: false, phase: 'extract', bytes, percent: totalBytes ? 100 : downloadProgress?.percent ?? null };
          // HTTP 200 不代表包完整：截断的 zip 没有 EOCD。这里先预检，
          // 失败就换下一个镜像，不要等 Expand-Archive 才报“包坏了”。
          if (!hasZipEocd(zipFile)) {
            tried.push({ url: candidate, outcome: 'bad-zip' });
            try { fs.rmSync(zipFile, { force: true }); } catch {}
            continue;
          }
          downloaded = { bytes, elapsedMs: Date.now() - startedAt, url: candidate };
          break;
        } catch (error) {
          if (fh != null) { try { fs.closeSync(fh); } catch {} fh = null; }
          const aborted = /abort|timeout/i.test(String(error?.name ?? error?.message ?? ''));
          const fsError = /ENOSPC|EACCES|EPERM|EBUSY|EROFS/i.test(String(error?.code ?? error?.message ?? ''));
          tried.push({ url: candidate, outcome: aborted ? 'timeout' : fsError ? 'fs' : String(error?.message ?? error).slice(0, 80) });
          // 注意：**不要在这里 return** —— body 阶段失败也要继续试下一个镜像。
        } finally {
          clearTimeout(idleTimer);
          clearTimeout(totalTimer);
        }
      }

      if (!downloaded) {
        downloadProgress = { ...(downloadProgress ?? {}), active: false, phase: 'failed' };
        const last = tried[tried.length - 1] ?? {};
        const badZip = tried.some((x) => x.outcome === 'bad-zip');
        const httpStatus = /^http-(\d+)$/.exec(String(last.outcome || ''))?.[1];
        const info = classifyDownloadFailure({
          aborted: tried.some((x) => x.outcome === 'timeout'),
          httpStatus: httpStatus ? Number(httpStatus) : 0,
          fsError: tried.some((x) => x.outcome === 'fs'),
          error: last.outcome,
        });
        return fail({
          ok: false, status: 'failed', stage: badZip ? 'verify' : 'download', code: badZip ? 'verify.unzip-failed' : info.code,
          reason: badZip
            ? '下载完成但 ZIP 不完整（没有 EOCD/可能被截断），已尝试其他镜像仍失败'
            : info.code === 'download.timeout'
            ? `下载超时：${Math.round(idleMs / 1000)} 秒没有新数据（或超过总上限）`
            : info.code === 'download.write-failed'
              ? `下载内容写入失败：磁盘空间/目录权限（${String(last.outcome).slice(0, 80)}）`
              : `下载失败：${String(last.outcome ?? '所有地址都不可用').slice(0, 160)}`,
          hint: badZip ? '网络/代理可能截断了大文件：稍后重试，或到 Release 页手动下载 zip 覆盖' : info.hint,
          retryable: true,
          diagnostics: { tried },
        });
      }
      pluginLog(`[updates] 下载完成：${(downloaded.bytes / 1024 / 1024).toFixed(2)} MB，${(downloaded.elapsedMs / 1000).toFixed(1)} 秒（${downloaded.url}）`);
      downloadProgress = { ...(downloadProgress ?? {}), active: false, phase: 'extract' };
      try {
        await new Promise((resolve, reject) => {
          execFile('powershell', ['-NoProfile', '-Command',
            `Expand-Archive -LiteralPath '${zipFile}' -DestinationPath '${stagingRoot}' -Force`],
          { windowsHide: true, timeout: 120_000 }, (error) => (error ? reject(error) : resolve()));
        });
      } catch (error) {
        downloadProgress = { ...(downloadProgress ?? {}), active: false, phase: 'failed' };
        return fail({
          ok: false, status: 'failed', stage: 'verify', code: 'verify.unzip-failed',
          reason: `安装包解压失败：${String(error?.message ?? error).slice(0, 160)}`,
          hint: '安装包可能损坏：重试一次；仍失败请手动下载',
          retryable: true,
        });
      }

      downloadProgress = { ...(downloadProgress ?? {}), active: false, phase: 'verify' };
      const entries = fs.readdirSync(stagingRoot, { withFileTypes: true }).filter((d) => d.isDirectory() && /^surfcore-/.test(d.name));
      const src = entries.length ? path.join(stagingRoot, entries[0].name) : '';
      if (!src || !fs.existsSync(path.join(src, 'package.json'))) {
        return fail({
          ok: false, status: 'failed', stage: 'verify', code: 'verify.bad-archive',
          reason: '解压后没有找到仓库根目录（package.json 不存在）',
          hint: '这个包可能不是 SurfCore 安装包：请手动下载正式包',
        });
      }

      // ── 覆盖前预检：没有安装清单 / 包被换过 / 本地改过 → 一律阻止（不覆盖） ──
      const pkg = readPackageManifest(src);
      if (!pkg.ok) {
        return fail({
          ok: false, status: 'blocked', stage: 'verify', code: pkg.code,
          reason: pkg.code === 'manifest-missing'
            ? '这个版本没有安装清单（release/install-manifest.json），无法确认覆盖哪些文件'
            : '安装清单格式不对，无法确认覆盖范围',
          hint: '按官方 Release 页面手动下载并覆盖；或等下一个带清单的版本',
        });
      }
      const stagingCheck = verifyStaging(src, pkg.manifest);
      if (stagingCheck.missing.length) {
        // 归档里少了清单中的文件：旧清单/分支差异；不判失败，但要留痕（诊断里可见）
        pluginLog(`[updates] ${item.id} 校验：清单 ${stagingCheck.missing.length} 个文件在包内缺失（${stagingCheck.missing.slice(0, 3).join('、')}…）`);
      }
      if (stagingCheck.bad.length) {
        return fail({
          ok: false, status: 'failed', stage: 'verify', code: 'verify.staging-mismatch',
          reason: `发布包与它自带的清单不一致：${stagingCheck.bad.length} 个文件哈希不符（${stagingCheck.bad.join('、')}…）`
            + (stagingCheck.missing.length ? `，另有 ${stagingCheck.missing.length} 个缺失` : ''),
          // 这是发布侧问题（重试必然同样结果），不是本地损坏：别让用户反复下载
          hint: '这个版本的发布包自身不一致，自动更新无法完成：请到 Release 页手动下载该版本覆盖；这是发布流程问题，重试无效',
          deterministic: true,
          diagnostics: { checked: stagingCheck.checked, mismatch: stagingCheck.bad.length, missing: stagingCheck.missing.length, sample: stagingCheck.bad.slice(0, 5) },
        });
      }
      let priorFiles = null;
      try {
        const prior = JSON.parse(fs.readFileSync(path.join(dir, '.installed-manifest.json'), 'utf8'));
        if (prior && typeof prior.files === 'object') priorFiles = prior.files;
      } catch {}
      const hasMeta = fs.existsSync(path.join(dir, '.installed-meta.json'));
      if (!priorFiles && !hasMeta) {
        if (opts.firstInstall !== true) {
          return fail({
            ok: false, status: 'blocked', stage: 'preflight', code: 'evidence-insufficient',
            reason: '这个安装既没有安装清单也没有安装记录，无法确认目录归属',
            hint: '官方 zip 解压安装可点「首次更新（先备份）」；其他情况请按官方 Release 手动下载，装一次新版后即可恢复自动更新',
          });
        }
        if (!isTrustedZipInstall(dir)) {
          return fail({
            ok: false, status: 'blocked', stage: 'preflight', code: 'evidence-untrusted',
            reason: '目录不像 SurfCore 解压安装（package.json 名称不符，或是 git 工作副本）',
            hint: '不自动覆盖：请确认安装目录，或按官方 Release 手动下载',
          });
        }
        pluginLog(`[updates] ${item.id} 首次 zip 更新：用户确认后先备份再覆盖（无历史安装证据）`);
      }
      const plan = planOverwrite(dir, pkg.manifest, priorFiles);
      if (plan.modified.length && opts.overwriteModified !== true) {
        // 确定性失败：不还原/不显式覆盖，重试必然同样结果 → 前端应禁用“立即更新”，
        // 只留“备份并覆盖”这个显式出口（2026-11-02 测试机反馈 P0）。
        return fail({
          ok: false, status: 'blocked', stage: 'preflight', code: 'local-modifications',
          deterministic: true,
          reason: `这些文件被本地改过，覆盖会丢掉改动（共 ${plan.modified.length} 个）：${plan.modified.slice(0, 8).join('、')}${plan.modified.length > 8 ? '…' : ''}`,
          hint: '点「备份并覆盖」继续（会先把这些文件备份到 state/backups）；或先还原/手动下载新版',
          diagnostics: {
            modified: plan.modified.slice(0, 20),
            total: plan.modified.length,
            checked: plan.overwrite.length,
          },
        });
      }
      if (plan.modified.length) {
        pluginLog(`[updates] ${item.id} 用户选择备份并覆盖 ${plan.modified.length} 个本地改动文件`);
      }

      const txn = `${item.id}-${stamp}`;
      downloadProgress = { ...(downloadProgress ?? {}), active: false, phase: 'backup' };
      const backup = backupTarget(dir, plan.overwrite, txn, {
        component: item.id, from: report?.installedVersion ?? '', to: report?.latestVersion ?? '',
        manifest: pkg.manifest.version ?? '',
      });
      if (!backup.ok) {
        return fail({
          ok: false, status: 'failed', stage: 'backup', code: backup.code,
          reason: backup.reason,
          hint: '检查磁盘空间与 state/backups 权限后重试；备份失败不会覆盖任何文件',
        });
      }

      downloadProgress = { ...(downloadProgress ?? {}), active: false, phase: 'stage' };
      const staged = stageDeferredApply({
        kind: 'zip', component: String(item.id), target: dir, staging: src, to: String(report?.latestVersion ?? ''),
        txn, backup: backup.dir, from: report?.installedVersion ?? '',
        manifest: { version: pkg.manifest.version ?? '', files: Object.keys(pkg.manifest.files).length },
        meta: { version: String(report?.latestVersion ?? ''), sha: String(report?.remoteSha ?? '') },
      });
      downloadProgress = { ...(downloadProgress ?? {}), active: false, phase: staged.ok ? 'pending' : 'failed' };
      if (!staged.ok) {
        return fail({
          ok: false, status: 'failed', stage: 'stage', code: staged.code ?? 'stage.failed',
          reason: staged.reason ?? '更新助手没有启动',
          hint: '重启 DSH 后重试；或手动下载 zip 覆盖安装',
        });
      }
      pluginLog(`[updates] ${item.id} 已暂存 v${report?.latestVersion ?? '?'}，等 DSH 退出后应用（pid=${staged.pid ?? '?'}）`);
      return {
        ok: true, staged: true, needRestart: true,
        status: 'pending_restart', code: 'staged',
        message: `${item.name} 已下载，退出 DSH 后自动应用（尚未更新）`,
        restart: '退出并重新打开 DSH',
      };
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    } finally {
      try { fs.rmSync(zipFile, { force: true }); } catch {}
    }
  }

/** 写 pending 文件 + 起独立进程（等本宿主退出后执行覆盖）。 */
  function stageDeferredApply(job) {
    // 新一次排队 = 新尝试：上一轮的 .failed 不能再压住它
    try { fs.rmSync(path.join(stateDir, 'updates-pending.json.failed'), { force: true }); } catch {}

    const pendingFile = path.join(stateDir, 'updates-pending.json');
    const payload = {
      ...job,
      waitPid: process.pid,
      logFile: path.join(stateDir, 'apply-update.log'),
      createdAt: new Date().toISOString(),
    };
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(pendingFile, `${JSON.stringify(payload, null, 2)}
`, 'utf8');
    // 测试里不想真的起"等宿主退出"的进程时，设 SURFCORE_UPDATE_NO_SPAWN=1
    if (process.env.SURFCORE_UPDATE_NO_SPAWN === '1') return { ok: true, pid: null, pendingFile, spawned: false };
    const helper = String(process.env.SURFCORE_UPDATE_HELPER || '').trim() || path.join(REPO_ROOT, 'scripts', 'apply-update.mjs');
    if (!fs.existsSync(helper)) {
      return {
        ok: false, code: 'stage.helper-missing',
        reason: `更新助手文件不存在：${helper}`,
        pendingFile,
      };
    }
    let child;
    try {
      child = spawn(process.execPath, [helper, '--pending', pendingFile], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        cwd: stateDir,
        env: helperSpawnEnv(),
      });
    } catch (error) {
      return {
        ok: false, code: 'stage.spawn-failed',
        reason: `启动更新助手失败：${String(error?.message ?? error).slice(0, 160)}`,
        pendingFile,
      };
    }
    child.on('error', (error) => {
      pluginLog(`[updates] 更新助手启动出错（${pendingFile}）：${String(error?.message ?? error)}`);
    });
    child.unref();
    // 2.5 秒后看 helper 有没有留 .started：Electron 没带 RUN_AS_NODE 时会静默退出，必须报出来。
    const startedFile = `${pendingFile}.started`;
    setTimeout(() => {
      if (fs.existsSync(startedFile)) return;
      pluginLog(`[updates] 更新助手没有启动（${pendingFile}）：请重启 DSH 让其重试，或手动覆盖 zip`);
    }, 2500).unref?.();
    return { ok: true, pid: child.pid, pendingFile };
  }

  async function apply(ids, opts = {}) {
    if (applying) {
      const heldMs = applyingSince ? Date.now() - applyingSince : 0;
      if (heldMs > APPLY_STUCK_MS) {
        pluginLog(`[updates] 上一次更新已卡住 ${Math.round(heldMs / 1000)} 秒，强制复位后重试`);
        applying = false;
        applyingSince = 0;
      } else {
        // 必须带上 results[0]：前端只读 results，顶层 error 会被忽略 → 用户看到"原因不明"。
        const busy = {
          id: null, ok: false, status: 'busy', code: 'apply.busy',
          reason: '上一次更新还没结束（可能卡在下载）',
          error: '正在更新中，请稍候',
          hint: '等它结束；卡住超过 10 分钟会自动复位，想立刻重试就重启 DSH',
        };
        return { ok: false, code: 'apply.busy', error: busy.error, reason: busy.reason, retryable: true, results: [busy] };
      }
    }
    const wanted = new Set((Array.isArray(ids) ? ids : []).map(String));
    if (!wanted.size) return { ok: false, error: '没有选择要更新的组件', results: [] };
    applying = true;
    applyingSince = Date.now();
    downloadProgress = null;
    try {
      // 更新前重新检查一次：用户可能刚改过文件、远端也可能又变了
      await check({ fetch: true, firstInstall: opts.firstInstall === true });
      const all = list();
      const results = [];
      const stagedTargets = new Map();
      for (const item of all) {
        if (!wanted.has(String(item.id))) continue;
        const report = (state.results ?? []).find((row) => row.id === item.id);
        if (!report?.available) { results.push({ id: item.id, ok: false, code: 'apply.not-available', error: report?.reason ?? '不可用', hint: '先点「检查更新」确认远端可达' }); continue; }
        if (!report.updateAvailable) { results.push({ id: item.id, ok: true, skipped: true, message: '已是最新' }); continue; }
        if (report.blocked) {
          results.push({
            id: item.id, ok: false, status: 'blocked',
            code: report.code ?? 'blocked',
            reason: report.blocked, hint: report.hint ?? '',
            error: report.blocked,
          });
          continue;
        }
        const blocked = blockedReason(item);
        if (blocked) { results.push({ id: item.id, ok: false, code: 'apply.blocked', error: blocked, hint: '按提示处理后再试' }); continue; }

        if (report.channel === 'version' || report.channel === 'dev') {
          // dev 构建也是 tag 归档：和稳定版走同一条 zip 流水线（校验/暂存/回滚都复用）。
          const done = await updateFromZip(item, report, opts);
          if (done?.ok && done.staged) stagedTargets.set(String(item.id), targetKeyOf(report));
          results.push({ id: item.id, ...done });
          continue;
        }

        if (report.channel === 'release') {
          // 构建产物型（桌宠）：下 zip → 校验 → 交给组件自己的安装器。
          const downloaded = await downloadReleaseAsset(item, report, {
            stateDir,
            pluginLog,
            onProgress: (p) => { downloadProgress = p; },
          });
          if (!downloaded.ok) {
            downloadProgress = { ...(downloadProgress ?? {}), active: false, phase: 'failed' };
            results.push({ id: item.id, ok: false, code: downloaded.code ?? 'download.failed', error: downloaded.error, hint: downloaded.hint ?? '检查网络后重试；持续失败可手动下载安装包' });
            continue;
          }
          downloadProgress = { ...(downloadProgress ?? {}), active: false, phase: 'install' };
          if (typeof item.installZip !== 'function') {
            results.push({ id: item.id, ok: false, error: '这个组件没有配置安装器（installZip）' });
            continue;
          }
          let installed;
          try { installed = await item.installZip(downloaded.path, { report }); }
          catch (error) { installed = { ok: false, error: String(error?.message ?? error) }; }
          try { fs.rmSync(downloaded.path, { force: true }); } catch {}
          if (!installed?.ok) { results.push({ id: item.id, ok: false, code: installed?.code ?? 'apply.install-failed', error: installed?.error ?? '安装失败', hint: installed?.hint ?? '查看该组件安装器日志；或手动下载安装包覆盖' }); continue; }
          results.push({
            id: item.id, ok: true, from: report.installedVersion, to: report.latestVersion,
            message: `${report.name} 已更新到 v${report.latestVersion}`,
            restart: '重启桌宠',
          });
          continue;
        }

        if (report.channel === 'git') {
          // 同样不能在宿主进程里 merge：工作区文件正在被使用。交给退出后的独立进程。
          const dir = normalizeDir(item.dir);
          if (!dir) { results.push({ id: item.id, ok: false, error: '目录不存在' }); continue; }
          const staged = stageDeferredApply({
            kind: 'git', component: String(item.id), target: dir,
            branch: String(item.branch || report.branch || 'main'), to: String(report.latest ?? ''),
          });
          if (staged.ok) stagedTargets.set(String(item.id), targetKeyOf(report));
          pluginLog(`[updates] ${item.id} 已排队 git 更新，等 DSH 退出后执行（pid=${staged.pid ?? '?'}）`);
          results.push({
            id: item.id, ok: true, staged: true, needRestart: true,
            status: 'pending_restart', code: 'staged',
            from: report.local, to: report.latest,
            message: `${report.name} 已排队更新（${report.behind} 个提交）；退出 DSH 后自动应用（尚未更新）`,
            restart: '退出并重新打开 DSH',
          });
          continue;
        }

        // 兼容非常老的检查结果（没有 channel 字段）：那时只有 git 组件。
        if (!report.channel) {
          const merged = await fastForwardComponent({ ...item, branch: report.branch });
          if (!merged.ok) {
            results.push({
              id: item.id, ok: false, code: 'apply.git-failed',
              error: merged.error,
              hint: /ENOENT/.test(String(merged.error))
                ? '本机没有 git 命令：zip 安装不该走 git 更新（插件缺陷，请反馈）；可手动下载 zip 覆盖'
                : '先处理本地改动/网络后重试',
            });
            continue;
          }
          results.push({
            id: item.id, ok: true, from: report.local, to: merged.head,
            message: `${report.name} 已更新（${report.behind} 个提交）`,
            restart: String(item.id).startsWith('surfvoice') ? '重启对应语音服务' : (item.id === 'surfcore' ? '重启 DSH' : '重启对应组件'),
          });
          continue;
        }

        // 有 channel 但没有对应应用逻辑 = 插件缺陷；绝不能猜成 git merge。
        results.push({
          id: item.id, ok: false, code: 'apply.unknown-channel',
          error: `更新通道「${report.channel}」没有对应的应用逻辑`,
          hint: '这是插件缺陷：请把这条诊断反馈开发者；可先手动下载该版本 zip 覆盖',
        });
        continue;
      }
      // 只有“已经真正落地”的组件才需要重新拉远端校准；staged 组件还没覆盖文件，
      // 这里绝不能做 no-fetch 检查（它会把 latestVersion 洗成 null，dismiss 再次写成 vnull）。
      if (results.some((row) => row.ok && !row.staged)) {
        await check({ fetch: true });
      }
      // 已排队（staged）的组件：记成"已处理"，重启前不再弹同一个提醒。
      // 以前不记账 → 用户点了更新、还没重启，下次检查又弹一遍（2026-10-28 反馈）。
      try {
        for (const row of results) {
          if (!row.ok || !row.staged) continue;
          // 用下载前捕获的目标键；最后的 check({fetch:false}) 会把 latestVersion 洗成 null，
          // 不能再从它算 key（否则又写成 vnull，重启前重复弹 update）。
          const key = stagedTargets.get(String(row.id))
            ?? (() => {
              const report = (state.results ?? []).find((x) => x.id === row.id);
              if (!report) return '';
              return report.remote ?? (report.latestVersion ? `v${report.latestVersion}` : '');
            })();
          if (key) state.dismissed[row.id] = key;
        }
        persist();
      } catch {}
      const failedNow = results.filter((row) => !row.ok);
      // 下载/网络类失败：30 分钟内不再自动弹同一条（用户关掉后不该每次检查又出现）
      for (const f of failedNow) {
        if (/^download\./.test(String(f.code || ''))
          || String(f.code || '').startsWith('stage.')
          || /^apply\.(unknown-channel|unknown-kind|git-failed)$/.test(String(f.code || ''))) {
          const row = (state.results ?? []).find((r) => r.id === f.id);
          if (row) {
            state.applyBackoff = state.applyBackoff && typeof state.applyBackoff === 'object' ? state.applyBackoff : {};
            state.applyBackoff[f.id] = { target: targetKeyOf(row), until: Date.now() + 30 * 60_000, code: f.code };
          }
        }
      }
      state.lastApplyFailure = failedNow.length
        ? {
          status: 'failed',
          code: failedNow[0].code ?? 'apply.failed',
          component: failedNow[0].id,
          reason: failedNow[0].reason ?? failedNow[0].error ?? '更新失败',
          hint: failedNow[0].hint ?? '',
          deterministic: failedNow[0].deterministic === true,
          mismatchCount: failedNow[0].diagnostics?.mismatch,
          missingCount: failedNow[0].diagnostics?.missing,
          modifiedCount: failedNow[0].diagnostics?.total,
          modifiedSample: failedNow[0].diagnostics?.modified,
          sample: failedNow[0].diagnostics?.sample,
          at: new Date().toISOString(),
        }
        : null;
      persist();
      const changed = results.filter((row) => row.ok && !row.skipped);
      const pendingRestart = results.filter((row) => row.status === 'pending_restart').length;
      const failed = results.filter((row) => !row.ok);
      return {
        ok: results.every((row) => row.ok),
        results,
        updated: changed.length - pendingRestart,
        pendingRestart,
        failed: failed.map((row) => ({ id: row.id, code: row.code ?? '', reason: row.reason ?? row.error ?? '' })),
        restartRequired: changed.length > 0,
        status: status(),
      };
    } finally {
      applying = false;
      applyingSince = 0;
    }
  }

  /** "不再提示本次更新"：把当前远端 commit 记下来；远端再往前走会重新提示。 */
  function dismiss(ids) {
    const wanted = Array.isArray(ids) && ids.length ? new Set(ids.map(String)) : null;
    for (const row of state.results ?? []) {
      if (!row?.available || !row.updateAvailable) continue;
      if (wanted && !wanted.has(String(row.id))) continue;
      // 版本号通道没有 remote：用 v<latest> 当 key，和 pendingOf 保持一致。
      state.dismissed[row.id] = row.remote ?? `v${row.latestVersion ?? ''}`;
    }
    persist();
    return status();
  }

  /**
   * 清掉当前检查结果（切换更新通道时用）：
   * 避免切回 main 后，上一轮 dev 检查留下的 pending 继续弹窗——main 通道不该被 dev 更新打扰。
   */
  function resetCheck() {
    state.results = [];
    state.lastCheckAt = 0;
    state.lastError = '';
    persist();
    return status();
  }

  /** 清掉"不再提示"，让下一次检查重新提示（界面上的"恢复提示"）。 */
  function resetDismissed() {
    state.dismissed = {};
    persist();
    return status();
  }

  function startAutoCheck({ delayMs = 20_000, intervalMs = 6 * 60 * 60 * 1000, enabled = true } = {}) {
    if (!enabled || timer) return;
    const first = setTimeout(() => { void check(); }, Math.max(1_000, Number(delayMs) || 20_000));
    first.unref?.();
    timer = setInterval(() => { void check(); }, Math.max(10 * 60_000, Number(intervalMs) || 6 * 60 * 60 * 1000));
    timer.unref?.();
  }

  function dispose() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  return { check, apply, rollback, dismiss, resetDismissed, resetCheck, status, startAutoCheck, dispose, file };
}

export { resumePendingApply };

/**
 * 启动时重试未完成的更新：上次的助手可能没跑起来（Electron 没带 RUN_AS_NODE）。
 * 这里把 waitPid 改成当前进程并重新拉起 —— 用户下一次退出 DSH 就会应用。
 */
function resumePendingApply({ stateDir, pluginLog = () => {} } = {}) {
  try {
    const pendingFile = path.join(stateDir, 'updates-pending.json');
    if (!fs.existsSync(pendingFile)) return false;
    const pending = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
    const started = `${pendingFile}.started`;
    try { fs.rmSync(started, { force: true }); } catch {}
    pending.waitPid = process.pid;
    pending.resumedAt = new Date().toISOString();
    fs.writeFileSync(pendingFile, `${JSON.stringify(pending, null, 2)}
`, 'utf8');
    const helper = path.join(REPO_ROOT, 'scripts', 'apply-update.mjs');
    const child = spawn(process.execPath, [helper, '--pending', pendingFile], {
      detached: true, stdio: 'ignore', windowsHide: true, cwd: stateDir, env: helperSpawnEnv(),
    });
    child.unref();
    pluginLog(`[updates] 发现未完成的更新（${pending.component} → v${pending.to ?? '?'}），已重新排队（pid=${child.pid ?? '?'}）`);
    return true;
  } catch (error) {
    pluginLog('[updates] 重试未完成更新失败：', String(error?.message ?? error));
    return false;
  }
}

