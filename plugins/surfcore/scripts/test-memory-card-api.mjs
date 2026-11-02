/**
 * 记忆卡插件侧集成测试（临时 DSH_HOME + 临时 QQBOT_ROOT，不碰真实数据）。
 *
 * 覆盖：
 *   · 维护器真的读 inbox / bili-memory.json 并写 4 份文件；
 *   · 控制台动作（pin / add / forget / compact / ack）能落盘；
 *   · B站 注入块可读、且不会把 QQ 私事带过去。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-memory-card-'));
const dshHome = path.join(tempRoot, 'dsh');
const qqbotRoot = path.join(tempRoot, 'qqbot');
fs.mkdirSync(path.join(dshHome, 'surfcore', 'memory'), { recursive: true });
fs.mkdirSync(path.join(qqbotRoot, 'state'), { recursive: true });
fs.mkdirSync(path.join(qqbotRoot, 'src'), { recursive: true });
fs.writeFileSync(path.join(qqbotRoot, 'config.json'), '{"ownerQQ":10001}\n');
fs.writeFileSync(path.join(qqbotRoot, 'src', 'bridge.js'), '// fake root for test\n');
fs.writeFileSync(path.join(dshHome, 'surfcore', 'config.json'), `${JSON.stringify({
  admin: { qq: '10001', biliMid: '', biliName: '', displayName: '主人', gentle: true },
  memoryCard: { enabled: true, maxChars: 3000, injectMaxChars: { qq: 800, bili: 600 }, notifyOwner: false },
}, null, 2)}\n`);

process.env.DSH_HOME = dshHome;
process.env.SURFCORE_QQBOT_ROOT = qqbotRoot;
process.env.SURFCORE_DISABLE_MEMORY_TIMER = '1';

const now = Date.now();
fs.writeFileSync(path.join(dshHome, 'surfcore', 'memory', 'memory-inbox.jsonl'), [
  JSON.stringify({ at: new Date(now - 60_000).toISOString(), kind: 'private', sender: '主人', senderId: '10001', isOwner: true, private: true, direct: true, text: '第一次跟角色说：以后就是一家人了' }),
  JSON.stringify({ at: new Date(now - 30_000).toISOString(), kind: 'group', sender: 'omm', senderId: '2373982492', isOwner: false, direct: true, text: '角色今天在吗' }),
].join('\n') + '\n');
fs.writeFileSync(path.join(qqbotRoot, 'state', 'bili-memory.json'), `${JSON.stringify({
  generatedAt: new Date(now).toISOString(),
  entries: [
    { id: 'bv:test001', type: 'video', title: '鲸鱼娘的二创', reason: '可爱又好笑', score: 15, favorite: true, at: new Date(now - 3_600_000).toISOString() },
  ],
}, null, 2)}\n`);

const mod = await import('../lib/memory-card.js');
const paths = mod.memoryCardPaths();

try {
  // 1) 维护：写入 4 份文件
  const maintained = await mod.runMemoryCardMaintenance({ forceDecay: false });
  assert.equal(maintained.ok, true);
  assert.equal(maintained.addedQq, 2);
  assert.equal(maintained.addedBili, 1);
  for (const file of [paths.json, paths.markdown, paths.promptQq, paths.promptBili]) {
    assert.equal(fs.existsSync(file), true, `缺少输出文件：${file}`);
  }
  // 全量卡：JSONL + stats + md，没有 prompt 文件（日常不加载）
  assert.equal(fs.existsSync(paths.fullJsonl), true, '缺少全量卡 JSONL');
  assert.equal(fs.existsSync(paths.fullStats), true, '缺少全量卡 stats');
  assert.equal(fs.existsSync(paths.fullMarkdown), true, '缺少全量卡 md');
  assert.equal(Object.prototype.hasOwnProperty.call(paths, 'promptFull'), false);

  // 2) 状态 / 注入块
  const snap = mod.memoryCardSnapshot();
  assert.equal(snap.status.counts.owner, 1);
  assert.equal(snap.status.counts.anchors, 1);
  assert.equal(snap.status.counts.firstMet >= 1, true);
  assert.equal(snap.firstMet.source, 'auto');
  assert.equal(snap.loaded, 'decayed');
  assert.equal(mod.fullMemoryCardSnapshot().status.records >= 2, true);
  assert.ok(snap.markdown.includes('记忆卡'));
  assert.ok(snap.promptQq.includes('主人'));
  // B站 注入块不能出现 QQ 私事
  assert.equal(snap.promptBili.includes('一家人'), false);
  assert.ok(mod.memoryCardPromptBlock('qq').includes('记忆卡'));
  assert.ok(mod.memoryCardPromptBlock('bili').includes('B站') || mod.memoryCardPromptBlock('bili').includes('鲸鱼娘'));
  // 全量卡检索
  const fullSnap = mod.fullMemoryCardSnapshot({ q: '鲸鱼娘', limit: 10 });
  assert.equal(fullSnap.fullLoaded, false);
  assert.equal(fullSnap.records.length >= 1, true);
  assert.match(fullSnap.records[0].text, /鲸鱼娘/);

  // 3) pin / add / forget
  const ownerRecord = snap.records.find((record) => record.tags.includes('owner'));
  assert.ok(ownerRecord);
  assert.equal(ownerRecord.isInitial, true);
  const designated = await mod.applyMemoryCardAction('set-first-meet', { ids: [ownerRecord.id] });
  assert.equal(designated.ok, true);
  assert.equal(mod.memoryCardSnapshot().firstMet.source, 'manual');
  const clearedFirst = await mod.applyMemoryCardAction('clear-first-meet');
  assert.equal(clearedFirst.ok, true);
  assert.equal(mod.memoryCardSnapshot().firstMet.source, 'auto');
  const pinned = await mod.applyMemoryCardAction('pin', { id: ownerRecord.id, pinned: true });
  assert.equal(pinned.ok, true);
  assert.equal(mod.memoryCardSnapshot().records.find((r) => r.id === ownerRecord.id).pinned, true);

  const added = await mod.applyMemoryCardAction('add', { text: '手动记一条：主人说周末带角色去看海。', importance: 88, scope: 'qq' });
  assert.equal(added.ok, true);
  const manual = mod.memoryCardSnapshot().records.find((record) => record.tags.includes('manual'));
  assert.ok(manual);

  const pinnedManual = await mod.applyMemoryCardAction('pin', { id: manual.id, pinned: true });
  assert.equal(pinnedManual.ok, true);
  const forgotManual = await mod.applyMemoryCardAction('forget', { id: manual.id });
  assert.equal(forgotManual.ok, true, '置顶记录现在允许忘记');
  // 衰减卡忘了，全量卡仍然保留完整原文（这是「以后能加载全量记忆」的核心）
  const fullAfterForget = mod.fullMemoryCardSnapshot({ q: '周末带角色去看海', limit: 10 });
  assert.equal(fullAfterForget.records.length >= 1, true, '全量卡应保留已从衰减卡忘记的记忆');

  // 3.5) 多选任意记忆合并为一个事件（不改变初次相遇）
  await mod.applyMemoryCardAction('add', { text: '合并素材一：B站看到鲸鱼娘', importance: 50, scope: 'bili' });
  await mod.applyMemoryCardAction('add', { text: '合并素材二：B站看到猫猫', importance: 55, scope: 'bili' });
  const mergeCandidates = mod.memoryCardSnapshot().records
    .filter((record) => record.tags.includes('manual'))
    .slice(0, 2);
  assert.equal(mergeCandidates.length, 2);
  const merged = await mod.applyMemoryCardAction('merge-memories', {
    ids: mergeCandidates.map((record) => record.id),
    title: '合并测试事件',
    pinned: true,
  });
  assert.equal(merged.ok, true);
  assert.equal(merged.merged, 2);
  const mergedSnap = mod.memoryCardSnapshot();
  const mergedRecord = mergedSnap.records.find((record) => record.tags.includes('merged'));
  assert.ok(mergedRecord);
  assert.equal(mergedRecord.title, '合并测试事件');
  assert.equal(mergedRecord.pinned, true);
  assert.equal(mergedSnap.firstMet.source, 'auto', '合并普通记忆不应改变初次相遇');

  // 置顶排序：置顶的合并事件应排在“重要度 100 但未置顶”的记忆之前
  await mod.applyMemoryCardAction('add', { text: '未置顶的高重要记忆', importance: 100, scope: 'bili' });
  const sortSnap = mod.memoryCardSnapshot();
  const mergedIndex = sortSnap.records.findIndex((record) => record.tags.includes('merged'));
  const firstMetIndex = sortSnap.records.findIndex((record) => record.firstMet);
  const highIndex = sortSnap.records.findIndex((record) => record.text.includes('未置顶的高重要记忆'));
  assert.ok(mergedIndex >= 0 && firstMetIndex >= 0 && highIndex >= 0);
  assert.equal(firstMetIndex, 0, '初次相遇必须永远排最顶');
  assert.ok(mergedIndex > firstMetIndex, '置顶合并事件排在初次相遇之后');
  assert.ok(mergedIndex < highIndex, '置顶记忆必须排在未置顶的高重要记忆之前');

  // 4) 压缩 / 确认告警（空操作也应 ok）
  const compacted = await mod.compactMemoryCardNow({ targetRatio: 0.8 });
  assert.equal(compacted.ok, true);
  const acked = await mod.applyMemoryCardAction('ack', { level: 1 });
  assert.equal(acked.ok, true);

  // 5) 再维护一次：幂等（没有新 inbox / B站 条目不重复）
  const again = await mod.runMemoryCardMaintenance();
  assert.equal(again.addedQq, 0);
  assert.equal(again.addedBili, 0);

  // 5.5) 初次相遇也可以被忘记；删除后不能再指向不存在的 firstMet。
  const forgotFirst = await mod.applyMemoryCardAction('forget', { id: ownerRecord.id });
  assert.equal(forgotFirst.ok, true, '初次相遇现在允许忘记');
  const afterFirstForget = mod.memoryCardSnapshot();
  assert.equal(afterFirstForget.records.some((record) => record.id === ownerRecord.id), false);
  assert.equal(afterFirstForget.records.some((record) => record.firstMet), false, '没有主人记录时不应残留 firstMet');

  // 6) 关掉记忆卡：必须清空 QQ 注入块（桥接只认文件，不能“设置关了但提示词还在”）
  fs.writeFileSync(path.join(dshHome, 'surfcore', 'config.json'), `${JSON.stringify({
    admin: { qq: '10001', displayName: '主人', gentle: true },
    memoryCard: { enabled: false },
  }, null, 2)}\n`);
  const disabled = await mod.runMemoryCardMaintenance();
  assert.equal(disabled.disabled, true);
  assert.equal(fs.existsSync(paths.fullJsonl), true, '关掉日常记忆卡不应删除全量存档');
  assert.equal(fs.readFileSync(paths.promptQq, 'utf8'), '');
  assert.equal(fs.readFileSync(paths.promptBili, 'utf8'), '');
  console.log('memory-card plugin integration: OK');
} finally {
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
}
