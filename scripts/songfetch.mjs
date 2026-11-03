// songfetch.mjs —— 搜一首歌，下载人声，用指定音色翻唱，直接落进 SurfCore 语音库。
//
// 用法：
//   node scripts/songfetch.mjs "April Encounter"
//   node scripts/songfetch.mjs "夜曲" --pick 2 --text "歌词" --keep 2
//
// 流程：B站搜视频 → 挑一个有人声的 → 拿 cid → playurl 取最高码率音频流
//       → 下载 m4s → sing.mjs 声音转换翻唱 → audio/唱歌/<歌名>.wav
//
// 为什么用 B站：本机已有登录态（bili-api.js 的 loadBiliAccount），
// 搜索/播放接口都不需要 wbi 签名，且 DASH 把音频单独分了一条流（纯人声，不带视频）。
//
// 依赖：Breeze-TTS-2\bridge\sing.mjs（翻唱）、ffmpeg（sing.mjs 自己会找）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { loadBiliAccount } from '../src/bili-api.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SURFCORE = path.resolve(HERE, '..');
const SING_MJS = process.env.SING_MJS || 'D:/Breeze-TTS-2/bridge/sing.mjs';
const OUT_DIR = process.env.OUT_DIR || path.join(SURFCORE, 'audio', '唱歌');
const CACHE = path.join(SURFCORE, 'state', 'songfetch');

// ── 参数 ────────────────────────────────────────────────────────────────
function arg(name, dflt = '') {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : (v === undefined ? dflt : 'true');
}
const keyword = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '';
if (!keyword) {
  console.error('用法: node scripts/songfetch.mjs "歌名" [--pick N] [--text "歌词"] [--voice v3_A] [--keep 1]');
  process.exit(1);
}
const pick = Number(arg('pick', '0')) || 0;   // 0 = 自动挑
const lyric = arg('text', '');
const voice = arg('voice', 'v3_A');
const keep = arg('keep', '1');
const maxDur = Number(arg('maxdur', '480')) || 480;   // 超过 8 分钟大概率是合集/循环

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });

// ── 工具 ────────────────────────────────────────────────────────────────
const clean = (s) => String(s ?? '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
const durToSec = (s) => {
  const p = String(s ?? '').split(':').map(Number);
  return p.length === 2 ? p[0] * 60 + p[1] : p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : 0;
};
// 标题里出现这些词，基本没有人声可翻（教学/伴奏/纯音乐）
const BAD = /教学|教程|吉他|钢琴|扒谱|伴奏|纯音乐|BGM|bgm|伴奏版|无人声| instrumental|Inst\.|课程|解析|混音|升降调|AI化/;
const GOOD = /歌词|lyrics|Lyrics|唱见|翻唱| cover|Cover|COVER|完整版|官方|MV|PV/;

async function getJson(url, headers, timeoutMs = 25000) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  return r.json().catch(() => ({}));
}

// ── 1) 搜索 ─────────────────────────────────────────────────────────────
const acc = loadBiliAccount();
if (!acc.hasCredentials) {
  console.error('✗ B站账号不完整（缺 SESSDATA/bili_jct/buvid3），搜不了也下不了。');
  process.exit(1);
}
console.log(`→ 搜「${keyword}」…`);
const sj = await getJson(
  `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(keyword)}`,
  acc.headers,
);
if (sj?.code !== 0) { console.error(`✗ 搜索失败 code=${sj?.code} ${sj?.message ?? ''}`); process.exit(1); }

const cands = (sj?.data?.result ?? [])
  .filter((x) => x?.type === 'video' && x?.bvid)
  .map((x) => {
    const title = clean(x.title);
    const dur = durToSec(x.duration);
    const bad = BAD.test(title);
    const good = GOOD.test(title);
    return { bvid: x.bvid, title, dur, author: clean(x.author), bad, good };
  })
  // 太长的多是合集/循环版，没有单曲人声
  .filter((x) => x.dur > 15 && x.dur <= maxDur);

if (!cands.length) { console.error('✗ 没搜到合适的结果（或都被时长过滤掉了）。'); process.exit(1); }

cands.sort((a, b) => (b.good - a.good) || (a.bad - b.bad) || (Math.abs(a.dur - 210) - Math.abs(b.dur - 210)));
const chosen = pick > 0 ? cands[pick - 1] : cands[0];
if (!chosen) { console.error(`✗ --pick ${pick} 超出范围（共 ${cands.length} 条）`); process.exit(1); }

console.log(`  候选 ${cands.length} 条，选中：`);
cands.slice(0, 5).forEach((c, i) => {
  const mark = c === chosen ? ' ←' : '';
  console.log(`   ${i + 1}. [${c.bvid}] ${Math.floor(c.dur / 60)}:${String(c.dur % 60).padStart(2, '0')} ${c.title.slice(0, 42)}${mark}`);
});

// ── 2) cid ──────────────────────────────────────────────────────────────
const vj = await getJson(`https://api.bilibili.com/x/web-interface/view?bvid=${chosen.bvid}`, acc.headers);
const page = (vj?.data?.pages ?? [])[0] ?? {};
const cid = page?.cid;
if (!cid) { console.error(`✗ 拿不到 cid（view code=${vj?.code}）`); process.exit(1); }

// ── 3) 音频流 ───────────────────────────────────────────────────────────
const pj = await getJson(`https://api.bilibili.com/x/player/playurl?bvid=${chosen.bvid}&cid=${cid}&fn=16&fnval=16`, acc.headers);
const audio = (pj?.data?.dash?.audio ?? []).slice().sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0));
const best = audio[0];
if (!best?.baseUrl) { console.error(`✗ 没有音频流（playurl code=${pj?.code} ${pj?.message ?? ''}）`); process.exit(1); }
console.log(`→ 音频流：id=${best.id} ${best.codecs} ${(best.bandwidth / 1000).toFixed(0)}kbps`);

// ── 4) 下载（CDN 要 Referer，否则 403）──────────────────────────────────
const m4s = path.join(CACHE, `${chosen.bvid}-${best.id}.m4s`);
if (!fs.existsSync(m4s) || fs.statSync(m4s).size === 0) {
  console.log('→ 下载中…');
  const r = await fetch(best.baseUrl, { headers: acc.headers, signal: AbortSignal.timeout(180000) });
  if (!r.ok) { console.error(`✗ 下载失败 HTTP ${r.status}`); process.exit(1); }
  fs.writeFileSync(m4s, Buffer.from(await r.arrayBuffer()));
}
console.log(`   ${(fs.statSync(m4s).size / 1024 / 1024).toFixed(2)} MB`);

// ── 5) 翻唱（交给 sing.mjs，它自己抽 24k 单声道）────────────────────────
const safeName = clean(vj?.data?.title ?? chosen.title).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
const outPath = arg('out', path.join(OUT_DIR, `${safeName}.wav`));

const singArgs = [SING_MJS, m4s, '--voice', voice, '--keep', keep, '--out', outPath];
if (lyric) singArgs.push('--text', lyric);

console.log(`→ 翻唱中（音色 ${voice}，keep=${keep}${lyric ? '，带歌词' : ''}）…`);
await new Promise((resolve, reject) => {
  execFile(process.execPath, singArgs, { maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
    const out = String(stdout ?? '') + String(stderr ?? '');
    process.stdout.write(out.split('\n').filter((l) => /✓|✗|→|音频|提示/.test(l)).map((l) => `   ${l}`).join('\n'));
    err ? reject(new Error(out.slice(-400))) : resolve();
  });
});

if (!fs.existsSync(outPath)) { console.error('✗ 翻唱没产出文件'); process.exit(1); }
console.log(`\n✓ 已落库：${path.relative(SURFCORE, outPath)}`);
console.log(`  AI 发送时 voice 填 "${path.relative(path.join(SURFCORE, 'audio'), outPath).split(path.sep).join('/')}"`);
