// 生成发布包的安装清单：每个文件的 sha256。
//
// 关键约束（2026-10-30 第二次事故）：
//   清单里的哈希必须等于 **Git 提交里的内容**（= GitHub archive 里的字节），
//   不能取工作目录里的文件：Windows 下工作区常是 CRLF，而 git 提交/归档是 LF，
//   两边 sha256 必然不同 → 用户下载的包永远校验失败。
//   所以这里用 `git cat-file` 读 HEAD（或指定 ref）的 blob 字节来算哈希。
//
// 用法：
//   node scripts/release-manifest.mjs                        # 用 HEAD 生成 release/install-manifest.json
//   node scripts/release-manifest.mjs --verify-ref v0.7.11   # 校验某 ref 的清单与 blob 是否一致（发版门禁）
//   node scripts/release-manifest.mjs --verify <dir>         # 校验解压出来的目录与清单是否一致
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const verifyRefIdx = args.indexOf('--verify-ref');
const verifyDirIdx = args.indexOf('--verify');

const EXCLUDE_DIRS = new Set([
  'state', 'backups', 'node_modules', '.git', 'logs', 'staging', 'pet', 'characters',
  'voice-packs', 'dist', 'video', 'release', 'tmp-update',
  // 内容/个人数据目录：不进公开镜像，也不进清单（它们不是"我们的代码文件"）
  'roles', 'assets', 'audio', 'pet', 'characters', 'examples',
]);
const EXCLUDE_FILES = new Set([
  'config.json', 'bili.config.json', 'updates-pending.json',
  '.installed-meta.json', '.installed-manifest.json',
  // 本机诊断产物，不属于发布内容
  'obs-diag.json',
]);

function listTracked(ref) {
  const out = execFileSync('git', ['-C', root, 'ls-tree', '-r', '--name-only', '-z', ref], { encoding: 'buffer' });
  return out.toString('utf8').split(String.fromCharCode(0)).filter(Boolean);
}

/** 用一次 git cat-file --batch 取出所有 blob 的字节，返回 { rel: sha256 } */
function hashBlobs(ref, files) {
  const input = files.map((rel) => `${ref}:${rel}`).join('\n') + '\n';
  const out = execFileSync('git', ['-C', root, 'cat-file', '--batch'], { input, maxBuffer: 256 * 1024 * 1024 });
  const filesHash = {};
  let offset = 0;
  for (const rel of files) {
    const nl = out.indexOf(10, offset);
    if (nl < 0) throw new Error(`git cat-file 输出不完整（${rel}）`);
    const header = out.slice(offset, nl).toString('utf8');
    const parts = header.split(' '); // <sha> <type> <size>
    if (parts.length !== 3) throw new Error(`无法解析 blob 头：${header}（${rel}）`);
    const size = Number(parts[2]);
    const start = nl + 1;
    const blob = out.subarray(start, start + size);
    if (blob.length !== size) throw new Error(`blob 长度不符：${rel}`);
    filesHash[rel] = crypto.createHash('sha256').update(blob).digest('hex');
    offset = start + size + 1; // 跳过 blob 后的换行
  }
  return filesHash;
}

function filterTracked(list) {
  return list.filter((rel) => {
    const parts = rel.split('/');
    if (parts.some((x) => EXCLUDE_DIRS.has(x))) return false;
    if (EXCLUDE_FILES.has(parts[parts.length - 1])) return false;
    if (rel === 'release/install-manifest.json') return false;
    return true;
  });
}

function verifyAt(ref) {
  const manifest = JSON.parse(execFileSync('git', ['-C', root, 'show', `${ref}:release/install-manifest.json`], { encoding: 'utf8' }));
  const tracked = filterTracked(listTracked(ref));
  const expected = hashBlobs(ref, tracked);
  const problems = [];
  for (const [rel, want] of Object.entries(manifest.files ?? {})) {
    if (!(rel in expected)) { problems.push(`清单多出：${rel}`); continue; }
    if (expected[rel] !== want) problems.push(`哈希不符：${rel}（清单 ${want.slice(0, 12)} / 实际 ${expected[rel].slice(0, 12)}）`);
  }
  for (const rel of tracked) if (!(rel in (manifest.files ?? {}))) problems.push(`清单缺少：${rel}`);
  console.log(`verify-ref ${ref}: 清单 ${Object.keys(manifest.files ?? {}).length} 个，跟踪文件 ${tracked.length} 个，问题 ${problems.length} 个`);
  for (const p of problems.slice(0, 20)) console.log(`  ✗ ${p}`);
  if (problems.length) process.exit(1);
  console.log('✅ 清单与该 ref 的内容逐字节一致');
}

function verifyDir(dir) {
  const target = path.resolve(dir);
  const manifestPath = path.join(target, 'release', 'install-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`[release-manifest] ${target} 里没有 release/install-manifest.json：这不是发布包，拒绝用本机清单猜`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  console.log(`verify-dir ${target}: 使用 ${manifestPath}`);
  let ok = 0; const bad = []; const missing = [];
  for (const [rel, want] of Object.entries(manifest.files ?? {})) {
    const abs = path.resolve(target, rel);
    if (!abs.startsWith(`${target}${path.sep}`)) { bad.push(`${rel}（路径越界）`); continue; }
    if (!fs.existsSync(abs)) { missing.push(rel); continue; }
    const hash = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
    if (hash === want) ok += 1; else bad.push(rel);
  }
  console.log(`verify-dir ${target}: ok ${ok} | 不符 ${bad.length} | 缺失 ${missing.length}`);
  for (const rel of bad.slice(0, 10)) console.log(`  ✗ 不符：${rel}`);
  for (const rel of missing.slice(0, 10)) console.log(`  ✗ 缺失：${rel}`);
  if (bad.length || missing.length) process.exit(1);
  console.log('✅ 目录内容与该目录自己的清单一致');
}

if (verifyRefIdx >= 0) {
  verifyAt(args[verifyRefIdx + 1] || 'HEAD');
  process.exit(0);
}
if (verifyDirIdx >= 0) {
  verifyDir(args[verifyDirIdx + 1] || '.');
  process.exit(0);
}

// ── 生成模式 ─────────────────────────────────────────────────────────────
const dirty = execFileSync('git', ['-C', root, 'status', '--porcelain', '--', ...listTracked('HEAD')], { encoding: 'utf8' })
  .split('\n')
  .filter((line) => line && !line.includes('release/install-manifest.json'))
  .join('\n')
  .trim();
if (dirty) {
  console.error('[release-manifest] 工作区有未提交改动：清单按 HEAD 生成，未提交内容不会进包');
  console.error(dirty.split('\n').slice(0, 10).join('\n'));
  process.exitCode = 1;
}

const tracked = filterTracked(listTracked('HEAD'));
const files = hashBlobs('HEAD', tracked);
const version = JSON.parse(execFileSync('git', ['-C', root, 'show', 'HEAD:package.json'], { encoding: 'utf8' })).version;
const out = { schemaVersion: 1, version, source: 'git:HEAD', generatedAt: new Date().toISOString(), files };
const target = path.join(root, 'release', 'install-manifest.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
console.log(`install-manifest: ${Object.keys(files).length} files, version ${version} (source=git HEAD) -> ${target}`);
