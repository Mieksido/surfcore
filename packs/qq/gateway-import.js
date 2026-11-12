/**
 * 网关导入：执行层（解压与哈希由调用方注入）
 * 跑法见 gateway-import.test.mjs
 *
 * 为什么注入：解压是平台能力（Windows 用 Expand-Archive），哈希是文件能力；
 * 包不该绑定某一种实现，测试也不该真的解压 40MB。
 */
import { planGatewayImport, provenanceOf } from './gateway.js';

/**
 * @param {object} input
 *   { zipPath, destDir, list（async zipPath→entries）, extract（async {zipPath,destDir,stripPrefix}）, hash（async zipPath→hex）,
 *     now, writeProvenance（async (destDir, obj)） }
 * @returns {Promise<{ok, plan?, provenance?, error?}>}
 */
export async function importGateway({
  zipPath,
  destDir,
  list,
  extract,
  hash,
  now = () => Date.now(),
  writeProvenance,
} = {}) {
  if (typeof list !== 'function') return { ok: false, error: { code: 'gateway.no-lister', message: '缺少解压能力（list）' } };
  if (typeof extract !== 'function') return { ok: false, error: { code: 'gateway.no-extractor', message: '缺少解压能力（extract）' } };

  let entries;
  try {
    entries = await list(zipPath);
  } catch (error) {
    return { ok: false, error: { code: 'gateway.unreadable', message: `读不了这个压缩包：${error?.message ?? error}` } };
  }

  const planned = planGatewayImport({ zipPath, entries, destDir });
  if (!planned.ok) return planned;

  const { plan } = planned;

  // 先解压（失败就停，不要留半截）
  try {
    await extract({ zipPath, destDir, stripPrefix: plan.stripPrefix });
  } catch (error) {
    return { ok: false, error: { code: 'gateway.extract-failed', message: `解压失败：${error?.message ?? error}` } };
  }

  // 哈希失败不算致命（来源记录不完整，但要能看出来）
  let sha256 = '';
  let hashWarning = null;
  if (typeof hash === 'function') {
    try { sha256 = String(await hash(zipPath)); } catch (error) { hashWarning = `算不出哈希：${error?.message ?? error}`; }
  }

  const provenance = provenanceOf({ plan, sha256, importedAt: now() });
  if (typeof writeProvenance === 'function') {
    try { await writeProvenance(destDir, provenance); } catch (error) { hashWarning = `${hashWarning ?? ''}；来源文件没写成功：${error?.message ?? error}`.trim(); }
  }

  return { ok: true, plan, provenance, warning: hashWarning ?? undefined };
}
