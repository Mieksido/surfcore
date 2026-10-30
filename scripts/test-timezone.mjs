/**
 * 自定义时区回归（config.json 的 timezone，覆盖系统时区）。
 *
 * 动机：很多服务器的系统时区是错的（默认 UTC）。安静时段 / 每日额度换天 / 作息窗口 /
 * 定点问候都按「本地时钟」算，时区不对就全错位。
 *
 * 要钉住的事：
 *   1. 输入校验：IANA 名、大小写、UTC+8 整点偏移；非法值要给 error + hint（失败必须可行动）；
 *   2. withTimeZone 临时切换：算完必须还原到系统时区（delete TZ 不会让 V8 重读，这里专门测过）、可嵌套、抛错也还原；
 *   3. 进程层 applyProcessTimeZone 之后普通的 new Date().getHours() 就是配置时区；清空后回到系统；
 *   4. 共享模块（token-budget / purpose-engine / memory-card）在宿主进程里按配置时区算，不依赖系统时区；
 *   5. 不配置 = 行为与以前完全一致；
 *   6. 以上全部在 3 种不同的「系统时区」下再跑一遍（UTC / 东京 / 美西）。
 *
 * 纯逻辑，不连 DSH / QQ。运行：node scripts/test-timezone.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  SYSTEM_TIME_ZONE, normalizeTimeZone, configuredTimeZone, withTimeZone, withConfiguredTimeZone,
  applyProcessTimeZone, appliedProcessTimeZone, timeZoneEnv, describeTimeZone, offsetMinutes, offsetLabel,
  formatInTimeZone, _setConfigFileForTest,
} from '../src/timezone.js';
import { localDayKey, localDayStart } from '../src/token-budget.js';
import { localDayStart as guardDayStart } from '../src/token-guard.js';
import { inQuietHours, quietEndAfter, nextDayStartAfter, localDateKey, setClockScope } from '../src/purpose-engine.js';
import { needsDailyDecay } from '../src/memory-card.js';
import { normalizeQqConfig } from '../plugins/surfcore/lib/store.js';

const here = fileURLToPath(import.meta.url);
let failures = 0;
function test(name, run) {
  try { run(); console.log('PASS', name); }
  catch (error) { failures++; console.error('FAIL', name, error.message); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-tz-'));
const cfgFile = path.join(tmp, 'config.json');
_setConfigFileForTest(cfgFile);
delete process.env.SURFCORE_TIMEZONE;
const sysAtStart = process.env.TZ;

// 2026-10-29 16:30:00 UTC = 上海 10-30 00:30 = 东京 10-30 01:30 = 洛杉矶 10-29 09:30
const T = Date.UTC(2026, 9, 29, 16, 30, 0);
const hourNow = () => new Date(T).getHours();
const systemHour = hourNow();

test('校验：IANA 名 / 大小写规范 / 空 = 系统', () => {
  assert.deepEqual(normalizeTimeZone('Asia/Shanghai'), { ok: true, zone: 'Asia/Shanghai' });
  assert.equal(normalizeTimeZone('asia/shanghai').zone, 'Asia/Shanghai');
  assert.deepEqual(normalizeTimeZone(''), { ok: true, zone: '' });
  assert.deepEqual(normalizeTimeZone('   '), { ok: true, zone: '' });
  assert.deepEqual(normalizeTimeZone(null), { ok: true, zone: '' });
  assert.equal(normalizeTimeZone('UTC').ok, true);
});

test('校验：UTC+8 / GMT-5 整点偏移（POSIX 符号翻转后与直觉一致）', () => {
  const plus8 = normalizeTimeZone('UTC+8');
  assert.equal(plus8.zone, 'Etc/GMT-8');
  assert.equal(offsetMinutes(T, plus8.zone), 480);
  assert.equal(offsetMinutes(T, normalizeTimeZone('GMT-5').zone), -300);
  assert.equal(offsetMinutes(T, normalizeTimeZone('utc+08:00').zone), 480);
  assert.equal(normalizeTimeZone('UTC+0').zone, 'UTC');
});

test('校验失败：给出 error 和可行动的 hint', () => {
  for (const bad of ['Mars/Olympus', 'UTC+15', 'UTC+5:30', '东八区', 'Asia/Shanghai; rm -rf']) {
    const r = normalizeTimeZone(bad);
    assert.equal(r.ok, false, bad);
    assert.ok(r.error && r.hint, `${bad} 缺 error/hint`);
  }
  assert.match(normalizeTimeZone('UTC+5:30').hint, /Asia\/Kolkata/);
});

test('withTimeZone：切换、还原、可嵌套、抛错也还原', () => {
  const inTokyo = withTimeZone('Asia/Tokyo', hourNow);
  assert.equal(inTokyo, 1);
  assert.equal(hourNow(), systemHour, '还原后必须回到系统时区');
  assert.equal(process.env.TZ, sysAtStart, '环境变量要和原来一样');
  const nested = withTimeZone('Asia/Tokyo', () => [hourNow(), withTimeZone('America/New_York', hourNow), hourNow()]);
  assert.deepEqual(nested, [1, 12, 1]);
  assert.equal(hourNow(), systemHour);
  assert.throws(() => withTimeZone('Asia/Tokyo', () => { throw new Error('boom'); }), /boom/);
  assert.equal(hourNow(), systemHour, '抛错后也要还原');
  assert.equal(withTimeZone('', hourNow), systemHour);
});

test('withTimeZone：夏令时按目标时区算（纽约 3/8 日春季跳时）', () => {
  const diff = withTimeZone('America/New_York', () => (new Date(2026, 2, 9, 0, 0).getTime() - new Date(2026, 2, 8, 0, 0).getTime()) / 3600000);
  assert.equal(diff, 23);
});

test('configuredTimeZone：未配置 = 系统（旧行为）', () => {
  const r = configuredTimeZone();
  assert.equal(r.zone, '');
  assert.equal(r.source, 'system');
  assert.equal(withConfiguredTimeZone(hourNow), systemHour);
  assert.deepEqual(timeZoneEnv(), {});
});

test('configuredTimeZone：config.json 的 timezone 生效（含 BOM、UTC+8 写法）', () => {
  fs.writeFileSync(cfgFile, JSON.stringify({ timezone: 'Asia/Tokyo' }));
  _setConfigFileForTest(cfgFile);
  assert.equal(configuredTimeZone().zone, 'Asia/Tokyo');
  assert.equal(configuredTimeZone().source, 'config');
  assert.equal(withConfiguredTimeZone(hourNow), 1);
  assert.deepEqual(timeZoneEnv(), { TZ: 'Asia/Tokyo' });
  fs.writeFileSync(cfgFile, String.fromCharCode(0xFEFF) + JSON.stringify({ timezone: 'UTC+8' }));
  _setConfigFileForTest(cfgFile);
  assert.equal(configuredTimeZone().zone, 'Etc/GMT-8');
});

test('configuredTimeZone：环境变量优先；非法值回退系统并带 error（不抛）', () => {
  process.env.SURFCORE_TIMEZONE = 'America/New_York';
  assert.equal(configuredTimeZone().zone, 'America/New_York');
  assert.equal(configuredTimeZone().source, 'env');
  process.env.SURFCORE_TIMEZONE = 'Nowhere/Land';
  const bad = configuredTimeZone();
  assert.equal(bad.zone, '');
  assert.match(bad.error, /Nowhere\/Land/);
  assert.equal(withConfiguredTimeZone(hourNow), systemHour, '非法配置不能把时间算歪');
  delete process.env.SURFCORE_TIMEZONE;
  fs.writeFileSync(cfgFile, '{ not json');
  _setConfigFileForTest(cfgFile);
  assert.equal(configuredTimeZone().zone, '', '配置文件损坏也不能崩');
});

test('共享模块（宿主进程里）：每日额度换天按配置时区', () => {
  process.env.SURFCORE_TIMEZONE = 'Asia/Shanghai';
  assert.equal(localDayKey(T), '2026-10-30');
  assert.equal(formatInTimeZone(localDayStart(T), 'Asia/Shanghai'), '2026-10-30 00:00:00');
  assert.equal(formatInTimeZone(guardDayStart(T), 'Asia/Shanghai'), '2026-10-30 00:00:00');
  process.env.SURFCORE_TIMEZONE = 'America/Los_Angeles';
  assert.equal(localDayKey(T), '2026-10-29');
  assert.equal(formatInTimeZone(localDayStart(T), 'America/Los_Angeles'), '2026-10-29 00:00:00');
  process.env.SURFCORE_TIMEZONE = 'UTC';
  assert.equal(localDayKey(T), '2026-10-29');
  delete process.env.SURFCORE_TIMEZONE;
  assert.equal(hourNow(), systemHour);
});

test('共享模块：目的机制的安静时段 / 安静结束按配置时区（引擎零 import，靠 setClockScope 注入）', () => {
  setClockScope(withConfiguredTimeZone);
  const cfg = { quietStart: '23:30', quietEnd: '08:30' };
  process.env.SURFCORE_TIMEZONE = 'Asia/Shanghai';        // 00:30，在安静时段内
  assert.equal(inQuietHours(T, cfg), true);
  assert.equal(localDateKey(T), '2026-10-30');
  assert.equal(formatInTimeZone(quietEndAfter(T, cfg), 'Asia/Shanghai'), '2026-10-30 08:30:00');
  process.env.SURFCORE_TIMEZONE = 'UTC';                  // 16:30，不在
  assert.equal(inQuietHours(T, cfg), false);
  assert.equal(formatInTimeZone(quietEndAfter(T, cfg), 'UTC'), '2026-10-30 08:30:00');
  assert.equal(formatInTimeZone(nextDayStartAfter(T, { quietStart: '08:00', quietEnd: '08:00' }), 'UTC'), '2026-10-30 00:05:00');
  delete process.env.SURFCORE_TIMEZONE;
  assert.equal(hourNow(), systemHour);
});

test('共享模块：记忆卡每日衰减的触发小时按配置时区', () => {
  const card = { lastDecayDate: '1999-01-01' };
  process.env.SURFCORE_TIMEZONE = 'Asia/Shanghai';        // 00:30 → 还没到 04 点
  assert.equal(needsDailyDecay(card, { dailyHour: 4 }, T), false);
  process.env.SURFCORE_TIMEZONE = 'UTC';                  // 16:30 → 过了
  assert.equal(needsDailyDecay(card, { dailyHour: 4 }, T), true);
  delete process.env.SURFCORE_TIMEZONE;
});

test('进程层：applyProcessTimeZone 后普通 Date 就是配置时区；热切换；清空回系统', () => {
  fs.writeFileSync(cfgFile, JSON.stringify({ timezone: 'Asia/Tokyo' }));
  _setConfigFileForTest(cfgFile);
  const r = applyProcessTimeZone();
  assert.equal(r.zone, 'Asia/Tokyo');
  assert.equal(r.changed, true);
  assert.equal(appliedProcessTimeZone(), 'Asia/Tokyo');
  assert.equal(hourNow(), 1, '常驻后不用 wrapper 也对');
  assert.equal(withConfiguredTimeZone(hourNow), 1);
  assert.equal(applyProcessTimeZone().changed, false, '没变化不重复设');
  fs.writeFileSync(cfgFile, JSON.stringify({ timezone: 'America/New_York' }));
  _setConfigFileForTest(cfgFile);
  assert.equal(applyProcessTimeZone().changed, true);
  assert.equal(hourNow(), 12, '热切换');
  fs.writeFileSync(cfgFile, JSON.stringify({ timezone: '' }));
  _setConfigFileForTest(cfgFile);
  assert.equal(applyProcessTimeZone().changed, true);
  assert.equal(appliedProcessTimeZone(), '');
  assert.equal(hourNow(), systemHour, '清空后回到系统时区');
  assert.equal(process.env.TZ, sysAtStart);
});

test('describeTimeZone：设置页要展示的系统/生效时区与此刻时间', () => {
  process.env.SURFCORE_TIMEZONE = 'Asia/Kolkata';
  const d = describeTimeZone(T);
  assert.ok(['Asia/Kolkata', 'Asia/Calcutta'].includes(d.configured), d.configured);   // ICU 版本不同，规范名可能是旧别名
  assert.equal(d.source, 'env');
  assert.equal(d.effective.offset, 'UTC+05:30');
  assert.equal(d.effective.now, '2026-10-29 22:00:00');
  assert.equal(d.system.zone, SYSTEM_TIME_ZONE);
  delete process.env.SURFCORE_TIMEZONE;
  assert.equal(describeTimeZone(T).effective.zone, SYSTEM_TIME_ZONE);
  assert.equal(offsetLabel(-210), 'UTC-03:30');
  assert.equal(offsetMinutes(Date.UTC(2026, 0, 15), 'America/New_York'), -300);
  assert.equal(offsetMinutes(Date.UTC(2026, 6, 15), 'America/New_York'), -240);
});

test('保存配置：normalizeQqConfig 规范化 timezone，非法值落成空串（入口已 400，这里是兜底）', () => {
  assert.equal(normalizeQqConfig({ timezone: 'asia/shanghai' }).timezone, 'Asia/Shanghai');
  assert.equal(normalizeQqConfig({ timezone: 'UTC+8' }).timezone, 'Etc/GMT-8');
  assert.equal(normalizeQqConfig({}).timezone, '');
  assert.equal(normalizeQqConfig({ timezone: 'nope' }).timezone, '');
});

// ── 在不同的「系统时区」下整套再跑一遍（动机场景：服务器是 UTC / 美西 / 东京）──
if (!process.env.SURFCORE_TZ_TEST_CHILD) {
  for (const sys of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles']) {
    test(`系统时区为 ${sys} 时同样通过`, () => {
      const r = spawnSync(process.execPath, [here], {
        env: { ...process.env, TZ: sys, SURFCORE_TZ_TEST_CHILD: '1' }, encoding: 'utf8',
      });
      assert.equal(r.status, 0, `${sys} 子进程失败：\n${r.stdout}\n${r.stderr}`.slice(0, 1500));
    });
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
if (failures) {
  console.error(`\n${failures} 项失败`);
  process.exit(1);
}
console.log('\n全部通过');
