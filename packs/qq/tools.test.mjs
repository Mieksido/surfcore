/**
 * QQ 工具层测试（注入假网关，不联网）
 * 跑法：node packs/qq/tools.test.mjs
 */
import { QQ_TOOLS, createToolRunner } from './tools.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

function fakeClient() {
  const calls = [];
  return {
    calls,
    async call(action, params) { calls.push({ action, params }); return { ok: true, status: 'delivered', data: { action } }; },
  };
}

console.log('## 清单：分级');
{
  const kinds = new Set(QQ_TOOLS.map((t) => t.kind));
  ok(kinds.has('read') && kinds.has('write') && kinds.has('manage'), '三类都有：只读/写/管理');
  ok(QQ_TOOLS.length >= 10, `工具数量：${QQ_TOOLS.length}`);
  ok(QQ_TOOLS.every((t) => t.name && t.action), '每个工具都有名字和 action');
}

console.log('\n## 只读：默认可用');
{
  const client = fakeClient();
  const runner = createToolRunner({ client });
  const r = await runner.run('get_login_info', {}, 'group:1');
  ok(r.ok === true, '只读工具：直接可用');
  ok(client.calls[0].action === 'get_login_info', '打到正确的 action');

  const list = await runner.run('get_group_member_list', {}, 'group:123');
  ok(list.ok && client.calls[1].params.group_id === 123, '需要群的工具：从频道自动取 group_id');

  const hist = await runner.run('get_group_msg_history', { messageSeq: 88 }, 'group:123');
  ok(hist.ok && client.calls[2].action === 'get_group_msg_history', '群历史：走 OneBot 的 get_group_msg_history');
  ok(client.calls[2].params.group_id === 123 && client.calls[2].params.message_seq === 88, '群历史：messageSeq → message_seq（可选参数原样带）');
}

console.log('\n## 写与管理：默认关闭（fail-closed）');
{
  const client = fakeClient();
  const runner = createToolRunner({ client });
  const w = await runner.run('delete_msg', { messageId: 9 }, 'group:1');
  ok(w.ok === false && w.error.code === 'qq.tool-denied', '写操作没打开：拒绝');
  const m = await runner.run('set_group_ban', { userId: 7, duration: 60 }, 'group:1');
  ok(m.ok === false && m.error.code === 'qq.tool-denied', '管理操作没打开：拒绝');
  ok(client.calls.length === 0, '被拒绝的动作：一次都没打出去');
}

console.log('\n## 打开之后：参数映射');
{
  const client = fakeClient();
  const runner = createToolRunner({ client, allowWrite: true, allowManage: true });
  await runner.run('delete_msg', { messageId: 9 }, 'group:1');
  ok(client.calls[0].params.message_id === 9, 'camelCase → snake_case（message_id）');

  await runner.run('set_group_card', { userId: 7, card: '小猫' }, 'group:1');
  const p = client.calls[1].params;
  ok(p.group_id === 1 && p.user_id === 7 && p.card === '小猫', '群/人/名片 都映射对');

  await runner.run('set_group_ban', { userId: 7, duration: 600 }, 'group:1');
  ok(client.calls[2].params.duration === 600, '禁言时长传下去');
}

console.log('\n## 参数与场景校验');
{
  const client = fakeClient();
  const runner = createToolRunner({ client, allowWrite: true });
  const miss = await runner.run('delete_msg', {}, 'group:1');
  ok(miss.error.code === 'qq.tool-missing-arg', '缺参数：报错，不猜');
  const wrongScene = await runner.run('set_group_card', { userId: 7, card: 'x' }, 'private:9');
  ok(wrongScene.error.code === 'qq.tool-need-group', '群工具用在私聊：明确报错');
  const unknown = await runner.run('不存在的工具', {}, 'group:1');
  ok(unknown.error.code === 'qq.tool-unknown', '未知工具：报错');
  ok(typeof runner.list === 'function' && runner.list().length === QQ_TOOLS.length, 'list() 给设置页看');
}

console.log('\n## 网关失败：如实回传');
{
  const bad = { async call() { return { ok: false, error: { code: 'qq.send-failed', message: '风控' } }; } };
  const runner = createToolRunner({ client: bad });
  const r = await runner.run('get_login_info', {}, 'group:1');
  ok(r.ok === false && r.error.code === 'qq.send-failed', '网关失败：原样带回错误码');
  ok(String(r.error.message).includes('风控'), '带回网关原话（便于排查）');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
