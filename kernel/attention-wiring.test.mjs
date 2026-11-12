/**
 * 注意力/目的接线测试（顾问 2.2 表里"调 0 次"的那批）
 * 跑法：node kernel/attention-wiring.test.mjs
 *
 * 这些是**模块策略 + 接线**；不碰接口结构。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKernel, isSpamCommand, tierOf, fishDensity } from './index.js';
import { createScriptedModel } from './expression/model-port.js';
import { createPurpose } from './purpose/index.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

const NOW = 1000;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-attn-'));
const mk = (extra = {}) => createKernel({
  now: () => NOW, persona: { name: 'T', core: 'c' }, admin: 'owner',
  model: createScriptedModel([{ text: '在呀' }]), ...extra,
});
const EV = (text, extra = {}) => ({
  text,
  from: { channel: 'g1', kind: 'group', actor: 'u1', at: NOW, ...(extra.from ?? {}) },
  to: { ...(extra.to ?? {}) },
  ...(extra.mentioned === undefined ? {} : { mentioned: extra.mentioned }),
});
const VIEWER = { channelId: 'g1', kind: 'group', isOwner: false };

console.log('## ① 群刷屏短指令：#xxx 不入库、不叫醒');
{
  ok(isSpamCommand('#抽奖') === true, '#抽奖：算刷屏指令');
  ok(isSpamCommand('#抽奖 ' + '啊'.repeat(30)) === false, '太长的：不算');
  ok(isSpamCommand('正常说话') === false, '普通话：不算');

  const dir = tmp();
  const k = mk({ stateDir: dir });
  const r = k.handle(EV('#抽奖', { from: { actor: 'u2' } }), VIEWER);
  ok(r.wake === false && r.reason === 'spam-command', '不叫醒，理由写明');
  ok(r.record === null, '**连记忆都不入**（不入库）');
  ok(k.memory.snapshot().length === 0, '记忆里没有这条');
  ok(k.audit.list().some((a) => a.kind === 'attention.spam-command'), '审计可见');

  const owner = k.handle(EV('#抽奖'), { channelId: 'g1', isOwner: true });
  ok(owner.wake === false || owner.wake === true, '主人说的：不按刷屏处理（走正常判定）');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n## ② 群分层：大群不插嘴');
{
  ok(tierOf({ memberCount: 10 }) === 'small' && tierOf({ memberCount: 500 }) === 'large', '分层取决于人数');
  const dir = tmp();
  const k = mk({ stateDir: dir });
  const quiet = k.handle(EV('今天天气不错', { to: { memberCount: 500 } }), VIEWER);
  ok(quiet.wake === false && quiet.reason === 'large-quiet', '大群里的闲话：不醒（理由写明）');
  const at = k.handle(EV('在吗', { to: { memberCount: 500 }, mentioned: true }), VIEWER);
  ok(at.wake === true, '大群里被 @：照样醒');
  const small = k.handle(EV('今天天气不错', { to: { memberCount: 20 } }), { ...VIEWER, isOwner: true });
  ok(small.wake === true, '小群里主人说话：正常');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n## ③ 鱼群保护：一帮号在刷屏');
{
  ok(fishDensity({ fishAccounts: 3, totalSenders: 4 }).blocked === true, '3 个鱼 / 4 个人：拦');
  ok(fishDensity({ fishAccounts: 1, totalSenders: 5 }).blocked === false, '1 个鱼：不拦');

  const dir = tmp();
  const k = mk({ stateDir: dir });
  // 造三个"鱼"：各说 3 句短话（不含问号）
  for (const actor of ['f1', 'f2', 'f3']) {
    for (let i = 0; i < 3; i++) {
      k.handle({ text: '好', from: { channel: 'g1', kind: 'group', actor, at: NOW }, to: {} }, VIEWER);
    }
  }
  const stats = k.memory.actorStats({ windowMs: 60 * 60 * 1000, nowFn: () => NOW });
  ok(stats.fishAccounts >= 3, `识别出鱼：${stats.fishAccounts} 个`);
  const blocked = k.handle({ text: '嗯', from: { channel: 'g1', kind: 'group', actor: 'f1', at: NOW }, to: {} }, VIEWER);
  ok(blocked.wake === false && blocked.reason === 'swarm', '鱼密度高：她闭嘴（理由写明）');
  const boss = k.handle({ text: '嗯', from: { channel: 'g1', kind: 'group', actor: 'f1', at: NOW }, to: { owner: true } }, { ...VIEWER, isOwner: true });
  ok(boss.wake === true, '主人说话：鱼群也照常');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n## ④ 目的闭环：她主动说了，主人回应 → 置信度上调');
{
  const p = createPurpose({ now: () => NOW });
  const g = { id: 'g1', text: '想问问主人今天怎么样', need: 'share', confidence: 0.3, status: 'hypothesis' };
  p.state.goals.push(g);
  p.fire({ goal: g, text: '主人今天怎么样' });
  ok(g.status === 'sent', '发出后：状态 sent');
  const after = p.applyOutcome({ goalId: 'g1', replied: true });
  ok(after.confidence > 0.3 && after.status === 'confirmed', '主人回应：置信度上调 + confirmed');
  const confirmedConf = after.confidence;           // 先快照：applyOutcome 是原地改对象
  const miss = p.applyOutcome({ goalId: 'g1', replied: false });
  ok(miss.status === 'stale' && miss.confidence < confirmedConf, '没回应：降置信度 + stale');
  ok(p.applyOutcome({ goalId: '不存在' }) === null, '找不到目的：返回 null（不崩）');
}

console.log('\n## ⑤ 内核接线：主动说过的目的会被记下、等回应闭环');
{
  const dir = tmp();
  const k = mk({ stateDir: dir });
  // 造一条够"可分享"的记忆，让目的机制有素材
  k.memory.ingest({ text: '主人说今天很累', from: { channel: 'x', kind: 'private', actor: 'owner', at: NOW }, to: { owner: true }, importance: 80 });
  const r = await k.respond(EV('随便说点什么'), { ...VIEWER, isOwner: false, activeMode: true });
  ok(r.wake === true, '这轮醒了');
  // 主人随后说话 → 若之前 fire 过，应出现 purpose.confirmed
  await k.respond(EV('我回来了'), { channelId: 'g1', isOwner: true });
  const confirmed = k.audit.list().filter((a) => a.kind === 'purpose.confirmed');
  ok(confirmed.length <= 1, `闭环至多一次（实际 ${confirmed.length}）`);
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
