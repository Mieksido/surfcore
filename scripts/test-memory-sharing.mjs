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
const CFG_ON = normalizeMemoryCardConfig({
  sharing: {
    circles: [{ name: '熟人圈', groups: ['111', '222'] }],
    privateReadsGroups: true,
    privateGroupLimit: 4,
  },
});
const RUNTIME = {
  ownerPrivateKey: 'private:999',
  privateAllowedGroups: ['111', '222'],
  privateDeniedGroups: [],
  allowAllWhenEmpty: false,
};
const T = Date.parse('2026-11-02T12:00:00+08:00');
const card = createEmptyCard(T);
const add = (input) => addMemoryRecord(card, { createdAt: T, lastSeenAt: T, ...input }, CFG, T);
add({ source: 'qq-group', speaker: '小明', text: 'A群的事', conversationKey: 'group:111', groupId: '111', groupName: 'A群' });
add({ source: 'qq-group', speaker: '小红', text: 'B群的事', conversationKey: 'group:222', groupId: '222', groupName: 'B群' });
add({ source: 'qq-group', speaker: '小刚', text: 'C群的事', conversationKey: 'group:333', groupId: '333', groupName: 'C群' });
add({ source: 'qq-owner', speaker: '主人', text: '私聊的事', conversationKey: 'private:999', private: true });
add({ source: 'qq-owner', speaker: '主人', text: '无key的旧私聊', private: true });
add({ source: 'qq-private', speaker: '另一个人', text: '另一个人的私聊', conversationKey: 'private:888', private: true });
add({ source: 'pet-self', speaker: '她', text: '桌宠的事', conversationKey: 'pet', scope: 'pet', platform: 'pet' });
add({ source: 'manual', speaker: '管理员', text: '手动全局记忆', manual: true });

const render = (key, cfg = CFG, runtime = RUNTIME) => renderMemoryCard(card, {
  config: cfg, platform: 'qq', conversationKey: key, maxChars: 8000, runtimeSharing: runtime,
});
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
assert.ok(!a.includes('私聊的事') && !a.includes('另一个人的私聊'), '私聊记忆永不进群');
assert.ok(!priv.includes('A群的事'), '私聊默认不看群记忆');
assert.ok(priv.includes('私聊的事') && priv.includes('私聊'), '私聊只看私聊');
assert.ok(priv.includes('无key的旧私聊'), '主人私聊能看到无 key 的旧私聊');
assert.ok(!render('private:888').includes('无key的旧私聊'), '非主人私聊不能看到无 key 的旧私聊');
assert.ok(!render('private:888').includes('私聊的事'), '非主人私聊不能看到主人的私聊');
assert.ok(!priv.includes('桌宠的事'), '私聊不注入桌宠记忆');
assert.ok(!a.includes('来源未知'), '没有未知来源混入');

// 主人私聊额外读白名单群：默认关；开启后只给主人，且仍受白名单/黑名单/条数限制。
const ownerOn = render('private:999', CFG_ON);
assert.ok(ownerOn.includes('A群的事') && ownerOn.includes('B群的事'), '开启后主人私聊应看到白名单群');
assert.ok(!ownerOn.includes('C群的事'), '未加入白名单/只读列表的 C 群不应出现');
assert.ok(ownerOn.includes('无key的旧私聊'), '主人私聊仍能看到自己的旧私聊');
assert.ok(!ownerOn.includes('桌宠的事'), '群记忆开关不放开桌宠');
const otherOn = render('private:888', CFG_ON);
assert.ok(!otherOn.includes('A群的事') && !otherOn.includes('B群的事'), '非主人私聊不能读群记忆');
const denied = render('private:999', CFG_ON, { ...RUNTIME, privateDeniedGroups: ['222'] });
assert.ok(denied.includes('A群的事') && !denied.includes('B群的事'), '黑名单群不应出现');
const only111 = render('private:999', CFG_ON, { ...RUNTIME, privateGroupIds: ['111'] });
assert.ok(only111.includes('A群的事') && !only111.includes('B群的事'), '可读群号过滤生效');
const noAllow = render('private:999', CFG_ON, { ...RUNTIME, privateAllowedGroups: [] });
assert.ok(!noAllow.includes('A群的事'), '白名单为空且未 allowAll 时应 fail closed');
const allowAll = render('private:999', CFG_ON, { ...RUNTIME, privateAllowedGroups: [], allowAllWhenEmpty: true });
assert.ok(allowAll.includes('A群的事'), 'allowAllWhenEmpty=true 时才允许全部群');

// 群记忆独立预算：不能在低注入预算下把私聊自己的记忆挤掉。
{
  const budgetCard = createEmptyCard(T);
  const addBudget = (input) => addMemoryRecord(budgetCard, { createdAt: T, lastSeenAt: T, ...input }, CFG_ON, T);
  addBudget({ source: 'qq-owner', speaker: '主人', text: '必须保留的私聊记忆', conversationKey: 'private:999', private: true });
  for (let i = 0; i < 10; i += 1) {
    addBudget({ source: 'qq-group', speaker: `群友${i}`, text: `群里的第${i}条近况`, conversationKey: 'group:111', groupId: '111', groupName: 'A群' });
  }
  const budgetText = renderMemoryCard(budgetCard, {
    config: CFG_ON, platform: 'qq', conversationKey: 'private:999', maxChars: 600, runtimeSharing: RUNTIME,
  });
  assert.ok(budgetText.includes('必须保留的私聊记忆'), '群记忆不能把私聊自己的记忆挤出预算');
  assert.ok(budgetText.includes('群里的近况'), '主人私聊应有独立的群近况小节');
}

// 同文本不同群不能被去重合并
const before = card.records.length;
add({ source: 'qq-owner', speaker: '主人', text: '同一句话', conversationKey: 'group:111', groupId: '111', groupName: 'A群' });
add({ source: 'qq-owner', speaker: '主人', text: '同一句话', conversationKey: 'group:222', groupId: '222', groupName: 'B群' });
assert.equal(card.records.length, before + 2, '跨群同文本不能合并');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-sharing-'));
try {
  const paths = resolveMemoryCardPaths(tmp);
  saveMemoryCardOutputs(paths, card, CFG, T, RUNTIME);
  const map = JSON.parse(fs.readFileSync(path.join(tmp, 'memory-card-prompt-qq-groups.json'), 'utf8'));
  assert.ok(map.blocks['group:111'].includes('A群的事'));
  assert.ok(!map.blocks['group:111'].includes('私聊的事'));
  assert.ok(map.blocks['private:999'].includes('私聊的事'));
  assert.ok(!map.blocks['private:999'].includes('A群的事'), '关闭时私聊块不含群记忆');
  assert.ok(map.blocks['private:999'].includes('无key的旧私聊'), '主人私聊块保留无 key 旧私聊');
  assert.ok(!map.blocks['private:888'].includes('无key的旧私聊'), '非主人私聊块不串无 key 旧私聊');

  saveMemoryCardOutputs(paths, card, CFG_ON, T, RUNTIME);
  const onMap = JSON.parse(fs.readFileSync(path.join(tmp, 'memory-card-prompt-qq-groups.json'), 'utf8'));
  assert.ok(onMap.blocks['private:999'].includes('A群的事') && onMap.blocks['private:999'].includes('B群的事'), '开启后主人私聊块含白名单群');
  assert.ok(onMap.blocks['private:999'].includes('私聊的事'), '开启后私聊自己的记忆仍在');
  assert.ok(!onMap.blocks['private:999'].includes('C群的事'), '未入白名单的群不进主人私聊块');
  assert.ok(!onMap.blocks['private:888'].includes('A群的事'), '非主人私聊块不含群记忆');
  assert.ok(onMap.blocks['group:111'].includes('A群的事') && !onMap.blocks['group:111'].includes('私聊的事'), '群块仍然不受影响');
  console.log('✅ 记忆互通圈/来源标签/主人私聊读群记忆测试通过');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const bridgeSource = fs.readFileSync('src/bridge.js', 'utf8');
const memorySource = fs.readFileSync('src/memory-card.js', 'utf8');
assert.ok(memorySource.includes('privateReadsGroups'), '核心模块缺少主人私聊读群记忆开关');
assert.ok(memorySource.includes('群里的近况'), '核心模块缺少群近况小节');
assert.ok(memorySource.includes('ownerPrivateKey'), '核心模块缺少主人私聊身份边界');
assert.ok(bridgeSource.includes('conversationIdentityLineV2(key)'), '唤醒 prompt 必须带当前群/私聊身份');
assert.ok(bridgeSource.includes('memoryCardPromptBlock(key)'), '记忆注入必须按当前会话取块');
assert.ok(bridgeSource.includes('MEMORY_CARD_GROUP_PROMPTS'), '桥接必须读按会话记忆块');
assert.ok(bridgeSource.includes("if (currentMode === 'reserved2') return '';"), 'v2 没有按会话块时必须 fail closed');
assert.ok(bridgeSource.includes('groupNameForMemory'), '落库时必须带群名');
