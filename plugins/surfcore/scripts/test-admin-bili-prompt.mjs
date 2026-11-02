/**
 * B站 侧管理员提示词的接线回归（临时 DSH_HOME，不碰真实配置）。
 *
 * 为什么要单独测：B站 的提示词由 scheduler.js 每次醒来/评论/私信/直播时生成，
 * 宿主重启才会换代码；规则里还多一条硬要求——**B站 提示词不能出现管理员的 QQ 号**。
 *
 * 运行：node scripts/test-admin-bili-prompt.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDsh = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-bili-admin-'));
const stateDir = path.join(tempDsh, 'surfcore');
fs.mkdirSync(stateDir, { recursive: true });
const biliConfigFile = path.join(stateDir, 'bili.config.json');
const unifiedFile = path.join(stateDir, 'config.json');
fs.writeFileSync(biliConfigFile, JSON.stringify({
  owner: { mid: '20002', name: '测试B站昵称' },
  self: { mid: '20003', name: '测试B站账号' },
}));
// 合体层故意不写 admin：验证「升级后从 bili.config.json owner.mid 推导」。
fs.writeFileSync(unifiedFile, JSON.stringify({ version: 1 }));

process.env.DSH_HOME = tempDsh;
process.env.USERPROFILE = tempDsh;
process.env.SURFCORE_BILI_CONFIG = biliConfigFile;

const { adminBlockForBili } = await import('../lib/scheduler.js');

try {
  // 1) 升级兼容 + 新默认：合体层没有 admin 时不再默认注入温柔规则。
  const legacyOff = adminBlockForBili();
  assert.equal(legacyOff, '', '缺省必须关闭温柔模式，不注入管理员块');
  fs.writeFileSync(unifiedFile, JSON.stringify({
    version: 1,
    admin: { qq: '10001', biliMid: '20002', biliName: '测试B站昵称', displayName: '主人', gentle: true },
  }));
  const block = adminBlockForBili();
  assert.ok(block.includes('20002'), 'B站 提示词必须认出主人 mid');
  assert.ok(block.includes('测试B站昵称'), 'B站 提示词必须认出主人昵称');
  assert.ok(block.includes('绝不回嘴'), 'B站 回复主人必须注入「绝不回嘴」');
  assert.ok(block.includes('温柔'), 'B站 回复主人必须注入温柔语气');
  assert.ok(!block.includes('10001'), 'B站 提示词不得出现管理员的 QQ 号');

  // 2) 合体层写了 admin（含 QQ 号）后，仍然不能把 QQ 号带进 B站。
  fs.writeFileSync(unifiedFile, JSON.stringify({
    version: 1,
    admin: { qq: '10001', biliMid: '20002', biliName: '测试B站昵称', displayName: '主人', gentle: true },
  }));
  const withAdmin = adminBlockForBili();
  assert.ok(withAdmin.includes('主人'), 'B站 提示词要用管理员称呼');
  assert.ok(withAdmin.includes('20002'));
  assert.ok(!withAdmin.includes('10001'), '合体层 admin 有 QQ 号也不能泄漏到 B站');

  // 3) 关掉温柔模式：只留身份，不再注入语气规则。
  fs.writeFileSync(unifiedFile, JSON.stringify({
    version: 1,
    admin: { qq: '10001', biliMid: '20002', biliName: '测试B站昵称', displayName: '主人', gentle: false },
  }));
  const mild = adminBlockForBili();
  assert.equal(mild, '', '关掉后不再注入任何管理员专属提示词');

  // 4) 完全没配置：返回空串，不能凭空造规则。
  fs.writeFileSync(biliConfigFile, JSON.stringify({ owner: { mid: '', name: '' } }));
  fs.writeFileSync(unifiedFile, JSON.stringify({ version: 1 }));
  assert.equal(adminBlockForBili(), '', '未配置主人时不得注入');

  console.log('admin bili prompt tests OK');
} finally {
  try { fs.rmSync(tempDsh, { recursive: true, force: true }); } catch {}
}
