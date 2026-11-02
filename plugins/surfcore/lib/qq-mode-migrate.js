/**
 * 一次性迁移：把旧 `qq-mode` Settings 命名空间的持久化值搬到 `surfcore`。
 *
 * 背景（Mieksido/surfcore#35）：0.8.6 及之前 mode/ownerQQ 由第二条 Loader 行
 * （- id: qq-mode）承载；合并进主行后命名空间变成 surfcore（由 Loader entry id
 * 推导）。旧命名空间的 volatile 覆盖值由 DSH 持久化在 profile 的 cordis.patch.yml：
 *
 *   - id: qq-mode
 *     name: ./lib/qq-mode.js
 *     config:
 *       mode: chat
 *       ownerQQ: '12345'
 *
 * 旧行删除后 settings API 读不到它（describe 只返回 ACTIVE entry，write 直接抛
 * No configurable plugin entry），所以唯一的迁移数据源就是这份文件。**只读解析**，
 * 写回走 settings.update('surfcore', …) —— 插件不直接改写任何用户配置文件。
 *
 * 时序约定（用户确认的实施基线）：
 *   1. marker 存在 → 什么都不做（幂等，不重复扫描）；
 *   2. 只读解析旧配置，算出「新 namespace 缺失且旧值有效」的字段；
 *   3. settings.update 成功**之后**才写 marker（中途失败下次重试，不会误标完成）；
 *   4. 旧文件不存在 / 没有可迁移字段 → 记录结果并写 marker（同样幂等）；
 *   5. 空 ownerQQ 视为「未设置」，不迁移。
 */
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export const MARKER_VERSION = 1;

/**
 * 从 profile patch 文本里解析旧 qq-mode 行的 config（纯函数，可测）。
 * @param {string} text cordis.patch.yml 的文本内容
 * @returns {{ mode?: string, ownerQQ?: string }} 旧值；字段缺失/非法时不出现在结果里
 */
export function parseLegacyQqModeConfig(text) {
  if (!text || !text.trim()) return {};
  let doc;
  try { doc = yaml.load(text); } catch { return {}; }
  if (!Array.isArray(doc)) return {};
  // profile patch 的覆盖行形如 { id, name?, config }；只认 id=qq-mode 且带 config 对象的行。
  // name 不强匹配（不同版本写法可能不同），id 是 settings 定位的唯一键。
  const row = [...doc].reverse().find((item) => item
    && typeof item === 'object'
    && !Array.isArray(item)
    && item.id === 'qq-mode'
    && item.config
    && typeof item.config === 'object'
    && !Array.isArray(item.config));
  if (!row) return {};
  const out = {};
  if (typeof row.config.mode === 'string' && row.config.mode) out.mode = row.config.mode;
  // 空串 = 「不通过 DSH 设置覆盖」，按未设置处理（与 ownerQQ 语义一致）。
  if (typeof row.config.ownerQQ === 'string' && row.config.ownerQQ.trim()) out.ownerQQ = row.config.ownerQQ.trim();
  else if (typeof row.config.ownerQQ === 'number' && String(row.config.ownerQQ).trim()) out.ownerQQ = String(row.config.ownerQQ);
  return out;
}

/**
 * 计算需要迁移的字段：只填新 namespace 缺失的，不覆盖已设置的新值（纯函数，可测）。
 * @param {{ mode?: string, ownerQQ?: string }} legacy 旧值
 * @param {{ mode?: unknown, ownerQQ?: unknown }} current 新 namespace 当前值
 */
export function migrationPatch(legacy, current) {
  const patch = {};
  if (legacy.mode && !current.mode) patch.mode = legacy.mode;
  if (legacy.ownerQQ && !(typeof current.ownerQQ === 'string' && current.ownerQQ.trim())) patch.ownerQQ = legacy.ownerQQ;
  return patch;
}

/**
 * 执行一次性迁移；完成后在 markerFile 记录结果（成功/无操作/失败原因都记）。
 * 所有文件操作只读（profile patch）或写 state 目录（marker）；不碰其它任何文件。
 * @param {object} options
 * @param {string} options.profilePatchFile profile 的 cordis.patch.yml 绝对路径
 * @param {string} options.markerFile marker 文件绝对路径（放 state 目录）
 * @param {(ns: string, patch: object) => Promise<unknown>} options.updateSettings 等价 settings.update 的函数
 * @param {() => { mode?: unknown, ownerQQ?: unknown } | null} options.readCurrentNamespace 读新 namespace 当前值
 * @param {(msg: string) => void} [options.log] 日志函数
 * @returns {Promise<{ status: 'skipped'|'migrated'|'noop'|'failed', patch?: object, reason?: string }>}
 */
export async function migrateLegacyQqMode({ profilePatchFile, markerFile, updateSettings, readCurrentNamespace, log = () => {} }) {
  // 1) marker 已存在：之前已跑完（无论结果），不再重复扫描。
  try {
    const existing = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
    if (existing && typeof existing === 'object') {
      return { status: 'skipped', reason: `marker 存在（status=${existing.status}）` };
    }
  } catch { /* 无 marker：继续 */ }

  let legacy = {};
  try {
    legacy = parseLegacyQqModeConfig(fs.readFileSync(profilePatchFile, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      // 旧文件不存在 = 没有可迁移数据，属正常路径：幂等收尾，不是失败。
      try {
        fs.writeFileSync(markerFile, `${JSON.stringify({ migratedAt: new Date().toISOString(), status: 'noop', legacy: {} }, null, 2)}\n`, 'utf8');
      } catch (markerError) {
        log(`[qq-mode-migrate] 写 marker 失败：${markerError?.message ?? markerError}`);
      }
      return { status: 'noop', reason: 'profile patch 不存在（无旧配置可迁移）' };
    }
    // 其它读错误不阻塞启动：记录失败但不写成功 marker，下次启动重试。
    log(`[qq-mode-migrate] 读取 ${profilePatchFile} 失败：${error?.message ?? error}`);
    return { status: 'failed', reason: `read-profile-patch: ${error?.message ?? error}` };
  }

  if (!legacy.mode && !legacy.ownerQQ) {
    // 旧文件不存在 / 没有 qq-mode 行 / 行里没有有效值：记录 noop 并幂等收尾。
    try {
      fs.writeFileSync(markerFile, `${JSON.stringify({ migratedAt: new Date().toISOString(), status: 'noop', legacy: {} }, null, 2)}\n`, 'utf8');
    } catch (error) {
      log(`[qq-mode-migrate] 写 marker 失败：${error?.message ?? error}`);
    }
    return { status: 'noop', reason: '旧配置无 mode/ownerQQ 可迁移' };
  }

  let current = null;
  try { current = readCurrentNamespace?.() ?? null; } catch { current = null; }
  const patch = migrationPatch(legacy, current ?? {});
  if (!Object.keys(patch).length) {
    try {
      fs.writeFileSync(markerFile, `${JSON.stringify({ migratedAt: new Date().toISOString(), status: 'noop', legacy }, null, 2)}\n`, 'utf8');
    } catch (error) {
      log(`[qq-mode-migrate] 写 marker 失败：${error?.message ?? error}`);
    }
    return { status: 'noop', reason: '新 namespace 已有值，无需迁移' };
  }

  try {
    await updateSettings('surfcore', patch);
  } catch (error) {
    // 不写 marker：下次启动重试（避免迁移中途失败被误标完成）。
    log(`[qq-mode-migrate] settings.update('surfcore') 失败（下次启动重试）：${error?.message ?? error}`);
    return { status: 'failed', patch, reason: `settings-update: ${error?.message ?? error}` };
  }

  try {
    fs.writeFileSync(markerFile, `${JSON.stringify({ migratedAt: new Date().toISOString(), status: 'migrated', legacy, patch }, null, 2)}\n`, 'utf8');
  } catch (error) {
    // 值已写进 settings，marker 写失败只会导致下次重复迁移一次相同值（幂等）。
    log(`[qq-mode-migrate] 迁移完成但写 marker 失败：${error?.message ?? error}`);
  }
  return { status: 'migrated', patch };
}
