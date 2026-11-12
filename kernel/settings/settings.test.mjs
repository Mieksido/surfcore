/**
 * 设置模型测试
 * 跑法：node kernel/settings/settings.test.mjs
 */
import { validateField, coerceValue, buildSettingsModel, exportSettings, importSettings, SETTINGS_VERSION } from './index.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

const PACK_A = {
  identity: { publisher: 'acme', name: 'alpha' },
  settings: [
    { key: 'size', label: '大小', description: '气泡大小', defaultValue: 6, options: [3, 6, 9], cost: '越大越占地方', group: 'basic' },
    { key: 'voice', label: '用语音', description: '要不要语音', defaultValue: false, options: [true, false], cost: '更吵', group: 'basic' },
    { key: 'mode', label: '模式', description: '行为模式', defaultValue: 'calm', options: ['calm', 'lively'], cost: '活泼会多说几句', group: 'advanced' },
  ],
};
const PACK_B = {
  identity: { publisher: 'acme', name: 'beta' },
  settings: [
    { key: 'window', label: '窗口', description: '时间窗', defaultValue: '20:00', options: ['20:00', '21:00'], cost: '越晚越省电', group: 'basic' },
  ],
};

console.log('## 声明校验（缺代价说明不算合格）');
{
  ok(validateField(PACK_A.settings[0]).ok, '合格声明：通过');
  ok(!validateField({ key: 'x', label: 'X', defaultValue: 1, options: [1] }).ok, '缺代价说明：拒绝');
  ok(validateField({ key: 'x', label: 'X', defaultValue: 1, options: [1] }).errors.some((e) => e.includes('代价')), '错误里点名"代价"');
  ok(!validateField({ key: 'x', label: 'X', options: [1], cost: 'c' }).ok, '缺默认值：拒绝');
  ok(!validateField({ key: 'x', label: 'X', defaultValue: 1, options: [1], cost: 'c', group: '乱写' }).ok, '分组不合法：拒绝');
}

console.log('\n## 值收敛（不在范围就拒绝，不偷偷改默认）');
{
  ok(coerceValue(PACK_A.settings[0], 9).value === 9, '数值在范围内：接受');
  ok(!coerceValue(PACK_A.settings[0], 7).ok, '数值不在范围：拒绝');
  ok(coerceValue(PACK_A.settings[1], 'true').value === true, '字符串 true 被收敛成布尔');
  ok(!coerceValue(PACK_A.settings[1], 'maybe').ok, '非布尔：拒绝');
  ok(coerceValue(PACK_A.settings[2], 'lively').value === 'lively', '枚举在范围：接受');
  ok(!coerceValue(PACK_A.settings[2], 'chaos').ok, '枚举不在范围：拒绝');

  const changed = coerceValue(PACK_A.settings[0], 9);
  ok(changed.warning === '越大越占地方', '选了非默认值：带出代价说明（用户知道后果）');
  const same = coerceValue(PACK_A.settings[0], 6);
  ok(same.warning === null, '选默认值：不啰嗦');
}

console.log('\n## 合成表单');
{
  const model = buildSettingsModel([PACK_A, PACK_B], { 'acme/alpha': { size: 9 } });
  ok(model.version === SETTINGS_VERSION, '模型带版本号');
  ok(model.groups.length === 2, '两个包 → 两组');
  ok(model.issues.length === 0, '没有问题项');

  const alpha = model.groups[0];
  ok(alpha.id === 'acme/alpha', '组标识 = 发布人/名字');
  ok(alpha.fields.length === 3, '这一组有三项');
  const size = alpha.fields.find((f) => f.key === 'size');
  ok(size.value === 9 && size.isDefault === false, '用户的设定生效（9，已改过）');
  ok(size.warning === '越大越占地方', '改过的项带代价提示');
  const voice = alpha.fields.find((f) => f.key === 'voice');
  ok(voice.value === false && voice.isDefault === true, '没设过的项：用默认值');
  ok(alpha.fields.every((f) => Array.isArray(f.options) && f.cost), '每项都有可选值与代价（界面能直接画）');

  const bad = buildSettingsModel([{ identity: { publisher: 'x', name: 'y' }, settings: [{ key: 'k', label: 'K' }] }], {});
  ok(bad.groups.length === 0 && bad.issues.length === 1, '不合格的声明：不画进表单，记成问题项');
}

console.log('\n## 导出 / 导入（配置属于用户）');
{
  const model = buildSettingsModel([PACK_A, PACK_B], { 'acme/alpha': { size: 9 } });
  const dump = exportSettings(model);
  ok(dump.version === SETTINGS_VERSION && typeof dump.exportedAt === 'number', '导出带版本与时间');
  ok(dump.values['acme/alpha'].size === 9, '导出的是生效值');
  ok(dump.values['acme/beta'].window === '20:00', '没改过的也导出（换机器直接还原）');

  const back = importSettings(dump, [PACK_A, PACK_B]);
  ok(back.ok && back.applied['acme/alpha'].size === 9, '导入：认识的值应用成功');
  ok(back.rejected.length === 0, '导入：没有拒绝项');

  const partial = importSettings({ version: SETTINGS_VERSION, values: { 'acme/alpha': { size: 99, 不存在的项: 1 } } }, [PACK_A]);
  ok(partial.rejected.length === 2, '导入：越界值 + 未知项都被拒绝');
  ok(partial.rejected.some((r) => String(r.reason).includes('没有这一项')), '未知项：说清"这个包没有这一项"');
  ok(partial.rejected.some((r) => String(r.reason).includes('只能是')), '越界值：说清可选范围');

  const wrongVer = importSettings({ version: 999, values: {} }, [PACK_A]);
  ok(!wrongVer.ok, '版本不符：整体拒绝（不半信半疑地导入）');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
