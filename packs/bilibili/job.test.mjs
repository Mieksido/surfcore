/**
 * B站 分享任务测试（纯计算 + 注入假模型/假发送；不联网）
 * 跑法：node packs/bilibili/job.test.mjs
 */
import {
  SHARE_HISTORY_KEEP_MS, planShareJob, applyShareResult, cleanShareReply, runShareJob,
} from './job.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };
const at = (s) => Date.parse(s);

const TIMES = ['07:00', '11:00', '13:00', '15:00', '17:00', '19:00', '21:00', '23:00'];
const RECORDS = [
  { text: '视频：猫猫视频。很可爱', tags: ['bvid:BV1'], from: { at: 100 }, importance: 35 },
  { text: '视频：旧视频', tags: ['bvid:BV2'], from: { at: 200 }, importance: 80 },
];

console.log('## 不该到点：不产出任务');
{
  const r = planShareJob({ now: at('2026-11-10T20:00:00'), times: TIMES, state: {}, records: RECORDS });
  ok(r.due === false && r.reason === 'missed-window', '20:00 的最近点是 19:00，已过补跑窗口：不跑');
  ok(r.next.label === '21:00', '给下一个点');
}

console.log('\n## 到点：选卡 + 提示词');
{
  const r = planShareJob({ now: at('2026-11-10T21:05:00'), times: TIMES, state: {}, records: RECORDS });
  ok(r.due === true && r.reason === 'ready', '21:05 在补跑窗口：ready');
  ok(r.slot.key === '2026-11-10 21:00', '槽位键');
  ok(r.card.id === 'BV2', '先挑重要度高的');
  ok(r.cardMode === 'text' && r.cardText.includes('【B站】'), '默认 text：系统先发卡');
  ok(r.prompt.includes('猫猫') === false && r.prompt.includes('旧视频'), '提示词用选中的卡（BV2）');
  ok(r.prompt.includes('已经由系统发到群里'), '卡已发：提示词只要求短评');
}

console.log('\n## 没有新鲜素材：跳过，不发旧的');
{
  const state = { shareHistory: { BV1: new Date(at('2026-11-10T00:00:00')).toISOString(), BV2: new Date(at('2026-11-10T00:00:00')).toISOString() } };
  const r = planShareJob({ now: at('2026-11-10T21:05:00'), times: TIMES, state, records: RECORDS });
  ok(r.due === true && r.reason === 'no-fresh-material', '到点了但没新材料：明确跳过');
  ok(!r.card && !r.prompt, '不产出卡/提示词');
  ok(String(r.hint).includes('不发旧的'), '说明为什么不发');
}

console.log('\n## off 模式：不先发卡，提示词要求带链接');
{
  const r = planShareJob({ now: at('2026-11-10T21:05:00'), times: TIMES, state: {}, records: RECORDS, shareMode: { cardMode: 'off' } });
  ok(r.due && r.cardText === '', 'off：系统不发卡');
  ok(r.prompt.includes('BV2'), '提示词里有链接，交给角色写');
  ok(r.prompt.includes('不要再发链接') === false, 'off 模式不要求"不要发链接"');
}

console.log('\n## 状态推进：槽位 + 30 天历史');
{
  const slot = { key: '2026-11-10 21:00', label: '21:00' };
  const now = at('2026-11-10T21:05:00');
  const state = { lastSlots: { old: '2026-01-01T00:00:00.000Z' }, shareHistory: { old: '2026-01-01T00:00:00.000Z' } };
  const next = applyShareResult(state, { slot, card: { id: 'BV2' }, now });
  ok(next.lastSlot === slot.key, '记下最后槽位');
  ok(next.lastSlots[slot.key] === new Date(now).toISOString(), '槽位时间');
  ok(next.shareHistory.BV2 === new Date(now).toISOString(), '素材进历史');
  ok(!next.shareHistory.old, '30 天前的历史清掉');
  ok(state.shareHistory.old, '不改入参（纯函数）');
  ok(SHARE_HISTORY_KEEP_MS === 30 * 86400000, '保留 30 天');
  ok(applyShareResult(state, { slot: null, card: null }) === state, '缺槽位/卡：原样返回');
}

console.log('\n## 模型输出清理');
{
  ok(cleanShareReply('  “今天看到个好玩的。”  ') === '今天看到个好玩的。', '去引号/空白');
  ok(cleanShareReply('[SILENT]') === null, '沉默：null');
  ok(cleanShareReply('[沉默]') === null, '中文沉默标记也认');
  ok(cleanShareReply('') === null, '空：null');
  ok(cleanShareReply('x'.repeat(900)).length === 500, '超长截断');
}

console.log('\n## 执行：假模型 + 假发送');
{
  const plan = planShareJob({ now: at('2026-11-10T21:05:00'), times: TIMES, state: {}, records: RECORDS });
  const calls = [];
  const model = { complete: async () => ({ text: '这个猫猫也太可爱了，笑死。' }) };
  const send = async (channel, intent) => { calls.push({ channel, intent }); return { status: 'delivered' }; };
  const out = await runShareJob({ plan, groups: ['123', 'group:456'], model, system: '系统', send });
  ok(out.sentGroups === 2, '两个群都发成功');
  ok(calls.length === 4, '每个群：卡 + 短评 = 4 条');
  ok(calls[0].channel === 'group:123' && calls[1].channel === 'group:123', '群号归一为 group:');
  ok(calls[0].intent.text.includes('【B站】'), '第一条是卡');
  ok(calls[1].intent.text.includes('猫猫') && calls[1].intent.aiGenerated === true, '第二条是 AI 短评且带标识');
  ok(out.failures.length === 0, '没有失败');

  const badModel = { complete: async () => ({ error: { message: '模型挂了' } }) };
  const failed = await runShareJob({ plan, groups: ['1'], model: badModel, send });
  ok(failed.reason === 'model-failed' && failed.sentGroups === 0, '模型失败：一条都不发');

  const badSend = async () => ({ status: 'failed', error: { message: '网关拒绝' } });
  const sendFail = await runShareJob({ plan, groups: ['1'], model, send: badSend });
  ok(sendFail.sentGroups === 0 && sendFail.failures[0].error.includes('网关拒绝'), '发送失败：如实返回');

  const noGroups = await runShareJob({ plan, groups: [], model, send });
  ok(noGroups.reason === 'no-groups', '没白名单群：跳过并说明');

  const notDue = await runShareJob({ plan: { due: false, reason: 'already-used' }, groups: ['1'], model, send });
  ok(notDue.skipped === true, '没到点：不执行');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
