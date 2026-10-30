// 「群里发图片回不回」的唤醒回归（2026-10-30，两次用户实测驱动）。
//
// 第一版：纯图片消息没有文字，atMention/名字/关键词/提问等文字类触发条件全都不命中，
// 只剩 5% 概率唤醒 → 用户实感「我在群里发图片它不回我」。当时做成"主人发图必醒"。
// 第二版（用户后续要求）：图片/表情也改成**概率唤醒 0.1**，并且群友发图也参与。
//   模式：probability（缺省，所有人含主人按 10%）/ owner（主人必醒、群友 10%）/ any / off。
//   关键约束：概率没中时**不再落回普通消息的 5% 概率**，否则 0.1 实际是 ~14.5%，不可预测。
//
// 全部在 VM 夹具里跑（虚拟网关 + 临时目录），不连真 QQ / DSH。
// 运行：node scripts/test-media-wake.mjs
import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';

let failures = 0;
async function test(name, run, options = {}) {
  const h = await bridgeHarness(options.harness ?? {});
  try {
    h.setMode('reserved2');
    h.setSelfIdentity('小鲸鱼', 111);
    seedWakeState(h, options.key ?? 'group:456', options.triggers ?? {});
    await run(h);
    console.log('PASS', name);
  } catch (error) {
    failures++;
    console.error('FAIL', name, '—', error?.stack ?? error);
  } finally {
    await h.close();
  }
}

// 潜水 + 文字类触发（probability 默认 0，杜绝随机通过/失败；需要时用 options.triggers 覆盖）。
function seedWakeState(h, key, overrides = {}) {
  const st = h.getSocialV2State(key);
  st.bootstrapSent = true;
  st.wakeConfig = {
    mode: 'diving', infinite: true, sleepUntil: null,
    triggers: {
      atMention: true, nameMention: true, speakerIds: [], keywords: ['小鲸鱼'],
      question: true, poke: true, anyMessage: false, probability: 0,
      ...overrides,
    },
    batchWindowMs: 60000, lastWakeAt: 0, wakeCount: 0, noActionCount: 0,
    confirmedAt: Date.now(), confirmedBy: 'set_wake_config',
  };
  return st;
}

function baseEvent({ groupId = 456, userId = 123, messageId = 3001, nickname = 'owner' } = {}) {
  return {
    post_type: 'message',
    message_type: 'group',
    group_id: groupId,
    user_id: userId,
    self_id: 111,
    message_id: messageId,
    sender: { user_id: userId, nickname },
  };
}

const imageEvent = (opts = {}) => ({
  ...baseEvent(opts),
  message: [{ type: 'image', data: { file: 'shot.jpg', url: 'https://example.invalid/shot.jpg', summary: '[图片]', sub_type: '0' } }],
});
const stickerEvent = (opts = {}) => ({
  ...baseEvent(opts),
  message: [{ type: 'mface', data: { file: 'm.gif', url: 'https://example.invalid/m.gif', summary: '给你糖吃' } }],
});
const faceEvent = (opts = {}) => ({
  ...baseEvent(opts),
  message: [{ type: 'face', data: { id: '178' } }],
});
const textEvent = (opts = {}, text = '随便聊两句') => ({
  ...baseEvent(opts),
  message: [{ type: 'text', data: { text } }],
});

function wakeState(h, key = 'group:456') {
  const st = h.getSocialV2State(key);
  return { scheduled: Boolean(st.pendingWakeTimer), reason: st.pendingWakeReason || '' };
}

const cfgWith = (mediaWake, extra = {}) => ({ harness: { config: { socialV2: { wake: { mediaWake, ...extra } } } } });
const PROB = (p) => cfgWith('probability', { mediaWakeProbability: p });
const OWNER = (p) => cfgWith('owner', { mediaWakeProbability: p });

// ── 概率模式（当前默认）：10%，主人和群友一视同仁 ────────────────────────
await test('probability 模式 p=1：主人图片 → media', async (h) => {
  await h.handleIncoming('group', '456', imageEvent(), h.cfg);
  assert.equal(wakeState(h).reason, 'media');
}, PROB(1));

await test('probability 模式 p=1：群友图片也唤醒（用户要求"群友发图也唤醒"）', async (h) => {
  await h.handleIncoming('group', '456', imageEvent({ userId: 999 }), h.cfg);
  assert.equal(wakeState(h).reason, 'media');
}, PROB(1));

await test('probability 模式 p=0：谁发图都不醒，且不落回普通消息概率（不双摇）', async (h) => {
  // triggers.probability=1 用来证明"媒体概率没中就直接结束"，否则这里会因普通概率必醒而失败。
  await h.handleIncoming('group', '456', imageEvent(), h.cfg);
  assert.equal(wakeState(h).scheduled, false, '主人图：0.1 概率没中就不该醒');
  await h.handleIncoming('group', '456', imageEvent({ userId: 999, messageId: 3002 }), h.cfg);
  assert.equal(wakeState(h).scheduled, false, '群友图：同样不双摇普通概率');
}, { ...PROB(0), triggers: { probability: 1 } });

await test('mediaWake 乱写 → 收敛成 probability（不是 owner/any），p 沿用配置', async (h) => {
  const h2 = await bridgeHarness({ config: { socialV2: { wake: { mediaWake: '随便写的', mediaWakeProbability: 0 } } } });
  try {
    h2.setMode('reserved2');
    h2.setSelfIdentity('小鲸鱼', 111);
    seedWakeState(h2, 'group:456', { probability: 1 });
    assert.match(h2.buildWakePromptV2('group:456', 'media'), /图片\/表情\/动图\/链接\(概率0%\)/, '乱写的值要落到概率模式，比例沿用配置');
    await h2.handleIncoming('group', '456', imageEvent(), h2.cfg);
    assert.equal(wakeState(h2).scheduled, false, '坏值不能变成"必醒"，概率 0 时不醒');
  } finally { await h2.close(); }
});

// ── owner 模式（折中）：主人必醒，群友按概率 ──────────────────────────────
await test('owner 模式：主人图片必醒（p=0 也醒）', async (h) => {
  await h.handleIncoming('group', '456', imageEvent(), h.cfg);
  assert.equal(wakeState(h).reason, 'media');
}, OWNER(0));

await test('owner 模式 p=0：群友图片不醒', async (h) => {
  await h.handleIncoming('group', '456', imageEvent({ userId: 999 }), h.cfg);
  assert.equal(wakeState(h).scheduled, false);
}, { ...OWNER(0), triggers: { probability: 1 } });

await test('owner 模式 p=1：群友图片也醒', async (h) => {
  await h.handleIncoming('group', '456', imageEvent({ userId: 999 }), h.cfg);
  assert.equal(wakeState(h).reason, 'media');
}, OWNER(1));

// ── any / off / 媒体类型边界 ──────────────────────────────────────────────
await test('any 模式：群友图片必醒（p=0 也醒）', async (h) => {
  await h.handleIncoming('group', '456', imageEvent({ userId: 999 }), h.cfg);
  assert.equal(wakeState(h).reason, 'media');
}, { ...cfgWith('any'), triggers: { probability: 0 } });

await test('off 模式：连主人图片也不唤醒（回退到旧行为，只走普通消息概率）', async (h) => {
  await h.handleIncoming('group', '456', imageEvent(), h.cfg);
  assert.equal(wakeState(h).scheduled, false);
}, { ...cfgWith('off'), triggers: { probability: 0 } });

await test('市场表情（mface）算媒体：p=1 时唤醒', async (h) => {
  await h.handleIncoming('group', '456', stickerEvent(), h.cfg);
  assert.equal(wakeState(h).reason, 'media');
}, PROB(1));

await test('QQ 小黄脸（face）不算媒体：p=1 也不醒', async (h) => {
  await h.handleIncoming('group', '456', faceEvent(), h.cfg);
  assert.equal(wakeState(h).scheduled, false);
}, { ...PROB(1), triggers: { probability: 0 } });

// ── 文字原因优先 ──────────────────────────────────────────────────────────
await test('图片 + @机器人 → 原因仍是 atMention（文字原因优先，不掷概率）', async (h) => {
  await h.handleIncoming('group', '456', {
    ...imageEvent({ messageId: 3002 }),
    message: [
      { type: 'at', data: { qq: 111 } },
      { type: 'image', data: { file: 'a.jpg', url: 'https://example.invalid/a.jpg', summary: '[图片]' } },
    ],
  }, h.cfg);
  assert.equal(wakeState(h).reason, 'atMention');
}, PROB(0));

await test('纯文字（无 @/关键词）不唤醒——媒体规则只补图片通道', async (h) => {
  await h.handleIncoming('group', '456', textEvent(), h.cfg);
  assert.equal(wakeState(h).scheduled, false);
}, PROB(1));

// ── 管理员：owner 模式下 admin.qq≠ownerQQ 也算"自己人"（必醒，靠概率太弱）──
await test('owner 模式：管理员（admin.qq≠ownerQQ）发图必醒', async (h) => {
  await h.handleIncoming('group', '456', imageEvent({ userId: 77777 }), h.cfg);
  assert.equal(wakeState(h).reason, 'media');
}, { harness: { config: { ownerQQ: '123', admin: { qq: '77777' }, socialV2: { wake: { mediaWake: 'owner', mediaWakeProbability: 0 } } } } });

// ── 唤醒提示词 ────────────────────────────────────────────────────────────
await test('media 唤醒提示词带 qq_get_message_images 与 messageId 指引', async (h) => {
  const prompt = h.buildWakePromptV2('group:456', 'media');
  assert.match(prompt, /qq_get_message_images/, '不给出看图工具，模型只能对 [图片] 瞎猜或装死');
  assert.match(prompt, /messageId/, '要给出 messageId 从哪来');
  assert.match(prompt, /图片\/表情/);
});

await test('【当前唤醒】默认显示"概率10%"', async (h) => {
  assert.match(h.buildWakePromptV2('group:456', 'media'), /图片\/表情\/动图\/链接\(概率10%\)/);
}, { harness: {} });

await test('【当前唤醒】owner 模式：主人必醒 / 群友 10%', async (h) => {
  assert.match(h.buildWakePromptV2('group:456', 'media'), /图片\/表情\/动图\/链接\(主人必醒\/群友10%\)/);
}, OWNER(0.1));

await test('【当前唤醒】any 模式显示"所有人"', async (h) => {
  assert.match(h.buildWakePromptV2('group:456', 'media'), /图片\/表情\/动图\/链接\(所有人\)/);
}, cfgWith('any'));

await test('【当前唤醒】off 模式不列图片触发', async (h) => {
  assert.doesNotMatch(h.buildWakePromptV2('group:456', 'media'), /图片\/表情\/动图\/链接\(/);
}, cfgWith('off'));

// ── 私聊不受影响：私聊本来就必醒 ──────────────────────────────────────────
await test('私聊图片 → 原因 private（与 mediaWake / 概率解耦）', async (h) => {
  await h.handleIncoming('private', '123', {
    post_type: 'message', message_type: 'private', user_id: 123, self_id: 111, message_id: 3010,
    sender: { user_id: 123, nickname: 'owner' },
    message: [{ type: 'image', data: { file: 'p.jpg', url: 'https://example.invalid/p.jpg', summary: '[图片]' } }],
  }, h.cfg);
  assert.equal(wakeState(h, 'private:123').reason, 'private');
}, { key: 'private:123', ...PROB(0) });

if (failures > 0) {
  console.error(`\n${failures} 条媒体唤醒回归失败`);
  process.exit(1);
}
console.log('\nmedia-wake 回归全部通过');
