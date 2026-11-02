// GIF 中间层（four stages）：把「动图」变成模型真正看得懂的东西。
//
// 背景：DSH 的附件服务会把任何图片归一化成**单帧** 8 位 sRGB（`@deepseek-ai/dsh-attachment-local`
// 的直通判定明确排除 image/gif，重编码也从不设置 animated/page），于是模型拿到一条 GIF 表情包
// 时只能看到第一帧 —— 后面的动作全丢。桥接这边其实**有原始字节**（`fetchMediaData` 返回
// base64），所以在字节进 DSH 之前把它们展开成一张「带帧号标注的胶片条」，是目前唯一缝合点。
//
// 四个阶段（用户定的架构，别压回一个函数）：
//   1. decode(buf, mime)           —— ffprobe 判是不是动图、多少帧、多快、宽度高度
//   2. sample(meta, opts)          —— 均匀采样 + 算出网格/缩放（"关键帧"在这里就是等间隔帧）
//   3. render(src, plan)           —— 一次 ffmpeg 滤滤镜链出 JPEG 胶片条（中间帧不落盘）
//   4. encode(filmstrip, opts)     —— 预留给"回发/合成动图"，当前 return not-implemented
//
// 设计约束（都是踩过的坑）：
// - **不引入 sharp/图像库**：仓库里已有 ffmpeg 先例（voice-core 的 resolveFfmpeg），新增原生依赖
//   会让 Windows 安装变脆。
// - **产物只有一张**：8 帧分别塞给模型会一次性把附件库里塞 8 张图，且 token 反而更贵。
// - **输出 JPEG 而不是 PNG**：GIF 的调色板抖动在 PNG 里几乎不压缩（1280×640 要 1.6MB），
//   JPEG q4 只要 190KB，视觉模型不看无损。
// - **完全 fail-open**：ffmpeg 缺失/超时/格式不认识/图太大 → 一律返回 { ok:false }，
//   调用方原样返回首帧，绝不因为中间层挂掉而让整条消息拿不到图。
// - **ffprobe/ffmpeg 输出走临时文件**（不吃 pipe）：受限沙箱下 spawn 的 pipe 会 EPERM，
//   这和 `voice-core.js` 的 `probeAudio` 是同一套写法。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolveFfmpeg } from './voice-core.js';

/** 默认配置。全部可被 config.json 的 socialV2.gif 覆盖。 */
export const GIF_DEFAULTS = Object.freeze({
  enabled: true,
  // 采样档位：用户定的 16 帧 4×4、每格长边 240。帧数不够时自动退 4×N。
  frames: 16,
  maxEdge: 240,
  cols: 4,
  quality: 4, // ffmpeg -q:v：2 最好、31 最差；4 ≈ JPEG q80
  maxInputBytes: 32 * 1024 * 1024,
  maxFrames: 600, // 超过就当长视频，不展开（5 秒 10fps 的 GIF 才 50 帧，600 帧已经离谱）
  timeoutMs: 5000,
  cacheEntries: 48,
  cacheBytes: 24 * 1024 * 1024,
  label: true, // 是否在每格角上打帧号（没有可用字体时自动降级成无标注）
  ffmpegPath: null,
  ffprobePath: null
});

const TMP_DIR_NAME = 'surfcore-gif';

function cfgWithDefaults(raw) {
  const out = { ...GIF_DEFAULTS };
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      if (v === undefined || v === null) continue;
      if (k in GIF_DEFAULTS) out[k] = v;
    }
  }
  out.frames = clampInt(out.frames, 2, 64, GIF_DEFAULTS.frames);
  out.maxEdge = clampInt(out.maxEdge, 64, 720, GIF_DEFAULTS.maxEdge);
  out.cols = clampInt(out.cols, 2, 8, GIF_DEFAULTS.cols);
  out.quality = clampInt(out.quality, 2, 31, GIF_DEFAULTS.quality);
  out.maxInputBytes = clampInt(out.maxInputBytes, 1024, 128 * 1024 * 1024, GIF_DEFAULTS.maxInputBytes);
  out.maxFrames = clampInt(out.maxFrames, 2, 10000, GIF_DEFAULTS.maxFrames);
  out.timeoutMs = clampInt(out.timeoutMs, 500, 60000, GIF_DEFAULTS.timeoutMs);
  out.cacheEntries = clampInt(out.cacheEntries, 0, 512, GIF_DEFAULTS.cacheEntries);
  out.cacheBytes = clampInt(out.cacheBytes, 0, 512 * 1024 * 1024, GIF_DEFAULTS.cacheBytes);
  out.enabled = out.enabled !== false;
  out.label = out.label !== false;
  return out;
}

function clampInt(v, min, max, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// ── 阶段 0：要不要交给 ffmpeg ────────────────────────────────────────────────
// 只做几次字节比较，零 IO。静态图片（绝大多数）连一毫秒都不花。
export function animationHint(buf, mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  if (!Buffer.isBuffer(buf) || buf.length < 16) return null;
  const head = buf.subarray(0, 16).toString('latin1');
  if (mime === 'image/gif' || head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'gif';
  // 动画 WebP 才带 ANIM 块；静态 WebP 只带 VP8/VP8L/VP8X。PNG 的动画标记是 acTL。
  const probeLen = Math.min(buf.length, 128 * 1024);
  const slice = buf.subarray(0, probeLen).toString('latin1');
  if (mime === 'image/webp' || (head.startsWith('RIFF') && head.includes('WEBP'))) {
    return slice.includes('ANIM') ? 'webp' : null;
  }
  if (mime === 'image/apng' || mime === 'image/png' || head.includes('PNG')) {
    return slice.includes('acTL') ? 'apng' : null;
  }
  return null;
}

// ── ffmpeg / ffprobe 定位 ───────────────────────────────────────────────────
export function resolvePaths(opts = {}) {
  const ffmpeg = resolveFfmpeg({ ffmpegPath: opts.ffmpegPath || null });
  const cands = [opts.ffprobePath, process.env.FFPROBE_PATH].filter(Boolean);
  if (opts.ffmpegPath && /ffmpeg(\.exe)?$/i.test(String(opts.ffmpegPath))) {
    cands.push(String(opts.ffmpegPath).replace(/ffmpeg(\.exe)?$/i, (m) => (/\.exe$/i.test(m) ? 'ffprobe.exe' : 'ffprobe')));
  }
  let ffprobe = 'ffprobe';
  for (const c of cands) {
    try {
      if (fs.statSync(c).isFile()) { ffprobe = c; break; }
    } catch {}
  }
  return { ffmpeg, ffprobe };
}

// ── 子进程：输出写文件，stdio 全 ignore（受限沙箱下 pipe 会 EPERM）───────────
function runToFile(bin, args, timeoutMs, { stderrFile = null } = {}) {
  return new Promise((resolve) => {
    let child;
    let fd = null;
    const closeFd = () => { if (fd !== null) { try { fs.closeSync(fd); } catch {} fd = null; } };
    try {
      let stdio = 'ignore';
      if (stderrFile) {
        // stderr 重定向到**文件**而不是管道：受限沙箱下 spawn 的 pipe 会 EPERM。
        fd = fs.openSync(stderrFile, 'w');
        stdio = ['ignore', 'ignore', fd];
      }
      child = spawn(bin, args, { windowsHide: true, stdio });
    } catch (error) {
      closeFd();
      resolve({ code: -1, error: `启动失败：${error?.message ?? error}` });
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      closeFd();
      resolve({ code: -2, error: '超时' });
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      closeFd();
      resolve({ code: -1, error: e.code === 'ENOENT' ? `找不到 ${bin}` : e.message });
    });
    child.on('close', (code) => { clearTimeout(timer); closeFd(); resolve({ code }); });
  });
}

function ensureTmpDir() {
  const dir = path.join(os.tmpdir(), TMP_DIR_NAME);
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}

function tmpName(dir, ext) {
  return path.join(dir, `g-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
}

// ── 阶段 1：解码元信息 ──────────────────────────────────────────────────────
/**
 * 探测动图元信息。返回 { ok:true, meta } 或 { ok:false, reason }。
 * meta: { frames, width, height, fps, duration, loop, format, bytes }
 */
export async function decode(input, opts = {}) {
  const cfg = cfgWithDefaults(opts);
  const { ffprobe, ffmpeg } = resolvePaths({ ffmpegPath: cfg.ffmpegPath, ffprobePath: cfg.ffprobePath });
  const buf = Buffer.isBuffer(input) ? input : null;
  const srcPath = buf ? null : String(input || '');
  if (!buf && !srcPath) return { ok: false, reason: '空输入' };
  if (buf && buf.length === 0) return { ok: false, reason: '空输入' };
  if (buf && buf.length > cfg.maxInputBytes) {
    return { ok: false, reason: `文件过大（${buf.length} > ${cfg.maxInputBytes}）` };
  }

  const dir = ensureTmpDir();
  let inFile = srcPath && fs.existsSync(srcPath) ? srcPath : null;
  const metaFile = tmpName(dir, '.json');
  const cleanup = [];
  try {
    if (!inFile && buf) {
      inFile = tmpName(dir, '.gif');
      fs.writeFileSync(inFile, buf);
      cleanup.push(inFile);
    }
    cleanup.push(metaFile);

    const res = await runToFile(ffprobe, [
      '-v', 'error',
      '-count_frames',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,codec_name,nb_read_frames,avg_frame_rate,r_frame_rate,duration',
      '-show_entries', 'format=format_name,duration',
      '-of', 'json', '-o', metaFile, inFile
    ], Math.min(cfg.timeoutMs, 4000));

    if (res.error) {
      // ffprobe 不可用（常见：只装了 ffmpeg）→ 用 ffmpeg 自己数帧，别直接放弃。
      if (/找不到|ENOENT/.test(String(res.error))) return await decodeWithFfmpeg(ffmpeg, inFile, cfg);
      return { ok: false, reason: `ffprobe ${res.error}` };
    }

    let raw = '';
    try { raw = fs.readFileSync(metaFile, 'utf8'); } catch { /* 走 ffmpeg 兜底 */ }
    if (raw.trim()) {
      const j = JSON.parse(raw);
      const s = Array.isArray(j.streams) ? j.streams[0] || {} : {};
      const frames = Number(s.nb_read_frames) || 0;
      const width = Number(s.width) || 0;
      const height = Number(s.height) || 0;
      // ffprobe 对"不是图片的字节"可能写出空 JSON，也可能从随机头里读出荒谬尺寸（GIF 头
      // 就是随机字节，能拼出 28192x29807 这种鬼数字），两种都不算探测成功 → 交给 ffmpeg 兜底。
      if (!frames || !saneSize(width, height)) return await decodeWithFfmpeg(ffmpeg, inFile, cfg);
      const duration = Number(j.format?.duration) || Number(s.duration) || 0;
      const fps = parseRate(s.avg_frame_rate) || parseRate(s.r_frame_rate) || (frames && duration ? frames / duration : 0);
      return {
        ok: true,
        meta: {
          frames,
          width,
          height,
          fps: round2(fps),
          duration: round2(duration),
          format: String(j.format?.format_name || s.codec_name || ''),
          codec: String(s.codec_name || ''),
          bytes: buf ? buf.length : safeSize(inFile)
        }
      };
    }
    return await decodeWithFfmpeg(ffmpeg, inFile, cfg);
  } catch (error) {
    return { ok: false, reason: `探测失败：${error?.message ?? error}` };
  } finally {
    for (const f of cleanup) { try { fs.unlinkSync(f); } catch {} }
  }
}

/**
 * ffprobe 不在时的兜底：`ffmpeg -i in -f null -` 的 stderr 里有 Duration / 分辨率 / fps，
 * 再读一遍解码进度里的 `frame=` 拿真实帧数。两件事分两步做，避免一个正则吃掉全部信息。
 */
async function decodeWithFfmpeg(ffmpeg, inFile, cfg) {
  const dir = ensureTmpDir();
  const logFile = tmpName(dir, '.log');
  try {
    const res = await runToFile(
      ffmpeg,
      ['-hide_banner', '-i', inFile, '-map', '0:v:0', '-f', 'null', '-'],
      Math.min(cfg.timeoutMs, 4000),
      { stderrFile: logFile }
    );
    if (res.error && res.code === -1) return { ok: false, reason: `ffmpeg ${res.error}` };
    let text = '';
    try { text = fs.readFileSync(logFile, 'utf8'); } catch {}
    // 这种兜底只求"能判断是不是动图 + 有多少帧"，判不出来就退回静态。
    const frames = matchInt(text, /frame=\s*(\d+)/g);
    const duration = matchFloat(text, /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    const wh = text.match(/(\d{2,5})x(\d{2,5})/);
    if (!wh) return { ok: false, reason: 'ffmpeg 无法解析该动图' };
    const width = wh ? Number(wh[1]) : 0;
    const height = wh ? Number(wh[2]) : 0;
    // 坏字节同样会在这里"碰巧"拼出尺寸，所以兜底路径也要卡范围。
    if (!saneSize(width, height)) return { ok: false, reason: `ffmpeg 报出的尺寸不合理（${width}x${height}）` };
    return {
      ok: true,
      meta: {
        frames: frames || 1,
        width,
        height,
        fps: frames && duration ? round2(frames / duration) : 0,
        duration: round2(duration),
        format: 'unknown',
        codec: 'unknown',
        bytes: safeSize(inFile),
        degraded: true
      }
    };
  } finally {
    try { fs.unlinkSync(logFile); } catch {}
  }
}

function parseRate(v) {
  const s = String(v ?? '');
  const m = s.match(/^(\d+)\/(\d+)$/);
  if (!m) { const n = Number(s); return Number.isFinite(n) ? n : 0; }
  const d = Number(m[2]);
  return d ? Number(m[1]) / d : 0;
}
function round2(n) { return Math.round(Number(n) * 100) / 100; }
/** 尺寸合理性：GIF 理论上能到 65535，但超过 16384 的"图"几乎一定是坏字节拼出来的。 */
function saneSize(w, h) {
  return Number.isFinite(w) && Number.isFinite(h) && w >= 16 && h >= 16 && w <= 16384 && h <= 16384;
}
function safeSize(f) { try { return fs.statSync(f).size; } catch { return 0; } }
function matchInt(text, re) {
  let max = 0, m;
  while ((m = re.exec(text))) max = Math.max(max, Number(m[1]) || 0);
  return max;
}
function matchFloat(text, re) {
  const m = String(text).match(re);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

// ── 阶段 2：采样计划 ────────────────────────────────────────────────────────
/**
 * 决定采样多少帧、拼成几行几列、每格多大。
 * 帧数不够就全给（不做插值），像素总量超预算就缩边长。
 */
export function sample(meta, opts = {}) {
  const cfg = cfgWithDefaults(opts);
  const total = Math.max(0, Number(meta?.frames) || 0);
  const cols = cfg.cols;
  const want = total > 0 && total <= cfg.frames ? total : cfg.frames;
  const rows = Math.max(1, Math.ceil(want / cols));
  // 总像素上限：16×240² = 921,600；1.4M 是"再大就纯烧 token"的经验线。
  let maxEdge = cfg.maxEdge;
  const budgetPx = 1_400_000;
  while (rows * cols * maxEdge * maxEdge > budgetPx && maxEdge > 80) maxEdge -= 16;
  const step = total && want ? total / want : 1;
  return {
    frames: want,
    cols,
    rows,
    maxEdge,
    sourceFrames: total,
    // 每格对应的源帧编号（1 基），用于在角上标注；最后可能重复，去重后交给 drawtext 没意义，
    // 所以只在"帧数够"时才标。
    step: Math.max(1, Math.round(step)),
    durationMs: Math.round((Number(meta?.duration) || 0) * 1000)
  };
}

// ── 阶段 3：渲染胶片条 ──────────────────────────────────────────────────────
/**
 * 一次性出图：抽帧 → 缩放 → 拼贴 → JPEG。中间帧不落盘，只有最终成品写一个临时文件。
 * 返回 { ok:true, buffer, width, height, ms } 或 { ok:false, reason }。
 */
export async function render(src, plan, opts = {}) {
  const cfg = cfgWithDefaults(opts);
  const { ffmpeg } = resolvePaths({ ffmpegPath: cfg.ffmpegPath, ffprobePath: cfg.ffprobePath });
  const dir = ensureTmpDir();
  const startedAt = Date.now();

  const buf = Buffer.isBuffer(src) ? src : null;
  if (!buf && !(typeof src === 'string' && fs.existsSync(src))) return { ok: false, reason: '源文件不存在' };

  let inFile = buf ? tmpName(dir, '.gif') : String(src);
  const outFile = tmpName(dir, '.jpg');
  const cleanup = [outFile];
  try {
    if (buf) { fs.writeFileSync(inFile, buf); cleanup.push(inFile); }

    const total = Math.max(1, Number(plan.sourceFrames) || plan.frames);
    const duration = Number(plan.durationMs) / 1000;
    // 采样：fps = 目标帧数 / 时长（等间隔）。时长未知就退回"每 K 帧取一帧"。
    let sampleFilter;
    if (duration > 0.05) {
      sampleFilter = `fps=${plan.frames}/${duration.toFixed(3)}`;
    } else {
      const k = Math.max(1, Math.round(total / plan.frames));
      sampleFilter = `select='not(mod(n\\,${k}))'`;
    }
    const grid = `scale=${plan.maxEdge}:-2:flags=lanczos,tile=${plan.cols}x${plan.rows}:padding=4:margin=4:color=0x101010`;
    const label = `drawtext=text='%{eif\\:n*${plan.step}\\:d}':x=6:y=6:fontsize=16:fontcolor=yellow:box=1:boxcolor=black@0.65`;
    const mkArgs = (vf) => [
      '-hide_banner', '-v', 'error', '-y',
      '-i', inFile,
      '-vf', vf,
      '-frames:v', '1',
      '-q:v', String(cfg.quality),
      outFile
    ];

    let res;
    if (cfg.label) {
      // drawtext 依赖 fontconfig：没装字体的机器上滤镜会整体失败，所以先带标注试一次，
      // 失败再退回无标注版本（宁可少个帧号，也不能没有图）。
      res = await runToFile(ffmpeg, mkArgs(`${sampleFilter},${grid},${label}`), cfg.timeoutMs);
      if (res.error || !fs.existsSync(outFile)) {
        try { fs.unlinkSync(outFile); } catch {}
        res = await runToFile(ffmpeg, mkArgs(`${sampleFilter},${grid}`), cfg.timeoutMs);
      }
    } else {
      res = await runToFile(ffmpeg, mkArgs(`${sampleFilter},${grid}`), cfg.timeoutMs);
    }

    if (res.error) return { ok: false, reason: `ffmpeg ${res.error}` };
    if (!fs.existsSync(outFile)) return { ok: false, reason: `ffmpeg 退出码 ${res.code} 且没产出文件` };
    const out = fs.readFileSync(outFile);
    if (!out.length) return { ok: false, reason: 'ffmpeg 产出空文件' };
    const dims = jpegSize(out);
    return {
      ok: true,
      buffer: out,
      width: dims.width,
      height: dims.height,
      bytes: out.length,
      ms: Date.now() - startedAt
    };
  } catch (error) {
    return { ok: false, reason: `渲染失败：${error?.message ?? error}` };
  } finally {
    for (const f of cleanup) { try { fs.unlinkSync(f); } catch {} }
  }
}

/** 从 JPEG 头部读宽高（避免为了两个数字再起一次 ffprobe）。 */
function jpegSize(buf) {
  try {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  } catch {}
  return { width: 0, height: 0 };
}

// ── 阶段 4：编码 ────────────────────────────────────────────────────────────
/**
 * 把胶片条（或多帧）重新编码成动图/视频。
 *
 * **当前故意不实现**：桥接发送侧还没有「图片段」通路（发图是另一件事，见 /api/send 系列），
 * 所以这一步没有任何触发点。保留函数签名是为了让四段式结构在代码里真实存在——
 * 等哪天要做「把胶片条发回群里」或「把 16 帧合成动图」，只需要填这里，不动前三个阶段。
 */
export function encode() {
  return { ok: false, reason: 'not-implemented', hint: '发送侧还没有图片段通路，编码阶段暂未启用' };
}

// ── 缓存：只放内存，永不落盘 ────────────────────────────────────────────────
const cache = new Map(); // key → { value, bytes, at }
let cacheBytes = 0;

function cacheGet(key, cfg) {
  if (!cfg.cacheEntries || !cfg.cacheBytes) return null;
  const hit = cache.get(key);
  if (!hit) return null;
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

function cacheSet(key, value, bytes, cfg) {
  if (!cfg.cacheEntries || !cfg.cacheBytes) return;
  if (bytes > cfg.cacheBytes) return;
  cache.set(key, { value, bytes, at: Date.now() });
  cacheBytes += bytes;
  while (cache.size > cfg.cacheEntries || cacheBytes > cfg.cacheBytes) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    const evicted = cache.get(oldest.value);
    cache.delete(oldest.value);
    cacheBytes -= evicted?.bytes || 0;
  }
}

export function cacheStats() {
  return { entries: cache.size, bytes: cacheBytes };
}

export function cacheClear() {
  cache.clear();
  cacheBytes = 0;
}

// ── 编排：一个动图 → 一条文字信封 + 一张胶片条 ──────────────────────────────
/**
 * @param {Buffer} buf          原始字节
 * @param {string} mimeType     image/gif、image/webp、image/apng…
 * @param {object} rawCfg       config.json 的 socialV2.gif（可空）
 * @returns {Promise<{ok:true, envelope:string, images:Array, meta:object, plan:object, cached?:boolean}
 *                 | {ok:false, reason:string, hint?:string}>}
 */
export async function toModelImages(buf, mimeType, rawCfg = {}) {
  const cfg = cfgWithDefaults(rawCfg);
  if (!cfg.enabled) return { ok: false, reason: 'disabled', hint: 'socialV2.gif.enabled=false' };
  if (!Buffer.isBuffer(buf) || buf.length === 0) return { ok: false, reason: 'empty' };
  if (buf.length > cfg.maxInputBytes) return { ok: false, reason: 'too-large' };
  if (!animationHint(buf, mimeType)) return { ok: false, reason: 'static' };

  // 缓存键要带采样参数：改了帧数/边长/质量就该重出一张，不能把旧胶片条当成新配置的结果。
  const key = crypto.createHash('sha256')
    .update(buf)
    .update(`|${cfg.frames}|${cfg.maxEdge}|${cfg.cols}|${cfg.quality}|${cfg.label}`)
    .digest('hex');
  const cached = cacheGet(key, cfg);
  if (cached) {
    // 命中缓存也得重新过一遍上限校验（这次的 maxFrames 可能被调小了）。
    if (cached.ok && cached.meta && cached.meta.frames > cfg.maxFrames) {
      return { ok: false, reason: 'too-many-frames', meta: cached.meta, hint: `帧数 ${cached.meta.frames} 超过上限 ${cfg.maxFrames}` };
    }
    return { ...cached, cached: true };
  }

  const dec = await decode(buf, cfg);
  if (!dec.ok) return { ok: false, reason: dec.reason };
  const meta = dec.meta;
  if (!meta.frames || meta.frames <= 1) {
    const miss = { ok: false, reason: 'static', meta };
    cacheSet(key, miss, 0, cfg);
    return miss;
  }
  if (meta.frames > cfg.maxFrames) {
    return { ok: false, reason: 'too-many-frames', meta, hint: `帧数 ${meta.frames} 超过上限 ${cfg.maxFrames}` };
  }

  const plan = sample(meta, cfg);
  const out = await render(buf, plan, cfg);
  if (!out.ok) return { ok: false, reason: out.reason, meta, plan };

  const value = {
    ok: true,
    envelope: buildEnvelope(meta, plan, out),
    images: [{ mimeType: 'image/jpeg', data: out.buffer.toString('base64') }],
    meta,
    plan
  };
  cacheSet(key, value, out.bytes, cfg);
  return value;
}

/** 给模型看的一行"信封"：它必须能自己解释清楚"这是一张网格图，不是一张完整的画"。 */
export function buildEnvelope(meta, plan, out) {
  const parts = [];
  const frames = Number(meta.frames) || 0;
  const shown = Math.min(plan.frames, frames || plan.frames);
  parts.push(`【动图】原图 ${frames} 帧 / ${meta.duration ? meta.duration + ' 秒' : '时长未知'}${meta.fps ? ' / ' + meta.fps + 'fps' : ''}`);
  parts.push(`已均匀采样 ${shown} 帧拼成 ${plan.cols}×${plan.rows} 网格（每格长边 ${plan.maxEdge}px，从上到下、从左到右按时间先后排列${plan.step > 1 ? `，每格间隔约 ${plan.step} 帧` : ''}）`);
  if (meta.width && meta.height) parts.push(`原始尺寸 ${meta.width}×${meta.height}`);
  if (out?.bytes) parts.push(`胶片条 ${out.width}×${out.height} / ${Math.round(out.bytes / 1024)}KB`);
  return parts.join('；');
}

/** 失败时给调用方一句人话，附在原图前面，避免模型以为"这条动图就是一张静止画"。 */
export function fallbackNote(reason, meta) {
  if (!reason || reason === 'static' || reason === 'disabled') return '';
  const why = {
    'too-large': '文件太大',
    'too-many-frames': '帧数过多',
    'empty': '内容为空'
  }[reason] || String(reason);
  return `（动图展开失败：${why}，下面只有首帧${meta?.frames ? `，原图共 ${meta.frames} 帧` : ''}）`;
}
