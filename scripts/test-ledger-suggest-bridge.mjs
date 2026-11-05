// 建议候选（第 4 件）的**接线**回归：真实 bridge.js（VM 夹具）里验证入池 → 提示词 → 计数。
//
// 重点不是抽取规则（那是 test-ledger-suggest.mjs），而是通路：
//   · 私聊/主人的话才入池，群友的话不入池；
//   · 提示词里带【可能值得记住的】，但绝不含候选 id；
//   · 一次唤醒里 buildWakePromptV2 调两遍，两遍都要带（消耗性读取的坑：约定那条踩过）；
//   · 投递被接受之后才计数；没投递的不能被算作「提过」；
//   · 候选不串会话。
import assert from 'node:assert/strict';
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

await test('私聊里「关于他自己的事」入池；群友的不入池', async (h) => {
  h.noteSuggestCandidate({ key: KEY, text: '我不吃香菜', sender: '主人', isOwner: true });
  h.noteSuggestCandidate({ key: 'group:9', text: '我对芒果过敏', sender: '群友', isOwner: false });
  const items = Object.values(h.suggestState().items);
  assert.equal(items.length, 1, '只应有私聊那一条');
  assert.equal(items[0].fact, '香菜');
  assert.equal(items[0].key, KEY);
  assert.equal(items[0].status, 'open');
  assert.equal(items[0].shown, 0);
  assert.ok(h.suggestFile().length > 0, '状态文件路径要能拿到');
});

await test('提示词带候选正文，不带内部 id；连建两遍都带', async (h) => {
  h.noteSuggestCandidate({ key: KEY, text: '我对芒果过敏', sender: '主人', isOwner: true });
  const first = h.buildWakePromptV2(KEY, 'replyCheck');
  const second = h.buildWakePromptV2(KEY, 'replyCheck');
  assert.ok(first.includes('【可能值得记住的】'), '第一遍要带');
  assert.ok(second.includes('【可能值得记住的】'), '第二遍也要带（不能在准备阶段消费掉）');
  assert.ok(second.includes('芒果'), '正文要进提示词');
  const [id] = Object.keys(h.suggestState().items);
  assert.ok(!second.includes(id), '不能把候选 id 漏进提示词');
});

await test('候选不串会话', async (h) => {
  h.noteSuggestCandidate({ key: KEY, text: '我养了只橘猫', sender: '主人', isOwner: true });
  const other = h.buildWakePromptV2('private:999', 'replyCheck');
  assert.ok(!other.includes('橘猫'), '别的会话不该看到这条');
  const mine = h.buildWakePromptV2(KEY, 'replyCheck');
  assert.ok(mine.includes('橘猫'));
});

await test('投递接受后才计数；提满 maxShows 不再提', async (h) => {
  h.noteSuggestCandidate({ key: KEY, text: '我喜欢雨天', sender: '主人', isOwner: true });
  const [id] = Object.keys(h.suggestState().items);
  const prompt = h.buildWakePromptV2(KEY, 'replyCheck');
  assert.ok(prompt.includes('雨天'));
  assert.equal(h.suggestState().items[id].shown, 0, '只建提示词时不能计数');

  await h.deliverPrompt(KEY, prompt, { wakeReason: 'replyCheck' });
  assert.equal(h.suggestState().items[id].shown, 1, '接受后计一次');

  await h.deliverPrompt(KEY, h.buildWakePromptV2(KEY, 'replyCheck'), { wakeReason: 'replyCheck' });
  assert.equal(h.suggestState().items[id].shown, 2, '第二次接受再计一次');
  assert.equal(h.suggestState().items[id].status, 'expired', '提满 maxShows 自动作废');

  const later = h.buildWakePromptV2(KEY, 'replyCheck');
  assert.ok(!later.includes('雨天'), '作废的不再提');
});

await test('没有候选时提示词里不出现这一段', async (h) => {
  const prompt = h.buildWakePromptV2('private:555', 'replyCheck');
  assert.ok(!prompt.includes('【可能值得记住的】'));
});

if (failures) {
  console.error(`${failures} case(s) failed`);
  process.exit(1);
}
console.log('建议候选接线：全部通过');