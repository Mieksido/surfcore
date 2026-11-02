// GIF 中间层测试（four stages：decode → sample → render → encode）。
//
// 这层是**纯 fail-open** 的：任何一步失败都必须让调用方拿回原图，所以失败分支的断言
// 和成功分支一样重要 —— 只测"能出图"，等于没测到它真正的价值（不阻断消息）。
//
// fixture 用 ffmpeg 现场生成（机器上必须有 ffmpeg；没有就整体跳过并打印说明），
// 不把二进制样本塞进仓库。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  animationHint,
  decode,
  sample,
  render,
  encode,
  toModelImages,
  buildEnvelope,
  fallbackNote,
  cacheStats,
  cacheClear,
  GIF_DEFAULTS
} from '../src/gif-middleware.js';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
function runFfmpeg(args) {
  const r = spawnSync(FFMPEG, args, { windowsHide: true, stdio: 'ignore' });
  return r.status === 0;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gif-mw-test-'));
const animGif = path.join(dir, 'anim.gif');
const stillGif = path.join(dir, 'still.gif');
const staticPng = path.join(dir, 'static.png');
const animWebp = path.join(dir, 'anim.webp');
const staticWebp = path.join(dir, 'static.webp');

const okFixtures = runFfmpeg(['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=540x540:rate=10:duration=1.2', animGif])
  && runFfmpeg(['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=orange:size=200x200:d=1', '-frames:v', '1', stillGif])
  && runFfmpeg(['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=teal:size=200x200:d=1', '-frames:v', '1', staticPng])
  && runFfmpeg(['-hide_banner', '-v', 'error', '-y', '-i', animGif, '-loop', '0', animWebp])
  && runFfmpeg(['-hide_banner', '-v', 'error', '-y', '-i', staticPng, staticWebp]);

if (!okFixtures) {
  console.log('⚠️  跳过 gif-middleware 测试：这台机器上没有可用的 ffmpeg（设置 FFMPEG_PATH 后再跑）');
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}

const read = (f) => fs.readFileSync(f);

// ── 1. animationHint：静态图片一次字节比较就排除，不能花 IO ──────────────────
assert.equal(animationHint(read(animGif), 'image/gif'), 'gif', 'GIF 应被判为动图候选');
assert.equal(animationHint(read(stillGif), 'image/gif'), 'gif', '单帧 GIF 也要先交给 decode 才能判（hint 只按容器判）');
assert.equal(animationHint(read(staticPng), 'image/png'), null, '静态 PNG 不该进 ffmpeg');
assert.equal(animationHint(read(staticWebp), 'image/webp'), null, '静态 WebP 没有 ANIM 块，不该进 ffmpeg');
assert.equal(animationHint(read(animWebp), 'image/webp'), 'webp', '动画 WebP 应被识别');
assert.equal(animationHint(Buffer.alloc(4), 'image/gif'), null, '过短的字节不能崩');

// ── 2. decode：帧数/尺寸/时长 ───────────────────────────────────────────────
const dec = await decode(read(animGif));
assert.equal(dec.ok, true, 'decode 应成功');
assert.equal(dec.meta.frames, 12, '12 帧的 GIF 应数出 12 帧');
assert.equal(dec.meta.width, 540, '宽度应为 540');
assert.equal(dec.meta.height, 540, '高度应为 540');
assert.ok(dec.meta.duration > 1 && dec.meta.duration < 1.4, `时长应约 1.2 秒，实得 ${dec.meta.duration}`);

const decStill = await decode(read(stillGif));
assert.equal(decStill.ok, true, '单帧 GIF 也能被探测');
assert.equal(decStill.meta.frames, 1, '单帧 GIF 的帧数应为 1');

const decBad = await decode(Buffer.from('GIF89a not really a gif at all'));
assert.equal(decBad.ok, false, '坏数据必须返回 ok:false，不能抛异常');
assert.ok(typeof decBad.reason === 'string' && decBad.reason.length > 0, '失败必须带可读的 reason');

// ── 3. sample：用户定的 16 帧 4×4，帧数不够就全给 ───────────────────────────
const plan34 = sample({ frames: 34, duration: 3.4 });
assert.equal(plan34.frames, 16, '34 帧的图应采样 16 帧');
assert.equal(plan34.cols, 4, '默认 4 列');
assert.equal(plan34.rows, 4, '16 帧应排成 4 行');
assert.equal(plan34.maxEdge, 240, '默认每格长边 240');
assert.equal(plan34.step, 2, '34 → 16，每格大约隔 2 帧');

const plan12 = sample(dec.meta);
assert.equal(plan12.frames, 12, '帧数少于目标值时应该全给（12 帧 → 12 帧）');
assert.equal(plan12.rows, 3, '12 帧 4 列应排 3 行');

const planHuge = sample({ frames: 500, duration: 50 }, { maxEdge: 720, frames: 64 });
assert.ok(planHuge.rows * planHuge.cols * planHuge.maxEdge * planHuge.maxEdge <= 1_400_000,
  `总像素应被压到预算内，实得 ${planHuge.rows * planHuge.cols * planHuge.maxEdge ** 2}`);

// ── 4. render：只产出一张 JPEG，中间帧不落盘 ────────────────────────────────
const rendered = await render(read(animGif), plan12);
assert.equal(rendered.ok, true, `render 应成功，实得 ${rendered.reason || ''}`);
assert.ok(rendered.buffer.length > 1000, '胶片条不该是空文件');
assert.ok(rendered.width >= 4 * 240, `宽度应至少 4 列 × 240，实得 ${rendered.width}`);
assert.ok(rendered.height > 0, '高度应可解析（从 JPEG 头读出，不额外起 ffprobe）');
assert.equal(rendered.buffer[0], 0xff, '产物应是 JPEG（SOI 0xFFD8）');
assert.equal(rendered.buffer[1], 0xd8, '产物应是 JPEG（SOI 0xFFD8）');

// ── 5. toModelImages：完整编排 + 缓存 + 信封 ────────────────────────────────
cacheClear();
const first = await toModelImages(read(animGif), 'image/gif');
assert.equal(first.ok, true, `toModelImages 应成功，实得 ${first.reason || ''}`);
assert.equal(first.images.length, 1, '一条动图只产出一张图（不是 N 张）');
assert.equal(first.images[0].mimeType, 'image/jpeg', '产物是 JPEG');
assert.ok(first.images[0].data.length > 1000, 'base64 内容非空');
const decoded = Buffer.from(first.images[0].data, 'base64');
assert.equal(decoded[0], 0xff, 'base64 解回来应是 JPEG');
assert.ok(/12/.test(first.envelope), `信封应写明原图帧数，实得：${first.envelope}`);
assert.ok(/帧/.test(first.envelope), '信封应含"帧"字');
assert.ok(/4×3|4x3/.test(first.envelope), `信封应写明网格，实得：${first.envelope}`);

const second = await toModelImages(read(animGif), 'image/gif');
assert.equal(second.cached, true, '同一份字节第二次应命中内存缓存');
assert.equal(second.images[0].data, first.images[0].data, '缓存命中应返回同一份胶片条');
assert.equal(cacheStats().entries, 1, '缓存里应只有一条');

// ── 6. 失败分支全部 fail-open（调用方要能原样退回首帧）──────────────────────
const png = await toModelImages(read(staticPng), 'image/png');
assert.equal(png.ok, false, '静态 PNG 不该被展开');
assert.equal(png.reason, 'static', '静态图的原因应是 static');

const single = await toModelImages(read(stillGif), 'image/gif');
assert.equal(single.ok, false, '单帧 GIF 不该被展开');
assert.equal(single.reason, 'static', '单帧 GIF 也应判 static（不是错误）');

const off = await toModelImages(read(animGif), 'image/gif', { enabled: false });
assert.equal(off.ok, false, '关闭开关后不该展开');
assert.equal(off.reason, 'disabled', '关闭原因应是 disabled');

const tiny = await toModelImages(read(animGif), 'image/gif', { maxInputBytes: 1024 });
assert.equal(tiny.ok, false, '超过体积上限不该展开');
assert.equal(tiny.reason, 'too-large', '超限原因应是 too-large');

const cap = await toModelImages(read(animGif), 'image/gif', { maxFrames: 5 });
assert.equal(cap.ok, false, '帧数超上限不该展开');
assert.equal(cap.reason, 'too-many-frames', '超帧原因应是 too-many-frames');

cacheClear();
const broken = await toModelImages(Buffer.from('GIF89a garbage that ffmpeg cannot read'), 'image/gif');
assert.equal(broken.ok, false, '坏数据必须返回 ok:false');
assert.ok(typeof broken.reason === 'string' && broken.reason.length > 0, '坏数据也要有 reason');

// ── 7. 编码阶段：结构留着，但明确未实现 ─────────────────────────────────────
const enc = encode(Buffer.from([0xff, 0xd8]));
assert.equal(enc.ok, false, 'encode 当前必须是 not-implemented');
assert.equal(enc.reason, 'not-implemented', 'encode 的原因应是 not-implemented');

// ── 8. 文字兜底与信封不撒谎 ─────────────────────────────────────────────────
assert.equal(fallbackNote('static'), '', '静态图不该加"展开失败"的话');
assert.equal(fallbackNote('disabled'), '', '关闭开关时也不该加话');
assert.ok(fallbackNote('too-large', { frames: 34 }).includes('34'), '超体积时提示应带上原图帧数');
assert.ok(buildEnvelope({ frames: 40, duration: 4, fps: 10, width: 480, height: 480 }, { frames: 16, cols: 4, rows: 4, maxEdge: 240, step: 3 }, { width: 964, height: 964, bytes: 200000 })
  .includes('40'), '信封要写原始帧数');

// ── 9. 临时文件必须清干净（中间帧不落盘）───────────────────────────────────
const tmpGifDir = path.join(os.tmpdir(), 'surfcore-gif');
if (fs.existsSync(tmpGifDir)) {
  assert.equal(fs.readdirSync(tmpGifDir).length, 0, `中间层不该留下临时文件，实得：${fs.readdirSync(tmpGifDir).join(', ')}`);
}

assert.ok(GIF_DEFAULTS.frames === 16 && GIF_DEFAULTS.cols === 4 && GIF_DEFAULTS.maxEdge === 240,
  '默认档位应是 16 帧 4×4 每格 240（用户定的）');

fs.rmSync(dir, { recursive: true, force: true });
console.log('✅ GIF 中间层通过（解码/采样/渲染/缓存 + 6 条 fail-open 分支）');
