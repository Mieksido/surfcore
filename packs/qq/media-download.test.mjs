/**
 * 媒体下载测试（注入假 fetch，不联网）
 * 跑法：node packs/qq/media-download.test.mjs
 */
import { downloadMedia, DEFAULT_MEDIA } from './media-download.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

const fakeFetch = (map) => async (url) => {
  const hit = map[url];
  if (!hit) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
  if (hit.throw) throw new Error(hit.throw);
  return { ok: true, status: 200, arrayBuffer: async () => hit.bytes.buffer.slice(hit.bytes.byteOffset, hit.bytes.byteOffset + hit.bytes.byteLength) };
};

console.log('## 正常下载');
{
  const bytes = Buffer.from('IMAGEDATA');
  const r = await downloadMedia({
    items: [{ kind: 'image', path: 'https://x/a.png', caption: '猫' }],
    fetchImpl: fakeFetch({ 'https://x/a.png': { bytes } }),
  });
  ok(r.downloaded === 1, '下到 1 张');
  ok(Buffer.isBuffer(r.items[0].bytes) && r.items[0].bytes.toString() === 'IMAGEDATA', '拿到字节');
  ok(r.items[0].caption === '猫', '说明保留');
}

console.log('\n## 不下载的：本地路径 / 没有 URL');
{
  const r = await downloadMedia({ items: [{ kind: 'image', path: '/tmp/a.png' }, { kind: 'file' }], fetchImpl: fakeFetch({}) });
  ok(r.downloaded === 0 && r.items.length === 2, '原样保留，不算失败');
  ok(!r.items[0].unavailable, '本地路径不标记失败');
}

console.log('\n## 失败要标出来，但不拖垮事件');
{
  const r = await downloadMedia({
    items: [
      { kind: 'image', path: 'https://x/404.png' },
      { kind: 'image', path: 'https://x/boom.png' },
    ],
    fetchImpl: fakeFetch({ 'https://x/boom.png': { throw: 'Headers Timeout Error' } }),
  });
  ok(r.items[0].unavailable === 'http' && r.items[0].reason.includes('404'), '404：标 http + 原因');
  ok(r.items[1].unavailable === 'timeout', '超时：单独归类');
  ok(r.skipped === 2, '统计：跳过 2 个');
  ok(r.items.length === 2, '事件里的媒体条数不变（她仍知道"对方发了图"）');
}

console.log('\n## 上限：太大 / 太多');
{
  const big = Buffer.alloc(2048);
  const r = await downloadMedia({ items: [{ kind: 'image', path: 'https://x/big.png' }], fetchImpl: fakeFetch({ 'https://x/big.png': { bytes: big } }), maxBytes: 1024 });
  ok(r.items[0].unavailable === 'too-large', '超过上限：不下载（标记）');
  ok(String(r.items[0].reason).includes('超过上限'), '原因写清');

  const items = Array.from({ length: 6 }, (_, i) => ({ kind: 'image', path: `https://x/${i}.png` }));
  const many = await downloadMedia({ items, fetchImpl: fakeFetch({}), maxItems: 2 });
  ok(many.items.filter((x) => x.unavailable === 'too-many').length === 4, '超过条数：后面的不试');
  ok(DEFAULT_MEDIA.maxItems === 4 && DEFAULT_MEDIA.maxBytes === 8 * 1024 * 1024, '默认上限可读');
}

console.log('\n## 没有 fetch');
{
  const r = await downloadMedia({ items: [{ kind: 'image', path: 'https://x/a.png' }], fetchImpl: null });
  ok(r.items[0].unavailable === 'no-fetch', '没有 fetch：标记 unavailable（不崩）');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
