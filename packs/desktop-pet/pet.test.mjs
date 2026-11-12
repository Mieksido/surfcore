/**
 * 桌宠 包测试
 * 跑法：node packs/desktop-pet/pet.test.mjs
 */
import pack, { createBubbles, gatePush, decideVoice, configure, setFocus, send, open, push, health, identity, capabilities } from './index.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

let clock = 1000;
const bubbles = createBubbles({ ttlMs: 100, max: 2, now: () => clock });

console.log('## 气泡队列');
{
  ok(bubbles.push({ text: '嗨' }).ok, '推一条气泡');
  ok(bubbles.size() === 1, '队列里有 1 条');
  bubbles.push({ text: '第二句' });
  ok(!bubbles.push({ text: '第三句' }).ok, '超过上限：拒绝（不堆成山）');
  clock += 200;
  ok(bubbles.size() === 0, '过期自动清掉');
  ok(bubbles.list().length === 0, '列表也是空的');
}

console.log('\n## 专注门（用户按的"别吵我"）');
{
  ok(gatePush({ focusOn: false }).ok, '没专注：可以发');
  ok(!gatePush({ focusOn: true, hardStop: true }).ok, '专注 + 硬停：一律不发');
  ok(gatePush({ focusOn: true, hardStop: true }).reason === 'focus', '原因写明是专注');
  ok(gatePush({ focusOn: true, hardStop: false }).ok, '关掉硬停：专注时仍可发（用户自己的选择）');
  const other = gatePush({ carrierIsPet: false });
  ok(!other.ok && other.reason === 'carrier-not-pet', '载体不是桌宠：这轮不该我发');
}

console.log('\n## 语音决策（三个条件都满足才用）');
{
  ok(!decideVoice({ wantVoice: false, enabled: true, available: true }).useVoice, '没要求语音：不用');
  ok(!decideVoice({ wantVoice: true, enabled: false, available: true }).useVoice, '没开启：不用');
  ok(decideVoice({ wantVoice: true, enabled: false, available: true }).reason === 'disabled', '原因：没开启');
  ok(!decideVoice({ wantVoice: true, enabled: true, available: false }).useVoice, '通道没起：不用');
  ok(decideVoice({ wantVoice: true, enabled: true, available: true }).useVoice, '三个都满足：用语音');
}

console.log('\n## 平台包接线');
{
  ok(identity.publisher === 'surfcore' && identity.name === 'desktop-pet', '身份：发布人+名字');
  ok(capabilities.special.readReceipt === true, '能力：桌宠有已读（气泡关掉可观测）');
  ok(pack.settings.length >= 3, '菜单：有可调项');

  const emitted = [];
  const ctx = { emit: (e) => emitted.push(e), log: () => {} };
  push({ text: '在吗', actor: 'owner' }, ctx);
  ok(emitted.length === 1 && emitted[0].from.channel === 'pet:main', '收：长轮询来的话变成事件');
  ok(push({ text: '   ' }, ctx) === null, '收：空内容不上报');

  configure({ ttlMs: 60000, voiceEnabled: false });
  await open({ log: () => {} });
  ok((await send({ kind: 'say', text: '嗨' })).status === 'delivered', '发：气泡推出去了');
  ok((await send({ kind: 'say', text: '再说一句' })).externalId?.startsWith('b_'), '回执里带气泡编号');

  setFocus(true);
  const blocked = await send({ kind: 'say', text: '专注时不该发' });
  ok(blocked.status === 'unsupported' && blocked.error.code === 'pet.blocked', '专注时：如实回"被挡住"，不假装发了');
  setFocus(false);
  ok((await send({ kind: 'stay_silent' })).status === 'delivered', '沉默：回执成功但什么都不做');
  const voice = await send({ kind: 'send_media', media: [{ kind: 'audio', path: 'C:/tmp/voice.wav' }], text: '听我说' });
  ok(voice.status === 'delivered' && voice.voice === true, '语音：跨大适配器送到桌宠，变成带音频的气泡');
  const noAudio = await send({ kind: 'send_media', media: [{ kind: 'image', path: 'C:/tmp/a.png' }] });
  ok(noAudio.status === 'unsupported' && noAudio.error.code === 'pet.audio-missing', '非音频媒体：如实拒绝');

  const h = await health();
  ok(h.status === 'ok' && h.focused === false, '报平安：带专注状态');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
