/**
 * 接线测试：语音闸门 / 设置模型 / 跨进程单写者锁
 * 跑法：node kernel/wiring.test.mjs
 *
 * 这三件是"已实现但没接进主流程"的补齐（核验时发现的 🟡）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKernel } from './index.js';
import { createScriptedModel } from './expression/model-port.js';
import { createStore } from './store/persist.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

const NOW = Date.parse('2026-11-09T12:00:00');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-wire-'));

function mkKernel(extra = {}) {
  return createKernel({
    now: () => NOW,
    persona: { name: '小鲸鱼', core: '你是小鲸鱼' },
    admin: 'owner', adminName: '主人',
    ...extra,
  });
}
const EVENT = (text = '在吗') => ({
  from: { adapter: 'surfcore@terminal', channel: 'c1', kind: 'private', actor: 'owner', at: NOW },
  text, source: 'user', to: { owner: true },
});
const VIEWER = { channelId: 'c1', kind: 'private', isOwner: true };

console.log('## 语音：决策在内核（模型想用 → 内核闸门）');
{
  // 开关没开：降级成文字，且必须可见
  const k = mkKernel({ model: createScriptedModel([{ toolCalls: [{ name: 'say', args: { text: '晚安呀', voice: true } }] }]) });
  const r = await k.respond(EVENT(), VIEWER);
  const say = r.intents.find((i) => i.kind === 'say');
  ok(say && say.voice === undefined, '开关没开：意图被降级成纯文字');
  ok(say.text === '晚安呀', '降级不丢内容');
  ok(k.audit.list().some((a) => a.kind === 'voice.degraded' && a.code === 'voice.disabled'), '降级写进审计（失败可见）');
  ok(String(k.audit.list().find((a) => a.kind === 'voice.degraded').hint).includes('设置页'), '审计里给下一步（去哪开）');
}

{
  // 开关打开 + 长度合规：保留语音
  const k = mkKernel({
    voice: { enabled: true, available: true },
    model: createScriptedModel([{ toolCalls: [{ name: 'say', args: { text: '晚安呀', voice: true } }] }]),
  });
  const r = await k.respond(EVENT(), VIEWER);
  const say = r.intents.find((i) => i.kind === 'say');
  ok(say.voice === true, '开关打开：意图保留 voice:true');
  ok(k.voice.usage() === 1, '用过一次语音：用量 +1');
  ok(!k.audit.list().some((a) => a.kind === 'voice.degraded'), '没降级：审计里没有降级记录');
}

{
  // 太长：降级，并说明原因
  const k = mkKernel({
    voice: { enabled: true, available: true, maxChars: 5 },
    model: createScriptedModel([{ toolCalls: [{ name: 'say', args: { text: '这是一句很长很长的话', voice: true } }] }]),
  });
  await k.respond(EVENT(), VIEWER);
  ok(k.audit.list().some((a) => a.code === 'voice.too-long'), '太长：降级并记下 too-long 原因');
}

{
  // 频率：超过每小时上限就降级
  const k = mkKernel({ voice: { enabled: true, available: true, perHour: 1 },
    model: createScriptedModel([
      { toolCalls: [{ name: 'say', args: { text: '一', voice: true } }] },
      { toolCalls: [{ name: 'say', args: { text: '二', voice: true } }] },
    ]) });
  await k.respond(EVENT(), VIEWER);
  const r2 = await k.respond(EVENT(), VIEWER);
  const say2 = r2.intents.find((i) => i.kind === 'say');
  ok(say2.voice === undefined, '超过每小时上限：第二条降级');
  ok(k.audit.list().some((a) => a.code === 'voice.rate-limited'), '频率超限被记录');

  // 不产生副作用的询问
  ok(k.voice.decide({ wantVoice: false }).useVoice === false, 'decide：没要求 → 不用');
  ok(k.voice.decide({ wantVoice: true, chars: 3 }).ok === false, 'decide：频率已满 → 拒绝（且不占次数）');
}

console.log('\n## 设置：只吃声明，可导出带走');
{
  const packs = [
    { identity: { publisher: 'acme', name: 'alpha' }, settings: [
      { key: 'size', label: '大小', defaultValue: 6, options: [3, 6, 9], cost: '越大越占地方', group: 'basic' },
      { key: 'voice', label: '语音', defaultValue: false, options: [true, false], cost: '更吵', group: 'basic' },
    ] },
  ];
  const k = mkKernel({ packs });

  const model = k.settings.model();
  ok(model.groups.length === 1 && model.groups[0].id === 'acme/alpha', '模型：一组 = 发布人/名字');
  ok(model.groups[0].fields.length === 2, '模型：两项都在');
  ok(model.issues.length === 0, '模型：没有不合格声明');

  k.settings.set('acme/alpha', 'size', 9);
  ok(k.settings.model().groups[0].fields.find((f) => f.key === 'size').value === 9, 'set：设定生效');
  ok(k.settings.model().groups[0].fields.find((f) => f.key === 'size').warning === '越大越占地方', '改过的项带代价提示');

  const dump = k.settings.export();
  ok(dump.values['acme/alpha'].size === 9, 'export：导出生效值');

  const k2 = mkKernel({ packs });
  const imported = k2.settings.import(dump);
  ok(imported.ok && imported.rejected.length === 0, 'import：换一个内核也能导入');
  ok(k2.settings.model().groups[0].fields.find((f) => f.key === 'size').value === 9, '导入后：值确实生效');

  const bad = k2.settings.import({ version: 1, values: { 'acme/alpha': { size: 99 } } });
  ok(bad.rejected.length === 1, 'import：越界值被拒绝');
  ok(k2.settings.model().groups[0].fields.find((f) => f.key === 'size').value === 9, '被拒绝的值不会污染现有设定');

  // 设置也要能落盘
  const dir = tmp();
  const k3 = mkKernel({ packs, stateDir: dir });
  k3.settings.set('acme/alpha', 'size', 3);
  k3.save();
  const k4 = mkKernel({ packs, stateDir: dir });
  k4.load();
  ok(k4.settings.model().groups[0].fields.find((f) => f.key === 'size').value === 3, '设置随状态一起落盘、重启读回');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n## 跨进程单写者锁');
{
  const dir = tmp();
  const a = createStore({ dir });
  const b = createStore({ dir });

  const first = a.acquireLock();
  ok(first.ok && first.pid === process.pid, '第一个进程拿到锁');
  const second = b.acquireLock();
  ok(!second.ok, '第二个进程拿不到（同一 pid 的重复获取也算占用）');
  ok(String(second.error).includes('已有写入者'), '拒绝时说明原因');

  ok(a.lockHolder() === process.pid, '锁里记的是持有者 pid');

  a.releaseLock();
  ok(b.acquireLock().ok, '释放后：别人能拿到了');
  b.releaseLock();

  // 陈旧锁：写一个已经死掉的 pid
  fs.writeFileSync(path.join(dir, '.writer.lock'), '999999');
  const c = createStore({ dir });
  const reclaimed = c.acquireLock();
  ok(reclaimed.ok && reclaimed.stale === true, '陈旧锁（持有者已死）：被回收，不卡死');
  c.releaseLock();

  // 别人的锁不释放（宁可报错，也不删别人的锁）
  fs.writeFileSync(path.join(dir, '.writer.lock'), '999999');
  const rel = c.releaseLock();
  ok(!rel.ok, '别人的锁：拒绝释放（不误删）');
  ok(String(rel.error).includes('999999'), '拒绝时点名持有者 pid');
  ok(fs.existsSync(path.join(dir, '.writer.lock')), '那个锁文件确实还在');
  fs.rmSync(path.join(dir, '.writer.lock'), { force: true });
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n## 落盘时抢不到锁：不写，且说清楚');
{
  const dir = tmp();
  const store = createStore({ dir });
  const k = mkKernel({ store });
  k.memory.ingest({ text: '一条记忆', from: { channel: 'c1', kind: 'private', at: NOW } });

  const held = store.acquireLock();     // 模拟"另一个进程正在写"
  ok(held.ok, '先让另一个进程占住锁');

  const r = k.save();
  ok(r && r.ok === false && r.code === 'store.locked', '拿不到锁：这次不保存');
  ok(String(r.hint).includes('等它退出'), '给出下一步（等它退出再存）');
  ok(!fs.existsSync(path.join(dir, 'kernel-state.json')), '确实没写文件（数据没被覆盖）');
  ok(k.audit.list().some((a) => a.kind === 'kernel.save-blocked'), '审计里可见（不是静默失败）');

  store.releaseLock();
  const okSave = k.save();
  ok(typeof okSave === 'string', '锁释放后：保存成功（返回文件路径）');
  ok(fs.existsSync(path.join(dir, 'kernel-state.json')), '这次真的写进去了');
  ok(store.lockHolder() === null, '保存完把锁放掉了（不会一直占着）');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n## 媒体：编号 → 真实路径（包不该认识编号）');
{
  const dir = tmp();
  let targetId = null;
  const model = { async complete() { return { toolCalls: [{ name: 'send_media', args: { mediaId: targetId, kind: 'image' } }] }; } };
  const k = mkKernel({ stateDir: dir, model });

  const put = k.media.put({ kind: 'image', bytes: Buffer.from('PNGDATA'), caption: '来自媒体库' });
  targetId = put.id;

  const r = await k.respond(EVENT('把那张图发来'), VIEWER);
  const m = r.intents.find((i) => i.kind === 'send_media');
  ok(Boolean(m), '产出 send_media 意图');
  ok(m.media[0].path && m.media[0].path.includes('media'), '编号被换成了真实路径');
  ok(fs.existsSync(m.media[0].path), '那个路径上真的有文件');
  ok(m.media[0].caption === '来自媒体库', '说明文字跟着一起过去（包不用查库）');

  // 编号不存在：不假装发了，但要能被审计
  targetId = 'm_不存在的编号';
  const r2 = await k.respond(EVENT('再发一张'), VIEWER);
  const m2 = r2.intents.find((i) => i.kind === 'send_media');
  ok(m2.media[0].path === undefined, '不存在的编号：不会凭空有路径');
  ok(k.audit.list().some((a) => a.kind === 'media.unresolved'), '解析失败进审计（可见）');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n## AI 标识：事实由内核给，形式归包');
{
  const k = mkKernel({ model: createScriptedModel([{ text: '这是我写的' }]) });
  const r = await k.respond(EVENT('说点什么'), VIEWER);
  const say = r.intents.find((i) => i.kind === 'say');
  ok(say.aiGenerated === true, '她说的话：带 aiGenerated 事实');
  ok(say.label === 'AI 生成', '默认标签是「AI 生成」');
  ok(say.text === '这是我写的', '标识不污染正文（呈现交给包）');

  const silent = mkKernel({ model: createScriptedModel([{ text: '[沉默]' }]) });
  const rs = await silent.respond(EVENT('嗯'), VIEWER);
  ok(rs.intents[0].kind === 'stay_silent' && rs.intents[0].aiGenerated === undefined, '沉默不是内容：不带标识');

  const off = mkKernel({ aiLabeling: { enabled: false, reason: '内部测试环境' }, model: createScriptedModel([{ text: 'x' }]) });
  const ro = await off.respond(EVENT('说话'), VIEWER);
  ok(ro.intents[0].aiGenerated === undefined, '显式关闭后：不带标识');
  ok(off.audit.list().some((a) => a.kind === 'compliance.ai-label-disabled'), '关闭标识要留审计（不能悄悄关）');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
