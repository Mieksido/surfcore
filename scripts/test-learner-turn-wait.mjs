// 黑话学习 turn 等待：waiter 必须先注册；缺 turn/start 时也要能收尾。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createTurnCollector } from '../src/dsh-client.js';

// 1) 正常顺序
{
  const c = createTurnCollector({ tolerantStart: true });
  assert.equal(c.push({ type: 'turn/start', data: { turn: 1 } }), null);
  assert.equal(c.push({ type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '答案' }] } } }), null);
  const end = c.push({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
  assert.equal(end.text, '答案');
}

// 2) 缺 turn/start：assistant/message 先到，turn/end 仍要收尾
{
  const c = createTurnCollector({ tolerantStart: true });
  assert.equal(c.push({ type: 'assistant/message', data: { turn: 2, message: { content: [{ type: 'text', text: '迟到答案' }] } } }), null);
  const end = c.push({ type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } });
  assert.equal(end.text, '迟到答案');
}

// 3) 默认 collector 不能改变 QQ 现有行为
{
  const c = createTurnCollector();
  assert.equal(c.push({ type: 'assistant/message', data: { turn: 3, message: { content: [{ type: 'text', text: 'x' }] } } }), null);
  assert.equal(c.push({ type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } } }), null);
}

const bridge = fs.readFileSync(path.resolve('src/bridge.js'), 'utf8');
const extractionAt = bridge.indexOf('async function runSlangExtraction');
const researchAt = bridge.indexOf('async function runSlangResearch');
for (const [name, at] of [['extraction', extractionAt], ['research', researchAt]]) {
  assert.ok(at > 0, `${name} 必须存在`);
  const section = bridge.slice(at, at + 2600);
  assert.ok(section.indexOf('waitLearnerTurn(sessionId)') < section.indexOf('api.sessions.prompt'),
    `${name} 必须先注册 waiter 再发 prompt`);
  assert.ok(section.includes('turnWait.cancel()'), `${name} prompt 失败必须取消 waiter`);
}
assert.ok(bridge.includes("error.code = 'LEARNER_TURN_TIMEOUT'"), '超时必须有稳定 code');
assert.ok(!bridge.includes('/会话|session|not found|404/i'), '超时不能再用泛化“会话”判死');
console.log('✅ 黑话学习 turn 等待测试通过');
