/**
 * 语音模型公共面：只暴露 model 语义，不暴露 dir/port/start/stop
 * 跑法：node kernel/voice/models.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createVoiceModels } from './models.js';
import { normalizeModelRecord, readModelConfig, writeModelConfig } from './model-runtime.js';
import { createHash } from 'node:crypto';
import { MODEL_ARTIFACT_KIND } from './artifact.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass += 1; console.log('  ✅', n); } else { fail += 1; console.error('  ❌', n); } };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-voice-models-'));
const configFile = path.join(dir, 'models.json');
const providersFile = path.join(dir, 'providers.json');

const model = normalizeModelRecord({
  id: 'local', kind: 'local', voiceId: 'v1', label: '本地音色', artifactDir: dir,
  runtime: { endpoint: 'http://127.0.0.1:1' },
}).value;
writeModelConfig({ file: configFile, config: { active: 'local', models: { local: model } } });

const models = createVoiceModels({ configFile, providersFile });
console.log('## 公共面');
{
  const list = models.list();
  ok(list.ok && list.models.length === 1, '列出模型');
  const m = list.models[0];
  ok(m.modelId === 'local' && m.kind === 'local' && m.voiceId === 'v1', '模型字段');
  ok(!('dir' in m) && !('port' in m) && !('start' in m) && !('stop' in m), '不暴露 dir/port/start/stop');
  ok(m.state === 'idle', '模型状态');
}

console.log('\n## 导入不接受 API 的 runtime.command');
{
  const src = path.join(dir, 'src');
  const target = path.join(dir, 'target');
  fs.mkdirSync(path.join(src, 'weights'), { recursive: true });
  fs.mkdirSync(path.join(src, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(src, 'bin', 'tts'), 'x');
  const bytes = Buffer.from('weights');
  fs.writeFileSync(path.join(src, 'weights', 'model.bin'), bytes);
  const sha = createHash('sha256').update(bytes).digest('hex');
  const binSha = createHash('sha256').update('x').digest('hex');
  fs.writeFileSync(path.join(src, 'model.json'), JSON.stringify({
    kind: MODEL_ARTIFACT_KIND, model: 'imported', version: '1.0.0',
    voice: { id: 'v2' },
    files: [
      { path: 'weights/model.bin', sha256: sha },
      { path: 'bin/tts', sha256: binSha },
    ],
    runtime: { kind: 'process', command: 'bin/tts', endpoint: 'http://127.0.0.1:8765', transport: 'http' },
  }));
  const r = await models.importModel({ sourceDir: src, targetDir: target, model: { id: 'imported', kind: 'local', voiceId: 'v2', runtime: { command: 'C:\\evil.exe' } } });
  ok(r.ok, '导入成功');
  const cfg = readModelConfig(configFile);
  ok(cfg.models.imported.runtime.command === 'bin/tts', 'runtime 只来自工件 manifest，不接受 API 注入');
}

console.log('\n## deleteSource');
{
  const zipSrc = path.join(dir, 'zip-src');
  fs.mkdirSync(path.join(zipSrc, 'weights'), { recursive: true });
  const bytes = Buffer.from('zip-weights');
  fs.writeFileSync(path.join(zipSrc, 'weights', 'model.bin'), bytes);
  const sha = createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(path.join(zipSrc, 'model.json'), JSON.stringify({
    kind: MODEL_ARTIFACT_KIND, model: 'zip-model', version: '1.0.0',
    voice: { id: 'v3' },
    files: [{ path: 'weights/model.bin', sha256: sha }],
    runtime: { kind: 'http', endpoint: 'http://127.0.0.1:8765', transport: 'http' },
  }));
  const tarBin = process.platform === 'win32' ? 'C:\\Windows\\System32\\tar.exe' : 'tar';
  const zip = path.join(dir, 'model.zip');
  const tar = spawnSync(tarBin, ['-a', '-cf', zip, '-C', zipSrc, '.'], { stdio: 'ignore' });
  ok(tar.status === 0 && fs.existsSync(zip), '测试 zip 生成');
  const r = await models.importModel({ sourceDir: zip, targetDir: path.join(dir, 'zip-installed'), deleteSource: true });
  ok(r.ok && r.sourceDeleted === true && !fs.existsSync(zip), '导入成功后删除 zip');
  const zip2 = path.join(dir, 'keep.zip');
  spawnSync(tarBin, ['-a', '-cf', zip2, '-C', zipSrc, '.'], { stdio: 'ignore' });
  const r2 = await models.importModel({ sourceDir: zip2, targetDir: path.join(dir, 'keep-installed'), deleteSource: false });
  ok(r2.ok && !('sourceDeleted' in r2) && fs.existsSync(zip2), '默认不删除 zip');
  const r3 = await models.importModel({ sourceDir: zipSrc, targetDir: path.join(dir, 'dir-installed'), deleteSource: true });
  ok(r3.ok && r3.sourceDeleted === false && typeof r3.sourceDeleteError === 'string', '删除失败不影响导入成功');
}

console.log('\n## relink');
{
  const moved = path.join(dir, 'relocated');
  fs.mkdirSync(path.join(moved, 'weights'), { recursive: true });
  const bytes = Buffer.from('reloc-weights');
  fs.writeFileSync(path.join(moved, 'weights', 'model.bin'), bytes);
  const sha = createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(path.join(moved, 'model.json'), JSON.stringify({
    kind: MODEL_ARTIFACT_KIND, model: 'reloc', version: '1.0.0',
    voice: { id: 'v9' },
    files: [{ path: 'weights/model.bin', sha256: sha }],
    runtime: { kind: 'http', endpoint: 'http://127.0.0.1:9999', transport: 'http' },
  }));
  const cfg = readModelConfig(configFile);
  cfg.models.reloc = normalizeModelRecord({ id: 'reloc', kind: 'local', voiceId: 'v9', artifactDir: path.join(dir, 'gone') }).value;
  writeModelConfig({ file: configFile, config: cfg });
  const r = models.relink('reloc', moved);
  ok(r.ok && r.artifactDir === moved, 'relink 更新 artifactDir');
  ok(fs.existsSync(moved) && !fs.existsSync(path.join(dir, 'gone')), '不复制不删目录');
  ok(readModelConfig(configFile).models.reloc.runtime.endpoint === 'http://127.0.0.1:9999', 'relink 同时刷新 runtime');
}

console.log('\n## relink 旧包名别名');
{
  const aliasDir = path.join(dir, 'alias');
  fs.mkdirSync(path.join(aliasDir, 'weights'), { recursive: true });
  const bytes = Buffer.from('alias-weights');
  fs.writeFileSync(path.join(aliasDir, 'weights', 'model.bin'), bytes);
  const sha = createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(path.join(aliasDir, 'model.json'), JSON.stringify({
    kind: MODEL_ARTIFACT_KIND, model: 'voice-local', version: '1.0.0',
    voice: { id: 'alias', weights: { main: { path: 'weights/model.bin', sha256: sha } } },
  }));
  const cfg = readModelConfig(configFile);
  cfg.models.local = normalizeModelRecord({ id: 'local', kind: 'local', voiceId: 'alias', artifactDir: path.join(dir, 'gone-local') }).value;
  writeModelConfig({ file: configFile, config: cfg });
  const r = models.relink('local', aliasDir);
  ok(r.ok, 'voice-local 可重定位到卡片 local');
}

console.log('\n## provider');
{
  const r = models.setProvider({ id: 'cloud', kind: 'cloud', endpoint: 'https://api.example/v1', model: 'm', voiceId: 'v' });
  ok(r.ok && r.provider.accessKeyMasked === '', '云端无 Key 未配置');
  const cloudArtifact = path.join(dir, 'cloud-artifact');
  fs.mkdirSync(path.join(cloudArtifact, 'voices', 'age12-cloud'), { recursive: true });
  fs.writeFileSync(path.join(cloudArtifact, 'config.toml'), 'cloud_app_id = ""\ncloud_access_key = ""\ncloud_resource = "old"\n', 'utf8');
  fs.writeFileSync(path.join(cloudArtifact, 'voices', 'age12-cloud', 'voice.json'), JSON.stringify({ engine: 'cloud', speaker: '' }), 'utf8');
  const cfg2 = readModelConfig(configFile);
  cfg2.models.cloud = normalizeModelRecord({ id: 'cloud', kind: 'cloud', voiceId: 'age12-cloud', artifactDir: cloudArtifact, runtime: { endpoint: 'http://127.0.0.1:8767' } }).value;
  writeModelConfig({ file: configFile, config: cfg2 });
  const withKey = models.setProvider({ id: 'cloud', kind: 'cloud', endpoint: 'http://127.0.0.1:8767', appId: 'app', accessKey: 'secret', speaker: 'S_x' });
  ok(withKey.ok && withKey.applied && withKey.provider.hasAccessKey && withKey.provider.configured && !JSON.stringify(withKey).includes('secret'), '三项配置完整、写模型且 Key 不回显');
  ok(fs.readFileSync(path.join(cloudArtifact, 'config.toml'), 'utf8').includes('cloud_access_key = "secret"'), 'AccessKey 写进 config.toml');
  ok(JSON.parse(fs.readFileSync(path.join(cloudArtifact, 'voices', 'age12-cloud', 'voice.json'), 'utf8')).speaker === 'S_x', 'speaker 写进 voice.json');
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
