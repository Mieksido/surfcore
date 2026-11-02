import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function isNodeExe(file) {
  return /^node(\.exe)?$/i.test(path.basename(String(file ?? '')));
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
  ];
  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    try {
      if (isNodeExe(candidate) && fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return execPath;
}
