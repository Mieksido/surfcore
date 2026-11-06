// 插件侧 Embedding 包管理端到端（临时 DSH_HOME，不起真实运行时）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'embedding-pack-plugin-'));
const dsh = path.join(temp, 'dsh');
const stateDir = path.join(dsh, 'surfcore');
fs.mkdirSync(stateDir, { recursive: true });
process.env.DSH_HOME = dsh;

const core = await import('../src/embedding-packs.js');
const packs = await import('../plugins/surfcore/lib/embedding-packs.js?test=plugin');

async function makeSource(id, kind, { files = true } = {}) {
  const dir = path.join(temp, 'sources', id);
  fs.mkdirSync(dir, { recursive: true });
  const list = [];
  if (files) {
    const data = Buffer.from(`model-${id}`);
    fs.writeFileSync(path.join(dir, 'model.gguf'), data);
    list.push({ path: 'model.gguf', sha256: await core.fileSha256(path.join(dir, 'model.gguf')), size: data.length });
  }
  const manifest = {
    schema: 1, id, kind, name: id, version: '1.0.0',
    model: kind === 'model' ? id : '', modelSpace: kind === 'model' ? `${id}@4-test` : '',
    dimension: kind === 'model' ? 4 : 0, license: 'MIT',
    entry: kind === 'runtime' ? 'run.bat' : '',
    files: list,
  };
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify(manifest));
  return dir;
}

async function waitJob(id, ms = 8000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const job = packs.getEmbeddingPackJob(id);
    if (job && job.state !== 'running') return job;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('安装任务超时');
}

try {
  const empty = packs.embeddingPacksStatus();
  assert.equal(empty.ok, true);
  assert.equal(empty.installed, false);
  assert.ok(empty.hint.includes('还没有安装'), empty.hint);

  const modelSource = await makeSource('test-model', 'model');
  const job = packs.startEmbeddingPackInstall({ source: modelSource });
  assert.equal(job.ok, true);
  const done = await waitJob(job.jobId);
  assert.equal(done.state, 'done', JSON.stringify(done));
  assert.equal(done.packId, 'test-model');

  let status = packs.embeddingPacksStatus();
  assert.equal(status.installed, true);
  assert.equal(status.models.length, 1);
  assert.equal(status.packs.find((pack) => pack.id === 'test-model').valid, true);

  const selected = packs.selectEmbeddingPack('test-model');
  assert.equal(selected.ok, true);
  status = packs.embeddingPacksStatus();
  assert.equal(status.selected, 'test-model');
  assert.equal(status.config.model, 'test-model');
  assert.equal(status.config.modelSpace, 'test-model@4-test');

  const cloudSource = await makeSource('cloud', 'cloud', { files: false });
  const cloudJob = packs.startEmbeddingPackInstall({ source: cloudSource });
  assert.equal(cloudJob.ok, true);
  assert.equal((await waitJob(cloudJob.jobId)).state, 'done');
  assert.equal(packs.selectEmbeddingPack('cloud').ok, true);
  assert.equal(packs.embeddingPacksStatus().config.provider, 'cloud');

  const saved = packs.saveCloudPackConfig({
    endpoint: 'https://example.invalid/v1/embeddings', model: 'BAAI/bge-m3',
    modelSpace: 'bge-m3@1024-cloud-v1', apiKey: 'sk-test-secret', allowRemote: true,
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.config.hasKey, true);
  assert.ok(saved.config.keyMasked.includes('****'));
  assert.ok(!JSON.stringify(saved).includes('sk-test-secret'), 'API key 不能回显');
  const zhipu = packs.saveCloudPackConfig({
    provider: 'zhipu', endpoint: 'https://example.invalid/zhipu', model: 'embedding-3',
    modelSpace: 'embedding-3@2048-cloud-v1', apiKey: 'sk-zhipu-secret', allowRemote: true, activate: false,
  });
  assert.equal(zhipu.ok, true);
  assert.equal(zhipu.config.active, 'siliconflow');
  assert.equal(zhipu.config.providers.zhipu.hasKey, true);
  assert.ok(!JSON.stringify(zhipu).includes('sk-zhipu-secret'), '服务商配置不能回显 key');
  const activated = packs.activateCloudProvider('zhipu');
  assert.equal(activated.ok, true);
  assert.equal(activated.config.active, 'zhipu');
  assert.equal(activated.config.modelSpace, 'embedding-3@2048-cloud-v1');
  const statusText = JSON.stringify(packs.embeddingPacksStatus());
  assert.ok(!statusText.includes('sk-test-secret'), '状态接口不能泄露 key');

  assert.equal(packs.removeEmbeddingPack('test-model').ok, true);
  assert.equal(packs.embeddingPacksStatus().models.length, 0);
  console.log('embedding-pack plugin test: pass');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
