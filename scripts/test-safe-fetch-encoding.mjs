/**
 * Content-Encoding 回归 —— B站 链接抓回来是乱码的根因（issue #83）。
 *
 * 钉住：
 *   1. gzip / deflate / br 三种单层编码都能被正确解压成原文；
 *   2. identity / 空值不套解码器（保持旧行为）；
 *   3. 未知编码与多重编码一律返回 null —— 宁可退回原始字节，也不猜一个可能错的解码器；
 *   4. 解压出来的中文、emoji 逐字节一致（不劈代理对）。
 *
 * 全程离线：用 zlib 现场压一段文本再解，不依赖任何外部站点。
 */
import assert from 'node:assert/strict';
import { createBrotliCompress, createDeflate, createGzip } from 'node:zlib';
import { pickContentDecoder } from '../src/safe-fetch.js';

const SAMPLE = '【官方 MV】Never Gonna Give You Up —— 百度一下，你就知道 😀 混排 test';

async function decodeWith(encoding, compress) {
  const decoder = pickContentDecoder(encoding);
  assert.ok(decoder, `${encoding} 应当有解码器`);
  const source = compress();
  const out = [];
  await new Promise((resolve, reject) => {
    source.on('error', reject);
    decoder.on('error', reject);
    decoder.on('data', (chunk) => out.push(chunk));
    decoder.on('end', resolve);
    source.pipe(decoder);
  });
  return Buffer.concat(out).toString('utf8');
}

const cases = [
  ['gzip', createGzip],
  ['x-gzip', createGzip],
  ['deflate', createDeflate],
  ['br', createBrotliCompress],
];

for (const [encoding, compress] of cases) {
  const text = await decodeWith(encoding, () => {
    const c = compress();
    c.end(Buffer.from(SAMPLE, 'utf8'));
    return c;
  });
  assert.equal(text, SAMPLE, `${encoding} 解压结果应与原文一致`);
  console.log(`PASS ${encoding.padEnd(8)} 解压一致（${Buffer.byteLength(text, 'utf8')} 字节）`);
}

// 大小写与空白要能吃
assert.ok(pickContentDecoder('  GZIP '), '大小写/空白不敏感');
assert.ok(pickContentDecoder('x-GZip'), 'x-gzip 别名');
console.log('PASS 大小写与空白不敏感');

for (const encoding of [undefined, null, '', 'identity']) {
  assert.equal(pickContentDecoder(encoding), null, `${encoding} 不应套解码器`);
}
console.log('PASS identity / 空值 → 不套解码器');

for (const encoding of ['zstd', 'gzip, br', 'compress', 'gzip;q=1']) {
  assert.equal(pickContentDecoder(encoding), null, `${encoding} 应退回原始字节`);
}
console.log('PASS 未知编码 / 多重编码 → 退回原始字节');

console.log('\n全部通过');
