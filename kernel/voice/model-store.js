/**
 * 语音模型工件存储（内核 voice）
 * ============================================================================
 * 只做：读 manifest、算哈希、校验、解压/复制到模型目录。
 * 不执行扩展包代码，不启动进程。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { normalizeModelManifest, verifyModelFiles } from './artifact.js';

const MANIFESTS = ['model.json', 'voice-model.json'];
const TAR_BIN = process.platform === 'win32' ? 'C:\\Windows\\System32\\tar.exe' : 'tar';
const PS_BIN = process.platform === 'win32' ? 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' : 'powershell';

export function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function manifestIn(root) {
  return MANIFESTS.map((n) => path.join(root, n)).find((p) => fs.existsSync(p)) ?? null;
}

function findRoot(root) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return null;
  if (manifestIn(root)) return root;
  for (const name of fs.readdirSync(root)) {
    const child = path.join(root, name);
    try {
      if (fs.statSync(child).isDirectory() && manifestIn(child)) return child;
    } catch { /* 跳过 */ }
  }
  return null;
}

function extractZip(zip, { tmpRoot } = {}) {
  const root = tmpRoot || process.env.SURFCORE_VOICE_TMP || os.tmpdir();
  fs.mkdirSync(root, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(root, 'sc-voice-model-'));
  let r = spawnSync(TAR_BIN, ['-xf', zip, '-C', tmp], { stdio: 'ignore', windowsHide: true, timeout: 600000 });
  if (r.status !== 0) {
    // Windows tar 对 >4GB zip 会失败；用 PowerShell 的 ZipFile 兜底。
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    const q = (s) => String(s).replace(/'/g, "''");
    r = spawnSync(PS_BIN, ['-NoProfile', '-Command',
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${q(zip)}','${q(tmp)}')`],
    { stdio: 'ignore', windowsHide: true, timeout: 600000 });
  }
  if (r.status !== 0) {
    fs.rmSync(tmp, { recursive: true, force: true });
    return { ok: false, code: 'voice-model.unzip-failed', error: 'zip 解压失败（tar/PowerShell 都失败）' };
  }
  return { ok: true, dir: tmp };
}

function formatBytes(n) {
  const v = Number(n) || 0;
  if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(1)}GB`;
  if (v >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(1)}MB`;
  return `${Math.round(v / 1024)}KB`;
}

/** 从 ZIP 中央目录读未压缩大小；读不到返回 0（调用方用压缩大小估算）。 */
function zipUncompressedSize(file) {
  const size = fs.statSync(file).size;
  if (size < 22) return 0;
  const fd = fs.openSync(file, 'r');
  try {
    const tailLen = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return 0;
    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    // ZIP64：EOCD 字段溢出时读 ZIP64 EOCD。
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      if (eocd >= 20 && tail.readUInt32LE(eocd - 20) === 0x07064b50) {
        const z64Off = Number(tail.readBigUInt64LE(eocd - 20 + 8));
        const z64 = Buffer.alloc(56);
        fs.readSync(fd, z64, 0, 56, z64Off);
        if (z64.readUInt32LE(0) === 0x06064b50) {
          count = Number(z64.readBigUInt64LE(32));
          cdSize = Number(z64.readBigUInt64LE(40));
          cdOffset = Number(z64.readBigUInt64LE(48));
        }
      }
    }
    if (!count || cdSize === 0xffffffff || cdOffset === 0xffffffff || cdSize > 64 * 1024 * 1024) return 0;
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOffset);
    let off = 0;
    let total = 0;
    for (let i = 0; i < count; i += 1) {
      if (off + 46 > cd.length || cd.readUInt32LE(off) !== 0x02014b50) return 0;
      let uncompressed = cd.readUInt32LE(off + 24);
      const nameLen = cd.readUInt16LE(off + 28);
      const extraLen = cd.readUInt16LE(off + 30);
      const commentLen = cd.readUInt16LE(off + 32);
      if (uncompressed === 0xffffffff) {
        let e = off + 46 + nameLen;
        const end = e + extraLen;
        let found = false;
        while (e + 4 <= end) {
          const id = cd.readUInt16LE(e);
          const size = cd.readUInt16LE(e + 2);
          if (id === 0x0001 && e + 4 + 8 <= end) {
            uncompressed = Number(cd.readBigUInt64LE(e + 4));
            found = true;
            break;
          }
          e += 4 + size;
        }
        if (!found) return 0;
      }
      total += uncompressed;
      off += 46 + nameLen + extraLen + commentLen;
    }
    return total;
  } catch { return 0; }
  finally { try { fs.closeSync(fd); } catch {} }
}

function freeBytesAt(dir) {
  let p = path.resolve(dir);
  while (p && !fs.existsSync(p)) {
    const parent = path.dirname(p);
    if (parent === p) break;
    p = parent;
  }
  try {
    const st = fs.statfsSync(p);
    return Number(st.bavail) * Number(st.bsize);
  } catch { return 0; }
}

function defaultTmpRoot(target) {
  return path.join(path.dirname(path.resolve(target)), '.surfcore-voice-tmp');
}

function checkSpace({ zip, target, tmpRoot }) {
  const compressed = fs.statSync(zip).size;
  let uncompressed = zipUncompressedSize(zip);
  let estimated = false;
  if (!uncompressed) { uncompressed = Math.ceil(compressed * 1.6); estimated = true; }
  const need = Math.ceil(uncompressed * 2);
  const freeTemp = freeBytesAt(tmpRoot);
  const freeTarget = freeBytesAt(target);
  const sameRoot = path.parse(path.resolve(tmpRoot)).root.toLowerCase() === path.parse(path.resolve(target)).root.toLowerCase();
  const current = sameRoot ? freeTemp : Math.min(freeTemp || Infinity, freeTarget || Infinity);
  if (current && current < need) {
    return {
      ok: false,
      code: 'voice-model.tmp-space',
      error: `临时空间不足：需要 ${formatBytes(need)}，当前 ${formatBytes(current)}`,
      hint: '把安装目录换到空间足够的磁盘',
      needBytes: need,
      freeBytes: current,
      estimated,
    };
  }
  return { ok: true, need, free: current, estimated };
}

function inspectDir(root, { requireRuntime = true } = {}) {
  const base = path.resolve(String(root ?? ''));
  const found = findRoot(base);
  if (!found) return { ok: false, code: 'voice-model.manifest-missing', error: '模型工件缺少 manifest' };
  const manifestFile = manifestIn(found);
  const raw = readJson(manifestFile);
  if (!raw) return { ok: false, code: 'voice-model.manifest-bad', error: '模型 manifest 不是合法 JSON' };
  const normalized = normalizeModelManifest(raw);
  if (!normalized.ok) return { ok: false, ...normalized.error };
  const observed = {};
  for (const file of normalized.value.files) {
    const abs = path.join(found, file.path);
    if (!fs.existsSync(abs)) continue;
    observed[file.path] = { sha256: sha256File(abs) };
  }
  const verified = verifyModelFiles(normalized.value, observed);
  if (!verified.ok) return { ok: false, code: 'voice-model.verify-failed', error: '模型文件与 manifest 不一致', detail: verified };
  if (!normalized.value.runtime?.endpoint && !normalized.value.runtime?.command) {
    if (requireRuntime) return { ok: false, code: 'voice-model.runtime-required', error: '导入失败：模型 manifest 必须声明 runtime.endpoint 或 runtime.command' };
  }
  if (normalized.value.runtime?.kind === 'process') {
    const required = normalized.value.runtime.entry || normalized.value.runtime.command;
    if (normalized.value.runtime.inferred !== true && !normalized.value.files.some((f) => f.path === required)) {
      return { ok: false, code: 'voice-model.command-unhashed', error: 'runtime entry/command 必须在 manifest 的 weights 里声明并带 SHA256' };
    }
    if (!fs.existsSync(path.join(found, required))) return { ok: false, code: 'voice-model.command-missing', error: 'runtime entry/command 不在模型工件里' };
    if (normalized.value.runtime.inferred === true && normalized.value.runtime.commandSha256) {
      const actual = sha256File(path.join(found, required));
      if (actual !== normalized.value.runtime.commandSha256) return { ok: false, code: 'voice-model.command-changed', error: 'runtime 启动文件在导入后发生变化' };
    }
    const pre = normalized.value.runtime.preStart;
    if (pre?.command) {
      if (!fs.existsSync(path.join(found, pre.command))) return { ok: false, code: 'voice-model.command-missing', error: 'runtime.preStart 不在模型工件里' };
      if (pre.commandSha256 && sha256File(path.join(found, pre.command)) !== pre.commandSha256) {
        return { ok: false, code: 'voice-model.command-changed', error: 'runtime.preStart 文件在导入后发生变化' };
      }
    }
  }
  return { ok: true, manifest: normalized.value, files: normalized.value.files, dir: found };
}

export function inspectModelArtifact(dir, opts = {}) {
  const raw = String(dir ?? '');
  if (/\.zip$/i.test(raw)) {
    const extracted = extractZip(path.resolve(raw));
    if (!extracted.ok) return extracted;
    try { return inspectDir(extracted.dir, opts); } finally { fs.rmSync(extracted.dir, { recursive: true, force: true }); }
  }
  return inspectDir(raw, opts);
}

export function importModelArtifact({ dir, target, force = false } = {}) {
  const source = String(dir ?? '');
  const dest = path.resolve(String(target ?? ''));
  if (!dest) return { ok: false, code: 'voice-model.no-target', error: '缺少目标目录' };
  if (fs.existsSync(dest) && fs.readdirSync(dest).length > 0 && !force) {
    return { ok: false, code: 'voice-model.target-exists', error: '目标目录已存在；确认覆盖再 force' };
  }
  if (!/\.zip$/i.test(source)) {
    const inspected = inspectDir(source);
    if (!inspected.ok) return inspected;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest) && force) fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(inspected.dir, dest, { recursive: true });
    return { ok: true, dir: dest, model: inspected.manifest.model, version: inspected.manifest.version, voiceId: inspected.manifest.voiceId, runtime: inspected.manifest.runtime };
  }

  // 默认可写临时目录放在 target 同盘；显式 SURFCORE_VOICE_TMP 仍优先。
  const tmpRoot = process.env.SURFCORE_VOICE_TMP || defaultTmpRoot(dest);
  const space = checkSpace({ zip: path.resolve(source), target: dest, tmpRoot });
  if (!space.ok) return space;
  let extracted = null;
  try {
    extracted = extractZip(path.resolve(source), { tmpRoot });
    if (!extracted.ok) return extracted;
    const inspected = inspectDir(extracted.dir);
    if (!inspected.ok) return inspected;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest) && force) fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(inspected.dir, dest, { recursive: true });
    return { ok: true, dir: dest, model: inspected.manifest.model, version: inspected.manifest.version, voiceId: inspected.manifest.voiceId, runtime: inspected.manifest.runtime, estimatedSize: space.estimated };
  } finally {
    if (extracted?.ok) fs.rmSync(extracted.dir, { recursive: true, force: true });
  }
}
