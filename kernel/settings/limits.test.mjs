/**
 * 可调阈值测试：设置页的值 → 记忆模块真的变
 * 跑法：node kernel/settings/limits.test.mjs
 */
import { KERNEL_IDENTITY, KERNEL_SETTINGS, limitsFromSettings } from './limits.js';
import { buildSettingsModel, validateField } from './index.js';
import { createKernel } from '../index.js';
import { createMemoryKernel } from '../memory/index.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

const KID = `${KERNEL_IDENTITY.publisher}/${KERNEL_IDENTITY.name}`;
const NOW = 1000;

console.log('## 声明本身合格');
{
  ok(KERNEL_SETTINGS.every((f) => validateField(f).ok), '每条声明都过校验（有默认值/代价说明）');
  ok(KERNEL_SETTINGS.every((f) => (Array.isArray(f.options) && f.options.length >= 2) || (f.type === 'text' && f.maxChars > 0)), '选项型/文本型都有默认值和上限');
  const model = buildSettingsModel([{ identity: KERNEL_IDENTITY, settings: KERNEL_SETTINGS }], {});
  ok(model.issues.length === 0 && model.groups.length === 1, '能合成表单（无问题项）');
  ok(model.groups[0].id === KID, '组 id 可预测（surfcore/kernel）');
}

console.log('\n## 翻译：设置值 → 记忆参数');
{
  const t = limitsFromSettings({ 'memory.maxRecords': 200, 'memory.dedupeDays': 7, 'memory.initialDays': 90 });
  ok(t.maxRecords === 200, '上限');
  ok(t.dedupeWindowMs === 7 * 86400000, '去重窗口换算成毫秒');
  ok(t.initialWindowDays === 90, '最初窗口');
  ok(Object.keys(limitsFromSettings({})).length === 0, '没给值：不覆盖（用模块默认）');
  ok(limitsFromSettings({ 'memory.maxRecords': 'x' }).maxRecords === undefined, '非法值：忽略，不猜');
}

console.log('\n## 生效：改设置 → 记忆真的按新上限淘汰');
{
  const m = createMemoryKernel({ now: () => NOW, limits: { maxRecords: 3 } });
  for (let i = 0; i < 5; i++) {
    m.ingest({ text: `第${i}条不同的内容`, from: { channel: 'c', kind: 'private', actor: 'u', at: NOW + i }, to: {} });
  }
  ok(m.stats().narrative === 3, '上限 3：衰减卡只留 3 条');
  ok(m.stats().full === 5, '全量卡 5 条（淘汰不等于丢原文）');
  m.configure({ maxRecords: 10 });
  for (let i = 0; i < 5; i++) {
    m.ingest({ text: `再来第${i}条内容`, from: { channel: 'c', kind: 'private', actor: 'u', at: NOW + 100 + i }, to: {} });
  }
  ok(m.stats().narrative === 8, '上限改 10：不再按 3 淘汰');
}

console.log('\n## 接进内核：settings.set 立刻生效，不用重启');
{
  const k = createKernel({ now: () => NOW, persona: { name: 'T', core: 'c' }, admin: 'o' });
  const before = k.memory.configure().maxRecords;
  ok(before === 600, `默认 600（实际 ${before}）`);
  k.settings.set(KID, 'memory.maxRecords', 200);
  ok(k.memory.configure().maxRecords === 200, '改完立刻是 200');
  k.settings.set(KID, 'memory.dedupeDays', 7);
  ok(k.memory.configure().dedupeWindowMs === 7 * 86400000, '去重窗口也跟着变');
  k.settings.set(KID, 'memory.mode', 'vector');
  ok(k.memory.mode === 'vector', '记忆方式：切到向量立刻生效');
  k.settings.set(KID, 'memory.vector.modelSpace', 'm2');
  ok(k.memory.vectorConfig().modelSpace === 'm2', '向量模型索引：换 space 立刻生效');
  k.settings.set(KID, 'memory.vector.enabled', false);
  ok(k.memory.vectorConfig().enabled === false, '向量开关：关掉立刻生效');
}

console.log('\n## 设置页能读到（默认值来自声明）');
{
  const k = createKernel({ now: () => NOW, persona: { name: 'T', core: 'c' }, admin: 'o', packs: [{ identity: KERNEL_IDENTITY, settings: KERNEL_SETTINGS }] });
  const g = k.settings.model().groups.find((x) => x.id === KID);
  ok(Boolean(g), '表单里有内核组');
  ok(g.fields.find((f) => f.key === 'memory.maxRecords').value === 600, '显示默认值 600');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
