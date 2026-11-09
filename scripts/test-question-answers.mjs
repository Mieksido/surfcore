// 提问回答编码回归（纯函数，不连 DSH）。
//
// 背景：DSH 的单选回答不允许 selected + custom 并存（apiproxy 校验），
// 所以来源标注必须按题型的合法分支编码；见 src/question-answers.js 顶部说明。
import {
  OWNER_ONLY_TAG, isOwnerOnlyFrame, canConsumePending, responderNote, buildQuestionAnswers,
} from '../src/question-answers.js';

let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log(`✅ ${label}`);
  else { failures += 1; console.error(`❌ ${label}`); }
};

console.log('## 1. [仅主人] 分类标记');
{
  ok(isOwnerOnlyFrame([{ header: '[仅主人]' }]) === true, '任一问题带标记 → 整帧 owner-only');
  ok(isOwnerOnlyFrame([{ header: '普通' }, { header: '[仅主人]' }]) === true, '多问一帧里有标记也算');
  ok(isOwnerOnlyFrame([{ header: '普通' }]) === false, '没有标记 → 普通');
  ok(isOwnerOnlyFrame([]) === false && isOwnerOnlyFrame(null) === false, '空/缺省不误判');
  ok(OWNER_ONLY_TAG === '[仅主人]', '标记字符串固定（preset 和桥接共用）');
}

console.log('## 2. 谁能消费 pending');
{
  ok(canConsumePending({ kind: 'approval' }, true) === true, '审批：主人可消费');
  ok(canConsumePending({ kind: 'approval' }, false) === false, '审批：非主人不消费（消息继续走群聊）');
  ok(canConsumePending({ kind: 'question', ownerOnly: false }, false) === true, '普通提问：群友可答');
  ok(canConsumePending({ kind: 'question', ownerOnly: true }, false) === false, '仅主人提问：群友不消费');
  ok(canConsumePending({ kind: 'question', ownerOnly: true }, true) === true, '仅主人提问：主人可答');
  ok(canConsumePending(null, true) === false, '无 pending 不消费');
}

console.log('## 3. 来源标注');
{
  ok(responderNote({ isOwner: true }).includes('管理员'), '管理员来源');
  const g = responderNote({ isOwner: false, sender: '张三' });
  ok(g.includes('非管理员') && g.includes('张三'), '群友来源带昵称与非管理员');
  ok(responderNote({ isOwner: false }).includes('未知'), '缺昵称不崩');
}

console.log('## 4. 单选题：selected 必须留空（DSH 约束），选项文字进 custom');
{
  const pending = { questions: [{ id: 'q1', header: '普通', options: [{ label: '继续' }, { label: '停' }] }] };
  const hit = buildQuestionAnswers(pending, '继续', { isOwner: false, sender: '张三' });
  ok(hit[0].selected.length === 0, '单选命中：selected 为空（否则 DSH 拒收）');
  ok(hit[0].custom.includes('继续') && hit[0].custom.includes('非管理员'), '单选命中：选项文字 + 来源都在 custom');
  const typed = buildQuestionAnswers(pending, '随便聊聊', { isOwner: true });
  ok(typed[0].custom.includes('随便聊聊') && typed[0].custom.includes('管理员'), '单选自由文本：原文 + 来源');
  ok(typed[0].selected.length === 0, '单选自由文本：selected 仍为空');
}

console.log('## 5. 多选题：selected 保留 + custom 带来源（DSH 允许）');
{
  const pending = { questions: [{ id: 'q2', header: '普通', multiSelect: true, options: [{ label: 'A' }, { label: 'B' }] }] };
  const hit = buildQuestionAnswers(pending, 'A', { isOwner: false, sender: '张三' });
  ok(hit[0].selected.length === 1 && hit[0].selected[0] === 'A', '多选命中：selected 保留');
  ok(hit[0].custom.includes('非管理员'), '多选命中：custom 带来源');
  const typed = buildQuestionAnswers(pending, 'C', { isOwner: true });
  ok(typed[0].selected.length === 0 && typed[0].custom.includes('C'), '多选自由文本：原文进 custom');
}

console.log('## 6. 多问题一帧：逐题编码，id 一一对应');
{
  const pending = { questions: [
    { id: 'a', header: '普通', options: [{ label: '好' }] },
    { id: 'b', header: '普通', multiSelect: true, options: [{ label: '好' }] },
  ] };
  const answers = buildQuestionAnswers(pending, '好', { isOwner: true });
  ok(answers.length === 2 && answers[0].id === 'a' && answers[1].id === 'b', 'id 与问题顺序一致');
  ok(answers[0].selected.length === 0 && answers[1].selected.length === 1, '单选/多选分别按合法形状编码');
}

console.log(failures === 0 ? '\n✅ 提问回答编码回归通过' : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
