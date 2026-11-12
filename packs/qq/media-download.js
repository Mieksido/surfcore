/**
 * 媒体下载：把平台给的 URL 变成字节
 * ============================================================================
 * 位置：平台包内部。**下载是渠道的事**——只有包知道去哪儿取、带什么头。
 * 内核只接收 `{ kind, bytes, caption }`，不认识 URL、也不发网络请求。
 *
 * 三条规矩：
 *   · 有上限（字节数 / 条数 / 超时），超了就**放弃这张**，不拖垮整个事件
 *   · 失败不抛：标 `unavailable` + 原因，事件照常往上走（她还能看到"对方发了一张图"）
 *   · 不猜内容：不下结论"这是什么"，那要视觉模型
 */
export const DEFAULT_MEDIA = Object.freeze({
  maxBytes: 8 * 1024 * 1024,   // 单张 8MB
  maxItems: 4,                 // 一个事件最多下 4 张
  timeoutMs: 15000,
});

const isHttp = (s) => /^https?:\/\//i.test(String(s ?? ''));

/**
 * @param {object} input { items:[{kind, path, caption, transcript}], fetchImpl, maxBytes, maxItems, timeoutMs }
 * @returns {Promise<{items:Array, downloaded:number, skipped:number}>}
 */
export async function downloadMedia({
  items = [],
  fetchImpl = globalThis.fetch,
  maxBytes,
  maxItems,
  timeoutMs,
} = {}) {
  const capB = Number(maxBytes) > 0 ? Number(maxBytes) : DEFAULT_MEDIA.maxBytes;
  const capN = Number(maxItems) > 0 ? Number(maxItems) : DEFAULT_MEDIA.maxItems;
  const capT = Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_MEDIA.timeoutMs;

  const out = [];
  let downloaded = 0;
  let skipped = 0;

  for (const [i, m] of (Array.isArray(items) ? items : []).entries()) {
    if (!m) continue;
    const url = m.path ?? m.url;

    // 不是 http（本地文件/空）：原样保留，交给上游判断
    if (!isHttp(url)) { out.push({ ...m }); continue; }
    if (i >= capN) { skipped += 1; out.push({ ...m, unavailable: 'too-many', reason: `一个事件最多下载 ${capN} 张` }); continue; }
    if (typeof fetchImpl !== 'function') { skipped += 1; out.push({ ...m, unavailable: 'no-fetch' }); continue; }

    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(capT) });
      if (!res.ok) { skipped += 1; out.push({ ...m, unavailable: 'http', reason: `HTTP ${res.status}` }); continue; }

      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > capB) {
        skipped += 1;
        out.push({ ...m, unavailable: 'too-large', reason: `${Math.round(buf.length / 1024)}KB 超过上限` });
        continue;
      }
      out.push({ kind: m.kind ?? 'file', bytes: buf, caption: m.caption ?? '', transcript: m.transcript ?? '' });
      downloaded += 1;
    } catch (error) {
      skipped += 1;
      const msg = String(error?.message ?? error);
      out.push({ ...m, unavailable: /timeout|abort/i.test(msg) ? 'timeout' : 'network', reason: msg.slice(0, 80) });
    }
  }

  return { items: out, downloaded, skipped };
}
