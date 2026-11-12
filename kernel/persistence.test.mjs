/**
 * 落盘完整性 + 接线回归测试（顾问审阅 2.2 表的"看起来做了、跑起来没有"）
 * 跑法：node kernel/persistence.test.mjs
 *
 * 这些断言的意义：以后谁把接线改回去，这里会红。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKernel } from './index.js';
import { createScriptedModel } from './expression/model-port.js';
import { decideWake } from './attention/index.js';
import { createBatcher } from './attention/batch.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-persist-'));
const NOW = 1000;
const EVENT = (text = '在吗') => ({ from: { channel: 'c1', kind: 'private', actor: 'owner', at: NOW }, text, source: 'user', to: { owner: true } });
const VIEWER = { channelId: 'c1', kind: 'private', isOwner: true };
const mk = (dir, extra = {}) => createKernel({
  stateDir: dir, now: () => NOW, persona: { name: 'T', core: 'c' }, admin: 'owner',
  model: createScriptedModel([{ text: '在呀' }]), ...extra,
});

console.log('## 落盘：七样东西重启后都要在');
{
  const dir = tmp();
  const k = mk(dir, {
    budgetLimits: { total: 1000 },
    model: { complete: async () => ({ text: '在呀', usage: { cacheMiss: 100, output: 5 } }) },
  });
  const media = k.media.put({ kind: 'image', bytes: Buffer.from('X'), caption: '猫' });
  k.stickers.add({ id: 's1', mediaId: media.id, emotion: '开心', tags: ['猫'] });
  k.lexicon.confirm({ word: '绝绝子', meaning: '太厉害了' });
  await k.respond(EVENT(), VIEWER);
  k.save();

  const before = {
    records: k.snapshot().records, vector: k.memory.stats().vector, stickers: k.stickers.size(),
    lex: k.lexicon.stats().confirmed, conv: k.conversation.countOf('c1'), closure: k.closure.stats('c1').turns,
    budget: k.budget.snapshot().total, ledger: k.ledger.summary().tokens,
  };
  ok(before.vector > 0, '向量线有数据');
  ok(before.budget > 0, '额度有记账（之前 commit 一次都没调）');
  ok(before.ledger === 105, '账本有真实用量（100 未命中 + 5 输出）');

  const k2 = mk(dir, { budgetLimits: { total: 1000 } });
  k2.load();
  const after = {
    records: k2.snapshot().records, vector: k2.memory.stats().vector, stickers: k2.stickers.size(),
    lex: k2.lexicon.stats().confirmed, conv: k2.conversation.countOf('c1'), closure: k2.closure.stats('c1').turns,
    budget: k2.budget.snapshot().total, ledger: k2.ledger.summary().tokens,
  };
  for (const key of Object.keys(before)) ok(before[key] === after[key], `重启后 ${key} 仍在（${before[key]}）`);
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n## 只读命令不再写全量卡（之前 load 会重复 append）');
{
  const dir = tmp();
  const k = mk(dir);
  await k.respond(EVENT(), VIEWER);
  k.save();
  const file = path.join(dir, 'memory-full.jsonl');
  const rows1 = fs.readFileSync(file, 'utf8').trim().split('\n').length;

  const k2 = mk(dir); k2.load(); k2.load(); k2.load();
  const rows2 = fs.readFileSync(file, 'utf8').trim().split('\n').length;
  ok(rows1 === rows2, `连 load 三次，全量卡行数不变（${rows1} → ${rows2}）`);
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n## 复习：摸的是"旧记录"，不是刚进来的这条');
{
  const dir = tmp();
  const k = mk(dir);
  await k.respond(EVENT('今天看到一只猫'), VIEWER);
  const first = k.memory.snapshot()[0];
  const recallBefore = first.recallCount ?? 0;
  ok(recallBefore === 0, '新记录还没被复习');

  await k.respond(EVENT('那只猫'), VIEWER);
  ok((first.recallCount ?? 0) === 1, '提到"猫"：旧记录被复习（recallCount+1）');
  ok(k.audit.list().some((a) => a.kind === 'memory.reviewed'), '复习进审计');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n## 唤醒：空正文但被点名，必须醒（拍一拍/@ 不能被吞）');
{
  ok(decideWake({ kind: 'group', text: '', mentioned: true }).wake === true, '空正文 + @：醒');
  ok(decideWake({ kind: 'group', text: '', mentioned: true }).reason === 'atMention', '理由正确');
  ok(decideWake({ kind: 'group', text: '' }).wake === false, '真·空消息：仍然不醒');
  ok(decideWake({ kind: 'group', text: '在吗', calledName: true }).wake === true, '叫名字：醒');
}

console.log('\n## 合批：任一条的唤醒信号都要保留');
{
  let t = 1000;
  const b = createBatcher({ windowMs: 5000, maxItems: 9, now: () => t });
  b.push({ from: { channel: 'g', kind: 'group', at: t }, text: '@她 在吗', mentioned: true });
  b.push({ from: { channel: 'g', kind: 'group', at: t + 100 }, text: '今天好热' });
  const due = b.due(t + 6000);
  ok(due.length === 1, '合并成一批');
  ok(due[0].batch.event.mentioned === true, '@ 在前一条：合并后仍然算被叫');
  ok(due[0].batch.event.text.includes('@她 在吗'), '文本都保留');
  ok(due[0].batch.event.batch.count === 2, '批次里记着两条');
}

console.log('\n## 收尾：每条消息都要推进（之前一次都没调）');
{
  const dir = tmp();
  const k = mk(dir);
  await k.respond(EVENT('在吗'), VIEWER);
  await k.respond(EVENT('今天好热'), VIEWER);
  ok(k.closure.stats('c1').turns === 2, '两条消息 → turns=2');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
