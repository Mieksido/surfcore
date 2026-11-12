/**
 * 二期接线测试：自动收尾 / 发收藏表情 / 媒体理解
 * 跑法：node kernel/phase2.test.mjs
 *
 * 这三件都是"接线"：模块本身已单测过，这里测它们**真的接进了 respond**。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKernel } from './index.js';
import { createScriptedModel } from './expression/model-port.js';
import { mediaBriefOf } from './expression/media-brief.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

const NOW = Date.parse('2026-11-09T12:00:00');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-p2-'));
const EVENT = (text, extra = {}) => ({
  from: { adapter: 'surfcore@terminal', channel: 'c1', kind: 'private', actor: 'owner', at: NOW },
  text, source: 'user', to: { owner: true }, ...extra,
});
const VIEWER = { channelId: 'c1', kind: 'private', isOwner: true };

function mk(script, extra = {}) {
  return createKernel({ now: () => NOW, persona: { name: 'T', core: 'c' }, admin: 'owner', model: createScriptedModel(script), ...extra });
}

console.log('## 自动收尾：判到该收了，内核自己记下结束点');
{
  const k = mk([{ text: '晚安呀' }]);
  const r = await k.respond(EVENT('晚安'), VIEWER);
  ok(k.audit.list().some((a) => a.kind === 'closure.proposed' && a.reason === 'explicit-farewell'), '审计记下收尾原因');
  ok(!r.intents.some((i) => i.kind === 'close'), 'close 由内核消化（不再发给包）');
  ok(k.audit.list().some((a) => a.kind === 'closure.closed'), '结束点被记下（审计可见）');

  const k2 = mk([{ text: '在呀' }]);
  const r2 = await k2.respond(EVENT('在吗'), VIEWER);
  ok(!k2.audit.list().some((a) => a.kind === 'closure.closed'), '普通聊天：不收尾');

  // 模型自己已经给了 close：不重复（只记一次 closed）
  const k3 = mk([{ toolCalls: [{ name: 'close', args: { summary: '聊完了' } }] }]);
  await k3.respond(EVENT('拜拜'), VIEWER);
  const closedCount = k3.audit.list().filter((a) => a.kind === 'closure.closed').length;
  ok(closedCount === 1, `模型自己收了：不重复记（实际 ${closedCount} 次）`);
}

console.log('\n## 发收藏表情：模型只说情绪，挑哪张内核定');
{
  const dir = tmp();
  const k = mk([{ toolCalls: [{ name: 'send_sticker', args: { emotion: '开心' } }] }], { stateDir: dir });
  const media = k.media.put({ kind: 'image', bytes: Buffer.from('CAT'), caption: '猫笑' });
  k.stickers.add({ id: 's1', mediaId: media.id, emotion: '开心', tags: ['猫'], note: '猫笑' });

  const r = await k.respond(EVENT('讲个笑话'), VIEWER);
  const m = r.intents.find((i) => i.kind === 'send_media');
  ok(Boolean(m), '产出 send_media 意图');
  ok(m.sticker === undefined, 'sticker 字段已被内核消化（不留给包）');
  ok(m.media[0].path && m.media[0].path.includes('media'), '表情被换成真实路径');
  ok(fs.existsSync(m.media[0].path), '文件真的在');
  ok(k.stickers.list()[0].uses === 1, '用过一次：记账');

  // 没有这个情绪：不发，且留审计
  const k2 = mk([{ toolCalls: [{ name: 'send_sticker', args: { emotion: '悲伤' } }] }]);
  const r2 = await k2.respond(EVENT('呜呜'), VIEWER);
  ok(!r2.intents.some((i) => i.kind === 'send_media'), '没有对应表情：不发（不硬凑）');
  ok(k2.audit.list().some((a) => a.kind === 'sticker.miss'), '没挑到进审计（可见）');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n## 媒体理解：把对方发来的东西写成一句话');
{
  const brief = mediaBriefOf({
    media: [
      { kind: 'image', caption: '一只猫躺在键盘上' },
      { kind: 'audio', transcript: '今晚吃火锅吧' },
      { kind: 'video' },
    ],
  });
  ok(brief.includes('图片') && brief.includes('猫'), '图片：带说明');
  ok(brief.includes('语音') && brief.includes('火锅'), '语音：带文字稿');
  ok(brief.includes('视频'), '视频：没有说明就只说类型');
  ok(!brief.includes('bytes') && !brief.includes('path'), '不写技术字段');

  const k = mk([{ text: '好可爱' }]);
  const r = await k.respond(EVENT('看这个', { media: [{ kind: 'image', caption: '猫' }] }), VIEWER);
  ok(r.wake === true, '带图的消息：正常唤醒');
  ok(mediaBriefOf({}) === '', '没有媒体：空串');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
