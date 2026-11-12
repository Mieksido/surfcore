/**
 * 价目表测试（纯函数，不联网）
 * 跑法：node kernel/expression/prices.test.mjs
 */
import {
  PRICE_TABLE_VERSION, DEFAULT_PRICE_TABLE, resolvePriceTable, beijingParts, isPeakAt,
  ratesAt, costOfBuckets, priceUsage, ledgerPrice, describePriceTable, billableTokens,
} from './prices.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };
const bj = (s) => Date.parse(`${s}+08:00`);

console.log('## 北京时间（不依赖本机时区）');
{
  const p = beijingParts(bj('2026-11-10T10:00:00'));
  ok(p.weekday === 2, '2026-11-10 是周二');
  ok(p.hour === 10 && p.clock === '10:00', '小时/时钟');
  ok(p.date === '2026-11-10', '日期键');
}

console.log('\n## 峰谷判定');
{
  ok(isPeakAt(bj('2026-11-10T09:00:00')), '周二 09:00：高峰（窗口起点含）');
  ok(!isPeakAt(bj('2026-11-10T12:00:00')), '周二 12:00：空闲（窗口终点不含）');
  ok(isPeakAt(bj('2026-11-10T14:00:00')), '周二 14:00：高峰');
  ok(!isPeakAt(bj('2026-11-10T18:00:00')), '周二 18:00：空闲');
  ok(!isPeakAt(bj('2026-11-10T20:00:00')), '周二 20:00：空闲');
  ok(!isPeakAt(bj('2026-11-14T10:00:00')), '周六 10:00：空闲（周末）');
  ok(!isPeakAt(bj('2026-10-01T10:00:00')), '国庆 10:00：空闲（法定节假日）');
  ok(isPeakAt(bj('2026-11-11T10:00:00')), '周三 10:00：高峰');
  ok(!isPeakAt(NaN), '坏时间：不当高峰');
}

console.log('\n## 单价与金额');
{
  const off = ratesAt('deepseek-flash', bj('2026-11-10T20:00:00'));
  ok(off.tier === 'off' && off.cacheMiss === 1 && off.output === 4, '空闲价：未命中 1 / 输出 4');

  const peak = ratesAt('deepseek-flash', bj('2026-11-10T10:00:00'));
  ok(peak.tier === 'peak' && peak.cacheMiss === 2 && peak.output === 8, '高峰价 = 空闲 × 2');
  ok(peak.estimated === false, '认识的模型：不标 estimated');

  const pro = ratesAt('deepseek-v4-pro', bj('2026-11-10T20:00:00'));
  ok(pro.cacheMiss === 4.5 && pro.output === 13.5, 'pro 价目单独');

  const unknown = ratesAt('who-is-this', bj('2026-11-10T20:00:00'));
  ok(unknown.model === 'who-is-this' && unknown.estimated === true, '不认识的模型：按兜底价 + estimated');

  const millionOff = costOfBuckets({ cacheMiss: 1e6 }, off);
  ok(Math.abs(millionOff.total - 1) < 1e-9, '一百万未命中 token = 1 元（空闲）');
  const millionPeak = costOfBuckets({ cacheMiss: 1e6 }, peak);
  ok(Math.abs(millionPeak.total - 2) < 1e-9, '一百万未命中 token = 2 元（高峰）');

  const all = costOfBuckets({ cacheHit: 1e6, cacheMiss: 1e6, output: 1e6 }, off);
  ok(Math.abs(all.cacheHit - 0.02) < 1e-9 && Math.abs(all.cacheMiss - 1) < 1e-9 && Math.abs(all.output - 4) < 1e-9, '三类桶分别计价');
  ok(Math.abs(all.total - (0.02 + 1 + 4)) < 1e-9, '合计 = 分项相加');
  ok(costOfBuckets({}, off).total === 0, '空桶：0 元');

  const one = priceUsage({ cacheMiss: 1e6 }, { model: 'deepseek-flash', at: bj('2026-11-10T20:00:00') });
  ok(Math.abs(one.cost.total - 1) < 1e-9, 'priceUsage 一步到位');
  ok(one.rates.currency === 'CNY' && one.rates.unit === 1e6, '带币种与单位');
}

console.log('\n## 价目表覆盖');
{
  const table = resolvePriceTable({
    peakMultiplier: 3,
    models: { 'my-model': { label: '自备模型', off: { cacheMiss: 2, output: 6 } } },
    fallbackModel: 'my-model',
  });
  const r = ratesAt('my-model', bj('2026-11-10T10:00:00'), table);
  ok(r.cacheMiss === 6 && r.output === 18, '覆盖项：高峰按新倍数 3');
  ok(r.cacheWrite === 2 * 3, '没写 cacheWrite：跟随 cacheMiss（不继承兜底模型的怪价）');
  ok(table.version === PRICE_TABLE_VERSION, '版本保留');

  const bad = resolvePriceTable({ peakMultiplier: 0, peakWindows: 'nope', models: null, holidays: 'x' });
  ok(bad.peakMultiplier === DEFAULT_PRICE_TABLE.peakMultiplier, '坏倍数回默认');
  ok(Array.isArray(bad.peakWindows) && Array.isArray(bad.holidays), '坏窗口/假期回默认');
  ok(bad.models['deepseek-flash'], '坏 models 不影响内置条目');

  const noFallback = resolvePriceTable({ fallbackModel: 'not-exist' });
  ok(noFallback.fallbackModel === DEFAULT_PRICE_TABLE.fallbackModel, '兜底模型不存在：回默认');

  const d = describePriceTable();
  ok(d.models.includes('deepseek-flash') && d.currency === 'CNY', '展示信息');
}

console.log('\n## 给账本的适配器');
{
  const price = ledgerPrice();
  const out = price({ cacheMiss: 1e6 }, { model: 'deepseek-flash', at: bj('2026-11-10T20:00:00') });
  ok(Math.abs(out.total - 1) < 1e-9 && out.currency === 'CNY', '账本拿到 total/currency');
  ok(out.tier === 'off' && out.estimated === false, '账本还拿到峰谷与估算标记');

  ok(billableTokens({ prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 60 } }) === 120, '展示用：可计费总量');
  ok(billableTokens(null) === 0, '展示用：空 usage 为 0');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
