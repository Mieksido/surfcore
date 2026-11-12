/**
 * QQ 历史补读（纯选择 + 假 client）
 * 跑法：node packs/qq/history.test.mjs
 */
import { rememberEvent, selectMissedHistory, historyMessageToEvent, createHistoryCatchup } from './history.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass += 1; console.log('  ✅', n); } else { fail += 1; console.error('  ❌', n); } };
const now = Date.parse('2026-01-01T12:00:00.000Z');
const ev = (id, at, text = id) => ({ externalId: id, from: { channel: 'group:1', at, actor: 'u' }, text });

console.log('## 水位/去重');
{
  const state = {};
  rememberEvent(state, ev('m1', now - 10000));
  rememberEvent(state, ev('m2', now - 5000));
  ok(state['group:1'].at === now - 5000 && state['group:1'].ids.length === 2, '记住最新时间与编号');
  const picked = selectMissedHistory([
    ev('m3', now - 3000), ev('m2', now - 5000), ev('old', now - 3 * 60 * 60 * 1000),
  ], { afterAt: state['group:1'].at, knownIds: state['group:1'].ids, now, maxAgeMs: 60 * 60 * 1000 });
  ok(picked.length === 1 && picked[0].externalId === 'm3', '只补水位后、未见过、未过期');
  ok(selectMissedHistory([ev('', now)], { now }).length === 0, '没编号：跳过');
}

console.log('\n## OneBot 历史 → 事件');
{
  const e = historyMessageToEvent({
    group_id: 123, user_id: 456, message_id: 9, time: Math.floor(now / 1000), raw_message: '你好',
    sender: { user_id: 456, nickname: 'u' },
  }, { ownerId: '456' });
  ok(e && e.from.channel === 'group:123' && e.to.owner === true, '群/主人识别');
  ok(e.silent === true && e.text === '你好', 'silent=true，文本正确');
  ok(historyMessageToEvent({ user_id: 1 }, {}) === null, '没有群号：跳过');
}

console.log('\n## 假 client：补历史');
{
  const client = { async call(action, params) {
    ok(action === 'get_group_msg_history' && params.group_id === 1, '调用正确 action');
    return { ok: true, data: [
      { group_id: 1, user_id: 2, message_id: 11, time: Math.floor((now - 2000) / 1000), raw_message: '补一' },
      { group_id: 1, user_id: 2, message_id: 12, time: Math.floor((now - 1000) / 1000), raw_message: '补二' },
    ] };
  } };
  const c = createHistoryCatchup({ client, ownerId: '2', now: () => now });
  const r = await c.catchup('group:1');
  ok(r.ok && r.fetched === 2 && r.missed.length === 2, '补到 2 条');
  ok(r.missed.every((x) => x.silent === true), '都标 silent');
  c.remember(r.missed[0]); c.remember(r.missed[1]);
  const again = await c.catchup('group:1');
  ok(again.missed.length === 0, '第二次不重复补');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
