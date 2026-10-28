// 新手体检的判定规则（纯函数）：哪项该红、该给什么修复提示、一键配置补什么。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildInstallChecks, installOk, planDoctorFix } from '../lib/doctor.js';

const base = {
  nodeVersion: '24.19.0',
  hasUnified: true,
  unifiedMasked: '~/.dsh/surfcore/config.json',
  ownerQQ: '1000000001',
  groups: ['100000004'],
  privates: ['1000000001'],
  snow: { wsUrl: 'ws://127.0.0.1:3001', httpUrl: 'http://127.0.0.1:3000' },
  snowState: { state: 'connected' },
  bridgeSrc: true,
  bridgeMasked: 'D:/surfcore/src/bridge.js',
  profile: 'web',
  token: 'abc123',
};

// 1) 全配好 → 全绿
{
  const checks = buildInstallChecks(base);
  assert.equal(checks.filter((c) => c.level !== 'ok').length, 0, '全配好时不应有非 ok 项');
  assert.ok(installOk(checks));
}

// 2) 白名单为空 → fail（这是新手最常卡的一步）
{
  const checks = buildInstallChecks({ ...base, groups: [], privates: [] });
  const allow = checks.find((c) => c.name === '白名单');
  assert.equal(allow.level, 'fail');
  assert.ok(allow.fix.includes('白名单'));
  assert.equal(installOk(checks), false);
}

// 3) 白名单只有私聊 → 也算配好了（不该误判）
{
  const checks = buildInstallChecks({ ...base, groups: [], privates: ['1000000001'] });
  assert.equal(checks.find((c) => c.name === '白名单').level, 'ok');
}

// 4) 没装进 DSH → fail，并给出 setup 命令
{
  const checks = buildInstallChecks({ ...base, profile: '' });
  const item = checks.find((c) => c.name === '装进 DSH');
  assert.equal(item.level, 'fail');
  assert.ok(item.fix.includes('setup-dsh.mjs'));
}

// 5) Node 太老 / SnowLuma 离线（warn，不阻塞）
{
  const checks = buildInstallChecks({ ...base, nodeVersion: '20.11.0', snowState: { state: 'offline' } });
  assert.equal(checks.find((c) => c.name === 'Node 版本').level, 'fail');
  assert.equal(checks.find((c) => c.name === 'SnowLuma 在线').level, 'warn');
  assert.equal(installOk(checks), false);
}

// 6) 一键配置：只补缺失项，合法 QQ 才写
{
  assert.deepEqual(planDoctorFix({ hasUnified: true, hasToken: true, ownerQQ: '', currentOwnerQQ: '' }), []);
  assert.deepEqual(planDoctorFix({ hasUnified: false, hasToken: false, ownerQQ: '', currentOwnerQQ: '' }),
    ['生成统一配置 config.json', '生成控制台令牌']);
  assert.deepEqual(planDoctorFix({ hasUnified: true, hasToken: true, ownerQQ: '1000000001', currentOwnerQQ: '' }),
    ['写入管理员 QQ']);
  assert.deepEqual(planDoctorFix({ hasUnified: true, hasToken: true, ownerQQ: 'abc', currentOwnerQQ: '' }), []);
  assert.deepEqual(planDoctorFix({ hasUnified: true, hasToken: true, ownerQQ: '1000000001', currentOwnerQQ: '1000000001' }), []);
}

// 回归守卫：诊断必须拿桥接状态，别再把 config 的 snowluma 段传进去（传错会恒定误报 onebot-rejected）
{
  const block = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8').match(/async function installChecks[\s\S]{0,1600}/)[0];
  assert.ok(/bridgeStatus\(\)/.test(block) && !/diagnoseSnowLuma\(snow\)/.test(block), 'installChecks 应传桥接状态');
}

console.log('✅ 新手体检判定通过');
