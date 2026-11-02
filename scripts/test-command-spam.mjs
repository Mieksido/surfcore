// 群刷屏短指令识别：只拦 # + ASCII 命令词，不误伤中文话题标签。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bridgeHarness } from './audit-bridge-harness.mjs';
import { isSpamCommandText } from '../src/command-spam.js';

for (const text of ['#sl', '#SL', '＃sl', '#sl 刷屏', '#help 一下', ' #sl ']) {
  assert.equal(isSpamCommandText(text), true, `应识别：${text}`);
}
for (const text of ['#B站#', '#话题', '今天 #sl 了吗', 'sl', '']) {
  assert.equal(isSpamCommandText(text), false, `不应识别：${text}`);
}

const bridge = fs.readFileSync('src/bridge.js', 'utf8');
const client = fs.readFileSync('plugins/surfcore/lib/client.js', 'utf8');
assert.match(bridge, /ignoreSpamCommands/);
assert.match(bridge, /isSpamCommandText\(plainContent\)/);
assert.match(bridge, /ignore-command:/);
assert.match(client, /socialV2\.ignoreSpamCommands/);
const groupEvent = (() => {
  let seq = 3000;
  return (text, userId = 999) => ({
    post_type: 'message',
    message_type: 'group',
    group_id: 456,
    user_id: userId,
    self_id: 1,
    message_id: seq++,
    sender: { user_id: userId, nickname: 'fixture' },
    message: [{ type: 'text', data: { text } }],
  });
})();

const h = await bridgeHarness({ config: { socialV2: { ignoreSpamCommands: true } } });
try {
  h.setMode('reserved2');
  const key = 'group:456';
  const unreadCount = () => (h.getSocialV2State(key).unread ?? []).length;
  const before = unreadCount();
  await h.handleIncoming('group', '456', groupEvent('#sl'), h.cfg);
  assert.equal(unreadCount(), before, '过滤的 #sl 不能进未读');
  assert.equal(h.calls.prompts.length, 0, '过滤的 #sl 不能唤醒 agent');

  await h.handleIncoming('group', '456', groupEvent('#B站#'), h.cfg);
  assert.equal(unreadCount(), before + 1, '中文话题标签不能被误伤');

  h.cfg.socialV2.ignoreSpamCommands = false;
  await h.handleIncoming('group', '456', groupEvent('#sl'), h.cfg);
  assert.equal(unreadCount(), before + 2, '关掉开关后 #sl 应恢复入站');
} finally {
  await h.close();
}

console.log('✅ 群刷屏指令过滤测试通过');
