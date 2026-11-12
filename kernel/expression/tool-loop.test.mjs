/**
 * 工具结果回灌测试（顾问 P0：读类工具必须能存在）
 * 跑法：node kernel/expression/tool-loop.test.mjs
 */
import { createExpression } from './index.js';
import { createKernel } from '../index.js';
import { createScriptedModel } from './model-port.js';
import { createIdentity } from '../support/index.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

const identity = createIdentity({ persona: { name: 'T', core: 'c' }, admin: 'o' });

/** 一个会"先读后说"的假模型：第一次返回工具调用，第二次返回台词 */
function makeReadingModel(calls = []) {
  let n = 0;
  return {
    async complete({ messages }) {
      n += 1;
      calls.push(messages.length);
      if (n === 1) return { toolCalls: [{ name: 'get_group_info', args: { groupId: 1 } }] };
      // 第二次调用时，应能看到 tool 消息
      const hasTool = messages.some((m) => m.role === 'tool');
      return { text: hasTool ? '看到了，群里有 3 个人' : '没看到工具结果' };
    },
  };
}

console.log('## 工具往返：读 → 回灌 → 再说');
{
  const seen = [];
  const model = makeReadingModel(seen);
  const expr = createExpression({
    model, identity,
    extraTools: [{ name: 'get_group_info', description: '看群信息', parameters: { type: 'object', properties: {} } }],
    execute: async (name, args) => { seen.push(`${name}:${JSON.stringify(args)}`); return { ok: true, member_count: 3 }; },
  });

  const r = await expr.respond({ event: { text: '群里几个人', from: { actor: 'o' } }, viewer: {} });
  ok(r.steps === 2, '两轮：先工具，再说话');
  ok(r.intents[0].kind === 'say' && r.intents[0].text.includes('3 个人'), '模型看到了工具结果才说话');
  ok(seen.includes('get_group_info:{"groupId":1}'), '执行器被调用，参数原样传过去');
}

console.log('\n## 没有执行器：如实告诉模型"不可用"，不中断');
{
  const model = { async complete({ messages }) {
    const hasTool = messages.some((m) => m.role === 'tool');
    if (!hasTool) return { toolCalls: [{ name: 'get_msg', args: {} }] };
    return { text: '那我看不了' };
  } };
  const expr = createExpression({ model, identity });
  const r = await expr.respond({ event: { text: '看看消息' }, viewer: {} });
  ok(r.steps === 2, '仍然走两轮');
  ok(r.intents[0].text === '那我看不了', '模型收到"不可用"后自己收场');
}

console.log('\n## 步数上限：不无限转圈');
{
  const loops = { async complete() { return { toolCalls: [{ name: 'get_msg', args: {} }] }; } };
  let n = 0;
  const expr = createExpression({ model: loops, identity, execute: async () => { n += 1; return { ok: true }; }, maxSteps: 3 });
  const r = await expr.respond({ event: { text: '一直调工具' }, viewer: {} });
  ok(r.exhausted === true, '用尽步数：标记 exhausted');
  ok(r.intents[0].kind === 'stay_silent', '用尽就沉默（不硬编）');
  ok(n === 3, `执行器最多调 maxSteps 次（实际 ${n}）`);
}

console.log('\n## 执行器抛错：包成结果回灌，不让整轮崩');
{
  const model = { async complete({ messages }) {
    if (!messages.some((m) => m.role === 'tool')) return { toolCalls: [{ name: 'get_msg', args: {} }] };
    return { text: '工具出错了，我换个办法' };
  } };
  const expr = createExpression({ model, identity, execute: async () => { throw new Error('网关拒绝'); } });
  const r = await expr.respond({ event: { text: 'x' }, viewer: {} });
  ok(r.intents[0].kind === 'say', '出错也继续（模型能自己收场）');
  ok(r.errors.length === 0, '错误回灌给模型，不当作她的错误');
}

console.log('\n## 接进内核：remember / close 由内核自己处理');
{
  const k = createKernel({
    now: () => 1000, persona: { name: 'T', core: 'c' }, admin: 'o',
    model: createScriptedModel([{ toolCalls: [{ name: 'remember', args: { text: '主人喜欢猫', importance: 80 } }] }]),
  });
  const r = await k.respond(
    { from: { channel: 'c1', kind: 'private', actor: 'o', at: 1000 }, text: '记住我喜欢猫', to: { owner: true } },
    { channelId: 'c1', kind: 'private', isOwner: true },
  );
  ok(r.intents.length === 0, 'remember 不产出要发的意图（不发给包）');
  ok(k.memory.snapshot().some((x) => x.text === '主人喜欢猫' && x.importance === 80), '真的记进去了（重要度 80）');
  ok(k.audit.list().some((a) => a.kind === 'memory.remembered'), '审计留痕');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
