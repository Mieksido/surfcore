/**
 * Token 账本测试（纯内存，不联网、不摸盘）
 * 跑法：node kernel/support/ledger.test.mjs
 */
import {
  TOKEN_BUCKET_KEYS, ZERO_BUCKETS, emptyBuckets, normalizeUsage, totalTokensOf,
  addBuckets, createTokenLedger,
} from './ledger.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

console.log('## 桶：归一化');
{
  ok(TOKEN_BUCKET_KEYS.length === 5, '五个桶：命中/未命中/写入/输出/推理');
  ok(totalTokensOf(ZERO_BUCKETS) === 0, '空桶总量 0');

  const external = normalizeUsage({ inputTokens: 100, cacheReadTokens: 30, cacheWriteTokens: 5, outputTokens: 20, reasoningTokens: 7 });
  ok(external.cacheMiss === 100 && external.cacheHit === 30 && external.cacheWrite === 5 && external.output === 20, '外部口径：input 是未命中部分');
  ok(external.reasoning === 7, '推理桶单独记（只展示）');
  ok(totalTokensOf(external) === 155, '计费总量 = 四桶之和（不含 reasoning，避免重复）');

  const openai = normalizeUsage({ prompt_tokens: 1000, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 800 }, completion_tokens_details: { reasoning_tokens: 12 } });
  ok(openai.cacheHit === 800, 'OpenAI 口径：cached_tokens → 命中');
  ok(openai.cacheMiss === 200, 'OpenAI 口径：prompt - cached → 未命中');
  ok(openai.output === 40 && openai.reasoning === 12, 'OpenAI 口径：completion / reasoning');

  const ours = normalizeUsage({ cacheMiss: 3, cacheHit: 4, cacheWrite: 1, output: 2, reasoning: 1 });
  ok(ours.cacheMiss === 3 && ours.cacheHit === 4, '自己的落盘口径原样读回');

  ok(totalTokensOf(normalizeUsage(null)) === 0, 'null 不炸');
  ok(totalTokensOf(normalizeUsage({ prompt_tokens: -5 })) === 0, '负值当 0');
  ok(emptyBuckets() !== ZERO_BUCKETS, '空桶每次给新对象（改不到常量）');

  const sum = addBuckets({ cacheMiss: 1, output: 2 }, { cacheMiss: 3, cacheHit: 4 });
  ok(sum.cacheMiss === 4 && sum.output === 2 && sum.cacheHit === 4, '桶相加逐项');
}

console.log('\n## 账本：幂等（重连重发不能把钱改小）');
{
  const ledger = createTokenLedger({ now: () => 1000, price: (b) => ({ total: totalTokensOf(b), currency: 'T', tier: 'off' }) });
  const first = ledger.ingest({ sessionId: 's1', turn: 1, step: 1, model: 'm', at: 100, usage: { cacheMiss: 100, output: 20 } });
  ok(first.tokens === 120, '第一次：记 120 token');
  ok(first.cost === 120, '成本走注入的价格函数');

  const replay = ledger.ingest({ sessionId: 's1', turn: 1, step: 1, model: 'm', at: 100, usage: { cacheMiss: 100, output: 20 } });
  ok(replay === first, '同一条重放：返回原记录');
  ok(ledger.summary().tokens === 120, '总量没有翻倍');

  const stale = ledger.ingest({ sessionId: 's1', turn: 1, step: 1, model: 'm', at: 100, usage: { cacheMiss: 1, output: 0 }, seq: 0 });
  ok(stale === first, '旧 seq 不覆盖新记录');

  const newer = ledger.ingest({ sessionId: 's1', turn: 1, step: 1, model: 'm', at: 100, usage: { cacheMiss: 200, output: 0 }, seq: 5 });
  ok(newer.tokens === 200, '更新的 seq 覆盖（后到覆盖先到）');
  ok(ledger.summary().tokens === 200, '总量跟着变成 200（不是 320）');
}

console.log('\n## 账本：一回合多步 / 多会话');
{
  const ledger = createTokenLedger({ price: () => ({ total: 1, currency: 'CNY', tier: 'peak', estimated: false }) });
  ledger.ingest({ sessionId: 's1', turn: 1, step: 1, model: 'flash', usage: { cacheMiss: 10 } });
  ledger.ingest({ sessionId: 's1', turn: 1, step: 2, model: 'flash', usage: { output: 5 } });
  ledger.ingest({ sessionId: 's2', turn: 1, step: 1, model: 'pro', usage: { cacheHit: 2 } });

  const one = ledger.sessionTotal('s1');
  ok(one.tokens === 15 && one.samples === 2, '会话 s1：两步都算，两条采样');
  ok(ledger.sessionTotal('s2').tokens === 2, '会话 s2 单独算');
  ok(ledger.sessionTotal('nobody').tokens === 0, '不存在的会话：0');

  const sum = ledger.summary();
  ok(sum.tokens === 17, '全局总量 17');
  ok(sum.byModel.flash.tokens === 15 && sum.byModel.pro.tokens === 2, '按模型分组');
  ok(sum.samples === 3, '采样 3 条');
  ok(sum.cost === 3, '成本 3（每次按注入价格 1）');
  ok(sum.byTier.peak.samples === 3 && sum.byTier.peak.cost === 3, '按峰谷汇总：3 条都在高峰');
  ok(sum.currency === 'CNY', '币种从采样带出来');
}

console.log('\n## 账本：没有价格就明说，不假装 0 元');
{
  const bare = createTokenLedger();
  const row = bare.ingest({ sessionId: 's', turn: 1, step: 1, usage: { cacheMiss: 10 } });
  ok(row.tokens === 10, 'token 照记');
  ok(row.unpriced === true, '标 unpriced');
  const s = bare.summary();
  ok(s.unpriced === 1 && s.cost === 0, '汇总里能看到"有一条没算钱"');

  const broken = createTokenLedger({ price: () => { throw new Error('价目表坏了'); } });
  const r2 = broken.ingest({ sessionId: 's', turn: 1, step: 1, usage: { cacheMiss: 10 } });
  ok(r2.unpriced === true && r2.tokens === 10, '价格函数抛错：token 保住，标没算钱');

  const unknown = createTokenLedger({ price: () => ({ total: 0.5, currency: 'CNY', estimated: true }) });
  const r3 = unknown.ingest({ sessionId: 's', turn: 1, step: 1, model: 'who', usage: { cacheMiss: 1 } });
  ok(r3.estimated === true, '未知模型：保留 estimated 标记');
}

console.log('\n## 账本：外部用量 / 落盘 / 读盘');
{
  const ledger = createTokenLedger();
  ledger.ingest({ sessionId: 's', turn: 1, step: 1, usage: { cacheMiss: 3 } });
  ok(ledger.external({ name: 'carrier', tokens: 50, cost: 0.02 }) !== null, '外部用量可以报进来');
  ok(ledger.external({ name: 'empty' }) === null, '没量没钱的"外部用量"不记');

  const sum = ledger.summary();
  ok(sum.externalTokens === 50 && sum.totalTokens === 53, '外部 token 进总量');
  ok(Math.abs(sum.totalCost - 0.02) < 1e-9, '外部成本也进总成本');

  const snap = ledger.snapshot();
  const copy = createTokenLedger();
  const restored = copy.restore(snap);
  ok(restored.samples === 1 && restored.externals === 1, '快照恢复条数');
  ok(copy.summary().totalTokens === 53, '恢复后总量一致');
  ok(copy.ingest({ sessionId: 's', turn: 1, step: 1, usage: { cacheMiss: 3 } }).tokens === 3, '恢复后仍按原键幂等');

  const bad = createTokenLedger();
  const n = bad.restore({ samples: [{ key: 'x', buckets: { cacheMiss: 0 } }, null, { nokey: true }] });
  ok(n.samples === 0, '坏行/空桶丢掉，不炸');
}

console.log('\n## 账本：容量上限');
{
  const ledger = createTokenLedger({ maxSamples: 2 });
  for (let i = 1; i <= 4; i++) ledger.ingest({ sessionId: 's', turn: i, step: 1, at: i, usage: { cacheMiss: i } });
  ok(ledger.size() === 2, '超过上限只留 2 条（淘汰最老的）');
  const sum = ledger.summary();
  ok(sum.tokens === 7, '留下的是第 3、4 条：3 + 4 = 7');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
