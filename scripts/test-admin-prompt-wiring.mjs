/**
 * 管理员提示词的接线回归：纯函数测过了，但还得确认 bridge.js 真的把它们塞进了
 * 每条消息的人格提示、二代唤醒、以及管理员消息标记里。
 *
 * 用真实桥接源码（audit-bridge-harness 的 VM）跑，不连 QQ / DSH：
 *   1. reserved2 唤醒 prompt 必须带管理员身份 + 温柔规则；
 *   2. 角色提示（qq_get_prompt 的内容）也必须带；
 *   3. 管理员消息标记是【管理员·温柔】；
 *   4. 关掉 gentle 后只保留身份，不再出现「绝不回嘴」。
 *
 * 运行：node scripts/test-admin-prompt-wiring.mjs
 */
import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const ADMIN = {
  qq: '10001',
  biliMid: '20002',
  biliName: '测试B站昵称',
  displayName: '主人',
  gentle: true,
};

async function withHarness(config, run) {
  const h = await bridgeHarness({ config });
  try {
    h.setMode('reserved2');
    await run(h);
  } finally {
    await h.close();
  }
}

await withHarness({ ownerQQ: ADMIN.qq, admin: ADMIN }, async (h) => {
  const key = 'group:456';
  const wake = h.buildWakePromptV2(key, 'question');
  assert.ok(wake.includes('【管理员·温柔模式】'), '二代唤醒必须带管理员温柔规则（否则每次醒来都看不到）');
  assert.ok(wake.includes('绝不回嘴'), '唤醒提示必须包含「绝不回嘴」');
  assert.ok(wake.includes(ADMIN.qq), '唤醒提示要认出管理员 QQ');
  assert.ok(wake.includes(ADMIN.biliMid), '唤醒提示要知道管理员 B站 mid（同一个人）');
  assert.ok(wake.includes('主人'), '唤醒提示要用管理员称呼');
  // 2026-10-23：她把群里转发的「她在别的群的聊天记录」说成了自己在 B站 说过的话。
  // 唤醒 prompt 每轮都要带【来源判断】，否则模型只按内容相似度猜平台（PITFALLS #40）。
  assert.ok(wake.includes('【来源判断】'), '唤醒提示必须带来源判断块');
  assert.ok(wake.includes('合并转发 / 聊天记录 = QQ 聊天内容'), '来源判断块要明确合并转发属于 QQ');

  const roleHint = h.currentRoleHintV2();
  assert.ok(roleHint.includes('【管理员 · 温柔模式'), '角色提示（qq_get_prompt.hint）必须带完整管理员规则');
  assert.ok(roleHint.includes('绝不回嘴'));
  assert.ok(roleHint.includes(ADMIN.biliMid));

  assert.equal(h.ownerMessageTag(), '【管理员·温柔】', '管理员消息标记要更醒目');
});

await withHarness({ ownerQQ: ADMIN.qq, admin: { ...ADMIN, gentle: false } }, async (h) => {
  const wake = h.buildWakePromptV2('group:456', 'question');
  assert.ok(!wake.includes(ADMIN.qq), '关掉温柔模式后不再注入管理员身份块');
  assert.ok(!wake.includes('绝不回嘴'), '关掉后不得再注入语气硬规则');
  const roleHint = h.currentRoleHintV2();
  assert.ok(!roleHint.includes('【管理员】'), '关掉后角色提示也不留管理员标记');
  assert.ok(!roleHint.includes('绝不回嘴'), '关掉后角色提示也不得带语气规则');
  assert.equal(h.ownerMessageTag(), '', '关掉后消息标记必须为空');
});

// 未配置管理员（ownerQQ 也空）：不能凭空造出规则，也不能报错。
await withHarness({ ownerQQ: null }, async (h) => {
  const wake = h.buildWakePromptV2('group:456', 'question');
  assert.ok(!wake.includes('管理员·温柔模式'), '未配置时不得注入管理员规则');
  assert.equal(h.ownerMessageTag(), '', '未配置时也不能凭空留【管理员】标记');
});

console.log('admin prompt wiring tests OK');
