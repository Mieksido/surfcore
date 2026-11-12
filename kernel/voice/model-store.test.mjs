/**
 * 语音模型工件导入（校验/复制；不执行）
 * 跑法：node kernel/voice/model-store.test.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectModelArtifact, importModelArtifact } from './model-store.js';
import { MODEL_ARTIFACT_KIND } from './artifact.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass += 1; console.log('  ✅', n); } else { fail += 1; console.error('  ❌', n); } };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-voice-model-store-'));
const src = path.join(dir, 'src');
fs.mkdirSync(path.join(src, 'weights'), { recursive: true });
const bytes = Buffer.from('weights');
fs.writeFileSync(path.join(src, 'weights', 'model.bin'), bytes);
const sha = crypto.createHash('sha256').update(bytes).digest('hex');
fs.writeFileSync(path.join(src, 'model.json'), JSON.stringify({
  kind: MODEL_ARTIFACT_KIND, model: 'demo', version: '1.0.0',
  voice: { id: 'v1' },
  files: [{ path: 'weights/model.bin', sha256: sha }],
  runtime: { endpoint: 'http://127.0.0.1:8765', path: '/tts', bodyTemplate: { text: '{text}', voice: '{voiceId}' } },
}));

console.log('## 检查');
{
  const r = inspectModelArtifact(src);
  ok(r.ok && r.manifest.model === 'demo' && r.manifest.runtime.transport === 'http', '合法工件');
  ok(!r.ok || !('scripts' in r), '不看扩展脚本');
}

console.log('\n## 导入');
{
  const target = path.join(dir, 'installed');
  const r = importModelArtifact({ dir: src, target });
  ok(r.ok && fs.existsSync(path.join(target, 'weights', 'model.bin')), '复制成功');
  const again = importModelArtifact({ dir: src, target });
  ok(again.ok === false && again.code === 'voice-model.target-exists', '默认拒绝覆盖');
  const forced = importModelArtifact({ dir: src, target, force: true });
  ok(forced.ok, 'force 覆盖');
}

console.log('\n## 坏工件');
{
  const bad = path.join(dir, 'bad');
  fs.mkdirSync(bad);
  ok(inspectModelArtifact(bad).code === 'voice-model.manifest-missing', '缺 manifest');
  fs.writeFileSync(path.join(bad, 'model.json'), '{bad');
  ok(inspectModelArtifact(bad).code === 'voice-model.manifest-bad', '坏 JSON');
}

console.log('\n## 没有 runtime');
{
  const noRuntime = path.join(dir, 'no-runtime');
  fs.mkdirSync(noRuntime);
  fs.writeFileSync(path.join(noRuntime, 'model.json'), JSON.stringify({
    kind: MODEL_ARTIFACT_KIND, model: 'no-runtime', version: '1.0.0', voice: { id: 'v' }, files: [],
  }));
  const r = inspectModelArtifact(noRuntime);
  ok(r.ok === false && r.code === 'voice-model.runtime-required', '必须声明 runtime');
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
