// Embedding 包（模型 / 运行时 / 云端）的纯逻辑：manifest 校验、文件校验、安装/卸载、列表。
// 权重不进 SurfCore；安装到 state/embedding-packs/，由插件/UI 管理。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const EMBEDDING_PACK_SCHEMA = 1;
export const EMBEDDING_PACK_KINDS = Object.freeze(['runtime', 'model', 'cloud']);

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const SHA_RE = /^[a-f0-9]{64}$/i;

export function normalizePackId(value) {
  const id = String(value ?? '').trim().toLowerCase();
  return ID_RE.test(id) ? id : '';
}

export function embeddingPacksRoot(stateDir) {
  return path.join(String(stateDir || ''), 'embedding-packs');
}

export function packDir(root, id) {
  const safe = normalizePackId(id);
  if (!safe) throw new Error(`非法 embedding pack id: ${id}`);
  return path.join(root, safe);
}

/** 只允许包内相对路径；拒绝绝对路径、..、空段、反斜杠逃逸。 */
export function safePackRelativePath(relative) {
  const raw = String(relative ?? '').replaceAll('\\', '/').trim();
  if (!raw || raw.startsWith('/') || raw.includes('\0')) return '';
  const parts = raw.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return '';
  return parts.join('/');
}

export function fileSha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * 校验 pack.json。返回 {ok, errors, manifest}；不读大文件。
 * expectedId 用于“目录名必须与 id 一致”。
 */
export function validatePackManifest(input, { expectedId = '' } = {}) {
  const errors = [];
  const fail = (code, message) => errors.push({ code, error: message });
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: [{ code: 'pack.manifest-invalid', error: 'pack.json 不是对象' }] };
  }
  const manifest = {
    schema: Number(input.schema) || 0,
    id: normalizePackId(input.id),
    kind: String(input.kind ?? '').trim(),
    name: String(input.name ?? '').trim(),
    version: String(input.version ?? '1.0.0').trim(),
    model: String(input.model ?? '').trim(),
    modelSpace: String(input.modelSpace ?? '').trim(),
    dimension: Number(input.dimension) || 0,
    license: String(input.license ?? '').trim(),
    sizeBytes: Number(input.sizeBytes) || 0,
    requires: Array.isArray(input.requires) ? input.requires.map(String) : [],
    files: Array.isArray(input.files) ? input.files : [],
    notes: String(input.notes ?? '').trim(),
    entry: String(input.entry ?? '').trim(),
    config: input.config && typeof input.config === 'object' ? input.config : {},
  };
  if (manifest.schema !== EMBEDDING_PACK_SCHEMA) fail('pack.schema-unsupported', `不支持的 pack schema：${manifest.schema}`);
  if (!manifest.id) fail('pack.id-invalid', 'pack id 只能是小写字母/数字/._-，最长 80');
  if (expectedId && manifest.id !== normalizePackId(expectedId)) fail('pack.id-mismatch', `目录 ${expectedId} 与 pack id ${manifest.id} 不一致`);
  if (!EMBEDDING_PACK_KINDS.includes(manifest.kind)) fail('pack.kind-invalid', `未知 kind：${manifest.kind}`);
  if (!manifest.name) fail('pack.name-missing', '缺少 name');
  if (manifest.kind === 'model') {
    if (!manifest.model) fail('pack.model-missing', 'model 包缺少 model');
    if (!manifest.modelSpace) fail('pack.space-missing', 'model 包缺少 modelSpace');
    if (!(manifest.dimension > 0 && manifest.dimension <= 65536)) fail('pack.dimension-invalid', 'dimension 必须在 1..65536');
    if (!manifest.files.length) fail('pack.files-missing', 'model 包没有 files');
  }
  if (manifest.kind === 'runtime' && !manifest.entry && !manifest.files.length) {
    fail('pack.runtime-entry-missing', 'runtime 包缺少 entry（run.bat / 可执行）或 files');
  }
  const seen = new Set();
  for (const file of manifest.files) {
    if (!file || typeof file !== 'object') { fail('pack.file-invalid', 'files 项不是对象'); continue; }
    const rel = safePackRelativePath(file.path);
    if (!rel) { fail('pack.file-path-invalid', `非法文件路径：${file.path}`); continue; }
    if (seen.has(rel)) { fail('pack.file-duplicate', `重复文件：${rel}`); continue; }
    seen.add(rel);
    const size = Number(file.size);
    if (!Number.isSafeInteger(size) || size < 0) fail('pack.file-size-invalid', `${rel} 的 size 非法`);
    if (!SHA_RE.test(String(file.sha256 ?? ''))) fail('pack.file-sha-invalid', `${rel} 的 sha256 非法`);
  }
  const total = manifest.files.reduce((sum, file) => sum + (Number(file?.size) || 0), 0);
  if (manifest.sizeBytes && total && manifest.sizeBytes !== total) {
    fail('pack.size-mismatch', `sizeBytes=${manifest.sizeBytes}，files 合计=${total}`);
  }
  if (!manifest.sizeBytes) manifest.sizeBytes = total;
  return { ok: errors.length === 0, errors, manifest };
}

export function readPackManifest(dir, { expectedId = '' } = {}) {
  const file = path.join(dir, 'pack.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return validatePackManifest(parsed, { expectedId });
  } catch (error) {
    return { ok: false, errors: [{ code: 'pack.manifest-invalid', error: `读不到 pack.json：${error?.message ?? error}` }] };
  }
}

/** 校验包内文件存在、大小与 SHA256。返回 missing/mismatch；不修改文件。 */
export async function verifyPackFiles(dir, manifest) {
  const missing = [];
  const mismatch = [];
  for (const file of manifest.files ?? []) {
    const rel = safePackRelativePath(file.path);
    if (!rel) { mismatch.push({ path: file.path, error: '非法路径' }); continue; }
    const target = path.join(dir, ...rel.split('/'));
    let stat;
    try { stat = fs.lstatSync(target); } catch { missing.push(rel); continue; }
    if (!stat.isFile() || stat.isSymbolicLink()) { mismatch.push({ path: rel, error: '不是普通文件' }); continue; }
    if (Number(file.size) >= 0 && stat.size !== Number(file.size)) {
      mismatch.push({ path: rel, error: `大小 ${stat.size} != ${file.size}` });
      continue;
    }
    const sha = await fileSha256(target);
    if (sha.toLowerCase() !== String(file.sha256).toLowerCase()) {
      mismatch.push({ path: rel, error: `sha256 ${sha.slice(0, 12)}… != ${String(file.sha256).slice(0, 12)}…` });
    }
  }
  return { ok: missing.length === 0 && mismatch.length === 0, missing, mismatch };
}

export function packSummary(dir, manifest) {
  return {
    id: manifest.id,
    kind: manifest.kind,
    name: manifest.name,
    version: manifest.version,
    model: manifest.model,
    modelSpace: manifest.modelSpace,
    dimension: manifest.dimension,
    license: manifest.license,
    sizeBytes: manifest.sizeBytes,
    notes: manifest.notes,
    files: manifest.files.map((file) => ({ path: file.path, size: file.size })),
    path: dir,
  };
}

/** 扫描安装根目录；坏包也列出来，状态里能显示原因，不静默跳过。 */
export function listEmbeddingPacks(root) {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = path.join(root, entry.name);
    if (!fs.existsSync(path.join(dir, 'pack.json'))) continue;
    const result = readPackManifest(dir, { expectedId: entry.name });
    if (!result.ok) {
      out.push({ id: entry.name, kind: 'invalid', valid: false, error: result.errors[0]?.error ?? 'pack.json 无效', errors: result.errors, path: dir, sizeBytes: 0 });
      continue;
    }
    out.push({ ...packSummary(dir, result.manifest), valid: true, error: '' });
  }
  out.sort((a, b) => (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind.localeCompare(b.kind)));
  return out;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function moveToQuarantine(target, quarantineDir, id) {
  const dest = path.join(quarantineDir || path.join(path.dirname(target), '.removed'), `${id}-${timestamp()}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(target, dest);
  return dest;
}

/**
 * 从目录安装：校验 manifest + 文件 → 复制到临时目录 → 原子 rename。
 * 已存在时默认拒绝；overwrite=true 时旧目录移到 quarantine，不硬删。
 */
export async function installPackFromDirectory(sourceDir, {
  root, overwrite = false, quarantineDir = '', verify = true,
} = {}) {
  if (!root) return { ok: false, code: 'pack.root-missing', error: '缺少安装根目录', hint: '检查 state/embedding-packs 路径' };
  const source = path.resolve(sourceDir);
  let stat;
  try { stat = fs.statSync(source); } catch { return { ok: false, code: 'pack.source-missing', error: `源目录不存在：${source}`, hint: '重新选择包目录或先解压' }; }
  if (!stat.isDirectory()) return { ok: false, code: 'pack.source-not-directory', error: '源路径不是目录', hint: '选择 pack.json 所在目录' };
  const checked = readPackManifest(source);
  if (!checked.ok) {
    return { ok: false, code: checked.errors[0]?.code ?? 'pack.manifest-invalid', error: checked.errors[0]?.error ?? 'pack.json 无效', hint: '检查 pack.json', errors: checked.errors };
  }
  if (verify) {
    const files = await verifyPackFiles(source, checked.manifest);
    if (!files.ok) {
      return {
        ok: false, code: 'pack.file-verify-failed', error: '包文件缺失或校验失败',
        hint: '重新下载/重新导出；不要跳过校验', missing: files.missing, mismatch: files.mismatch,
      };
    }
  }
  fs.mkdirSync(root, { recursive: true });
  const target = packDir(root, checked.manifest.id);
  if (fs.existsSync(target) && !overwrite) {
    return { ok: false, code: 'pack.exists', error: `包 ${checked.manifest.id} 已安装`, hint: '先卸载，或勾选覆盖安装' };
  }
  const temp = path.join(root, `.${checked.manifest.id}.tmp-${process.pid}-${Date.now()}`);
  try {
    fs.cpSync(source, temp, { recursive: true, force: true });
    const recheck = readPackManifest(temp, { expectedId: checked.manifest.id });
    if (!recheck.ok) throw new Error(recheck.errors[0]?.error ?? '复制后校验失败');
    if (verify) {
      const files = await verifyPackFiles(temp, recheck.manifest);
      if (!files.ok) throw new Error(`复制后文件校验失败：${files.missing[0] ?? files.mismatch[0]?.path ?? ''}`);
    }
    let backup = '';
    if (fs.existsSync(target)) backup = moveToQuarantine(target, quarantineDir, checked.manifest.id);
    fs.renameSync(temp, target);
    return { ok: true, id: checked.manifest.id, path: target, backup, manifest: recheck.manifest, summary: packSummary(target, recheck.manifest) };
  } catch (error) {
    try { fs.rmSync(temp, { recursive: true, force: true }); } catch {}
    return { ok: false, code: 'pack.install-failed', error: String(error?.message ?? error), hint: '检查磁盘空间/权限后重试' };
  }
}

/** 卸载 = rename 到 quarantine；找不到也不报灾难。 */
export function uninstallPack(root, id, { quarantineDir = '' } = {}) {
  const target = packDir(root, id);
  if (!fs.existsSync(target)) return { ok: false, code: 'pack.not-installed', error: `包 ${id} 未安装`, hint: '刷新列表' };
  try {
    const dest = moveToQuarantine(target, quarantineDir, id);
    return { ok: true, id, removedTo: dest };
  } catch (error) {
    return { ok: false, code: 'pack.uninstall-failed', error: String(error?.message ?? error), hint: '检查文件是否被运行时占用' };
  }
}

export function resolveInstalledPack(root, { id = '', modelSpace = '' } = {}) {
  const packs = listEmbeddingPacks(root).filter((pack) => pack.valid);
  if (id) return packs.find((pack) => pack.id === normalizePackId(id)) ?? null;
  if (modelSpace) return packs.find((pack) => pack.kind === 'model' && pack.modelSpace === modelSpace) ?? null;
  return null;
}
