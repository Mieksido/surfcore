// 语音包管理器：把语音引擎做成"可选安装包"，surfcore 本体不背这几 GB。
//
// 设计要点：
// - npm 包里只有 manifest（几百字节），模型和运行时都在包内，装的时候才下载/复制。
// - 安装源支持两种：本地目录（开发期）和 http(s) zip（分发期）。zip 用系统自带 tar 解压。
// - 所有路径都限制在 packsDir 下面，卸载前先校验，避免误删用户别的东西。
// - 语音服务挂了绝不影响聊天：这里只负责"启停/状态"，不参与消息主流程。

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { wavDurationMs } from './voice-tts.js';
import { stripCloudCredentials } from './voice-pack-secrets.js';
import {
  IMPORT_CODES,
  ImportError,
  inspectImportSource,
  rewriteVenvConfig,
  prepareConfig,
  copyTree,
  dirSize,
  missingPackFiles,
  validateConfigText,
  renameWithRetry,
  removeWithRetry,
} from './voice-pack-import.js';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 启动日志可能是 Windows GBK（cmd/Python 控制台），不能一律按 UTF-8 解。 */
function decodeProcessLog(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer ?? ''), 'utf8');
  const utf8 = buf.toString('utf8');
  if (!utf8.includes('\uFFFD')) return utf8;
  try { return new TextDecoder('gbk').decode(buf); } catch { return utf8; }
}

/**
 * 开发期的默认安装源：**仓库同级的** `voice/packages/<id>`。
 *
 * 为什么不写死盘符（2026-10-26）：原来这里硬编码了本机的一个绝对路径（`<工作区>\voice\...`），
 * 换机器/换目录后默认安装源直接指向不存在的路径，而现象只是"安装失败"。
 * 改成相对仓库根解析：本机仓库放在工作区分区下，其上级正好是 `voice/` 所在目录，
 * 解析结果与旧值**逐字相同**（`scripts/test-voice-packs-default.mjs` 比对），所以本机行为不变，换目录也能用。
 */
function devPackUrl(id) {
  return path.join(REPO_ROOT, '..', 'voice', 'packages', id);
}

/** 默认两个语音包。url 支持：http(s) 链接、本地目录、本地 zip。 */
export const DEFAULT_MANIFESTS = [
  {
    id: 'voice-local',
    name: '本地语音包',
    version: '1.0.0',
    // 2026-10-28 更正：旧值 7.83GB 是开发机整目录（含 .venv 5.1GB + 日志），
    // 公开分发实际下载 ≈ 1.77GB（vendor 1.71 + models 0.05）。
    sizeBytes: 1_900_000_000,
    port: 8765,
    startScript: 'run.bat',
    stopScript: 'stop.bat',
    // 本地音色真正的推理进程：voxd(8765) 只是入口，合成要 GPT-SoVITS(9880)。
    // 2026-10-27：只起 run.bat 时发语音全 503，用户以为"语音坏了"。
    engineScript: 'gsv.bat',
    enginePort: 9880,
    repo: 'Mieksido/surfvoicelocal',
    postInstall: ['scripts/fetch-models.mjs', 'scripts/bootstrap-env.mjs'],
    // 装完必须存在的目录（否则就是"只下了代码、模型没下完"）
    verifyDirs: ['models', 'vendor/GPT-SoVITS'],
    engineWarmupHint: '本地音色引擎加载约 40 秒，期间发语音会失败，稍等再试',
    // 开发期用本地目录；分发期换成 GitHub Releases 的 zip 链接
    url: process.env.SURFCORE_VOICE_LOCAL_URL || devPackUrl('voice-local'),
    requires: { gpu: true, network: false },
    voices: [{ id: 'loli12-gsv', label: '小语（本地 · 女童声）' }],
    about: {
      summary: '在你自己的电脑上跑，不联网也能说话。',
      pros: ['完全免费', '断网可用', '延迟 1.0~1.5 秒'],
      cons: ['需要 NVIDIA 显卡（6G 显存以上）', '下载约 1.8GB，首次装依赖 20~40 分钟'],
    },
  },
  {
    id: 'voice-cloud',
    name: '云端语音包',
    version: '1.0.0',
    sizeBytes: 280_000_000,
    port: 8767,
    startScript: 'run.bat',
    // 云端包不需要 run.bat 里的 `start`：直接拉 python，桥接才能收到 stderr，
    // 否则 Python 崩在独立窗口里，桥接只能等 60 秒后报“端口没起来”。
    directStart: { python: '.venv/Scripts/python.exe', args: ['-m', 'voxd', '--config', 'config.toml'] },
    stopScript: 'stop.bat',
    repo: 'Mieksido/surfvoicecloud',
    postInstall: ['scripts/fetch-models.mjs', 'scripts/bootstrap-env.mjs'],
    verifyDirs: ['models'],
    url: process.env.SURFCORE_VOICE_CLOUD_URL || devPackUrl('voice-cloud'),
    requires: { gpu: false, network: true },
    voices: [{ id: 'age12-cloud', label: '小语（云端 · 女童声）' }],
    about: {
      summary: '调用火山引擎声音复刻服务，音质最好。',
      pros: ['延迟 0.5~1.1 秒', '不占显卡', '安装约 280MB，1~3 分钟'],
      cons: ['按字符计费（火山引擎收取，与本插件无关）', '必须联网', '要自己申请两个密钥'],
      billing: '按字符计费。每天直播 3 小时约 135 万字符/月。不想付费就装本地包，效果接近且不要钱。',
      disclaimer: '这不是推销：两个包功能对等，装哪个都不影响插件其他功能。',
    },
  },
];

function packsDir(cfg) {
  // 默认目录必须和插件侧一致（插件用 <仓库根>/state/voice-packs）。
  // 2026-10-27：以前用 process.cwd()，桥接 cwd 不同就会指到两个地方 → "装了却说没装"。
  const base = cfg?.voicePacks?.dir || path.join(REPO_ROOT, 'state', 'voice-packs');
  return path.resolve(base);
}

function stateFile(cfg) {
  return path.join(packsDir(cfg), 'installed.json');
}

async function readState(cfg) {
  try {
    return JSON.parse(await fsp.readFile(stateFile(cfg), 'utf8'));
  } catch {
    return { packs: {} };
  }
}

async function writeState(cfg, state) {
  await fsp.mkdir(packsDir(cfg), { recursive: true });
  await fsp.writeFile(stateFile(cfg), JSON.stringify(state, null, 2), 'utf8');
}

function manifests(cfg) {
  const extra = Array.isArray(cfg?.voicePacks?.manifests) ? cfg.voicePacks.manifests : [];
  const byId = new Map(DEFAULT_MANIFESTS.map((m) => [m.id, m]));
  for (const m of extra) byId.set(m.id, { ...byId.get(m.id), ...m });
  return [...byId.values()];
}

/** 已知会放语音包的目录（按可信度）：配置目录、仓库根、cwd、用户目录下常见位置。 */
function packDirCandidates(cfg, id) {
  const list = [];
  const push = (base) => {
    const d = path.join(path.resolve(base), id);
    if (!list.includes(d)) list.push(d);
  };
  push(packsDir(cfg));
  push(path.join(REPO_ROOT, 'state', 'voice-packs'));
  push(path.join(process.cwd(), 'state', 'voice-packs'));
  // 旧版默认目录用过 cwd，用户把包装到「文档\surfcore」这种地方很常见（2026-10-28 反馈）。
  push(path.join(os.homedir(), 'Documents', 'surfcore', 'state', 'voice-packs'));
  push(path.join(os.homedir(), 'surfcore', 'state', 'voice-packs'));
  return list;
}


/** 按端口找监听进程并强杀（stop.bat 失效时的兜底）。 */
function killListeners(port) {
  return new Promise((resolve) => {
    const ps = spawn('powershell', ['-NoProfile', '-Command',
      `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue; $_ }`],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    ps.stdout.on('data', (d) => { out += String(d); });
    ps.on('exit', () => resolve(out.trim().length > 0));
    ps.on('error', () => resolve(false));
  });
}

function packDir(cfg, id) {
  const root = packsDir(cfg);
  const dir = path.join(root, id);
  if (!dir.startsWith(root + path.sep)) throw new Error(`非法语音包 id：${id}`);
  // 配置目录里没有，就去候选目录找已经装好的那份（否则"装了却说没装"）。
  try {
    if (fs.existsSync(path.join(dir, 'config.toml'))) return dir;
  } catch {}
  for (const candidate of packDirCandidates(cfg, id)) {
    try {
      if (fs.existsSync(path.join(candidate, 'config.toml'))) return candidate;
    } catch {}
  }
  return dir;
}

/** 这个包是否不在「配置的安装目录」里（UI 用来提示"已在别处安装"）。 */
function isExternalDir(cfg, id, dir) {
  return path.resolve(dir) !== path.resolve(path.join(packsDir(cfg), id));
}

/** TCP 探活：给 300ms，够本机服务回应。 */
function probePort(port, timeout = 300) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const done = (ok) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeout);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

/** 本地目录直接用；zip 先落到临时文件再用系统 tar 解压（Windows 10+ 自带 bsdtar）。 */
/** GitHub archive zip 解压后多一层 `<repo>-main/`：把里面的内容提上来。 */
export async function flattenSingleDir(destDir) {
  let entries = [];
  try { entries = await fsp.readdir(destDir, { withFileTypes: true }); } catch { return false; }
  const dirs = entries.filter((e) => e.isDirectory());
  const files = entries.filter((e) => !e.isDirectory());
  if (dirs.length !== 1 || files.length > 0) return false;
  const inner = path.join(destDir, dirs[0].name);
  if (await exists(path.join(destDir, 'config.toml'))) return false;
  // 判定“这层是包根”不能看 config.toml：仓库里只有 config.example.toml（真实配置不入库），
  // 用 package.json / models.json / version.json / config.example.toml 任一存在即可（2026-10-28 报告 #1）。
  const markers = ['package.json', 'models.json', 'version.json', 'config.example.toml', 'config.toml'];
  let isPackRoot = false;
  for (const m of markers) {
    if (await exists(path.join(inner, m))) { isPackRoot = true; break; }
  }
  if (!isPackRoot) return false;
  for (const name of await fsp.readdir(inner)) {
    await fsp.rename(path.join(inner, name), path.join(destDir, name));
  }
  await fsp.rm(inner, { recursive: true, force: true });
  return true;
}

async function fetchToLocal(cfg, id, src, destDir, onProgress = () => {}, { mirror = '' } = {}) {
  if (/^https?:\/\//i.test(src)) {
    await fsp.mkdir(destDir, { recursive: true });
    // 代码 zip 也走用户选的镜像；镜像失败再回原地址，不能只让模型下载吃镜像。
    const urls = [];
    const m = String(mirror || '').trim().replace(/\/+$/, '');
    if (/^https?:\/\//i.test(m)) urls.push(`${m}/${src}`);
    urls.push(src);
    let lastError = null;
    for (const url of urls) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const tmp = path.join(os.tmpdir(), `surfcore-${id}-${Date.now()}-${attempt}.zip`);
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
          if (!res.ok) {
            const error = new Error(`HTTP ${res.status}`);
            error.status = res.status;
            throw error;
          }
          const total = Number(res.headers.get('content-length') || 0);
          let got = 0;
          const file = fs.createWriteStream(tmp);
          for await (const chunk of res.body) {
            got += chunk.length;
            file.write(chunk);
            if (total) onProgress(Math.min(99, Math.round((got / total) * 90)), '下载中');
          }
          await new Promise((r) => file.end(r));
          onProgress(96, '解压中');
          await new Promise((resolve, reject) => {
            const p = spawn('tar', ['-xf', tmp, '-C', destDir], { stdio: 'ignore' });
            p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`解压失败（exit ${code}）`))));
            p.on('error', reject);
          });
          await fsp.rm(tmp, { force: true });
          return;
        } catch (error) {
          lastError = error;
          try { await fsp.rm(tmp, { force: true }); } catch {}
          // 4xx 不是网络抖动，重试没意义；5xx/429/连接超时才重试。
          const status = Number(error?.status) || 0;
          if (status && status < 500 && status !== 429) break;
          if (attempt < 1) await new Promise((r) => setTimeout(r, 800));
        }
      }
    }
    const cause = lastError?.cause?.code || lastError?.code || lastError?.name || '';
    const detail = cause ? `${lastError?.message || '下载失败'}（${cause}）` : (lastError?.message || '下载失败');
    const error = new Error(`下载安装包失败：${detail}。检查网络、代理或换一个下载镜像后重试。`);
    error.cause = lastError;
    throw error;
  }

  // 本地目录 / 本地 zip
  const st = await fsp.stat(src).catch(() => null);
  if (!st) throw new Error(`安装源不存在：${src}`);
  if (st.isDirectory()) {
    onProgress(10, '复制中');
    await fsp.cp(src, destDir, { recursive: true, force: true });
    onProgress(100, '完成');
    return;
  }
  onProgress(10, '解压中');
  await fsp.mkdir(destDir, { recursive: true });
  await new Promise((resolve, reject) => {
    const p = spawn('tar', ['-xf', src, '-C', destDir], { stdio: 'ignore' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`解压失败（exit ${code}）`))));
    p.on('error', reject);
  });
  onProgress(100, '完成');
}

// ── 云端凭据边界（2026-10-29）──────────────────────────────────────────────
//
// 实现已抽到 voice-pack-secrets.js：安装、离线导入、测试共用同一份清洗规则；
// 这里保留 re-export，旧调用方/测试不用改 import 路径。
export { stripCloudCredentials } from './voice-pack-secrets.js';

/**
 * 装完后的 `config.toml`：仓库只带 `config.example.toml` 时复制一份；
 * 新装一律清掉云端凭据（见上面的背景）。返回是否新建/是否清过，供进度条显示。
 */
export async function ensurePackConfig(dir, { hadOwnConfig = false } = {}) {
  const file = path.join(dir, 'config.toml');
  let created = false;
  if (!(await exists(file))) {
    const example = path.join(dir, 'config.example.toml');
    if (!(await exists(example))) throw new Error('包里没有 config.toml，可能下载的是错的文件');
    await fsp.copyFile(example, file);
    created = true;
  }
  if (hadOwnConfig) return { created, sanitized: false, file };
  const raw = await fsp.readFile(file, 'utf8');
  const cleaned = stripCloudCredentials(raw);
  if (cleaned !== raw) await fsp.writeFile(file, cleaned, 'utf8');
  return { created, sanitized: cleaned !== raw, file };
}

export function createVoicePacks(cfg) {
  const activeInstalls = new Map(); // id → {progress, phase, startedAt, error}
  const activeImports = new Map(); // id → 导入进度/错误（离线包复制与切换）

  function importTarget(id) {
    return path.join(packsDir(cfg), id);
  }

  function importSnapshot(rec) {
    if (!rec) return null;
    return {
      progress: rec.progress,
      phase: rec.phase,
      startedAt: rec.startedAt,
      error: rec.error || null,
      code: rec.code || null,
      hint: rec.hint || '',
      missing: Array.isArray(rec.missing) ? rec.missing : [],
      cancelled: Boolean(rec.cancelled),
      sourceDir: rec.sourceDir,
      targetDir: rec.targetDir,
      backupDir: rec.backupDir || null,
      verified: Boolean(rec.verified),
      result: rec.result || null,
    };
  }

  async function inspectImport(id, sourceDir) {
    const m = manifests(cfg).find((x) => x.id === id);
    if (!m) throw new ImportError(IMPORT_CODES.PACK_NOT_FOUND, `未知语音包：${id}`, { hint: '刷新设置页后重试。' });
    return inspectImportSource({ id, sourceDir, targetDir: importTarget(id) });
  }

  async function checkFreeSpace(dir, need) {
    try {
      await fsp.mkdir(dir, { recursive: true });
      const s = await fsp.statfs(dir);
      const free = Number(s.bavail) * Number(s.bsize);
      if (Number.isFinite(free) && free < need + 256 * 1024 * 1024) {
        throw new ImportError(IMPORT_CODES.DISK_FULL, '磁盘空间不足，无法导入离线包', {
          hint: `需要至少 ${(need / 1024 ** 3).toFixed(1)} GB，当前可用 ${(free / 1024 ** 3).toFixed(1)} GB。请清理磁盘，或把语音包安装目录换到空间更大的盘。`,
          detail: { freeBytes: free, needBytes: need },
        });
      }
    } catch (e) {
      if (e instanceof ImportError) throw e;
      // statfs 在个别文件系统上不可用：不阻塞导入，结构性错误仍会在复制时暴露。
    }
  }

  async function startImport(id, { sourceDir, allowUnverified = false } = {}) {
    const m = manifests(cfg).find((x) => x.id === id);
    if (!m) throw new ImportError(IMPORT_CODES.PACK_NOT_FOUND, `未知语音包：${id}`, { hint: '刷新设置页后重试。' });
    const prev = activeImports.get(id);
    if (prev && prev.phase !== '完成' && prev.phase !== '失败') {
      throw new ImportError('IMPORT_BUSY', '这个语音包正在导入中', {
        hint: '等当前导入结束，或先点「取消导入」。',
        status: 409,
      });
    }
    if (prev) activeImports.delete(id);

    const info = await inspectImport(id, sourceDir);
    if (!info.verified && !allowUnverified) {
      throw new ImportError(IMPORT_CODES.UNVERIFIED, '离线包没有完整性清单', {
        hint: '该包未经完整性验证，可能不完整或被替换。确认来源可信后点「仍要导入」。',
        status: 409,
        detail: { warnings: info.warnings || [] },
      });
    }
    const target = importTarget(id);
    if (await probePort(m.port)) {
      throw new ImportError(IMPORT_CODES.TARGET_RUNNING, '目标语音包正在运行，不能覆盖', {
        hint: '先在设置页停止这个语音包，再重新导入。',
        status: 409,
        detail: { port: m.port, targetDir: target },
      });
    }
    if (m.enginePort && await probePort(m.enginePort)) {
      throw new ImportError(IMPORT_CODES.TARGET_RUNNING, '音色引擎仍在运行，不能覆盖', {
        hint: `先停止本地音色引擎（端口 ${m.enginePort}），或点「先停止语音包」后再导入。`,
        status: 409,
        detail: { port: m.enginePort, targetDir: target },
      });
    }
    const source = info.sourceDir;
    const inPlace = path.resolve(source) === path.resolve(target);
    if (!inPlace) await checkFreeSpace(path.dirname(target), info.sizeBytes);
    const targetExists = await exists(target);
    const oldConfigPath = targetExists && (await exists(path.join(target, 'config.toml')))
      ? path.join(target, 'config.toml') : '';
    if (oldConfigPath) {
      let oldText = '';
      try { oldText = await fsp.readFile(oldConfigPath, 'utf8'); } catch (e) {
        throw new ImportError(IMPORT_CODES.CONFIG_INVALID, '读不到旧 config.toml，无法保留用户配置', {
          hint: '先备份旧包并修复/删除旧 config.toml 后再导入；导入不会覆盖它。',
          detail: { file: oldConfigPath, reason: String(e?.message || e) },
        });
      }
      const bad = validateConfigText(oldText);
      if (bad) {
        throw new ImportError(IMPORT_CODES.CONFIG_INVALID, `旧 config.toml 格式不对（${bad}）`, {
          hint: '旧配置不会被覆盖。请先备份并修复/删除旧 config.toml，再重新导入。',
          detail: { file: oldConfigPath },
        });
      }
    }
    const rec = {
      progress: 2,
      phase: '校验通过',
      startedAt: Date.now(),
      error: null,
      code: null,
      hint: '',
      missing: [],
      cancelled: false,
      sourceDir: source,
      targetDir: target,
      backupDir: null,
      verified: info.verified,
      result: null,
    };
    activeImports.set(id, rec);

    (async () => {
      let temp = '';
      let switched = false;
      try {
        if (!inPlace) {
          temp = path.join(packsDir(cfg), `.import-${id}-${Date.now()}`);
          await copyTree(source, temp, {
            onProgress: (pct, phase) => { rec.progress = pct; rec.phase = phase; },
            isCancelled: () => rec.cancelled,
          });
          if (rec.cancelled) throw new ImportError(IMPORT_CODES.CANCELLED, '导入已取消', { hint: '没有改动旧包；可以重新导入。', status: 409 });
          // 源目录若自带 config.toml，先立刻清掉凭据，避免临时目录里长时间留 key；
          // 有旧配置时下一步 prepareConfig 会用用户旧配置覆盖它。
          const tempConfig = path.join(temp, 'config.toml');
          if (await exists(tempConfig)) {
            const raw = await fsp.readFile(tempConfig, 'utf8').catch(() => '');
            if (raw) await fsp.writeFile(tempConfig, stripCloudCredentials(raw), 'utf8');
          }
          rec.phase = '处理配置';
          rec.progress = 78;
          await prepareConfig(temp, oldConfigPath);
          const missing = await missingPackFiles(id, temp);
          if (missing.length) {
            throw new ImportError(IMPORT_CODES.PACK_INCOMPLETE, '复制后的离线包不完整', {
              hint: '重新下载完整离线包后再导入。',
              missing,
            });
          }
          if (rec.cancelled) throw new ImportError(IMPORT_CODES.CANCELLED, '导入已取消', { hint: '没有改动旧包；可以重新导入。', status: 409 });
          rec.phase = '切换安装目录';
          rec.progress = 94;
          if (targetExists) {
            rec.backupDir = `${target}.backup-${Date.now()}`;
            await renameWithRetry(target, rec.backupDir);
          }
          await renameWithRetry(temp, target);
          temp = '';
          switched = true;
          // 必须在 rename 之后改写：pyvenv.cfg 的 home 要指向最终目录，
          // 指向 .import-* 临时目录的话，重命名后解释器直接找不到 runtime。
          rec.phase = '修复 Python 环境';
          rec.progress = 96;
          await rewriteVenvConfig(target, { versions: id === 'voice-local' ? ['313', '312'] : ['313'] });
        } else {
          rec.phase = '修复 Python 环境（就地）';
          rec.progress = 70;
          await rewriteVenvConfig(target, { versions: id === 'voice-local' ? ['313', '312'] : ['313'] });
          if (!oldConfigPath) {
            rec.phase = '处理配置（就地）';
            await prepareConfig(target, '');
          }
          switched = true;
        }

        const state = await readState(cfg);
        state.packs = state.packs || {};
        state.packs[id] = {
          ...(state.packs[id] || {}),
          enabled: true,
          installedAt: new Date().toISOString(),
          importedAt: new Date().toISOString(),
          version: info.version || m.version,
          importSource: inPlace ? null : source,
          backupDir: rec.backupDir || null,
          verified: Boolean(info.verified),
        };
        await writeState(cfg, state);
        rec.phase = '完成';
        rec.progress = 100;
        rec.result = {
          ok: true,
          imported: !inPlace,
          alreadyInPlace: inPlace,
          sourceDir: source,
          targetDir: target,
          backupDir: rec.backupDir || null,
          verified: Boolean(info.verified),
          runtimeVerified: false,
          version: info.version || m.version,
        };
      } catch (e) {
        const err = e instanceof ImportError ? e : new ImportError(IMPORT_CODES.COPY_FAILED, String(e?.message || e), {
          hint: '检查源目录、磁盘空间和文件占用后重试。',
        });
        rec.error = err.message;
        rec.code = err.code;
        rec.hint = err.hint;
        rec.missing = err.missing;
        rec.phase = '失败';
        rec.progress = Math.min(rec.progress, 99);

        if (temp) {
          try { await removeWithRetry(temp); } catch (cleanup) {
            rec.hint = `${rec.hint || ''}\n临时目录清理失败：${temp}（${String(cleanup?.message || cleanup)}）`.trim();
          }
        }
        if (switched) {
          try {
            const failed = `${target}.failed-${Date.now()}`;
            if (await exists(target)) await renameWithRetry(target, failed);
            if (rec.backupDir) {
              await renameWithRetry(rec.backupDir, target);
              rec.backupDir = null;
            }
            rec.hint = `${rec.hint || ''}\n新包已验证失败，已回滚旧包。`.trim();
          } catch (rollback) {
            rec.code = IMPORT_CODES.ROLLBACK_FAILED;
            rec.error = '导入失败，且旧包回滚失败';
            rec.hint = `旧包备份在：${rec.backupDir || '（未知路径）'}。请先不要删除它，手动把备份改回 voice-${id === 'voice-local' ? 'local' : 'cloud'} 目录。原因：${String(rollback?.message || rollback)}`;
          }
        } else if (rec.backupDir) {
          try {
            await renameWithRetry(rec.backupDir, target);
            rec.backupDir = null;
          } catch (rollback) {
            rec.code = IMPORT_CODES.ROLLBACK_FAILED;
            rec.error = '导入失败，且旧包回滚失败';
            rec.hint = `旧包备份在：${rec.backupDir}。请手动恢复，不要删除。原因：${String(rollback?.message || rollback)}`;
          }
        }
      }
    })();

    return { ok: true, import: importSnapshot(rec) };
  }

  function cancelImport(id) {
    const rec = activeImports.get(id);
    if (!rec || rec.phase === '完成' || rec.phase === '失败') {
      return { ok: false, error: '没有进行中的导入', code: 'IMPORT_NOT_RUNNING' };
    }
    rec.cancelled = true;
    rec.phase = '取消中';
    return { ok: true };
  }

  async function deleteImportSource(id, sourceDir) {
    const state = await readState(cfg);
    const recorded = state.packs?.[id]?.importSource || '';
    const target = importTarget(id);
    const source = path.resolve(String(sourceDir || ''));
    if (!recorded || path.resolve(recorded) !== source) {
      throw new ImportError(IMPORT_CODES.SOURCE_DELETE_REFUSED, '这个目录不是本次导入的源目录，已拒绝删除', {
        hint: '只允许删除刚刚导入时使用的原始文件夹；其他目录请手动处理。',
        status: 409,
      });
    }
    if (source === path.resolve(target) || target.startsWith(source + path.sep)) {
      throw new ImportError(IMPORT_CODES.SOURCE_DELETE_REFUSED, '源目录就是安装目录，不能删除', {
        hint: '源目录与标准安装目录相同，不需要删除。',
        status: 409,
      });
    }
    if (!(await exists(target))) {
      throw new ImportError(IMPORT_CODES.SOURCE_DELETE_REFUSED, '标准安装目录不存在，已拒绝删除源目录', {
        hint: '先确认导入成功；旧包/新包异常时不要删除源文件。',
        status: 409,
      });
    }
    const freedBytes = await dirSize(source).catch(() => 0);
    try {
      await fsp.rm(source, { recursive: true, force: true });
    } catch (e) {
      throw new ImportError(IMPORT_CODES.SOURCE_DELETE_REFUSED, '删除源文件夹失败', {
        hint: `关闭占用该文件夹的程序后重试；残留位置：${source}`,
        status: 409,
        detail: { path: source, reason: String(e?.message || e) },
      });
    }
    delete state.packs[id].importSource;
    await writeState(cfg, state);
    return { ok: true, freedBytes };
  }

  async function deleteImportBackup(id, backupDir) {
    const state = await readState(cfg);
    const recorded = state.packs?.[id]?.backupDir || '';
    const target = importTarget(id);
    const backup = path.resolve(String(backupDir || ''));
    if (!recorded || path.resolve(recorded) !== backup) {
      throw new ImportError(IMPORT_CODES.BACKUP_DELETE_REFUSED, '这个路径不是本次导入的旧包备份，已拒绝删除', {
        hint: '只允许删除导入时记录的备份目录。',
        status: 409,
      });
    }
    if (backup === path.resolve(target)) {
      throw new ImportError(IMPORT_CODES.BACKUP_DELETE_REFUSED, '备份路径等于当前安装目录，已拒绝删除', { status: 409 });
    }
    try {
      await fsp.rm(backup, { recursive: true, force: true });
    } catch (e) {
      throw new ImportError(IMPORT_CODES.BACKUP_DELETE_REFUSED, '删除旧包备份失败', {
        hint: `关闭占用该目录的程序后重试；残留位置：${backup}`,
        status: 409,
        detail: { path: backup, reason: String(e?.message || e) },
      });
    }
    delete state.packs[id].backupDir;
    await writeState(cfg, state);
    return { ok: true };
  }


  async function statusOne(m) {
    const dir = packDir(cfg, m.id);
    const hasFiles = await exists(path.join(dir, 'config.toml'));
    const portUp = await probePort(m.port);
    const engineUp = m.enginePort ? await probePort(m.enginePort) : null;
    // 「外部安装」两种：① 文件在别的目录（旧默认目录/cwd，2026-10-28 用户反馈）；② 只有端口在跑。
    const external = hasFiles ? isExternalDir(cfg, m.id, dir) : portUp;
    const installed = hasFiles || portUp;
    const running = portUp;
    return {
      id: m.id,
      name: m.name,
      version: m.version,
      sizeBytes: m.sizeBytes,
      port: m.port,
      enginePort: m.enginePort ?? null,
      engineUp,
      requires: m.requires,
      voices: m.voices,
      about: m.about,
      installed,
      running,
      external,
      dir: hasFiles ? dir : null,
      install: (() => {
        const rec = activeInstalls.get(m.id);
        if (!rec) return null;
        const { child, ...rest } = rec;
        return { ...rest, logTail: String(rec.log || '').slice(-160) };
      })(),
      import: importSnapshot(activeImports.get(m.id)),
    };
  }

  async function list() {
    const state = await readState(cfg);
    const packs = await Promise.all(manifests(cfg).map(statusOne));
    // 云端包装好但凭据没填全：给设置页一个明确信号（新装不再预置任何凭据，见 PITFALLS #79）。
    const withNeeds = await Promise.all(packs.map(async (p) => {
      if (p.id !== 'voice-cloud' || !p.installed) return p;
      const c = await readCloudConfig(p.id).catch(() => null);
      return { ...p, needsCloudConfig: !c || !c.configured };
    }));
    return {
      ok: true,
      packsDir: packsDir(cfg),
      packs: withNeeds.map((p) => ({
        ...p,
        enabled: state.packs?.[p.id]?.enabled ?? false,
        installedAt: state.packs?.[p.id]?.installedAt ?? null,
        importSource: state.packs?.[p.id]?.importSource ?? null,
        backupDir: state.packs?.[p.id]?.backupDir ?? null,
        importedAt: state.packs?.[p.id]?.importedAt ?? null,
        verified: state.packs?.[p.id]?.verified ?? null,
      })),
    };
  }

  /** 重装时保留这些（模型/环境/配置）：否则断点续传的 .part 也会被一起删掉。 */
const PACK_KEEP = ['models', 'vendor', 'voices', 'voicepack', 'logs', 'cache', '.venv', '.venv-gsv', 'config.toml'];

/** 清掉代码，但把模型/环境/配置暂时挪出去再挪回来。 */
async function clearPackKeepingAssets(dir) {
  if (!(await exists(dir))) return;
  const keepDir = `${dir}.keep-${Date.now()}`;
  await fsp.mkdir(keepDir, { recursive: true });
  const moved = [];
  for (const name of PACK_KEEP) {
    const from = path.join(dir, name);
    if (!(await exists(from))) continue;
    try {
      await fsp.rename(from, path.join(keepDir, name));
      moved.push(name);
    } catch {}
  }
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
  for (const name of moved) {
    try {
      await fsp.rename(path.join(keepDir, name), path.join(dir, name));
    } catch {}
  }
  await fsp.rm(keepDir, { recursive: true, force: true });
}

async function install(id, { force = false, mirror = '', jobs = 0 } = {}) {
    const m = manifests(cfg).find((x) => x.id === id);
    if (!m) throw new Error(`未知语音包：${id}`);
    // 上一次已经结束（完成/失败）的安装记录要清掉，否则会永远卡在"正在安装中"，
    // 用户失败后连重试都点不了（2026-10-27 反馈）。
    if (activeInstalls.has(id)) {
      const prev = activeInstalls.get(id);
      if (prev && (prev.phase === '完成' || prev.phase === '失败')) activeInstalls.delete(id);
      else throw new Error('这个包正在安装中');
    }
    const dir = packDir(cfg, id);
    if (!force && (await exists(path.join(dir, 'config.toml')))) throw new Error('已经安装过了');

    const rec = { progress: 0, phase: '准备中', startedAt: Date.now(), error: null, log: '', lastOutputAt: Date.now(), child: null, cancelled: false };
    activeInstalls.set(id, rec);
    // 异步跑，接口立刻返回，前端轮询 status 看进度
    (async () => {
      try {
        // 装之前先看有没有用户自己的 config.toml：有就是重装（下面会原样保留），
        // 没有就是新装 → 凭据一律清空（见 stripCloudCredentials 的背景）。
        const hadOwnConfig = await exists(path.join(dir, 'config.toml'));
        // 保留 models/vendor/.venv/config.toml：断点续传的 .part 在这里，不能一起删。
        await clearPackKeepingAssets(dir);
        // 安装源：本地开发目录 / 本地 zip / http(s)。开发目录在用户机器上不存在，
        // 这时退到 GitHub 仓库的 archive zip（代码很小），模型由 postInstall 单独拉。
        let src = String(m.url || '');
        const localDir = /^https?:/i.test(src) ? null : path.resolve(src || '.');
        if (localDir && !(await exists(localDir))) {
          if (!m.repo) throw new Error(`安装源不存在：${src}（这个包没有配置在线安装地址）`);
          src = `https://codeload.github.com/${m.repo}/zip/refs/heads/main`;
          rec.phase = '改用在线源';
        }
        await fetchToLocal(cfg, id, src, dir, (p, phase) => {
          rec.progress = p;
          rec.phase = phase;
        }, { mirror });
        await flattenSingleDir(dir);
        // GitHub archive 解压出来可能带只读属性，后面复制 config / 拉模型会写不进去。
        try {
          await new Promise((resolve) => {
            const c = spawn('cmd', ['/c', `attrib -R "${dir}\*" /S /D`], { windowsHide: true, stdio: 'ignore' });
            c.on('exit', resolve); c.on('error', resolve);
          });
        } catch {}
        // 仓库里只有 config.example.toml（真实配置不入库）：装完先复制成 config.toml，
        // 否则 voxd 起不来、用户看到"包里没有 config.toml"。
        // 新装还会清空预置凭据——打包者可能把自己的火山 key 留在了包里，
        // 不能让用户拿我们的额度计费（PITFALLS #79）。
        const conf = await ensurePackConfig(dir, { hadOwnConfig });
        if (conf.created) rec.phase = '生成配置';
        if (conf.sanitized) rec.phase = '清空预置凭据（需自己填密钥）';
        // 后置步骤：先拉模型/运行库（sha256 校验），再建 Python 环境（首次要几分钟）。
        const postScripts = (Array.isArray(m.postInstall) ? m.postInstall : (m.postInstall ? [m.postInstall] : []))
          .filter((x) => x);
        for (const script of postScripts) {
          if (!(await exists(path.join(dir, script)))) {
            throw new Error(`安装包里缺少 ${script}（可能下载到了不完整的版本），请重试或先删掉 ${dir} 再装`);
          }
          rec.phase = script.includes('bootstrap') ? '安装 Python 依赖（首次 5~40 分钟）' : '拉取模型（可能几分钟）';
          rec.transferPct = null;
          rec.progress = 90;
          const okPost = await new Promise((resolve) => {
            const env = { ...process.env };
            if (mirror) env.SURFCORE_GH_MIRROR = String(mirror);
            if (jobs) env.SURFCORE_DOWNLOAD_JOBS = String(jobs);
            const child = spawn(process.execPath, [path.join(dir, script)], {
              cwd: dir, windowsHide: true, env,
            });
            rec.child = child;
            let out = '';
            // 1.84GB 在国内 0.2~2MB/s 需要 30~150 分钟；45 分钟必然误杀。
            // 卡死由包内 4 分钟无进展看门狗负责，这里只防脚本永久不退。
            const capMs = Math.max(45 * 60_000, Number(m.postInstallTimeoutMs) || 3 * 60 * 60_000);
            const timer = setTimeout(() => { try { child.kill(); } catch {} resolve(false); }, capMs);
            const onChunk = (d) => {
              const text = String(d);
              out = (out + text).slice(-4000); rec.log = out;
              rec.lastOutputAt = Date.now();
              // [bootstrap] ... 行直接当阶段名：用户能看到"现在在装 voxd 依赖 / 装 GPT-SoVITS 依赖"
              const bi = text.lastIndexOf('[bootstrap]');
              if (bi >= 0) {
                const bootLine = text.slice(bi + 11).split(String.fromCharCode(10))[0].trim();
                if (bootLine) rec.phase = bootLine.slice(0, 60);
              }
              const m2 = /(\d{1,3})\s*%/.exec(text);
              if (m2) {
                const pct = Math.min(100, Math.max(0, Number(m2[1])));
                rec.transferPct = pct;
                rec.progress = Math.min(99, Math.round(90 + pct * 0.09));
                rec.phase = script.includes('bootstrap') ? '安装依赖' : '拉取模型';
              }
            };
            child.stdout?.on('data', onChunk);
            child.stderr?.on('data', onChunk);
            child.on('error', () => { clearTimeout(timer); resolve(false); });
            child.on('exit', (code) => { clearTimeout(timer); resolve(code === 0); });
          });
          if (!okPost) throw new Error(`${script} 失败（可能网络中断/太慢）：${(rec.log || '').slice(-600) || '看包内日志'}`);
        }
        // 完整性校验：只有代码、模型没下完的"假安装"必须报错，不能显示完成。
        const missing = [];
        for (const rel of (Array.isArray(m.verifyDirs) ? m.verifyDirs : [])) {
          const abs2 = path.join(dir, rel);
          let okDir = false;
          try {
            const st2 = await fsp.stat(abs2);
            okDir = st2.isDirectory() ? (await fsp.readdir(abs2)).length > 0 : st2.size > 0;
          } catch { okDir = false; }
          if (!okDir) missing.push(rel);
        }
        if (missing.length) {
          throw new Error(`下载不完整：缺 ${missing.join('、')}（多半是模型下载中断）。点「安装」重试，或先删掉 ${dir} 再装；网络慢可以换时段再试`);
        }
        const state = await readState(cfg);
        state.packs = state.packs || {};
        state.packs[id] = { enabled: true, installedAt: new Date().toISOString(), version: m.version };
        await writeState(cfg, state);
        // 记录安装版本 + 远端提交，供「检查更新」做提交级比对（语音包没有 package.json）。
        try {
          let sha = '';
          if (m.repo) {
            const r = await fetch(`https://api.github.com/repos/${m.repo}/commits/main`, {
              headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'surfcore-voice' },
              signal: AbortSignal.timeout(8000),
            });
            if (r.ok) sha = String((await r.json())?.sha ?? '');
          }
          await fsp.writeFile(path.join(dir, '.installed-meta.json'),
            `${JSON.stringify({ version: m.version || '', sha, at: new Date().toISOString() }, null, 2)}
`, 'utf8');
        } catch {}
        rec.phase = '完成';
        rec.progress = 100;
        setTimeout(() => activeInstalls.delete(id), 5000).unref?.();
      } catch (e) {
        rec.error = String(e?.message || e);
        rec.phase = '失败';
        setTimeout(() => activeInstalls.delete(id), 10 * 60_000).unref?.();
      }
    })();

    return { ok: true, started: true };
  }

  async function remove(id) {
    const dir = packDir(cfg, id);
    await stop(id).catch(() => {});
    // 端口还在 → 说明有进程占着目录，直接删会 EBUSY；给用户明确提示而不是抛原始错误。
    const m = manifests(cfg).find((x) => x.id === id);
    if (m && await probePort(m.port)) {
      return { ok: false, error: '还有进程占着这个包（端口仍在监听）：先点「停止」，或重启 DSH 后再卸载' };
    }
    try {
      await fsp.rm(dir, { recursive: true, force: true });
    } catch (error) {
      const msg = String(error?.message ?? error);
      if (/EBUSY|EPERM|resource busy/i.test(msg)) {
        return { ok: false, error: '目录被占用（EBUSY）：可能有手动启动的 python/voxd 在跑，结束它再卸载' };
      }
      return { ok: false, error: msg };
    }
    const state = await readState(cfg);
    if (state.packs?.[id]) {
      delete state.packs[id];
      await writeState(cfg, state);
    }
    return { ok: true };
  }

  async function start(id) {
    const m = manifests(cfg).find((x) => x.id === id);
    if (!m) throw new Error(`未知语音包：${id}`);
    const dir = packDir(cfg, id);
    if (!(await exists(path.join(dir, 'config.toml')))) throw new Error('还没安装');
    // 云端包：没填凭据就别启动——voxd 会起来，但每次合成都 401/403，
    // 用户只会看到"启动成功、一说话就失败"。给一句能直接照做的提示。
    if (id === 'voice-cloud') {
      const conf = await readCloudConfig(id).catch(() => null);
      if (!conf || !conf.configured) {
        throw new Error('云端包还没填密钥：先在设置页「云端包：密钥与音色」填 AppID / Access Key / 音色 ID，再启动');
      }
    }
    // Python 环境缺失时直接给可操作的提示，别让用户看着"启动超时"猜。
    if (process.platform === 'win32' && !(await exists(path.join(dir, '.venv', 'Scripts', 'python.exe')))) {
      throw new Error('Python 环境还没装好：先点「卸载」再点「安装」重新装一次（会自动创建 .venv 并装依赖）');
    }
    if (await probePort(m.port)) return { ok: true, already: true, port: m.port };

    // 本地音色：先把 GPT-SoVITS(9880) 拉起来，否则入口起来了也只能 503。
    let engineStarted = false;
    if (m.engineScript && m.enginePort) {
      const engineUp = await probePort(m.enginePort);
      if (!engineUp) {
        const engineScript = path.join(dir, m.engineScript);
        if (await exists(engineScript)) {
          const engineChild = spawn('cmd', ['/c', engineScript], { cwd: dir, detached: false, stdio: 'ignore', windowsHide: true });
          engineChild.unref();
          engineStarted = true;
        }
      }
    }

    const direct = m.directStart && typeof m.directStart === 'object' ? m.directStart : null;
    const script = path.join(dir, m.startScript || 'run.bat');
    if (!direct && !(await exists(script))) throw new Error(`包内缺少启动脚本：${m.startScript}`);
    const logFile = path.join(dir, 'logs', 'startup.log');
    try { fs.mkdirSync(path.dirname(logFile), { recursive: true }); fs.writeFileSync(logFile, ''); } catch {}
    // 云端包直接拉 python，不经过 run.bat 的 start；否则 Python 的 stderr 不在桥接管道里，
    // 只能看到 cmd 的一小段输出，超时后永远不知道真正原因。
    let child;
    if (direct) {
      let python = path.join(dir, String(direct.python || '.venv/Scripts/python.exe'));
      // Windows 的 python.exe 会创建控制台窗口（即使父进程 windowsHide）；
      // venv 一般同时带 pythonw.exe，用它启动语音服务，彻底不弹黑框。
      if (process.platform === 'win32') {
        const pythonw = path.join(path.dirname(python), 'pythonw.exe');
        if (fs.existsSync(pythonw)) python = pythonw;
      }
      const args = Array.isArray(direct.args) ? direct.args.map(String) : ['-m', 'voxd', '--config', 'config.toml'];
      child = spawn(python, args, {
        cwd: dir,
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
    } else {
      child = spawn('cmd', ['/c', script], {
        cwd: dir,
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
    }
    const chunks = [];
    let chunkBytes = 0;
    let exitCode = null;
    const collect = (d) => {
      const b = Buffer.isBuffer(d) ? d : Buffer.from(String(d));
      if (chunkBytes >= 8000) return;
      const add = b.subarray(0, Math.max(0, 8000 - chunkBytes));
      chunks.push(add);
      chunkBytes += add.length;
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.on('error', (error) => { exitCode = -1; collect(Buffer.from(`spawn error: ${error?.message ?? error}\n`)); });
    child.on('exit', (code) => { exitCode = code; });
    child.unref();

    // 最多等 60 秒（本地包要加载模型）；云端直连通常 1~3 秒。
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await probePort(m.port)) {
        const engineUp = m.enginePort ? await probePort(m.enginePort) : null;
        return {
          ok: true, port: m.port, seconds: i + 1,
          ...(m.enginePort ? { enginePort: m.enginePort, engineUp, engineStarted } : {}),
          ...(m.enginePort && !engineUp ? { warning: m.engineWarmupHint } : {}),
        };
      }
      // 进程已经退出且端口没起来：没必要再傻等，马上把真实报错带回去。
      if (exitCode !== null) break;
    }
    // 超时/早退：把这次拉起的进程树杀掉（cmd + python 子进程），别留占端口的僵尸。
    try {
      if (child.pid) {
        await new Promise((resolve) => {
          const k = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          k.on('exit', resolve); k.on('error', resolve);
        });
      }
    } catch {}
    const logText = decodeProcessLog(Buffer.concat(chunks)).trim();
    const logTail = logText.slice(-1200);
    try { fs.writeFileSync(logFile, `${logText}\n`, 'utf8'); } catch {}
    const timedOut = exitCode === null;
    return {
      ok: false,
      port: m.port,
      code: timedOut ? 'VOICE_START_TIMEOUT' : 'VOICE_START_EXITED',
      error: `${timedOut ? '启动超时（60 秒内端口没起来）' : `启动失败（进程已退出，exit ${exitCode}）`}`
        + `${logTail ? `；脚本输出：${logTail}` : ''}；完整日志：${logFile}`,
      hint: timedOut
        ? '看完整日志里的最后一行；常见原因是端口被占用、.venv 依赖缺失或模型路径不对'
        : '进程已经退出：看完整日志里的 Python traceback，按第一行错误修复；端口被占用时先停止旧进程',
      logFile,
      logTail,
    };
  }

  /** 取消正在进行的安装：杀子进程树，标记失败。 */
  async function cancelInstall(id) {
    const rec = activeInstalls.get(id);
    if (!rec) return { ok: false, error: '这个包没有正在进行的安装' };
    rec.cancelled = true;
    try {
      if (rec.child?.pid) {
        await new Promise((resolve) => {
          const k = spawn('taskkill', ['/PID', String(rec.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          k.on('exit', resolve); k.on('error', resolve);
        });
      }
    } catch {}
    rec.phase = '失败';
    rec.error = '已取消安装（可以重新点安装；已下载的模型/分卷会保留）';
    setTimeout(() => activeInstalls.delete(id), 10 * 60_000).unref?.();
    return { ok: true };
  }

  /** 清理未完成的下载（.part / .pNN / models/.download），返回释放的字节数。 */
  async function cleanPartial(id) {
    const m = manifests(cfg).find((x) => x.id === id);
    if (!m) throw new Error(`未知语音包：${id}`);
    const dir = packDir(cfg, id);
    let freed = 0;
    const rm = async (target) => {
      try {
        const st = await fsp.stat(target);
        const size = st.isDirectory() ? 0 : st.size;
        await fsp.rm(target, { recursive: true, force: true });
        freed += size;
      } catch {}
    };
    await rm(path.join(dir, 'models', '.download'));
    // 残留分卷：xxx.part、xxx.p01、xxx.p02…
    try {
      for (const name of await fsp.readdir(dir, { recursive: true })) {
        const base = path.basename(String(name));
        if (/\.part$|\.[pP]\d{1,3}$/.test(base)) await rm(path.join(dir, String(name)));
      }
    } catch {}
    return { ok: true, freedBytes: freed };
  }

  async function stop(id) {
    const m = manifests(cfg).find((x) => x.id === id);
    if (!m) throw new Error(`未知语音包：${id}`);
    const dir = packDir(cfg, id);
    const script = path.join(dir, m.stopScript || 'stop.bat');
    if (await exists(script)) {
      await new Promise((resolve) => {
        const p = spawn('cmd', ['/c', script], { cwd: dir, stdio: 'ignore', windowsHide: true });
        p.on('exit', resolve);
        p.on('error', resolve);
      });
    }
    for (let i = 0; i < 10; i++) {
      if (!(await probePort(m.port))) return { ok: true };
      await new Promise((r) => setTimeout(r, 500));
    }
    // 兜底：脚本没杀掉（老版 stop.bat 依赖 Get-NetTCPConnection 单对象假设，常失效）
    // 就直接按端口找 PID 强杀。只杀监听这个端口的进程，不碰别的。
    try {
      const killed = await killListeners(m.port);
      if (killed) {
        for (let i = 0; i < 6; i++) {
          if (!(await probePort(m.port))) return { ok: true, killedByFallback: true };
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    } catch {}
    return { ok: false, error: '端口还在监听：可能有别的程序占着，或语音包里的进程需要管理员权限才能结束' };
  }

  /** 写云端密钥：只改 config.toml 里那三行，其余原样保留。 */
  async function cloudConfig(id, body) {
    const dir = packDir(cfg, id);
    const file = path.join(dir, 'config.toml');
    if (!(await exists(file))) throw new Error('还没安装');
    let text = await fsp.readFile(file, 'utf8');
    const set = (key, value) => {
      const re = new RegExp(`^${key}\\s*=.*$`, 'm');
      const line = `${key} = "${String(value).replace(/"/g, '\\"')}"`;
      text = re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
    };
    if (body.appId) set('cloud_app_id', body.appId);
    if (body.accessKey) set('cloud_access_key', body.accessKey);
    if (body.resource) set('cloud_resource', body.resource);
    await fsp.writeFile(file, text, 'utf8');
    if (body.speaker) {
      const vdir = path.join(dir, 'voices');
      const voiceMeta = (manifests(cfg).find((m) => m.id === id)?.voices ?? [])[0] ?? {};
      // 2026-11-08：以前这里在 voices/ 不存在或没有 age12* 目录时**静默跳过**，而读侧
      // readCloudConfig() 又要求 speaker 才 configured:true —— 用户把三项填全、点保存、
      // 回显也成功，启动却仍报"云端包还没填密钥"。全新安装没有 voices/ 很正常：
      // 语音仓库把 voices/ 写进了 .gitignore，GitHub 归档里根本没有这个目录。
      // 现在按清单里的音色 id 补建最小 voice.json（voxd 以目录名为音色 id，只读里面的 speaker）。
      // 取舍：相比"显式报错"，自动补建不会把用户卡死（报错只会让"手建目录"成为唯一出路）；
      // 代价是这个函数会写包目录——它本来就在写 config.toml，语义一致。
      const first = (await fsp.readdir(vdir).catch(() => [])).find((x) => x.startsWith('age12')) || voiceMeta.id || 'age12-cloud';
      const vf = path.join(vdir, first, 'voice.json');
      const v = JSON.parse((await fsp.readFile(vf, 'utf8').catch(() => '{}')).replace(/^\uFEFF/, ''));
      v.id = v.id ?? first;
      v.label = v.label ?? voiceMeta.label ?? first;
      v.speaker = String(body.speaker);
      await fsp.mkdir(path.dirname(vf), { recursive: true });
      await fsp.writeFile(vf, JSON.stringify(v, null, 2) + '\n', 'utf8');
    }
    return { ok: true, file };
  }


  /** 启动其中一个并切换过去：另一个自动停掉，避免"两个都在跑却不知道用哪个"。 */
  async function activate(id) {
    const m = manifests(cfg).find((x) => x.id === id);
    if (!m) throw new Error(`未知语音包：${id}`);
    for (const other of manifests(cfg)) {
      if (other.id === id) continue;
      if (await probePort(other.port)) await stop(other.id).catch(() => {});
    }
    if (!(await probePort(m.port))) {
      const r = await start(id);
      if (r.ok === false) return r;
    }
    // 顺手把路由切过去（写 config.json，宿主热读）
    try {
      const cfgPath = path.join(process.cwd(), 'config.json');
      const disk = JSON.parse(await fsp.readFile(cfgPath, 'utf8'));
      disk.socialV2 = disk.socialV2 || {};
      disk.socialV2.voice = disk.socialV2.voice || {};
      disk.socialV2.voice.tts = disk.socialV2.voice.tts || {};
      disk.socialV2.voice.tts.route = id === 'voice-cloud' ? 'cloud' : 'local';
      // 只要切路由，不能顺手把开关关掉（曾经因此出现“语音合成还没开启”）
      disk.socialV2.voice.tts.enabled = true;
      await fsp.writeFile(cfgPath, JSON.stringify(disk, null, 2) + '\n', 'utf8');
    } catch {}
    return { ok: true, route: id === 'voice-cloud' ? 'cloud' : 'local', port: m.port };
  }

  /** 启用/停用（不影响安装状态，只影响宿主是否把它当作可用语音源）。 */
  async function setEnabled(id, enabled) {
    const m = manifests(cfg).find((x) => x.id === id);
    if (!m) throw new Error(`未知语音包：${id}`);
    const state = await readState(cfg);
    state.packs = state.packs || {};
    state.packs[id] = { ...(state.packs[id] || {}), enabled: !!enabled };
    await writeState(cfg, state);
    return { ok: true, enabled: !!enabled };
  }


  /** 读云端配置：AppID / AccessKey（打码）/ 音色 ID，给设置页回显。 */
  async function readCloudConfig(id) {
    const dir = packDir(cfg, id);
    const file = path.join(dir, 'config.toml');
    const text = (await fsp.readFile(file, 'utf8').catch(() => ''));
    const pick = (k) => (text.match(new RegExp('^' + k + '\\s*=\\s*"([^"]*)"', 'm')) || [])[1] || '';
    const appId = pick('cloud_app_id');
    const accessKey = pick('cloud_access_key');
    let speaker = '';
    try {
      const vdir = path.join(dir, 'voices');
      const first = (await fsp.readdir(vdir)).find((x) => x.startsWith('age12'));
      if (first) {
        // 容忍用户手工创建的 voice.json 带 UTF-8 BOM（PowerShell 5.1/7 的
        // `Set-Content -Encoding utf8` 都会写 BOM，`JSON.parse` 会直接抛错并被外层 catch 吞掉）。
        const v = JSON.parse((await fsp.readFile(path.join(vdir, first, 'voice.json'), 'utf8')).replace(/^\uFEFF/, ''));
        speaker = String(v.speaker || '');
      }
    } catch {}
    return {
      ok: true,
      appId,
      hasAccessKey: !!accessKey,
      accessKeyMasked: accessKey ? accessKey.slice(0, 4) + '****' + accessKey.slice(-4) : '',
      speaker,
      configured: !!appId && !!accessKey && !!speaker,
    };
  }


  /** 云端用量：读包内 logs/requests.jsonl，汇总今天/本月字符数，按用户填的单价估算费用。 */
  async function cloudStats(id, opts = {}) {
    const dir = packDir(cfg, id);
    const file = path.join(dir, 'logs', 'requests.jsonl');
    const text = await fsp.readFile(file, 'utf8').catch(() => '');
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const dayKey = `${monthKey}-${String(now.getDate()).padStart(2, '0')}`;
    let todayChars = 0;
    let monthChars = 0;
    let totalChars = 0;
    let todayCalls = 0;
    let monthCalls = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      const chars = Number(row.chars) || 0;
      const t = String(row.t || '');
      totalChars += chars;
      if (t.startsWith(dayKey)) { todayChars += chars; todayCalls += 1; }
      if (t.startsWith(monthKey)) { monthChars += chars; monthCalls += 1; }
    }
    const conf = (await readCloudConfig(id).catch(() => ({}))) || {};
    let cloudCfg = cfg?.socialV2?.voice?.cloud ?? {};
    // 面板刚保存的单价/额度在 config.json 里，内存 cfg 不会热更新，这里直接读盘
    try {
      const disk = JSON.parse(await fsp.readFile(path.join(process.cwd(), 'config.json'), 'utf8'));
      cloudCfg = disk?.socialV2?.voice?.cloud ?? cloudCfg;
    } catch {}
    const pricePerKChar = Number(opts.pricePerKChar ?? cloudCfg.pricePerKChar ?? 0) || 0;
    const monthlyQuota = Number(opts.monthlyQuota ?? cloudCfg.monthlyQuota ?? 0) || 0;
    const model = (await fsp.readFile(path.join(dir, 'config.toml'), 'utf8').catch(() => '')
      .then((t) => (t.match(/^cloud_resource\s*=\s*"([^"]*)"/m) || [])[1] || '')) || '';
    return {
      ok: true,
      model: model === 'seed-icl-2.0' ? '豆包声音复刻 2.0（字符版）' : (model || '未配置'),
      resource: model,
      speaker: conf.speaker || '',
      todayChars, monthChars, totalChars, todayCalls, monthCalls,
      pricePerKChar,
      monthlyQuota,
      monthCost: pricePerKChar ? +(monthChars / 1000 * pricePerKChar).toFixed(2) : null,
      remainChars: monthlyQuota ? Math.max(0, monthlyQuota - monthChars) : null,
      updatedAt: new Date().toISOString(),
    };
  }

  /** 包里预置的"参考音频"（用户拿去喂声音复刻模型，省得自己录）。 */
  async function sampleFile(id) {
    const dir = packDir(cfg, id);
    const vp = path.join(dir, 'voicepack');
    const files = (await fsp.readdir(vp).catch(() => [])).filter((f) => /\.(wav|mp3|m4a)$/i.test(f));
    if (!files.length) throw new Error('这个包没有预置参考音频');
    const file = path.join(vp, files[0]);
    return { file, name: files[0], buffer: await fsp.readFile(file) };
  }

  /** 试听：走包自己的 /v1/speak/file，返回耗时和音频大小。 */
  async function test(id, { text = '你好呀，语音包已经装好了。' } = {}) {
    const m = manifests(cfg).find((x) => x.id === id);
    if (!m) throw new Error(`未知语音包：${id}`);
    if (!(await probePort(m.port))) throw new Error('服务没在运行，先点「启动」');
    const t0 = Date.now();
    const res = await fetch(`http://127.0.0.1:${m.port}/v1/speak/file`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`合成失败：HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    // 用真实 WAV 头算时长：以前 bytes/2/24000 是按 16bit/24k 猜的，遇到 22050/32bit 就报 0 或错值。
    let seconds = 0;
    try { seconds = +(wavDurationMs(buf) / 1000).toFixed(2); } catch { seconds = +(buf.length / 2 / 24000).toFixed(2); }
    return { ok: true, ms: Date.now() - t0, bytes: buf.length, seconds, duration: seconds };
  }

  return { list, install, remove, start, stop, activate, cleanPartial, cancelInstall, cloudConfig, readCloudConfig, cloudStats, test, sampleFile, setEnabled, manifests, packsDir, inspectImport, startImport, cancelImport, deleteImportSource, deleteImportBackup };
}
