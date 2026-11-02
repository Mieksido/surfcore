// 作息窗口：跨午夜、全角冒号、24:00、非法时间不能再静默失效。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeWindow, parseClock, windowContains } from '../plugins/surfcore/tools/lib/time-window.mjs';
import { normalizeNightWindows } from '../plugins/surfcore/tools/lib/night-schedule.mjs';
import { normalizeBiliWindowList } from '../plugins/surfcore/lib/store.js';

assert.equal(parseClock('22:00'), 1320);
assert.equal(parseClock('22：00'), 1320, '全角冒号要归一');
assert.equal(parseClock('２２：００'), 1320, '全角数字也要归一');
assert.equal(parseClock('24:00', { allow24: true }), 1440);
assert.equal(parseClock('24:00'), null, '开始时间不允许 24:00');
assert.equal(parseClock('25:00'), null);
assert.equal(parseClock('22:70'), null);

const wrap = normalizeWindow({ start: '22:00', end: '02:00', wakes: 1 });
assert.ok(wrap.ok && wrap.wrap, '22:00–02:00 必须跨午夜');
assert.equal(windowContains(wrap, 23 * 60), true);
assert.equal(windowContains(wrap, 1 * 60), true);
assert.equal(windowContains(wrap, 12 * 60), false);
assert.equal(windowContains(wrap, 2 * 60), false, '结束边界是开区间');

const normal = normalizeWindow({ start: '20:00', end: '24:00', wakes: 1 });
assert.ok(normal.ok && !normal.wrap);
assert.equal(windowContains(normal, 23 * 60), true);
assert.equal(windowContains(normal, 0), false);

assert.equal(normalizeWindow({ start: '22：00', end: '02：00' }).ok, true, '全角时间窗必须可用');
assert.equal(normalizeWindow({ start: '22:00', end: '22:00' }).ok, false, '相同起止不能静默变全天');

const night = normalizeNightWindows([{ start: '22：00', end: '02：00', wakes: 1 }]);
assert.equal(night.length, 1);
assert.equal(night[0].wrap, true);

const checked = normalizeBiliWindowList([{ start: '22：00', end: '08：00', wakes: 1 }]);
assert.equal(checked.windows[0].start, '22:00');
assert.equal(checked.windows[0].end, '08:00');
assert.equal(checked.warnings.length, 0);
const bad = normalizeBiliWindowList([{ start: '22：00', end: 'nope', wakes: 1 }]);
assert.equal(bad.warnings.length, 1, '非法窗口必须给 warning，不能静默保存');

const scheduler = fs.readFileSync(path.resolve('plugins/surfcore/lib/scheduler.js'), 'utf8');
const listen = scheduler.slice(scheduler.indexOf('async function listenTick'), scheduler.indexOf('async function liveTick'));
assert.ok(listen.includes('const LIM = limitsNow()'), 'listenTick 内层额度变量必须改名，避免与外层 L 冲突');
assert.ok(!listen.includes('const L = limitsNow()'), 'listenTick 不能再声明同名 L');
assert.ok(listen.includes("String(L.scope"), '外层 listen 配置仍应使用 L');
console.log('✅ 作息时间窗/监听变量测试通过');
