// 新手体检的判定规则（纯函数）：哪项该红、该给什么修复提示、一键配置补什么。
import assert from 'node:assert/strict';
import fs from 'node:fs';
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

// 7) SnowLuma 的「怎么补」必须跟着状态走（2026-10-30 误报）：
//    桥接没在跑时让人去查 SnowLuma token 是错的；OneBot 拒绝时才该指向 bridge.log。
{
  const down = buildInstallChecks({ ...base, snowState: { state: 'bridge-down', hint: '桥接没在跑' } });
  const item = down.find((c) => c.name === 'SnowLuma 在线');
  assert.equal(item.level, 'warn');
  assert.ok(item.fix.includes('QQ 桥接'), 'bridge-down 时应先让人启动桥接');
  assert.ok(!/SnowLuma token|accessToken/.test(item.fix), 'bridge-down 时不要甩锅给 token');

  const rejected = buildInstallChecks({ ...base, snowState: { state: 'onebot-rejected', hint: '端口在听' } });
  assert.ok(rejected.find((c) => c.name === 'SnowLuma 在线').fix.includes('bridge.log'));
  const unknown = buildInstallChecks({ ...base, snowState: { state: 'offline' } });
  assert.ok(unknown.find((c) => c.name === 'SnowLuma 在线').fix.includes('SnowLuma'));
}

// 8) 今日唤醒额度用完 → warn，并指出去哪调高（2026-10-30「私聊不回我」）
{
  const checks = buildInstallChecks({
    ...base,
    wakeGuard: { conversations: [{ key: 'private:1000000001', dayCount: 10, maxDay: 10, blocked: true }] },
  });
  const item = checks.find((c) => c.name === '唤醒额度');
  assert.equal(item.level, 'warn');
  assert.ok(item.detail.includes('10/10'), '要显示实际次数');
  assert.ok(item.fix.includes('私聊每天最多醒'), '要告诉用户改哪个参数');
  assert.equal(installOk(checks), true, '额度用完是 warn，不该把体检判成不通过');

  const healthy = buildInstallChecks({
    ...base,
    wakeGuard: { conversations: [{ key: 'private:1000000001', dayCount: 2, maxDay: 10, blocked: false }] },
  });
  assert.equal(healthy.find((c) => c.name === '唤醒额度').level, 'ok');
  // 没有桥接快照（桥接没跑）时不显示这一项，避免误报
  assert.equal(buildInstallChecks(base).some((c) => c.name === '唤醒额度'), false);
}

// 9) 接线：体检必须用桥接状态判断 SnowLuma（以前传的是配置对象 → 永远 onebot-rejected）
{
  const src = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8');
  assert.ok(src.includes('diagnoseSnowLuma(bridge?.snowluma'), '体检又拿配置对象当桥接状态了');
  assert.ok(src.includes('wakeGuard: bridge?.wakeGuard'), '体检没有把唤醒额度带进检查项');
}

console.log('✅ 新手体检判定通过');
