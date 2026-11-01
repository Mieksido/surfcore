// wait 积压批量回归：群聊几百条时只交付有界、优先的一批，不整段倒给模型。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { selectWaitBatch } from '../src/v2-wait.js';

const msg = (seq, text = `消息${seq}`, extra = {}) => ({ seq, text, plain: text, ...extra });
const important = (m) => m.isOwner === true || m.quoteTargetIsSelf === true || String(m.plain).includes('@我');

{
  const many = Array.from({ length: 120 }, (_, i) => msg(i + 1));
  many[2] = msg(3, '主人叫我', { isOwner: true });
  const { selected, folded } = selectWaitBatch(many, { maxMessages: 20, maxChars: 4000, isImportant: important });
  assert.ok(selected.length <= 20, '最多只交付 20 条');
  assert.ok(selected.some((m) => m.seq === 3), '优先保留主人消息');
  assert.ok(selected.some((m) => m.seq === 120), '保留最新消息');
  assert.equal(selected.length + folded.length, 120, '所有消息都被分类');
  assert.ok(folded.length > 0, '超出部分必须折叠');
}

{
  const many = Array.from({ length: 30 }, (_, i) => msg(i + 1, 'x'.repeat(500)));
  const { selected } = selectWaitBatch(many, { maxMessages: 50, maxChars: 2000, isImportant: important });
  const chars = selected.reduce((n, m) => n + String(m.plain).length + 24, 0);
  assert.ok(chars <= 2000, '字符上限必须生效');
  assert.ok(selected.some((m) => m.seq === 30), '字符裁剪不能丢掉最新一条');
}

{
  const few = [msg(1, '在吗'), msg(2, '？')];
  const { selected, folded } = selectWaitBatch(few, { maxMessages: 20, maxChars: 4000, isImportant: important });
  assert.deepEqual(selected.map((m) => m.seq), [1, 2]);
  assert.equal(folded.length, 0);
}

const bridge = fs.readFileSync(path.resolve('src/bridge.js'), 'utf8');
assert.ok(bridge.includes('backlogImmediate'), '积压消息必须走立即返回路径');
assert.ok(bridge.includes('maxBatchMessages') && bridge.includes('maxBatchChars'), 'wait 必须有条数/字符上限');
assert.ok(bridge.includes('foldedCount') && bridge.includes('foldedPreview'), '折叠必须可见');
assert.ok(bridge.includes('latestAt'), '积压静默起点必须用最后到达时间');
console.log('✅ wait 积压批量测试通过');
