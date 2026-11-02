/**
 * B站 视频缓存（shots）的统一路径与轮转。
 *
 * 为什么抽出来：watch-video / debrief / subtitles 三个进程各自写不同子目录，
 * 以前都写死 `~/.dsh/shots`，也都没有保留期。这里统一：
 *   - 尊重 DSH_HOME（和插件/bili 工具的其他路径一致）；
 *   - 允许 bili.config.json 的 shots.dir 改到其他盘；
 *   - 按天 + 可选总大小清理；
 *   - 只处理自己认识的直接文件/临时目录，不递归删用户的东西。
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.mjs';

const HOME = process.env.USERPROFILE || process.env.HOME || '.';
const DSH_HOME = process.env.DSH_HOME || path.join(HOME, '.dsh');
const DEFAULT_ROOT = path.join(DSH_HOME, 'shots');
const SHOT_DIRS = ['video', 'covers', 'subs'];

function normalizeConfig() {
  let raw = {};
  try { raw = config()?.shots ?? {}; } catch {}
  const configured = String(raw.dir ?? '').trim();
  const root = configured
    ? (path.isAbsolute(configured) ? configured : path.resolve(DSH_HOME, configured))
    : DEFAULT_ROOT;
  return {
    root,
    retentionDays: Math.max(0, Number(raw.retentionDays ?? 7) || 0),
    maxMB: Math.max(0, Number(raw.maxMB ?? 0) || 0),
  };
}

/** 当前配置下的 shots 根目录。 */
export function shotsRoot() {
  return normalizeConfig().root;
}

/** 当前配置下某个子目录（video / covers / subs）。 */
export function shotsPath(...parts) {
  return path.join(shotsRoot(), ...parts);
}

function formatMB(bytes) {
  return `${(Number(bytes || 0) / 1024 / 1024).toFixed(1)} MB`;
}

function collectFiles(dir) {
  const out = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue; // 不跟符号链接/目录
      const full = path.join(dir, entry.name);
      try {
        const st = fs.lstatSync(full);
        if (!st.isFile()) continue;
        out.push({ full, size: st.size, mtime: st.mtimeMs });
      } catch {}
    }
  } catch {}
  return out;
}

/**
 * 清理 shots/{video,covers,subs}。
 *
 * - retentionDays=0 表示不按天清理；
 * - maxMB=0 表示不按总大小清理；
 * - 只删普通文件；`.frames-*` 只删超期的临时目录；
 * - 任何单个文件删除失败只记 errors，不中断。
 */
export function pruneShots({
  root = shotsRoot(),
  retentionDays = normalizeConfig().retentionDays,
  maxMB = normalizeConfig().maxMB,
  now = Date.now(),
} = {}) {
  const removed = [];
  const errors = [];
  const kept = [];
  const cutoff = retentionDays > 0 ? now - retentionDays * 24 * 60 * 60 * 1000 : 0;
  const all = [];

  for (const sub of SHOT_DIRS) {
    const dir = path.join(root, sub);
    for (const file of collectFiles(dir)) all.push(file);
  }

  const remove = (file) => {
    try {
      fs.rmSync(file.full, { force: true });
      removed.push(file);
      return true;
    } catch (error) {
      errors.push({ file: file.full, error: String(error?.message ?? error) });
      return false;
    }
  };

  // 1) 按天清理
  const expired = new Set();
  if (cutoff) {
    for (const file of all) {
      if (file.mtime < cutoff && remove(file)) expired.add(file.full);
    }
  }

  // 2) 可选总大小上限：从最旧的开始清到上限以内
  if (maxMB > 0) {
    const left = all.filter((file) => !expired.has(file.full)).sort((a, b) => a.mtime - b.mtime);
    let total = left.reduce((sum, file) => sum + file.size, 0);
    const limit = maxMB * 1024 * 1024;
    for (const file of left) {
      if (total <= limit) break;
      if (remove(file)) total -= file.size;
    }
  }

  // 3) 临时帧目录：只清超期的 `.frames-*`，避免 ffmpeg 中途被删
  const tempCutoff = retentionDays > 0 ? cutoff : now - 24 * 60 * 60 * 1000;
  try {
    const videoDir = path.join(root, 'video');
    for (const entry of fs.readdirSync(videoDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('.frames-')) continue;
      const full = path.join(videoDir, entry.name);
      try {
        const st = fs.statSync(full);
        if (st.mtimeMs < tempCutoff) {
          fs.rmSync(full, { recursive: true, force: true });
          removed.push({ full, size: 0, mtime: st.mtimeMs });
        }
      } catch (error) {
        errors.push({ file: full, error: String(error?.message ?? error) });
      }
    }
  } catch {}

  // 4) 重新统计（清理后）
  for (const sub of SHOT_DIRS) {
    for (const file of collectFiles(path.join(root, sub))) kept.push(file);
  }
  const bytes = kept.reduce((sum, file) => sum + file.size, 0);
  return {
    root,
    retentionDays,
    maxMB,
    files: kept.length,
    bytes,
    removed: removed.length,
    freed: removed.reduce((sum, file) => sum + file.size, 0),
    errors,
  };
}

/** 一行给命令输出/设置页看的缓存摘要。 */
export function formatShotsStats(stats) {
  const retention = stats.retentionDays > 0 ? `保留 ${stats.retentionDays} 天` : '不按天清理';
  const cap = stats.maxMB > 0 ? ` · 上限 ${stats.maxMB} MB` : '';
  const cleaned = stats.removed
    ? ` · 本次清理 ${stats.removed} 个 / ${formatMB(stats.freed)}`
    : '';
  const failed = stats.errors?.length ? ` · ${stats.errors.length} 个清理失败` : '';
  return `B站缓存：${stats.files} 个文件 / ${formatMB(stats.bytes)}（${retention}${cap}${cleaned}${failed}）`;
}
