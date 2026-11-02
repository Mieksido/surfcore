// B站沉默逛 + 评论年龄闸：必须硬拦、带 code/hint，不能只靠提示词。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { interactEnabled, maxCommentAgeDays, checkCommentAge } from '../plugins/surfcore/tools/lib/interact.mjs';

const off = { interact: { enabled: false, maxCommentAgeDays: 14 } };
assert.equal(interactEnabled(off), false);
assert.equal(maxCommentAgeDays(off), 14);

const old = checkCommentAge(Date.now() - 1000 * 86400_000, off);
assert.equal(old.ok, false);
assert.equal(old.code, 'BILI_COMMENT_TOO_OLD');
assert.ok(old.error.includes('1000 天'));
assert.ok(old.hint.includes('互动与静默'));

const fresh = checkCommentAge(Date.now() - 2 * 86400_000, off);
assert.equal(fresh.ok, true);

const unknown = checkCommentAge(0, off);
assert.equal(unknown.ok, true, '时间未知不能误杀');

const comment = fs.readFileSync(path.resolve('plugins/surfcore/tools/commands/comment.mjs'), 'utf8');
const daily = fs.readFileSync(path.resolve('plugins/surfcore/tools/commands/daily.mjs'), 'utf8');
const share = fs.readFileSync(path.resolve('plugins/surfcore/tools/commands/share-dynamic.mjs'), 'utf8');
const scheduler = fs.readFileSync(path.resolve('plugins/surfcore/lib/scheduler.js'), 'utf8');
const client = fs.readFileSync(path.resolve('plugins/surfcore/lib/client.js'), 'utf8');
for (const src of [comment, daily, share]) {
  assert.ok(src.includes('assertInteractEnabled'), '写操作必须走沉默闸门');
}
assert.ok(comment.includes('checkCommentAge') && comment.includes('BILI_COMMENT_TOO_OLD') === false);
assert.ok(comment.includes('printAgeBlock'), '年龄拒绝必须打印 code/hint');
assert.ok(scheduler.includes('SILENT') && scheduler.includes('沉默逛 B 站已开启'), '唤醒提示必须承认沉默模式');
assert.ok(scheduler.includes('if (!interactEnabled()) return'), 'listen/dm/live/dyn 必须停');
assert.ok(client.includes('沉默逛 B 站（只看不说）'), '设置页必须有静默开关');
assert.ok(client.includes('只回复多少天内的评论'), '设置页必须有年龄上限');
console.log('✅ 沉默逛/评论年龄测试通过');
