// 监听 TDZ 的回归：程序错误必须带类型/stack，不能被 catch 吞成普通网络错误。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { formatListenError } from '../plugins/surfcore/lib/scheduler.js';

const ref = formatListenError(new ReferenceError('Cannot access L before initialization'));
assert.ok(ref.includes('ReferenceError'), 'ReferenceError 必须保留类型');
assert.ok(ref.includes('Cannot access L'), 'ReferenceError 必须保留消息');

const type = formatListenError(new TypeError('x is not a function'));
assert.ok(type.includes('TypeError'));

const network = formatListenError(new Error('fetch failed'));
assert.equal(network, 'fetch failed', '普通错误只留 message，不刷长 stack');
assert.ok(formatListenError(null).length <= 800);

const source = fs.readFileSync('plugins/surfcore/lib/scheduler.js', 'utf8');
assert.ok(!/const\s+L\s*=\s*limitsNow\(\)/.test(source.slice(source.indexOf('async function listenTick'), source.indexOf('async function liveTick'))),
  'listenTick 不能再用 L 接收 limitsNow');
assert.ok(source.includes('listenerCfg'), '监听配置必须用独立名字');
assert.ok(source.includes('formatListenError(e)'), 'catch 必须走可见错误格式');
console.log('✅ B站监听错误可见性回归通过');
