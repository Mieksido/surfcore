/**
 * 群规模测试（假客户端，不联网）
 * 跑法：node packs/qq/group-info.test.mjs
 */
import { createGroupInfo, DEFAULT_GROUP_INFO } from './group-info.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

function fakeClient(map = {}) {
  const calls = [];
  return {
    calls,
    async call(action, params) {
      calls.push({ action, params });
      const hit = map[String(params.group_id)];
      if (hit === undefined) return { ok: false, error: { code: 'qq.not-found' } };
      if (hit === 'throw') throw new Error('网关拒绝');
      return { ok: true, data: { member_count: hit } };
    },
  };
}

console.log('## 查询与缓存');
{
  let t = 1000;
  const client = fakeClient({ 123: 500 });
  const gi = createGroupInfo({ client, now: () => t });

  ok(await gi.memberCount(123) === 500, '第一次：问到人数');
  ok(client.calls.length === 1, '只打了一次网关');
  ok(await gi.memberCount(123) === 500, '第二次：走缓存');
  ok(client.calls.length === 1, '没有重复请求');
  ok(gi.stats().hits === 1 && gi.stats().misses === 1, '统计：1 命中 1 未命中');

  t += DEFAULT_GROUP_INFO.ttlMs + 1;
  await gi.memberCount(123);
  ok(client.calls.length === 2, '过期后：重新查');
}

console.log('\n## 失败：返回 0，不抛');
{
  const client = fakeClient({ 999: 'throw' });
  const gi = createGroupInfo({ client });
  ok(await gi.memberCount(999) === 0, '网关抛错：0（按小群处理）');
  ok(gi.stats().failures === 1, '统计里有失败次数');

  const missing = createGroupInfo({ client: fakeClient({}) });
  ok(await missing.memberCount(1) === 0, '查不到：0（不瞎猜）');
  ok(await missing.memberCount('') === 0, '没给群号：0');
}

console.log('\n## 并发合并：同一个群同时来三条只问一次');
{
  const client = fakeClient({ 7: 300 });
  const gi = createGroupInfo({ client });
  const [a, b, c] = await Promise.all([gi.memberCount(7), gi.memberCount(7), gi.memberCount(7)]);
  ok(a === 300 && b === 300 && c === 300, '三个都拿到人数');
  ok(client.calls.length === 1, '只问了一次');
}

console.log('\n## 直接塞值 & 上限');
{
  const gi = createGroupInfo({ client: fakeClient({}), maxGroups: 2 });
  gi.prime('a', 120);
  ok(await gi.memberCount('a') === 120, 'prime 之后直接可用（不打网关）');
  gi.prime('b', 1); gi.prime('c', 2);
  ok(gi.stats().size <= 2, '缓存受上限约束');

  let threw = false;
  try { createGroupInfo({}); } catch { threw = true; }
  ok(threw, '没有客户端：直接报错');
  ok(DEFAULT_GROUP_INFO.ttlMs === 10 * 60 * 1000, '默认缓存 10 分钟');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
