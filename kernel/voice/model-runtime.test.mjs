/**
 * 语音模型运行时（假 spawn/probe；不启真实进程）
 * 跑法：node kernel/voice/model-runtime.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createModelRuntime, normalizeModelRecord, writeModelConfig, selectModel } from './model-runtime.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass += 1; console.log('  ✅', n); } else { fail += 1; console.error('  ❌', n); } };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-voice-model-runtime-'));
const file = path.join(dir, 'models.json');
const model = normalizeModelRecord({
  id: 'local', kind: 'local', voiceId: 'v1', label: '本地',
  artifactDir: dir,
  runtime: { endpoint: 'http://127.0.0.1:1', command: 'python', entry: 'bin/tts', args: ['-m', 'voice'], transport: 'http' },
}).value;
writeModelConfig({ file, config: { active: 'local', models: { local: model } } });

let up = false;
const spawns = [];
const rt = createModelRuntime({
  file,
  probeImpl: async () => up,
  spawnImpl: (cmd, args) => {
    spawns.push([cmd, args]);
    if (path.basename(cmd) === 'python') up = true;
    if (cmd === 'stop') up = false;
    return { kill() { up = false; } };
  },
  now: () => Date.now(),
});

console.log('## 状态');
{
  const st = await rt.status();
  ok(st.ok && st.models[0].modelId === 'local' && st.models[0].state === 'idle', '未装载是 idle');
  ok(!('dir' in st.models[0]) && !('port' in st.models[0]), '不暴露运行时细节');
  ok(st.active === 'local', 'status 返回 active');
}

console.log('\n## 选择');
{
  ok(selectModel({ file, modelId: 'local' }).ok, '选择模型');
  ok(selectModel({ file, modelId: 'nope' }).code === 'voice-model.unknown', '未知模型不能选择');
}

console.log('\n## 装载/卸载');
{
  const l = await rt.load('local');
  ok(l.ok && l.state === 'loaded', '装载成功');
  ok(spawns.length === 1 && path.basename(spawns[0][0]) === 'python', '按中性 command 启动，不是扩展脚本');
  const st = await rt.status();
  ok(st.models[0].state === 'loaded' && st.models[0].available === true, '状态 loaded');
  const u = await rt.unload('local');
  ok(u.ok && u.state === 'idle', '卸载成功');
}

console.log('\n## 错误');
{
  ok((await rt.load('nope')).code === 'voice-model.unknown', '未知模型');
  ok((await rt.synthesize({ modelId: 'nope' })).code === 'voice-model.unknown', '未知模型合成');
  const noRt = normalizeModelRecord({ id: 'x', kind: 'local', runtime: {} }).value;
  writeModelConfig({ file, config: { models: { x: noRt } } });
  ok((await rt.load('x')).code === 'voice-model.no-runtime', '无运行时明确失败');
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
