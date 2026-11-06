// 向量记忆接线契约（源码级）：桥接只读、插件单写、模式二选一、存储独立。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('桥接：读 mode / 检索块 / 只在 vector 模式注入，不写向量文件', () => {
  const bridge = read('src/bridge.js');
  assert.match(bridge, /import\s*\{[\s\S]*?embedTexts[\s\S]*?\}\s*from '\.\/vector-memory\.js'/);
  assert.match(bridge, /function memoryMode\(\)/);
  assert.match(bridge, /async function vectorRecallBlockForWake\(key\)/);
  assert.match(bridge, /const memoryCardText = memoryMode\(\) === 'vector' \? String\(vectorBlock \|\| ''\)\.trim\(\) : memoryCardPromptBlock\(key\);/);
  assert.match(bridge, /await vectorRecallBlockForWake\(key\)/);
  assert.match(bridge, /function vectorEntryVisibleForKey\(key, entry\)/);
  assert.match(bridge, /entryFilter: \(entry\) => vectorEntryVisibleForKey\(key, entry\)/);
  assert.match(bridge, /buildWakePromptV2\(key, opts\.wakeReason, vectorBlock\)/);
  assert.match(bridge, /memoryCard: memoryMode\(\) === 'vector' \? '' : memoryCardPromptBlock\(key\)/);
  assert.match(bridge, /memoryHint: memoryMode\(\) === 'vector'/);
  assert.doesNotMatch(bridge, /appendFileSync\([^)]*vector-memory/);
  assert.doesNotMatch(bridge, /writeVectorIndex\(/);
});

test('插件：独立维护器启动/状态/API，且不 import 记忆卡写函数', () => {
  const index = read('plugins/surfcore/lib/index.js');
  assert.match(index, /startVectorMemoryTimer\(\{ log: pluginLog \}\)/);
  assert.match(index, /vectorMemory: vectorMemoryStatusNow\(\)/);
  assert.match(index, /\/vector-memory/);
  assert.match(index, /runVectorMemoryMaintenanceNow/);
  assert.match(index, /await vectorMemoryIdle\(\)/);
  assert.match(index, /rebuild-all/);
  assert.match(index, /rebuild-selected/);
  assert.match(index, /registerAllInstalledModels/);
  assert.match(index, /missingIndexes/);
  const client = read('plugins/surfcore/lib/client.js');
  assert.match(client, /为多个模型重建索引/);
  assert.match(client, /已有索引/);
  assert.match(client, /indexPickerOpen/);
  assert.match(client, /cloud:\$\{provider\.id\}/);

  const maintainer = read('plugins/surfcore/lib/vector-memory.js');
  assert.match(maintainer, /activeMemoryPaths\(\)/);
  assert.match(maintainer, /recordTextHash/);
  assert.match(maintainer, /writeVectorIndex\(paths/);
  assert.match(maintainer, /vector-memory\.jsonl/);
  assert.match(maintainer, /rebuildAllVectorIndexes/);
  assert.match(maintainer, /item\.indexReady !== true/);
  assert.match(maintainer, /skippedModels/);
  assert.match(maintainer, /pending > 0 \? 30_000/);
  assert.doesNotMatch(maintainer, /from '\.\/memory-card\.js'/);
  assert.doesNotMatch(maintainer, /maintainMemoryCard|saveMemoryCardOutputs|addMemoryRecord/);
});

test('配置：memory.mode 默认 narrative，vectorMemory 独立默认开', () => {
  const store = read('plugins/surfcore/lib/store.js');
  assert.match(store, /mode: 'narrative'/);
  assert.match(store, /vectorMemory: \{ \.\.\.DEFAULT_VECTOR_MEMORY_CONFIG, packLinks: \{ \.\.\.DEFAULT_VECTOR_MEMORY_CONFIG\.packLinks \} \}/);
  assert.match(store, /normalizeVectorMemoryConfig\(next\.vectorMemory\)/);
  assert.match(store, /next\.memory\.mode = next\.memory\.mode === 'vector' \? 'vector' : 'narrative'/);
});

test('B站：vector 模式注入检索块，narrative 才注入记忆卡', () => {
  const scheduler = read('plugins/surfcore/lib/scheduler.js');
  assert.match(scheduler, /vectorRecallBlockForBili/);
  assert.match(scheduler, /platform: 'bili'/);
  assert.match(scheduler, /if \(unified\.memory\?\.mode === 'vector'\) return ''/);
  assert.match(scheduler, /content: \[\{ type: 'text', text: block \}, \.\.\.args\.content\]/);
});

test('桌宠：只要任意一套存储开着，就继续写共享 inbox', () => {
  const pet = read('plugins/surfcore/lib/pet-chat.js');
  assert.match(pet, /cardEnabled/);
  assert.match(pet, /vectorEnabled/);
  assert.match(pet, /if \(!cardEnabled && !vectorEnabled\) return 0;/);
  assert.doesNotMatch(pet, /memoryCard\?\.enabled === false\) return 0/);
});

test('核心：检索排除 sensitive、bili 平台过滤、渲染有硬上限', () => {
  const core = read('src/vector-memory.js');
  assert.match(core, /if \(entry\.sensitive\) continue;/);
  assert.match(core, /platform === 'bili' && entry\.scope !== 'bili' && entry\.scope !== 'shared'/);
  assert.match(core, /maxChars/);
  assert.match(core, /vector\.service-missing/);
  assert.match(core, /vector\.model-space-mismatch/);
});

test('记忆库：只读列表/语义搜索接线，不写记录/索引', () => {
  const index = read('plugins/surfcore/lib/index.js');
  assert.match(index, /library-list/);
  assert.match(index, /library-search/);
  assert.match(index, /listVectorMemoryRecords/);
  assert.match(index, /searchVectorMemoryRecords/);

  const maintainer = read('plugins/surfcore/lib/vector-memory.js');
  assert.match(maintainer, /export function listVectorMemoryRecords/);
  assert.match(maintainer, /export async function searchVectorMemoryRecords/);
  assert.match(maintainer, /record\.sensitive !== true/);
  assert.match(maintainer, /platform: 'all'/);
  assert.match(maintainer, /vector\.index-missing/);

  const client = read('plugins/surfcore/lib/client.js');
  assert.match(client, /library-list/);
  assert.match(client, /library-search/);
  assert.match(client, /记忆库/);
  assert.match(client, /语义搜索/);
  assert.match(client, /相似度/);
});
