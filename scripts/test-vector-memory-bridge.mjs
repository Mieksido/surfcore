// 桥接注入路径：vector 模式只注入检索块，narrative 模式只注入记忆卡。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bridgeHarness } from './audit-bridge-harness.mjs';

test('memory.mode=vector：注入检索块，不读记忆卡文件', async () => {
  const harness = await bridgeHarness({
    config: { memory: { mode: 'vector' } },
    files: {
      'dsh/surfcore/config.json': { memory: { mode: 'vector' } },
      'dsh/surfcore/memory/memory-card-prompt-qq.md': '【记忆卡】\n叙事旧事',
    },
  });
  try {
    const prompt = harness.buildWakePromptV2('private:123', 'timeout', '【想起的旧事】\n· 向量旧事');
    assert.match(prompt, /【想起的旧事】/);
    assert.match(prompt, /向量旧事/);
  } finally {
    await harness.close();
  }
});

test('memory.mode=narrative：注入记忆卡，忽略检索块', async () => {
  const harness = await bridgeHarness({
    config: { memory: { mode: 'narrative' } },
    files: {
      'dsh/surfcore/config.json': { memory: { mode: 'narrative' } },
      'dsh/surfcore/memory/memory-card-prompt-qq.md': '【记忆卡】\n叙事旧事',
    },
  });
  try {
    const prompt = harness.buildWakePromptV2('private:123', 'timeout', '【想起的旧事】\n· 向量旧事');
    assert.match(prompt, /【记忆卡】/);
    assert.doesNotMatch(prompt, /向量旧事/);
  } finally {
    await harness.close();
  }
});
