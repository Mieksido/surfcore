// 目的机制接线：真实 bridge.js 的配置/预览/投递/发送回执/回合回执（VM 夹具，不连真 QQ）。
import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';

let failures = 0;
async function test(name, run, options) {
  const h = await bridgeHarness(options);
  try {
    h.setMode('reserved2');
    await run(h);
    console.log('PASS', name);
  } catch (error) {
    failures += 1;
    console.error('FAIL', name, error.message);
  } finally {
    await h.close();
  }
}

function seedOwner(h) {
  h.appendSocialV2Message('private:123', '主人', '明天面试有点紧张', '明天面试有点紧张', false, true, 'm1');
  h.appendSocialV2Message('private:123', '主人', '你最近在忙什么', '你最近在忙什么', false, true, 'm2');
}

await test('配置默认开、owner 回退到 config.ownerQQ', async (h) => {
  assert.equal(h.cfg.purpose.enabled, true);
  assert.equal(h.cfg.purpose.ownerUin, '123');
  assert.ok(h.cfg.purpose.quietStart);
  assert.ok(h.cfg.purpose.quietEnd);
});

await test('只读预览：会读素材/拼提示词，但不建会话、不投递、不改状态', async (h) => {
  seedOwner(h);
  const before = JSON.stringify(h.purposeState);
  const r = await h.runPurpose({ preview: true });
  assert.equal(r.ok, true);
  assert.equal(r.preview, true);
  assert.ok(r.materials.length >= 2);
  assert.ok(r.prompt.includes('【主动找对方 · 目的回合】'));
  assert.ok(r.prompt.includes('qq_send_private_message'));
  assert.ok(r.prompt.includes('明天面试有点紧张'));
  assert.equal(h.calls.prompts.length, 0);
  assert.equal(h.calls.created.length, 0);
  assert.equal(JSON.stringify(h.purposeState), before);
});

await test('强制投递：落到 private:owner，状态先记 pending', async (h) => {
  seedOwner(h);
  const r = await h.runPurpose({ force: true });
  assert.equal(r.ok, true);
  assert.equal(r.delivered, true);
  assert.equal(h.calls.prompts.length, 1);
  assert.equal(h.calls.prompts[0].sessionId, h.state.sessions['private:123']);
  assert.equal(h.purposeState.countToday, 1);
  assert.equal(h.purposeState.lastOutcome, 'pending');
  assert.equal(h.purposeState.nextFireAt, 0);
  assert.ok(r.selected?.text);
});

await test('回合回执：真发了 = sent；内部备忘的「待续」进 pending', async (h) => {
  seedOwner(h);
  const r = await h.runPurpose({ force: true });
  assert.equal(r.ok, true);
  const sid = h.state.sessions['private:123'];
  h.notePurposeOutbound('private:123', ['主人，明天面试的事……']);
  h.notePurposeTurnEnded(sid, {
    reason: { kind: 'completed' },
    text: '【目的】关心一下面试\n【类型】关心\n【状态】待续\n【待续】面试结果出来再问一次',
  }, true);
  assert.equal(h.purposeState.lastOutcome, 'sent');
  assert.equal(h.purposeState.attempts, 0);
  assert.ok(h.purposeState.lastSentAt > 0);
  assert.ok(h.purposeState.nextFireAt > Date.now());
  assert.equal(h.purposeState.history.at(-1).outcome, 'sent');
  assert.equal(h.purposeState.pending.length, 1);
  assert.equal(h.purposeState.pending[0].text, '面试结果出来再问一次');
});

await test('回合回执：没发消息且正常结束 = silent，不重试', async (h) => {
  seedOwner(h);
  const r = await h.runPurpose({ force: true });
  const sid = h.state.sessions['private:123'];
  h.notePurposeTurnEnded(sid, { reason: { kind: 'completed' }, text: '【目的】无【状态】跳过' }, false);
  assert.equal(r.ok, true);
  assert.equal(h.purposeState.lastOutcome, 'silent');
  assert.equal(h.purposeState.attempts, 0);
  assert.ok(h.purposeState.nextFireAt > Date.now());
});

const pad2 = (n) => String(n).padStart(2, '0');
const clockOf = (ms) => {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
await test('安静时段：非强制不投递；force 仍可手动试一次', async (h) => {
  seedOwner(h);
  h.purposeState.nextFireAt = 0;
  const quiet = await h.runPurpose({});
  assert.equal(quiet.ok, false);
  assert.equal(quiet.reason, 'quiet');
  assert.equal(h.calls.prompts.length, 0);
  const r = await h.runPurpose({ force: true });
  assert.equal(r.ok, true);
  assert.equal(h.calls.prompts.length, 1);
}, {
  config: {
    purpose: {
      quietStart: clockOf(Date.now() - 60 * 60 * 1000),
      quietEnd: clockOf(Date.now() + 60 * 60 * 1000),
    },
  },
});

await test('启动预热：不投递，但把人格/记忆/群聊素材变成 goals 写进状态', async (h) => {
  seedOwner(h);
  h.appendSocialV2Message('group:456', '群友', '那个养鱼游戏怎么玩啊', '那个养鱼游戏怎么玩啊', false, false, 'm3');
  await h.warmPurposeState();
  assert.ok(h.purposeState.goals.length >= 1, '预热后应有目标假设');
  assert.ok(h.purposeState.drives.connect >= 0, '预热后驱动应落盘');
  assert.ok(h.purposeState.observations.length >= 1, '预热后观察账本应有条目');
  assert.ok(h.purposeState.lastCandidateCount >= 1, '预热后应能算出候选');
  assert.equal(h.calls.prompts.length, 0, '预热不能投递');
});

await test('关掉总开关：非强制不投递；模式不对也不投递', async (h) => {
  seedOwner(h);
  h.cfg.purpose.enabled = false;
  const r = await h.runPurpose({});
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'disabled');
  h.cfg.purpose.enabled = true;
  h.setMode('chat');
  const r2 = await h.runPurpose({});
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'mode');
});

console.log(`\n${failures ? 'FAILED' : 'OK'}（purpose wiring）`);
process.exitCode = failures ? 1 : 0;
