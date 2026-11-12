/**
 * 本体的边界：**核心只保留内核与适配器**
 * ============================================================================
 * 这是整个项目的法律边界，也是架构边界。任何打包/检查/文档都从这里取，不另写一份。
 *
 *   核心（SurfCore 本体）  kernel/（内核） runtime/（大适配器）
 *   扩展（不随本体分发）   packs/      平台包，各自独立打包
 *   工具（开发期）         tools/ docs/ contracts/
 *
 * 为什么工具不算核心：它们是开发期用的（门禁/命令行），不参与运行。
 * 为什么 packs 不算核心：平台包描述的是"外部世界怎么说话"，属于扩展；
 *   它们各自独立发布，本体分发包里**一个包都不带**。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 核心：出包时只带这些目录 */
export const CORE_PATHS = Object.freeze(['kernel', 'runtime']);

/** 扩展：独立发布，不进核心包 */
export const EXTENSION_PATHS = Object.freeze(['packs']);

/** 开发期目录：**不进任何分发包**（既不进本体，也不进平台包） */
export const DEV_PATHS = Object.freeze(['tools', 'docs', 'contracts', 'scripts', 'src']);

/** 把核心目录展开成文件清单（给"打包/检查"用） */
export function listCoreFiles(root = ROOT) {
  const out = [];
  const walk = (dir, prefix) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name.startsWith('_')) continue;
        walk(full, rel);
      } else {
        out.push(rel);
      }
    }
  };
  for (const p of CORE_PATHS) walk(path.join(root, p), p);
  return out;
}

/** 一句话：核心是什么 */
export function describeCore() {
  return `核心 = ${CORE_PATHS.join(' + ')}；扩展 = ${EXTENSION_PATHS.join(' + ')}（不随本体分发）`;
}
