// 诊断：从 node 进程用 detached 方式拉起语音引擎脚本，看子进程到底怎么了。
// 只在排障时手动跑：node scripts/diag-engine-start.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const script = 'D:/大肥鱼功能/语音/说话/breeze/bridge/start-voice.ps1';
const logFile = 'D:/大肥鱼功能/语音/说话/breeze/logs/engine-start-probe.log';
const fd = fs.openSync(logFile, 'a');

console.log('spawn', script);
const c = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
  windowsHide: true,
  stdio: ['ignore', fd, fd],
});
c.on('error', (e) => console.log('SPAWN ERROR:', e.code, e.message));
c.on('exit', (code, sig) => console.log('exit code', code, 'signal', sig));
setTimeout(() => {
  console.log('--- 探针等待结束，日志末尾 ---');
  try { console.log(fs.readFileSync(logFile, 'utf8').slice(-2000)); } catch {}
  process.exit(0);
}, 100000);
