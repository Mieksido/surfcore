// 体检 SnowLuma：必须用 bridge.snowluma（运行态），不能用 config.snowluma。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildInstallChecks } from '../plugins/surfcore/lib/doctor.js';

const base = {
  nodeVersion: '24.0.0',
  hasUnified: true,
  unifiedMasked: 'C:\\test\\config.json',
  ownerQQ: '12345',
  groups: ['1'],
  privates: ['2'],
  snow: { httpUrl: 'http://127.0.0.1:3000', wsUrl: 'ws://127.0.0.1:3001' },
  bridgeSrc: true,
  bridgeMasked: 'C:\\repo\\src\\bridge.js',
  profile: 'desktop',
  token: 'x',
};
const row = (state) => buildInstallChecks({ ...base, snowState: { state, hint: 'hint' } })
  .find((item) => item.name === 'SnowLuma 在线');

assert.equal(row('connected').ok, true, '运行态 connected 必须通过');
assert.equal(row('onebot-rejected').level, 'warn', 'rejected 是警告');
assert.equal(row('bridge-not-running').level, 'warn', '桥接未运行不能被当成 rejected');

const index = fs.readFileSync('plugins/surfcore/lib/index.js', 'utf8');
assert.ok(index.includes('diagnoseSnowLuma(runtimeBridge?.snowluma'), '体检必须读 bridge.snowluma');
assert.ok(index.includes("state: 'bridge-not-running'"), '配置对象不能冒充运行态');
assert.ok(index.includes('installChecks(bridge)'), '体检复用已读取的 bridge 状态');
console.log('✅ 体检 SnowLuma 状态源测试通过');
