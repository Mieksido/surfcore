// state/ 目录 ACL 收紧的**唯一实现**。
//
// 为什么单独成模块：这套逻辑原本在桥接进程（`src/bridge.js` 的 hardenStateDirAcl）和
// 安装脚本（`scripts/harden-state-acl.mjs`）里各写了一份，两份带着**同一个** bug：
//
//   icacls DIR /inheritance:r /grant:r "u:(OI)(CI)F" /grant:r ... /T /C
//
// `(OI)(CI)` 是**目录专用**的继承标志。icacls 把它套到 `/T` 展开出来的**文件**上会失败，
// 而同一句里的 `/inheritance:r` 已经把文件原有的继承 ACE 摘掉了 —— 净结果是**子文件
// DACL 被清空，连属主自己都读不了**。实测后果：state/ 下 50 个子文件变成空 DACL，
// 桥接读不到自己的控制台令牌（"Access to the path ... is denied"），而启动日志只报
// 「未能收紧权限」，完全看不出已经造成了破坏。
//
// 第二个 bug 让第一个 bug 反复发生：回读自检用 `/\(I\)/.test(整段输出)` 判断「继承链是否
// 断干净」。但 DSH 的 ACL 沙箱会把工作区（含 state/）标记为 Low 完整性，而
// `Mandatory Label\Low Mandatory Level:(I)(OI)(CI)(NW)` 这一行**永远**带 (I) ——
// 于是「已收紧」被误判成「未收紧」，**每次启动都重跑一遍那个破坏性命令**。
//
// 合并成一份实现，从结构上杜绝两份逻辑再次漂移。
//
// 正确顺序是四步，缺一不可：
//   1. 目录上停止继承；
//   2. 按 **SID** 删除宽松主体（不受系统显示语言影响）；
//   3. 对**每一个**条目显式授权 —— 不带 (OI)(CI)，所以对文件同样有效；
//   4. 给目录补一份可继承 ACE，让以后新建的文件自动拿到权限。
// 最后自检由调用方按需做（{@link isHardened}）。

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

// Authenticated Users=S-1-5-11, BUILTIN\Users=S-1-5-32-545, Everyone=S-1-1-0
const PERMISSIVE_SIDS = ['*S-1-5-11', '*S-1-5-32-545', '*S-1-1-0'];

/** icacls 的可执行封装（统一超时与隐藏窗口）。 */
export function icacls(args, timeout = 30000) {
  return spawnSync('icacls', args, { encoding: 'utf8', timeout, windowsHide: true });
}

/**
 * icacls 输出里是否还有**继承来的权限** ACE。
 *
 * 必须排除 Mandatory Label 行：那不是权限，而且 DSH 沙箱打过 Low 标签后它永远带 (I)。
 * 用全文 `/\(I\)/` 扫描会把「已收紧」判成「未收紧」，进而让调用方反复重跑破坏性命令。
 */
export function hasInheritedPermissionAce(icaclsOutput) {
  return String(icaclsOutput ?? '')
    .split(/\r?\n/)
    .filter((line) => !/Mandatory Label/i.test(line))
    .some((line) => /\(I\)/.test(line));
}

/** 是否还有本机任意用户可读的宽松主体授权。 */
export function hasPermissiveTrustee(icaclsOutput) {
  return /Authenticated Users|BUILTIN\\Users|\bEveryone\b/i.test(String(icaclsOutput ?? ''));
}

/**
 * 目标路径的权限是否已收紧：既没有继承来的权限 ACE，也没有宽松主体。
 * @param {string} target - 目录或文件路径。
 */
export function isHardened(target) {
  if (process.platform !== 'win32') {
    try { return (fs.statSync(target).mode & 0o077) === 0; } catch { return false; }
  }
  const res = icacls([target], 10000);
  if (res.error || res.status !== 0) return false;
  const out = res.stdout ?? '';
  return !hasInheritedPermissionAce(out) && !hasPermissiveTrustee(out);
}

/**
 * 收紧一个**目录**及其整棵子树的权限。
 * @param {string} dir - 目标目录。
 * @returns {{ok: boolean, detail: string}}
 */
export function hardenDir(dir) {
  if (process.platform !== 'win32') {
    try { fs.chmodSync(dir, 0o700); return { ok: true, detail: 'chmod 700' }; }
    catch (error) { return { ok: false, detail: error?.message ?? String(error) }; }
  }
  const user = process.env.USERNAME;
  if (!user) return { ok: false, detail: '无法确定当前用户名（%USERNAME% 为空）' };
  const steps = [
    [dir, '/inheritance:r', '/C', '/Q'],
    [dir, '/remove:g', ...PERMISSIVE_SIDS, '/T', '/C', '/Q'],
    [dir, '/T', '/C', '/Q', '/grant', `${user}:F`, '/grant', 'SYSTEM:F', '/grant', 'Administrators:F'],
    [dir, '/Q', '/grant', `${user}:(OI)(CI)F`, '/grant', 'SYSTEM:(OI)(CI)F', '/grant', 'Administrators:(OI)(CI)F']
  ];
  for (const args of steps) {
    // 启动路径不能为了 ACL 把控制台事件循环卡 30 秒/步；超时就明确失败，交给安全页手动重试。
    const res = icacls(args, 3000);
    const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
    if (res.error) return { ok: false, detail: res.error.message };
    // /C 会让 icacls 继续处理剩余文件、即使全失败退出码仍是 0，所以必须看输出。
    if (/access is denied/i.test(out)) {
      return { ok: false, detail: out.split('\n').filter(Boolean).slice(-3).join(' / ') };
    }
  }
  // 自检：属主必须仍能读到目录内容（防止把 DACL 清空这种"成功"的破坏）。
  try { fs.readdirSync(dir); }
  catch (error) { return { ok: false, detail: `收紧后目录已不可读，请检查 ACL（${error?.message ?? error}）` }; }
  return { ok: true, detail: 'icacls' };
}

/**
 * 收紧一个**文件**的权限（凭据文件用；文件不能带 (OI)(CI)）。
 * @param {string} file - 目标文件。
 * @returns {{ok: boolean, detail: string}}
 */
export function hardenFile(file) {
  if (process.platform !== 'win32') {
    try { fs.chmodSync(file, 0o600); return { ok: true, detail: 'chmod 600' }; }
    catch (error) { return { ok: false, detail: error?.message ?? String(error) }; }
  }
  const user = process.env.USERNAME;
  if (!user) return { ok: false, detail: '无法确定当前用户名（%USERNAME% 为空）' };
  const res = icacls([file, '/inheritance:r',
    '/grant:r', `${user}:F`, '/grant:r', 'SYSTEM:F', '/grant:r', 'Administrators:F', '/C', '/Q']);
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  if (res.error) return { ok: false, detail: res.error.message };
  if (/access is denied/i.test(out)) {
    return { ok: false, detail: out.split('\n').filter(Boolean).slice(-2).join(' / ') };
  }
  return { ok: true, detail: 'icacls' };
}

/**
 * 给人看的手动收紧命令（失败降级时打印）。
 *
 * 必须是**安全**的那一版：把 (OI)(CI) 授权和 /T 混在同一句里会把子文件 DACL 清空。
 */
export function manualDirCommand(dir) {
  if (process.platform !== 'win32') return `chmod -R go-rwx "${dir}"`;
  const d = `"${dir}"`;
  return [
    `icacls ${d} /inheritance:r /C /Q`,
    `icacls ${d} /remove:g "*S-1-5-11" "*S-1-5-32-545" "*S-1-1-0" /T /C /Q`,
    `icacls ${d} /T /C /Q /grant "%USERNAME%:F" /grant "SYSTEM:F" /grant "Administrators:F"`,
    `icacls ${d} /Q /grant "%USERNAME%:(OI)(CI)F" /grant "SYSTEM:(OI)(CI)F" /grant "Administrators:(OI)(CI)F"`
  ].join('\n             ');
}
