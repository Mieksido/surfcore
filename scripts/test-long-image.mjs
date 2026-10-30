// 长图切段回归（2026-10-30 用户实测：「bot看不了qq长图」）。
//
// 现象：群里发 QQ 长截图（实测 1320×15378 JPEG），bot 回「确实看不到，长图单边像素
// 超了我这边的上限」。工具 qq_get_message_images 确实返回了图片，但 DSH 图像准入
// 直接拒收：单边 > 8192 → "[image unavailable: ... per-side pixel limit]"。
// 就算放行，4MP 归一化也会把 1320 宽的长图压到 400 多像素，字全糊。
//
// 修法：桥接在把图交给模型前先切段（src/long-image.js）：
//   planLongImageSlices 决定"要不要切、怎么切"；sliceImageWithPillow 交给本机 Pillow 执行。
// 本测试全部在夹具里跑（假 execFile，不 spawn 真 Python、不连 QQ/DSH）。
// 运行：node scripts/test-long-image.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  LONG_IMAGE_DEFAULTS, PIL_PROBE_CODE, isRescaleOnly, longImageSlicingEnabled, parseSliceScriptOutput,
  planLongImageSlices, pythonCandidatesFromEnv,
} from '../src/long-image.js';
import { bridgeHarness } from './audit-bridge-harness.mjs';

let failures = 0;
async function test(name, run, options = {}) {
  const h = await bridgeHarness(options.harness ?? {});
  try {
    h.setMode('reserved2');
    await run(h);
    console.log('PASS', name);
  } catch (error) {
    failures++;
    console.error('FAIL', name, '—', error?.stack ?? error);
  } finally {
    await h.close();
  }
}

function plain(name, run) {
  try { run(); console.log('PASS', name); }
  catch (error) { failures++; console.error('FAIL', name, '—', error?.stack ?? error); }
}

/** 只有头部合法的假 PNG：getImageDimensions/acceptImageBuffer 都只读 IHDR，不真解码。 */
function fakePng(width, height) {
  const buf = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  buf[24] = 8;   // bit depth
  buf[25] = 6;   // color type RGBA
  return buf;
}

/** 假 Python 进程：探针回 PIL_OK；切图按计划写出 N 个 jpg 并回一行 JSON。 */
function fakePillowExec(log = []) {
  return (file, args, options, callback) => {
    log.push({ file, args });
    setImmediate(() => {
      if (args[0] === '-c') {
        assert.equal(args[1], PIL_PROBE_CODE, '探针必须用 long-image.js 里的唯一定义');
        callback(null, 'PIL_OK\n', '');
        return;
      }
      try {
        const [scriptPath, srcPath, outDir, planPath] = args;
        assert.ok(fs.existsSync(scriptPath), '切图脚本应已落盘');
        assert.ok(fs.existsSync(srcPath), '原图应已落盘');
        const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
        const slices = [];
        for (let i = 0; i < plan.slices.length; i += 1) {
          const target = path.join(outDir, `slice-${String(i).padStart(2, '0')}.jpg`);
          fs.writeFileSync(target, fakePng(Math.min(plan.width, 64), Math.min(64, plan.slices[i].h)));
          slices.push({ path: target, y: plan.slices[i].y, h: plan.slices[i].h, bytes: fs.statSync(target).size });
        }
        callback(null, `${JSON.stringify({ ok: true, width: plan.width, height: plan.height, count: slices.length, slices })}\n`, '');
      } catch (error) {
        callback(error, '', '');
      }
    });
  };
}

// ── 纯函数：切段计划 ──────────────────────────────────────────────────────
plain('普通照片/小图不切段（不能把正常图片也拆了）', () => {
  assert.equal(planLongImageSlices(4000, 3000), null, '12MP 4:3 照片不该切');
  assert.equal(planLongImageSlices(1320, 1140), null);
  assert.equal(planLongImageSlices(800, 600), null);
});

plain('QQ 长截图 1320×15378 → 切成多段，每段都在模型准入/归一化预算内', () => {
  const plan = planLongImageSlices(1320, 15378);
  assert.ok(plan, '长截图必须触发切段');
  assert.ok(plan.reasons.includes('side'), '单边 15378 > 8192，必须命中准入上限');
  assert.ok(plan.reasons.includes('pixels'), '20MP > 4MP，命中归一化预算');
  assert.equal(plan.scale, 1, '超高的图应该切而不是整体缩小（缩小会让字糊）');
  assert.ok(plan.slices.length > 1, `应切成多段，实际 ${plan.slices.length}`);
  assert.equal(plan.width, 1320);
  let covered = 0;
  for (const slice of plan.slices) {
    assert.ok(slice.h > 0);
    assert.ok(plan.width * slice.h <= LONG_IMAGE_DEFAULTS.maxPixels, `单段 ${plan.width}x${slice.h} 超归一化预算`);
    assert.ok(slice.h <= LONG_IMAGE_DEFAULTS.sliceMaxHeight, '单段高度不该超过 sliceMaxHeight');
    covered = Math.max(covered, slice.y + slice.h);
  }
  assert.equal(covered, 15378, '最后一段必须盖到图片底部（不能漏掉结尾）');
});

plain('超长图 1080×40000 → 段数封顶，且每段仍在像素预算内', () => {
  const plan = planLongImageSlices(1080, 40000);
  assert.ok(plan);
  assert.ok(plan.slices.length <= LONG_IMAGE_DEFAULTS.sliceMaxCount, '段数不能无限增长');
  for (const slice of plan.slices) assert.ok(1080 * slice.h <= LONG_IMAGE_DEFAULTS.maxPixels + 1080 * 8);
  const last = plan.slices[plan.slices.length - 1];
  assert.equal(last.y + last.h, 40000, '封顶后仍要盖到底部');
});

plain('单边超标（宽 9000）→ 先等比缩到 8192 再切，单边不再超准入线', () => {
  const plan = planLongImageSlices(9000, 2000);
  assert.ok(plan);
  assert.ok(plan.scale < 1, '宽超标必须缩');
  assert.equal(plan.width, 8192);
  assert.ok(Math.max(plan.width, plan.height) <= LONG_IMAGE_DEFAULTS.maxSide);
  for (const slice of plan.slices) assert.ok(plan.width * slice.h <= LONG_IMAGE_DEFAULTS.maxPixels);
});

plain('坏尺寸/未定义 → 不切段（优雅降级，绝不抛异常）', () => {
  assert.equal(planLongImageSlices(0, 100), null);
  assert.equal(planLongImageSlices(NaN, 100), null);
  assert.equal(planLongImageSlices(undefined, undefined), null);
  assert.equal(planLongImageSlices(-5, 9000), null);
});

plain('配置上限可覆盖（maxSide 调小时长图判定跟着变）', () => {
  const plan = planLongImageSlices(1320, 3000, { maxSide: 2000 });
  assert.ok(plan, '单边 3000 > 自定义 2000 应触发');
  assert.ok(plan.reasons.includes('side'));
});

plain('只有宽超标且高度很短时，isRescaleOnly 为 true（调用方据此不切多段）', () => {
  const plan = planLongImageSlices(9000, 400);
  assert.ok(plan);
  assert.equal(plan.slices.length, 1);
  assert.equal(isRescaleOnly(plan), true);
});

plain('配置开关收敛：只有显式 false/off 才关', () => {
  assert.equal(longImageSlicingEnabled(undefined), true, '缺省必须开（否则老配置永远看不了长图）');
  assert.equal(longImageSlicingEnabled(true), true);
  assert.equal(longImageSlicingEnabled('on'), true);
  assert.equal(longImageSlicingEnabled(false), false);
  assert.equal(longImageSlicingEnabled('off'), false);
});

plain('Python 候选顺序：显式配置 > DSH 运行时 > PATH', () => {
  const win = pythonCandidatesFromEnv({ configuredPath: 'C:/my/python.exe', dshHome: 'C:/dsh', homeDir: 'C:/Users/u', platform: 'win32' });
  assert.equal(win[0], 'C:/my/python.exe');
  assert.ok(win.some((p) => p.includes('dsh-runtimes') && p.endsWith('python.exe')), '应包含 DSH 自带运行时');
  assert.ok(win.some((p) => p === 'python' || p === 'python3'), '最后应回退 PATH');
  const linux = pythonCandidatesFromEnv({ homeDir: '/home/u', platform: 'linux' });
  assert.ok(linux.some((p) => p.endsWith('python3')));
});

plain('Pillow 探针必须是合法 Python：PIL_OK 要带引号（NameError 会被误判成"没有 Pillow"）', () => {
  assert.match(PIL_PROBE_CODE, /print\(['"]PIL_OK['"]\)/, 'PIL_OK 必须作为字符串字面量');
  assert.doesNotMatch(PIL_PROBE_CODE, /print\(\s*PIL_OK\s*\)/, 'print(PIL_OK) 是 NameError，会被当成探测失败');
  assert.ok(!PIL_PROBE_CODE.includes('\n'), '探针要能作为 -c 单行传入');
});

plain('切图脚本输出解析：容忍前面混着警告行', () => {
  const parsed = parseSliceScriptOutput('WARNING: something\n{"ok":true,"count":2,"slices":[]}\n');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.count, 2);
  assert.equal(parseSliceScriptOutput('not json'), null);
});

// ── 桥接接线：长图 → 多张图（假 Pillow）────────────────────────────────────
await test('fetchMediaData：长截图被切成多段，每段带"第 i/n 段"标签', async (h) => {
  h.bot.getImage = async () => ({ base64: fakePng(1320, 15378).toString('base64') });
  const out = await h.fetchMediaData([{ kind: 'image', file: 'long.png', url: '' }]);
  assert.ok(out.length > 1, `应返回多段，实际 ${out.length} 项`);
  const imageEntries = out.filter((item) => item.data);
  assert.ok(imageEntries.length > 1);
  for (const entry of imageEntries) {
    assert.equal(entry.mimeType, 'image/jpeg');
    assert.ok(entry.data.length > 0);
    assert.ok(entry.part && entry.part.n === imageEntries.length, 'part 段数要一致');
    assert.match(entry.text, /长图第 \d+\/\d+ 段/);
  }
}, { harness: { globals: { execFile: fakePillowExec() } } });

await test('fetchMediaData：普通图片原样返回，不触发切段（不起 Python 进程）', async (h) => {
  h.bot.getImage = async () => ({ base64: fakePng(1320, 1140).toString('base64') });
  const out = await h.fetchMediaData([{ kind: 'image', file: 'normal.png', url: '' }]);
  assert.equal(out.length, 1);
  assert.ok(out[0].data);
  assert.equal(out[0].text, '');
  assert.equal(out[0].mimeType, 'image/png');
}, { harness: { globals: { execFile: fakePillowExec() } } });

await test('没有 Pillow：长图不静默失败，给出可行动的英文/中文说明', async (h) => {
  h.bot.getImage = async () => ({ base64: fakePng(1320, 15378).toString('base64') });
  const out = await h.fetchMediaData([{ kind: 'image', file: 'long.png', url: '' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].data, undefined, '切不了时不要塞一张会被 DSH 拒收的原图');
  assert.match(out[0].text, /Pillow/);
  assert.match(out[0].text, /截成两三段|截成两段/);
});

// 探针成功、真正切图时报错的假进程：用来钉住"切图失败要降级成说明"这条失败路径。
function failingPillowExec(file, args, options, callback) {
  setImmediate(() => {
    if (args[0] === '-c') return callback(null, 'PIL_OK\n', '');
    return callback(new Error('Pillow 崩了'), '', '');
  });
}

await test('切图进程报错：降级成说明，不影响其它消息', async (h) => {
  h.bot.getImage = async () => ({ base64: fakePng(1320, 15378).toString('base64') });
  const out = await h.fetchMediaData([{ kind: 'image', file: 'long.png', url: '' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].data, undefined);
  assert.match(out[0].text, /长图切段失败/);
}, { harness: { globals: { execFile: failingPillowExec } } });

await test('sliceLongImages=false：彻底关掉切段（回退开关）', async (h) => {
  h.bot.getImage = async () => ({ base64: fakePng(1320, 15378).toString('base64') });
  const out = await h.fetchMediaData([{ kind: 'image', file: 'long.png', url: '' }]);
  assert.equal(out.length, 1);
  assert.ok(out[0].data, '关闭后应该退回原始行为（交给模型侧处理）');
  assert.equal(h.cfg.socialV2.media.sliceLongImages, false);
}, { harness: { config: { socialV2: { media: { sliceLongImages: false } } }, globals: { execFile: fakePillowExec() } } });

if (failures > 0) {
  console.error(`\n${failures} 条长图切段回归失败`);
  process.exit(1);
}
console.log('\nlong-image 回归全部通过');
