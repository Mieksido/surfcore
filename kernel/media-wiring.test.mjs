/**
 * 媒体入库 + 收藏表情 + 学新词 的接线测试
 * 跑法：node kernel/media-wiring.test.mjs
 */
import { createKernel } from './index.js';
import { createScriptedModel } from './expression/model-port.js';
import { mediaBriefOf } from './expression/media-brief.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

const NOW = 1000;
const mk = (script) => createKernel({ now: () => NOW, persona: { name: 'T', core: 'c' }, admin: 'owner', model: createScriptedModel(script) });
const EV = (extra = {}) => ({ from: { channel: 'c1', kind: 'private', actor: 'owner', at: NOW, ...(extra.from ?? {}) }, text: extra.text ?? '看这个', to: { owner: true }, media: extra.media ?? [] });
const VIEWER = { channelId: 'c1', kind: 'private', isOwner: true };

console.log('## 媒体入库：包下好的字节 → 媒体库 → 事件只留编号');
{
  const k = mk([{ text: '好可爱' }]);
  const r = await k.respond(EV({ media: [{ kind: 'image', bytes: Buffer.from('CAT'), caption: '猫' }] }), VIEWER);
  const rec = k.memory.snapshot()[0];
  ok(Array.isArray(rec.media) && rec.media.length === 1, '记录里带 1 份媒体');
  ok(rec.media[0].id, '记录里存的是**编号**，不是原始字节');
  ok(!rec.media[0].bytes, '原始字节没进记录（只进媒体库）');
  ok(k.media.refFor(rec.media[0].id) !== null, '用编号能换回媒体（媒体库里有）');
  ok(r.wake === true, '带媒体的事件正常醒');
}

console.log('\n## 提示词里能看到媒体的"编号 + 说明"');
{
  const brief = mediaBriefOf({ media: [{ id: 'm_abcdef123456', kind: 'image', caption: '一只猫' }] });
  ok(brief.includes('图片'), '说清类型');
  ok(brief.includes('m_abcdef12'), '带编号（模型要能指名道姓）');
  ok(brief.includes('一只猫'), '带说明');
  ok(!brief.includes('bytes'), '不带技术字段');
  ok(mediaBriefOf({ media: [{ kind: 'audio', transcript: '今晚吃火锅' }] }).includes('火锅'), '语音带文字稿');
}

console.log('\n## 收藏表情：只给编号和情绪，挑/存由内核做');
{
  // 媒体编号按内容指纹算：先用一个探针内核算出编号，再造真正要测的内核
  const probe = mk([{ text: 'x' }]);
  const item = probe.media.put({ kind: 'image', bytes: Buffer.from('IMG1'), caption: '猫笑' });

  const k = mk([{ toolCalls: [{ name: 'save_sticker', args: { mediaId: item.id, emotion: '开心', tags: ['猫'], note: '猫笑' } }] }]);
  const same = k.media.put({ kind: 'image', bytes: Buffer.from('IMG1'), caption: '猫笑' });
  ok(same.id === item.id, '同内容的编号一致（指纹去重）');

  const r = await k.respond(EV({ media: [{ id: same.id, kind: 'image', caption: '猫笑' }] }), VIEWER);
  const list = k.stickers.list();
  ok(list.length === 1, '收藏成功（1 张）');
  ok(list[0].emotion === '开心' && list[0].tags.includes('猫'), '情绪和标签存对了');
  ok(list[0].mediaId === same.id, '存的是媒体编号引用（不复制图片）');
  ok(r.intents.length === 0, '收藏不产出要发的消息');
  ok(k.audit.list().some((a) => a.kind === 'sticker.collected'), '审计留痕');
}

console.log('\n## 收藏失败：编号不存在就如实记，不乱存');
{
  const k = mk([{ toolCalls: [{ name: 'save_sticker', args: { mediaId: 'm_不存在', emotion: '开心' } }] }]);
  await k.respond(EV(), VIEWER);
  ok(k.stickers.list().length === 0, '没有硬存进去');
  ok(k.audit.list().some((a) => a.kind === 'sticker.collect-failed'), '审计记失败（可见）');
}

console.log('\n## 学新词：只进候选，不马上用');
{
  const k = mk([{ toolCalls: [{ name: 'learn_word', args: { word: '绝绝子', context: '群里有人这么说' } }] }]);
  await k.respond(EV(), VIEWER);
  ok(k.lexicon.pending().length === 1, '进了候选池');
  ok(k.lexicon.lookup('绝绝子') === null, '**确认之前她还不认识**');
  ok(k.lexicon.render() === '', '提示词里不出现（没确认）');
  ok(k.audit.list().some((a) => a.kind === 'lexicon.proposed'), '审计留痕');

  k.lexicon.confirm({ word: '绝绝子', meaning: '太厉害了' });
  ok(k.lexicon.render().includes('绝绝子'), '确认后：进提示词');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
