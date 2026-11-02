// B站 shots 缓存轮转：只删超期普通文件；不碰新文件/未知目录；按总大小兜底。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatShotsStats, pruneShots } from '../plugins/surfcore/tools/lib/shots-cache.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-shots-'));
const now = Date.now();
const old = new Date(now - 10 * 24 * 3600_000);
const fresh = new Date(now - 1 * 3600_000);
const make = (sub, name, size, mtime) => {
  const dir = path.join(root, sub);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, 'x'.repeat(size));
  fs.utimesSync(file, mtime, mtime);
  return file;
};
try {
  const oldVideo = make('video', 'old.mp4', 200, old);
  const freshVideo = make('video', 'fresh.mp4', 100, fresh);
  make('covers', 'old.jpg', 100, old);
  const freshSub = make('subs', 'fresh.txt', 100, fresh);
  fs.mkdirSync(path.join(root, 'video', '.frames-old'));
  fs.utimesSync(path.join(root, 'video', '.frames-old'), old, old);
  fs.mkdirSync(path.join(root, 'video', '.frames-new'));
  const outside = path.join(root, 'not-a-shot.txt');
  fs.writeFileSync(outside, 'keep');

  const r = pruneShots({ root, retentionDays: 7, maxMB: 0, now });
  assert.equal(r.errors.length, 0);
  assert.ok(!fs.existsSync(oldVideo), '超期原片被清理');
  assert.ok(fs.existsSync(freshVideo), '新原片保留');
  assert.ok(fs.existsSync(freshSub), '新字幕保留');
  assert.ok(!fs.existsSync(path.join(root, 'covers', 'old.jpg')), '超期封面被清理');
  assert.ok(!fs.existsSync(path.join(root, 'video', '.frames-old')), '超期临时帧目录被清理');
  assert.ok(fs.existsSync(path.join(root, 'video', '.frames-new')), '新临时帧目录保留');
  assert.ok(fs.existsSync(outside), '不碰 shots 根下的非目标文件');
  assert.equal(r.removed, 3);
  assert.ok(formatShotsStats(r).includes('B站缓存'));

  // 总大小兜底：从最旧开始清，直到低于上限（这里上限极小，只剩最新的一个文件）。
  const maxed = pruneShots({ root, retentionDays: 0, maxMB: 0.00015, now });
  assert.ok(maxed.files <= 1, '总大小上限生效');
  assert.ok(fs.existsSync(freshSub) || fs.existsSync(freshVideo), '至少保留一个最新文件');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

const read = (name) => fs.readFileSync(new URL(`../plugins/surfcore/tools/commands/${name}`, import.meta.url), 'utf8');
const watch = read('bili-watch.mjs');
const debrief = read('debrief.mjs');
const subtitles = read('subtitles.mjs');
assert.ok(watch.includes('--keep-mp4') && watch.includes('pruneShots') && watch.includes('shotsPath'), 'watch 必须支持保留开关并触发清理');
assert.ok(watch.includes('fs.rmSync(mp4'), 'watch 默认清理原片');
assert.ok(debrief.includes('--keep-mp4') && debrief.includes('pruneShots') && debrief.includes('shotsPath'), 'debrief 必须保留到字幕条完成并触发清理');
assert.ok(subtitles.includes('pruneShots') && subtitles.includes('shotsPath'), 'subtitles 必须走统一目录并触发清理');
console.log('✅ shots 缓存轮转测试通过');
