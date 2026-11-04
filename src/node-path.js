import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function isNodeExe(file) {
  return /^node(\.exe)?$/i.test(path.basename(String(file ?? '')));
}

// macOS 移植（2026-11-03）：DSH Desktop 在 macOS 上是 .app 包，
// process.execPath 是 `.../DSH Desktop.app/Contents/MacOS/DSH Desktop`，
// 官方安装目录里**没有** resources/runtime/.../node（只有 Windows 版带），
// 所以原来的候选表在 mac 上全部落空 → 返回 execPath → 调用方报「找不到真正的 node.exe」。
//
// 这里补 mac 的常见来源，顺序按「离仓库近、可预测」优先：
//   1) SURFCORE_NODE（显式覆盖，多实例/便携 node 用）
//   2) <仓库根>/../.tooling/node/bin/node（本仓库自带的便携 node，整目录搬走仍有效）
//   3) Homebrew（Apple Silicon / Intel）、/usr/local
//   4) ~/.local/bin/node
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function unixNodeCandidates({ home }) {
  if (process.platform === 'win32') return [];
  const out = [process.env.SURFCORE_NODE];
  out.push(path.resolve(REPO_ROOT, '..', '.tooling', 'node', 'bin', 'node'));
  if (process.platform === 'darwin') {
    out.push('/opt/homebrew/bin/node', '/usr/local/bin/node');
  }
  out.push('/usr/local/bin/node', '/usr/bin/node');
  out.push(path.join(home, '.local', 'bin', 'node'));
  return out.filter(Boolean);
}

/**
 * 找到真正能跑 .mjs 的 node。
 *
 * DSH Desktop 的 process.execPath 是 Harness.exe，真正的 node 可能只在
 * <install>/resources/runtime/primary-runtime/dependencies/node/bin/node.exe。
 * 这里把安装目录候选放在用户缓存/Program Files 之前，但保留所有旧入口；
 * 找不到时仍返回 process.execPath，让调用方给出明确错误，而不是静默换程序。
 */
export function findNodeExe({
  execPath = process.execPath,
  env = process.env,
  home = env.USERPROFILE || os.homedir(),
  dshHome = env.DSH_HOME || path.join(home, '.dsh'),
  programFiles = 'C:\\Program Files\\nodejs\\node.exe',
} = {}) {
  const exeDir = path.dirname(String(execPath || process.execPath));
  const candidates = [
    env.DSH_NODE,
    // DSH Desktop 安装目录布局（PR #3）；Windows 和类 Unix 各一份，按存在性选。
    path.join(exeDir, 'resources', 'runtime', 'primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'),
    path.join(exeDir, 'resources', 'runtime', 'primary-runtime', 'dependencies', 'node', 'bin', 'node'),
    // 旧的用户缓存布局。
    path.join(dshHome, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'),
    path.join(home, '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'),
    programFiles,
    // macOS / Linux：见上方 unixNodeCandidates 的注释。
    ...unixNodeCandidates({ home }),
  ];
  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    try {
      if (isNodeExe(candidate) && fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return execPath;
}
