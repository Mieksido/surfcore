/**
 * 识图端口测试（纯函数；字节由假 reader 注入）
 * 跑法：node kernel/expression/vision.test.mjs
 */
import { VISION_LIMITS, sniffImageMime, buildVisionParts } from './vision.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const GIF = Buffer.from('GIF89a____', 'latin1');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);
const BMP = Buffer.from([0x42, 0x4d, 0, 0]);

console.log('## 从文件头认格式（不看扩展名）');
{
  ok(sniffImageMime(PNG) === 'image/png', 'PNG');
  ok(sniffImageMime(JPG) === 'image/jpeg', 'JPEG');
  ok(sniffImageMime(GIF) === 'image/gif', 'GIF');
  ok(sniffImageMime(WEBP) === 'image/webp', 'WEBP');
  ok(sniffImageMime(BMP) === 'image/bmp', 'BMP');
  ok(sniffImageMime(Buffer.from('hello')) === null, '不是图片：null');
  ok(sniffImageMime(Buffer.alloc(0)) === null, '空：null');
  ok(sniffImageMime(null) === null, 'null：null');
}

console.log('\n## 变成模型内容段');
{
  const out = buildVisionParts([
    { id: 'a', kind: 'image', caption: '猫' },
    { id: 'b', kind: 'audio', caption: '语音' },
  ], { readBytes: (id) => (id === 'a' ? PNG : null) });

  ok(out.parts.length === 1, '只给图片，不给语音');
  ok(out.parts[0].type === 'image_url', 'OpenAI 兼容的 image_url 段');
  ok(out.parts[0].image_url.url.startsWith('data:image/png;base64,'), 'data URL + png');
  ok(out.used[0].id === 'a' && out.used[0].mime === 'image/png', 'used 里记 id/mime');
  ok(out.dropped.length === 0, '没有丢失');
  ok(VISION_LIMITS.maxImages === 2 && VISION_LIMITS.maxBytes === 5 * 1024 * 1024, '默认上限：2 张 / 5MB');
}

console.log('\n## 读不到 / 太大 / 格式不认：丢掉并说原因');
{
  const out = buildVisionParts([
    { id: 'missing', kind: 'image' },
    { id: 'big', kind: 'image' },
    { id: 'text', kind: 'image' },
    { id: 'audio', kind: 'audio' },
  ], {
    readBytes: (id) => {
      if (id === 'big') return Buffer.alloc(200);
      if (id === 'text') return Buffer.from('not an image');
      if (id === 'audio') return PNG;
      return null;
    },
    maxBytes: 100,
  });

  ok(out.parts.length === 0, '一张都没交出去');
  ok(out.dropped.find((d) => d.id === 'missing')?.reason === 'unreadable', '读不到：unreadable');
  ok(out.dropped.find((d) => d.id === 'big')?.reason === 'too-large', '太大：too-large');
  ok(out.dropped.find((d) => d.id === 'text')?.reason === 'unsupported-format', '格式不认：unsupported-format');
  ok(!out.dropped.some((d) => d.id === 'audio'), '非图片不报"丢失"（它本来就不该进来）');
}

console.log('\n## 张数上限 / 没 reader');
{
  const out = buildVisionParts([
    { id: '1', kind: 'image' }, { id: '2', kind: 'image' }, { id: '3', kind: 'image' },
  ], { readBytes: () => PNG, maxImages: 2 });
  ok(out.parts.length === 2, '最多 2 张');
  ok(out.dropped.find((d) => d.id === '3')?.reason === 'too-many', '第 3 张：too-many');

  const noReader = buildVisionParts([{ id: 'x', kind: 'image' }], {});
  ok(noReader.parts.length === 0 && noReader.dropped[0].reason === 'no-reader', '没有 reader：不假装看见了');

  ok(buildVisionParts([]).parts.length === 0, '没有媒体：空');
  ok(buildVisionParts(null).parts.length === 0, 'null 也不炸');
}

console.log('\n## reader 抛错不炸');
{
  const out = buildVisionParts([{ id: 'x', kind: 'image' }], { readBytes: () => { throw new Error('磁盘坏了'); } });
  ok(out.parts.length === 0 && out.dropped[0].reason === 'unreadable', 'reader 抛错：当读不到');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
