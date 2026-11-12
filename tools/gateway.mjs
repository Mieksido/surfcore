/**
 * 网关导入的"系统能力"（app 层）
 * ============================================================================
 * 为什么在 app：解压要调操作系统的工具（Windows 上是 Expand-Archive），
 * 这属于**部署环境**的事，不该进包、更不该进内核。
 *
 * 包那边只认"给我 list/extract/hash 三个函数"（见 packs/qq/gateway-import.js），
 * 这里就是这三个函数在 Windows 上的实现。换平台只需要换这个文件。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const PS = process.platform === 'win32' ? 'powershell' : 'pwsh';

/** 读 zip 条目名（只读，不解压） */
export async function listZipEntries(zipPath) {
  if (!fs.existsSync(zipPath)) throw new Error(`找不到文件：${zipPath}`);
  const script = [
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    `$z=[System.IO.Compression.ZipFile]::OpenRead('${String(zipPath).replace(/'/g, "''")}')`,
    '$z.Entries | ForEach-Object { $_.FullName }',
    '$z.Dispose()',
  ].join('; ');
  const r = spawnSync(PS, ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || '读取压缩包失败').toString().trim().slice(0, 200));
  return String(r.stdout ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

/** 算文件 sha256 */
export async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (c) => hash.update(c));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

/**
 * 解压：先解到临时目录，再按 stripPrefix 搬进目标目录。
 * 这样即使解压到一半失败，也不会在目标目录留下半截文件。
 */
export async function extractZip({ zipPath, destDir, stripPrefix = '' }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-gw-'));
  try {
    const r = spawnSync(PS, ['-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath '${String(zipPath).replace(/'/g, "''")}' -DestinationPath '${tmp.replace(/'/g, "''")}' -Force`],
    { encoding: 'utf8' });
    if (r.status !== 0) throw new Error((r.stderr || '解压失败').toString().trim().slice(0, 200));

    const src = stripPrefix ? path.join(tmp, stripPrefix) : tmp;
    if (!fs.existsSync(src)) throw new Error(`压缩包里没有 ${stripPrefix} 目录`);
    fs.mkdirSync(destDir, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      // 用复制而不是 rename：临时目录与目标可能在不同盘（EXDEV）
      fs.cpSync(path.join(src, name), path.join(destDir, name), { recursive: true, force: true });
    }
    return { destDir };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** 写来源文件（单写者：只有导入流程写它） */
export async function writeProvenance(destDir, obj) {
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(path.join(destDir, '_gateway.json'), JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

/** 默认安装位置：**用户本地数据目录**，不在仓库里 */
export function defaultGatewayDir(profile) {
  const base = process.platform === 'win32'
    ? (process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'))
    : path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'SurfCore', 'gateways', String(profile || 'gateway'));
}
