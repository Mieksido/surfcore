/**
 * 发件箱测试
 * 跑法：node runtime/outbox.test.mjs
 */
import { createOutbox } from './outbox.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

const noSleep = async () => {};

console.log('## 一次就送到');
{
  const seen = [];
  const box = createOutbox({
    deliver: async (i) => { seen.push(i.id); return { intentId: i.id, status: 'delivered' }; },
    sleep: noSleep,
  });
  const ack = await box.send({ id: 'a', kind: 'say', text: 'x' });
  ok(ack.status === 'delivered' && ack.attempts === 1, '送到：一次，返回 attempts=1');
  ok(box.stats().sent === 1, '统计：sent 1');
}

console.log('\n## 可重试失败：退避后再试');
{
  let n = 0;
  const waits = [];
  const box = createOutbox({
    deliver: async (i) => {
      n += 1;
      if (n < 3) return { intentId: i.id, status: 'failed', error: { retryable: true, code: 'x' } };
      return { intentId: i.id, status: 'delivered' };
    },
    baseMs: 100,
    sleep: async (ms) => { waits.push(ms); },
    maxAttempts: 3,
  });
  const ack = await box.send({ id: 'b', kind: 'say' });
  ok(ack.status === 'delivered' && ack.attempts === 3, '第三次才成功：attempts=3');
  ok(waits.length === 2, '中间等了两次');
  ok(waits[0] === 100 && waits[1] === 200, '退避是 100 → 200（指数）');
  ok(box.stats().retried === 2, '统计：retried 2');
}

console.log('\n## 不可重试：立刻放弃');
{
  let n = 0;
  const box = createOutbox({
    deliver: async (i) => { n += 1; return { intentId: i.id, status: 'failed', error: { retryable: false, code: 'bad' } }; },
    sleep: noSleep,
  });
  const ack = await box.send({ id: 'c', kind: 'say' });
  ok(ack.status === 'failed' && ack.attempts === 1, '不可重试：只打一次');
  ok(n === 1, '确实只调用了一次');
}

console.log('\n## 已发出无法确认：绝不重试（防重复发消息）');
{
  let n = 0;
  const box = createOutbox({
    deliver: async (i) => { n += 1; return { intentId: i.id, status: 'unconfirmed' }; },
    sleep: noSleep,
  });
  const ack = await box.send({ id: 'd', kind: 'say' });
  ok(ack.status === 'unconfirmed' && n === 1, 'unconfirmed：不重试');
  ok(String(ack.note).includes('无法确认'), '回执里说明为什么不再试');
}

console.log('\n## 同一编号只投一次');
{
  let n = 0;
  const box = createOutbox({ deliver: async (i) => { n += 1; return { intentId: i.id, status: 'delivered' }; }, sleep: noSleep });
  await box.send({ id: 'same' });
  const again = await box.send({ id: 'same' });
  ok(n === 1, '第二次没有再打');
  ok(again.status === 'delivered', '但仍返回成功回执');
  ok(box.stats().skipped === 1, '统计：skipped 1');
}

console.log('\n## 用尽次数');
{
  const box = createOutbox({
    deliver: async (i) => ({ intentId: i.id, status: 'failed', error: { retryable: true } }),
    maxAttempts: 2, baseMs: 1, sleep: noSleep,
  });
  const ack = await box.send({ id: 'e' });
  ok(ack.status === 'failed' && ack.attempts === 2, '两次都失败：返回最后回执');
  ok(box.stats().failed === 1, '统计：failed 1');

  let threw = false;
  try { createOutbox({}); } catch { threw = true; }
  ok(threw, '没有 deliver：直接报错');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
