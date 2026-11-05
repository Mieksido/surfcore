// 唤醒注入**端到端**回归：不用等真实 QQ 消息，直接用 VM 夹具驱动 buildWakePromptV2，
// 验证四段记忆类内容在「真桥接代码」里确实按设计进入提示词、且互不打架。
//
// 为什么要有这一条：第 1 / 4 / 5 / 6 件各自的单测都绿，但真机上「四段同时存在时会怎样」
// 一直只能靠等聊天来观察（P1 遗留）。这里把那条等待换成确定性验证：
//   · 对方在回忆 → 注入【记忆检索…】且能命中档案里的旧事；
//   · 对方没在回忆、也没有检索命中 → 才轮到【忽然想起】（两者互斥，避免同一件事说两遍）；
//   · 有到期的约定 → 注入【到期的约定】；
//   · 私聊里说了「我不吃 X」→ 下一次唤醒带【可能值得记住的】。
// 只读夹具自己的 temp 目录，不碰真实记忆与真实桥接。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { bridgeHarness } from './audit-bridge-harness.mjs';

let failures = 0;
async function test(name, run) {
  const h = await bridgeHarness();
  try {
    h.setMode('reserved2');
    await run(h);
    console.log('PASS', name);
  } catch (error) {
    failures += 1;
    console.error('FAIL', name, error.message);
  } finally {
    await h.close();
  }
}

const KEY = 'private:123';

/** 往夹具的记忆档案里写两条旧事（memory-recall 会按需建 FTS 索引）。 */
function seedMemory(h) {
  const dir = path.join(h.temp, 'dsh', 'surfcore', 'memory');
  fs.mkdirSync(dir, { recursive: true });
  const now = Date.now();
  const rows = [
    {
      id: 'mem_lamp_blue', text: '主人房间里那根五十米的灯带，晚上开着是偏蓝的光。',
      clarity: 'clear', createdAt: now - 30 * 86400000, lastSeenAt: now - 10 * 86400000,
      recallCount: 2, decaySteps: 1, importance: 60,
    },
    {
      id: 'mem_cat_town', text: '猫咪小镇那家店门口有只橘猫，见人就翻肚皮。',
      clarity: 'fuzzy', createdAt: now - 120 * 86400000, lastSeenAt: now - 100 * 86400000,
      recallCount: 0, decaySteps: 2, importance: 40,
    },
  ];
  fs.writeFileSync(path.join(dir, 'memory-card-full.jsonl'), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
}

/** 造一条「对方刚说的话」——buildWakePromptV2 取的是 recentMessages 里最后一条非自己消息。 */
function sayLast(h, text) {
  h.appendSocialV2Message(KEY, '主人', text, text, false, true, 'm1');
}

await test('对方在回忆：提示词里出现【记忆检索…】并命中档案里的旧事', async (h) => {
  seedMemory(h);
  sayLast(h, '你还记得我屋里那根灯带吗？');
  const prompt = h.buildWakePromptV2(KEY, 'replyCheck');
  assert.ok(prompt.includes('【记忆检索'), '要注入检索段');
  assert.ok(prompt.includes('灯带'), '要带命中正文');
  assert.ok(!prompt.includes('mem_lamp_blue'), '不能把记忆 id 漏进提示词');
});

await test('对方没在回忆：不注入检索段', async (h) => {
  seedMemory(h);
  sayLast(h, '今天外面风挺大的');
  const prompt = h.buildWakePromptV2(KEY, 'replyCheck');
  assert.ok(!prompt.includes('【记忆检索'), '没触发词就不该出现检索段');
});

await test('检索命中和联想互斥：检索命中时不再叠【忽然想起】', async (h) => {
  seedMemory(h);
  h.associateCache.set(KEY, { at: Date.now(), items: [{ id: 'mem_old_cat', text: '去年冬天河边那只白猫', R: 0.42, clarity: 'fuzzy' }] });
  sayLast(h, '你还记得我屋里那根灯带吗？');
  const prompt = h.buildWakePromptV2(KEY, 'replyCheck');
  assert.ok(prompt.includes('【记忆检索'), '检索段在');
  assert.ok(!prompt.includes('【忽然想起】'), '同一轮不要再叠联想');
});

await test('没有检索触发时才轮到【忽然想起】', async (h) => {
  seedMemory(h);
  h.associateCache.set(KEY, { at: Date.now(), items: [{ id: 'mem_old_cat', text: '去年冬天河边那只白猫', R: 0.42, clarity: 'fuzzy' }] });
  sayLast(h, '今天外面风挺大的');
  const prompt = h.buildWakePromptV2(KEY, 'replyCheck');
  assert.ok(prompt.includes('【忽然想起】'), '要注入联想段');
  assert.ok(prompt.includes('白猫'), '要带正文');
});

await test('到期的约定：提示词里出现【到期的约定】与正文', async (h) => {
  sayLast(h, '在吗');
  h.promiseWakePending.set(KEY, {
    at: Date.now(),
    items: [{ id: 'p1', text: '周六陪我去看那家店的橘猫', dueDate: '2026-11-07' }],
  });
  const prompt = h.buildWakePromptV2(KEY, 'promiseDue');
  assert.ok(prompt.includes('【到期的约定】'), '要注入约定段');
  assert.ok(prompt.includes('橘猫'), '要带约定正文');
  assert.ok(prompt.includes('别像闹钟一样念日期'), '要带「自然提起」的口径');
});

await test('私聊说了忌口：下一次唤醒带【可能值得记住的】', async (h) => {
  sayLast(h, '我不吃香菜，你记一下');
  h.noteSuggestCandidate({ key: KEY, text: '我不吃香菜，你记一下', sender: '主人', isOwner: true });
  const prompt = h.buildWakePromptV2(KEY, 'replyCheck');
  assert.ok(prompt.includes('【可能值得记住的】'), '要注入建议段');
  assert.ok(prompt.includes('香菜'), '要带抽出来的事实');
});

if (failures) {
  console.error(`\n唤醒注入测试失败 ${failures} 条`);
  process.exit(1);
}
console.log('\n唤醒注入测试全部通过');