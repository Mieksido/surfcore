/**
 * 表达层 + 落盘 + 端到端（内核内部）测试
 * 跑法：node kernel/expression/expression.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPrompt, toMessages, SILENT_MARKER } from './prompt.js';
import { createScriptedModel, createRuleModel, normalizeCompletion, validateModelPort } from './model-port.js';
import { createExpression } from './index.js';
import { createStore } from '../store/persist.js';
import { createKernel } from '../index.js';
import { createIdentity } from '../support/index.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

const NOW = Date.parse('2026-11-09T12:00:00');
const identity = createIdentity({ persona: { name: '小鲸鱼', core: '你是小鲸鱼' }, admin: 'owner', adminName: '主人' });

/* ── 提示词组装 ───────────────────────────────────────── */
console.log('## 提示词组装');
{
  const memoryBlock = { text: '【记忆】\n- 2026-11-08 [80] 主人说周五见面', refs: [{ channel: 'x', at: NOW }] };
  const p = buildPrompt({
    identity, memoryBlock,
    history: '- 主人：刚才说了啥\n- 她：说了那个',
    glossary: '- 绝绝子：太厉害了',
    viewer: { kind: 'private', isOwner: true },
    event: { text: '在吗', from: { actor: 'owner' } },
  });
  ok(p.system.includes('小鲸鱼'), '系统提示词里有她是谁');
  ok(p.user.includes('【刚才】'), '用户提示词里有刚才那几轮');
  ok(p.user.includes('【群里的词】') && p.user.includes('绝绝子'), '用户提示词里有她学会的词');
  ok(p.system.includes(SILENT_MARKER), '系统提示词告诉模型"怎么沉默"');
  ok(p.user.includes('记忆'), '用户提示词里带着记忆块');
  ok(p.user.includes('私聊里'), '认得出这是私聊（但不是认渠道名）');
  ok(p.user.includes('主人对你说'), '认得出对方是主人');
  ok(!JSON.stringify(p).match(/acme|globex|initech/i), '提示词里没有任何具体来源名');
  ok(toMessages(p).length === 2 && toMessages(p)[0].role === 'system', '能转成模型消息数组');

  const withImage = toMessages(p, { images: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,xx' } }] });
  ok(Array.isArray(withImage[1].content), '有图片：user 消息变成内容数组');
  ok(withImage[1].content[0].type === 'text' && withImage[1].content[1].type === 'image_url', '文本 + 图片段');
  ok(toMessages(p, { images: [] })[1].content === p.user, '没图片：仍然是纯字符串（旧端口不用改）');
}

/* ── 模型端口 ─────────────────────────────────────────── */
console.log('\n## 模型端口');
{
  ok(validateModelPort({ complete: async () => ({}) }).ok, '端口齐全：通过');
  ok(!validateModelPort({}).ok, '缺 complete：拒绝');
  ok(normalizeCompletion('你好').text === '你好', '字符串返回值被收敛成统一形状');
  ok(normalizeCompletion({ toolCalls: [{ name: 'say', args: { text: 'x' } }] }).toolCalls.length === 1, '工具调用被保留');

  const scripted = createScriptedModel([{ text: '第一句' }, { text: SILENT_MARKER }]);
  ok((await scripted.complete({})).text === '第一句', '剧本模型：按顺序回答');
  ok((await scripted.complete({})).text === SILENT_MARKER, '剧本模型：第二条是沉默');
  ok(scripted.remaining() === 0, '剧本用完：剩余 0');

  const rule = createRuleModel({ name: '小鲸鱼' });
  ok((await rule.complete({ messages: [{ role: 'user', content: '在吗' }] })).text.includes('小鲸鱼'), '规则模型：被叫会应');
  ok((await rule.complete({ messages: [{ role: 'user', content: '随便说点啥' }] })).text === SILENT_MARKER, '规则模型：多数时候选择不说');
  const withImage = await rule.complete({
    messages: [{ role: 'user', content: [{ type: 'text', text: '在吗' }, { type: 'image_url', image_url: { url: 'x' } }] }],
  });
  ok(withImage.text.includes('在呀'), '规则模型：能看到文本段，忽略图片段（不崩）');
}

/* ── 表达层 ───────────────────────────────────────────── */
console.log('\n## 表达层：模型输出 → 意图');
{
  const expr = createExpression({ model: createScriptedModel([{ text: '在呀。' }]), identity });
  const r1 = await expr.respond({ event: { text: '在吗', from: { actor: 'owner' } }, viewer: { kind: 'private', isOwner: true } });
  ok(r1.intents.length === 1 && r1.intents[0].kind === 'say', '模型说话 → 产出 say 意图');
  ok(r1.intents[0].text === '在呀。', '内容原样带出');

  const expr2 = createExpression({ model: createScriptedModel([{ text: SILENT_MARKER }]), identity });
  const r2 = await expr2.respond({ event: { text: '随便' }, viewer: {} });
  ok(r2.intents[0].kind === 'stay_silent', '沉默标记 → 产出 stay_silent 意图（可审计）');

  const expr3 = createExpression({ model: createScriptedModel([{ toolCalls: [{ name: 'say', args: { text: '工具里的话' } }] }]), identity });
  const r3 = await expr3.respond({ event: { text: '在吗' }, viewer: {} });
  ok(r3.intents[0].text === '工具里的话', '工具调用优先于纯文本');

  const expr4 = createExpression({ model: createScriptedModel([{ text: '   ' }]), identity });
  const r4 = await expr4.respond({ event: { text: '嗯' }, viewer: {} });
  ok(r4.intents[0].kind === 'stay_silent', '空输出 → 当成沉默（不留空意图）');

  /* 用量回调：模型端口给了 usage 才回调；回调失败要可见，不能拖垮对话 */
  const seen = [];
  const exprUsage = createExpression({
    model: { complete: async () => ({ text: '好', usage: { cacheMiss: 10, output: 2 } }) },
    identity,
    onUsage: (u) => seen.push(u),
  });
  const ru = await exprUsage.respond({ event: { text: '在吗' }, viewer: {}, turn: 7 });
  ok(seen.length === 1, '有 usage：回调一次');
  ok(seen[0].usage.cacheMiss === 10 && seen[0].turn === 7 && seen[0].step === 1, '回调带用量/回合/步骤');
  ok(ru.intents[0].kind === 'say' && ru.errors.length === 0, '记账不影响这一轮说话');

  const exprBad = createExpression({
    model: { complete: async () => ({ text: '好', usage: { cacheMiss: 1 } }) },
    identity,
    onUsage: () => { throw new Error('账本坏了'); },
  });
  const rb = await exprBad.respond({ event: { text: '在吗' }, viewer: {} });
  ok(rb.intents[0].kind === 'say', '记账失败：话还是要说');
  ok(rb.errors.some((e) => e.code === 'usage.record-failed'), '记账失败：错误可见（不是静默）');

  const seenMessages = [];
  const exprVision = createExpression({
    model: { complete: async ({ messages }) => { seenMessages.push(messages); return { text: '看到了。' }; } },
    identity,
  });
  const image = { type: 'image_url', image_url: { url: 'data:image/png;base64,xx' } };
  const rv = await exprVision.respond({ event: { text: '看这个' }, viewer: {}, images: [image] });
  ok(rv.intents[0].kind === 'say', '带图：照常产出意图');
  ok(Array.isArray(seenMessages[0][1].content), '带图：模型收到的 user 是内容数组');
  ok(seenMessages[0][1].content.some((p) => p.type === 'image_url'), '图片段真的进了模型消息');

  /* 工具取回图片：tool 消息只留文字，图片另起一条 user 消息（兼容性最好） */
  const rounds = [];
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const exprTools = createExpression({
    identity,
    model: {
      complete: async ({ messages }) => {
        rounds.push(messages);
        if (rounds.length === 1) return { text: '', toolCalls: [{ name: 'fetch_images', args: { messageId: 1 } }] };
        return { text: '看到猫了。' };
      },
    },
    execute: async () => ({ ok: true, data: { count: 1 }, media: [{ kind: 'image', bytes: png, caption: '猫' }] }),
  });
  const rt = await exprTools.respond({ event: { text: '发的那张图是啥' }, viewer: {} });
  ok(rt.intents[0].kind === 'say', '工具取图：最终照常说话');
  const second = rounds[1];
  const toolMsg = second.find((m) => m.role === 'tool');
  ok(toolMsg && !String(toolMsg.content).includes(png.toString('base64')), 'tool 消息里没有 base64（不重复塞）');
  const imageMsg = second.find((m) => m.role === 'user' && Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'));
  ok(Boolean(imageMsg), '工具取回的图片变成一条 user 消息');
  ok(imageMsg.content[0].text.includes('工具取回的图片'), '图片消息有文字说明');

  let threw = false;
  try { createExpression({}); } catch { threw = true; }
  ok(threw, '没有模型端口：直接报错，不带病运行');
}

/* ── 落盘 ─────────────────────────────────────────────── */
console.log('\n## 落盘（原子写 + 备份 + 恢复）');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-k-'));
  const store = createStore({ dir, now: () => NOW });
  store.writeJson('t', { a: 1 });
  ok(store.readJson('t').a === 1, '写进去能读出来');
  store.writeJson('t', { a: 2 });
  ok(store.readJson('t').a === 2, '再写覆盖成功');
  ok(store.exists('t'), '文件存在');
  const bak = path.join(dir, 't.json.bak');
  ok(fs.existsSync(bak), '覆盖前留了 .bak（可回滚）');
  ok(store.readJson('不存在', { fallback: true }).fallback === true, '读不存在的文件：回退默认值不炸');
  store.appendJsonl('log', { x: 1 });
  store.appendJsonl('log', { x: 2 });
  ok(fs.readFileSync(path.join(dir, 'log.jsonl'), 'utf8').trim().split('\n').length === 2, '只追加：两行都在');
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ── 端到端：内核 respond + 存盘再读回 ────────────────── */
console.log('\n## 端到端：内核内部跑一遍');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-e2e-'));
  const model = createScriptedModel([{ text: '我记着呢。' }]);
  const kernel = createKernel({
    stateDir: dir, model, now: () => NOW,
    persona: { name: '小鲸鱼', core: '你是小鲸鱼' }, admin: 'owner', adminName: '主人',
  });

  const viewer = { channelId: 'c1', kind: 'private', isOwner: true };
  const r = await kernel.respond({
    from: { adapter: 'surfcore@terminal', channel: 'c1', kind: 'private', actor: 'owner', at: NOW },
    text: '你还记得我吗', source: 'user', to: { owner: true },
  }, viewer);

  ok(r.wake === true, '私聊：醒了');
  ok(r.intents.some((i) => i.kind === 'say'), '端到端：产出了要说的意图');
  ok(kernel.memory.snapshot().length === 1, '端到端：入库了');

  kernel.save();
  ok(fs.existsSync(path.join(dir, 'kernel-state.json')), '存盘：状态文件生成');

  // 新内核读回
  const kernel2 = createKernel({ stateDir: dir, now: () => NOW, persona: { name: '小鲸鱼', core: '你是小鲸鱼' } });
  const loaded = kernel2.load();
  ok(loaded && loaded.version === 1, '读盘：版本号对上');
  ok(kernel2.memory.snapshot().length === 1, '读盘：记忆条数恢复');
  ok(kernel2.memory.snapshot()[0].text === '你还记得我吗', '读盘：内容不丢');

  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
