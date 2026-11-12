/**
 * 账本报表测试（纯函数）
 * 跑法：node kernel/support/ledger-report.test.mjs
 */
import { buildLedgerReport, ledgerReportLines } from './ledger-report.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

console.log('## 空账本');
{
  const r = buildLedgerReport({});
  ok(r.hasData === false, '没数据：hasData=false');
  ok(r.totalTokens === 0 && r.totalCost === 0, '全 0');
  ok(Array.isArray(r.byModel) && r.byModel.length === 0, '按模型：空数组');
  ok(r.byTier.length === 3 && r.byTier.every((t) => t.samples === 0), '峰谷三档都在，样本 0');
  const lines = ledgerReportLines(r);
  ok(lines.length === 1 && lines[0].includes('空的'), '给一句"还没用量"，不装忙');
  ok(!lines.some((l) => l.includes('0 CNY')), '空账本不显示"花了 0 元"');
}

console.log('\n## 有数据：按模型/峰谷/外部/没算价');
{
  const summary = {
    currency: 'CNY',
    samples: 3,
    externals: 1,
    tokens: 1500,
    cost: 0.012,
    externalTokens: 50,
    externalCost: 0.02,
    totalTokens: 1550,
    totalCost: 0.032,
    unpriced: 1,
    estimated: 1,
    byModel: {
      flash: { tokens: 1000, cost: 0.01, samples: 2 },
      pro: { tokens: 500, cost: 0.002, samples: 1 },
    },
    byTier: {
      peak: { tokens: 800, cost: 0.009, samples: 2 },
      off: { tokens: 700, cost: 0.003, samples: 1 },
      unknown: { tokens: 0, cost: 0, samples: 0 },
    },
  };
  const r = buildLedgerReport(summary);
  ok(r.hasData === true, '有数据');
  ok(r.totalTokens === 1550 && r.totalCost === 0.032, '总量含外部用量');
  ok(r.byModel[0].model === 'flash' && r.byModel[1].model === 'pro', '按花费从高到低（flash 0.01 > pro 0.002）');
  ok(r.byTier.find((t) => t.tier === 'peak').samples === 2, '高峰 2 条');
  ok(r.unpriced === 1 && r.estimated === 1, '没算价/估算单独计数');

  const lines = ledgerReportLines(r).join('\n');
  ok(lines.includes('flash') && lines.includes('pro'), '按模型列出来');
  ok(lines.includes('高峰') === false && lines.includes('peak'), '峰谷用稳定 key（排版交给界面/命令行）');
  ok(lines.includes('没算上价'), '没算价要显式提醒');
  ok(lines.includes('兜底价'), '估算要显式提醒');
  ok(lines.includes('外部'), '外部用量要单独说');
}

console.log('\n## 排序与缺字段');
{
  const r = buildLedgerReport({
    samples: 2, tokens: 10, cost: 3, totalTokens: 10, totalCost: 3,
    byModel: {
      b: { tokens: 5, cost: 1 },
      a: { tokens: 5, cost: 1 },
      c: { tokens: 100, cost: 1 },
    },
  });
  ok(r.byModel[0].model === 'c', '同价：token 多的排前面');
  ok(r.byModel[1].model === 'a' && r.byModel[2].model === 'b', '再同：按名字排（a 在 b 前）');
  ok(r.byTier.every((t) => t.samples === 0), '没给峰谷：三档补 0，不炸');
  ok(r.currency === '', '没币种：空串，不编');

  const weird = buildLedgerReport({ samples: 'x', cost: 'y', byModel: null, byTier: 'nope' });
  ok(weird.samples === 0 && weird.cost === 0, '坏值当 0');
  ok(weird.byModel.length === 0 && weird.byTier.length === 3, '坏结构给空数组/三档');
}

console.log('\n## 金额格式（命令行行）');
{
  const r = buildLedgerReport({ samples: 1, tokens: 1, cost: 0.000001, totalTokens: 1, totalCost: 0.000001, currency: 'CNY', byModel: { m: { tokens: 1, cost: 0.000001, samples: 1 } }, byTier: { off: { tokens: 1, cost: 0.000001, samples: 1 } } });
  const text = ledgerReportLines(r).join('\n');
  ok(text.includes('0.000001 CNY'), '小额不被四舍五入成 0');
  ok(!text.includes('0.0000010'), '去掉尾随 0');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
