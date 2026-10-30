// 长图切段（QQ 长截图 → 多张可读图片），2026-10-30。
//
// 背景：DSH 给模型喂图前有一道"图像准入 + 归一化"：
//   · 单边（宽或高）超过 8192 → 直接拒收，模型只看到
//     "[image unavailable: ... Image exceeds the configured per-side pixel limit]"
//     （QQ 长截图常见 1320×15000，必中）；
//   · 总像素超过 4,194,304 → 等比缩小到 4MP。长图被缩小后宽度只剩几百像素，
//     字全糊，等于"能收但看不清"。
// 所以桥接在把图片交给模型之前，先按"每段都落在准入/归一化预算内"的规则切段，
// 让模型按顺序读多张图 —— 这是唯一能真正看清长截图的办法（不裁剪/缩小就无解）。
//
// 本模块只做两件纯逻辑事：
//   1. planLongImageSlices()：根据原图尺寸算出"要不要切、怎么切"（不碰 IO）；
//   2. sliceImageWithPillow()：把切图计划交给本机 Pillow 执行（只依赖 fs/os/path，
//      `run` 由调用方注入，方便测试时替换成假进程）。
// 真实解码/缩放/重编码交给 Pillow（C 实现，1320×15000 约 1.7 秒；纯 JS 要几十秒）。
// 拿不到 Pillow 时调用方降级成一句可行动的说明，绝不静默失败。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 与 DSH 0.2.1-rc.2 的图像准入/归一化默认值对齐（可在 config.json 覆盖）。 */
export const LONG_IMAGE_DEFAULTS = Object.freeze({
  // DSH attachment 准入：任一单边不得超过（超过 = IMAGE_DIMENSION_TOO_LARGE）
  maxSide: 8192,
  // DSH 归一化预算：超过就被等比缩小（长图会糊到看不清）
  maxPixels: 4194304,
  // 单段高度上限：太高会吃满归一化预算，也会让模型多烧 token
  sliceMaxHeight: 3000,
  // 相邻段重叠：避免正好切在一行字/一张脸的中间
  sliceOverlapPx: 80,
  // 重编码质量（长截图多是文字，85 足够且体积可控）
  sliceQuality: 85,
  // 单张长图最多切几段（防止超长图把一次工具结果撑爆）
  sliceMaxCount: 12,
  // 只有"明显是长截图"才切：长宽比低于这个值的普通照片不切
  minAspectRatio: 2.5,
  // 段高下限（避免超宽图被切成一条条细缝）
  minSliceHeight: 256,
});

function positive(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeLimits(options = {}) {
  const d = LONG_IMAGE_DEFAULTS;
  return {
    maxSide: Math.round(Math.min(16384, Math.max(1024, positive(options.maxSide, d.maxSide)))),
    maxPixels: Math.round(Math.min(64_000_000, Math.max(1_000_000, positive(options.maxPixels, d.maxPixels)))),
    sliceMaxHeight: Math.round(Math.min(6000, Math.max(600, positive(options.sliceMaxHeight, d.sliceMaxHeight)))),
    sliceOverlapPx: Math.round(Math.min(400, Math.max(0, Number.isFinite(Number(options.sliceOverlapPx)) ? Number(options.sliceOverlapPx) : d.sliceOverlapPx))),
    sliceQuality: Math.round(Math.min(95, Math.max(40, positive(options.sliceQuality, d.sliceQuality)))),
    sliceMaxCount: Math.round(Math.min(20, Math.max(2, positive(options.sliceMaxCount, d.sliceMaxCount)))),
    minAspectRatio: Math.min(10, Math.max(1.2, positive(options.minAspectRatio, d.minAspectRatio))),
    minSliceHeight: Math.round(Math.min(1024, Math.max(64, positive(options.minSliceHeight, d.minSliceHeight)))),
  };
}

/**
 * 判断一张图要不要切段，要切就返回完整计划（纯函数，不碰 IO）。
 *
 * 触发条件（满足任一）：
 *   1. 单边超过 maxSide —— 模型侧会直接拒收，必须切；
 *   2. 总像素超过 maxPixels 且长宽比 ≥ minAspectRatio —— 不切就会被缩小到字看不清。
 *
 * 计划里的坐标是**缩放后**的坐标：宽超标的图先等比缩到 maxSide，再按行切。
 * @returns {null | {original:{width:number,height:number}, width:number, height:number,
 *   scale:number, quality:number, slices:Array<{y:number,h:number}>,
 *   reasons:string[], limits:object}}
 */
export function planLongImageSlices(width, height, options = {}) {
  const w0 = Math.round(Number(width));
  const h0 = Math.round(Number(height));
  if (!Number.isFinite(w0) || !Number.isFinite(h0) || w0 <= 0 || h0 <= 0) return null;
  const limits = normalizeLimits(options);
  const longSide = Math.max(w0, h0);
  const shortSide = Math.max(1, Math.min(w0, h0));
  const ratio = longSide / shortSide;

  const reasons = [];
  const tooWide = longSide > limits.maxSide;
  const tooManyPixels = w0 * h0 > limits.maxPixels && ratio >= limits.minAspectRatio;
  if (tooWide) reasons.push('side');
  if (tooManyPixels) reasons.push('pixels');
  if (!reasons.length) return null;

  // 只按**宽度**缩：切段是沿纵向切的，所以超高的图靠"切"解决，不是靠"缩"——
  // 把 1320x15378 整体缩到 703x8192 只会把字缩糊，正是这次要修的问题。
  const scale = w0 > limits.maxSide ? limits.maxSide / w0 : 1;
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));

  // 每段至少要落在 maxPixels 内；宽度越大，能容忍的段高越小。
  const budgetHeight = Math.floor(limits.maxPixels / w);
  const sliceHeight = Math.max(limits.minSliceHeight, Math.min(limits.sliceMaxHeight, budgetHeight));

  const slices = [];
  const step = Math.max(1, sliceHeight - limits.sliceOverlapPx);
  for (let y = 0; y < h && slices.length < limits.sliceMaxCount; y += step) {
    slices.push({ y, h: Math.min(sliceHeight, h - y) });
  }
  // 段数超上限：改均匀切，宁可每段高一点（仍然受单段预算约束的近似）。
  if (slices.length >= limits.sliceMaxCount && slices[slices.length - 1].y + slices[slices.length - 1].h < h) {
    const n = limits.sliceMaxCount;
    const even = Math.ceil(h / n);
    slices.length = 0;
    for (let i = 0; i < n; i += 1) {
      const y = i * even;
      if (y >= h) break;
      slices.push({ y, h: Math.min(even, h - y) });
    }
  }
  if (!slices.length) return null;
  // 兜底：最后一段必须盖到底部（重叠步进偶尔会差一行）。
  const last = slices[slices.length - 1];
  if (last.y + last.h < h) last.h = h - last.y;

  return {
    original: { width: w0, height: h0 },
    width: w,
    height: h,
    scale,
    quality: limits.sliceQuality,
    slices,
    reasons,
    limits,
  };
}

/** 计划是否只是"缩一下"（只宽超标、高度没超），调用方可用它决定提示语。 */
export function isRescaleOnly(plan) {
  return Boolean(plan && plan.slices.length === 1 && plan.scale < 1);
}

/** Pillow 可用性探针（`python -c <code>`）。PIL_OK 必须带引号——写成 print(PIL_OK) 是
 *  NameError，进程非 0 退出，会被当成"没有 Pillow"，静默退化成"看不了长图"。 */
export const PIL_PROBE_CODE = "import PIL; from PIL import Image; print('PIL_OK')";

/** 切图脚本文件名（临时目录内，不落用户目录）。 */
export const PILLOW_SLICE_SCRIPT_NAME = 'slice.py';

/**
 * Pillow 切图脚本。参数：<源图路径> <输出目录> <计划 JSON 路径>。
 * stdout 只输出一行 JSON（调用方取最后一行），失败时退出码非 0。
 */
export const PILLOW_SLICE_SCRIPT = `# -*- coding: utf-8 -*-
# SurfCore 长图切段（由 src/long-image.js 生成，勿手改）
import json, os, sys
from PIL import Image

src, outdir, plan_path = sys.argv[1], sys.argv[2], sys.argv[3]
with open(plan_path, "r", encoding="utf-8") as fh:
    plan = json.load(fh)

quality = int(plan.get("quality") or 85)
im = Image.open(src)
im.load()
if im.mode not in ("RGB", "L"):
    im = im.convert("RGB")

target_w = max(1, int(plan["width"]))
target_h = max(1, int(plan["height"]))
if im.size != (target_w, target_h):
    im = im.resize((target_w, target_h), Image.LANCZOS)

os.makedirs(outdir, exist_ok=True)
out = []
for i, item in enumerate(plan.get("slices") or []):
    top = max(0, int(item["y"]))
    bottom = min(im.height, top + int(item["h"]))
    if bottom <= top:
        continue
    crop = im.crop((0, top, im.width, bottom))
    target = os.path.join(outdir, "slice-%02d.jpg" % i)
    crop.save(target, "JPEG", quality=quality, optimize=True)
    out.append({"path": target, "y": top, "h": bottom - top, "bytes": os.path.getsize(target)})

print(json.dumps({"ok": True, "width": im.width, "height": im.height, "count": len(out), "slices": out}, ensure_ascii=False))
`;

function extensionForMime(mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('gif')) return '.gif';
  return '.jpg';
}

/** 从脚本 stdout 里取最后一行 JSON（Pillow 有时会往 stdout 打进度/警告）。 */
export function parseSliceScriptOutput(stdout) {
  const lines = String(stdout ?? '').trim().split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (parsed && typeof parsed === 'object' && parsed.ok) return parsed;
    } catch {}
  }
  return null;
}

/**
 * 执行切图计划。
 * @param {object} input
 * @param {Buffer} input.buffer 原图字节
 * @param {string} input.mimeType 原图 MIME（只用它决定临时文件后缀）
 * @param {object} input.plan planLongImageSlices() 的返回值
 * @param {string} input.pythonPath 带 Pillow 的 Python 可执行文件
 * @param {(file:string,args:string[],opts:object)=>Promise<{stdout:string,stderr:string}>} input.run
 * @param {string} [input.tmpRoot] 临时目录根（默认系统临时目录；不写 state/，那里 ACL 收紧过）
 * @returns {Promise<Array<{buffer:Buffer,mimeType:string,part:{i:number,n:number},y:number,h:number}>>}
 */
export async function sliceImageWithPillow({ buffer, mimeType, plan, pythonPath, run, tmpRoot = os.tmpdir() }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('原图为空');
  if (!plan || !Array.isArray(plan.slices) || !plan.slices.length) throw new Error('切图计划为空');
  if (typeof run !== 'function') throw new Error('缺少 run 执行器');
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'surfcore-longimg-'));
  try {
    const srcPath = path.join(dir, `source${extensionForMime(mimeType)}`);
    fs.writeFileSync(srcPath, buffer);
    const outDir = path.join(dir, 'slices');
    fs.mkdirSync(outDir);
    const planPath = path.join(dir, 'plan.json');
    fs.writeFileSync(planPath, JSON.stringify({
      width: plan.width,
      height: plan.height,
      quality: plan.quality,
      slices: plan.slices,
    }));
    const scriptPath = path.join(dir, PILLOW_SLICE_SCRIPT_NAME);
    fs.writeFileSync(scriptPath, PILLOW_SLICE_SCRIPT);
    const result = await run(pythonPath, [scriptPath, srcPath, outDir, planPath], {
      timeoutMs: 120000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const parsed = parseSliceScriptOutput(result?.stdout);
    if (!parsed) throw new Error('切图脚本没有返回有效结果');
    const files = fs.readdirSync(outDir).filter((name) => name.endsWith('.jpg')).sort();
    if (!files.length) throw new Error('切图脚本没有产出任何图片');
    return files.map((name, index) => ({
      buffer: fs.readFileSync(path.join(outDir, name)),
      mimeType: 'image/jpeg',
      part: { i: index + 1, n: files.length },
      y: Number(parsed.slices?.[index]?.y) || 0,
      h: Number(parsed.slices?.[index]?.h) || 0,
    }));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

/**
 * 本机能用哪个 Python 跑 Pillow（按优先级，纯函数便于单测）。
 * 1. config 显式指定的路径（用户自装 Python + Pillow）；
 * 2. DSH 自带运行时（DSH_HOME/dsh-runtimes/dsh-primary-runtime/dependencies/python，
 *    随 DSH 分发、必带 Pillow —— 对"装了 DSH 的用户"是稳定来源）；
 * 3. PATH 里的 python / python3。
 */
export function pythonCandidatesFromEnv({ configuredPath = '', dshHome = '', homeDir = '', platform = process.platform } = {}) {
  const list = [];
  const push = (value) => {
    const s = String(value ?? '').trim();
    if (s && !list.includes(s)) list.push(s);
  };
  push(configuredPath);
  const bases = [];
  if (dshHome) bases.push(String(dshHome));
  if (homeDir) bases.push(path.join(String(homeDir), '.dsh'));
  for (const base of bases) {
    const runtime = path.join(base, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'python');
    if (platform === 'win32') push(path.join(runtime, 'python.exe'));
    push(path.join(runtime, 'bin', platform === 'win32' ? 'python.exe' : 'python3'));
    push(path.join(runtime, 'bin', 'python3'));
  }
  if (platform === 'win32') {
    push('python');
    push('python3');
  } else {
    push('python3');
    push('python');
  }
  return list;
}

/** 长图切段是否启用：`false` 完全关闭；其它值（含缺省）启用。 */
export function longImageSlicingEnabled(value) {
  return value !== false && String(value ?? '').trim().toLowerCase() !== 'off';
}
