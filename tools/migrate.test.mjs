/**
 * 旧配置迁移测试（纯规划；不读真实 config，不写状态）
 * 跑法：node tools/migrate.test.mjs
 */
import { planMigration, formatMigrationPlan, applyMigration } from './migrate.mjs';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

const old = {
  allow: { groups: ['1', '2'], private: ['9'] },
  ownerQQ: '10086',
  snowluma: { wsUrl: 'ws://127.0.0.1:3001', httpUrl: 'http://127.0.0.1:3000', accessToken: 'secret-token' },
  webSearch: { apiSearchURL: 'https://search.example/api', apiKey: 'secret-key' },
  biliBridge: { enabled: true },
  purpose: { enabled: true },
  chat: { contextMessages: 100 },
};

console.log('## 规划');
{
  const p = planMigration(old);
  ok(p.mapped.length === 8, `映射 8 项（实际 ${p.mapped.length}）`);
  ok(p.settings['surfcore/runtime']['allow.groups'] === '1,2', '群名单 → allow.groups');
  ok(p.settings['surfcore/runtime']['allow.privates'] === '9', '私聊名单 → allow.privates');
  ok(p.settings['surfcore/qq'].ownerId === '10086', 'ownerQQ → QQ ownerId');
  ok(p.settings['surfcore/qq'].accessToken === 'secret-token', 'snowluma token → QQ accessToken');
  ok(p.settings['surfcore/web'].searchEndpoint === 'https://search.example/api', '搜索端点 → web');
  ok(p.skipped.some((s) => s.key === 'biliBridge'), 'B站旧配置明确不迁');
  ok(p.skipped.some((s) => s.key === 'purpose'), 'purpose 明确不迁');
}

console.log('\n## 预览不泄密');
{
  const text = formatMigrationPlan(planMigration(old));
  ok(text.includes('可迁移：8 项'), '打印可迁移数');
  ok(!text.includes('secret-token'), '不打印 QQ 令牌');
  ok(!text.includes('secret-key'), '不打印搜索密钥');
  ok(!text.includes('10086'), '不打印主人号');
}

console.log('\n## allowAllWhenEmpty 有警告');
{
  const p = planMigration({ allowAllWhenEmpty: true });
  ok(p.settings['surfcore/runtime']['allow.all'] === true, '映射成 allow.all');
  ok(p.warnings.some((w) => w.includes('所有人放行')), '明确警告');
}

console.log('\n## 应用只写新设置');
{
  const writes = [];
  const kernel = { settings: { set: (a, k, v) => writes.push([a, k, v]) }, save: () => writes.push(['save']) };
  const r = applyMigration(kernel, planMigration(old));
  ok(r.settingsWritten === 8, '写入 8 项');
  ok(writes.some(([a]) => a === 'surfcore/runtime'), '写了 runtime 设置');
  ok(writes.at(-1)[0] === 'save', '最后保存一次');
  let threw = false;
  try { applyMigration({}, {}); } catch { threw = true; }
  ok(threw, '没有 kernel.settings.set 就明确报错');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
