// 联想（第 6 件）的**接线**回归：真实 bridge.js（VM 夹具）里验证提示词与冷却。
//
// 预取要跑一次真检索（夹具里没有真实索引），所以这几条用例直接往 associateCache 里塞条目，
// 验的是「接线」而不是「挑得准不准」（后者在 test-memory-associate.mjs）。
//
// 验四件事：
//   · 缓存里有条目时提示词带【忽然想起】；连建两遍都带（准备阶段不许消费）；
//   · 投递被接受后记冷却并清缓存，同一个 id 冷却期内不再出现；
//   · 缓存过期（>10 分钟）不再注入；
//   · 关掉开关时一条都不带。
import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';

let failures = 0;
async function test(name, run, options) {
  const h = await bridgeHarness(options);
  try {
    h.setMode('reserved2');
    await run(h);
    console.log('PASS', name);
  } catch (error) {
    failures += 1;
    console.error('FAIL', name, error.message);
  } finally {
    await h.close();
  }
}

const KEY = 'private:123';
const cacheItem = { id: 'mem_old_cat', text: '去年冬天在河边看到的那只白猫', R: 0.42, clarity: 'fuzzy' };

/** 直接把缓存铺好：等价于预取成功的那一刻。 */
function seed(h, at = Date.now(), items = [cacheItem]) {
  h.associateCache.set(KEY, { at, items });
}

await test('缓存里有条目：提示词带【忽然想起】，连建两遍都带', async (h) => {
  seed(h);
  const first = h.buildWakePromptV2(KEY, 'replyCheck');
  const second = h.buildWakePromptV2(KEY, 'replyCheck');
  assert.ok(first.includes('【忽然想起】'), '第一遍要带');
  assert.ok(second.includes('【忽然想起】'), '第二遍也要带（准备阶段不许消费）');
  assert.ok(second.includes('白猫'), '正文要进提示词');
  assert.ok(second.includes('别硬提'), '要带「搭不上就别提」的出口');
  assert.ok(!second.includes('mem_old_cat'), '不能把记忆 id 漏进提示词');
});

await test('投递被接受后才记冷却：缓存清掉、状态落盘、下一轮不再提', async (h) => {
  seed(h);
  const prompt = h.buildWakePromptV2(KEY, 'replyCheck');
  assert.ok(prompt.includes('白猫'));
  // 只建提示词不清缓存 —— 被拒的投递不该算「提过」。
  assert.ok(h.associateCache.has(KEY), '还没接受就不能清');

  await h.deliverPrompt(KEY, prompt, { wakeReason: 'replyCheck' });
  assert.ok(!h.associateCache.has(KEY), '接受后缓存要清');
  const seen = h.associateSeen();
  assert.ok(seen.seen.mem_old_cat, '要记下今天提过');
  assert.match(seen.seen.mem_old_cat, /^\d{4}-\d{2}-\d{2}$/);
});

await test('缓存过期（>10 分钟）不再注入，并顺手清掉', async (h) => {
  seed(h, Date.now() - 11 * 60_000);
  const prompt = h.buildWakePromptV2(KEY, 'replyCheck');
  assert.ok(!prompt.includes('【忽然想起】'), '过期条目不该注入');
  assert.ok(!h.associateCache.has(KEY), '过期条目要清掉');
});

await test('关掉开关时一条都不带', async (h) => {
  seed(h);
  h.cfg.memoryAssociate = { enabled: false };
  const prompt = h.buildWakePromptV2(KEY, 'replyCheck');
  assert.ok(!prompt.includes('【忽然想起】'));
});

await test('缓存为空时提示词里没有这一段', async (h) => {
  const prompt = h.buildWakePromptV2('private:888', 'replyCheck');
  assert.ok(!prompt.includes('【忽然想起】'));
});

if (failures) {
  console.error(`${failures} case(s) failed`);
  process.exit(1);
}
console.log('联想接线：全部通过');