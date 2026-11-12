/**
 * 静默事件：只入记忆，不唤醒
 * 跑法：node kernel/silent-wake.test.mjs
 */
import { createKernel } from './index.js';

let pass = 0; let fail = 0;
const ok = (c, n) => { if (c) { pass += 1; console.log('  ✅', n); } else { fail += 1; console.error('  ❌', n); } };
const at = Date.parse('2026-01-01T00:00:00.000Z');
const k = createKernel({ now: () => at });

const event = {
  text: '后台同步进来的一句话', silent: true, mentioned: false,
  from: { adapter: 'x', channel: 'private:owner', kind: 'private', actor: 'owner', at },
  to: { owner: true },
};
const r = await k.respond(event, { channelId: 'private:owner', kind: 'private', isOwner: true });
ok(r.wake === false && r.reason === 'silent', 'silent 事件不唤醒');
ok(r.record && r.record.text.includes('后台'), '仍然入库');
ok(k.snapshot().records === 1, '记忆里有 1 条');

const live = await k.respond({ ...event, text: '现在说的话', silent: false }, { channelId: 'private:owner', kind: 'private', isOwner: true });
ok(live.wake === true, '普通主人消息仍然唤醒');

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
