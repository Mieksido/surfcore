// QQ @ 识别：同一条消息 @ 我 + @ 别人时，仍然要算“叫了我”。
import assert from 'node:assert/strict';
import { atInfo } from '../src/qq-at.js';

const self = '10001';
assert.deepEqual(
  atInfo([{ type: 'at', data: { qq: self } }, { type: 'text', data: { text: ' 在吗' } }], [self]),
  { atSelf: true, atOther: false, targets: [self] },
);
const both = atInfo([
  { type: 'at', data: { qq: '20002' } },
  { type: 'at', data: { qq: self } },
], [self]);
assert.equal(both.atSelf, true);
assert.equal(both.atOther, true, '同时 @ 别人也要保留 atSelf，不能一票否决');

const other = atInfo([{ type: 'at', data: { qq: '20002' } }], [self]);
assert.equal(other.atSelf, false);
assert.equal(other.atOther, true);

const all = atInfo([{ type: 'at', data: { qq: 'all' } }], [self]);
assert.equal(all.atSelf, false);
assert.equal(all.atOther, false, '@全体不算 @ 我，也不算 @ 别人');

const cq = atInfo(`[CQ:at,qq=${self}] 你好`, [self]);
assert.equal(cq.atSelf, true);
assert.equal(cq.atOther, false);

const fallback = atInfo([{ type: 'at', data: { qq: 30003 } }], ['', null, 30003]);
assert.equal(fallback.atSelf, true, 'self_id 缺失时要用登录 selfUserId 回退');

const noAt = atInfo([{ type: 'text', data: { text: 'hello' } }], [self]);
assert.equal(noAt.atSelf, false);
assert.equal(noAt.atOther, false);

console.log('✅ QQ @ 识别测试通过');
