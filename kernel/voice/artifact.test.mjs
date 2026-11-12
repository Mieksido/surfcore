/**
 * 语音模型工件 manifest（纯规则）
 * 跑法：node kernel/voice/artifact.test.mjs
 */
import { normalizeModelManifest, verifyModelFiles, safeModelPath, MODEL_ARTIFACT_KIND } from './artifact.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass += 1; console.log('  ✅', n); } else { fail += 1; console.error('  ❌', n); } };
const sha = 'a'.repeat(64);
const raw = {
  kind: MODEL_ARTIFACT_KIND,
  model: 'demo',
  version: '1.0.0',
  voice: { id: 'v1' },
  files: [{ path: 'weights/model.bin', sha256: sha }],
  runtime: { endpoint: 'http://127.0.0.1:8765', path: '/v1/speak/file', bodyTemplate: { text: '{text}', voice: '{voiceId}', format: 'wav' } },
};

console.log('## 归一');
{
  const r = normalizeModelManifest(raw);
  ok(r.ok && r.value.model === 'demo' && r.value.voiceId === 'v1', '合法 manifest');
  ok(r.value.files.length === 1 && r.value.runtime.transport === 'http', 'files/runtime');
  ok(r.value.runtime.path === '/v1/speak/file' && r.value.runtime.bodyTemplate.voice === '{voiceId}', '通用 endpoint/path/body');
  ok(normalizeModelManifest({ ...raw, kind: 'nope' }).ok === false, '拒绝错误 kind');
  ok(normalizeModelManifest({ ...raw, model: '' }).ok === false, '缺 model id');
  ok(normalizeModelManifest({ ...raw, files: [{ path: '../x', sha256: sha }] }).ok === false, '拒绝路径穿越');
}

console.log('\n## runtime schema');
{
  const processRt = normalizeModelManifest({ ...raw, runtime: { kind: 'process', command: 'bin/tts', args: ['--port', '8765'], endpoint: 'http://127.0.0.1:8765' } });
  ok(processRt.ok && processRt.value.runtime.kind === 'process' && processRt.value.runtime.command === 'bin/tts', '进程 runtime 是工件内相对路径');
  ok(normalizeModelManifest({ ...raw, runtime: { kind: 'process', command: 'C:\\evil.exe' } }).ok === false, '拒绝绝对 command');
  ok(normalizeModelManifest({ ...raw, runtime: { kind: 'process', command: '../run.bat' } }).ok === false, '拒绝穿越 command');
}

console.log('\n## 校验');
{
  const m = normalizeModelManifest(raw).value;
  ok(verifyModelFiles(m, { 'weights/model.bin': { sha256: sha } }).ok, '哈希一致');
  ok(verifyModelFiles(m, {}).missing.length === 1, '缺文件');
  ok(verifyModelFiles(m, { 'weights/model.bin': { sha256: 'b'.repeat(64) } }).mismatch.length === 1, '哈希不符');
}

console.log('\n## 路径');
{
  ok(safeModelPath('a/b.bin') === 'a/b.bin', '相对路径');
  ok(safeModelPath('C:\\x') === '', '盘符拒绝');
  ok(safeModelPath('../x') === '', '.. 拒绝');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
