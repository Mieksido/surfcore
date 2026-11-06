// Embedding 包接线：核心/插件/API/UI/运行时存在，且安装清单不含权重。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('核心包逻辑：manifest/校验/安装/卸载导出齐全', () => {
  const core = read('src/embedding-packs.js');
  for (const name of ['validatePackManifest', 'verifyPackFiles', 'installPackFromDirectory', 'uninstallPack', 'listEmbeddingPacks', 'resolveInstalledPack', 'safePackRelativePath']) {
    assert.match(core, new RegExp(`export (async )?function ${name}\\(`), `缺少 ${name}`);
  }
  assert.match(core, /pack\.file-verify-failed/);
  assert.match(core, /pack\.exists/);
  assert.match(core, /quarantine/i);
});

test('插件/API/UI：安装包路由、启动停止、云端配置、未安装态', () => {
  const index = read('plugins/surfcore/lib/index.js');
  assert.match(index, /from '\.\/embedding-packs\.js'/);
  assert.match(index, /pathname === `\$\{API_PREFIX\}\/embedding-packs`/);
  assert.match(index, /startEmbeddingPackInstall/);
  assert.match(index, /startEmbeddingRuntime/);
  assert.match(index, /saveCloudPackConfig/);
  assert.match(index, /action === 'open-share'/);
  const client = read('plugins/surfcore/lib/client.js');
  assert.match(client, /function EmbeddingPackPanel/);
  assert.match(client, /Embedding 功能（可选安装）/);
  assert.match(client, /获取网盘资源（语音、向量记忆模型）/);
  assert.match(client, /向量记忆使用说明（人话版）/);
  assert.match(client, /导入文件：/);
  assert.match(client, /下载并安装/);
  assert.match(client, /云端模型/);
  assert.match(client, /CLOUD_PROVIDERS/);
  assert.match(client, /keyOnce/);
  assert.match(client, /只显示一次/);
  assert.match(client, /usageTab === "local"/);
  assert.match(client, /usageCloudProvider/);
  assert.match(client, /配置步骤/);
  assert.match(client, /bge-m3@1024-cloud-v1/);
  assert.match(client, /允许远程 provider/);
  assert.match(client, /一键启动 runtime \+ 选中模型/);
  assert.match(client, /一键启动 runtime \+ 云端/);
  assert.match(client, /packTab === "local"/);
  assert.match(client, /name: "embedding-local-model"/);
  assert.match(client, /bge-small-zh-v1.5\.zip/);
  assert.match(client, /browseNative\("file", `选择 \$\{file\}`, "embedding-pack"\)/);
  assert.match(index, /filterKey === 'embedding-pack'/);
  const server = read('plugins/surfcore/lib/embedding-packs.js');
  assert.match(server, /installPackFromDirectory/);
  assert.match(server, /startEmbeddingRuntime/);
  assert.match(server, /readCloudPackFile/);
  assert.match(server, /SURFCORE_EMBED_API_KEY/);
});

test('运行时：Node 服务 + run.bat/stop.bat，不依赖 Python', () => {
  const service = read('plugins/surfcore/runtime/embedding-service.mjs');
  const server = read('plugins/surfcore/lib/embedding-packs.js');
  assert.match(service, /\/v1\/embeddings/);
  assert.match(service, /\/health/);
  assert.match(service, /SURFCORE_EMBED_OLLAMA_URL/);
  assert.match(service, /SURFCORE_EMBED_API_KEY/);
  assert.match(service, /writeDiscovery/);
  assert.match(service, /BUNDLED_OLLAMA/);
  assert.match(service, /ensureOllama/);
  assert.match(service, /OLLAMA_MODELS/);
  assert.match(server, /registerModelWithBundledOllama/);
  assert.match(server, /ollamaTagFor/);
  assert.match(server, /'create', tag, '-f'/);
  assert.doesNotMatch(service, /from ['"]surfcore_embedding|python(3)?\.exe|python -m/i);
  assert.ok(fs.existsSync(path.join(root, 'plugins/surfcore/runtime/run.bat')));
  assert.ok(fs.existsSync(path.join(root, 'plugins/surfcore/runtime/stop.bat')));
});

test('安装清单不包含 embedding-packs 权重/运行时', () => {
  const manifest = JSON.parse(read('release/install-manifest.json'));
  const bad = Object.keys(manifest.files ?? {}).filter((file) => file.startsWith('state/embedding-packs/') || file.endsWith('.gguf'));
  assert.deepEqual(bad, []);
});
