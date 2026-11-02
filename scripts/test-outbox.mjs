// 出站 outbox：连接失败暂存、上线补发、去重、策略失败不入队。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOutbox } from '../src/outbox.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-outbox-'));
const file = path.join(dir, 'outbox.json');
try {
  let fail = true;
  const sent = [];
  const outbox = createOutbox({
    file,
    send: async (entry) => {
      if (fail) throw new Error('fetch failed');
      sent.push(entry.text);
    },
    isConnectionError: (error) => /fetch failed/.test(String(error?.message ?? error)),
    now: () => Date.now(),
  });

  assert.equal(outbox.push('private', '123', 'hello'), true);
  assert.equal(outbox.push('private', '123', 'hello'), false, '同文本 10 分钟内去重');
  const first = await outbox.flush('test');
  assert.equal(first.sent, 0);
  assert.equal(first.left, 1);
  fail = false;
  const second = await outbox.flush('test');
  assert.equal(second.sent, 1);
  assert.equal(second.left, 0);
  assert.deepEqual(sent, ['hello']);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), []);

  outbox.push('group', '456', 'will-be-deduped');
  outbox.markSent('group', '456', 'will-be-deduped');
  assert.equal(outbox.stats().count, 0, '正常发送成功要清掉同文本待补发项');

  const policy = createOutbox({
    file,
    send: async () => { throw new Error('sensitive content blocked'); },
    isConnectionError: () => false,
  });
  policy.push('private', '789', 'policy');
  const p = await policy.flush('test');
  assert.equal(p.left, 0, '策略失败不能留在队列里反复撞');
  const bridge = fs.readFileSync('src/bridge.js', 'utf8');
  assert.ok(bridge.includes("createOutbox({") && bridge.includes("flush(`account-online:${source}`)"),
    'bridge 必须在账号上线边沿补发');
  assert.ok(bridge.includes('probeOneBotSendable') && bridge.includes("reason: 'QQ 暂不可发送'"),
    '早安必须先探活，不能只凭 deliverPrompt 成功就记已发');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('✅ 出站 outbox 测试通过');
