/**
 * 工具面 + 落盘降级 测试
 * 跑法：node kernel/expression/tools.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TOOLS, toolSchema, findTool, resolveToolCall, intentsFromCompletion } from './tools.js';
import { createExpression } from './index.js';
import { createScriptedModel } from './model-port.js';
import { createIdentity } from '../support/index.js';
import { createKernel } from '../index.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

const NOW = Date.parse('2026-11-09T12:00:00');
const identity = createIdentity({ persona: { name: '小鲸鱼', core: '你是小鲸鱼' }, admin: 'owner', adminName: '主人' });

/* ── 工具面 ───────────────────────────────────────────── */
console.log('## 工具面（她的手）');
{
  ok(TOOLS.length >= 5, `内置 ${TOOLS.length} 个工具`);
  ok(TOOLS.every((t) => t.name && t.description), '每个工具都有名字与说明（模型能看懂）');
  ok(TOOLS.every((t) => !/acme|globex|initech/i.test(t.name)), '工具名里没有具体来源名（内核不认识外部世界）');
  ok(toolSchema().every((t) => t.parameters), '给模型的清单里带参数说明');

  ok(findTool('send_message')?.name === 'say', '旧工具名 send_message 映射到 say（兼容）');
  ok(findTool('不存在的工具') === null, '找不到就返回 null');
}

console.log('\n## 工具调用 → 意图');
{
  const r1 = resolveToolCall({ name: 'say', args: { text: '你好' } });
  ok(r1.ok && r1.intent.kind === 'say' && r1.intent.text === '你好', 'say → 说话的意图');

  const r2 = resolveToolCall({ name: 'send_media', args: { mediaId: 'm_1', kind: 'image', caption: '猫图' } });
  ok(r2.ok && r2.intent.kind === 'send_media' && r2.intent.media[0].id === 'm_1', 'send_media → 发媒体意图');
  ok(r2.intent.caption === '猫图', '媒体带上说明文字');

  const r3 = resolveToolCall({ name: 'remember', args: { text: '主人周五要见面', importance: 80 } });
  ok(r3.ok && r3.intent.kind === 'remember' && r3.intent.importance === 80, 'remember → 记忆候选意图（内核决定收不收）');

  const r4 = resolveToolCall({ name: 'close', args: { summary: '聊到周末计划', nextOpening: '问他订票没' } });
  ok(r4.ok && r4.intent.kind === 'close' && r4.intent.nextOpening.includes('订票'), 'close → 收尾意图');

  const r5 = resolveToolCall({ name: 'stay_silent', args: {} });
  ok(r5.ok && r5.intent.kind === 'stay_silent', 'stay_silent → 沉默意图');

  ok(!resolveToolCall({ name: '瞎写的' }).ok, '未知工具：拒绝');
  ok(!resolveToolCall({ name: 'say', args: {} }).ok, '缺必填参数：拒绝');
  ok(resolveToolCall({ name: 'say', args: { text: '  ' } }).code === 'tool.empty-text', '空文字：拒绝（不留空意图）');
}

console.log('\n## 整段输出解析（工具优先）');
{
  const a = intentsFromCompletion({ toolCalls: [{ name: 'say', args: { text: '工具说的' } }], text: '这段文本应被忽略' });
  ok(a.intents.length === 1 && a.intents[0].text === '工具说的', '有工具调用：以工具为准，忽略纯文本');

  const b = intentsFromCompletion({ text: '你好呀' });
  ok(b.intents[0].kind === 'say' && b.intents[0].text === '你好呀', '没有工具调用：把文本当她说的话');

  const c = intentsFromCompletion({ text: '' });
  ok(c.intents[0].kind === 'stay_silent', '空输出：当成沉默');

  const d = intentsFromCompletion({ toolCalls: [{ name: '瞎写的' }], text: '' });
  ok(d.errors.length === 1 && d.errors[0].code === 'tool.unknown', '未知工具：进错误清单，不静默吞掉');
}

console.log('\n## 表达层接上工具面');
{
  const expr = createExpression({ model: createScriptedModel([
    { toolCalls: [{ name: 'remember', args: { text: '她说周五见面' } }, { name: 'say', args: { text: '记下了' } }] },
  ]), identity });
  ok(expr.tools().length >= 5, '表达层把工具清单交给模型');
  const r = await expr.respond({ event: { text: '周五见' }, viewer: {} });
  ok(r.intents.length === 2, '一次输出可以产生多个意图（先记住再说）');
  ok(r.intents[0].kind === 'remember' && r.intents[1].kind === 'say', '顺序被保留');
}

/* ── 落盘降级 ─────────────────────────────────────────── */
console.log('\n## 落盘降级（旧代码的教训：读坏不许假装正常）');

function freshDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-tools-')); }

{
  const dir = freshDir();
  fs.writeFileSync(path.join(dir, 'kernel-state.json'), '{ 这不是合法 JSON', 'utf8');

  const kernel = createKernel({ stateDir: dir, now: () => NOW });
  const loaded = kernel.load();
  ok(loaded === null, '损坏的文件：不加载（不当成空数据）');
  ok(kernel.degraded === 'corrupt', '进入写保护状态（degraded = corrupt）');
  ok(kernel.audit.list().some((a) => a.code === 'store.corrupt'), '审计里写明原因（可见，不静默）');
  ok(kernel.audit.list().some((a) => String(a.hint ?? '').includes('recovered')), '审计里给出下一步（新数据写哪）');

  kernel.memory.ingest({ text: '新记忆', from: { channel: 'c1', kind: 'private', at: NOW } });
  kernel.save();
  ok(fs.existsSync(path.join(dir, 'kernel-state.json')), '原损坏文件还在（没被覆盖）');
  const original = fs.readFileSync(path.join(dir, 'kernel-state.json'), 'utf8');
  ok(original.includes('这不是合法 JSON'), '原文件字节未变（可人工抢救）');
  ok(fs.existsSync(path.join(dir, 'kernel-state.recovered.json')), '新数据写到了 recovered 文件');
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  const dir = freshDir();
  fs.writeFileSync(path.join(dir, 'kernel-state.json'), JSON.stringify({ version: 999, records: [] }), 'utf8');
  const kernel = createKernel({ stateDir: dir, now: () => NOW });
  ok(kernel.load() === null, '版本不符：不加载');
  ok(kernel.degraded === 'version', '进入写保护（degraded = version）');
  ok(kernel.audit.list().some((a) => a.code === 'store.version-mismatch'), '审计写明版本不符');
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  const dir = freshDir();
  const k1 = createKernel({ stateDir: dir, now: () => NOW, persona: { name: '小鲸鱼', core: '你是小鲸鱼' } });
  k1.load();
  ok(k1.degraded === null, '首次启动（无文件）：不进入降级');
  k1.memory.ingest({ text: '第一条', from: { channel: 'c1', kind: 'private', at: NOW } });
  k1.save();
  ok(!fs.existsSync(path.join(dir, 'kernel-state.recovered.json')), '正常路径：不需要 recovered');
  const k2 = createKernel({ stateDir: dir, now: () => NOW });
  k2.load();
  ok(k2.memory.snapshot().length === 1, '正常路径：读回成功');
  ok(k2.degraded === null, '正常路径：不降级');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
