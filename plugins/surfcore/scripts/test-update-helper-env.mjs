// 更新助手（apply-update.mjs）的启动方式与"启动标记"：
// 插件在 DSH（Electron）里跑，process.execPath 是宿主可执行文件；不带 ELECTRON_RUN_AS_NODE
// 直接 spawn .mjs 会静默退出（exit 0），更新永远不落地 —— 2026-10-28 用户反馈的核心原因。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { helperSpawnEnv } from '../lib/updates.js';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-update-helper-'));
let failures = 0;
const ok = (cond, label, extra = '') => {
  if (cond) console.log(`✅ ${label}`);
  else { failures += 1; console.error(`❌ ${label} ${extra}`); }
};

try {
  // 1) 环境变量：Electron 宿主必须带 RUN_AS_NODE；node 本身不需要
  const envElectron = helperSpawnEnv('C:\\DSH\\DeepSeek Harness.exe', {});
  ok(envElectron.ELECTRON_RUN_AS_NODE === '1', 'Electron 宿主 → 带 ELECTRON_RUN_AS_NODE=1');
  const envNode = helperSpawnEnv('C:\\nodejs\\node.exe', {});
  ok(envNode.ELECTRON_RUN_AS_NODE === undefined, 'node.exe → 不额外加环境变量');

  // 2) 助手跑起来会写 .started；成功应用后写目标文件、删 pending 与 started
  const stateDir = path.join(base, 'state');
  const staging = path.join(base, 'staging');
  const target = path.join(base, 'target');
  fs.mkdirSync(staging, { recursive: true });
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(staging, 'package.json'), '{"version":"9.9.9"}');
  fs.writeFileSync(path.join(target, 'config.json'), '{"keep":true}');
  fs.mkdirSync(stateDir, { recursive: true });
  const pendingFile = path.join(stateDir, 'updates-pending.json');
  fs.writeFileSync(pendingFile, JSON.stringify({
    kind: 'zip', component: 'surfcore', target, staging, to: '9.9.9', waitPid: 999999,
    logFile: path.join(stateDir, 'apply.log'),
  }, null, 2));

  execFileSync(process.execPath, [path.resolve('../../scripts/apply-update.mjs'), '--pending', pendingFile], { stdio: 'ignore' });

  ok(fs.existsSync(path.join(target, 'package.json')), '助手真的执行了（目标目录有 package.json）');
  ok(fs.readFileSync(path.join(target, 'config.json'), 'utf8').includes('keep'), '用户的 config.json 被保留');
  ok(!fs.existsSync(pendingFile), '成功后 pending 被删除');
  ok(!fs.existsSync(`${pendingFile}.started`), '成功后 .started 被清理');

  // 3) 失败要留证据：staging 不存在 → .failed，pending 保留，便于下次重试
  const badPending = path.join(stateDir, 'updates-pending.json');
  fs.writeFileSync(badPending, JSON.stringify({
    kind: 'zip', component: 'surfcore', target, staging: path.join(base, 'nope'), to: '9.9.9', waitPid: 999999,
    logFile: path.join(stateDir, 'apply2.log'),
  }, null, 2));
  let exitCode = 0;
  try {
    execFileSync(process.execPath, [path.resolve('../../scripts/apply-update.mjs'), '--pending', badPending], { stdio: 'ignore' });
  } catch (error) { exitCode = error.status ?? 1; }
  ok(exitCode !== 0, 'staging 缺失时助手以非 0 退出');
  ok(fs.existsSync(`${badPending}.failed`), '失败留下 .failed 证据');
  // 2026-11-01 起：失败 = 本次尝试结束，删 pending、只留 .failed（避免下次启动重试坏包/永远显示旧失败）
  ok(!fs.existsSync(badPending), '失败后删除 pending（.failed 是唯一真相）');
  ok(!fs.existsSync(`${badPending}.started`), '失败后清理 .started');
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}

if (failures) { console.error(`\n${failures} 项失败`); process.exit(1); }
console.log('\n✅ test-update-helper-env 通过');
