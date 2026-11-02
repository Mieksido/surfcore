// 记忆互通圈：默认隔离；同圈互看；每条带来源；私聊永不进群。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addMemoryRecord, createEmptyCard, normalizeMemoryCardConfig,
  renderMemoryCard, resolveMemoryCardPaths, saveMemoryCardOutputs,
} from '../src/memory-card.js';

const CFG = normalizeMemoryCardConfig({
  sharing: { circles: [{ name: '熟人圈', groups: ['111', '222'] }] },
});
const T = Date.parse('2026-11-02T12:00:00+08:00');
const card = createEmptyCard(T);
const add = (input) => addMemoryRecord(card, { createdAt: T, lastSeenAt: T, ...input }, CFG, T);
add({ source: 'qq-group', speaker: '小明', text: 'A群的事', conversationKey: 'group:111', groupId: '111', groupName: 'A群' });
add({ source: 'qq-group', speaker: '小红', text: 'B群的事', conversationKey: 'group:222', groupId: '222', groupName: 'B群' });
add({ source: 'qq-group', speaker: '小刚', text: 'C群的事', conversationKey: 'group:333', groupId: '333', groupName: 'C群' });
add({ source: 'qq-owner', speaker: '主人', text: '私聊的事', conversationKey: 'private:999', private: true });
add({ source: 'manual', speaker: '管理员', text: '手动全局记忆', manual: true });

const render = (key) => renderMemoryCard(card, { config: CFG, platform: 'qq', conversationKey: key, maxChars: 8000 });
const a = render('group:111');
const b = render('group:222');
const c = render('group:333');
const priv = render('private:999');
assert.ok(a.includes('A群的事') && a.includes('B群的事'), '同圈 A 应看到 A/B');
assert.ok(!a.includes('C群的事'), 'A 不应看到圈外 C');
assert.ok(a.includes('群聊·A群 / group:111'), '记忆必须带来源群名+ID');
assert.ok(b.includes('A群的事') && b.includes('B群的事'), '同圈 B 应看到 A/B');
assert.ok(!c.includes('A群的事') && !c.includes('B群的事'), 'C 默认隔离');
assert.ok(c.includes('手动全局记忆'), '手动记忆可全局');
assert.ok(!a.includes('私聊的事'), '私聊记忆永不进群');
assert.ok(!priv.includes('A群的事'), '私聊不看群记忆');
assert.ok(priv.includes('私聊的事') && priv.includes('私聊'), '私聊只看私聊');
assert.ok(!a.includes('来源未知'), '没有未知来源混入');

// 同文本不同群不能被去重合并
const before = card.records.length;
add({ source: 'qq-owner', speaker: '主人', text: '同一句话', conversationKey: 'group:111', groupId: '111', groupName: 'A群' });
add({ source: 'qq-owner', speaker: '主人', text: '同一句话', conversationKey: 'group:222', groupId: '222', groupName: 'B群' });
assert.equal(card.records.length, before + 2, '跨群同文本不能合并');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-sharing-'));
try {
  const paths = resolveMemoryCardPaths(tmp);
  saveMemoryCardOutputs(paths, card, CFG, T);
  const map = JSON.parse(fs.readFileSync(path.join(tmp, 'memory-card-prompt-qq-groups.json'), 'utf8'));
  assert.ok(map.blocks['group:111'].includes('A群的事'));
  assert.ok(!map.blocks['group:111'].includes('私聊的事'));
  assert.ok(map.blocks['private:999'].includes('私聊的事'));
  assert.ok(!map.blocks['private:999'].includes('A群的事'));
  console.log('✅ 记忆互通圈/来源标签测试通过');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const bridgeSource = fs.readFileSync('src/bridge.js', 'utf8');
assert.ok(bridgeSource.includes('conversationIdentityLineV2(key)'), '唤醒 prompt 必须带当前群/私聊身份');
assert.ok(bridgeSource.includes('memoryCardPromptBlock(key)'), '记忆注入必须按当前会话取块');
assert.ok(bridgeSource.includes('MEMORY_CARD_GROUP_PROMPTS'), '桥接必须读按会话记忆块');
assert.ok(bridgeSource.includes("if (currentMode === 'reserved2') return '';"), 'v2 没有按会话块时必须 fail closed');
assert.ok(bridgeSource.includes('groupNameForMemory'), '落库时必须带群名');
