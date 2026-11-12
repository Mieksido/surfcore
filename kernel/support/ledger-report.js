/**
 * 账本报表：把 summary() 的原始数字整理成"人能看、机器也能读"的一份
 * ============================================================================
 * 位置：内核·支撑。它只做**汇总视图**，不做 IO、不做格式化货币符号；
 * 命令行/界面拿这份结构去排版。
 *
 * 三条口径：
 *   · 按模型：花得多的排前面（同价按 token，再按名字）
 *   · 按峰谷：高峰/空闲/未知（没算上价的进"未知"）
 *   · 没算价 / 估算：单独计数，**不许混进 0 元**
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * @param {object} summary createTokenLedger().summary()
 * @returns {object} 稳定结构（命令行 --json 直接输出）
 */
export function buildLedgerReport(summary = {}) {
  const samples = num(summary.samples);
  const externals = num(summary.externals);
  const byModelRaw = summary.byModel && typeof summary.byModel === 'object' ? summary.byModel : {};
  const byModel = Object.entries(byModelRaw)
    .map(([model, v]) => ({
      model: String(model),
      tokens: num(v?.tokens),
      cost: num(v?.cost),
      samples: num(v?.samples),
    }))
    .sort((a, b) => (b.cost - a.cost) || (b.tokens - a.tokens) || a.model.localeCompare(b.model));

  const tierRaw = summary.byTier && typeof summary.byTier === 'object' ? summary.byTier : {};
  const byTier = ['peak', 'off', 'unknown'].map((tier) => ({
    tier,
    tokens: num(tierRaw?.[tier]?.tokens),
    cost: num(tierRaw?.[tier]?.cost),
    samples: num(tierRaw?.[tier]?.samples),
  }));

  const tokens = num(summary.tokens);
  const cost = num(summary.cost);
  const externalTokens = num(summary.externalTokens);
  const externalCost = num(summary.externalCost);
  const totalTokens = num(summary.totalTokens) || (tokens + externalTokens);
  const totalCost = num(summary.totalCost) || (cost + externalCost);

  return {
    hasData: samples > 0 || externals > 0,
    currency: String(summary.currency ?? ''),
    samples,
    externals,
    tokens,
    cost,
    externalTokens,
    externalCost,
    totalTokens,
    totalCost,
    unpriced: num(summary.unpriced),
    estimated: num(summary.estimated),
    byModel,
    byTier,
  };
}

/** 给命令行用的几行摘要（不打印，只返回字符串数组；谁打印谁负责） */
export function ledgerReportLines(report = {}) {
  const money = (v) => {
    const n = Number(v) || 0;
    return n === 0 ? '0' : n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  };
  const lines = [];
  if (!report.hasData) {
    lines.push('账本还是空的：先跑一次 chat / boot，让模型真正用一次。');
    return lines;
  }
  lines.push(`总计：${report.samples} 条采样 + ${report.externals} 条外部用量`);
  lines.push(`token：${report.totalTokens}（模型 ${report.tokens} + 外部 ${report.externalTokens}）`);
  lines.push(`花费：${money(report.totalCost)}${report.currency ? ` ${report.currency}` : '（无币种）'}`);
  if (report.unpriced) lines.push(`⚠ 有 ${report.unpriced} 条没算上价（只记了 token，没有假装 0 元）`);
  if (report.estimated) lines.push(`⚠ 有 ${report.estimated} 条用了兜底价（estimated）`);
  if (report.byModel.length) {
    lines.push('按模型：');
    for (const row of report.byModel) {
      lines.push(`  ${row.model}  ${row.tokens} token  ${money(row.cost)}  ${row.samples} 条`);
    }
  }
  lines.push('按峰谷：');
  for (const row of report.byTier) {
    if (!row.samples) continue;
    lines.push(`  ${row.tier}  ${row.tokens} token  ${money(row.cost)}  ${row.samples} 条`);
  }
  return lines;
}
